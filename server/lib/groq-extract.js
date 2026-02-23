"use strict";
/**
 * Groq Extraction Functions
 *
 * Replaces all Anthropic API calls in the indexing pipeline with Groq models:
 * - extractWithGptOss: Text-based PDF extraction (Path 1) via GPT-OSS 120B
 * - extractWithVision: Scanned PDF extraction (Path 2) via Llama 4 Scout → Maverick fallback
 * - generateHypergraphWithGptOss: Cross-document consistency analysis via GPT-OSS 120B
 * - generateCaseSummaryWithGptOss: Case summary generation via GPT-OSS 120B
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
exports.extractWithGptOss = extractWithGptOss;
exports.extractWithVision = extractWithVision;
exports.extractImageFileWithVision = extractImageFileWithVision;
exports.generateHypergraphWithGptOss = generateHypergraphWithGptOss;
exports.generateHypergraphConflictReviewWithGptOss = generateHypergraphConflictReviewWithGptOss;
exports.generateCaseSummaryWithGptOss = generateCaseSummaryWithGptOss;
var promises_1 = require("fs/promises");
var groq_client_1 = require("./groq-client");
var pdftoppm_1 = require("./pdftoppm");
var index_schema_1 = require("./index-schema");
var extract_1 = require("./extract");
// ============================================================================
// Model Constants & Rate Limit Tracking
// ============================================================================
var TEXT_PRIMARY = "openai/gpt-oss-120b";
var TEXT_FALLBACK = "openai/gpt-oss-20b";
var VISION_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
var VISION_MAVERICK = "meta-llama/llama-4-maverick-17b-128e-instruct";
/** Conservative estimate of tokens per text extraction call */
var ESTIMATED_TEXT_TOKENS = 8000;
/** Conservative estimate of tokens per vision call (images are token-heavy) */
var ESTIMATED_VISION_TOKENS = 20000;
/** Adaptive vision quality targets */
var MAX_VISION_PAGES = 5;
var VISION_DPI_HIGH = 150;
var VISION_DPI_MEDIUM = 120;
var VISION_DPI_LOW = 100;
var SIZE_BASED_DPI_SAMPLES = [
    { maxFileMB: 4, dpi: VISION_DPI_HIGH },
    { maxFileMB: 10, dpi: VISION_DPI_MEDIUM },
    { maxFileMB: 20, dpi: VISION_DPI_LOW },
];
var VISION_DPI_STEPS = [200, 150, 120, 100, 80];
/** Per-model rate limit state, updated from Groq response headers */
var rateLimitState = {};
function updateRateLimitState(model, headers) {
    var remaining = headers.get("x-ratelimit-remaining-tokens");
    var resetMs = headers.get("x-ratelimit-reset-tokens");
    if (remaining !== null) {
        var resetAt = resetMs
            ? Date.now() + parseResetDuration(resetMs)
            : Date.now() + 60000; // default 60s window
        rateLimitState[model] = {
            remainingTokens: parseInt(remaining, 10),
            resetAt: resetAt,
        };
    }
}
/** Parse Groq reset duration like "1m30s", "45s", "2m" into milliseconds */
function parseResetDuration(value) {
    var ms = 0;
    var minMatch = value.match(/(\d+)m/);
    var secMatch = value.match(/(\d+(?:\.\d+)?)s/);
    if (minMatch)
        ms += parseInt(minMatch[1], 10) * 60000;
    if (secMatch)
        ms += parseFloat(secMatch[1]) * 1000;
    return ms || 60000;
}
function shouldUseFallback(model, estimatedTokens) {
    if (estimatedTokens === void 0) { estimatedTokens = ESTIMATED_VISION_TOKENS; }
    var state = rateLimitState[model];
    if (!state)
        return false;
    // If the reset window has passed, state is stale — don't fallback
    if (Date.now() > state.resetAt)
        return false;
    return state.remainingTokens < estimatedTokens;
}
// ============================================================================
// Schema Helpers
// ============================================================================
/**
 * Convert the FILE_EXTRACTION_TOOL_SCHEMA into a JSON description for embedding
 * in the system prompt (GPT-OSS json_object mode doesn't support json_schema).
 */
function buildExtractionSchemaDescription() {
    var props = index_schema_1.FILE_EXTRACTION_TOOL_SCHEMA.input_schema.properties;
    var lines = [
        "You MUST return a JSON object with exactly these top-level fields:",
        "",
    ];
    for (var _i = 0, _a = Object.entries(props); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], schema = _b[1];
        var s = schema;
        var desc = s.description || "";
        if (s.enum)
            desc += " (one of: ".concat(s.enum.join(", "), ")");
        if (s.type === "array")
            desc += " (array of strings)";
        lines.push("- \"".concat(key, "\" (").concat(s.type, "): ").concat(desc));
    }
    lines.push("");
    lines.push("The extracted_data object should contain any specific data points found in the document,");
    lines.push("such as: client_name, dob, phone, email, address, dol, document_date,");
    lines.push("document_date_confidence, document_date_reason, insurance_1p, insurance_3p,");
    lines.push("health_insurance, provider_name, service_dates, charges, balance, diagnosis,");
    lines.push("treatment_summary, settlement_amount, demand_amount, etc.");
    return lines.join("\n");
}
/**
 * Build a JSON Schema object for vision models (best-effort json_schema mode).
 */
