/**
 * Direct Chat API
 *
 * Fast, lightweight chat using direct Anthropic API calls instead of Agent SDK.
 * For most queries, answers from context without tool calls.
 * Tools only invoked when explicitly needed.
 *
 * Complex document generation (demand letters, memos, etc.) is delegated to
 * a Sonnet-powered document agent with full template and knowledge access.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, dirname, resolve, sep } from "path";
import { resolveFirmRoot } from "./year-mode";
import { generateDocument, type DocumentType } from "./doc-agent";
import { readDocument } from "./doc-reader";
import { acquireCaseLock, releaseCaseLock } from "./case-lock";
import {
  buildEvidencePacket,
  type EvidencePacketDocumentInput,
  type EvidencePacketOrderRule,
  type EvidencePacketRedactionOptions,
  type EvidencePacketServiceInfo,
} from "./evidence-packet";
import { loadFirmInfo } from "./export";
import { applyResolvedFieldToSummary } from "./index-summary-sync";
import { extractPdfText } from "./pdftotext";
import { extractTextFromDocx } from "./extract";
import { generateMetaIndex, splitIndexToFolders, buildMetaIndexPromptView, writeIndexDerivedFiles } from "./meta-index";
import { generateHypergraph } from "../routes/firm";
import { buildDocumentId, buildDocumentIdFromPath } from "./document-id";
import { generateTagsForAllSections, type SectionSemanticTags } from "./knowledge-tagger";

// Client creation - recreated when API key changes
// Web shim (imported in server/index.ts) handles runtime selection
let _anthropic: Anthropic | null = null;
let _lastApiKey: string | undefined = undefined;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Recreate client if API key changed (e.g., was undefined, now set by auth)
  if (_anthropic && _lastApiKey !== apiKey) {
    _anthropic = null;
  }

  if (!_anthropic) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Auth middleware may have been bypassed.");
    }

    _anthropic = new Anthropic({
      apiKey: apiKey,
      fetch: globalThis.fetch.bind(globalThis),
    });
    _lastApiKey = apiKey;
  }
  return _anthropic;
}

// Message format for conversation history
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentDocumentView {
  id: string;
  name: string;
  description?: string;
  paths: string[];
  sortBy?: "folder" | "date" | "type";
  sortDirection?: "asc" | "desc";
  createdAt: string;
  totalMatches: number;
  invalidPaths?: string[];
}

const CASE_CONTEXT_MAX_CHARS = 180000;
const INDEX_SLICE_MAX_CHARS = 12000;
const CONFLICT_BATCH_DEFAULT = 25;
const CONFLICT_BATCH_MAX = 80;
const KNOWLEDGE_PREVIEW_CHARS = 420;
const KNOWLEDGE_META_INDEX_MAX_CHARS = 16000;
const KNOWLEDGE_META_INDEX_PATH = ".ai_tool/knowledge/meta_index.json";

interface MetaKnowledgeSection {
  id?: string;
  title: string;
  filename: string;
  path: string;
  preview: string;
  char_count: number;
  topics?: string[];
  applies_to?: string[];
  summary?: string;
}

interface MetaKnowledgeIndex {
  indexed_at: string;
  source: string;
  practice_area?: string;
  jurisdiction?: string;
  section_count: number;
  sections: MetaKnowledgeSection[];
  source_mtime?: number;
  section_mtimes?: Record<string, number>;
  has_semantic_tags?: boolean;
}

// Tool definitions
const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file in the case folder. Use for text documents, DOCX files, PDFs when OCR/text extraction is sufficient, JSON, and indexed artifacts.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Intake/Intake.pdf', 'Intake/Notice.docx', or '.ai_tool/document_index.json')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "read_index_slice",
    description: "Read a bounded slice of .ai_tool/document_index.json for very large cases. Use this when you need more detail than the meta-index provides.",
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
    name: "rerun_hypergraph",
    description: "Re-run hypergraph analysis from existing document_index.json (no extraction). Writes .ai_tool/hypergraph_analysis.json and can refresh needs_review.",
    input_schema: {
      type: "object" as const,
      properties: {
        apply_to_index: {
          type: "boolean",
          description: "If true (default), update needs_review in document_index.json using the new conflicts."
        },
        note: {
          type: "string",
          description: "Optional note explaining why hypergraph was re-run."
        }
      },
      required: []
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the case folder. Use for creating documents, memos, or updating files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "update_index",
    description: "Update a field in the case's document_index.json. Use when user provides corrections or new information.",
    input_schema: {
      type: "object" as const,
      properties: {
        field_path: {
          type: "string",
          description: "Dot-notation path to the field (e.g., 'summary.client', 'case_phase', 'summary.contact.phone', 'summary.policy_limits')"
        },
        value: {
          description: "New value for the field. Can be a string, number, object, or array depending on the field."
        },
        note: {
          type: "string",
          description: "Brief note about why this was updated"
        }
      },
      required: ["field_path", "value"]
    }
  },
  {
    name: "update_case_summary",
    description: "Update the canonical case summary fields in document_index.json. Prefer this over update_index when editing narrative summary or phase.",
    input_schema: {
      type: "object" as const,
      properties: {
        case_summary: {
          type: "string",
          description: "The narrative summary text to save to summary.case_summary."
        },
        case_phase: {
          type: "string",
          description: "Optional current phase to save to case_phase."
        },
        note: {
          type: "string",
          description: "Optional audit note for why the summary was updated."
        }
      },
      required: ["case_summary"]
    }
  },
  {
    name: "generate_document",
    description: "Delegate to a specialized agent to draft a formal document. Use this when the user asks you to write, draft, create, or generate a document like a demand letter, case memo, settlement calculation, formal letter, or a hearing Decision & Order. The agent has access to templates and will create a complete, professional document.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: {
          type: "string",
          enum: ["demand_letter", "case_memo", "settlement", "general_letter", "decision_order"],
          description: "Type of document to generate: demand_letter (to insurance), case_memo (internal summary), settlement (disbursement calc), general_letter (LOP, records request, etc.), decision_order (post-hearing Decision & Order draft)."
        },
        instructions: {
          type: "string",
          description: "Specific instructions for the document (e.g., 'Focus on the soft tissue injuries', 'Include future medical needs'). Pass along any specific requests from the user."
        }
      },
      required: ["document_type", "instructions"]
    }
  },
  {
    name: "read_document",
    description: "Read a PDF with vision support, especially useful for scanned/complex PDFs where layout matters. Spawns a specialist that can see rendered pages (forms, tables, handwriting, images) not just extracted text. Use this only for PDF documents, not DOCX.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (PDF only), e.g., 'Intake/Intake.pdf', 'Medical/MRI_Report.pdf'"
        },
        question: {
          type: "string",
          description: "What you want to know about the document (e.g., 'What injuries are documented?', 'What are the total charges?')"
        }
      },
      required: ["path", "question"]
    }
  },
  {
    name: "update_file_entry",
    description: "Update a specific file's entry in the document index after re-reading it. Use when the user asks you to re-read a document and then confirms the extracted information should be saved. Only update when the user explicitly confirms.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder: {
          type: "string",
          description: "Exact folder name from the index (e.g., 'Claim File (Checked for Determs)', 'Intake', 'Medical/Concentra')"
        },
        filename: {
          type: "string",
          description: "Exact filename within the folder (e.g., 'DWC D-8 Wages.PDF')"
        },
        updates: {
          type: "object",
          description: "Fields to update on the file entry. Include only the fields that need changing.",
          properties: {
            key_info: { type: "string", description: "Updated summary of the document's key information" },
            type: { type: "string", description: "Document type (e.g., 'medical_bill', 'medical_record', 'correspondence', 'other')" },
            date: { type: "string", description: "Document date in YYYY-MM-DD format" },
            extracted_data: { description: "Structured data extracted from the document" },
            issues: { type: "string", description: "Any issues found, or null if extraction was successful" }
          }
        },
        note: {
          type: "string",
          description: "Brief note about what was updated and why"
        }
      },
      required: ["folder", "filename", "updates"]
    }
  },
  {
    name: "create_document_view",
    description: "Create a temporary filtered document view in the file panel based on explicit document paths from document_index.json. Use when the user asks to show a subset of documents (for example, medical records, hearing notices, records from a specific provider, or chronological views).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Short label for the generated view (example: 'Medical Records')."
        },
        description: {
          type: "string",
          description: "Optional one-line explanation shown in the file panel."
        },
        documents: {
          type: "array",
          description: "Documents to include. Each item can be a path string or an object with path.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
        sort_by: {
          type: "string",
          enum: ["folder", "date", "type"],
          description: "Optional preferred sort mode for this view."
        },
        sort_direction: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Optional sort direction (used when sort_by is date)."
        },
      },
      required: ["documents"]
    }
  },
  {
    name: "create_evidence_packet",
    description: "Plan an evidence packet for a workers' compensation hearing. Returns instructions to review documents with the user before building. Does NOT generate a PDF — use build_evidence_packet after the user confirms the document list.",
    input_schema: {
      type: "object" as const,
      properties: {
        hearing_number: {
          type: "string",
          description: "Hearing number (examples: '2680509-RA' or 'HO-2680509-RA'). Optional if the case has exactly one hearing."
        },
      },
      required: []
    }
  },
  {
    name: "build_evidence_packet",
    description: "Open the Packet Creation UI with a curated, ordered document list. Use after planning/selecting order with the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        hearing_number: {
          type: "string",
          description: "Hearing number for caption/output naming (example: '2680509-RA')."
        },
        documents: {
          type: "array",
          description: "Explicit ordered list of indexed documents to include. Prefer doc_id values from create_evidence_packet output; path or filename+folder is accepted as a compatibility fallback.",
          items: {
            type: "object",
            properties: {
              doc_id: { type: "string" },
              docId: { type: "string" },
              document_id: { type: "string" },
              documentId: { type: "string" },
              id: { type: "string" },
              path: { type: "string" },
              folder: { type: "string" },
              title: { type: "string" },
              date: { type: "string" },
              doc_type: { type: "string" },
              docType: { type: "string" },
              include: { type: "boolean" },
              fileName: { type: "string" },
              filename: { type: "string" },
              file: { type: "string" },
            },
            required: [],
          },
        },
        output_path: {
          type: "string",
          description: "Optional relative output path for packet PDF."
        },
        hearing_datetime: {
          type: "string",
          description: "Optional hearing date/time string for caption."
        },
        appearance: {
          type: "string",
          description: "Optional appearance line for caption."
        },
        redaction_mode: {
          type: "string",
          enum: ["off", "detect_only", "best_effort"],
          description: "PII mode."
        },
        include_affirmation_page: {
          type: "boolean",
          description: "Optional override for affirmation/certificate page."
        },
        page_stamp_start: {
          type: "number",
          description: "Optional exhibit page start number."
        },
        claim_number: {
          type: "string",
          description: "The workers' compensation claim number (e.g. 'WC-2024-001234'). Extracted from the document index or case documents."
        },
        hearing_type: {
          type: "string",
          enum: ["HO", "AO"],
          description: "Type of hearing: 'HO' for Hearing Officer (default), 'AO' for Appeals Officer (appeal of a previous decision)."
        },
        issue_on_appeal: {
          type: "string",
          description: "For Appeals Officer (AO) hearings: a 1-2 sentence summary of the issue on appeal. Leave empty for Hearing Officer (HO) hearings."
        },
        service: {
          type: "object",
          properties: {
            service_date: { type: "string" },
            service_method: { type: "string" },
            recipients: { type: "array", items: { type: "string" } },
            served_by: { type: "string" },
            serviceDate: { type: "string" },
            serviceMethod: { type: "string" },
            servedBy: { type: "string" },
          },
        },
      },
      required: ["documents"]
    }
  },
  {
    name: "get_conflicts",
    description: "Get document conflicts that need review. Returns a paged set of needs_review items with their conflicting values and sources. Use this when the user wants to review conflicts in batches.",
    input_schema: {
      type: "object" as const,
      properties: {
        offset: {
          type: "number",
          description: "0-based conflict offset to start paging from."
        },
        limit: {
          type: "number",
          description: "Maximum items in this batch. Default 25, max 80."
        }
      },
      required: []
    }
  },
  {
    name: "batch_resolve_conflicts",
    description: "Resolve multiple conflicts at once. Use after presenting recommendations and getting user approval. Pass an array of resolutions.",
    input_schema: {
      type: "object" as const,
      properties: {
        resolutions: {
          type: "array",
          description: "Array of conflict resolutions",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "The EXACT field name from needs_review (e.g., 'insurance_claim_numbers', 'total_medical', 'charges:Provider Name')" },
              resolved_value: { type: "string", description: "The correct value" },
              evidence: { type: "string", description: "Brief explanation" }
            },
            required: ["field", "resolved_value"]
          }
        }
      },
      required: ["resolutions"]
    }
  },
  {
    name: "resolve_conflict",
    description: "Resolve a specific conflict from needs_review. Use this after the user has reviewed a conflict and told you which value is correct. This removes the item from needs_review, adds it to errata for audit trail, and updates summary fields if applicable.",
    input_schema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          description: "The EXACT field name from needs_review. Common fields: 'insurance_claim_numbers', 'total_medical', 'date_of_loss', 'date_of_birth', 'client_name', 'policy_limits'. For provider charges: 'charges:Provider Name'"
        },
        resolved_value: {
          type: "string",
          description: "The correct value the user confirmed"
        },
        evidence: {
          type: "string",
          description: "Brief explanation of why this value is correct (e.g., 'Per original invoice', 'User confirmed from police report')"
        }
      },
      required: ["field", "resolved_value"]
    }
  }
];

const WRITE_TOOLS = new Set([
  "write_file",
  "update_index",
  "update_file_entry",
  "rerun_hypergraph",
  "generate_document",
  "build_evidence_packet",
  "batch_resolve_conflicts",
  "resolve_conflict",
]);

function getTools(readOnlyMode: boolean): Anthropic.Tool[] {
  if (!readOnlyMode) return TOOLS;
  return TOOLS.filter((tool) => !WRITE_TOOLS.has(tool.name));
}

function normalizeFieldName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[''`]/g, "'");
}

// Fuzzy field matching - handles casing, whitespace, and punctuation variations
function findFieldIndex(needsReview: any[], field: string): number {
  // Tier 1: Exact match
  const exact = needsReview.findIndex((item: any) => item.field === field);
  if (exact !== -1) return exact;

  // Tier 2: Case-insensitive + trimmed
  const normalizedField = field.trim().toLowerCase();
  const ci = needsReview.findIndex((item: any) =>
    item.field?.trim().toLowerCase() === normalizedField
  );
  if (ci !== -1) return ci;

  // Tier 3: Normalize punctuation (underscores, colons, apostrophe variants)
  const norm = normalizeFieldName(field);
  const normMatch = needsReview.findIndex((item: any) =>
    normalizeFieldName(item.field || "") === norm
  );
  if (normMatch !== -1) return normMatch;

  return -1;
}

function findMatchingFieldIndexes(needsReview: any[], field: string): number[] {
  const matchIndex = findFieldIndex(needsReview, field);
  if (matchIndex === -1) return [];

  const matchedField = needsReview[matchIndex]?.field ?? field;
  const normalizedMatchedField = normalizeFieldName(matchedField);
  const indexes: number[] = [];

  for (let i = 0; i < needsReview.length; i++) {
    if (normalizeFieldName(needsReview[i]?.field || "") === normalizedMatchedField) {
      indexes.push(i);
    }
  }

  return indexes;
}

function dedupeNeedsReviewEntries(needsReview: any[]): any[] {
  const merged = new Map<string, {
    field: string;
    conflicting_values: Set<string>;
    sources: Set<string>;
    reasons: Set<string>;
  }>();

  for (const item of needsReview || []) {
    const field = item?.field;
    const key = normalizeFieldName(field || "");
    if (!key) continue;

    let existing = merged.get(key);
    if (!existing) {
      existing = {
        field: field || "",
        conflicting_values: new Set<string>(),
        sources: new Set<string>(),
        reasons: new Set<string>(),
      };
      merged.set(key, existing);
    }

    for (const value of Array.isArray(item?.conflicting_values) ? item.conflicting_values : []) {
      existing.conflicting_values.add(String(value));
    }
    for (const source of Array.isArray(item?.sources) ? item.sources : []) {
      existing.sources.add(String(source));
    }
    if (item?.reason) {
      existing.reasons.add(String(item.reason));
    }
  }

  return Array.from(merged.values()).map((item) => {
    const reasons = Array.from(item.reasons);
    return {
      field: item.field,
      conflicting_values: Array.from(item.conflicting_values),
      sources: Array.from(item.sources),
      reason: reasons.length > 0 ? reasons.join(" | ") : "Conflicting values found",
    };
  });
}

interface KnowledgeEvidencePacketConfig {
  orderRules?: EvidencePacketOrderRule[];
  includePathRegexes?: string[];
  excludePathRegexes?: string[];
  includeAffirmationPage?: boolean;
  pageStampPrefix?: string;
  pageStampStart?: number;
  service?: EvidencePacketServiceInfo;
  defaultRedactionMode?: "off" | "detect_only" | "best_effort";
}

interface IndexedPdfDoc {
  path: string;
  title: string;
  date?: string;
  docType?: string;
}


function safeJsonParse<T = any>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeSectionFilename(section: any): string | null {
  const filename = typeof section?.filename === "string" ? section.filename : section?.file;
  return typeof filename === "string" && filename.trim() ? filename.trim() : null;
}

function normalizeServiceInput(raw: any): EvidencePacketServiceInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    serviceDate: typeof raw.serviceDate === "string"
      ? raw.serviceDate
      : typeof raw.service_date === "string"
        ? raw.service_date
        : undefined,
    serviceMethod: typeof raw.serviceMethod === "string"
      ? raw.serviceMethod
      : typeof raw.service_method === "string"
        ? raw.service_method
        : undefined,
    recipients: Array.isArray(raw.recipients)
      ? raw.recipients.filter((v: any) => typeof v === "string")
      : undefined,
    servedBy: typeof raw.servedBy === "string"
      ? raw.servedBy
      : typeof raw.served_by === "string"
        ? raw.served_by
        : undefined,
  };
}

function normalizeHearingNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^ho-/i.test(trimmed) ? trimmed : `HO-${trimmed}`;
}

function extractHearingCore(input: string): string {
  return normalizeHearingNumber(input).replace(/^ho-/i, "");
}

function hearingSearchTokens(hearingNumber: string): string[] {
  const normalized = normalizeHearingNumber(hearingNumber).toLowerCase();
  const core = normalized.replace(/^ho-/, "");
  const digits = core.replace(/[^0-9]/g, "");
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const coreCompact = core.replace(/[^a-z0-9]/g, "");

  const tokens = [normalized, core, compact, coreCompact, digits]
    .map((token) => token.trim())
    .filter((token, idx, arr) => token.length > 0 && arr.indexOf(token) === idx);
  return tokens;
}

function valueMatchesHearing(value: string, tokens: string[]): boolean {
  const lower = value.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return tokens.some((token) => {
    if (!token) return false;
    if (lower.includes(token)) return true;
    if (token.length >= 6 && compact.includes(token.replace(/[^a-z0-9]/g, ""))) return true;
    return false;
  });
}

function parseDateFromFilename(filename: string): string | undefined {
  const dateMatch = filename.match(/\b(20\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})\b/);
  if (!dateMatch) return undefined;
  const year = dateMatch[1];
  const month = dateMatch[2].padStart(2, "0");
  const day = dateMatch[3].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderDocumentTitle(value: string | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "selected document" || normalized === "selected doc" || normalized === "document") {
    return true;
  }
  return /^doc_[a-f0-9]{8}$/i.test(normalized);
}

function inferDocType(title: string, path: string): string | undefined {
  const value = `${title} ${path}`.toLowerCase();
  if (/\bc-?3\b/.test(value)) return "c3";
  if (/\bc-?4\b/.test(value)) return "c4";
  if (/notice of hearing|hearing notice/.test(value)) return "notice_of_hearing";
  if (/notice of claim acceptance|acceptance|denial/.test(value)) return "claim_acceptance_or_denial";
  if (/notice of appearance|representation|letter of representation/.test(value)) return "representation";
  if (/ppd|ime|medical report|doctor|dr\./.test(value)) return "medical_report";
  if (/request|letter|correspondence|memo/.test(value)) return "correspondence";
  return undefined;
}

function normalizeRelativePathForLookup(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim()
    .toLowerCase();
}

function normalizeFolderForPath(path: string): string {
  const normalized = normalizeRelativePathForLookup(path);
  if (normalized === "." || normalized === "./") return "";
  return normalized.replace(/\/+$/, "");
}

function collectIndexedDocumentPathMap(indexData: any): Map<string, string> {
  const pathMap = new Map<string, string>();
  const folders = indexData?.folders || {};

  for (const [folderNameRaw, folderData] of Object.entries(folders)) {
    let docs: any[] = [];
    if (Array.isArray(folderData)) {
      docs = folderData;
    } else if (folderData && typeof folderData === "object" && Array.isArray((folderData as any).files)) {
      docs = (folderData as any).files;
    } else if (folderData && typeof folderData === "object" && Array.isArray((folderData as any).documents)) {
      docs = (folderData as any).documents;
    }

    const folderName = normalizeFolderForPath(String(folderNameRaw || ""));

    for (const doc of docs) {
      const filename = typeof doc === "string"
        ? doc
        : typeof doc?.filename === "string"
          ? doc.filename
          : typeof doc?.file === "string"
            ? doc.file
            : "";
      if (!filename) continue;

      const canonicalPath = folderName ? `${folderName}/${filename}` : filename;
      const normalizedPath = normalizeRelativePathForLookup(canonicalPath);
      if (!normalizedPath) continue;

      if (!pathMap.has(normalizedPath)) {
        pathMap.set(normalizedPath, canonicalPath);
      }
    }
  }

  return pathMap;
}

function normalizeDocumentViewSortBy(value: any): "folder" | "date" | "type" | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "folder" || normalized === "date" || normalized === "type") {
    return normalized;
  }
  return undefined;
}

function normalizeDocumentViewSortDirection(value: any): "asc" | "desc" | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return undefined;
}

function truncateForIndex(value: string, max = KNOWLEDGE_PREVIEW_CHARS): string {
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function toMetaKnowledgePath(filename: string): string {
  return `.ai_tool/knowledge/${filename}`;
}

async function getFileMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

function getManifestSections(manifest: Record<string, any> | null): any[] {
  if (!manifest || !Array.isArray(manifest.sections)) return [];
  return manifest.sections.filter((section: any) => section && typeof section === "object");
}

async function buildMetaKnowledgeIndex(
  firmRoot: string,
  manifest?: Record<string, any>,
  manifestMtimeMs?: number,
  precomputedTags?: Map<string, SectionSemanticTags>
): Promise<MetaKnowledgeIndex | null> {
  const knowledgeDir = join(firmRoot, ".ai_tool", "knowledge");
  const manifestPath = join(knowledgeDir, "manifest.json");

  try {
    const loadedManifest = manifest
      || safeJsonParse<Record<string, any>>(await readFile(manifestPath, "utf-8"));
    if (!loadedManifest) return null;

    const sectionsData = getManifestSections(loadedManifest);
    const sectionMtimes: Record<string, number> = {};
    const sections: MetaKnowledgeSection[] = [];
    const seenFilenames = new Set<string>();

    for (const section of sectionsData) {
      const filename = normalizeSectionFilename(section) || "";
      if (!filename || seenFilenames.has(filename)) {
        continue;
      }
      seenFilenames.add(filename);

      const title = typeof section.title === "string" && section.title.trim()
        ? section.title.trim()
        : typeof section.name === "string" && section.name.trim()
          ? section.name.trim()
          : filename;

      let snippet = "";
      let charCount = 0;
      const sectionPath = join(knowledgeDir, filename);
      const sectionMtime = await getFileMtimeMs(sectionPath);
      if (sectionMtime !== null) {
        sectionMtimes[filename] = sectionMtime;
      }

      if (sectionMtime !== null) {
        try {
          const sectionContent = await readFile(sectionPath, "utf-8");
          charCount = sectionContent.length;
          const firstLine = sectionContent.split(/\r?\n/)[0] || "";
          const body = sectionContent.slice(firstLine.length).trim();
          snippet = truncateForIndex(`${firstLine} ${body}`.trim());
        } catch {
          // Ignore unreadable sections
        }
      }

      const sectionEntry: MetaKnowledgeSection = {
        id: typeof section.id === "string" ? section.id : undefined,
        title,
        filename,
        path: toMetaKnowledgePath(filename),
        preview: snippet,
        char_count: charCount,
      };

      const tags = precomputedTags?.get(filename);
      if (tags) {
        sectionEntry.topics = tags.topics;
        sectionEntry.applies_to = tags.applies_to;
        sectionEntry.summary = tags.summary;
      }

      sections.push(sectionEntry);
    }

    const hasSemanticTags = precomputedTags !== undefined && precomputedTags.size > 0;

    return {
      indexed_at: new Date().toISOString(),
      source: ".ai_tool/knowledge/manifest.json",
      source_mtime: manifestMtimeMs,
      practice_area: typeof loadedManifest.practiceArea === "string"
        ? loadedManifest.practiceArea
        : typeof loadedManifest.practice_area === "string"
          ? loadedManifest.practice_area
          : undefined,
      jurisdiction: typeof loadedManifest.jurisdiction === "string"
        ? loadedManifest.jurisdiction
        : typeof loadedManifest.jurisdiction_area === "string"
          ? loadedManifest.jurisdiction_area
          : undefined,
      section_count: sections.length,
      sections,
      section_mtimes: sectionMtimes,
      has_semantic_tags: hasSemanticTags || undefined,
    };
  } catch {
    return null;
  }
}

async function getOrBuildMetaKnowledgeIndex(firmRoot: string): Promise<MetaKnowledgeIndex | null> {
  const knowledgeDir = join(firmRoot, ".ai_tool", "knowledge");
  const manifestPath = join(knowledgeDir, "manifest.json");
  const cachePath = join(firmRoot, KNOWLEDGE_META_INDEX_PATH);

  const manifestRaw = await readFile(manifestPath, "utf-8").catch(() => null);
  if (!manifestRaw) return null;
  const manifest = safeJsonParse<Record<string, any>>(manifestRaw);
  if (!manifest) return null;

  const sectionsData = getManifestSections(manifest);
  const sourceMtime = await getFileMtimeMs(manifestPath);
  if (sourceMtime === null) {
    return buildMetaKnowledgeIndex(firmRoot, manifest, undefined);
  }
  const manifestPracticeArea = typeof manifest.practiceArea === "string"
    ? manifest.practiceArea
    : typeof manifest.practice_area === "string"
      ? manifest.practice_area
      : undefined;
  const manifestJurisdiction = typeof manifest.jurisdiction === "string"
    ? manifest.jurisdiction
    : typeof manifest.jurisdiction_area === "string"
      ? manifest.jurisdiction_area
      : undefined;

  const cachedRaw = await readFile(cachePath, "utf-8").catch(() => null);
  const cached = safeJsonParse<MetaKnowledgeIndex>(cachedRaw || "");
  if (
    cached &&
    cached.source === ".ai_tool/knowledge/manifest.json" &&
    cached.section_count === sectionsData.length &&
    cached.source_mtime === sourceMtime &&
    cached.practice_area === manifestPracticeArea &&
    cached.jurisdiction === manifestJurisdiction &&
    cached.section_mtimes
  ) {
    let matches = true;
    const seen = new Set<string>();

    for (const section of sectionsData) {
      const filename = normalizeSectionFilename(section) || "";
      if (!filename || seen.has(filename)) {
        continue;
      }
      seen.add(filename);

      const currentMtime = await getFileMtimeMs(join(knowledgeDir, filename));
      if (currentMtime === null || cached.section_mtimes[filename] !== currentMtime) {
        matches = false;
        break;
      }
    }

    if (matches) {
      const cachedFiles = Object.keys(cached.section_mtimes || {});
      if (seen.size === cachedFiles.length && cachedFiles.every((file) => seen.has(file))) {
        // If cached index has semantic tags, it's fully valid
        if (cached.has_semantic_tags) {
          return cached;
        }
        // Otherwise fall through to rebuild with tags
      }
    }
  }

  // Read all section contents for Haiku tagging
  let precomputedTags: Map<string, SectionSemanticTags> | undefined;
  try {
    const tagInputs: Array<{ filename: string; title: string; content: string }> = [];
    for (const section of sectionsData) {
      const filename = normalizeSectionFilename(section) || "";
      if (!filename) continue;
      try {
        const content = await readFile(join(knowledgeDir, filename), "utf-8");
        const title = typeof section.title === "string" ? section.title : filename;
        tagInputs.push({ filename, title, content });
      } catch {
        // Skip unreadable sections
      }
    }
    if (tagInputs.length > 0) {
      precomputedTags = await generateTagsForAllSections(tagInputs);
    }
  } catch (err) {
    console.warn("[meta-index] Semantic tagging failed, building without tags:", err instanceof Error ? err.message : err);
  }

  const rebuilt = await buildMetaKnowledgeIndex(firmRoot, manifest, sourceMtime, precomputedTags);
  if (!rebuilt) return null;

  await writeFile(cachePath, JSON.stringify(rebuilt, null, 2)).catch(() => {});
  return rebuilt;
}

/**
 * Patch a single section's semantic tags in the persisted meta_index.json
 * without rebuilding the entire index. Used by CRUD hooks for incremental updates.
 */
