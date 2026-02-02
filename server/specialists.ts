/**
 * Sonnet Specialist Agents
 *
 * These are complex, multi-step tasks that benefit from Sonnet's stronger reasoning.
 * Called by the Haiku router when users request document generation.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "fs/promises";
import { join, dirname } from "path";

// SDK CLI options helper - handles both direct and npx modes
import { getSDKCliOptions } from "./lib/sdk-cli-options";

// Load specialist prompts from command files
async function loadPrompt(name: string): Promise<string> {
  const path = join(import.meta.dir, "../.claude/commands", `${name}.md`);
  try {
    const content = await readFile(path, "utf-8");
    // Strip YAML frontmatter if present
    return content.replace(/^---[\s\S]*?---\n*/m, "");
  } catch {
    throw new Error(`Specialist prompt not found: ${name}`);
  }
}

// Cache for the full system prompt
let fullSystemPromptCache: string | null = null;

// Load the full agent system prompt (PI law knowledge, valuation guidelines, etc.)
async function loadFullSystemPrompt(): Promise<string> {
  if (fullSystemPromptCache) return fullSystemPromptCache;
  const path = join(import.meta.dir, "../agent/system-prompt.md");
  const content = await readFile(path, "utf-8");
  fullSystemPromptCache = content;
  return content;
}

/**
 * Load all firm templates from the firm root (parent of case folder).
 * Returns a formatted string with all templates for inclusion in the system prompt.
 */
async function loadFirmTemplates(caseFolder: string): Promise<string> {
  const firmRoot = dirname(caseFolder);
  const templatesDir = join(firmRoot, ".pi_tool", "templates");
  const indexPath = join(templatesDir, "templates.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const parts: string[] = [];

    for (const template of index.templates) {
      if (!template.parsedFile) continue;

      try {
        const content = await readFile(join(templatesDir, template.parsedFile), "utf-8");
        parts.push(`## TEMPLATE: ${template.name} (${template.id})

**Description:** ${template.description || "No description"}

---

${content}

---
`);
      } catch {
        // Skip unreadable templates
      }
    }

    if (parts.length === 0) {
      return "";
    }

    return `
# FIRM TEMPLATES

The following templates are available for use. When generating documents, you MUST use the appropriate template exactly as provided - matching its structure, length, and language. Only fill in the placeholders with case-specific data.

${parts.join("\n\n")}
`;
  } catch {
    return "";
  }
}

export interface SpecialistResult {
  success: boolean;
  output?: string;
  outputPath?: string;
  error?: string;
}

export type ProgressCallback = (event: {
  type: string;
  message?: string;
  tool?: string;
  [key: string]: any;
}) => Promise<void>;

/**
 * Draft Demand Letter - Sonnet specialist
 *
 * Reads medical records, calculates damages, generates formal demand letter.
 */
export async function draftDemand(
  caseFolder: string,
  onProgress?: ProgressCallback
): Promise<SpecialistResult> {
  const taskPrompt = await loadPrompt("draft-demand");
  const baseSystemPrompt = await loadFullSystemPrompt();
  const templates = await loadFirmTemplates(caseFolder);

  // Combine system prompt with templates so the agent has them in context
  const systemPrompt = templates
    ? `${baseSystemPrompt}\n\n${templates}`
    : baseSystemPrompt;

  await onProgress?.({ type: "specialist_start", name: "draft_demand", message: "Starting demand letter generation..." });

  let result: SpecialistResult = { success: false };

  try {
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: caseFolder,
        systemPrompt,
        model: "sonnet",
        allowedTools: ["Read", "Write", "Glob", "Grep", "Bash"],
        permissionMode: "acceptEdits",
        maxTurns: 20,
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            await onProgress?.({ type: "tool", tool: block.name, message: `Using ${block.name}...` });
          }
        }
      }

      if (msg.type === "result") {
        result = {
          success: msg.subtype === "success",
          output: msg.subtype === "success" ? msg.result : undefined,
          outputPath: "3P/3P Demand - DRAFT.md",
          error: msg.subtype !== "success" ? "Demand generation failed" : undefined,
        };
      }
    }
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await onProgress?.({ type: "specialist_done", name: "draft_demand", success: result.success });
  return result;
}

