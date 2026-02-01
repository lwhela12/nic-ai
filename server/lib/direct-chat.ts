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
  },
  {
    name: "start_document_review",
    description: "Start reviewing document conflicts (needs_review items). Use when the user wants to review conflicts, resolve discrepancies, or go through items that need attention. Returns the list of pending conflicts for you to walk through one by one.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: []
    }
  },
  {
    name: "resolve_conflict",
    description: "Resolve a specific conflict from needs_review. Use this after the user has reviewed a conflict and told you which value is correct. This removes the item from needs_review, adds it to errata for audit trail, and updates summary fields if applicable.",
    input_schema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          description: "The field name from needs_review (e.g., 'charges:Provider Name', 'date_of_loss', 'claim_numbers:3P')"
        },
        resolved_value: {
          type: "string",
          description: "The correct value the user confirmed"
        },
        evidence: {
          type: "string",
          description: "Brief explanation of why this value is correct (e.g., 'Per original invoice', 'User confirmed from police report')"
        }
      },
      required: ["field", "resolved_value"]
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

      case "start_document_review": {
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        const needsReview: any[] = index.needs_review || [];

        if (needsReview.length === 0) {
          return JSON.stringify({
            status: "no_items",
            message: "No conflicts to review. All items have been resolved.",
            count: 0
          });
        }

        // Build filename -> path lookup from folders
        const filePathMap: Record<string, string> = {};
        if (index.folders) {
          for (const [folderName, folderData] of Object.entries(index.folders)) {
            const files: any[] = Array.isArray(folderData) ? folderData : (folderData as any)?.files || [];
            for (const file of files) {
              if (file.filename) {
                filePathMap[file.filename] = `${folderName}/${file.filename}`;
              }
            }
          }
        }

        // Enrich items with resolved file paths
        const enrichedItems = needsReview.map((item, idx) => {
          const resolvedSources = (item.sources || []).map((source: string) => {
            // Source might be "filename.pdf ($1,234)" - extract just the filename
            const match = source.match(/^([^(]+)/);
            const filename = match ? match[1].trim() : source.trim();
            return {
              original: source,
              filename,
              path: filePathMap[filename] || null
            };
          });

          return {
            index: idx + 1,
            field: item.field,
            conflicting_values: item.conflicting_values,
            sources: item.sources,
            resolved_sources: resolvedSources,
            reason: item.reason
          };
        });

        return JSON.stringify({
          status: "review_started",
          message: `Found ${needsReview.length} conflict(s) to review.`,
          count: needsReview.length,
          items: enrichedItems
        });
      }

      case "resolve_conflict": {
        const { field, resolved_value, evidence } = toolInput;
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        // Find the item in needs_review
        const needsReview: any[] = index.needs_review || [];
        const itemIndex = needsReview.findIndex((item: any) => item.field === field);

        if (itemIndex === -1) {
          return JSON.stringify({
            success: false,
            error: `Field "${field}" not found in needs_review`
          });
        }

        const resolvedItem = needsReview[itemIndex];
        const rejectedValues = resolvedItem.conflicting_values?.filter(
          (v: any) => String(v) !== String(resolved_value)
        ) || [];

        // Remove from needs_review
        needsReview.splice(itemIndex, 1);
        index.needs_review = needsReview;

        // Add to errata
        const errata: any[] = index.errata || [];
        const errataEntry = {
          field,
          decision: resolved_value,
          rejected_values: rejectedValues,
          evidence: evidence || "User confirmed correct value",
          resolution_type: "user_decision",
          resolved_at: new Date().toISOString()
        };
        errata.push(errataEntry);
        index.errata = errata;

        // Add to case_notes
        let caseNotes: any[] = Array.isArray(index.case_notes) ? index.case_notes : [];
        caseNotes.push({
          id: `note-${Date.now()}`,
          content: `Resolved ${field}: ${resolved_value} (was conflicting: ${rejectedValues.join(", ")}). ${evidence || ""}`.trim(),
          field_updated: field,
          previous_value: rejectedValues,
          source: "chat_review",
          createdAt: new Date().toISOString()
        });
        index.case_notes = caseNotes;

        // Update summary fields if applicable
        let summaryUpdated = false;

        // For charges fields, update provider and total
        if (field.startsWith("charges:") && index.summary?.providers) {
          const providerName = field.replace("charges:", "");
          const numericValue = parseFloat(String(resolved_value).replace(/[$,]/g, ""));

          const providers = index.summary.providers;
          if (Array.isArray(providers)) {
            for (const prov of providers) {
              if (typeof prov === "object" && prov.name) {
                if (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
                    providerName.toLowerCase().includes(prov.name.toLowerCase())) {
                  const oldCharges = prov.charges;
                  prov.charges = numericValue;

                  if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                    const delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
                    index.summary.total_charges = index.summary.total_charges + delta;
                  }
                  summaryUpdated = true;
                  break;
                }
              }
            }
          }
        }

        // For date_of_loss, update summary.dol
        if (field === "date_of_loss" && index.summary) {
          index.summary.dol = resolved_value;
          summaryUpdated = true;
        }

        // For claim_numbers, update summary
        if (field.startsWith("claim_numbers:") && index.summary) {
          const claimKey = field.replace("claim_numbers:", "");
          if (!index.summary.claim_numbers) {
            index.summary.claim_numbers = {};
          }
          index.summary.claim_numbers[claimKey] = resolved_value;
          summaryUpdated = true;
        }

        // Write updated index
        await writeFile(indexPath, JSON.stringify(index, null, 2));

        return JSON.stringify({
          success: true,
          field,
          resolved_value,
          rejected_values: rejectedValues,
          remaining_conflicts: needsReview.length,
          summary_updated: summaryUpdated,
          message: `Resolved "${field}" to "${resolved_value}". ${needsReview.length} conflict(s) remaining.`
        });
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

5. **Review Document Conflicts**: When the user wants to review conflicts or needs_review items, use start_document_review to get the list, then walk through each conflict one at a time, asking the user which value is correct, and use resolve_conflict to record their decision.

## DOCUMENT REVIEW MODE

Use this when the user says things like:
- "Let's review the conflicts"
- "Go through the needs_review items"
- "There are discrepancies to resolve"
- "Review document issues"

### How to conduct a review:

1. **Start the review** - Call start_document_review to get all pending conflicts

2. **Present one conflict at a time** - For each item:
   - State the field name clearly (e.g., "Charges for Desert Radiology")
   - List ALL conflicting values with their sources
   - If the source is a file, tell the user they can check it at the path provided
   - Ask which value is correct, or if they want to check the document first

3. **Wait for user decision** - Let them:
   - Pick one of the values
   - Provide a different value if none are correct
   - Ask to see the source document (use read_file)
   - Skip to decide later

4. **Record the resolution** - Call resolve_conflict with:
   - The exact field name from needs_review
   - The resolved_value the user confirmed
   - Brief evidence explaining the decision

5. **Continue to the next conflict** - Repeat until all are resolved

### Example review flow:

User: "Let's review the conflicts"

You: [call start_document_review]

You: "I found 3 conflicts to review. Let's start with the first one.

**Conflict 1: Charges for Desert Radiology**

I'm seeing two different amounts:
- $1,234 (from Records & Bills/Desert Radiology Invoice.pdf)
- $1,432 (from Records & Bills/Desert Radiology Statement.pdf)

Which amount is correct? You can say 'show me the invoice' if you want to check the documents."

User: "$1,234 is correct, that's from the itemized invoice"

You: [call resolve_conflict with field="charges:Desert Radiology", resolved_value="$1,234", evidence="Per itemized invoice"]

You: "Got it, I've recorded $1,234 as the correct amount. 2 conflicts remaining.

**Conflict 2: Date of Loss**
..."

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
