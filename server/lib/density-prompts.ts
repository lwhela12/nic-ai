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
  "generate_document",
  "update_index",
  "update_case_summary",
  "resolve_conflict",
  "batch_resolve_conflicts",
  "rerun_hypergraph",
  "create_document_view",
  "read_document",
  "clarify_documents",
  "remember",
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
  return `You are an intent classifier for a personal/family/business assistant system.
Given a user message and case context, classify the intent and extract parameters.

Return JSON with these fields:
{
  "intent": one of ${JSON.stringify(INTENT_TYPES)},
  "confidence": 0.0 to 1.0,
  "params": intent-specific parameters (see below),
  "reasoning": brief explanation of classification
}

## Intent Definitions & Params

**answer** — User asks a question about the case, documents, or wants information.
params: { "question": "the user's question" }
Examples: "What are the total medical charges?", "When was the accident?", "Summarize the medical records"

**generate_document** — User wants to draft/write/create a formal document.
params: { "doc_type": "financial_summary"|"estate_checklist"|"medical_summary"|"care_plan"|"correspondence"|"meeting_minutes"|"action_plan"|"custom_document", "instructions": "any specific instructions" }
Examples: "Draft a financial summary", "Write meeting minutes", "Generate an action plan"

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

**clarify_documents** — User wants to review or provide context for flagged documents.
params: {}
Examples: "What documents need clarification?", "Show me the unclear documents", "Review the documents that need context", "Clarify docs"

**remember** — User wants the system to remember a fact, preference, or instruction across conversations.
params: { "content": "what to remember", "scope": "case"|"firm" }
Use "firm" scope for preferences that apply across all cases (tone, formatting, workflow preferences). Use "case" scope for facts specific to this case.
Examples: "Remember that the client prefers email", "Always use formal tone in documents", "Note that the accident date is actually March 5th"

**clarify** — Message is too vague or ambiguous to classify.
params: { "question": "what to ask the user" }
Examples: "Help me with the thing", "Do the stuff"

## Case Context
${metaIndexSummary}

## Rules
- Prefer "answer" for most informational questions — it handles analysis, summaries, and lookups.
- Only use "generate_document" when the user explicitly wants a formal document drafted.
- Use "clarify" only when genuinely ambiguous — most messages have clear intent.
- For "update_index", extract the field path and value from the message.
- If the user asks to "re-index" or "update the index", that's "rerun_hypergraph", not "update_index".`;
}

// ============================================================================
// Q&A Pipeline: Route
// ============================================================================

export function buildRouterPrompt(
  metaIndexSummary: string,
): string {
  return `You are a document router for a personal/family/business assistant workspace.
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
  return `You are a document planner for a personal/family/business assistant workspace.
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
- Select all documents that are likely relevant — there is no hard cap. For narrow factual lookups, 2-4 documents may suffice. For comprehensive overviews, history, or multi-topic analysis, select as many as needed (10-20+ is fine).
- If the folder summaries already contain enough information to answer the question, set "requires_targeted_extraction" to false and return an empty documents_to_read list. The answer stage can use the summaries directly.
- Prioritize documents whose summaries indicate relevance to the question.
- For historical questions (timeline, sequence of events, decision history), include ALL relevant documents — missing even one can cause incorrect sequencing.
- For questions about "most recent", "latest", or "newest" documents, prioritize the files with the most recent dates.`;
}

export function buildPlannerUserPrompt(
  question: string,
  folderDetails: string,
  history?: string,
): string {
  const parts: string[] = [];
  if (history) {
    parts.push(history);
  }
  parts.push(`Question: ${question}`);
  parts.push(`## Folder Details\n${folderDetails}`);
  parts.push("Select which documents need deeper reading to answer this question.");
  return parts.join("\n\n");
}

// ============================================================================
// Q&A Pipeline: Extract
// ============================================================================

