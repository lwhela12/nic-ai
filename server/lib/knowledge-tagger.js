"use strict";
/**
 * Knowledge Section Semantic Tagger
 *
 * Uses Groq GPT-OSS 120B to generate semantic tags (topics, applicable workflows,
 * summary) for each knowledge section. Tags are stored in meta_index.json and used
 * for precise section lookups instead of regex guessing.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSectionTags = generateSectionTags;
exports.generateKnowledgeSummary = generateKnowledgeSummary;
exports.generateTagsForAllSections = generateTagsForAllSections;
var groq_client_1 = require("./groq-client");
var APPLIES_TO_ENUM = [
    "evidence_packet",
    "demand_letter",
    "case_memo",
    "settlement",
    "general_reference",
    "case_evaluation",
    "indexing",
    "case_management",
    "medical_treatment",
    "benefits_calculation",
    "litigation",
    "client_communication",
];
var MODEL_PRIMARY = "openai/gpt-oss-120b";
var MODEL_FALLBACK = "openai/gpt-oss-20b";
var CONCURRENCY = 5;
var SYSTEM_PROMPT = "You are a classifier for law firm knowledge base sections. Given a section title and content, output a JSON object with exactly these fields:\n\n- \"topics\": array of 2-6 short lowercase kebab-case topic tags (e.g. \"document-ordering\", \"hearing-procedures\", \"medical-records\")\n- \"applies_to\": array of workflow identifiers this section provides SUBSTANTIVE GUIDANCE for. Only include a workflow if this section contains detailed instructions, rules, or procedures for that workflow \u2014 not if it merely mentions the workflow in passing.\n  Valid values: ".concat(APPLIES_TO_ENUM.join(", "), "\n- \"summary\": a single sentence (max 120 chars) describing what this section is FOR \u2014 what a practitioner would use it to accomplish.\n\nOutput ONLY valid JSON, no markdown fences, no explanation.");
function callGroq(title, content, model) {
    return __awaiter(this, void 0, void 0, function () {
        var groq, response;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    groq = (0, groq_client_1.getGroqClient)();
                    return [4 /*yield*/, groq.chat.completions.create({
                            model: model,
                            temperature: 0,
                            max_tokens: 300,
                            response_format: { type: "json_object" },
                            messages: [
                                { role: "system", content: SYSTEM_PROMPT },
                                { role: "user", content: "Section title: ".concat(title, "\n\nContent:\n").concat(content) },
                            ],
                        })];
                case 1:
                    response = _d.sent();
                    return [2 /*return*/, ((_c = (_b = (_a = response.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || ""];
            }
        });
    });
}
function generateSectionTags(title, content) {
    return __awaiter(this, void 0, void 0, function () {
        var fallback, text, _a, cleaned, parsed, err_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    fallback = {
                        topics: [],
                        applies_to: ["general_reference"],
                        summary: title,
                    };
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 7, , 8]);
                    text = void 0;
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, callGroq(title, content, MODEL_PRIMARY)];
                case 3:
                    text = _b.sent();
                    return [3 /*break*/, 6];
                case 4:
                    _a = _b.sent();
                    return [4 /*yield*/, callGroq(title, content, MODEL_FALLBACK)];
                case 5:
                    text = _b.sent();
                    return [3 /*break*/, 6];
                case 6:
                    cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
                    parsed = JSON.parse(cleaned);
                    return [2 /*return*/, {
                            topics: Array.isArray(parsed.topics)
                                ? parsed.topics.filter(function (t) { return typeof t === "string"; }).slice(0, 8)
                                : [],
                            applies_to: Array.isArray(parsed.applies_to)
                                ? parsed.applies_to.filter(function (v) {
                                    return typeof v === "string" &&
                                        APPLIES_TO_ENUM.includes(v);
                                })
                                : ["general_reference"],
                            summary: typeof parsed.summary === "string" && parsed.summary.trim()
                                ? parsed.summary.trim().slice(0, 200)
                                : title,
                        }];
                case 7:
                    err_1 = _b.sent();
                    console.warn("[knowledge-tagger] Failed to generate tags for \"".concat(title, "\":"), err_1 instanceof Error ? err_1.message : err_1);
                    return [2 /*return*/, fallback];
                case 8: return [2 /*return*/];
            }
        });
    });
}
var SUMMARY_SYSTEM_PROMPT = "You are a legal practice knowledge summarizer. Given the full text of all knowledge sections for a law firm, produce a concise, unified reference summary in markdown.\n\nRequirements:\n- Summarize the most important rules, thresholds, deadlines, statutory references, and formulas across ALL sections\n- Use markdown bullet points, organize by topic\n- No redundancy \u2014 state each fact exactly once\n- Include specific numbers, percentages, time limits, and statute citations\n- After the summary, add a \"### Definitive Sources\" section mapping key topics to their source filenames so the agent knows where to read_file for full detail\n- Target approximately 600-700 words (~3000-4000 characters)\n- Output ready-to-render markdown \u2014 no JSON wrapping, no code fences, no explanation prefix";
/**
 * Generate a holistic knowledge summary across ALL sections.
 * One Groq call reads all sections and produces a unified markdown summary.
 * Returns raw markdown string (empty string on error).
 */
