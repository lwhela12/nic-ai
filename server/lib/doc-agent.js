"use strict";
/**
 * Document Generation Agent
 *
 * Sonnet-powered agent for generating complex documents like demand letters,
 * case memos, and settlement calculations. Receives full context including
 * templates and knowledge bank.
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
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
exports.getClient = getClient;
exports.generateDocument = generateDocument;
exports.detectDocGenIntent = detectDocGenIntent;
var sdk_1 = require("@anthropic-ai/sdk");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var year_mode_1 = require("./year-mode");
var child_process_1 = require("child_process");
var knowledge_1 = require("../routes/knowledge");
var pdftotext_1 = require("./pdftotext");
var extract_1 = require("./extract");
var meta_index_1 = require("./meta-index");
// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
var _anthropic = null;
function getClient() {
    if (!_anthropic) {
        // Explicitly pass API key - env var reading may not work in bundled binary
        _anthropic = new sdk_1.default({
            apiKey: process.env.ANTHROPIC_API_KEY,
            fetch: globalThis.fetch.bind(globalThis),
        });
    }
    return _anthropic;
}
var INDEX_SLICE_MAX_CHARS = 12000;
// Tool definitions for the document agent
var DOC_TOOLS = [
    {
        name: "read_file",
        description: "Read a file from the case folder. Use to read templates, medical records, bills, or other case documents.",
        input_schema: {
            type: "object",
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
        name: "glob",
        description: "Find files matching a pattern (e.g., 'Medical/*.pdf', '**/*.md')",
        input_schema: {
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
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
/**
 * Load the full case index.
 */
function loadCaseIndex(caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var indexPath, content, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 1:
                    content = _b.sent();
                    return [2 /*return*/, JSON.parse(content)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, {}];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Build a bounded prompt view of case context for document generation.
 * Uses meta_index for a compact navigable summary, plus a trimmed index preview.
 */
function buildCasePromptContext(caseFolder, caseIndex) {
    return __awaiter(this, void 0, void 0, function () {
        var metaIndexData, metaIndexPath, content, _a, metaView, metaBlock, preview, _i, _b, _c, folderName, folderData, files, previewJson;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    metaIndexPath = (0, path_1.join)(caseFolder, ".ai_tool", "meta_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(metaIndexPath, "utf-8")];
                case 1:
                    content = _d.sent();
                    metaIndexData = JSON.parse(content);
                    return [3 /*break*/, 3];
                case 2:
                    _a = _d.sent();
                    metaIndexData = (0, meta_index_1.generateMetaIndex)(caseIndex);
                    return [3 /*break*/, 3];
                case 3:
                    metaView = (0, meta_index_1.buildMetaIndexPromptView)(metaIndexData);
                    metaBlock = "".concat(metaView, "\n[For full folder details, use read_file(\".ai_tool/indexes/{FolderName}.json\"). For deep index access, use read_index_slice.]");
                    preview = __assign({}, caseIndex);
                    if (preview.folders) {
                        for (_i = 0, _b = Object.entries(preview.folders); _i < _b.length; _i++) {
                            _c = _b[_i], folderName = _c[0], folderData = _c[1];
                            files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
                            if (!Array.isArray(files))
                                continue;
                            preview.folders[folderName] = {
                                files: files.slice(0, 140).map(function (file) { return ({
                                    filename: file.filename,
                                    type: file.type,
                                    date: file.date,
                                    key_info: typeof file.key_info === "string" ? file.key_info.slice(0, 220) : file.key_info,
                                }); }),
                                truncated: files.length > 140,
                            };
                        }
                    }
                    previewJson = JSON.stringify(preview, null, 2);
                    if (previewJson.length > 22000) {
                        previewJson = "".concat(previewJson.slice(0, 22000), "\n...\n[NOTE: Index preview truncated; use read_index_slice for exact details.]");
                    }
                    return [2 /*return*/, "".concat(metaBlock, "\n\nCASE INDEX PREVIEW:\n").concat(previewJson)];
            }
        });
    });
}
/**
 * Load all parsed templates as a single context string.
 */
