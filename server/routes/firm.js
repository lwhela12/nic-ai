"use strict";
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
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
exports.indexCase = indexCase;
exports.generateHypergraph = generateHypergraph;
var hono_1 = require("hono");
var streaming_1 = require("hono/streaming");
var claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
var sdk_1 = require("@anthropic-ai/sdk");
// SDK CLI options helper - handles both direct and npx modes
var sdk_cli_options_1 = require("../lib/sdk-cli-options");
var promises_1 = require("fs/promises");
var fs_1 = require("fs");
var path_1 = require("path");
var migrate_pi_tool_1 = require("../lib/migrate-pi-tool");
var year_mode_1 = require("../lib/year-mode");
var os_1 = require("os");
var sessions_1 = require("../sessions");
var phase_rules_1 = require("../shared/phase-rules");
var knowledge_1 = require("./knowledge");
var extract_1 = require("../lib/extract");
var case_summary_1 = require("../lib/case-summary");
var merge_index_1 = require("../lib/merge-index");
var groq_extract_1 = require("../lib/groq-extract");
var firm_chat_1 = require("../lib/firm-chat");
var meta_index_1 = require("../lib/meta-index");
var index_schema_1 = require("../lib/index-schema");
var practice_areas_1 = require("../practice-areas");
var practice_area_1 = require("../lib/practice-area");
var team_access_1 = require("../lib/team-access");
var date_format_1 = require("../lib/date-format");
var document_id_1 = require("../lib/document-id");
// ============================================================================
// Usage Reporting
// ============================================================================
var DEV_MODE = process.env.DEV_MODE === "true" || process.env.NODE_ENV !== "production";
var SUBSCRIPTION_SERVER = process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";
var CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || (0, path_1.join)((0, os_1.homedir)(), ".claude-pi");
var CONFIG_FILE = (0, path_1.join)(CONFIG_DIR, "config.json");
function loadAuthConfig() {
    if (process.env.CLAUDE_PI_CONFIG) {
        try {
            return JSON.parse(process.env.CLAUDE_PI_CONFIG);
        }
        catch (_a) {
            // Fall through
        }
    }
    if (!(0, fs_1.existsSync)(CONFIG_FILE))
        return null;
    try {
        return JSON.parse((0, fs_1.readFileSync)(CONFIG_FILE, "utf-8"));
    }
    catch (_b) {
        return null;
    }
}
/**
 * Report token usage to the subscription server.
 * This is fire-and-forget - errors are logged but don't affect the main request.
 */
function reportUsage(tokensUsed, requestType) {
    return __awaiter(this, void 0, void 0, function () {
        var config, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (DEV_MODE)
                        return [2 /*return*/];
                    config = loadAuthConfig();
                    if (!(config === null || config === void 0 ? void 0 : config.authToken))
                        return [2 /*return*/];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, fetch("".concat(SUBSCRIPTION_SERVER, "/v1/usage/log"), {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: "Bearer ".concat(config.authToken),
                            },
                            body: JSON.stringify({ tokensUsed: tokensUsed, requestType: requestType }),
                        })];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    console.warn("[usage] Failed to report usage:", err_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
// Client is reset periodically to prevent connection pool exhaustion
var _anthropic = null;
var _requestCount = 0;
var CLIENT_RESET_THRESHOLD = 50;
function getClient() {
    if (!_anthropic || _requestCount >= CLIENT_RESET_THRESHOLD) {
        _anthropic = new sdk_1.default({
            apiKey: process.env.ANTHROPIC_API_KEY,
            fetch: globalThis.fetch.bind(globalThis),
        });
        if (_requestCount >= CLIENT_RESET_THRESHOLD) {
            console.log('[api] Anthropic client reset (connection pool refresh)');
        }
        _requestCount = 0;
    }
    _requestCount++;
    return _anthropic;
}
var app = new hono_1.Hono();
// Practice guide loading now handled by knowledge.ts
// Load INDEX_SCHEMA.md for injection into synthesis prompt
var indexSchemaCache = null;
function loadIndexSchema() {
    return __awaiter(this, void 0, void 0, function () {
        var schemaPath, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (indexSchemaCache)
                        return [2 /*return*/, indexSchemaCache];
                    schemaPath = (0, path_1.join)(import.meta.dir, "../../INDEX_SCHEMA.md");
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(schemaPath, "utf-8")];
                case 2:
                    indexSchemaCache = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    console.warn("[Schema] Could not load INDEX_SCHEMA.md, using fallback");
                    indexSchemaCache = "";
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, indexSchemaCache];
            }
        });
    });
}
// Sections relevant for case synthesis (by manifest section ID)
var SYNTHESIS_SECTION_IDS = [
    "liability-evaluation",
    "injury-severity",
    "valuation-framework",
    "subrogation-liens",
    "document-quality",
    // Workers' comp equivalents
    "claim-evaluation",
    "injury-classification",
    "benefits-calculation",
    "third-party-claims",
];
// JSON Schema for structured synthesis output (used with direct API call)
// PI-specific schema
var SYNTHESIS_SCHEMA_PI = {
    type: "object",
    properties: {
        needs_review: {
            type: "array",
            description: "Fields requiring human review due to conflicts or uncertainty",
            items: {
                type: "object",
                properties: {
                    field: { type: "string", description: "Field name or path (e.g., 'charges:Provider Name')" },
                    conflicting_values: {
                        type: "array",
                        items: { type: "string" },
                        description: "The different values found"
                    },
                    sources: {
                        type: "array",
                        items: { type: "string" },
                        description: "Source documents for each value"
                    },
                    reason: { type: "string", description: "Why this requires human review" }
                },
                required: ["field", "conflicting_values", "sources", "reason"]
            }
        },
        errata: {
            type: "array",
            description: "Documentation of decisions made during synthesis",
            items: {
                type: "object",
                properties: {
                    field: { type: "string", description: "Field that was resolved" },
                    decision: { type: "string", description: "Value chosen" },
                    evidence: { type: "string", description: "What the extractions showed" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] }
                },
                required: ["field", "decision", "evidence", "confidence"]
            }
        },
        case_analysis: {
            type: "string",
            description: "Substantive case analysis: liability assessment, injury tier, value estimate, treatment patterns, next steps"
        },
        liability_assessment: {
            type: "string",
            enum: ["clear", "moderate", "contested"],
            description: "Overall liability strength"
        },
        injury_tier: {
            type: "string",
            enum: ["tier_1_soft_tissue", "tier_2_structural", "tier_3_surgical"],
            description: "Injury severity tier based on treatment and findings"
        },
        estimated_value_range: {
            type: "string",
            description: "Value range in format '$X - $Y' based on specials and multiplier"
        },
        policy_limits_demand_appropriate: {
            type: "boolean",
            description: "Whether a policy limits demand is appropriate"
        },
        summary: {
            type: "object",
            description: "Case summary fields",
            properties: {
                client: { type: "string", description: "Client's full name" },
                dol: { type: "string", description: "Date of loss (MM-DD-YYYY preferred, or YYYY-MM-DD)" },
                dob: { type: "string", description: "Client's date of birth" },
                providers: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of medical provider names"
                },
                total_charges: { type: "number", description: "Total medical charges in dollars" },
                policy_limits: {
                    type: "object",
                    description: "Policy limits by party (1P, 3P)",
                    additionalProperties: true
                },
                contact: {
                    type: "object",
                    properties: {
                        phone: { type: "string" },
                        email: { type: "string" },
                        address: {
                            type: "object",
                            properties: {
                                street: { type: "string" },
                                city: { type: "string" },
                                state: { type: "string" },
                                zip: { type: "string" }
                            }
                        }
                    }
                },
                health_insurance: {
                    type: "object",
                    properties: {
                        carrier: { type: "string" },
                        group_no: { type: "string" },
                        member_no: { type: "string" }
                    }
                },
                claim_numbers: {
                    type: "object",
                    description: "Claim numbers keyed by party (e.g., '1P_AAA', '3P_Progressive')",
                    additionalProperties: { type: "string" }
                },
                case_summary: { type: "string", description: "Brief narrative summary of the case" }
            },
            required: ["client", "dol", "providers", "total_charges"]
        },
        case_name: {
            type: "string",
            description: "Case name (typically 'LASTNAME, Firstname')"
        },
        case_phase: {
            type: "string",
            enum: ["Intake", "Investigation", "Treatment", "Demand", "Negotiation", "Settlement", "Complete"],
            description: "Current phase of the case"
        }
    },
    required: [
        "needs_review",
        "errata",
        "case_analysis",
        "liability_assessment",
        "injury_tier",
        "estimated_value_range",
        "policy_limits_demand_appropriate",
        "summary",
        "case_name",
        "case_phase"
    ]
};
// WC-specific schema for synthesis
var SYNTHESIS_SCHEMA_WC = {
    type: "object",
    properties: {
        // Shared fields (same structure as PI)
        needs_review: {
            type: "array",
            description: "Fields requiring human review due to conflicts or uncertainty",
            items: {
                type: "object",
                properties: {
                    field: { type: "string", description: "Field name or path (e.g., 'charges:Provider Name')" },
                    conflicting_values: {
                        type: "array",
                        items: { type: "string" },
                        description: "The different values found"
                    },
                    sources: {
                        type: "array",
                        items: { type: "string" },
                        description: "Source documents for each value"
                    },
                    reason: { type: "string", description: "Why this requires human review" }
                },
                required: ["field", "conflicting_values", "sources", "reason"]
            }
        },
        errata: {
            type: "array",
            description: "Documentation of decisions made during synthesis",
            items: {
                type: "object",
                properties: {
                    field: { type: "string", description: "Field that was resolved" },
                    decision: { type: "string", description: "Value chosen" },
                    evidence: { type: "string", description: "What the extractions showed" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] }
                },
                required: ["field", "decision", "evidence", "confidence"]
            }
        },
        case_analysis: {
            type: "string",
            description: "Substantive WC case analysis: compensability assessment, injury classification, benefits calculation, treatment status, next steps"
        },
        // WC-specific assessment fields
        compensability: {
            type: "string",
            enum: ["clearly_compensable", "likely_compensable", "disputed", "denied"],
            description: "Compensability status of the claim based on AOE/COE analysis"
        },
        claim_type: {
            type: "string",
            enum: ["specific_injury", "occupational_disease", "cumulative_trauma"],
            description: "Type of workers' compensation claim"
        },
        estimated_ttd_weeks: {
            type: "number",
            description: "Estimated weeks of Temporary Total Disability benefits"
        },
        estimated_ppd_rating: {
            type: "number",
            description: "Estimated Permanent Partial Disability rating percentage"
        },
        third_party_potential: {
            type: "boolean",
            description: "Whether there is potential for a third-party liability claim"
        },
        open_hearings: {
            type: "array",
            description: "Open hearing matters with case numbers and hearing level",
            items: {
                type: "object",
                properties: {
                    case_number: { type: "string", description: "Hearing/docket case number (e.g., D-16-12345)" },
                    hearing_level: {
                        type: "string",
                        enum: ["H.O.", "A.O."],
                        description: "H.O. (Hearing Officer, default) or A.O. (Appeals Officer, if any A.O. documents exist)"
                    },
                    next_date: { type: "string", description: "Next hearing date if known" },
                    issue: { type: "string", description: "Issue(s) in dispute" }
                },
                required: ["case_number", "hearing_level"]
            }
        },
        // WC summary structure
        summary: {
            type: "object",
            description: "Case summary fields for Workers' Compensation",
            properties: {
                client: { type: "string", description: "Client's full name" },
                doi: { type: "string", description: "Date of injury (MM-DD-YYYY preferred, or YYYY-MM-DD)" },
                dob: { type: "string", description: "Client's date of birth" },
                providers: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of medical provider names"
                },
                total_charges: { type: "number", description: "Total medical charges in dollars" },
                contact: {
                    type: "object",
                    properties: {
                        phone: { type: "string" },
                        email: { type: "string" },
                        address: {
                            type: "object",
                            properties: {
                                street: { type: "string" },
                                city: { type: "string" },
                                state: { type: "string" },
                                zip: { type: "string" }
                            }
                        }
                    }
                },
                health_insurance: {
                    type: "object",
                    properties: {
                        carrier: { type: "string" },
                        group_no: { type: "string" },
                        member_no: { type: "string" }
                    }
                },
                case_summary: { type: "string", description: "Brief narrative summary of the case" },
                // WC-specific summary fields
                employer: {
                    type: "object",
                    description: "Employer information",
                    properties: {
                        name: { type: "string", description: "Employer company name" },
                        address: {
                            type: "object",
                            properties: {
                                street: { type: "string" },
                                city: { type: "string" },
                                state: { type: "string" },
                                zip: { type: "string" }
                            }
                        },
                        phone: { type: "string" }
                    },
                    required: ["name"]
                },
                wc_carrier: {
                    type: "object",
                    description: "Workers' compensation insurance carrier information",
                    properties: {
                        name: { type: "string", description: "Insurance carrier name" },
                        claim_number: { type: "string", description: "WC claim number" },
                        adjuster_name: { type: "string" },
                        adjuster_phone: { type: "string" },
                        tpa_name: { type: "string", description: "Third Party Administrator name if applicable" }
                    }
                },
                disability_status: {
                    type: "object",
                    description: "Current disability status and benefits information",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["TTD", "TPD", "PPD", "PTD"],
                            description: "Type of disability (Temporary Total, Temporary Partial, Permanent Partial, Permanent Total)"
                        },
                        amw: { type: "number", description: "Average Monthly Wage in dollars" },
                        compensation_rate: { type: "number", description: "Weekly compensation rate in dollars" },
                        mmi_date: { type: "string", description: "Maximum Medical Improvement date" },
                        ppd_rating: { type: "number", description: "Permanent Partial Disability rating percentage" }
                    }
                },
                job_title: { type: "string", description: "Client's job title at time of injury" },
                injury_description: { type: "string", description: "Description of the work injury" },
                body_parts: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of affected body parts"
                }
            },
            required: ["client", "doi", "providers", "total_charges", "employer"]
        },
        case_name: {
            type: "string",
            description: "Case name (typically 'LASTNAME, Firstname')"
        },
        case_phase: {
            type: "string",
            enum: ["Intake", "Investigation", "Treatment", "MMI Evaluation", "Benefits Resolution", "Settlement/Hearing", "Closed"],
            description: "Current phase of the Workers' Compensation case"
        }
    },
    required: [
        "needs_review",
        "errata",
        "case_analysis",
        "compensability",
        "summary",
        "case_name",
        "case_phase"
    ]
};
/**
 * Get the appropriate synthesis schema based on practice area.
 */
function getSynthesisSchema(practiceArea) {
    if (practiceArea === practice_areas_1.PRACTICE_AREAS.WC) {
        return SYNTHESIS_SCHEMA_WC;
    }
    return SYNTHESIS_SCHEMA_PI;
}
// Helper to parse amount values (handles both number and string formats like "$24,419.90")
function parseAmount(val) {
    if (typeof val === 'number')
        return val;
    if (typeof val === 'string') {
        var cleaned = val.replace(/[$,]/g, '');
        var num = parseFloat(cleaned);
        return isNaN(num) ? undefined : num;
    }
    return undefined;
}
// Helper to build a CaseSummary from a case folder path
function buildCaseSummary(casePath, caseName, options) {
    return __awaiter(this, void 0, void 0, function () {
        function countFiles(dir) {
            return __awaiter(this, void 0, void 0, function () {
                var entries, _a, _i, entries_1, e;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _b.trys.push([0, 2, , 3]);
                            return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                        case 1:
                            entries = _b.sent();
                            return [3 /*break*/, 3];
                        case 2:
                            _a = _b.sent();
                            return [2 /*return*/];
                        case 3:
                            _i = 0, entries_1 = entries;
                            _b.label = 4;
                        case 4:
                            if (!(_i < entries_1.length)) return [3 /*break*/, 8];
                            e = entries_1[_i];
                            if (e.name === '.ai_tool' || e.name.startsWith('.'))
                                return [3 /*break*/, 7];
                            if (!e.isDirectory()) return [3 /*break*/, 6];
                            return [4 /*yield*/, countFiles((0, path_1.join)(dir, e.name))];
                        case 5:
                            _b.sent();
                            return [3 /*break*/, 7];
                        case 6:
                            count_1++;
                            _b.label = 7;
                        case 7:
                            _i++;
                            return [3 /*break*/, 4];
                        case 8: return [2 /*return*/];
                    }
                });
            });
        }
        var indexPath, configuredPracticeArea, caseSummary, indexContent, index, indexStats, dolDate, solDate, solDate, now, diffMs, indexPracticeArea, isWC, _a, _b, entry, count_1, _c;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
        return __generator(this, function (_11) {
            switch (_11.label) {
                case 0:
                    indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                    configuredPracticeArea = (0, practice_area_1.normalizePracticeArea)(options === null || options === void 0 ? void 0 : options.practiceArea);
                    caseSummary = {
                        path: casePath,
                        name: caseName,
                        indexed: false,
                        practiceArea: configuredPracticeArea,
                        isSubcase: !!(options === null || options === void 0 ? void 0 : options.subcaseInfo),
                        parentPath: (_d = options === null || options === void 0 ? void 0 : options.subcaseInfo) === null || _d === void 0 ? void 0 : _d.parentPath,
                        parentName: (_e = options === null || options === void 0 ? void 0 : options.subcaseInfo) === null || _e === void 0 ? void 0 : _e.parentName,
                    };
                    _11.label = 1;
                case 1:
                    _11.trys.push([1, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 2:
                    indexContent = _11.sent();
                    index = JSON.parse(indexContent);
                    return [4 /*yield*/, (0, promises_1.stat)(indexPath)];
                case 3:
                    indexStats = _11.sent();
                    caseSummary.indexed = true;
                    caseSummary.indexedAt = indexStats.mtime.toISOString();
                    // Extract from index - handle various formats
                    caseSummary.clientName = ((_f = index.summary) === null || _f === void 0 ? void 0 : _f.client) || index.client_name || ((_g = index.summary) === null || _g === void 0 ? void 0 : _g.client_name) || ((_h = index.case_name) === null || _h === void 0 ? void 0 : _h.split(" v.")[0]) || caseName;
                    caseSummary.casePhase = index.case_phase || ((_j = index.summary) === null || _j === void 0 ? void 0 : _j.case_phase) || "Unknown";
                    // Check incident_date (canonical field), dol (PI legacy), and date_of_loss variants
                    caseSummary.dateOfLoss = ((_k = index.summary) === null || _k === void 0 ? void 0 : _k.incident_date) || ((_l = index.summary) === null || _l === void 0 ? void 0 : _l.dol) || index.date_of_loss || ((_m = index.summary) === null || _m === void 0 ? void 0 : _m.date_of_loss) || index.dol;
                    caseSummary.policyLimits = index.policy_limits || ((_o = index.summary) === null || _o === void 0 ? void 0 : _o.policy_limits) || index["3p_policy_limits"];
                    caseSummary.totalSpecials = (_v = (_u = (_t = (_r = (_p = parseAmount(index.total_specials)) !== null && _p !== void 0 ? _p : parseAmount((_q = index.summary) === null || _q === void 0 ? void 0 : _q.total_specials)) !== null && _r !== void 0 ? _r : parseAmount((_s = index.summary) === null || _s === void 0 ? void 0 : _s.total_charges)) !== null && _t !== void 0 ? _t : parseAmount(index.total_medical_charges)) !== null && _u !== void 0 ? _u : parseAmount(index.total_charges)) !== null && _v !== void 0 ? _v : parseAmount((_w = index.financials) === null || _w === void 0 ? void 0 : _w.total_charges);
                    // Statute of limitations - use explicit value or calculate from DOL + 2 years (Nevada PI)
                    caseSummary.statuteOfLimitations = index.statute_of_limitations || ((_x = index.summary) === null || _x === void 0 ? void 0 : _x.statute_of_limitations);
                    // If no explicit SOL, calculate from DOL (Nevada PI = 2 years)
                    if (!caseSummary.statuteOfLimitations && caseSummary.dateOfLoss) {
                        dolDate = (0, date_format_1.parseFlexibleDate)(caseSummary.dateOfLoss);
                        if (dolDate) {
                            solDate = new Date(dolDate);
                            solDate.setFullYear(solDate.getFullYear() + 2);
                            caseSummary.statuteOfLimitations = (0, date_format_1.formatDateYYYYMMDD)(solDate);
                        }
                    }
                    if (caseSummary.statuteOfLimitations) {
                        solDate = new Date(caseSummary.statuteOfLimitations);
                        now = new Date();
                        diffMs = solDate.getTime() - now.getTime();
                        caseSummary.solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    }
                    // Providers list
                    if (index.providers) {
                        caseSummary.providers = Array.isArray(index.providers)
                            ? index.providers.map(function (p) { return typeof p === 'string' ? p : p.name; })
                            : Object.keys(index.providers);
                    }
                    else if ((_y = index.summary) === null || _y === void 0 ? void 0 : _y.providers) {
                        caseSummary.providers = index.summary.providers;
                    }
                    indexPracticeArea = (0, practice_area_1.normalizePracticeArea)(index.practice_area || index.practiceArea);
                    caseSummary.practiceArea = configuredPracticeArea || indexPracticeArea;
                    isWC = caseSummary.practiceArea === practice_areas_1.PRACTICE_AREAS.WC;
                    // WC-specific fields
                    if (isWC) {
                        // Employer
                        caseSummary.employer = ((_0 = (_z = index.summary) === null || _z === void 0 ? void 0 : _z.employer) === null || _0 === void 0 ? void 0 : _0.name) || ((_1 = index.summary) === null || _1 === void 0 ? void 0 : _1.employer);
                        // TTD Status
                        caseSummary.ttdStatus = ((_3 = (_2 = index.summary) === null || _2 === void 0 ? void 0 : _2.disability_status) === null || _3 === void 0 ? void 0 : _3.type) || index.ttd_status;
                        // AMW and compensation rate (accept both amw and legacy aww)
                        caseSummary.amw = parseAmount((_5 = (_4 = index.summary) === null || _4 === void 0 ? void 0 : _4.disability_status) === null || _5 === void 0 ? void 0 : _5.amw)
                            || parseAmount((_7 = (_6 = index.summary) === null || _6 === void 0 ? void 0 : _6.disability_status) === null || _7 === void 0 ? void 0 : _7.aww)
                            || parseAmount(index.amw);
                        caseSummary.compensationRate = parseAmount((_9 = (_8 = index.summary) === null || _8 === void 0 ? void 0 : _8.disability_status) === null || _9 === void 0 ? void 0 : _9.compensation_rate) || parseAmount(index.compensation_rate);
                        // Open hearings (normalize legacy type→hearing_level)
                        if (Array.isArray(index.open_hearings)) {
                            caseSummary.openHearings = index.open_hearings.map(function (h) { return ({
                                case_number: h.case_number,
                                hearing_level: h.hearing_level || (h.type === "A.O." ? "A.O." : "H.O."),
                                next_date: h.next_date,
                                issue: h.issue,
                            }); });
                        }
                    }
                    // Team assignments
                    if (Array.isArray(index.assignments)) {
                        caseSummary.assignments = index.assignments;
                    }
                    if (!!(options === null || options === void 0 ? void 0 : options.yearRegistry)) return [3 /*break*/, 5];
                    _a = caseSummary;
                    return [4 /*yield*/, checkNeedsReindex(casePath, indexStats.mtimeMs)];
                case 4:
                    _a.needsReindex = _11.sent();
                    _11.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    _b = _11.sent();
                    // No index found - case exists but not indexed
                    caseSummary.indexed = false;
                    return [3 /*break*/, 7];
                case 7:
                    _11.trys.push([7, 11, , 12]);
                    if (!(options === null || options === void 0 ? void 0 : options.yearRegistry)) return [3 /*break*/, 8];
                    entry = options.yearRegistry.registry.clients[options.yearRegistry.slug];
                    caseSummary.fileCount = (_10 = entry === null || entry === void 0 ? void 0 : entry.fileCount) !== null && _10 !== void 0 ? _10 : 0;
                    return [3 /*break*/, 10];
                case 8:
                    count_1 = 0;
                    return [4 /*yield*/, countFiles(casePath)];
                case 9:
                    _11.sent();
                    caseSummary.fileCount = count_1;
                    _11.label = 10;
                case 10: return [3 /*break*/, 12];
                case 11:
                    _c = _11.sent();
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/, caseSummary];
            }
        });
    });
}
// Discover subcases and build their summaries
function discoverAndBuildSubcases(parentPath, parentName, practiceArea) {
    return __awaiter(this, void 0, void 0, function () {
        var subcasePaths;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, discoverSubcases(parentPath)];
                case 1:
                    subcasePaths = _a.sent();
                    return [2 /*return*/, Promise.all(subcasePaths.map(function (subcasePath) {
                            var subcaseName = subcasePath.split('/').pop() || subcasePath;
                            return buildCaseSummary(subcasePath, subcaseName, {
                                subcaseInfo: { parentPath: parentPath, parentName: parentName },
                                practiceArea: practiceArea,
                            });
                        }))];
            }
        });
    });
}
/**
 * Build a container summary for a client folder with DOI subfolders.
 * Containers are not cases themselves - they're grouping headers.
 */
function buildContainerSummary(containerPath, containerName, doiCases) {
    return {
        path: containerPath,
        name: containerName,
        clientName: containerName,
        indexed: false, // Containers are never "indexed" as cases
        isContainer: true,
        siblingCases: doiCases,
    };
}
/**
 * Build a DOI case summary with container and sibling information.
 */
