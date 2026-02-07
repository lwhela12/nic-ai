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
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve, sep } from "path";
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

// Tool definitions
const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file in the case folder. Use for detailed document review or checking specific files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Intake/Intake.pdf' or '.pi_tool/document_index.json')"
        }
      },
      required: ["path"]
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
    name: "generate_document",
    description: "Delegate to a specialized agent to draft a formal document. Use this when the user asks you to write, draft, create, or generate a document like a demand letter, case memo, settlement calculation, or formal letter. The agent has access to templates and will create a complete, professional document.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_type: {
          type: "string",
          enum: ["demand_letter", "case_memo", "settlement", "general_letter"],
          description: "Type of document to generate: demand_letter (to insurance), case_memo (internal summary), settlement (disbursement calc), general_letter (LOP, records request, etc.)"
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
    description: "Read a document with full vision support, especially useful for PDFs. Spawns a specialist that can see rendered pages (forms, tables, handwriting, images) not just extracted text. Use this when you need to analyze a specific document in detail — especially PDFs with complex layouts, medical forms, billing statements, or scanned documents. Do NOT use for simple text/JSON file lookups (use read_file for those).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from case folder (e.g., 'Intake/Intake.pdf', 'Medical/MRI_Report.pdf')"
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
    name: "create_evidence_packet",
    description: "Generate a workers' compensation hearing/appeal evidence packet for a Hearing Officer number. The tool uses the case index + firm knowledge rules to select, order, merge, and page-number exhibits, then writes a final packet PDF into the case workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        hearing_number: {
          type: "string",
          description: "Hearing number (examples: '2680509-RA' or 'HO-2680509-RA'). Required unless the case has exactly one HO folder."
        },
        output_path: {
          type: "string",
          description: "Optional relative output path for the packet PDF. If omitted, a default Litigation path is used."
        },
        hearing_datetime: {
          type: "string",
          description: "Optional hearing date/time string for caption (example: '10/29/2025 @ 2:30PM')."
        },
        appearance: {
          type: "string",
          description: "Optional appearance line for caption (example: 'Telephone Appearance: O. Munguia')."
        },
        redaction_mode: {
          type: "string",
          enum: ["off", "detect_only", "best_effort"],
          description: "PII mode: off (no redaction), detect_only (find DOB/SSN only), best_effort (overlay masking where possible)."
        },
        rules_text: {
          type: "string",
          description: "Optional raw packet-rule text from knowledge bank, passed verbatim. Use when rules are narrative/markdown and not JSON."
        },
        order_rules: {
          type: "array",
          description: "Optional explicit ordering rules derived from knowledge. Overrides parsed knowledge config when provided.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              required: { type: "boolean" },
              match: {
                type: "object",
                properties: {
                  doc_types: { type: "array", items: { type: "string" } },
                  path_regex: { type: "string" },
                  title_regex: { type: "string" },
                  docTypes: { type: "array", items: { type: "string" } },
                  pathRegex: { type: "string" },
                  titleRegex: { type: "string" },
                },
              },
              sort_by: { type: "string", enum: ["none", "date", "title", "path"] },
              sort_direction: { type: "string", enum: ["asc", "desc"] },
              sortBy: { type: "string", enum: ["none", "date", "title", "path"] },
              sortDirection: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["id"],
          },
        },
        include_path_regexes: {
          type: "array",
          items: { type: "string" },
          description: "Optional include filters for candidate documents."
        },
        exclude_path_regexes: {
          type: "array",
          items: { type: "string" },
          description: "Optional exclude filters for candidate documents."
        },
        include_affirmation_page: {
          type: "boolean",
          description: "Optional override for whether to include affirmation/certificate page."
        },
        page_stamp_prefix: {
          type: "string",
          description: "Optional exhibit page label prefix (example: 'Page ')."
        },
        page_stamp_start: {
          type: "number",
          description: "Optional exhibit page start number."
        },
        service: {
          type: "object",
          description: "Optional certificate/service block details.",
          properties: {
            service_date: { type: "string" },
            service_method: { type: "string" },
            recipients: { type: "array", items: { type: "string" } },
            served_by: { type: "string" },
            serviceDate: { type: "string" },
            serviceMethod: { type: "string" },
            servedBy: { type: "string" },
          },
        }
      },
      required: []
    }
  },
  {
    name: "list_hearing_documents",
    description: "List candidate PDF documents for a hearing packet. This is a planning helper: use it first, then decide final order according to knowledge-bank rules before calling build_evidence_packet.",
    input_schema: {
      type: "object" as const,
      properties: {
        hearing_number: {
          type: "string",
          description: "Hearing number (examples: '2680509-RA' or 'HO-2680509-RA'). Optional if only one hearing is inferable."
        },
        include_path_regexes: {
          type: "array",
          items: { type: "string" },
          description: "Optional include filters for candidate docs."
        },
        exclude_path_regexes: {
          type: "array",
          items: { type: "string" },
          description: "Optional exclude filters for candidate docs."
        }
      },
      required: []
    }
  },
  {
    name: "build_evidence_packet",
    description: "Deterministically build a packet from an explicit ordered documents list. Use after planning/selecting order in the agent.",
    input_schema: {
      type: "object" as const,
      properties: {
        hearing_number: {
          type: "string",
          description: "Hearing number for caption/output naming (example: '2680509-RA')."
        },
        documents: {
          type: "array",
          description: "Explicit ordered list of documents to include.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              title: { type: "string" },
              date: { type: "string" },
              doc_type: { type: "string" },
              docType: { type: "string" },
              include: { type: "boolean" },
            },
            required: ["path", "title"],
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
        page_stamp_prefix: {
          type: "string",
          description: "Optional exhibit page label prefix."
        },
        page_stamp_start: {
          type: "number",
          description: "Optional exhibit page start number."
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
    description: "Get all document conflicts that need review. Returns all needs_review items with their conflicting values and sources. Use this when the user wants to review conflicts. After reviewing, present your recommendations in batches - group easy ones together, flag complex ones for individual review.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
  "generate_document",
  "create_evidence_packet",
  "build_evidence_packet",
  "batch_resolve_conflicts",
  "resolve_conflict",
]);

function getTools(readOnlyMode: boolean): Anthropic.Tool[] {
  if (!readOnlyMode) return TOOLS;
  return TOOLS.filter((tool) => !WRITE_TOOLS.has(tool.name));
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
  const normalize = (s: string) => s.trim().toLowerCase()
    .replace(/[_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'");
  const norm = normalize(field);
  const normMatch = needsReview.findIndex((item: any) =>
    normalize(item.field || '') === norm
  );
  if (normMatch !== -1) return normMatch;

  return -1;
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

interface LoadedKnowledgePacketConfig {
  config: KnowledgeEvidencePacketConfig | null;
  source: string | null;
  rawText: string | null;
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

function normalizeOrderRulesInput(raw: any): EvidencePacketOrderRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const normalized = raw
    .filter((rule) => rule && typeof rule.id === "string")
    .map((rule) => {
      const match = rule.match && typeof rule.match === "object"
        ? {
          docTypes: Array.isArray(rule.match.docTypes)
            ? rule.match.docTypes.filter((v: any) => typeof v === "string")
            : Array.isArray(rule.match.doc_types)
              ? rule.match.doc_types.filter((v: any) => typeof v === "string")
              : undefined,
          pathRegex: typeof rule.match.pathRegex === "string"
            ? rule.match.pathRegex
            : typeof rule.match.path_regex === "string"
              ? rule.match.path_regex
              : undefined,
          titleRegex: typeof rule.match.titleRegex === "string"
            ? rule.match.titleRegex
            : typeof rule.match.title_regex === "string"
              ? rule.match.title_regex
              : undefined,
        }
        : undefined;

      const sortBy = typeof rule.sortBy === "string"
        ? rule.sortBy
        : typeof rule.sort_by === "string"
          ? rule.sort_by
          : undefined;

      const sortDirection = typeof rule.sortDirection === "string"
        ? rule.sortDirection
        : typeof rule.sort_direction === "string"
          ? rule.sort_direction
          : undefined;

      return {
        id: rule.id,
        required: Boolean(rule.required),
        match,
        sortBy: sortBy === "none" || sortBy === "date" || sortBy === "title" || sortBy === "path"
          ? sortBy
          : undefined,
        sortDirection: sortDirection === "asc" || sortDirection === "desc"
          ? sortDirection
          : undefined,
      } satisfies EvidencePacketOrderRule;
    });

  return normalized.length > 0 ? normalized : undefined;
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

function defaultEvidencePacketOrderRules(): EvidencePacketOrderRule[] {
  return [
    {
      id: "notice_of_hearing",
      match: { titleRegex: "notice\\s+of\\s+hearing|hearing\\s+notice|\\bho[-\\s]?\\d+" },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "c3_form",
      match: { titleRegex: "\\bc-?3\\b|\\bc3\\b" },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "c4_form",
      match: { titleRegex: "\\bc-?4\\b|\\bc4\\b" },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "claim_acceptance_or_denial",
      match: { titleRegex: "notice\\s+of\\s+claim\\s+acceptance|acceptance|denial" },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "representation_and_appearance",
      match: { titleRegex: "representation|notice\\s+of\\s+appear" },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "medical_reports",
      match: { titleRegex: "ppd|ime|medical|report|doctor|dr\\." },
      sortBy: "date",
      sortDirection: "asc",
    },
    {
      id: "correspondence",
      match: { titleRegex: "letter|request|memo|correspondence" },
      sortBy: "date",
      sortDirection: "asc",
    },
  ];
}

function extractFirstJsonCodeFence(content: string): Record<string, any> | null {
  const fenceRegex = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const parsed = safeJsonParse<Record<string, any>>(match[1]);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  return null;
}

function normalizeKnowledgePacketConfig(input: any): KnowledgeEvidencePacketConfig | null {
  if (!input || typeof input !== "object") return null;

  const raw =
    (input.evidencePacket && typeof input.evidencePacket === "object" && input.evidencePacket) ||
    (input.evidence_packet && typeof input.evidence_packet === "object" && input.evidence_packet) ||
    (input.evidencePacketRules && typeof input.evidencePacketRules === "object" && input.evidencePacketRules) ||
    input;

  const normalized: KnowledgeEvidencePacketConfig = {};

  normalized.orderRules = normalizeOrderRulesInput(raw.orderRules || raw.order_rules);
  if (Array.isArray(raw.includePathRegexes)) {
    normalized.includePathRegexes = raw.includePathRegexes.filter((v: any) => typeof v === "string");
  } else if (Array.isArray(raw.include_path_regexes)) {
    normalized.includePathRegexes = raw.include_path_regexes.filter((v: any) => typeof v === "string");
  }
  if (Array.isArray(raw.excludePathRegexes)) {
    normalized.excludePathRegexes = raw.excludePathRegexes.filter((v: any) => typeof v === "string");
  } else if (Array.isArray(raw.exclude_path_regexes)) {
    normalized.excludePathRegexes = raw.exclude_path_regexes.filter((v: any) => typeof v === "string");
  }
  if (typeof raw.includeAffirmationPage === "boolean") {
    normalized.includeAffirmationPage = raw.includeAffirmationPage;
  } else if (typeof raw.include_affirmation_page === "boolean") {
    normalized.includeAffirmationPage = raw.include_affirmation_page;
  }
  if (typeof raw.pageStampPrefix === "string") {
    normalized.pageStampPrefix = raw.pageStampPrefix;
  } else if (typeof raw.page_stamp_prefix === "string") {
    normalized.pageStampPrefix = raw.page_stamp_prefix;
  }
  if (typeof raw.pageStampStart === "number") {
    normalized.pageStampStart = raw.pageStampStart;
  } else if (typeof raw.page_stamp_start === "number") {
    normalized.pageStampStart = raw.page_stamp_start;
  }
  normalized.service = normalizeServiceInput(raw.service);
  if (raw.defaultRedactionMode === "off" || raw.defaultRedactionMode === "detect_only" || raw.defaultRedactionMode === "best_effort") {
    normalized.defaultRedactionMode = raw.defaultRedactionMode;
  } else if (raw.default_redaction_mode === "off" || raw.default_redaction_mode === "detect_only" || raw.default_redaction_mode === "best_effort") {
    normalized.defaultRedactionMode = raw.default_redaction_mode;
  }

  return normalized;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugifyRuleId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function buildRegexFromRuleLine(line: string): string | null {
  const lowered = line.toLowerCase();
  if (/\bc[\s-]?3\b/.test(lowered)) return "\\bc-?3\\b|\\bc3\\b";
  if (/\bc[\s-]?4\b/.test(lowered)) return "\\bc-?4\\b|\\bc4\\b";
  if (/notice of hearing/.test(lowered)) return "notice\\s+of\\s+hearing|hearing\\s+notice";
  if (/notice of appearance/.test(lowered)) return "notice\\s+of\\s+appear";
  if (/claim acceptance/.test(lowered)) return "claim\\s+acceptance|notice\\s+of\\s+claim\\s+acceptance";
  if (/ppd|ime|medical report/.test(lowered)) return "ppd|ime|medical\\s+report";

  const cleaned = line
    .replace(/["“”'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 6) return null;

  const words = cleaned.split(" ").slice(0, 8).map((word) => escapeRegexLiteral(word));
  if (words.length < 2) return null;
  return words.join("\\s+");
}

function parseLooseOrderRulesFromText(text: string | null | undefined): EvidencePacketOrderRule[] {
  if (!text || !text.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rules: EvidencePacketOrderRule[] = [];
  const seenIds = new Set<string>();

  for (const line of lines) {
    const markerMatch = line.match(/^(?:\d+[\).:\-]\s*|[-*]\s+|[A-Z][\).:\-]\s+)(.+)$/);
    if (!markerMatch) continue;
    const candidate = (markerMatch ? markerMatch[1] : line).trim();
    if (candidate.length < 4) continue;
    if (/^(note|notes|if|then|when|must|should|include|exclude|order|rule)\b/i.test(candidate)) {
      continue;
    }

    const regex = buildRegexFromRuleLine(candidate);
    if (!regex) continue;

    const ruleId = slugifyRuleId(candidate) || `rule_${rules.length + 1}`;
    if (seenIds.has(ruleId)) continue;

    rules.push({
      id: ruleId,
      match: { titleRegex: regex },
      sortBy: "date",
      sortDirection: "asc",
    });
    seenIds.add(ruleId);
  }

  return rules;
}

function compileRegexes(values: string[] | undefined): RegExp[] {
  if (!values || values.length === 0) return [];
  return values
    .map((value) => {
      try {
        return new RegExp(value, "i");
      } catch {
        return null;
      }
    })
    .filter((regex): regex is RegExp => Boolean(regex));
}

function shouldExcludeGeneratedPacket(path: string): boolean {
  const lower = path.toLowerCase();
  if (!lower.endsWith(".pdf")) return true;
  if (lower.includes("/.pi_tool/")) return true;
  if (lower.includes("template")) return true;
  if (lower.includes("claimant index")) return true;
  if (lower.includes("document index")) return true;
  if (lower.includes("evidence packet")) return true;
  return false;
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

async function loadKnowledgeEvidencePacketConfig(firmRoot: string): Promise<LoadedKnowledgePacketConfig> {
  const explicitPath = join(firmRoot, ".pi_tool", "knowledge", "evidence-packet-rules.json");
  try {
    const explicitContent = await readFile(explicitPath, "utf-8");
    const explicitJson = safeJsonParse<Record<string, any>>(explicitContent);
    const normalized = normalizeKnowledgePacketConfig(explicitJson);
    if (normalized) {
      return {
        config: normalized,
        source: ".pi_tool/knowledge/evidence-packet-rules.json",
        rawText: explicitContent,
      };
    }
    return {
      config: null,
      source: ".pi_tool/knowledge/evidence-packet-rules.json",
      rawText: explicitContent,
    };
  } catch {
    // Continue to manifest sections
  }

  let firstRelevantText: { source: string; rawText: string } | null = null;
  try {
    const manifestPath = join(firmRoot, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    for (const section of manifest.sections || []) {
      const label = `${section?.id || ""} ${section?.title || ""}`.toLowerCase();
      const sectionFile = normalizeSectionFilename(section);
      if (!sectionFile) continue;

      try {
        const content = await readFile(join(firmRoot, ".pi_tool", "knowledge", sectionFile), "utf-8");
        const contentSnippet = content.slice(0, 4000).toLowerCase();
        const isPacketSection =
          /evidence|hearing|packet|exhibit|document index/.test(label) ||
          /evidence packet|hearing packet|document index|claimant index|exhibit order|h\.?o\.|hearing officer/.test(contentSnippet);
        if (!isPacketSection) continue;

        if (!firstRelevantText) {
          firstRelevantText = { source: `.pi_tool/knowledge/${sectionFile}`, rawText: content };
        }
        const parsedWhole = safeJsonParse<Record<string, any>>(content);
        const parsedFenced = parsedWhole || extractFirstJsonCodeFence(content);
        const normalized = normalizeKnowledgePacketConfig(parsedFenced);
        if (normalized) {
          return {
            config: normalized,
            source: `.pi_tool/knowledge/${sectionFile}`,
            rawText: content,
          };
        }
      } catch {
        // Try next section
      }
    }
  } catch {
    // No knowledge manifest or sections
  }

  if (firstRelevantText) {
    return {
      config: null,
      source: firstRelevantText.source,
      rawText: firstRelevantText.rawText,
    };
  }

  return { config: null, source: null, rawText: null };
}

function collectIndexedPdfDocs(indexData: any): IndexedPdfDoc[] {
  const docs: IndexedPdfDoc[] = [];
  const folders = indexData?.folders || {};

  for (const [folderName, folderData] of Object.entries(folders)) {
    const files: any[] = Array.isArray(folderData) ? folderData : (folderData as any)?.files || [];
    for (const file of files) {
      const filename = typeof file?.filename === "string" ? file.filename : null;
      if (!filename || !filename.toLowerCase().endsWith(".pdf")) continue;

      const relPath = `${folderName}/${filename}`;
      if (shouldExcludeGeneratedPacket(relPath)) continue;

      const title = typeof file?.title === "string" && file.title.trim()
        ? file.title.trim()
        : titleFromFilename(filename);

      const docDate = typeof file?.date === "string" ? file.date : parseDateFromFilename(filename);
      const docType = typeof file?.type === "string" && file.type.trim()
        ? file.type.trim()
        : inferDocType(title, relPath);

      docs.push({
        path: relPath,
        title,
        date: docDate,
        docType,
      });
    }
  }

  const deduped = new Map<string, IndexedPdfDoc>();
  for (const doc of docs) {
    const key = doc.path.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, doc);
  }
  return Array.from(deduped.values());
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

function selectDocsForHearing(
  docs: IndexedPdfDoc[],
  hearingNumber: string,
  config: KnowledgeEvidencePacketConfig | null
): IndexedPdfDoc[] {
  const tokens = hearingSearchTokens(hearingNumber);
  const includeRegexes = compileRegexes(config?.includePathRegexes);
  const excludeRegexes = compileRegexes(config?.excludePathRegexes);

  let selected = docs.filter((doc) => valueMatchesHearing(doc.path, tokens) || valueMatchesHearing(doc.title, tokens));

  if (selected.length === 0) {
    selected = docs.filter((doc) => doc.path.toLowerCase().startsWith("litigation/"));
  }

  if (selected.length === 0) {
    selected = docs;
  }

  if (includeRegexes.length > 0) {
    selected = selected.filter((doc) => includeRegexes.some((regex) => regex.test(doc.path)));
  }

  if (excludeRegexes.length > 0) {
    selected = selected.filter((doc) => !excludeRegexes.some((regex) => regex.test(doc.path)));
  }

  return selected;
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

function inferOutputPathFromDocs(docs: IndexedPdfDoc[], hearingNumber: string, explicitPath?: string): string {
  if (explicitPath && explicitPath.trim()) return explicitPath.trim();

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
    if (!item || typeof item.path !== "string") continue;
    const path = item.path.trim();
    if (!path) continue;

    const title = typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : titleFromFilename(path.split("/").pop() || path);

    docs.push({
      path,
      title,
      date: typeof item.date === "string" ? item.date : undefined,
      docType: typeof item.docType === "string"
        ? item.docType
        : typeof item.doc_type === "string"
          ? item.doc_type
          : undefined,
      include: typeof item.include === "boolean" ? item.include : true,
    });
  }
  return docs;
}

async function buildPacketFromInputs(
  caseFolder: string,
  firmRoot: string,
  indexData: any,
  hearingNumber: string,
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
      firmBlockLines = [
        firmInfo.firmName,
        firmInfo.address,
        `${firmInfo.city || ""}${firmInfo.city && firmInfo.state ? ", " : ""}${firmInfo.state || ""} ${firmInfo.zip || ""}`.trim(),
        firmInfo.phone,
      ].filter((line): line is string => Boolean(line && line.trim()));
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
      hearingNumber,
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

        // Handle PDFs specially
        if (toolInput.path.toLowerCase().endsWith('.pdf')) {
          const { execSync } = await import("child_process");
          try {
            const text = execSync(`pdftotext "${filePath}" - 2>/dev/null`, {
              maxBuffer: 1024 * 1024,
              encoding: 'utf-8'
            });
            return text.slice(0, 10000); // Limit output
          } catch {
            return "Error: Could not extract text from PDF";
          }
        }

        const content = await readFile(filePath, "utf-8");
        return content.slice(0, 15000); // Limit output to avoid context overflow
      }

      case "write_file": {
        const filePath = join(caseFolder, toolInput.path);
        if (!filePath.startsWith(caseFolder)) {
          return "Error: Cannot write files outside the case folder";
        }
        await writeFile(filePath, toolInput.content);
        return `Successfully wrote ${toolInput.content.length} characters to ${toolInput.path}`;
      }

      case "list_hearing_documents": {
        const firmRoot = dirname(caseFolder);
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);

        const allIndexedPdfs = collectIndexedPdfDocs(indexData);
        if (allIndexedPdfs.length === 0) {
          return JSON.stringify({
            success: false,
            error: "No PDF documents found in document_index.json. Re-index the case first.",
          });
        }

        const hearingInput = typeof toolInput.hearing_number === "string" ? toolInput.hearing_number.trim() : "";
        const inferredHearing = hearingInput || inferHearingNumberFromDocs(allIndexedPdfs);
        if (!inferredHearing) {
          return JSON.stringify({
            success: false,
            error: "hearing_number is required when multiple hearing folders exist.",
          });
        }

        const hearingNumber = extractHearingCore(inferredHearing);
        const {
          config: knowledgeConfig,
          source: knowledgeSource,
          rawText: knowledgeRawText,
        } = await loadKnowledgeEvidencePacketConfig(firmRoot);

        const inputIncludePathRegexes = Array.isArray(toolInput.include_path_regexes)
          ? toolInput.include_path_regexes.filter((v: any) => typeof v === "string")
          : undefined;
        const inputExcludePathRegexes = Array.isArray(toolInput.exclude_path_regexes)
          ? toolInput.exclude_path_regexes.filter((v: any) => typeof v === "string")
          : undefined;

        const effectiveConfig: KnowledgeEvidencePacketConfig = {
          includePathRegexes: inputIncludePathRegexes || knowledgeConfig?.includePathRegexes,
          excludePathRegexes: inputExcludePathRegexes || knowledgeConfig?.excludePathRegexes,
        };

        const selectedDocs = selectDocsForHearing(allIndexedPdfs, hearingNumber, effectiveConfig);
        const looseRules = parseLooseOrderRulesFromText(knowledgeRawText);

        return JSON.stringify({
          success: true,
          hearingNumber,
          candidateCount: selectedDocs.length,
          candidates: selectedDocs,
          knowledgeRuleSource: knowledgeSource,
          ruleHints: knowledgeConfig?.orderRules || looseRules,
          note: "Planning step only. Choose final ordered documents, then call build_evidence_packet.",
        });
      }

      case "create_evidence_packet": {
        const firmRoot = dirname(caseFolder);
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);

        const allIndexedPdfs = collectIndexedPdfDocs(indexData);
        if (allIndexedPdfs.length === 0) {
          return JSON.stringify({
            success: false,
            error: "No PDF documents found in document_index.json. Re-index the case first.",
          });
        }

        const hearingInput = typeof toolInput.hearing_number === "string" ? toolInput.hearing_number.trim() : "";
        const inferredHearing = hearingInput || inferHearingNumberFromDocs(allIndexedPdfs);
        if (!inferredHearing) {
          return JSON.stringify({
            success: false,
            error: "hearing_number is required when multiple hearing folders exist.",
          });
        }

        const hearingNumber = extractHearingCore(inferredHearing);
        const {
          config: knowledgeConfig,
          source: knowledgeSource,
          rawText: knowledgeRawText,
        } = await loadKnowledgeEvidencePacketConfig(firmRoot);

        const inputOrderRules = normalizeOrderRulesInput(toolInput.order_rules);
        const inputIncludePathRegexes = Array.isArray(toolInput.include_path_regexes)
          ? toolInput.include_path_regexes.filter((v: any) => typeof v === "string")
          : undefined;
        const inputExcludePathRegexes = Array.isArray(toolInput.exclude_path_regexes)
          ? toolInput.exclude_path_regexes.filter((v: any) => typeof v === "string")
          : undefined;
        const inputService = normalizeServiceInput(toolInput.service);
        const inputRulesText = typeof toolInput.rules_text === "string" ? toolInput.rules_text : undefined;

        const effectiveConfig: KnowledgeEvidencePacketConfig = {
          orderRules: inputOrderRules || knowledgeConfig?.orderRules,
          includePathRegexes: inputIncludePathRegexes || knowledgeConfig?.includePathRegexes,
          excludePathRegexes: inputExcludePathRegexes || knowledgeConfig?.excludePathRegexes,
          includeAffirmationPage: typeof toolInput.include_affirmation_page === "boolean"
            ? toolInput.include_affirmation_page
            : knowledgeConfig?.includeAffirmationPage,
          pageStampPrefix: typeof toolInput.page_stamp_prefix === "string"
            ? toolInput.page_stamp_prefix
            : knowledgeConfig?.pageStampPrefix,
          pageStampStart: typeof toolInput.page_stamp_start === "number"
            ? toolInput.page_stamp_start
            : knowledgeConfig?.pageStampStart,
          service: inputService || knowledgeConfig?.service,
          defaultRedactionMode: knowledgeConfig?.defaultRedactionMode,
        };

        const selectedDocs = selectDocsForHearing(allIndexedPdfs, hearingNumber, effectiveConfig);
        if (selectedDocs.length === 0) {
          return JSON.stringify({
            success: false,
            error: `No PDF documents matched hearing ${normalizeHearingNumber(hearingNumber)}.`,
          });
        }

        const normalizedDocuments: EvidencePacketDocumentInput[] = selectedDocs.map((doc) => ({
          path: doc.path,
          title: doc.title,
          date: doc.date,
          docType: doc.docType,
          include: true,
        }));

        const looseRules = parseLooseOrderRulesFromText(inputRulesText || knowledgeRawText);
        const resolvedOrderRules =
          effectiveConfig.orderRules && effectiveConfig.orderRules.length > 0
            ? effectiveConfig.orderRules
            : looseRules.length > 0
              ? looseRules
              : defaultEvidencePacketOrderRules();

        const redaction = resolveRedactionOptions(
          typeof toolInput.redaction_mode === "string" ? toolInput.redaction_mode : undefined,
          effectiveConfig
        );

        let firmBlockLines: string[] | undefined;
        try {
          const firmInfo = await loadFirmInfo(firmRoot);
          if (firmInfo) {
            firmBlockLines = [
              firmInfo.firmName,
              firmInfo.address,
              `${firmInfo.city || ""}${firmInfo.city && firmInfo.state ? ", " : ""}${firmInfo.state || ""} ${firmInfo.zip || ""}`.trim(),
              firmInfo.phone,
            ].filter((line): line is string => Boolean(line && line.trim()));
          }
        } catch {
          // no-op
        }

        const outputPath = inferOutputPathFromDocs(
          selectedDocs,
          hearingNumber,
          typeof toolInput.output_path === "string" ? toolInput.output_path : undefined
        );

        const resolvedCaseFolder = resolve(caseFolder);
        const fullOutputPath = resolve(caseFolder, outputPath);
        if (fullOutputPath !== resolvedCaseFolder && !fullOutputPath.startsWith(resolvedCaseFolder + sep)) {
          return JSON.stringify({
            success: false,
            error: "output_path must be within the case folder.",
          });
        }

        const packet = await buildEvidencePacket({
          caseFolder,
          documents: normalizedDocuments,
          caption: {
            claimantName: indexData?.summary?.client || "Claimant",
            claimNumber: inferClaimNumber(indexData),
            hearingNumber,
            hearingDateTime: typeof toolInput.hearing_datetime === "string" ? toolInput.hearing_datetime : undefined,
            appearance: typeof toolInput.appearance === "string" ? toolInput.appearance : undefined,
          },
          orderRules: resolvedOrderRules,
          redaction,
          service: effectiveConfig.service,
          includeAffirmationPage: effectiveConfig.includeAffirmationPage ?? true,
          pageStampPrefix: effectiveConfig.pageStampPrefix,
          pageStampStart: effectiveConfig.pageStampStart,
          firmBlockLines,
        });

        await mkdir(dirname(fullOutputPath), { recursive: true });
        await writeFile(fullOutputPath, packet.pdfBytes);

        const warnings = [...packet.warnings];
        if (looseRules.length > 0 && (!effectiveConfig.orderRules || effectiveConfig.orderRules.length === 0)) {
          warnings.push("Parsed ordering rules from narrative knowledge text (verbatim source) because no structured rule object was provided.");
        }
        if ((!effectiveConfig.orderRules || effectiveConfig.orderRules.length === 0) && looseRules.length === 0) {
          warnings.push("No packet ordering rules found in provided knowledge/tool input; fallback default ordering rules were used.");
        }

        return JSON.stringify({
          success: true,
          outputPath,
          fullPath: fullOutputPath,
          hearingNumber,
          totalPages: packet.totalPages,
          documentsIncluded: normalizedDocuments.length,
          knowledgeRuleSource: knowledgeSource,
          ruleMode: effectiveConfig.orderRules?.length
            ? "structured"
            : looseRules.length > 0
              ? "narrative_parsed"
              : "default_fallback",
          warnings,
          redactionFindings: packet.redactionFindings,
          instruction: `Packet created. Include [[SHOW_FILE: ${outputPath}]] in your response so the user can review it in this workspace.`,
        });
      }

      case "build_evidence_packet": {
        const firmRoot = dirname(caseFolder);
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const indexData = JSON.parse(indexContent);

        const documents = normalizeDocumentsInput(toolInput.documents);
        if (documents.length === 0) {
          return JSON.stringify({
            success: false,
            error: "build_evidence_packet requires a non-empty documents[] ordered list.",
          });
        }

        const hearingInput = typeof toolInput.hearing_number === "string" ? toolInput.hearing_number.trim() : "";
        const inferredHearing = hearingInput || inferHearingNumberFromDocs(
          documents.map((doc) => ({
            path: doc.path,
            title: doc.title,
            date: doc.date,
            docType: doc.docType,
          }))
        );
        if (!inferredHearing) {
          return JSON.stringify({
            success: false,
            error: "hearing_number is required when it cannot be inferred from documents.",
          });
        }

        const hearingNumber = extractHearingCore(inferredHearing);
        const { config: knowledgeConfig } = await loadKnowledgeEvidencePacketConfig(firmRoot);
        const inputService = normalizeServiceInput(toolInput.service);

        const { outputPath, fullOutputPath, packet } = await buildPacketFromInputs(
          caseFolder,
          firmRoot,
          indexData,
          hearingNumber,
          documents,
          {
            outputPath: typeof toolInput.output_path === "string" ? toolInput.output_path : undefined,
            hearingDateTime: typeof toolInput.hearing_datetime === "string" ? toolInput.hearing_datetime : undefined,
            appearance: typeof toolInput.appearance === "string" ? toolInput.appearance : undefined,
            redactionMode: typeof toolInput.redaction_mode === "string" ? toolInput.redaction_mode : undefined,
            includeAffirmationPage: typeof toolInput.include_affirmation_page === "boolean"
              ? toolInput.include_affirmation_page
              : knowledgeConfig?.includeAffirmationPage,
            pageStampPrefix: typeof toolInput.page_stamp_prefix === "string"
              ? toolInput.page_stamp_prefix
              : knowledgeConfig?.pageStampPrefix,
            pageStampStart: typeof toolInput.page_stamp_start === "number"
              ? toolInput.page_stamp_start
              : knowledgeConfig?.pageStampStart,
            service: inputService || knowledgeConfig?.service,
            defaultRedactionMode: knowledgeConfig?.defaultRedactionMode,
          }
        );

        return JSON.stringify({
          success: true,
          outputPath,
          fullPath: fullOutputPath,
          hearingNumber,
          totalPages: packet.totalPages,
          documentsIncluded: documents.length,
          warnings: packet.warnings,
          redactionFindings: packet.redactionFindings,
          instruction: `Packet created. Include [[SHOW_FILE: ${outputPath}]] in your response so the user can review it in this workspace.`,
        });
      }

      case "update_index": {
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
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

        await writeFile(indexPath, JSON.stringify(index, null, 2));
        return `Updated ${toolInput.field_path} from "${oldValue}" to "${toolInput.value}"`;
      }

      case "get_conflicts": {
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        const needsReview: any[] = index.needs_review || [];

        if (needsReview.length === 0) {
          return JSON.stringify({
            status: "all_done",
            message: "All conflicts have been resolved! No more items to review.",
            count: 0,
            items: []
          });
        }

        // Build filename -> path lookup from folders
        const filePathMap: Record<string, string> = {};
        if (index.folders) {
          for (const [folderName, folderData] of Object.entries(index.folders)) {
            const files: any[] = Array.isArray(folderData) ? folderData : (folderData as any)?.files || [];
            for (const file of files) {
              if (file.filename) {
                filePathMap[file.filename] = `${folderName}/${file.filename}`;
              }
            }
          }
        }

        // Return ALL items with resolved sources
        const items = needsReview.map((item, idx) => {
          const resolvedSources = (item.sources || []).map((source: string) => {
            const match = source.match(/^([^(]+)/);
            const filename = match ? match[1].trim() : source.trim();
            return {
              original: source,
              filename,
              path: filePathMap[filename] || null
            };
          });

          return {
            index: idx + 1,
            field: item.field,
            conflicting_values: item.conflicting_values,
            sources: item.sources,
            resolved_sources: resolvedSources,
            reason: item.reason
          };
        });

        return JSON.stringify({
          status: "conflicts_found",
          count: needsReview.length,
          items
        });
      }

      case "batch_resolve_conflicts": {
        const { resolutions } = toolInput;
        if (!Array.isArray(resolutions) || resolutions.length === 0) {
          return JSON.stringify({ success: false, error: "No resolutions provided" });
        }

        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        let needsReview: any[] = index.needs_review || [];
        const errata: any[] = index.errata || [];
        let caseNotes: any[] = Array.isArray(index.case_notes) ? index.case_notes : [];

        const resolved: string[] = [];
        const failed: string[] = [];

        for (const resolution of resolutions) {
          const { field, resolved_value, evidence } = resolution;
          const itemIndex = findFieldIndex(needsReview, field);

          if (itemIndex === -1) {
            failed.push(field);
            continue;
          }

          const resolvedItem = needsReview[itemIndex];
          const rejectedValues = resolvedItem.conflicting_values?.filter(
            (v: any) => String(v) !== String(resolved_value)
          ) || [];

          // Remove from needs_review
          needsReview.splice(itemIndex, 1);

          // Add to errata
          errata.push({
            field,
            decision: resolved_value,
            rejected_values: rejectedValues,
            evidence: evidence || "Batch resolution",
            resolution_type: "batch_review",
            resolved_at: new Date().toISOString()
          });

          // Add to case_notes
          caseNotes.push({
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            content: `Resolved ${field}: ${resolved_value}. ${evidence || ""}`.trim(),
            field_updated: field,
            previous_value: rejectedValues,
            source: "batch_review",
            createdAt: new Date().toISOString()
          });

          resolved.push(field);

          // Update summary fields if applicable
          if (field.startsWith("charges:") && index.summary?.providers) {
            const providerName = field.replace("charges:", "");
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
          if ((field === "date_of_loss" || field === "date_of_injury" || field === "doi" || field === "dol") && index.summary) {
            index.summary.dol = resolved_value;
            index.summary.incident_date = resolved_value;
          }
          if ((field === "amw" || field === "aww" || field === "average_monthly_wage") && index.summary) {
            if (!index.summary.disability_status) index.summary.disability_status = {};
            index.summary.disability_status.amw = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          }
          if ((field === "compensation_rate" || field === "weekly_compensation_rate") && index.summary) {
            if (!index.summary.disability_status) index.summary.disability_status = {};
            index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          }
          if (field.startsWith("claim_numbers:") && index.summary) {
            const claimKey = field.replace("claim_numbers:", "");
            if (!index.summary.claim_numbers) index.summary.claim_numbers = {};
            index.summary.claim_numbers[claimKey] = resolved_value;
          }
        }

        index.needs_review = needsReview;
        index.errata = errata;
        index.case_notes = caseNotes;

        await writeFile(indexPath, JSON.stringify(index, null, 2));

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
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);

        // Find the item in needs_review
        const needsReview: any[] = index.needs_review || [];
        const itemIndex = findFieldIndex(needsReview, field);

        if (itemIndex === -1) {
          return JSON.stringify({
            success: false,
            error: `Field "${field}" not found in needs_review`
          });
        }

        const resolvedItem = needsReview[itemIndex];
        const rejectedValues = resolvedItem.conflicting_values?.filter(
          (v: any) => String(v) !== String(resolved_value)
        ) || [];

        // Remove from needs_review
        needsReview.splice(itemIndex, 1);
        index.needs_review = needsReview;

        // Add to errata
        const errata: any[] = index.errata || [];
        const errataEntry = {
          field,
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
          content: `Resolved ${field}: ${resolved_value} (was conflicting: ${rejectedValues.join(", ")}). ${evidence || ""}`.trim(),
          field_updated: field,
          previous_value: rejectedValues,
          source: "chat_review",
          createdAt: new Date().toISOString()
        });
        index.case_notes = caseNotes;

        // Update summary fields if applicable
        let summaryUpdated = false;

        // For charges fields, update provider and total
        if (field.startsWith("charges:") && index.summary?.providers) {
          const providerName = field.replace("charges:", "");
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
        if ((field === "date_of_loss" || field === "date_of_injury" || field === "doi" || field === "dol") && index.summary) {
          index.summary.dol = resolved_value;
          index.summary.incident_date = resolved_value;
          summaryUpdated = true;
        }

        // For AMW/compensation_rate, update disability_status
        if ((field === "amw" || field === "aww" || field === "average_monthly_wage") && index.summary) {
          if (!index.summary.disability_status) index.summary.disability_status = {};
          index.summary.disability_status.amw = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          summaryUpdated = true;
        }
        if ((field === "compensation_rate" || field === "weekly_compensation_rate") && index.summary) {
          if (!index.summary.disability_status) index.summary.disability_status = {};
          index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
          summaryUpdated = true;
        }

        // For claim_numbers, update summary
        if (field.startsWith("claim_numbers:") && index.summary) {
          const claimKey = field.replace("claim_numbers:", "");
          if (!index.summary.claim_numbers) {
            index.summary.claim_numbers = {};
          }
          index.summary.claim_numbers[claimKey] = resolved_value;
          summaryUpdated = true;
        }

        // Write updated index
        await writeFile(indexPath, JSON.stringify(index, null, 2));

        return JSON.stringify({
          success: true,
          field,
          resolved_value,
          rejected_values: rejectedValues,
          remaining_conflicts: needsReview.length,
          summary_updated: summaryUpdated,
          message: `Resolved "${field}" to "${resolved_value}". ${needsReview.length} conflict(s) remaining.`
        });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Build context from case folder
async function buildContext(caseFolder: string): Promise<string> {
  const parts: string[] = [];
  const firmRoot = dirname(caseFolder);

  // Current date
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  parts.push(`TODAY'S DATE: ${dateStr}`);

  // Load case index
  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);

    // Trim index to manageable size
    const trimmed = { ...indexData };

    // Remove verbose extracted_data from folders, keep key_info
    if (trimmed.folders) {
      for (const folderData of Object.values(trimmed.folders) as any[]) {
        const files = Array.isArray(folderData) ? folderData : folderData?.files;
        if (Array.isArray(files)) {
          for (const file of files) {
            delete file.extracted_data;
            delete file.extracted_text;
            delete file.full_text;
            if (file.key_info && file.key_info.length > 300) {
              file.key_info = file.key_info.slice(0, 300) + "...";
            }
          }
        }
      }
    }

    parts.push(`\n## CASE INDEX\n${JSON.stringify(trimmed, null, 2)}`);
  } catch {
    parts.push("\n## CASE INDEX\nNo case index found. Case may need to be indexed first.");
  }

  // Load knowledge bank
  try {
    const knowledgePath = join(firmRoot, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(knowledgePath, "utf-8"));
    parts.push(`\n## PRACTICE KNOWLEDGE\nArea: ${manifest.practiceArea} (${manifest.jurisdiction})`);

    // Load key knowledge sections (abbreviated for general context) and include
    // packet/hearing rules verbatim so the agent can apply them without reformatting.
    if (manifest.sections) {
      const knowledgeSummary: string[] = [];
      const packetRuleSections: string[] = [];
      for (const section of manifest.sections) {
        try {
          const sectionFilename = normalizeSectionFilename(section);
          if (!sectionFilename) continue;
          const sectionPath = join(firmRoot, ".pi_tool", "knowledge", sectionFilename);
          const content = await readFile(sectionPath, "utf-8");
          const sectionLabel = `${section.id || ""} ${section.title || ""}`.toLowerCase();
          const contentSnippet = content.slice(0, 4000).toLowerCase();
          const isPacketRules =
            /evidence|hearing|packet|exhibit|document index/.test(sectionLabel) ||
            /evidence packet|hearing packet|document index|claimant index|exhibit order|h\.?o\.|hearing officer/.test(contentSnippet);

          if (isPacketRules) {
            packetRuleSections.push(`### ${section.title}\n${content}`);
          } else if (knowledgeSummary.length < 5) {
            knowledgeSummary.push(`### ${section.title}\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`);
          }
        } catch {
          // Skip unreadable sections
        }
      }
      if (knowledgeSummary.length > 0) {
        parts.push(knowledgeSummary.join("\n\n"));
      }
      if (packetRuleSections.length > 0) {
        parts.push(`\n## EVIDENCE PACKET RULES (VERBATIM)\n${packetRuleSections.join("\n\n---\n\n")}`);
      }
    }
  } catch {
    // No knowledge base
  }

  // Load templates list
  try {
    const templatesPath = join(firmRoot, ".pi_tool", "templates", "templates.json");
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

  return parts.join("\n");
}

// Document type descriptions for user feedback
const DOC_TYPE_NAMES: Record<DocumentType, string> = {
  demand_letter: "demand letter",
  case_memo: "case memo",
  settlement: "settlement calculation",
  general_letter: "letter"
};

// System prompt for direct chat (context gets appended)
const BASE_SYSTEM_PROMPT = `You are a helpful legal assistant for a Nevada injury law firm (Personal Injury and Workers' Compensation). You help attorneys and staff with case management, document review, answering questions, and drafting documents.

## YOUR CAPABILITIES

1. **Answer Questions**: Use the case index and your knowledge to answer questions about cases, injuries, treatments, and PI law.

2. **Read Files**: Use read_file for quick text lookups — reading the index, checking a text/JSON file, or grabbing a snippet. For PDFs this uses basic text extraction only.

3. **Update Case Data**: Use update_index when the user provides corrections or new information about a case.

4. **Generate Documents**: When the user asks you to draft, write, create, or generate a formal document (demand letter, case memo, settlement calculation, letter), use the generate_document tool. This delegates to a specialized agent with access to firm templates that will create a complete, professional document.

## WHEN TO USE generate_document

Use this tool when the user wants a NEW document created:
- "Draft a demand letter"
- "Write up a case memo"
- "Create a settlement breakdown"
- "Prepare a letter of protection"

Do NOT use it for:
- Questions about what should go in a document
- Reviewing existing documents
- Simple notes or quick responses

5. **Read Documents with Vision**: Use read_document to analyze specific documents in detail, especially PDFs. This spawns a vision-capable reader that sees rendered pages — form layouts, tables, handwriting, checkboxes, images — not just extracted text. Much better than read_file for PDFs with complex formatting.

## WHEN TO USE read_document

Use read_document when the user asks about a specific document's contents, especially PDFs:
- "What does the MRI report say?"
- "What are the charges on the billing statement?"
- "What injuries are listed in the intake form?"
- "Can you read the police report?"

Use read_file instead for:
- Reading the document index (.pi_tool/document_index.json)
- Quick lookups on text or JSON files
- Files you already know are simple text

6. **Review Document Conflicts**: When the user wants to review conflicts, use get_conflicts to get all items, analyze them, make recommendations, and present them in batches for approval.

7. **Build Hearing Evidence Packets**: Use a strict two-pass workflow:
- Pass 1 (agent planning): call list_hearing_documents, then choose and order documents according to knowledge rules.
- Pass 2 (deterministic build): call build_evidence_packet with your explicit ordered documents list.

## WHEN TO USE HEARING PACKET TOOLS

Use this tool when the user asks for:
- "evidence packet"
- "hearing packet"
- "document index packet"
- "H.O. packet"

Rule handling requirement:
- Use the evidence/hearing packet rules exactly as they appear in knowledge.
- Do not require the user to reformat those rules.
- If rules are narrative markdown, pass them through using rules_text and/or provide order_rules inferred from that text.

Execution requirement:
- Do NOT skip directly to building from implicit defaults when the user asked for a packet.
- First list candidates, then submit an explicit ordered documents array to build_evidence_packet.

After the tool succeeds, include a file reference using:
[[SHOW_FILE: relative/path/to/output.pdf]]
so the user can review the packet in this workspace.

## DOCUMENT REVIEW MODE

Use this when the user says things like:
- "Let's review the conflicts"
- "Go through the needs_review items"
- "Review document issues"

### How to conduct a batch review:

1. **Get all conflicts** - Call get_conflicts to retrieve everything

2. **Analyze and categorize** - Group conflicts by:
   - **Auto-resolve** (high confidence): OCR errors, formatting differences, clear typos
   - **Recommend** (medium confidence): One source more authoritative than another
   - **Needs discussion** (low confidence): Genuinely ambiguous, need user input

3. **Present in batches** - Show your recommendations grouped like:

   **Quick Fixes (I recommend these)**
   1. Date of Loss: "06/25/2023" (typo in one document shows 05/25)
   2. Claim Number format: "03-52P5-85B" (just formatting difference)
   Approve these? (yes/no/edit)

   **Need Your Input**
   3. Charges for Spinal Rehab: $6,558 vs $10,558 - which invoice is correct?

4. **Batch resolve** - When user approves, call batch_resolve_conflicts with all approved resolutions at once

5. **Verify and continue** - After batch_resolve_conflicts, if any conflicts remain (check the "remaining" count in the response), call get_conflicts again and resolve them. Do NOT report completion until remaining is 0. Keep going until every conflict is resolved or explicitly deferred by the user.

### Example flow:

User: "Let's review the conflicts"

You: [call get_conflicts]

You: "I found 26 conflicts. After analyzing them, here's my breakdown:

**Ready to Auto-Resolve (15 items):**
These are formatting differences, OCR errors, or clear typos where I'm confident about the correct value:
- Date of Loss: 06/25/2023 (not 05/25 - typo in radiology doc)
- DOB: 06/27/1984 (not 1949 or 1964 - HIPAA form errors)
- Client name: Brenda Boerdam-Madrid (with hyphen)
[... etc]

**Need Your Review (11 items):**
- Spinal Rehab charges: $6,558 vs $10,558 - genuinely different amounts
- Balance fields: Several show $0 vs original amount (may depend on payment timing)

Want me to apply the 15 auto-resolutions? Then we can discuss the remaining 11."

User: "Yes, apply them"

You: [call batch_resolve_conflicts with the 15 resolutions]

You: "Done! 15 resolved. Now let's look at the remaining 11..."

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
): AsyncGenerator<{ type: string; content?: string; tool?: string; done?: boolean; usage?: any; filePath?: string }> {

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
  const MAX_TOOL_ITERATIONS = 8;
  let iterations = 0;
  let generatedFilePath: string | undefined;

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
        if (toolUse.name === "create_evidence_packet" || toolUse.name === "build_evidence_packet") {
          const parsed = safeJsonParse<{ outputPath?: string; success?: boolean }>(result);
          if (parsed?.success && parsed.outputPath) {
            generatedFilePath = parsed.outputPath;
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

    yield { type: "done", done: true, filePath: generatedFilePath };
  } finally {
    if (lockResult.acquired) {
      await releaseCaseLock(caseFolder, lockOwner);
    }
  }
}