export async function updateMetaIndexSectionTags(
  firmRoot: string,
  filename: string,
  tags: SectionSemanticTags
): Promise<void> {
  const cachePath = join(firmRoot, KNOWLEDGE_META_INDEX_PATH);
  try {
    const raw = await readFile(cachePath, "utf-8");
    const index = safeJsonParse<MetaKnowledgeIndex>(raw);
    if (!index || !Array.isArray(index.sections)) return;

    const section = index.sections.find((s) => s.filename === filename);
    if (section) {
      section.topics = tags.topics;
      section.applies_to = tags.applies_to;
      section.summary = tags.summary;
      index.has_semantic_tags = index.sections.some(
        (s) => s.topics || s.applies_to || s.summary
      );
      await writeFile(cachePath, JSON.stringify(index, null, 2));
    }
  } catch {
    // meta_index.json doesn't exist yet or is invalid — will be rebuilt on next access
  }
}

/**
 * Find knowledge sections matching a given applies_to tag.
 */
export async function findKnowledgeSectionsByTag(
  firmRoot: string,
  tag: string
): Promise<MetaKnowledgeSection[]> {
  const metaIndex = await getOrBuildMetaKnowledgeIndex(firmRoot);
  if (!metaIndex) return [];
  return metaIndex.sections.filter((s) => s.applies_to?.includes(tag));
}