function buildDOICaseSummary(doiCase, containerPath, containerName, allSiblings, practiceArea) {
    return __awaiter(this, void 0, void 0, function () {
        var summary;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, buildCaseSummary(doiCase.path, doiCase.name, { practiceArea: practiceArea })];
                case 1:
                    summary = _a.sent();
                    // Add DOI-specific fields
                    summary.containerPath = containerPath;
                    summary.containerName = containerName;
                    summary.injuryDate = doiCase.dateOfInjury;
                    // Add sibling cases (excluding self)
                    summary.siblingCases = allSiblings.filter(function (s) { return s.path !== doiCase.path; });
                    // Override client name to be clearer (include injury date context)
                    if (!summary.clientName || summary.clientName === doiCase.name) {
                        summary.clientName = containerName;
                    }
                    return [2 /*return*/, summary];
            }
        });
    });
}
// Get all cases in a firm's root folder
app.get("/cases", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, requestedPracticeArea, access, configuredPracticeArea, practiceArea, isWC, yearMode, registry_1, cases_1, indexedCount_1, entries, casePromises, caseArrays, cases, topLevelCases, sortedCases, _loop_1, _i, topLevelCases_1, parent_1, indexedCount, needsAttentionCount, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                root = c.req.query("root");
                requestedPracticeArea = c.req.query("practiceArea");
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 1:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                // Migrate .pi_tool → .ai_tool at firm root if needed
                return [4 /*yield*/, (0, migrate_pi_tool_1.migratePiTool)(root)];
            case 2:
                // Migrate .pi_tool → .ai_tool at firm root if needed
                _a.sent();
                return [4 /*yield*/, (0, practice_area_1.resolveFirmPracticeArea)(root)];
            case 3:
                configuredPracticeArea = _a.sent();
                practiceArea = configuredPracticeArea ||
                    (0, practice_area_1.normalizePracticeArea)(requestedPracticeArea) ||
                    practice_areas_1.PRACTICE_AREAS.PI;
                isWC = practiceArea === practice_areas_1.PRACTICE_AREAS.WC;
                _a.label = 4;
            case 4:
                _a.trys.push([4, 15, , 16]);
                return [4 /*yield*/, (0, year_mode_1.detectYearBasedMode)(root)];
            case 5:
                yearMode = _a.sent();
                if (!yearMode) return [3 /*break*/, 12];
                return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(root)];
            case 6:
                registry_1 = _a.sent();
                if (!!registry_1) return [3 /*break*/, 8];
                return [4 /*yield*/, (0, year_mode_1.scanAndBuildRegistry)(root)];
            case 7:
                registry_1 = _a.sent();
                return [3 /*break*/, 10];
            case 8: return [4 /*yield*/, (0, year_mode_1.ensureRegistryFresh)(root, registry_1)];
            case 9:
                // Lightweight check: pick up new clients in current year + any new year folders
                registry_1 = _a.sent();
                _a.label = 10;
            case 10: return [4 /*yield*/, Promise.all(Object.values(registry_1.clients).map(function (client) { return __awaiter(void 0, void 0, void 0, function () {
                    var virtualPath, summary, years;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                virtualPath = (0, path_1.join)(root, ".ai_tool", "clients", client.slug);
                                return [4 /*yield*/, buildCaseSummary(virtualPath, client.name, {
                                        practiceArea: practiceArea,
                                        yearRegistry: { firmRoot: root, registry: registry_1, slug: client.slug },
                                    })];
                            case 1:
                                summary = _a.sent();
                                years = client.sourceFolders
                                    .map(function (sf) { return (0, year_mode_1.yearFromFolder)(sf.split("/")[0]); })
                                    .filter(function (y) { return y !== null; });
                                summary.latestYear = years.length > 0 ? Math.max.apply(Math, years) : undefined;
                                return [2 /*return*/, summary];
                        }
                    });
                }); }))];
            case 11:
                cases_1 = _a.sent();
                // Sort: indexed first, then alphabetically
                cases_1.sort(function (a, b) {
                    if (a.indexed !== b.indexed)
                        return a.indexed ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                indexedCount_1 = cases_1.filter(function (c) { return c.indexed; }).length;
                return [2 /*return*/, c.json({
                        root: root,
                        practiceArea: practiceArea,
                        yearBasedMode: true,
                        cases: cases_1,
                        summary: {
                            total: cases_1.length,
                            indexed: indexedCount_1,
                            needsAttention: 0,
                        },
                    })];
            case 12: return [4 /*yield*/, (0, promises_1.readdir)(root, { withFileTypes: true })];
            case 13:
                entries = _a.sent();
                casePromises = entries
                    .filter(function (entry) { return entry.isDirectory() && entry.name !== ".ai_tool" && entry.name !== ".ai_tool"; })
                    .map(function (entry) { return __awaiter(void 0, void 0, void 0, function () {
                    var casePath, results, doiDetection_1, containerSummary, doiSummaries, _a, caseSummary, subcases;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                casePath = (0, path_1.join)(root, entry.name);
                                results = [];
                                if (!isWC) return [3 /*break*/, 3];
                                return [4 /*yield*/, detectDOISubfolders(casePath)];
                            case 1:
                                doiDetection_1 = _b.sent();
                                if (!doiDetection_1.isContainer) return [3 /*break*/, 3];
                                containerSummary = buildContainerSummary(casePath, entry.name, doiDetection_1.doiCases);
                                results.push(containerSummary);
                                return [4 /*yield*/, Promise.all(doiDetection_1.doiCases.map(function (doiCase) {
                                        return buildDOICaseSummary(doiCase, casePath, entry.name, doiDetection_1.doiCases, practiceArea);
                                    }))];
                            case 2:
                                doiSummaries = _b.sent();
                                results.push.apply(results, doiSummaries);
                                return [2 /*return*/, results];
                            case 3: return [4 /*yield*/, Promise.all([
                                    buildCaseSummary(casePath, entry.name, { practiceArea: practiceArea }),
                                    discoverAndBuildSubcases(casePath, entry.name, practiceArea),
                                ])];
                            case 4:
                                _a = _b.sent(), caseSummary = _a[0], subcases = _a[1];
                                results.push.apply(results, __spreadArray([caseSummary], subcases, false));
                                return [2 /*return*/, results];
                        }
                    });
                }); });
                return [4 /*yield*/, Promise.all(casePromises)];
            case 14:
                caseArrays = _a.sent();
                cases = caseArrays.flat();
                topLevelCases = cases.filter(function (c) { return !c.isSubcase && !c.containerPath; });
                topLevelCases.sort(function (a, b) {
                    // Containers and indexed cases before unindexed regular cases
                    if (a.isContainer !== b.isContainer)
                        return a.isContainer ? -1 : 1;
                    if (!a.isContainer && !b.isContainer) {
                        if (a.indexed !== b.indexed)
                            return a.indexed ? -1 : 1;
                    }
                    // Then by SOL urgency (for non-containers)
                    if (!a.isContainer && !b.isContainer) {
                        if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
                            return a.solDaysRemaining - b.solDaysRemaining;
                        }
                        if (a.solDaysRemaining !== undefined)
                            return -1;
                        if (b.solDaysRemaining !== undefined)
                            return 1;
                    }
                    // Then alphabetically
                    return a.name.localeCompare(b.name);
                });
                sortedCases = [];
                _loop_1 = function (parent_1) {
                    sortedCases.push(parent_1);
                    if (parent_1.isContainer) {
                        // Add DOI cases for this container (sorted by injury date, most recent first)
                        var doiCases = cases.filter(function (c) { return c.containerPath === parent_1.path; });
                        doiCases.sort(function (a, b) { return (b.injuryDate || '').localeCompare(a.injuryDate || ''); });
                        sortedCases.push.apply(sortedCases, doiCases);
                    }
                    else {
                        // Add subcases for this parent (regular linked cases)
                        var subcases = cases.filter(function (c) { return c.isSubcase && c.parentPath === parent_1.path; });
                        subcases.sort(function (a, b) { return a.name.localeCompare(b.name); });
                        sortedCases.push.apply(sortedCases, subcases);
                    }
                };
                for (_i = 0, topLevelCases_1 = topLevelCases; _i < topLevelCases_1.length; _i++) {
                    parent_1 = topLevelCases_1[_i];
                    _loop_1(parent_1);
                }
                indexedCount = sortedCases.filter(function (c) { return c.indexed && !c.isContainer; }).length;
                needsAttentionCount = isWC
                    ? sortedCases.filter(function (c) { return c.openHearings && c.openHearings.length > 0; }).length
                    : sortedCases.filter(function (c) { return c.solDaysRemaining !== undefined && c.solDaysRemaining <= 90; }).length;
                return [2 /*return*/, c.json({
                        root: root,
                        practiceArea: practiceArea,
                        cases: sortedCases,
                        summary: {
                            total: sortedCases.filter(function (c) { return !c.isContainer; }).length, // Don't count containers
                            indexed: indexedCount,
                            needsAttention: needsAttentionCount,
                        }
                    })];
            case 15:
                error_1 = _a.sent();
                console.error("Firm cases error:", error_1);
                return [2 /*return*/, c.json({ error: "Could not read firm directory" }, 500)];
            case 16: return [2 /*return*/];
        }
    });
}); });
// Single-case summary — lightweight alternative to /cases for incremental refresh
app.get("/case-summary", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, casePath, access, practiceArea, yearMode, summary, slug, registry, years, caseName, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                root = c.req.query("root");
                casePath = c.req.query("path");
                if (!root || !casePath) {
                    return [2 /*return*/, c.json({ error: "root and path query params required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 1:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                return [4 /*yield*/, (0, practice_area_1.resolveFirmPracticeArea)(root)];
            case 2:
                practiceArea = (_a.sent()) || practice_areas_1.PRACTICE_AREAS.PI;
                _a.label = 3;
            case 3:
                _a.trys.push([3, 10, , 11]);
                return [4 /*yield*/, (0, year_mode_1.detectYearBasedMode)(root)];
            case 4:
                yearMode = _a.sent();
                summary = void 0;
                if (!yearMode) return [3 /*break*/, 7];
                slug = (0, year_mode_1.getClientSlug)(casePath);
                return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(root)];
            case 5:
                registry = _a.sent();
                if (!registry || !registry.clients[slug]) {
                    return [2 /*return*/, c.json({ error: "Client not found in registry" }, 404)];
                }
                return [4 /*yield*/, buildCaseSummary(casePath, registry.clients[slug].name, {
                        practiceArea: practiceArea,
                        yearRegistry: { firmRoot: root, registry: registry, slug: slug },
                    })];
            case 6:
                summary = _a.sent();
                years = registry.clients[slug].sourceFolders
                    .map(function (sf) { return (0, year_mode_1.yearFromFolder)(sf.split("/")[0]); })
                    .filter(function (y) { return y !== null; });
                summary.latestYear = years.length > 0 ? Math.max.apply(Math, years) : undefined;
                return [3 /*break*/, 9];
            case 7:
                caseName = casePath.split("/").pop() || casePath;
                return [4 /*yield*/, buildCaseSummary(casePath, caseName, { practiceArea: practiceArea })];
            case 8:
                summary = _a.sent();
                _a.label = 9;
            case 9:
                // We just indexed — override stale reindex flag
                summary.needsReindex = false;
                return [2 /*return*/, c.json(summary)];
            case 10:
                error_2 = _a.sent();
                console.error("Case summary error:", error_2);
                return [2 /*return*/, c.json({ error: "Could not build case summary" }, 500)];
            case 11: return [2 /*return*/];
        }
    });
}); });
// Scan for new clients in year-based folder structures
app.post("/scan-clients", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, access, result, error_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                root = (_a.sent()).root;
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root is required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                _a.label = 3;
            case 3:
                _a.trys.push([3, 5, , 6]);
                return [4 /*yield*/, (0, year_mode_1.refreshRegistry)(root)];
            case 4:
                result = _a.sent();
                return [2 /*return*/, c.json(result)];
            case 5:
                error_3 = _a.sent();
                console.error("Scan clients error:", error_3);
                return [2 /*return*/, c.json({ error: "Could not scan for clients" }, 500)];
            case 6: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// FILE EXTRACTION SYSTEM - One agent per file, server-side orchestration
// ============================================================================
// =============================================================================
// PRACTICE-AREA-AWARE EXTRACTION PROMPTS
// =============================================================================
// Personal Injury extraction prompt
var PI_EXTRACTION_PROMPT = "You are a document extraction agent for a Personal Injury law firm in Nevada.\n\nYOUR TASK: Analyze the provided document text and extract key information using the extract_document tool.\n\nDOCUMENT TYPES (use for the \"type\" field):\n- intake_form: Client intake, accident details, contact info\n- lor: Letter of Representation to insurance companies\n- declaration: Insurance policy declarations page (coverage limits) - EXTRACT FULL COVERAGE DETAILS\n- medical_record: Medical treatment records, doctor notes\n- medical_bill: Bills from medical providers (charges, dates)\n- correspondence: Letters, emails with adjusters\n- authorization: HIPAA forms, signed authorizations\n- identification: Driver's license, ID documents\n- police_report: Accident/police reports\n- demand: Demand letter to insurance\n- settlement: Settlement memos, releases\n- lien: Medical liens from providers\n- balance_request: Balance confirmation requests\n- balance_confirmation: Confirmed balances from providers\n- property_damage: Vehicle repair estimates, rental receipts\n- other: Anything that doesn't fit above\n\nEXTRACTION PRIORITIES:\n1. Client name, DOB, contact info (phone, email, address with street/city/state/zip)\n2. Date of loss (accident date) in MM-DD-YYYY format\n3. Document date (the date of this specific document, not treatment/incident dates):\n   - Extract into extracted_data.document_date\n   - If multiple dates appear, choose the document's issued/signed/authored date\n   - Add extracted_data.document_date_confidence (high|medium|low|unknown)\n   - Add extracted_data.document_date_reason with a brief explanation\n4. Handwriting detection:\n   - Set has_handwritten_data to true only if substantive extracted values appear handwritten (exclude signature/initial-only markings)\n   - Set handwritten_fields to non-signature extracted field names that appear handwritten (for example: [\"client_name\", \"document_date\"])\n   - Use an empty array [] when no handwritten values are present\n5. Insurance details - USE THE STRUCTURED FIELDS:\n   - For client's own policy (1P): use insurance_1p with carrier, policy_number, claim_number, bodily_injury, medical_payments, um_uim\n   - For at-fault party's policy (3P): use insurance_3p with carrier, policy_number, claim_number, bodily_injury, insured_name\n6. Medical provider name and charges (as numbers, not strings)\n7. Health insurance carrier, group_no, member_no\n8. Settlement/demand amounts as numbers\n\nCRITICAL FOR DECLARATION PAGES:\n- Identify if this is the client's policy (1P) or adverse party's policy (3P) based on folder name or document content\n- Extract carrier name, ALL coverage limits (BI, Med Pay, UM/UIM, PD)\n- Format limits as \"$X/$Y\" (per person/per accident)\n\nAlways call the extract_document tool with your findings.";
// Workers' Compensation extraction prompt
var WC_EXTRACTION_PROMPT = "You are a document extraction agent for a Workers' Compensation law firm in Nevada.\n\nYOUR TASK: Analyze the provided document text and extract key information using the extract_document tool.\n\nDOCUMENT TYPES (use for the \"type\" field):\n- c4_claim: C-4 Employee's Claim for Compensation form\n- c3_employer_report: C-3 Employer's Report of Industrial Injury\n- c5_carrier_acceptance: C-5 Insurer's Acceptance/Denial of Claim\n- medical_record: Treatment records from ATP (Authorized Treating Physician)\n- medical_bill: Bills from medical providers\n- work_status_report: Work restrictions, light duty documentation\n- ime_report: Independent Medical Examination report\n- mmi_determination: Maximum Medical Improvement determination\n- ppd_rating: Permanent Partial Disability rating report\n- ttd_check: Temporary Total Disability benefit check/stub\n- correspondence: Letters with adjuster, insurer, or DIR\n- authorization: Medical treatment authorizations\n- identification: Driver's license, ID, SSN documents\n- d9_hearing: D-9 Request for Hearing form\n- hearing_notice: Notice of hearing from DIR\n- hearing_decision: Administrative Officer or Hearing Officer decision\n- settlement: Stipulation, settlement agreement\n- wage_records: Pay stubs, W-2s, wage verification\n- job_description: Job duties, physical requirements\n- other: Anything that doesn't fit above\n\nEXTRACTION PRIORITIES:\n1. Claimant name, DOB, SSN (last 4), contact info\n2. Date of injury (DOI) in MM-DD-YYYY format\n3. Document date (the date of this specific document, not DOI/treatment dates):\n   - Extract into extracted_data.document_date\n   - If multiple dates appear, choose the document's issued/signed/authored date\n   - Add extracted_data.document_date_confidence (high|medium|low|unknown)\n   - Add extracted_data.document_date_reason with a brief explanation\n4. Handwriting detection:\n   - Set has_handwritten_data to true only if substantive extracted values appear handwritten (exclude signature/initial-only markings)\n   - Set handwritten_fields to non-signature extracted field names that appear handwritten (for example: [\"claimant_name\", \"doi\"])\n   - Use an empty array [] when no handwritten values are present\n5. Employer information:\n   - Employer name, address\n   - Job title at time of injury\n   - Date of hire\n6. WC Carrier/TPA information:\n   - Carrier name, claim number, adjuster name/contact\n7. Injury details:\n   - Body parts injured\n   - Mechanism of injury\n   - ICD-10 diagnosis codes if present\n8. Wage information:\n   - Average Monthly Wage (AMW)\n   - Compensation rate (typically 2/3 of AMW)\n9. Disability status (IMPORTANT - always determine disability_type when work status is mentioned):\n   - TTD (Temporary Total Disability): Patient is completely off work, cannot work at all\n   - TPD (Temporary Partial Disability): Patient on modified/light duty, working with restrictions\n   - PPD (Permanent Partial Disability): Patient has reached MMI with permanent impairment rating\n   - PTD (Permanent Total Disability): Patient permanently unable to work\n\n   INFERENCE RULES for disability_type:\n   - \"Off work\", \"no work\", \"cannot work\" \u2192 TTD\n   - \"Modified duty\", \"light duty\", \"work restrictions\", \"limited duty\" \u2192 TPD\n   - \"MMI reached\" + impairment rating \u2192 PPD\n   - Always extract disability_type if work status or benefits are mentioned\n10. Medical treatment:\n   - Treating physician name (ATP)\n   - Treatment dates and types\n   - Work restrictions\n11. Hearing information:\n   - Case/docket number\n   - Hearing dates\n   - Issues in dispute\n\nAlways call the extract_document tool with your findings.";
// Function to get the appropriate extraction prompt
// Loads from practice-areas module (markdown files) with fallback to hardcoded prompts
function getFileExtractionSystemPrompt(practiceArea) {
    var config = practiceArea === practice_areas_1.PRACTICE_AREAS.WC
        ? practice_areas_1.practiceAreaRegistry.get("WC")
        : practice_areas_1.practiceAreaRegistry.getDefault();
    // Use loaded prompt from markdown file if available, otherwise fall back to hardcoded
    if (config === null || config === void 0 ? void 0 : config.extractionPrompt) {
        return config.extractionPrompt;
    }
    // Fallback to hardcoded prompts during migration
    if (practiceArea === practice_areas_1.PRACTICE_AREAS.WC)
        return WC_EXTRACTION_PROMPT;
    return PI_EXTRACTION_PROMPT;
}
// PI fallback extraction prompt (agent reads file with tools)
var PI_EXTRACTION_PROMPT_WITH_TOOLS = "You are a document extraction agent for a Personal Injury law firm in Nevada.\n\nYOUR TASK: Read ONE document and extract key information.\n\nDOCUMENT TYPES:\n- intake_form: Client intake, accident details, contact info\n- lor: Letter of Representation to insurance companies\n- declaration: Insurance policy declarations page (coverage limits)\n- medical_record: Medical treatment records, doctor notes\n- medical_bill: Bills from medical providers (charges, dates)\n- correspondence: Letters, emails with adjusters\n- authorization: HIPAA forms, signed authorizations\n- identification: Driver's license, ID documents\n- police_report: Accident/police reports\n- demand: Demand letter to insurance\n- settlement: Settlement memos, releases\n- lien: Medical liens from providers\n- balance_request: Balance confirmation requests\n- balance_confirmation: Confirmed balances from providers\n- property_damage: Vehicle repair estimates, rental receipts\n- other: Anything that doesn't fit above\n\nEXTRACTION FOCUS:\n- Client name, DOB, contact info (phone, email, address)\n- Date of loss (accident date)\n- Use MM-DD-YYYY as the default output format for DOB, DOL, and document dates\n- Document date (this document's own issued/signed/authored date, not incident/treatment dates)\n- If multiple dates appear, include:\n  * extracted_data.document_date (best document date)\n  * extracted_data.document_date_confidence: high|medium|low|unknown\n  * extracted_data.document_date_reason: short explanation\n- Handwriting detection:\n  * has_handwritten_data: true when substantive extracted values appear handwritten (exclude signature/initial-only markings), else false\n  * handwritten_fields: array of non-signature extracted field names that appear handwritten (use [] when none)\n- Insurance policy numbers and limits\n- Medical provider names\n- Treatment dates and charges (dollar amounts)\n- Claim numbers\n- Health insurance details (carrier, group number, member ID)\n- Any issues or gaps noted in the document\n\nOUTPUT FORMAT - Return ONLY valid JSON:\n{\n  \"filename\": \"<exact filename>\",\n  \"folder\": \"<folder name>\",\n  \"type\": \"<document_type from list above>\",\n  \"key_info\": \"<2-3 sentence summary of most important information>\",\n  \"has_handwritten_data\": false,\n  \"handwritten_fields\": [],\n  \"extracted_data\": {\n    // Include any specific data points found\n  }\n}\n\nIMPORTANT:\n- Return ONLY the JSON object, no markdown, no explanation\n- For PDFs: prefer the Read tool directly (cross-platform). If needed, run: pdftotext \"filename\" -\n- For all other files: use the Read tool directly\n- If a file cannot be read or parsed, return the JSON with key_info explaining the issue";
// WC fallback extraction prompt (agent reads file with tools)
var WC_EXTRACTION_PROMPT_WITH_TOOLS = "You are a document extraction agent for a Workers' Compensation law firm in Nevada.\n\nYOUR TASK: Read ONE document and extract key information.\n\nDOCUMENT TYPES:\n- c4_claim: C-4 Employee's Claim for Compensation\n- c3_employer_report: C-3 Employer's Report of Industrial Injury\n- c5_carrier_acceptance: C-5 Insurer's Acceptance/Denial\n- medical_record: Treatment records from ATP\n- medical_bill: Bills from medical providers\n- work_status_report: Work restrictions, light duty docs\n- ime_report: Independent Medical Examination\n- mmi_determination: Maximum Medical Improvement determination\n- ppd_rating: Permanent Partial Disability rating\n- ttd_check: TTD benefit check/stub\n- correspondence: Letters with adjuster, insurer, DIR\n- authorization: Medical treatment authorizations\n- identification: Driver's license, ID, SSN documents\n- d9_hearing: D-9 Request for Hearing\n- hearing_notice: Notice of hearing from DIR\n- hearing_decision: AO or HO decision\n- settlement: Stipulation, settlement agreement\n- wage_records: Pay stubs, W-2s, wage verification\n- job_description: Job duties, physical requirements\n- other: Anything that doesn't fit above\n\nEXTRACTION FOCUS:\n- Claimant name, DOB, SSN (last 4), contact info\n- Date of injury (DOI)\n- Use MM-DD-YYYY as the default output format for DOB, DOI, and document dates\n- Document date (this document's own issued/signed/authored date, not DOI/treatment dates)\n- If multiple dates appear, include:\n  * extracted_data.document_date (best document date)\n  * extracted_data.document_date_confidence: high|medium|low|unknown\n  * extracted_data.document_date_reason: short explanation\n- Handwriting detection:\n  * has_handwritten_data: true when substantive extracted values appear handwritten (exclude signature/initial-only markings), else false\n  * handwritten_fields: array of non-signature extracted field names that appear handwritten (use [] when none)\n- Employer name, job title\n- WC Carrier name, claim number, adjuster\n- Body parts injured, diagnosis codes\n- Average Monthly Wage (AMW), compensation rate\n- disability_type (IMPORTANT - always determine when work status mentioned):\n  * TTD = off work completely, cannot work\n  * TPD = modified/light duty, working with restrictions\n  * PPD = MMI reached with permanent impairment rating\n  * PTD = permanently unable to work\n- MMI date, PPD rating if present\n- Treating physician (ATP), work restrictions\n- Hearing case numbers and dates\n\nDISABILITY TYPE INFERENCE:\n- \"Off work\", \"no work\", \"cannot work\" \u2192 disability_type: \"TTD\"\n- \"Modified duty\", \"light duty\", \"work restrictions\" \u2192 disability_type: \"TPD\"\n- \"MMI reached\" + rating percentage \u2192 disability_type: \"PPD\"\n\nOUTPUT FORMAT - Return ONLY valid JSON:\n{\n  \"filename\": \"<exact filename>\",\n  \"folder\": \"<folder name>\",\n  \"type\": \"<document_type from list above>\",\n  \"key_info\": \"<2-3 sentence summary of most important information>\",\n  \"has_handwritten_data\": false,\n  \"handwritten_fields\": [],\n  \"extracted_data\": {\n    // Include any specific data points found\n  }\n}\n\nIMPORTANT:\n- Return ONLY the JSON object, no markdown, no explanation\n- For PDFs: prefer the Read tool directly (cross-platform). If needed, run: pdftotext \"filename\" -\n- For all other files: use the Read tool directly\n- If a file cannot be read or parsed, return the JSON with key_info explaining the issue";
// Function to get the appropriate fallback extraction prompt
// Loads from practice-areas module (markdown files) with fallback to hardcoded prompts
function getFileExtractionSystemPromptWithTools(practiceArea) {
    var config = practiceArea === practice_areas_1.PRACTICE_AREAS.WC
        ? practice_areas_1.practiceAreaRegistry.get("WC")
        : practice_areas_1.practiceAreaRegistry.getDefault();
    // Use loaded prompt from markdown file if available, otherwise fall back to hardcoded
    if (config === null || config === void 0 ? void 0 : config.extractionPromptWithTools) {
        return config.extractionPromptWithTools;
    }
    // Fallback to hardcoded prompts during migration
    if (practiceArea === practice_areas_1.PRACTICE_AREAS.WC)
        return WC_EXTRACTION_PROMPT_WITH_TOOLS;
    return PI_EXTRACTION_PROMPT_WITH_TOOLS;
}
// Build synthesis system prompt for JSON output (used with direct API call)
function buildSynthesisSystemPrompt(firmRoot, practiceArea) {
    return __awaiter(this, void 0, void 0, function () {
        var practiceKnowledge, indexSchema, phaseRules, isWC;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, knowledge_1.loadSectionsByIds)(firmRoot, SYNTHESIS_SECTION_IDS)];
                case 1:
                    practiceKnowledge = _a.sent();
                    return [4 /*yield*/, loadIndexSchema()];
                case 2:
                    indexSchema = _a.sent();
                    phaseRules = (0, phase_rules_1.getPhaseRules)(practiceArea);
                    isWC = practiceArea === practice_areas_1.PRACTICE_AREAS.WC;
                    if (isWC) {
                        return [2 /*return*/, "You are a case analyst and summarizer for a Workers' Compensation law firm in Nevada.\n\nYou will receive:\n1. document_index.json - Data extracted from all case documents\n2. hypergraph_analysis.json - Cross-document analysis showing consensus values and conflicts\n\nYOUR JOB: Analyze the case substantively and return a JSON synthesis. Do NOT make any tool calls.\n\n## PRACTICE KNOWLEDGE\n\n".concat(practiceKnowledge, "\n\n## CANONICAL INDEX SCHEMA\n\n").concat(indexSchema, "\n\n## ANALYSIS WORKFLOW:\n\n1. **Case Analysis** \u2014 Using the practice knowledge above, assess:\n   - **Compensability**: Is the claim accepted, denied, or disputed?\n   - **Injury severity**: Body parts affected, surgical vs conservative treatment\n   - **Disability status**: TTD ongoing, TPD, or MMI reached? PPD rating if applicable\n   - **Benefits status**: Are TTD payments current? Any disputes or suspensions?\n   - **Document quality gaps**: What critical documents are missing?\n\n2. Use hypergraph consensus values where available\n\n3. Generate a case summary consolidating:\n   - Contact info into summary.contact\n   - Employer info into summary.employer (name, address, job_title)\n   - WC carrier info into summary.wc_carrier (carrier, claim_number, adjuster)\n   - Disability status into summary.disability_status (type, amw, compensation_rate, mmi_date, ppd_rating)\n\n4. Document ALL judgment calls in \"errata\"\n\n5. Put CRITICAL unresolved conflicts in \"needs_review\"\n\n## CRITICAL: HANDLING HYPERGRAPH CONFLICTS\n\n**MANDATORY needs_review items** - If the hypergraph shows ANY of these, you MUST add to needs_review:\n1. Any field where consensus is \"UNCERTAIN\" - these REQUIRE human decision\n2. Any AMW or compensation rate conflicts\n3. Any date_of_injury conflicts\n4. Any PPD rating conflicts\n\n**You are NOT authorized to resolve UNCERTAIN values.** When hypergraph says consensus: \"UNCERTAIN\", you MUST:\n1. Add it to needs_review with both values and their sources\n2. NOT pick one value to use in the summary\n3. Use \"NEEDS REVIEW\" or leave empty in summary fields\n\n## ERRATA - Document ALL decisions\n\nEvery field you fill in should have an errata entry:\n{\n  \"field\": \"<what field>\",\n  \"decision\": \"<value you used>\",\n  \"evidence\": \"<what the extractions showed>\",\n  \"confidence\": \"high|medium|low\"\n}\n\n## PHASE RULES:\n").concat(Object.entries(phaseRules).map(function (_a) {
                                var phase = _a[0], desc = _a[1];
                                return "- ".concat(phase, ": ").concat(desc);
                            }).join('\n'), "\n\n## OUTPUT FORMAT\n\nReturn a JSON object with these fields:\n- needs_review: Array of conflicts requiring human review\n- errata: Array of documented decisions\n- case_analysis: String with substantive analysis (compensability, injury severity, disability status, benefits status, gaps, next steps)\n- compensability_status: \"accepted\" | \"denied\" | \"disputed\"\n- disability_type: \"ttd\" | \"tpd\" | \"ppd\" | \"ptd\"\n- summary: Object with:\n  - client: Claimant name\n  - doi: Date of injury (MM-DD-YYYY)\n  - dob: Date of birth\n  - providers: Array of provider names (strings)\n  - total_charges: Total medical charges\n  - employer: { name, address, job_title }\n  - wc_carrier: { carrier, claim_number, adjuster }\n  - disability_status: { type, amw, compensation_rate, mmi_date, ppd_rating }\n  - contact: { phone, email, address }\n  - case_summary: Brief narrative summary\n- case_name: e.g. \"LASTNAME, Firstname\"\n- case_phase: One of Intake, Investigation, Treatment, MMI Evaluation, Benefits Resolution, Settlement/Hearing, Closed\n- open_hearings: Array of { case_number, hearing_level (\"H.O.\" or \"A.O.\"), next_date, issue }. Use \"A.O.\" if any Appeals Officer documents/decisions exist, otherwise default to \"H.O.\"\n\n**IMPORTANT**: You MUST include needs_review and errata arrays. Empty arrays only if truly zero conflicts.")];
                    }
                    // Personal Injury synthesis prompt (default)
                    return [2 /*return*/, "You are a case analyst and summarizer for a Personal Injury law firm in Nevada.\n\nYou will receive:\n1. document_index.json - Data extracted by Haiku from all case documents\n2. hypergraph_analysis.json - Cross-document analysis showing consensus values and conflicts\n\nYOUR JOB: Analyze the case substantively and return a JSON synthesis. Do NOT make any tool calls.\n\n## PRACTICE KNOWLEDGE\n\n".concat(practiceKnowledge, "\n\n## CANONICAL INDEX SCHEMA\n\n**CRITICAL SCHEMA REQUIREMENTS:**\n- `summary.providers` MUST be an array of strings: `[\"Provider A\", \"Provider B\"]` \u2014 NOT objects\n- `summary.policy_limits` MUST use keys `1P` and `3P` \u2014 NOT \"first_party\"/\"third_party\"\n- `summary.claim_numbers` MUST use keys like `1P_CarrierName` and `3P_CarrierName` \u2014 NOT \"first_party_carrier\"\n\n").concat(indexSchema, "\n\n## ANALYSIS WORKFLOW:\n\n1. **Case Analysis** \u2014 Using the practice knowledge above, assess:\n   - **Liability strength**: clear / moderate / contested (with reasoning)\n   - **Injury tier**: Tier 1 (soft tissue) / Tier 2 (structural) / Tier 3 (surgical) based on treatment and findings\n   - **Estimated value range**: Apply the multiplier for the injury tier against total specials\n   - **Policy limits demand appropriate?**: Yes/No based on Section IV triggers\n   - **Document quality gaps**: What critical documents are missing?\n\n2. Use hypergraph consensus values where available\n\n3. Generate a case summary consolidating:\n   - Contact info into summary.contact\n   - Health insurance into summary.health_insurance\n   - Claim numbers into summary.claim_numbers (use 1P_CarrierName, 3P_CarrierName format)\n\n4. Document ALL judgment calls in \"errata\"\n\n5. Put CRITICAL unresolved conflicts in \"needs_review\"\n\n## CRITICAL: HANDLING HYPERGRAPH CONFLICTS\n\n**MANDATORY needs_review items** - If the hypergraph shows ANY of these, you MUST add to needs_review:\n1. Any field where consensus is \"UNCERTAIN\" - these REQUIRE human decision\n2. Any charges/balances with conflicting values (even if one looks \"newer\")\n3. Any date_of_loss conflicts (affects statute of limitations)\n4. Any policy_limits conflicts\n\n**You are NOT authorized to resolve UNCERTAIN values.** When hypergraph says consensus: \"UNCERTAIN\", you MUST:\n1. Add it to needs_review with both values and their sources\n2. NOT pick one value to use in the summary\n3. Use \"NEEDS REVIEW\" or leave empty in summary fields\n\n## ERRATA - Document ALL decisions\n\nEvery field you fill in should have an errata entry:\n{\n  \"field\": \"<what field>\",\n  \"decision\": \"<value you used>\",\n  \"evidence\": \"<what the extractions showed>\",\n  \"confidence\": \"high|medium|low\"\n}\n\n## PHASE RULES:\n").concat(Object.entries(phaseRules).map(function (_a) {
                            var phase = _a[0], desc = _a[1];
                            return "- ".concat(phase, ": ").concat(desc);
                        }).join('\n'), "\n\n## OUTPUT FORMAT\n\nReturn a JSON object with these fields:\n- needs_review: Array of conflicts requiring human review\n- errata: Array of documented decisions\n- case_analysis: String with substantive analysis (liability, injury tier, value, gaps, next steps)\n- liability_assessment: \"clear\" | \"moderate\" | \"contested\"\n- injury_tier: \"tier_1_soft_tissue\" | \"tier_2_structural\" | \"tier_3_surgical\"\n- estimated_value_range: e.g. \"$37,500 - $62,500\"\n- policy_limits_demand_appropriate: true | false\n- summary: Object with client, dol, dob, providers (array of strings), total_charges, policy_limits, contact, health_insurance, claim_numbers, case_summary\n- case_name: e.g. \"LASTNAME, Firstname\"\n- case_phase: One of Intake, Investigation, Treatment, Demand, Negotiation, Settlement, Complete\n\n**IMPORTANT**: You MUST include needs_review and errata arrays. Empty arrays only if truly zero conflicts.")];
            }
        });
    });
}
function normalizeFolders(input) {
    var normalized = {};
    if (!input || typeof input !== "object")
        return normalized;
    for (var _i = 0, _a = Object.entries(input); _i < _a.length; _i++) {
        var _b = _a[_i], folderName = _b[0], folderData = _b[1];
        if (Array.isArray(folderData)) {
            normalized[folderName] = { files: __spreadArray([], folderData, true) };
            continue;
        }
        if (folderData && typeof folderData === "object") {
            var files = folderData.files;
            if (Array.isArray(files)) {
                normalized[folderName] = { files: __spreadArray([], files, true) };
                continue;
            }
            var documents = folderData.documents;
            if (Array.isArray(documents)) {
                normalized[folderName] = { files: __spreadArray([], documents, true) };
                continue;
            }
        }
        normalized[folderName] = { files: [] };
    }
    return normalized;
}
function normalizeDateToIso(value) {
    if (typeof value !== "string")
        return null;
    var trimmed = value.trim();
    if (!trimmed)
        return null;
    var parsed = (0, date_format_1.parseFlexibleDate)(trimmed);
    if (!parsed)
        return null;
    return (0, date_format_1.formatDateYYYYMMDD)(parsed);
}
function inferDateFromFilename(filename) {
    var ymd = filename.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/);
    if (ymd) {
        var year = parseInt(ymd[1], 10);
        var month = parseInt(ymd[2], 10);
        var day = parseInt(ymd[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return "".concat(year.toString().padStart(4, "0"), "-").concat(month.toString().padStart(2, "0"), "-").concat(day.toString().padStart(2, "0"));
        }
    }
    var mdy = filename.match(/(\d{1,2})[-_](\d{1,2})[-_](20\d{2})/);
    if (mdy) {
        var month = parseInt(mdy[1], 10);
        var day = parseInt(mdy[2], 10);
        var year = parseInt(mdy[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return "".concat(year.toString().padStart(4, "0"), "-").concat(month.toString().padStart(2, "0"), "-").concat(day.toString().padStart(2, "0"));
        }
    }
    return null;
}
function isSignatureOnlyHandwrittenField(value) {
    var normalized = value
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
    if (!normalized)
        return false;
    return (/\bsignature\b/.test(normalized) ||
        /\bsigned by\b/.test(normalized) ||
        /\bsigned\b/.test(normalized) ||
        /\bsigner\b/.test(normalized) ||
        /\binitials?\b/.test(normalized) ||
        normalized === "sign");
}
function normalizeHandwrittenFields(value) {
    if (!Array.isArray(value))
        return [];
    var seen = new Set();
    var normalized = [];
    for (var _i = 0, value_1 = value; _i < value_1.length; _i++) {
        var item = value_1[_i];
        if (typeof item !== "string")
            continue;
        var field = item.trim();
        if (!field)
            continue;
        if (isSignatureOnlyHandwrittenField(field))
            continue;
        var key = field.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        normalized.push(field);
    }
    return normalized;
}
function resolveHandwritingMetadata(extraction) {
    var handwrittenFields = normalizeHandwrittenFields(extraction.handwritten_fields);
    var hasHandwrittenData = handwrittenFields.length > 0;
    if (!hasHandwrittenData) {
        return {
            hasHandwrittenData: false,
            handwrittenFields: [],
        };
    }
    var issue = handwrittenFields.length > 0
        ? "Contains handwritten extracted values in fields: ".concat(handwrittenFields.join(", "), ".")
        : "Contains handwritten extracted values. Review extracted data.";
    return {
        hasHandwrittenData: true,
        handwrittenFields: handwrittenFields,
        issue: issue,
    };
}
function resolveDocumentDate(extraction) {
    var extractedData = extraction.extracted_data;
    var explicitDate = normalizeDateToIso(extractedData === null || extractedData === void 0 ? void 0 : extractedData.document_date);
    var confidenceRaw = typeof (extractedData === null || extractedData === void 0 ? void 0 : extractedData.document_date_confidence) === "string"
        ? extractedData.document_date_confidence.trim().toLowerCase()
        : "";
    var reason = typeof (extractedData === null || extractedData === void 0 ? void 0 : extractedData.document_date_reason) === "string"
        ? extractedData.document_date_reason.trim()
        : "";
    if (explicitDate) {
        if (confidenceRaw === "low" || confidenceRaw === "unknown") {
            var reasonSuffix = reason ? " Reason: ".concat(reason) : "";
            return {
                date: explicitDate,
                issue: "Document date extracted with ".concat(confidenceRaw, " confidence.").concat(reasonSuffix),
            };
        }
        return { date: explicitDate };
    }
    var inferredFromName = inferDateFromFilename(extraction.filename);
    if (inferredFromName) {
        return {
            date: inferredFromName,
            issue: "Document date not explicitly extracted from document text; inferred from filename. Verify manually.",
        };
    }
    return {
        issue: "Document date extraction failed: no reliable document date was identified. Review this file.",
    };
}
function classifyFile(caseFolder, filePath, yearModeInfo) {
    return __awaiter(this, void 0, void 0, function () {
        var filename, isPdf, isImage, rawFolder, folder, fullPath, firmRoot, registry, slug, fileSizeMB, fileStats, _a, extractedText, useText, _b, MAX_CHARS;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    filename = filePath.split('/').pop() || filePath;
                    isPdf = filename.toLowerCase().endsWith(".pdf");
                    isImage = (0, extract_1.isImageFile)(filename);
                    rawFolder = (0, path_1.dirname)(filePath).replace(/\\/g, '/');
                    folder = rawFolder === '.' ? '.' : rawFolder;
                    if (yearModeInfo) {
                        firmRoot = yearModeInfo.firmRoot, registry = yearModeInfo.registry, slug = yearModeInfo.slug;
                        fullPath = (0, year_mode_1.resolveYearFilePath)(firmRoot, registry, slug, filePath);
                    }
                    else {
                        fullPath = (0, path_1.join)(caseFolder, filePath);
                    }
                    fileSizeMB = 0;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.stat)(fullPath)];
                case 2:
                    fileStats = _c.sent();
                    fileSizeMB = fileStats.size / (1024 * 1024);
                    return [3 /*break*/, 4];
                case 3:
                    _a = _c.sent();
                    // File not found — will be caught during extraction
                    return [2 /*return*/, {
                            filePath: filePath,
                            filename: filename,
                            folder: folder,
                            fullPath: fullPath,
                            useText: false,
                            isPdf: isPdf,
                            isImage: isImage,
                            extractedText: '',
                            fileSizeMB: 0
                        }];
                case 4:
                    extractedText = '';
                    useText = false;
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, (0, extract_1.extractTextFromFile)(fullPath)];
                case 6:
                    extractedText = _c.sent();
                    useText = extractedText.length > 50 &&
                        !extractedText.startsWith('[Could not') &&
                        !extractedText.startsWith('[Binary file');
                    return [3 /*break*/, 8];
                case 7:
                    _b = _c.sent();
                    return [3 /*break*/, 8];
                case 8:
                    MAX_CHARS = 15000;
                    if (useText && extractedText.length > MAX_CHARS) {
                        extractedText = extractedText.slice(0, MAX_CHARS) + '\n\n[... truncated ...]';
                    }
                    return [2 /*return*/, { filePath: filePath, filename: filename, folder: folder, fullPath: fullPath, useText: useText, isPdf: isPdf, isImage: isImage, extractedText: extractedText, fileSizeMB: fileSizeMB }];
            }
        });
    });
}
// ============================================================================
// Text extraction: GPT-OSS 120B (Path 1)
// ============================================================================
function extractFileText(classified, fileIndex, totalFiles, practiceArea, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var filename, folder, fullPath, extractedText, startTime, result, usage, groqResult, handwrittenFields, hasHandwrittenData, apiErr_1, elapsed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    filename = classified.filename, folder = classified.folder, fullPath = classified.fullPath, extractedText = classified.extractedText;
                    startTime = Date.now();
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ type: "file_start", fileIndex: fileIndex, totalFiles: totalFiles, filename: filename, folder: folder });
                    result = {
                        filename: filename,
                        folder: folder,
                        type: 'other',
                        key_info: '',
                        has_handwritten_data: false,
                        handwritten_fields: [],
                    };
                    usage = {
                        inputTokens: 0,
                        inputTokensNew: 0,
                        inputTokensCacheWrite: 0,
                        inputTokensCacheRead: 0,
                        outputTokens: 0,
                        apiCalls: 0,
                        model: 'groq'
                    };
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, groq_extract_1.extractWithGptOss)(extractedText, filename, folder, getFileExtractionSystemPrompt(practiceArea))];
                case 2:
                    groqResult = _a.sent();
                    handwrittenFields = normalizeHandwrittenFields(groqResult.result.handwritten_fields);
                    hasHandwrittenData = handwrittenFields.length > 0;
                    result = {
                        filename: filename,
                        folder: folder,
                        type: groqResult.result.type || 'other',
                        key_info: groqResult.result.key_info || '',
                        has_handwritten_data: hasHandwrittenData,
                        handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
                        extracted_data: groqResult.result.extracted_data,
                    };
                    usage.inputTokens = groqResult.usage.inputTokens;
                    usage.inputTokensNew = groqResult.usage.inputTokens;
                    usage.outputTokens = groqResult.usage.outputTokens;
                    usage.apiCalls = 1;
                    return [3 /*break*/, 4];
                case 3:
                    apiErr_1 = _a.sent();
                    console.error("[".concat(fileIndex + 1, "/").concat(totalFiles, "] GPT-OSS error for ").concat(filename, ":"), apiErr_1);
                    result.key_info = "Extraction failed: ".concat(apiErr_1 instanceof Error ? apiErr_1.message : String(apiErr_1));
                    result.error = apiErr_1 instanceof Error ? apiErr_1.message : String(apiErr_1);
                    return [3 /*break*/, 4];
                case 4:
                    result.usage = usage;
                    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log("[".concat(fileIndex + 1, "/").concat(totalFiles, "] \u2713 Done: ").concat(filename, " (").concat(elapsed, "s) - ").concat(result.type, " [groq-gpt-oss]"));
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({
                        type: "file_done",
                        fileIndex: fileIndex,
                        totalFiles: totalFiles,
                        filename: filename,
                        folder: folder,
                        docType: result.type,
                        extractionMethod: 'groq-gpt-oss',
                        elapsed: parseFloat(elapsed)
                    });
                    return [2 /*return*/, result];
            }
        });
    });
}
// ============================================================================
// Vision extraction: Scout → Maverick fallback (Path 2)
// ============================================================================
function extractFileVision(classified, fileIndex, totalFiles, practiceArea, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var filename, folder, fullPath, isPdf, isImage, startTime, usage, result, _a, elapsed_1, elapsed_2, groqResult, _b, handwrittenFields, hasHandwrittenData, visionErr_1, elapsed;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    filename = classified.filename, folder = classified.folder, fullPath = classified.fullPath, isPdf = classified.isPdf, isImage = classified.isImage;
                    startTime = Date.now();
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ type: "file_start", fileIndex: fileIndex, totalFiles: totalFiles, filename: filename, folder: folder });
                    usage = {
                        inputTokens: 0,
                        inputTokensNew: 0,
                        inputTokensCacheWrite: 0,
                        inputTokensCacheRead: 0,
                        outputTokens: 0,
                        apiCalls: 0,
                        model: 'groq'
                    };
                    result = {
                        filename: filename,
                        folder: folder,
                        type: 'other',
                        key_info: 'Skipped: vision supports PDF and image files only',
                        has_handwritten_data: false,
                        handwritten_fields: [],
                        error: 'SKIPPED_NON_VISUAL',
                    };
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.stat)(fullPath)];
                case 2:
                    _c.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _c.sent();
                    elapsed_1 = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.error("[".concat(fileIndex + 1, "/").concat(totalFiles, "] \u2717 File not found: ").concat(filename, " (").concat(elapsed_1, "s)"));
                    return [2 /*return*/, {
                            filename: filename,
                            folder: folder,
                            type: 'other',
                            key_info: 'File not found or inaccessible',
                            has_handwritten_data: false,
                            handwritten_fields: [],
                            error: "File not found: ".concat(fullPath),
                            usage: usage,
                        }];
                case 4:
                    console.log("[".concat(fileIndex + 1, "/").concat(totalFiles, "] [groq-vision] ").concat(filename));
                    if (!isPdf && !isImage) {
                        console.log("[Vision] Skipping ".concat(filename, ": not a PDF or image"));
                        result.usage = usage;
                        elapsed_2 = ((Date.now() - startTime) / 1000).toFixed(1);
                        console.log("[".concat(fileIndex + 1, "/").concat(totalFiles, "] \u2713 Done: ").concat(filename, " (").concat(elapsed_2, "s) - ").concat(result.type, " [groq-vision]"));
                        onProgress === null || onProgress === void 0 ? void 0 : onProgress({
                            type: "file_done",
                            fileIndex: fileIndex,
                            totalFiles: totalFiles,
                            filename: filename,
                            folder: folder,
                            docType: result.type,
                            extractionMethod: 'groq-vision',
                            elapsed: parseFloat(elapsed_2),
                            skipped: true,
                        });
                        return [2 /*return*/, result];
                    }
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 10, , 11]);
                    if (!isImage) return [3 /*break*/, 7];
                    return [4 /*yield*/, (0, groq_extract_1.extractImageFileWithVision)(fullPath, filename, folder, getFileExtractionSystemPrompt(practiceArea))];
                case 6:
                    _b = _c.sent();
                    return [3 /*break*/, 9];
                case 7: return [4 /*yield*/, (0, groq_extract_1.extractWithVision)(fullPath, filename, folder, classified.fileSizeMB, getFileExtractionSystemPrompt(practiceArea))];
                case 8:
                    _b = _c.sent();
                    _c.label = 9;
                case 9:
                    groqResult = _b;
                    handwrittenFields = normalizeHandwrittenFields(groqResult.result.handwritten_fields);
                    hasHandwrittenData = handwrittenFields.length > 0;
                    result = {
                        filename: filename,
                        folder: folder,
                        type: groqResult.result.type || 'other',
                        key_info: groqResult.result.key_info || '',
                        has_handwritten_data: hasHandwrittenData,
                        handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
                        extracted_data: groqResult.result.extracted_data,
                    };
                    usage.inputTokens = groqResult.usage.inputTokens;
                    usage.inputTokensNew = groqResult.usage.inputTokens;
                    usage.outputTokens = groqResult.usage.outputTokens;
                    usage.apiCalls = 1;
                    return [3 /*break*/, 11];
                case 10:
                    visionErr_1 = _c.sent();
                    console.error("[".concat(fileIndex + 1, "/").concat(totalFiles, "] Vision error for ").concat(filename, ":"), visionErr_1);
                    result.key_info = "Extraction failed: ".concat(visionErr_1 instanceof Error ? visionErr_1.message : String(visionErr_1));
                    result.error = visionErr_1 instanceof Error ? visionErr_1.message : String(visionErr_1);
                    return [3 /*break*/, 11];
                case 11:
                    result.usage = usage;
                    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log("[".concat(fileIndex + 1, "/").concat(totalFiles, "] \u2713 Done: ").concat(filename, " (").concat(elapsed, "s) - ").concat(result.type, " [groq-vision]"));
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({
                        type: "file_done",
                        fileIndex: fileIndex,
                        totalFiles: totalFiles,
                        filename: filename,
                        folder: folder,
                        docType: result.type,
                        extractionMethod: 'groq-vision',
                        elapsed: parseFloat(elapsed)
                    });
                    return [2 /*return*/, result];
            }
        });
    });
}
// Sonnet synthesizes case summary from extracted data using single-turn structured output
function synthesizeCaseSummary(caseFolder, conflictCount, firmRoot, practiceArea) {
    return __awaiter(this, void 0, void 0, function () {
        var startTime, indexDir, indexPath, hypergraphPath, usage, _a, documentIndexContent, hypergraphContent, synthesisSystemPrompt, response, toolBlock, synthesis, existingIndex, isWC, merged, err_2, elapsed;
        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        return __generator(this, function (_t) {
            switch (_t.label) {
                case 0:
                    console.log("\n========== SONNET SYNTHESIS (Single-Turn) ==========");
                    console.log("[Sonnet] Case folder: ".concat(caseFolder));
                    console.log("[Sonnet] Conflicts detected: ".concat(conflictCount));
                    startTime = Date.now();
                    indexDir = (0, path_1.join)(caseFolder, '.ai_tool');
                    indexPath = (0, path_1.join)(indexDir, 'document_index.json');
                    hypergraphPath = (0, path_1.join)(indexDir, 'hypergraph_analysis.json');
                    usage = {
                        inputTokens: 0,
                        inputTokensNew: 0,
                        inputTokensCacheWrite: 0,
                        inputTokensCacheRead: 0,
                        outputTokens: 0,
                        apiCalls: 0,
                        model: 'sonnet'
                    };
                    _t.label = 1;
                case 1:
                    _t.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, Promise.all([
                            (0, promises_1.readFile)(indexPath, 'utf-8'),
                            (0, promises_1.readFile)(hypergraphPath, 'utf-8')
                        ])];
                case 2:
                    _a = _t.sent(), documentIndexContent = _a[0], hypergraphContent = _a[1];
                    console.log("[Sonnet] Read index (".concat(documentIndexContent.length, " chars) and hypergraph (").concat(hypergraphContent.length, " chars)"));
                    return [4 /*yield*/, buildSynthesisSystemPrompt(firmRoot, practiceArea)];
                case 3:
                    synthesisSystemPrompt = _t.sent();
                    return [4 /*yield*/, getClient().messages.create({
                            model: "claude-sonnet-4-5-20250929",
                            max_tokens: 16000,
                            system: synthesisSystemPrompt,
                            messages: [{
                                    role: "user",
                                    content: "<hypergraph_analysis>\n".concat(hypergraphContent, "\n</hypergraph_analysis>\n\n<document_index>\n").concat(documentIndexContent, "\n</document_index>\n\nAnalyze the case and use the case_synthesis tool to return your synthesis.")
                                }],
                            tools: [{
                                    name: "case_synthesis",
                                    description: "Output the synthesized case analysis with all required fields",
                                    input_schema: getSynthesisSchema(practiceArea)
                                }],
                            tool_choice: { type: "tool", name: "case_synthesis" }
                        })];
                case 4:
                    response = _t.sent();
                    // Step 4: Extract usage stats
                    usage.inputTokensNew = response.usage.input_tokens || 0;
                    usage.inputTokensCacheWrite = response.usage.cache_creation_input_tokens || 0;
                    usage.inputTokensCacheRead = response.usage.cache_read_input_tokens || 0;
                    usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
                    usage.outputTokens = response.usage.output_tokens || 0;
                    usage.apiCalls = 1;
                    toolBlock = response.content.find(function (block) { return block.type === 'tool_use'; });
                    if (!toolBlock || toolBlock.type !== 'tool_use') {
                        throw new Error('No tool use response from synthesis API');
                    }
                    synthesis = toolBlock.input;
                    console.log("[Sonnet] Parsed synthesis with ".concat(((_b = synthesis.needs_review) === null || _b === void 0 ? void 0 : _b.length) || 0, " review items, ").concat(((_c = synthesis.errata) === null || _c === void 0 ? void 0 : _c.length) || 0, " errata entries"));
                    existingIndex = JSON.parse(documentIndexContent);
                    isWC = practiceArea === practice_areas_1.PRACTICE_AREAS.WC;
                    merged = __assign(__assign({}, existingIndex), { 
                        // Common fields
                        needs_review: synthesis.needs_review || [], errata: synthesis.errata || [], case_analysis: synthesis.case_analysis || '', case_name: synthesis.case_name || existingIndex.case_name, case_phase: synthesis.case_phase || existingIndex.case_phase, 
                        // Deep merge summary, preserving folders structure
                        summary: __assign(__assign(__assign({}, existingIndex.summary), synthesis.summary), { 
                            // Ensure providers is an array of strings (flatten if needed)
                            providers: Array.isArray((_d = synthesis.summary) === null || _d === void 0 ? void 0 : _d.providers)
                                ? synthesis.summary.providers.map(function (p) { return typeof p === 'string' ? p : p.name || String(p); })
                                : ((_e = existingIndex.summary) === null || _e === void 0 ? void 0 : _e.providers) || [] }) });
                    // Practice-area-specific assessment fields
                    if (isWC) {
                        // WC fields
                        merged.compensability = synthesis.compensability || null;
                        merged.claim_type = synthesis.claim_type || null;
                        merged.estimated_ttd_weeks = (_f = synthesis.estimated_ttd_weeks) !== null && _f !== void 0 ? _f : null;
                        merged.estimated_ppd_rating = (_g = synthesis.estimated_ppd_rating) !== null && _g !== void 0 ? _g : null;
                        merged.third_party_potential = (_h = synthesis.third_party_potential) !== null && _h !== void 0 ? _h : null;
                        // Ensure WC summary sub-objects are properly merged
                        if ((_j = synthesis.summary) === null || _j === void 0 ? void 0 : _j.employer) {
                            merged.summary.employer = synthesis.summary.employer;
                        }
                        if ((_k = synthesis.summary) === null || _k === void 0 ? void 0 : _k.wc_carrier) {
                            merged.summary.wc_carrier = synthesis.summary.wc_carrier;
                        }
                        if ((_l = synthesis.summary) === null || _l === void 0 ? void 0 : _l.disability_status) {
                            merged.summary.disability_status = synthesis.summary.disability_status;
                        }
                        if ((_m = synthesis.summary) === null || _m === void 0 ? void 0 : _m.job_title) {
                            merged.summary.job_title = synthesis.summary.job_title;
                        }
                        if ((_o = synthesis.summary) === null || _o === void 0 ? void 0 : _o.injury_description) {
                            merged.summary.injury_description = synthesis.summary.injury_description;
                        }
                        if ((_p = synthesis.summary) === null || _p === void 0 ? void 0 : _p.body_parts) {
                            merged.summary.body_parts = synthesis.summary.body_parts;
                        }
                        // Use doi for WC incident date
                        if ((_q = synthesis.summary) === null || _q === void 0 ? void 0 : _q.doi) {
                            merged.summary.incident_date = synthesis.summary.doi;
                        }
                        // Open hearings from synthesis
                        if (Array.isArray(synthesis.open_hearings) && synthesis.open_hearings.length > 0) {
                            merged.open_hearings = synthesis.open_hearings;
                        }
                    }
                    else {
                        // PI fields
                        merged.liability_assessment = synthesis.liability_assessment || null;
                        merged.injury_tier = synthesis.injury_tier || null;
                        merged.estimated_value_range = synthesis.estimated_value_range || null;
                        merged.policy_limits_demand_appropriate = (_r = synthesis.policy_limits_demand_appropriate) !== null && _r !== void 0 ? _r : null;
                        // Use dol for PI incident date
                        if ((_s = synthesis.summary) === null || _s === void 0 ? void 0 : _s.dol) {
                            merged.summary.incident_date = synthesis.summary.dol;
                        }
                    }
                    return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(merged, null, 2))];
                case 5:
                    _t.sent();
                    return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(caseFolder, merged)];
                case 6:
                    _t.sent();
                    console.log("[Sonnet] Wrote merged index to ".concat(indexPath));
                    return [3 /*break*/, 8];
                case 7:
                    err_2 = _t.sent();
                    console.error("[Sonnet] Synthesis error:", err_2);
                    // Re-throw so caller can handle
                    throw err_2;
                case 8:
                    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log("[Sonnet] Done in ".concat(elapsed, "s. Usage: ").concat(usage.inputTokens.toLocaleString(), " in / ").concat(usage.outputTokens.toLocaleString(), " out"));
                    console.log("==========================================\n");
                    return [2 /*return*/, usage];
            }
        });
    });
}
// List all indexable files in a case folder
function listCaseFiles(caseFolder, options) {
    return __awaiter(this, void 0, void 0, function () {
        function walkDir(dir_1) {
            return __awaiter(this, arguments, void 0, function (dir, base) {
                var entries, _i, entries_2, entry, fullPath, relativePath;
                if (base === void 0) { base = ''; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                        case 1:
                            entries = _a.sent();
                            _i = 0, entries_2 = entries;
                            _a.label = 2;
                        case 2:
                            if (!(_i < entries_2.length)) return [3 /*break*/, 6];
                            entry = entries_2[_i];
                            // Skip .ai_tool entirely
                            if (entry.name === '.ai_tool')
                                return [3 /*break*/, 5];
                            fullPath = (0, path_1.join)(dir, entry.name);
                            relativePath = base ? "".concat(base, "/").concat(entry.name) : entry.name;
                            if (!entry.isDirectory()) return [3 /*break*/, 4];
                            return [4 /*yield*/, walkDir(fullPath, relativePath)];
                        case 3:
                            _a.sent();
                            return [3 /*break*/, 5];
                        case 4:
                            files.push(relativePath);
                            _a.label = 5;
                        case 5:
                            _i++;
                            return [3 /*break*/, 2];
                        case 6: return [2 /*return*/];
                    }
                });
            });
        }
        var _a, firmRoot, folders, allFiles, _loop_2, _i, folders_1, relFolder, files;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(options === null || options === void 0 ? void 0 : options.sourceFolders)) return [3 /*break*/, 5];
                    _a = options.sourceFolders, firmRoot = _a.firmRoot, folders = _a.folders;
                    console.log("[listCaseFiles] year-mode: firmRoot=".concat(firmRoot, ", folders=").concat(JSON.stringify(folders)));
                    allFiles = [];
                    _loop_2 = function (relFolder) {
                        function walkSourceDir(dir_1) {
                            return __awaiter(this, arguments, void 0, function (dir, base) {
                                var entries, err_3, _i, entries_3, entry, fullPath, relativePath;
                                if (base === void 0) { base = ''; }
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            _a.trys.push([0, 2, , 3]);
                                            return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                                        case 1:
                                            entries = _a.sent();
                                            return [3 /*break*/, 3];
                                        case 2:
                                            err_3 = _a.sent();
                                            console.error("[listCaseFiles] readdir failed for ".concat(dir, ":"), err_3);
                                            return [2 /*return*/];
                                        case 3:
                                            _i = 0, entries_3 = entries;
                                            _a.label = 4;
                                        case 4:
                                            if (!(_i < entries_3.length)) return [3 /*break*/, 8];
                                            entry = entries_3[_i];
                                            if (entry.name === '.ai_tool' || entry.name.startsWith('.'))
                                                return [3 /*break*/, 7];
                                            fullPath = (0, path_1.join)(dir, entry.name);
                                            relativePath = base ? "".concat(base, "/").concat(entry.name) : entry.name;
                                            if (!entry.isDirectory()) return [3 /*break*/, 6];
                                            return [4 /*yield*/, walkSourceDir(fullPath, relativePath)];
                                        case 5:
                                            _a.sent();
                                            return [3 /*break*/, 7];
                                        case 6:
                                            files_1.push("".concat(yearPrefix, "/").concat(relativePath));
                                            _a.label = 7;
                                        case 7:
                                            _i++;
                                            return [3 /*break*/, 4];
                                        case 8: return [2 /*return*/];
                                    }
                                });
                            });
                        }
                        var absFolder, yearPrefix, files_1;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    absFolder = (0, path_1.join)(firmRoot, relFolder);
                                    yearPrefix = relFolder.split("/")[0];
                                    files_1 = [];
                                    return [4 /*yield*/, walkSourceDir(absFolder)];
                                case 1:
                                    _c.sent();
                                    console.log("[listCaseFiles] ".concat(relFolder, " \u2192 ").concat(files_1.length, " files"));
                                    allFiles.push.apply(allFiles, files_1);
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, folders_1 = folders;
                    _b.label = 1;
                case 1:
                    if (!(_i < folders_1.length)) return [3 /*break*/, 4];
                    relFolder = folders_1[_i];
                    return [5 /*yield**/, _loop_2(relFolder)];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    console.log("[listCaseFiles] total: ".concat(allFiles.length, " files"));
                    return [2 /*return*/, allFiles];
                case 5:
                    files = [];
                    return [4 /*yield*/, walkDir(caseFolder)];
                case 6:
                    _b.sent();
                    return [2 /*return*/, files];
            }
        });
    });
}
// =============================================================================
// DOI CONTAINER DETECTION (for WC multi-injury clients)
// =============================================================================
/**
 * DOI folder pattern: DOI_YYYY-MM-DD (e.g., DOI_2024-01-15)
 */
