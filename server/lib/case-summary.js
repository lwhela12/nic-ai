"use strict";
/**
 * Case Summary Generator (Groq GPT-OSS 120B)
 *
 * Generates case_summary narrative and case_phase from document index.
 * Runs in parallel with hypergraph generation.
 */
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
exports.generateCaseSummary = generateCaseSummary;
var groq_extract_1 = require("./groq-extract");
var knowledge_1 = require("../routes/knowledge");
var config_1 = require("../practice-areas/personal-injury/config");
var config_2 = require("../practice-areas/workers-comp/config");
var index_schema_1 = require("./index-schema");
// Knowledge sections relevant for case summary
var SUMMARY_SECTION_IDS = [
    "document-quality", // Understanding what documents indicate
    "injury-severity", // Context for describing injuries
];
/**
 * Determine case phase from document types present.
 * This provides a reasonable default that the model can refine.
 */
function inferPhaseFromDocuments(folders, practiceArea) {
    var allTypes = new Set();
    for (var _i = 0, _a = Object.values(folders); _i < _a.length; _i++) {
        var folderData = _a[_i];
        var files = Array.isArray(folderData) ? folderData : (folderData === null || folderData === void 0 ? void 0 : folderData.files) || [];
        for (var _b = 0, files_1 = files; _b < files_1.length; _b++) {
            var file = files_1[_b];
            if (file.type) {
                allTypes.add(file.type.toLowerCase());
            }
        }
    }
    if (practiceArea === index_schema_1.PRACTICE_AREAS.WC) {
        if (allTypes.has("release") || allTypes.has("settlement_agreement")) {
            return "Closed";
        }
        if (allTypes.has("d9_form") || allTypes.has("d16_form") || allTypes.has("hearing") || allTypes.has("settlement")) {
            return "Settlement/Hearing";
        }
        if (allTypes.has("ppd_rating") || allTypes.has("ime_report") || allTypes.has("fce_report")) {
            return "MMI Evaluation";
        }
        if (allTypes.has("wage_statement") || allTypes.has("utilization_review") || allTypes.has("aoe_coe_investigation")) {
            return "Benefits Resolution";
        }
        if (allTypes.has("work_status_report") || allTypes.has("medical_record") || allTypes.has("medical_bill")) {
            return "Treatment";
        }
        if (allTypes.has("c4_claim") || allTypes.has("c3_employer_report") || allTypes.has("c4_supplemental")) {
            return "Investigation";
        }
        return "Intake";
    }
    // PI - work backwards from most advanced phase
    if (allTypes.has("settlement") || allTypes.has("release")) {
        return "Settlement";
    }
    if (allTypes.has("demand")) {
        // Check if we have response/negotiation docs
        if (allTypes.has("correspondence")) {
            return "Negotiation";
        }
        return "Demand";
    }
    if (allTypes.has("medical_record") || allTypes.has("medical_bill")) {
        return "Treatment";
    }
    if (allTypes.has("police_report") || allTypes.has("declaration")) {
        return "Investigation";
    }
    if (allTypes.has("intake_form") || allTypes.has("lor")) {
        return "Intake";
    }
    return "Intake"; // Default
}
/**
 * Build a condensed view of the document index for the summary prompt.
 * We don't need full extracted_data, just document types and key_info.
 */
function buildCondensedIndex(documentIndex) {
    var lines = [];
    var folders = documentIndex.folders || {};
    for (var _i = 0, _a = Object.entries(folders); _i < _a.length; _i++) {
        var _b = _a[_i], folderName = _b[0], folderData = _b[1];
        var files = Array.isArray(folderData) ? folderData : (folderData === null || folderData === void 0 ? void 0 : folderData.files) || [];
        if (files.length === 0)
            continue;
        lines.push("\n## ".concat(folderName, "/"));
        for (var _c = 0, files_2 = files; _c < files_2.length; _c++) {
            var file = files_2[_c];
            var type = file.type || "unknown";
            var keyInfo = file.key_info ? " - ".concat(file.key_info.slice(0, 200)) : "";
            lines.push("- [".concat(type, "] ").concat(file.filename).concat(keyInfo));
        }
    }
    return lines.join("\n");
}
/**
 * Generate case summary and phase using Groq Qwen3 32B.
 */
