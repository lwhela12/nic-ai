/**
 * Document Generation Agent
 *
 * Sonnet-powered agent for generating complex documents like demand letters,
 * case memos, and settlement calculations. Receives full context including
 * templates and knowledge bank.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join, dirname, relative as pathRelative } from "path";
import { resolveFirmRoot } from "./year-mode";
import { execSync } from "child_process";
import { loadSectionsByIds } from "../routes/knowledge";
import { extractPdfText } from "./pdftotext";
import { extractTextFromDocx } from "./extract";
import { generateMetaIndex, buildMetaIndexPromptView } from "./meta-index";

// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    // Explicitly pass API key - env var reading may not work in bundled binary
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return _anthropic;
}

// Document types we can generate
export type DocumentType =
  | "demand_letter"
  | "case_memo"
  | "settlement"
  | "general_letter"
  | "decision_order";

export interface DocGenResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

const INDEX_SLICE_MAX_CHARS = 12000;

// Tool definitions for the document agent
const DOC_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a file from the case folder. Use to read templates, medical records, bills, or other case documents.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Medical/records.pdf' or '.ai_tool/templates/parsed/demand-letter.md')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "read_index_slice",
    description: "Read a bounded slice of .ai_tool/document_index.json for large cases. Use this when you need more detail than the meta-index provides.",
    input_schema: {
      type: "object" as const,
      properties: {
        offset: {
          type: "number",
          description: "Character offset into .ai_tool/document_index.json (0-based)."
        },
        length: {
          type: "number",
          description: "Number of characters to read (max 12000)."
        }
      },
      required: ["offset"]
    }
  },
  {
    name: "glob",
    description: "Find files matching a pattern (e.g., 'Medical/*.pdf', '**/*.md')",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "grep",
    description: "Search for text in files",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex to search for"
        },
        path: {
          type: "string",
          description: "File or folder to search in (default: case folder)"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "list_folder",
    description: "List contents of a folder",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Folder path relative to case folder (default: root)"
        }
      }
    }
  },
  {
    name: "bash",
    description: "Run a shell command (use for PDF text extraction, file operations, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "write_draft",
    description: "Write the generated document to a draft file. Call this when the document is complete. Saves to .ai_tool/drafts/ folder.",
    input_schema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Name for the output file (e.g., 'Demand_Letter.md')"
        },
        content: {
          type: "string",
          description: "The full document content in markdown format"
        }
      },
      required: ["filename", "content"]
    }
  }
];

/**
 * Load the full case index.
 */