function loadAllTemplates(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var templatesDir, indexPath, parsedDir, indexContent, index, parts, _i, _a, template, content, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    templatesDir = (0, path_1.join)(firmRoot, ".ai_tool", "templates");
                    indexPath = (0, path_1.join)(templatesDir, "templates.json");
                    parsedDir = (0, path_1.join)(templatesDir, "parsed");
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 9, , 10]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 2:
                    indexContent = _d.sent();
                    index = JSON.parse(indexContent);
                    parts = [];
                    _i = 0, _a = index.templates;
                    _d.label = 3;
                case 3:
                    if (!(_i < _a.length)) return [3 /*break*/, 8];
                    template = _a[_i];
                    if (!template.parsedFile)
                        return [3 /*break*/, 7];
                    _d.label = 4;
                case 4:
                    _d.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(templatesDir, template.parsedFile), "utf-8")];
                case 5:
                    content = _d.sent();
                    parts.push("## TEMPLATE: ".concat(template.name, " (").concat(template.id, ")\n\n").concat(template.description || "No description", "\n\n---\n\n").concat(content, "\n\n---\n"));
                    return [3 /*break*/, 7];
                case 6:
                    _b = _d.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _i++;
                    return [3 /*break*/, 3];
                case 8:
                    if (parts.length === 0) {
                        return [2 /*return*/, "No templates available."];
                    }
                    return [2 /*return*/, parts.join("\n\n")];
                case 9:
                    _c = _d.sent();
                    return [2 /*return*/, "No templates available."];
                case 10: return [2 /*return*/];
            }
        });
    });
}
/**
 * Load firm configuration.
 */
function loadFirmConfig(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var configPath, _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    configPath = (0, path_1.join)(firmRoot, ".ai_tool", "firm-config.json");
                    _b = (_a = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(configPath, "utf-8")];
                case 1: return [2 /*return*/, _b.apply(_a, [_d.sent()])];
                case 2:
                    _c = _d.sent();
                    return [2 /*return*/, {}];
                case 3: return [2 /*return*/];
            }
        });
    });
}
var TEXT_SEARCH_EXTENSIONS = new Set([".txt", ".md", ".json"]);
function normalizeRelativePath(path) {
    return path.replace(/\\/g, "/");
}
function matchesSearchPattern(content, pattern, regex) {
    if (regex) {
        return regex.test(content);
    }
    return content.toLowerCase().includes(pattern.toLowerCase());
}
function collectSearchTargets(searchPath) {
    return __awaiter(this, void 0, void 0, function () {
        var targets, searchStat, glob, _a, _b, _c, relPath, dotIndex, ext, e_1_1;
        var _d, e_1, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    targets = [];
                    return [4 /*yield*/, (0, promises_1.stat)(searchPath)];
                case 1:
                    searchStat = _g.sent();
                    if (searchStat.isFile()) {
                        targets.push(searchPath);
                        return [2 /*return*/, targets];
                    }
                    glob = new Bun.Glob("**/*");
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 7, 8, 13]);
                    _a = true, _b = __asyncValues(glob.scan({ cwd: searchPath, onlyFiles: true }));
                    _g.label = 3;
                case 3: return [4 /*yield*/, _b.next()];
                case 4:
                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 6];
                    _f = _c.value;
                    _a = false;
                    relPath = _f;
                    dotIndex = relPath.lastIndexOf(".");
                    ext = dotIndex >= 0 ? relPath.slice(dotIndex).toLowerCase() : "";
                    if (TEXT_SEARCH_EXTENSIONS.has(ext)) {
                        targets.push((0, path_1.join)(searchPath, relPath));
                    }
                    _g.label = 5;
                case 5:
                    _a = true;
                    return [3 /*break*/, 3];
                case 6: return [3 /*break*/, 13];
                case 7:
                    e_1_1 = _g.sent();
                    e_1 = { error: e_1_1 };
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
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 12: return [7 /*endfinally*/];
                case 13: return [2 /*return*/, targets];
            }
        });
    });
}
/**
 * Execute a tool and return the result.
 */