function generateKnowledgeSummary(sections) {
    return __awaiter(this, void 0, void 0, function () {
        function callSummary(model) {
            return __awaiter(this, void 0, void 0, function () {
                var response;
                var _a, _b, _c;
                return __generator(this, function (_d) {
                    switch (_d.label) {
                        case 0: return [4 /*yield*/, groq.chat.completions.create({
                                model: model,
                                temperature: 0,
                                max_tokens: 2000,
                                messages: [
                                    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
                                    { role: "user", content: concatenated },
                                ],
                            })];
                        case 1:
                            response = _d.sent();
                            return [2 /*return*/, ((_c = (_b = (_a = response.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || ""];
                    }
                });
            });
        }
        var concatenated, groq, result, _a, err_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (sections.length === 0)
                        return [2 /*return*/, ""];
                    concatenated = sections
                        .map(function (s) { return "=== Section: ".concat(s.title, " (").concat(s.filename, ") ===\n").concat(s.content); })
                        .join("\n\n---\n\n");
                    groq = (0, groq_client_1.getGroqClient)();
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 7, , 8]);
                    result = void 0;
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, callSummary(MODEL_PRIMARY)];
                case 3:
                    result = _b.sent();
                    return [3 /*break*/, 6];
                case 4:
                    _a = _b.sent();
                    return [4 /*yield*/, callSummary(MODEL_FALLBACK)];
                case 5:
                    result = _b.sent();
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/, result.trim()];
                case 7:
                    err_2 = _b.sent();
                    console.warn("[knowledge-tagger] Failed to generate knowledge summary:", err_2 instanceof Error ? err_2.message : err_2);
                    return [2 /*return*/, ""];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function generateTagsForAllSections(sections) {
    return __awaiter(this, void 0, void 0, function () {
        var results, i, batch, batchResults, _i, batchResults_1, _a, filename, tags;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    results = new Map();
                    i = 0;
                    _b.label = 1;
                case 1:
                    if (!(i < sections.length)) return [3 /*break*/, 4];
                    batch = sections.slice(i, i + CONCURRENCY);
                    return [4 /*yield*/, Promise.all(batch.map(function (section) { return __awaiter(_this, void 0, void 0, function () {
                            var tags;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, generateSectionTags(section.title, section.content)];
                                    case 1:
                                        tags = _a.sent();
                                        return [2 /*return*/, { filename: section.filename, tags: tags }];
                                }
                            });
                        }); }))];
                case 2:
                    batchResults = _b.sent();
                    for (_i = 0, batchResults_1 = batchResults; _i < batchResults_1.length; _i++) {
                        _a = batchResults_1[_i], filename = _a.filename, tags = _a.tags;
                        results.set(filename, tags);
                    }
                    _b.label = 3;
                case 3:
                    i += CONCURRENCY;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, results];
            }
        });
    });
}