async function loadCaseIndex(caseFolder: string): Promise<Record<string, any>> {
  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const content = await readFile(indexPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Build a bounded prompt view of case context for document generation.
 * Uses meta_index for a compact navigable summary, plus a trimmed index preview.
 */
async function buildCasePromptContext(
  caseFolder: string,
  caseIndex: Record<string, any>
): Promise<string> {
  let metaIndexData: Record<string, any>;
  try {
    const metaIndexPath = join(caseFolder, ".ai_tool", "meta_index.json");
    const content = await readFile(metaIndexPath, "utf-8");
    metaIndexData = JSON.parse(content);
  } catch {
    metaIndexData = generateMetaIndex(caseIndex);
  }

  const metaView = buildMetaIndexPromptView(metaIndexData as any);
  const metaBlock = `${metaView}\n[For full folder details, use read_file(".ai_tool/indexes/{FolderName}.json"). For deep index access, use read_index_slice.]`;

  const preview = { ...caseIndex };
  if (preview.folders) {
    for (const [folderName, folderData] of Object.entries(preview.folders) as [string, any][]) {
      const files = Array.isArray(folderData) ? folderData : folderData?.files;
      if (!Array.isArray(files)) continue;
      preview.folders[folderName] = {
        files: files.slice(0, 140).map((file: any) => ({
          filename: file.filename,
          type: file.type,
          date: file.date,
          key_info: typeof file.key_info === "string" ? file.key_info.slice(0, 220) : file.key_info,
        })),
        truncated: files.length > 140,
      };
    }
  }

  let previewJson = JSON.stringify(preview, null, 2);
  if (previewJson.length > 22000) {
    previewJson = `${previewJson.slice(0, 22000)}\n...\n[NOTE: Index preview truncated; use read_index_slice for exact details.]`;
  }

  return `${metaBlock}\n\nCASE INDEX PREVIEW:\n${previewJson}`;
}

/**
 * Load all parsed templates as a single context string.
 */
async function loadAllTemplates(firmRoot: string): Promise<string> {
  const templatesDir = join(firmRoot, ".ai_tool", "templates");
  const indexPath = join(templatesDir, "templates.json");
  const parsedDir = join(templatesDir, "parsed");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const parts: string[] = [];

    for (const template of index.templates) {
      if (!template.parsedFile) continue;

      try {
        const content = await readFile(join(templatesDir, template.parsedFile), "utf-8");
        parts.push(`## TEMPLATE: ${template.name} (${template.id})

${template.description || "No description"}

---

${content}

---
`);
      } catch {
        // Skip unreadable templates
      }
    }

    if (parts.length === 0) {
      return "No templates available.";
    }

    return parts.join("\n\n");
  } catch {
    return "No templates available.";
  }
}

/**
 * Load firm configuration.
 */
async function loadFirmConfig(firmRoot: string): Promise<Record<string, any>> {
  try {
    const configPath = join(firmRoot, ".ai_tool", "firm-config.json");
    return JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const TEXT_SEARCH_EXTENSIONS = new Set([".txt", ".md", ".json"]);

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function matchesSearchPattern(
  content: string,
  pattern: string,
  regex: RegExp | null
): boolean {
  if (regex) {
    return regex.test(content);
  }
  return content.toLowerCase().includes(pattern.toLowerCase());
}

async function collectSearchTargets(searchPath: string): Promise<string[]> {
  const targets: string[] = [];
  const searchStat = await stat(searchPath);

  if (searchStat.isFile()) {
    targets.push(searchPath);
    return targets;
  }

  const glob = new Bun.Glob("**/*");
  for await (const relPath of glob.scan({ cwd: searchPath, onlyFiles: true })) {
    const dotIndex = relPath.lastIndexOf(".");
    const ext = dotIndex >= 0 ? relPath.slice(dotIndex).toLowerCase() : "";
    if (TEXT_SEARCH_EXTENSIONS.has(ext)) {
      targets.push(join(searchPath, relPath));
    }
  }

  return targets;
}

/**
 * Execute a tool and return the result.
 */
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  caseFolder: string,
  firmRoot: string
): Promise<{ result: string; filePath?: string }> {
  try {
    switch (toolName) {
      case "read_file": {
        // Allow reading from case folder or firm root (for templates)
        let filePath = join(caseFolder, toolInput.path);

        // If path starts with .ai_tool/templates, try firm root first
        if (toolInput.path.startsWith(".ai_tool/templates")) {
          const firmPath = join(firmRoot, toolInput.path);
          try {
            const content = await readFile(firmPath, "utf-8");
            return { result: content.slice(0, 20000) };
          } catch {
            // Fall through to case folder
          }
        }

        // Security check
        if (!filePath.startsWith(caseFolder) && !filePath.startsWith(firmRoot)) {
          return { result: "Error: Cannot read files outside the case/firm folder" };
        }

        const normalizedPath = toolInput.path.toLowerCase();

        // Handle PDFs and DOCX as binary documents
        if (normalizedPath.endsWith('.pdf')) {
          try {
            const text = await extractPdfText(filePath, {
              layout: false,
              maxBuffer: 2 * 1024 * 1024,
              timeout: 30000,
            });
            return { result: text.slice(0, 20000) };
          } catch {
            return { result: "Error: Could not extract text from PDF" };
          }
        }
        if (normalizedPath.endsWith('.docx')) {
          try {
            const text = await extractTextFromDocx(filePath);
            return { result: text.slice(0, 20000) };
          } catch {
            return { result: "Error: Could not extract text from DOCX" };
          }
        }

        const content = await readFile(filePath, "utf-8");
        return { result: content.slice(0, 20000) };
      }

      case "read_index_slice": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const content = await readFile(indexPath, "utf-8");

        const offsetRaw = Number(toolInput.offset);
        const lengthRaw = toolInput.length === undefined ? INDEX_SLICE_MAX_CHARS : Number(toolInput.length);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
        const length = Number.isFinite(lengthRaw) && lengthRaw > 0
          ? Math.min(Math.floor(lengthRaw), INDEX_SLICE_MAX_CHARS)
          : INDEX_SLICE_MAX_CHARS;
        const end = Math.min(content.length, offset + length);
        const slice = content.slice(offset, end);

        return {
          result: JSON.stringify({
            total_chars: content.length,
            offset,
            end,
            has_more: end < content.length,
            next_offset: end < content.length ? end : null,
            slice,
          }),
        };
      }

      case "glob": {
        // Use Bun.Glob to find files matching the pattern
        const glob = new Bun.Glob(toolInput.pattern);
        const matches: string[] = [];
        for await (const file of glob.scan({ cwd: caseFolder, onlyFiles: true })) {
          matches.push(file);
          if (matches.length >= 100) break; // Limit results
        }
        if (matches.length === 0) {
          return { result: "No files found matching pattern" };
        }
        return { result: matches.join("\n") };
      }

      case "grep": {
        const searchPath = toolInput.path ? join(caseFolder, toolInput.path) : caseFolder;
        const rawPattern = String(toolInput.pattern ?? "").trim();

        if (!rawPattern) {
          return { result: "Error: pattern is required" };
        }

        // Security check
        if (!searchPath.startsWith(caseFolder)) {
          return { result: "Error: Cannot search outside the case folder" };
        }

        try {
          let regex: RegExp | null = null;
          try {
            regex = new RegExp(rawPattern, "i");
          } catch {
            regex = null;
          }

          const candidates = await collectSearchTargets(searchPath);
          const matchedFiles: string[] = [];

          for (const candidate of candidates) {
            if (matchedFiles.length >= 20) break;

            try {
              const content = await readFile(candidate, "utf-8");
              if (matchesSearchPattern(content, rawPattern, regex)) {
                const relPath = normalizeRelativePath(pathRelative(caseFolder, candidate));
                matchedFiles.push(relPath);
              }
            } catch {
              // Skip unreadable files
            }
          }

          if (matchedFiles.length === 0) {
            return { result: "No matches found" };
          }

          return { result: `Files containing "${rawPattern}":\n${matchedFiles.join('\n')}` };
        } catch {
          return { result: "No matches found" };
        }
      }

      case "list_folder": {
        const folderPath = toolInput.path ? join(caseFolder, toolInput.path) : caseFolder;

        // Security check
        if (!folderPath.startsWith(caseFolder)) {
          return { result: "Error: Cannot list folders outside the case folder" };
        }

        try {
          const entries = await readdir(folderPath, { withFileTypes: true });
          const listing = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`);
          return { result: listing.join('\n') || "Empty folder" };
        } catch {
          return { result: "Error: Folder not found or not accessible" };
        }
      }

      case "bash": {
        // Security: only allow execution within case folder
        const command = toolInput.command;

        // Block dangerous commands
        const dangerous = ['rm -rf', 'sudo', '>', '>>', 'chmod', 'chown', 'curl', 'wget', 'eval'];
        if (dangerous.some(d => command.includes(d))) {
          return { result: "Error: Command not allowed for security reasons" };
        }

        try {
          const result = execSync(command, {
            cwd: caseFolder,
            encoding: 'utf-8',
            maxBuffer: 2 * 1024 * 1024,
            timeout: 30000 // 30 second timeout
          });
          return { result: result.slice(0, 20000) || "(no output)" };
        } catch (error) {
          const err = error as { stderr?: string; message?: string };
          return { result: `Command failed: ${err.stderr || err.message || 'Unknown error'}` };
        }
      }

      case "write_draft": {
        // Save drafts to .ai_tool/drafts/ within the case folder
        const draftsDir = join(caseFolder, ".ai_tool", "drafts");
        await mkdir(draftsDir, { recursive: true });

        const filePath = join(draftsDir, toolInput.filename);

        // Security check: verify path is within case folder
        if (!filePath.startsWith(caseFolder)) {
          return { result: "Error: Cannot write files outside the case folder" };
        }

        await writeFile(filePath, toolInput.content);
        const relativePath = `.ai_tool/drafts/${toolInput.filename}`;
        return {
          result: `Draft saved to ${relativePath}`,
          filePath: relativePath
        };
      }

      // Keep backwards compatibility with old tool name
      case "write_document": {
        // Redirect to write_draft behavior
        const draftsDir = join(caseFolder, ".ai_tool", "drafts");
        await mkdir(draftsDir, { recursive: true });

        const filePath = join(draftsDir, toolInput.filename);

        if (!filePath.startsWith(caseFolder)) {
          return { result: "Error: Cannot write files outside the case folder" };
        }

        await writeFile(filePath, toolInput.content);
        const relativePath = `.ai_tool/drafts/${toolInput.filename}`;
        return {
          result: `Draft saved to ${relativePath}`,
          filePath: relativePath
        };
      }

      default:
        return { result: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return {
      result: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Build the system prompt for document generation.
 */
function buildSystemPrompt(
  docType: DocumentType,
  knowledge: string,
  templates: string,
  firmConfig: Record<string, any>
): string {
  const docTypeDescriptions: Record<DocumentType, string> = {
    demand_letter: "a demand letter to the at-fault party's insurance carrier",
    case_memo: "an internal case memorandum summarizing the case",
    settlement: "a settlement calculation and disbursement breakdown",
    general_letter: "a professional letter related to the case",
    decision_order: "a workers' compensation hearing Decision & Order for filing",
  };

  const docTypeSpecificInstructions: Record<DocumentType, string> = {
    demand_letter: `
Demand-letter specific requirements:
- Follow demand template language closely when available.
- Include provider-by-provider specials with totals.
- Make sure demand amount/policy-limits framing is explicitly stated.`,
    case_memo: `
Case-memo specific requirements:
- Include case posture, major facts, treatment summary, financial snapshot, and open issues.
- Keep it internal-facing and analytical.`,
    settlement: `
Settlement specific requirements:
- Show clear arithmetic for all inflows/outflows.
- Include assumptions and flags where figures are uncertain.`,
    general_letter: `
General-letter specific requirements:
- Keep formal business-letter formatting.
- Keep requests, deadlines, and asks explicit.`,
    decision_order: `
Decision & Order specific requirements:
- This is a post-hearing legal filing style document, not a letter.
- Use this core structure:
  1) Caption / case heading
  2) Introductory hearing/procedural paragraph(s)
  3) Exhibits admitted (if known)
  4) FINDINGS OF FACT (numbered)
  5) CONCLUSIONS OF LAW (numbered, statute/case citations when supported)
  6) ORDER (numbered decretal rulings tied to appealed issues)
  7) Signature / submission block (if requested)
