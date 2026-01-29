/**
 * Haiku Case Summary Generator
 *
 * Generates case_summary narrative and case_phase from document index.
 * Runs in parallel with hypergraph generation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadSectionsByIds } from "../routes/knowledge";

const anthropic = new Anthropic();

// Knowledge sections relevant for case summary
const SUMMARY_SECTION_IDS = [
  "document-quality",  // Understanding what documents indicate
  "injury-severity",   // Context for describing injuries
];

export interface CaseSummaryResult {
  case_summary: string;
  case_phase: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Schema for structured output
const CASE_SUMMARY_SCHEMA = {
  type: "object" as const,
  properties: {
    case_summary: {
      type: "string" as const,
      description: "Brief narrative summary of the case (2-4 sentences). Include: type of accident, injuries sustained, treatment status, and current case posture."
    },
    case_phase: {
      type: "string" as const,
      enum: ["Intake", "Investigation", "Treatment", "Demand", "Negotiation", "Settlement", "Complete"],
      description: "Current phase based on documents present. Intake=just signed, Investigation=gathering records, Treatment=ongoing care, Demand=demand sent, Negotiation=back-and-forth, Settlement=finalizing, Complete=closed."
    }
  },
  required: ["case_summary", "case_phase"] as const
};

/**
 * Determine case phase from document types present.
 * This provides a reasonable default that Haiku can refine.
 */
function inferPhaseFromDocuments(folders: Record<string, any>): string {
  const allTypes = new Set<string>();

  for (const folderData of Object.values(folders)) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files || [];
    for (const file of files) {
      if (file.type) {
        allTypes.add(file.type.toLowerCase());
      }
    }
  }

  // Work backwards from most advanced phase
  if (allTypes.has("settlement") || allTypes.has("release")) {
    return "Settlement";
  }
  if (allTypes.has("demand")) {
    // Check if we have response/negotiation docs
    if (allTypes.has("correspondence")) {
      return "Negotiation";
    }
    return "Demand";
  }
  if (allTypes.has("medical_record") || allTypes.has("medical_bill")) {
    return "Treatment";
  }
  if (allTypes.has("police_report") || allTypes.has("declaration")) {
    return "Investigation";
  }
  if (allTypes.has("intake_form") || allTypes.has("lor")) {
    return "Intake";
  }

  return "Intake"; // Default
}

/**
 * Build a condensed view of the document index for the summary prompt.
 * We don't need full extracted_data, just document types and key_info.
 */
function buildCondensedIndex(documentIndex: Record<string, any>): string {
  const lines: string[] = [];
  const folders = documentIndex.folders || {};

  for (const [folderName, folderData] of Object.entries(folders)) {
    const files = Array.isArray(folderData) ? folderData : (folderData as any)?.files || [];
    if (files.length === 0) continue;

    lines.push(`\n## ${folderName}/`);
    for (const file of files) {
      const type = file.type || "unknown";
      const keyInfo = file.key_info ? ` - ${file.key_info.slice(0, 200)}` : "";
      lines.push(`- [${type}] ${file.filename}${keyInfo}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate case summary and phase using Haiku.
 */
export async function generateCaseSummary(
  documentIndex: Record<string, any>,
  firmRoot?: string
): Promise<CaseSummaryResult> {
  console.log(`[CaseSummary] Starting Haiku summary generation`);
  const startTime = Date.now();

  // Load knowledge for context
  const knowledge = await loadSectionsByIds(firmRoot, SUMMARY_SECTION_IDS);

  // Build condensed index view
  const condensedIndex = buildCondensedIndex(documentIndex);

  // Get initial phase inference as hint
  const inferredPhase = inferPhaseFromDocuments(documentIndex.folders || {});

  const systemPrompt = `You are a case intake specialist for a Personal Injury law firm.

Your job: Write a brief case summary and determine the current case phase.

## PRACTICE KNOWLEDGE

${knowledge}

## PHASE DEFINITIONS

- **Intake**: Client just signed, gathering initial documents
- **Investigation**: Collecting records, police reports, insurance info
- **Treatment**: Client receiving ongoing medical care
- **Demand**: Demand letter has been sent to insurance
- **Negotiation**: Back-and-forth with adjuster on settlement
- **Settlement**: Terms agreed, finalizing paperwork
- **Complete**: Case closed and resolved

## INSTRUCTIONS

1. Review the document list and key information
2. Write a 2-4 sentence summary covering:
   - Type of incident (MVA, slip-and-fall, dog bite, etc.)
   - Injuries described
   - Treatment status (ongoing, completed, etc.)
   - Any notable case factors
3. Determine the case phase based on what documents are present

Use the case_summary tool to return your analysis.`;

  const userPrompt = `CASE DOCUMENTS:
${condensedIndex}

Initial phase inference (you may adjust): ${inferredPhase}

Analyze the case and use the case_summary tool to return your summary and phase determination.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [{
        name: "case_summary",
        description: "Output the case summary and phase determination",
        input_schema: CASE_SUMMARY_SCHEMA
      }],
      tool_choice: { type: "tool", name: "case_summary" }
    });

    // Extract tool use
    const toolBlock = response.content.find(block => block.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error("No tool use response from Haiku");
    }

    const result = toolBlock.input as { case_summary: string; case_phase: string };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[CaseSummary] Done in ${elapsed}s. Phase: ${result.case_phase}`);
    console.log(`[CaseSummary] Usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

    return {
      case_summary: result.case_summary,
      case_phase: result.case_phase,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    };
  } catch (error) {
    console.error("[CaseSummary] Error:", error);

    // Fallback to inferred values
    return {
      case_summary: "Case summary generation failed. Please review documents manually.",
      case_phase: inferredPhase,
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}
