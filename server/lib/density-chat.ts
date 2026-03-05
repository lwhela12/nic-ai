/**
 * Density Chat Backend
 *
 * Alternative chat backend using density-style pipelines and Groq models.
 * No Anthropic API dependency — all LLM calls go through Groq gpt-oss-120b.
 *
 * Architecture:
 *   User message → Intent Classifier → Pipeline dispatch
 *   - "answer" → Q&A pipeline (route → plan → extract → answer)
 *   - "generate_document" → Density research + Groq compose
 *   - Other intents → dispatchAction() using existing tool executors
 *   - "clarify" → Return question to user
 */

import { readFile as fsReadFile, writeFile as fsWriteFileAsync, mkdir as fsMkdirAsync, unlink as fsUnlink } from "fs/promises";
import { getVfs } from "../lib/vfs";

// VFS-aware wrappers for case file operations
const readFile: typeof fsReadFile = ((...args: any[]) => (getVfs() as any).readFile(...args)) as any;
const writeFileAsync: typeof fsWriteFileAsync = ((...args: any[]) => (getVfs() as any).writeFile(...args)) as any;
const mkdirAsync: typeof fsMkdirAsync = ((...args: any[]) => (getVfs() as any).mkdir(...args)) as any;
const unlink: typeof fsUnlink = ((...args: any[]) => (getVfs() as any).unlink(...args)) as any;
import { join, dirname } from "path";

import { groqChat, groqChatJson } from "./groq-chat-client";
import {
  INTENT_TYPES,
  type ClassifiedIntent,
  buildIntentClassifierPrompt,
  buildRouterPrompt,
  buildRouterUserPrompt,
  buildPlannerPrompt,
  buildPlannerUserPrompt,
  buildExtractorPrompt,
  buildExtractorUserPrompt,
  buildBatchExtractorUserPrompt,
  buildAnswererPrompt,
  buildAnswererUserPrompt,
  buildMetaIndexSummary,
  getDocResearchQuestion,
  buildDensityComposePrompt,
  buildDensityComposeUserPrompt,
  buildPacketSelectorPrompt,
  buildPacketSelectorUserPrompt,
  buildMemoryCompressionPrompt,
  buildMemoryCompressionUserPrompt,
} from "./density-prompts";

import {
  loadPersistentMemory,
  addMemoryEntry,
  shouldSearchArchives,
  searchArchives,
} from "./memory";

import {
  executeTool,
  normalizeDocumentsInput,
  canonicalizePacketDocumentsFromIndex,
  inferHearingNumberFromDocs,
  extractHearingCore,
  normalizeServiceInput,
  type ChatMessage,
} from "./direct-chat";

import { buildDocumentIdFromPath } from "./document-id";

import {
  loadCaseIndex,
  buildCasePromptContext,
  loadNarrowedTemplates,
  applyComposeBudget,
  persistDraftContent,
  isDraftTooThin,
  buildFallbackDraftContent,
  loadFirmConfig,
  normalizeDocumentType,
  DEFAULT_COMPOSE_BUDGET,
  type DocumentType,
  type DocAgentPathContext,
} from "./doc-agent";

import { loadSectionsByIds } from "../routes/knowledge";
import { generateMetaIndex } from "./meta-index";

// Re-export for route compatibility
export type { ChatMessage };

// ============================================================================
// Types
// ============================================================================

export interface DensityChatEvent {
  type: string;
  content?: string;
  tool?: string;
  done?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  filePath?: string;
  previewPath?: string;
  docxPath?: string;
  view?: any;
  plan?: any;
  incomplete?: boolean;
  reason?: string;
}

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
}

// ============================================================================
// Token Budget
// ============================================================================

/** Max chars to include per folder detail in planner prompt */
const FOLDER_DETAIL_MAX_CHARS = 6000;
/** Token budget per extraction batch (chars / 4 ≈ tokens). ~100K tokens ≈ 400K chars. */
const EXTRACTION_BATCH_CHAR_BUDGET = 400_000;
/** Memory compression threshold — compress when memory exceeds this (chars) */
const MEMORY_COMPRESS_THRESHOLD = 60_000;
/** Sparse memory threshold — trigger raw fallback when memory is below this (chars) */
const SPARSE_MEMORY_THRESHOLD = 100;
/** Max chars per message when formatting history for prompts */
const HISTORY_MESSAGE_CAP = 300;
/** Max recent messages to include in history context */
const HISTORY_MESSAGE_LIMIT = 12;

// ============================================================================
// History Formatting
// ============================================================================

/**
 * Format recent conversation history as a concise block for prompt injection.
 * Returns empty string if no meaningful history exists.
 */