var DOI_FOLDER_PATTERN = /^DOI_(\d{4}-\d{2}-\d{2})$/;
/**
 * Parse a DOI folder name to extract the date of injury.
 * Returns the date string (YYYY-MM-DD) or null if not a valid DOI folder.
 */
function parseDOIFolderName(name) {
    var match = name.match(DOI_FOLDER_PATTERN);
    if (match) {
        return { date: match[1] };
    }
    return null;
}
/**
 * Detect if a folder contains DOI subfolders (making it a client container).
 * Returns:
 * - isContainer: true if any DOI_* folders found
 * - doiCases: array of { path, name, dateOfInjury } for each DOI folder
 * - sharedFolders: non-DOI folders (for container indexing)
 */
function detectDOISubfolders(folderPath) {
    return __awaiter(this, void 0, void 0, function () {
        var result, entries, _i, entries_4, entry, parsed, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    result = {
                        isContainer: false,
                        doiCases: [],
                        sharedFolders: [],
                    };
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readdir)(folderPath, { withFileTypes: true })];
                case 2:
                    entries = _b.sent();
                    for (_i = 0, entries_4 = entries; _i < entries_4.length; _i++) {
                        entry = entries_4[_i];
                        if (!entry.isDirectory())
                            continue;
                        if (entry.name === '.ai_tool')
                            continue;
                        parsed = parseDOIFolderName(entry.name);
                        if (parsed) {
                            // This is a DOI folder
                            result.doiCases.push({
                                path: (0, path_1.join)(folderPath, entry.name),
                                name: entry.name,
                                dateOfInjury: parsed.date,
                            });
                        }
                        else if (!entry.name.startsWith('.')) {
                            // Non-DOI, non-hidden folder (shared client info like "General Contact Info")
                            result.sharedFolders.push(entry.name);
                        }
                    }
                    result.isContainer = result.doiCases.length > 0;
                    // Sort DOI cases by date (most recent first)
                    result.doiCases.sort(function (a, b) { return b.dateOfInjury.localeCompare(a.dateOfInjury); });
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, result];
            }
        });
    });
}
/**
 * Index a container's shared folders (non-DOI folders like "General Contact Info").
 * Extracts shared client contact info and writes to container_info.json.
 */
