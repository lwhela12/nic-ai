"use strict";
/**
 * Document Reader with Vision Support
 *
 * Spawns an Agent SDK agent with the Read tool to read PDFs with full
 * multimodal support (rendered pages + extracted text). The SDK's Read tool
 * natively handles PDFs by base64-encoding them as document content blocks,
 * which the API renders as images and extracts text from.
 *
 * For non-PDF files, the agent reads them as plain text.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDocument = readDocument;
var claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
var sdk_cli_options_1 = require("./sdk-cli-options");
var path_1 = require("path");
var promises_1 = require("fs/promises");
var SYSTEM_PROMPT = "You are a document reading assistant. Your job is to read a specific document and answer a question about it.\n\n## Instructions\n\n1. Use the Read tool to read the file at the path provided\n2. Analyze the content carefully\n3. Answer the question based on what you see in the document\n\n## Document Types\n\n- **Medical records**: Look for patient name, dates of service, diagnoses (ICD codes), procedures (CPT codes), provider notes, and treatment plans\n- **Billing/invoices**: Look for provider name, dates of service, CPT codes, charges, payments, adjustments, and balances\n- **Legal documents**: Look for parties, dates, claim numbers, policy information, and key terms\n- **Forms/intake**: Look for filled-in fields, checkboxes, signatures, and dates \u2014 pay attention to spatial layout since form labels and values may be side by side\n- **Imaging reports**: Look for findings, impressions, and recommendations\n\n## Response Format\n\nAnswer the question directly and concisely. Include specific details like dates, amounts, and names when relevant. If the document is unclear or you can't find the requested information, say so.";
/**
 * Read a document using the Agent SDK's native PDF vision support.
 *
 * @param caseFolder - Absolute path to the case folder
 * @param documentPath - Relative path to the document within the case folder
 * @param question - What the user wants to know about the document
 */