function buildMetaKnowledgeIndexText(index: MetaKnowledgeIndex | null): string {
  if (!index) {
    return "## PRACTICE KNOWLEDGE (META INDEX)\nNo knowledge index available in this case folder.\n";
  }

  const lines: string[] = [
    "## PRACTICE KNOWLEDGE (META INDEX)",
    `Source: ${index.source}`,
    `Jurisdiction: ${index.jurisdiction || "not specified"} | Practice Area: ${index.practice_area || "not specified"}`,
    `Indexed: ${index.indexed_at}`,
    `Sections: ${index.section_count}`,
  ];

  if (index.sections.length > 0) {
    lines.push("");
    for (const section of index.sections) {
      const header = section.id ? `${section.title} (${section.id})` : section.title;
      lines.push(`- ${header}: ${section.path} (${section.char_count} chars)`);
      if (section.summary) {
        lines.push(`  Purpose: ${section.summary}`);
      } else if (section.preview) {
        lines.push(`  Preview: ${section.preview}`);
      }
      if (section.applies_to && section.applies_to.length > 0) {
        lines.push(`  Applies to: ${section.applies_to.join(", ")}`);
      }
      if (section.topics && section.topics.length > 0) {
        lines.push(`  Topics: ${section.topics.join(", ")}`);
      }
    }
    lines.push(
      "Use read_file(\".ai_tool/knowledge/<filename>\") to load any section you need for full context."
    );
  }

  const rendered = lines.join("\n");
  if (rendered.length <= KNOWLEDGE_META_INDEX_MAX_CHARS) {
    return rendered;
  }
  return `${rendered.slice(0, KNOWLEDGE_META_INDEX_MAX_CHARS)}...`;
}

function buildMetaToolIndexText(): string {
  const toolHints = [
    "read_file — Use for case data and indexed artifacts (document_index.json, meta_index.json, per-folder indexes, and .ai_tool/knowledge/meta_index.json).",
    "read_index_slice — Bounded reads of .ai_tool/document_index.json for deep conflict/data review.",
    "rerun_hypergraph — Re-runs hypergraph from document_index.json and can refresh needs_review.",
    "update_index / update_case_summary / update_file_entry — Write into document_index.json fields and conflict decisions.",
    "generate_document — Delegates formal document drafting to the doc agent.",
    "create_document_view / get_conflicts / batch_resolve_conflicts / resolve_conflict — Review/resolve needs_review items in the same session.",
  ];

  return [
    "## TOOL INDEX (META)",
    "Core tools and where to use them:",
    ...toolHints.map((hint) => `- ${hint}`),
    "For full tool metadata, use the direct tool schema in this message context.",
  ].join("\n");
}


function summarizeCommonFolder(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const splitPaths = paths.map((path) => path.split("/").filter(Boolean));
  const first = splitPaths[0];
  let idx = 0;
  while (idx < first.length - 1) {
    const value = first[idx];
    if (splitPaths.some((parts) => parts[idx] !== value)) break;
    idx += 1;
  }
  if (idx === 0) return null;
  return first.slice(0, idx).join("/");
}


function inferHearingNumberFromDocs(docs: IndexedPdfDoc[]): string | null {
  const hearingCandidates = new Map<string, number>();
  const hoRegex = /ho[-_ ]?(\d{4,}-[a-z]{1,3})/ig;

  for (const doc of docs) {
    const target = `${doc.path} ${doc.title}`;
    let match: RegExpExecArray | null;
    while ((match = hoRegex.exec(target)) !== null) {
      const core = match[1].toUpperCase();
      hearingCandidates.set(core, (hearingCandidates.get(core) || 0) + 1);
    }
  }

  if (hearingCandidates.size === 1) {
    return Array.from(hearingCandidates.keys())[0];
  }
  return null;
}

