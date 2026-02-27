/**
 * Document Generation Agent
 *
 * Two-phase document generator (Haiku research + Sonnet compose) with
 * fallback-safe draft persistence. Receives case context, templates, and
 * practice knowledge to produce filing-ready drafts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, readdir, stat, appendFile } from "fs/promises";
import { join, relative as pathRelative, extname, resolve as pathResolve, sep } from "path";
import {
  resolveFirmRoot,
  getClientSlug,
  loadClientRegistry,
  resolveYearFilePath,
  type ClientRegistry,
} from "./year-mode";
import { execSync } from "child_process";
import { loadSectionsByIds } from "../routes/knowledge";
import { extractPdfText } from "./pdftotext";
import { extractTextFromDocx } from "./extract";
import { generateMetaIndex, buildMetaIndexPromptView } from "./meta-index";
import {
  markdownToHtml,
  htmlToDocx,
  markdownToHearingDecisionDocx,
  loadFirmInfo,
  type ExportOptions,
} from "./export";
import { renderDocxWithLibreOfficeWithRetry } from "./evidence-packet";

// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
let _anthropic: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_anthropic) {
    // Explicitly pass API key - env var reading may not work in bundled binary
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return _anthropic;
}

// Document types we can generate
export type DocumentType =
  | "demand_letter"
  | "case_memo"
  | "settlement"
  | "general_letter"
  | "decision_order";

export interface DocGenResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

const INDEX_SLICE_MAX_CHARS = 12000;
const WORKING_DOCS_REL_DIR = ".ai_tool/working-docs";
const DOC_GEN_TRACE_MAX_TEXT = 1600;
const DOC_AGENT_DEFAULT_TWO_PHASE_ENABLED = process.env.NODE_ENV !== "production";
const DOC_AGENT_TWO_PHASE_ENABLED = parseBooleanEnv(
  process.env.DOC_AGENT_TWO_PHASE,
  DOC_AGENT_DEFAULT_TWO_PHASE_ENABLED
);
const DOC_AGENT_RESEARCH_MODEL = "claude-haiku-4-5-20251001";
const DOC_AGENT_COMPOSE_MODEL = "claude-sonnet-4-5-20250929";

type ResearchPacketSectionKey =
  | "caseSnapshot"
  | "timeline"
  | "issuesToDecide"
  | "evidenceCitations"
  | "requiredPlaceholders"
  | "draftingConstraints";

const RESEARCH_SECTION_META: Array<{
  key: ResearchPacketSectionKey;
  label: string;
  maxLines: number;
}> = [
  { key: "caseSnapshot", label: "Case Snapshot", maxLines: 12 },
  { key: "timeline", label: "Timeline", maxLines: 12 },
  { key: "issuesToDecide", label: "Issues to Decide", maxLines: 10 },
  { key: "evidenceCitations", label: "Evidence and Citations", maxLines: 20 },
  { key: "requiredPlaceholders", label: "Required Placeholders", maxLines: 10 },
  { key: "draftingConstraints", label: "Drafting Constraints", maxLines: 10 },
];

interface ResearchPacketSectionState {
  lines: string[];
  seen: Set<string>;
  maxLines: number;
}

export interface ResearchPacket {
  sections: Record<ResearchPacketSectionKey, ResearchPacketSectionState>;
}

export interface DocGenOptions {
  researchMaxTurns: number;
  composeTools: "none";
  fallbackMode: "full_scaffold_verify";
}

export interface ComposeBudget {
  maxSystemChars: number;
  maxUserPromptChars: number;
  maxCaseContextChars: number;
  maxKnowledgeChars: number;
  maxTemplateChars: number;
  maxResearchPacketChars: number;
}

const DEFAULT_DOC_GEN_OPTIONS: DocGenOptions = {
  researchMaxTurns: 10,
  composeTools: "none",
  fallbackMode: "full_scaffold_verify",
};

export const DEFAULT_COMPOSE_BUDGET: ComposeBudget = {
  maxSystemChars: 28000,
  maxUserPromptChars: 5000,
  maxCaseContextChars: 28000,
  maxKnowledgeChars: 22000,
  maxTemplateChars: 18000,
  maxResearchPacketChars: 16000,
};

const RESEARCH_TOOL_NAMES = new Set(["read_file", "read_index_slice", "glob", "grep", "list_folder"]);

const DEFAULT_DRAFT_FILENAME: Record<DocumentType, string> = {
  demand_letter: "demand_letter.md",
  case_memo: "case_memo.md",
  settlement: "settlement_calculation.md",
  general_letter: "letter.md",
  decision_order: "decision_and_order.md",
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function getDocTypeDescription(docType: DocumentType): string {
  const docTypeDescriptions: Record<DocumentType, string> = {
    demand_letter: "a demand letter to the at-fault party's insurance carrier",
    case_memo: "an internal case memorandum summarizing the case",
    settlement: "a settlement calculation and disbursement breakdown",
    general_letter: "a professional letter related to the case",
    decision_order: "a workers' compensation hearing Decision & Order for filing",
  };
  return docTypeDescriptions[docType];
}

function getDocTypeSpecificInstructions(docType: DocumentType): string {
  const instructions: Record<DocumentType, string> = {
    demand_letter: `
Demand-letter specific requirements:
- Follow demand template language closely when available.
- Include provider-by-provider specials with totals.
- Make sure demand amount/policy-limits framing is explicitly stated.`,
    case_memo: `
Case-memo specific requirements:
- Include case posture, major facts, treatment summary, financial snapshot, and open issues.
- Keep it internal-facing and analytical.`,
    settlement: `
Settlement specific requirements:
- Show clear arithmetic for all inflows/outflows.
- Include assumptions and flags where figures are uncertain.`,
    general_letter: `
General-letter specific requirements:
- Keep formal business-letter formatting.
- Keep requests, deadlines, and asks explicit.`,
    decision_order: `
Decision & Order specific requirements:
- This is a post-hearing legal filing style document, not a letter.
- Use this core structure:
  1) Caption / case heading
  2) Introductory hearing/procedural paragraph(s)
  3) Exhibits admitted (if known)
  4) FINDINGS OF FACT (numbered)
  5) CONCLUSIONS OF LAW (numbered, statute/case citations when supported)
  6) ORDER (numbered decretal rulings tied to appealed issues)
  7) Signature / submission block (if requested)
- Ground every finding and legal conclusion in case documents/index data; do not invent facts, holdings, dates, or citations.
- If critical filing detail is missing (appeal no., claim no., hearing date, AO name), insert a clear [VERIFY: ...] placeholder rather than guessing.
- A post-save layout safety pass will normalize missing section numbering and add Claim/Hearing/DOI placeholders if omitted, but still draft these explicitly when known.
- Default draft filename for this type: decision_and_order.md`,
  };
  return instructions[docType];
}

function formatDraftName(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferDraftMetadata(docType: DocumentType): { type: string; targetPath: string } {
  switch (docType) {
    case "demand_letter":
      return { type: "demand", targetPath: "3P/3P Demand.pdf" };
    case "case_memo":
      return { type: "memo", targetPath: ".ai_tool/case_memo.pdf" };
    case "settlement":
      return { type: "settlement", targetPath: "Settlement/Settlement Memo.pdf" };
    case "general_letter":
      return { type: "letter", targetPath: "letter.pdf" };
    case "decision_order":
      return { type: "hearing_decision", targetPath: "Litigation/Decision and Order.pdf" };
    default:
      return { type: "document", targetPath: "document.pdf" };
  }
}

function mapDocTypeToExportType(docType: DocumentType): ExportOptions["documentType"] {
  switch (docType) {
    case "demand_letter":
      return "demand";
    case "case_memo":
      return "memo";
    case "settlement":
      return "settlement";
    case "general_letter":
      return "letter";
    case "decision_order":
      return "hearing_decision";
    default:
      return "generic";
  }
}

function sanitizeDraftFilename(rawFilename: unknown, docType: DocumentType): string {
  const fallback = DEFAULT_DRAFT_FILENAME[docType];
  const requested = typeof rawFilename === "string" ? rawFilename.trim() : "";
  let filename = requested
    ? requested.replace(/\\/g, "/").split("/").pop() || ""
    : "";

  if (!filename) {
    filename = fallback;
  }

  filename = filename
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+/, "");

  if (!filename) {
    filename = fallback;
  }

  if (extname(filename).toLowerCase() !== ".md") {
    filename = `${filename.replace(/\.[^.]*$/, "")}.md`;
  }

  return filename;
}

function cleanInlineMarkdownForMatch(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function stripOuterMarkdownFence(content: string): { content: string; changed: boolean } {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (!fenced) return { content, changed: false };
  return { content: fenced[1], changed: true };
}

function normalizeDecisionOrderMarkdown(content: string): { content: string; notes: string[] } {
  const notes: string[] = [];
  const normalizedLineEndings = content.replace(/\r/g, "");
  const lines = normalizedLineEndings.split("\n");

  const sectionRules: Array<{ label: string; numeral: string }> = [
    { label: "PROCEDURAL HISTORY", numeral: "I" },
    { label: "ISSUE PRESENTED", numeral: "II" },
    { label: "EXHIBITS ADMITTED", numeral: "III" },
    { label: "FINDINGS OF FACT", numeral: "IV" },
    { label: "CONCLUSIONS OF LAW", numeral: "V" },
    { label: "ORDER", numeral: "VI" },
    { label: "NOTICE OF APPEAL RIGHTS", numeral: "VII" },
    { label: "CERTIFICATE OF SERVICE", numeral: "VIII" },
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headingMatch = line.match(/^(\s{0,3}#{1,6}\s+)?(.*)$/);
    if (!headingMatch) continue;
    const prefix = headingMatch[1] || "";
    const body = headingMatch[2] || "";
    const cleanBody = cleanInlineMarkdownForMatch(body);
    const withoutNumeral = cleanBody.replace(/^[IVXLCDM]+\.\s*/i, "").trim().toUpperCase();
    const hasNumeral = /^[IVXLCDM]+\.\s+/i.test(cleanBody);
    const rule = sectionRules.find((entry) => entry.label === withoutNumeral);
    if (!rule || hasNumeral) continue;

    lines[i] = `${prefix || "### "}${rule.numeral}. ${rule.label}`;
    notes.push(`Added missing section numeral for "${rule.label}".`);
  }

  const hasProceduralHeading = lines.some((line) => {
    const clean = cleanInlineMarkdownForMatch(line).toUpperCase();
    return /^I\.\s*PROCEDURAL HISTORY\b/.test(clean);
  });

  if (!hasProceduralHeading) {
    const firstLaterSectionIdx = lines.findIndex((line) => {
      const clean = cleanInlineMarkdownForMatch(line).toUpperCase();
      return /^(II|III|IV|V|VI|VII|VIII)\.\s+(ISSUE PRESENTED|EXHIBITS ADMITTED|FINDINGS OF FACT|CONCLUSIONS OF LAW|ORDER|NOTICE OF APPEAL RIGHTS|CERTIFICATE OF SERVICE)\b/.test(clean);
    });

    const insertionIdx = firstLaterSectionIdx >= 0 ? firstLaterSectionIdx : lines.length;
    const insertionBlock = [
      "### I. PROCEDURAL HISTORY",
      "",
      "[VERIFY: Add procedural history section details.]",
      "",
    ];
    lines.splice(insertionIdx, 0, ...insertionBlock);
    notes.push("Inserted missing I. PROCEDURAL HISTORY placeholder block.");
  }

  const metadataRules: Array<{ label: string; regex: RegExp; placeholder: string }> = [
    { label: "Claim No.", regex: /^claim\s*no\.?\s*:/i, placeholder: "Claim No.: [VERIFY]" },
    { label: "Hearing No.", regex: /^hearing\s*no\.?\s*:/i, placeholder: "Hearing No.: [VERIFY]" },
    { label: "Date of Injury", regex: /^date\s*of\s*injury\s*:/i, placeholder: "Date of Injury: [VERIFY]" },
  ];

  const missingMetadata = metadataRules.filter((rule) =>
    !lines.some((line) => rule.regex.test(cleanInlineMarkdownForMatch(line)))
  );

  if (missingMetadata.length > 0) {
    const decisionHeadingIdx = lines.findIndex((line) => {
      const clean = cleanInlineMarkdownForMatch(line).toUpperCase();
      return /(?:HEARING|APPEALS)\s+OFFICER\s+DECISION\s*(?:&|AND)\s*ORDER/.test(clean)
        || /^DECISION\s*(?:&|AND)\s*ORDER/.test(clean);
    });

    const insertionIdx = decisionHeadingIdx >= 0 ? decisionHeadingIdx : 0;
    const metadataLines = missingMetadata.map((entry) => entry.placeholder);
    lines.splice(insertionIdx, 0, ...metadataLines, "");
    notes.push(`Inserted missing metadata placeholders: ${missingMetadata.map((entry) => entry.label).join(", ")}.`);
  }

  return {
    content: lines.join("\n"),
    notes,
  };
}