/**
 * Generate Case Memo - Sonnet specialist
 *
 * Creates comprehensive case summary from index and documents.
 */
export async function generateMemo(
  caseFolder: string,
  onProgress?: ProgressCallback
): Promise<SpecialistResult> {
  const taskPrompt = await loadPrompt("case-memo");
  const systemPrompt = await loadFullSystemPrompt();

  await onProgress?.({ type: "specialist_start", name: "generate_memo", message: "Starting case memo generation..." });

  let result: SpecialistResult = { success: false };

  try {
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: caseFolder,
        systemPrompt,
        model: "sonnet",
        allowedTools: ["Read", "Write"],
        permissionMode: "acceptEdits",
        maxTurns: 10,
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            await onProgress?.({ type: "tool", tool: block.name, message: `Using ${block.name}...` });
          }
        }
      }

      if (msg.type === "result") {
        result = {
          success: msg.subtype === "success",
          output: msg.subtype === "success" ? msg.result : undefined,
          outputPath: ".pi_tool/case_memo.md",
          error: msg.subtype !== "success" ? "Memo generation failed" : undefined,
        };
      }
    }
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await onProgress?.({ type: "specialist_done", name: "generate_memo", success: result.success });
  return result;
}

/**
 * Calculate Settlement - Sonnet specialist
 *
 * Computes full settlement disbursement with liens and fees.
 */
export async function calculateSettlement(
  caseFolder: string,
  onProgress?: ProgressCallback
): Promise<SpecialistResult> {
  const taskPrompt = await loadPrompt("settlement-calc");
  const systemPrompt = await loadFullSystemPrompt();

  await onProgress?.({ type: "specialist_start", name: "calculate_settlement", message: "Starting settlement calculation..." });

  let result: SpecialistResult = { success: false };

  try {
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: caseFolder,
        systemPrompt,
        model: "sonnet",
        allowedTools: ["Read", "Write", "Glob", "Grep", "Bash"],
        permissionMode: "acceptEdits",
        maxTurns: 15,
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            await onProgress?.({ type: "tool", tool: block.name, message: `Using ${block.name}...` });
          }
        }
      }

      if (msg.type === "result") {
        result = {
          success: msg.subtype === "success",
          output: msg.subtype === "success" ? msg.result : undefined,
          outputPath: "Settlement/Settlement Memo - DRAFT.md",
          error: msg.subtype !== "success" ? "Settlement calculation failed" : undefined,
        };
      }
    }
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await onProgress?.({ type: "specialist_done", name: "calculate_settlement", success: result.success });
  return result;
}

/**
 * Gap Analysis - Haiku specialist (simpler task)
 *
 * Identifies missing documents and next steps.
 */
export async function analyzeGaps(
  caseFolder: string,
  onProgress?: ProgressCallback
): Promise<SpecialistResult> {
  const taskPrompt = await loadPrompt("gaps");
  const systemPrompt = await loadFullSystemPrompt();

  await onProgress?.({ type: "specialist_start", name: "analyze_gaps", message: "Starting gap analysis..." });

  let result: SpecialistResult = { success: false };

  try {
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: caseFolder,
        systemPrompt,
        model: "haiku", // Gaps analysis is simpler, Haiku can handle it
        allowedTools: ["Read", "Write", "Glob", "Grep", "Bash"],
        permissionMode: "acceptEdits",
        maxTurns: 10,
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            await onProgress?.({ type: "tool", tool: block.name, message: `Using ${block.name}...` });
          }
        }
      }

      if (msg.type === "result") {
        result = {
          success: msg.subtype === "success",
          output: msg.subtype === "success" ? msg.result : undefined,
          outputPath: ".pi_tool/gap_analysis.md",
          error: msg.subtype !== "success" ? "Gap analysis failed" : undefined,
        };
      }
    }
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await onProgress?.({ type: "specialist_done", name: "analyze_gaps", success: result.success });
  return result;
}
