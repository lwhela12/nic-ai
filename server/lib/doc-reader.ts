/**
 * Document Reader with Vision Support
 *
 * Spawns an Agent SDK agent with the Read tool to read PDFs with full
 * multimodal support (rendered pages + extracted text). The SDK's Read tool
 * natively handles PDFs by base64-encoding them as document content blocks,
 * which the API renders as images and extracts text from.
 *
 * For non-PDF files, the agent reads them as plain text.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSDKCliOptions } from "./sdk-cli-options";
import { join } from "path";
import { stat } from "fs/promises";

// Events yielded by readDocument
export type DocReaderEvent =
  | { type: "status"; content: string }
  | { type: "tool"; content: string }
  | { type: "error"; content: string }
  | { type: "done"; content: string };

const SYSTEM_PROMPT = `You are a document reading assistant. Your job is to read a specific document and answer a question about it.

## Instructions

1. Use the Read tool to read the file at the path provided
2. Analyze the content carefully
3. Answer the question based on what you see in the document

## Document Types

- **Medical records**: Look for patient name, dates of service, diagnoses (ICD codes), procedures (CPT codes), provider notes, and treatment plans
- **Billing/invoices**: Look for provider name, dates of service, CPT codes, charges, payments, adjustments, and balances
- **Legal documents**: Look for parties, dates, claim numbers, policy information, and key terms
- **Forms/intake**: Look for filled-in fields, checkboxes, signatures, and dates — pay attention to spatial layout since form labels and values may be side by side
- **Imaging reports**: Look for findings, impressions, and recommendations

## Response Format

Answer the question directly and concisely. Include specific details like dates, amounts, and names when relevant. If the document is unclear or you can't find the requested information, say so.`;

/**
 * Read a document using the Agent SDK's native PDF vision support.
 *
 * @param caseFolder - Absolute path to the case folder
 * @param documentPath - Relative path to the document within the case folder
 * @param question - What the user wants to know about the document
 */
export async function* readDocument(
  caseFolder: string,
  documentPath: string,
  question: string
): AsyncGenerator<DocReaderEvent> {
  // Validate path
  const fullPath = join(caseFolder, documentPath);
  if (!fullPath.startsWith(caseFolder)) {
    yield { type: "error", content: "Error: Cannot read files outside the case folder" };
    return;
  }

  // Check file exists
  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) {
      yield { type: "error", content: `Error: "${documentPath}" is not a file` };
      return;
    }
    // Check size limit (20MB)
    if (fileStat.size > 20 * 1024 * 1024) {
      yield { type: "error", content: `Error: File is too large (${Math.round(fileStat.size / 1024 / 1024)}MB). Maximum is 20MB.` };
      return;
    }
  } catch {
    yield { type: "error", content: `Error: File not found: "${documentPath}"` };
    return;
  }

  const isPdf = documentPath.toLowerCase().endsWith(".pdf");
  yield {
    type: "status",
    content: `Reading ${documentPath}${isPdf ? " with vision" : ""}...`
  };

  const prompt = `Read the file at this absolute path: ${fullPath}

Then answer this question about the document:
${question}`;

  try {
    let resultContent = "";

    for await (const msg of query({
      prompt,
      options: {
        cwd: caseFolder,
        systemPrompt: SYSTEM_PROMPT,
        model: "haiku",
        allowedTools: ["Read"],
        permissionMode: "acceptEdits",
        maxTurns: 3,
        ...getSDKCliOptions(),
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            resultContent += block.text;
          }
        }
      }

      if (msg.type === "tool_use") {
        yield { type: "tool", content: `Reading ${documentPath}...` };
      }

      if (msg.type === "result") {
        if (msg.subtype !== "success") {
          yield {
            type: "error",
            content: `Document reading failed: ${msg.subtype}`
          };
          return;
        }
      }
    }

    if (!resultContent) {
      yield { type: "error", content: "No response from document reader" };
      return;
    }

    yield { type: "done", content: resultContent };
  } catch (error) {
    yield {
      type: "error",
      content: `Error reading document: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
