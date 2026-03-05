/**
 * Persistent Memory System
 *
 * Two-layer memory for retaining knowledge across conversations:
 * - Layer 1: Always-loaded JSON files (case + firm level)
 * - Layer 2: On-demand archive recall via Groq
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { groqChat, groqChatJson } from "./groq-chat-client";
import {
  buildMemoryExtractionPrompt,
  buildArchiveRouterPrompt,
  buildArchiveRelevancePrompt,
  buildBatchExtractorUserPrompt,
  buildExtractorPrompt,
} from "./density-prompts";
import { resolveFirmRoot } from "./year-mode";

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
  id: string;
  content: string;
  category: "fact" | "preference" | "instruction" | "correction";
  source: "auto" | "user";
  createdAt: string;
  sourceConversation?: string;
}

export interface CaseMemory {
  version: 1;
  lastUpdated: string;
  facts: MemoryEntry[];
}

export interface FirmMemory {
  version: 1;
  lastUpdated: string;
  preferences: MemoryEntry[];
}

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
}

// ============================================================================
// Budget Constants
// ============================================================================

const CASE_MEMORY_BUDGET = 12_000; // ~12KB
const FIRM_MEMORY_BUDGET = 8_000;  // ~8KB

// ============================================================================
// Load Memory
// ============================================================================

function caseMemoryPath(caseFolder: string): string {
  return join(caseFolder, ".ai_tool", "persistent_memory.json");
}

function firmMemoryPath(caseFolder: string): string {
  const firmRoot = resolveFirmRoot(caseFolder);
  return join(firmRoot, ".ai_tool", "firm_memory.json");
}

export async function loadCaseMemory(caseFolder: string): Promise<CaseMemory> {
  try {
    const raw = await readFile(caseMemoryPath(caseFolder), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), facts: [] };
  }
}

export async function loadFirmMemory(caseFolder: string): Promise<FirmMemory> {
  try {
    const raw = await readFile(firmMemoryPath(caseFolder), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), preferences: [] };
  }
}

/**
 * Format memory entries as text for prompt injection.
 */
function formatEntries(entries: MemoryEntry[], label: string): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- [${e.category}] ${e.content}`);
  return `## ${label}\n${lines.join("\n")}`;
}

/**
 * Load both firm and case memory, formatted for prompt injection.
 * Firm memory is listed first (higher priority).
 */
export async function loadPersistentMemory(caseFolder: string): Promise<string> {
  const [firmMem, caseMem] = await Promise.all([
    loadFirmMemory(caseFolder),
    loadCaseMemory(caseFolder),
  ]);

  const parts: string[] = [];
  const firmText = formatEntries(firmMem.preferences, "Firm Preferences & Instructions");
  if (firmText) parts.push(firmText);

  const caseText = formatEntries(caseMem.facts, "Case Memory");
  if (caseText) parts.push(caseText);

  return parts.join("\n\n");
}

// ============================================================================
// Save Memory
// ============================================================================

export async function addMemoryEntry(
  caseFolder: string,
  entry: Omit<MemoryEntry, "id" | "createdAt">,
  scope: "case" | "firm",
): Promise<void> {
  const now = new Date().toISOString();
  const fullEntry: MemoryEntry = {
    ...entry,
    id: `mem-${Date.now()}`,
    createdAt: now,
  };

  if (scope === "firm") {
    const mem = await loadFirmMemory(caseFolder);
    // Deduplicate — skip if identical content exists
    if (mem.preferences.some((e) => e.content === fullEntry.content)) return;
    mem.preferences.push(fullEntry);
    mem.lastUpdated = now;
    await compressIfOverBudget(mem.preferences, FIRM_MEMORY_BUDGET);
    const p = firmMemoryPath(caseFolder);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(mem, null, 2));
  } else {
    const mem = await loadCaseMemory(caseFolder);
    if (mem.facts.some((e) => e.content === fullEntry.content)) return;
    mem.facts.push(fullEntry);
    mem.lastUpdated = now;
    await compressIfOverBudget(mem.facts, CASE_MEMORY_BUDGET);
    const p = caseMemoryPath(caseFolder);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(mem, null, 2));
  }
}

/**
 * Drop oldest entries when serialized size exceeds budget.
 */
async function compressIfOverBudget(entries: MemoryEntry[], budget: number): Promise<void> {
  while (JSON.stringify(entries).length > budget && entries.length > 1) {
    entries.shift(); // Remove oldest
  }
}

