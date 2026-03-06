import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { appendFile } from "fs/promises";
import { getVfs } from "../lib/vfs";
import { groqChat } from "../lib/groq-chat-client";

import { join } from "path";
import { resolveFirmRoot, getClientSlug, loadClientRegistry } from "../lib/year-mode";
import { homedir } from "os";
import { getSession, saveSession } from "../sessions";
import { indexCase } from "./firm";


import { directChat, type ChatMessage as DirectChatMessage } from "../lib/direct-chat";
import { densityChat } from "../lib/density-chat";
import { extractMemoriesFromConversation } from "../lib/memory";

const CHAT_BACKEND = process.env.CHAT_BACKEND || "density";
import { requireCaseAccess } from "../lib/team-access";

import { applyResolvedFieldToSummary } from "../lib/index-summary-sync";
import { writeIndexDerivedFiles } from "../lib/meta-index";
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

// Case chat endpoint - uses density or direct API backend
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
    let keepalive: ReturnType<typeof setInterval> | null = null;
    try {
      let fullResponse = "";
      const authEmail = c.get("authEmail");
      const lockOwner = typeof authEmail === "string" && authEmail ? `user:${authEmail.toLowerCase()}` : undefined;
      keepalive = setInterval(() => {
        stream.writeSSE({
          data: JSON.stringify({ type: "heartbeat", ts: Date.now() }),
        }).catch(() => {});
      }, 15000);

      const chatBackend = CHAT_BACKEND === "density"
        ? densityChat(caseFolder, message, chatHistory, {
            lockOwner,
            lockDisplayName: typeof authEmail === "string" ? authEmail : undefined,
          })
        : directChat(caseFolder, message, chatHistory, {
            lockOwner,
            lockDisplayName: typeof authEmail === "string" ? authEmail : undefined,
          });

      for await (const event of chatBackend) {
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
        } else if (event.type === "evidence_packet_plan" && event.plan) {
          await stream.writeSSE({
            data: JSON.stringify({ type: "evidence_packet_plan", plan: event.plan }),
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
              previewPath: event.previewPath,
              docxPath: event.docxPath,
              incomplete: event.incomplete,
              reason: event.reason,
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
    } finally {
      if (keepalive) clearInterval(keepalive);
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
      const firmRoot = resolveFirmRoot(caseFolder);
      // Resolve practice area from folder metadata first.
      // Fallback to existing index for backward compatibility.
      let practiceArea = await resolveFirmPracticeArea(firmRoot);
      if (!practiceArea) {
        try {
          const existingIndex = JSON.parse(await getVfs().readFile(join(caseFolder, '.ai_tool', 'document_index.json'), 'utf-8'));
          practiceArea = normalizePracticeArea(existingIndex.practice_area ?? existingIndex.practiceArea);
        } catch {
          // No existing index.
        }
      }
      // Build sourceFolders for year-based mode
      let sourceFolders: { firmRoot: string; folders: string[] } | undefined;
      const initSlug = getClientSlug(caseFolder);
      console.log(`[init] firmRoot=${firmRoot}, slug=${initSlug}`);
      if (initSlug) {
        const initRegistry = await loadClientRegistry(firmRoot);
        console.log(`[init] registry loaded: ${initRegistry ? Object.keys(initRegistry.clients).length + ' clients' : 'null'}`);
        if (initRegistry?.clients[initSlug]) {
          sourceFolders = { firmRoot, folders: initRegistry.clients[initSlug].sourceFolders };
          console.log(`[init] sourceFolders:`, sourceFolders.folders);
        } else {
          console.log(`[init] slug "${initSlug}" not found in registry`);
        }
      }

      const options = files?.length
        ? { incrementalFiles: files, firmRoot, practiceArea, sourceFolders }
        : { firmRoot, practiceArea, sourceFolders };
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

  const summarizePrompt = `Summarize this conversation between a user and an AI assistant about an elder care coordination client record. Focus on:
- Key facts discussed (dates, amounts, providers, etc.)
- Decisions made or actions taken
- Outstanding questions or issues
- Any file references or documents mentioned

Keep the summary concise but include all important details that would be needed to continue the conversation.

CONVERSATION:
${conversationText}

SUMMARY:`;

  try {
    const result = await groqChat({
      messages: [
        { role: "user", content: summarizePrompt },
      ],
      maxTokens: 1000,
      temperature: 0.3,
    });

    return c.json({
      success: true,
      summary: result.content.trim(),
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
    const historyPath = join(caseFolder, ".ai_tool", "chat_history.json");
    const historyContent = await getVfs().readFile(historyPath, "utf-8");
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
    const piToolDir = join(caseFolder, ".ai_tool");
    const historyPath = join(piToolDir, "chat_history.json");

    // Ensure .ai_tool directory exists
    await getVfs().mkdir(piToolDir, { recursive: true });

    // Load existing history or create new
    let history: ChatHistory;
    try {
      const existingContent = await getVfs().readFile(historyPath, "utf-8");
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

    await getVfs().writeFile(historyPath, JSON.stringify(history, null, 2));
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
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await getVfs().readFile(indexPath, "utf-8");
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

  const piToolDir = join(caseFolder, ".ai_tool");
  const historyPath = join(piToolDir, "chat_history.json");
  const archivesDir = join(piToolDir, "chat_archives");
  const indexPath = join(piToolDir, "document_index.json");

  try {
    // Load current chat history
    let history: ChatHistory;
    try {
      const historyContent = await getVfs().readFile(historyPath, "utf-8");
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
      const indexContent = await getVfs().readFile(indexPath, "utf-8");
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

      const summaryPrompt = `Write a SHORT label (5-10 words max) for this conversation. Be direct, like "Resolved 8 document conflicts" or "Updated care plan details" or "Discussed provider coordination". No full sentences.\n\n${conversationText}\n\nLABEL:`;

      const result = await groqChat({
        messages: [
          { role: "user", content: summaryPrompt },
        ],
        maxTokens: 50,
        temperature: 0.3,
      });
      summary = result.content.trim();
    } catch (error) {
      console.error("Summary generation failed:", error);
      // Continue with default summary
    }

    // Create/update archive file
    await getVfs().mkdir(archivesDir, { recursive: true });
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

    await getVfs().writeFile(archivePath, JSON.stringify({
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
    await getVfs().writeFile(indexPath, JSON.stringify(index, null, 2));

    // Extract persistent memories from the conversation (non-blocking)
    extractMemoriesFromConversation(caseFolder, history.messages, archiveEntry.id).catch((err) => {
      console.error("[archive] Memory extraction failed:", err);
    });

    // Clear active chat history
    const emptyHistory: ChatHistory = {
      messages: [],
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    await getVfs().writeFile(historyPath, JSON.stringify(emptyHistory, null, 2));

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
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await getVfs().readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const archiveEntry = (index.chat_archives || []).find(
      (a: ChatArchiveEntry) => a.id === archiveId
    );

    if (!archiveEntry) {
      return c.json({ error: "Archive not found" }, 404);
    }

    // Load the archive file
    const archivePath = join(caseFolder, ".ai_tool", archiveEntry.file);
    const archiveContent = await getVfs().readFile(archivePath, "utf-8");
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
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await getVfs().readFile(indexPath, "utf-8");
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

    await getVfs().writeFile(indexPath, JSON.stringify(index, null, 2));
    await writeIndexDerivedFiles(caseFolder, index);
    return c.json({ success: true });
  } catch (error) {
    console.error("Errata correction error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
