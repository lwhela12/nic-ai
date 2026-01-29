/**
 * Direct Chat API
 *
 * Fast, lightweight chat using direct Anthropic API calls instead of Agent SDK.
 * For most queries, answers from context without tool calls.
 * Tools only invoked when explicitly needed.
 *
 * Complex document generation (demand letters, memos, etc.) is delegated to
 * a Sonnet-powered document agent with full template and knowledge access.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { generateDocument, type DocumentType } from "./doc-agent";

const anthropic = new Anthropic();

// Message format for conversation history
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Tool definitions
const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file in the case folder. Use for detailed document review or checking specific files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Intake/Intake.pdf' or '.pi_tool/document_index.json')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the case folder. Use for creating documents, memos, or updating files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "update_index",
    description: "Update a field in the case's document_index.json. Use when user provides corrections or new information.",
    input_schema: {
      type: "object" as const,
      properties: {
        field_path: {
          type: "string",
          description: "Dot-notation path to the field (e.g., 'summary.client', 'case_phase', 'summary.contact.phone')"
        },
        value: {
          type: "string",
          description: "New value for the field"
        },
        note: {
          type: "string",
          description: "Brief note about why this was updated"
        }
      },
      required: ["field_path", "value"]
    }
  },
  {
    name: "generate_document",
    description: "Delegate to a specialized agent to draft a formal document. Use this when the user asks you to write, draft, create, or generate a document like a demand letter, case memo, settlement calculation, or formal letter. The agent has access to templates and will create a complete, professional document.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: {
          type: "string",
          enum: ["demand_letter", "case_memo", "settlement", "general_letter"],
          description: "Type of document to generate: demand_letter (to insurance), case_memo (internal summary), settlement (disbursement calc), general_letter (LOP, records request, etc.)"
        },
        instructions: {
          type: "string",
          description: "Specific instructions for the document (e.g., 'Focus on the soft tissue injuries', 'Include future medical needs'). Pass along any specific requests from the user."
        }
      },
      required: ["document_type", "instructions"]
    }
  }
];

// Execute a tool and return result
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  caseFolder: string
): Promise<string> {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = join(caseFolder, toolInput.path);
        // Security check - ensure path is within case folder
        if (!filePath.startsWith(caseFolder)) {
          return "Error: Cannot read files outside the case folder";
        }

        // Handle PDFs specially
        if (toolInput.path.toLowerCase().endsWith('.pdf')) {
          const { execSync } = await import("child_process");
          try {
            const text = execSync(`pdftotext "${filePath}" - 2>/dev/null`, {
              maxBuffer: 1024 * 1024,
              encoding: 'utf-8'
            });
            return text.slice(0, 10000); // Limit output
          } catch {
            return "Error: Could not extract text from PDF";
          }
        }

        const content = await readFile(filePath, "utf-8");
        return content.slice(0, 15000); // Limit output to avoid context overflow
      }

      case "write_file": {
        const filePath = join(caseFolder, toolInput.path);
        if (!filePath.startsWith(caseFolder)) {
          return "Error: Cannot write files outside the case folder";
        }
        await writeFile(filePath, toolInput.content);
        return `Successfully wrote ${toolInput.content.length} characters to ${toolInput.path}`;
      }

      case "update_index": {
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        // Navigate to field using dot notation
        const parts = toolInput.field_path.split(".");
        let target = index;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]]) {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }

        const lastPart = parts[parts.length - 1];
        const oldValue = target[lastPart];
        target[lastPart] = toolInput.value;

        // Track the update in case_notes
        if (!index.case_notes) {
          index.case_notes = [];
        }
        index.case_notes.push({
          timestamp: new Date().toISOString(),
          field: toolInput.field_path,
          old_value: oldValue,
          new_value: toolInput.value,
          note: toolInput.note || "Updated via chat"
        });

        await writeFile(indexPath, JSON.stringify(index, null, 2));
        return `Updated ${toolInput.field_path} from "${oldValue}" to "${toolInput.value}"`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Build context from case folder
async function buildContext(caseFolder: string): Promise<string> {
  const parts: string[] = [];
  const firmRoot = dirname(caseFolder);

  // Current date
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  parts.push(`TODAY'S DATE: ${dateStr}`);

  // Load case index
  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);

    // Trim index to manageable size
    const trimmed = { ...indexData };

    // Remove verbose extracted_data from folders, keep key_info
    if (trimmed.folders) {
      for (const folderData of Object.values(trimmed.folders) as any[]) {
        const files = Array.isArray(folderData) ? folderData : folderData?.files;
        if (Array.isArray(files)) {
          for (const file of files) {
            delete file.extracted_data;
            delete file.extracted_text;
            delete file.full_text;
            if (file.key_info && file.key_info.length > 300) {
              file.key_info = file.key_info.slice(0, 300) + "...";
            }
          }
        }
      }
    }

    parts.push(`\n## CASE INDEX\n${JSON.stringify(trimmed, null, 2)}`);
  } catch {
    parts.push("\n## CASE INDEX\nNo case index found. Case may need to be indexed first.");
  }

  // Load knowledge bank
  try {
    const knowledgePath = join(firmRoot, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(knowledgePath, "utf-8"));
    parts.push(`\n## PRACTICE KNOWLEDGE\nArea: ${manifest.practiceArea} (${manifest.jurisdiction})`);

    // Load key knowledge sections (abbreviated for chat context)
    if (manifest.sections) {
      const knowledgeSummary: string[] = [];
      for (const section of manifest.sections.slice(0, 5)) {
        try {
          const sectionPath = join(firmRoot, ".pi_tool", "knowledge", section.file);
          const content = await readFile(sectionPath, "utf-8");
          // Include first 500 chars of each section
          knowledgeSummary.push(`### ${section.title}\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`);
        } catch {
          // Skip unreadable sections
        }
      }
      if (knowledgeSummary.length > 0) {
        parts.push(knowledgeSummary.join("\n\n"));
      }
    }
  } catch {
    // No knowledge base
  }

  // Load templates list
  try {
    const templatesPath = join(firmRoot, ".pi_tool", "templates", "templates.json");
    const templatesData = JSON.parse(await readFile(templatesPath, "utf-8"));
    if (templatesData.templates?.length > 0) {
      const templateList = templatesData.templates
        .map((t: any) => `- ${t.name}: ${t.description || 'No description'}`)
        .join("\n");
      parts.push(`\n## AVAILABLE DOCUMENT TEMPLATES\n${templateList}`);
    }
  } catch {
    // No templates
  }

  parts.push(`\n## WORKING DIRECTORY\n${caseFolder}`);

  return parts.join("\n");
}

// Document type descriptions for user feedback
const DOC_TYPE_NAMES: Record<DocumentType, string> = {
  demand_letter: "demand letter",
  case_memo: "case memo",
  settlement: "settlement calculation",
  general_letter: "letter"
};

// System prompt for direct chat (context gets appended)
const BASE_SYSTEM_PROMPT = `You are a helpful legal assistant for a Personal Injury law firm. You help attorneys and staff with case management, document review, answering questions, and drafting documents.

## YOUR CAPABILITIES

1. **Answer Questions**: Use the case index and your knowledge to answer questions about cases, injuries, treatments, and PI law.

2. **Read Documents**: Use read_file to review specific documents when you need more detail than the index provides.

3. **Update Case Data**: Use update_index when the user provides corrections or new information about a case.

4. **Generate Documents**: When the user asks you to draft, write, create, or generate a formal document (demand letter, case memo, settlement calculation, letter), use the generate_document tool. This delegates to a specialized agent with access to firm templates that will create a complete, professional document.

## WHEN TO USE generate_document

Use this tool when the user wants a NEW document created:
- "Draft a demand letter"
- "Write up a case memo"
- "Create a settlement breakdown"
- "Prepare a letter of protection"

Do NOT use it for:
- Questions about what should go in a document
- Reviewing existing documents
- Simple notes or quick responses

## GUIDELINES

- Be concise but thorough
- Answer from the case index when possible - no need for tools on simple lookups
- Explain medical/legal terms briefly when helpful
- Keep responses professional`;

// Main chat function with streaming
export async function* directChat(
  caseFolder: string,
  message: string,
  history: ChatMessage[] = []
): AsyncGenerator<{ type: string; content?: string; tool?: string; done?: boolean; usage?: any; filePath?: string }> {

  // Build context and include it in the system prompt
  const context = await buildContext(caseFolder);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n---\n\n${context}`;

  // Build messages array from history
  const messages: Anthropic.MessageParam[] = [];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Add current message
  messages.push({
    role: "user",
    content: message
  });

  // Initial API call - context is in system prompt, available on every turn
  let response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    tools: TOOLS,
    stream: true
  });

  let fullText = "";
  let toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];
  let currentToolUse: { id: string; name: string; input: string } | null = null;
  let stopReason: string | null = null;

  // Process streaming response
  for await (const event of response) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        currentToolUse = {
          id: event.content_block.id,
          name: event.content_block.name,
          input: ""
        };
        yield { type: "tool", tool: event.content_block.name };
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        fullText += event.delta.text;
        yield { type: "text", content: event.delta.text };
      } else if (event.delta.type === "input_json_delta" && currentToolUse) {
        currentToolUse.input += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolUse) {
        try {
          toolUseBlocks.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: JSON.parse(currentToolUse.input)
          });
        } catch {
          // Invalid JSON, skip
        }
        currentToolUse = null;
      }
    } else if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason;
    } else if (event.type === "message_stop") {
      // Message complete
    }
  }

  // Handle tool use if needed
  if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let generatedFilePath: string | undefined;

    for (const toolUse of toolUseBlocks) {
      // Handle generate_document specially - it's an async generator
      if (toolUse.name === "generate_document") {
        const docType = toolUse.input.document_type as DocumentType;
        const instructions = toolUse.input.instructions as string;
        const docTypeName = DOC_TYPE_NAMES[docType];

        yield { type: "delegating", content: `Generating ${docTypeName}...` };

        // Run the document agent and stream its output
        let filePath: string | undefined;
        for await (const event of generateDocument(caseFolder, docType, instructions)) {
          if (event.type === "status") {
            yield { type: "status", content: event.content };
          } else if (event.type === "tool") {
            yield { type: "tool", content: event.content };
          } else if (event.type === "text") {
            yield { type: "text", content: event.content };
          } else if (event.type === "done") {
            filePath = event.filePath;
          }
        }

        generatedFilePath = filePath;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: filePath
            ? `Document successfully generated and saved to ${filePath}`
            : "Document generation completed but no file was saved"
        });
      } else {
        // Regular tool execution
        yield { type: "tool_executing", tool: toolUse.name };
        const result = await executeTool(toolUse.name, toolUse.input, caseFolder);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result
        });
      }
    }

    // Continue with tool results
    messages.push({
      role: "assistant",
      content: [
        ...(fullText ? [{ type: "text" as const, text: fullText }] : []),
        ...toolUseBlocks.map(t => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: t.input
        }))
      ]
    });

    messages.push({
      role: "user",
      content: toolResults
    });

    // Make follow-up call (non-streaming for simplicity after tool use)
    const followUp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,  // Use same system prompt with context
      messages,
      tools: TOOLS
    });

    // Extract text from follow-up
    for (const block of followUp.content) {
      if (block.type === "text") {
        yield { type: "text", content: block.text };
        fullText += block.text;
      }
    }

    yield {
      type: "done",
      done: true,
      filePath: generatedFilePath,
      usage: {
        inputTokens: followUp.usage.input_tokens,
        outputTokens: followUp.usage.output_tokens
      }
    };
  } else {
    yield {
      type: "done",
      done: true
    };
  }
}