function buildVisionJsonSchema() {
    return {
        name: "document_extraction",
        strict: false,
        schema: {
            type: "object",
            properties: {
                type: { type: "string", description: "Document type classification" },
                key_info: { type: "string", description: "2-3 sentence summary" },
                has_handwritten_data: { type: "boolean" },
                handwritten_fields: { type: "array", items: { type: "string" } },
                extracted_data: {
                    type: "object",
                    description: "Structured data extracted from the document",
                },
            },
            required: ["type", "key_info", "has_handwritten_data", "handwritten_fields", "extracted_data"],
        },
    };
}
// ============================================================================
// Path 1: Text Extraction with GPT-OSS 120B → 20B Fallback
// ============================================================================
/**
 * Make a single GPT-OSS API call with a specific model.
 * Returns the parsed response and updates rate limit state from headers.
 */
function callTextModel(modelId, messages) {
    return __awaiter(this, void 0, void 0, function () {
        var groq, _a, response, rawResponse, modelShort;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    groq = (0, groq_client_1.getGroqClient)();
                    return [4 /*yield*/, groq.chat.completions.create({
                            model: modelId,
                            temperature: 0.1,
                            max_tokens: 4000,
                            response_format: { type: "json_object" },
                            messages: messages,
                        }).withResponse()];
                case 1:
                    _a = _f.sent(), response = _a.data, rawResponse = _a.response;
                    // Update rate limit state from response headers
                    updateRateLimitState(modelId, rawResponse.headers);
                    modelShort = modelId.includes("120b") ? "120b" : "20b";
                    return [2 /*return*/, {
                            content: ((_c = (_b = response.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || "{}",
                            usage: {
                                inputTokens: ((_d = response.usage) === null || _d === void 0 ? void 0 : _d.prompt_tokens) || 0,
                                outputTokens: ((_e = response.usage) === null || _e === void 0 ? void 0 : _e.completion_tokens) || 0,
                            },
                            model: modelShort,
                        }];
            }
        });
    });
}
/**
 * Make a GPT-OSS API call with 120B → 20B fallback.
 * 1. If proactive check says 120B is low on tokens → go straight to 20B
 * 2. Try 120B; on 429 → switch to 20B
 * 3. Try 20B; on 429 → wait retry-after, then retry 20B once
 * 4. On timeout → retry same model once
 */
