// Single source of truth for case phase detection logic.
// Used by claude.ts /determine-phase endpoint and referenced by firm.ts synthesisSystemPrompt.
//
// Practice Area Support:
// - Personal Injury (PI): Original phases (Intake → Investigation → Treatment → Demand → Negotiation → Settlement → Complete)
// - Workers' Compensation (WC): WC phases (Intake → Investigation → Treatment → MMI Evaluation → Benefits Resolution → Settlement/Hearing → Closed)

import { PRACTICE_AREAS, type PracticeAreaName } from "../lib/index-schema";

// =============================================================================
// PERSONAL INJURY PHASE RULES
// =============================================================================

export const PI_PHASE_RULES: Record<string, string> = {
  Intake: "Has intake docs but no LOR files sent",
  Investigation: "LORs sent, gathering insurance/police info",
  Treatment: "Medical records accumulating, no demand yet",
  Demand: "Demand letter exists in 3P folder",
  Negotiation: "Settlement correspondence exists, no settlement memo",
  Settlement: "Settlement memo exists",
  Complete: "Release signed, case complete",
};

export const PI_PHASE_INDICATORS = [
  { check: "LOR files (LOR 1P, LOR 3P)", phase: "Investigation" },
  { check: 'Medical records in "Records & Bills"', phase: "Treatment" },
  { check: '"Demand" in filename in 3P folder', phase: "Demand" },
  { check: "Settlement correspondence", phase: "Negotiation" },
  { check: "Settlement memo in Settlement folder", phase: "Settlement" },
  { check: "Signed release in Settlement folder", phase: "Complete" },
] as const;

// =============================================================================
// WORKERS' COMPENSATION PHASE RULES
// =============================================================================

export const WC_PHASE_RULES: Record<string, string> = {
  Intake: "C-4 filed, initial documentation gathered",
  Investigation: "Compensability investigation underway, gathering employment/medical records",
  Treatment: "Active medical treatment, ATP visits, work status reports accumulating",
  "MMI Evaluation": "Treatment stabilized, awaiting or reviewing MMI determination and PPD rating",
  "Benefits Resolution": "Disputing benefits, negotiating PPD award, or pursuing additional compensation",
  "Settlement/Hearing": "Settlement negotiations active or hearing scheduled/completed",
  Closed: "Case resolved, settlement executed or hearing decision final",
};

export const WC_PHASE_INDICATORS = [
  { check: "C-4 Employee Claim form filed", phase: "Intake" },
  { check: "C-3 Employer Report received", phase: "Investigation" },
  { check: "Medical records from treating physician", phase: "Treatment" },
  { check: "Work status reports or light duty documentation", phase: "Treatment" },
  { check: "IME report or MMI determination", phase: "MMI Evaluation" },
  { check: "PPD rating report", phase: "MMI Evaluation" },
  { check: "Benefit dispute correspondence or D-9 hearing request", phase: "Benefits Resolution" },
  { check: "Settlement offer or stipulation draft", phase: "Settlement/Hearing" },
  { check: "Signed settlement agreement or hearing decision", phase: "Closed" },
] as const;

// =============================================================================
// BACKWARD COMPATIBLE EXPORTS (default to PI)
// =============================================================================

export const PHASE_RULES = PI_PHASE_RULES;
export const PHASE_INDICATORS = PI_PHASE_INDICATORS;

// =============================================================================
// PRACTICE AREA HELPERS
// =============================================================================

/**
 * Get phase rules for a practice area.
 */
export function getPhaseRules(practiceArea?: string): Record<string, string> {
  if (practiceArea === PRACTICE_AREAS.WC) return WC_PHASE_RULES;
  return PI_PHASE_RULES;
}

/**
 * Get phase indicators for a practice area.
 */
export function getPhaseIndicators(practiceArea?: string): readonly { check: string; phase: string }[] {
  if (practiceArea === PRACTICE_AREAS.WC) return WC_PHASE_INDICATORS;
  return PI_PHASE_INDICATORS;
}

/**
 * Build a phase detection prompt for the agent.
 * @param practiceArea - Optional practice area (defaults to PI)
 */
export function buildPhasePrompt(practiceArea?: string): string {
  const rules = getPhaseRules(practiceArea);
  const indicators = getPhaseIndicators(practiceArea);
  const practiceAreaName = practiceArea === PRACTICE_AREAS.WC ? "Workers' Compensation" : "Personal Injury";

  const rulesSection = Object.entries(rules)
    .map(([phase, desc]) => `- **${phase}**: ${desc}`)
    .join("\n");

  const indicatorsSection = indicators
    .map((ind, i) => `${i + 1}. ${ind.check} → at least ${ind.phase} phase`)
    .join("\n");

  return `Read .pi_tool/document_index.json and determine the case phase based on these markers.

**Practice Area:** ${practiceAreaName}

**Phase Detection Logic:**
${rulesSection}

**Check the folders object for these indicator files:**
${indicatorsSection}

Read the index, determine the phase, update the "case_phase" field, and write the updated index back to .pi_tool/document_index.json.`;
}