// ============================================================================
// Auto-Extraction at Archive Time
// ============================================================================

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function extractMemoriesFromConversation(
  caseFolder: string,
  messages: ChatMessage[],
  archiveId: string,
): Promise<void> {
  if (messages.length < 2) return;

  // Build a condensed conversation transcript (cap at ~20 messages)
  const transcript = messages
    .slice(-20)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  try {
    const result = await groqChatJson<{
      case_facts: Array<{ content: string; category: string }>;
      firm_preferences: Array<{ content: string; category: string }>;
    }>({
      messages: [
        { role: "system", content: buildMemoryExtractionPrompt() },
        { role: "user", content: transcript },
      ],
      maxTokens: 4000,
      temperature: 0.1,
      model: "llama-3.1-8b-instant",
    });

    const data = result.data;

    // Save case facts
    for (const fact of data.case_facts || []) {
      await addMemoryEntry(
        caseFolder,
        {
          content: fact.content,
          category: (fact.category as MemoryEntry["category"]) || "fact",
          source: "auto",
          sourceConversation: archiveId,
        },
        "case",
      );
    }

    // Save firm preferences
    for (const pref of data.firm_preferences || []) {
      await addMemoryEntry(
        caseFolder,
        {
          content: pref.content,
          category: (pref.category as MemoryEntry["category"]) || "preference",
          source: "auto",
          sourceConversation: archiveId,
        },
        "firm",
      );
    }

    console.log(
      `[memory] Extracted ${(data.case_facts || []).length} case facts, ${(data.firm_preferences || []).length} firm preferences from archive ${archiveId}`,
    );
  } catch (err) {
    console.error("[memory] Extraction failed:", err);
  }
}

// ============================================================================
// Layer 2: On-Demand Archive Recall
// ============================================================================

/**
 * Lightweight check: should we search archived conversations?
 */
export async function shouldSearchArchives(
  question: string,
  memory: string,
  persistentMemory: string,
  usage: UsageAccumulator,
): Promise<boolean> {
  const prompt = buildArchiveRelevancePrompt();
  try {
    const result = await groqChatJson<{ search: boolean; reasoning: string }>({
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Question: ${question}\n\nPersistent Memory:\n${persistentMemory || "(empty)"}\n\nDocument Memory:\n${memory ? memory.slice(0, 2000) : "(empty)"}`,
        },
      ],
      maxTokens: 500,
      temperature: 0.1,
      model: "llama-3.1-8b-instant",
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    console.log(`[memory] Archive relevance check: search=${result.data.search} — ${result.data.reasoning}`);
    return result.data.search === true;
  } catch (err) {
    console.warn("[memory] Archive relevance check failed:", err);
    return false;
  }
}

/**
 * Search archived conversations for relevant context.
 */
export async function searchArchives(
  caseFolder: string,
  question: string,
  usage: UsageAccumulator,
): Promise<string> {
  // Load archive summaries from document_index.json
  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  let archives: Array<{ id: string; summary: string; file: string; date: string }> = [];
  try {
    const raw = await readFile(indexPath, "utf-8");
    const index = JSON.parse(raw);
    archives = index.chat_archives || [];
  } catch {
    return "";
  }

  if (archives.length === 0) return "";

  // Route to relevant archives
  const archiveSummaries = archives
    .map((a) => `- ${a.id} (${a.date}): ${a.summary}`)
    .join("\n");

  const routeResult = await groqChatJson<{ selected_archives: string[]; reasoning: string }>({
    messages: [
      { role: "system", content: buildArchiveRouterPrompt(archiveSummaries) },
      { role: "user", content: `Question: ${question}` },
    ],
    maxTokens: 1000,
    temperature: 0.1,
    model: "llama-3.1-8b-instant",
  });
  usage.inputTokens += routeResult.usage.inputTokens;
  usage.outputTokens += routeResult.usage.outputTokens;

  const selectedIds = routeResult.data.selected_archives || [];
  if (selectedIds.length === 0) return "";

  console.log(`[memory] Archive router selected: ${selectedIds.join(", ")}`);

  // Load and extract from selected archives (max 3)
  const archivesToRead = archives
    .filter((a) => selectedIds.includes(a.id))
    .slice(0, 3);

  const archiveDocs: Array<{ name: string; content: string }> = [];
  for (const archive of archivesToRead) {
    try {
      const archivePath = join(caseFolder, ".ai_tool", archive.file);
      const raw = await readFile(archivePath, "utf-8");
      const data = JSON.parse(raw);
      const transcript = (data.messages || [])
        .slice(-20)
        .map((m: ChatMessage) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
        .join("\n");
      archiveDocs.push({ name: `Archive: ${archive.summary} (${archive.date})`, content: transcript });
    } catch {
      // Skip unreadable archives
    }
  }

  if (archiveDocs.length === 0) return "";

  // Extract relevant facts using batch extractor
  const extractResult = await groqChat({
    messages: [
      { role: "system", content: buildExtractorPrompt() },
      { role: "user", content: buildBatchExtractorUserPrompt(question, "", archiveDocs) },
    ],
    maxTokens: 4000,
    temperature: 0.1,
  });
  usage.inputTokens += extractResult.usage.inputTokens;
  usage.outputTokens += extractResult.usage.outputTokens;

  console.log(`[memory] Extracted ${extractResult.content.length} chars from ${archiveDocs.length} archives`);
  return extractResult.content || "";
}