function callTextWithFallback(messages, filename) {
    return __awaiter(this, void 0, void 0, function () {
        var skip120b, primaryModel, err_1, status_1, isTimeout, retryAfter, fallbackErr_1, fallbackStatus, retryAfter;
        var _a, _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    skip120b = shouldUseFallback(TEXT_PRIMARY, ESTIMATED_TEXT_TOKENS);
                    if (skip120b) {
                        console.log("[GPT-OSS] ".concat(filename, ": 120B low on tokens, using 20B"));
                    }
                    primaryModel = skip120b ? TEXT_FALLBACK : TEXT_PRIMARY;
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 3, , 16]);
                    return [4 /*yield*/, callTextModel(primaryModel, messages)];
                case 2: return [2 /*return*/, _f.sent()];
                case 3:
                    err_1 = _f.sent();
                    status_1 = (err_1 === null || err_1 === void 0 ? void 0 : err_1.status) || (err_1 === null || err_1 === void 0 ? void 0 : err_1.statusCode);
                    isTimeout = (err_1 === null || err_1 === void 0 ? void 0 : err_1.name) === "APIConnectionTimeoutError" || (err_1 === null || err_1 === void 0 ? void 0 : err_1.code) === "ETIMEDOUT" || ((_a = err_1 === null || err_1 === void 0 ? void 0 : err_1.message) === null || _a === void 0 ? void 0 : _a.includes("timed out"));
                    if (!isTimeout) return [3 /*break*/, 6];
                    console.log("[GPT-OSS] ".concat(filename, ": ").concat(primaryModel.includes("120b") ? "120B" : "20B", " timeout, retrying"));
                    return [4 /*yield*/, sleep(3000)];
                case 4:
                    _f.sent();
                    return [4 /*yield*/, callTextModel(primaryModel, messages)];
                case 5: return [2 /*return*/, _f.sent()];
                case 6:
                    if (status_1 !== 429)
                        throw err_1; // non-rate-limit error — propagate
                    if (!(primaryModel === TEXT_FALLBACK)) return [3 /*break*/, 9];
                    retryAfter = parseRetryAfter((_c = (_b = err_1 === null || err_1 === void 0 ? void 0 : err_1.headers) === null || _b === void 0 ? void 0 : _b["retry-after"]) !== null && _c !== void 0 ? _c : null);
                    console.log("[GPT-OSS] ".concat(filename, ": 20B 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 7:
                    _f.sent();
                    return [4 /*yield*/, callTextModel(TEXT_FALLBACK, messages)];
                case 8: return [2 /*return*/, _f.sent()];
                case 9:
                    // 120B 429 → fall back to 20B
                    console.log("[GPT-OSS] ".concat(filename, ": 120B 429, falling back to 20B"));
                    _f.label = 10;
                case 10:
                    _f.trys.push([10, 12, , 15]);
                    return [4 /*yield*/, callTextModel(TEXT_FALLBACK, messages)];
                case 11: return [2 /*return*/, _f.sent()];
                case 12:
                    fallbackErr_1 = _f.sent();
                    fallbackStatus = (fallbackErr_1 === null || fallbackErr_1 === void 0 ? void 0 : fallbackErr_1.status) || (fallbackErr_1 === null || fallbackErr_1 === void 0 ? void 0 : fallbackErr_1.statusCode);
                    if (fallbackStatus !== 429)
                        throw fallbackErr_1;
                    retryAfter = parseRetryAfter((_e = (_d = fallbackErr_1 === null || fallbackErr_1 === void 0 ? void 0 : fallbackErr_1.headers) === null || _d === void 0 ? void 0 : _d["retry-after"]) !== null && _e !== void 0 ? _e : null);
                    console.log("[GPT-OSS] ".concat(filename, ": 20B also 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 13:
                    _f.sent();
                    return [4 /*yield*/, callTextModel(TEXT_FALLBACK, messages)];
                case 14: return [2 /*return*/, _f.sent()];
                case 15: return [3 /*break*/, 16];
                case 16: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract structured data from pre-extracted document text using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
function extractWithGptOss(text, filename, folder, systemPrompt) {
    return __awaiter(this, void 0, void 0, function () {
        var schemaDesc, messages, _a, content, usage, parsed;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    schemaDesc = buildExtractionSchemaDescription();
                    messages = [
                        {
                            role: "system",
                            content: "".concat(systemPrompt, "\n\n## OUTPUT FORMAT\n\nYou must respond with a single JSON object. No markdown, no explanation, no text outside the JSON.\n\n").concat(schemaDesc),
                        },
                        {
                            role: "user",
                            content: "Extract information from this document.\n\nFILENAME: ".concat(filename, "\nFOLDER: ").concat(folder, "\n\nDOCUMENT TEXT:\n").concat(text, "\n\nCRITICAL:\n- Include extracted_data.document_date for this specific document's own date.\n- If multiple dates appear, include extracted_data.document_date_confidence and extracted_data.document_date_reason.\n- Set has_handwritten_data to true only for substantive handwritten extracted values (exclude signature/initial-only markings).\n- Include handwritten_fields as non-signature extracted field names that are handwritten (use [] when none).\n\nReturn the JSON extraction now."),
                        },
                    ];
                    return [4 /*yield*/, callTextWithFallback(messages, filename)];
                case 1:
                    _a = _b.sent(), content = _a.content, usage = _a.usage;
                    parsed = JSON.parse(content);
                    return [2 /*return*/, {
                            result: {
                                type: parsed.type || "other",
                                key_info: parsed.key_info || "",
                                has_handwritten_data: parsed.has_handwritten_data === true,
                                handwritten_fields: Array.isArray(parsed.handwritten_fields) ? parsed.handwritten_fields : [],
                                extracted_data: parsed.extracted_data || {},
                            },
                            usage: usage,
                        }];
            }
        });
    });
}
// ============================================================================
// Path 2: Vision Extraction with Scout → Maverick Fallback
// ============================================================================
/**
 * Make a single vision API call with a specific model.
 * Returns the parsed response and updates rate limit state from headers.
 */
function callVisionModel(modelId, messages) {
    return __awaiter(this, void 0, void 0, function () {
        var groq, _a, response, rawResponse, modelShort;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    groq = (0, groq_client_1.getGroqClient)();
                    return [4 /*yield*/, groq.chat.completions.create({
                            model: modelId,
                            temperature: 0.1,
                            max_tokens: 6000,
                            response_format: {
                                type: "json_schema",
                                json_schema: buildVisionJsonSchema(),
                            },
                            messages: messages,
                        }).withResponse()];
                case 1:
                    _a = _f.sent(), response = _a.data, rawResponse = _a.response;
                    // Update rate limit state from response headers
                    updateRateLimitState(modelId, rawResponse.headers);
                    modelShort = modelId.includes("scout") ? "scout" : "maverick";
                    return [2 /*return*/, {
                            content: ((_c = (_b = response.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || "{}",
                            usage: {
                                inputTokens: ((_d = response.usage) === null || _d === void 0 ? void 0 : _d.prompt_tokens) || 0,
                                outputTokens: ((_e = response.usage) === null || _e === void 0 ? void 0 : _e.completion_tokens) || 0,
                            },
                            model: modelShort,
                        }];
            }
        });
    });
}
/** Sleep for a given number of milliseconds */
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
/** Parse retry-after header value (seconds) */
function parseRetryAfter(value) {
    if (!value)
        return 5;
    var n = parseFloat(value);
    return isNaN(n) ? 5 : n;
}
/**
 * Make a vision API call with Scout → Maverick fallback.
 * 1. If proactive check says Scout is low on tokens → go straight to Maverick
 * 2. Try Scout; on 429 → switch to Maverick
 * 3. Try Maverick; on 429 → wait retry-after, then retry Maverick once
 */
function callVisionWithFallback(messages, filename, batchLabel) {
    return __awaiter(this, void 0, void 0, function () {
        var skipScout, primaryModel, err_2, status_2, retryAfter, maverickErr_1, maverickStatus, retryAfter;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    skipScout = shouldUseFallback(VISION_SCOUT);
                    if (skipScout) {
                        console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": Scout low on tokens, using Maverick"));
                    }
                    primaryModel = skipScout ? VISION_MAVERICK : VISION_SCOUT;
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 3, , 13]);
                    return [4 /*yield*/, callVisionModel(primaryModel, messages)];
                case 2: return [2 /*return*/, _e.sent()];
                case 3:
                    err_2 = _e.sent();
                    status_2 = (err_2 === null || err_2 === void 0 ? void 0 : err_2.status) || (err_2 === null || err_2 === void 0 ? void 0 : err_2.statusCode);
                    if (status_2 !== 429)
                        throw err_2; // non-rate-limit error — propagate
                    if (!(primaryModel === VISION_MAVERICK)) return [3 /*break*/, 6];
                    retryAfter = parseRetryAfter((_b = (_a = err_2 === null || err_2 === void 0 ? void 0 : err_2.headers) === null || _a === void 0 ? void 0 : _a["retry-after"]) !== null && _b !== void 0 ? _b : null);
                    console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": Maverick 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 4:
                    _e.sent();
                    return [4 /*yield*/, callVisionModel(VISION_MAVERICK, messages)];
                case 5: return [2 /*return*/, _e.sent()];
                case 6:
                    // Scout 429 → fall back to Maverick
                    console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": Scout 429, falling back to Maverick"));
                    _e.label = 7;
                case 7:
                    _e.trys.push([7, 9, , 12]);
                    return [4 /*yield*/, callVisionModel(VISION_MAVERICK, messages)];
                case 8: return [2 /*return*/, _e.sent()];
                case 9:
                    maverickErr_1 = _e.sent();
                    maverickStatus = (maverickErr_1 === null || maverickErr_1 === void 0 ? void 0 : maverickErr_1.status) || (maverickErr_1 === null || maverickErr_1 === void 0 ? void 0 : maverickErr_1.statusCode);
                    if (maverickStatus !== 429)
                        throw maverickErr_1;
                    retryAfter = parseRetryAfter((_d = (_c = maverickErr_1 === null || maverickErr_1 === void 0 ? void 0 : maverickErr_1.headers) === null || _c === void 0 ? void 0 : _c["retry-after"]) !== null && _d !== void 0 ? _d : null);
                    console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": Maverick also 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 10:
                    _e.sent();
                    return [4 /*yield*/, callVisionModel(VISION_MAVERICK, messages)];
                case 11: return [2 /*return*/, _e.sent()];
                case 12: return [3 /*break*/, 13];
                case 13: return [2 /*return*/];
            }
        });
    });
}
function getNextLowerVisionDpi(currentDpi) {
    var sortedSteps = __spreadArray([], VISION_DPI_STEPS, true).sort(function (a, b) { return b - a; });
    for (var _i = 0, sortedSteps_1 = sortedSteps; _i < sortedSteps_1.length; _i++) {
        var step = sortedSteps_1[_i];
        if (step < currentDpi) {
            return step;
        }
    }
    return null;
}
function isImageTooLargeError(error) {
    var _a;
    var message = typeof error === "object" && error !== null && "message" in error
        ? String((_a = error.message) !== null && _a !== void 0 ? _a : "")
        : "";
    return message.toLowerCase().includes("image too large");
}
function extractVisionRangeWithAdaptiveRetry(pdfPath, filename, folder, systemPrompt, firstPage, lastPage, dpi, batchLabel, totalUsage) {
    return __awaiter(this, void 0, void 0, function () {
        var images, messages, totalSize, imageBlocks, i, img, pageRange, visionResult, parsed, err_3, fallbackDpi, midPage, firstHalf, secondHalf;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    images = [];
                    messages = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 8, 9]);
                    return [4 /*yield*/, (0, pdftoppm_1.pdfToImages)(pdfPath, firstPage, lastPage, dpi)];
                case 2:
                    images = _a.sent();
                    totalSize = images.reduce(function (sum, img) { return sum + img.sizeBytes; }, 0);
                    if (totalSize > 3.5 * 1024 * 1024) {
                        console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": ").concat((totalSize / 1024 / 1024).toFixed(1), "MB at ").concat(dpi, " DPI"));
                    }
                    imageBlocks = [];
                    for (i = 0; i < images.length; i++) {
                        img = images[i];
                        imageBlocks.push({
                            type: "image_url",
                            image_url: {
                                url: "data:image/jpeg;base64,".concat(img.base64),
                            },
                        });
                        img.base64 = "";
                    }
                    images = [];
                    pageRange = firstPage === lastPage ? "page ".concat(firstPage) : "pages ".concat(firstPage, "-").concat(lastPage);
                    messages = [
                        {
                            role: "system",
                            content: "".concat(systemPrompt, "\n\nYou must respond with a single JSON object. No markdown, no explanation.\nRequired fields: type, key_info, has_handwritten_data, handwritten_fields, extracted_data."),
                        },
                        {
                            role: "user",
                            content: __spreadArray([
                                {
                                    type: "text",
                                    text: "Extract information from ".concat(pageRange, " of this document.\n\nFILENAME: ").concat(filename, "\nFOLDER: ").concat(folder, "\n\nCRITICAL:\n- Include extracted_data.document_date for this specific document's own date.\n- If multiple dates appear, include extracted_data.document_date_confidence and extracted_data.document_date_reason.\n- Set has_handwritten_data to true only for substantive handwritten extracted values.\n- Include handwritten_fields as non-signature extracted field names that are handwritten (use [] when none).\n\nReturn the JSON extraction now."),
                                }
                            ], imageBlocks, true),
                        },
                    ];
                    return [4 /*yield*/, callVisionWithFallback(messages, filename, batchLabel)];
                case 3:
                    visionResult = _a.sent();
                    messages = null;
                    parsed = JSON.parse(visionResult.content);
                    console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": done [groq-").concat(visionResult.model, "]"));
                    totalUsage.inputTokens += visionResult.usage.inputTokens;
                    totalUsage.outputTokens += visionResult.usage.outputTokens;
                    return [2 /*return*/, [{
                                type: parsed.type || "other",
                                key_info: parsed.key_info || "",
                                has_handwritten_data: parsed.has_handwritten_data === true,
                                handwritten_fields: Array.isArray(parsed.handwritten_fields) ? parsed.handwritten_fields : [],
                                extracted_data: parsed.extracted_data || {},
                            }]];
                case 4:
                    err_3 = _a.sent();
                    if (!isImageTooLargeError(err_3)) return [3 /*break*/, 7];
                    fallbackDpi = getNextLowerVisionDpi(dpi);
                    if (fallbackDpi !== null) {
                        console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": image too large at ").concat(dpi, " DPI, retrying at ").concat(fallbackDpi, " DPI"));
                        return [2 /*return*/, extractVisionRangeWithAdaptiveRetry(pdfPath, filename, folder, systemPrompt, firstPage, lastPage, fallbackDpi, batchLabel, totalUsage)];
                    }
                    if (!(firstPage < lastPage)) return [3 /*break*/, 7];
                    midPage = Math.floor((firstPage + lastPage) / 2);
                    console.log("[Vision] ".concat(filename, " ").concat(batchLabel, ": splitting ").concat(firstPage, "-").concat(lastPage, " into ").concat(firstPage, "-").concat(midPage, " and ").concat(midPage + 1, "-").concat(lastPage));
                    return [4 /*yield*/, extractVisionRangeWithAdaptiveRetry(pdfPath, filename, folder, systemPrompt, firstPage, midPage, dpi, "".concat(batchLabel, " (1/2)"), totalUsage)];
                case 5:
                    firstHalf = _a.sent();
                    return [4 /*yield*/, extractVisionRangeWithAdaptiveRetry(pdfPath, filename, folder, systemPrompt, midPage + 1, lastPage, dpi, "".concat(batchLabel, " (2/2)"), totalUsage)];
                case 6:
                    secondHalf = _a.sent();
                    return [2 /*return*/, __spreadArray(__spreadArray([], firstHalf, true), secondHalf, true)];
                case 7:
                    console.error("[Vision] ".concat(filename, " ").concat(batchLabel, " failed:"), err_3);
                    return [2 /*return*/, []];
                case 8:
                    messages = null;
                    images = [];
                    return [7 /*endfinally*/];
                case 9: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract structured data from a scanned PDF using vision models.
 * Uses Scout as primary with Maverick fallback on rate limits.
 * Converts PDF pages to PNG images and processes once per PDF with a max of 5 pages.
 */