function applyDraftSafetyChecks(content: string, docType: DocumentType): { content: string; notes: string[] } {
  const notes: string[] = [];
  let working = content;

  const unfenced = stripOuterMarkdownFence(working);
  if (unfenced.changed) {
    working = unfenced.content;
    notes.push("Removed outer markdown code fence.");
  }

  if (docType === "decision_order") {
    const normalized = normalizeDecisionOrderMarkdown(working);
    working = normalized.content;
    notes.push(...normalized.notes);
  }

  return { content: working, notes };
}

function createResearchPacket(docType: DocumentType, userPrompt: string): ResearchPacket {
  const sections = Object.fromEntries(
    RESEARCH_SECTION_META.map((section) => [
      section.key,
      {
        lines: [],
        seen: new Set<string>(),
        maxLines: section.maxLines,
      },
    ])
  ) as Record<ResearchPacketSectionKey, ResearchPacketSectionState>;

  const packet: ResearchPacket = { sections };
  addResearchPacketLine(packet, "caseSnapshot", `Requested document type: ${docType.replace(/_/g, " ")}.`);
  addResearchPacketLine(packet, "draftingConstraints", "Draft in markdown; include [VERIFY: ...] placeholders for missing required details.");
  addResearchPacketLine(packet, "draftingConstraints", `User request focus: ${truncateForTrace(userPrompt, 320)}`);
  return packet;
}

function sanitizeResearchLine(value: string): string {
  return value
    .replace(/^[-*+\d.)\s]+/, "")
    .replace(/`{3,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResearchLineKey(value: string): string {
  return sanitizeResearchLine(value).toLowerCase();
}

function addResearchPacketLine(
  packet: ResearchPacket,
  section: ResearchPacketSectionKey,
  rawLine: string
): void {
  const line = sanitizeResearchLine(rawLine);
  if (!line) return;
  const target = packet.sections[section];
  if (!target) return;

  const key = normalizeResearchLineKey(line);
  if (!key) return;
  if (target.seen.has(key)) return;

  target.lines.push(line.length > 360 ? `${line.slice(0, 357)}...` : line);
  target.seen.add(key);

  while (target.lines.length > target.maxLines) {
    const removed = target.lines.shift();
    if (removed) {
      target.seen.delete(normalizeResearchLineKey(removed));
    }
  }
}

function resolveResearchSectionFromHeading(line: string): ResearchPacketSectionKey | null {
  const normalized = sanitizeResearchLine(line)
    .replace(/^#{1,6}\s+/, "")
    .replace(/[:\s]+$/, "")
    .toLowerCase();

  if (normalized === "case snapshot") return "caseSnapshot";
  if (normalized === "timeline") return "timeline";
  if (normalized === "issues to decide") return "issuesToDecide";
  if (normalized === "evidence and citations") return "evidenceCitations";
  if (normalized === "required placeholders") return "requiredPlaceholders";
  if (normalized === "drafting constraints") return "draftingConstraints";
  return null;
}

function mergeResearchPacketMarkdown(packet: ResearchPacket, markdown: string): void {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let currentSection: ResearchPacketSectionKey | null = null;
  let usedHeading = false;

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+/);
    if (headingMatch) {
      const next = resolveResearchSectionFromHeading(line);
      if (next) {
        currentSection = next;
        usedHeading = true;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    if (!currentSection) continue;
    addResearchPacketLine(packet, currentSection, trimmed);
  }

  if (!usedHeading) {
    const fallbackLines = lines
      .map((line) => sanitizeResearchLine(line))
      .filter((line) => line.length > 0)
      .slice(0, 6);
    for (const line of fallbackLines) {
      addResearchPacketLine(packet, "caseSnapshot", line);
    }
  }
}

function extractToolResultHighlights(
  result: string,
  docType: DocumentType,
  limit = 8
): string[] {
  const lines = result
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => sanitizeResearchLine(line))
    .filter((line) => line.length > 0 && !/^error[:\s]/i.test(line));

  const docKeywords: Record<DocumentType, RegExp> = {
    demand_letter: /(policy|carrier|demand|settlement|medical|specials|liability|limits?)/i,
    case_memo: /(summary|history|treatment|damages|issue|status|fact)/i,
    settlement: /(amount|lien|paid|balance|settlement|cost|fee|distribution)/i,
    general_letter: /(request|notice|deadline|correspondence|client|insurer)/i,
    decision_order: /(hearing|appeal|issue|finding|conclusion|order|claim\s*no|hearing\s*no|date of injury|exhibit|nrs|decision)/i,
  };
  const datePattern = /\b(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+(?:19|20)\d{2}\b/i;
  const moneyPattern = /\$\s?\d[\d,]*(?:\.\d{2})?/;

  const scored = lines.map((line) => {
    let score = 0;
    if (docKeywords[docType].test(line)) score += 8;
    if (datePattern.test(line)) score += 4;
    if (moneyPattern.test(line)) score += 3;
    if (line.length >= 30 && line.length <= 180) score += 2;
    if (/\[[^\]]+\]/.test(line)) score += 2;
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const dedup = new Set<string>();
  const selected: string[] = [];

  for (const item of scored) {
    if (selected.length >= limit) break;
    const key = normalizeResearchLineKey(item.line);
    if (dedup.has(key)) continue;
    dedup.add(key);
    selected.push(item.line);
  }

  return selected;
}

function updateResearchPacketFromToolResult(
  packet: ResearchPacket,
  toolName: string,
  toolInput: Record<string, any>,
  result: string,
  docType: DocumentType
): void {
  const source =
    typeof toolInput.path === "string" && toolInput.path.trim()
      ? toolInput.path.trim()
      : typeof toolInput.pattern === "string" && toolInput.pattern.trim()
        ? `${toolName}:${toolInput.pattern.trim()}`
        : toolName;

  const highlights = extractToolResultHighlights(result, docType, 8);
  if (highlights.length === 0) {
    if (/error|not found|failed/i.test(result)) {
      addResearchPacketLine(packet, "requiredPlaceholders", `[VERIFY: Source not resolved - ${source}]`);
    }
    return;
  }

  for (const line of highlights) {
    addResearchPacketLine(packet, "evidenceCitations", `${line} [source: ${source}]`);

    if (/\b(?:19|20)\d{2}[-/]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(line)) {
      addResearchPacketLine(packet, "timeline", line);
    }

    if (/\b(issue|appeal|question|dispute|whether)\b/i.test(line)) {
      addResearchPacketLine(packet, "issuesToDecide", line);
    } else {
      addResearchPacketLine(packet, "caseSnapshot", line);
    }

    if (/\bverify|missing|unknown|not provided\b/i.test(line)) {
      addResearchPacketLine(packet, "requiredPlaceholders", `[VERIFY: ${line}]`);
    }
  }
}

function renderResearchPacketMarkdown(packet: ResearchPacket): string {
  const chunks: string[] = ["# Research Packet"];

  for (const section of RESEARCH_SECTION_META) {
    chunks.push("");
    chunks.push(`## ${section.label}`);
    const lines = packet.sections[section.key].lines;
    if (lines.length === 0) {
      chunks.push("- [No confirmed information captured yet.]");
      continue;
    }
    for (const line of lines) {
      chunks.push(`- ${line}`);
    }
  }

  return chunks.join("\n");
}