function formatHistoryForPrompt(history: ChatMessage[]): string {
  if (!history || history.length === 0) return "";

  const recent = history.slice(-HISTORY_MESSAGE_LIMIT);
  const lines: string[] = [];

  for (const msg of recent) {
    const role = msg.role === "user" ? "User" : "Assistant";
    let content = msg.content.trim();
    if (content.length > HISTORY_MESSAGE_CAP) {
      content = content.slice(0, HISTORY_MESSAGE_CAP) + "...";
    }
    lines.push(`${role}: ${content}`);
  }

  if (lines.length === 0) return "";

  return `## Recent Conversation\n${lines.join("\n")}`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Density chat — async generator with same yield signature as directChat().
 */
export async function* densityChat(
  caseFolder: string,
  message: string,
  history: ChatMessage[] = [],
  options?: { lockOwner?: string; lockDisplayName?: string },
): AsyncGenerator<DensityChatEvent> {
  const usage: UsageAccumulator = { inputTokens: 0, outputTokens: 0 };
  let resultFilePath: string | undefined;

  try {
    // Load meta-index and persistent memory in parallel
    const [metaIndex, persistentMemory] = await Promise.all([
      loadMetaIndex(caseFolder),
      loadPersistentMemory(caseFolder),
    ]);
    const metaIndexSummary = buildMetaIndexSummary(metaIndex);

    // Step 1: Classify intent (include persistent memory so classifier knows instructions)
    yield { type: "status", content: "Classifying intent..." };
    const intent = await classifyIntent(message, metaIndexSummary, history, usage, persistentMemory);
    console.log(`[density] Intent: ${intent.intent} (${intent.confidence}) — ${intent.reasoning}`);

    // Step 2: Dispatch based on intent
    let generator: AsyncGenerator<DensityChatEvent> | null = null;

    switch (intent.intent) {
      case "answer": {
        generator = runQAPipeline(caseFolder, intent.params.question || message, metaIndex, metaIndexSummary, usage, history, persistentMemory);
        break;
      }
      case "generate_document": {
        generator = densityGenerateDocument(
          caseFolder,
          intent.params.doc_type || "action_plan",
          intent.params.instructions || message,
          usage,
          persistentMemory,
        );
        break;
      }
      case "remember": {
        const content = intent.params.content || message;
        const scope = intent.params.scope === "firm" ? "firm" : "case";
        await addMemoryEntry(
          caseFolder,
          { content, category: "instruction", source: "user" },
          scope,
        );
        yield { type: "text", content: `Got it — I'll remember that${scope === "firm" ? " across all cases" : " for this case"}. "${content}"` };
        break;
      }
      case "clarify": {
        yield { type: "text", content: intent.params.question || "Could you clarify what you'd like me to do?" };
        break;
      }
      default: {
        generator = dispatchAction(caseFolder, intent, message, usage);
        break;
      }
    }

    if (generator) {
      for await (const event of generator) {
        // Capture filePath from sub-generators
        if (event.filePath) resultFilePath = event.filePath;
        yield event;
      }
    }

    yield {
      type: "done",
      done: true,
      filePath: resultFilePath,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[density] Error:", msg);
    yield { type: "text", content: `I encountered an error: ${msg}` };
    yield { type: "done", done: true, usage };
  }
}

// ============================================================================
// Intent Classifier
// ============================================================================

async function classifyIntent(
  message: string,
  metaIndexSummary: string,
  history: ChatMessage[],
  usage: UsageAccumulator,
  persistentMemory?: string,
): Promise<ClassifiedIntent> {
  let systemPrompt = buildIntentClassifierPrompt(metaIndexSummary);
  if (persistentMemory) {
    systemPrompt += `\n\n## Persistent Memory (instructions & preferences)\n${persistentMemory}`;
  }

  // Include recent history for context
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  // Add last 10 history messages for context
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: "user", content: message });

  let classified: ClassifiedIntent;
  try {
    const result = await groqChatJson<ClassifiedIntent>({
      messages,
      maxTokens: 16000,
      temperature: 0.1,
      model: "llama-3.1-8b-instant",
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    classified = result.data;
  } catch (err) {
    // JSON parse failure or API error — fall back to answer
    console.warn(`[density] Classifier error, falling back to answer:`, err);
    return {
      intent: "answer",
      confidence: 0.5,
      params: { question: message },
      reasoning: "Classifier failed, defaulting to Q&A",
    };
  }

  // Validate the intent is one we recognize
  const validIntents: Set<string> = new Set(INTENT_TYPES);
  if (!classified.intent || !validIntents.has(classified.intent)) {
    console.warn(`[density] Unknown intent "${classified.intent}", falling back to answer`);
    return {
      intent: "answer",
      confidence: classified.confidence || 0.5,
      params: { question: message },
      reasoning: `Classifier returned "${classified.intent}", defaulting to Q&A`,
    };
  }

  return classified;
}

// ============================================================================
// Q&A Pipeline: Route → Plan → Extract → Answer
// ============================================================================

async function* runQAPipeline(
  caseFolder: string,
  question: string,
  metaIndex: Record<string, any>,
  metaIndexSummary: string,
  usage: UsageAccumulator,
  history: ChatMessage[] = [],
  persistentMemory: string = "",
): AsyncGenerator<DensityChatEvent> {
  const formattedHistory = formatHistoryForPrompt(history);
  yield { type: "status", content: "Routing to relevant folders..." };

  // Step 1: Route — select relevant folders
  const routeResult = await groqChatJson<{ selected_folders: string[]; reasoning: string }>({
    messages: [
      { role: "system", content: buildRouterPrompt(metaIndexSummary) },
      { role: "user", content: buildRouterUserPrompt(question) },
    ],
    maxTokens: 16000,
    temperature: 0.1,
  });
  usage.inputTokens += routeResult.usage.inputTokens;
  usage.outputTokens += routeResult.usage.outputTokens;

  const selectedFolders = routeResult.data.selected_folders || [];
  console.log(`[density] Router selected ${selectedFolders.length} folders: ${selectedFolders.join(", ")}`);

  if (selectedFolders.length === 0) {
    yield { type: "text", content: "I couldn't find relevant folders in the case index for your question. The case may need to be indexed first." };
    return;
  }

  // Step 2: Plan — load folder details and decide which documents to read
  yield { type: "status", content: "Planning document reads..." };
  const folderDetails = await loadFolderDetails(caseFolder, selectedFolders);

  const planResult = await groqChatJson<{
    documents_to_read: Array<{ folder: string; filename: string; reason: string }>;
    requires_targeted_extraction?: boolean;
    reasoning: string;
  }>({
    messages: [
      { role: "system", content: buildPlannerPrompt() },
      { role: "user", content: buildPlannerUserPrompt(question, folderDetails, formattedHistory || undefined) },
    ],
    maxTokens: 16000,
    temperature: 0.1,
  });
  usage.inputTokens += planResult.usage.inputTokens;
  usage.outputTokens += planResult.usage.outputTokens;

  const docsToRead = planResult.data.documents_to_read || [];
  const skipExtraction = planResult.data.requires_targeted_extraction === false;
  console.log(`[density] Planner selected ${docsToRead.length} documents to read${skipExtraction ? " (skip extraction — summaries sufficient)" : ""}`);

  // Step 3: Extract — read documents in batches and accumulate memory
  let memory = "";

  if (docsToRead.length > 0 && !skipExtraction) {
    yield { type: "status", content: `Reading ${docsToRead.length} documents...` };

    // Load all document contents, tracking thin docs for potential raw fallback
    const loadedDocs: Array<{ name: string; content: string }> = [];
    const thinDocs: Array<{ folder: string; filename: string }> = [];
    for (const doc of docsToRead) {
      const content = await readDocumentContent(caseFolder, doc.folder, doc.filename);
      if (content) {
        loadedDocs.push({ name: doc.filename, content });
        if (content.length < 200) {
          thinDocs.push({ folder: doc.folder, filename: doc.filename });
        }
      } else {
        thinDocs.push({ folder: doc.folder, filename: doc.filename });
      }
    }

    // Batch documents by token budget
    const batches: Array<Array<{ name: string; content: string }>> = [];
    let currentBatch: Array<{ name: string; content: string }> = [];
    let currentBatchChars = 0;

    for (const doc of loadedDocs) {
      if (currentBatchChars + doc.content.length > EXTRACTION_BATCH_CHAR_BUDGET && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }
      currentBatch.push(doc);
      currentBatchChars += doc.content.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log(`[density] Processing ${loadedDocs.length} documents in ${batches.length} batch(es)${thinDocs.length > 0 ? ` (${thinDocs.length} thin)` : ""}`);

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (batches.length > 1) {
        yield { type: "status", content: `Extracting batch ${i + 1}/${batches.length} (${batch.length} docs)...` };
      }

      // Use batch prompt for multiple docs, single-doc prompt for one
      const userPrompt = batch.length === 1
        ? buildExtractorUserPrompt(question, memory, batch[0].content, batch[0].name)
        : buildBatchExtractorUserPrompt(question, memory, batch);

      // Free-form text extraction — no JSON wrapper
      const extractResult = await groqChat({
        messages: [
          { role: "system", content: buildExtractorPrompt() },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 16000,
        temperature: 0.1,
      });
      usage.inputTokens += extractResult.usage.inputTokens;
      usage.outputTokens += extractResult.usage.outputTokens;

      memory = extractResult.content || memory;

      // LLM-driven compression when memory exceeds threshold
      if (memory.length > MEMORY_COMPRESS_THRESHOLD && i < batches.length - 1) {
        console.log(`[density] Memory at ${memory.length} chars, compressing...`);
        yield { type: "status", content: "Compressing memory..." };
        const compressResult = await groqChat({
          messages: [
            { role: "system", content: buildMemoryCompressionPrompt() },
            { role: "user", content: buildMemoryCompressionUserPrompt(memory) },
          ],
          maxTokens: 16000,
          temperature: 0.1,
        });
        usage.inputTokens += compressResult.usage.inputTokens;
        usage.outputTokens += compressResult.usage.outputTokens;
        const compressed = compressResult.content;
        if (compressed && compressed.length < memory.length) {
          console.log(`[density] Compressed memory: ${memory.length} → ${compressed.length} chars`);
          memory = compressed;
        }
      }
    }

    // Raw document fallback — re-read files when extraction is sparse
    if (memory.length < SPARSE_MEMORY_THRESHOLD || thinDocs.length > 0) {
      yield { type: "status", content: "Re-reading raw documents for detail..." };
      memory = await rawDocumentFallback(caseFolder, question, memory, thinDocs, usage);
    }
  }

  // Always include folder details — they have dates and summaries for ALL files,
  // which is critical for questions like "most recent" even if the extractor
  // only read a subset deeply.
  const folderContext = `\n\n## All Files in Selected Folders (with dates)\n${folderDetails}`;
  if (!memory) {
    memory = folderContext;
  } else {
    memory += folderContext;
  }

  // Step 4: On-demand archive recall (Layer 2)
  let archiveContext = "";
  if (persistentMemory || memory) {
    try {
      const needsArchive = await shouldSearchArchives(question, memory, persistentMemory, usage);
      if (needsArchive) {
        yield { type: "status", content: "Searching archived conversations..." };
        archiveContext = await searchArchives(caseFolder, question, usage);
      }
    } catch (err) {
      console.warn("[density] Archive recall failed:", err);
    }
  }

  // Step 5: Answer — includes global dataset summary for birds-eye context
  yield { type: "status", content: "Composing answer..." };

  const firmRoot = dirname(caseFolder);
  const knowledge = await loadSectionsByIds(firmRoot);
  const caseContext = await buildCompactCaseContext(caseFolder);
  const datasetSummary = buildDatasetSummary(metaIndex);

  // Build full context: persistent memory (firm first) → dataset → archive recall → document memory
  const contextParts: string[] = [];
  if (persistentMemory) {
    contextParts.push(`## Persistent Memory\n${persistentMemory}`);
  }
  if (datasetSummary) {
    contextParts.push(`## Dataset Overview\n${datasetSummary}`);
  }
  if (archiveContext) {
    contextParts.push(`## Recalled from Prior Conversations\n${archiveContext}`);
  }
  contextParts.push(memory);
  const fullContext = contextParts.filter(Boolean).join("\n\n");

  const answerResult = await groqChat({
    messages: [
      { role: "system", content: buildAnswererPrompt(knowledge) },
      { role: "user", content: buildAnswererUserPrompt(question, fullContext, caseContext, formattedHistory || undefined) },
    ],
    maxTokens: 16000,
    temperature: 0.3,
  });
  usage.inputTokens += answerResult.usage.inputTokens;
  usage.outputTokens += answerResult.usage.outputTokens;

  yield { type: "text", content: answerResult.content };
}

// ============================================================================
// Document Generation — Density Research + Groq Compose
// ============================================================================

async function* densityGenerateDocument(
  caseFolder: string,
  docType: string,
  userInstructions: string,
  usage: UsageAccumulator,
  persistentMemory: string = "",
): AsyncGenerator<DensityChatEvent> {
  const firmRoot = dirname(caseFolder);
  const validDocType = validateDocType(docType);

  yield { type: "delegating", content: `Generating ${validDocType.replace(/_/g, " ")}...` };

  // Load case context and templates in parallel
  const [caseIndex, knowledge, firmConfig, narrowedTemplates] = await Promise.all([
    loadCaseIndex(caseFolder),
    loadSectionsByIds(firmRoot),
    loadFirmConfig(firmRoot),
    loadNarrowedTemplates(firmRoot, validDocType, userInstructions),
  ]);
  const caseContext = await buildCasePromptContext(caseFolder, caseIndex);

  // Phase 1: Density research — reuse Q&A pipeline with doc-specific question
  yield { type: "status", content: "Researching case documents..." };

  const researchQuestion = getDocResearchQuestion(validDocType, userInstructions);
  const metaIndex = await loadMetaIndex(caseFolder);
  const metaIndexSummary = buildMetaIndexSummary(metaIndex);

  // Route
  const routeResult = await groqChatJson<{ selected_folders: string[]; reasoning: string }>({
    messages: [
      { role: "system", content: buildRouterPrompt(metaIndexSummary) },
      { role: "user", content: buildRouterUserPrompt(researchQuestion) },
    ],
    maxTokens: 16000,
    temperature: 0.1,
  });
  usage.inputTokens += routeResult.usage.inputTokens;
  usage.outputTokens += routeResult.usage.outputTokens;

  const selectedFolders = routeResult.data.selected_folders || Object.keys(metaIndex?.folders || {});

  // Plan
  const folderDetails = await loadFolderDetails(caseFolder, selectedFolders);
  const planResult = await groqChatJson<{
    documents_to_read: Array<{ folder: string; filename: string; reason: string }>;
    reasoning: string;
  }>({
    messages: [
      { role: "system", content: buildPlannerPrompt() },
      { role: "user", content: buildPlannerUserPrompt(researchQuestion, folderDetails) },
    ],
    maxTokens: 16000,
    temperature: 0.1,
  });
  usage.inputTokens += planResult.usage.inputTokens;
  usage.outputTokens += planResult.usage.outputTokens;

  const docsToRead = planResult.data.documents_to_read || [];

  // Extract — batched
  let researchMemory = "";
  if (docsToRead.length > 0) {
    yield { type: "status", content: `Reading ${docsToRead.length} documents for research...` };

    // Load all document contents, tracking thin docs for potential raw fallback
    const loadedDocs: Array<{ name: string; content: string }> = [];
    const thinDocs: Array<{ folder: string; filename: string }> = [];
    for (const doc of docsToRead) {
      const content = await readDocumentContent(caseFolder, doc.folder, doc.filename);
      if (content) {
        loadedDocs.push({ name: doc.filename, content });
        if (content.length < 200) {
          thinDocs.push({ folder: doc.folder, filename: doc.filename });
        }
      } else {
        thinDocs.push({ folder: doc.folder, filename: doc.filename });
      }
    }

    // Batch documents by token budget
    const batches: Array<Array<{ name: string; content: string }>> = [];
    let currentBatch: Array<{ name: string; content: string }> = [];
    let currentBatchChars = 0;

    for (const doc of loadedDocs) {
      if (currentBatchChars + doc.content.length > EXTRACTION_BATCH_CHAR_BUDGET && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }
      currentBatch.push(doc);
      currentBatchChars += doc.content.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (batches.length > 1) {
        yield { type: "status", content: `Extracting batch ${i + 1}/${batches.length} (${batch.length} docs)...` };
      }

      const userPrompt = batch.length === 1
        ? buildExtractorUserPrompt(researchQuestion, researchMemory, batch[0].content, batch[0].name)
        : buildBatchExtractorUserPrompt(researchQuestion, researchMemory, batch);

      const extractResult = await groqChat({
        messages: [
          { role: "system", content: buildExtractorPrompt() },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 16000,
        temperature: 0.1,
      });
      usage.inputTokens += extractResult.usage.inputTokens;
      usage.outputTokens += extractResult.usage.outputTokens;

      researchMemory = extractResult.content || researchMemory;

      // LLM-driven compression when memory exceeds threshold
      if (researchMemory.length > MEMORY_COMPRESS_THRESHOLD && i < batches.length - 1) {
        const compressResult = await groqChat({
          messages: [
            { role: "system", content: buildMemoryCompressionPrompt() },
            { role: "user", content: buildMemoryCompressionUserPrompt(researchMemory) },
          ],
          maxTokens: 16000,
          temperature: 0.1,
        });
        usage.inputTokens += compressResult.usage.inputTokens;
        usage.outputTokens += compressResult.usage.outputTokens;
        const compressed = compressResult.content;
        if (compressed && compressed.length < researchMemory.length) {
          researchMemory = compressed;
        }
      }
    }

    // Raw document fallback — re-read files when extraction is sparse
    if (researchMemory.length < SPARSE_MEMORY_THRESHOLD || thinDocs.length > 0) {
      yield { type: "status", content: "Re-reading raw documents for detail..." };
      researchMemory = await rawDocumentFallback(caseFolder, researchQuestion, researchMemory, thinDocs, usage);
    }
  }

  if (!researchMemory) {
    researchMemory = `Case context from index:\n${caseContext}`;
  }

  // Phase 2: Compose with Groq
  yield { type: "status", content: "Drafting document..." };

  const firmContextParts = [
    firmConfig.firmName ? `Firm: ${firmConfig.firmName}` : "",
    firmConfig.address ? `Address: ${firmConfig.address}` : "",
    firmConfig.phone ? `Phone: ${firmConfig.phone}` : "",
  ].filter(Boolean);
  if (persistentMemory) {
    firmContextParts.push(`\n${persistentMemory}`);
  }
  const firmContext = firmContextParts.join("\n");

  // Apply budget constraints
  const budgeted = applyComposeBudget(
    DEFAULT_COMPOSE_BUDGET,
    userInstructions,
    caseContext,
    researchMemory,
    narrowedTemplates.context,
    knowledge,
  );

  const composeResult = await groqChat({
    messages: [
      {
        role: "system",
        content: buildDensityComposePrompt(validDocType, budgeted.knowledge, firmContext),
      },
      {
        role: "user",
        content: buildDensityComposeUserPrompt(
          budgeted.researchPacket,
          budgeted.templateContext,
          budgeted.userPrompt,
          budgeted.caseContext,
        ),
      },
    ],
    maxTokens: 16000,
    temperature: 0.3,
  });
  usage.inputTokens += composeResult.usage.inputTokens;
  usage.outputTokens += composeResult.usage.outputTokens;

  let draftContent = composeResult.content;

  // Quality gate
  const thinCheck = isDraftTooThin(draftContent, validDocType);
  if (thinCheck.thin) {
    console.warn(`[density] Draft too thin: ${thinCheck.reason}`);
    draftContent = buildFallbackDraftContent(
      validDocType,
      userInstructions,
      researchMemory,
      thinCheck.reason,
    );
  }

  // Persist draft
  yield { type: "status", content: "Saving draft..." };
  const pathContext: DocAgentPathContext = { clientSlug: null, registry: null, yearSources: [] };
  const persistResult = await persistDraftContent(
    caseFolder,
    firmRoot,
    validDocType,
    pathContext,
    draftContent,
  );

  yield {
    type: "text",
    content: persistResult.filePath
      ? `I've drafted your ${validDocType.replace(/_/g, " ")}. ${persistResult.result}`
      : persistResult.result,
    filePath: persistResult.filePath,
  };
}

// ============================================================================
// Evidence Packet Pipeline — 3-phase with user confirmation gates
//
// Phase 1 (build_packet):  Find hearings → present to user for confirmation
// Phase 2 (confirm_hearing): User confirmed hearing → select documents → present list
// Phase 3 (confirm_packet):  User confirmed documents → yield evidence_packet_plan → UI
// ============================================================================

const PENDING_PACKET_PATH = ".ai_tool/pending_packet_plan.json";

interface PendingPacketPlan {
  phase: "hearing_confirmed" | "documents_confirmed";
  hearing: {
    hearingNumber: string | null;
    hearingType: string;
    description: string;
  };
  proposedDocuments?: Array<{
    docId: string;
    path: string;
    title: string;
    date?: string;
    docType?: string;
    fileName: string;
  }>;
  caption?: {
    claimantName: string;
    claimNumber: string;
    hearingNumber?: string;
  };
  templateId?: string;
  createdAt: string;
}

/**
 * Phase 1: Find open hearings and present them for confirmation.
 */
async function* runBuildPacketPipeline(
  caseFolder: string,
  params: Record<string, any>,
  originalMessage: string,
  metaIndex: Record<string, any>,
  _metaIndexSummary: string,
  usage: UsageAccumulator,
): AsyncGenerator<DensityChatEvent> {
  yield { type: "status", content: "Searching for hearings..." };

  // Load case index
  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  let indexData: Record<string, any>;
  try {
    indexData = JSON.parse(await readFile(indexPath, "utf-8"));
  } catch {
    yield { type: "text", content: "No case index found. Please index the case first." };
    return;
  }

  const openHearings: any[] = metaIndex?.open_hearings || indexData?.open_hearings || [];
  const hearingNumberFromParams = typeof params.hearing_number === "string" ? params.hearing_number.trim() : "";
  const summary = indexData?.summary || metaIndex?.summary || {};

  // If user specified a hearing number, skip straight to phase 2
  if (hearingNumberFromParams) {
    const isAppeal = /-(RA|AP|APPEAL)/i.test(hearingNumberFromParams);
    const pending: PendingPacketPlan = {
      phase: "hearing_confirmed",
      hearing: {
        hearingNumber: hearingNumberFromParams,
        hearingType: isAppeal ? "AO" : "HO",
        description: `User-specified hearing ${hearingNumberFromParams}`,
      },
      createdAt: new Date().toISOString(),
    };
    await savePendingPlan(caseFolder, pending);

    // Go directly to document selection
    yield* runDocumentSelectionPhase(caseFolder, pending, metaIndex, indexData, summary, originalMessage, usage);
    return;
  }

  // Present open hearings for user selection
  if (openHearings.length === 0) {
    // No hearings found — save a generic plan and go to doc selection
    const pending: PendingPacketPlan = {
      phase: "hearing_confirmed",
      hearing: {
        hearingNumber: null,
        hearingType: "HO",
        description: "General evidence packet (no specific hearing found)",
      },
      createdAt: new Date().toISOString(),
    };
    await savePendingPlan(caseFolder, pending);

    yield {
      type: "text",
      content: "I don't see any open hearings on file, so I'll put together a general evidence packet. Let me pull the documents...",
    };

    yield* runDocumentSelectionPhase(caseFolder, pending, metaIndex, indexData, summary, originalMessage, usage);
    return;
  }

  if (openHearings.length === 1) {
    // Single hearing — present it for confirmation
    const hearing = openHearings[0];
    const hearingDesc = formatHearingForDisplay(hearing);
    const hearingNum = extractHearingNumberFromObj(hearing);
    const isAppeal = hearingNum ? /-(RA|AP|APPEAL)/i.test(hearingNum) : false;

    const pending: PendingPacketPlan = {
      phase: "hearing_confirmed",
      hearing: {
        hearingNumber: hearingNum,
        hearingType: isAppeal ? "AO" : "HO",
        description: hearingDesc,
      },
      createdAt: new Date().toISOString(),
    };
    await savePendingPlan(caseFolder, pending);

    yield {
      type: "text",
      content: `There's one open hearing on file — ${hearingDesc}. Want me to put together the evidence packet for this one?`,
    };
    return;
  }

  // Multiple hearings — list them all
  const hearingList = openHearings
    .map((h: any, i: number) => `${i + 1}. ${formatHearingForDisplay(h)}`)
    .join("\n");

  // Save the first hearing as default, user can specify which one
  const firstHearing = openHearings[0];
  const firstNum = extractHearingNumberFromObj(firstHearing);
  const pending: PendingPacketPlan = {
    phase: "hearing_confirmed",
    hearing: {
      hearingNumber: firstNum,
      hearingType: firstNum && /-(RA|AP|APPEAL)/i.test(firstNum) ? "AO" : "HO",
      description: formatHearingForDisplay(firstHearing),
    },
    createdAt: new Date().toISOString(),
  };
  await savePendingPlan(caseFolder, pending);

  yield {
    type: "text",
    content: `There are ${openHearings.length} open hearings on file:\n\n${hearingList}\n\nWhich one should I build the packet for?`,
  };
}

/**
 * Phase 2: User confirmed hearing → select and present documents.
 */
async function* confirmHearingPipeline(
  caseFolder: string,
  message: string,
  usage: UsageAccumulator,
): AsyncGenerator<DensityChatEvent> {
  const pending = await loadPendingPlan(caseFolder);
  if (!pending || pending.phase !== "hearing_confirmed") {
    yield { type: "text", content: "I don't have a pending hearing to confirm. Would you like me to search for hearings to build an evidence packet?" };
    return;
  }

  // Check if user specified a different hearing number in their message
  const hearingMatch = message.match(/(\d{5,}-\w+)/);
  if (hearingMatch) {
    const num = hearingMatch[1];
    pending.hearing.hearingNumber = num;
    pending.hearing.hearingType = /-(RA|AP|APPEAL)/i.test(num) ? "AO" : "HO";
    pending.hearing.description = `Hearing ${num}`;
  }

  // Check if user said a number like "2" to pick from the list
  const numMatch = message.match(/^#?(\d)$/);
  if (numMatch) {
    // They might be selecting from the list — but we only saved the first.
    // For now, proceed with what we have; a full implementation would re-read the hearings.
  }

  const metaIndex = await loadMetaIndex(caseFolder);
  let indexData: Record<string, any>;
  try {
    indexData = JSON.parse(await readFile(join(caseFolder, ".ai_tool", "document_index.json"), "utf-8"));
  } catch {
    yield { type: "text", content: "No case index found. Please index the case first." };
    return;
  }
  const summary = indexData?.summary || metaIndex?.summary || {};

  yield* runDocumentSelectionPhase(caseFolder, pending, metaIndex, indexData, summary, message, usage);
}

/**
 * Shared: select documents for a confirmed hearing and present list.
 */
async function* runDocumentSelectionPhase(
  caseFolder: string,
  pending: PendingPacketPlan,
  metaIndex: Record<string, any>,
  indexData: Record<string, any>,
  summary: Record<string, any>,
  userMessage: string,
  usage: UsageAccumulator,
): AsyncGenerator<DensityChatEvent> {
  const firmRoot = dirname(caseFolder);
  const metaIndexSummary = buildMetaIndexSummary(metaIndex);

  yield { type: "status", content: "Selecting documents for packet..." };

  // Build hearing context
  let hearingInfo = pending.hearing.description;
  if (pending.hearing.hearingNumber) {
    hearingInfo += `\nHearing number: ${pending.hearing.hearingNumber}`;
    hearingInfo += `\nHearing type: ${pending.hearing.hearingType}`;
  }
  if (summary.client) hearingInfo += `\nClaimant: ${summary.client}`;
  if (summary.claim_numbers) {
    const claimNums = Object.values(summary.claim_numbers).filter(Boolean);
    if (claimNums.length) hearingInfo += `\nClaim numbers: ${claimNums.join(", ")}`;
  }

  // Load all folder details
  const allFolders = Object.keys(metaIndex?.folders || indexData?.folders || {});
  const folderDetails = await loadFolderDetails(caseFolder, allFolders);

  // Load practice knowledge rules for evidence packets
  let knowledgeRules = "";
  try {
    const { findKnowledgeSectionsByTag } = await import("./direct-chat");
    const packetSections = await findKnowledgeSectionsByTag(firmRoot, "evidence_packet");
    for (const section of packetSections) {
      try {
        const sectionContent = await readFile(section.path, "utf-8");
        knowledgeRules += `### ${section.title}\n${sectionContent}\n\n`;
      } catch {
        if (section.preview) {
          knowledgeRules += `### ${section.title}\n${section.preview}\n\n`;
        }
      }
    }
  } catch {
    // No knowledge rules
  }

  // Ask Groq to select and order documents
  const selectorResult = await groqChatJson<{
    hearing_type: string;
    hearing_number: string | null;
    explanation: string;
    documents: Array<{ folder: string; filename: string; title: string; reason: string }>;
  }>({
    messages: [
      { role: "system", content: buildPacketSelectorPrompt() },
      { role: "user", content: buildPacketSelectorUserPrompt(hearingInfo, folderDetails, knowledgeRules, userMessage) },
    ],
    maxTokens: 16000,
    temperature: 0.1,
  });
  usage.inputTokens += selectorResult.usage.inputTokens;
  usage.outputTokens += selectorResult.usage.outputTokens;

  const selected = selectorResult.data;
  console.log(`[density] Packet selector: ${selected.documents?.length || 0} docs`);

  if (!selected.documents || selected.documents.length === 0) {
    yield { type: "text", content: "I couldn't identify documents to include. Please specify which documents should be in the packet." };
    return;
  }

  // Resolve documents against the index
  const docInputs = selected.documents.map((d) => ({
    path: `${d.folder}/${d.filename}`,
    title: d.title,
  }));
  const { documents: canonicalized, unresolvedSelectors } = canonicalizePacketDocumentsFromIndex(
    normalizeDocumentsInput(docInputs),
    indexData,
  );

  if (canonicalized.length === 0) {
    yield { type: "text", content: `None of the selected documents matched indexed files. Unresolved: ${unresolvedSelectors.join(", ")}` };
    return;
  }

  // Resolve hearing details
  const hearingInput = pending.hearing.hearingNumber || selected.hearing_number || "";
  const inferredHearing = hearingInput || inferHearingNumberFromDocs(
    canonicalized.map((doc) => ({ path: doc.path, title: doc.title, date: doc.date, docType: doc.docType })),
  );
  const hearingNumber = inferredHearing ? extractHearingCore(inferredHearing) : undefined;

  let hearingType = pending.hearing.hearingType || (selected.hearing_type || "").toUpperCase();
  if (!hearingType && hearingNumber) {
    hearingType = /-(RA|AP|APPEAL)/i.test(hearingNumber) ? "AO" : "HO";
  }
  if (!hearingType) hearingType = "HO";

  const templateId = hearingType === "AO" ? "ao-standard" : "ho-standard";

  const claimantName = summary.client || "";
  const claimNumbersObj = summary.claim_numbers || {};
  const firstClaimNumber = Object.values(claimNumbersObj).find((v: unknown) => typeof v === "string") as string || "";

  const proposedDocuments = canonicalized.map((doc) => ({
    docId: buildDocumentIdFromPath(doc.path),
    path: doc.path,
    title: doc.title,
    date: doc.date,
    docType: doc.docType,
    fileName: doc.path.split("/").pop() || doc.path,
  }));

  // Save plan with documents for phase 3
  pending.phase = "documents_confirmed" as any; // overwrite to next phase
  pending.proposedDocuments = proposedDocuments;
  pending.caption = {
    claimantName,
    claimNumber: firstClaimNumber,
    hearingNumber: hearingNumber || undefined,
  };
  pending.templateId = templateId;
  await savePendingPlan(caseFolder, pending);

  // Present document list
  let explanation = selected.explanation || "";
  if (unresolvedSelectors.length > 0) {
    explanation += `\n\nNote: ${unresolvedSelectors.length} document(s) could not be resolved from the index and were excluded.`;
  }

  const docList = proposedDocuments
    .map((d, i) => `${i + 1}. **${d.title}** — ${d.fileName}${d.date ? ` (${d.date})` : ""}`)
    .join("\n");

  yield {
    type: "text",
    content: `Here's what I'd include in the **${hearingType}** packet${hearingNumber ? ` for ${hearingNumber}` : ""}:\n\n${explanation}\n\n${docList}\n\nLook good, or do you want to add or remove anything?`,
  };
}

/**
 * Phase 3: User confirmed document list → yield evidence_packet_plan → UI.
 */
async function* confirmPacketPipeline(
  caseFolder: string,
): AsyncGenerator<DensityChatEvent> {
  const pending = await loadPendingPlan(caseFolder);

  if (!pending) {
    yield { type: "text", content: "I don't have a pending evidence packet plan. Would you like me to build one?" };
    return;
  }

  // If hearing is confirmed but documents aren't selected yet, this is a hearing confirmation
  if (pending.phase === "hearing_confirmed") {
    // This case is handled by confirm_hearing intent, but if confirm_packet fires
    // at this stage, treat it as hearing confirmation and auto-advance
    yield { type: "text", content: "Let me select the documents for this hearing..." };
    return;
  }

  if (!pending.proposedDocuments || pending.proposedDocuments.length === 0) {
    yield { type: "text", content: "The pending plan has no documents. Would you like me to build a new evidence packet?" };
    await cleanupPendingPlan(caseFolder);
    return;
  }

  // Clean up pending file
  await cleanupPendingPlan(caseFolder);

  yield { type: "status", content: "Opening packet creation..." };

  yield {
    type: "text",
    content: `Got it — opening the packet builder with ${pending.proposedDocuments.length} documents loaded. You can reorder, edit the front matter, and generate the PDF from there.`,
  };

  yield {
    type: "evidence_packet_plan",
    plan: {
      proposedDocuments: pending.proposedDocuments,
      caption: pending.caption,
      templateId: pending.templateId,
    },
  };
}

// ── Pending plan persistence helpers ─────────────────────────────────────────

async function savePendingPlan(caseFolder: string, plan: PendingPacketPlan): Promise<void> {
  const pendingPath = join(caseFolder, PENDING_PACKET_PATH);
  await mkdirAsync(join(caseFolder, ".ai_tool"), { recursive: true });
  await writeFileAsync(pendingPath, JSON.stringify(plan, null, 2));
}

async function loadPendingPlan(caseFolder: string): Promise<PendingPacketPlan | null> {
  try {
    const content = await readFile(join(caseFolder, PENDING_PACKET_PATH), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function cleanupPendingPlan(caseFolder: string): Promise<void> {
  try {
    await unlink(join(caseFolder, PENDING_PACKET_PATH));
  } catch {
    // Ignore
  }
}

// ── Hearing display helpers ──────────────────────────────────────────────────

function formatHearingForDisplay(hearing: any): string {
  if (typeof hearing === "string") return hearing;
  if (typeof hearing !== "object" || !hearing) return String(hearing);

  const caseNum = hearing.case_number || hearing.hearing_number || hearing.number || "";
  const level = hearing.hearing_level || hearing.type || hearing.hearing_type || "";
  const issue = hearing.issue || hearing.issues || "";
  const date = hearing.date || hearing.hearing_date || "";

  const parts: string[] = [];
  if (caseNum) parts.push(`Case **${caseNum}**`);
  if (level) parts.push(`${level} hearing`);
  if (issue) parts.push(`on the issue of ${issue}`);
  if (date) parts.push(`scheduled for ${date}`);

  if (parts.length > 0) return parts.join(", ");

  // Fallback for unexpected shapes
  return Object.entries(hearing)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function extractHearingNumberFromObj(hearing: any): string | null {
  if (typeof hearing === "string") {
    const m = hearing.match(/(\d{5,}-?\w*)/);
    return m ? m[1] : null;
  }
  if (typeof hearing !== "object" || !hearing) return null;
  // Check common field names
  for (const key of ["hearing_number", "hearingNumber", "number", "id", "hearing_id"]) {
    if (typeof hearing[key] === "string" && hearing[key].trim()) {
      return hearing[key].trim();
    }
  }
  // Try to extract from any string value
  for (const v of Object.values(hearing)) {
    if (typeof v === "string") {
      const m = v.match(/(\d{5,}-?\w+)/);
      if (m) return m[1];
    }
  }
  return null;
}

// ============================================================================
// Action Dispatch
// ============================================================================

async function* dispatchAction(
  caseFolder: string,
  intent: ClassifiedIntent,
  originalMessage: string,
  usage: UsageAccumulator,
): AsyncGenerator<DensityChatEvent> {
  const { intent: intentType, params } = intent;

  yield { type: "tool", tool: intentType, content: `Executing ${intentType}...` };

  try {
    let toolInput: Record<string, any> = {};

    switch (intentType) {
      case "update_index": {
        toolInput = {
          field_path: params.field_path,
          value: params.value,
        };
        break;
      }
      case "update_case_summary": {
        toolInput = params.updates || {};
        break;
      }
      case "resolve_conflict": {
        toolInput = {
          conflict_id: params.conflict_id,
          chosen_value: params.resolution,
        };
        break;
      }
      case "batch_resolve_conflicts": {
        toolInput = {
          resolutions: params.resolutions || [],
        };
        break;
      }
      case "rerun_hypergraph": {
        toolInput = {};
        break;
      }
      case "create_document_view": {
        toolInput = {
          name: params.name,
          description: params.description,
          documents: (params.paths || []).map((p: string) => ({ path: p })),
          sort_by: params.sort_by,
        };
        break;
      }
      case "read_document": {
        toolInput = {
          path: params.path,
          question: params.question,
        };
        break;
      }
      case "clarify_documents": {
        // Map intent to the actual tool name
        const contextResult = await executeTool("get_context_questions", {}, caseFolder);
        yield { type: "text", content: contextResult };
        return;
      }
      default: {
        // Shouldn't reach here since classifier validation falls back to "answer",
        // but just in case — treat as a question
        const fallbackResult = await executeTool(intentType, toolInput, caseFolder);
        yield { type: "text", content: fallbackResult };
        return;
      }
    }

    const result = await executeTool(intentType, toolInput, caseFolder);

    // Try to parse JSON results for structured responses
    try {
      const parsed = JSON.parse(result);
      if (parsed.error) {
        yield { type: "text", content: `Error: ${parsed.error}` };
      } else if (parsed.view) {
        yield { type: "document_view", view: parsed.view };
        yield { type: "text", content: parsed.message || "Document view created." };
      } else if (parsed.plan) {
        yield { type: "evidence_packet_plan", plan: parsed.plan };
      } else {
        yield { type: "text", content: result };
      }
    } catch {
      // Plain text result
      yield { type: "text", content: result };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    yield { type: "text", content: `Error executing ${intentType}: ${msg}` };
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function loadMetaIndex(caseFolder: string): Promise<Record<string, any>> {
  try {
    const metaIndexPath = join(caseFolder, ".ai_tool", "meta_index.json");
    const content = await readFile(metaIndexPath, "utf-8");
    return JSON.parse(content);
  } catch {
    // Try to generate from document_index.json
    try {
      const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const indexData = JSON.parse(indexContent);
      return generateMetaIndex(indexData);
    } catch {
      return {};
    }
  }
}

/**
 * Load per-folder index details for the selected folders.
 * Each file includes a summary (key_info) so the planner can judge relevance
 * without reading the full document.
 */
async function loadFolderDetails(
  caseFolder: string,
  folderNames: string[],
): Promise<string> {
  const parts: string[] = [];

  for (const name of folderNames) {
    try {
      const indexPath = join(caseFolder, ".ai_tool", "indexes", `${name}.json`);
      const content = await readFile(indexPath, "utf-8");
      const folderIndex = JSON.parse(content);
      const files: any[] = folderIndex.files || [];

      // Sort files by date descending (most recent first)
      const sorted = [...files].sort((a, b) => {
        const da = a.date || "";
        const db = b.date || "";
        return db.localeCompare(da);
      });

      // Compute date range
      const dates = sorted.map((f: any) => f.date).filter(Boolean);
      const dateInfo = dates.length > 0
        ? ` | dates: ${dates[dates.length - 1]} to ${dates[0]}`
        : "";

      // Build compact listing — one line per file, always include summary
      const fileLines = sorted.map((f: any) => {
        const date = f.date ? `[${f.date}]` : "[no date]";
        const type = f.type ? ` (${f.type})` : "";
        // Always include key_info — the planner needs it to judge relevance
        let summary = f.key_info || "";
        if (summary.length > 150) summary = summary.slice(0, 150) + "...";
        const info = summary ? ` — ${summary}` : "";
        return `- ${date} ${f.filename || "unknown"}${type}${info}`;
      });

      let listing = `### ${name}\n${files.length} files${dateInfo}\n\n${fileLines.join("\n")}`;

      // Only truncate by shortening summaries, never by removing them entirely
      if (listing.length > FOLDER_DETAIL_MAX_CHARS) {
        const shortLines = sorted.map((f: any) => {
          const date = f.date ? `[${f.date}]` : "[no date]";
          const type = f.type ? ` (${f.type})` : "";
          let summary = f.key_info || "";
          if (summary.length > 60) summary = summary.slice(0, 60) + "...";
          const info = summary ? ` — ${summary}` : "";
          return `- ${date} ${f.filename || "unknown"}${type}${info}`;
        });
        listing = `### ${name}\n${files.length} files${dateInfo}\n\n${shortLines.join("\n")}`;
      }

      parts.push(listing);
    } catch {
      parts.push(`### ${name}\n(folder index not available)`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Flatten extracted_data into dense plaintext.
 * Arrays → comma-separated, objects → "key: value; key: value".
 * No JSON overhead — maximizes token efficiency.
 */
function flattenExtractedData(data: any, prefix = ""): string {
  if (data === null || data === undefined) return "";
  if (Array.isArray(data)) {
    return data.map((item) => flattenExtractedData(item)).filter(Boolean).join(", ");
  }
  if (typeof data === "object") {
    const entries = Object.entries(data)
      .map(([k, v]) => {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        const val = flattenExtractedData(v);
        return val ? `${fullKey}: ${val}` : "";
      })
      .filter(Boolean);
    return entries.join("; ");
  }
  return String(data);
}

/**
 * Read document content by folder and filename.
 * Returns dense plaintext — no JSON overhead.
 * Tries extracted data from index first, then falls back to raw file read.
 */
async function readDocumentContent(
  caseFolder: string,
  folder: string,
  filename: string,
): Promise<string | null> {
  // First try to get extracted data from the folder index
  try {
    const indexPath = join(caseFolder, ".ai_tool", "indexes", `${folder}.json`);
    const indexContent = await readFile(indexPath, "utf-8");
    const folderIndex = JSON.parse(indexContent);
    const file = folderIndex.files?.find((f: any) => f.filename === filename);
    if (file) {
      // Build a dense plaintext representation — no JSON
      const parts: string[] = [];
      if (file.type) parts.push(`Type: ${file.type}`);
      if (file.key_info) parts.push(`Summary: ${file.key_info}`);
      if (file.date) parts.push(`Date: ${file.date}`);
      if (file.user_context) parts.push(`User Context: ${file.user_context}`);
      if (file.extracted_data) {
        const flattened = flattenExtractedData(file.extracted_data);
        if (flattened) parts.push(flattened);
      }
      if (parts.length > 0) {
        return parts.join("\n");
      }
    }
  } catch {
    // Fall through
  }

  // Fallback: try to read the raw file
  try {
    const filePath = join(caseFolder, folder, filename);
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf" || ext === "docx") {
      const result = await executeTool("read_file", { path: `${folder}/${filename}` }, caseFolder);
      return result;
    }
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read raw document content, bypassing the index.
 * Uses executeTool("read_file") for PDF/DOCX, fs for text files.
 */
async function readRawDocumentContent(
  caseFolder: string,
  folder: string,
  filename: string,
): Promise<string | null> {
  try {
    const filePath = join(caseFolder, folder, filename);
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf" || ext === "docx") {
      return await executeTool("read_file", { path: `${folder}/${filename}` }, caseFolder);
    }
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Raw document fallback — re-read raw files for documents with thin/missing
 * extracted data, run one extraction pass, and return enriched memory.
 */
async function rawDocumentFallback(
  caseFolder: string,
  question: string,
  memory: string,
  thinDocs: Array<{ folder: string; filename: string }>,
  usage: UsageAccumulator,
): Promise<string> {
  if (thinDocs.length === 0) return memory;

  console.log(`[density] Raw fallback triggered for ${thinDocs.length} thin doc(s)`);

  // Re-read raw files
  const rawDocs: Array<{ name: string; content: string }> = [];
  for (const doc of thinDocs) {
    const content = await readRawDocumentContent(caseFolder, doc.folder, doc.filename);
    if (content && content.length > 0) {
      rawDocs.push({ name: doc.filename, content });
    }
  }

  if (rawDocs.length === 0) return memory;

  // Batch by existing budget
  const batches: Array<Array<{ name: string; content: string }>> = [];
  let currentBatch: Array<{ name: string; content: string }> = [];
  let currentBatchChars = 0;

  for (const doc of rawDocs) {
    if (currentBatchChars + doc.content.length > EXTRACTION_BATCH_CHAR_BUDGET && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }
    currentBatch.push(doc);
    currentBatchChars += doc.content.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // Run extraction on raw content
  let enrichedMemory = memory;
  for (const batch of batches) {
    const userPrompt = batch.length === 1
      ? buildExtractorUserPrompt(question, enrichedMemory, batch[0].content, batch[0].name)
      : buildBatchExtractorUserPrompt(question, enrichedMemory, batch);

    const extractResult = await groqChat({
      messages: [
        { role: "system", content: buildExtractorPrompt() },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 16000,
      temperature: 0.1,
    });
    usage.inputTokens += extractResult.usage.inputTokens;
    usage.outputTokens += extractResult.usage.outputTokens;

    enrichedMemory = extractResult.content || enrichedMemory;
  }

  return enrichedMemory;
}

/**
 * Build a compact case context string (summary + key facts).
 * Uses dense plaintext — no JSON.
 */
async function buildCompactCaseContext(caseFolder: string): Promise<string> {
  try {
    const metaIndex = await loadMetaIndex(caseFolder);
    const parts: string[] = [];

    if (metaIndex.case_name) parts.push(`Case: ${metaIndex.case_name}`);
    if (metaIndex.case_phase) parts.push(`Phase: ${metaIndex.case_phase}`);

    const summary = metaIndex.summary || {};
    if (Object.keys(summary).length > 0) {
      const flatSummary = Object.entries(summary)
        .map(([k, v]) => {
          const val = typeof v === "object" ? flattenExtractedData(v) : String(v);
          return `${k}: ${val}`;
        })
        .join("; ");
      parts.push(`Summary: ${flatSummary}`);
    }

    return parts.join("\n") || "No case context available.";
  } catch {
    return "No case context available.";
  }
}

/**
 * Build a global dataset summary — a narrative birds-eye view of the
 * entire case, synthesized from the meta-index. Gives the answerer
 * context beyond just the extracted memory.
 */
function buildDatasetSummary(metaIndex: Record<string, any>): string {
  const parts: string[] = [];

  if (metaIndex.case_name) parts.push(`Case: ${metaIndex.case_name}`);
  if (metaIndex.case_phase) parts.push(`Phase: ${metaIndex.case_phase}`);

  const docCount = metaIndex.document_count || 0;
  const folderCount = metaIndex.folder_count || Object.keys(metaIndex.folders || {}).length;
  parts.push(`${docCount} documents across ${folderCount} folders`);

  // Case summary narrative
  const summary = metaIndex.summary || {};
  if (Object.keys(summary).length > 0) {
    const flatSummary = Object.entries(summary)
      .map(([k, v]) => {
        const val = typeof v === "object" ? flattenExtractedData(v) : String(v);
        return `${k}: ${val}`;
      })
      .join("; ");
    parts.push(`Case overview: ${flatSummary}`);
  }

  // Folder overview — one line per folder
  const folders = metaIndex.folders || {};
  const folderLines: string[] = [];
  for (const [name, folder] of Object.entries(folders) as [string, any][]) {
    const types = folder.types?.join(", ") || "";
    const dr = folder.date_range;
    const dateStr = dr?.earliest && dr?.latest ? ` (${dr.earliest} to ${dr.latest})` : "";
    folderLines.push(`- ${name}: ${folder.file_count} files, ${types}${dateStr}`);
  }
  if (folderLines.length > 0) {
    parts.push(`\nDocument overview:\n${folderLines.join("\n")}`);
  }

  // Open hearings
  if (metaIndex.open_hearings?.length > 0) {
    const hearingLines = metaIndex.open_hearings.map((h: any) =>
      typeof h === "object" ? flattenExtractedData(h) : String(h)
    );
    parts.push(`\nOpen hearings: ${hearingLines.join("; ")}`);
  }

  return parts.join("\n");
}

function validateDocType(docType: string): DocumentType {
  return normalizeDocumentType(docType);
}