function extractWithVision(pdfPath_1, filename_1, folder_1) {
    return __awaiter(this, arguments, void 0, function (pdfPath, filename, folder, fileSizeMB, systemPrompt) {
        var totalUsage, pageCount, _a, pickVisionDpi, maxPages, PAGES_PER_BATCH, batchCount, chosenDpi, batchResults, batch, firstPage, lastPage, batchLabel, batchPartialResults, merged;
        if (fileSizeMB === void 0) { fileSizeMB = 0; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    totalUsage = { inputTokens: 0, outputTokens: 0 };
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, pdftoppm_1.getPdfPageCount)(pdfPath)];
                case 2:
                    pageCount = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    pageCount = 1;
                    return [3 /*break*/, 4];
                case 4:
                    pickVisionDpi = function (sizeMB, pages) {
                        if (pages <= 2 && sizeMB <= 6)
                            return VISION_DPI_HIGH;
                        if (!Number.isFinite(sizeMB) || sizeMB <= 0)
                            return VISION_DPI_MEDIUM;
                        for (var _i = 0, SIZE_BASED_DPI_SAMPLES_1 = SIZE_BASED_DPI_SAMPLES; _i < SIZE_BASED_DPI_SAMPLES_1.length; _i++) {
                            var tier = SIZE_BASED_DPI_SAMPLES_1[_i];
                            if (sizeMB <= tier.maxFileMB)
                                return tier.dpi;
                        }
                        return VISION_DPI_LOW;
                    };
                    maxPages = Math.min(pageCount, MAX_VISION_PAGES);
                    PAGES_PER_BATCH = maxPages;
                    batchCount = Math.ceil(maxPages / PAGES_PER_BATCH);
                    chosenDpi = pickVisionDpi(fileSizeMB, maxPages);
                    console.log("[Vision] ".concat(filename, ": ").concat(pageCount, " pages, processing ").concat(maxPages, " (").concat(batchCount, " batch(es)), using ").concat(chosenDpi, " DPI"));
                    batchResults = [];
                    batch = 0;
                    _b.label = 5;
                case 5:
                    if (!(batch < batchCount)) return [3 /*break*/, 8];
                    firstPage = batch * PAGES_PER_BATCH + 1;
                    lastPage = Math.min(firstPage + PAGES_PER_BATCH - 1, maxPages);
                    batchLabel = "batch ".concat(batch + 1, "/").concat(batchCount);
                    return [4 /*yield*/, extractVisionRangeWithAdaptiveRetry(pdfPath, filename, folder, systemPrompt, firstPage, lastPage, chosenDpi, batchLabel, totalUsage)];
                case 6:
                    batchPartialResults = _b.sent();
                    batchResults.push.apply(batchResults, batchPartialResults);
                    _b.label = 7;
                case 7:
                    batch++;
                    return [3 /*break*/, 5];
                case 8:
                    merged = mergeExtractions(batchResults, filename);
                    return [2 /*return*/, { result: merged, usage: totalUsage }];
            }
        });
    });
}
/**
 * Extract information from a standalone image file (JPG, PNG, etc.) using vision models.
 * Reads the image directly and sends it to Scout → Maverick fallback.
 */
