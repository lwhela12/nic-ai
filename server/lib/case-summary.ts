/**
 * Case Summary Generator (Groq GPT-OSS 120B)
 *
 * Generates case_summary narrative and case_phase from document index.
 * Runs in parallel with hypergraph generation.
 */

import { generateCaseSummaryWithGptOss } from "./groq-extract";
import { loadSectionsByIds } from "../routes/knowledge";
import { PI_PHASES } from "../practice-areas/personal-injury/config";
import { WC_PHASES } from "../practice-areas/workers-comp/config";
import { PRACTICE_AREAS } from "./index-schema";

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

/**
 * Determine case phase from document types present.
 * This provides a reasonable default that the model can refine.
 */
function inferPhaseFromDocuments(folders: Record<string, any>, practiceArea?: string): string {
  const allTypes = new Set<string>();

  for (const folderData of Object.values(folders)) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files || [];
    for (const file of files) {
      if (file.type) {
        allTypes.add(file.type.toLowerCase());
      }
    }
  }

  if (practiceArea === PRACTICE_AREAS.WC) {
    if (allTypes.has("release") || allTypes.has("settlement_agreement")) {
      return "Closed";
    }
    if (allTypes.has("d9_form") || allTypes.has("d16_form") || allTypes.has("hearing") || allTypes.has("settlement")) {
      return "Settlement/Hearing";
    }
    if (allTypes.has("ppd_rating") || allTypes.has("ime_report") || allTypes.has("fce_report")) {
      return "MMI Evaluation";
    }
    if (allTypes.has("wage_statement") || allTypes.has("utilization_review") || allTypes.has("aoe_coe_investigation")) {
      return "Benefits Resolution";
    }
    if (allTypes.has("work_status_report") || allTypes.has("medical_record") || allTypes.has("medical_bill")) {
      return "Treatment";
    }
    if (allTypes.has("c4_claim") || allTypes.has("c3_employer_report") || allTypes.has("c4_supplemental")) {
      return "Investigation";
    }
    return "Intake";
  }

  // PI - work backwards from most advanced phase
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
 * Generate case summary and phase using Groq Qwen3 32B.
 */
export async function generateCaseSummary(
  documentIndex: Record<string, any>,
  options?: {
    firmRoot?: string;
    practiceArea?: string;
  }
): Promise<CaseSummaryResult> {
  console.log(`[CaseSummary] Starting Groq GPT-OSS summary generation`);
  const startTime = Date.now();
  const practiceAreaInput = options?.practiceArea || documentIndex.practice_area;
  const practiceArea = practiceAreaInput === PRACTICE_AREAS.WC
    ? PRACTICE_AREAS.WC
    : PRACTICE_AREAS.PI;
  const isWC = practiceArea === PRACTICE_AREAS.WC;
  const practiceLabel = isWC ? "Workers' Compensation" : "Personal Injury";

  // Load knowledge for context
  const knowledge = await loadSectionsByIds(options?.firmRoot, SUMMARY_SECTION_IDS);

  // Build condensed index view
  const condensedIndex = buildCondensedIndex(documentIndex);

  // Get initial phase inference as hint
  const inferredPhase = inferPhaseFromDocuments(documentIndex.folders || {}, practiceArea);

  const contextLines: string[] = [];
  if (typeof documentIndex.case_name === "string" && documentIndex.case_name.trim()) {
    contextLines.push(`Case Name: ${documentIndex.case_name.trim()}`);
  }
  if (documentIndex.is_doi_case && typeof documentIndex.injury_date === "string") {
    contextLines.push(`DOI Case: yes (injury date ${documentIndex.injury_date})`);
  }
  if (Array.isArray(documentIndex.related_cases) && documentIndex.related_cases.length > 0) {
    contextLines.push(`Related Claims: ${documentIndex.related_cases.length}`);
  }
  const contextBlock = contextLines.length > 0
    ? contextLines.join("\n")
    : "No extra case metadata provided.";

  const phaseEnum = isWC ? [...WC_PHASES] : [...PI_PHASES];

  const phaseDefinitions = isWC
    ? `- **Intake**: Initial WC claim setup and onboarding
- **Investigation**: Compensability and records investigation in progress
- **Treatment**: Active treatment and work-status management
- **MMI Evaluation**: MMI/PPD evaluation stage
- **Benefits Resolution**: Wage/benefit disputes and resolution work
- **Settlement/Hearing**: Hearing prep/active litigation or settlement execution
- **Closed**: Matter resolved/closed`
    : `- **Intake**: Client just signed, gathering initial documents
- **Investigation**: Collecting records, police reports, insurance info
- **Treatment**: Client receiving ongoing medical care
- **Demand**: Demand letter has been sent to insurance
- **Negotiation**: Back-and-forth with adjuster on settlement
- **Settlement**: Terms agreed, finalizing paperwork
- **Complete**: Case closed and resolved`;

  const systemPrompt = `You are a case intake specialist for a ${practiceLabel} law firm.

Your job: Write a brief case summary and determine the current case phase.

## PRACTICE KNOWLEDGE

${knowledge}

## PHASE DEFINITIONS

${phaseDefinitions}

## VALID PHASES

case_phase must be one of: ${phaseEnum.join(", ")}

## INSTRUCTIONS

1. Review the document list and key information
2. Write a 2-4 sentence summary covering:
   - Type of incident (MVA, slip-and-fall, dog bite, etc.)
   - Injuries described
   - Treatment status (ongoing, completed, etc.)
   - Any notable case factors
3. Determine the case phase based on what documents are present`;

  const userPrompt = `CASE CONTEXT:
${contextBlock}

CASE DOCUMENTS:
${condensedIndex}

Initial phase inference (you may adjust): ${inferredPhase}

Analyze the case and return your summary and phase determination as JSON.`;

  try {
    const { result, usage } = await generateCaseSummaryWithGptOss(
      condensedIndex,
      systemPrompt,
      userPrompt
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[CaseSummary] Done in ${elapsed}s. Phase: ${result.case_phase}`);
    console.log(`[CaseSummary] Usage: ${usage.inputTokens} in / ${usage.outputTokens} out`);

    return {
      case_summary: result.case_summary,
      case_phase: result.case_phase,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens
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