- Ground every finding and legal conclusion in case documents/index data; do not invent facts, holdings, dates, or citations.
- If critical filing detail is missing (appeal no., claim no., hearing date, AO name), insert a clear [VERIFY: ...] placeholder rather than guessing.
- Default draft filename for this type: decision_and_order.md`,
  };

  return `You are a legal document drafting assistant for a Personal Injury law firm. Your task is to generate ${docTypeDescriptions[docType]}.

## FIRM INFORMATION

${firmConfig.firmName ? `Firm: ${firmConfig.firmName}` : ""}
${firmConfig.address ? `Address: ${firmConfig.address}` : ""}
${firmConfig.phone ? `Phone: ${firmConfig.phone}` : ""}
${firmConfig.feeStructure ? `Fee Structure: ${firmConfig.feeStructure}` : ""}

## PRACTICE KNOWLEDGE

${knowledge}

## AVAILABLE TEMPLATES

${templates}

## INSTRUCTIONS

1. First, review the meta-index/index preview to understand the case
2. If you need deeper detail from document_index.json, use read_index_slice in chunks
3. If you need more detail on specific documents, use read_file to review them
4. Select the most appropriate template for this document
5. Read the template to understand its structure and requirements
6. Draft the document following the template structure
7. Fill in all placeholders with actual case data
8. Use write_draft to save the final document