function extractImageFileWithVision(imagePath, filename, folder, systemPrompt) {
    return __awaiter(this, void 0, void 0, function () {
        var totalUsage, imageBuffer, base64, mimeType, messages, visionResult, parsed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    totalUsage = { inputTokens: 0, outputTokens: 0 };
                    return [4 /*yield*/, (0, promises_1.readFile)(imagePath)];
                case 1:
                    imageBuffer = _a.sent();
                    base64 = imageBuffer.toString("base64");
                    mimeType = (0, extract_1.getImageMimeType)(filename);
                    console.log("[Vision] ".concat(filename, ": standalone image (").concat((imageBuffer.length / 1024).toFixed(0), "KB, ").concat(mimeType, ")"));
                    messages = [
                        {
                            role: "system",
                            content: "".concat(systemPrompt, "\n\nYou must respond with a single JSON object. No markdown, no explanation.\nRequired fields: type, key_info, has_handwritten_data, handwritten_fields, extracted_data."),
                        },
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Extract information from this image document.\n\nFILENAME: ".concat(filename, "\nFOLDER: ").concat(folder, "\n\nCRITICAL:\n- Include extracted_data.document_date for this specific document's own date.\n- If multiple dates appear, include extracted_data.document_date_confidence and extracted_data.document_date_reason.\n- Set has_handwritten_data to true only for substantive handwritten extracted values.\n- Include handwritten_fields as non-signature extracted field names that are handwritten (use [] when none).\n\nReturn the JSON extraction now."),
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: "data:".concat(mimeType, ";base64,").concat(base64),
                                    },
                                },
                            ],
                        },
                    ];
                    return [4 /*yield*/, callVisionWithFallback(messages, filename, "image")];
                case 2:
                    visionResult = _a.sent();
                    parsed = JSON.parse(visionResult.content);
                    console.log("[Vision] ".concat(filename, ": done [groq-").concat(visionResult.model, "]"));
                    totalUsage.inputTokens += visionResult.usage.inputTokens;
                    totalUsage.outputTokens += visionResult.usage.outputTokens;
                    return [2 /*return*/, {
                            result: {
                                type: parsed.type || "other",
                                key_info: parsed.key_info || "",
                                has_handwritten_data: parsed.has_handwritten_data === true,
                                handwritten_fields: Array.isArray(parsed.handwritten_fields) ? parsed.handwritten_fields : [],
                                extracted_data: parsed.extracted_data || {},
                            },
                            usage: totalUsage,
                        }];
            }
        });
    });
}
/**
 * Merge multiple extraction results from vision batches into a single result.
 * First batch result is the primary; later batches contribute extracted_data fields.
 */