function indexContainer(containerPath, sharedFolders, doiCases, practiceArea, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var containerName, piToolDir, containerInfoPath, existingInfo, existing, _a, containerInfo, err_4, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    containerName = containerPath.split('/').pop() || containerPath;
                    piToolDir = (0, path_1.join)(containerPath, '.ai_tool');
                    containerInfoPath = (0, path_1.join)(piToolDir, 'container_info.json');
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ type: "status", message: "Indexing container: ".concat(containerName) });
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 8, , 9]);
                    return [4 /*yield*/, (0, promises_1.mkdir)(piToolDir, { recursive: true })];
                case 2:
                    _b.sent();
                    existingInfo = null;
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, (0, promises_1.readFile)(containerInfoPath, 'utf-8')];
                case 4:
                    existing = _b.sent();
                    existingInfo = JSON.parse(existing);
                    return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    return [3 /*break*/, 6];
                case 6:
                    containerInfo = {
                        clientName: containerName,
                        practiceArea: practiceArea === practice_areas_1.PRACTICE_AREAS.WC || practiceArea === "WC"
                            ? practice_areas_1.PRACTICE_AREAS.WC
                            : undefined,
                        contact: existingInfo === null || existingInfo === void 0 ? void 0 : existingInfo.contact, // Preserve existing contact if we have it
                        sharedFolders: sharedFolders,
                        doiCases: doiCases.map(function (dc) { return ({
                            path: dc.path,
                            dateOfInjury: dc.dateOfInjury,
                            indexed: false, // Will be updated when DOI cases are indexed
                        }); }),
                        createdAt: (existingInfo === null || existingInfo === void 0 ? void 0 : existingInfo.createdAt) || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    // Write container info
                    return [4 /*yield*/, (0, promises_1.writeFile)(containerInfoPath, JSON.stringify(containerInfo, null, 2))];
                case 7:
                    // Write container info
                    _b.sent();
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ type: "status", message: "Container info written: ".concat(containerName) });
                    return [2 /*return*/, { success: true, containerInfo: containerInfo }];
                case 8:
                    err_4 = _b.sent();
                    error = err_4 instanceof Error ? err_4.message : String(err_4);
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ type: "error", message: "Failed to index container: ".concat(error) });
                    return [2 /*return*/, { success: false, error: error }];
                case 9: return [2 /*return*/];
            }
        });
    });
}
// Discover dot-prefixed subfolders that represent linked cases (e.g., .ClientB Spouse)
function discoverSubcases(casePath) {
    return __awaiter(this, void 0, void 0, function () {
        var subcases, entries, _i, entries_5, entry, subPath, subEntries, hasFiles, _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    subcases = [];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 9, , 10]);
                    return [4 /*yield*/, (0, promises_1.readdir)(casePath, { withFileTypes: true })];
                case 2:
                    entries = _c.sent();
                    _i = 0, entries_5 = entries;
                    _c.label = 3;
                case 3:
                    if (!(_i < entries_5.length)) return [3 /*break*/, 8];
                    entry = entries_5[_i];
                    if (!entry.isDirectory())
                        return [3 /*break*/, 7];
                    if (entry.name === '.ai_tool' || entry.name === '.ai_tool')
                        return [3 /*break*/, 7];
                    if (!entry.name.startsWith('.'))
                        return [3 /*break*/, 7];
                    subPath = (0, path_1.join)(casePath, entry.name);
                    _c.label = 4;
                case 4:
                    _c.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readdir)(subPath, { withFileTypes: true })];
                case 5:
                    subEntries = _c.sent();
                    hasFiles = subEntries.some(function (e) { return !e.isDirectory() || e.name !== '.ai_tool'; });
                    if (hasFiles) {
                        subcases.push(subPath);
                    }
                    return [3 /*break*/, 7];
                case 6:
                    _a = _c.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _i++;
                    return [3 /*break*/, 3];
                case 8: return [3 /*break*/, 10];
                case 9:
                    _b = _c.sent();
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/, subcases];
            }
        });
    });
}
// Semaphore to limit concurrent vision extractions (heavy subprocess memory)
var VISION_CONCURRENCY = 4;
var _activeVision = 0;
var _visionQueue = [];
function acquireVisionSlot() {
    if (_activeVision < VISION_CONCURRENCY) {
        _activeVision++;
        console.log("[vision-sem] Acquired slot (".concat(_activeVision, "/").concat(VISION_CONCURRENCY, " active, ").concat(_visionQueue.length, " queued)"));
        return Promise.resolve();
    }
    console.log("[vision-sem] Queuing \u2014 all ".concat(VISION_CONCURRENCY, " slots busy (").concat(_visionQueue.length + 1, " will be queued)"));
    return new Promise(function (resolve) { return _visionQueue.push(function () {
        _activeVision++;
        console.log("[vision-sem] Dequeued into slot (".concat(_activeVision, "/").concat(VISION_CONCURRENCY, " active, ").concat(_visionQueue.length, " queued)"));
        resolve();
    }); });
}
function releaseVisionSlot() {
    _activeVision--;
    console.log("[vision-sem] Released slot (".concat(_activeVision, "/").concat(VISION_CONCURRENCY, " active, ").concat(_visionQueue.length, " queued)"));
    if (_visionQueue.length > 0) {
        _visionQueue.shift()();
    }
}
// Index a single case using file-by-file extraction
function indexCase(caseFolder, onProgress, options) {
    return __awaiter(this, void 0, void 0, function () {
        var caseName, isIncremental, indexDir, indexPath, previousIndexContent, previousIndex, _a, totalUsage, existingIndex, files_2, CONCURRENCY_LIMIT, totalFiles_1, completedCount_1, successCount_1, failCount_1, nextFileIndex_1, folders_2, runIssues_1, failedFiles_1, indexStartTime_1, yearModeInfo_1, slug, firmRoot, registry, processWorker_1, workers, baseSummary, existingIssues, issuesFound, initialIndex, initialIndexForSummary, _b, hypergraphResult, caseSummaryResult, hypergraphPath, mergedIndex, normalizedIndex, validation, indexDiff, usageReport, totalTokensUsed, parentIndexPath, parentContent, parentIndex, relatedCases, existingIdx, relatedEntry, parentErr_1, err_5, error, restored, _c, restoreError_1;
        var _this = this;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        return __generator(this, function (_p) {
            switch (_p.label) {
                case 0:
                    caseName = caseFolder.split('/').pop() || caseFolder;
                    isIncremental = (options === null || options === void 0 ? void 0 : options.incrementalFiles) && options.incrementalFiles.length > 0;
                    indexDir = (0, path_1.join)(caseFolder, '.ai_tool');
                    indexPath = (0, path_1.join)(indexDir, 'document_index.json');
                    previousIndexContent = null;
                    previousIndex = null;
                    _p.label = 1;
                case 1:
                    _p.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, 'utf-8')];
                case 2:
                    previousIndexContent = _p.sent();
                    try {
                        previousIndex = JSON.parse(previousIndexContent);
                    }
                    catch (_q) {
                        previousIndex = null;
                    }
                    return [3 /*break*/, 4];
                case 3:
                    _a = _p.sent();
                    return [3 /*break*/, 4];
                case 4:
                    totalUsage = {
                        groq: {
                            inputTokens: 0,
                            inputTokensNew: 0,
                            inputTokensCacheWrite: 0,
                            inputTokensCacheRead: 0,
                            outputTokens: 0,
                            apiCalls: 0
                        },
                    };
                    _p.label = 5;
                case 5:
                    _p.trys.push([5, 24, , 33]);
                    onProgress({ type: "case_start", caseName: caseName, caseFolder: caseFolder, incremental: isIncremental });
                    existingIndex = previousIndex;
                    if (isIncremental) {
                        if (existingIndex) {
                            console.log("[Incremental] Loaded existing index with ".concat(Object.keys(existingIndex.folders || {}).length, " folders"));
                        }
                        else {
                            console.log("[Incremental] No existing index found, falling back to full index");
                        }
                    }
                    if (!(isIncremental && (options === null || options === void 0 ? void 0 : options.incrementalFiles))) return [3 /*break*/, 6];
                    files_2 = options.incrementalFiles;
                    onProgress({ type: "status", caseName: caseName, message: "Incremental update: ".concat(files_2.length, " file(s)...") });
                    onProgress({ type: "files_found", caseName: caseName, count: files_2.length, files: files_2, incremental: true });
                    return [3 /*break*/, 8];
                case 6:
                    onProgress({ type: "status", caseName: caseName, message: "Listing files..." });
                    return [4 /*yield*/, listCaseFiles(caseFolder, {
                            sourceFolders: options === null || options === void 0 ? void 0 : options.sourceFolders,
                        })];
                case 7:
                    files_2 = _p.sent();
                    onProgress({ type: "files_found", caseName: caseName, count: files_2.length, files: files_2 });
                    _p.label = 8;
                case 8:
                    if (files_2.length === 0) {
                        onProgress({ type: "case_done", caseName: caseName, casePath: caseFolder, success: false, error: "No files found" });
                        return [2 /*return*/, { success: false, error: "No files found in case folder" }];
                    }
                    CONCURRENCY_LIMIT = 10;
                    totalFiles_1 = files_2.length;
                    completedCount_1 = 0;
                    successCount_1 = 0;
                    failCount_1 = 0;
                    nextFileIndex_1 = 0;
                    folders_2 = isIncremental && (existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.folders) ? normalizeFolders(existingIndex.folders) : {};
                    runIssues_1 = [];
                    failedFiles_1 = [];
                    indexStartTime_1 = Date.now();
                    console.log("\n========== PROCESSING ".concat(files_2.length, " FILES (max concurrent: ").concat(CONCURRENCY_LIMIT, ") ========="));
                    onProgress({ type: "status", caseName: caseName, message: "Processing ".concat(files_2.length, " files (steady stream, max ").concat(CONCURRENCY_LIMIT, " concurrent)...") });
                    if (!(options === null || options === void 0 ? void 0 : options.sourceFolders)) return [3 /*break*/, 10];
                    slug = (0, year_mode_1.getClientSlug)(caseFolder);
                    firmRoot = (0, year_mode_1.resolveFirmRoot)(caseFolder);
                    return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(firmRoot)];
                case 9:
                    registry = _p.sent();
                    if (slug && (registry === null || registry === void 0 ? void 0 : registry.clients[slug])) {
                        yearModeInfo_1 = { firmRoot: firmRoot, registry: registry, slug: slug };
                    }
                    _p.label = 10;
                case 10:
                    processWorker_1 = function () { return __awaiter(_this, void 0, void 0, function () {
                        var _loop_3;
                        var _this = this;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _loop_3 = function () {
                                        var fileIndex, filePath, extraction, isVision, classified_1, _b, err_6, fallbackFolder, fallbackFilename, fileEntry, dateResolution, handwritingResolution, extractionIssue, mem, elapsed;
                                        return __generator(this, function (_c) {
                                            switch (_c.label) {
                                                case 0:
                                                    fileIndex = nextFileIndex_1++;
                                                    filePath = files_2[fileIndex];
                                                    extraction = null;
                                                    isVision = false;
                                                    _c.label = 1;
                                                case 1:
                                                    _c.trys.push([1, 7, , 8]);
                                                    return [4 /*yield*/, classifyFile(caseFolder, filePath, yearModeInfo_1)];
                                                case 2:
                                                    classified_1 = _c.sent();
                                                    isVision = !classified_1.useText;
                                                    if (!classified_1.useText) return [3 /*break*/, 4];
                                                    return [4 /*yield*/, extractFileText(classified_1, fileIndex, totalFiles_1, options === null || options === void 0 ? void 0 : options.practiceArea, function (event) { onProgress(__assign(__assign({}, event), { caseName: caseName })); })];
                                                case 3:
                                                    _b = _c.sent();
                                                    return [3 /*break*/, 6];
                                                case 4: return [4 /*yield*/, (function () { return __awaiter(_this, void 0, void 0, function () {
                                                        return __generator(this, function (_a) {
                                                            switch (_a.label) {
                                                                case 0: return [4 /*yield*/, acquireVisionSlot()];
                                                                case 1:
                                                                    _a.sent();
                                                                    _a.label = 2;
                                                                case 2:
                                                                    _a.trys.push([2, , 4, 5]);
                                                                    return [4 /*yield*/, extractFileVision(classified_1, fileIndex, totalFiles_1, options === null || options === void 0 ? void 0 : options.practiceArea, function (event) { onProgress(__assign(__assign({}, event), { caseName: caseName })); })];
                                                                case 3: return [2 /*return*/, _a.sent()];
                                                                case 4:
                                                                    releaseVisionSlot();
                                                                    return [7 /*endfinally*/];
                                                                case 5: return [2 /*return*/];
                                                            }
                                                        });
                                                    }); })()];
                                                case 5:
                                                    _b = _c.sent();
                                                    _c.label = 6;
                                                case 6:
                                                    extraction = _b;
                                                    classified_1 = null; // Release classified (including extractedText) immediately
                                                    return [3 /*break*/, 8];
                                                case 7:
                                                    err_6 = _c.sent();
                                                    fallbackFolder = (0, path_1.dirname)(filePath).replace(/\\/g, '/');
                                                    fallbackFilename = filePath.split('/').pop() || filePath;
                                                    console.error("[".concat(fileIndex + 1, "/").concat(totalFiles_1, "] Unhandled error for ").concat(fallbackFilename, ":"), err_6);
                                                    extraction = {
                                                        filename: fallbackFilename,
                                                        folder: fallbackFolder || "root",
                                                        type: 'other',
                                                        key_info: "Failed to extract",
                                                        has_handwritten_data: false,
                                                        handwritten_fields: [],
                                                        error: err_6 instanceof Error ? err_6.message : String(err_6),
                                                    };
                                                    return [3 /*break*/, 8];
                                                case 8:
                                                    // Aggregate usage incrementally
                                                    if (extraction.usage) {
                                                        totalUsage.groq.inputTokens += extraction.usage.inputTokens;
                                                        totalUsage.groq.inputTokensNew += extraction.usage.inputTokensNew || 0;
                                                        totalUsage.groq.inputTokensCacheWrite += extraction.usage.inputTokensCacheWrite || 0;
                                                        totalUsage.groq.inputTokensCacheRead += extraction.usage.inputTokensCacheRead || 0;
                                                        totalUsage.groq.outputTokens += extraction.usage.outputTokens;
                                                        totalUsage.groq.apiCalls += extraction.usage.apiCalls;
                                                    }
                                                    // Build folder entry incrementally
                                                    if (!folders_2[extraction.folder]) {
                                                        folders_2[extraction.folder] = { files: [] };
                                                    }
                                                    if (isIncremental) {
                                                        folders_2[extraction.folder].files = folders_2[extraction.folder].files.filter(function (f) { return f.filename !== extraction.filename; });
                                                    }
                                                    fileEntry = {
                                                        doc_id: (0, document_id_1.buildDocumentId)(extraction.folder, extraction.filename),
                                                        filename: extraction.filename,
                                                        type: extraction.type,
                                                        key_info: extraction.key_info,
                                                        has_handwritten_data: false,
                                                        handwritten_fields: [],
                                                        extracted_data: extraction.extracted_data,
                                                    };
                                                    dateResolution = resolveDocumentDate(extraction);
                                                    handwritingResolution = resolveHandwritingMetadata(extraction);
                                                    if (dateResolution.date) {
                                                        fileEntry.date = dateResolution.date;
                                                    }
                                                    fileEntry.has_handwritten_data = handwritingResolution.hasHandwrittenData;
                                                    fileEntry.handwritten_fields = handwritingResolution.handwrittenFields;
                                                    if (dateResolution.issue) {
                                                        fileEntry.issues = dateResolution.issue;
                                                        runIssues_1.push("[Document Date] ".concat(extraction.folder, "/").concat(extraction.filename, ": ").concat(dateResolution.issue));
                                                    }
                                                    if (handwritingResolution.issue) {
                                                        fileEntry.issues = fileEntry.issues
                                                            ? "".concat(fileEntry.issues, " ").concat(handwritingResolution.issue)
                                                            : handwritingResolution.issue;
                                                        runIssues_1.push("[Handwriting] ".concat(extraction.folder, "/").concat(extraction.filename, ": ").concat(handwritingResolution.issue));
                                                    }
                                                    if (extraction.error) {
                                                        extractionIssue = "Extraction failed: ".concat(extraction.error);
                                                        fileEntry.issues = fileEntry.issues
                                                            ? "".concat(fileEntry.issues, " ").concat(extractionIssue)
                                                            : extractionIssue;
                                                        runIssues_1.push("[Extraction] ".concat(extraction.folder, "/").concat(extraction.filename, ": ").concat(extraction.error));
                                                        failedFiles_1.push({
                                                            filename: extraction.filename,
                                                            folder: extraction.folder,
                                                            error: extraction.error,
                                                            failed_at: new Date().toISOString(),
                                                        });
                                                        failCount_1++;
                                                    }
                                                    else {
                                                        successCount_1++;
                                                    }
                                                    folders_2[extraction.folder].files.push(fileEntry);
                                                    // Release extraction — its data has been transferred to folders/accumulators
                                                    extraction = null;
                                                    completedCount_1 += 1;
                                                    // Log memory every 5 files to track leak pattern
                                                    if (completedCount_1 % 5 === 0) {
                                                        mem = process.memoryUsage();
                                                        elapsed = ((Date.now() - indexStartTime_1) / 1000).toFixed(0);
                                                        console.log("[mem] ".concat(completedCount_1, "/").concat(totalFiles_1, " @ ").concat(elapsed, "s | RSS: ").concat((mem.rss / 1024 / 1024).toFixed(0), "MB | Heap: ").concat((mem.heapUsed / 1024 / 1024).toFixed(0), "/").concat((mem.heapTotal / 1024 / 1024).toFixed(0), "MB | External: ").concat((mem.external / 1024 / 1024).toFixed(0), "MB | ArrayBuf: ").concat(((mem.arrayBuffers || 0) / 1024 / 1024).toFixed(0), "MB"));
                                                    }
                                                    console.log("--- Progress: ".concat(completedCount_1, "/").concat(totalFiles_1, " files complete ---"));
                                                    // Force garbage collection every 5 files (same cadence as before)
                                                    if (completedCount_1 % 5 === 0 && typeof Bun !== 'undefined' && Bun.gc) {
                                                        Bun.gc(true);
                                                        console.log("[gc] Forced garbage collection after ".concat(completedCount_1, " files"));
                                                    }
                                                    return [2 /*return*/];
                                            }
                                        });
                                    };
                                    _a.label = 1;
                                case 1:
                                    if (!(nextFileIndex_1 < totalFiles_1)) return [3 /*break*/, 3];
                                    return [5 /*yield**/, _loop_3()];
                                case 2:
                                    _a.sent();
                                    return [3 /*break*/, 1];
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); };
                    workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, totalFiles_1) }, function () { return processWorker_1(); });
                    return [4 /*yield*/, Promise.all(workers)];
                case 11:
                    _p.sent();
                    onProgress({
                        type: "extractions_complete",
                        caseName: caseName,
                        successful: successCount_1,
                        failed: failCount_1
                    });
                    // Step 3: Build preliminary index for hypergraph analysis
                    // Folders were built incrementally during extraction above.
                    // Step 4: Write initial document_index.json (before hypergraph/Sonnet)
                    return [4 /*yield*/, (0, promises_1.mkdir)(indexDir, { recursive: true })];
                case 12:
                    // Step 3: Build preliminary index for hypergraph analysis
                    // Folders were built incrementally during extraction above.
                    // Step 4: Write initial document_index.json (before hypergraph/Sonnet)
                    _p.sent();
                    baseSummary = isIncremental && (existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.summary) ? existingIndex.summary : {
                        client: 'Pending reconciliation',
                        dol: 'Pending',
                        dob: 'Pending',
                        providers: [],
                        total_charges: 0,
                        policy_limits: {},
                        contact: {},
                        health_insurance: {},
                        claim_numbers: {},
                        case_summary: '',
                    };
                    existingIssues = Array.isArray(existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.issues_found)
                        ? existingIndex.issues_found.filter(function (issue) { return typeof issue === "string"; })
                        : [];
                    issuesFound = Array.from(new Set(__spreadArray(__spreadArray([], existingIssues, true), runIssues_1, true)));
                    initialIndex = {
                        indexed_at: new Date().toISOString(),
                        case_name: caseName,
                        case_phase: isIncremental && (existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.case_phase) ? existingIndex.case_phase : 'Unknown',
                        summary: baseSummary,
                        folders: folders_2,
                        failed_files: failedFiles_1,
                        issues_found: issuesFound,
                        reconciled_values: (_d = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.reconciled_values) !== null && _d !== void 0 ? _d : {},
                        needs_review: (_e = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.needs_review) !== null && _e !== void 0 ? _e : [],
                        errata: (_f = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.errata) !== null && _f !== void 0 ? _f : [],
                        case_analysis: (_g = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.case_analysis) !== null && _g !== void 0 ? _g : "",
                        case_notes: (_h = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.case_notes) !== null && _h !== void 0 ? _h : [],
                        chat_archives: (_j = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.chat_archives) !== null && _j !== void 0 ? _j : [],
                        liability_assessment: (_k = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.liability_assessment) !== null && _k !== void 0 ? _k : null,
                        injury_tier: (_l = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.injury_tier) !== null && _l !== void 0 ? _l : null,
                        estimated_value_range: (_m = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.estimated_value_range) !== null && _m !== void 0 ? _m : null,
                        policy_limits_demand_appropriate: (_o = existingIndex === null || existingIndex === void 0 ? void 0 : existingIndex.policy_limits_demand_appropriate) !== null && _o !== void 0 ? _o : null,
                    };
                    // Add practice area if specified (omit for PI to maintain backward compat)
                    // Accept both short code ("WC") and full name ("Workers' Compensation")
                    if ((options === null || options === void 0 ? void 0 : options.practiceArea) === practice_areas_1.PRACTICE_AREAS.WC || (options === null || options === void 0 ? void 0 : options.practiceArea) === "WC") {
                        initialIndex.practice_area = practice_areas_1.PRACTICE_AREAS.WC;
                    }
                    // Add linked case fields if this is a subcase
                    if (options === null || options === void 0 ? void 0 : options.parentCase) {
                        initialIndex.parent_case = options.parentCase;
                        initialIndex.is_subcase = true;
                    }
                    // Add DOI container fields if this is a DOI case (WC multi-injury client)
                    if (options === null || options === void 0 ? void 0 : options.containerInfo) {
                        initialIndex.container = {
                            path: options.containerInfo.path,
                            clientName: options.containerInfo.clientName,
                        };
                        initialIndex.is_doi_case = true;
                        initialIndex.injury_date = options.containerInfo.injuryDate;
                        // Add DOI siblings as related cases
                        if (options.containerInfo.siblingCases && options.containerInfo.siblingCases.length > 0) {
                            initialIndex.related_cases = options.containerInfo.siblingCases.map(function (sibling) { return ({
                                path: sibling.path,
                                name: sibling.name,
                                type: "doi_sibling",
                                dateOfInjury: sibling.dateOfInjury,
                            }); });
                        }
                    }
                    return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(initialIndex, null, 2))];
                case 13:
                    _p.sent();
                    console.log("[Index] Wrote initial document_index.json");
                    // Step 5: Run hypergraph and case summary generation IN PARALLEL
                    onProgress({ type: "status", caseName: caseName, message: "Analyzing documents and generating summary..." });
                    initialIndexForSummary = {
                        folders: folders_2,
                        case_name: initialIndex.case_name,
                        practice_area: initialIndex.practice_area,
                        is_doi_case: initialIndex.is_doi_case,
                        injury_date: initialIndex.injury_date,
                        related_cases: initialIndex.related_cases,
                    };
                    return [4 /*yield*/, Promise.all([
                            generateHypergraph(caseFolder, { folders: folders_2 }, options === null || options === void 0 ? void 0 : options.practiceArea),
                            (0, case_summary_1.generateCaseSummary)(initialIndexForSummary, {
                                firmRoot: options === null || options === void 0 ? void 0 : options.firmRoot,
                                practiceArea: options === null || options === void 0 ? void 0 : options.practiceArea,
                            })
                        ])];
                case 14:
                    _b = _p.sent(), hypergraphResult = _b[0], caseSummaryResult = _b[1];
                    hypergraphPath = (0, path_1.join)(indexDir, 'hypergraph_analysis.json');
                    return [4 /*yield*/, (0, promises_1.writeFile)(hypergraphPath, JSON.stringify(hypergraphResult, null, 2))];
                case 15:
                    _p.sent();
                    console.log("[Hypergraph] Wrote hypergraph_analysis.json");
                    // Add hypergraph usage to Groq totals
                    if (hypergraphResult.usage) {
                        totalUsage.groq.inputTokens += hypergraphResult.usage.inputTokens;
                        totalUsage.groq.inputTokensNew += hypergraphResult.usage.inputTokensNew || 0;
                        totalUsage.groq.inputTokensCacheWrite += hypergraphResult.usage.inputTokensCacheWrite || 0;
                        totalUsage.groq.inputTokensCacheRead += hypergraphResult.usage.inputTokensCacheRead || 0;
                        totalUsage.groq.outputTokens += hypergraphResult.usage.outputTokens;
                        totalUsage.groq.apiCalls += hypergraphResult.usage.apiCalls;
                    }
                    // Add case summary usage to Groq totals
                    totalUsage.groq.inputTokens += caseSummaryResult.usage.inputTokens;
                    totalUsage.groq.outputTokens += caseSummaryResult.usage.outputTokens;
                    totalUsage.groq.apiCalls += 1;
                    onProgress({
                        type: "hypergraph_complete",
                        caseName: caseName,
                        conflictsFound: hypergraphResult.conflicts.length,
                        confidence: hypergraphResult.summary.confidence_score
                    });
                    // Step 6: Programmatic merge - combine hypergraph + case summary into final index
                    onProgress({ type: "status", caseName: caseName, message: "Merging results..." });
                    mergedIndex = (0, merge_index_1.mergeToIndex)(hypergraphResult, caseSummaryResult, __assign(__assign({}, initialIndex), { folders: folders_2 }));
                    normalizedIndex = (0, index_schema_1.normalizeIndex)(mergedIndex, options === null || options === void 0 ? void 0 : options.practiceArea);
                    validation = (0, index_schema_1.validateIndex)(normalizedIndex);
                    if (!validation.valid) {
                        console.warn("[Schema] Validation issues in ".concat(caseName, ":"), validation.issues.slice(0, 5));
                    }
                    indexDiff = (0, merge_index_1.diffIndexes)(previousIndex, normalizedIndex);
                    // Write final normalized index + all derived files
                    return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(normalizedIndex, null, 2))];
                case 16:
                    // Write final normalized index + all derived files
                    _p.sent();
                    return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(caseFolder, normalizedIndex)];
                case 17:
                    _p.sent();
                    console.log("[Index] Wrote normalized document_index.json + meta_index.json + per-folder indexes");
                    console.log("[Diff] ".concat(indexDiff.summary));
                    usageReport = {
                        groq: totalUsage.groq,
                        totalInputTokens: totalUsage.groq.inputTokens,
                        totalOutputTokens: totalUsage.groq.outputTokens,
                        totalApiCalls: totalUsage.groq.apiCalls,
                    };
                    onProgress({
                        type: "usage_stats",
                        caseName: caseName,
                        usage: usageReport,
                    });
                    // Pretty print usage to console
                    console.log("\n========== USAGE STATS: ".concat(caseName, " =========="));
                    console.log("Groq:   ".concat(usageReport.groq.apiCalls, " calls, ").concat(usageReport.groq.inputTokens.toLocaleString(), " in / ").concat(usageReport.groq.outputTokens.toLocaleString(), " out"));
                    console.log("---------------------------------------------");
                    console.log("TOTAL:  ".concat(usageReport.totalApiCalls, " API calls"));
                    console.log("        ".concat(usageReport.totalInputTokens.toLocaleString(), " input tokens"));
                    console.log("        ".concat(usageReport.totalOutputTokens.toLocaleString(), " output tokens"));
                    console.log("=============================================\n");
                    totalTokensUsed = usageReport.totalInputTokens + usageReport.totalOutputTokens;
                    if (totalTokensUsed > 0) {
                        reportUsage(totalTokensUsed, "indexing").catch(function () { });
                    }
                    if (!(options === null || options === void 0 ? void 0 : options.parentCase)) return [3 /*break*/, 23];
                    _p.label = 18;
                case 18:
                    _p.trys.push([18, 22, , 23]);
                    parentIndexPath = (0, path_1.join)(options.parentCase.path, '.ai_tool', 'document_index.json');
                    return [4 /*yield*/, (0, promises_1.readFile)(parentIndexPath, 'utf-8')];
                case 19:
                    parentContent = _p.sent();
                    parentIndex = JSON.parse(parentContent);
                    relatedCases = parentIndex.related_cases || [];
                    existingIdx = relatedCases.findIndex(function (rc) { return rc.path === caseFolder; });
                    relatedEntry = {
                        path: caseFolder,
                        name: caseName,
                        type: "subcase",
                    };
                    if (existingIdx >= 0) {
                        relatedCases[existingIdx] = relatedEntry;
                    }
                    else {
                        relatedCases.push(relatedEntry);
                    }
                    parentIndex.related_cases = relatedCases;
                    return [4 /*yield*/, (0, promises_1.writeFile)(parentIndexPath, JSON.stringify(parentIndex, null, 2))];
                case 20:
                    _p.sent();
                    return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(options.parentCase.path, parentIndex)];
                case 21:
                    _p.sent();
                    console.log("[Index] Updated parent index with related_cases");
                    return [3 /*break*/, 23];
                case 22:
                    parentErr_1 = _p.sent();
                    // Parent index may not exist yet - that's ok
                    console.warn("[Index] Could not update parent index:", parentErr_1);
                    return [3 /*break*/, 23];
                case 23:
                    onProgress({ type: "case_done", caseName: caseName, casePath: caseFolder, success: true, diff: indexDiff });
                    return [2 /*return*/, { success: true, diff: indexDiff }];
                case 24:
                    err_5 = _p.sent();
                    error = err_5 instanceof Error ? err_5.message : String(err_5);
                    if (!(previousIndexContent !== null)) return [3 /*break*/, 32];
                    _p.label = 25;
                case 25:
                    _p.trys.push([25, 31, , 32]);
                    return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, previousIndexContent)];
                case 26:
                    _p.sent();
                    _p.label = 27;
                case 27:
                    _p.trys.push([27, 29, , 30]);
                    restored = JSON.parse(previousIndexContent);
                    return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(caseFolder, restored)];
                case 28:
                    _p.sent();
                    return [3 /*break*/, 30];
                case 29:
                    _c = _p.sent();
                    return [3 /*break*/, 30];
                case 30:
                    console.warn("[Index] Restored previous document_index.json after failure");
                    return [3 /*break*/, 32];
                case 31:
                    restoreError_1 = _p.sent();
                    console.error("[Index] Failed to restore previous index:", restoreError_1);
                    return [3 /*break*/, 32];
                case 32:
                    onProgress({ type: "case_error", caseName: caseName, error: error });
                    return [2 /*return*/, { success: false, error: error }];
                case 33: return [2 /*return*/];
            }
        });
    });
}
app.post("/batch-index", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, casesToIndex, requestedPracticeArea, access, configuredPracticeArea, practiceArea, isWC, targetCases, containersToIndex, _loop_4, _i, casesToIndex_1, casePath, batchYearMode, registry, _b, _c, client, virtualPath, indexPath, _d, entries, _e, entries_6, entry, casePath, doiDetection, _loop_5, _f, _g, doiCase, indexPath, _h, subcasePaths, _j, subcasePaths_1, subcasePath, subcaseName, subcaseIndexPath, _k, error_4;
    return __generator(this, function (_l) {
        switch (_l.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _l.sent(), root = _a.root, casesToIndex = _a.cases, requestedPracticeArea = _a.practiceArea;
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root is required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _l.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                return [4 /*yield*/, (0, practice_area_1.resolveFirmPracticeArea)(root)];
            case 3:
                configuredPracticeArea = _l.sent();
                practiceArea = configuredPracticeArea ||
                    (0, practice_area_1.normalizePracticeArea)(requestedPracticeArea) ||
                    practice_areas_1.PRACTICE_AREAS.PI;
                isWC = practiceArea === practice_areas_1.PRACTICE_AREAS.WC;
                targetCases = [];
                containersToIndex = [];
                if (!(casesToIndex && casesToIndex.length > 0)) return [3 /*break*/, 8];
                _loop_4 = function (casePath) {
                    var caseName, parentPath, parentName, doiParsed, parentDoiDetection, siblings, doiDetection, _loop_6, _m, _o, doiCase, slug, firmRoot, registry, client, subcasePaths, _p, subcasePaths_2, subcasePath, subcaseName, subcaseIndexPath, _q;
                    return __generator(this, function (_r) {
                        switch (_r.label) {
                            case 0:
                                caseName = casePath.split('/').pop() || casePath;
                                parentPath = (0, path_1.dirname)(casePath);
                                parentName = parentPath.split('/').pop() || '';
                                doiParsed = parseDOIFolderName(caseName);
                                if (!(doiParsed && parentPath !== root)) return [3 /*break*/, 2];
                                return [4 /*yield*/, detectDOISubfolders(parentPath)];
                            case 1:
                                parentDoiDetection = _r.sent();
                                if (parentDoiDetection.isContainer) {
                                    siblings = parentDoiDetection.doiCases.filter(function (d) { return d.path !== casePath; });
                                    // Add container if not already tracked
                                    if (!containersToIndex.find(function (c) { return c.path === parentPath; })) {
                                        containersToIndex.push({
                                            path: parentPath,
                                            name: parentName,
                                            doiCases: parentDoiDetection.doiCases,
                                            sharedFolders: parentDoiDetection.sharedFolders,
                                        });
                                    }
                                    targetCases.push({
                                        path: casePath,
                                        name: caseName,
                                        containerInfo: {
                                            path: parentPath,
                                            clientName: parentName,
                                            injuryDate: doiParsed.date,
                                            siblingCases: siblings,
                                        },
                                    });
                                }
                                return [3 /*break*/, 21];
                            case 2:
                                if (!(caseName.startsWith('.') && parentPath !== root)) return [3 /*break*/, 3];
                                // It's a subcase (dot-prefixed)
                                targetCases.push({
                                    path: casePath,
                                    name: caseName,
                                    parentCase: { path: parentPath, name: parentName },
                                });
                                return [3 /*break*/, 21];
                            case 3:
                                if (!isWC) return [3 /*break*/, 9];
                                return [4 /*yield*/, detectDOISubfolders(casePath)];
                            case 4:
                                doiDetection = _r.sent();
                                if (!doiDetection.isContainer) return [3 /*break*/, 9];
                                // This is a container - queue container and all its DOI cases
                                containersToIndex.push({
                                    path: casePath,
                                    name: caseName,
                                    doiCases: doiDetection.doiCases,
                                    sharedFolders: doiDetection.sharedFolders,
                                });
                                _loop_6 = function (doiCase) {
                                    var doiIndexPath, _s, siblings;
                                    return __generator(this, function (_t) {
                                        switch (_t.label) {
                                            case 0:
                                                doiIndexPath = (0, path_1.join)(doiCase.path, ".ai_tool", "document_index.json");
                                                _t.label = 1;
                                            case 1:
                                                _t.trys.push([1, 3, , 4]);
                                                return [4 /*yield*/, (0, promises_1.stat)(doiIndexPath)];
                                            case 2:
                                                _t.sent();
                                                return [3 /*break*/, 4];
                                            case 3:
                                                _s = _t.sent();
                                                siblings = doiDetection.doiCases.filter(function (d) { return d.path !== doiCase.path; });
                                                targetCases.push({
                                                    path: doiCase.path,
                                                    name: doiCase.name,
                                                    containerInfo: {
                                                        path: casePath,
                                                        clientName: caseName,
                                                        injuryDate: doiCase.dateOfInjury,
                                                        siblingCases: siblings,
                                                    },
                                                });
                                                return [3 /*break*/, 4];
                                            case 4: return [2 /*return*/];
                                        }
                                    });
                                };
                                _m = 0, _o = doiDetection.doiCases;
                                _r.label = 5;
                            case 5:
                                if (!(_m < _o.length)) return [3 /*break*/, 8];
                                doiCase = _o[_m];
                                return [5 /*yield**/, _loop_6(doiCase)];
                            case 6:
                                _r.sent();
                                _r.label = 7;
                            case 7:
                                _m++;
                                return [3 /*break*/, 5];
                            case 8: return [2 /*return*/, "continue"];
                            case 9:
                                slug = (0, year_mode_1.getClientSlug)(casePath);
                                if (!slug) return [3 /*break*/, 13];
                                firmRoot = (0, year_mode_1.resolveFirmRoot)(casePath);
                                return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(firmRoot)];
                            case 10:
                                registry = _r.sent();
                                if (!!registry) return [3 /*break*/, 12];
                                return [4 /*yield*/, (0, year_mode_1.scanAndBuildRegistry)(firmRoot)];
                            case 11:
                                registry = _r.sent();
                                _r.label = 12;
                            case 12:
                                client = registry.clients[slug];
                                if (client) {
                                    console.log("[batch-index] year-based case: ".concat(caseName, ", slug=").concat(slug, ", sourceFolders=").concat(JSON.stringify(client.sourceFolders)));
                                    targetCases.push({
                                        path: casePath,
                                        name: client.name,
                                        sourceFolders: { firmRoot: firmRoot, folders: client.sourceFolders },
                                    });
                                }
                                else {
                                    console.warn("[batch-index] slug ".concat(slug, " not found in registry, skipping"));
                                }
                                return [3 /*break*/, 14];
                            case 13:
                                // Regular case
                                targetCases.push({ path: casePath, name: caseName });
                                _r.label = 14;
                            case 14: return [4 /*yield*/, discoverSubcases(casePath)];
                            case 15:
                                subcasePaths = _r.sent();
                                _p = 0, subcasePaths_2 = subcasePaths;
                                _r.label = 16;
                            case 16:
                                if (!(_p < subcasePaths_2.length)) return [3 /*break*/, 21];
                                subcasePath = subcasePaths_2[_p];
                                subcaseName = subcasePath.split('/').pop() || subcasePath;
                                subcaseIndexPath = (0, path_1.join)(subcasePath, ".ai_tool", "document_index.json");
                                _r.label = 17;
                            case 17:
                                _r.trys.push([17, 19, , 20]);
                                return [4 /*yield*/, (0, promises_1.stat)(subcaseIndexPath)];
                            case 18:
                                _r.sent();
                                return [3 /*break*/, 20];
                            case 19:
                                _q = _r.sent();
                                // No index, add to list
                                targetCases.push({
                                    path: subcasePath,
                                    name: subcaseName,
                                    parentCase: { path: casePath, name: caseName },
                                });
                                return [3 /*break*/, 20];
                            case 20:
                                _p++;
                                return [3 /*break*/, 16];
                            case 21: return [2 /*return*/];
                        }
                    });
                };
                _i = 0, casesToIndex_1 = casesToIndex;
                _l.label = 4;
            case 4:
                if (!(_i < casesToIndex_1.length)) return [3 /*break*/, 7];
                casePath = casesToIndex_1[_i];
                return [5 /*yield**/, _loop_4(casePath)];
            case 5:
                _l.sent();
                _l.label = 6;
            case 6:
                _i++;
                return [3 /*break*/, 4];
            case 7: return [3 /*break*/, 41];
            case 8: return [4 /*yield*/, (0, year_mode_1.detectYearBasedMode)(root)];
            case 9:
                batchYearMode = _l.sent();
                if (!batchYearMode) return [3 /*break*/, 19];
                return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(root)];
            case 10:
                registry = _l.sent();
                if (!!registry) return [3 /*break*/, 12];
                return [4 /*yield*/, (0, year_mode_1.scanAndBuildRegistry)(root)];
            case 11:
                registry = _l.sent();
                _l.label = 12;
            case 12:
                _b = 0, _c = Object.values(registry.clients);
                _l.label = 13;
            case 13:
                if (!(_b < _c.length)) return [3 /*break*/, 18];
                client = _c[_b];
                virtualPath = (0, path_1.join)(root, ".ai_tool", "clients", client.slug);
                indexPath = (0, path_1.join)(virtualPath, ".ai_tool", "document_index.json");
                _l.label = 14;
            case 14:
                _l.trys.push([14, 16, , 17]);
                return [4 /*yield*/, (0, promises_1.stat)(indexPath)];
            case 15:
                _l.sent();
                return [3 /*break*/, 17];
            case 16:
                _d = _l.sent();
                targetCases.push({
                    path: virtualPath,
                    name: client.name,
                    sourceFolders: { firmRoot: root, folders: client.sourceFolders },
                });
                return [3 /*break*/, 17];
            case 17:
                _b++;
                return [3 /*break*/, 13];
            case 18: return [3 /*break*/, 41];
            case 19:
                _l.trys.push([19, 40, , 41]);
                return [4 /*yield*/, (0, promises_1.readdir)(root, { withFileTypes: true })];
            case 20:
                entries = _l.sent();
                _e = 0, entries_6 = entries;
                _l.label = 21;
            case 21:
                if (!(_e < entries_6.length)) return [3 /*break*/, 39];
                entry = entries_6[_e];
                if (!entry.isDirectory() || entry.name === ".ai_tool" || entry.name === ".ai_tool")
                    return [3 /*break*/, 38];
                casePath = (0, path_1.join)(root, entry.name);
                if (!isWC) return [3 /*break*/, 27];
                return [4 /*yield*/, detectDOISubfolders(casePath)];
            case 22:
                doiDetection = _l.sent();
                if (!doiDetection.isContainer) return [3 /*break*/, 27];
                // This is a container - queue container and all its unindexed DOI cases
                containersToIndex.push({
                    path: casePath,
                    name: entry.name,
                    doiCases: doiDetection.doiCases,
                    sharedFolders: doiDetection.sharedFolders,
                });
                _loop_5 = function (doiCase) {
                    var doiIndexPath, _u, siblings;
                    return __generator(this, function (_v) {
                        switch (_v.label) {
                            case 0:
                                doiIndexPath = (0, path_1.join)(doiCase.path, ".ai_tool", "document_index.json");
                                _v.label = 1;
                            case 1:
                                _v.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, (0, promises_1.stat)(doiIndexPath)];
                            case 2:
                                _v.sent();
                                return [3 /*break*/, 4];
                            case 3:
                                _u = _v.sent();
                                siblings = doiDetection.doiCases.filter(function (d) { return d.path !== doiCase.path; });
                                targetCases.push({
                                    path: doiCase.path,
                                    name: doiCase.name,
                                    containerInfo: {
                                        path: casePath,
                                        clientName: entry.name,
                                        injuryDate: doiCase.dateOfInjury,
                                        siblingCases: siblings,
                                    },
                                });
                                return [3 /*break*/, 4];
                            case 4: return [2 /*return*/];
                        }
                    });
                };
                _f = 0, _g = doiDetection.doiCases;
                _l.label = 23;
            case 23:
                if (!(_f < _g.length)) return [3 /*break*/, 26];
                doiCase = _g[_f];
                return [5 /*yield**/, _loop_5(doiCase)];
            case 24:
                _l.sent();
                _l.label = 25;
            case 25:
                _f++;
                return [3 /*break*/, 23];
            case 26: return [3 /*break*/, 38]; // Skip regular case handling for containers
            case 27:
                indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                _l.label = 28;
            case 28:
                _l.trys.push([28, 30, , 31]);
                return [4 /*yield*/, (0, promises_1.stat)(indexPath)];
            case 29:
                _l.sent();
                return [3 /*break*/, 31];
            case 30:
                _h = _l.sent();
                // No parent index, add to list
                targetCases.push({ path: casePath, name: entry.name });
                return [3 /*break*/, 31];
            case 31: return [4 /*yield*/, discoverSubcases(casePath)];
            case 32:
                subcasePaths = _l.sent();
                _j = 0, subcasePaths_1 = subcasePaths;
                _l.label = 33;
            case 33:
                if (!(_j < subcasePaths_1.length)) return [3 /*break*/, 38];
                subcasePath = subcasePaths_1[_j];
                subcaseName = subcasePath.split('/').pop() || subcasePath;
                subcaseIndexPath = (0, path_1.join)(subcasePath, ".ai_tool", "document_index.json");
                _l.label = 34;
            case 34:
                _l.trys.push([34, 36, , 37]);
                return [4 /*yield*/, (0, promises_1.stat)(subcaseIndexPath)];
            case 35:
                _l.sent();
                return [3 /*break*/, 37];
            case 36:
                _k = _l.sent();
                // No index, add to list
                targetCases.push({
                    path: subcasePath,
                    name: subcaseName,
                    parentCase: { path: casePath, name: entry.name },
                });
                return [3 /*break*/, 37];
            case 37:
                _j++;
                return [3 /*break*/, 33];
            case 38:
                _e++;
                return [3 /*break*/, 21];
            case 39: return [3 /*break*/, 41];
            case 40:
                error_4 = _l.sent();
                return [2 /*return*/, c.json({ error: "Could not read firm directory" }, 500)];
            case 41:
                if (targetCases.length === 0) {
                    return [2 /*return*/, c.json({ message: "All cases are already indexed", indexed: 0 })];
                }
                return [2 /*return*/, (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(void 0, void 0, void 0, function () {
                        var heartbeat, _i, containersToIndex_1, container, results, successCount, error_5;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    heartbeat = setInterval(function () { return __awaiter(void 0, void 0, void 0, function () {
                                        var _a;
                                        return __generator(this, function (_b) {
                                            switch (_b.label) {
                                                case 0:
                                                    _b.trys.push([0, 2, , 3]);
                                                    return [4 /*yield*/, stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })];
                                                case 1:
                                                    _b.sent();
                                                    return [3 /*break*/, 3];
                                                case 2:
                                                    _a = _b.sent();
                                                    return [3 /*break*/, 3];
                                                case 3: return [2 /*return*/];
                                            }
                                        });
                                    }); }, 30000);
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 11, 13, 14]);
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "start",
                                                totalCases: targetCases.length,
                                                containersToIndex: containersToIndex.length,
                                                cases: targetCases.map(function (t) { return ({
                                                    path: t.path,
                                                    name: t.name,
                                                    isSubcase: !!t.parentCase,
                                                    isDOICase: !!t.containerInfo,
                                                }); })
                                            })
                                        })];
                                case 2:
                                    _a.sent();
                                    _i = 0, containersToIndex_1 = containersToIndex;
                                    _a.label = 3;
                                case 3:
                                    if (!(_i < containersToIndex_1.length)) return [3 /*break*/, 7];
                                    container = containersToIndex_1[_i];
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "status",
                                                message: "Indexing container: ".concat(container.name),
                                            })
                                        })];
                                case 4:
                                    _a.sent();
                                    return [4 /*yield*/, indexContainer(container.path, container.sharedFolders, container.doiCases, practiceArea, function (event) { return __awaiter(void 0, void 0, void 0, function () {
                                            return __generator(this, function (_a) {
                                                switch (_a.label) {
                                                    case 0: return [4 /*yield*/, stream.writeSSE({ data: JSON.stringify(event) })];
                                                    case 1:
                                                        _a.sent();
                                                        return [2 /*return*/];
                                                }
                                            });
                                        }); })];
                                case 5:
                                    _a.sent();
                                    _a.label = 6;
                                case 6:
                                    _i++;
                                    return [3 /*break*/, 3];
                                case 7: return [4 /*yield*/, Promise.all(targetCases.map(function (target) {
                                        return indexCase(target.path, function (event) { return __awaiter(void 0, void 0, void 0, function () {
                                            return __generator(this, function (_a) {
                                                switch (_a.label) {
                                                    case 0: 
                                                    // Stream progress events to client
                                                    return [4 /*yield*/, stream.writeSSE({
                                                            data: JSON.stringify(event)
                                                        })];
                                                    case 1:
                                                        // Stream progress events to client
                                                        _a.sent();
                                                        return [2 /*return*/];
                                                }
                                            });
                                        }); }, {
                                            firmRoot: root,
                                            parentCase: target.parentCase,
                                            practiceArea: practiceArea,
                                            containerInfo: target.containerInfo,
                                            sourceFolders: target.sourceFolders,
                                        });
                                    }))];
                                case 8:
                                    results = _a.sent();
                                    successCount = results.filter(function (r) { return r.success; }).length;
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "text",
                                                content: "Batch indexing complete: ".concat(successCount, "/").concat(targetCases.length, " cases indexed successfully.")
                                            })
                                        })];
                                case 9:
                                    _a.sent();
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "done",
                                                success: successCount === targetCases.length,
                                                successCount: successCount,
                                                totalCases: targetCases.length,
                                            })
                                        })];
                                case 10:
                                    _a.sent();
                                    return [3 /*break*/, 14];
                                case 11:
                                    error_5 = _a.sent();
                                    console.error("Batch index error:", error_5);
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "error",
                                                error: error_5 instanceof Error ? error_5.message : String(error_5),
                                            })
                                        })];
                                case 12:
                                    _a.sent();
                                    return [3 /*break*/, 14];
                                case 13:
                                    clearInterval(heartbeat);
                                    return [7 /*endfinally*/];
                                case 14: return [2 /*return*/];
                            }
                        });
                    }); })];
        }
    });
}); });
// Cache recent reindex checks to avoid rescanning large case trees on quick dashboard revisits.
var REINDEX_CHECK_TTL_MS = 15000;
var REINDEX_CHECK_CACHE_MAX = 512;
var reindexCheckCache = new Map();
function pruneReindexCheckCache(now) {
    if (reindexCheckCache.size <= REINDEX_CHECK_CACHE_MAX)
        return;
    for (var _i = 0, reindexCheckCache_1 = reindexCheckCache; _i < reindexCheckCache_1.length; _i++) {
        var _a = reindexCheckCache_1[_i], key = _a[0], cached = _a[1];
        if (now - cached.checkedAt > REINDEX_CHECK_TTL_MS) {
            reindexCheckCache.delete(key);
        }
    }
}
// Helper to check if case needs reindexing
function checkNeedsReindex(casePath, indexedAt) {
    return __awaiter(this, void 0, void 0, function () {
        function checkDir(dir) {
            return __awaiter(this, void 0, void 0, function () {
                var entries, results, _a;
                var _this = this;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _b.trys.push([0, 3, , 4]);
                            return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                        case 1:
                            entries = _b.sent();
                            return [4 /*yield*/, Promise.all(entries
                                    .filter(function (entry) { return entry.name !== ".ai_tool"; })
                                    .map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                                    var fullPath, stats;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                fullPath = (0, path_1.join)(dir, entry.name);
                                                if (entry.isDirectory()) {
                                                    return [2 /*return*/, checkDir(fullPath)];
                                                }
                                                return [4 /*yield*/, (0, promises_1.stat)(fullPath)];
                                            case 1:
                                                stats = _a.sent();
                                                return [2 /*return*/, stats.mtimeMs > indexedAt];
                                        }
                                    });
                                }); }))];
                        case 2:
                            results = _b.sent();
                            return [2 /*return*/, results.some(function (r) { return r; })];
                        case 3:
                            _a = _b.sent();
                            return [2 /*return*/, false];
                        case 4: return [2 /*return*/];
                    }
                });
            });
        }
        var now, cacheKey, cached, slug, needsReindex, firmRoot, registry, _i, _a, rel;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    now = Date.now();
                    cacheKey = "".concat(casePath, "::").concat(indexedAt);
                    cached = reindexCheckCache.get(cacheKey);
                    if (cached && now - cached.checkedAt <= REINDEX_CHECK_TTL_MS) {
                        return [2 /*return*/, cached.value];
                    }
                    pruneReindexCheckCache(now);
                    slug = (0, year_mode_1.getClientSlug)(casePath);
                    needsReindex = false;
                    if (!slug) return [3 /*break*/, 6];
                    firmRoot = (0, year_mode_1.resolveFirmRoot)(casePath);
                    return [4 /*yield*/, (0, year_mode_1.loadClientRegistry)(firmRoot)];
                case 1:
                    registry = _b.sent();
                    if (!(registry === null || registry === void 0 ? void 0 : registry.clients[slug])) return [3 /*break*/, 5];
                    _i = 0, _a = registry.clients[slug].sourceFolders;
                    _b.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 5];
                    rel = _a[_i];
                    return [4 /*yield*/, checkDir((0, path_1.join)(firmRoot, rel))];
                case 3:
                    if (_b.sent()) {
                        needsReindex = true;
                        return [3 /*break*/, 5];
                    }
                    _b.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 8];
                case 6: return [4 /*yield*/, checkDir(casePath)];
                case 7:
                    needsReindex = _b.sent();
                    _b.label = 8;
                case 8:
                    reindexCheckCache.set(cacheKey, { value: needsReindex, checkedAt: now });
                    return [2 /*return*/, needsReindex];
            }
        });
    });
}
// ============================================================================
// HYPERGRAPH GENERATION - Cross-document consistency analysis
// ============================================================================
// ── Programmatic hypergraph augmentation ────────────────────────────────────
//
// The LLM analyzes chunked document indexes to build value→source mappings,
// but frequently misses values when the index is large. This function scans
// ALL extracted_data across every document and augments the LLM's hypergraph
// with ground-truth source counts so consensus is accurate.
/** Map of hypergraph field name → extracted_data keys that feed into it */
var HYPERGRAPH_FIELD_ALIASES = {
    // Common to PI and WC
    claimant_name: ["claimant_name", "client_name", "patient_name"],
    date_of_birth: ["date_of_birth", "dob"],
    client_phone: ["client_phone", "phone", "claimant_phone"],
    client_email: ["client_email", "email", "claimant_email"],
    client_address: ["client_address", "address", "claimant_address"],
    // PI-specific
    date_of_loss: ["date_of_loss", "dol"],
    claim_number_1p: ["claim_number_1p", "claimant_1p", "claim_1p"],
    claim_number_3p: ["claim_number_3p", "claimant_3p", "claim_3p"],
    policy_limits_1p: ["policy_limits_1p", "policy_limit_1p", "policy_limits_1", "policy1p"],
    policy_limits_3p: ["policy_limits_3p", "policy_limit_3p", "policy_limits_3", "policy3p", "insurance_3p_limits"],
    adjuster_name_1p: ["adjuster_name_1p", "first_party_adjuster_name", "1p_adjuster_name"],
    adjuster_phone_1p: ["adjuster_phone_1p", "first_party_adjuster_phone", "1p_adjuster_phone"],
    adjuster_email_1p: ["adjuster_email_1p", "first_party_adjuster_email", "1p_adjuster_email"],
    adjuster_name_3p: ["adjuster_name_3p", "third_party_adjuster_name", "3p_adjuster_name", "adjuster_name"],
    adjuster_phone_3p: ["adjuster_phone_3p", "third_party_adjuster_phone", "3p_adjuster_phone", "adjuster_phone"],
    adjuster_email_3p: ["adjuster_email_3p", "third_party_adjuster_email", "3p_adjuster_email", "adjuster_email"],
    health_insurance: ["health_insurance"],
    total_medical: ["total_medical", "total_medical_charges", "total_charges", "total_medical_cost"],
    insurance_claim_numbers: ["insurance_claim_numbers"],
    policy_limits: ["policy_limits"],
    provider_balances: ["provider_balances", "provider_balance"],
    // WC-specific
    date_of_injury: ["date_of_injury", "doi"],
    employer_name: ["employer_name", "employer"],
    employer_address: ["employer_address"],
    employer_phone: ["employer_phone"],
    job_title: ["job_title", "job_title_at_time_of_injury"],
    wc_carrier: ["wc_carrier", "wc_insurance_carrier", "carrier_name"],
    wc_claim_number: ["wc_claim_number", "claim_number", "claim"],
    tpa_name: ["tpa_name", "third_party_administrator"],
    tpa: ["tpa"],
    adjuster_name: ["adjuster_name"],
    adjuster_phone: ["adjuster_phone"],
    adjuster_email: ["adjuster_email"],
    disability_type: ["disability_type"],
    amw: ["amw", "average_monthly_wage", "aww"],
    compensation_rate: ["compensation_rate", "weekly_compensation_rate"],
    body_parts_injured: ["body_parts_injured", "body_parts"],
    injury_description: ["injury_description", "mechanism_of_injury", "incident_description"],
    providers: ["providers", "treating_physicians", "treating_providers"],
    mmi_date: ["mmi_date"],
    ppd_rating: ["ppd_rating"],
};
/** Build a reverse lookup: extracted_data key → hypergraph field name */
function buildAliasReverseMap() {
    var reverseMap = new Map();
    for (var _i = 0, _a = Object.entries(HYPERGRAPH_FIELD_ALIASES); _i < _a.length; _i++) {
        var _b = _a[_i], hgField = _b[0], aliases = _b[1];
        for (var _c = 0, aliases_1 = aliases; _c < aliases_1.length; _c++) {
            var alias = aliases_1[_c];
            // First alias mapping wins (most specific)
            if (!reverseMap.has(alias)) {
                reverseMap.set(alias, hgField);
            }
        }
    }
    return reverseMap;
}
/** Normalize a value for grouping: lowercase, collapse whitespace, trim */
function normalizeDateForGrouping(value) {
    var compact = value.replace(/\s+/g, " ").trim();
    var slashDate = compact.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slashDate) {
        var m = slashDate[1], d = slashDate[2], yRaw = slashDate[3];
        var yNum = yRaw.length === 2 ? Number(yRaw) + 2000 : Number(yRaw);
        var mm = m.padStart(2, "0");
        var dd = d.padStart(2, "0");
        return "".concat(yNum.toString().padStart(4, "0"), "-").concat(mm, "-").concat(dd);
    }
    var alphaDate = compact.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{2,4})$/i);
    if (alphaDate) {
        var monthText = alphaDate[1], day = alphaDate[2], yearRaw = alphaDate[3];
        var months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
        var idx = months.indexOf(monthText.slice(0, 3).toLowerCase());
        if (idx >= 0) {
            var yNum = yearRaw.length === 2 ? Number(yearRaw) + 2000 : Number(yearRaw);
            return "".concat(yNum.toString(), "-").concat(String(idx + 1).padStart(2, "0"), "-").concat(String(Number(day)).padStart(2, "0"));
        }
    }
    return null;
}
function normalizeMoneyForGrouping(value) {
    var compact = value.replace(/,/g, "").trim();
    var moneyMatch = compact.match(/^\$?\s*(\d+(?:\.\d{1,2})?)$/);
    if (!moneyMatch)
        return null;
    var amount = Number(moneyMatch[1]);
    if (Number.isNaN(amount))
        return null;
    return "$".concat(amount.toFixed(2));
}
function normalizeForGrouping(value) {
    var compact = value.toLowerCase().replace(/\s+/g, " ").trim();
    if (!compact)
        return "";
    return (normalizeDateForGrouping(compact)
        || normalizeMoneyForGrouping(compact)
        || compact);
}
function normalizeScalarValue(rawValue) {
    if (typeof rawValue === "number")
        return [String(rawValue)];
    if (typeof rawValue === "boolean")
        return [rawValue ? "true" : "false"];
    if (typeof rawValue === "string") {
        var trimmed = rawValue.trim();
        return trimmed ? [trimmed] : [];
    }
    if (Array.isArray(rawValue)) {
        return rawValue.flatMap(function (entry) { return normalizeScalarValue(entry); });
    }
    return [];
}
function addFieldValue(fieldValues, field, rawValue, filename) {
    for (var _i = 0, _a = normalizeScalarValue(rawValue); _i < _a.length; _i++) {
        var scalar = _a[_i];
        var normalized = normalizeForGrouping(scalar);
        if (!normalized)
            continue;
        if (!fieldValues.has(field)) {
            fieldValues.set(field, new Map());
        }
        var values = fieldValues.get(field);
        var entry = values.get(normalized) || {
            canonical: scalar,
            canonicalCount: new Map(),
            sources: new Set([filename]),
        };
        var count = entry.canonicalCount.get(scalar) || 0;
        entry.canonicalCount.set(scalar, count + 1);
        entry.sources.add(filename);
        var bestCasing = entry.canonical;
        var bestCount = 0;
        for (var _b = 0, _c = entry.canonicalCount; _b < _c.length; _b++) {
            var _d = _c[_b], form = _d[0], formCount = _d[1];
            if (formCount > bestCount) {
                bestCount = formCount;
                bestCasing = form;
            }
        }
        entry.canonical = bestCasing;
        values.set(normalized, entry);
    }
}
function addInsuranceFields(side, insuranceValue, filename, fieldValues) {
    if (!insuranceValue || typeof insuranceValue !== "object")
        return;
    var claimNumber = insuranceValue.claim_number || insuranceValue.policy_number || insuranceValue.claimNo;
    if (claimNumber) {
        addFieldValue(fieldValues, "claim_number_".concat(side), claimNumber, filename);
    }
    var carrier = insuranceValue.carrier || insuranceValue.insurer || insuranceValue.insured_name;
    if (carrier) {
        addFieldValue(fieldValues, side === "1p" ? "wc_carrier" : "wc_carrier", carrier, filename);
    }
    var adjusterName = insuranceValue.adjuster_name || insuranceValue.adjuster;
    if (adjusterName) {
        addFieldValue(fieldValues, side === "1p" ? "adjuster_name_1p" : "adjuster_name_3p", adjusterName, filename);
    }
    var adjusterPhone = insuranceValue.adjuster_phone || insuranceValue.adjuster_phone_number;
    if (adjusterPhone) {
        addFieldValue(fieldValues, side === "1p" ? "adjuster_phone_1p" : "adjuster_phone_3p", adjusterPhone, filename);
    }
    var adjusterEmail = insuranceValue.adjuster_email || insuranceValue.adjuster_email_address;
    if (adjusterEmail) {
        addFieldValue(fieldValues, side === "1p" ? "adjuster_email_1p" : "adjuster_email_3p", adjusterEmail, filename);
    }
    if (carrier || insuranceValue.bodily_injury || insuranceValue.medical_payments || insuranceValue.um_uim || insuranceValue.property_damage) {
        var policyPayload = {};
        if (carrier)
            policyPayload.carrier = String(carrier).trim();
        if (insuranceValue.bodily_injury)
            policyPayload.bodily_injury = String(insuranceValue.bodily_injury).trim();
        if (insuranceValue.medical_payments)
            policyPayload.medical_payments = String(insuranceValue.medical_payments).trim();
        if (insuranceValue.um_uim)
            policyPayload.um_uim = String(insuranceValue.um_uim).trim();
        if (insuranceValue.property_damage)
            policyPayload.property_damage = String(insuranceValue.property_damage).trim();
        if (insuranceValue.policy_number)
            policyPayload.policy_number = String(insuranceValue.policy_number).trim();
        addFieldValue(fieldValues, side === "1p" ? "policy_limits_1p" : "policy_limits_3p", JSON.stringify(policyPayload), filename);
    }
}
function buildDeterministicHypergraph(documentIndex) {
    var _a, _b, _c, _d;
    var aliasMap = buildAliasReverseMap();
    var fieldValues = new Map();
    var addField = function (field, value, source) { return addFieldValue(fieldValues, field, value, source); };
    var rawFolders = documentIndex.folders || {};
    for (var _i = 0, _e = Object.entries(rawFolders); _i < _e.length; _i++) {
        var _f = _e[_i], _folderName = _f[0], folderData = _f[1];
        var files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
        if (!Array.isArray(files))
            continue;
        for (var _g = 0, files_3 = files; _g < files_3.length; _g++) {
            var file = files_3[_g];
            var filename = (file === null || file === void 0 ? void 0 : file.filename) || "unknown";
            var extracted = file === null || file === void 0 ? void 0 : file.extracted_data;
            if (!extracted || typeof extracted !== "object")
                continue;
            for (var _h = 0, _j = Object.entries(extracted); _h < _j.length; _h++) {
                var _k = _j[_h], key = _k[0], rawValue = _k[1];
                var hgField = aliasMap.get(key);
                if (hgField) {
                    addField(hgField, rawValue, filename);
                }
                if (typeof key === "string" && (key.startsWith("charges:") || key.startsWith("provider_charges:"))) {
                    addField(key, rawValue, filename);
                    continue;
                }
                if (key === "insurance_1p") {
                    addInsuranceFields("1p", rawValue, filename, fieldValues);
                    continue;
                }
                if (key === "insurance_3p") {
                    addInsuranceFields("3p", rawValue, filename, fieldValues);
                    continue;
                }
                if (key === "charges" || key === "provider_charges") {
                    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
                        for (var _l = 0, _m = Object.entries(rawValue); _l < _m.length; _l++) {
                            var _o = _m[_l], provider = _o[0], chargeValue = _o[1];
                            if (provider) {
                                addField("charges:".concat(provider), chargeValue, filename);
                            }
                        }
                    }
                    continue;
                }
                if (key === "health_insurance" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
                    addField("health_insurance", JSON.stringify(rawValue), filename);
                    continue;
                }
                if (key === "provider_balances" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
                    for (var _p = 0, _q = Object.entries(rawValue); _p < _q.length; _p++) {
                        var _r = _q[_p], provider = _r[0], balanceValue = _r[1];
                        addField("provider_balances:".concat(provider), balanceValue, filename);
                    }
                    continue;
                }
            }
        }
    }
    var hypergraph = {};
    var conflicts = [];
    for (var _s = 0, fieldValues_1 = fieldValues; _s < fieldValues_1.length; _s++) {
        var _t = fieldValues_1[_s], field = _t[0], valueMap = _t[1];
        var orderedValues = Array.from(valueMap.values()).map(function (entry) { return ({
            value: entry.canonical,
            sources: Array.from(entry.sources),
            count: entry.sources.size,
        }); });
        orderedValues.sort(function (a, b) { return b.count - a.count; });
        var totalMentions = orderedValues.reduce(function (sum, item) { return sum + item.count; }, 0);
        var topCount = ((_a = orderedValues[0]) === null || _a === void 0 ? void 0 : _a.count) || 0;
        var secondCount = ((_b = orderedValues[1]) === null || _b === void 0 ? void 0 : _b.count) || 0;
        var consensusValue = orderedValues.length > 1 && topCount === secondCount
            ? "UNCERTAIN"
            : (((_c = orderedValues[0]) === null || _c === void 0 ? void 0 : _c.value) || "");
        var confidence = totalMentions > 0 && consensusValue !== "UNCERTAIN"
            ? topCount / totalMentions
            : 0;
        hypergraph[field] = {
            values: orderedValues,
            consensus: consensusValue,
            confidence: confidence,
            has_conflict: orderedValues.length > 1,
        };
        if (orderedValues.length > 1) {
            var consensusSources = consensusValue === "UNCERTAIN" ? [] : (((_d = orderedValues[0]) === null || _d === void 0 ? void 0 : _d.sources) || []);
            for (var i = 0; i < orderedValues.length; i++) {
                if (i > 0 || consensusValue === "UNCERTAIN") {
                    var candidate = orderedValues[i];
                    conflicts.push({
                        field: field,
                        consensus_value: consensusValue,
                        consensus_sources: __spreadArray([], consensusSources, true),
                        outlier_value: candidate.value,
                        outlier_sources: __spreadArray([], candidate.sources, true),
                    });
                }
            }
        }
    }
    return {
        hypergraph: hypergraph,
        conflicts: conflicts.filter(function (item, idx, arr) {
            var key = "".concat(item.field, "|").concat(item.consensus_value, "|").concat(item.outlier_value);
            return arr.findIndex(function (other) { return "".concat(other.field, "|").concat(other.consensus_value, "|").concat(other.outlier_value) === key; }) === idx;
        }),
        summary: {
            total_fields_analyzed: Object.keys(hypergraph).length,
            fields_with_conflicts: Object.keys(hypergraph).filter(function (field) { var _a; return (_a = hypergraph[field]) === null || _a === void 0 ? void 0 : _a.has_conflict; }).length,
            confidence_score: Object.keys(hypergraph).length > 0
                ? Object.values(hypergraph).reduce(function (sum, node) { return sum + (node.confidence || 0); }, 0) / Object.keys(hypergraph).length
                : 0,
        },
    };
}
function buildHypergraphReviewPayload(hypergraph) {
    return {
        reviewTargets: Object.entries(hypergraph)
            .filter(function (_a) {
            var node = _a[1];
            return node.has_conflict || node.consensus === "UNCERTAIN";
        })
            .map(function (_a) {
            var field = _a[0], node = _a[1];
            return ({
                field: field,
                consensus: node.consensus,
                confidence: node.confidence,
                values: node.values,
            });
        }),
    };
}
function annotateConflictReasons(conflictMap, annotations) {
    var byField = new Map();
    for (var _i = 0, annotations_1 = annotations; _i < annotations_1.length; _i++) {
        var item = annotations_1[_i];
        var field = (item.field || "").trim();
        if (!field || !item.likely_reason)
            continue;
        byField.set(field, String(item.likely_reason).trim());
    }
    for (var _a = 0, _b = conflictMap.values(); _a < _b.length; _a++) {
        var conflict = _b[_a];
        var reason = byField.get(conflict.field);
        if (reason) {
            conflict.likely_reason = reason;
        }
    }
}
// Backward-compat helper: preserve old post-LMM augmentation path if needed.
// Keep existing augmentation helper for fallback-only scenarios and debugging.
function deprecatedAugmentHypergraphFromExtractedData(hypergraph, conflictMap, documentIndex) {
    augmentHypergraphFromExtractedData(hypergraph, conflictMap, documentIndex);
}
/**
 * Scan all extracted_data in the document index and augment the hypergraph
 * with accurate source counts. Then recompute consensus for each field.
 */