function executeTool(toolName, toolInput, caseFolder, firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, filePath, firmPath, content_1, _b, normalizedPath, text, _c, text, _d, content, indexPath, content, offsetRaw, lengthRaw, offset, length_1, end, slice, glob, matches, _e, _f, _g, file, e_2_1, searchPath, rawPattern, regex, candidates, matchedFiles, _i, candidates_1, candidate, content, relPath, _h, _j, folderPath, entries, listing, _k, command_1, dangerous, result, err, draftsDir, filePath, relativePath, draftsDir, filePath, relativePath, error_1;
        var _l, e_2, _m, _o;
        var _p;
        return __generator(this, function (_q) {
            switch (_q.label) {
                case 0:
                    _q.trys.push([0, 53, , 54]);
                    _a = toolName;
                    switch (_a) {
                        case "read_file": return [3 /*break*/, 1];
                        case "read_index_slice": return [3 /*break*/, 15];
                        case "glob": return [3 /*break*/, 17];
                        case "grep": return [3 /*break*/, 30];
                        case "list_folder": return [3 /*break*/, 40];
                        case "bash": return [3 /*break*/, 44];
                        case "write_draft": return [3 /*break*/, 45];
                        case "write_document": return [3 /*break*/, 48];
                    }
                    return [3 /*break*/, 51];
                case 1:
                    filePath = (0, path_1.join)(caseFolder, toolInput.path);
                    if (!toolInput.path.startsWith(".ai_tool/templates")) return [3 /*break*/, 5];
                    firmPath = (0, path_1.join)(firmRoot, toolInput.path);
                    _q.label = 2;
                case 2:
                    _q.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, promises_1.readFile)(firmPath, "utf-8")];
                case 3:
                    content_1 = _q.sent();
                    return [2 /*return*/, { result: content_1.slice(0, 20000) }];
                case 4:
                    _b = _q.sent();
                    return [3 /*break*/, 5];
                case 5:
                    // Security check
                    if (!filePath.startsWith(caseFolder) && !filePath.startsWith(firmRoot)) {
                        return [2 /*return*/, { result: "Error: Cannot read files outside the case/firm folder" }];
                    }
                    normalizedPath = toolInput.path.toLowerCase();
                    if (!normalizedPath.endsWith('.pdf')) return [3 /*break*/, 9];
                    _q.label = 6;
                case 6:
                    _q.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, (0, pdftotext_1.extractPdfText)(filePath, {
                            layout: false,
                            maxBuffer: 2 * 1024 * 1024,
                            timeout: 30000,
                        })];
                case 7:
                    text = _q.sent();
                    return [2 /*return*/, { result: text.slice(0, 20000) }];
                case 8:
                    _c = _q.sent();
                    return [2 /*return*/, { result: "Error: Could not extract text from PDF" }];
                case 9:
                    if (!normalizedPath.endsWith('.docx')) return [3 /*break*/, 13];
                    _q.label = 10;
                case 10:
                    _q.trys.push([10, 12, , 13]);
                    return [4 /*yield*/, (0, extract_1.extractTextFromDocx)(filePath)];
                case 11:
                    text = _q.sent();
                    return [2 /*return*/, { result: text.slice(0, 20000) }];
                case 12:
                    _d = _q.sent();
                    return [2 /*return*/, { result: "Error: Could not extract text from DOCX" }];
                case 13: return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
                case 14:
                    content = _q.sent();
                    return [2 /*return*/, { result: content.slice(0, 20000) }];
                case 15:
                    indexPath = (0, path_1.join)(caseFolder, ".ai_tool", "document_index.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 16:
                    content = _q.sent();
                    offsetRaw = Number(toolInput.offset);
                    lengthRaw = toolInput.length === undefined ? INDEX_SLICE_MAX_CHARS : Number(toolInput.length);
                    offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
                    length_1 = Number.isFinite(lengthRaw) && lengthRaw > 0
                        ? Math.min(Math.floor(lengthRaw), INDEX_SLICE_MAX_CHARS)
                        : INDEX_SLICE_MAX_CHARS;
                    end = Math.min(content.length, offset + length_1);
                    slice = content.slice(offset, end);
                    return [2 /*return*/, {
                            result: JSON.stringify({
                                total_chars: content.length,
                                offset: offset,
                                end: end,
                                has_more: end < content.length,
                                next_offset: end < content.length ? end : null,
                                slice: slice,
                            }),
                        }];
                case 17:
                    glob = new Bun.Glob(toolInput.pattern);
                    matches = [];
                    _q.label = 18;
                case 18:
                    _q.trys.push([18, 23, 24, 29]);
                    _e = true, _f = __asyncValues(glob.scan({ cwd: caseFolder, onlyFiles: true }));
                    _q.label = 19;
                case 19: return [4 /*yield*/, _f.next()];
                case 20:
                    if (!(_g = _q.sent(), _l = _g.done, !_l)) return [3 /*break*/, 22];
                    _o = _g.value;
                    _e = false;
                    file = _o;
                    matches.push(file);
                    if (matches.length >= 100)
                        return [3 /*break*/, 22]; // Limit results
                    _q.label = 21;
                case 21:
                    _e = true;
                    return [3 /*break*/, 19];
                case 22: return [3 /*break*/, 29];
                case 23:
                    e_2_1 = _q.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 29];
                case 24:
                    _q.trys.push([24, , 27, 28]);
                    if (!(!_e && !_l && (_m = _f.return))) return [3 /*break*/, 26];
                    return [4 /*yield*/, _m.call(_f)];
                case 25:
                    _q.sent();
                    _q.label = 26;
                case 26: return [3 /*break*/, 28];
                case 27:
                    if (e_2) throw e_2.error;
                    return [7 /*endfinally*/];
                case 28: return [7 /*endfinally*/];
                case 29:
                    if (matches.length === 0) {
                        return [2 /*return*/, { result: "No files found matching pattern" }];
                    }
                    return [2 /*return*/, { result: matches.join("\n") }];
                case 30:
                    searchPath = toolInput.path ? (0, path_1.join)(caseFolder, toolInput.path) : caseFolder;
                    rawPattern = String((_p = toolInput.pattern) !== null && _p !== void 0 ? _p : "").trim();
                    if (!rawPattern) {
                        return [2 /*return*/, { result: "Error: pattern is required" }];
                    }
                    // Security check
                    if (!searchPath.startsWith(caseFolder)) {
                        return [2 /*return*/, { result: "Error: Cannot search outside the case folder" }];
                    }
                    _q.label = 31;
                case 31:
                    _q.trys.push([31, 39, , 40]);
                    regex = null;
                    try {
                        regex = new RegExp(rawPattern, "i");
                    }
                    catch (_r) {
                        regex = null;
                    }
                    return [4 /*yield*/, collectSearchTargets(searchPath)];
                case 32:
                    candidates = _q.sent();
                    matchedFiles = [];
                    _i = 0, candidates_1 = candidates;
                    _q.label = 33;
                case 33:
                    if (!(_i < candidates_1.length)) return [3 /*break*/, 38];
                    candidate = candidates_1[_i];
                    if (matchedFiles.length >= 20)
                        return [3 /*break*/, 38];
                    _q.label = 34;
                case 34:
                    _q.trys.push([34, 36, , 37]);
                    return [4 /*yield*/, (0, promises_1.readFile)(candidate, "utf-8")];
                case 35:
                    content = _q.sent();
                    if (matchesSearchPattern(content, rawPattern, regex)) {
                        relPath = normalizeRelativePath((0, path_1.relative)(caseFolder, candidate));
                        matchedFiles.push(relPath);
                    }
                    return [3 /*break*/, 37];
                case 36:
                    _h = _q.sent();
                    return [3 /*break*/, 37];
                case 37:
                    _i++;
                    return [3 /*break*/, 33];
                case 38:
                    if (matchedFiles.length === 0) {
                        return [2 /*return*/, { result: "No matches found" }];
                    }
                    return [2 /*return*/, { result: "Files containing \"".concat(rawPattern, "\":\n").concat(matchedFiles.join('\n')) }];
                case 39:
                    _j = _q.sent();
                    return [2 /*return*/, { result: "No matches found" }];
                case 40:
                    folderPath = toolInput.path ? (0, path_1.join)(caseFolder, toolInput.path) : caseFolder;
                    // Security check
                    if (!folderPath.startsWith(caseFolder)) {
                        return [2 /*return*/, { result: "Error: Cannot list folders outside the case folder" }];
                    }
                    _q.label = 41;
                case 41:
                    _q.trys.push([41, 43, , 44]);
                    return [4 /*yield*/, (0, promises_1.readdir)(folderPath, { withFileTypes: true })];
                case 42:
                    entries = _q.sent();
                    listing = entries.map(function (e) { return "".concat(e.isDirectory() ? '[DIR]' : '[FILE]', " ").concat(e.name); });
                    return [2 /*return*/, { result: listing.join('\n') || "Empty folder" }];
                case 43:
                    _k = _q.sent();
                    return [2 /*return*/, { result: "Error: Folder not found or not accessible" }];
                case 44:
                    {
                        command_1 = toolInput.command;
                        dangerous = ['rm -rf', 'sudo', '>', '>>', 'chmod', 'chown', 'curl', 'wget', 'eval'];
                        if (dangerous.some(function (d) { return command_1.includes(d); })) {
                            return [2 /*return*/, { result: "Error: Command not allowed for security reasons" }];
                        }
                        try {
                            result = (0, child_process_1.execSync)(command_1, {
                                cwd: caseFolder,
                                encoding: 'utf-8',
                                maxBuffer: 2 * 1024 * 1024,
                                timeout: 30000 // 30 second timeout
                            });
                            return [2 /*return*/, { result: result.slice(0, 20000) || "(no output)" }];
                        }
                        catch (error) {
                            err = error;
                            return [2 /*return*/, { result: "Command failed: ".concat(err.stderr || err.message || 'Unknown error') }];
                        }
                    }
                    _q.label = 45;
                case 45:
                    draftsDir = (0, path_1.join)(caseFolder, ".ai_tool", "drafts");
                    return [4 /*yield*/, (0, promises_1.mkdir)(draftsDir, { recursive: true })];
                case 46:
                    _q.sent();
                    filePath = (0, path_1.join)(draftsDir, toolInput.filename);
                    // Security check: verify path is within case folder
                    if (!filePath.startsWith(caseFolder)) {
                        return [2 /*return*/, { result: "Error: Cannot write files outside the case folder" }];
                    }
                    return [4 /*yield*/, (0, promises_1.writeFile)(filePath, toolInput.content)];
                case 47:
                    _q.sent();
                    relativePath = ".ai_tool/drafts/".concat(toolInput.filename);
                    return [2 /*return*/, {
                            result: "Draft saved to ".concat(relativePath),
                            filePath: relativePath
                        }];
                case 48:
                    draftsDir = (0, path_1.join)(caseFolder, ".ai_tool", "drafts");
                    return [4 /*yield*/, (0, promises_1.mkdir)(draftsDir, { recursive: true })];
                case 49:
                    _q.sent();
                    filePath = (0, path_1.join)(draftsDir, toolInput.filename);
                    if (!filePath.startsWith(caseFolder)) {
                        return [2 /*return*/, { result: "Error: Cannot write files outside the case folder" }];
                    }
                    return [4 /*yield*/, (0, promises_1.writeFile)(filePath, toolInput.content)];
                case 50:
                    _q.sent();
                    relativePath = ".ai_tool/drafts/".concat(toolInput.filename);
                    return [2 /*return*/, {
                            result: "Draft saved to ".concat(relativePath),
                            filePath: relativePath
                        }];
                case 51: return [2 /*return*/, { result: "Unknown tool: ".concat(toolName) }];
                case 52: return [3 /*break*/, 54];
                case 53:
                    error_1 = _q.sent();
                    return [2 /*return*/, {
                            result: "Error executing ".concat(toolName, ": ").concat(error_1 instanceof Error ? error_1.message : String(error_1))
                        }];
                case 54: return [2 /*return*/];
            }
        });
    });
}
/**
 * Build the system prompt for document generation.
 */
