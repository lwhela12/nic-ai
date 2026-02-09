import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, appendFile, writeFile, mkdir } from "fs/promises";
import { readFileSync as readFileSyncFs, existsSync as existsSyncFs } from "fs";

// SDK CLI options helper - handles both direct and npx modes
import { getSDKCliOptions } from "../lib/sdk-cli-options";

import { join, dirname } from "path";
import { homedir } from "os";
import { getSession, saveSession } from "../sessions";
import { indexCase } from "./firm";
import { buildPhasePrompt } from "../shared/phase-rules";
import { isPathWithinBounds, extractPathsFromBash } from "../lib/path-validator";
import { directChat, type ChatMessage as DirectChatMessage } from "../lib/direct-chat";
import { requireCaseAccess } from "../lib/team-access";
import { acquireCaseLock, releaseCaseLock } from "../lib/case-lock";
import { applyResolvedFieldToSummary } from "../lib/index-summary-sync";
import { normalizePracticeArea, resolveFirmPracticeArea } from "../lib/practice-area";

// ============================================================================
// Usage Reporting
// ============================================================================

const DEV_MODE = process.env.DEV_MODE === "true" || process.env.NODE_ENV !== "production";
const SUBSCRIPTION_SERVER = process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  authToken?: string;
}

function loadConfig(): Config | null {
  if (process.env.CLAUDE_PI_CONFIG) {
    try {
      return JSON.parse(process.env.CLAUDE_PI_CONFIG);
    } catch {
      // Fall through
    }
  }
  if (!existsSyncFs(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSyncFs(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Report token usage to the subscription server.
 * This is fire-and-forget - errors are logged but don't affect the main request.
 */
async function reportUsage(tokensUsed: number, requestType: string): Promise<void> {
  if (DEV_MODE) return;
  const config = loadConfig();
  if (!config?.authToken) return;

  try {
    await fetch(`${SUBSCRIPTION_SERVER}/v1/usage/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify({ tokensUsed, requestType }),
    });
  } catch (err) {
    // Log but don't fail the request
    console.warn("[usage] Failed to report usage:", err);
  }
}

// Types for chat history
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tools?: string[];
}

interface ChatHistory {
  messages: ChatMessage[];
  startedAt: string;
  lastUpdated: string;
}

interface ChatArchiveEntry {
  id: string;
  date: string;
  summary: string;
  messageCount: number;
  file: string;
}

// Log to file for debugging
import { tmpdir } from "os";
const LOG_FILE = join(tmpdir(), "claude-pi-debug.log");
async function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  await appendFile(LOG_FILE, line);
  console.log(msg); // Also try console
}

const app = new Hono();

// Cache the system prompt
let routerPromptCache: string | null = null;

// Phase determination prompt - generated from shared phase rules
const phasePrompt = buildPhasePrompt();

async function loadRouterPrompt(): Promise<string> {
  if (routerPromptCache) return routerPromptCache;
  // Support Electron bundled resources via AGENT_PROMPT_PATH
  const agentDir = process.env.AGENT_PROMPT_PATH || join(import.meta.dir, "../../agent");
  const routerPromptPath = join(agentDir, "router-prompt.md");
  routerPromptCache = await readFile(routerPromptPath, "utf-8");
  return routerPromptCache;
}


// Main chat endpoint - Haiku agent that can spawn Sonnet specialists via Task tool
app.post("/chat", async (c) => {
  const { caseFolder, message, sessionId: providedSessionId } = await c.req.json();

  if (!caseFolder || !message) {
    return c.json({ error: "caseFolder and message required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const routerPrompt = await loadRouterPrompt();
  const sessionId = providedSessionId || (await getSession(caseFolder));

  // Load full case index for context, capping size to prevent context overflow
  let caseContext = "";
  const INDEX_MAX_CHARS = 80000; // ~20K tokens, leaves room for session history + response
  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);

    let indexJson = JSON.stringify(indexData, null, 2);

    // If index is too large, progressively trim it
    if (indexJson.length > INDEX_MAX_CHARS) {
      // First pass: strip verbose fields (extracted_text, full content), keep key_info truncated
      const trimmed = JSON.parse(JSON.stringify(indexData));
      if (trimmed.folders) {
        for (const folderData of Object.values(trimmed.folders) as any[]) {
          const files = Array.isArray(folderData) ? folderData : folderData?.files;
          if (Array.isArray(files)) {
            for (const file of files) {
              delete file.extracted_text;
              delete file.full_text;
              delete file.raw_content;
              delete file.content;
              if (file.key_info && typeof file.key_info === 'string' && file.key_info.length > 500) {
                file.key_info = file.key_info.slice(0, 500) + '...';
              }
            }
          }
        }
      }
      indexJson = JSON.stringify(trimmed, null, 2);

      // Second pass: if still too large, summary-only mode
      if (indexJson.length > INDEX_MAX_CHARS) {
        const summaryIndex: any = {
          case_summary: indexData.case_summary || indexData.summary || null,
          phase: indexData.phase || null,
          reconciled_values: indexData.reconciled_values || null,
          folders: {} as Record<string, string[]>,
        };
        if (indexData.folders) {
          for (const [folder, folderData] of Object.entries(indexData.folders) as [string, any][]) {
            const files = Array.isArray(folderData) ? folderData : folderData?.files;
            if (Array.isArray(files)) {
              summaryIndex.folders[folder] = files.map((f: any) => f.filename || f.path || 'unknown');
            }
          }
        }
        indexJson = JSON.stringify(summaryIndex, null, 2);
        indexJson += '\n\n[NOTE: Index was too large to include in full. Use the Read tool on .pi_tool/document_index.json for complete details.]';
      }
    }

    // Load templates from firm root (parent of case folder)
    let templatesContext = "";
    try {
      const firmRoot = dirname(caseFolder);
      const templatesPath = join(firmRoot, ".pi_tool", "templates", "templates.json");
      const templatesContent = await readFile(templatesPath, "utf-8");
      const templatesData = JSON.parse(templatesContent);
      if (templatesData.templates && templatesData.templates.length > 0) {
        templatesContext = `
AVAILABLE TEMPLATES (at firm root ${firmRoot}/.pi_tool/templates/):
${JSON.stringify(templatesData.templates.map((t: any) => ({ id: t.id, name: t.name, description: t.description })), null, 2)}

To use a template, read: ../.pi_tool/templates/parsed/{id}.md

`;
      }
    } catch {
      // No templates available - that's fine
    }

    // Load knowledge from firm root
    let knowledgeContext = "";
    try {
      const firmRoot = dirname(caseFolder);
      const knowledgePath = join(firmRoot, ".pi_tool", "knowledge", "manifest.json");
      const manifestContent = await readFile(knowledgePath, "utf-8");
      const manifest = JSON.parse(manifestContent);

      // Load each knowledge section
      const sections: string[] = [];
      for (const section of manifest.sections || []) {
        try {
          const sectionPath = join(firmRoot, ".pi_tool", "knowledge", section.filename);
          const content = await readFile(sectionPath, "utf-8");
          sections.push(content);
        } catch {
          // Skip missing sections
        }
      }

      if (sections.length > 0) {
        knowledgeContext = `
PI PRACTICE KNOWLEDGE (${manifest.practiceArea} - ${manifest.jurisdiction}):

${sections.join("\n\n---\n\n")}

`;
      }
    } catch {
      // No knowledge base - that's fine
    }

    // Load firm configuration for signature blocks and letterhead
    let firmInfoContext = "";
    try {
      const firmRoot = dirname(caseFolder);
      const firmConfigPath = join(firmRoot, ".pi_tool", "firm-config.json");
      const firmConfigContent = await readFile(firmConfigPath, "utf-8");
      const firmConfig = JSON.parse(firmConfigContent);

      // Check if firm info is actually configured (not just empty strings)
      const hasConfig = firmConfig.firmName || firmConfig.attorneyName;

      if (hasConfig) {
        firmInfoContext = `
FIRM INFORMATION (use this for signature blocks and letterhead):
- Firm Name: ${firmConfig.firmName || "[Not configured]"}
- Attorney Name: ${firmConfig.attorneyName || "[Not configured]"}
- Address: ${firmConfig.address || "[Not configured]"}
- Phone: ${firmConfig.phone || "[Not configured]"}
- Fax: ${firmConfig.fax || "[Not configured]"}
- Email: ${firmConfig.email || "[Not configured]"}

⚠️ ALWAYS use the firm information above for signature blocks. NEVER use hardcoded names like "Adam Muslusky" or "Muslusky Law" - use the configured firm info.

`;
      } else {
        firmInfoContext = `
⚠️ FIRM INFORMATION NOT CONFIGURED
The firm settings have not been filled in. When generating letters:
- Use placeholder text like "[Firm Name]", "[Attorney Name]", "[Address]", etc.
- Tell the user they need to configure firm settings in the Firm Settings panel
- NEVER use hardcoded names like "Adam Muslusky" or "Muslusky Law"

`;
      }
    } catch {
      // No firm config file - agent will use placeholders
      firmInfoContext = `
⚠️ FIRM INFORMATION NOT CONFIGURED
No firm configuration found. When generating letters, use placeholder text and tell the user to configure firm settings.

`;
    }

    // Load DOI sibling summaries if this is a DOI case (WC multi-injury client)
    let siblingContext = "";
    if (indexData.is_doi_case && indexData.container) {
      try {
        const siblingCases: Array<{ name: string; dateOfInjury: string; summary: any }> = [];

        // Find sibling DOI folders
        if (indexData.related_cases && Array.isArray(indexData.related_cases)) {
          for (const sibling of indexData.related_cases) {
            if (sibling.type === "doi_sibling") {
              try {
                const siblingIndexPath = join(sibling.path, ".pi_tool", "document_index.json");
                const siblingContent = await readFile(siblingIndexPath, "utf-8");
                const siblingIndex = JSON.parse(siblingContent);

                // Extract just the key summary fields for context
                siblingCases.push({
                  name: sibling.name,
                  dateOfInjury: sibling.dateOfInjury || siblingIndex.injury_date || "Unknown",
                  summary: {
                    client: siblingIndex.summary?.client,
                    incident_date: siblingIndex.summary?.incident_date,
                    employer: siblingIndex.summary?.employer?.name,
                    injury_description: siblingIndex.summary?.injury_description,
                    body_parts: siblingIndex.summary?.body_parts,
                    total_charges: siblingIndex.summary?.total_charges,
                    case_phase: siblingIndex.case_phase,
                    disability_status: siblingIndex.summary?.disability_status?.type,
                    wc_carrier: siblingIndex.summary?.wc_carrier?.name,
                  },
                });
              } catch {
                // Sibling index not available
              }
            }
          }
        }

        if (siblingCases.length > 0) {
          siblingContext = `
RELATED CLAIMS FOR THIS CLIENT (${indexData.container.clientName}):
This client has multiple injury claims. The current case is for DOI ${indexData.injury_date}.

Sibling claim summaries (for cross-reference only - keep analyses separate):
${JSON.stringify(siblingCases, null, 2)}

Note: Each claim has its own carrier, injury date, and treatment history. Reference sibling info when relevant but maintain separate case analyses.

`;
        }
      } catch {
        // Couldn't load sibling context - continue without it
      }
    }

    // Get current date for document generation
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    caseContext = `
TODAY'S DATE: ${dateStr}
${siblingContext}
CASE INDEX (use this to answer questions):
${indexJson}
${templatesContext}${knowledgeContext}${firmInfoContext}
WORKING DIRECTORY: ${caseFolder}

USER REQUEST: `;
  } catch {
    // Get current date for document generation
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    caseContext = `
TODAY'S DATE: ${dateStr}

CASE CONTEXT:
- Working Directory: ${caseFolder}
- No document index found. You may need to read documents directly or run indexing first.

USER REQUEST: `;
  }

  return streamSSE(c, async (stream) => {
    const authEmail = c.get("authEmail");
    const lockOwner = typeof authEmail === "string" && authEmail
      ? `user:${authEmail.toLowerCase()}`
      : `session:${Date.now()}`;

    try {
      let currentSessionId: string | undefined;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const lockResult = await acquireCaseLock(
        caseFolder,
        lockOwner,
        typeof authEmail === "string" ? authEmail : undefined
      );
      const writeEnabled = lockResult.acquired;
      const allowedTools = writeEnabled
        ? ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "Task"]
        : ["Read", "Glob", "Grep"];

      if (!writeEnabled) {
        const holder = lockResult.lock?.displayName || lockResult.lock?.owner || "another user";
        await stream.writeSSE({
          data: JSON.stringify({
            type: "text",
            content: `${holder}'s agent is working on this case right now. You can still ask questions, but edits are disabled for now.`,
          }),
        });
      }

      const promptWithContext = caseContext + message;

      // Context size guard: if prompt is very large and we're resuming a session,
      // drop the resume to avoid hitting context limits with stale session history
      const PROMPT_DANGER_CHARS = 120000; // ~30K tokens
      let effectiveSessionId = sessionId || undefined;
      if (promptWithContext.length > PROMPT_DANGER_CHARS && effectiveSessionId) {
        console.warn(`[context-guard] Prompt is ${promptWithContext.length} chars with session resume - dropping session to prevent overflow`);
        effectiveSessionId = undefined;
        await saveSession(caseFolder, "");
      }

      for await (const msg of query({
        prompt: promptWithContext,
        options: {
          cwd: caseFolder,
          systemPrompt: routerPrompt,
          model: "haiku",
          resume: effectiveSessionId,
          // Haiku has Task tool to spawn Sonnet specialists
          allowedTools,
          permissionMode: "acceptEdits",
          maxTurns: 15, // Allow more turns for Task spawning
          ...getSDKCliOptions(),

          // Path boundary enforcement - reject file operations outside the case folder
          canUseTool: async (toolName: string, input: unknown) => {
            if (!writeEnabled && (toolName === "Write" || toolName === "Edit" || toolName === "Bash" || toolName === "Task")) {
              return {
                behavior: "deny" as const,
                message: "This case is currently locked for editing by another agent.",
              };
            }

            // Validate Write and Edit tool paths
            if (toolName === "Write" || toolName === "Edit") {
              const filePath = (input as { file_path?: string }).file_path;
              if (filePath) {
                const isAllowed = await isPathWithinBounds(filePath, caseFolder, caseFolder);
                if (!isAllowed) {
                  return {
                    behavior: "deny" as const,
                    message: `Path "${filePath}" is outside the case folder. Use absolute paths within: ${caseFolder}`,
                  };
                }
              }
            }

            // Validate Bash commands that write files
            if (toolName === "Bash") {
              const command = (input as { command?: string }).command;
              if (command) {
                const paths = extractPathsFromBash(command);
                for (const path of paths) {
                  const isAllowed = await isPathWithinBounds(path, caseFolder, caseFolder);
                  if (!isAllowed) {
                    return {
                      behavior: "deny" as const,
                      message: `Bash command targets path "${path}" outside case folder. Stay within: ${caseFolder}`,
                    };
                  }
                }
              }
            }

            return { behavior: "allow" as const };
          },
        },
      })) {
        // Capture session ID
        if (msg.type === "system" && msg.subtype === "init") {
          currentSessionId = msg.session_id;
          await stream.writeSSE({
            data: JSON.stringify({ type: "init", sessionId: msg.session_id }),
          });
          continue;
        }

        // Stream assistant text and track usage
        if (msg.type === "assistant") {
          const usage = (msg as any).message?.usage || (msg as any).usage;
          if (usage) {
            totalInputTokens = usage.input_tokens ?? usage.inputTokens ?? totalInputTokens;
            totalOutputTokens += usage.output_tokens ?? usage.outputTokens ?? 0;
            await stream.writeSSE({
              data: JSON.stringify({
                type: "usage",
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                contextPercent: Math.round((totalInputTokens / 200000) * 100),
              }),
            });
          }

          for (const block of msg.message.content) {
            if (block.type === "text") {
              // Filter out compaction-related messages from the SDK
              const text = block.text.toLowerCase();
              const isCompactionMessage =
                text.includes("prompt is too long") ||
                text.includes("process exited with code 1") ||
                text.includes("compacting conversation") ||
                text.includes("conversation has been compacted") ||
                text.includes("summarizing the conversation");

              if (isCompactionMessage) {
                // Send compaction event instead of text (for UI indicator)
                await stream.writeSSE({
                  data: JSON.stringify({ type: "compaction" }),
                });
              } else {
                await stream.writeSSE({
                  data: JSON.stringify({ type: "text", content: block.text }),
                });
              }
            } else if (block.type === "tool_use") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "tool", name: block.name }),
              });
            }
          }
        }

        // Stream result with final usage
        if (msg.type === "result") {
          const resultUsage = (msg as any).usage;
          if (resultUsage) {
            const inputTokens = resultUsage.input_tokens ?? 0;
            const cacheCreation = resultUsage.cache_creation_input_tokens ?? 0;
            const cacheRead = resultUsage.cache_read_input_tokens ?? 0;
            totalInputTokens = inputTokens + cacheCreation + cacheRead;
            totalOutputTokens = resultUsage.output_tokens ?? 0;
          }

          const modelUsage = (msg as any).modelUsage;
          let contextWindow = 200000;
          if (modelUsage) {
            for (const model of Object.values(modelUsage) as any[]) {
              if (model.contextWindow) {
                contextWindow = Math.max(contextWindow, model.contextWindow);
              }
            }
          }

          const contextPercent = Math.round((totalInputTokens / contextWindow) * 100);

          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              success: msg.subtype === "success",
              result: msg.subtype === "success" ? msg.result : undefined,
              sessionId: msg.session_id,
              usage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                contextPercent,
              },
            }),
          });
        }
      }

      // Save session for continuity
      if (currentSessionId) {
        await saveSession(caseFolder, currentSessionId);
      }

      // Report usage to subscription server (fire-and-forget)
      if (totalInputTokens + totalOutputTokens > 0) {
        reportUsage(totalInputTokens + totalOutputTokens, "chat").catch(() => {});
      }

      if (lockResult.acquired) {
        await releaseCaseLock(caseFolder, lockOwner);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorLower = errorMsg.toLowerCase();
      console.error("Agent error:", errorMsg);

      await releaseCaseLock(caseFolder, lockOwner);

      // Detect autocompact crash: "process exited with code 1" or "prompt is too long"
      const isContextOverflow =
        errorLower.includes('process exited with code 1') ||
        errorLower.includes('prompt is too long') ||
        errorLower.includes('context_length_exceeded') ||
        errorLower.includes('max_tokens');

      if (isContextOverflow) {
        // Clear the broken session immediately so the next attempt starts fresh
        await saveSession(caseFolder, "");
        console.warn(`[recovery] Context overflow detected, cleared session for ${caseFolder}`);

        // Try to generate a brief summary of recent chat history for continuity
        let recoverySummary = "The conversation context grew too large and was reset. Your previous discussion has been preserved in chat history.";
        try {
          const historyPath = join(caseFolder, ".pi_tool", "chat_history.json");
          const historyContent = await readFile(historyPath, "utf-8");
          const history = JSON.parse(historyContent);
          if (history.messages && history.messages.length > 0) {
            // Take last few messages for a quick summary
            const recentMessages = history.messages.slice(-6);
            const conversationText = recentMessages
              .map((m: any) => `${m.role.toUpperCase()}: ${(m.content || '').slice(0, 200)}`)
              .join('\n');

            // Generate a quick summary via Haiku (non-streaming, fire-and-forget if it fails)
            let summaryText = '';
            for await (const msg of query({
              prompt: `Briefly summarize this recent conversation (2-3 sentences) so it can be resumed:\n\n${conversationText}\n\nSUMMARY:`,
              options: {
                model: "haiku",
                allowedTools: [],
                permissionMode: "acceptEdits",
                maxTurns: 1,
                persistSession: false, // No need to persist one-shot recovery queries
                ...getSDKCliOptions(),
              },
            })) {
              if (msg.type === "assistant") {
                for (const block of msg.message.content) {
                  if (block.type === "text") summaryText += block.text;
                }
              }
            }
            if (summaryText.trim()) {
              recoverySummary = summaryText.trim();
            }
          }
        } catch (summaryError) {
          console.error("[recovery] Failed to generate summary:", summaryError);
          // Continue with default recovery message
        }

        await stream.writeSSE({
          data: JSON.stringify({
            type: "context_overflow_recovery",
            message: "Context grew too large. Session has been reset.",
            summary: recoverySummary,
          }),
        });
      } else {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            error: errorMsg,
          }),
        });
      }
    }
  });
});

