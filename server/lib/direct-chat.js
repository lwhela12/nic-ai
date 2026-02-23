"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMetaIndexSectionTags = updateMetaIndexSectionTags;
exports.findKnowledgeSectionsByTag = findKnowledgeSectionsByTag;
exports.directChat = directChat;
var sdk_1 = require("@anthropic-ai/sdk");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var year_mode_1 = require("./year-mode");
var doc_agent_1 = require("./doc-agent");
var doc_reader_1 = require("./doc-reader");
var case_lock_1 = require("./case-lock");
var evidence_packet_1 = require("./evidence-packet");
var export_1 = require("./export");
var index_summary_sync_1 = require("./index-summary-sync");
var pdftotext_1 = require("./pdftotext");
var extract_1 = require("./extract");
var meta_index_1 = require("./meta-index");
var firm_1 = require("../routes/firm");
var document_id_1 = require("./document-id");
var knowledge_tagger_1 = require("./knowledge-tagger");
// Client creation - recreated when API key changes
// Web shim (imported in server/index.ts) handles runtime selection
var _anthropic = null;
var _lastApiKey = undefined;
function getClient() {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    // Recreate client if API key changed (e.g., was undefined, now set by auth)
    if (_anthropic && _lastApiKey !== apiKey) {
        _anthropic = null;
    }
    if (!_anthropic) {
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY is not set. Auth middleware may have been bypassed.");
        }
        _anthropic = new sdk_1.default({
            apiKey: apiKey,
            fetch: globalThis.fetch.bind(globalThis),
        });
        _lastApiKey = apiKey;
    }
    return _anthropic;
}
var CASE_CONTEXT_MAX_CHARS = 180000;
var INDEX_SLICE_MAX_CHARS = 12000;
var CONFLICT_BATCH_DEFAULT = 25;
var CONFLICT_BATCH_MAX = 80;
var KNOWLEDGE_PREVIEW_CHARS = 420;
var KNOWLEDGE_META_INDEX_MAX_CHARS = 24000;
var KNOWLEDGE_META_INDEX_PATH = ".ai_tool/knowledge/meta_index.json";
// Tool definitions
var TOOLS = [
    {
        name: "read_file",
        description: "Read the contents of a file in the case folder. Use for text documents, DOCX files, PDFs when OCR/text extraction is sufficient, JSON, and indexed artifacts.",
        input_schema: {
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
var WRITE_TOOLS = new Set([
    "write_file",
    "update_index",
    "update_file_entry",
    "rerun_hypergraph",
    "generate_document",
    "build_evidence_packet",
    "batch_resolve_conflicts",
    "resolve_conflict",
]);
function getTools(readOnlyMode) {
    if (!readOnlyMode)
        return TOOLS;
    return TOOLS.filter(function (tool) { return !WRITE_TOOLS.has(tool.name); });
}
function normalizeFieldName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[_:]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[''`]/g, "'");
}
// Fuzzy field matching - handles casing, whitespace, and punctuation variations
function findFieldIndex(needsReview, field) {
    // Tier 1: Exact match
    var exact = needsReview.findIndex(function (item) { return item.field === field; });
    if (exact !== -1)
        return exact;
    // Tier 2: Case-insensitive + trimmed
    var normalizedField = field.trim().toLowerCase();
    var ci = needsReview.findIndex(function (item) { var _a; return ((_a = item.field) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) === normalizedField; });
    if (ci !== -1)
        return ci;
    // Tier 3: Normalize punctuation (underscores, colons, apostrophe variants)
    var norm = normalizeFieldName(field);
    var normMatch = needsReview.findIndex(function (item) {
        return normalizeFieldName(item.field || "") === norm;
    });
    if (normMatch !== -1)
        return normMatch;
    return -1;
}
function findMatchingFieldIndexes(needsReview, field) {
    var _a, _b, _c;
    var matchIndex = findFieldIndex(needsReview, field);
    if (matchIndex === -1)
        return [];
    var matchedField = (_b = (_a = needsReview[matchIndex]) === null || _a === void 0 ? void 0 : _a.field) !== null && _b !== void 0 ? _b : field;
    var normalizedMatchedField = normalizeFieldName(matchedField);
    var indexes = [];
    for (var i = 0; i < needsReview.length; i++) {
        if (normalizeFieldName(((_c = needsReview[i]) === null || _c === void 0 ? void 0 : _c.field) || "") === normalizedMatchedField) {
            indexes.push(i);
        }
    }
    return indexes;
}
function dedupeNeedsReviewEntries(needsReview) {
    var merged = new Map();
    for (var _i = 0, _a = needsReview || []; _i < _a.length; _i++) {
        var item = _a[_i];
        var field = item === null || item === void 0 ? void 0 : item.field;
        var key = normalizeFieldName(field || "");
        if (!key)
            continue;
        var existing = merged.get(key);
        if (!existing) {
            existing = {
                field: field || "",
                conflicting_values: new Set(),
                sources: new Set(),
                reasons: new Set(),
            };
            merged.set(key, existing);
        }
        for (var _b = 0, _c = Array.isArray(item === null || item === void 0 ? void 0 : item.conflicting_values) ? item.conflicting_values : []; _b < _c.length; _b++) {
            var value = _c[_b];
            existing.conflicting_values.add(String(value));
        }
        for (var _d = 0, _e = Array.isArray(item === null || item === void 0 ? void 0 : item.sources) ? item.sources : []; _d < _e.length; _d++) {
            var source = _e[_d];
            existing.sources.add(String(source));
        }
        if (item === null || item === void 0 ? void 0 : item.reason) {
            existing.reasons.add(String(item.reason));
        }
    }
    return Array.from(merged.values()).map(function (item) {
        var reasons = Array.from(item.reasons);
        return {
            field: item.field,
            conflicting_values: Array.from(item.conflicting_values),
            sources: Array.from(item.sources),
            reason: reasons.length > 0 ? reasons.join(" | ") : "Conflicting values found",
        };
    });
}
function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    }
    catch (_a) {
        return null;
    }
}
function normalizeSectionFilename(section) {
    var filename = typeof (section === null || section === void 0 ? void 0 : section.filename) === "string" ? section.filename : section === null || section === void 0 ? void 0 : section.file;
    return typeof filename === "string" && filename.trim() ? filename.trim() : null;
}
function normalizeServiceInput(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
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
            ? raw.recipients.filter(function (v) { return typeof v === "string"; })
            : undefined,
        servedBy: typeof raw.servedBy === "string"
            ? raw.servedBy
            : typeof raw.served_by === "string"
                ? raw.served_by
                : undefined,
    };
}
function normalizeHearingNumber(input) {
    var trimmed = input.trim();
    if (!trimmed)
        return "";
    return /^ho-/i.test(trimmed) ? trimmed : "HO-".concat(trimmed);
}
function extractHearingCore(input) {
    return normalizeHearingNumber(input).replace(/^ho-/i, "");
}
function hearingSearchTokens(hearingNumber) {
    var normalized = normalizeHearingNumber(hearingNumber).toLowerCase();
    var core = normalized.replace(/^ho-/, "");
    var digits = core.replace(/[^0-9]/g, "");
    var compact = normalized.replace(/[^a-z0-9]/g, "");
    var coreCompact = core.replace(/[^a-z0-9]/g, "");
    var tokens = [normalized, core, compact, coreCompact, digits]
        .map(function (token) { return token.trim(); })
        .filter(function (token, idx, arr) { return token.length > 0 && arr.indexOf(token) === idx; });
    return tokens;
}
function valueMatchesHearing(value, tokens) {
    var lower = value.toLowerCase();
    var compact = lower.replace(/[^a-z0-9]/g, "");
    return tokens.some(function (token) {
        if (!token)
            return false;
        if (lower.includes(token))
            return true;
        if (token.length >= 6 && compact.includes(token.replace(/[^a-z0-9]/g, "")))
            return true;
        return false;
    });
}
function parseDateFromFilename(filename) {
    var dateMatch = filename.match(/\b(20\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})\b/);
    if (!dateMatch)
        return undefined;
    var year = dateMatch[1];
    var month = dateMatch[2].padStart(2, "0");
    var day = dateMatch[3].padStart(2, "0");
    return "".concat(year, "-").concat(month, "-").concat(day);
}
function titleFromFilename(filename) {
    return filename
        .replace(/\.[^/.]+$/, "")
        .replace(/[_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isPlaceholderDocumentTitle(value) {
    var normalized = String(value || "").trim().toLowerCase();
    if (!normalized)
        return true;
    if (normalized === "selected document" || normalized === "selected doc" || normalized === "document") {
        return true;
    }
    return /^doc_[a-f0-9]{8}$/i.test(normalized);
}
function inferDocType(title, path) {
    var value = "".concat(title, " ").concat(path).toLowerCase();
    if (/\bc-?3\b/.test(value))
        return "c3";
    if (/\bc-?4\b/.test(value))
        return "c4";
    if (/notice of hearing|hearing notice/.test(value))
        return "notice_of_hearing";
    if (/notice of claim acceptance|acceptance|denial/.test(value))
        return "claim_acceptance_or_denial";
    if (/notice of appearance|representation|letter of representation/.test(value))
        return "representation";
    if (/ppd|ime|medical report|doctor|dr\./.test(value))
        return "medical_report";
    if (/request|letter|correspondence|memo/.test(value))
        return "correspondence";
    return undefined;
}
function normalizeRelativePathForLookup(path) {
    return String(path || "")
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .trim()
        .toLowerCase();
}
function normalizeFolderForPath(path) {
    var normalized = normalizeRelativePathForLookup(path);
    if (normalized === "." || normalized === "./")
        return "";
    return normalized.replace(/\/+$/, "");
}
function collectIndexedDocumentPathMap(indexData) {
    var pathMap = new Map();
    var folders = (indexData === null || indexData === void 0 ? void 0 : indexData.folders) || {};
    for (var _i = 0, _a = Object.entries(folders); _i < _a.length; _i++) {
        var _b = _a[_i], folderNameRaw = _b[0], folderData = _b[1];
        var docs = [];
        if (Array.isArray(folderData)) {
            docs = folderData;
        }
        else if (folderData && typeof folderData === "object" && Array.isArray(folderData.files)) {
            docs = folderData.files;
        }
        else if (folderData && typeof folderData === "object" && Array.isArray(folderData.documents)) {
            docs = folderData.documents;
        }
        var folderName = normalizeFolderForPath(String(folderNameRaw || ""));
        for (var _c = 0, docs_1 = docs; _c < docs_1.length; _c++) {
            var doc = docs_1[_c];
            var filename = typeof doc === "string"
                ? doc
                : typeof (doc === null || doc === void 0 ? void 0 : doc.filename) === "string"
                    ? doc.filename
                    : typeof (doc === null || doc === void 0 ? void 0 : doc.file) === "string"
                        ? doc.file
                        : "";
            if (!filename)
                continue;
            var canonicalPath = folderName ? "".concat(folderName, "/").concat(filename) : filename;
            var normalizedPath = normalizeRelativePathForLookup(canonicalPath);
            if (!normalizedPath)
                continue;
            if (!pathMap.has(normalizedPath)) {
                pathMap.set(normalizedPath, canonicalPath);
            }
        }
    }
    return pathMap;
}
function normalizeDocumentViewSortBy(value) {
    var normalized = String(value || "").trim().toLowerCase();
    if (normalized === "folder" || normalized === "date" || normalized === "type") {
        return normalized;
    }
    return undefined;
}
function normalizeDocumentViewSortDirection(value) {
    var normalized = String(value || "").trim().toLowerCase();
    if (normalized === "asc" || normalized === "desc") {
        return normalized;
    }
    return undefined;
}
function truncateForIndex(value, max) {
    if (max === void 0) { max = KNOWLEDGE_PREVIEW_CHARS; }
    var normalized = (value || "").trim().replace(/\s+/g, " ");
    if (!normalized)
        return "";
    return normalized.length <= max ? normalized : "".concat(normalized.slice(0, max), "...");
}
function toMetaKnowledgePath(filename) {
    return ".ai_tool/knowledge/".concat(filename);
}
function getFileMtimeMs(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var stats, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.stat)(filePath)];
                case 1:
                    stats = _b.sent();
                    return [2 /*return*/, stats.mtimeMs];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function getManifestSections(manifest) {
    if (!manifest || !Array.isArray(manifest.sections))
        return [];
    return manifest.sections.filter(function (section) { return section && typeof section === "object"; });
}
function buildMetaKnowledgeIndex(firmRoot, manifest, manifestMtimeMs, precomputedTags, knowledgeSummary) {
    return __awaiter(this, void 0, void 0, function () {
        var knowledgeDir, manifestPath, loadedManifest, _a, _b, sectionsData, sectionMtimes, sections, seenFilenames, _i, sectionsData_1, section, filename, title, snippet, charCount, sectionPath, sectionMtime, sectionContent, firstLine, body, _c, sectionEntry, tags, hasSemanticTags, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    knowledgeDir = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge");
                    manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 12, , 13]);
                    _a = manifest;
                    if (_a) return [3 /*break*/, 3];
                    _b = safeJsonParse;
                    return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
                case 2:
                    _a = _b.apply(void 0, [_e.sent()]);
                    _e.label = 3;
                case 3:
                    loadedManifest = _a;
                    if (!loadedManifest)
                        return [2 /*return*/, null];
                    sectionsData = getManifestSections(loadedManifest);
                    sectionMtimes = {};
                    sections = [];
                    seenFilenames = new Set();
                    _i = 0, sectionsData_1 = sectionsData;
                    _e.label = 4;
                case 4:
                    if (!(_i < sectionsData_1.length)) return [3 /*break*/, 11];
                    section = sectionsData_1[_i];
                    filename = normalizeSectionFilename(section) || "";
                    if (!filename || seenFilenames.has(filename)) {
                        return [3 /*break*/, 10];
                    }
                    seenFilenames.add(filename);
                    title = typeof section.title === "string" && section.title.trim()
                        ? section.title.trim()
                        : typeof section.name === "string" && section.name.trim()
                            ? section.name.trim()
                            : filename;
                    snippet = "";
                    charCount = 0;
                    sectionPath = (0, path_1.join)(knowledgeDir, filename);
                    return [4 /*yield*/, getFileMtimeMs(sectionPath)];
                case 5:
                    sectionMtime = _e.sent();
                    if (sectionMtime !== null) {
                        sectionMtimes[filename] = sectionMtime;
                    }
                    if (!(sectionMtime !== null)) return [3 /*break*/, 9];
                    _e.label = 6;
                case 6:
                    _e.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, (0, promises_1.readFile)(sectionPath, "utf-8")];
                case 7:
                    sectionContent = _e.sent();
                    charCount = sectionContent.length;
                    firstLine = sectionContent.split(/\r?\n/)[0] || "";
                    body = sectionContent.slice(firstLine.length).trim();
                    snippet = truncateForIndex("".concat(firstLine, " ").concat(body).trim());
                    return [3 /*break*/, 9];
                case 8:
                    _c = _e.sent();
                    return [3 /*break*/, 9];
                case 9:
                    sectionEntry = {
                        id: typeof section.id === "string" ? section.id : undefined,
                        title: title,
                        filename: filename,
                        path: toMetaKnowledgePath(filename),
                        preview: snippet,
                        char_count: charCount,
                    };
                    tags = precomputedTags === null || precomputedTags === void 0 ? void 0 : precomputedTags.get(filename);
                    if (tags) {
                        sectionEntry.topics = tags.topics;
                        sectionEntry.applies_to = tags.applies_to;
                        sectionEntry.summary = tags.summary;
                    }
                    sections.push(sectionEntry);
                    _e.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 4];
                case 11:
                    hasSemanticTags = precomputedTags !== undefined && precomputedTags.size > 0;
                    return [2 /*return*/, {
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
                            sections: sections,
                            section_mtimes: sectionMtimes,
                            has_semantic_tags: hasSemanticTags || undefined,
                            knowledge_summary: knowledgeSummary || undefined,
                        }];
                case 12:
                    _d = _e.sent();
                    return [2 /*return*/, null];
                case 13: return [2 /*return*/];
            }
        });
    });
}
function getOrBuildMetaKnowledgeIndex(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var knowledgeDir, manifestPath, cachePath, manifestRaw, manifest, sectionsData, sourceMtime, manifestPracticeArea, manifestJurisdiction, cachedRaw, cached, matches, seen_1, _i, sectionsData_2, section, filename, currentMtime, cachedFiles, precomputedTags, knowledgeSummary, tagInputs, _a, sectionsData_3, section, filename, content, title, _b, _c, tags, summary, err_1, rebuilt;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    knowledgeDir = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge");
                    manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                    cachePath = (0, path_1.join)(firmRoot, KNOWLEDGE_META_INDEX_PATH);
                    return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8").catch(function () { return null; })];
                case 1:
                    manifestRaw = _d.sent();
                    if (!manifestRaw)
                        return [2 /*return*/, null];
                    manifest = safeJsonParse(manifestRaw);
                    if (!manifest)
                        return [2 /*return*/, null];
                    sectionsData = getManifestSections(manifest);
                    return [4 /*yield*/, getFileMtimeMs(manifestPath)];
                case 2:
                    sourceMtime = _d.sent();
                    if (sourceMtime === null) {
                        return [2 /*return*/, buildMetaKnowledgeIndex(firmRoot, manifest, undefined)];
                    }
                    manifestPracticeArea = typeof manifest.practiceArea === "string"
                        ? manifest.practiceArea
                        : typeof manifest.practice_area === "string"
                            ? manifest.practice_area
                            : undefined;
                    manifestJurisdiction = typeof manifest.jurisdiction === "string"
                        ? manifest.jurisdiction
                        : typeof manifest.jurisdiction_area === "string"
                            ? manifest.jurisdiction_area
                            : undefined;
                    return [4 /*yield*/, (0, promises_1.readFile)(cachePath, "utf-8").catch(function () { return null; })];
                case 3:
                    cachedRaw = _d.sent();
                    cached = safeJsonParse(cachedRaw || "");
                    if (!(cached &&
                        cached.source === ".ai_tool/knowledge/manifest.json" &&
                        cached.section_count === sectionsData.length &&
                        cached.source_mtime === sourceMtime &&
                        cached.practice_area === manifestPracticeArea &&
                        cached.jurisdiction === manifestJurisdiction &&
                        cached.section_mtimes)) return [3 /*break*/, 8];
                    matches = true;
                    seen_1 = new Set();
                    _i = 0, sectionsData_2 = sectionsData;
                    _d.label = 4;
                case 4:
                    if (!(_i < sectionsData_2.length)) return [3 /*break*/, 7];
                    section = sectionsData_2[_i];
                    filename = normalizeSectionFilename(section) || "";
                    if (!filename || seen_1.has(filename)) {
                        return [3 /*break*/, 6];
                    }
                    seen_1.add(filename);
                    return [4 /*yield*/, getFileMtimeMs((0, path_1.join)(knowledgeDir, filename))];
                case 5:
                    currentMtime = _d.sent();
                    if (currentMtime === null || cached.section_mtimes[filename] !== currentMtime) {
                        matches = false;
                        return [3 /*break*/, 7];
                    }
                    _d.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7:
                    if (matches) {
                        cachedFiles = Object.keys(cached.section_mtimes || {});
                        if (seen_1.size === cachedFiles.length && cachedFiles.every(function (file) { return seen_1.has(file); })) {
                            // Cached index is fully valid if it has both semantic tags and knowledge summary
                            if (cached.has_semantic_tags && cached.knowledge_summary) {
                                return [2 /*return*/, cached];
                            }
                            // Otherwise fall through to rebuild with tags + summary
                        }
                    }
                    _d.label = 8;
                case 8:
                    tagInputs = [];
                    _a = 0, sectionsData_3 = sectionsData;
                    _d.label = 9;
                case 9:
                    if (!(_a < sectionsData_3.length)) return [3 /*break*/, 14];
                    section = sectionsData_3[_a];
                    filename = normalizeSectionFilename(section) || "";
                    if (!filename)
                        return [3 /*break*/, 13];
                    _d.label = 10;
                case 10:
                    _d.trys.push([10, 12, , 13]);
                    return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, filename), "utf-8")];
                case 11:
                    content = _d.sent();
                    title = typeof section.title === "string" ? section.title : filename;
                    tagInputs.push({ filename: filename, title: title, content: content });
                    return [3 /*break*/, 13];
                case 12:
                    _b = _d.sent();
                    return [3 /*break*/, 13];
                case 13:
                    _a++;
                    return [3 /*break*/, 9];
                case 14:
                    if (!(tagInputs.length > 0)) return [3 /*break*/, 18];
                    _d.label = 15;
                case 15:
                    _d.trys.push([15, 17, , 18]);
                    return [4 /*yield*/, Promise.all([
                            (0, knowledge_tagger_1.generateTagsForAllSections)(tagInputs),
                            (0, knowledge_tagger_1.generateKnowledgeSummary)(tagInputs),
                        ])];
                case 16:
                    _c = _d.sent(), tags = _c[0], summary = _c[1];
                    precomputedTags = tags;
                    knowledgeSummary = summary || undefined;
                    return [3 /*break*/, 18];
                case 17:
                    err_1 = _d.sent();
                    console.warn("[meta-index] Semantic tagging/summary failed, building without:", err_1 instanceof Error ? err_1.message : err_1);
                    return [3 /*break*/, 18];
                case 18: return [4 /*yield*/, buildMetaKnowledgeIndex(firmRoot, manifest, sourceMtime, precomputedTags, knowledgeSummary)];
                case 19:
                    rebuilt = _d.sent();
                    if (!rebuilt)
                        return [2 /*return*/, null];
                    return [4 /*yield*/, (0, promises_1.writeFile)(cachePath, JSON.stringify(rebuilt, null, 2)).catch(function () { })];
                case 20:
                    _d.sent();
                    return [2 /*return*/, rebuilt];
            }
        });
    });
}
/**
 * Patch a single section's semantic tags in the persisted meta_index.json
 * without rebuilding the entire index. Used by CRUD hooks for incremental updates.
 */
function updateMetaIndexSectionTags(firmRoot, filename, tags) {
    return __awaiter(this, void 0, void 0, function () {
        var cachePath, raw, index, section, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    cachePath = (0, path_1.join)(firmRoot, KNOWLEDGE_META_INDEX_PATH);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    return [4 /*yield*/, (0, promises_1.readFile)(cachePath, "utf-8")];
                case 2:
                    raw = _b.sent();
                    index = safeJsonParse(raw);
                    if (!index || !Array.isArray(index.sections))
                        return [2 /*return*/];
                    section = index.sections.find(function (s) { return s.filename === filename; });
                    if (!section) return [3 /*break*/, 4];
                    section.topics = tags.topics;
                    section.applies_to = tags.applies_to;
                    section.summary = tags.summary;
                    index.has_semantic_tags = index.sections.some(function (s) { return s.topics || s.applies_to || s.summary; });
                    // Clear holistic summary so it gets rebuilt on next chat access
                    delete index.knowledge_summary;
                    return [4 /*yield*/, (0, promises_1.writeFile)(cachePath, JSON.stringify(index, null, 2))];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
/**
 * Find knowledge sections matching a given applies_to tag.
 */
function findKnowledgeSectionsByTag(firmRoot, tag) {
    return __awaiter(this, void 0, void 0, function () {
        var metaIndex;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getOrBuildMetaKnowledgeIndex(firmRoot)];
                case 1:
                    metaIndex = _a.sent();
                    if (!metaIndex)
                        return [2 /*return*/, []];
                    return [2 /*return*/, metaIndex.sections.filter(function (s) { var _a; return (_a = s.applies_to) === null || _a === void 0 ? void 0 : _a.includes(tag); })];
            }
        });
    });
}
function buildMetaKnowledgeIndexText(index) {
    if (!index) {
        return "## PRACTICE KNOWLEDGE (META INDEX)\nNo knowledge index available in this case folder.\n";
    }
    var lines = [
        "## PRACTICE KNOWLEDGE (META INDEX)",
        "Source: ".concat(index.source),
        "Jurisdiction: ".concat(index.jurisdiction || "not specified", " | Practice Area: ").concat(index.practice_area || "not specified"),
        "Indexed: ".concat(index.indexed_at),
        "Sections: ".concat(index.section_count),
    ];
    // Insert holistic knowledge summary if available
    if (index.knowledge_summary) {
        lines.push("");
        lines.push("### Knowledge Summary");
        lines.push(index.knowledge_summary);
    }
    if (index.sections.length > 0) {
        lines.push("");
        lines.push("### Section Map");
        for (var _i = 0, _a = index.sections; _i < _a.length; _i++) {
            var section = _a[_i];
            var header = section.id ? "".concat(section.title, " (").concat(section.id, ")") : section.title;
            lines.push("- ".concat(header, ": ").concat(section.path, " (").concat(section.char_count, " chars)"));
            if (section.summary) {
                lines.push("  Purpose: ".concat(section.summary));
            }
            else if (section.preview) {
                lines.push("  Preview: ".concat(section.preview));
            }
            if (section.applies_to && section.applies_to.length > 0) {
                lines.push("  Applies to: ".concat(section.applies_to.join(", ")));
            }
        }
        lines.push("Use read_file(\".ai_tool/knowledge/<filename>\") to load any section you need for full context.");
    }
    var rendered = lines.join("\n");
    if (rendered.length <= KNOWLEDGE_META_INDEX_MAX_CHARS) {
        return rendered;
    }
    // Progressive truncation: try trimming knowledge summary first
    if (index.knowledge_summary) {
        var summaryStart = rendered.indexOf("### Knowledge Summary\n");
        var sectionMapStart = rendered.indexOf("\n### Section Map");
        if (summaryStart !== -1 && sectionMapStart !== -1) {
            var headerPart = rendered.slice(0, summaryStart);
            var summaryContent = index.knowledge_summary;
            var mapPart = rendered.slice(sectionMapStart);
            var availableForSummary = KNOWLEDGE_META_INDEX_MAX_CHARS - headerPart.length - "### Knowledge Summary\n".length - "\n[...summary truncated]\n".length - mapPart.length;
            if (availableForSummary > 500) {
                return "".concat(headerPart, "### Knowledge Summary\n").concat(summaryContent.slice(0, availableForSummary), "\n[...summary truncated]").concat(mapPart);
            }
        }
    }
    return "".concat(rendered.slice(0, KNOWLEDGE_META_INDEX_MAX_CHARS), "...");
}
function buildMetaToolIndexText() {
    var toolHints = [
        "read_file — Use for case data and indexed artifacts (document_index.json, meta_index.json, per-folder indexes, and .ai_tool/knowledge/meta_index.json).",
        "read_index_slice — Bounded reads of .ai_tool/document_index.json for deep conflict/data review.",
        "rerun_hypergraph — Re-runs hypergraph from document_index.json and can refresh needs_review.",
        "update_index / update_case_summary / update_file_entry — Write into document_index.json fields and conflict decisions.",
        "generate_document — Delegates formal document drafting to the doc agent.",
        "create_document_view / get_conflicts / batch_resolve_conflicts / resolve_conflict — Review/resolve needs_review items in the same session.",
    ];
    return __spreadArray(__spreadArray([
        "## TOOL INDEX (META)",
        "Core tools and where to use them:"
    ], toolHints.map(function (hint) { return "- ".concat(hint); }), true), [
        "For full tool metadata, use the direct tool schema in this message context.",
    ], false).join("\n");
}
function summarizeCommonFolder(paths) {
    if (paths.length === 0)
        return null;
    var splitPaths = paths.map(function (path) { return path.split("/").filter(Boolean); });
    var first = splitPaths[0];
    var idx = 0;
    var _loop_1 = function () {
        var value = first[idx];
        if (splitPaths.some(function (parts) { return parts[idx] !== value; }))
            return "break";
        idx += 1;
    };
    while (idx < first.length - 1) {
        var state_1 = _loop_1();
        if (state_1 === "break")
            break;
    }
    if (idx === 0)
        return null;
    return first.slice(0, idx).join("/");
}
function inferHearingNumberFromDocs(docs) {
    var hearingCandidates = new Map();
    var hoRegex = /ho[-_ ]?(\d{4,}-[a-z]{1,3})/ig;
    for (var _i = 0, docs_2 = docs; _i < docs_2.length; _i++) {
        var doc = docs_2[_i];
        var target = "".concat(doc.path, " ").concat(doc.title);
        var match = void 0;
        while ((match = hoRegex.exec(target)) !== null) {
            var core = match[1].toUpperCase();
            hearingCandidates.set(core, (hearingCandidates.get(core) || 0) + 1);
        }
    }
    if (hearingCandidates.size === 1) {
        return Array.from(hearingCandidates.keys())[0];
    }
    return null;
}
function inferClaimNumber(indexData) {
    var _a, _b, _c;
    var direct = (_b = (_a = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _a === void 0 ? void 0 : _a.wc_carrier) === null || _b === void 0 ? void 0 : _b.claim_number;
    if (typeof direct === "string" && direct.trim())
        return direct.trim();
    var claimNumbers = (_c = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _c === void 0 ? void 0 : _c.claim_numbers;
    if (claimNumbers && typeof claimNumbers === "object") {
        for (var _i = 0, _d = Object.values(claimNumbers); _i < _d.length; _i++) {
            var value = _d[_i];
            if (typeof value === "string" && value.trim())
                return value.trim();
        }
    }
    return undefined;
}
function inferOutputPathFromDocs(docs, hearingNumber, explicitPath) {
    if (explicitPath && explicitPath.trim())
        return explicitPath.trim();
    if (!hearingNumber || !hearingNumber.trim()) {
        return "Litigation/Claimant Evidence Packet.pdf";
    }
    var normalizedHo = normalizeHearingNumber(hearingNumber).toUpperCase();
    var dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    var folder = summarizeCommonFolder(docs.map(function (doc) { return doc.path; })) || "Litigation";
    return "".concat(folder, "/EFILED Claimant Index ").concat(normalizedHo, " ").concat(dateStamp, ".pdf");
}
function resolveRedactionOptions(requestedMode, config) {
    var mode = (requestedMode || (config === null || config === void 0 ? void 0 : config.defaultRedactionMode) || "off").toLowerCase();
    if (mode === "detect_only") {
        return { enabled: true, mode: "detect_only" };
    }
    if (mode === "best_effort") {
        return { enabled: true, mode: "best_effort" };
    }
    return { enabled: false };
}
function normalizeDocumentsInput(raw) {
    if (!Array.isArray(raw))
        return [];
    var docs = [];
    for (var _i = 0, raw_1 = raw; _i < raw_1.length; _i++) {
        var item = raw_1[_i];
        if (typeof item === "string") {
            var selector_1 = item.trim();
            if (!selector_1)
                continue;
            docs.push({
                path: selector_1, // Temporary selector container; canonicalized against the index before packet mode opens.
                title: "",
                include: true,
            });
            continue;
        }
        if (!item || typeof item !== "object")
            continue;
        var text = function (value) {
            return typeof value === "string" ? value.trim() : "";
        };
        var docId = text(item.doc_id)
            || text(item.docId)
            || text(item.document_id)
            || text(item.documentId)
            || text(item.id);
        var path = text(item.path)
            || text(item.relative_path)
            || text(item.relativePath);
        var folder = text(item.folder)
            || text(item.folder_name)
            || text(item.folderName);
        var filename = text(item.fileName)
            || text(item.filename)
            || text(item.file);
        var normalizedFolder = folder
            .replace(/\\/g, "/")
            .replace(/^\.\/+/, "")
            .replace(/^\/+/, "")
            .replace(/\/+/g, "/")
            .replace(/\/+$/, "");
        var normalizedFilename = filename
            .replace(/\\/g, "/")
            .replace(/^\.\/+/, "")
            .replace(/^\/+/, "")
            .replace(/\/+/g, "/");
        var joinedPath = normalizedFilename
            ? (normalizedFolder && normalizedFolder !== "." && normalizedFolder.toLowerCase() !== "root"
                ? "".concat(normalizedFolder, "/").concat(normalizedFilename)
                : normalizedFilename)
            : "";
        var selector = docId || path || joinedPath || normalizedFilename;
        if (!selector)
            continue;
        var title = text(item.title);
        var date = text(item.date);
        var docType = text(item.docType) || text(item.doc_type);
        docs.push({
            path: selector, // Temporary selector container; canonicalized against the index before packet mode opens.
            title: title,
            date: date || undefined,
            docType: docType || undefined,
            include: typeof item.include === "boolean" ? item.include : true,
        });
    }
    return docs;
}
function canonicalizePacketDocumentsFromIndex(documents, indexData) {
    var docIdToPath = new Map();
    var normalizedPathToPath = new Map();
    var normalizedBasenameToPath = new Map();
    var pathMetadata = new Map();
    var ambiguousBasenames = new Set();
    var folders = (indexData === null || indexData === void 0 ? void 0 : indexData.folders) || {};
    for (var _i = 0, _a = Object.entries(folders); _i < _a.length; _i++) {
        var _b = _a[_i], folderName = _b[0], folderData = _b[1];
        var files = Array.isArray(folderData) ? folderData : (folderData === null || folderData === void 0 ? void 0 : folderData.files) || (folderData === null || folderData === void 0 ? void 0 : folderData.documents) || [];
        for (var _c = 0, files_1 = files; _c < files_1.length; _c++) {
            var file = files_1[_c];
            if (typeof file === "string") {
                var canonicalPath_1 = folderName === "." || !folderName ? file : "".concat(folderName, "/").concat(file);
                var docId_1 = (0, document_id_1.buildDocumentId)(folderName, file);
                docIdToPath.set(docId_1, canonicalPath_1);
                pathMetadata.set(canonicalPath_1, { title: file });
                var normalizedPath_1 = normalizeRelativePathForLookup(canonicalPath_1);
                var normalizedBasename_1 = normalizeRelativePathForLookup(file);
                if (normalizedPath_1 && !normalizedPathToPath.has(normalizedPath_1)) {
                    normalizedPathToPath.set(normalizedPath_1, canonicalPath_1);
                }
                if (normalizedBasename_1) {
                    if (!normalizedBasenameToPath.has(normalizedBasename_1)) {
                        normalizedBasenameToPath.set(normalizedBasename_1, canonicalPath_1);
                    }
                    else if (normalizedBasenameToPath.get(normalizedBasename_1) !== canonicalPath_1) {
                        ambiguousBasenames.add(normalizedBasename_1);
                    }
                }
                continue;
            }
            var fileName = typeof (file === null || file === void 0 ? void 0 : file.filename) === "string"
                ? file.filename
                : typeof (file === null || file === void 0 ? void 0 : file.file) === "string"
                    ? file.file
                    : "";
            if (!fileName)
                continue;
            var canonicalPath = folderName === "." || !folderName ? fileName : "".concat(folderName, "/").concat(fileName);
            var docId = typeof (file === null || file === void 0 ? void 0 : file.doc_id) === "string" && file.doc_id.trim()
                ? file.doc_id.trim()
                : (0, document_id_1.buildDocumentId)(folderName, fileName);
            docIdToPath.set(docId, canonicalPath);
            var rawTitle = typeof (file === null || file === void 0 ? void 0 : file.title) === "string" ? file.title.trim() : "";
            var metadataTitle = !isPlaceholderDocumentTitle(rawTitle) ? rawTitle : fileName;
            var metadataDate = typeof (file === null || file === void 0 ? void 0 : file.date) === "string" && file.date.trim() ? file.date.trim() : undefined;
            var metadataDocType = typeof (file === null || file === void 0 ? void 0 : file.type) === "string" && file.type.trim() ? file.type.trim() : undefined;
            pathMetadata.set(canonicalPath, {
                title: metadataTitle,
                date: metadataDate,
                docType: metadataDocType,
            });
            var normalizedPath = normalizeRelativePathForLookup(canonicalPath);
            var normalizedBasename = normalizeRelativePathForLookup(fileName);
            if (normalizedPath && !normalizedPathToPath.has(normalizedPath)) {
                normalizedPathToPath.set(normalizedPath, canonicalPath);
            }
            if (normalizedBasename) {
                if (!normalizedBasenameToPath.has(normalizedBasename)) {
                    normalizedBasenameToPath.set(normalizedBasename, canonicalPath);
                }
                else if (normalizedBasenameToPath.get(normalizedBasename) !== canonicalPath) {
                    ambiguousBasenames.add(normalizedBasename);
                }
            }
        }
    }
    var resolved = [];
    var unresolvedSelectors = [];
    for (var _d = 0, documents_1 = documents; _d < documents_1.length; _d++) {
        var doc = documents_1[_d];
        var selector = doc.path.trim();
        if (!selector) {
            unresolvedSelectors.push(doc.path);
            continue;
        }
        var canonicalPath = docIdToPath.get(selector);
        if (!canonicalPath) {
            var normalizedSelector = normalizeRelativePathForLookup(selector);
            canonicalPath = normalizedPathToPath.get(normalizedSelector);
            if (!canonicalPath) {
                var basename = normalizeRelativePathForLookup(normalizedSelector.split("/").pop() || normalizedSelector);
                if (basename && !ambiguousBasenames.has(basename)) {
                    canonicalPath = normalizedBasenameToPath.get(basename);
                }
            }
        }
        if (!canonicalPath) {
            unresolvedSelectors.push(selector);
            continue;
        }
        var metadata = pathMetadata.get(canonicalPath);
        var incomingTitle = typeof doc.title === "string" ? doc.title.trim() : "";
        var incomingDate = typeof doc.date === "string" && doc.date.trim() ? doc.date.trim() : undefined;
        var incomingDocType = typeof doc.docType === "string" && doc.docType.trim() ? doc.docType.trim() : undefined;
        var defaultTitle = canonicalPath.split("/").pop() || canonicalPath;
        var resolvedTitle = !isPlaceholderDocumentTitle(incomingTitle)
            ? incomingTitle
            : (metadata === null || metadata === void 0 ? void 0 : metadata.title) || defaultTitle;
        resolved.push(__assign(__assign({}, doc), { path: canonicalPath, title: resolvedTitle, date: incomingDate || (metadata === null || metadata === void 0 ? void 0 : metadata.date), docType: incomingDocType || (metadata === null || metadata === void 0 ? void 0 : metadata.docType) }));
    }
    return { documents: resolved, unresolvedSelectors: unresolvedSelectors };
}
function buildPacketFromInputs(caseFolder, firmRoot, indexData, hearingNumber, documents, options) {
    return __awaiter(this, void 0, void 0, function () {
        var firmBlockLines, firmInfo, barLine, legacyCityStateZip, _a, outputPath, resolvedCaseFolder, fullOutputPath, redaction, packet;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (documents.length === 0) {
                        throw new Error("No documents provided for packet build");
                    }
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, export_1.loadFirmInfo)(firmRoot)];
                case 2:
                    firmInfo = _d.sent();
                    if (firmInfo) {
                        barLine = firmInfo.nevadaBarNo
                            ? /bar\s*no\.?/i.test(firmInfo.nevadaBarNo)
                                ? firmInfo.nevadaBarNo
                                : "Nevada Bar No. ".concat(firmInfo.nevadaBarNo)
                            : undefined;
                        legacyCityStateZip = "".concat(firmInfo.city || "").concat(firmInfo.city && firmInfo.state ? ", " : "").concat(firmInfo.state || "", " ").concat(firmInfo.zip || "").trim();
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
                    return [3 /*break*/, 4];
                case 3:
                    _a = _d.sent();
                    return [3 /*break*/, 4];
                case 4:
                    outputPath = inferOutputPathFromDocs(documents.map(function (doc) { return ({ path: doc.path, title: doc.title, date: doc.date, docType: doc.docType }); }), hearingNumber, options.outputPath);
                    resolvedCaseFolder = (0, path_1.resolve)(caseFolder);
                    fullOutputPath = (0, path_1.resolve)(caseFolder, outputPath);
                    if (fullOutputPath !== resolvedCaseFolder && !fullOutputPath.startsWith(resolvedCaseFolder + path_1.sep)) {
                        throw new Error("output_path must be within the case folder.");
                    }
                    redaction = resolveRedactionOptions(options.redactionMode, {
                        defaultRedactionMode: options.defaultRedactionMode,
                    });
                    return [4 /*yield*/, (0, evidence_packet_1.buildEvidencePacket)({
                            caseFolder: caseFolder,
                            documents: documents,
                            caption: {
                                claimantName: ((_b = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _b === void 0 ? void 0 : _b.client) || "Claimant",
                                claimNumber: inferClaimNumber(indexData),
                                hearingNumber: hearingNumber || undefined,
                                hearingDateTime: options.hearingDateTime,
                                appearance: options.appearance,
                            },
                            redaction: redaction,
                            service: options.service,
                            includeAffirmationPage: (_c = options.includeAffirmationPage) !== null && _c !== void 0 ? _c : true,
                            pageStampPrefix: options.pageStampPrefix,
                            pageStampStart: options.pageStampStart,
                            firmBlockLines: firmBlockLines,
                        })];
                case 5:
                    packet = _d.sent();
                    return [4 /*yield*/, (0, promises_1.mkdir)((0, path_1.dirname)(fullOutputPath), { recursive: true })];
                case 6:
                    _d.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)(fullOutputPath, packet.pdfBytes)];
                case 7:
                    _d.sent();
                    return [2 /*return*/, {
                            outputPath: outputPath,
                            fullOutputPath: fullOutputPath,
                            packet: packet,
                        }];
            }
        });
    });
}
function saveIndexAndMap(caseFolder, indexPath, index) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(index, null, 2))];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(caseFolder, index)];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Execute a tool and return result
function executeTool(toolName, toolInput, caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, requestedPath, isKnowledgePath, baseDir, filePath, normalizedPath, text, _b, text, _c, content, indexPath, content, offsetRaw, lengthRaw, offset, length_1, end, slice, indexPath, indexContent, index, practiceArea, applyToIndex, hypergraphResult, hypergraphPath, needsReview, filePath, indexPath, indexContent, indexData, indexedPathMap, rawDocuments, selectedPaths, invalidPaths, seen, _i, rawDocuments_1, raw, rawPath, normalizedRequested, canonicalPath, canonicalKey, sortBy, sortDirection, view, indexPath, indexContent, indexData, hearingNumber, claimantName, claimNumbers, firstClaimNumber, resolvedClaimNumber, folders, docCount, _d, _e, _f, folderData, files, result, indexPath, indexContent, indexData, requestedDocuments, _g, documents, unresolvedSelectors, hearingInput, inferredHearing, hearingNumber, inputService, claimantName, claimNumbers, firstClaimNumber, resolvedClaimNumber, issueOnAppeal, hearingType, isAppealFormat, templateId, proposedDocuments, indexPath, indexContent, index, parts, target, i, lastPart, oldValue, indexPath, indexContent, index, previousSummary, indexPath, indexContent, index, folderData, files, fileEntry, available, updates, updatedFields, _h, _j, _k, key, value, indexPath, indexContent, index, rawNeedsReview, needsReview, offsetRaw, limitRaw, offset, limit, clampedOffset_1, end, hypergraph_1, hgPath, hgContent, hgData, _l, items, resolutions, indexPath, indexContent, index, needsReview_1, errata, caseNotes, resolved, failed, _loop_2, _m, resolutions_1, resolution, field, resolved_value_1, evidence, indexPath, indexContent, index, needsReview_2, matchingIndexes, resolvedItems, resolvedField, rejectedValues, indexSet_1, errata, errataEntry, caseNotes, summaryUpdated, providerName, numericValue, providers, _o, providers_1, prov, oldCharges, delta, claimKey, error_1, message;
        var _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
        return __generator(this, function (_6) {
            switch (_6.label) {
                case 0:
                    _6.trys.push([0, 50, , 51]);
                    _a = toolName;
                    switch (_a) {
                        case "read_file": return [3 /*break*/, 1];
                        case "read_index_slice": return [3 /*break*/, 11];
                        case "rerun_hypergraph": return [3 /*break*/, 13];
                        case "write_file": return [3 /*break*/, 19];
                        case "create_document_view": return [3 /*break*/, 21];
                        case "create_evidence_packet": return [3 /*break*/, 23];
                        case "build_evidence_packet": return [3 /*break*/, 25];
                        case "update_index": return [3 /*break*/, 27];
                        case "update_case_summary": return [3 /*break*/, 30];
                        case "update_file_entry": return [3 /*break*/, 33];
                        case "get_conflicts": return [3 /*break*/, 36];
                        case "batch_resolve_conflicts": return [3 /*break*/, 42];
                        case "resolve_conflict": return [3 /*break*/, 45];
                    }
                    return [3 /*break*/, 48];
                case 1:
                    requestedPath = typeof toolInput.path === "string" ? toolInput.path : "";
                    isKnowledgePath = requestedPath.startsWith(".ai_tool/knowledge/");
                    baseDir = isKnowledgePath ? (0, year_mode_1.resolveFirmRoot)(caseFolder) : caseFolder;
                    filePath = (0, path_1.join)(baseDir, requestedPath);
                    // Security check - ensure path is within allowed directory
                    if (!filePath.startsWith(baseDir)) {
                        return [2 /*return*/, "Error: Cannot read files outside the ".concat(isKnowledgePath ? "firm" : "case", " folder")];
                    }
                    normalizedPath = toolInput.path.toLowerCase();
                    if (!toolInput.path.toLowerCase().endsWith('.pdf')) return [3 /*break*/, 5];
                    _6.label = 2;
                case 2:
                    _6.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, pdftotext_1.extractPdfText)(filePath, {
                            layout: false,
                            maxBuffer: 1024 * 1024,
                            timeout: 30000,
                        })];
                case 3:
                    text = _6.sent();
                    return [2 /*return*/, text.slice(0, 10000)]; // Limit output
                case 4:
                    _b = _6.sent();
                    return [2 /*return*/, "Error: Could not extract text from PDF"];
                case 5:
                    if (!normalizedPath.endsWith('.docx')) return [3 /*break*/, 9];
                    _6.label = 6;
                case 6:
                    _6.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, (0, extract_1.extractTextFromDocx)(filePath)];
                case 7:
                    text = _6.sent();
                    return [2 /*return*/, text.slice(0, 10000)]; // Limit output
                case 8:
                    _c = _6.sent();
                    return [2 /*return*/, "Error: Could not extract text from DOCX"];
                case 9: return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
                case 10:
                    content = _6.sent();
                    return [2 /*return*/, content.slice(0, 15000)]; // Limit output to avoid context overflow
                case 11:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 12:
                    content = _6.sent();
                    offsetRaw = Number(toolInput.offset);
                    lengthRaw = toolInput.length === undefined ? INDEX_SLICE_MAX_CHARS : Number(toolInput.length);
                    offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
                    length_1 = Number.isFinite(lengthRaw) && lengthRaw > 0
                        ? Math.min(Math.floor(lengthRaw), INDEX_SLICE_MAX_CHARS)
                        : INDEX_SLICE_MAX_CHARS;
                    end = Math.min(content.length, offset + length_1);
                    slice = content.slice(offset, end);
                    return [2 /*return*/, JSON.stringify({
                            total_chars: content.length,
                            offset: offset,
                            end: end,
                            has_more: end < content.length,
                            next_offset: end < content.length ? end : null,
                            slice: slice,
                        })];
                case 13:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 14:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    practiceArea = typeof index.practice_area === "string" ? index.practice_area : undefined;
                    applyToIndex = toolInput.apply_to_index !== false;
                    return [4 /*yield*/, (0, firm_1.generateHypergraph)(caseFolder, index, practiceArea)];
                case 15:
                    hypergraphResult = _6.sent();
                    hypergraphPath = (0, path_1.join)(caseFolder, ".ai_tool", "hypergraph_analysis.json");
                    return [4 /*yield*/, (0, promises_1.writeFile)(hypergraphPath, JSON.stringify(hypergraphResult, null, 2))];
                case 16:
                    _6.sent();
                    if (!applyToIndex) return [3 /*break*/, 18];
                    needsReview = (hypergraphResult.conflicts || []).map(function (conflict) {
                        var _a, _b;
                        var values = Array.from(new Set([
                            String((_a = conflict.consensus_value) !== null && _a !== void 0 ? _a : ""),
                            String((_b = conflict.outlier_value) !== null && _b !== void 0 ? _b : ""),
                        ])).filter(function (v) { return v.length > 0; });
                        var sources = Array.from(new Set(__spreadArray(__spreadArray([], (Array.isArray(conflict.consensus_sources) ? conflict.consensus_sources : []), true), (Array.isArray(conflict.outlier_sources) ? conflict.outlier_sources : []), true))).map(function (s) { return String(s); });
                        return {
                            field: String(conflict.field || "unknown"),
                            conflicting_values: values,
                            sources: sources,
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
                        id: "note-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 7)),
                        content: toolInput.note || "Re-ran hypergraph and refreshed needs_review from existing index",
                        field_updated: "needs_review",
                        source: "hypergraph_rebuild",
                        createdAt: new Date().toISOString(),
                    });
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 17:
                    _6.sent();
                    _6.label = 18;
                case 18: return [2 /*return*/, JSON.stringify({
                        success: true,
                        hypergraph_path: ".ai_tool/hypergraph_analysis.json",
                        conflicts_found: ((_p = hypergraphResult.conflicts) === null || _p === void 0 ? void 0 : _p.length) || 0,
                        fields_analyzed: ((_q = hypergraphResult.summary) === null || _q === void 0 ? void 0 : _q.total_fields_analyzed) || 0,
                        index_updated: applyToIndex,
                        needs_review_count: applyToIndex && Array.isArray(index.needs_review) ? index.needs_review.length : undefined,
                    })];
                case 19:
                    filePath = (0, path_1.join)(caseFolder, toolInput.path);
                    if (!filePath.startsWith(caseFolder)) {
                        return [2 /*return*/, "Error: Cannot write files outside the case folder"];
                    }
                    return [4 /*yield*/, (0, promises_1.writeFile)(filePath, toolInput.content)];
                case 20:
                    _6.sent();
                    return [2 /*return*/, "Successfully wrote ".concat(toolInput.content.length, " characters to ").concat(toolInput.path)];
                case 21:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 22:
                    indexContent = _6.sent();
                    indexData = JSON.parse(indexContent);
                    indexedPathMap = collectIndexedDocumentPathMap(indexData);
                    rawDocuments = Array.isArray(toolInput.documents) ? toolInput.documents : [];
                    if (rawDocuments.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "create_document_view requires a non-empty documents[] list.",
                            })];
                    }
                    selectedPaths = [];
                    invalidPaths = [];
                    seen = new Set();
                    for (_i = 0, rawDocuments_1 = rawDocuments; _i < rawDocuments_1.length; _i++) {
                        raw = rawDocuments_1[_i];
                        rawPath = typeof raw === "string"
                            ? raw
                            : raw && typeof raw.path === "string"
                                ? raw.path
                                : "";
                        normalizedRequested = normalizeRelativePathForLookup(rawPath);
                        if (!normalizedRequested)
                            continue;
                        canonicalPath = indexedPathMap.get(normalizedRequested);
                        if (!canonicalPath) {
                            invalidPaths.push(rawPath);
                            continue;
                        }
                        canonicalKey = normalizeRelativePathForLookup(canonicalPath);
                        if (seen.has(canonicalKey))
                            continue;
                        seen.add(canonicalKey);
                        selectedPaths.push(canonicalPath);
                    }
                    if (selectedPaths.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "None of the requested documents matched indexed file paths.",
                                invalidPaths: invalidPaths,
                            })];
                    }
                    sortBy = normalizeDocumentViewSortBy((_r = toolInput.sort_by) !== null && _r !== void 0 ? _r : toolInput.sortBy);
                    sortDirection = normalizeDocumentViewSortDirection((_s = toolInput.sort_direction) !== null && _s !== void 0 ? _s : toolInput.sortDirection);
                    view = {
                        id: "agent-view-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 8)),
                        name: typeof toolInput.name === "string" && toolInput.name.trim()
                            ? toolInput.name.trim()
                            : "Agent Document View",
                        description: typeof toolInput.description === "string" && toolInput.description.trim()
                            ? toolInput.description.trim()
                            : undefined,
                        paths: selectedPaths,
                        sortBy: sortBy,
                        sortDirection: sortDirection,
                        createdAt: new Date().toISOString(),
                        totalMatches: selectedPaths.length,
                        invalidPaths: invalidPaths.length > 0 ? invalidPaths : undefined,
                    };
                    return [2 /*return*/, JSON.stringify({
                            success: true,
                            view: view,
                            matchedCount: selectedPaths.length,
                            invalidPaths: invalidPaths,
                        })];
                case 23:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 24:
                    indexContent = _6.sent();
                    indexData = JSON.parse(indexContent);
                    hearingNumber = typeof toolInput.hearing_number === "string"
                        ? toolInput.hearing_number.trim()
                        : "";
                    claimantName = ((_t = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _t === void 0 ? void 0 : _t.client) || "";
                    claimNumbers = ((_u = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _u === void 0 ? void 0 : _u.claim_numbers) || {};
                    firstClaimNumber = Object.values(claimNumbers).find(function (v) { return typeof v === "string"; }) || "";
                    resolvedClaimNumber = (typeof ((_w = (_v = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _v === void 0 ? void 0 : _v.wc_carrier) === null || _w === void 0 ? void 0 : _w.claim_number) === "string"
                        && indexData.summary.wc_carrier.claim_number.trim()) ||
                        firstClaimNumber;
                    folders = (indexData === null || indexData === void 0 ? void 0 : indexData.folders) || {};
                    docCount = 0;
                    for (_d = 0, _e = Object.entries(folders); _d < _e.length; _d++) {
                        _f = _e[_d], folderData = _f[1];
                        files = Array.isArray(folderData) ? folderData : (folderData === null || folderData === void 0 ? void 0 : folderData.files) || (folderData === null || folderData === void 0 ? void 0 : folderData.documents) || [];
                        docCount += files.length;
                    }
                    result = {
                        success: true,
                        totalIndexedDocuments: docCount,
                        hearingNumber: hearingNumber || null,
                        caption: { claimantName: claimantName, claimNumber: resolvedClaimNumber },
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
                    return [2 /*return*/, JSON.stringify(result)];
                case 25:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 26:
                    indexContent = _6.sent();
                    indexData = JSON.parse(indexContent);
                    requestedDocuments = normalizeDocumentsInput(toolInput.documents);
                    if (requestedDocuments.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "build_evidence_packet requires a non-empty documents[] ordered list.",
                            })];
                    }
                    _g = canonicalizePacketDocumentsFromIndex(requestedDocuments, indexData), documents = _g.documents, unresolvedSelectors = _g.unresolvedSelectors;
                    if (documents.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "None of the selected documents matched indexed files (doc_id or path).",
                                invalidSelectors: unresolvedSelectors,
                            })];
                    }
                    hearingInput = typeof toolInput.hearing_number === "string"
                        ? toolInput.hearing_number.trim()
                        : typeof toolInput.hearingNumber === "string"
                            ? toolInput.hearingNumber.trim()
                            : "";
                    inferredHearing = hearingInput || inferHearingNumberFromDocs(documents.map(function (doc) { return ({
                        path: doc.path,
                        title: doc.title,
                        date: doc.date,
                        docType: doc.docType,
                    }); }));
                    hearingNumber = inferredHearing ? extractHearingCore(inferredHearing) : undefined;
                    inputService = normalizeServiceInput(toolInput.service);
                    claimantName = ((_x = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _x === void 0 ? void 0 : _x.client) || "";
                    claimNumbers = ((_y = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _y === void 0 ? void 0 : _y.claim_numbers) || {};
                    firstClaimNumber = Object.values(claimNumbers).find(function (v) { return typeof v === "string"; }) || "";
                    resolvedClaimNumber = (typeof toolInput.claim_number === "string" && toolInput.claim_number.trim()) ||
                        (typeof ((_0 = (_z = indexData === null || indexData === void 0 ? void 0 : indexData.summary) === null || _z === void 0 ? void 0 : _z.wc_carrier) === null || _0 === void 0 ? void 0 : _0.claim_number) === "string" && indexData.summary.wc_carrier.claim_number.trim()) ||
                        firstClaimNumber;
                    issueOnAppeal = typeof toolInput.issue_on_appeal === "string" ? toolInput.issue_on_appeal : "";
                    hearingType = typeof toolInput.hearing_type === "string"
                        ? toolInput.hearing_type.toUpperCase()
                        : "";
                    // Fallback: infer from hearing number if agent didn't specify
                    if (!hearingType && hearingNumber) {
                        isAppealFormat = /-(RA|AP|APPEAL)/i.test(hearingNumber);
                        if (isAppealFormat)
                            hearingType = "AO";
                    }
                    templateId = (hearingType === "AO" || issueOnAppeal.trim())
                        ? "ao-standard"
                        : "ho-standard";
                    proposedDocuments = documents.map(function (doc) { return ({
                        docId: (0, document_id_1.buildDocumentIdFromPath)(doc.path),
                        path: doc.path,
                        title: doc.title,
                        date: doc.date,
                        docType: doc.docType,
                        fileName: doc.path.split("/").pop() || doc.path,
                    }); });
                    return [2 /*return*/, JSON.stringify({
                            success: true,
                            packetModeOpened: true,
                            proposedDocuments: proposedDocuments,
                            invalidSelectors: unresolvedSelectors.length > 0 ? unresolvedSelectors : undefined,
                            caption: {
                                claimantName: claimantName,
                                claimNumber: resolvedClaimNumber,
                                hearingNumber: hearingNumber || undefined,
                                hearingDateTime: typeof toolInput.hearing_datetime === "string" ? toolInput.hearing_datetime : undefined,
                                appearance: typeof toolInput.appearance === "string" ? toolInput.appearance : undefined,
                            },
                            issueOnAppeal: issueOnAppeal,
                            templateId: templateId,
                            service: inputService,
                            instruction: "The Packet Creation UI has opened with the curated documents pre-loaded. Let the user know they can review the order, edit front matter, run a PII scan, and generate the final PDF from the interface.",
                        })];
                case 27:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 28:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    parts = toolInput.field_path.split(".");
                    target = index;
                    for (i = 0; i < parts.length - 1; i++) {
                        if (!target[parts[i]]) {
                            target[parts[i]] = {};
                        }
                        target = target[parts[i]];
                    }
                    lastPart = parts[parts.length - 1];
                    oldValue = target[lastPart];
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
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 29:
                    _6.sent();
                    return [2 /*return*/, "Updated ".concat(toolInput.field_path, " from \"").concat(oldValue, "\" to \"").concat(toolInput.value, "\"")];
                case 30:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 31:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    if (!index.summary || typeof index.summary !== "object") {
                        index.summary = {};
                    }
                    previousSummary = typeof index.summary.case_summary === "string"
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
                        id: "note-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 7)),
                        content: toolInput.note || "Updated case summary via chat",
                        field_updated: "summary.case_summary",
                        previous_value: previousSummary,
                        source: "chat_summary_update",
                        createdAt: new Date().toISOString(),
                    });
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 32:
                    _6.sent();
                    return [2 /*return*/, "Updated summary.case_summary (".concat(index.summary.case_summary.length, " chars)").concat(index.case_phase ? " and case_phase=".concat(index.case_phase) : "")];
                case 33:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 34:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    folderData = (_1 = index.folders) === null || _1 === void 0 ? void 0 : _1[toolInput.folder];
                    if (!folderData) {
                        return [2 /*return*/, "Error: Folder \"".concat(toolInput.folder, "\" not found in index. Available folders: ").concat(Object.keys(index.folders || {}).join(", "))];
                    }
                    files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
                    if (!Array.isArray(files)) {
                        return [2 /*return*/, "Error: No files array found in folder \"".concat(toolInput.folder, "\"")];
                    }
                    fileEntry = files.find(function (f) { return f.filename === toolInput.filename; });
                    if (!fileEntry) {
                        available = files.map(function (f) { return f.filename; }).filter(Boolean).join(", ");
                        return [2 /*return*/, "Error: File \"".concat(toolInput.filename, "\" not found in folder \"").concat(toolInput.folder, "\". Available files: ").concat(available)];
                    }
                    updates = toolInput.updates || {};
                    updatedFields = [];
                    for (_h = 0, _j = Object.entries(updates); _h < _j.length; _h++) {
                        _k = _j[_h], key = _k[0], value = _k[1];
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
                        id: "note-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 7)),
                        content: "Re-extracted ".concat(toolInput.folder, "/").concat(toolInput.filename, ": updated ").concat(updatedFields.join(", "), ". ").concat(toolInput.note || "").trim(),
                        field_updated: "".concat(toolInput.folder, "/").concat(toolInput.filename),
                        source: "file_re_extraction",
                        createdAt: new Date().toISOString()
                    });
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 35:
                    _6.sent();
                    return [2 /*return*/, "Successfully updated ".concat(updatedFields.join(", "), " for ").concat(toolInput.folder, "/").concat(toolInput.filename)];
                case 36:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 37:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    rawNeedsReview = index.needs_review || [];
                    needsReview = dedupeNeedsReviewEntries(rawNeedsReview);
                    offsetRaw = Number(toolInput.offset);
                    limitRaw = Number(toolInput.limit);
                    offset = Number.isFinite(offsetRaw) && offsetRaw >= 0
                        ? Math.floor(offsetRaw)
                        : 0;
                    limit = Number.isFinite(limitRaw) && limitRaw > 0
                        ? Math.min(Math.floor(limitRaw), CONFLICT_BATCH_MAX)
                        : CONFLICT_BATCH_DEFAULT;
                    clampedOffset_1 = Math.min(offset, needsReview.length);
                    end = Math.min(clampedOffset_1 + limit, needsReview.length);
                    if (needsReview.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                status: "all_done",
                                message: "All conflicts have been resolved! No more items to review.",
                                count: 0,
                                returned: 0,
                                offset: 0,
                                limit: 0,
                                has_more: false,
                                next_offset: null,
                                items: []
                            })];
                    }
                    hypergraph_1 = null;
                    _6.label = 38;
                case 38:
                    _6.trys.push([38, 40, , 41]);
                    hgPath = (0, path_1.join)(caseFolder, ".ai_tool", "hypergraph_analysis.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(hgPath, "utf-8")];
                case 39:
                    hgContent = _6.sent();
                    hgData = JSON.parse(hgContent);
                    if (hgData.hypergraph && typeof hgData.hypergraph === "object") {
                        hypergraph_1 = hgData.hypergraph;
                    }
                    return [3 /*break*/, 41];
                case 40:
                    _l = _6.sent();
                    return [3 /*break*/, 41];
                case 41:
                    items = needsReview.slice(clampedOffset_1, end).map(function (item, batchIndex) {
                        var fieldData = hypergraph_1 === null || hypergraph_1 === void 0 ? void 0 : hypergraph_1[item.field];
                        if ((fieldData === null || fieldData === void 0 ? void 0 : fieldData.values) && Array.isArray(fieldData.values)) {
                            // Hypergraph path: compact value→count pairs
                            return {
                                index: clampedOffset_1 + batchIndex + 1,
                                field: item.field,
                                values: fieldData.values.map(function (v) { return ({
                                    value: v.value,
                                    count: v.count,
                                }); }),
                                consensus: fieldData.consensus,
                                confidence: fieldData.confidence,
                                reason: item.reason,
                            };
                        }
                        // Fallback: no hypergraph data for this field — return without sources
                        return {
                            index: clampedOffset_1 + batchIndex + 1,
                            field: item.field,
                            conflicting_values: item.conflicting_values,
                            reason: item.reason,
                        };
                    });
                    return [2 /*return*/, JSON.stringify({
                            status: "conflicts_found",
                            count: needsReview.length,
                            returned: items.length,
                            offset: clampedOffset_1,
                            limit: limit,
                            has_more: end < needsReview.length,
                            next_offset: end < needsReview.length ? end : null,
                            items: items
                        })];
                case 42:
                    resolutions = toolInput.resolutions;
                    if (!Array.isArray(resolutions) || resolutions.length === 0) {
                        return [2 /*return*/, JSON.stringify({ success: false, error: "No resolutions provided" })];
                    }
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 43:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    needsReview_1 = index.needs_review || [];
                    errata = index.errata || [];
                    caseNotes = Array.isArray(index.case_notes) ? index.case_notes : [];
                    resolved = [];
                    failed = [];
                    _loop_2 = function (resolution) {
                        var field = resolution.field, resolved_value = resolution.resolved_value, evidence = resolution.evidence;
                        var matchingIndexes = findMatchingFieldIndexes(needsReview_1, field);
                        if (matchingIndexes.length === 0) {
                            failed.push(field);
                            return "continue";
                        }
                        var resolvedItems = matchingIndexes.map(function (idx) { return needsReview_1[idx]; });
                        var resolvedField = ((_2 = resolvedItems[0]) === null || _2 === void 0 ? void 0 : _2.field) || field;
                        var rejectedValues = Array.from(new Set(resolvedItems
                            .flatMap(function (item) { return Array.isArray(item === null || item === void 0 ? void 0 : item.conflicting_values) ? item.conflicting_values : []; })
                            .map(function (v) { return String(v); })
                            .filter(function (v) { return v !== String(resolved_value); })));
                        // Remove all matching duplicates from needs_review
                        var indexSet = new Set(matchingIndexes);
                        needsReview_1 = needsReview_1.filter(function (_, idx) { return !indexSet.has(idx); });
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
                            id: "note-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 7)),
                            content: "Resolved ".concat(resolvedField, ": ").concat(resolved_value, ". ").concat(evidence || "").trim(),
                            field_updated: resolvedField,
                            previous_value: rejectedValues,
                            source: "batch_review",
                            createdAt: new Date().toISOString()
                        });
                        resolved.push(resolvedField);
                        // Update summary fields if applicable
                        if (resolvedField.startsWith("charges:") && ((_3 = index.summary) === null || _3 === void 0 ? void 0 : _3.providers)) {
                            var providerName = resolvedField.replace("charges:", "");
                            var numericValue = parseFloat(String(resolved_value).replace(/[$,]/g, ""));
                            for (var _7 = 0, _8 = index.summary.providers; _7 < _8.length; _7++) {
                                var prov = _8[_7];
                                if (typeof prov === "object" && prov.name &&
                                    (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
                                        providerName.toLowerCase().includes(prov.name.toLowerCase()))) {
                                    var oldCharges = prov.charges;
                                    prov.charges = numericValue;
                                    if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                                        var delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
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
                            if (!index.summary.disability_status)
                                index.summary.disability_status = {};
                            index.summary.disability_status.amw = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
                        }
                        if ((resolvedField === "compensation_rate" || resolvedField === "weekly_compensation_rate") && index.summary) {
                            if (!index.summary.disability_status)
                                index.summary.disability_status = {};
                            index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value).replace(/[$,]/g, "")) || undefined;
                        }
                        if (resolvedField.startsWith("claim_numbers:") && index.summary) {
                            var claimKey = resolvedField.replace("claim_numbers:", "");
                            if (!index.summary.claim_numbers)
                                index.summary.claim_numbers = {};
                            index.summary.claim_numbers[claimKey] = resolved_value;
                        }
                        (0, index_summary_sync_1.applyResolvedFieldToSummary)(index, resolvedField, resolved_value);
                    };
                    for (_m = 0, resolutions_1 = resolutions; _m < resolutions_1.length; _m++) {
                        resolution = resolutions_1[_m];
                        _loop_2(resolution);
                    }
                    index.needs_review = needsReview_1;
                    index.errata = errata;
                    index.case_notes = caseNotes;
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 44:
                    _6.sent();
                    return [2 /*return*/, JSON.stringify(__assign({ success: resolved.length > 0, resolved: resolved.length, failed: failed.length, remaining: needsReview_1.length, resolved_fields: resolved, failed_fields: failed, message: failed.length > 0
                                ? "WARNING: ".concat(failed.length, " field(s) not found in needs_review: ").concat(failed.join(', '), ". Make sure to use exact field names from get_conflicts.")
                                : "Successfully resolved ".concat(resolved.length, " conflicts") }, (needsReview_1.length > 0 ? {
                            action_required: "".concat(needsReview_1.length, " conflict(s) still remain. You MUST call get_conflicts now to retrieve and resolve the remaining items before reporting completion.")
                        } : {})))];
                case 45:
                    field = toolInput.field, resolved_value_1 = toolInput.resolved_value, evidence = toolInput.evidence;
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 46:
                    indexContent = _6.sent();
                    index = JSON.parse(indexContent);
                    needsReview_2 = index.needs_review || [];
                    matchingIndexes = findMatchingFieldIndexes(needsReview_2, field);
                    if (matchingIndexes.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "Field \"".concat(field, "\" not found in needs_review")
                            })];
                    }
                    resolvedItems = matchingIndexes.map(function (idx) { return needsReview_2[idx]; });
                    resolvedField = ((_4 = resolvedItems[0]) === null || _4 === void 0 ? void 0 : _4.field) || field;
                    rejectedValues = Array.from(new Set(resolvedItems
                        .flatMap(function (item) { return Array.isArray(item === null || item === void 0 ? void 0 : item.conflicting_values) ? item.conflicting_values : []; })
                        .map(function (v) { return String(v); })
                        .filter(function (v) { return v !== String(resolved_value_1); })));
                    indexSet_1 = new Set(matchingIndexes);
                    index.needs_review = needsReview_2.filter(function (_, idx) { return !indexSet_1.has(idx); });
                    errata = index.errata || [];
                    errataEntry = {
                        field: resolvedField,
                        decision: resolved_value_1,
                        rejected_values: rejectedValues,
                        evidence: evidence || "User confirmed correct value",
                        resolution_type: "user_decision",
                        resolved_at: new Date().toISOString()
                    };
                    errata.push(errataEntry);
                    index.errata = errata;
                    caseNotes = Array.isArray(index.case_notes) ? index.case_notes : [];
                    caseNotes.push({
                        id: "note-".concat(Date.now()),
                        content: "Resolved ".concat(resolvedField, ": ").concat(resolved_value_1, " (was conflicting: ").concat(rejectedValues.join(", "), "). ").concat(evidence || "").trim(),
                        field_updated: resolvedField,
                        previous_value: rejectedValues,
                        source: "chat_review",
                        createdAt: new Date().toISOString()
                    });
                    index.case_notes = caseNotes;
                    summaryUpdated = false;
                    // For charges fields, update provider and total
                    if (resolvedField.startsWith("charges:") && ((_5 = index.summary) === null || _5 === void 0 ? void 0 : _5.providers)) {
                        providerName = resolvedField.replace("charges:", "");
                        numericValue = parseFloat(String(resolved_value_1).replace(/[$,]/g, ""));
                        providers = index.summary.providers;
                        if (Array.isArray(providers)) {
                            for (_o = 0, providers_1 = providers; _o < providers_1.length; _o++) {
                                prov = providers_1[_o];
                                if (typeof prov === "object" && prov.name) {
                                    if (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
                                        providerName.toLowerCase().includes(prov.name.toLowerCase())) {
                                        oldCharges = prov.charges;
                                        prov.charges = numericValue;
                                        if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                                            delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
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
                        index.summary.dol = resolved_value_1;
                        index.summary.incident_date = resolved_value_1;
                        summaryUpdated = true;
                    }
                    // For AMW/compensation_rate, update disability_status
                    if ((resolvedField === "amw" || resolvedField === "aww" || resolvedField === "average_monthly_wage") && index.summary) {
                        if (!index.summary.disability_status)
                            index.summary.disability_status = {};
                        index.summary.disability_status.amw = parseFloat(String(resolved_value_1).replace(/[$,]/g, "")) || undefined;
                        summaryUpdated = true;
                    }
                    if ((resolvedField === "compensation_rate" || resolvedField === "weekly_compensation_rate") && index.summary) {
                        if (!index.summary.disability_status)
                            index.summary.disability_status = {};
                        index.summary.disability_status.compensation_rate = parseFloat(String(resolved_value_1).replace(/[$,]/g, "")) || undefined;
                        summaryUpdated = true;
                    }
                    // For claim_numbers, update summary
                    if (resolvedField.startsWith("claim_numbers:") && index.summary) {
                        claimKey = resolvedField.replace("claim_numbers:", "");
                        if (!index.summary.claim_numbers) {
                            index.summary.claim_numbers = {};
                        }
                        index.summary.claim_numbers[claimKey] = resolved_value_1;
                        summaryUpdated = true;
                    }
                    summaryUpdated = (0, index_summary_sync_1.applyResolvedFieldToSummary)(index, resolvedField, resolved_value_1) || summaryUpdated;
                    // Write updated index
                    return [4 /*yield*/, saveIndexAndMap(caseFolder, indexPath, index)];
                case 47:
                    // Write updated index
                    _6.sent();
                    return [2 /*return*/, JSON.stringify({
                            success: true,
                            field: resolvedField,
                            resolved_value: resolved_value_1,
                            rejected_values: rejectedValues,
                            remaining_conflicts: index.needs_review.length,
                            summary_updated: summaryUpdated,
                            message: "Resolved \"".concat(resolvedField, "\" to \"").concat(resolved_value_1, "\". ").concat(index.needs_review.length, " conflict(s) remaining.")
                        })];
                case 48: return [2 /*return*/, "Unknown tool: ".concat(toolName)];
                case 49: return [3 /*break*/, 51];
                case 50:
                    error_1 = _6.sent();
                    message = error_1 instanceof Error ? error_1.message : String(error_1);
                    if (toolName === "build_evidence_packet" || toolName === "create_evidence_packet" || toolName === "create_document_view") {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "Error executing ".concat(toolName, ": ").concat(message),
                            })];
                    }
                    return [2 /*return*/, "Error executing ".concat(toolName, ": ").concat(message)];
                case 51: return [2 /*return*/];
            }
        });
    });
}
// Build context from case folder
function buildContext(caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var parts, firmRoot, now, dateStr, indexPath, metaIndexPath, metaIndexData, metaContent, _a, indexContent, indexData, metaIndexView, knowledgeIndex, e_1, _b, templatesPath, templatesData, _c, _d, templateList, _e, context;
        var _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    parts = [];
                    firmRoot = (0, year_mode_1.resolveFirmRoot)(caseFolder);
                    now = new Date();
                    dateStr = now.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    parts.push("TODAY'S DATE: ".concat(dateStr));
                    _g.label = 1;
                case 1:
                    _g.trys.push([1, 13, , 14]);
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    metaIndexPath = (0, path_1.join)(caseFolder, ".ai_tool", "meta_index.json");
                    metaIndexData = void 0;
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 4, , 8]);
                    return [4 /*yield*/, (0, promises_1.readFile)(metaIndexPath, "utf-8")];
                case 3:
                    metaContent = _g.sent();
                    metaIndexData = JSON.parse(metaContent);
                    return [3 /*break*/, 8];
                case 4:
                    _a = _g.sent();
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 5:
                    indexContent = _g.sent();
                    indexData = JSON.parse(indexContent);
                    return [4 /*yield*/, (0, meta_index_1.splitIndexToFolders)(indexData, caseFolder)];
                case 6:
                    _g.sent();
                    metaIndexData = (0, meta_index_1.generateMetaIndex)(indexData);
                    return [4 /*yield*/, (0, promises_1.writeFile)(metaIndexPath, JSON.stringify(metaIndexData, null, 2))];
                case 7:
                    _g.sent();
                    return [3 /*break*/, 8];
                case 8:
                    metaIndexView = (0, meta_index_1.buildMetaIndexPromptView)(metaIndexData);
                    parts.push("\n".concat(metaIndexView));
                    parts.push("\n".concat(buildMetaToolIndexText()));
                    _g.label = 9;
                case 9:
                    _g.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, getOrBuildMetaKnowledgeIndex(firmRoot)];
                case 10:
                    knowledgeIndex = _g.sent();
                    parts.push("\n".concat(buildMetaKnowledgeIndexText(knowledgeIndex)));
                    return [3 /*break*/, 12];
                case 11:
                    e_1 = _g.sent();
                    return [3 /*break*/, 12];
                case 12: return [3 /*break*/, 14];
                case 13:
                    _b = _g.sent();
                    parts.push("\n## CASE INDEX\nNo case index found. Case may need to be indexed first.");
                    return [3 /*break*/, 14];
                case 14:
                    _g.trys.push([14, 16, , 17]);
                    templatesPath = (0, path_1.join)(firmRoot, ".ai_tool", "templates", "templates.json");
                    _d = (_c = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(templatesPath, "utf-8")];
                case 15:
                    templatesData = _d.apply(_c, [_g.sent()]);
                    if (((_f = templatesData.templates) === null || _f === void 0 ? void 0 : _f.length) > 0) {
                        templateList = templatesData.templates
                            .map(function (t) { return "- ".concat(t.name, ": ").concat(t.description || 'No description'); })
                            .join("\n");
                        parts.push("\n## AVAILABLE DOCUMENT TEMPLATES\n".concat(templateList));
                    }
                    return [3 /*break*/, 17];
                case 16:
                    _e = _g.sent();
                    return [3 /*break*/, 17];
                case 17:
                    parts.push("\n## WORKING DIRECTORY\n".concat(caseFolder));
                    context = parts.join("\n");
                    if (context.length > CASE_CONTEXT_MAX_CHARS) {
                        console.log("[buildContext] Context truncated from ".concat(context.length, " to ").concat(CASE_CONTEXT_MAX_CHARS));
                        context = "".concat(context.slice(0, CASE_CONTEXT_MAX_CHARS), "\n...\n[NOTE: Context truncated to stay within prompt budget. Use read_index_slice for deep index access.]");
                    }
                    return [2 /*return*/, context];
            }
        });
    });
}
// Document type descriptions for user feedback
var DOC_TYPE_NAMES = {
    demand_letter: "demand letter",
    case_memo: "case memo",
    settlement: "settlement calculation",
    general_letter: "letter",
    decision_order: "Decision & Order"
};
// System prompt for direct chat (context gets appended)
var BASE_SYSTEM_PROMPT = "You are a helpful legal assistant for a Nevada injury law firm (Personal Injury and Workers' Compensation). You help attorneys and staff with case management, document review, answering questions, and drafting documents.\n\n## NAVIGATING THE CASE\n\nYou have a layered view of this case that lets you zoom from broad overview down to individual files.\n\n**Broad view \u2014 Meta-index (already in your context)**\nYour context includes a meta-index built from previous AI extractions of every document in the case. It contains the case summary, all folders, filenames, and the important facts pulled from each document \u2014 deduplicated across the case. This is your primary reference. Many questions can be answered directly from these pre-extracted facts without reading any files.\n\n**Detailed view \u2014 Per-folder indexes**\nWhen you need specifics beyond what the meta-index shows \u2014 exact dates, full extracted data for a file, or document-level detail \u2014 zoom into that folder's index:\n  read_file(\".ai_tool/indexes/{FolderName}.json\")\nEach per-folder index has the complete AI extraction for every file in that folder: key_info, type, date, extracted_data, and any flagged issues. These are the same extractions the meta-index summarizes, but with full detail preserved.\n\n**File level \u2014 Individual documents**\nWhen you need the actual content of a specific document:\n- Text, JSON, DOCX files: read_file(\"{folder}/{filename}\")\n- PDFs (basic text extraction): read_file(\"{folder}/{filename}.pdf\")\n- PDFs (scanned, handwritten, complex layout): read_document(\"{folder}/{filename}.pdf\", \"what to look for\")\n\n**Practice knowledge**\nYour context also includes a Knowledge Summary with the firm's key rules, thresholds, and statutory references. When you need full detail on a topic, the summary's source map tells you which knowledge section to load:\n  read_file(\".ai_tool/knowledge/{filename}\")\n\nStart broad, zoom in as needed.\n\n## YOUR CAPABILITIES\n\n1. **Answer Questions**: Use the meta-index facts and your knowledge to answer questions. Zoom into per-folder indexes or individual files when the meta-index doesn't have enough detail.\n\n2. **Read Files**: Use read_file to zoom into per-folder indexes, text/JSON/DOCX files, or PDFs (basic text extraction). Use read_index_slice to page through the full .ai_tool/document_index.json when you need to scan across all folders.\n\n2b. **Re-run Hypergraph**: Use rerun_hypergraph to rebuild .ai_tool/hypergraph_analysis.json from the current index and refresh conflict detection without re-extraction.\n\n3. **Update Case Data**: Use update_index when the user provides corrections or new information about top-level case fields (e.g., client name, DOB, case phase, policy limits).\n   Use update_case_summary when updating the narrative case summary.\n\n4. **Re-Extract File Data**: Use update_file_entry when the user asks you to re-read a document and update its entry in the index. This updates a specific file within a folder \u2014 its key_info, type, date, extracted_data, and issues.\n\n5. **Generate Documents**: When the user asks you to draft, write, create, or generate a formal document (demand letter, case memo, settlement calculation, letter, or Decision & Order), use the generate_document tool. This delegates to a specialized agent with access to firm templates that will create a complete, professional document.\n\n## WHEN TO USE generate_document\n\nUse this tool when the user wants a NEW document created:\n- \"Draft a demand letter\"\n- \"Write up a case memo\"\n- \"Create a settlement breakdown\"\n- \"Prepare a letter of protection\"\n- \"Draft an Appeals Officer Decision & Order\"\n\nDo NOT use it for:\n- Questions about what should go in a document\n- Reviewing existing documents\n- Simple notes or quick responses\n\n5. **Read Documents with Vision**: Use read_document for PDFs in detail, especially scanned or layout-heavy PDFs. This spawns a vision-capable reader that sees rendered pages \u2014 form layouts, tables, handwriting, checkboxes, images \u2014 not just extracted text. Much better than read_file for PDFs with complex formatting.\n\n## WHEN TO USE read_document\n\nUse read_document only when the user asks about a specific PDF and layout/context is needed, especially:\n- \"What does the MRI report say?\"\n- \"What are the charges on the billing statement?\"\n- \"What injuries are listed in the intake form?\"\n- \"Can you read the police report?\"\n\nUse read_file for:\n- DOCX files\n- Non-PDF files\n- Per-folder indexes (.ai_tool/indexes/{FolderName}.json) or small index files\n- Quick lookups on text or JSON files\n\nDo not call read_document on DOCX or other non-PDF files; use read_file instead.\n\nUse rerun_hypergraph when:\n- A legacy case never completed hypergraph/conflict reconciliation\n- needs_review appears missing or stale after an indexing failure\n\n## WHEN TO USE update_file_entry\n\nUse this tool when the user asks you to re-read a document and update the index with the new extraction. The typical flow:\n\n1. User says \"read DWC D-8 Wages.pdf\" or \"re-extract the intake form\"\n2. If it's a PDF, call read_document to read the file with vision; otherwise call read_file.\n3. You present what you found to the user\n4. User says \"update the file\", \"looks good, save it\", or \"update the index\"\n5. You call update_file_entry with the folder name, filename, and updated fields\n\n**Important:**\n- Only call update_file_entry AFTER the user explicitly confirms\n- Include key_info (a comprehensive summary), type, date, and extracted_data\n- The folder and filename must match EXACTLY what's in the index (case-sensitive)\n- Set issues to null if the re-extraction was successful\n\n## WHEN TO USE update_case_summary\n\nUse this tool when the user asks to create, revise, or replace the case summary narrative.\n\nCanonical write locations:\n- summary.case_summary for narrative summary text\n- case_phase for current lifecycle phase (optional)\n\nPrefer this tool over update_index for case summary updates so the write target is explicit and consistent.\n\n7. **Create Document Panel Views**: When the user asks to show a specific subset of documents in the panel (for example medical records, provider-specific notes, hearing notices, chronological sets), use create_document_view with explicit paths from the index.\n\n## WHEN TO USE create_document_view\n\nUse this tool when the user asks for commands like:\n- \"Show all medical records\"\n- \"Show doctor's notes from Dr. Smith\"\n- \"Show hearing notices in date order\"\n- \"Show me only recent treatment records\"\n\nRequirements:\n- Use explicit documents[].path values that exist in .ai_tool/document_index.json.\n- Prefer meaningful name and a short description.\n- Set sort_by / sort_direction when the user requests ordering (e.g., chronological).\n- After creating the view, explain what you selected and why in normal chat text.\n\n7. **Review Document Conflicts**: When the user wants to review conflicts, use get_conflicts in paginated batches and resolve one batch at a time.\n\n8. **Build Hearing Evidence Packets**: Use create_evidence_packet to plan, then build_evidence_packet to generate. Always review the document list with the user before building.\n\n## WHEN TO USE HEARING PACKET TOOLS\n\nUse these tools when the user asks for an \"evidence packet\", \"hearing packet\", \"document index packet\", or \"H.O. packet\".\n\nTwo-step flow:\n1. **create_evidence_packet** (planning step): Call this first. It returns instructions telling you to review the document index, check knowledge rules, and present a proposed document list to the user. No PDF is generated.\n2. **build_evidence_packet** (execution step): Call this AFTER the user has reviewed and confirmed the document list. This opens the Packet Creation UI where the user can make final adjustments and generate the PDF.\n\nRequirements:\n- ALWAYS start with create_evidence_packet \u2014 never skip straight to build_evidence_packet.\n- Use the PRACTICE KNOWLEDGE meta-index to find the section tagged with \"Applies to: evidence_packet\", then read_file it to get the full evidence packet rules. Follow those rules for document ordering, inclusion/exclusion, and packet structure.\n- Present the proposed document list to the user and wait for confirmation before building.\n- Pass `doc_id` values into build_evidence_packet documents[].\n- If `doc_id` is unavailable, pass exact `filename` + `folder` from the index.\n- Compatibility: exact indexed `path` is accepted, but do not invent/synthesize paths.\n- When calling build_evidence_packet, include `claim_number` from the document index (check `wc_carrier.claim_number` first, then `claim_numbers`).\n- When calling build_evidence_packet, set `hearing_type` to \"AO\" for Appeals Officer hearings or \"HO\" for Hearing Officer hearings.\n- For AO hearings, also include `issue_on_appeal` with a 1-2 sentence summary of the contested issue based on case documents. Leave both empty for HO hearings.\n- Do NOT claim the Packet Creation UI opened unless build_evidence_packet returns `success: true`.\n- After build_evidence_packet succeeds, let the user know the Packet Creation interface has opened with their documents pre-loaded.\n\n## DOCUMENT REVIEW MODE\n\nUse this when the user says things like:\n- \"Let's review the conflicts\"\n- \"Go through the needs_review items\"\n- \"Review document issues\"\n\n### Data shape from get_conflicts\n\nEach conflict item includes value\u2192count pairs from the hypergraph plus consensus/confidence:\n```json\n{\n  \"field\": \"client_name\",\n  \"values\": [\n    { \"value\": \"Jomo Henderson\", \"count\": 89 },\n    { \"value\": \"Joma Henderson\", \"count\": 1 }\n  ],\n  \"consensus\": \"Jomo Henderson\",\n  \"confidence\": 0.61,\n  \"reason\": \"...\"\n}\n```\n\nUse the count ratios and confidence to guide categorization:\n- **High count ratio + high confidence** \u2192 auto-resolve to consensus value\n- **Low confidence / UNCERTAIN consensus** \u2192 needs user discussion\n- **Similar counts** \u2192 genuinely ambiguous, ask user\n\n### How to conduct a batch review:\n\n1. **Get first batch** - Call get_conflicts with defaults (offset 0, limit 25) to retrieve the first batch.\n\n2. **Analyze and categorize** - Group conflicts by:\n   - **Auto-resolve** (high confidence): One value dominates (e.g. 89 vs 1), OCR errors, formatting differences\n   - **Recommend** (medium confidence): Clear majority but worth confirming\n   - **Needs discussion** (low confidence or UNCERTAIN consensus): Genuinely ambiguous, need user input\n\n3. **Present in batches** - Show your recommendations grouped like:\n\n   **Quick Fixes (I recommend these)**\n   1. client_name: \"Jomo Henderson\" (89 docs) vs \"Joma Henderson\" (1 doc) \u2192 clearly a typo\n   2. date_of_loss: \"06/25/2023\" (12 docs) vs \"05/25/2023\" (1 doc) \u2192 OCR error\n   Approve these? (yes/no/edit)\n\n   **Need Your Input**\n   3. Charges for Spinal Rehab: $6,558 (3 docs) vs $10,558 (2 docs) - which invoice is correct?\n\n4. **Batch resolve** - When user approves, call batch_resolve_conflicts with all approved resolutions at once\n\n5. **Verify and continue** - After batch_resolve_conflicts, if any conflicts remain:\n   - Use the response \"has_more\" / \"next_offset\" fields from get_conflicts for pagination.\n   - Call get_conflicts again with offset=next_offset until has_more is false.\n   - Do NOT report completion until remaining is 0 or the user explicitly defers unresolved items.\n\n### Example flow:\n\nUser: \"Let's review the conflicts\"\n\nYou: [call get_conflicts]\n\nYou: \"I found 23 conflicts. After analyzing them, here's my breakdown:\n\n**Ready to Auto-Resolve (15 items):**\nThese have a clear dominant value (high document count vs 1-2 outliers):\n- client_name: \"Jomo Henderson\" (89 docs) vs \"Joma Henderson\" (1 doc) \u2192 OCR typo\n- date_of_birth: \"06/27/1984\" (45 docs) vs \"1949\" (1 doc) \u2192 HIPAA form error\n- client_name: \"Brenda Boerdam-Madrid\" (30 docs) vs \"Boerdam Madrid\" (2 docs) \u2192 formatting\n[... etc]\n\n**Need Your Review (8 items):**\n- rehab_charges: $6,558 (3 docs) vs $10,558 (2 docs) - genuinely different amounts\n- balance_due: Several with $0 vs original amount (similar counts)\n\nWant me to apply the 15 auto-resolutions? Then we can discuss the remaining 8.\"\n\nUser: \"Yes, apply them\"\n\nYou: [call batch_resolve_conflicts with the 15 resolutions]\n\nYou: \"Done! 15 resolved. Now let's look at the remaining 8...\"\n\n## GUIDELINES\n\n- Be concise but thorough\n- Answer from the case index when possible - no need for tools on simple lookups\n- Explain medical/legal terms briefly when helpful\n- Keep responses professional";
// Main chat function with streaming
function directChat(caseFolder_1, message_1) {
    return __asyncGenerator(this, arguments, function directChat_1(caseFolder, message, history, options) {
        var context, systemPrompt, messages, _i, history_1, msg, lockOwner, lockResult, readOnlyMode, holderName, MAX_TOOL_ITERATIONS, iterations, generatedFilePath, hitIterationLimit, response, err_2, iterationText, toolUseBlocks, currentToolUse, stopReason, _a, response_1, response_1_1, event_1, parsedInput, e_2_1, toolResults, _b, toolUseBlocks_1, toolUse, docType, instructions, docTypeName, filePath, _c, _d, _e, event_2, e_3_1, docPath, question, normalizedDocPath, resultContent, _f, _g, _h, event_3, e_4_1, result, parsed, parsed;
        var _j, e_2, _k, _l, _m, e_3, _o, _p, _q, e_4, _r, _s;
        var _t, _u;
        if (history === void 0) { history = []; }
        return __generator(this, function (_v) {
            switch (_v.label) {
                case 0: return [4 /*yield*/, __await(buildContext(caseFolder))];
                case 1:
                    context = _v.sent();
                    systemPrompt = "".concat(BASE_SYSTEM_PROMPT, "\n\n---\n\n").concat(context);
                    messages = [];
                    // Add history
                    for (_i = 0, history_1 = history; _i < history_1.length; _i++) {
                        msg = history_1[_i];
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
                    lockOwner = (options === null || options === void 0 ? void 0 : options.lockOwner) || "chat-".concat(Date.now());
                    return [4 /*yield*/, __await((0, case_lock_1.acquireCaseLock)(caseFolder, lockOwner, options === null || options === void 0 ? void 0 : options.lockDisplayName))];
                case 2:
                    lockResult = _v.sent();
                    readOnlyMode = !lockResult.acquired;
                    if (!readOnlyMode) return [3 /*break*/, 5];
                    holderName = ((_t = lockResult.lock) === null || _t === void 0 ? void 0 : _t.displayName) || ((_u = lockResult.lock) === null || _u === void 0 ? void 0 : _u.owner) || "another user";
                    return [4 /*yield*/, __await({
                            type: "text",
                            content: "\n\n".concat(holderName, "'s agent is working on this case right now. You can still ask questions, but edits are disabled for now."),
                        })];
                case 3: return [4 /*yield*/, _v.sent()];
                case 4:
                    _v.sent();
                    _v.label = 5;
                case 5:
                    MAX_TOOL_ITERATIONS = 16;
                    iterations = 0;
                    hitIterationLimit = false;
                    _v.label = 6;
                case 6:
                    _v.trys.push([6, , 98, 101]);
                    _v.label = 7;
                case 7:
                    if (!(iterations < MAX_TOOL_ITERATIONS)) return [3 /*break*/, 92];
                    iterations++;
                    response = void 0;
                    _v.label = 8;
                case 8:
                    _v.trys.push([8, 10, , 13]);
                    return [4 /*yield*/, __await(getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 4096,
                            system: systemPrompt,
                            messages: messages,
                            tools: getTools(readOnlyMode),
                            stream: true
                        }))];
                case 9:
                    response = _v.sent();
                    return [3 /*break*/, 13];
                case 10:
                    err_2 = _v.sent();
                    console.error("API call failed (iteration ".concat(iterations, "):"), err_2);
                    return [4 /*yield*/, __await({ type: "text", content: "\n\nError processing response: ".concat(err_2) })];
                case 11: return [4 /*yield*/, _v.sent()];
                case 12:
                    _v.sent();
                    return [3 /*break*/, 92];
                case 13:
                    iterationText = "";
                    toolUseBlocks = [];
                    currentToolUse = null;
                    stopReason = null;
                    _v.label = 14;
                case 14:
                    _v.trys.push([14, 28, 29, 34]);
                    _a = true, response_1 = (e_2 = void 0, __asyncValues(response));
                    _v.label = 15;
                case 15: return [4 /*yield*/, __await(response_1.next())];
                case 16:
                    if (!(response_1_1 = _v.sent(), _j = response_1_1.done, !_j)) return [3 /*break*/, 27];
                    _l = response_1_1.value;
                    _a = false;
                    event_1 = _l;
                    if (!(event_1.type === "content_block_start")) return [3 /*break*/, 20];
                    if (!(event_1.content_block.type === "tool_use")) return [3 /*break*/, 19];
                    currentToolUse = {
                        id: event_1.content_block.id,
                        name: event_1.content_block.name,
                        input: ""
                    };
                    return [4 /*yield*/, __await({ type: "tool", tool: event_1.content_block.name })];
                case 17: return [4 /*yield*/, _v.sent()];
                case 18:
                    _v.sent();
                    _v.label = 19;
                case 19: return [3 /*break*/, 26];
                case 20:
                    if (!(event_1.type === "content_block_delta")) return [3 /*break*/, 25];
                    if (!(event_1.delta.type === "text_delta")) return [3 /*break*/, 23];
                    iterationText += event_1.delta.text;
                    return [4 /*yield*/, __await({ type: "text", content: event_1.delta.text })];
                case 21: return [4 /*yield*/, _v.sent()];
                case 22:
                    _v.sent();
                    return [3 /*break*/, 24];
                case 23:
                    if (event_1.delta.type === "input_json_delta" && currentToolUse) {
                        currentToolUse.input += event_1.delta.partial_json;
                    }
                    _v.label = 24;
                case 24: return [3 /*break*/, 26];
                case 25:
                    if (event_1.type === "content_block_stop") {
                        if (currentToolUse) {
                            try {
                                parsedInput = currentToolUse.input.trim() === ""
                                    ? {}
                                    : JSON.parse(currentToolUse.input);
                                toolUseBlocks.push({
                                    id: currentToolUse.id,
                                    name: currentToolUse.name,
                                    input: parsedInput
                                });
                            }
                            catch (e) {
                                console.error("Failed to parse tool input for ".concat(currentToolUse.name, ":"), e, currentToolUse.input);
                            }
                            currentToolUse = null;
                        }
                    }
                    else if (event_1.type === "message_delta") {
                        stopReason = event_1.delta.stop_reason;
                    }
                    _v.label = 26;
                case 26:
                    _a = true;
                    return [3 /*break*/, 15];
                case 27: return [3 /*break*/, 34];
                case 28:
                    e_2_1 = _v.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 34];
                case 29:
                    _v.trys.push([29, , 32, 33]);
                    if (!(!_a && !_j && (_k = response_1.return))) return [3 /*break*/, 31];
                    return [4 /*yield*/, __await(_k.call(response_1))];
                case 30:
                    _v.sent();
                    _v.label = 31;
                case 31: return [3 /*break*/, 33];
                case 32:
                    if (e_2) throw e_2.error;
                    return [7 /*endfinally*/];
                case 33: return [7 /*endfinally*/];
                case 34:
                    // If no tool use, we're done
                    if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
                        return [3 /*break*/, 92];
                    }
                    toolResults = [];
                    _b = 0, toolUseBlocks_1 = toolUseBlocks;
                    _v.label = 35;
                case 35:
                    if (!(_b < toolUseBlocks_1.length)) return [3 /*break*/, 91];
                    toolUse = toolUseBlocks_1[_b];
                    if (!(toolUse.name === "generate_document")) return [3 /*break*/, 59];
                    docType = toolUse.input.document_type;
                    instructions = toolUse.input.instructions;
                    docTypeName = DOC_TYPE_NAMES[docType];
                    return [4 /*yield*/, __await({ type: "delegating", content: "Generating ".concat(docTypeName, "...") })];
                case 36: return [4 /*yield*/, _v.sent()];
                case 37:
                    _v.sent();
                    filePath = void 0;
                    _v.label = 38;
                case 38:
                    _v.trys.push([38, 52, 53, 58]);
                    _c = true, _d = (e_3 = void 0, __asyncValues((0, doc_agent_1.generateDocument)(caseFolder, docType, instructions)));
                    _v.label = 39;
                case 39: return [4 /*yield*/, __await(_d.next())];
                case 40:
                    if (!(_e = _v.sent(), _m = _e.done, !_m)) return [3 /*break*/, 51];
                    _p = _e.value;
                    _c = false;
                    event_2 = _p;
                    if (!(event_2.type === "status")) return [3 /*break*/, 43];
                    return [4 /*yield*/, __await({ type: "status", content: event_2.content })];
                case 41: return [4 /*yield*/, _v.sent()];
                case 42:
                    _v.sent();
                    return [3 /*break*/, 50];
                case 43:
                    if (!(event_2.type === "tool")) return [3 /*break*/, 46];
                    return [4 /*yield*/, __await({ type: "tool", content: event_2.content })];
                case 44: return [4 /*yield*/, _v.sent()];
                case 45:
                    _v.sent();
                    return [3 /*break*/, 50];
                case 46:
                    if (!(event_2.type === "text")) return [3 /*break*/, 49];
                    return [4 /*yield*/, __await({ type: "text", content: event_2.content })];
                case 47: return [4 /*yield*/, _v.sent()];
                case 48:
                    _v.sent();
                    return [3 /*break*/, 50];
                case 49:
                    if (event_2.type === "done") {
                        filePath = event_2.filePath;
                    }
                    _v.label = 50;
                case 50:
                    _c = true;
                    return [3 /*break*/, 39];
                case 51: return [3 /*break*/, 58];
                case 52:
                    e_3_1 = _v.sent();
                    e_3 = { error: e_3_1 };
                    return [3 /*break*/, 58];
                case 53:
                    _v.trys.push([53, , 56, 57]);
                    if (!(!_c && !_m && (_o = _d.return))) return [3 /*break*/, 55];
                    return [4 /*yield*/, __await(_o.call(_d))];
                case 54:
                    _v.sent();
                    _v.label = 55;
                case 55: return [3 /*break*/, 57];
                case 56:
                    if (e_3) throw e_3.error;
                    return [7 /*endfinally*/];
                case 57: return [7 /*endfinally*/];
                case 58:
                    generatedFilePath = filePath;
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: filePath
                            ? "Document successfully generated and saved to ".concat(filePath)
                            : "Document generation completed but no file was saved"
                    });
                    return [3 /*break*/, 90];
                case 59:
                    if (!(toolUse.name === "read_document")) return [3 /*break*/, 80];
                    docPath = toolUse.input.path;
                    question = toolUse.input.question;
                    normalizedDocPath = (docPath || "").toLowerCase();
                    if (!normalizedDocPath.endsWith(".pdf")) {
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: toolUse.id,
                            content: "Error: read_document is PDF-only. Use read_file for DOCX and other non-PDF documents.",
                        });
                        return [3 /*break*/, 90];
                    }
                    return [4 /*yield*/, __await({ type: "delegating", content: "Reading ".concat(docPath, " with vision...") })];
                case 60: return [4 /*yield*/, _v.sent()];
                case 61:
                    _v.sent();
                    resultContent = "";
                    _v.label = 62;
                case 62:
                    _v.trys.push([62, 73, 74, 79]);
                    _f = true, _g = (e_4 = void 0, __asyncValues((0, doc_reader_1.readDocument)(caseFolder, docPath, question)));
                    _v.label = 63;
                case 63: return [4 /*yield*/, __await(_g.next())];
                case 64:
                    if (!(_h = _v.sent(), _q = _h.done, !_q)) return [3 /*break*/, 72];
                    _s = _h.value;
                    _f = false;
                    event_3 = _s;
                    if (!(event_3.type === "status")) return [3 /*break*/, 67];
                    return [4 /*yield*/, __await({ type: "status", content: event_3.content })];
                case 65: return [4 /*yield*/, _v.sent()];
                case 66:
                    _v.sent();
                    return [3 /*break*/, 71];
                case 67:
                    if (!(event_3.type === "tool")) return [3 /*break*/, 70];
                    return [4 /*yield*/, __await({ type: "tool", content: event_3.content })];
                case 68: return [4 /*yield*/, _v.sent()];
                case 69:
                    _v.sent();
                    return [3 /*break*/, 71];
                case 70:
                    if (event_3.type === "error") {
                        resultContent = event_3.content;
                    }
                    else if (event_3.type === "done") {
                        resultContent = event_3.content;
                    }
                    _v.label = 71;
                case 71:
                    _f = true;
                    return [3 /*break*/, 63];
                case 72: return [3 /*break*/, 79];
                case 73:
                    e_4_1 = _v.sent();
                    e_4 = { error: e_4_1 };
                    return [3 /*break*/, 79];
                case 74:
                    _v.trys.push([74, , 77, 78]);
                    if (!(!_f && !_q && (_r = _g.return))) return [3 /*break*/, 76];
                    return [4 /*yield*/, __await(_r.call(_g))];
                case 75:
                    _v.sent();
                    _v.label = 76;
                case 76: return [3 /*break*/, 78];
                case 77:
                    if (e_4) throw e_4.error;
                    return [7 /*endfinally*/];
                case 78: return [7 /*endfinally*/];
                case 79:
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: resultContent || "No content extracted from document"
                    });
                    return [3 /*break*/, 90];
                case 80: return [4 /*yield*/, __await({ type: "tool_executing", tool: toolUse.name })];
                case 81: 
                // Regular tool execution
                return [4 /*yield*/, _v.sent()];
                case 82:
                    // Regular tool execution
                    _v.sent();
                    return [4 /*yield*/, __await(executeTool(toolUse.name, toolUse.input, caseFolder))];
                case 83:
                    result = _v.sent();
                    if (!(toolUse.name === "create_document_view")) return [3 /*break*/, 86];
                    parsed = safeJsonParse(result);
                    if (!((parsed === null || parsed === void 0 ? void 0 : parsed.success) && parsed.view)) return [3 /*break*/, 86];
                    return [4 /*yield*/, __await({ type: "document_view", view: parsed.view })];
                case 84: return [4 /*yield*/, _v.sent()];
                case 85:
                    _v.sent();
                    _v.label = 86;
                case 86:
                    if (!(toolUse.name === "build_evidence_packet")) return [3 /*break*/, 89];
                    parsed = safeJsonParse(result);
                    if (!(((parsed === null || parsed === void 0 ? void 0 : parsed.success) || (parsed === null || parsed === void 0 ? void 0 : parsed.packetModeOpened)) && Array.isArray(parsed.proposedDocuments))) return [3 /*break*/, 89];
                    return [4 /*yield*/, __await({
                            type: "evidence_packet_plan",
                            plan: {
                                proposedDocuments: parsed.proposedDocuments,
                                caption: parsed.caption,
                                issueOnAppeal: parsed.issueOnAppeal || "",
                                templateId: parsed.templateId,
                                service: parsed.service,
                            },
                        })];
                case 87: return [4 /*yield*/, _v.sent()];
                case 88:
                    _v.sent();
                    _v.label = 89;
                case 89:
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: result
                    });
                    _v.label = 90;
                case 90:
                    _b++;
                    return [3 /*break*/, 35];
                case 91:
                    // Build messages for next iteration (per-iteration text, not accumulated)
                    messages.push({
                        role: "assistant",
                        content: __spreadArray(__spreadArray([], (iterationText ? [{ type: "text", text: iterationText }] : []), true), toolUseBlocks.map(function (t) { return ({
                            type: "tool_use",
                            id: t.id,
                            name: t.name,
                            input: t.input
                        }); }), true)
                    });
                    messages.push({
                        role: "user",
                        content: toolResults
                    });
                    return [3 /*break*/, 7];
                case 92:
                    if (!(iterations >= MAX_TOOL_ITERATIONS)) return [3 /*break*/, 95];
                    hitIterationLimit = true;
                    return [4 /*yield*/, __await({
                            type: "status",
                            content: "Stopped after ".concat(MAX_TOOL_ITERATIONS, " tool steps to prevent runaway execution. Ask me to continue and I'll resume from here."),
                        })];
                case 93: return [4 /*yield*/, _v.sent()];
                case 94:
                    _v.sent();
                    _v.label = 95;
                case 95: return [4 /*yield*/, __await({
                        type: "done",
                        done: true,
                        filePath: generatedFilePath,
                        incomplete: hitIterationLimit,
                        reason: hitIterationLimit ? "max_tool_iterations" : undefined,
                    })];
                case 96: return [4 /*yield*/, _v.sent()];
                case 97:
                    _v.sent();
                    return [3 /*break*/, 101];
                case 98:
                    if (!lockResult.acquired) return [3 /*break*/, 100];
                    return [4 /*yield*/, __await((0, case_lock_1.releaseCaseLock)(caseFolder, lockOwner))];
                case 99:
                    _v.sent();
                    _v.label = 100;
                case 100: return [7 /*endfinally*/];
                case 101: return [2 /*return*/];
            }
        });
    });
}