function trimContentToBudget(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n...[${label} truncated ${content.length - maxChars} chars]`;
}

function capResearchPacketMarkdown(packetMarkdown: string, maxChars: number): string {
  if (packetMarkdown.length <= maxChars) return packetMarkdown;

  const lines = packetMarkdown.replace(/\r/g, "").split("\n");
  const trimmed: string[] = [];
  let evidenceMode = false;

  for (const line of lines) {
    if (/^##\s+evidence and citations\b/i.test(line)) {
      evidenceMode = true;
      trimmed.push(line);
      continue;
    }
    if (/^##\s+/i.test(line)) {
      evidenceMode = false;
      trimmed.push(line);
      continue;
    }

    if (evidenceMode && line.startsWith("- ")) {
      const text = line.slice(2);
      const reduced = text.length > 220 ? `${text.slice(0, 217)}...` : text;
      trimmed.push(`- ${reduced}`);
      continue;
    }

    trimmed.push(line);
  }

  const normalized = trimmed.join("\n");
  return trimContentToBudget(normalized, maxChars, "research packet");
}

function truncateForTrace(value: string, max = DOC_GEN_TRACE_MAX_TEXT): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

function safeTraceInput(input: Record<string, any>): Record<string, any> {
  const json = JSON.stringify(input ?? {});
  if (json.length <= DOC_GEN_TRACE_MAX_TEXT) return input ?? {};
  return {
    _truncated: true,
    preview: truncateForTrace(json),
  };
}

function toolUseSummary(toolUses: Array<{ id: string; name: string; input: Record<string, any> }>): Array<Record<string, any>> {
  return toolUses.map((tool) => ({
    id: tool.id,
    name: tool.name,
    input: safeTraceInput(tool.input),
  }));
}

async function appendDocGenTrace(tracePath: string, event: Record<string, any>): Promise<void> {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  await appendFile(tracePath, `${entry}\n`, "utf-8");
}

interface YearSourceRoot {
  prefix: string;
  year: string;
  root: string;
}

export interface DocAgentPathContext {
  clientSlug: string | null;
  registry: ClientRegistry | null;
  yearSources: YearSourceRoot[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isWithinPath(targetPath: string, basePath: string): boolean {
  const target = pathResolve(targetPath);
  const base = pathResolve(basePath);
  return target === base || target.startsWith(base + sep);
}

function normalizeToolPath(rawPath: unknown): string {
  return normalizeRelativePath(String(rawPath ?? ""))
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function mapClientFilesAliasToYearPath(inputPath: string): string {
  const match = inputPath.match(/^(\d{4})\s+client\s+files(?:\/(.*))?$/i);
  if (!match) return inputPath;
  const year = match[1];
  const rest = match[2] ? `/${match[2]}` : "";
  return `${year}${rest}`;
}

function buildRequestedPathCandidates(requestedPath: string): string[] {
  const normalized = normalizeToolPath(requestedPath);
  const mapped = mapClientFilesAliasToYearPath(normalized);
  const candidates = [normalized, mapped].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function buildDocAgentPathContext(
  caseFolder: string,
  firmRoot: string
): Promise<DocAgentPathContext> {
  const clientSlug = getClientSlug(caseFolder);
  if (!clientSlug) {
    return { clientSlug: null, registry: null, yearSources: [] };
  }

  const registry = await loadClientRegistry(firmRoot);
  const entry = registry?.clients?.[clientSlug];
  if (!registry || !entry) {
    return { clientSlug, registry: registry ?? null, yearSources: [] };
  }

  const yearSources: YearSourceRoot[] = [];
  for (const relFolder of entry.sourceFolders || []) {
    const prefix = String(relFolder).split("/")[0] || "";
    if (!prefix) continue;
    const yearMatch = prefix.match(/^(19|20)\d{2}/);
    const year = yearMatch ? yearMatch[0] : prefix;
    yearSources.push({
      prefix,
      year,
      root: pathResolve(firmRoot, relFolder),
    });
  }

  return { clientSlug, registry, yearSources };
}

function resolveYearPathFromContext(
  firmRoot: string,
  pathContext: DocAgentPathContext,
  candidatePath: string
): string | null {
  if (!pathContext.clientSlug || !pathContext.registry) return null;
  const normalizedCandidate = normalizeToolPath(candidatePath);
  const candidateLower = normalizedCandidate.toLowerCase();

  for (const source of pathContext.yearSources) {
    const prefixLower = source.prefix.toLowerCase();
    const yearLower = source.year.toLowerCase();
    let sourceRelativePath: string | null = null;

    if (candidateLower === prefixLower || candidateLower.startsWith(`${prefixLower}/`)) {
      sourceRelativePath = `${source.prefix}${normalizedCandidate.slice(source.prefix.length)}`;
    } else if (candidateLower === yearLower || candidateLower.startsWith(`${yearLower}/`)) {
      sourceRelativePath = `${source.prefix}${normalizedCandidate.slice(source.year.length)}`;
    }

    if (!sourceRelativePath) continue;

    const resolved = pathResolve(
      resolveYearFilePath(firmRoot, pathContext.registry, pathContext.clientSlug, sourceRelativePath)
    );
    if (isWithinPath(resolved, source.root)) {
      return resolved;
    }
  }

  return null;
}

async function resolveReadableCasePath(
  caseFolder: string,
  firmRoot: string,
  requestedPath: string,
  pathContext: DocAgentPathContext
): Promise<string | null> {
  const candidates = buildRequestedPathCandidates(requestedPath);

  for (const candidate of candidates) {
    const caseResolved = pathResolve(caseFolder, candidate);
    if (isWithinPath(caseResolved, caseFolder) && await fileExists(caseResolved)) {
      return caseResolved;
    }

    const yearResolved = resolveYearPathFromContext(firmRoot, pathContext, candidate);
    if (yearResolved && await fileExists(yearResolved)) {
      return yearResolved;
    }
  }

  return null;
}

function toDocAgentDisplayPath(
  absolutePath: string,
  caseFolder: string,
  pathContext: DocAgentPathContext
): string {
  for (const source of pathContext.yearSources) {
    if (isWithinPath(absolutePath, source.root)) {
      const relWithinSource = normalizeRelativePath(pathRelative(source.root, absolutePath));
      return relWithinSource && relWithinSource !== "."
        ? `${source.prefix}/${relWithinSource}`
        : source.prefix;
    }
  }

  return normalizeRelativePath(pathRelative(caseFolder, absolutePath));
}

interface DraftArtifacts {
  docxPath?: string;
  previewPath?: string;
  docxMtimeMs?: number;
}

async function buildDraftArtifacts(
  caseFolder: string,
  firmRoot: string,
  draftId: string,
  content: string,
  docType: DocumentType
): Promise<DraftArtifacts> {
  const workingDocsDir = join(caseFolder, WORKING_DOCS_REL_DIR);
  await mkdir(workingDocsDir, { recursive: true });

  const docxPath = `${WORKING_DOCS_REL_DIR}/${draftId}.docx`;
  const previewPath = `${WORKING_DOCS_REL_DIR}/${draftId}.preview.pdf`;
  const fullDocxPath = join(caseFolder, docxPath);
  const fullPreviewPath = join(caseFolder, previewPath);

  const documentType = mapDocTypeToExportType(docType);
  const shouldShowLetterhead = documentType === "demand" || documentType === "letter";
  const firmInfo = await loadFirmInfo(firmRoot);
  const docxBuffer = documentType === "hearing_decision"
    ? await markdownToHearingDecisionDocx(content, draftId, {
      documentType,
      firmInfo: firmInfo || undefined,
      showPageNumbers: true,
    })
    : await htmlToDocx(
      markdownToHtml(content, {
        documentType,
        firmInfo: firmInfo || undefined,
        showLetterhead: shouldShowLetterhead,
        showPageNumbers: documentType !== "memo",
      }),
      draftId,
      {
        documentType,
        firmInfo: firmInfo || undefined,
        showLetterhead: shouldShowLetterhead,
      }
    );

  await writeFile(fullDocxPath, docxBuffer);
  const docxStats = await stat(fullDocxPath);
  let resolvedPreviewPath: string | undefined;
  try {
    const previewPdfBytes = await renderDocxWithLibreOfficeWithRetry(docxBuffer, {
      attempts: 2,
      initialDelayMs: 100,
    });
    await writeFile(fullPreviewPath, previewPdfBytes);
    resolvedPreviewPath = previewPath;
  } catch (previewError) {
    console.warn(
      `[DocAgent] Draft DOCX created but PDF preview render failed for ${draftId}: ${
        previewError instanceof Error ? previewError.message : String(previewError)
      }`
    );
  }

  return {
    docxPath,
    previewPath: resolvedPreviewPath,
    docxMtimeMs: docxStats.mtimeMs,
  };
}

async function upsertDraftManifestEntry(
  caseFolder: string,
  draftFilename: string,
  docType: DocumentType,
  artifacts: DraftArtifacts
): Promise<void> {
  const draftsDir = join(caseFolder, ".ai_tool", "drafts");
  await mkdir(draftsDir, { recursive: true });

  const manifestPath = join(draftsDir, "manifest.json");
  let manifest: Record<string, any> = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch {
    manifest = {};
  }

  const id = draftFilename.replace(/\.md$/i, "");
  const existing = manifest[id] || {};
  const inferred = inferDraftMetadata(docType);

  manifest[id] = {
    ...existing,
    name: existing.name || formatDraftName(id),
    type: existing.type || inferred.type,
    targetPath: existing.targetPath || inferred.targetPath,
    sourcePath: `.ai_tool/drafts/${draftFilename}`,
    createdAt: existing.createdAt || new Date().toISOString(),
    workingDocxPath: artifacts.docxPath || existing.workingDocxPath,
    previewPdfPath: artifacts.previewPath || existing.previewPdfPath,
    workingDocxMtimeMs:
      typeof artifacts.docxMtimeMs === "number"
        ? artifacts.docxMtimeMs
        : existing.workingDocxMtimeMs,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

// Tool definitions for the document agent
const DOC_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a file from the case folder. Use to read templates, medical records, bills, or other case documents.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Medical/records.pdf' or '.ai_tool/templates/parsed/demand-letter.md')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "read_index_slice",
    description: "Read a bounded slice of .ai_tool/document_index.json for large cases. Use this when you need more detail than the meta-index provides.",
    input_schema: {
      type: "object" as const,
      properties: {
        offset: {
          type: "number",
          description: "Character offset into .ai_tool/document_index.json (0-based)."
        },
        length: {
          type: "number",
          description: "Number of characters to read (max 12000)."
        }
      },
      required: ["offset"]
    }
  },
  {
    name: "glob",
    description: "Find files matching a pattern (e.g., 'Medical/*.pdf', '**/*.md')",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "grep",
    description: "Search for text in files",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex to search for"
        },
        path: {
          type: "string",
          description: "File or folder to search in (default: case folder)"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "list_folder",
    description: "List contents of a folder",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Folder path relative to case folder (default: root)"
        }
      }
    }
  },
  {
    name: "bash",
    description: "Run a shell command (use for PDF text extraction, file operations, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "write_draft",
    description: "Write the generated document to a draft file. Call this when the document is complete. Saves to .ai_tool/drafts/ folder.",
    input_schema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Name for the output file (e.g., 'Demand_Letter.md')"
        },
        content: {
          type: "string",
          description: "The full document content in markdown format"
        }
      },
      required: ["filename", "content"]
    }
  }
];

const RESEARCH_DOC_TOOLS: Anthropic.Tool[] = DOC_TOOLS.filter((tool) => RESEARCH_TOOL_NAMES.has(tool.name));

/**
 * Load the full case index.
 */
export async function loadCaseIndex(caseFolder: string): Promise<Record<string, any>> {
  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const content = await readFile(indexPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Build a bounded prompt view of case context for document generation.
 * Uses meta_index for a compact navigable summary, plus a trimmed index preview.
 */
export async function buildCasePromptContext(
  caseFolder: string,
  caseIndex: Record<string, any>
): Promise<string> {
  let metaIndexData: Record<string, any>;
  try {
    const metaIndexPath = join(caseFolder, ".ai_tool", "meta_index.json");
    const content = await readFile(metaIndexPath, "utf-8");
    metaIndexData = JSON.parse(content);
  } catch {
    metaIndexData = generateMetaIndex(caseIndex);
  }

  const metaView = buildMetaIndexPromptView(metaIndexData as any);
  const metaBlock = `${metaView}\n[For full folder details, use read_file(".ai_tool/indexes/{FolderName}.json"). For deep index access, use read_index_slice.]`;

  const preview = { ...caseIndex };
  if (preview.folders) {
    for (const [folderName, folderData] of Object.entries(preview.folders) as [string, any][]) {
      const files = Array.isArray(folderData) ? folderData : folderData?.files;
      if (!Array.isArray(files)) continue;
      preview.folders[folderName] = {
        files: files.slice(0, 140).map((file: any) => ({
          filename: file.filename,
          type: file.type,
          date: file.date,
          key_info: typeof file.key_info === "string" ? file.key_info.slice(0, 220) : file.key_info,
        })),
        truncated: files.length > 140,
      };
    }
  }

  let previewJson = JSON.stringify(preview, null, 2);
  if (previewJson.length > 22000) {
    previewJson = `${previewJson.slice(0, 22000)}\n...\n[NOTE: Index preview truncated; use read_index_slice for exact details.]`;
  }

  return `${metaBlock}\n\nCASE INDEX PREVIEW:\n${previewJson}`;
}

/**
 * Load all parsed templates as a single context string.
 */
async function loadAllTemplates(firmRoot: string): Promise<string> {
  const templatesDir = join(firmRoot, ".ai_tool", "templates");
  const indexPath = join(templatesDir, "templates.json");
  const parsedDir = join(templatesDir, "parsed");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const parts: string[] = [];

    for (const template of index.templates) {
      if (!template.parsedFile) continue;

      try {
        const content = await readFile(join(templatesDir, template.parsedFile), "utf-8");
        parts.push(`## TEMPLATE: ${template.name} (${template.id})

${template.description || "No description"}

---

${content}

---
`);
      } catch {
        // Skip unreadable templates
      }
    }

    if (parts.length === 0) {
      return "No templates available.";
    }

    return parts.join("\n\n");
  } catch {
    return "No templates available.";
  }
}

/**
 * Load firm configuration.
 */
export async function loadFirmConfig(firmRoot: string): Promise<Record<string, any>> {
  try {
    const configPath = join(firmRoot, ".ai_tool", "firm-config.json");
    return JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const TEXT_SEARCH_EXTENSIONS = new Set([".txt", ".md", ".json"]);

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function matchesSearchPattern(
  content: string,
  pattern: string,
  regex: RegExp | null
): boolean {
  if (regex) {
    return regex.test(content);
  }
  return content.toLowerCase().includes(pattern.toLowerCase());
}

async function collectSearchTargets(searchPath: string): Promise<string[]> {
  const targets: string[] = [];
  const searchStat = await stat(searchPath);

  if (searchStat.isFile()) {
    targets.push(searchPath);
    return targets;
  }

  const glob = new Bun.Glob("**/*");
  for await (const relPath of glob.scan({ cwd: searchPath, onlyFiles: true })) {
    const dotIndex = relPath.lastIndexOf(".");
    const ext = dotIndex >= 0 ? relPath.slice(dotIndex).toLowerCase() : "";
    if (TEXT_SEARCH_EXTENSIONS.has(ext)) {
      targets.push(join(searchPath, relPath));
    }
  }

  return targets;
}

/**
 * Execute a tool and return the result.
 */
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  caseFolder: string,
  firmRoot: string,
  docType: DocumentType,
  pathContext: DocAgentPathContext
): Promise<{ result: string; filePath?: string; previewPath?: string; docxPath?: string }> {
  try {
    switch (toolName) {
      case "read_file": {
        const requestedPath = String(toolInput.path ?? "");
        const normalizedRequestedPath = normalizeToolPath(requestedPath);
        let filePath: string | null = null;

        // If path starts with .ai_tool/templates, try firm root first
        if (requestedPath.startsWith(".ai_tool/templates")) {
          const firmPath = pathResolve(firmRoot, requestedPath);
          try {
            const content = await readFile(firmPath, "utf-8");
            return { result: content.slice(0, 20000) };
          } catch {
            // Fall through to case folder
          }
        }

        filePath = await resolveReadableCasePath(
          caseFolder,
          firmRoot,
          requestedPath,
          pathContext
        );
        if (!filePath) {
          const availableAliases = pathContext.yearSources
            .map((source) => source.prefix)
            .filter((value, index, list) => list.indexOf(value) === index)
            .join(", ");
          const aliasHint = availableAliases
            ? ` Available virtual folders: ${availableAliases}.`
            : "";
          return {
            result: `Error: File not found: ${requestedPath}.${aliasHint} Try read_file(\".ai_tool/indexes/{FolderName}.json\") to locate the exact filename.`,
          };
        }

        const normalizedPath = normalizedRequestedPath.toLowerCase();

        // Handle PDFs and DOCX as binary documents
        if (normalizedPath.endsWith('.pdf')) {
          try {
            const text = await extractPdfText(filePath, {
              layout: false,
              maxBuffer: 2 * 1024 * 1024,
              timeout: 30000,
            });
            return { result: text.slice(0, 20000) };
          } catch (error) {
            return { result: `Error: Could not extract text from PDF: ${error instanceof Error ? error.message : String(error)}` };
          }
        }
        if (normalizedPath.endsWith('.docx')) {
          try {
            const text = await extractTextFromDocx(filePath);
            return { result: text.slice(0, 20000) };
          } catch (error) {
            return { result: `Error: Could not extract text from DOCX: ${error instanceof Error ? error.message : String(error)}` };
          }
        }

        const content = await readFile(filePath, "utf-8");
        return { result: content.slice(0, 20000) };
      }

      case "read_index_slice": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const content = await readFile(indexPath, "utf-8");

        const offsetRaw = Number(toolInput.offset);
        const lengthRaw = toolInput.length === undefined ? INDEX_SLICE_MAX_CHARS : Number(toolInput.length);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
        const length = Number.isFinite(lengthRaw) && lengthRaw > 0
          ? Math.min(Math.floor(lengthRaw), INDEX_SLICE_MAX_CHARS)
          : INDEX_SLICE_MAX_CHARS;
        const end = Math.min(content.length, offset + length);
        const slice = content.slice(offset, end);

        return {
          result: JSON.stringify({
            total_chars: content.length,
            offset,
            end,
            has_more: end < content.length,
            next_offset: end < content.length ? end : null,
            slice,
          }),
        };
      }

      case "glob": {
        const pattern = String(toolInput.pattern ?? "").trim();
        if (!pattern) {
          return { result: "Error: pattern is required" };
        }
        const glob = new Bun.Glob(pattern);
        const matches: string[] = [];
        const seen = new Set<string>();

        for await (const file of glob.scan({ cwd: caseFolder, onlyFiles: true })) {
          const normalized = normalizeRelativePath(file);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          matches.push(normalized);
          if (matches.length >= 100) break;
        }

        if (matches.length < 100) {
          for (const source of pathContext.yearSources) {
            for await (const file of glob.scan({ cwd: source.root, onlyFiles: true })) {
              const prefixed = normalizeRelativePath(`${source.prefix}/${file}`);
              if (seen.has(prefixed)) continue;
              seen.add(prefixed);
              matches.push(prefixed);
              if (matches.length >= 100) break;
            }
            if (matches.length >= 100) break;
          }
        }

        if (matches.length === 0) {
          return { result: "No files found matching pattern" };
        }
        return { result: matches.join("\n") };
      }

      case "grep": {
        const requestedSearchPath = typeof toolInput.path === "string" ? toolInput.path : "";
        const searchPath = requestedSearchPath
          ? await resolveReadableCasePath(caseFolder, firmRoot, requestedSearchPath, pathContext)
          : caseFolder;
        const rawPattern = String(toolInput.pattern ?? "").trim();

        if (!rawPattern) {
          return { result: "Error: pattern is required" };
        }

        if (!searchPath) {
          return { result: `Error: Search path not found: ${requestedSearchPath}` };
        }

        // Security check
        if (
          !isWithinPath(searchPath, caseFolder) &&
          !pathContext.yearSources.some((source) => isWithinPath(searchPath, source.root))
        ) {
          return { result: "Error: Cannot search outside the case folder" };
        }

        try {
          let regex: RegExp | null = null;
          try {
            regex = new RegExp(rawPattern, "i");
          } catch {
            regex = null;
          }

          const candidates = await collectSearchTargets(searchPath);
          const matchedFiles: string[] = [];

          for (const candidate of candidates) {
            if (matchedFiles.length >= 20) break;

            try {
              const content = await readFile(candidate, "utf-8");
              if (matchesSearchPattern(content, rawPattern, regex)) {
                const relPath = toDocAgentDisplayPath(candidate, caseFolder, pathContext);
                matchedFiles.push(relPath);
              }
            } catch {
              // Skip unreadable files
            }
          }

          if (matchedFiles.length === 0) {
            return { result: "No matches found" };
          }

          return { result: `Files containing "${rawPattern}":\n${matchedFiles.join('\n')}` };
        } catch {
          return { result: "No matches found" };
        }
      }

      case "list_folder": {
        const requestedPath = typeof toolInput.path === "string" && toolInput.path.trim()
          ? toolInput.path.trim()
          : ".";
        const folderPath = requestedPath === "."
          ? caseFolder
          : await resolveReadableCasePath(caseFolder, firmRoot, requestedPath, pathContext);

        if (!folderPath) {
          const availableAliases = pathContext.yearSources
            .map((source) => source.prefix)
            .filter((value, index, list) => list.indexOf(value) === index)
            .join(", ");
          const aliasHint = availableAliases
            ? ` Available virtual folders: ${availableAliases}.`
            : "";
          return { result: `Error: Folder not found: ${requestedPath}.${aliasHint}` };
        }

        try {
          const entries = await readdir(folderPath, { withFileTypes: true });
          const listing = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`);
          return { result: listing.join('\n') || "Empty folder" };
        } catch {
          return { result: "Error: Folder not found or not accessible" };
        }
      }

      case "bash": {
        // Security: only allow execution within case folder
        const command = toolInput.command;

        // Block dangerous commands
        const dangerous = ['rm -rf', 'sudo', '>', '>>', 'chmod', 'chown', 'curl', 'wget', 'eval'];
        if (dangerous.some(d => command.includes(d))) {
          return { result: "Error: Command not allowed for security reasons" };
        }

        try {
          const result = execSync(command, {
            cwd: caseFolder,
            encoding: 'utf-8',
            maxBuffer: 2 * 1024 * 1024,
            timeout: 30000 // 30 second timeout
          });
          return { result: result.slice(0, 20000) || "(no output)" };
        } catch (error) {
          const err = error as { stderr?: string; message?: string };
          return { result: `Command failed: ${err.stderr || err.message || 'Unknown error'}` };
        }
      }

      case "write_draft": {
        // Save drafts to .ai_tool/drafts/ within the case folder
        const draftsDir = join(caseFolder, ".ai_tool", "drafts");
        await mkdir(draftsDir, { recursive: true });

        const safeFilename = sanitizeDraftFilename(toolInput.filename, docType);
        const filePath = join(draftsDir, safeFilename);

        // Security check: verify path is within case folder
        if (!filePath.startsWith(caseFolder)) {
          return { result: "Error: Cannot write files outside the case folder" };
        }

        const rawContent = String(toolInput.content ?? "");
        const {
          content: markdownContent,
          notes: safetyNotes,
        } = applyDraftSafetyChecks(rawContent, docType);
        await writeFile(filePath, markdownContent, "utf-8");
        const relativePath = `.ai_tool/drafts/${safeFilename}`;
        const draftId = safeFilename.replace(/\.md$/i, "");

        let artifacts: DraftArtifacts = {};
        try {
          artifacts = await buildDraftArtifacts(caseFolder, firmRoot, draftId, markdownContent, docType);
        } catch (artifactError) {
          console.warn(
            `[DocAgent] Draft saved but artifact generation failed for ${safeFilename}: ${
              artifactError instanceof Error ? artifactError.message : String(artifactError)
            }`
          );
        }

        await upsertDraftManifestEntry(caseFolder, safeFilename, docType, artifacts);

        return {
          result: artifacts.previewPath
            ? `Draft saved to ${relativePath} with DOCX and PDF preview artifacts${safetyNotes.length ? " (layout safety checks applied)" : ""}`
            : `Draft saved to ${relativePath}${safetyNotes.length ? " (layout safety checks applied)" : ""}`,
          filePath: relativePath,
          previewPath: artifacts.previewPath,
          docxPath: artifacts.docxPath,
        };
      }

      // Keep backwards compatibility with old tool name
      case "write_document": {
        // Redirect to write_draft behavior
        const draftsDir = join(caseFolder, ".ai_tool", "drafts");
        await mkdir(draftsDir, { recursive: true });

        const safeFilename = sanitizeDraftFilename(toolInput.filename, docType);
        const filePath = join(draftsDir, safeFilename);

        if (!filePath.startsWith(caseFolder)) {
          return { result: "Error: Cannot write files outside the case folder" };
        }

        const rawContent = String(toolInput.content ?? "");
        const {
          content: markdownContent,
          notes: safetyNotes,
        } = applyDraftSafetyChecks(rawContent, docType);
        await writeFile(filePath, markdownContent, "utf-8");
        const relativePath = `.ai_tool/drafts/${safeFilename}`;
        const draftId = safeFilename.replace(/\.md$/i, "");

        let artifacts: DraftArtifacts = {};
        try {
          artifacts = await buildDraftArtifacts(caseFolder, firmRoot, draftId, markdownContent, docType);
        } catch (artifactError) {
          console.warn(
            `[DocAgent] Draft saved but artifact generation failed for ${safeFilename}: ${
              artifactError instanceof Error ? artifactError.message : String(artifactError)
            }`
          );
        }

        await upsertDraftManifestEntry(caseFolder, safeFilename, docType, artifacts);

        return {
          result: artifacts.previewPath
            ? `Draft saved to ${relativePath} with DOCX and PDF preview artifacts${safetyNotes.length ? " (layout safety checks applied)" : ""}`
            : `Draft saved to ${relativePath}${safetyNotes.length ? " (layout safety checks applied)" : ""}`,
          filePath: relativePath,
          previewPath: artifacts.previewPath,
          docxPath: artifacts.docxPath,
        };
      }

      default:
        return { result: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return {
      result: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Build the system prompt for document generation.
 */
function buildSystemPrompt(
  docType: DocumentType,
  knowledge: string,
  templates: string,
  firmConfig: Record<string, any>
): string {
  return `You are a legal document drafting assistant for a Personal Injury law firm. Your task is to generate ${getDocTypeDescription(docType)}.

## FIRM INFORMATION

${firmConfig.firmName ? `Firm: ${firmConfig.firmName}` : ""}
${firmConfig.address ? `Address: ${firmConfig.address}` : ""}
${firmConfig.phone ? `Phone: ${firmConfig.phone}` : ""}
${firmConfig.feeStructure ? `Fee Structure: ${firmConfig.feeStructure}` : ""}

## PRACTICE KNOWLEDGE

${knowledge}

## AVAILABLE TEMPLATES

${templates}

## INSTRUCTIONS

1. First, review the meta-index/index preview to understand the case
2. If you need deeper detail from document_index.json, use read_index_slice in chunks
3. If you need more detail on specific documents, use read_file to review them
4. Select the most appropriate template for this document
5. Read the template to understand its structure and requirements
6. Draft the document following the template structure
7. Fill in all placeholders with actual case data
8. Use write_draft to save the final document

## DOCUMENT-SPECIFIC REQUIREMENTS

${getDocTypeSpecificInstructions(docType)}

IMPORTANT:
- Follow the template structure closely
- Use professional legal language
- Ensure all facts are accurate based on the case documents
- Include proper dates, amounts, and details
- Write the complete document - do not leave placeholders unfilled
- Save the document when complete using write_draft
- write_draft filename must end in .md (never .txt or .docx)

## AVAILABLE TOOLS

- read_file: Read any file in the case folder (handles PDFs automatically)
- read_index_slice: Read document_index.json in bounded chunks for very large cases
- glob: Find files matching a pattern (e.g., 'Medical/*.pdf')
- grep: Search for text across files
- list_folder: List directory contents
- bash: Run shell commands for complex operations
- write_draft: Save your completed document to .ai_tool/drafts/`;
}

function buildResearchSystemPrompt(
  docType: DocumentType,
  knowledge: string,
  firmConfig: Record<string, any>,
  maxTurns: number
): string {
  return `You are the research phase for legal document drafting.
Your sole task is to gather verified facts and citations for ${getDocTypeDescription(docType)}.
Do NOT draft the final document.

Firm context:
${firmConfig.firmName ? `Firm: ${firmConfig.firmName}` : ""}
${firmConfig.jurisdiction ? `Jurisdiction: ${firmConfig.jurisdiction}` : ""}

Practice knowledge:
${trimContentToBudget(knowledge, 22000, "research knowledge")}

Document-specific requirements:
${getDocTypeSpecificInstructions(docType)}

Research instructions:
- You have a maximum of ${maxTurns} turns.
- Use tools to find facts quickly.
- Prefer read_file, read_index_slice, grep, and folder indexes under .ai_tool/indexes/.
- Never call write_draft and never use bash.
- After each reasoning step, provide a markdown packet update using these exact section headings:
  ## Case Snapshot
  ## Timeline
  ## Issues to Decide
  ## Evidence and Citations
  ## Required Placeholders
  ## Drafting Constraints
- Keep lines concise and source-grounded.
- When enough information is gathered, include the line: RESEARCH_COMPLETE`;
}

export function buildComposeSystemPrompt(
  docType: DocumentType,
  knowledge: string,
  firmConfig: Record<string, any>
): string {
  return `You are the composition phase for legal document drafting.
Draft ${getDocTypeDescription(docType)} from the provided research packet and template excerpts.
Do not use tools.
Output markdown only (no code fences, no JSON).

Firm context:
${firmConfig.firmName ? `Firm: ${firmConfig.firmName}` : ""}
${firmConfig.address ? `Address: ${firmConfig.address}` : ""}
${firmConfig.phone ? `Phone: ${firmConfig.phone}` : ""}

Practice knowledge:
${trimContentToBudget(knowledge, DEFAULT_COMPOSE_BUDGET.maxKnowledgeChars, "compose knowledge")}

Document-specific requirements:
${getDocTypeSpecificInstructions(docType)}

Drafting rules:
- Follow template structure where provided.
- Ground factual statements in the supplied research packet evidence.
- For missing required facts, insert [VERIFY: ...] placeholders.
- Produce a complete filing-ready draft in one response.`;
}

interface NarrowedTemplateContext {
  context: string;
  selectedTemplateIds: string[];
}

function getTemplateKeywords(docType: DocumentType): string[] {
  switch (docType) {
    case "decision_order":
      return ["decision", "order", "hearing", "appeal", "appeals officer", "hearing officer", "dao", "d&o"];
    case "demand_letter":
      return ["demand", "policy limits", "insurer", "carrier", "settlement"];
    case "case_memo":
      return ["memo", "memorandum", "case summary", "posture"];
    case "settlement":
      return ["settlement", "disbursement", "distribution", "lien", "calculation"];
    case "general_letter":
      return ["letter", "request", "notice", "correspondence"];
    default:
      return ["document"];
  }
}

function scoreTemplateCandidate(
  docType: DocumentType,
  userPrompt: string,
  candidate: { id?: string; name?: string; description?: string }
): number {
  const haystack = `${candidate.id || ""} ${candidate.name || ""} ${candidate.description || ""}`.toLowerCase();
  const keywords = getTemplateKeywords(docType);
  let score = 0;

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 10;
  }

  const promptTerms = userPrompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5);
  for (const term of promptTerms) {
    if (haystack.includes(term)) score += 2;
  }

  if (docType === "decision_order" && /(decision|order|hearing|appeal)/i.test(haystack)) {
    score += 6;
  }

  return score;
}

function extractTemplateContentWindow(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const sectionStart = content.search(/##\s+4\.\s*TEMPLATE CONTENT/i);
  if (sectionStart >= 0) {
    const usageNotesIdx = content.slice(sectionStart).search(/##\s+5\./i);
    if (usageNotesIdx > 0) {
      const slice = content.slice(sectionStart, sectionStart + usageNotesIdx).trim();
      return trimContentToBudget(slice, maxChars, "template content");
    }
  }

  return trimContentToBudget(content, maxChars, "template");
}

export async function loadNarrowedTemplates(
  firmRoot: string,
  docType: DocumentType,
  userPrompt: string,
  maxTemplates = 2
): Promise<NarrowedTemplateContext> {
  const templatesDir = join(firmRoot, ".ai_tool", "templates");
  const indexPath = join(templatesDir, "templates.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    const candidates = Array.isArray(index.templates) ? index.templates : [];

    const ranked = candidates
      .filter((template: any) => Boolean(template?.parsedFile))
      .map((template: any) => ({
        template,
        score: scoreTemplateCandidate(docType, userPrompt, template),
      }))
      .sort((a: any, b: any) => b.score - a.score);

    const selected = ranked
      .filter((item: any) => item.score > 0)
      .slice(0, maxTemplates);
    const fallbackSelected = selected.length > 0 ? selected : ranked.slice(0, Math.min(maxTemplates, ranked.length));

    const contextParts: string[] = [];
    const selectedIds: string[] = [];

    for (const item of fallbackSelected) {
      const template = item.template;
      const parsedPath = join(templatesDir, template.parsedFile);
      try {
        const content = await readFile(parsedPath, "utf-8");
        const scoped = extractTemplateContentWindow(content, 9000);
        selectedIds.push(String(template.id || template.name || "unknown-template"));
        contextParts.push(
          `## TEMPLATE: ${template.name || template.id || "Unnamed template"} (${template.id || "unknown-id"})\n` +
          `${template.description || "No description"}\n\n${scoped}`
        );
      } catch {
        // Skip unreadable template.
      }
    }

    if (contextParts.length === 0) {
      return { context: "No parsed templates available.", selectedTemplateIds: [] };
    }

    return {
      context: trimContentToBudget(
        contextParts.join("\n\n---\n\n"),
        DEFAULT_COMPOSE_BUDGET.maxTemplateChars,
        "selected templates"
      ),
      selectedTemplateIds: selectedIds,
    };
  } catch {
    return { context: "No parsed templates available.", selectedTemplateIds: [] };
  }
}