function mergeExtractions(results, filename) {
    if (results.length === 0) {
        return {
            type: "other",
            key_info: "Vision extraction produced no results for ".concat(filename),
            has_handwritten_data: false,
            handwritten_fields: [],
            extracted_data: {},
        };
    }
    if (results.length === 1) {
        return results[0];
    }
    // Use first batch as the base (it has the document header/type info)
    var base = __assign({}, results[0]);
    var mergedData = __assign({}, base.extracted_data);
    var allHandwrittenFields = new Set(base.handwritten_fields || []);
    var keyInfoParts = [base.key_info];
    for (var i = 1; i < results.length; i++) {
        var r = results[i];
        // Merge extracted_data — later batches fill in missing fields only
        for (var _i = 0, _a = Object.entries(r.extracted_data || {}); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            if (!(key in mergedData) && value !== null && value !== undefined && value !== "") {
                mergedData[key] = value;
            }
        }
        // Merge handwritten fields
        for (var _c = 0, _d = r.handwritten_fields || []; _c < _d.length; _c++) {
            var field = _d[_c];
            allHandwrittenFields.add(field);
        }
        // Append key_info if it adds new information
        if (r.key_info && !keyInfoParts.includes(r.key_info)) {
            keyInfoParts.push(r.key_info);
        }
        // If any batch detected handwritten data, the overall result should reflect it
        if (r.has_handwritten_data) {
            base.has_handwritten_data = true;
        }
    }
    return {
        type: base.type,
        key_info: keyInfoParts.join(" "),
        has_handwritten_data: allHandwrittenFields.size > 0 || base.has_handwritten_data,
        handwritten_fields: Array.from(allHandwrittenFields),
        extracted_data: mergedData,
    };
}
// ============================================================================
// Hypergraph Generation with GPT-OSS 120B → 20B Fallback
// ============================================================================
/**
 * Generate a hypergraph analysis chunk using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
function generateHypergraphWithGptOss(chunkJson, chunkId, chunkCount, systemPrompt) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, label, skip120b, primaryModel, callWithModel, content, usage, _a, response, rawResponse, err_4, status_3, isTimeout, _b, response, rawResponse, _c, response, rawResponse, fallbackErr_2, fallbackStatus, retryAfter, _d, response, rawResponse, retryAfter, _e, response, rawResponse, parsed;
        var _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
        return __generator(this, function (_6) {
            switch (_6.label) {
                case 0:
                    messages = [
                        {
                            role: "system",
                            content: "".concat(systemPrompt, "\n\nYou must respond with a single JSON object. No markdown, no explanation, no text outside the JSON."),
                        },
                        {
                            role: "user",
                            content: "<document_index chunk=\"".concat(chunkId, "/").concat(chunkCount, "\">\n").concat(chunkJson, "\n</document_index>\n\nReturn ONLY the JSON hypergraph for this chunk. No explanation, no planning - just the JSON object."),
                        },
                    ];
                    label = "hypergraph-".concat(chunkId, "/").concat(chunkCount);
                    skip120b = shouldUseFallback(TEXT_PRIMARY, ESTIMATED_TEXT_TOKENS);
                    if (skip120b) {
                        console.log("[Hypergraph] chunk ".concat(chunkId, "/").concat(chunkCount, ": 120B low on tokens, using 20B"));
                    }
                    primaryModel = skip120b ? TEXT_FALLBACK : TEXT_PRIMARY;
                    callWithModel = function (model) {
                        var groq = (0, groq_client_1.getGroqClient)();
                        return groq.chat.completions.create({
                            model: model,
                            temperature: 0.1,
                            max_tokens: 8000,
                            response_format: { type: "json_object" },
                            messages: messages,
                        }).withResponse();
                    };
                    _6.label = 1;
                case 1:
                    _6.trys.push([1, 3, , 20]);
                    return [4 /*yield*/, callWithModel(primaryModel)];
                case 2:
                    _a = _6.sent(), response = _a.data, rawResponse = _a.response;
                    updateRateLimitState(primaryModel, rawResponse.headers);
                    content = ((_g = (_f = response.choices[0]) === null || _f === void 0 ? void 0 : _f.message) === null || _g === void 0 ? void 0 : _g.content) || "{}";
                    usage = { inputTokens: ((_h = response.usage) === null || _h === void 0 ? void 0 : _h.prompt_tokens) || 0, outputTokens: ((_j = response.usage) === null || _j === void 0 ? void 0 : _j.completion_tokens) || 0 };
                    return [3 /*break*/, 20];
                case 3:
                    err_4 = _6.sent();
                    status_3 = (err_4 === null || err_4 === void 0 ? void 0 : err_4.status) || (err_4 === null || err_4 === void 0 ? void 0 : err_4.statusCode);
                    isTimeout = (err_4 === null || err_4 === void 0 ? void 0 : err_4.name) === "APIConnectionTimeoutError" || (err_4 === null || err_4 === void 0 ? void 0 : err_4.code) === "ETIMEDOUT" || ((_k = err_4 === null || err_4 === void 0 ? void 0 : err_4.message) === null || _k === void 0 ? void 0 : _k.includes("timed out"));
                    if (!isTimeout) return [3 /*break*/, 6];
                    console.log("[Hypergraph] chunk ".concat(chunkId, "/").concat(chunkCount, ": timeout, retrying"));
                    return [4 /*yield*/, sleep(5000)];
                case 4:
                    _6.sent();
                    return [4 /*yield*/, callWithModel(primaryModel)];
                case 5:
                    _b = _6.sent(), response = _b.data, rawResponse = _b.response;
                    updateRateLimitState(primaryModel, rawResponse.headers);
                    content = ((_m = (_l = response.choices[0]) === null || _l === void 0 ? void 0 : _l.message) === null || _m === void 0 ? void 0 : _m.content) || "{}";
                    usage = { inputTokens: ((_o = response.usage) === null || _o === void 0 ? void 0 : _o.prompt_tokens) || 0, outputTokens: ((_p = response.usage) === null || _p === void 0 ? void 0 : _p.completion_tokens) || 0 };
                    return [3 /*break*/, 19];
                case 6:
                    if (!(status_3 === 429 && primaryModel === TEXT_PRIMARY)) return [3 /*break*/, 15];
                    console.log("[Hypergraph] chunk ".concat(chunkId, "/").concat(chunkCount, ": 120B 429, falling back to 20B"));
                    _6.label = 7;
                case 7:
                    _6.trys.push([7, 9, , 14]);
                    return [4 /*yield*/, callWithModel(TEXT_FALLBACK)];
                case 8:
                    _c = _6.sent(), response = _c.data, rawResponse = _c.response;
                    updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
                    content = ((_r = (_q = response.choices[0]) === null || _q === void 0 ? void 0 : _q.message) === null || _r === void 0 ? void 0 : _r.content) || "{}";
                    usage = { inputTokens: ((_s = response.usage) === null || _s === void 0 ? void 0 : _s.prompt_tokens) || 0, outputTokens: ((_t = response.usage) === null || _t === void 0 ? void 0 : _t.completion_tokens) || 0 };
                    return [3 /*break*/, 14];
                case 9:
                    fallbackErr_2 = _6.sent();
                    fallbackStatus = (fallbackErr_2 === null || fallbackErr_2 === void 0 ? void 0 : fallbackErr_2.status) || (fallbackErr_2 === null || fallbackErr_2 === void 0 ? void 0 : fallbackErr_2.statusCode);
                    if (!(fallbackStatus === 429)) return [3 /*break*/, 12];
                    retryAfter = parseRetryAfter((_v = (_u = fallbackErr_2 === null || fallbackErr_2 === void 0 ? void 0 : fallbackErr_2.headers) === null || _u === void 0 ? void 0 : _u["retry-after"]) !== null && _v !== void 0 ? _v : null);
                    console.log("[Hypergraph] chunk ".concat(chunkId, "/").concat(chunkCount, ": 20B also 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 10:
                    _6.sent();
                    return [4 /*yield*/, callWithModel(TEXT_FALLBACK)];
                case 11:
                    _d = _6.sent(), response = _d.data, rawResponse = _d.response;
                    updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
                    content = ((_x = (_w = response.choices[0]) === null || _w === void 0 ? void 0 : _w.message) === null || _x === void 0 ? void 0 : _x.content) || "{}";
                    usage = { inputTokens: ((_y = response.usage) === null || _y === void 0 ? void 0 : _y.prompt_tokens) || 0, outputTokens: ((_z = response.usage) === null || _z === void 0 ? void 0 : _z.completion_tokens) || 0 };
                    return [3 /*break*/, 13];
                case 12: throw fallbackErr_2;
                case 13: return [3 /*break*/, 14];
                case 14: return [3 /*break*/, 19];
                case 15:
                    if (!(status_3 === 429)) return [3 /*break*/, 18];
                    retryAfter = parseRetryAfter((_1 = (_0 = err_4 === null || err_4 === void 0 ? void 0 : err_4.headers) === null || _0 === void 0 ? void 0 : _0["retry-after"]) !== null && _1 !== void 0 ? _1 : null);
                    console.log("[Hypergraph] chunk ".concat(chunkId, "/").concat(chunkCount, ": 20B 429, waiting ").concat(retryAfter, "s"));
                    return [4 /*yield*/, sleep(retryAfter * 1000)];
                case 16:
                    _6.sent();
                    return [4 /*yield*/, callWithModel(TEXT_FALLBACK)];
                case 17:
                    _e = _6.sent(), response = _e.data, rawResponse = _e.response;
                    updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
                    content = ((_3 = (_2 = response.choices[0]) === null || _2 === void 0 ? void 0 : _2.message) === null || _3 === void 0 ? void 0 : _3.content) || "{}";
                    usage = { inputTokens: ((_4 = response.usage) === null || _4 === void 0 ? void 0 : _4.prompt_tokens) || 0, outputTokens: ((_5 = response.usage) === null || _5 === void 0 ? void 0 : _5.completion_tokens) || 0 };
                    return [3 /*break*/, 19];
                case 18: throw err_4;
                case 19: return [3 /*break*/, 20];
                case 20:
                    parsed = JSON.parse(content);
                    return [2 /*return*/, {
                            result: {
                                hypergraph: parsed.hypergraph || {},
                                conflicts: parsed.conflicts || [],
                                summary: parsed.summary || {
                                    total_fields_analyzed: 0,
                                    fields_with_conflicts: 0,
                                    confidence_score: 0,
                                },
                            },
                            usage: usage,
                        }];
            }
        });
    });
}
/**
 * Generate concise conflict annotations for deterministic hypergraph review.
 *
 * Called after deterministic conflict detection to add lightweight context on
 * what to investigate (e.g., duplicate IDs, stale values, partial billing).
 */