function inferClaimNumber(indexData: any): string | undefined {
  const direct = indexData?.summary?.wc_carrier?.claim_number;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const claimNumbers = indexData?.summary?.claim_numbers;
  if (claimNumbers && typeof claimNumbers === "object") {
    for (const value of Object.values(claimNumbers)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function inferOutputPathFromDocs(docs: IndexedPdfDoc[], hearingNumber?: string, explicitPath?: string): string {
  if (explicitPath && explicitPath.trim()) return explicitPath.trim();

  if (!hearingNumber || !hearingNumber.trim()) {
    return "Litigation/Claimant Evidence Packet.pdf";
  }

  const normalizedHo = normalizeHearingNumber(hearingNumber).toUpperCase();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const folder = summarizeCommonFolder(docs.map((doc) => doc.path)) || "Litigation";
  return `${folder}/EFILED Claimant Index ${normalizedHo} ${dateStamp}.pdf`;
}

function resolveRedactionOptions(
  requestedMode: string | undefined,
  config: KnowledgeEvidencePacketConfig | null
): EvidencePacketRedactionOptions {
  const mode = (requestedMode || config?.defaultRedactionMode || "off").toLowerCase();
  if (mode === "detect_only") {
    return { enabled: true, mode: "detect_only" };
  }
  if (mode === "best_effort") {
    return { enabled: true, mode: "best_effort" };
  }
  return { enabled: false };
}

function normalizeDocumentsInput(raw: any): EvidencePacketDocumentInput[] {
  if (!Array.isArray(raw)) return [];
  const docs: EvidencePacketDocumentInput[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const selector = item.trim();
      if (!selector) continue;
      docs.push({
        path: selector, // Temporary selector container; canonicalized against the index before packet mode opens.
        title: "",
        include: true,
      });
      continue;
    }
    if (!item || typeof item !== "object") continue;

    const text = (value: unknown): string =>
      typeof value === "string" ? value.trim() : "";

    const docId = text(item.doc_id)
      || text(item.docId)
      || text(item.document_id)
      || text(item.documentId)
      || text(item.id);

    const path = text(item.path)
      || text(item.relative_path)
      || text(item.relativePath);

    const folder = text(item.folder)
      || text(item.folder_name)
      || text(item.folderName);
    const filename = text(item.fileName)
      || text(item.filename)
      || text(item.file);

    const normalizedFolder = folder
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
    const normalizedFilename = filename
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/");
    const joinedPath = normalizedFilename
      ? (normalizedFolder && normalizedFolder !== "." && normalizedFolder.toLowerCase() !== "root"
        ? `${normalizedFolder}/${normalizedFilename}`
        : normalizedFilename)
      : "";

    const selector = docId || path || joinedPath || normalizedFilename;
    if (!selector) continue;

    const title = text(item.title);
    const date = text(item.date);
    const docType = text(item.docType) || text(item.doc_type);

    docs.push({
      path: selector, // Temporary selector container; canonicalized against the index before packet mode opens.
      title,
      date: date || undefined,
      docType: docType || undefined,
      include: typeof item.include === "boolean" ? item.include : true,
    });
  }
  return docs;
}

function canonicalizePacketDocumentsFromIndex(
  documents: EvidencePacketDocumentInput[],
  indexData: any
): {
  documents: EvidencePacketDocumentInput[];
  unresolvedSelectors: string[];
} {
  const docIdToPath = new Map<string, string>();
  const normalizedPathToPath = new Map<string, string>();
  const normalizedBasenameToPath = new Map<string, string>();
  const pathMetadata = new Map<string, { title: string; date?: string; docType?: string }>();
  const ambiguousBasenames = new Set<string>();
  const folders = indexData?.folders || {};

  for (const [folderName, folderData] of Object.entries(folders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files || folderData?.documents || [];
    for (const file of files) {
      if (typeof file === "string") {
        const canonicalPath = folderName === "." || !folderName ? file : `${folderName}/${file}`;
        const docId = buildDocumentId(folderName, file);
        docIdToPath.set(docId, canonicalPath);
        pathMetadata.set(canonicalPath, { title: file });
        const normalizedPath = normalizeRelativePathForLookup(canonicalPath);
        const normalizedBasename = normalizeRelativePathForLookup(file);
        if (normalizedPath && !normalizedPathToPath.has(normalizedPath)) {
          normalizedPathToPath.set(normalizedPath, canonicalPath);
        }
        if (normalizedBasename) {
          if (!normalizedBasenameToPath.has(normalizedBasename)) {
            normalizedBasenameToPath.set(normalizedBasename, canonicalPath);
          } else if (normalizedBasenameToPath.get(normalizedBasename) !== canonicalPath) {
            ambiguousBasenames.add(normalizedBasename);
          }
        }
        continue;
      }
      const fileName = typeof file?.filename === "string"
        ? file.filename
        : typeof file?.file === "string"
          ? file.file
          : "";
      if (!fileName) continue;
      const canonicalPath = folderName === "." || !folderName ? fileName : `${folderName}/${fileName}`;
      const docId = typeof file?.doc_id === "string" && file.doc_id.trim()
        ? file.doc_id.trim()
        : buildDocumentId(folderName, fileName);
      docIdToPath.set(docId, canonicalPath);
      const rawTitle = typeof file?.title === "string" ? file.title.trim() : "";
      const metadataTitle = !isPlaceholderDocumentTitle(rawTitle) ? rawTitle : fileName;
      const metadataDate = typeof file?.date === "string" && file.date.trim() ? file.date.trim() : undefined;
      const metadataDocType = typeof file?.type === "string" && file.type.trim() ? file.type.trim() : undefined;
      pathMetadata.set(canonicalPath, {
        title: metadataTitle,
        date: metadataDate,
        docType: metadataDocType,
      });
      const normalizedPath = normalizeRelativePathForLookup(canonicalPath);
      const normalizedBasename = normalizeRelativePathForLookup(fileName);
      if (normalizedPath && !normalizedPathToPath.has(normalizedPath)) {
        normalizedPathToPath.set(normalizedPath, canonicalPath);
      }
      if (normalizedBasename) {
        if (!normalizedBasenameToPath.has(normalizedBasename)) {
          normalizedBasenameToPath.set(normalizedBasename, canonicalPath);
        } else if (normalizedBasenameToPath.get(normalizedBasename) !== canonicalPath) {
          ambiguousBasenames.add(normalizedBasename);
        }
      }
    }
  }

  const resolved: EvidencePacketDocumentInput[] = [];
  const unresolvedSelectors: string[] = [];

  for (const doc of documents) {
    const selector = doc.path.trim();
    if (!selector) {
      unresolvedSelectors.push(doc.path);
      continue;
    }
    let canonicalPath = docIdToPath.get(selector);
    if (!canonicalPath) {
      const normalizedSelector = normalizeRelativePathForLookup(selector);
      canonicalPath = normalizedPathToPath.get(normalizedSelector);
      if (!canonicalPath) {
        const basename = normalizeRelativePathForLookup(normalizedSelector.split("/").pop() || normalizedSelector);
        if (basename && !ambiguousBasenames.has(basename)) {
          canonicalPath = normalizedBasenameToPath.get(basename);
        }
      }
    }
    if (!canonicalPath) {
      unresolvedSelectors.push(selector);
      continue;
    }

    const metadata = pathMetadata.get(canonicalPath);
    const incomingTitle = typeof doc.title === "string" ? doc.title.trim() : "";
    const incomingDate = typeof doc.date === "string" && doc.date.trim() ? doc.date.trim() : undefined;
    const incomingDocType = typeof doc.docType === "string" && doc.docType.trim() ? doc.docType.trim() : undefined;
    const defaultTitle = canonicalPath.split("/").pop() || canonicalPath;
    const resolvedTitle = !isPlaceholderDocumentTitle(incomingTitle)
      ? incomingTitle
      : metadata?.title || defaultTitle;

    resolved.push({
      ...doc,
      path: canonicalPath,
      title: resolvedTitle,
      date: incomingDate || metadata?.date,
      docType: incomingDocType || metadata?.docType,
    });
  }

  return { documents: resolved, unresolvedSelectors };
}

async function buildPacketFromInputs(
  caseFolder: string,
  firmRoot: string,
  indexData: any,
  hearingNumber: string | undefined,
  documents: EvidencePacketDocumentInput[],
  options: {
    outputPath?: string;
    hearingDateTime?: string;
    appearance?: string;
    redactionMode?: string;
    includeAffirmationPage?: boolean;
    pageStampPrefix?: string;
    pageStampStart?: number;
    service?: EvidencePacketServiceInfo;
    defaultRedactionMode?: "off" | "detect_only" | "best_effort";
  }
): Promise<{
  outputPath: string;
  fullOutputPath: string;
  packet: Awaited<ReturnType<typeof buildEvidencePacket>>;
}> {
  if (documents.length === 0) {
    throw new Error("No documents provided for packet build");
  }

  let firmBlockLines: string[] | undefined;
  try {
    const firmInfo = await loadFirmInfo(firmRoot);
    if (firmInfo) {
      const barLine = firmInfo.nevadaBarNo
        ? /bar\s*no\.?/i.test(firmInfo.nevadaBarNo)
          ? firmInfo.nevadaBarNo
          : `Nevada Bar No. ${firmInfo.nevadaBarNo}`
        : undefined;
      const legacyCityStateZip = `${firmInfo.city || ""}${firmInfo.city && firmInfo.state ? ", " : ""}${firmInfo.state || ""} ${firmInfo.zip || ""}`.trim();
      // Preserve blank lines so the attorney block keeps a stable court-style layout.
      firmBlockLines = [
        (firmInfo.attorney || "").trim(),
        (barLine || "").trim(),
        (firmInfo.name || firmInfo.firmName || "").trim(),
        (firmInfo.address || "").trim(),
        (firmInfo.cityStateZip || legacyCityStateZip || "").trim(),
        (firmInfo.phone || "").trim(),
        "Attorney for Claimant",
      ];
    }
  } catch {
    // no-op
  }

  const outputPath = inferOutputPathFromDocs(
    documents.map((doc) => ({ path: doc.path, title: doc.title, date: doc.date, docType: doc.docType })),
    hearingNumber,
    options.outputPath
  );

  const resolvedCaseFolder = resolve(caseFolder);
  const fullOutputPath = resolve(caseFolder, outputPath);
  if (fullOutputPath !== resolvedCaseFolder && !fullOutputPath.startsWith(resolvedCaseFolder + sep)) {
    throw new Error("output_path must be within the case folder.");
  }

  const redaction = resolveRedactionOptions(options.redactionMode, {
    defaultRedactionMode: options.defaultRedactionMode,
  });

  const packet = await buildEvidencePacket({
    caseFolder,
    documents,
    caption: {
      claimantName: indexData?.summary?.client || "Claimant",
      claimNumber: inferClaimNumber(indexData),
      hearingNumber: hearingNumber || undefined,
      hearingDateTime: options.hearingDateTime,
      appearance: options.appearance,
    },
    redaction,
    service: options.service,
    includeAffirmationPage: options.includeAffirmationPage ?? true,
    pageStampPrefix: options.pageStampPrefix,
    pageStampStart: options.pageStampStart,
    firmBlockLines,
  });

  await mkdir(dirname(fullOutputPath), { recursive: true });
  await writeFile(fullOutputPath, packet.pdfBytes);

  return {
    outputPath,
    fullOutputPath,
    packet,
  };
}

async function saveIndexAndMap(
  caseFolder: string,
  indexPath: string,
  index: Record<string, any>
): Promise<void> {
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  await writeIndexDerivedFiles(caseFolder, index);
}

// Execute a tool and return result
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  caseFolder: string
): Promise<string> {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = join(caseFolder, toolInput.path);
        // Security check - ensure path is within case folder
        if (!filePath.startsWith(caseFolder)) {
          return "Error: Cannot read files outside the case folder";
        }

        // Handle DOCX and PDFs as non-text binaries
        const normalizedPath = toolInput.path.toLowerCase();
        if (toolInput.path.toLowerCase().endsWith('.pdf')) {
          try {
            const text = await extractPdfText(filePath, {
              layout: false,
              maxBuffer: 1024 * 1024,
              timeout: 30000,
            });
            return text.slice(0, 10000); // Limit output
          } catch {
            return "Error: Could not extract text from PDF";
          }
        }
        if (normalizedPath.endsWith('.docx')) {
          try {
            const text = await extractTextFromDocx(filePath);
            return text.slice(0, 10000); // Limit output
          } catch {
            return "Error: Could not extract text from DOCX";
          }
        }

        const content = await readFile(filePath, "utf-8");
        return content.slice(0, 15000); // Limit output to avoid context overflow
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

        return JSON.stringify({
          total_chars: content.length,
          offset,
          end,
          has_more: end < content.length,
          next_offset: end < content.length ? end : null,
          slice,
        });
      }

      case "rerun_hypergraph": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);
        const practiceArea = typeof index.practice_area === "string" ? index.practice_area : undefined;
        const applyToIndex = toolInput.apply_to_index !== false;

        const hypergraphResult = await generateHypergraph(caseFolder, index, practiceArea);
        const hypergraphPath = join(caseFolder, ".ai_tool", "hypergraph_analysis.json");
        await writeFile(hypergraphPath, JSON.stringify(hypergraphResult, null, 2));

        if (applyToIndex) {
          const needsReview = (hypergraphResult.conflicts || []).map((conflict: any) => {
            const values = Array.from(new Set([
              String(conflict.consensus_value ?? ""),
              String(conflict.outlier_value ?? ""),
            ])).filter((v) => v.length > 0);
            const sources = Array.from(new Set([
              ...(Array.isArray(conflict.consensus_sources) ? conflict.consensus_sources : []),
              ...(Array.isArray(conflict.outlier_sources) ? conflict.outlier_sources : []),
            ])).map((s) => String(s));
            return {
              field: String(conflict.field || "unknown"),
              conflicting_values: values,
              sources,
              reason: typeof conflict.likely_reason === "string" && conflict.likely_reason.trim()
                ? conflict.likely_reason.trim()
                : "Detected by hypergraph re-analysis",
            };
          });

          index.needs_review = needsReview;
          if (!Array.isArray(index.case_notes)) {
            index.case_notes = [];
          }
          index.case_notes.push({
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            content: toolInput.note || "Re-ran hypergraph and refreshed needs_review from existing index",
            field_updated: "needs_review",
            source: "hypergraph_rebuild",
            createdAt: new Date().toISOString(),
          });
          await saveIndexAndMap(caseFolder, indexPath, index);
        }

        return JSON.stringify({
          success: true,
          hypergraph_path: ".ai_tool/hypergraph_analysis.json",
          conflicts_found: hypergraphResult.conflicts?.length || 0,
          fields_analyzed: hypergraphResult.summary?.total_fields_analyzed || 0,
          index_updated: applyToIndex,
          needs_review_count: applyToIndex && Array.isArray(index.needs_review) ? index.needs_review.length : undefined,
        });
      }

      case "write_file": {
        const filePath = join(caseFolder, toolInput.path);
        if (!filePath.startsWith(caseFolder)) {
          return "Error: Cannot write files outside the case folder";
        }
        await writeFile(filePath, toolInput.content);
        return `Successfully wrote ${toolInput.content.length} characters to ${toolInput.path}`;
      }

      case "create_document_view": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);
        const indexedPathMap = collectIndexedDocumentPathMap(indexData);

        const rawDocuments = Array.isArray(toolInput.documents) ? toolInput.documents : [];
        if (rawDocuments.length === 0) {
          return JSON.stringify({
            success: false,
            error: "create_document_view requires a non-empty documents[] list.",
          });
        }

        const selectedPaths: string[] = [];
        const invalidPaths: string[] = [];
        const seen = new Set<string>();

        for (const raw of rawDocuments) {
          const rawPath = typeof raw === "string"
            ? raw
            : raw && typeof raw.path === "string"
              ? raw.path
              : "";
          const normalizedRequested = normalizeRelativePathForLookup(rawPath);
          if (!normalizedRequested) continue;

          const canonicalPath = indexedPathMap.get(normalizedRequested);
          if (!canonicalPath) {
            invalidPaths.push(rawPath);
            continue;
          }

          const canonicalKey = normalizeRelativePathForLookup(canonicalPath);
          if (seen.has(canonicalKey)) continue;
          seen.add(canonicalKey);
          selectedPaths.push(canonicalPath);
        }

        if (selectedPaths.length === 0) {
          return JSON.stringify({
            success: false,
            error: "None of the requested documents matched indexed file paths.",
            invalidPaths,
          });
        }

        const sortBy = normalizeDocumentViewSortBy(
          toolInput.sort_by ?? toolInput.sortBy
        );
        const sortDirection = normalizeDocumentViewSortDirection(
          toolInput.sort_direction ?? toolInput.sortDirection
        );

        const view: AgentDocumentView = {
          id: `agent-view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: typeof toolInput.name === "string" && toolInput.name.trim()
            ? toolInput.name.trim()
            : "Agent Document View",
          description: typeof toolInput.description === "string" && toolInput.description.trim()
            ? toolInput.description.trim()
            : undefined,
          paths: selectedPaths,
          sortBy,
          sortDirection,
          createdAt: new Date().toISOString(),
          totalMatches: selectedPaths.length,
          invalidPaths: invalidPaths.length > 0 ? invalidPaths : undefined,
        };

        return JSON.stringify({
          success: true,
          view,
          matchedCount: selectedPaths.length,
          invalidPaths,
        });
      }

      case "create_evidence_packet": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);

        const hearingNumber = typeof toolInput.hearing_number === "string"
          ? toolInput.hearing_number.trim()
          : "";

        const claimantName = indexData?.summary?.client || "";
        const claimNumbers = indexData?.summary?.claim_numbers || {};
        const firstClaimNumber = Object.values(claimNumbers).find((v: unknown) => typeof v === "string") as string || "";
        const resolvedClaimNumber =
          (typeof indexData?.summary?.wc_carrier?.claim_number === "string"
            && indexData.summary.wc_carrier.claim_number.trim()) ||
          firstClaimNumber;

        // Count total documents for reference (without returning them all)
        const folders = indexData?.folders || {};
        let docCount = 0;
        for (const [, folderData] of Object.entries(folders) as [string, any][]) {
          const files = Array.isArray(folderData) ? folderData : folderData?.files || folderData?.documents || [];
          docCount += files.length;
        }

        const result: Record<string, any> = {
          success: true,
          totalIndexedDocuments: docCount,
          hearingNumber: hearingNumber || null,
          caption: { claimantName, claimNumber: resolvedClaimNumber },
          instruction: [
            "This is a PLANNING step only — no PDF has been generated yet.",
            "Use the meta-index already in your context to identify relevant documents for this packet:",
            "1. If a hearing number was provided, find and read the hearing notice using read_file or read_document to understand what this hearing is for.",
            "2. Determine the hearing type: Read the hearing notice to check if this is an AO (Appeals Officer) or HO (Hearing Officer) hearing. Also check the hearing number format — a suffix like '-RA' indicates a reconsideration/appeal (AO). Otherwise default to HO.",
            "3. LOAD EVIDENCE PACKET RULES: Check the PRACTICE KNOWLEDGE meta-index in your context. Find the section tagged with 'Applies to: evidence_packet' and use read_file to load its full content. Follow those rules for document ordering, inclusion/exclusion, and packet structure.",
            "4. Review the meta-index folders in your context — look at filenames, types, dates, and facts to identify which documents belong in the packet.",
            "5. For folders with relevant documents, use read_file(\".ai_tool/indexes/{FolderName}.json\") to get doc_id values for the specific files you want to include.",
            "6. Present the proposed ordered document list to the user for review. Show title, folder, and why each was included.",
            "7. EXPLAIN YOUR REASONING: Before showing the document list, explain which evidence packet rules you found and how you applied them. Cite specific rules that influenced document ordering, inclusion, or exclusion. If no rules were found in the knowledge base, state that and explain the default ordering logic you used.",
            "8. After the user confirms (or adjusts), call build_evidence_packet with the verified ordered list using doc_id for each document. Set hearing_type to 'AO' or 'HO' based on step 2.",
            "Do NOT skip straight to build_evidence_packet without showing the user the proposed list first.",
          ].join("\n"),
        };

        return JSON.stringify(result);
      }

      case "build_evidence_packet": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);

        const requestedDocuments = normalizeDocumentsInput(toolInput.documents);
        if (requestedDocuments.length === 0) {
          return JSON.stringify({
            success: false,
            error: "build_evidence_packet requires a non-empty documents[] ordered list.",
          });
        }
        const { documents, unresolvedSelectors } = canonicalizePacketDocumentsFromIndex(requestedDocuments, indexData);
        if (documents.length === 0) {
          return JSON.stringify({
            success: false,
            error: "None of the selected documents matched indexed files (doc_id or path).",
            invalidSelectors: unresolvedSelectors,
          });
        }

        const hearingInput = typeof toolInput.hearing_number === "string"
          ? toolInput.hearing_number.trim()
          : typeof toolInput.hearingNumber === "string"
            ? toolInput.hearingNumber.trim()
            : "";
        const inferredHearing = hearingInput || inferHearingNumberFromDocs(
          documents.map((doc) => ({
            path: doc.path,
            title: doc.title,
            date: doc.date,
            docType: doc.docType,
          }))
        );
        const hearingNumber = inferredHearing ? extractHearingCore(inferredHearing) : undefined;
        const inputService = normalizeServiceInput(toolInput.service);

        const claimantName = indexData?.summary?.client || "";
        const claimNumbers = indexData?.summary?.claim_numbers || {};
        const firstClaimNumber = Object.values(claimNumbers).find((v: unknown) => typeof v === "string") as string || "";
        const resolvedClaimNumber =
          (typeof toolInput.claim_number === "string" && toolInput.claim_number.trim()) ||
          (typeof indexData?.summary?.wc_carrier?.claim_number === "string" && indexData.summary.wc_carrier.claim_number.trim()) ||
          firstClaimNumber;
        const issueOnAppeal = typeof toolInput.issue_on_appeal === "string" ? toolInput.issue_on_appeal : "";

        // Determine hearing type and derive templateId
        let hearingType = typeof toolInput.hearing_type === "string"
          ? toolInput.hearing_type.toUpperCase()
          : "";
        // Fallback: infer from hearing number if agent didn't specify
        if (!hearingType && hearingNumber) {
          const isAppealFormat = /-(RA|AP|APPEAL)/i.test(hearingNumber);
          if (isAppealFormat) hearingType = "AO";
        }
        const templateId = (hearingType === "AO" || issueOnAppeal.trim())
          ? "ao-standard"
          : "ho-standard";

        const proposedDocuments = documents.map((doc) => ({
          docId: buildDocumentIdFromPath(doc.path),
          path: doc.path,
          title: doc.title,
          date: doc.date,
          docType: doc.docType,
          fileName: doc.path.split("/").pop() || doc.path,
        }));

        return JSON.stringify({
          success: true,
          packetModeOpened: true,
          proposedDocuments,
          invalidSelectors: unresolvedSelectors.length > 0 ? unresolvedSelectors : undefined,
          caption: {
            claimantName,
            claimNumber: resolvedClaimNumber,
            hearingNumber: hearingNumber || undefined,
            hearingDateTime: typeof toolInput.hearing_datetime === "string" ? toolInput.hearing_datetime : undefined,
            appearance: typeof toolInput.appearance === "string" ? toolInput.appearance : undefined,
          },
          issueOnAppeal,
          templateId,
          service: inputService,
          instruction: "The Packet Creation UI has opened with the curated documents pre-loaded. Let the user know they can review the order, edit front matter, run a PII scan, and generate the final PDF from the interface.",
        });
      }

      case "update_index": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        // Navigate to field using dot notation
        const parts = toolInput.field_path.split(".");
        let target = index;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]]) {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }

        const lastPart = parts[parts.length - 1];
        const oldValue = target[lastPart];
        target[lastPart] = toolInput.value;

        // Track the update in case_notes
        if (!index.case_notes) {
          index.case_notes = [];
        }
        index.case_notes.push({
          timestamp: new Date().toISOString(),
          field: toolInput.field_path,
          old_value: oldValue,
          new_value: toolInput.value,
          note: toolInput.note || "Updated via chat"
        });

        await saveIndexAndMap(caseFolder, indexPath, index);
        return `Updated ${toolInput.field_path} from "${oldValue}" to "${toolInput.value}"`;
      }

      case "update_case_summary": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        if (!index.summary || typeof index.summary !== "object") {
          index.summary = {};
        }

        const previousSummary = typeof index.summary.case_summary === "string"
          ? index.summary.case_summary
          : "";

        index.summary.case_summary = String(toolInput.case_summary || "").trim();

        if (typeof toolInput.case_phase === "string" && toolInput.case_phase.trim()) {
          index.case_phase = toolInput.case_phase.trim();
        }

        if (!Array.isArray(index.case_notes)) {
          index.case_notes = [];
        }
        index.case_notes.push({
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          content: toolInput.note || "Updated case summary via chat",
          field_updated: "summary.case_summary",
          previous_value: previousSummary,
          source: "chat_summary_update",
          createdAt: new Date().toISOString(),
        });

        await saveIndexAndMap(caseFolder, indexPath, index);
        return `Updated summary.case_summary (${index.summary.case_summary.length} chars)${index.case_phase ? ` and case_phase=${index.case_phase}` : ""}`;
      }

      case "update_file_entry": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        const folderData = index.folders?.[toolInput.folder];
        if (!folderData) {
          return `Error: Folder "${toolInput.folder}" not found in index. Available folders: ${Object.keys(index.folders || {}).join(", ")}`;
        }

        const files = Array.isArray(folderData) ? folderData : folderData?.files;
        if (!Array.isArray(files)) {
          return `Error: No files array found in folder "${toolInput.folder}"`;
        }

        const fileEntry = files.find((f: any) => f.filename === toolInput.filename);
        if (!fileEntry) {
          const available = files.map((f: any) => f.filename).filter(Boolean).join(", ");
          return `Error: File "${toolInput.filename}" not found in folder "${toolInput.folder}". Available files: ${available}`;
        }

        // Apply updates, preserving fields not mentioned
        const updates = toolInput.updates || {};
        const updatedFields: string[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            fileEntry[key] = value;
            updatedFields.push(key);
          }
        }

        // Clear issues if extraction succeeded and issues wasn't explicitly set
        if (updatedFields.includes("key_info") && !updatedFields.includes("issues")) {
          if (fileEntry.issues) {
            fileEntry.issues = null;
            updatedFields.push("issues (cleared)");
          }
        }

        // Audit trail
        if (!Array.isArray(index.case_notes)) {
          index.case_notes = [];
        }
        index.case_notes.push({
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          content: `Re-extracted ${toolInput.folder}/${toolInput.filename}: updated ${updatedFields.join(", ")}. ${toolInput.note || ""}`.trim(),
          field_updated: `${toolInput.folder}/${toolInput.filename}`,
          source: "file_re_extraction",
          createdAt: new Date().toISOString()
        });

        await saveIndexAndMap(caseFolder, indexPath, index);
        return `Successfully updated ${updatedFields.join(", ")} for ${toolInput.folder}/${toolInput.filename}`;
      }

      case "get_conflicts": {
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        const rawNeedsReview: any[] = index.needs_review || [];
        const needsReview: any[] = dedupeNeedsReviewEntries(rawNeedsReview);
        const offsetRaw = Number(toolInput.offset);
        const limitRaw = Number(toolInput.limit);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0
          ? Math.floor(offsetRaw)
          : 0;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), CONFLICT_BATCH_MAX)
          : CONFLICT_BATCH_DEFAULT;
        const clampedOffset = Math.min(offset, needsReview.length);
        const end = Math.min(clampedOffset + limit, needsReview.length);

        if (needsReview.length === 0) {
          return JSON.stringify({
            status: "all_done",
            message: "All conflicts have been resolved! No more items to review.",
            count: 0,
            returned: 0,
            offset: 0,
            limit: 0,
            has_more: false,
            next_offset: null,
            items: []
          });
        }

        // Try to load hypergraph for value→count data (much more compact than raw sources)
        let hypergraph: Record<string, any> | null = null;
        try {
          const hgPath = join(caseFolder, ".ai_tool", "hypergraph_analysis.json");
          const hgContent = await readFile(hgPath, "utf-8");
          const hgData = JSON.parse(hgContent);
          if (hgData.hypergraph && typeof hgData.hypergraph === "object") {
            hypergraph = hgData.hypergraph;
          }
        } catch {
          // No hypergraph file — fall back to needs_review data only
        }

        // Return compact items with value→count from hypergraph
        const items = needsReview.slice(clampedOffset, end).map((item, batchIndex) => {
          const fieldData = hypergraph?.[item.field];

          if (fieldData?.values && Array.isArray(fieldData.values)) {
            // Hypergraph path: compact value→count pairs
            return {
              index: clampedOffset + batchIndex + 1,
              field: item.field,
              values: fieldData.values.map((v: any) => ({
                value: v.value,
                count: v.count,
              })),
              consensus: fieldData.consensus,
              confidence: fieldData.confidence,
              reason: item.reason,
            };
          }

          // Fallback: no hypergraph data for this field — return without sources
          return {
            index: clampedOffset + batchIndex + 1,
            field: item.field,
            conflicting_values: item.conflicting_values,
            reason: item.reason,
          };
        });

        return JSON.stringify({
          status: "conflicts_found",
          count: needsReview.length,
          returned: items.length,
          offset: clampedOffset,
          limit,
          has_more: end < needsReview.length,
          next_offset: end < needsReview.length ? end : null,
          items
        });
      }

      case "batch_resolve_conflicts": {
        const { resolutions } = toolInput;
        if (!Array.isArray(resolutions) || resolutions.length === 0) {
          return JSON.stringify({ success: false, error: "No resolutions provided" });
        }

        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        let needsReview: any[] = index.needs_review || [];
        const errata: any[] = index.errata || [];
        let caseNotes: any[] = Array.isArray(index.case_notes) ? index.case_notes : [];

        const resolved: string[] = [];
        const failed: string[] = [];

        for (const resolution of resolutions) {
          const { field, resolved_value, evidence } = resolution;
          const matchingIndexes = findMatchingFieldIndexes(needsReview, field);
          if (matchingIndexes.length === 0) {
            failed.push(field);
            continue;
          }

          const resolvedItems = matchingIndexes.map((idx) => needsReview[idx]);
          const resolvedField = resolvedItems[0]?.field || field;
          const rejectedValues = Array.from(new Set(
            resolvedItems
              .flatMap((item) => Array.isArray(item?.conflicting_values) ? item.conflicting_values : [])
              .map((v: any) => String(v))
              .filter((v) => v !== String(resolved_value))
          ));

          // Remove all matching duplicates from needs_review
          const indexSet = new Set(matchingIndexes);
          needsReview = needsReview.filter((_: any, idx: number) => !indexSet.has(idx));

          // Add to errata
          errata.push({
            field: resolvedField,
            decision: resolved_value,
            rejected_values: rejectedValues,
            evidence: evidence || "Batch resolution",
            resolution_type: "batch_review",
            resolved_at: new Date().toISOString()
          });

          // Add to case_notes
          caseNotes.push({
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            content: `Resolved ${resolvedField}: ${resolved_value}. ${evidence || ""}`.trim(),
            field_updated: resolvedField,
            previous_value: rejectedValues,
            source: "batch_review",
            createdAt: new Date().toISOString()
          });

          resolved.push(resolvedField);

          // Update summary fields if applicable
          if (resolvedField.startsWith("charges:") && index.summary?.providers) {
            const providerName = resolvedField.replace("charges:", "");
            const numericValue = parseFloat(String(resolved_value).replace(/[$,]/g, ""));
            for (const prov of index.summary.providers) {
              if (typeof prov === "object" && prov.name &&
                  (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
                   providerName.toLowerCase().includes(prov.name.toLowerCase()))) {
                const oldCharges = prov.charges;
                prov.charges = numericValue;
                if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                  const delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
                  index.summary.total_charges = index.summary.total_charges + delta;
                }
                break;
              }
            }
          }
          if ((resolvedField === "date_of_loss" || resolvedField === "date_of_injury" || resolvedField === "doi" || resolvedField === "dol") && index.summary) {
            index.summary.dol = resolved_value;
            index.summary.incident_date = resolved_value;
          }
          if ((resolvedField === "amw" || resolvedField === "aww" || resolvedField === "average_monthly_wage") && index.summary) {
            if (!index.summary.disability_status) index.summary.disability_status = {};
            index.summary.disability_status.amw = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          }
          if ((resolvedField === "compensation_rate" || resolvedField === "weekly_compensation_rate") && index.summary) {
            if (!index.summary.disability_status) index.summary.disability_status = {};
            index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          }
          if (resolvedField.startsWith("claim_numbers:") && index.summary) {
            const claimKey = resolvedField.replace("claim_numbers:", "");
            if (!index.summary.claim_numbers) index.summary.claim_numbers = {};
            index.summary.claim_numbers[claimKey] = resolved_value;
          }

          applyResolvedFieldToSummary(index, resolvedField, resolved_value);
        }

        index.needs_review = needsReview;
        index.errata = errata;
        index.case_notes = caseNotes;

        await saveIndexAndMap(caseFolder, indexPath, index);

        return JSON.stringify({
          success: resolved.length > 0,
          resolved: resolved.length,
          failed: failed.length,
          remaining: needsReview.length,
          resolved_fields: resolved,
          failed_fields: failed,
          message: failed.length > 0
            ? `WARNING: ${failed.length} field(s) not found in needs_review: ${failed.join(', ')}. Make sure to use exact field names from get_conflicts.`
            : `Successfully resolved ${resolved.length} conflicts`,
          ...(needsReview.length > 0 ? {
            action_required: `${needsReview.length} conflict(s) still remain. You MUST call get_conflicts now to retrieve and resolve the remaining items before reporting completion.`
          } : {})
        });
      }

      case "resolve_conflict": {
        const { field, resolved_value, evidence } = toolInput;
        const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        // Find the item in needs_review
        const needsReview: any[] = index.needs_review || [];
        const matchingIndexes = findMatchingFieldIndexes(needsReview, field);

        if (matchingIndexes.length === 0) {
          return JSON.stringify({
            success: false,
            error: `Field "${field}" not found in needs_review`
          });
        }

        const resolvedItems = matchingIndexes.map((idx) => needsReview[idx]);
        const resolvedField = resolvedItems[0]?.field || field;
        const rejectedValues = Array.from(new Set(
          resolvedItems
            .flatMap((item) => Array.isArray(item?.conflicting_values) ? item.conflicting_values : [])
            .map((v: any) => String(v))
            .filter((v) => v !== String(resolved_value))
        ));

        // Remove all matching duplicates from needs_review
        const indexSet = new Set(matchingIndexes);
        index.needs_review = needsReview.filter((_: any, idx: number) => !indexSet.has(idx));

        // Add to errata
        const errata: any[] = index.errata || [];
        const errataEntry = {
          field: resolvedField,
          decision: resolved_value,
          rejected_values: rejectedValues,
          evidence: evidence || "User confirmed correct value",
          resolution_type: "user_decision",
          resolved_at: new Date().toISOString()
        };
        errata.push(errataEntry);
        index.errata = errata;

        // Add to case_notes
        let caseNotes: any[] = Array.isArray(index.case_notes) ? index.case_notes : [];
        caseNotes.push({
          id: `note-${Date.now()}`,
          content: `Resolved ${resolvedField}: ${resolved_value} (was conflicting: ${rejectedValues.join(", ")}). ${evidence || ""}`.trim(),
          field_updated: resolvedField,
          previous_value: rejectedValues,
          source: "chat_review",
          createdAt: new Date().toISOString()
        });
        index.case_notes = caseNotes;

        // Update summary fields if applicable
        let summaryUpdated = false;

        // For charges fields, update provider and total
        if (resolvedField.startsWith("charges:") && index.summary?.providers) {
          const providerName = resolvedField.replace("charges:", "");
          const numericValue = parseFloat(String(resolved_value).replace(/[$,]/g, ""));

          const providers = index.summary.providers;
          if (Array.isArray(providers)) {
            for (const prov of providers) {
              if (typeof prov === "object" && prov.name) {
                if (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
                    providerName.toLowerCase().includes(prov.name.toLowerCase())) {
                  const oldCharges = prov.charges;
                  prov.charges = numericValue;

                  if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                    const delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
                    index.summary.total_charges = index.summary.total_charges + delta;
                  }
                  summaryUpdated = true;
                  break;
                }
              }
            }
          }
        }

        // For date_of_loss or date_of_injury, update summary date fields
        if ((resolvedField === "date_of_loss" || resolvedField === "date_of_injury" || resolvedField === "doi" || resolvedField === "dol") && index.summary) {
          index.summary.dol = resolved_value;
          index.summary.incident_date = resolved_value;
          summaryUpdated = true;
        }

        // For AMW/compensation_rate, update disability_status
        if ((resolvedField === "amw" || resolvedField === "aww" || resolvedField === "average_monthly_wage") && index.summary) {
          if (!index.summary.disability_status) index.summary.disability_status = {};
          index.summary.disability_status.amw = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          summaryUpdated = true;
        }
        if ((resolvedField === "compensation_rate" || resolvedField === "weekly_compensation_rate") && index.summary) {
          if (!index.summary.disability_status) index.summary.disability_status = {};
          index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          summaryUpdated = true;
        }

        // For claim_numbers, update summary
        if (resolvedField.startsWith("claim_numbers:") && index.summary) {
          const claimKey = resolvedField.replace("claim_numbers:", "");
          if (!index.summary.claim_numbers) {
            index.summary.claim_numbers = {};
          }
          index.summary.claim_numbers[claimKey] = resolved_value;
          summaryUpdated = true;
        }

        summaryUpdated = applyResolvedFieldToSummary(index, resolvedField, resolved_value) || summaryUpdated;

        // Write updated index
        await saveIndexAndMap(caseFolder, indexPath, index);

        return JSON.stringify({
          success: true,
          field: resolvedField,
          resolved_value,
          rejected_values: rejectedValues,
          remaining_conflicts: index.needs_review.length,
          summary_updated: summaryUpdated,
          message: `Resolved "${resolvedField}" to "${resolved_value}". ${index.needs_review.length} conflict(s) remaining.`
        });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (toolName === "build_evidence_packet" || toolName === "create_evidence_packet" || toolName === "create_document_view") {
      return JSON.stringify({
        success: false,
        error: `Error executing ${toolName}: ${message}`,
      });
    }
    return `Error executing ${toolName}: ${message}`;
  }
}

// Build context from case folder
async function buildContext(caseFolder: string): Promise<string> {
  const parts: string[] = [];
  const firmRoot = resolveFirmRoot(caseFolder);

  // Current date
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  parts.push(`TODAY'S DATE: ${dateStr}`);

  // Load meta-index (or generate lazily from document_index.json)
  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const metaIndexPath = join(caseFolder, ".ai_tool", "meta_index.json");

    let metaIndexData: Record<string, any>;
    try {
      const metaContent = await readFile(metaIndexPath, "utf-8");
      metaIndexData = JSON.parse(metaContent);
    } catch {
      // Lazy migration: generate from canonical index
      const indexContent = await readFile(indexPath, "utf-8");
      const indexData = JSON.parse(indexContent);
      await splitIndexToFolders(indexData, caseFolder);
      metaIndexData = generateMetaIndex(indexData);
      await writeFile(metaIndexPath, JSON.stringify(metaIndexData, null, 2));
    }

    const metaIndexView = buildMetaIndexPromptView(metaIndexData as any);
    parts.push(`\n${metaIndexView}`);
    parts.push(`\n${buildMetaToolIndexText()}`);

    try {
      // Load contracted knowledge index (meta + on-demand read_file)
      const knowledgeIndex = await getOrBuildMetaKnowledgeIndex(firmRoot);
      parts.push(`\n${buildMetaKnowledgeIndexText(knowledgeIndex)}`);
    } catch (e) {
      // No knowledge base for this firm
    }
  } catch {
    parts.push("\n## CASE INDEX\nNo case index found. Case may need to be indexed first.");
  }

  // Load templates list
  try {
    const templatesPath = join(firmRoot, ".ai_tool", "templates", "templates.json");
    const templatesData = JSON.parse(await readFile(templatesPath, "utf-8"));
    if (templatesData.templates?.length > 0) {
      const templateList = templatesData.templates
        .map((t: any) => `- ${t.name}: ${t.description || 'No description'}`)
        .join("\n");
      parts.push(`\n## AVAILABLE DOCUMENT TEMPLATES\n${templateList}`);
    }
  } catch {
    // No templates
  }

  parts.push(`\n## WORKING DIRECTORY\n${caseFolder}`);

  let context = parts.join("\n");
  if (context.length > CASE_CONTEXT_MAX_CHARS) {
    console.log(`[buildContext] Context truncated from ${context.length} to ${CASE_CONTEXT_MAX_CHARS}`);
    context = `${context.slice(0, CASE_CONTEXT_MAX_CHARS)}\n...\n[NOTE: Context truncated to stay within prompt budget. Use read_index_slice for deep index access.]`;
  }
  return context;
}