## DOCUMENT-SPECIFIC REQUIREMENTS

${docTypeSpecificInstructions[docType]}

IMPORTANT:
- Follow the template structure closely
- Use professional legal language
- Ensure all facts are accurate based on the case documents
- Include proper dates, amounts, and details
- Write the complete document - do not leave placeholders unfilled
- Save the document when complete using write_draft

## AVAILABLE TOOLS

- read_file: Read any file in the case folder (handles PDFs automatically)
- read_index_slice: Read document_index.json in bounded chunks for very large cases
- glob: Find files matching a pattern (e.g., 'Medical/*.pdf')
- grep: Search for text across files
- list_folder: List directory contents
- bash: Run shell commands for complex operations
- write_draft: Save your completed document to .ai_tool/drafts/`;
}

/**
 * Main document generation function.
 * Returns an async generator for streaming progress back to the chat.
 */
export async function* generateDocument(
  caseFolder: string,
  docType: DocumentType,
  userPrompt: string
): AsyncGenerator<{ type: string; content?: string; filePath?: string; done?: boolean }> {
  const firmRoot = resolveFirmRoot(caseFolder);

  yield { type: "status", content: "Loading case data and templates..." };

  // Load all context
  const [caseIndex, knowledge, templates, firmConfig] = await Promise.all([
    loadCaseIndex(caseFolder),
    loadSectionsByIds(firmRoot), // Load all knowledge sections
    loadAllTemplates(firmRoot),
    loadFirmConfig(firmRoot)
  ]);
  const caseContext = await buildCasePromptContext(caseFolder, caseIndex);

  const systemPrompt = buildSystemPrompt(docType, knowledge, templates, firmConfig);

  // Build initial user message with case context
  const userMessage = `CASE CONTEXT:
${caseContext}

USER REQUEST:
${userPrompt}

Please generate the requested document. Start by reviewing the case context above, then select and read the appropriate template, and finally draft and save the document.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage }
  ];

  yield { type: "status", content: "Starting document generation..." };

  let iterations = 0;
  const maxIterations = 10;
  let finalFilePath: string | undefined;

  while (iterations < maxIterations) {
    iterations++;

    const response = await getClient().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools: DOC_TOOLS
    });

    // Process response content
    let textContent = "";
    const toolUses: Array<{ id: string; name: string; input: any }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, any>
        });
      }
    }

    // Stream any text output
    if (textContent) {
      yield { type: "text", content: textContent };
    }

    // If no tool use, we're done
    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      break;
    }

    // Execute tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      yield { type: "tool", content: `Using ${toolUse.name}...` };

      const { result, filePath } = await executeTool(
        toolUse.name,
        toolUse.input,
        caseFolder,
        firmRoot
      );

      if (filePath) {
        finalFilePath = filePath;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result
      });
    }

    // Add assistant message with tool uses
    messages.push({
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...toolUses.map(t => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: t.input
        }))
      ]
    });

    // Add tool results
    messages.push({
      role: "user",
      content: toolResults
    });
  }

  yield {
    type: "done",
    done: true,
    filePath: finalFilePath
  };
}

/**
 * Detect if a user message is requesting document generation.
 * Returns the document type if detected, null otherwise.
 */
export function detectDocGenIntent(message: string): { type: DocumentType; prompt: string } | null {
  const lower = message.toLowerCase();

  // Must have a generation verb
  const genWords = /\b(draft|write|generate|create|prepare|make)\b/;
  if (!genWords.test(lower)) return null;

  // Check for specific document types
  const patterns: Array<{ keywords: string[]; type: DocumentType }> = [
    { keywords: ["demand letter", "demand"], type: "demand_letter" },
    { keywords: ["case memo", "memo", "memorandum"], type: "case_memo" },
    { keywords: ["decision and order", "decision & order", "appeals officer decision", "hearing decision", "dao"], type: "decision_order" },
    { keywords: ["settlement", "disbursement", "calculation"], type: "settlement" },
    { keywords: ["letter"], type: "general_letter" }
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some(k => lower.includes(k))) {
      return { type: pattern.type, prompt: message };
    }
  }

  return null;
}