function generateHypergraphConflictReviewWithGptOss(reviewPayload) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, _a, content, usage, parsed;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    messages = [
                        {
                            role: "system",
                            content: "You are a legal case data consistency reviewer.\n\nOnly reason over the provided hypergraph candidates.\n\nReturn a single JSON object with this exact shape and no extra text:\n{\n  \"annotations\": [\n    {\n      \"field\": \"<field_name>\",\n      \"likely_reason\": \"<short likely explanation for why values conflict>\"\n    }\n  ]\n}\n\nIf you cannot infer a reason, return the field with a concise best-effort reason.\nYou can use wording like \"signature date vs. loss date\", \"partial vs. full amount\", or \"source document typo\".\n",
                        },
                        {
                            role: "user",
                            content: reviewPayload,
                        },
                    ];
                    return [4 /*yield*/, callTextWithFallback(messages, "hypergraph-review")];
                case 1:
                    _a = _b.sent(), content = _a.content, usage = _a.usage;
                    parsed = JSON.parse(content);
                    return [2 /*return*/, {
                            result: {
                                annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
                            },
                            usage: usage,
                        }];
            }
        });
    });
}
// ============================================================================
// Case Summary Generation with GPT-OSS 120B → 20B Fallback
// ============================================================================
/**
 * Generate case summary and phase using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
function generateCaseSummaryWithGptOss(condensedIndex, systemPrompt, userPrompt) {
    return __awaiter(this, void 0, void 0, function () {
        var messages, _a, content, usage, parsed;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    messages = [
                        {
                            role: "system",
                            content: "".concat(systemPrompt, "\n\n## OUTPUT FORMAT\n\nYou must respond with a single JSON object containing exactly these fields:\n- \"case_summary\" (string): Brief narrative summary of the case (2-4 sentences). Include incident type, injuries, treatment/procedural status, and current posture.\n- \"case_phase\" (string): Current lifecycle phase based on documents present.\n\nNo markdown, no explanation, no text outside the JSON."),
                        },
                        {
                            role: "user",
                            content: userPrompt,
                        },
                    ];
                    return [4 /*yield*/, callTextWithFallback(messages, "case-summary")];
                case 1:
                    _a = _b.sent(), content = _a.content, usage = _a.usage;
                    parsed = JSON.parse(content);
                    return [2 /*return*/, {
                            result: {
                                case_summary: parsed.case_summary || "Case summary generation failed.",
                                case_phase: parsed.case_phase || "Intake",
                            },
                            usage: usage,
                        }];
            }
        });
    });
}