// Document type descriptions for user feedback
const DOC_TYPE_NAMES: Record<DocumentType, string> = {
  demand_letter: "demand letter",
  case_memo: "case memo",
  settlement: "settlement calculation",
  general_letter: "letter",
  decision_order: "Decision & Order"
};

// System prompt for direct chat (context gets appended)
const BASE_SYSTEM_PROMPT = `You are a helpful legal assistant for a Nevada injury law firm (Personal Injury and Workers' Compensation). You help attorneys and staff with case management, document review, answering questions, and drafting documents.

## NAVIGATING THE CASE INDEX

Your context includes a meta-index with all case facts organized by folder. Each folder shows:
- File count, document types, and date range
- All filenames in that folder
- Deduped facts extracted from the folder's documents

For quick answers, use the facts in the meta-index directly.
For full document details in any folder, use: read_file(".ai_tool/indexes/{FolderName}.json")
For reading a specific document:
- Use read_file for DOCX and text-like files (including .pdf when OCR/text extraction is sufficient): read_file("{folder}/{filename}")
- Use read_document only for PDFs where you need vision (scanned pages, handwriting, complex layout): read_document("{folder}/{filename}.pdf", "...").

## YOUR CAPABILITIES

1. **Answer Questions**: Use the case index and your knowledge to answer questions about cases, injuries, treatments, and PI law.

2. **Read Files**: Use read_file for quick text lookups — reading per-folder index files, checking a text/JSON file, DOCX files, or grabbing a snippet. For PDFs this uses basic text extraction only.
   For deep index detail, read per-folder files at .ai_tool/indexes/{FolderName}.json, or use read_index_slice to page through the full .ai_tool/document_index.json.

2b. **Re-run Hypergraph**: Use rerun_hypergraph to rebuild .ai_tool/hypergraph_analysis.json from the current index and refresh conflict detection without re-extraction.

3. **Update Case Data**: Use update_index when the user provides corrections or new information about top-level case fields (e.g., client name, DOB, case phase, policy limits).
   Use update_case_summary when updating the narrative case summary.

4. **Re-Extract File Data**: Use update_file_entry when the user asks you to re-read a document and update its entry in the index. This updates a specific file within a folder — its key_info, type, date, extracted_data, and issues.

5. **Generate Documents**: When the user asks you to draft, write, create, or generate a formal document (demand letter, case memo, settlement calculation, letter, or Decision & Order), use the generate_document tool. This delegates to a specialized agent with access to firm templates that will create a complete, professional document.

## WHEN TO USE generate_document

Use this tool when the user wants a NEW document created:
- "Draft a demand letter"
- "Write up a case memo"
- "Create a settlement breakdown"
- "Prepare a letter of protection"
- "Draft an Appeals Officer Decision & Order"

Do NOT use it for:
- Questions about what should go in a document
- Reviewing existing documents
- Simple notes or quick responses

5. **Read Documents with Vision**: Use read_document for PDFs in detail, especially scanned or layout-heavy PDFs. This spawns a vision-capable reader that sees rendered pages — form layouts, tables, handwriting, checkboxes, images — not just extracted text. Much better than read_file for PDFs with complex formatting.

## WHEN TO USE read_document

Use read_document only when the user asks about a specific PDF and layout/context is needed, especially:
- "What does the MRI report say?"
- "What are the charges on the billing statement?"
- "What injuries are listed in the intake form?"
- "Can you read the police report?"

Use read_file for:
- DOCX files
- Non-PDF files
- Per-folder indexes (.ai_tool/indexes/{FolderName}.json) or small index files
- Quick lookups on text or JSON files

Do not call read_document on DOCX or other non-PDF files; use read_file instead.

Use rerun_hypergraph when:
- A legacy case never completed hypergraph/conflict reconciliation
- needs_review appears missing or stale after an indexing failure

## WHEN TO USE update_file_entry

Use this tool when the user asks you to re-read a document and update the index with the new extraction. The typical flow:

1. User says "read DWC D-8 Wages.pdf" or "re-extract the intake form"
2. If it's a PDF, call read_document to read the file with vision; otherwise call read_file.
3. You present what you found to the user
4. User says "update the file", "looks good, save it", or "update the index"
5. You call update_file_entry with the folder name, filename, and updated fields

**Important:**
- Only call update_file_entry AFTER the user explicitly confirms
- Include key_info (a comprehensive summary), type, date, and extracted_data
- The folder and filename must match EXACTLY what's in the index (case-sensitive)
- Set issues to null if the re-extraction was successful

## WHEN TO USE update_case_summary

Use this tool when the user asks to create, revise, or replace the case summary narrative.

Canonical write locations:
- summary.case_summary for narrative summary text
- case_phase for current lifecycle phase (optional)

Prefer this tool over update_index for case summary updates so the write target is explicit and consistent.

7. **Create Document Panel Views**: When the user asks to show a specific subset of documents in the panel (for example medical records, provider-specific notes, hearing notices, chronological sets), use create_document_view with explicit paths from the index.

## WHEN TO USE create_document_view

Use this tool when the user asks for commands like:
- "Show all medical records"
- "Show doctor's notes from Dr. Smith"
- "Show hearing notices in date order"
- "Show me only recent treatment records"

Requirements:
- Use explicit documents[].path values that exist in .ai_tool/document_index.json.
- Prefer meaningful name and a short description.
- Set sort_by / sort_direction when the user requests ordering (e.g., chronological).
- After creating the view, explain what you selected and why in normal chat text.

7. **Review Document Conflicts**: When the user wants to review conflicts, use get_conflicts in paginated batches and resolve one batch at a time.

8. **Build Hearing Evidence Packets**: Use create_evidence_packet to plan, then build_evidence_packet to generate. Always review the document list with the user before building.

## WHEN TO USE HEARING PACKET TOOLS

Use these tools when the user asks for an "evidence packet", "hearing packet", "document index packet", or "H.O. packet".

Two-step flow:
1. **create_evidence_packet** (planning step): Call this first. It returns instructions telling you to review the document index, check knowledge rules, and present a proposed document list to the user. No PDF is generated.
2. **build_evidence_packet** (execution step): Call this AFTER the user has reviewed and confirmed the document list. This opens the Packet Creation UI where the user can make final adjustments and generate the PDF.

Requirements:
- ALWAYS start with create_evidence_packet — never skip straight to build_evidence_packet.
- Use the PRACTICE KNOWLEDGE meta-index to find the section tagged with "Applies to: evidence_packet", then read_file it to get the full evidence packet rules. Follow those rules for document ordering, inclusion/exclusion, and packet structure.
- Present the proposed document list to the user and wait for confirmation before building.
- Pass \`doc_id\` values into build_evidence_packet documents[].
- If \`doc_id\` is unavailable, pass exact \`filename\` + \`folder\` from the index.
- Compatibility: exact indexed \`path\` is accepted, but do not invent/synthesize paths.
- When calling build_evidence_packet, include \`claim_number\` from the document index (check \`wc_carrier.claim_number\` first, then \`claim_numbers\`).
- When calling build_evidence_packet, set \`hearing_type\` to "AO" for Appeals Officer hearings or "HO" for Hearing Officer hearings.
- For AO hearings, also include \`issue_on_appeal\` with a 1-2 sentence summary of the contested issue based on case documents. Leave both empty for HO hearings.
- Do NOT claim the Packet Creation UI opened unless build_evidence_packet returns \`success: true\`.
- After build_evidence_packet succeeds, let the user know the Packet Creation interface has opened with their documents pre-loaded.

## DOCUMENT REVIEW MODE

Use this when the user says things like:
- "Let's review the conflicts"
- "Go through the needs_review items"
- "Review document issues"

### Data shape from get_conflicts

Each conflict item includes value→count pairs from the hypergraph plus consensus/confidence:
\`\`\`json
{
  "field": "client_name",
  "values": [
    { "value": "Jomo Henderson", "count": 89 },
    { "value": "Joma Henderson", "count": 1 }
  ],
  "consensus": "Jomo Henderson",
  "confidence": 0.61,
  "reason": "..."
}
\`\`\`

Use the count ratios and confidence to guide categorization:
- **High count ratio + high confidence** → auto-resolve to consensus value
- **Low confidence / UNCERTAIN consensus** → needs user discussion
- **Similar counts** → genuinely ambiguous, ask user

### How to conduct a batch review:

1. **Get first batch** - Call get_conflicts with defaults (offset 0, limit 25) to retrieve the first batch.

2. **Analyze and categorize** - Group conflicts by:
   - **Auto-resolve** (high confidence): One value dominates (e.g. 89 vs 1), OCR errors, formatting differences
   - **Recommend** (medium confidence): Clear majority but worth confirming
   - **Needs discussion** (low confidence or UNCERTAIN consensus): Genuinely ambiguous, need user input

3. **Present in batches** - Show your recommendations grouped like:

   **Quick Fixes (I recommend these)**
   1. client_name: "Jomo Henderson" (89 docs) vs "Joma Henderson" (1 doc) → clearly a typo
   2. date_of_loss: "06/25/2023" (12 docs) vs "05/25/2023" (1 doc) → OCR error
   Approve these? (yes/no/edit)

   **Need Your Input**
   3. Charges for Spinal Rehab: $6,558 (3 docs) vs $10,558 (2 docs) - which invoice is correct?

4. **Batch resolve** - When user approves, call batch_resolve_conflicts with all approved resolutions at once

5. **Verify and continue** - After batch_resolve_conflicts, if any conflicts remain:
   - Use the response "has_more" / "next_offset" fields from get_conflicts for pagination.
   - Call get_conflicts again with offset=next_offset until has_more is false.
   - Do NOT report completion until remaining is 0 or the user explicitly defers unresolved items.

### Example flow:

User: "Let's review the conflicts"

You: [call get_conflicts]

You: "I found 23 conflicts. After analyzing them, here's my breakdown:

**Ready to Auto-Resolve (15 items):**
These have a clear dominant value (high document count vs 1-2 outliers):
- client_name: "Jomo Henderson" (89 docs) vs "Joma Henderson" (1 doc) → OCR typo
- date_of_birth: "06/27/1984" (45 docs) vs "1949" (1 doc) → HIPAA form error
- client_name: "Brenda Boerdam-Madrid" (30 docs) vs "Boerdam Madrid" (2 docs) → formatting
[... etc]

**Need Your Review (8 items):**
- rehab_charges: $6,558 (3 docs) vs $10,558 (2 docs) - genuinely different amounts
- balance_due: Several with $0 vs original amount (similar counts)

Want me to apply the 15 auto-resolutions? Then we can discuss the remaining 8."

User: "Yes, apply them"

You: [call batch_resolve_conflicts with the 15 resolutions]

You: "Done! 15 resolved. Now let's look at the remaining 8..."

## GUIDELINES

- Be concise but thorough
- Answer from the case index when possible - no need for tools on simple lookups
- Explain medical/legal terms briefly when helpful
- Keep responses professional`;