export function buildExtractorPrompt(): string {
  return `You are an information extractor for a personal/family/business assistant workspace.
Given a question, existing accumulated context (memory), and new document content, extract and condense all relevant facts into an updated memory.

Respond ONLY with the highly condensed text summary — no JSON wrapper, no preamble.

## Rules
- MERGE new findings into existing memory — never discard previous findings.
- Condense naturally: combine related facts, remove redundancy, keep specific numbers/dates/names.
- Only cite documents you are reading in this batch as [filename.pdf]. If a document references another document that isn't being read (e.g., "requested forms," "see attached report"), note the reference but mark it as [referenced, not in file] — do not cite it as if it exists in the case.
- If contradictory facts appear, include both with their sources.
- Organize by topic (health, finances, legal, dates, parties, etc.) not by document.
- The output replaces the previous memory entirely — include everything important.
- Prioritize facts related to contested or uncertain issues when they are apparent from the question.`;
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
  return `You are an assistant analyst for personal/family/business workflows. Answer questions thoroughly and accurately based on the compiled case information.

${knowledge ? `## Practice Knowledge\n${knowledge}\n` : ""}
## Rules
- Ground all factual claims in the compiled research — cite sources as [document name].
- If information is incomplete, say what's known and what's missing.
- Use professional but accessible language.
- For domain-specific questions, provide relevant analysis informed by workspace knowledge.
- Format responses with clear structure — use headers, bullet points, and tables where appropriate.
- Be direct and thorough. Don't hedge unnecessarily when the evidence is clear.`;
}

export function buildAnswererUserPrompt(
  question: string,
  memory: string,
  caseContext: string,
  history?: string,
): string {
  const parts: string[] = [];
  if (history) {
    parts.push(history);
  }
  parts.push(`## Compiled Research\n${memory}`);
  parts.push(`## Case Context\n${caseContext}`);
  parts.push(`## Question\n${question}`);
  parts.push("Provide a thorough, well-cited answer.");
  return parts.join("\n\n");
}

// ============================================================================
// Legacy Packet Selection (Deprecated)
// ============================================================================

export function buildPacketSelectorPrompt(): string {
  return `Packet workflows are deprecated. Return JSON:
{
  "hearing_type": null,
  "hearing_number": null,
  "explanation": "Packet workflows are deprecated. Use create_document_view or generate_document.",
  "documents": []
}`;
}

export function buildPacketSelectorUserPrompt(
  hearingInfo: string,
  folderDetails: string,
  knowledgeRules: string,
  userInstructions: string,
): string {
  return `Packet workflows are deprecated. Use create_document_view or generate_document instead.

Hearing info (ignored): ${hearingInfo}
Knowledge rules (ignored): ${knowledgeRules}
Available documents (ignored): ${folderDetails}
User instructions (ignored): ${userInstructions}`;
}

// ============================================================================
// Document Generation: Research Question Builder
// ============================================================================

const DOC_TYPE_RESEARCH_QUESTIONS: Record<string, string> = {
  financial_summary:
    "Compile all financial inputs needed for a summary: income, expenses, balances, obligations, totals, assumptions, and outstanding unknowns.",
  estate_checklist:
    "Compile all estate-planning details: available documents, missing documents, responsible parties, and next actions.",
  medical_summary:
    "Compile medical facts: provider timeline, diagnoses, treatment details, medications, and follow-up needs.",
  care_plan:
    "Compile care-planning details: goals, support needs, tasks, owners, and target dates.",
  correspondence:
    "Compile contact facts, timeline context, and key requests needed to draft correspondence.",
  meeting_minutes:
    "Compile meeting context: attendees, decisions, open questions, and action items.",
  action_plan:
    "Compile tasks, priorities, owners, due dates, dependencies, and risks.",
  custom_document:
    "Compile the key facts, structure needs, and constraints required for the requested custom document.",
};