export function applyComposeBudget(
  budget: ComposeBudget,
  userPrompt: string,
  caseContext: string,
  researchPacket: string,
  templateContext: string,
  knowledge: string
): {
  userPrompt: string;
  caseContext: string;
  researchPacket: string;
  templateContext: string;
  knowledge: string;
  notes: string[];
} {
  const notes: string[] = [];

  const budgetedUserPrompt = trimContentToBudget(userPrompt, budget.maxUserPromptChars, "user prompt");
  if (budgetedUserPrompt.length < userPrompt.length) notes.push("Truncated user prompt.");

  const budgetedCaseContext = trimContentToBudget(caseContext, budget.maxCaseContextChars, "case context");
  if (budgetedCaseContext.length < caseContext.length) notes.push("Truncated case context.");

  const compressedPacket = capResearchPacketMarkdown(researchPacket, budget.maxResearchPacketChars);
  if (compressedPacket.length < researchPacket.length) {
    notes.push("Truncated research packet (verbose evidence quotes and low-priority facts reduced).");
  }

  const budgetedTemplateContext = trimContentToBudget(templateContext, budget.maxTemplateChars, "template context");
  if (budgetedTemplateContext.length < templateContext.length) {
    notes.push("Truncated extra template notes.");
  }

  const budgetedKnowledge = trimContentToBudget(knowledge, budget.maxKnowledgeChars, "compose knowledge");
  if (budgetedKnowledge.length < knowledge.length) notes.push("Truncated compose knowledge.");

  return {
    userPrompt: budgetedUserPrompt,
    caseContext: budgetedCaseContext,
    researchPacket: compressedPacket,
    templateContext: budgetedTemplateContext,
    knowledge: budgetedKnowledge,
    notes,
  };
}