function readDocument(caseFolder, documentPath, question) {
    return __asyncGenerator(this, arguments, function readDocument_1() {
        var fullPath, fileStat, _a, isPdf, prompt, resultContent, _b, _c, _d, msg, _i, _e, block, e_1_1, error_1;
        var _f, e_1, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    fullPath = (0, path_1.join)(caseFolder, documentPath);
                    if (!!fullPath.startsWith(caseFolder)) return [3 /*break*/, 4];
                    return [4 /*yield*/, __await({ type: "error", content: "Error: Cannot read files outside the case folder" })];
                case 1: return [4 /*yield*/, _j.sent()];
                case 2:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 3: return [2 /*return*/, _j.sent()];
                case 4:
                    _j.trys.push([4, 14, , 18]);
                    return [4 /*yield*/, __await((0, promises_1.stat)(fullPath))];
                case 5:
                    fileStat = _j.sent();
                    if (!!fileStat.isFile()) return [3 /*break*/, 9];
                    return [4 /*yield*/, __await({ type: "error", content: "Error: \"".concat(documentPath, "\" is not a file") })];
                case 6: return [4 /*yield*/, _j.sent()];
                case 7:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 8: return [2 /*return*/, _j.sent()];
                case 9:
                    if (!(fileStat.size > 20 * 1024 * 1024)) return [3 /*break*/, 13];
                    return [4 /*yield*/, __await({ type: "error", content: "Error: File is too large (".concat(Math.round(fileStat.size / 1024 / 1024), "MB). Maximum is 20MB.") })];
                case 10: return [4 /*yield*/, _j.sent()];
                case 11:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 12: return [2 /*return*/, _j.sent()];
                case 13: return [3 /*break*/, 18];
                case 14:
                    _a = _j.sent();
                    return [4 /*yield*/, __await({ type: "error", content: "Error: File not found: \"".concat(documentPath, "\"") })];
                case 15: return [4 /*yield*/, _j.sent()];
                case 16:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 17: return [2 /*return*/, _j.sent()];
                case 18:
                    isPdf = documentPath.toLowerCase().endsWith(".pdf");
                    return [4 /*yield*/, __await({
                            type: "status",
                            content: "Reading ".concat(documentPath).concat(isPdf ? " with vision" : "", "...")
                        })];
                case 19: return [4 /*yield*/, _j.sent()];
                case 20:
                    _j.sent();
                    prompt = "Read the file at this absolute path: ".concat(fullPath, "\n\nThen answer this question about the document:\n").concat(question);
                    _j.label = 21;
                case 21:
                    _j.trys.push([21, 46, , 49]);
                    resultContent = "";
                    _j.label = 22;
                case 22:
                    _j.trys.push([22, 33, 34, 39]);
                    _b = true, _c = __asyncValues((0, claude_agent_sdk_1.query)({
                        prompt: prompt,
                        options: __assign({ cwd: caseFolder, systemPrompt: SYSTEM_PROMPT, model: "haiku", allowedTools: ["Read"], permissionMode: "acceptEdits", maxTurns: 3 }, (0, sdk_cli_options_1.getSDKCliOptions)()),
                    }));
                    _j.label = 23;
                case 23: return [4 /*yield*/, __await(_c.next())];
                case 24:
                    if (!(_d = _j.sent(), _f = _d.done, !_f)) return [3 /*break*/, 32];
                    _h = _d.value;
                    _b = false;
                    msg = _h;
                    if (msg.type === "assistant") {
                        for (_i = 0, _e = msg.message.content; _i < _e.length; _i++) {
                            block = _e[_i];
                            if (block.type === "text") {
                                resultContent += block.text;
                            }
                        }
                    }
                    if (!(msg.type === "tool_use")) return [3 /*break*/, 27];
                    return [4 /*yield*/, __await({ type: "tool", content: "Reading ".concat(documentPath, "...") })];
                case 25: return [4 /*yield*/, _j.sent()];
                case 26:
                    _j.sent();
                    _j.label = 27;
                case 27:
                    if (!(msg.type === "result")) return [3 /*break*/, 31];
                    if (!(msg.subtype !== "success")) return [3 /*break*/, 31];
                    return [4 /*yield*/, __await({
                            type: "error",
                            content: "Document reading failed: ".concat(msg.subtype)
                        })];
                case 28: return [4 /*yield*/, _j.sent()];
                case 29:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 30: return [2 /*return*/, _j.sent()];
                case 31:
                    _b = true;
                    return [3 /*break*/, 23];
                case 32: return [3 /*break*/, 39];
                case 33:
                    e_1_1 = _j.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 39];
                case 34:
                    _j.trys.push([34, , 37, 38]);
                    if (!(!_b && !_f && (_g = _c.return))) return [3 /*break*/, 36];
                    return [4 /*yield*/, __await(_g.call(_c))];
                case 35:
                    _j.sent();
                    _j.label = 36;
                case 36: return [3 /*break*/, 38];
                case 37:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 38: return [7 /*endfinally*/];
                case 39:
                    if (!!resultContent) return [3 /*break*/, 43];
                    return [4 /*yield*/, __await({ type: "error", content: "No response from document reader" })];
                case 40: return [4 /*yield*/, _j.sent()];
                case 41:
                    _j.sent();
                    return [4 /*yield*/, __await(void 0)];
                case 42: return [2 /*return*/, _j.sent()];
                case 43: return [4 /*yield*/, __await({ type: "done", content: resultContent })];
                case 44: return [4 /*yield*/, _j.sent()];
                case 45:
                    _j.sent();
                    return [3 /*break*/, 49];
                case 46:
                    error_1 = _j.sent();
                    return [4 /*yield*/, __await({
                            type: "error",
                            content: "Error reading document: ".concat(error_1 instanceof Error ? error_1.message : String(error_1))
                        })];
                case 47: return [4 /*yield*/, _j.sent()];
                case 48:
                    _j.sent();
                    return [3 /*break*/, 49];
                case 49: return [2 /*return*/];
            }
        });
    });
}