function buildSystemPrompt(docType, knowledge, templates, firmConfig) {
    var docTypeDescriptions = {
        demand_letter: "a demand letter to the at-fault party's insurance carrier",
        case_memo: "an internal case memorandum summarizing the case",
        settlement: "a settlement calculation and disbursement breakdown",
        general_letter: "a professional letter related to the case",
        decision_order: "a workers' compensation hearing Decision & Order for filing",
    };
    var docTypeSpecificInstructions = {
        demand_letter: "\nDemand-letter specific requirements:\n- Follow demand template language closely when available.\n- Include provider-by-provider specials with totals.\n- Make sure demand amount/policy-limits framing is explicitly stated.",
        case_memo: "\nCase-memo specific requirements:\n- Include case posture, major facts, treatment summary, financial snapshot, and open issues.\n- Keep it internal-facing and analytical.",
        settlement: "\nSettlement specific requirements:\n- Show clear arithmetic for all inflows/outflows.\n- Include assumptions and flags where figures are uncertain.",
        general_letter: "\nGeneral-letter specific requirements:\n- Keep formal business-letter formatting.\n- Keep requests, deadlines, and asks explicit.",
        decision_order: "\nDecision & Order specific requirements:\n- This is a post-hearing legal filing style document, not a letter.\n- Use this core structure:\n  1) Caption / case heading\n  2) Introductory hearing/procedural paragraph(s)\n  3) Exhibits admitted (if known)\n  4) FINDINGS OF FACT (numbered)\n  5) CONCLUSIONS OF LAW (numbered, statute/case citations when supported)\n  6) ORDER (numbered decretal rulings tied to appealed issues)\n  7) Signature / submission block (if requested)\n- Ground every finding and legal conclusion in case documents/index data; do not invent facts, holdings, dates, or citations.\n- If critical filing detail is missing (appeal no., claim no., hearing date, AO name), insert a clear [VERIFY: ...] placeholder rather than guessing.\n- Default draft filename for this type: decision_and_order.md",
    };
    return "You are a legal document drafting assistant for a Personal Injury law firm. Your task is to generate ".concat(docTypeDescriptions[docType], ".\n\n## FIRM INFORMATION\n\n").concat(firmConfig.firmName ? "Firm: ".concat(firmConfig.firmName) : "", "\n").concat(firmConfig.address ? "Address: ".concat(firmConfig.address) : "", "\n").concat(firmConfig.phone ? "Phone: ".concat(firmConfig.phone) : "", "\n").concat(firmConfig.feeStructure ? "Fee Structure: ".concat(firmConfig.feeStructure) : "", "\n\n## PRACTICE KNOWLEDGE\n\n").concat(knowledge, "\n\n## AVAILABLE TEMPLATES\n\n").concat(templates, "\n\n## INSTRUCTIONS\n\n1. First, review the meta-index/index preview to understand the case\n2. If you need deeper detail from document_index.json, use read_index_slice in chunks\n3. If you need more detail on specific documents, use read_file to review them\n4. Select the most appropriate template for this document\n5. Read the template to understand its structure and requirements\n6. Draft the document following the template structure\n7. Fill in all placeholders with actual case data\n8. Use write_draft to save the final document\n\n## DOCUMENT-SPECIFIC REQUIREMENTS\n\n").concat(docTypeSpecificInstructions[docType], "\n\nIMPORTANT:\n- Follow the template structure closely\n- Use professional legal language\n- Ensure all facts are accurate based on the case documents\n- Include proper dates, amounts, and details\n- Write the complete document - do not leave placeholders unfilled\n- Save the document when complete using write_draft\n\n## AVAILABLE TOOLS\n\n- read_file: Read any file in the case folder (handles PDFs automatically)\n- read_index_slice: Read document_index.json in bounded chunks for very large cases\n- glob: Find files matching a pattern (e.g., 'Medical/*.pdf')\n- grep: Search for text across files\n- list_folder: List directory contents\n- bash: Run shell commands for complex operations\n- write_draft: Save your completed document to .ai_tool/drafts/");
}
/**
 * Main document generation function.
 * Returns an async generator for streaming progress back to the chat.
 */
