// Single source of truth for case phase detection logic.
// Used by claude.ts /determine-phase endpoint and referenced by firm.ts synthesisSystemPrompt.

export const PHASE_RULES: Record<string, string> = {
  Intake: "Has intake docs but no LOR files sent",
  Investigation: "LORs sent, gathering insurance/police info",
  Treatment: "Medical records accumulating, no demand yet",
  Demand: "Demand letter exists in 3P folder",
  Negotiation: "Settlement correspondence exists, no settlement memo",
  Settlement: "Settlement memo exists",
  Complete: "Release signed, case complete",
};

export const PHASE_INDICATORS = [
  { check: "LOR files (LOR 1P, LOR 3P)", phase: "Investigation" },
  { check: 'Medical records in "Records & Bills"', phase: "Treatment" },
  { check: '"Demand" in filename in 3P folder', phase: "Demand" },
  { check: "Settlement correspondence", phase: "Negotiation" },
  { check: "Settlement memo in Settlement folder", phase: "Settlement" },
  { check: "Signed release in Settlement folder", phase: "Complete" },
] as const;

export function buildPhasePrompt(): string {
  const rulesSection = Object.entries(PHASE_RULES)
    .map(([phase, desc]) => `- **${phase}**: ${desc}`)
    .join("\n");

  const indicatorsSection = PHASE_INDICATORS
    .map((ind, i) => `${i + 1}. ${ind.check} \u2192 at least ${ind.phase} phase`)
    .join("\n");

  return `Read .pi_tool/document_index.json and determine the case phase based on these markers:

**Phase Detection Logic:**
${rulesSection}

**Check the folders object for these indicator files:**
${indicatorsSection}

Read the index, determine the phase, update the "case_phase" field, and write the updated index back to .pi_tool/document_index.json.`;
}