export function isDraftTooThin(content: string, docType: DocumentType): { thin: boolean; reason?: string } {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { thin: true, reason: "Compose returned empty content." };
  }

  if (docType === "decision_order") {
    const requiredHeadings = ["findings of fact", "conclusions of law", "order"];
    const lower = trimmed.toLowerCase();
    for (const heading of requiredHeadings) {
      if (!lower.includes(heading)) {
        return { thin: true, reason: `Compose output missing required section: ${heading}.` };
      }
    }
    if (trimmed.length < 1200) {
      return { thin: true, reason: "Compose output is too short for a filing-ready Decision & Order." };
    }
    return { thin: false };
  }

  if (trimmed.length < 450) {
    return { thin: true, reason: "Compose output is too short for a complete draft." };
  }
  return { thin: false };
}

export function buildFallbackDraftContent(
  docType: DocumentType,
  userPrompt: string,
  researchPacketMarkdown: string,
  composeReason: string | undefined
): string {
  const reasonLine = composeReason
    ? `Auto-saved fallback scaffold because compose was incomplete: ${composeReason}`
    : "Auto-saved fallback scaffold because compose was incomplete.";

  if (docType === "decision_order") {
    return `Claim No.: [VERIFY]
Hearing No.: [VERIFY]
Date of Injury: [VERIFY]
Appeal No.: [VERIFY]

# DECISION AND ORDER

### I. PROCEDURAL HISTORY
[VERIFY: Provide procedural posture, hearing date, appearances, and appeal identifier.]

### II. ISSUE PRESENTED
1. [VERIFY: Identify each issue on appeal.]

### III. EXHIBITS ADMITTED
1. [VERIFY: List admitted exhibits and references.]

### IV. FINDINGS OF FACT
1. [VERIFY: Add fact findings supported by record citations.]
2. [VERIFY]

### V. CONCLUSIONS OF LAW
1. [VERIFY: Add legal conclusions tied to findings and controlling law.]
2. [VERIFY]

### VI. ORDER
1. [VERIFY: Add decretal ruling for each appealed issue.]
2. [VERIFY]

### VII. NOTICE OF APPEAL RIGHTS
[VERIFY: Insert applicable statutory appeal-rights language.]

### VIII. CERTIFICATE OF SERVICE
[VERIFY: Insert date, method, recipients, and signature block.]

---
${reasonLine}

## User Request Context
${truncateForTrace(userPrompt, 800)}

## Research Packet Snapshot
${trimContentToBudget(researchPacketMarkdown, 3000, "research packet snapshot")}`;
  }

  return `# ${formatDraftName(DEFAULT_DRAFT_FILENAME[docType].replace(/\.md$/i, ""))}

[VERIFY: Complete this draft using available case facts and citations.]

## Core Points
- [VERIFY: Key facts]
- [VERIFY: Requested relief or ask]
- [VERIFY: Missing information placeholders]

---
${reasonLine}

## User Request Context
${truncateForTrace(userPrompt, 800)}

## Research Packet Snapshot
${trimContentToBudget(researchPacketMarkdown, 2200, "research packet snapshot")}`;
}