export function getDocResearchQuestion(
  docType: string,
  userInstructions: string,
): string {
  const base = DOC_TYPE_RESEARCH_QUESTIONS[docType] || DOC_TYPE_RESEARCH_QUESTIONS.action_plan;
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
  return `You are composing a formal support document.
Draft a complete ${getDocTypeLabel(docType)} from the provided research and template.

${firmContext}

Practice knowledge:
${knowledge || "(none available)"}

Document-specific requirements:
${getDocTypeInstructions(docType)}

Drafting rules:
- Follow template structure where provided.
- Ground factual statements in the supplied research evidence.
- For missing required facts, insert [VERIFY: ...] placeholders.
- Produce a complete draft in one response.
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
    financial_summary: "financial summary",
    estate_checklist: "estate checklist",
    medical_summary: "medical summary",
    care_plan: "care plan",
    correspondence: "correspondence document",
    meeting_minutes: "meeting minutes",
    action_plan: "action plan",
    custom_document: "custom document",
  };
  return labels[docType] || "document";
}

function getDocTypeInstructions(docType: string): string {
  const instructions: Record<string, string> = {
    financial_summary: `- Present totals and assumptions clearly.
- Show calculations transparently.
- Flag unknown values with [VERIFY: ...].`,
    estate_checklist: `- Use checklist formatting with status/owner fields.
- Separate complete, in-progress, and missing items.
- Include concrete next steps.`,
    medical_summary: `- Organize by timeline and provider.
- Include diagnosis/treatment summaries.
- Highlight pending follow-ups.`,
    care_plan: `- Include goals, tasks, owners, and due dates.
- Keep action language concise.
- Note dependencies and risks.`,
    correspondence: `- Use professional, clear communication style.
- State purpose and requested action early.
- Include relevant references and dates.`,
    meeting_minutes: `- Capture attendees, discussion outcomes, and decisions.
- Include explicit action items.
- Keep bullets concise and chronological.`,
    action_plan: `- Prioritize tasks and identify owners.
- Include due dates and dependencies.
- Summarize risks and blockers.`,
    custom_document: `- Follow user instructions and template structure.
- Use explicit headings and [VERIFY: ...] for missing details.
- Keep content actionable.`,
  };
  return instructions[docType] || "Follow a clear, structured document format.";
}

// ============================================================================
// Persistent Memory Prompts
// ============================================================================

/**
 * Prompt for auto-extracting memories from a conversation at archive time.
 */
export function buildMemoryExtractionPrompt(): string {
  return `You extract persistent memories from conversations. Analyze the conversation and extract:

1. **case_facts** — Facts specific to this case: corrections to data, discovered information, important dates, client details, case-specific instructions.
2. **firm_preferences** — Preferences that apply across all cases: formatting preferences, communication style, workflow instructions, tool preferences.

Return JSON:
{
  "case_facts": [
    { "content": "the fact itself", "category": "fact"|"correction"|"instruction" }
  ],
  "firm_preferences": [
    { "content": "the preference itself", "category": "preference"|"instruction" }
  ]
}

Rules:
- Only extract genuinely persistent information — skip transient discussion.
- Corrections override previous values: "The DOB is actually 01/15/1980" → correction.
- Instructions like "always do X" or "never do Y" → instruction.
- Keep each entry concise (1-2 sentences max).
- Return empty arrays if nothing worth remembering.
- Do NOT extract information that would already be in the document index (e.g., standard case fields).`;
}

/**
 * Prompt for routing to relevant archived conversations.
 */
export function buildArchiveRouterPrompt(archiveSummaries: string): string {
  return `You select which archived conversations might contain relevant context for the user's question.

## Available Archives
${archiveSummaries}

Return JSON:
{
  "selected_archives": ["archive-id-1", "archive-id-2"],
  "reasoning": "brief explanation"
}

Rules:
- Select 1-3 archives most likely to contain relevant information.
- If no archives seem relevant, return an empty array.
- Match based on the summary descriptions and the user's question topic.`;
}

/**
 * Lightweight check: should we search archived conversations?
 */
export function buildArchiveRelevancePrompt(): string {
  return `Determine if the user's question requires searching archived conversations.

Return JSON:
{
  "search": true/false,
  "reasoning": "brief explanation"
}

Search archives when:
- User references prior conversations: "we discussed", "last time", "you told me", "remember when"
- Persistent memory is empty/sparse AND the question implies prior context
- User asks about something not in documents or current memory

Do NOT search when:
- The question can be answered from documents and current memory alone
- It's a straightforward document query or action request
- Persistent memory already contains relevant information`;
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