function augmentHypergraphFromExtractedData(hypergraph, conflictMap, documentIndex) {
    var _a, _b, _c, _d;
    var aliasMap = buildAliasReverseMap();
    // Collect: hgField → normalizedValue → { canonical: string (most common casing), sources: Set<filename> }
    var fieldValues = new Map();
    var rawFolders = documentIndex.folders || {};
    for (var _i = 0, _e = Object.entries(rawFolders); _i < _e.length; _i++) {
        var _f = _e[_i], _folderName = _f[0], folderData = _f[1];
        var files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
        if (!Array.isArray(files))
            continue;
        for (var _g = 0, files_4 = files; _g < files_4.length; _g++) {
            var file = files_4[_g];
            var filename = file === null || file === void 0 ? void 0 : file.filename;
            if (!filename || !(file === null || file === void 0 ? void 0 : file.extracted_data))
                continue;
            var ed = file.extracted_data;
            for (var _h = 0, _j = Object.entries(ed); _h < _j.length; _h++) {
                var _k = _j[_h], key = _k[0], rawValue = _k[1];
                var hgField = aliasMap.get(key);
                if (!hgField)
                    continue;
                // Only process string/number values
                var strValue = typeof rawValue === "string" ? rawValue.trim()
                    : typeof rawValue === "number" ? String(rawValue)
                        : null;
                if (!strValue)
                    continue;
                var normalized = normalizeForGrouping(strValue);
                if (!normalized)
                    continue;
                if (!fieldValues.has(hgField)) {
                    fieldValues.set(hgField, new Map());
                }
                var valMap = fieldValues.get(hgField);
                if (!valMap.has(normalized)) {
                    valMap.set(normalized, { canonical: strValue, canonicalCount: new Map([[strValue, 1]]), sources: new Set([filename]) });
                }
                else {
                    var entry = valMap.get(normalized);
                    entry.sources.add(filename);
                    // Track most common exact casing
                    entry.canonicalCount.set(strValue, (entry.canonicalCount.get(strValue) || 0) + 1);
                    // Update canonical to most frequent casing
                    var bestCount = 0;
                    for (var _l = 0, _m = entry.canonicalCount; _l < _m.length; _l++) {
                        var _o = _m[_l], form = _o[0], count = _o[1];
                        if (count > bestCount) {
                            bestCount = count;
                            entry.canonical = form;
                        }
                    }
                }
            }
        }
    }
    // Augment each hypergraph field with programmatic data
    for (var _p = 0, fieldValues_2 = fieldValues; _p < fieldValues_2.length; _p++) {
        var _q = fieldValues_2[_p], hgField = _q[0], valueMap = _q[1];
        if (!hypergraph[hgField]) {
            hypergraph[hgField] = { values: [], consensus: "", confidence: 0, has_conflict: false };
        }
        var node = hypergraph[hgField];
        // Build a normalized lookup for existing LLM values
        var existingByNorm = new Map(); // normalized → index in node.values
        for (var i = 0; i < node.values.length; i++) {
            existingByNorm.set(normalizeForGrouping(node.values[i].value), i);
        }
        // Merge programmatic values into the node
        for (var _r = 0, valueMap_1 = valueMap; _r < valueMap_1.length; _r++) {
            var _s = valueMap_1[_r], normalized = _s[0], entry = _s[1];
            var existingIdx = existingByNorm.get(normalized);
            if (existingIdx !== undefined) {
                // LLM already has this value — add any missing sources
                var existing = node.values[existingIdx];
                var sourceSet = new Set(existing.sources);
                for (var _t = 0, _u = entry.sources; _t < _u.length; _t++) {
                    var src = _u[_t];
                    sourceSet.add(src);
                }
                existing.sources = Array.from(sourceSet);
                existing.count = existing.sources.length;
            }
            else {
                // LLM missed this value entirely — add it
                node.values.push({
                    value: entry.canonical,
                    sources: Array.from(entry.sources),
                    count: entry.sources.size,
                });
            }
        }
        // Recompute consensus: sort by count desc, pick winner
        node.values.sort(function (a, b) { return b.count - a.count; });
        var totalMentions = node.values.reduce(function (sum, v) { return sum + v.count; }, 0);
        var topCount = ((_a = node.values[0]) === null || _a === void 0 ? void 0 : _a.count) || 0;
        var secondCount = ((_b = node.values[1]) === null || _b === void 0 ? void 0 : _b.count) || 0;
        // If tied at top, mark UNCERTAIN
        if (node.values.length > 1 && topCount === secondCount) {
            node.consensus = "UNCERTAIN";
            node.confidence = 0;
        }
        else {
            node.consensus = ((_c = node.values[0]) === null || _c === void 0 ? void 0 : _c.value) || "";
            node.confidence = totalMentions > 0 ? topCount / totalMentions : 0;
        }
        node.has_conflict = node.values.length > 1;
    }
    // Rebuild conflicts from augmented hypergraph
    conflictMap.clear();
    for (var _v = 0, _w = Object.entries(hypergraph); _v < _w.length; _v++) {
        var _x = _w[_v], field = _x[0], node = _x[1];
        if (!node.has_conflict || node.values.length < 2)
            continue;
        var consensusValue = node.consensus;
        var consensusSources = node.consensus !== "UNCERTAIN" ? ((_d = node.values[0]) === null || _d === void 0 ? void 0 : _d.sources) || [] : [];
        for (var i = (consensusValue === "UNCERTAIN" ? 0 : 1); i < node.values.length; i++) {
            var outlier = node.values[i];
            var key = "".concat(field, "|").concat(consensusValue, "|").concat(outlier.value);
            if (!conflictMap.has(key)) {
                conflictMap.set(key, {
                    field: field,
                    consensus_value: consensusValue,
                    consensus_sources: __spreadArray([], consensusSources, true),
                    outlier_value: outlier.value,
                    outlier_sources: __spreadArray([], outlier.sources, true),
                });
            }
        }
    }
    // Log augmentation results
    var augmentedFields = 0;
    for (var _y = 0, _z = Object.entries(hypergraph); _y < _z.length; _y++) {
        var _0 = _z[_y], field = _0[0], node = _0[1];
        if (fieldValues.has(field))
            augmentedFields++;
    }
    console.log("[Hypergraph] Programmatic augmentation: ".concat(augmentedFields, " fields cross-checked against extracted_data"));
}
// System prompt for hypergraph generation (Haiku) - Personal Injury
var hypergraphSystemPromptPI = "You are a data consistency analyzer for a Personal Injury law firm.\n\nYOUR TASK: Read a document index JSON and build a hypergraph that groups related data points across documents to identify inconsistencies.\n\nHYPERGRAPH STRUCTURE:\n- Each \"hyperedge\" groups all mentions of a semantic field (e.g., all dates of loss, all DOBs, all charges for a provider)\n- Nodes within a hyperedge should have the same value if extracted correctly\n- Inconsistencies = nodes in same hyperedge with different values\n\nFIELDS TO TRACK:\n1. date_of_loss / dol - The accident date (critical - appears in many docs)\n2. date_of_birth / dob - Client DOB\n3. client_name - Client's full name\n4. client_phone / phone - Client phone number (primarily in intake forms)\n5. client_email / email - Client email address (primarily in intake forms)\n6. client_address / address - Client mailing address (primarily in intake forms)\n7. claim_number_1p - First party claim number (from insurance_1p.claim_number)\n8. claim_number_3p - Third party claim number (from insurance_3p.claim_number)\n9. policy_limits_1p - Client's own policy limits. Look for insurance_1p object with:\n   - carrier, bodily_injury, medical_payments, um_uim, property_damage\n   - Output as JSON object: {\"carrier\": \"X\", \"bodily_injury\": \"Y\", ...}\n10. policy_limits_3p - At-fault party's policy limits. Look for insurance_3p object with:\n    - carrier, bodily_injury, property_damage, insured_name\n    - Output as JSON object: {\"carrier\": \"X\", \"bodily_injury\": \"Y\", ...}\n11. charges - Medical charges by provider. Use field name format \"charges:Provider Name\" (e.g., \"charges:Spinal Rehab Center\")\n12. provider_balances - Outstanding balances by provider\n13. total_medical - Total medical specials\n14. health_insurance - Look for health_insurance object with carrier, group_no, member_no\n    - Output as JSON object: {\"carrier\": \"X\", \"group_no\": \"Y\", \"member_no\": \"Z\"}\n15. adjuster_name_3p - Third party (at-fault carrier) adjuster name. Look in insurance_3p.adjuster_name\n16. adjuster_phone_3p - Third party adjuster phone. Look in insurance_3p.adjuster_phone\n17. adjuster_email_3p - Third party adjuster email. Look in insurance_3p.adjuster_email\n18. adjuster_name_1p - First party (client's carrier) adjuster name. Look in insurance_1p.adjuster_name\n19. adjuster_phone_1p - First party adjuster phone. Look in insurance_1p.adjuster_phone\n20. adjuster_email_1p - First party adjuster email. Look in insurance_1p.adjuster_email\n    - NOTE: If adjuster_name/phone/email appear at top level (not inside insurance_1p/3p), treat them as 3P adjuster info\n\nANALYSIS RULES:\n1. Normalize values for comparison:\n   - Dates: treat \"6/25/2023\", \"06/25/2023\", \"6/25/23\" as equivalent\n   - Money: treat \"$6,558\", \"6558\", \"6,558.00\" as equivalent\n   - Names: ignore minor variations (case, spacing)\n2. Count how many documents support each value\n3. Majority value = consensus (higher confidence)\n4. Flag outliers with their source documents\n\nHANDLING UNCERTAINTY:\n- If document counts are EQUAL (e.g., 1:1 or 2:2), do NOT declare a consensus. Set consensus to \"UNCERTAIN\" and confidence to 0.\n- Do NOT guess which document is \"more authoritative\" or \"more recent\" - that's not your job.\n- Resolve conflicts where there is clear majority evidence. Identifying uncertainty where it exists is a success condition.\n\nOUTPUT FORMAT - Return ONLY valid JSON:\n{\n  \"hypergraph\": {\n    \"<field_name>\": {\n      \"values\": [\n        { \"value\": \"<normalized_value>\", \"sources\": [\"file1.pdf\", \"file2.pdf\"], \"count\": 2 }\n      ],\n      \"consensus\": \"<majority_value>\",\n      \"confidence\": 0.95,\n      \"has_conflict\": true|false\n    }\n  },\n  \"conflicts\": [\n    {\n      \"field\": \"<field_name>\",\n      \"consensus_value\": \"<majority_value>\",\n      \"consensus_sources\": [\"file1.pdf\", \"file2.pdf\"],\n      \"outlier_value\": \"<different_value>\",\n      \"outlier_sources\": [\"file3.pdf\"],\n      \"likely_reason\": \"<optional explanation if obvious, e.g., 'signature date vs accident date'>\"\n    }\n  ],\n  \"summary\": {\n    \"total_fields_analyzed\": 8,\n    \"fields_with_conflicts\": 2,\n    \"confidence_score\": 0.85\n  }\n}\n\nIMPORTANT:\n- Return ONLY the JSON object, no markdown, no explanation\n- Only include fields that have actual data in the index\n- For provider-specific fields, use format \"charges:<provider_name>\"\n- If a field appears in only one document, confidence is lower but no conflict";
// System prompt for hypergraph generation (Haiku) - Workers' Compensation
var hypergraphSystemPromptWC = "You are a data consistency analyzer for a Workers' Compensation law firm.\n\nYOUR TASK: Read a document index JSON and build a hypergraph that groups related data points across documents to identify inconsistencies.\n\nHYPERGRAPH STRUCTURE:\n- Each \"hyperedge\" groups all mentions of a semantic field (e.g., all dates of injury, all DOBs, all AMW values)\n- Nodes within a hyperedge should have the same value if extracted correctly\n- Inconsistencies = nodes in same hyperedge with different values\n\nFIELDS TO TRACK:\n1. date_of_injury / doi - The work injury date (critical - appears in many docs)\n2. date_of_birth / dob - Client DOB\n3. client_name / claimant_name - Client's full name\n4. client_phone / phone - Client phone number\n5. client_email / email - Client email address\n6. client_address / address - Client mailing address\n7. employer_name / employer - Employer company name (critical for WC)\n8. employer_address - Employer address\n9. employer_phone - Employer phone\n10. job_title - Client's job title/position\n11. wc_carrier / wc_insurance_carrier - Workers' comp insurance carrier name\n12. wc_claim_number / claim_number - WC claim number\n13. tpa_name / third_party_administrator - Third Party Administrator (e.g., CCMSI)\n14. adjuster_name - Claims adjuster name\n15. adjuster_phone - Claims adjuster phone\n16. amw / average_monthly_wage - Average Monthly Wage (critical for benefits calculation)\n17. compensation_rate / weekly_compensation_rate - Weekly benefit rate\n18. disability_type - TTD/TPD/PPD/PTD status\n19. injury_description - Description of injury mechanism\n20. body_parts / body_parts_injured - Affected body parts\n21. providers - Treating physicians/facilities\n22. mmi_date - Maximum Medical Improvement date\n23. ppd_rating - Permanent Partial Disability rating percentage\n\nANALYSIS RULES:\n1. Normalize values for comparison:\n   - Dates: treat \"6/25/2023\", \"06/25/2023\", \"6/25/23\" as equivalent\n   - Money: treat \"$6,558\", \"6558\", \"6,558.00\" as equivalent\n   - Names: ignore minor variations (case, spacing)\n   - Employer: \"Caesars Palace\" = \"CAESARS PALACE\" = \"Caesar's Palace\"\n2. Count how many documents support each value\n3. Majority value = consensus (higher confidence)\n4. Flag outliers with their source documents\n\nHANDLING UNCERTAINTY:\n- If document counts are EQUAL (e.g., 1:1 or 2:2), do NOT declare a consensus. Set consensus to \"UNCERTAIN\" and confidence to 0.\n- Do NOT guess which document is \"more authoritative\" or \"more recent\" - that's not your job.\n- AMW and compensation_rate conflicts are CRITICAL - always flag them.\n\nOUTPUT FORMAT - Return ONLY valid JSON:\n{\n  \"hypergraph\": {\n    \"<field_name>\": {\n      \"values\": [\n        { \"value\": \"<normalized_value>\", \"sources\": [\"file1.pdf\", \"file2.pdf\"], \"count\": 2 }\n      ],\n      \"consensus\": \"<majority_value>\",\n      \"confidence\": 0.95,\n      \"has_conflict\": true|false\n    }\n  },\n  \"conflicts\": [\n    {\n      \"field\": \"<field_name>\",\n      \"consensus_value\": \"<majority_value>\",\n      \"consensus_sources\": [\"file1.pdf\", \"file2.pdf\"],\n      \"outlier_value\": \"<different_value>\",\n      \"outlier_sources\": [\"file3.pdf\"],\n      \"likely_reason\": \"<optional explanation>\"\n    }\n  ],\n  \"summary\": {\n    \"total_fields_analyzed\": 8,\n    \"fields_with_conflicts\": 2,\n    \"confidence_score\": 0.85\n  }\n}\n\nIMPORTANT:\n- Return ONLY the JSON object, no markdown, no explanation\n- Only include fields that have actual data in the index\n- AMW and compensation_rate are CRITICAL for WC - always extract if present\n- If a field appears in only one document, confidence is lower but no conflict";
// Helper to get the right hypergraph prompt based on practice area
function getHypergraphPrompt(practiceArea) {
    if (practiceArea === practice_areas_1.PRACTICE_AREAS.WC) {
        return hypergraphSystemPromptWC;
    }
    return hypergraphSystemPromptPI;
}
function generateHypergraph(caseFolder, documentIndex, practiceArea) {
    return __awaiter(this, void 0, void 0, function () {
        var usage, deterministic, fields, mergedHypergraph, conflictMap, _i, _a, conflict, key, reviewTargets, payloadJson, llmReview, error_6, fieldsWithConflicts, avgConfidence, result;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log("\n========== GENERATING HYPERGRAPH (".concat(practiceArea || 'PI', ") =========="));
                    usage = {
                        inputTokens: 0,
                        inputTokensNew: 0,
                        inputTokensCacheWrite: 0,
                        inputTokensCacheRead: 0,
                        outputTokens: 0,
                        apiCalls: 0,
                        model: 'groq'
                    };
                    deterministic = buildDeterministicHypergraph(documentIndex);
                    fields = Object.keys(deterministic.hypergraph);
                    mergedHypergraph = deterministic.hypergraph;
                    conflictMap = new Map();
                    for (_i = 0, _a = deterministic.conflicts; _i < _a.length; _i++) {
                        conflict = _a[_i];
                        key = "".concat(conflict.field, "|").concat(conflict.consensus_value, "|").concat(conflict.outlier_value);
                        if (!conflictMap.has(key)) {
                            conflictMap.set(key, __assign({}, conflict));
                        }
                    }
                    reviewTargets = buildHypergraphReviewPayload(mergedHypergraph);
                    if (!(reviewTargets.reviewTargets.length > 0)) return [3 /*break*/, 4];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    payloadJson = JSON.stringify(reviewTargets, null, 2);
                    return [4 /*yield*/, (0, groq_extract_1.generateHypergraphConflictReviewWithGptOss)(payloadJson)];
                case 2:
                    llmReview = _b.sent();
                    usage.inputTokensNew += llmReview.usage.inputTokens;
                    usage.outputTokens += llmReview.usage.outputTokens;
                    usage.apiCalls += 1;
                    annotateConflictReasons(conflictMap, llmReview.result.annotations);
                    console.log("[Hypergraph] Reviewed ".concat(reviewTargets.reviewTargets.length, " uncertain/conflict candidates with LLM"));
                    return [3 /*break*/, 4];
                case 3:
                    error_6 = _b.sent();
                    console.warn("[Hypergraph] Conflict review call failed; proceeding without generated reasons", error_6);
                    return [3 /*break*/, 4];
                case 4:
                    usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
                    // Optional fallback path for diagnostics
                    if (process.env.HYPERGRAPH_USE_LLm_AUGMENT === "true") {
                        deprecatedAugmentHypergraphFromExtractedData(mergedHypergraph, conflictMap, documentIndex);
                    }
                    fieldsWithConflicts = fields.filter(function (field) { return mergedHypergraph[field].has_conflict; }).length;
                    avgConfidence = fields.length > 0
                        ? fields.reduce(function (sum, field) { return sum + (mergedHypergraph[field].confidence || 0); }, 0) / fields.length
                        : 0;
                    result = {
                        hypergraph: mergedHypergraph,
                        conflicts: Array.from(conflictMap.values()),
                        summary: {
                            total_fields_analyzed: fields.length,
                            fields_with_conflicts: fieldsWithConflicts,
                            confidence_score: avgConfidence,
                        },
                        usage: usage,
                    };
                    console.log("Hypergraph generated (Groq GPT-OSS):");
                    console.log("  Fields analyzed: ".concat(result.summary.total_fields_analyzed));
                    console.log("  Conflicts found: ".concat(result.summary.fields_with_conflicts));
                    console.log("  Confidence: ".concat((result.summary.confidence_score * 100).toFixed(0), "%"));
                    console.log("  Usage: ".concat(usage.inputTokens.toLocaleString(), " in / ").concat(usage.outputTokens.toLocaleString(), " out"));
                    console.log("==========================================\n");
                    return [2 /*return*/, result];
            }
        });
    });
}
// Endpoint to generate hypergraph for a case (for testing)
app.post("/generate-hypergraph", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var caseFolder, indexPath, indexContent, documentIndex, practiceArea, hypergraph, error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                caseFolder = (_a.sent()).caseFolder;
                if (!caseFolder) {
                    return [2 /*return*/, c.json({ error: "caseFolder is required" }, 400)];
                }
                indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                _a.label = 2;
            case 2:
                _a.trys.push([2, 5, , 6]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 3:
                indexContent = _a.sent();
                documentIndex = JSON.parse(indexContent);
                practiceArea = documentIndex.practice_area;
                return [4 /*yield*/, generateHypergraph(caseFolder, documentIndex, practiceArea)];
            case 4:
                hypergraph = _a.sent();
                return [2 /*return*/, c.json(__assign({ success: true, caseFolder: caseFolder }, hypergraph))];
            case 5:
                error_7 = _a.sent();
                console.error("Hypergraph generation error:", error_7);
                return [2 /*return*/, c.json({
                        success: false,
                        error: error_7 instanceof Error ? error_7.message : String(error_7),
                    }, 500)];
            case 6: return [2 /*return*/];
        }
    });
}); });
function normalizeScopeAssignments(input) {
    if (!Array.isArray(input))
        return [];
    return input.filter(function (assignment) {
        return !!assignment &&
            typeof assignment === "object" &&
            typeof assignment.userId === "string";
    });
}
function isVisibleInScope(assignments, scope, actorUserId) {
    if (scope.mode === "firm")
        return true;
    if (scope.mode === "mine") {
        return assignments.some(function (assignment) { return assignment.userId === actorUserId; });
    }
    return assignments.some(function (assignment) { return assignment.userId === scope.memberId; });
}
function defaultScopeForRole(role) {
    if (role === "case_manager") {
        return { mode: "mine" };
    }
    return { mode: "firm" };
}
function resolveFirmChatScope(rawScope, context, teamMemberIds) {
    var fallback = defaultScopeForRole(context.role);
    if (!rawScope || typeof rawScope !== "object") {
        return { ok: true, scope: fallback };
    }
    var scopeInput = rawScope;
    var mode = scopeInput.mode;
    if (mode === "mine") {
        return { ok: true, scope: { mode: "mine" } };
    }
    if (mode === "member") {
        if (!context.permissions.canManageTeam) {
            return { ok: false, error: "insufficient_permissions" };
        }
        if (!scopeInput.memberId || !teamMemberIds.has(scopeInput.memberId)) {
            return { ok: false, error: "invalid_member_scope" };
        }
        return { ok: true, scope: { mode: "member", memberId: scopeInput.memberId } };
    }
    if (mode === "firm") {
        if (!context.permissions.canViewAllCases) {
            return { ok: true, scope: { mode: "mine" } };
        }
        return { ok: true, scope: { mode: "firm" } };
    }
    return { ok: true, scope: fallback };
}
// Build aggregated firm context from case summaries
function buildFirmContext(root, scope, actorUserId, memberById) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, caseSummaries, casesByPhase, totalSpecials, solUrgent, indexedCount, visibleCaseCount, _i, entries_7, entry, casePath, indexPath, indexContent, index, assignments, parseAmount_1, clientName, casePhase, dateOfLoss, specials, solDaysRemaining, statuteOfLimitations, dolDate, solDate, solDate, now, diffMs, providers, policyLimits, limits, biValue, assignedTo, _a;
        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        return __generator(this, function (_o) {
            switch (_o.label) {
                case 0: return [4 /*yield*/, (0, promises_1.readdir)(root, { withFileTypes: true })];
                case 1:
                    entries = _o.sent();
                    caseSummaries = [];
                    casesByPhase = {};
                    totalSpecials = 0;
                    solUrgent = 0;
                    indexedCount = 0;
                    visibleCaseCount = 0;
                    _i = 0, entries_7 = entries;
                    _o.label = 2;
                case 2:
                    if (!(_i < entries_7.length)) return [3 /*break*/, 7];
                    entry = entries_7[_i];
                    if (!entry.isDirectory() || entry.name === ".ai_tool")
                        return [3 /*break*/, 6];
                    casePath = (0, path_1.join)(root, entry.name);
                    indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                    _o.label = 3;
                case 3:
                    _o.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 4:
                    indexContent = _o.sent();
                    index = JSON.parse(indexContent);
                    assignments = normalizeScopeAssignments(index.assignments);
                    if (!isVisibleInScope(assignments, scope, actorUserId)) {
                        return [3 /*break*/, 6];
                    }
                    visibleCaseCount++;
                    indexedCount++;
                    parseAmount_1 = function (val) {
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            var cleaned = val.replace(/[$,]/g, '');
                            var num = parseFloat(cleaned);
                            return isNaN(num) ? 0 : num;
                        }
                        return 0;
                    };
                    clientName = ((_b = index.summary) === null || _b === void 0 ? void 0 : _b.client) || index.client_name || ((_c = index.case_name) === null || _c === void 0 ? void 0 : _c.split(" v.")[0]) || entry.name;
                    casePhase = index.case_phase || ((_d = index.summary) === null || _d === void 0 ? void 0 : _d.case_phase) || "Unknown";
                    dateOfLoss = ((_e = index.summary) === null || _e === void 0 ? void 0 : _e.dol) || index.date_of_loss || "";
                    specials = parseAmount_1(index.total_specials)
                        || parseAmount_1((_f = index.summary) === null || _f === void 0 ? void 0 : _f.total_specials)
                        || parseAmount_1((_g = index.summary) === null || _g === void 0 ? void 0 : _g.total_charges)
                        || 0;
                    solDaysRemaining = void 0;
                    statuteOfLimitations = index.statute_of_limitations || ((_h = index.summary) === null || _h === void 0 ? void 0 : _h.statute_of_limitations);
                    if (!statuteOfLimitations && dateOfLoss) {
                        dolDate = (0, date_format_1.parseFlexibleDate)(dateOfLoss);
                        if (dolDate) {
                            solDate = new Date(dolDate);
                            solDate.setFullYear(solDate.getFullYear() + 2);
                            statuteOfLimitations = (0, date_format_1.formatDateYYYYMMDD)(solDate);
                        }
                    }
                    if (statuteOfLimitations) {
                        solDate = new Date(statuteOfLimitations);
                        now = new Date();
                        diffMs = solDate.getTime() - now.getTime();
                        solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        if (solDaysRemaining <= 90)
                            solUrgent++;
                    }
                    providers = [];
                    if (index.providers) {
                        providers = Array.isArray(index.providers)
                            ? index.providers.map(function (p) { return typeof p === 'string' ? p : p.name; })
                            : Object.keys(index.providers);
                    }
                    else if ((_j = index.summary) === null || _j === void 0 ? void 0 : _j.providers) {
                        providers = index.summary.providers;
                    }
                    policyLimits = void 0;
                    limits = index.policy_limits || ((_k = index.summary) === null || _k === void 0 ? void 0 : _k.policy_limits);
                    if (typeof limits === 'string') {
                        policyLimits = limits;
                    }
                    else if (typeof limits === 'object' && limits !== null) {
                        biValue = limits['3P_bi'] || limits['3p_bi'] || limits['bi'] || limits['bodily_injury']
                            || ((_l = limits['3P']) === null || _l === void 0 ? void 0 : _l.bodily_injury) || ((_m = limits['3p']) === null || _m === void 0 ? void 0 : _m.bodily_injury);
                        if (typeof biValue === 'string')
                            policyLimits = biValue;
                    }
                    // Track phase counts
                    casesByPhase[casePhase] = (casesByPhase[casePhase] || 0) + 1;
                    totalSpecials += specials;
                    assignedTo = assignments.map(function (assignment) {
                        var member = memberById.get(assignment.userId);
                        if (!member)
                            return assignment.userId;
                        return member.name ? "".concat(member.name, " (").concat(member.email, ")") : member.email;
                    });
                    caseSummaries.push({
                        name: entry.name,
                        clientName: clientName,
                        casePhase: casePhase,
                        dateOfLoss: dateOfLoss,
                        totalSpecials: specials,
                        solDaysRemaining: solDaysRemaining,
                        providers: providers,
                        policyLimits: policyLimits,
                        assignedTo: assignedTo,
                    });
                    return [3 /*break*/, 6];
                case 5:
                    _a = _o.sent();
                    // Case not indexed
                    if (scope.mode === "firm") {
                        visibleCaseCount++;
                    }
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7:
                    // Sort by SOL urgency
                    caseSummaries.sort(function (a, b) {
                        if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
                            return a.solDaysRemaining - b.solDaysRemaining;
                        }
                        if (a.solDaysRemaining !== undefined)
                            return -1;
                        if (b.solDaysRemaining !== undefined)
                            return 1;
                        return a.clientName.localeCompare(b.clientName);
                    });
                    return [2 /*return*/, {
                            root: root,
                            caseCount: visibleCaseCount,
                            indexedCount: indexedCount,
                            caseSummaries: caseSummaries,
                            aggregates: {
                                totalSpecials: totalSpecials,
                                casesByPhase: casesByPhase,
                                solUrgent: solUrgent,
                            },
                        }];
            }
        });
    });
}
// Cache the firm system prompt
var firmSystemPromptCache = null;
function loadFirmSystemPrompt() {
    return __awaiter(this, void 0, void 0, function () {
        var systemPromptPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (firmSystemPromptCache)
                        return [2 /*return*/, firmSystemPromptCache];
                    systemPromptPath = (0, path_1.join)(import.meta.dir, "../../agent/firm-system-prompt.md");
                    return [4 /*yield*/, (0, promises_1.readFile)(systemPromptPath, "utf-8")];
                case 1:
                    firmSystemPromptCache = _a.sent();
                    return [2 /*return*/, firmSystemPromptCache];
            }
        });
    });
}
// Firm-level chat endpoint
app.post("/chat", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, message, providedSessionId, rawScope, access, activeMembers, scopedMemberIds, scopeResult, scope, memberById, systemPrompt, sessionId, _b, firmContext, scopeLabel, contextString, promptWithContext;
    var _c, _d;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _e.sent(), root = _a.root, message = _a.message, providedSessionId = _a.sessionId, rawScope = _a.scope;
                if (!root || !message) {
                    return [2 /*return*/, c.json({ error: "root and message required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _e.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                activeMembers = access.team.members.filter(function (member) { return member.status === "active"; });
                scopedMemberIds = new Set(activeMembers
                    .filter(function (member) { return member.role === "case_manager" || member.role === "case_manager_assistant"; })
                    .map(function (member) { return member.id; }));
                scopeResult = resolveFirmChatScope(rawScope, access.context, scopedMemberIds);
                if (!scopeResult.ok) {
                    return [2 /*return*/, c.json({ error: scopeResult.error }, 403)];
                }
                scope = scopeResult.scope;
                memberById = new Map(activeMembers.map(function (member) { return [member.id, { id: member.id, email: member.email, name: member.name }]; }));
                return [4 /*yield*/, loadFirmSystemPrompt()];
            case 3:
                systemPrompt = _e.sent();
                _b = providedSessionId;
                if (_b) return [3 /*break*/, 5];
                return [4 /*yield*/, (0, sessions_1.getFirmSession)(root)];
            case 4:
                _b = (_e.sent());
                _e.label = 5;
            case 5:
                sessionId = _b;
                return [4 /*yield*/, buildFirmContext(root, scope, access.context.userId, memberById)];
            case 6:
                firmContext = _e.sent();
                scopeLabel = scope.mode === "firm"
                    ? "firm"
                    : scope.mode === "mine"
                        ? "my cases"
                        : "".concat(((_c = memberById.get(scope.memberId)) === null || _c === void 0 ? void 0 : _c.name) || ((_d = memberById.get(scope.memberId)) === null || _d === void 0 ? void 0 : _d.email) || "selected team member", "'s cases");
                contextString = "\nFIRM PORTFOLIO CONTEXT:\n- Active Scope: ".concat(scopeLabel, "\n- Total Cases: ").concat(firmContext.caseCount, "\n- Indexed Cases: ").concat(firmContext.indexedCount, "\n- Total Medical Specials: $").concat(firmContext.aggregates.totalSpecials.toLocaleString(), "\n- Cases with SOL < 90 days: ").concat(firmContext.aggregates.solUrgent, "\n\nCASES BY PHASE:\n").concat(Object.entries(firmContext.aggregates.casesByPhase).map(function (_a) {
                    var phase = _a[0], count = _a[1];
                    return "- ".concat(phase, ": ").concat(count);
                }).join('\n'), "\n\nCASE SUMMARIES (sorted by SOL urgency):\n").concat(firmContext.caseSummaries.map(function (c) { return "\n- **".concat(c.clientName, "** (").concat(c.name, ")\n  Phase: ").concat(c.casePhase, " | DOL: ").concat(c.dateOfLoss || 'Unknown', " | Specials: $").concat(c.totalSpecials.toLocaleString(), "\n  SOL: ").concat(c.solDaysRemaining !== undefined ? "".concat(c.solDaysRemaining, " days remaining") : 'Unknown', "\n  Policy: ").concat(c.policyLimits || 'Unknown', " | Providers: ").concat(c.providers.length > 0 ? c.providers.join(', ') : 'None listed', " | Assigned: ").concat(c.assignedTo.length > 0 ? c.assignedTo.join(', ') : 'Unassigned', "\n"); }).join(''), "\n\nUSER QUESTION: ");
                promptWithContext = contextString + message;
                return [2 /*return*/, (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(void 0, void 0, void 0, function () {
                        var currentSessionId, _a, _b, _c, msg, _i, _d, block, text, isCompactionMessage, e_1_1, error_8;
                        var _e, e_1, _f, _g;
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0:
                                    _h.trys.push([0, 24, , 26]);
                                    currentSessionId = void 0;
                                    _h.label = 1;
                                case 1:
                                    _h.trys.push([1, 15, 16, 21]);
                                    _a = true, _b = __asyncValues((0, claude_agent_sdk_1.query)({
                                        prompt: promptWithContext,
                                        options: __assign({ cwd: root, systemPrompt: systemPrompt, resume: sessionId || undefined, allowedTools: [], permissionMode: "acceptEdits", maxTurns: 5 }, (0, sdk_cli_options_1.getSDKCliOptions)()),
                                    }));
                                    _h.label = 2;
                                case 2: return [4 /*yield*/, _b.next()];
                                case 3:
                                    if (!(_c = _h.sent(), _e = _c.done, !_e)) return [3 /*break*/, 14];
                                    _g = _c.value;
                                    _a = false;
                                    msg = _g;
                                    if (!(msg.type === "system" && msg.subtype === "init")) return [3 /*break*/, 5];
                                    currentSessionId = msg.session_id;
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({ type: "init", sessionId: msg.session_id }),
                                        })];
                                case 4:
                                    _h.sent();
                                    return [3 /*break*/, 13];
                                case 5:
                                    if (!(msg.type === "assistant")) return [3 /*break*/, 11];
                                    _i = 0, _d = msg.message.content;
                                    _h.label = 6;
                                case 6:
                                    if (!(_i < _d.length)) return [3 /*break*/, 11];
                                    block = _d[_i];
                                    if (!(block.type === "text")) return [3 /*break*/, 10];
                                    text = block.text.toLowerCase();
                                    isCompactionMessage = text.includes("prompt is too long") ||
                                        text.includes("process exited with code 1") ||
                                        text.includes("compacting conversation") ||
                                        text.includes("conversation has been compacted") ||
                                        text.includes("summarizing the conversation");
                                    if (!isCompactionMessage) return [3 /*break*/, 8];
                                    // Send compaction event instead of text (for UI indicator)
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({ type: "compaction" }),
                                        })];
                                case 7:
                                    // Send compaction event instead of text (for UI indicator)
                                    _h.sent();
                                    return [3 /*break*/, 10];
                                case 8: return [4 /*yield*/, stream.writeSSE({
                                        data: JSON.stringify({ type: "text", content: block.text }),
                                    })];
                                case 9:
                                    _h.sent();
                                    _h.label = 10;
                                case 10:
                                    _i++;
                                    return [3 /*break*/, 6];
                                case 11:
                                    if (!(msg.type === "result")) return [3 /*break*/, 13];
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "done",
                                                success: msg.subtype === "success",
                                                sessionId: msg.session_id,
                                            }),
                                        })];
                                case 12:
                                    _h.sent();
                                    _h.label = 13;
                                case 13:
                                    _a = true;
                                    return [3 /*break*/, 2];
                                case 14: return [3 /*break*/, 21];
                                case 15:
                                    e_1_1 = _h.sent();
                                    e_1 = { error: e_1_1 };
                                    return [3 /*break*/, 21];
                                case 16:
                                    _h.trys.push([16, , 19, 20]);
                                    if (!(!_a && !_e && (_f = _b.return))) return [3 /*break*/, 18];
                                    return [4 /*yield*/, _f.call(_b)];
                                case 17:
                                    _h.sent();
                                    _h.label = 18;
                                case 18: return [3 /*break*/, 20];
                                case 19:
                                    if (e_1) throw e_1.error;
                                    return [7 /*endfinally*/];
                                case 20: return [7 /*endfinally*/];
                                case 21:
                                    if (!currentSessionId) return [3 /*break*/, 23];
                                    return [4 /*yield*/, (0, sessions_1.saveFirmSession)(root, currentSessionId)];
                                case 22:
                                    _h.sent();
                                    _h.label = 23;
                                case 23: return [3 /*break*/, 26];
                                case 24:
                                    error_8 = _h.sent();
                                    console.error("Firm chat error:", error_8);
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "error",
                                                error: error_8 instanceof Error ? error_8.message : String(error_8),
                                            }),
                                        })];
                                case 25:
                                    _h.sent();
                                    return [3 /*break*/, 26];
                                case 26: return [2 /*return*/];
                            }
                        });
                    }); })];
        }
    });
}); });
// Direct firm chat - lightweight Haiku-based chat with tools
app.post("/direct-chat", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, message, _b, history, rawScope, access, activeMembers, scopedMemberIds, scopeResult;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _c.sent(), root = _a.root, message = _a.message, _b = _a.history, history = _b === void 0 ? [] : _b, rawScope = _a.scope;
                if (!root || !message) {
                    return [2 /*return*/, c.json({ error: "root and message required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _c.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                activeMembers = access.team.members.filter(function (member) { return member.status === "active"; });
                scopedMemberIds = new Set(activeMembers
                    .filter(function (member) { return member.role === "case_manager" || member.role === "case_manager_assistant"; })
                    .map(function (member) { return member.id; }));
                scopeResult = resolveFirmChatScope(rawScope, access.context, scopedMemberIds);
                if (!scopeResult.ok) {
                    return [2 /*return*/, c.json({ error: scopeResult.error }, 403)];
                }
                return [2 /*return*/, (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(void 0, void 0, void 0, function () {
                        var _a, _b, _c, event_1, totalTokens, e_2_1, error_9;
                        var _d, e_2, _e, _f;
                        return __generator(this, function (_g) {
                            switch (_g.label) {
                                case 0:
                                    _g.trys.push([0, 14, , 16]);
                                    _g.label = 1;
                                case 1:
                                    _g.trys.push([1, 7, 8, 13]);
                                    _a = true, _b = __asyncValues((0, firm_chat_1.directFirmChat)(root, message, history, {
                                        scope: scopeResult.scope,
                                        actorUserId: access.context.userId,
                                        teamMembers: activeMembers.map(function (member) { return ({
                                            id: member.id,
                                            email: member.email,
                                            name: member.name,
                                        }); }),
                                    }));
                                    _g.label = 2;
                                case 2: return [4 /*yield*/, _b.next()];
                                case 3:
                                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 6];
                                    _f = _c.value;
                                    _a = false;
                                    event_1 = _f;
                                    // Report usage when done
                                    if (event_1.type === "done" && event_1.usage) {
                                        totalTokens = (event_1.usage.inputTokens || 0) + (event_1.usage.outputTokens || 0);
                                        if (totalTokens > 0) {
                                            reportUsage(totalTokens, "firm_chat").catch(function () { });
                                        }
                                    }
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify(event_1)
                                        })];
                                case 4:
                                    _g.sent();
                                    _g.label = 5;
                                case 5:
                                    _a = true;
                                    return [3 /*break*/, 2];
                                case 6: return [3 /*break*/, 13];
                                case 7:
                                    e_2_1 = _g.sent();
                                    e_2 = { error: e_2_1 };
                                    return [3 /*break*/, 13];
                                case 8:
                                    _g.trys.push([8, , 11, 12]);
                                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 10];
                                    return [4 /*yield*/, _e.call(_b)];
                                case 9:
                                    _g.sent();
                                    _g.label = 10;
                                case 10: return [3 /*break*/, 12];
                                case 11:
                                    if (e_2) throw e_2.error;
                                    return [7 /*endfinally*/];
                                case 12: return [7 /*endfinally*/];
                                case 13: return [3 /*break*/, 16];
                                case 14:
                                    error_9 = _g.sent();
                                    console.error("Direct firm chat error:", error_9);
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "error",
                                                error: error_9 instanceof Error ? error_9.message : String(error_9),
                                            }),
                                        })];
                                case 15:
                                    _g.sent();
                                    return [3 /*break*/, 16];
                                case 16: return [2 /*return*/];
                            }
                        });
                    }); })];
        }
    });
}); });
// Clear firm session
app.post("/clear-session", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, access;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                root = (_a.sent()).root;
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root is required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                return [4 /*yield*/, (0, sessions_1.saveFirmSession)(root, "")];
            case 3:
                _a.sent();
                return [2 /*return*/, c.json({ success: true })];
        }
    });
}); });
var FIRM_DIR = ".ai_tool";
// Get firm todos
app.get("/todos", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, access, todosPath, content, data, _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 1:
                access = _b.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                _b.label = 2;
            case 2:
                _b.trys.push([2, 4, , 5]);
                todosPath = (0, path_1.join)(root, FIRM_DIR, "todos.json");
                return [4 /*yield*/, (0, promises_1.readFile)(todosPath, "utf-8")];
            case 3:
                content = _b.sent();
                data = JSON.parse(content);
                return [2 /*return*/, c.json(data)];
            case 4:
                _a = _b.sent();
                // No todos file yet
                return [2 /*return*/, c.json({ updated_at: new Date().toISOString(), todos: [] })];
            case 5: return [2 /*return*/];
        }
    });
}); });
// Save firm todos
app.post("/todos", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, todos, access, dir, todosPath, data, error_10;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _b.sent(), root = _a.root, todos = _a.todos;
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root is required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _b.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                _b.label = 3;
            case 3:
                _b.trys.push([3, 6, , 7]);
                dir = (0, path_1.join)(root, FIRM_DIR);
                todosPath = (0, path_1.join)(dir, "todos.json");
                return [4 /*yield*/, (0, promises_1.mkdir)(dir, { recursive: true })];
            case 4:
                _b.sent();
                data = {
                    updated_at: new Date().toISOString(),
                    todos: todos || [],
                };
                return [4 /*yield*/, (0, promises_1.writeFile)(todosPath, JSON.stringify(data, null, 2))];
            case 5:
                _b.sent();
                return [2 /*return*/, c.json({ success: true })];
            case 6:
                error_10 = _b.sent();
                console.error("Save todos error:", error_10);
                return [2 /*return*/, c.json({
                        error: error_10 instanceof Error ? error_10.message : String(error_10),
                    }, 500)];
            case 7: return [2 /*return*/];
        }
    });
}); });
// =============================================================================
// CASE ASSIGNMENT ENDPOINTS
// =============================================================================
// Assign users to a case
app.put("/case/assign", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, casePath, userIds, assignedBy, access, indexPath, indexContent, index, existingAssignments, existingUserIds, now, _i, userIds_1, userId, normalized, error_11;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _b.sent(), casePath = _a.casePath, userIds = _a.userIds, assignedBy = _a.assignedBy;
                if (!casePath || !userIds || !assignedBy) {
                    return [2 /*return*/, c.json({ error: "casePath, userIds, and assignedBy are required" }, 400)];
                }
                if (!Array.isArray(userIds)) {
                    return [2 /*return*/, c.json({ error: "userIds must be an array" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireCaseAccess)(c, casePath)];
            case 2:
                access = _b.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                if (!access.context.permissions.canAssignCases) {
                    return [2 /*return*/, c.json({ error: "insufficient_permissions" }, 403)];
                }
                _b.label = 3;
            case 3:
                _b.trys.push([3, 7, , 8]);
                indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                if (!(0, fs_1.existsSync)(indexPath)) {
                    return [2 /*return*/, c.json({ error: "Case index not found" }, 404)];
                }
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 4:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                existingAssignments = index.assignments || [];
                existingUserIds = new Set(existingAssignments.map(function (a) { return a.userId; }));
                now = new Date().toISOString();
                for (_i = 0, userIds_1 = userIds; _i < userIds_1.length; _i++) {
                    userId = userIds_1[_i];
                    if (!existingUserIds.has(userId)) {
                        existingAssignments.push({
                            userId: userId,
                            assignedAt: now,
                            assignedBy: assignedBy.toLowerCase(),
                        });
                    }
                }
                index.assignments = existingAssignments;
                normalized = (0, index_schema_1.normalizeIndex)(index);
                return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(normalized, null, 2))];
            case 5:
                _b.sent();
                return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(casePath, normalized)];
            case 6:
                _b.sent();
                return [2 /*return*/, c.json({ success: true, assignments: normalized.assignments })];
            case 7:
                error_11 = _b.sent();
                console.error("Assign case error:", error_11);
                return [2 /*return*/, c.json({
                        error: error_11 instanceof Error ? error_11.message : String(error_11),
                    }, 500)];
            case 8: return [2 /*return*/];
        }
    });
}); });
// Remove assignment from a case
app.delete("/case/unassign", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var casePath, userId, access, indexPath, indexContent, index, existingAssignments, normalized, error_12;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                casePath = c.req.query("casePath");
                userId = c.req.query("userId");
                if (!casePath || !userId) {
                    return [2 /*return*/, c.json({ error: "casePath and userId query params are required" }, 400)];
                }
                return [4 /*yield*/, (0, team_access_1.requireCaseAccess)(c, casePath)];
            case 1:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                if (!access.context.permissions.canAssignCases) {
                    return [2 /*return*/, c.json({ error: "insufficient_permissions" }, 403)];
                }
                _a.label = 2;
            case 2:
                _a.trys.push([2, 6, , 7]);
                indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                if (!(0, fs_1.existsSync)(indexPath)) {
                    return [2 /*return*/, c.json({ error: "Case index not found" }, 404)];
                }
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 3:
                indexContent = _a.sent();
                index = JSON.parse(indexContent);
                existingAssignments = index.assignments || [];
                index.assignments = existingAssignments.filter(function (a) { return a.userId !== userId; });
                normalized = (0, index_schema_1.normalizeIndex)(index);
                return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(normalized, null, 2))];
            case 4:
                _a.sent();
                return [4 /*yield*/, (0, meta_index_1.writeIndexDerivedFiles)(casePath, normalized)];
            case 5:
                _a.sent();
                return [2 /*return*/, c.json({ success: true, assignments: normalized.assignments })];
            case 6:
                error_12 = _a.sent();
                console.error("Unassign case error:", error_12);
                return [2 /*return*/, c.json({
                        error: error_12 instanceof Error ? error_12.message : String(error_12),
                    }, 500)];
            case 7: return [2 /*return*/];
        }
    });
}); });
exports.default = app;
