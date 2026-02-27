/**
 * Density Chat Prompts
 *
 * All system/user prompt builders for the density chat pipeline:
 * - Intent classifier
 * - Q&A pipeline (route → plan → extract → answer)
 * - Document generation (research question builder + compose)
 */

// ============================================================================
// Intent Classifier
// ============================================================================

export const INTENT_TYPES = [
  "answer",
  "build_packet",
  "generate_document",
  "update_index",
  "update_case_summary",
  "resolve_conflict",
  "batch_resolve_conflicts",
  "rerun_hypergraph",
  "create_document_view",
  "read_document",
  "confirm_hearing",
  "confirm_packet",
  "clarify",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export interface ClassifiedIntent {
  intent: IntentType;
  confidence: number;
  params: Record<string, any>;
  reasoning: string;
}

export function buildIntentClassifierPrompt(
  metaIndexSummary: string,
): string {
  return `You are an intent classifier for a personal injury case management system.
Given a user message and case context, classify the intent and extract parameters.

Return JSON with these fields:
{
  "intent": one of ${JSON.stringify(INTENT_TYPES)},
  "confidence": 0.0 to 1.0,
  "params": intent-specific parameters (see below),
  "reasoning": brief explanation of classification
}

## Intent Definitions & Params

**answer** — User asks a question about the case, documents, law, or wants information.
params: { "question": "the user's question" }
Examples: "What are the total medical charges?", "When was the accident?", "Summarize the medical records"

**generate_document** — User wants to draft/write/create a formal document.
params: { "doc_type": "demand_letter"|"case_memo"|"settlement"|"general_letter"|"decision_order", "instructions": "any specific instructions" }
Examples: "Draft a demand letter", "Write a case memo", "Generate a settlement calculation"

**build_packet** — User wants to build an evidence packet or hearing binder.
params: { "hearing_type": "AO"|"HO"|null, "hearing_number": string|null, "instructions": string }
Examples: "Build a hearing packet", "Create an evidence binder for hearing #12345"

**update_index** — User provides corrections or new info about case fields (client name, DOB, phone, etc).
params: { "field_path": "dotted.path.to.field", "value": "new value" }
Examples: "Update the client's phone to 555-1234", "Change the DOB to 01/15/1980"

**update_case_summary** — User wants to update the narrative case summary or phase.
params: { "updates": { field: value } }
Examples: "Update the case summary to include the new MRI findings", "Change the case phase to litigation"

**resolve_conflict** — User wants to resolve a single data conflict from needs_review.
params: { "conflict_id": string|null, "resolution": string|null }
Examples: "The correct DOB is 01/15/1980", "Resolve the name conflict — it's John Smith"

**batch_resolve_conflicts** — User wants to resolve multiple conflicts at once.
params: { "resolutions": [{ "conflict_id": string, "resolution": string }] }
Examples: "Accept all the values from the intake form"

**rerun_hypergraph** — User wants to re-run cross-document consistency analysis.
params: {}
Examples: "Re-run the hypergraph", "Check for conflicts again", "Refresh the analysis"

**create_document_view** — User wants a curated view of specific documents.
params: { "name": string, "description": string, "paths": string[], "sort_by": "folder"|"date"|"type" }
Examples: "Show me all the medical records", "Create a view of the billing documents"

**read_document** — User wants to read a specific document (typically scanned PDF needing vision).
params: { "path": string, "question": string|null }
Examples: "Read the intake form", "What does the MRI report say?"

**confirm_hearing** — User is confirming a hearing for an evidence packet. Use this when the previous assistant message asked about which hearing to build a packet for and the user confirms (e.g., "yes", "that one", "hearing #1", or specifies a hearing number).
params: { "hearing_number": string|null }
Examples: "Yes", "That one", "Use hearing 2680509-RA", "#1"

**confirm_packet** — User is confirming a proposed evidence packet document list. Use this when the previous assistant message showed a proposed document list for a packet and the user approves it.
params: {}
Examples: "Yes", "Looks good", "Go ahead and build it", "Confirmed"

**clarify** — Message is too vague or ambiguous to classify.
params: { "question": "what to ask the user" }
Examples: "Help me with the thing", "Do the stuff"

## Case Context
${metaIndexSummary}

## Rules
- Prefer "answer" for most informational questions — it handles analysis, summaries, and lookups.
- Only use "generate_document" when the user explicitly wants a formal document drafted.
- Use "clarify" only when genuinely ambiguous — most messages have clear intent.
- Use "confirm_hearing" when the previous assistant message asked about a hearing and the user is confirming. Look for hearing selection context.
- Use "confirm_packet" ONLY when the previous assistant message showed a proposed document list and the user is approving it.
- If unsure whether the user is confirming a hearing or a document list, check the last assistant message: if it lists documents → confirm_packet, if it asks about a hearing → confirm_hearing.
- For "update_index", extract the field path and value from the message.
- If the user asks to "re-index" or "update the index", that's "rerun_hypergraph", not "update_index".`;
}

// ============================================================================
// Q&A Pipeline: Route
// ============================================================================

export function buildRouterPrompt(
  metaIndexSummary: string,
): string {
  return `You are a document router for a personal injury case management system.
Given a question and a list of folders in the case index, select which folders likely contain relevant information.

Return JSON:
{
  "selected_folders": ["folder_name_1", "folder_name_2", ...],
  "reasoning": "brief explanation"
}

## Available Folders
${metaIndexSummary}

## Rules
- Select 1-5 folders most likely to contain the answer.
- Prefer fewer folders — only add more if the question spans multiple areas.
- The "summary" field in each folder describes its contents. Use it to guide selection.
- If the question is about the whole case (e.g., "summarize everything"), select the most important 3-4 folders.`;
}

export function buildRouterUserPrompt(question: string): string {
  return `Question: ${question}

Select the folders most likely to contain relevant information.`;
}

// ============================================================================
// Q&A Pipeline: Plan
// ============================================================================

export function buildPlannerPrompt(): string {
  return `You are a document planner for a personal injury case management system.
Given a question and folder summaries with file listings, decide which specific documents need deeper reading.

Return JSON:
{
  "documents_to_read": [
    { "folder": "folder_name", "filename": "file.pdf", "reason": "why this doc is needed" }
  ],
  "requires_targeted_extraction": true/false,
  "reasoning": "overall plan"
}

## Rules
- Each file listing includes a summary (after the dash). Use these summaries to judge whether a document is relevant.
- Select only documents likely to contain the answer — typically 2-8 documents.
- If the folder summaries already contain enough information to answer the question, set "requires_targeted_extraction" to false and return an empty documents_to_read list. The answer stage can use the summaries directly.
- Prioritize documents whose summaries indicate relevance to the question.
- For questions about "most recent", "latest", or "newest" documents, prioritize the files with the most recent dates.`;
}

export function buildPlannerUserPrompt(
  question: string,
  folderDetails: string,
): string {
  return `Question: ${question}

## Folder Details
${folderDetails}

Select which documents need deeper reading to answer this question.`;
}

// ============================================================================
// Q&A Pipeline: Extract
// ============================================================================

export function buildExtractorPrompt(): string {
  return `You are an information extractor for a personal injury case management system.
Given a question, existing accumulated context (memory), and new document content, extract and condense all relevant facts into an updated memory.

Respond ONLY with the highly condensed text summary — no JSON wrapper, no preamble.

## Rules
- MERGE new findings into existing memory — never discard previous findings.
- Condense naturally: combine related facts, remove redundancy, keep specific numbers/dates/names.
- Always cite the source document for each fact: [filename.pdf].
- If contradictory facts appear, include both with their sources.
- Organize by topic (injuries, treatment, charges, dates, parties, etc.) not by document.
- The output replaces the previous memory entirely — include everything important.`;
}

export function buildExtractorUserPrompt(
  question: string,
  memory: string,
  documentContent: string,
  documentName: string,
): string {
  return `Question: ${question}

## Current Memory
${memory || "(empty — first document)"}

## New Document: ${documentName}
${documentContent}

Extract relevant information and merge into memory.`;
}

/**
 * Build extractor user prompt for a batch of documents.
 * Multiple documents are included in a single prompt, each labeled.
 */
export function buildBatchExtractorUserPrompt(
  question: string,
  memory: string,
  documents: Array<{ name: string; content: string }>,
): string {
  const docSections = documents
    .map((d) => `### ${d.name}\n${d.content}`)
    .join("\n\n");

  return `Question: ${question}

## Current Memory
${memory || "(empty — first batch)"}

## Documents (${documents.length})
${docSections}

Extract all relevant information from these documents and merge into memory.`;
}

/**
 * Build a prompt for LLM-driven memory compression.
 * Used when memory exceeds the token budget — asks the LLM to compress
 * naturally rather than hard-slicing.
 */
export function buildMemoryCompressionPrompt(): string {
  return `You are a memory compressor. Given accumulated research notes, compress them to fit within a smaller budget while preserving all important facts, numbers, dates, and citations.

Respond ONLY with the compressed text — no preamble, no explanation.

## Rules
- Preserve all specific numbers, dates, dollar amounts, and names.
- Preserve all source citations [filename.pdf].
- Combine redundant information.
- Use abbreviations and shorthand where clear.
- Remove filler words and verbose phrasing.
- Organize by topic for clarity.`;
}

export function buildMemoryCompressionUserPrompt(
  memory: string,
): string {
  return `Compress the following research notes. Preserve all important facts and citations but reduce total length by ~40%.

${memory}`;
}

// ============================================================================
// Q&A Pipeline: Answer
// ============================================================================

export function buildAnswererPrompt(knowledge: string): string {
  return `You are a personal injury case analyst. Answer questions thoroughly and accurately based on the compiled case information.

${knowledge ? `## Practice Knowledge\n${knowledge}\n` : ""}
## Rules
- Ground all factual claims in the compiled research — cite sources as [document name].
- If information is incomplete, say what's known and what's missing.
- Use professional but accessible language.
- For legal questions, provide relevant analysis informed by PI practice knowledge.
- Format responses with clear structure — use headers, bullet points, and tables where appropriate.
- Be direct and thorough. Don't hedge unnecessarily when the evidence is clear.`;
}

export function buildAnswererUserPrompt(
  question: string,
  memory: string,
  caseContext: string,
): string {
  return `## Compiled Research
${memory}

## Case Context
${caseContext}

## Question
${question}

Provide a thorough, well-cited answer.`;
}

// ============================================================================
// Evidence Packet: Document Selection
// ============================================================================

export function buildPacketSelectorPrompt(): string {
  return `You are an evidence packet planner for a workers' compensation case management system.
Given open hearing details, case documents, and optionally practice knowledge rules, select and order documents for a hearing evidence packet.

Return JSON:
{
  "hearing_type": "HO" or "AO",
  "hearing_number": string or null,
  "explanation": "Brief explanation of your reasoning and any rules you applied",
  "documents": [
    {
      "folder": "Folder Name",
      "filename": "document.pdf",
      "title": "Human-readable title",
      "reason": "Why this document is included"
    }
  ]
}

## Rules
- Order documents logically: hearing notices first, then medical records chronologically, then billing, then correspondence.
- If practice knowledge rules are available, follow them for ordering and inclusion/exclusion.
- Include all documents that would be relevant to the hearing issues.
- Exclude clearly irrelevant documents (e.g., internal notes, duplicate copies).
- If a hearing number has a "-RA", "-AP", or "-APPEAL" suffix, it's an Appeals Officer (AO) hearing. Otherwise it's a Hearing Officer (HO) hearing.
- For AO hearings, focus on documents relevant to the appealed issue.
- For HO hearings, include a comprehensive set of medical and legal documents.`;
}

export function buildPacketSelectorUserPrompt(
  hearingInfo: string,
  folderDetails: string,
  knowledgeRules: string,
  userInstructions: string,
): string {
  const parts = [`## Hearing Information\n${hearingInfo}`];
  if (knowledgeRules) {
    parts.push(`## Evidence Packet Rules (from Practice Knowledge)\n${knowledgeRules}`);
  }
  parts.push(`## Available Documents\n${folderDetails}`);
  if (userInstructions) {
    parts.push(`## User Instructions\n${userInstructions}`);
  }
  parts.push("Select and order the documents for this evidence packet.");
  return parts.join("\n\n");
}

// ============================================================================
// Document Generation: Research Question Builder
// ============================================================================

const DOC_TYPE_RESEARCH_QUESTIONS: Record<string, string> = {
  demand_letter:
    "Compile all facts needed to draft a demand letter: injuries and diagnoses, treatment timeline, medical charges and balances, liability facts, insurance coverage details (first-party, third-party, policy limits), client demographics, and any settlement demands or offers.",
  case_memo:
    "Compile a comprehensive case overview: client information, accident details, injuries and treatment, medical providers and charges, insurance information, case phase and status, outstanding issues, and key evidence.",
  settlement:
    "Compile all financial data for settlement calculation: medical charges by provider, outstanding balances, liens, insurance payments, attorney fee percentage, case costs, and any prior settlement offers.",
  general_letter:
    "Compile relevant case facts, party information, and key dates needed to draft correspondence related to this case.",
  decision_order:
    "Compile all facts for a workers' compensation decision: hearing details, issues in dispute, witness testimony, exhibits, medical evidence, applicable statutes, and findings of fact.",
};

export function getDocResearchQuestion(
  docType: string,
  userInstructions: string,
): string {
  const base = DOC_TYPE_RESEARCH_QUESTIONS[docType] || DOC_TYPE_RESEARCH_QUESTIONS.case_memo;
  return userInstructions
    ? `${base}\n\nAdditional focus: ${userInstructions}`
    : base;
}

// ============================================================================
// Document Generation: Compose
// ============================================================================

export function buildDensityComposePrompt(
  docType: string,
  knowledge: string,
  firmContext: string,
): string {
  return `You are composing a formal legal document for a personal injury case.
Draft a complete, filing-ready ${getDocTypeLabel(docType)} from the provided research and template.

${firmContext}

Practice knowledge:
${knowledge || "(none available)"}

Document-specific requirements:
${getDocTypeInstructions(docType)}

Drafting rules:
- Follow template structure where provided.
- Ground factual statements in the supplied research evidence.
- For missing required facts, insert [VERIFY: ...] placeholders.
- Produce a complete filing-ready draft in one response.
- Output markdown only (no code fences, no JSON).`;
}

export function buildDensityComposeUserPrompt(
  researchMemory: string,
  templateContext: string,
  userInstructions: string,
  caseContext: string,
): string {
  const parts = [
    `## Research Findings\n${researchMemory}`,
    `## Case Context\n${caseContext}`,
  ];
  if (templateContext) {
    parts.push(`## Template\n${templateContext}`);
  }
  if (userInstructions) {
    parts.push(`## User Instructions\n${userInstructions}`);
  }
  parts.push("Draft the complete document now.");
  return parts.join("\n\n");
}

// ============================================================================
// Helpers
// ============================================================================

function getDocTypeLabel(docType: string): string {
  const labels: Record<string, string> = {
    demand_letter: "demand letter",
    case_memo: "case memorandum",
    settlement: "settlement calculation",
    general_letter: "letter",
    decision_order: "workers' compensation Decision and Order",
  };
  return labels[docType] || "document";
}

function getDocTypeInstructions(docType: string): string {
  const instructions: Record<string, string> = {
    demand_letter: `- Include all elements of a PI demand letter: liability, injuries, treatment, damages, demand amount.
- Present medical charges in a clear table format.
- Cite specific evidence for each claim.
- End with a clear demand amount and deadline.`,
    case_memo: `- Organize into standard sections: Case Overview, Liability, Injuries & Treatment, Damages, Insurance, Assessment.
- Be thorough but concise.
- Flag open questions and next steps.`,
    settlement: `- Present a clear disbursement breakdown.
- Include: gross settlement, attorney fees, costs, liens, net to client.
- Show all calculations transparently.`,
    general_letter: `- Professional tone appropriate for legal correspondence.
- Clear purpose stated in opening paragraph.
- Include relevant case reference numbers.`,
    decision_order: `- Follow WC Decision & Order format.
- Include: Appearances, Issues, Findings of Fact, Conclusions of Law, Order.
- Cite applicable statutes and case law.`,
  };
  return instructions[docType] || "Follow standard legal document format.";
}

// ============================================================================
// Meta-Index Summary Builder
// ============================================================================

/**
 * Flatten a value into a compact plaintext string.
 * Arrays → comma-separated, objects → "key: value; key: value", primitives → String().
 */
function flattenValueCompact(val: any): string {
  if (val === null || val === undefined) return "";
  if (Array.isArray(val)) return val.map(flattenValueCompact).filter(Boolean).join(", ");
  if (typeof val === "object") {
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${flattenValueCompact(v)}`)
      .filter((s) => s.length > 2)
      .join("; ");
  }
  return String(val);
}

/**
 * Build a narrative routing profile for a folder.
 * Produces a dense, LLM-readable summary: date range, document types,
 * key entities, and narrative fact summary — not just field names.
 */
function buildFolderRoutingProfile(name: string, folder: any): string {
  const parts: string[] = [];

  // Date range
  const dr = folder.date_range;
  if (dr?.earliest && dr?.latest) {
    parts.push(`${dr.earliest} to ${dr.latest}`);
  }

  // Document types
  const types = folder.types?.join(", ");
  if (types) parts.push(`Types: ${types}`);

  // Narrative facts — include values, not just keys
  const facts = folder.facts || {};
  const factEntries = Object.entries(facts);
  if (factEntries.length > 0) {
    // Show up to 12 key-value facts
    const factLines = factEntries.slice(0, 12).map(([k, v]) => {
      const val = flattenValueCompact(v);
      // Truncate very long values
      return val.length > 120 ? `${k}: ${val.slice(0, 120)}...` : `${k}: ${val}`;
    });
    parts.push(`Key data: ${factLines.join("; ")}`);
  }

  return `- **${name}** (${folder.file_count} files): ${parts.join(". ")}`;
}

/**
 * Build a compact summary of the meta-index for routing prompts.
 * Produces narrative routing profiles — dense, LLM-readable descriptions
 * of each folder's contents with date ranges, document types, and key facts.
 */
export function buildMetaIndexSummary(
  metaIndex: Record<string, any>,
): string {
  const folders = metaIndex?.folders || {};
  const lines: string[] = [];

  if (metaIndex?.case_name) {
    lines.push(`Case: ${metaIndex.case_name}`);
  }
  if (metaIndex?.case_phase) {
    lines.push(`Phase: ${metaIndex.case_phase}`);
  }
  lines.push(`${metaIndex?.document_count || 0} documents across ${metaIndex?.folder_count || Object.keys(folders).length} folders`);

  // Global dataset summary if available
  const summary = metaIndex?.summary || {};
  if (Object.keys(summary).length > 0) {
    const summaryText = flattenValueCompact(summary);
    if (summaryText) {
      lines.push(`\nCase overview: ${summaryText}`);
    }
  }
  lines.push("");

  for (const [name, folder] of Object.entries(folders) as [string, any][]) {
    lines.push(buildFolderRoutingProfile(name, folder));
  }

  return lines.join("\n");
}