function generateDocument(caseFolder, docType, userPrompt) {
    return __asyncGenerator(this, arguments, function generateDocument_1() {
        var firmRoot, _a, caseIndex, knowledge, templates, firmConfig, caseContext, systemPrompt, userMessage, messages, iterations, maxIterations, finalFilePath, response, textContent, toolUses, _i, _b, block, toolResults, _c, toolUses_1, toolUse, _d, result, filePath;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    firmRoot = (0, year_mode_1.resolveFirmRoot)(caseFolder);
                    return [4 /*yield*/, __await({ type: "status", content: "Loading case data and templates..." })];
                case 1: return [4 /*yield*/, _e.sent()];
                case 2:
                    _e.sent();
                    return [4 /*yield*/, __await(Promise.all([
                            loadCaseIndex(caseFolder),
                            (0, knowledge_1.loadSectionsByIds)(firmRoot), // Load all knowledge sections
                            loadAllTemplates(firmRoot),
                            loadFirmConfig(firmRoot)
                        ]))];
                case 3:
                    _a = _e.sent(), caseIndex = _a[0], knowledge = _a[1], templates = _a[2], firmConfig = _a[3];
                    return [4 /*yield*/, __await(buildCasePromptContext(caseFolder, caseIndex))];
                case 4:
                    caseContext = _e.sent();
                    systemPrompt = buildSystemPrompt(docType, knowledge, templates, firmConfig);
                    userMessage = "CASE CONTEXT:\n".concat(caseContext, "\n\nUSER REQUEST:\n").concat(userPrompt, "\n\nPlease generate the requested document. Start by reviewing the case context above, then select and read the appropriate template, and finally draft and save the document.");
                    messages = [
                        { role: "user", content: userMessage }
                    ];
                    return [4 /*yield*/, __await({ type: "status", content: "Starting document generation..." })];
                case 5: return [4 /*yield*/, _e.sent()];
                case 6:
                    _e.sent();
                    iterations = 0;
                    maxIterations = 10;
                    _e.label = 7;
                case 7:
                    if (!(iterations < maxIterations)) return [3 /*break*/, 18];
                    iterations++;
                    return [4 /*yield*/, __await(getClient().messages.create({
                            model: "claude-sonnet-4-5-20250929",
                            max_tokens: 8192,
                            system: systemPrompt,
                            messages: messages,
                            tools: DOC_TOOLS
                        }))];
                case 8:
                    response = _e.sent();
                    textContent = "";
                    toolUses = [];
                    for (_i = 0, _b = response.content; _i < _b.length; _i++) {
                        block = _b[_i];
                        if (block.type === "text") {
                            textContent += block.text;
                        }
                        else if (block.type === "tool_use") {
                            toolUses.push({
                                id: block.id,
                                name: block.name,
                                input: block.input
                            });
                        }
                    }
                    if (!textContent) return [3 /*break*/, 11];
                    return [4 /*yield*/, __await({ type: "text", content: textContent })];
                case 9: return [4 /*yield*/, _e.sent()];
                case 10:
                    _e.sent();
                    _e.label = 11;
                case 11:
                    // If no tool use, we're done
                    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
                        return [3 /*break*/, 18];
                    }
                    toolResults = [];
                    _c = 0, toolUses_1 = toolUses;
                    _e.label = 12;
                case 12:
                    if (!(_c < toolUses_1.length)) return [3 /*break*/, 17];
                    toolUse = toolUses_1[_c];
                    return [4 /*yield*/, __await({ type: "tool", content: "Using ".concat(toolUse.name, "...") })];
                case 13: return [4 /*yield*/, _e.sent()];
                case 14:
                    _e.sent();
                    return [4 /*yield*/, __await(executeTool(toolUse.name, toolUse.input, caseFolder, firmRoot))];
                case 15:
                    _d = _e.sent(), result = _d.result, filePath = _d.filePath;
                    if (filePath) {
                        finalFilePath = filePath;
                    }
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: result
                    });
                    _e.label = 16;
                case 16:
                    _c++;
                    return [3 /*break*/, 12];
                case 17:
                    // Add assistant message with tool uses
                    messages.push({
                        role: "assistant",
                        content: __spreadArray(__spreadArray([], (textContent ? [{ type: "text", text: textContent }] : []), true), toolUses.map(function (t) { return ({
                            type: "tool_use",
                            id: t.id,
                            name: t.name,
                            input: t.input
                        }); }), true)
                    });
                    // Add tool results
                    messages.push({
                        role: "user",
                        content: toolResults
                    });
                    return [3 /*break*/, 7];
                case 18: return [4 /*yield*/, __await({
                        type: "done",
                        done: true,
                        filePath: finalFilePath
                    })];
                case 19: return [4 /*yield*/, _e.sent()];
                case 20:
                    _e.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Detect if a user message is requesting document generation.
 * Returns the document type if detected, null otherwise.
 */
function detectDocGenIntent(message) {
    var lower = message.toLowerCase();
    // Must have a generation verb
    var genWords = /\b(draft|write|generate|create|prepare|make)\b/;
    if (!genWords.test(lower))
        return null;
    // Check for specific document types
    var patterns = [
        { keywords: ["demand letter", "demand"], type: "demand_letter" },
        { keywords: ["case memo", "memo", "memorandum"], type: "case_memo" },
        { keywords: ["decision and order", "decision & order", "appeals officer decision", "hearing decision", "dao"], type: "decision_order" },
        { keywords: ["settlement", "disbursement", "calculation"], type: "settlement" },
        { keywords: ["letter"], type: "general_letter" }
    ];
    for (var _i = 0, patterns_1 = patterns; _i < patterns_1.length; _i++) {
        var pattern = patterns_1[_i];
        if (pattern.keywords.some(function (k) { return lower.includes(k); })) {
            return { type: pattern.type, prompt: message };
        }
    }
    return null;
}