// Direct API chat endpoint - faster, lighter weight
// Uses direct Anthropic API calls instead of Agent SDK
app.post("/chat-v2", async (c) => {
  const { caseFolder, message, history } = await c.req.json();

  if (!caseFolder || !message) {
    return c.json({ error: "caseFolder and message required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  // Convert history format if needed
  const chatHistory: DirectChatMessage[] = (history || []).map((m: any) => ({
    role: m.role as "user" | "assistant",
    content: m.content
  }));

  return streamSSE(c, async (stream) => {
    try {
      let fullResponse = "";
      const authEmail = c.get("authEmail");
      const lockOwner = typeof authEmail === "string" && authEmail ? `user:${authEmail.toLowerCase()}` : undefined;

      for await (const event of directChat(caseFolder, message, chatHistory, {
        lockOwner,
        lockDisplayName: typeof authEmail === "string" ? authEmail : undefined,
      })) {
        if (event.type === "text" && event.content) {
          fullResponse += event.content;
          await stream.writeSSE({
            data: JSON.stringify({ type: "text", content: event.content }),
          });
        } else if (event.type === "tool") {
          await stream.writeSSE({
            data: JSON.stringify({ type: "tool", name: event.tool || event.content }),
          });
        } else if (event.type === "tool_executing") {
          await stream.writeSSE({
            data: JSON.stringify({ type: "tool_executing", name: event.tool }),
          });
        } else if (event.type === "delegating") {
          // Document generation agent is taking over
          await stream.writeSSE({
            data: JSON.stringify({ type: "delegating", message: event.content }),
          });
        } else if (event.type === "status") {
          // Status update from document agent
          await stream.writeSSE({
            data: JSON.stringify({ type: "status", message: event.content }),
          });
        } else if (event.type === "document_view" && event.view) {
          await stream.writeSSE({
            data: JSON.stringify({ type: "document_view", view: event.view }),
          });
        } else if (event.type === "done") {
          // Report usage to subscription server
          if (event.usage) {
            const totalTokens = (event.usage.inputTokens || 0) + (event.usage.outputTokens || 0);
            if (totalTokens > 0) {
              reportUsage(totalTokens, "direct_chat").catch(() => {});
            }
          }
          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              success: true,
              usage: event.usage,
              filePath: event.filePath,
            }),
          });
        }
      }
    } catch (error) {
      console.error("Direct chat error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Initialize case - uses shared indexCase from firm.ts
// This provides file-by-file extraction with Haiku + Sonnet summary
app.post("/init", async (c) => {
  await log("========== INIT ENDPOINT HIT ==========");

  const { caseFolder, files } = await c.req.json();
  await log(`Case folder: ${caseFolder}`);
  if (files?.length) {
    await log(`Incremental mode: ${files.length} file(s)`);
  }

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const startTime = Date.now();

  return streamSSE(c, async (stream) => {
    try {
      // Use the shared indexCase function from firm.ts
      // Pass incrementalFiles if provided for incremental indexing
      // Derive firmRoot as parent directory of caseFolder
      const firmRoot = dirname(caseFolder);
      // Resolve practice area from folder metadata first.
      // Fallback to existing index for backward compatibility.
      let practiceArea = await resolveFirmPracticeArea(firmRoot);
      if (!practiceArea) {
        try {
          const existingIndex = JSON.parse(await readFile(join(caseFolder, '.pi_tool', 'document_index.json'), 'utf-8'));
          practiceArea = normalizePracticeArea(existingIndex.practice_area ?? existingIndex.practiceArea);
        } catch {
          // No existing index.
        }
      }
      const options = files?.length
        ? { incrementalFiles: files, firmRoot, practiceArea }
        : { firmRoot, practiceArea };
      const result = await indexCase(caseFolder, async (event) => {
        await log(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${event.type}: ${JSON.stringify(event)}`);
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }, options);

      console.log(`\n========== INIT DONE ==========`);
      console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success: result.success,
          error: result.error,
          diff: result.diff,
          durationSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
        }),
      });
    } catch (error) {
      console.error("Init error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Determine case phase on existing index (without re-indexing)
app.post("/determine-phase", async (c) => {
  const { caseFolder } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: "phase", phase: "determining_phase" }),
      });

      let success = false;

      for await (const msg of query({
        prompt: phasePrompt,
        options: {
          cwd: caseFolder,
          model: "haiku", // Use cheaper/faster model for phase classification
          allowedTools: ["Read", "Write"],
          permissionMode: "acceptEdits",
          maxTurns: 3,
          ...getSDKCliOptions(),
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            }
          }
        }

        if (msg.type === "result") {
          success = msg.subtype === "success";
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success,
        }),
      });
    } catch (error) {
      console.error("Phase determination error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Get extracted data for a specific document from the index
app.post("/document", async (c) => {
  const { caseFolder, documentPath } = await c.req.json();

  if (!caseFolder || !documentPath) {
    return c.json({ error: "caseFolder and documentPath required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Search for the document in the folders structure
    let documentData = null;
    let folderName = null;

    if (index.folders) {
      for (const [folder, folderData] of Object.entries(index.folders)) {
        const files = Array.isArray(folderData) ? folderData : (folderData as any)?.files;
        if (Array.isArray(files)) {
          const doc = files.find((d: any) =>
            d.path === documentPath ||
            d.filename === documentPath ||
            d.path?.endsWith(documentPath)
          );
          if (doc) {
            documentData = doc;
            folderName = folder;
            break;
          }
        }
      }
    }

    if (!documentData) {
      return c.json({ error: "Document not found in index", documentPath }, 404);
    }

    return c.json({
      folder: folderName,
      document: documentData,
      indexed_at: index.indexed_at,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "No index found. Run /init first." }, 404);
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Submit feedback to re-extract a document with corrections
app.post("/document/feedback", async (c) => {
  const { caseFolder, documentPath, feedback } = await c.req.json();

  if (!caseFolder || !documentPath || !feedback) {
    return c.json({ error: "caseFolder, documentPath, and feedback required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const feedbackPrompt = `Re-extract information from the document "${documentPath}" with the following user feedback:

**User Feedback:**
${feedback}

**Instructions:**
1. Read the document using pdftotext: \`pdftotext "${documentPath}" - 2>/dev/null\`
2. Re-extract the information, paying special attention to the user's feedback
3. Read the current index from .pi_tool/document_index.json
4. Update ONLY this document's entry in the appropriate folder
5. Add a "user_reviewed" field set to true and "review_notes" with a brief summary of changes
6. Write the updated index back

Be precise and follow the user's corrections.`;

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: "phase", phase: "re_extracting" }),
      });

      let success = false;

      for await (const msg of query({
        prompt: feedbackPrompt,
        options: {
          cwd: caseFolder,
          model: "haiku", // Use Haiku for targeted re-extraction
          allowedTools: ["Read", "Write", "Bash"],
          permissionMode: "acceptEdits",
          maxTurns: 5,
          ...getSDKCliOptions(),
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            } else if (block.type === "tool_use") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "tool", name: block.name }),
              });
            }
          }
        }

        if (msg.type === "result") {
          success = msg.subtype === "success";
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success,
        }),
      });
    } catch (error) {
      console.error("Document feedback error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Clear session
app.post("/clear-session", async (c) => {
  const { caseFolder } = await c.req.json();
  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }
  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }
  await saveSession(caseFolder, "");
  return c.json({ success: true });
});

// Summarize conversation to reduce context size
app.post("/summarize", async (c) => {
  const { messages } = await c.req.json();

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages array required" }, 400);
  }

  // Format messages for summarization
  const conversationText = messages
    .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const summarizePrompt = `Summarize this conversation between a user and an AI assistant about a personal injury legal case. Focus on:
- Key facts discussed (dates, amounts, providers, etc.)
- Decisions made or actions taken
- Outstanding questions or issues
- Any file references or documents mentioned

Keep the summary concise but include all important details that would be needed to continue the conversation.

CONVERSATION:
${conversationText}

SUMMARY:`;

  try {
    let summary = '';

    for await (const msg of query({
      prompt: summarizePrompt,
      options: {
        model: "haiku", // Fast and cheap
        allowedTools: [],
        permissionMode: "acceptEdits",
        maxTurns: 1,
        persistSession: false, // No need to persist one-shot summarization queries
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            summary += block.text;
          }
        }
      }
    }

    return c.json({
      success: true,
      summary: summary.trim(),
    });
  } catch (error) {
    console.error("Summarization error:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Chat history endpoints

// GET /history - Load active chat history
app.get("/history", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const historyPath = join(caseFolder, ".pi_tool", "chat_history.json");
    const historyContent = await readFile(historyPath, "utf-8");
    const history: ChatHistory = JSON.parse(historyContent);
    return c.json(history);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // No history file - return empty
      return c.json({ messages: [], startedAt: null, lastUpdated: null });
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// POST /history - Save chat history
app.post("/history", async (c) => {
  const { caseFolder, messages } = await c.req.json();

  if (!caseFolder || !messages) {
    return c.json({ error: "caseFolder and messages required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const piToolDir = join(caseFolder, ".pi_tool");
    const historyPath = join(piToolDir, "chat_history.json");

    // Ensure .pi_tool directory exists
    await mkdir(piToolDir, { recursive: true });

    // Load existing history or create new
    let history: ChatHistory;
    try {
      const existingContent = await readFile(historyPath, "utf-8");
      history = JSON.parse(existingContent);
    } catch {
      history = {
        messages: [],
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
    }

    // Update with new messages
    history.messages = messages;
    history.lastUpdated = new Date().toISOString();
    if (!history.startedAt) {
      history.startedAt = new Date().toISOString();
    }

    await writeFile(historyPath, JSON.stringify(history, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Save history error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /history/archives - Get list of archived conversations
app.get("/history/archives", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    // Load archives from document index
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    return c.json({ archives: index.chat_archives || [] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ archives: [] });
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// POST /history/archive - Archive current conversation
app.post("/history/archive", async (c) => {
  const { caseFolder, overwriteId } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const piToolDir = join(caseFolder, ".pi_tool");
  const historyPath = join(piToolDir, "chat_history.json");
  const archivesDir = join(piToolDir, "chat_archives");
  const indexPath = join(piToolDir, "document_index.json");

  try {
    // Load current chat history
    let history: ChatHistory;
    try {
      const historyContent = await readFile(historyPath, "utf-8");
      history = JSON.parse(historyContent);
    } catch {
      return c.json({ error: "No chat history to archive" }, 400);
    }

    if (history.messages.length === 0) {
      return c.json({ error: "No messages to archive" }, 400);
    }

    // Load existing index to check for overwrite
    let index: any = {};
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    if (!index.chat_archives) {
      index.chat_archives = [];
    }

    // Check if we're overwriting an existing archive
    let existingEntry: ChatArchiveEntry | undefined;
    if (overwriteId) {
      existingEntry = index.chat_archives.find((a: ChatArchiveEntry) => a.id === overwriteId);
    }

    // Generate summary using Haiku
    let summary = "Conversation archived";
    try {
      const conversationText = history.messages
        .slice(0, 10) // Just first 10 messages for summary
        .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 200)}`)
        .join('\n\n');

      const summaryPrompt = `Write a SHORT label (5-10 words max) for this conversation. Be direct, like "Resolved 8 document conflicts" or "Generated demand letter" or "Discussed medical expenses". No full sentences.\n\n${conversationText}\n\nLABEL:`;

      for await (const msg of query({
        prompt: summaryPrompt,
        options: {
          model: "haiku",
          allowedTools: [],
          permissionMode: "acceptEdits",
          maxTurns: 1,
          persistSession: false, // No need to persist one-shot archive queries
          ...getSDKCliOptions(),
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              summary = block.text.trim();
            }
          }
        }
      }
    } catch (error) {
      console.error("Summary generation failed:", error);
      // Continue with default summary
    }

    // Create/update archive file
    await mkdir(archivesDir, { recursive: true });
    const dateStr = new Date().toISOString().split('T')[0];

    let archiveId: string;
    let archiveFileName: string;
    let archivePath: string;

    if (existingEntry) {
      // Overwrite existing archive
      archiveId = existingEntry.id;
      archivePath = join(piToolDir, existingEntry.file);
      archiveFileName = existingEntry.file.replace('chat_archives/', '');
    } else {
      // Create new archive
      archiveId = `archive-${Date.now()}`;
      archiveFileName = `${dateStr}_${archiveId}.json`;
      archivePath = join(archivesDir, archiveFileName);
    }

    await writeFile(archivePath, JSON.stringify({
      ...history,
      archivedAt: new Date().toISOString(),
    }, null, 2));

    const archiveEntry: ChatArchiveEntry = {
      id: archiveId,
      date: dateStr,
      summary,
      messageCount: history.messages.length,
      file: `chat_archives/${archiveFileName}`,
    };

    if (existingEntry) {
      // Update existing entry in place
      const idx = index.chat_archives.findIndex((a: ChatArchiveEntry) => a.id === overwriteId);
      if (idx >= 0) {
        index.chat_archives[idx] = archiveEntry;
      }
    } else {
      // Add new entry to beginning
      index.chat_archives.unshift(archiveEntry);
    }
    await writeFile(indexPath, JSON.stringify(index, null, 2));

    // Clear active chat history
    const emptyHistory: ChatHistory = {
      messages: [],
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    await writeFile(historyPath, JSON.stringify(emptyHistory, null, 2));

    // Clear the session for fresh context
    await saveSession(caseFolder, "");

    return c.json({
      success: true,
      archive: archiveEntry,
    });
  } catch (error) {
    console.error("Archive error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /history/archive/:id - Load a specific archived conversation
app.get("/history/archive/:id", async (c) => {
  const caseFolder = c.req.query("case");
  const archiveId = c.req.param("id");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    // Find the archive entry in the index
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const archiveEntry = (index.chat_archives || []).find(
      (a: ChatArchiveEntry) => a.id === archiveId
    );

    if (!archiveEntry) {
      return c.json({ error: "Archive not found" }, 404);
    }

    // Load the archive file
    const archivePath = join(caseFolder, ".pi_tool", archiveEntry.file);
    const archiveContent = await readFile(archivePath, "utf-8");
    const archive = JSON.parse(archiveContent);

    return c.json({
      ...archiveEntry,
      messages: archive.messages,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Correct an errata item (user override)
app.post("/errata-correct", async (c) => {
  const { caseFolder, field, correctedValue } = await c.req.json();

  if (!caseFolder || !field || correctedValue === undefined) {
    return c.json({ error: "caseFolder, field, and correctedValue required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Update reconciled_values with user correction
    if (!index.reconciled_values) {
      index.reconciled_values = {};
    }
    index.reconciled_values[field] = {
      value: correctedValue,
      source: "User correction",
      note: `Corrected by user from AI decision`
    };

    // Remove from errata since it's now user-verified
    if (index.errata) {
      index.errata = index.errata.filter((e: any) => e.field !== field);
    }

    // Propagate correction to summary fields so dashboard reflects it immediately
    applyResolvedFieldToSummary(index, field, correctedValue);

    await writeFile(indexPath, JSON.stringify(index, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Errata correction error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