// Main chat function with streaming
export async function* directChat(
  caseFolder: string,
  message: string,
  history: ChatMessage[] = [],
  options?: { lockOwner?: string; lockDisplayName?: string }
): AsyncGenerator<{ type: string; content?: string; tool?: string; done?: boolean; usage?: any; filePath?: string; view?: AgentDocumentView; incomplete?: boolean; reason?: string }> {

  // Build context and include it in the system prompt
  const context = await buildContext(caseFolder);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n---\n\n${context}`;

  // Build messages array from history
  const messages: Anthropic.MessageParam[] = [];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Add current message
  messages.push({
    role: "user",
    content: message
  });

  const lockOwner = options?.lockOwner || `chat-${Date.now()}`;
  const lockResult = await acquireCaseLock(caseFolder, lockOwner, options?.lockDisplayName);
  const readOnlyMode = !lockResult.acquired;

  if (readOnlyMode) {
    const holderName = lockResult.lock?.displayName || lockResult.lock?.owner || "another user";
    yield {
      type: "text",
      content: `\n\n${holderName}'s agent is working on this case right now. You can still ask questions, but edits are disabled for now.`,
    };
  }

  // Agentic loop - supports multiple rounds of tool calls
  const MAX_TOOL_ITERATIONS = 16;
  let iterations = 0;
  let generatedFilePath: string | undefined;
  let hitIterationLimit = false;

  try {
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

    // API call with tools and streaming on every iteration
    let response;
    try {
      response = await getClient().messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: getTools(readOnlyMode),
        stream: true
      });
    } catch (err) {
      console.error(`API call failed (iteration ${iterations}):`, err);
      yield { type: "text", content: `\n\nError processing response: ${err}` };
      break;
    }

    // Per-iteration state (prevents text accumulation across iterations)
    let iterationText = "";
    let toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let stopReason: string | null = null;

    // Stream and parse response
    for await (const event of response) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: ""
          };
          yield { type: "tool", tool: event.content_block.name };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          iterationText += event.delta.text;
          yield { type: "text", content: event.delta.text };
        } else if (event.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse.input += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolUse) {
          try {
            const parsedInput = currentToolUse.input.trim() === ""
              ? {}
              : JSON.parse(currentToolUse.input);
            toolUseBlocks.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: parsedInput
            });
          } catch (e) {
            console.error(`Failed to parse tool input for ${currentToolUse.name}:`, e, currentToolUse.input);
          }
          currentToolUse = null;
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason;
      }
    }

    // If no tool use, we're done
    if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // Handle generate_document specially - it's an async generator
      if (toolUse.name === "generate_document") {
        const docType = toolUse.input.document_type as DocumentType;
        const instructions = toolUse.input.instructions as string;
        const docTypeName = DOC_TYPE_NAMES[docType];

        yield { type: "delegating", content: `Generating ${docTypeName}...` };

        let filePath: string | undefined;
        for await (const event of generateDocument(caseFolder, docType, instructions)) {
          if (event.type === "status") {
            yield { type: "status", content: event.content };
          } else if (event.type === "tool") {
            yield { type: "tool", content: event.content };
          } else if (event.type === "text") {
            yield { type: "text", content: event.content };
          } else if (event.type === "done") {
            filePath = event.filePath;
          }
        }

        generatedFilePath = filePath;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: filePath
            ? `Document successfully generated and saved to ${filePath}`
            : "Document generation completed but no file was saved"
        });
      } else if (toolUse.name === "read_document") {
        // Handle read_document - spawns Agent SDK agent with Read tool for vision
        const docPath = toolUse.input.path as string;
        const question = toolUse.input.question as string;
        const normalizedDocPath = (docPath || "").toLowerCase();
        if (!normalizedDocPath.endsWith(".pdf")) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Error: read_document is PDF-only. Use read_file for DOCX and other non-PDF documents.",
          });
          continue;
        }

        yield { type: "delegating", content: `Reading ${docPath} with vision...` };

        let resultContent = "";
        for await (const event of readDocument(caseFolder, docPath, question)) {
          if (event.type === "status") {
            yield { type: "status", content: event.content };
          } else if (event.type === "tool") {
            yield { type: "tool", content: event.content };
          } else if (event.type === "error") {
            resultContent = event.content;
          } else if (event.type === "done") {
            resultContent = event.content;
          }
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultContent || "No content extracted from document"
        });
      } else {
        // Regular tool execution
        yield { type: "tool_executing", tool: toolUse.name };
        const result = await executeTool(toolUse.name, toolUse.input, caseFolder);
        if (toolUse.name === "create_document_view") {
          const parsed = safeJsonParse<{ success?: boolean; view?: AgentDocumentView }>(result);
          if (parsed?.success && parsed.view) {
            yield { type: "document_view", view: parsed.view };
          }
        }
        if (toolUse.name === "build_evidence_packet") {
          const parsed = safeJsonParse<{
            success?: boolean;
            packetModeOpened?: boolean;
            proposedDocuments?: Array<{
              docId: string;
              path?: string;
              title: string;
              date: string | null;
              docType: string;
              fileName: string;
            }>;
            caption?: { claimantName: string; claimNumber: string; hearingNumber?: string; hearingDateTime?: string; appearance?: string };
            issueOnAppeal?: string;
            templateId?: string;
            service?: EvidencePacketServiceInfo;
          }>(result);
          if ((parsed?.success || parsed?.packetModeOpened) && Array.isArray(parsed.proposedDocuments)) {
            yield {
              type: "evidence_packet_plan",
              plan: {
                proposedDocuments: parsed.proposedDocuments,
                caption: parsed.caption,
                issueOnAppeal: parsed.issueOnAppeal || "",
                templateId: parsed.templateId,
                service: parsed.service,
              },
            };
          }
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result
        });
      }
    }

    // Build messages for next iteration (per-iteration text, not accumulated)
    messages.push({
      role: "assistant",
      content: [
        ...(iterationText ? [{ type: "text" as const, text: iterationText }] : []),
        ...toolUseBlocks.map(t => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: t.input
        }))
      ]
    });

    messages.push({
      role: "user",
      content: toolResults
    });
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      hitIterationLimit = true;
      yield {
        type: "status",
        content: `Stopped after ${MAX_TOOL_ITERATIONS} tool steps to prevent runaway execution. Ask me to continue and I'll resume from here.`,
      };
    }

    yield {
      type: "done",
      done: true,
      filePath: generatedFilePath,
      incomplete: hitIterationLimit,
      reason: hitIterationLimit ? "max_tool_iterations" : undefined,
    };
  } finally {
    if (lockResult.acquired) {
      await releaseCaseLock(caseFolder, lockOwner);
    }
  }
}