interface ResearchPhaseResult {
  packet: ResearchPacket;
  packetMarkdown: string;
  turns: number;
  completionReason: string;
}

async function runResearchPhase(params: {
  caseFolder: string;
  firmRoot: string;
  docType: DocumentType;
  seedPrompt: string;
  pathContext: DocAgentPathContext;
  systemPrompt: string;
  userMessage: string;
  maxTurns: number;
  trace: (event: Record<string, any>) => Promise<void>;
}): Promise<ResearchPhaseResult> {
  const {
    caseFolder,
    firmRoot,
    docType,
    seedPrompt,
    pathContext,
    systemPrompt,
    userMessage,
    maxTurns,
    trace,
  } = params;

  const packet = createResearchPacket(docType, seedPrompt);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let completionReason = "max_turns";
  let turns = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    turns = turn;
    const response = await getClient().messages.create({
      model: DOC_AGENT_RESEARCH_MODEL,
      max_tokens: 2600,
      system: systemPrompt,
      messages,
      tools: RESEARCH_DOC_TOOLS,
    });

    let textContent = "";
    const toolUses: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, any>,
        });
      }
    }

    if (textContent.trim()) {
      mergeResearchPacketMarkdown(packet, textContent);
    }

    await trace({
      event: "research_model_response",
      turn,
      stopReason: response.stop_reason,
      textLength: textContent.length,
      textPreview: textContent ? truncateForTrace(textContent) : undefined,
      toolUses: toolUseSummary(toolUses),
    });

    const hasCompletionMarker = /RESEARCH_COMPLETE/i.test(textContent);
    if (toolUses.length === 0) {
      completionReason = hasCompletionMarker
        ? "completion_marker"
        : response.stop_reason || "no_tools";
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      if (!RESEARCH_TOOL_NAMES.has(toolUse.name)) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: Tool ${toolUse.name} is not allowed in research phase.`,
        });
        continue;
      }

      const toolOutput = await executeTool(
        toolUse.name,
        toolUse.input,
        caseFolder,
        firmRoot,
        docType,
        pathContext
      );
      updateResearchPacketFromToolResult(packet, toolUse.name, toolUse.input, toolOutput.result, docType);

      await trace({
        event: "research_tool_result",
        turn,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        resultPreview: truncateForTrace(toolOutput.result),
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: toolOutput.result,
      });
    }

    messages.push({
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...toolUses.map((tool) => ({
          type: "tool_use" as const,
          id: tool.id,
          name: tool.name,
          input: tool.input,
        })),
      ],
    });
    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  return {
    packet,
    packetMarkdown: renderResearchPacketMarkdown(packet),
    turns,
    completionReason,
  };
}

interface ComposePhaseResult {
  content: string;
  budgetNotes: string[];
  error?: string;
}

async function runComposePhase(params: {
  docType: DocumentType;
  userPrompt: string;
  caseContext: string;
  researchPacketMarkdown: string;
  templateContext: string;
  knowledge: string;
  firmConfig: Record<string, any>;
  budget?: ComposeBudget;
  trace: (event: Record<string, any>) => Promise<void>;
}): Promise<ComposePhaseResult> {
  const {
    docType,
    userPrompt,
    caseContext,
    researchPacketMarkdown,
    templateContext,
    knowledge,
    firmConfig,
    trace,
  } = params;
  const budget = params.budget || DEFAULT_COMPOSE_BUDGET;

  const budgeted = applyComposeBudget(
    budget,
    userPrompt,
    caseContext,
    researchPacketMarkdown,
    templateContext,
    knowledge
  );

  const systemPrompt = trimContentToBudget(
    buildComposeSystemPrompt(docType, budgeted.knowledge, firmConfig),
    budget.maxSystemChars,
    "compose system prompt"
  );

  const composeMessage = `USER REQUEST:
${budgeted.userPrompt}

CASE CONTEXT:
${budgeted.caseContext}

RESEARCH PACKET:
${budgeted.researchPacket}

SELECTED TEMPLATE EXCERPTS:
${budgeted.templateContext}

Draft the full final document now in markdown only.`;

  await trace({
    event: "compose_prompt_built",
    systemPromptLength: systemPrompt.length,
    userMessageLength: composeMessage.length,
    budgetNotes: budgeted.notes,
    templateChars: budgeted.templateContext.length,
    packetChars: budgeted.researchPacket.length,
  });

  try {
    const response = await getClient().messages.create({
      model: DOC_AGENT_COMPOSE_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: composeMessage }],
    });

    let textContent = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      }
    }

    await trace({
      event: "compose_model_response",
      stopReason: response.stop_reason,
      textLength: textContent.length,
      textPreview: textContent ? truncateForTrace(textContent) : undefined,
    });

    return {
      content: textContent.trim(),
      budgetNotes: budgeted.notes,
      error: textContent.trim().length === 0 ? "Compose model returned no draft text." : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await trace({
      event: "compose_error",
      error: message,
    });
    return {
      content: "",
      budgetNotes: budgeted.notes,
      error: message,
    };
  }
}

export async function persistDraftContent(
  caseFolder: string,
  firmRoot: string,
  docType: DocumentType,
  pathContext: DocAgentPathContext,
  content: string
): Promise<{ result: string; filePath?: string; previewPath?: string; docxPath?: string }> {
  return executeTool(
    "write_draft",
    {
      filename: DEFAULT_DRAFT_FILENAME[docType],
      content,
    },
    caseFolder,
    firmRoot,
    docType,
    pathContext
  );
}

/**
 * Main document generation function.
 * Returns an async generator for streaming progress back to the chat.
 */
async function* generateDocumentLegacy(
  caseFolder: string,
  docType: DocumentType,
  userPrompt: string
): AsyncGenerator<{ type: string; content?: string; filePath?: string; previewPath?: string; docxPath?: string; done?: boolean }> {
  const firmRoot = resolveFirmRoot(caseFolder);
  const pathContext = await buildDocAgentPathContext(caseFolder, firmRoot);
  const maxIterations = 10;
  const traceRunId = `docgen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const traceDir = join(caseFolder, ".ai_tool", "logs");
  const tracePath = join(traceDir, `${traceRunId}.jsonl`);
  const tracePathRel = `.ai_tool/logs/${traceRunId}.jsonl`;

  await mkdir(traceDir, { recursive: true });
  const trace = async (event: Record<string, any>) => {
    try {
      await appendDocGenTrace(tracePath, event);
    } catch (err) {
      console.warn(
        `[DocAgent] Failed to append trace at ${tracePathRel}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  await trace({
    event: "start",
    docType,
    caseFolder,
    userPromptPreview: truncateForTrace(userPrompt),
  });
  await trace({
    event: "path_context",
    clientSlug: pathContext.clientSlug,
    hasRegistry: Boolean(pathContext.registry),
    yearSources: pathContext.yearSources.map((source) => ({
      prefix: source.prefix,
      year: source.year,
      root: source.root,
    })),
  });

  yield { type: "status", content: "Loading case data and templates..." };

  // Load all context
  const [caseIndex, knowledge, templates, firmConfig] = await Promise.all([
    loadCaseIndex(caseFolder),
    loadSectionsByIds(firmRoot), // Load all knowledge sections
    loadAllTemplates(firmRoot),
    loadFirmConfig(firmRoot)
  ]);
  const caseContext = await buildCasePromptContext(caseFolder, caseIndex);

  const yearAliases = pathContext.yearSources
    .map((source) => source.prefix)
    .filter((alias, index, list) => list.indexOf(alias) === index);
  const runtimeGuidance = [
    "## RUNTIME CONSTRAINTS",
    `- You have a hard budget of ${maxIterations} model iterations for this run.`,
    "- Plan your calls: locate the needed files quickly, draft, then call write_draft before the budget is exhausted.",
    "- Avoid exploratory bash loops; prefer read_file, read_index_slice, and .ai_tool/indexes/* JSON.",
    "",
    "## PATH RESOLUTION NOTES",
    yearAliases.length > 0
      ? `- Indexed folder labels like ${yearAliases.join(", ")} are supported by read_file/list_folder. You may use those aliases directly.`
      : "- Use paths relative to the case folder.",
    "- If exact source docs are hard to locate, read .ai_tool/indexes/{FolderName}.json for canonical filenames.",
  ].join("\n");
  const systemPrompt = `${buildSystemPrompt(docType, knowledge, templates, firmConfig)}\n\n${runtimeGuidance}`;

  // Build initial user message with case context
  const userMessage = `CASE CONTEXT:
${caseContext}

USER REQUEST:
${userPrompt}

Please generate the requested document. Start by reviewing the case context above, then select and read the appropriate template, and finally draft and save the document.`;

  await trace({
    event: "prompt_built",
    systemPromptLength: systemPrompt.length,
    userMessageLength: userMessage.length,
    systemPromptPreview: truncateForTrace(systemPrompt, 4000),
    userMessagePreview: truncateForTrace(userMessage, 4000),
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage }
  ];

  yield { type: "status", content: "Starting document generation..." };

  let iterations = 0;
  let finalFilePath: string | undefined;
  let finalPreviewPath: string | undefined;
  let finalDocxPath: string | undefined;
  let finalFailureReason: string | undefined;

  while (iterations < maxIterations) {
    iterations++;

    const response = await getClient().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools: DOC_TOOLS
    });

    // Process response content
    let textContent = "";
    const toolUses: Array<{ id: string; name: string; input: any }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, any>
        });
      }
    }

    await trace({
      event: "model_response",
      iteration: iterations,
      stopReason: response.stop_reason,
      textLength: textContent.length,
      textPreview: textContent ? truncateForTrace(textContent) : undefined,
      toolUses: toolUseSummary(toolUses),
    });

    // Stream any text output
    if (textContent) {
      yield { type: "text", content: textContent };
    }

    // If no tool use, stop this run.
    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      if (!finalFilePath) {
        const trimmedText = textContent.trim();
        if (trimmedText.length === 0) {
          finalFailureReason = "Document generation ended before producing draft content or saving a file.";
        } else {
          finalFailureReason = "Document generation produced text but never called write_draft to save it.";
        }
      }
      await trace({
        event: "stop_no_tools",
        iteration: iterations,
        hasSavedFile: Boolean(finalFilePath),
        failureReason: finalFailureReason,
      });
      break;
    }

    // Execute tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      yield { type: "tool", content: `Using ${toolUse.name}...` };
      await trace({
        event: "tool_call",
        iteration: iterations,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        input: safeTraceInput(toolUse.input),
      });

      const { result, filePath, previewPath, docxPath } = await executeTool(
        toolUse.name,
        toolUse.input,
        caseFolder,
        firmRoot,
        docType,
        pathContext
      );

      await trace({
        event: "tool_result",
        iteration: iterations,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        resultPreview: truncateForTrace(result),
        filePath,
        previewPath,
        docxPath,
      });

      if (filePath) {
        finalFilePath = filePath;
      }
      if (previewPath) {
        finalPreviewPath = previewPath;
      }
      if (docxPath) {
        finalDocxPath = docxPath;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result
      });
    }

    // Add assistant message with tool uses
    messages.push({
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...toolUses.map(t => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: t.input
        }))
      ]
    });

    // Add tool results
    messages.push({
      role: "user",
      content: toolResults
    });
  }

  if (!finalFilePath && !finalFailureReason && iterations >= maxIterations) {
    finalFailureReason = `Document generation reached max iterations (${maxIterations}) before saving a draft.`;
  }

  if (!finalFilePath && finalFailureReason) {
    finalFailureReason = `${finalFailureReason} (trace: ${tracePathRel})`;
    console.warn(`[DocAgent] ${finalFailureReason}`);
    await trace({
      event: "error",
      failureReason: finalFailureReason,
    });
    yield { type: "error", content: finalFailureReason };
  }

  await trace({
    event: "done",
    iterations,
    filePath: finalFilePath,
    previewPath: finalPreviewPath,
    docxPath: finalDocxPath,
    failureReason: finalFailureReason,
  });

  yield {
    type: "done",
    done: true,
    content: finalFailureReason,
    filePath: finalFilePath,
    previewPath: finalPreviewPath,
    docxPath: finalDocxPath,
  };
}

/**
 * Main document generation entrypoint.
 * Uses two-phase (Haiku research -> single Sonnet compose) when enabled.
 */
export async function* generateDocument(
  caseFolder: string,
  docType: DocumentType,
  userPrompt: string
): AsyncGenerator<{ type: string; content?: string; filePath?: string; previewPath?: string; docxPath?: string; done?: boolean }> {
  if (!DOC_AGENT_TWO_PHASE_ENABLED) {
    yield* generateDocumentLegacy(caseFolder, docType, userPrompt);
    return;
  }

  const firmRoot = resolveFirmRoot(caseFolder);
  const pathContext = await buildDocAgentPathContext(caseFolder, firmRoot);
  const options = DEFAULT_DOC_GEN_OPTIONS;
  const traceRunId = `docgen-two-phase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const traceDir = join(caseFolder, ".ai_tool", "logs");
  const tracePath = join(traceDir, `${traceRunId}.jsonl`);
  const tracePathRel = `.ai_tool/logs/${traceRunId}.jsonl`;

  await mkdir(traceDir, { recursive: true });
  const trace = async (event: Record<string, any>) => {
    try {
      await appendDocGenTrace(tracePath, event);
    } catch (err) {
      console.warn(
        `[DocAgent] Failed to append trace at ${tracePathRel}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  await trace({
    event: "start",
    mode: "two_phase",
    docType,
    caseFolder,
    userPromptPreview: truncateForTrace(userPrompt),
    options,
  });
  await trace({
    event: "path_context",
    clientSlug: pathContext.clientSlug,
    hasRegistry: Boolean(pathContext.registry),
    yearSources: pathContext.yearSources.map((source) => ({
      prefix: source.prefix,
      year: source.year,
      root: source.root,
    })),
  });

  yield { type: "status", content: "Reasearching ..." };

  const [caseIndex, knowledge, firmConfig, narrowedTemplates] = await Promise.all([
    loadCaseIndex(caseFolder),
    loadSectionsByIds(firmRoot),
    loadFirmConfig(firmRoot),
    loadNarrowedTemplates(firmRoot, docType, userPrompt),
  ]);
  const caseContext = await buildCasePromptContext(caseFolder, caseIndex);

  await trace({
    event: "context_loaded",
    caseContextChars: caseContext.length,
    knowledgeChars: knowledge.length,
    templateChars: narrowedTemplates.context.length,
    selectedTemplateIds: narrowedTemplates.selectedTemplateIds,
  });

  const researchSystemPrompt = buildResearchSystemPrompt(
    docType,
    knowledge,
    firmConfig,
    options.researchMaxTurns
  );
  const researchMessage = `CASE CONTEXT:
${caseContext}

USER REQUEST:
${userPrompt}

Compile all necessary drafting information for the composing agent.
Collect grounded facts and source references only.`;

  const researchResult = await runResearchPhase({
    caseFolder,
    firmRoot,
    docType,
    seedPrompt: userPrompt,
    pathContext,
    systemPrompt: researchSystemPrompt,
    userMessage: researchMessage,
    maxTurns: options.researchMaxTurns,
    trace,
  });

  const researchPacketMarkdown = researchResult.packetMarkdown;
  await trace({
    event: "phase_done",
    phase: "research",
    turns: researchResult.turns,
    completionReason: researchResult.completionReason,
    packetChars: researchPacketMarkdown.length,
    packetPreview: truncateForTrace(researchPacketMarkdown, 2600),
  });

  yield { type: "status", content: "Drafting (this may take a few minutes) ..." };

  const composeResult = await runComposePhase({
    docType,
    userPrompt,
    caseContext,
    researchPacketMarkdown,
    templateContext: narrowedTemplates.context,
    knowledge,
    firmConfig,
    trace,
  });

  let draftContent = composeResult.content;
  let fallbackUsed = false;
  let fallbackReason: string | undefined = composeResult.error;

  const thinCheck = isDraftTooThin(draftContent, docType);
  if (!fallbackReason && thinCheck.thin) {
    fallbackReason = thinCheck.reason;
  }

  if (fallbackReason) {
    fallbackUsed = true;
    draftContent = buildFallbackDraftContent(docType, userPrompt, researchPacketMarkdown, fallbackReason);
  }

  await trace({
    event: "phase_done",
    phase: "compose",
    composeChars: draftContent.length,
    composeError: composeResult.error,
    budgetNotes: composeResult.budgetNotes,
    fallbackUsed,
    fallbackReason,
  });

  yield { type: "status", content: "Saving" };
  const saveResult = await persistDraftContent(caseFolder, firmRoot, docType, pathContext, draftContent);

  if (!saveResult.filePath) {
    const saveError = `Unable to save generated draft. ${saveResult.result || ""}`.trim();
    await trace({
      event: "error",
      phase: "save",
      failureReason: saveError,
      fallbackUsed,
      fallbackReason,
    });
    yield { type: "error", content: `${saveError} (trace: ${tracePathRel})` };
    yield {
      type: "done",
      done: true,
      content: `${saveError} (trace: ${tracePathRel})`,
    };
    return;
  }

  if (fallbackUsed) {
    yield { type: "status", content: "Saved (fallback)" };
    yield {
      type: "text",
      content: `Saved fallback draft scaffold with [VERIFY] placeholders. Reason: ${fallbackReason || "Compose returned incomplete output."}`,
    };
  }

  await trace({
    event: "done",
    mode: "two_phase",
    filePath: saveResult.filePath,
    previewPath: saveResult.previewPath,
    docxPath: saveResult.docxPath,
    fallbackUsed,
    fallbackReason,
  });

  yield {
    type: "done",
    done: true,
    content: fallbackUsed ? `Saved fallback draft: ${fallbackReason || "incomplete compose output."}` : undefined,
    filePath: saveResult.filePath,
    previewPath: saveResult.previewPath,
    docxPath: saveResult.docxPath,
  };
}

/**
 * Detect if a user message is requesting document generation.
 * Returns the document type if detected, null otherwise.
 */
export function detectDocGenIntent(message: string): { type: DocumentType; prompt: string } | null {
  const lower = message.toLowerCase();

  // Must have a generation verb
  const genWords = /\b(draft|write|generate|create|prepare|make)\b/;
  if (!genWords.test(lower)) return null;

  // Check for specific document types
  const patterns: Array<{ keywords: string[]; type: DocumentType }> = [
    { keywords: ["demand letter", "demand"], type: "demand_letter" },
    { keywords: ["case memo", "memo", "memorandum"], type: "case_memo" },
    { keywords: ["decision and order", "decision & order", "appeals officer decision", "hearing decision", "dao"], type: "decision_order" },
    { keywords: ["settlement", "disbursement", "calculation"], type: "settlement" },
    { keywords: ["letter"], type: "general_letter" }
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some(k => lower.includes(k))) {
      return { type: pattern.type, prompt: message };
    }
  }

  return null;
}