function generateCaseSummary(documentIndex, options) {
    return __awaiter(this, void 0, void 0, function () {
        var startTime, practiceAreaInput, practiceArea, isWC, practiceLabel, knowledge, condensedIndex, inferredPhase, contextLines, contextBlock, phaseEnum, phaseDefinitions, systemPrompt, userPrompt, _a, result, usage, elapsed, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log("[CaseSummary] Starting Groq GPT-OSS summary generation");
                    startTime = Date.now();
                    practiceAreaInput = (options === null || options === void 0 ? void 0 : options.practiceArea) || documentIndex.practice_area;
                    practiceArea = practiceAreaInput === index_schema_1.PRACTICE_AREAS.WC
                        ? index_schema_1.PRACTICE_AREAS.WC
                        : index_schema_1.PRACTICE_AREAS.PI;
                    isWC = practiceArea === index_schema_1.PRACTICE_AREAS.WC;
                    practiceLabel = isWC ? "Workers' Compensation" : "Personal Injury";
                    return [4 /*yield*/, (0, knowledge_1.loadSectionsByIds)(options === null || options === void 0 ? void 0 : options.firmRoot, SUMMARY_SECTION_IDS)];
                case 1:
                    knowledge = _b.sent();
                    condensedIndex = buildCondensedIndex(documentIndex);
                    inferredPhase = inferPhaseFromDocuments(documentIndex.folders || {}, practiceArea);
                    contextLines = [];
                    if (typeof documentIndex.case_name === "string" && documentIndex.case_name.trim()) {
                        contextLines.push("Case Name: ".concat(documentIndex.case_name.trim()));
                    }
                    if (documentIndex.is_doi_case && typeof documentIndex.injury_date === "string") {
                        contextLines.push("DOI Case: yes (injury date ".concat(documentIndex.injury_date, ")"));
                    }
                    if (Array.isArray(documentIndex.related_cases) && documentIndex.related_cases.length > 0) {
                        contextLines.push("Related Claims: ".concat(documentIndex.related_cases.length));
                    }
                    contextBlock = contextLines.length > 0
                        ? contextLines.join("\n")
                        : "No extra case metadata provided.";
                    phaseEnum = isWC ? __spreadArray([], config_2.WC_PHASES, true) : __spreadArray([], config_1.PI_PHASES, true);
                    phaseDefinitions = isWC
                        ? "- **Intake**: Initial WC claim setup and onboarding\n- **Investigation**: Compensability and records investigation in progress\n- **Treatment**: Active treatment and work-status management\n- **MMI Evaluation**: MMI/PPD evaluation stage\n- **Benefits Resolution**: Wage/benefit disputes and resolution work\n- **Settlement/Hearing**: Hearing prep/active litigation or settlement execution\n- **Closed**: Matter resolved/closed"
                        : "- **Intake**: Client just signed, gathering initial documents\n- **Investigation**: Collecting records, police reports, insurance info\n- **Treatment**: Client receiving ongoing medical care\n- **Demand**: Demand letter has been sent to insurance\n- **Negotiation**: Back-and-forth with adjuster on settlement\n- **Settlement**: Terms agreed, finalizing paperwork\n- **Complete**: Case closed and resolved";
                    systemPrompt = "You are a case intake specialist for a ".concat(practiceLabel, " law firm.\n\nYour job: Write a brief case summary and determine the current case phase.\n\n## PRACTICE KNOWLEDGE\n\n").concat(knowledge, "\n\n## PHASE DEFINITIONS\n\n").concat(phaseDefinitions, "\n\n## VALID PHASES\n\ncase_phase must be one of: ").concat(phaseEnum.join(", "), "\n\n## INSTRUCTIONS\n\n1. Review the document list and key information\n2. Write a 2-4 sentence summary covering:\n   - Type of incident (MVA, slip-and-fall, dog bite, etc.)\n   - Injuries described\n   - Treatment status (ongoing, completed, etc.)\n   - Any notable case factors\n3. Determine the case phase based on what documents are present");
                    userPrompt = "CASE CONTEXT:\n".concat(contextBlock, "\n\nCASE DOCUMENTS:\n").concat(condensedIndex, "\n\nInitial phase inference (you may adjust): ").concat(inferredPhase, "\n\nAnalyze the case and return your summary and phase determination as JSON.");
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, groq_extract_1.generateCaseSummaryWithGptOss)(condensedIndex, systemPrompt, userPrompt)];
                case 3:
                    _a = _b.sent(), result = _a.result, usage = _a.usage;
                    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log("[CaseSummary] Done in ".concat(elapsed, "s. Phase: ").concat(result.case_phase));
                    console.log("[CaseSummary] Usage: ".concat(usage.inputTokens, " in / ").concat(usage.outputTokens, " out"));
                    return [2 /*return*/, {
                            case_summary: result.case_summary,
                            case_phase: result.case_phase,
                            usage: {
                                inputTokens: usage.inputTokens,
                                outputTokens: usage.outputTokens
                            }
                        }];
                case 4:
                    error_1 = _b.sent();
                    console.error("[CaseSummary] Error:", error_1);
                    // Fallback to inferred values
                    return [2 /*return*/, {
                            case_summary: "Case summary generation failed. Please review documents manually.",
                            case_phase: inferredPhase,
                            usage: { inputTokens: 0, outputTokens: 0 }
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
