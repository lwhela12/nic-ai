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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
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
exports.loadPracticeGuide = loadPracticeGuide;
exports.clearKnowledgeCache = clearKnowledgeCache;
exports.loadSectionsByIds = loadSectionsByIds;
exports.loadDocumentTemplates = loadDocumentTemplates;
var hono_1 = require("hono");
var streaming_1 = require("hono/streaming");
var claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
var sdk_1 = require("@anthropic-ai/sdk");
// SDK CLI options helper - handles both direct and npx modes
var sdk_cli_options_1 = require("../lib/sdk-cli-options");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var extract_1 = require("../lib/extract");
var team_access_1 = require("../lib/team-access");
var evidence_packet_1 = require("../lib/evidence-packet");
var knowledge_tagger_1 = require("../lib/knowledge-tagger");
var direct_chat_1 = require("../lib/direct-chat");
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
var app = new hono_1.Hono();
function resolveRootFromRequest(c) {
    return __awaiter(this, void 0, void 0, function () {
        var queryRoot, contentType, body, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    queryRoot = c.req.query("root");
                    if (queryRoot)
                        return [2 /*return*/, queryRoot];
                    contentType = c.req.header("content-type") || "";
                    if (!contentType.includes("application/json"))
                        return [2 /*return*/, null];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, c.req.raw.clone().json()];
                case 2:
                    body = _b.sent();
                    return [2 /*return*/, typeof body.root === "string" ? body.root : null];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 4: return [2 /*return*/];
            }
        });
    });
}
app.use("/*", function (c, next) { return __awaiter(void 0, void 0, void 0, function () {
    var root, access;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, resolveRootFromRequest(c)];
            case 1:
                root = _a.sent();
                if (!root) {
                    return [2 /*return*/, next()];
                }
                return [4 /*yield*/, (0, team_access_1.requireFirmAccess)(c, root)];
            case 2:
                access = _a.sent();
                if (!access.ok) {
                    return [2 /*return*/, access.response];
                }
                if (c.req.method !== "GET" && !access.context.permissions.canEditKnowledge) {
                    return [2 /*return*/, c.json({ error: "insufficient_permissions" }, 403)];
                }
                return [2 /*return*/, next()];
        }
    });
}); });
// Use env var for production (set by Electron), fall back to relative path for dev
var agentPath = process.env.AGENT_PROMPT_PATH || (0, path_1.join)(import.meta.dir, "../../agent");
var templatesDir = (0, path_1.join)(agentPath, "templates");
// ============================================================================
// TEMPLATE ENDPOINTS
// ============================================================================
// List available practice area templates
app.get("/templates", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var entries, templates, _i, entries_1, entry, manifestPath, manifest, _a, _b, _c, error_1;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                _d.trys.push([0, 8, , 9]);
                return [4 /*yield*/, (0, promises_1.readdir)(templatesDir, { withFileTypes: true })];
            case 1:
                entries = _d.sent();
                templates = [];
                _i = 0, entries_1 = entries;
                _d.label = 2;
            case 2:
                if (!(_i < entries_1.length)) return [3 /*break*/, 7];
                entry = entries_1[_i];
                if (!entry.isDirectory())
                    return [3 /*break*/, 6];
                _d.label = 3;
            case 3:
                _d.trys.push([3, 5, , 6]);
                manifestPath = (0, path_1.join)(templatesDir, entry.name, "manifest.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 4:
                manifest = _b.apply(_a, [_d.sent()]);
                templates.push({
                    id: entry.name,
                    practiceArea: manifest.practiceArea,
                    jurisdiction: manifest.jurisdiction,
                });
                return [3 /*break*/, 6];
            case 5:
                _c = _d.sent();
                return [3 /*break*/, 6];
            case 6:
                _i++;
                return [3 /*break*/, 2];
            case 7: return [2 /*return*/, c.json(templates)];
            case 8:
                error_1 = _d.sent();
                return [2 /*return*/, c.json({ error: "Failed to list templates" }, 500)];
            case 9: return [2 /*return*/];
        }
    });
}); });
// Initialize knowledge from template
app.post("/init", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, templateId, templateDir, knowledgeDir, manifestPath, manifest_1, _b, _c, _i, _d, section, src, dest, firmConfigPath, _e, defaultConfig, error_2;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _f.sent(), root = _a.root, templateId = _a.templateId;
                if (!root || !templateId) {
                    return [2 /*return*/, c.json({ error: "root and templateId required" }, 400)];
                }
                templateDir = (0, path_1.join)(templatesDir, templateId);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                _f.label = 2;
            case 2:
                _f.trys.push([2, 15, , 16]);
                manifestPath = (0, path_1.join)(templateDir, "manifest.json");
                _c = (_b = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest_1 = _c.apply(_b, [_f.sent()]);
                // Create knowledge directory
                return [4 /*yield*/, (0, promises_1.mkdir)(knowledgeDir, { recursive: true })];
            case 4:
                // Create knowledge directory
                _f.sent();
                // Copy manifest
                return [4 /*yield*/, (0, promises_1.copyFile)(manifestPath, (0, path_1.join)(knowledgeDir, "manifest.json"))];
            case 5:
                // Copy manifest
                _f.sent();
                _i = 0, _d = manifest_1.sections;
                _f.label = 6;
            case 6:
                if (!(_i < _d.length)) return [3 /*break*/, 9];
                section = _d[_i];
                src = (0, path_1.join)(templateDir, section.filename);
                dest = (0, path_1.join)(knowledgeDir, section.filename);
                return [4 /*yield*/, (0, promises_1.copyFile)(src, dest)];
            case 7:
                _f.sent();
                _f.label = 8;
            case 8:
                _i++;
                return [3 /*break*/, 6];
            case 9:
                firmConfigPath = (0, path_1.join)(root, ".ai_tool", "firm-config.json");
                _f.label = 10;
            case 10:
                _f.trys.push([10, 12, , 14]);
                return [4 /*yield*/, (0, promises_1.stat)(firmConfigPath)];
            case 11:
                _f.sent();
                return [3 /*break*/, 14];
            case 12:
                _e = _f.sent();
                defaultConfig = {
                    firmName: "",
                    attorneyName: "",
                    nevadaBarNo: "",
                    address: "",
                    cityStateZip: "",
                    phone: "",
                    fax: "",
                    email: "",
                    practiceArea: manifest_1.practiceArea,
                    jurisdiction: manifest_1.jurisdiction,
                    feeStructure: "",
                };
                return [4 /*yield*/, (0, promises_1.writeFile)(firmConfigPath, JSON.stringify(defaultConfig, null, 2))];
            case 13:
                _f.sent();
                return [3 /*break*/, 14];
            case 14:
                // Generate semantic tags and holistic summary for all sections (non-blocking)
                (function () { return __awaiter(void 0, void 0, void 0, function () {
                    var tagInputs, _i, _a, section, content, _b, _c, tagsMap, knowledgeSummary, metaIndexPath, manifestMtime, sectionMtimes, sections, _d, _e, section, st, _f, tags, content, metaIndex, err_1;
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                _g.trys.push([0, 19, , 20]);
                                tagInputs = [];
                                _i = 0, _a = manifest_1.sections;
                                _g.label = 1;
                            case 1:
                                if (!(_i < _a.length)) return [3 /*break*/, 6];
                                section = _a[_i];
                                _g.label = 2;
                            case 2:
                                _g.trys.push([2, 4, , 5]);
                                return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, section.filename), "utf-8")];
                            case 3:
                                content = _g.sent();
                                tagInputs.push({ filename: section.filename, title: section.title, content: content });
                                return [3 /*break*/, 5];
                            case 4:
                                _b = _g.sent();
                                return [3 /*break*/, 5];
                            case 5:
                                _i++;
                                return [3 /*break*/, 1];
                            case 6:
                                if (!(tagInputs.length > 0)) return [3 /*break*/, 18];
                                return [4 /*yield*/, Promise.all([
                                        (0, knowledge_tagger_1.generateTagsForAllSections)(tagInputs),
                                        (0, knowledge_tagger_1.generateKnowledgeSummary)(tagInputs),
                                    ])];
                            case 7:
                                _c = _g.sent(), tagsMap = _c[0], knowledgeSummary = _c[1];
                                metaIndexPath = (0, path_1.join)(root, ".ai_tool", "knowledge", "meta_index.json");
                                return [4 /*yield*/, (0, promises_1.stat)((0, path_1.join)(knowledgeDir, "manifest.json"))];
                            case 8:
                                manifestMtime = (_g.sent()).mtimeMs;
                                sectionMtimes = {};
                                sections = [];
                                _d = 0, _e = manifest_1.sections;
                                _g.label = 9;
                            case 9:
                                if (!(_d < _e.length)) return [3 /*break*/, 16];
                                section = _e[_d];
                                _g.label = 10;
                            case 10:
                                _g.trys.push([10, 12, , 13]);
                                return [4 /*yield*/, (0, promises_1.stat)((0, path_1.join)(knowledgeDir, section.filename))];
                            case 11:
                                st = _g.sent();
                                sectionMtimes[section.filename] = st.mtimeMs;
                                return [3 /*break*/, 13];
                            case 12:
                                _f = _g.sent();
                                return [3 /*break*/, 13];
                            case 13:
                                tags = tagsMap.get(section.filename);
                                return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, section.filename), "utf-8").catch(function () { return ""; })];
                            case 14:
                                content = _g.sent();
                                sections.push(__assign({ id: section.id, title: section.title, filename: section.filename, path: ".ai_tool/knowledge/".concat(section.filename), preview: content.replace(/\s+/g, " ").trim().slice(0, 420), char_count: content.length }, (tags ? { topics: tags.topics, applies_to: tags.applies_to, summary: tags.summary } : {})));
                                _g.label = 15;
                            case 15:
                                _d++;
                                return [3 /*break*/, 9];
                            case 16:
                                metaIndex = {
                                    indexed_at: new Date().toISOString(),
                                    source: ".ai_tool/knowledge/manifest.json",
                                    source_mtime: manifestMtime,
                                    practice_area: manifest_1.practiceArea,
                                    jurisdiction: manifest_1.jurisdiction,
                                    section_count: sections.length,
                                    sections: sections,
                                    section_mtimes: sectionMtimes,
                                    has_semantic_tags: tagsMap.size > 0,
                                };
                                if (knowledgeSummary) {
                                    metaIndex.knowledge_summary = knowledgeSummary;
                                }
                                return [4 /*yield*/, (0, promises_1.writeFile)(metaIndexPath, JSON.stringify(metaIndex, null, 2))];
                            case 17:
                                _g.sent();
                                _g.label = 18;
                            case 18: return [3 /*break*/, 20];
                            case 19:
                                err_1 = _g.sent();
                                console.warn("[knowledge/init] Failed to generate semantic tags:", err_1 instanceof Error ? err_1.message : err_1);
                                return [3 /*break*/, 20];
                            case 20: return [2 /*return*/];
                        }
                    });
                }); })();
                return [2 /*return*/, c.json({ success: true, practiceArea: manifest_1.practiceArea })];
            case 15:
                error_2 = _f.sent();
                console.error("Knowledge init error:", error_2);
                return [2 /*return*/, c.json({
                        error: error_2 instanceof Error ? error_2.message : String(error_2),
                    }, 500)];
            case 16: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// MANIFEST & SECTION ENDPOINTS
// ============================================================================
// Load manifest
app.get("/manifest", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, manifestPath, manifest, _a, _b, error_3;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _c.label = 1;
            case 1:
                _c.trys.push([1, 3, , 4]);
                manifestPath = (0, path_1.join)(root, ".ai_tool", "knowledge", "manifest.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 2:
                manifest = _b.apply(_a, [_c.sent()]);
                return [2 /*return*/, c.json(manifest)];
            case 3:
                error_3 = _c.sent();
                if (error_3.code === "ENOENT") {
                    return [2 /*return*/, c.json({ error: "No knowledge base found" }, 404)];
                }
                return [2 /*return*/, c.json({ error: "Failed to load manifest" }, 500)];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Load section content
app.get("/section/:id", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, sectionId, manifestPath, manifest, _a, _b, section, content, error_4;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                sectionId = c.req.param("id");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _c.label = 1;
            case 1:
                _c.trys.push([1, 4, , 5]);
                manifestPath = (0, path_1.join)(root, ".ai_tool", "knowledge", "manifest.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 2:
                manifest = _b.apply(_a, [_c.sent()]);
                section = manifest.sections.find(function (s) { return s.id === sectionId; });
                if (!section) {
                    return [2 /*return*/, c.json({ error: "Section not found" }, 404)];
                }
                return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(root, ".ai_tool", "knowledge", section.filename), "utf-8")];
            case 3:
                content = _c.sent();
                return [2 /*return*/, c.json(__assign(__assign({}, section), { content: content }))];
            case 4:
                error_4 = _c.sent();
                return [2 /*return*/, c.json({ error: "Failed to load section" }, 500)];
            case 5: return [2 /*return*/];
        }
    });
}); });
// Save section content
app.put("/section/:id", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var sectionId, _a, root, content, knowledgeDir, manifestPath, manifest, _b, _c, section_1, filePath, existing, backupDir, _d, error_5;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                sectionId = c.req.param("id");
                return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _e.sent(), root = _a.root, content = _a.content;
                if (!root || content === undefined) {
                    return [2 /*return*/, c.json({ error: "root and content required" }, 400)];
                }
                _e.label = 2;
            case 2:
                _e.trys.push([2, 11, , 12]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _c = (_b = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest = _c.apply(_b, [_e.sent()]);
                section_1 = manifest.sections.find(function (s) { return s.id === sectionId; });
                if (!section_1) {
                    return [2 /*return*/, c.json({ error: "Section not found" }, 404)];
                }
                filePath = (0, path_1.join)(knowledgeDir, section_1.filename);
                _e.label = 4;
            case 4:
                _e.trys.push([4, 8, , 9]);
                return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
            case 5:
                existing = _e.sent();
                backupDir = (0, path_1.join)(knowledgeDir, ".backups");
                return [4 /*yield*/, (0, promises_1.mkdir)(backupDir, { recursive: true })];
            case 6:
                _e.sent();
                return [4 /*yield*/, (0, promises_1.writeFile)((0, path_1.join)(backupDir, "".concat(section_1.filename, ".").concat(Date.now(), ".bak")), existing)];
            case 7:
                _e.sent();
                return [3 /*break*/, 9];
            case 8:
                _d = _e.sent();
                return [3 /*break*/, 9];
            case 9: return [4 /*yield*/, (0, promises_1.writeFile)(filePath, content)];
            case 10:
                _e.sent();
                // Clear knowledge cache
                clearKnowledgeCache(root);
                // Generate semantic tags for the updated section (non-blocking)
                (0, knowledge_tagger_1.generateSectionTags)(section_1.title, content)
                    .then(function (tags) { return (0, direct_chat_1.updateMetaIndexSectionTags)(root, section_1.filename, tags); })
                    .catch(function (err) { return console.warn("[knowledge] Failed to tag section:", err instanceof Error ? err.message : err); });
                return [2 /*return*/, c.json({ success: true })];
            case 11:
                error_5 = _e.sent();
                return [2 /*return*/, c.json({ error: "Failed to save section" }, 500)];
            case 12: return [2 /*return*/];
        }
    });
}); });
// Create new section
app.post("/section", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, id, title, content, knowledgeDir, manifestPath, manifest, _b, _c, order, filename_1, sectionContent, error_6;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _d.sent(), root = _a.root, id = _a.id, title = _a.title, content = _a.content;
                if (!root || !id || !title) {
                    return [2 /*return*/, c.json({ error: "root, id, and title required" }, 400)];
                }
                _d.label = 2;
            case 2:
                _d.trys.push([2, 6, , 7]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _c = (_b = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest = _c.apply(_b, [_d.sent()]);
                // Check for duplicate id
                if (manifest.sections.find(function (s) { return s.id === id; })) {
                    return [2 /*return*/, c.json({ error: "Section with this ID already exists" }, 409)];
                }
                order = manifest.sections.length + 1;
                filename_1 = "".concat(String(order).padStart(2, "0"), "-").concat(id, ".md");
                manifest.sections.push({ id: id, title: title, filename: filename_1, order: order });
                return [4 /*yield*/, (0, promises_1.writeFile)(manifestPath, JSON.stringify(manifest, null, 2))];
            case 4:
                _d.sent();
                sectionContent = content || "## ".concat(title, "\n\n");
                return [4 /*yield*/, (0, promises_1.writeFile)((0, path_1.join)(knowledgeDir, filename_1), sectionContent)];
            case 5:
                _d.sent();
                clearKnowledgeCache(root);
                // Generate semantic tags for the new section (non-blocking)
                (0, knowledge_tagger_1.generateSectionTags)(title, sectionContent)
                    .then(function (tags) { return (0, direct_chat_1.updateMetaIndexSectionTags)(root, filename_1, tags); })
                    .catch(function (err) { return console.warn("[knowledge] Failed to tag new section:", err instanceof Error ? err.message : err); });
                return [2 /*return*/, c.json({ success: true, filename: filename_1 })];
            case 6:
                error_6 = _d.sent();
                return [2 /*return*/, c.json({ error: "Failed to create section" }, 500)];
            case 7: return [2 /*return*/];
        }
    });
}); });
// Delete section
app.delete("/section/:id", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var sectionId, root, knowledgeDir, manifestPath, manifest, _a, _b, sectionIdx, section, _c, error_7;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                sectionId = c.req.param("id");
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _d.label = 1;
            case 1:
                _d.trys.push([1, 8, , 9]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 2:
                manifest = _b.apply(_a, [_d.sent()]);
                sectionIdx = manifest.sections.findIndex(function (s) { return s.id === sectionId; });
                if (sectionIdx === -1) {
                    return [2 /*return*/, c.json({ error: "Section not found" }, 404)];
                }
                section = manifest.sections[sectionIdx];
                _d.label = 3;
            case 3:
                _d.trys.push([3, 5, , 6]);
                return [4 /*yield*/, (0, promises_1.unlink)((0, path_1.join)(knowledgeDir, section.filename))];
            case 4:
                _d.sent();
                return [3 /*break*/, 6];
            case 5:
                _c = _d.sent();
                return [3 /*break*/, 6];
            case 6:
                // Remove from manifest
                manifest.sections.splice(sectionIdx, 1);
                // Reorder
                manifest.sections.forEach(function (s, i) { s.order = i + 1; });
                return [4 /*yield*/, (0, promises_1.writeFile)(manifestPath, JSON.stringify(manifest, null, 2))];
            case 7:
                _d.sent();
                clearKnowledgeCache(root);
                return [2 /*return*/, c.json({ success: true })];
            case 8:
                error_7 = _d.sent();
                return [2 /*return*/, c.json({ error: "Failed to delete section" }, 500)];
            case 9: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// KNOWLEDGE CHAT
// ============================================================================
app.post("/chat", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, message, knowledgeContext, knowledgeDir, manifestPath, manifest, _b, _c, sections, _i, _d, section, content, _e, _f, systemPrompt;
    return __generator(this, function (_g) {
        switch (_g.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _g.sent(), root = _a.root, message = _a.message;
                if (!root || !message) {
                    return [2 /*return*/, c.json({ error: "root and message required" }, 400)];
                }
                knowledgeContext = "";
                _g.label = 2;
            case 2:
                _g.trys.push([2, 10, , 11]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _c = (_b = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest = _c.apply(_b, [_g.sent()]);
                sections = [];
                _i = 0, _d = manifest.sections;
                _g.label = 4;
            case 4:
                if (!(_i < _d.length)) return [3 /*break*/, 9];
                section = _d[_i];
                _g.label = 5;
            case 5:
                _g.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, section.filename), "utf-8")];
            case 6:
                content = _g.sent();
                sections.push("### Section: ".concat(section.title, " (id: ").concat(section.id, ")\n\n").concat(content));
                return [3 /*break*/, 8];
            case 7:
                _e = _g.sent();
                return [3 /*break*/, 8];
            case 8:
                _i++;
                return [3 /*break*/, 4];
            case 9:
                knowledgeContext = sections.join("\n\n---\n\n");
                return [3 /*break*/, 11];
            case 10:
                _f = _g.sent();
                return [2 /*return*/, c.json({ error: "No knowledge base found" }, 404)];
            case 11:
                systemPrompt = "You are a practice knowledge assistant for a law firm. You have access to the firm's practice knowledge base.\n\nYour role:\n1. Answer questions about the practice knowledge\n2. Suggest edits to sections when asked\n3. Help refine and improve the knowledge base\n\nWhen suggesting edits, output them in this exact format:\n[[EDIT_SUGGESTION: {\"section_id\":\"<section-id>\",\"old_text\":\"<exact text to replace>\",\"new_text\":\"<replacement text>\"}]]\n\nRules for edit suggestions:\n- old_text must be an EXACT substring of the current section content\n- Keep suggestions focused and specific\n- You may suggest multiple edits in one response\n- Explain your reasoning before or after each suggestion\n\nPRACTICE KNOWLEDGE BASE:\n\n".concat(knowledgeContext);
                return [2 /*return*/, (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(void 0, void 0, void 0, function () {
                        var _a, _b, _c, msg, _i, _d, block, e_1_1, error_8;
                        var _e, e_1, _f, _g;
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0:
                                    _h.trys.push([0, 18, , 20]);
                                    _h.label = 1;
                                case 1:
                                    _h.trys.push([1, 11, 12, 17]);
                                    _a = true, _b = __asyncValues((0, claude_agent_sdk_1.query)({
                                        prompt: message,
                                        options: __assign({ systemPrompt: systemPrompt, model: "sonnet", allowedTools: [], permissionMode: "acceptEdits", maxTurns: 3 }, (0, sdk_cli_options_1.getSDKCliOptions)()),
                                    }));
                                    _h.label = 2;
                                case 2: return [4 /*yield*/, _b.next()];
                                case 3:
                                    if (!(_c = _h.sent(), _e = _c.done, !_e)) return [3 /*break*/, 10];
                                    _g = _c.value;
                                    _a = false;
                                    msg = _g;
                                    if (!(msg.type === "assistant")) return [3 /*break*/, 7];
                                    _i = 0, _d = msg.message.content;
                                    _h.label = 4;
                                case 4:
                                    if (!(_i < _d.length)) return [3 /*break*/, 7];
                                    block = _d[_i];
                                    if (!(block.type === "text")) return [3 /*break*/, 6];
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({ type: "text", content: block.text }),
                                        })];
                                case 5:
                                    _h.sent();
                                    _h.label = 6;
                                case 6:
                                    _i++;
                                    return [3 /*break*/, 4];
                                case 7:
                                    if (!(msg.type === "result")) return [3 /*break*/, 9];
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "done",
                                                success: msg.subtype === "success",
                                            }),
                                        })];
                                case 8:
                                    _h.sent();
                                    _h.label = 9;
                                case 9:
                                    _a = true;
                                    return [3 /*break*/, 2];
                                case 10: return [3 /*break*/, 17];
                                case 11:
                                    e_1_1 = _h.sent();
                                    e_1 = { error: e_1_1 };
                                    return [3 /*break*/, 17];
                                case 12:
                                    _h.trys.push([12, , 15, 16]);
                                    if (!(!_a && !_e && (_f = _b.return))) return [3 /*break*/, 14];
                                    return [4 /*yield*/, _f.call(_b)];
                                case 13:
                                    _h.sent();
                                    _h.label = 14;
                                case 14: return [3 /*break*/, 16];
                                case 15:
                                    if (e_1) throw e_1.error;
                                    return [7 /*endfinally*/];
                                case 16: return [7 /*endfinally*/];
                                case 17: return [3 /*break*/, 20];
                                case 18:
                                    error_8 = _h.sent();
                                    console.error("Knowledge chat error:", error_8);
                                    return [4 /*yield*/, stream.writeSSE({
                                            data: JSON.stringify({
                                                type: "error",
                                                error: error_8 instanceof Error ? error_8.message : String(error_8),
                                            }),
                                        })];
                                case 19:
                                    _h.sent();
                                    return [3 /*break*/, 20];
                                case 20: return [2 /*return*/];
                            }
                        });
                    }); })];
        }
    });
}); });
// Apply an edit suggestion
app.post("/apply-edit", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, section_id, old_text, new_text, knowledgeDir, manifestPath, manifest, _b, _c, section, filePath, content, backupDir, updated, error_9;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _d.sent(), root = _a.root, section_id = _a.section_id, old_text = _a.old_text, new_text = _a.new_text;
                if (!root || !section_id || !old_text || new_text === undefined) {
                    return [2 /*return*/, c.json({ error: "root, section_id, old_text, and new_text required" }, 400)];
                }
                _d.label = 2;
            case 2:
                _d.trys.push([2, 8, , 9]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _c = (_b = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest = _c.apply(_b, [_d.sent()]);
                section = manifest.sections.find(function (s) { return s.id === section_id; });
                if (!section) {
                    return [2 /*return*/, c.json({ error: "Section not found" }, 404)];
                }
                filePath = (0, path_1.join)(knowledgeDir, section.filename);
                return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
            case 4:
                content = _d.sent();
                if (!content.includes(old_text)) {
                    return [2 /*return*/, c.json({ error: "old_text not found in section" }, 400)];
                }
                backupDir = (0, path_1.join)(knowledgeDir, ".backups");
                return [4 /*yield*/, (0, promises_1.mkdir)(backupDir, { recursive: true })];
            case 5:
                _d.sent();
                return [4 /*yield*/, (0, promises_1.writeFile)((0, path_1.join)(backupDir, "".concat(section.filename, ".").concat(Date.now(), ".bak")), content)];
            case 6:
                _d.sent();
                updated = content.replace(old_text, new_text);
                return [4 /*yield*/, (0, promises_1.writeFile)(filePath, updated)];
            case 7:
                _d.sent();
                clearKnowledgeCache(root);
                return [2 /*return*/, c.json({ success: true })];
            case 8:
                error_9 = _d.sent();
                return [2 /*return*/, c.json({ error: "Failed to apply edit" }, 500)];
            case 9: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// FIRM LOGO
// ============================================================================
// Upload firm logo
app.post("/firm-logo/upload", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, formData, file, ext, piToolDir, _i, _a, oldExt, _b, logoPath, buffer, _c, _d, error_10;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _e.label = 1;
            case 1:
                _e.trys.push([1, 12, , 13]);
                return [4 /*yield*/, c.req.formData()];
            case 2:
                formData = _e.sent();
                file = formData.get("file");
                if (!file) {
                    return [2 /*return*/, c.json({ error: "No file provided" }, 400)];
                }
                ext = (0, path_1.extname)(file.name).toLowerCase();
                if (![".png", ".jpg", ".jpeg"].includes(ext)) {
                    return [2 /*return*/, c.json({ error: "Only PNG and JPG images are supported" }, 400)];
                }
                piToolDir = (0, path_1.join)(root, ".ai_tool");
                return [4 /*yield*/, (0, promises_1.mkdir)(piToolDir, { recursive: true })];
            case 3:
                _e.sent();
                _i = 0, _a = [".png", ".jpg", ".jpeg"];
                _e.label = 4;
            case 4:
                if (!(_i < _a.length)) return [3 /*break*/, 9];
                oldExt = _a[_i];
                _e.label = 5;
            case 5:
                _e.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, promises_1.unlink)((0, path_1.join)(piToolDir, "firm-logo".concat(oldExt)))];
            case 6:
                _e.sent();
                return [3 /*break*/, 8];
            case 7:
                _b = _e.sent();
                return [3 /*break*/, 8];
            case 8:
                _i++;
                return [3 /*break*/, 4];
            case 9:
                logoPath = (0, path_1.join)(piToolDir, "firm-logo".concat(ext));
                _d = (_c = Buffer).from;
                return [4 /*yield*/, file.arrayBuffer()];
            case 10:
                buffer = _d.apply(_c, [_e.sent()]);
                return [4 /*yield*/, (0, promises_1.writeFile)(logoPath, buffer)];
            case 11:
                _e.sent();
                return [2 /*return*/, c.json({ success: true, filename: "firm-logo".concat(ext) })];
            case 12:
                error_10 = _e.sent();
                console.error("Logo upload error:", error_10);
                return [2 /*return*/, c.json({
                        error: error_10 instanceof Error ? error_10.message : String(error_10),
                    }, 500)];
            case 13: return [2 /*return*/];
        }
    });
}); });
// Get firm logo
app.get("/firm-logo", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, piToolDir, _i, _a, ext, logoPath, logoStat, logoData, mimeType, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                piToolDir = (0, path_1.join)(root, ".ai_tool");
                _i = 0, _a = [".png", ".jpg", ".jpeg"];
                _c.label = 1;
            case 1:
                if (!(_i < _a.length)) return [3 /*break*/, 8];
                ext = _a[_i];
                logoPath = (0, path_1.join)(piToolDir, "firm-logo".concat(ext));
                _c.label = 2;
            case 2:
                _c.trys.push([2, 6, , 7]);
                return [4 /*yield*/, (0, promises_1.stat)(logoPath)];
            case 3:
                logoStat = _c.sent();
                if (!logoStat.isFile()) return [3 /*break*/, 5];
                return [4 /*yield*/, (0, promises_1.readFile)(logoPath)];
            case 4:
                logoData = _c.sent();
                mimeType = ext === ".png" ? "image/png" : "image/jpeg";
                return [2 /*return*/, new Response(logoData, {
                        headers: {
                            "Content-Type": mimeType,
                            "Cache-Control": "max-age=3600",
                        },
                    })];
            case 5: return [3 /*break*/, 7];
            case 6:
                _b = _c.sent();
                return [3 /*break*/, 7];
            case 7:
                _i++;
                return [3 /*break*/, 1];
            case 8: return [2 /*return*/, c.json({ error: "No logo found" }, 404)];
        }
    });
}); });
// Delete firm logo
app.delete("/firm-logo", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, piToolDir, deleted, _i, _a, ext, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                piToolDir = (0, path_1.join)(root, ".ai_tool");
                deleted = false;
                _i = 0, _a = [".png", ".jpg", ".jpeg"];
                _c.label = 1;
            case 1:
                if (!(_i < _a.length)) return [3 /*break*/, 6];
                ext = _a[_i];
                _c.label = 2;
            case 2:
                _c.trys.push([2, 4, , 5]);
                return [4 /*yield*/, (0, promises_1.unlink)((0, path_1.join)(piToolDir, "firm-logo".concat(ext)))];
            case 3:
                _c.sent();
                deleted = true;
                return [3 /*break*/, 5];
            case 4:
                _b = _c.sent();
                return [3 /*break*/, 5];
            case 5:
                _i++;
                return [3 /*break*/, 1];
            case 6:
                if (deleted) {
                    return [2 /*return*/, c.json({ success: true })];
                }
                return [2 /*return*/, c.json({ error: "No logo found" }, 404)];
        }
    });
}); });
// ============================================================================
// FIRM CONFIG
// ============================================================================
app.get("/firm-config", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, configPath, config, _a, _b, error_11;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _c.label = 1;
            case 1:
                _c.trys.push([1, 3, , 4]);
                configPath = (0, path_1.join)(root, ".ai_tool", "firm-config.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(configPath, "utf-8")];
            case 2:
                config = _b.apply(_a, [_c.sent()]);
                // Synthesize attorneys[] from legacy attorneyName/nevadaBarNo if missing
                if (!Array.isArray(config.attorneys) && config.attorneyName) {
                    config.attorneys = [{ name: config.attorneyName, barNo: config.nevadaBarNo || "" }];
                }
                return [2 /*return*/, c.json(config)];
            case 3:
                error_11 = _c.sent();
                if (error_11.code === "ENOENT") {
                    return [2 /*return*/, c.json({
                            firmName: "",
                            attorneyName: "",
                            nevadaBarNo: "",
                            address: "",
                            cityStateZip: "",
                            phone: "",
                            practiceArea: "",
                            jurisdiction: "",
                            feeStructure: "",
                            attorneys: [],
                        })];
                }
                return [2 /*return*/, c.json({ error: "Failed to load firm config" }, 500)];
            case 4: return [2 /*return*/];
        }
    });
}); });
app.put("/firm-config", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, root, config, primary, piToolDir, configPath, error_12;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _b.sent(), root = _a.root, config = __rest(_a, ["root"]);
                if (!root)
                    return [2 /*return*/, c.json({ error: "root required" }, 400)];
                // Sync attorneys[0] back to legacy attorneyName/nevadaBarNo for backward compat
                if (Array.isArray(config.attorneys) && config.attorneys.length > 0) {
                    primary = config.attorneys[0];
                    if (primary === null || primary === void 0 ? void 0 : primary.name)
                        config.attorneyName = primary.name;
                    if ((primary === null || primary === void 0 ? void 0 : primary.barNo) !== undefined)
                        config.nevadaBarNo = primary.barNo;
                }
                _b.label = 2;
            case 2:
                _b.trys.push([2, 5, , 6]);
                piToolDir = (0, path_1.join)(root, ".ai_tool");
                return [4 /*yield*/, (0, promises_1.mkdir)(piToolDir, { recursive: true })];
            case 3:
                _b.sent();
                configPath = (0, path_1.join)(piToolDir, "firm-config.json");
                return [4 /*yield*/, (0, promises_1.writeFile)(configPath, JSON.stringify(config, null, 2))];
            case 4:
                _b.sent();
                return [2 /*return*/, c.json({ success: true })];
            case 5:
                error_12 = _b.sent();
                return [2 /*return*/, c.json({ error: "Failed to save firm config" }, 500)];
            case 6: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// KNOWLEDGE CACHE (used by firm.ts)
// ============================================================================
var knowledgeCache = new Map();
function loadPracticeGuide(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var cacheKey, knowledgeDir, manifestPath, manifest, _a, _b, sections, _i, _c, section, content, _d, combined, _e, defaultKey, guidePath, guide;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (!firmRoot) return [3 /*break*/, 10];
                    cacheKey = firmRoot;
                    if (knowledgeCache.has(cacheKey))
                        return [2 /*return*/, knowledgeCache.get(cacheKey)];
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 9, , 10]);
                    knowledgeDir = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge");
                    manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                    _b = (_a = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
                case 2:
                    manifest = _b.apply(_a, [_f.sent()]);
                    sections = [];
                    _i = 0, _c = manifest.sections;
                    _f.label = 3;
                case 3:
                    if (!(_i < _c.length)) return [3 /*break*/, 8];
                    section = _c[_i];
                    _f.label = 4;
                case 4:
                    _f.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, section.filename), "utf-8")];
                case 5:
                    content = _f.sent();
                    sections.push(content);
                    return [3 /*break*/, 7];
                case 6:
                    _d = _f.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _i++;
                    return [3 /*break*/, 3];
                case 8:
                    if (sections.length > 0) {
                        combined = sections.join("\n\n---\n\n");
                        knowledgeCache.set(cacheKey, combined);
                        return [2 /*return*/, combined];
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _e = _f.sent();
                    return [3 /*break*/, 10];
                case 10:
                    defaultKey = "__default__";
                    if (knowledgeCache.has(defaultKey))
                        return [2 /*return*/, knowledgeCache.get(defaultKey)];
                    guidePath = (0, path_1.join)(import.meta.dir, "../../agent/practice-guide.md");
                    return [4 /*yield*/, (0, promises_1.readFile)(guidePath, "utf-8")];
                case 11:
                    guide = _f.sent();
                    knowledgeCache.set(defaultKey, guide);
                    return [2 /*return*/, guide];
            }
        });
    });
}
function clearKnowledgeCache(firmRoot) {
    if (firmRoot) {
        knowledgeCache.delete(firmRoot);
    }
    else {
        knowledgeCache.clear();
    }
}
/**
 * Load specific knowledge sections by ID from the firm's knowledge base.
 * Falls back to loading the full practice-guide.md if no manifest exists.
 * If sectionIds is empty/undefined, loads ALL sections.
 */
function loadSectionsByIds(firmRoot, sectionIds) {
    return __awaiter(this, void 0, void 0, function () {
        var knowledgeDir, manifestPath, manifest, _a, _b, targetSections, parts, _i, targetSections_1, section, content, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (!firmRoot) {
                        return [2 /*return*/, loadPracticeGuide()];
                    }
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 9, , 10]);
                    knowledgeDir = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge");
                    manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                    _b = (_a = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
                case 2:
                    manifest = _b.apply(_a, [_e.sent()]);
                    targetSections = sectionIds && sectionIds.length > 0
                        ? manifest.sections.filter(function (s) { return sectionIds.includes(s.id); })
                        : manifest.sections;
                    parts = [];
                    _i = 0, targetSections_1 = targetSections;
                    _e.label = 3;
                case 3:
                    if (!(_i < targetSections_1.length)) return [3 /*break*/, 8];
                    section = targetSections_1[_i];
                    _e.label = 4;
                case 4:
                    _e.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, section.filename), "utf-8")];
                case 5:
                    content = _e.sent();
                    parts.push(content);
                    return [3 /*break*/, 7];
                case 6:
                    _c = _e.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _i++;
                    return [3 /*break*/, 3];
                case 8:
                    if (parts.length > 0) {
                        return [2 /*return*/, parts.join("\n\n---\n\n")];
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _d = _e.sent();
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/, loadPracticeGuide(firmRoot)];
            }
        });
    });
}
var DOCUMENT_INDEX_HEADING_RE = /\bDOCUMENT\s+INDEX\b/i;
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function replaceTextInsensitive(source, target, replacement) {
    if (!target)
        return source;
    return source.replace(new RegExp(escapeRegExp(target), "gi"), replacement);
}
function sanitizePacketHtml(html) {
    var normalized = html
        .replace(/^[\s\S]*?<body[^>]*>/i, "")
        .replace(/<\/body>\s*<\/html>\s*$/i, "")
        .replace(/<\/body>/i, "")
        .trim();
    return normalized || html.trim();
}
function applyPacketTemplatePlaceholders(html, analysis) {
    var result = sanitizePacketHtml(html);
    result = replaceTextInsensitive(result, analysis.sampleClaimantName || "", "{{claimantName}}");
    for (var _i = 0, _a = Object.entries(analysis.sampleCaptionValues || {}); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        if (!value)
            continue;
        result = replaceTextInsensitive(result, value, "{{".concat(key, "}}"));
    }
    if (analysis.sampleFirmName) {
        result = replaceTextInsensitive(result, analysis.sampleFirmName, "counsel");
    }
    for (var _c = 0, _d = analysis.sampleAttorneyNames; _c < _d.length; _c++) {
        var attorney = _d[_c];
        if (!attorney)
            continue;
        result = replaceTextInsensitive(result, attorney, "counsel");
    }
    // If the template text already includes a document index heading, avoid
    // forcing a duplicate section by inserting a marker for the HTML renderer.
    if (!DOCUMENT_INDEX_HEADING_RE.test(result)) {
        result = "".concat(result, "\n\n{{documentIndex}}");
    }
    return result.trim();
}
function applyPacketHtmlTemplate(packetTemplate, html, analysis) {
    if (!html || !analysis)
        return packetTemplate;
    var templateHtml = applyPacketTemplatePlaceholders(html.html, analysis);
    var templateCss = html.css;
    if (templateHtml) {
        packetTemplate.htmlTemplate = templateHtml;
    }
    if (templateCss) {
        packetTemplate.htmlTemplateCss = templateCss;
    }
    return packetTemplate;
}
// List document templates and detect new source files
app.get("/doc-templates", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templatesDir, sourceDir, parsedDir, indexPath, index, indexContent, _a, sourceFiles, validExtensions_1, templateFiles, templates, _loop_1, _i, templateFiles_1, filename, error_13;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                sourceDir = (0, path_1.join)(templatesDir, "source");
                parsedDir = (0, path_1.join)(templatesDir, "parsed");
                indexPath = (0, path_1.join)(templatesDir, "templates.json");
                _b.label = 1;
            case 1:
                _b.trys.push([1, 13, , 14]);
                // Ensure directories exist
                return [4 /*yield*/, (0, promises_1.mkdir)(sourceDir, { recursive: true })];
            case 2:
                // Ensure directories exist
                _b.sent();
                return [4 /*yield*/, (0, promises_1.mkdir)(parsedDir, { recursive: true })];
            case 3:
                _b.sent();
                index = { templates: [] };
                _b.label = 4;
            case 4:
                _b.trys.push([4, 6, , 7]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 5:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                return [3 /*break*/, 7];
            case 6:
                _a = _b.sent();
                return [3 /*break*/, 7];
            case 7: return [4 /*yield*/, (0, promises_1.readdir)(sourceDir)];
            case 8:
                sourceFiles = _b.sent();
                validExtensions_1 = [".pdf", ".docx"];
                templateFiles = sourceFiles.filter(function (f) {
                    return validExtensions_1.includes((0, path_1.extname)(f).toLowerCase());
                });
                templates = [];
                _loop_1 = function (filename) {
                    var sourceFilePath, sourceStat, id, existing, sourceModified, isOutdated;
                    return __generator(this, function (_c) {
                        switch (_c.label) {
                            case 0:
                                sourceFilePath = (0, path_1.join)(sourceDir, filename);
                                return [4 /*yield*/, (0, promises_1.stat)(sourceFilePath)];
                            case 1:
                                sourceStat = _c.sent();
                                id = (0, path_1.basename)(filename, (0, path_1.extname)(filename));
                                existing = index.templates.find(function (t) { return t.id === id; });
                                if (existing) {
                                    sourceModified = sourceStat.mtime.toISOString();
                                    isOutdated = existing.parsedAt
                                        ? new Date(sourceModified) > new Date(existing.parsedAt)
                                        : true;
                                    templates.push(__assign(__assign({}, existing), { sourceModified: sourceModified, status: existing.parsedFile
                                            ? isOutdated
                                                ? "outdated"
                                                : "parsed"
                                            : "needs_parsing" }));
                                }
                                else {
                                    // New file not in index
                                    templates.push({
                                        id: id,
                                        sourceFile: "source/".concat(filename),
                                        parsedFile: null,
                                        name: formatTemplateName(id),
                                        description: "",
                                        parsedAt: null,
                                        sourceModified: sourceStat.mtime.toISOString(),
                                        status: "needs_parsing",
                                    });
                                }
                                return [2 /*return*/];
                        }
                    });
                };
                _i = 0, templateFiles_1 = templateFiles;
                _b.label = 9;
            case 9:
                if (!(_i < templateFiles_1.length)) return [3 /*break*/, 12];
                filename = templateFiles_1[_i];
                return [5 /*yield**/, _loop_1(filename)];
            case 10:
                _b.sent();
                _b.label = 11;
            case 11:
                _i++;
                return [3 /*break*/, 9];
            case 12: return [2 /*return*/, c.json({ templates: templates })];
            case 13:
                error_13 = _b.sent();
                console.error("List templates error:", error_13);
                return [2 /*return*/, c.json({ error: "Failed to list templates" }, 500)];
            case 14: return [2 /*return*/];
        }
    });
}); });
// Upload a new template file
app.post("/doc-templates/upload", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templatesDir, sourceDir, formData, file, ext, filename, filePath, arrayBuffer, id, error_14;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                sourceDir = (0, path_1.join)(templatesDir, "source");
                _a.label = 1;
            case 1:
                _a.trys.push([1, 6, , 7]);
                // Ensure directory exists
                return [4 /*yield*/, (0, promises_1.mkdir)(sourceDir, { recursive: true })];
            case 2:
                // Ensure directory exists
                _a.sent();
                return [4 /*yield*/, c.req.formData()];
            case 3:
                formData = _a.sent();
                file = formData.get("file");
                if (!file) {
                    return [2 /*return*/, c.json({ error: "No file provided" }, 400)];
                }
                ext = (0, path_1.extname)(file.name).toLowerCase();
                if (![".pdf", ".docx"].includes(ext)) {
                    return [2 /*return*/, c.json({ error: "Only PDF and DOCX files are supported" }, 400)];
                }
                filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                filePath = (0, path_1.join)(sourceDir, filename);
                return [4 /*yield*/, file.arrayBuffer()];
            case 4:
                arrayBuffer = _a.sent();
                return [4 /*yield*/, (0, promises_1.writeFile)(filePath, Buffer.from(arrayBuffer))];
            case 5:
                _a.sent();
                id = (0, path_1.basename)(filename, ext);
                return [2 /*return*/, c.json({
                        success: true,
                        id: id,
                        filename: filename,
                        message: "Template uploaded successfully",
                    })];
            case 6:
                error_14 = _a.sent();
                console.error("Upload template error:", error_14);
                return [2 /*return*/, c.json({
                        error: error_14 instanceof Error ? error_14.message : String(error_14),
                    }, 500)];
            case 7: return [2 /*return*/];
        }
    });
}); });
// Parse a template source file into markdown
app.post("/doc-templates/:id/parse", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templateId, templatesDir, sourceDir, parsedDir, indexPath, sourceFiles, sourceFile, sourceFilePath, sourceStat, ext, extractedText, extractedStyles, extractedHtml, templatePdfWithAI, templateName_1, bboxMap, coordsPath, templErr_1, styleErr_1, htmlErr_1, templateDocxWithAI, templateName_2, templatedDocxBytes, templErr_2, templateName, analysis, detectedAsPacket, packetConfig, packetAnalysis, err_2, parsedFilename, parsedFilePath, stylesData, stylesPath, index, indexContent, _a, existingIdx, existing, isUserDescription, description, entry, error_15;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                templateId = c.req.param("id");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                sourceDir = (0, path_1.join)(templatesDir, "source");
                parsedDir = (0, path_1.join)(templatesDir, "parsed");
                indexPath = (0, path_1.join)(templatesDir, "templates.json");
                _b.label = 1;
            case 1:
                _b.trys.push([1, 40, , 41]);
                return [4 /*yield*/, (0, promises_1.readdir)(sourceDir)];
            case 2:
                sourceFiles = _b.sent();
                sourceFile = sourceFiles.find(function (f) { return (0, path_1.basename)(f, (0, path_1.extname)(f)) === templateId; });
                if (!sourceFile) {
                    return [2 /*return*/, c.json({ error: "Source file not found" }, 404)];
                }
                sourceFilePath = (0, path_1.join)(sourceDir, sourceFile);
                return [4 /*yield*/, (0, promises_1.stat)(sourceFilePath)];
            case 3:
                sourceStat = _b.sent();
                ext = (0, path_1.extname)(sourceFile).toLowerCase();
                extractedText = void 0;
                extractedStyles = null;
                extractedHtml = null;
                if (!(ext === ".pdf")) return [3 /*break*/, 11];
                return [4 /*yield*/, (0, extract_1.extractTextFromPdf)(sourceFilePath)];
            case 4:
                extractedText = _b.sent();
                _b.label = 5;
            case 5:
                _b.trys.push([5, 9, , 10]);
                return [4 /*yield*/, Promise.resolve().then(function () { return require("../lib/extract"); })];
            case 6:
                templatePdfWithAI = (_b.sent()).templatePdfWithAI;
                templateName_1 = formatTemplateName(templateId);
                return [4 /*yield*/, templatePdfWithAI(sourceFilePath, templateName_1)];
            case 7:
                bboxMap = _b.sent();
                coordsPath = (0, path_1.join)(parsedDir, "".concat(templateId, "-coords.json"));
                return [4 /*yield*/, (0, promises_1.writeFile)(coordsPath, JSON.stringify(bboxMap, null, 2))];
            case 8:
                _b.sent();
                console.log("[Parse] Successfully parsed PDF BBoxes for: ".concat(sourceFile));
                return [3 /*break*/, 10];
            case 9:
                templErr_1 = _b.sent();
                console.warn("[Parse] PDF BBox artificial mapping failed (non-fatal):", templErr_1 instanceof Error ? templErr_1.message : templErr_1);
                return [3 /*break*/, 10];
            case 10: return [3 /*break*/, 26];
            case 11:
                if (!(ext === ".docx")) return [3 /*break*/, 25];
                return [4 /*yield*/, (0, extract_1.extractTextFromDocx)(sourceFilePath)];
            case 12:
                extractedText = _b.sent();
                _b.label = 13;
            case 13:
                _b.trys.push([13, 15, , 16]);
                return [4 /*yield*/, (0, extract_1.extractStylesFromDocx)(sourceFilePath)];
            case 14:
                extractedStyles = _b.sent();
                return [3 /*break*/, 16];
            case 15:
                styleErr_1 = _b.sent();
                console.error("Style extraction failed (non-fatal):", styleErr_1);
                return [3 /*break*/, 16];
            case 16:
                _b.trys.push([16, 18, , 19]);
                return [4 /*yield*/, (0, extract_1.extractHtmlFromDocx)(sourceFilePath)];
            case 17:
                extractedHtml = _b.sent();
                return [3 /*break*/, 19];
            case 18:
                htmlErr_1 = _b.sent();
                console.error("DOCX HTML extraction failed (non-fatal):", htmlErr_1);
                return [3 /*break*/, 19];
            case 19:
                _b.trys.push([19, 23, , 24]);
                return [4 /*yield*/, Promise.resolve().then(function () { return require("../lib/extract"); })];
            case 20:
                templateDocxWithAI = (_b.sent()).templateDocxWithAI;
                templateName_2 = formatTemplateName(templateId);
                return [4 /*yield*/, templateDocxWithAI(sourceFilePath, templateName_2, extractedText)];
            case 21:
                templatedDocxBytes = _b.sent();
                // Overwrite the original source file with the new docxtemplater-ready file
                return [4 /*yield*/, (0, promises_1.writeFile)(sourceFilePath, Buffer.from(templatedDocxBytes))];
            case 22:
                // Overwrite the original source file with the new docxtemplater-ready file
                _b.sent();
                console.log("[Parse] Successfully templatized DOCX: ".concat(sourceFile));
                return [3 /*break*/, 24];
            case 23:
                templErr_2 = _b.sent();
                console.warn("[Parse] DOCX artificial templating failed (non-fatal):", templErr_2 instanceof Error ? templErr_2.message : templErr_2);
                return [3 /*break*/, 24];
            case 24: return [3 /*break*/, 26];
            case 25: return [2 /*return*/, c.json({ error: "Unsupported file format" }, 400)];
            case 26:
                templateName = formatTemplateName(templateId);
                return [4 /*yield*/, analyzeTemplateWithAI(extractedText, templateName)];
            case 27:
                analysis = _b.sent();
                detectedAsPacket = isPacketTemplate(extractedText);
                packetConfig = void 0;
                packetAnalysis = void 0;
                if (!detectedAsPacket) return [3 /*break*/, 31];
                _b.label = 28;
            case 28:
                _b.trys.push([28, 30, , 31]);
                return [4 /*yield*/, analyzePacketTemplateWithAI(extractedText, templateName)];
            case 29:
                packetAnalysis = _b.sent();
                packetConfig = packetAnalysis.template;
                if (extractedHtml) {
                    packetConfig = applyPacketHtmlTemplate(packetConfig, extractedHtml, packetAnalysis);
                    packetConfig.renderMode = "template-native";
                    packetConfig.suppressPleadingLineNumbers = !detectPleadingLineNumbers(extractedText, extractedHtml.html);
                }
                // Ensure sourceFile is explicitly set so the generator knows to use Native Injection
                packetConfig.sourceFile = "source/".concat(sourceFile);
                return [3 /*break*/, 31];
            case 30:
                err_2 = _b.sent();
                console.warn("[Parse] Packet template analysis failed (non-fatal):", err_2 instanceof Error ? err_2.message : err_2);
                return [3 /*break*/, 31];
            case 31:
                parsedFilename = "".concat(templateId, ".md");
                parsedFilePath = (0, path_1.join)(parsedDir, parsedFilename);
                return [4 /*yield*/, (0, promises_1.writeFile)(parsedFilePath, analysis.markdown)];
            case 32:
                _b.sent();
                if (!extractedStyles) return [3 /*break*/, 34];
                stylesData = {
                    sourceTemplate: sourceFile,
                    templateName: templateName,
                    extractedAt: new Date().toISOString(),
                    styles: extractedStyles,
                };
                stylesPath = (0, path_1.join)(root, ".ai_tool", "template-styles.json");
                return [4 /*yield*/, (0, promises_1.writeFile)(stylesPath, JSON.stringify(stylesData, null, 2))];
            case 33:
                _b.sent();
                _b.label = 34;
            case 34:
                index = { templates: [] };
                _b.label = 35;
            case 35:
                _b.trys.push([35, 37, , 38]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 36:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                return [3 /*break*/, 38];
            case 37:
                _a = _b.sent();
                return [3 /*break*/, 38];
            case 38:
                existingIdx = index.templates.findIndex(function (t) { return t.id === templateId; });
                existing = existingIdx >= 0 ? index.templates[existingIdx] : null;
                if (packetConfig) {
                    packetConfig = normalizeParsedPacketTemplateIds(packetConfig, templateId, existing === null || existing === void 0 ? void 0 : existing.packetConfig);
                }
                isUserDescription = (existing === null || existing === void 0 ? void 0 : existing.descriptionSource) === "user";
                description = isUserDescription ? existing.description : analysis.description;
                entry = {
                    id: templateId,
                    sourceFile: "source/".concat(sourceFile),
                    parsedFile: "parsed/".concat(parsedFilename),
                    name: (existing === null || existing === void 0 ? void 0 : existing.name) || formatTemplateName(templateId),
                    description: description,
                    descriptionSource: isUserDescription ? "user" : "ai",
                    parsedAt: new Date().toISOString(),
                    sourceModified: sourceStat.mtime.toISOString(),
                    type: detectedAsPacket ? "packet" : "document",
                    packetConfig: packetConfig,
                };
                if (existingIdx >= 0) {
                    index.templates[existingIdx] = entry;
                }
                else {
                    index.templates.push(entry);
                }
                return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(index, null, 2))];
            case 39:
                _b.sent();
                return [2 /*return*/, c.json({
                        success: true,
                        template: entry,
                        previewLength: analysis.markdown.length,
                        stylesExtracted: extractedStyles !== null,
                        styles: extractedStyles,
                        generatedDescription: analysis.description,
                        detectedType: entry.type,
                    })];
            case 40:
                error_15 = _b.sent();
                console.error("Parse template error:", error_15);
                return [2 /*return*/, c.json({
                        error: error_15 instanceof Error ? error_15.message : String(error_15),
                    }, 500)];
            case 41: return [2 /*return*/];
        }
    });
}); });
// Batch parse templates with parallel Haiku calls
var TEMPLATE_CONCURRENCY = 10;
function processTemplatesWithLimit(templates, root, limit, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        function worker() {
            return __awaiter(this, void 0, void 0, function () {
                var _loop_2;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _loop_2 = function () {
                                var index, template, sourceFiles, sourceFile, sourceFilePath, sourceStat, ext, isDocxSource, extractedText, extractedStyles, extractedHtml, _b, htmlErr_2, templateName, analysis, detectedAsPacket, packetConfig, packetAnalysis, err_3, parsedFilename, parsedFilePath, stylesData, stylesPath, indexData, indexContent, _c, existingIdx, existing, isUserDescription, description, entry, err_4, error;
                                return __generator(this, function (_d) {
                                    switch (_d.label) {
                                        case 0:
                                            index = currentIndex++;
                                            template = templates[index];
                                            _d.label = 1;
                                        case 1:
                                            _d.trys.push([1, 31, , 33]);
                                            return [4 /*yield*/, onProgress({
                                                    type: "template_start",
                                                    index: index,
                                                    total: templates.length,
                                                    id: template.id,
                                                })];
                                        case 2:
                                            _d.sent();
                                            return [4 /*yield*/, (0, promises_1.readdir)(sourceDir)];
                                        case 3:
                                            sourceFiles = _d.sent();
                                            sourceFile = sourceFiles.find(function (f) { return (0, path_1.basename)(f, (0, path_1.extname)(f)) === template.id; });
                                            if (!sourceFile) {
                                                results[index] = { id: template.id, success: false, error: "Source file not found" };
                                                return [2 /*return*/, "continue"];
                                            }
                                            sourceFilePath = (0, path_1.join)(sourceDir, sourceFile);
                                            return [4 /*yield*/, (0, promises_1.stat)(sourceFilePath)];
                                        case 4:
                                            sourceStat = _d.sent();
                                            ext = (0, path_1.extname)(sourceFile).toLowerCase();
                                            isDocxSource = ext === ".docx";
                                            extractedText = void 0;
                                            extractedStyles = null;
                                            extractedHtml = null;
                                            if (!(ext === ".pdf")) return [3 /*break*/, 6];
                                            return [4 /*yield*/, (0, extract_1.extractTextFromPdf)(sourceFilePath)];
                                        case 5:
                                            extractedText = _d.sent();
                                            return [3 /*break*/, 16];
                                        case 6:
                                            if (!(ext === ".docx")) return [3 /*break*/, 15];
                                            return [4 /*yield*/, (0, extract_1.extractTextFromDocx)(sourceFilePath)];
                                        case 7:
                                            extractedText = _d.sent();
                                            _d.label = 8;
                                        case 8:
                                            _d.trys.push([8, 10, , 11]);
                                            return [4 /*yield*/, (0, extract_1.extractStylesFromDocx)(sourceFilePath)];
                                        case 9:
                                            extractedStyles = _d.sent();
                                            return [3 /*break*/, 11];
                                        case 10:
                                            _b = _d.sent();
                                            return [3 /*break*/, 11];
                                        case 11:
                                            _d.trys.push([11, 13, , 14]);
                                            return [4 /*yield*/, (0, extract_1.extractHtmlFromDocx)(sourceFilePath)];
                                        case 12:
                                            extractedHtml = _d.sent();
                                            return [3 /*break*/, 14];
                                        case 13:
                                            htmlErr_2 = _d.sent();
                                            console.warn("[Batch Parse] DOCX HTML extraction failed for ".concat(template.id, " (non-fatal):"), htmlErr_2 instanceof Error ? htmlErr_2.message : htmlErr_2);
                                            return [3 /*break*/, 14];
                                        case 14: return [3 /*break*/, 16];
                                        case 15:
                                            results[index] = { id: template.id, success: false, error: "Unsupported format" };
                                            return [2 /*return*/, "continue"];
                                        case 16:
                                            templateName = formatTemplateName(template.id);
                                            return [4 /*yield*/, analyzeTemplateWithAI(extractedText, templateName)];
                                        case 17:
                                            analysis = _d.sent();
                                            detectedAsPacket = isPacketTemplate(extractedText);
                                            packetConfig = void 0;
                                            packetAnalysis = void 0;
                                            if (!detectedAsPacket) return [3 /*break*/, 21];
                                            _d.label = 18;
                                        case 18:
                                            _d.trys.push([18, 20, , 21]);
                                            return [4 /*yield*/, analyzePacketTemplateWithAI(extractedText, templateName)];
                                        case 19:
                                            packetAnalysis = _d.sent();
                                            packetConfig = packetAnalysis.template;
                                            if (extractedHtml) {
                                                packetConfig = applyPacketHtmlTemplate(packetConfig, extractedHtml, packetAnalysis);
                                                packetConfig.renderMode = "template-native";
                                                packetConfig.suppressPleadingLineNumbers = !detectPleadingLineNumbers(extractedText, extractedHtml.html);
                                            }
                                            else if (isDocxSource) {
                                                packetConfig.renderMode = "template-native";
                                                packetConfig.suppressPleadingLineNumbers = true;
                                            }
                                            return [3 /*break*/, 21];
                                        case 20:
                                            err_3 = _d.sent();
                                            console.warn("[Batch Parse] Packet analysis failed for ".concat(template.id, " (non-fatal):"), err_3 instanceof Error ? err_3.message : err_3);
                                            return [3 /*break*/, 21];
                                        case 21:
                                            parsedFilename = "".concat(template.id, ".md");
                                            parsedFilePath = (0, path_1.join)(parsedDir, parsedFilename);
                                            return [4 /*yield*/, (0, promises_1.writeFile)(parsedFilePath, analysis.markdown)];
                                        case 22:
                                            _d.sent();
                                            if (!extractedStyles) return [3 /*break*/, 24];
                                            stylesData = {
                                                sourceTemplate: sourceFile,
                                                templateName: templateName,
                                                extractedAt: new Date().toISOString(),
                                                styles: extractedStyles,
                                            };
                                            stylesPath = (0, path_1.join)(root, ".ai_tool", "template-styles.json");
                                            return [4 /*yield*/, (0, promises_1.writeFile)(stylesPath, JSON.stringify(stylesData, null, 2))];
                                        case 23:
                                            _d.sent();
                                            _d.label = 24;
                                        case 24:
                                            indexData = { templates: [] };
                                            _d.label = 25;
                                        case 25:
                                            _d.trys.push([25, 27, , 28]);
                                            return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                                        case 26:
                                            indexContent = _d.sent();
                                            indexData = JSON.parse(indexContent);
                                            return [3 /*break*/, 28];
                                        case 27:
                                            _c = _d.sent();
                                            return [3 /*break*/, 28];
                                        case 28:
                                            existingIdx = indexData.templates.findIndex(function (t) { return t.id === template.id; });
                                            existing = existingIdx >= 0 ? indexData.templates[existingIdx] : null;
                                            if (packetConfig) {
                                                packetConfig = normalizeParsedPacketTemplateIds(packetConfig, template.id, existing === null || existing === void 0 ? void 0 : existing.packetConfig);
                                            }
                                            isUserDescription = (existing === null || existing === void 0 ? void 0 : existing.descriptionSource) === "user";
                                            description = isUserDescription ? existing.description : analysis.description;
                                            entry = {
                                                id: template.id,
                                                sourceFile: "source/".concat(sourceFile),
                                                parsedFile: "parsed/".concat(parsedFilename),
                                                name: (existing === null || existing === void 0 ? void 0 : existing.name) || formatTemplateName(template.id),
                                                description: description,
                                                descriptionSource: isUserDescription ? "user" : "ai",
                                                parsedAt: new Date().toISOString(),
                                                sourceModified: sourceStat.mtime.toISOString(),
                                                type: detectedAsPacket ? "packet" : "document",
                                                packetConfig: packetConfig,
                                            };
                                            if (existingIdx >= 0) {
                                                indexData.templates[existingIdx] = entry;
                                            }
                                            else {
                                                indexData.templates.push(entry);
                                            }
                                            return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(indexData, null, 2))];
                                        case 29:
                                            _d.sent();
                                            results[index] = { id: template.id, success: true, previewLength: analysis.markdown.length };
                                            return [4 /*yield*/, onProgress({
                                                    type: "template_done",
                                                    index: index,
                                                    total: templates.length,
                                                    id: template.id,
                                                    previewLength: analysis.markdown.length,
                                                })];
                                        case 30:
                                            _d.sent();
                                            return [3 /*break*/, 33];
                                        case 31:
                                            err_4 = _d.sent();
                                            error = err_4 instanceof Error ? err_4.message : String(err_4);
                                            console.error("[Batch Parse] Error for ".concat(template.id, ":"), error);
                                            results[index] = { id: template.id, success: false, error: error };
                                            return [4 /*yield*/, onProgress({
                                                    type: "template_error",
                                                    index: index,
                                                    total: templates.length,
                                                    id: template.id,
                                                    error: error,
                                                })];
                                        case 32:
                                            _d.sent();
                                            return [3 /*break*/, 33];
                                        case 33: return [2 /*return*/];
                                    }
                                });
                            };
                            _a.label = 1;
                        case 1:
                            if (!(currentIndex < templates.length)) return [3 /*break*/, 3];
                            return [5 /*yield**/, _loop_2()];
                        case 2:
                            _a.sent();
                            return [3 /*break*/, 1];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        }
        var results, currentIndex, templatesDir, sourceDir, parsedDir, indexPath, workers;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    results = new Array(templates.length);
                    currentIndex = 0;
                    templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                    sourceDir = (0, path_1.join)(templatesDir, "source");
                    parsedDir = (0, path_1.join)(templatesDir, "parsed");
                    indexPath = (0, path_1.join)(templatesDir, "templates.json");
                    workers = Array(Math.min(limit, templates.length)).fill(null).map(function () { return worker(); });
                    return [4 /*yield*/, Promise.all(workers)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, results];
            }
        });
    });
}
app.post("/doc-templates/parse-batch", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, _a, templateIds, reparse, templatesDir, sourceDir, indexPath, templates, index, indexContent, _b, sourceFiles, validExtensions_2, templateFiles, _loop_3, _i, templateFiles_2, filename, error_16;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _c.sent(), templateIds = _a.templateIds, reparse = _a.reparse;
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                sourceDir = (0, path_1.join)(templatesDir, "source");
                indexPath = (0, path_1.join)(templatesDir, "templates.json");
                templates = [];
                _c.label = 2;
            case 2:
                _c.trys.push([2, 14, , 15]);
                // Ensure directories exist
                return [4 /*yield*/, (0, promises_1.mkdir)(sourceDir, { recursive: true })];
            case 3:
                // Ensure directories exist
                _c.sent();
                return [4 /*yield*/, (0, promises_1.mkdir)((0, path_1.join)(templatesDir, "parsed"), { recursive: true })];
            case 4:
                _c.sent();
                index = { templates: [] };
                _c.label = 5;
            case 5:
                _c.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 6:
                indexContent = _c.sent();
                index = JSON.parse(indexContent);
                return [3 /*break*/, 8];
            case 7:
                _b = _c.sent();
                return [3 /*break*/, 8];
            case 8: return [4 /*yield*/, (0, promises_1.readdir)(sourceDir)];
            case 9:
                sourceFiles = _c.sent();
                validExtensions_2 = [".pdf", ".docx"];
                templateFiles = sourceFiles.filter(function (f) {
                    return validExtensions_2.includes((0, path_1.extname)(f).toLowerCase());
                });
                _loop_3 = function (filename) {
                    var id, existing, sourceFilePath, sourceStat, sourceModified, status_1, isOutdated;
                    return __generator(this, function (_d) {
                        switch (_d.label) {
                            case 0:
                                id = (0, path_1.basename)(filename, (0, path_1.extname)(filename));
                                // Filter by templateIds if provided
                                if (templateIds && templateIds.length > 0 && !templateIds.includes(id)) {
                                    return [2 /*return*/, "continue"];
                                }
                                existing = index.templates.find(function (t) { return t.id === id; });
                                sourceFilePath = (0, path_1.join)(sourceDir, filename);
                                return [4 /*yield*/, (0, promises_1.stat)(sourceFilePath)];
                            case 1:
                                sourceStat = _d.sent();
                                sourceModified = sourceStat.mtime.toISOString();
                                status_1 = "needs_parsing";
                                if (existing === null || existing === void 0 ? void 0 : existing.parsedFile) {
                                    isOutdated = existing.parsedAt
                                        ? new Date(sourceModified) > new Date(existing.parsedAt)
                                        : true;
                                    status_1 = isOutdated ? "outdated" : "parsed";
                                }
                                // Include if reparse=true or not already parsed
                                if (reparse || status_1 !== "parsed") {
                                    templates.push({ id: id, sourceFile: "source/".concat(filename), status: status_1 });
                                }
                                return [2 /*return*/];
                        }
                    });
                };
                _i = 0, templateFiles_2 = templateFiles;
                _c.label = 10;
            case 10:
                if (!(_i < templateFiles_2.length)) return [3 /*break*/, 13];
                filename = templateFiles_2[_i];
                return [5 /*yield**/, _loop_3(filename)];
            case 11:
                _c.sent();
                _c.label = 12;
            case 12:
                _i++;
                return [3 /*break*/, 10];
            case 13:
                if (templates.length === 0) {
                    return [2 /*return*/, c.json({ message: "No templates to parse", parsed: 0 })];
                }
                return [3 /*break*/, 15];
            case 14:
                error_16 = _c.sent();
                return [2 /*return*/, c.json({ error: "Failed to scan templates" }, 500)];
            case 15: 
            // Stream progress via SSE
            return [2 /*return*/, (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(void 0, void 0, void 0, function () {
                    var results, successCount, error_17;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 4, , 6]);
                                return [4 /*yield*/, stream.writeSSE({
                                        data: JSON.stringify({
                                            type: "start",
                                            total: templates.length,
                                            templates: templates.map(function (t) { return ({ id: t.id, status: t.status }); }),
                                        }),
                                    })];
                            case 1:
                                _a.sent();
                                return [4 /*yield*/, processTemplatesWithLimit(templates, root, TEMPLATE_CONCURRENCY, function (event) { return __awaiter(void 0, void 0, void 0, function () {
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0: return [4 /*yield*/, stream.writeSSE({ data: JSON.stringify(event) })];
                                                case 1:
                                                    _a.sent();
                                                    return [2 /*return*/];
                                            }
                                        });
                                    }); })];
                            case 2:
                                results = _a.sent();
                                successCount = results.filter(function (r) { return r.success; }).length;
                                return [4 /*yield*/, stream.writeSSE({
                                        data: JSON.stringify({
                                            type: "done",
                                            success: successCount === templates.length,
                                            successCount: successCount,
                                            total: templates.length,
                                            results: results,
                                        }),
                                    })];
                            case 3:
                                _a.sent();
                                return [3 /*break*/, 6];
                            case 4:
                                error_17 = _a.sent();
                                console.error("Batch parse error:", error_17);
                                return [4 /*yield*/, stream.writeSSE({
                                        data: JSON.stringify({
                                            type: "error",
                                            error: error_17 instanceof Error ? error_17.message : String(error_17),
                                        }),
                                    })];
                            case 5:
                                _a.sent();
                                return [3 /*break*/, 6];
                            case 6: return [2 /*return*/];
                        }
                    });
                }); })];
        }
    });
}); });
// Update template metadata (name, description)
app.put("/doc-templates/:id", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templateId, _a, name, description, indexPath, indexContent, index, existing, error_18;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                templateId = c.req.param("id");
                return [4 /*yield*/, c.req.json()];
            case 1:
                _a = _b.sent(), name = _a.name, description = _a.description;
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                indexPath = (0, path_1.join)(root, ".ai_tool", "templates", "templates.json");
                _b.label = 2;
            case 2:
                _b.trys.push([2, 5, , 6]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 3:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                existing = index.templates.find(function (t) { return t.id === templateId; });
                if (!existing) {
                    return [2 /*return*/, c.json({ error: "Template not found" }, 404)];
                }
                if (name !== undefined)
                    existing.name = name;
                if (description !== undefined) {
                    existing.description = description;
                    existing.descriptionSource = "user"; // Mark as user-edited so reparse won't overwrite
                }
                return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(index, null, 2))];
            case 4:
                _b.sent();
                return [2 /*return*/, c.json({ success: true, template: existing })];
            case 5:
                error_18 = _b.sent();
                if (error_18.code === "ENOENT") {
                    return [2 /*return*/, c.json({ error: "Template index not found" }, 404)];
                }
                return [2 /*return*/, c.json({ error: "Failed to update template" }, 500)];
            case 6: return [2 /*return*/];
        }
    });
}); });
// Get parsed template content for preview
app.get("/doc-templates/:id/preview", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templateId, parsedFilePath, content, _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                templateId = c.req.param("id");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                parsedFilePath = (0, path_1.join)(root, ".ai_tool", "templates", "parsed", "".concat(templateId, ".md"));
                _b.label = 1;
            case 1:
                _b.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, promises_1.readFile)(parsedFilePath, "utf-8")];
            case 2:
                content = _b.sent();
                return [2 /*return*/, c.json({ content: content })];
            case 3:
                _a = _b.sent();
                return [2 /*return*/, c.json({ error: "Parsed template not found" }, 404)];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Delete a template
app.delete("/doc-templates/:id", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templateId, templatesDir, indexPath, indexContent, index, existingIdx, template, _a, _b, error_19;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                root = c.req.query("root");
                templateId = c.req.param("id");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                indexPath = (0, path_1.join)(templatesDir, "templates.json");
                _c.label = 1;
            case 1:
                _c.trys.push([1, 12, , 13]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 2:
                indexContent = _c.sent();
                index = JSON.parse(indexContent);
                existingIdx = index.templates.findIndex(function (t) { return t.id === templateId; });
                if (existingIdx < 0) {
                    return [2 /*return*/, c.json({ error: "Template not found" }, 404)];
                }
                template = index.templates[existingIdx];
                _c.label = 3;
            case 3:
                _c.trys.push([3, 5, , 6]);
                return [4 /*yield*/, (0, promises_1.unlink)((0, path_1.join)(templatesDir, template.sourceFile))];
            case 4:
                _c.sent();
                return [3 /*break*/, 6];
            case 5:
                _a = _c.sent();
                return [3 /*break*/, 6];
            case 6:
                if (!template.parsedFile) return [3 /*break*/, 10];
                _c.label = 7;
            case 7:
                _c.trys.push([7, 9, , 10]);
                return [4 /*yield*/, (0, promises_1.unlink)((0, path_1.join)(templatesDir, template.parsedFile))];
            case 8:
                _c.sent();
                return [3 /*break*/, 10];
            case 9:
                _b = _c.sent();
                return [3 /*break*/, 10];
            case 10:
                // Remove from index
                index.templates.splice(existingIdx, 1);
                return [4 /*yield*/, (0, promises_1.writeFile)(indexPath, JSON.stringify(index, null, 2))];
            case 11:
                _c.sent();
                return [2 /*return*/, c.json({ success: true })];
            case 12:
                error_19 = _c.sent();
                if (error_19.code === "ENOENT") {
                    return [2 /*return*/, c.json({ error: "Template index not found" }, 404)];
                }
                return [2 /*return*/, c.json({ error: "Failed to delete template" }, 500)];
            case 13: return [2 /*return*/];
        }
    });
}); });
// Extract styles from a DOCX template
app.post("/doc-templates/:id/extract-styles", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, templateId, templatesDir, sourceDir, sourceFiles, sourceFile, sourceFilePath, styles, indexPath, templateName, indexContent, index, template, _a, stylesData, stylesPath, error_20;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                templateId = c.req.param("id");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                templatesDir = (0, path_1.join)(root, ".ai_tool", "templates");
                sourceDir = (0, path_1.join)(templatesDir, "source");
                _b.label = 1;
            case 1:
                _b.trys.push([1, 9, , 10]);
                return [4 /*yield*/, (0, promises_1.readdir)(sourceDir)];
            case 2:
                sourceFiles = _b.sent();
                sourceFile = sourceFiles.find(function (f) { return (0, path_1.basename)(f, (0, path_1.extname)(f)) === templateId && (0, path_1.extname)(f).toLowerCase() === ".docx"; });
                if (!sourceFile) {
                    return [2 /*return*/, c.json({ error: "DOCX source file not found (style extraction only works with DOCX)" }, 404)];
                }
                sourceFilePath = (0, path_1.join)(sourceDir, sourceFile);
                return [4 /*yield*/, (0, extract_1.extractStylesFromDocx)(sourceFilePath)];
            case 3:
                styles = _b.sent();
                indexPath = (0, path_1.join)(templatesDir, "templates.json");
                templateName = formatTemplateName(templateId);
                _b.label = 4;
            case 4:
                _b.trys.push([4, 6, , 7]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 5:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                template = index.templates.find(function (t) { return t.id === templateId; });
                if (template === null || template === void 0 ? void 0 : template.name)
                    templateName = template.name;
                return [3 /*break*/, 7];
            case 6:
                _a = _b.sent();
                return [3 /*break*/, 7];
            case 7:
                stylesData = {
                    sourceTemplate: sourceFile,
                    templateName: templateName,
                    extractedAt: new Date().toISOString(),
                    styles: styles,
                };
                stylesPath = (0, path_1.join)(root, ".ai_tool", "template-styles.json");
                return [4 /*yield*/, (0, promises_1.writeFile)(stylesPath, JSON.stringify(stylesData, null, 2))];
            case 8:
                _b.sent();
                return [2 /*return*/, c.json({
                        success: true,
                        styles: styles,
                        sourceTemplate: sourceFile,
                    })];
            case 9:
                error_20 = _b.sent();
                console.error("Extract styles error:", error_20);
                return [2 /*return*/, c.json({
                        error: error_20 instanceof Error ? error_20.message : String(error_20),
                    }, 500)];
            case 10: return [2 /*return*/];
        }
    });
}); });
// Get current template styles
app.get("/template-styles", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, stylesPath, content, data, error_21;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                stylesPath = (0, path_1.join)(root, ".ai_tool", "template-styles.json");
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, promises_1.readFile)(stylesPath, "utf-8")];
            case 2:
                content = _a.sent();
                data = JSON.parse(content);
                return [2 /*return*/, c.json(data)];
            case 3:
                error_21 = _a.sent();
                if (error_21.code === "ENOENT") {
                    return [2 /*return*/, c.json({ error: "No template styles found" }, 404)];
                }
                return [2 /*return*/, c.json({ error: "Failed to load template styles" }, 500)];
            case 4: return [2 /*return*/];
        }
    });
}); });
// Helper: Format template ID to readable name
function formatTemplateName(id) {
    return id
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
// Helper: Format extracted text as markdown (fallback if AI fails)
function formatAsMarkdown(text, title) {
    // Clean up the extracted text
    var cleaned = text
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return "# ".concat(title, "\n\n").concat(cleaned, "\n");
}
function analyzeTemplateWithAI(rawText, templateName) {
    return __awaiter(this, void 0, void 0, function () {
        var prompt, response, textBlock, fullText, description, markdown, descMatch;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    prompt = "You are analyzing a legal document template to make it useful for an AI agent that will generate similar documents.\n\nTEMPLATE NAME: ".concat(templateName, "\n\nRAW EXTRACTED TEXT:\n").concat(rawText, "\n\n---\n\nPlease analyze this template and produce TWO things:\n\n## PART 1: AGENT DESCRIPTION (output first, on its own line starting with \"DESCRIPTION:\")\n\nWrite a concise description that tells an AI agent WHEN to use this template. Include all relevant details:\n- What type of document it creates\n- Key conditions or triggers (e.g., \"when liability is clear\", \"for 3P carriers\", \"after treatment complete\")\n- Any special features of this template (e.g., \"includes loss of consortium\", \"with wage loss section\", \"premises liability specific\")\n- What case types or situations it's designed for\n\nKeep it to 1-2 sentences but include all important details. The description helps the agent choose the right template.\n\n## PART 2: TEMPLATE ANALYSIS (output after the description)\n\nProduce a well-structured markdown document that includes:\n\n1. **TEMPLATE OVERVIEW** (at the top)\n   - What type of document this is\n   - When to use this template\n   - Key characteristics or tone\n\n2. **STRUCTURE ANALYSIS**\n   - Identify all major sections/headings\n   - Explain the purpose of each section\n   - Note the typical order and flow\n\n3. **PLACEHOLDERS & VARIABLES**\n   - List all placeholders you find (things like [CLIENT NAME], blanks, or variable content)\n   - For each, explain what information should go there\n   - Use consistent placeholder format: `{{PLACEHOLDER_NAME}}`\n\n4. **TEMPLATE CONTENT**\n   - Reproduce the template with:\n     - Placeholders converted to `{{PLACEHOLDER_NAME}}` format\n     - Preserved formatting and structure\n     - Any boilerplate language clearly marked\n\n   **IMPORTANT FORMATTING RULES:**\n   - If this is a LETTER template (LOR, Bill HI, correspondence, client letter):\n     - Use **Bold Text** for section labels, NOT ## markdown headers\n     - Do NOT add --- horizontal rules between sections\n     - Preserve the continuous flowing letter format\n     - Keep the business letter style with natural paragraph breaks\n   - If this is a FORMAL DOCUMENT (demand letter, memo, legal brief):\n     - Use ## headers for major sections\n     - Horizontal rules are acceptable between major sections\n\n5. **USAGE NOTES**\n   - Any special considerations\n   - Required information to fill this template\n   - Common variations or optional sections\n\nFormat everything as clean markdown. The goal is to help an AI agent understand this template well enough to generate high-quality documents following the same structure and style.");
                    return [4 /*yield*/, getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 8000,
                            messages: [{ role: "user", content: prompt }],
                        })];
                case 1:
                    response = _a.sent();
                    textBlock = response.content.find(function (block) { return block.type === "text"; });
                    if (!textBlock || textBlock.type !== "text") {
                        throw new Error("AI analysis returned no text content");
                    }
                    fullText = textBlock.text;
                    description = "";
                    markdown = fullText;
                    descMatch = fullText.match(/^DESCRIPTION:\s*(.+?)(?:\n|$)/im);
                    if (descMatch) {
                        description = descMatch[1].trim();
                        // Remove the description line from the markdown
                        markdown = fullText.replace(/^DESCRIPTION:\s*.+?\n+/im, "").trim();
                    }
                    return [2 /*return*/, { markdown: markdown, description: description }];
            }
        });
    });
}
// Heuristic: detect if extracted text is an evidence packet front matter template.
// These templates have highly distinctive markers. If 3+ are present, classify as packet.
var PACKET_MARKERS = [
    /\bDOCUMENT\s+INDEX\b/i,
    /\bCOMES\s+NOW\b/i,
    /\bCERTIFICATE\s+OF\s+SERVICE\b/i,
    /\bAFFIRMATION\b/i,
    /\bClaim\s+No\b/i,
    /\bAppeal\s+No\b/i,
    /\bHearing\s+No\b/i,
    /\bBEFORE\s+THE\s+(HEARING|APPEALS)\s+OFFICER\b/i,
    /\bIndustrial\s+Insurance\s+Claim\b/i,
    /\bClaimant\b/i,
];
function isPacketTemplate(extractedText) {
    var matchCount = 0;
    for (var _i = 0, PACKET_MARKERS_1 = PACKET_MARKERS; _i < PACKET_MARKERS_1.length; _i++) {
        var marker = PACKET_MARKERS_1[_i];
        if (marker.test(extractedText)) {
            matchCount++;
            if (matchCount >= 3)
                return true;
        }
    }
    return false;
}
function detectPleadingLineNumbers(extractedText, extractedHtml) {
    var htmlText = (extractedHtml !== null && extractedHtml !== void 0 ? extractedHtml : "")
        .replace(/<[^>]*>/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/&nbsp;/g, " ");
    var allText = "".concat(extractedText, "\n").concat(htmlText);
    var normalizedLines = allText
        .replace(/\r/g, "\n")
        .split("\n")
        .map(function (line) { return line.trim(); })
        .filter(Boolean);
    var standaloneLineNumbers = normalizedLines.filter(function (line) { return /^\d{1,3}$/.test(line); }).length;
    var gutterAlignedLines = normalizedLines.filter(function (line) { return /^\d{1,3}\s{2,}\S/.test(line); }).length;
    var shortNumberHeadings = normalizedLines.filter(function (line) { return /^\d{1,3}\s*\S{1,30}$/.test(line); }).length;
    var repeatedStandaloneNumbers = (allText.match(/(?:^|\n)\s*\d{1,3}\s*(?:\n)/g) || []).length;
    var sequentialNumbers = Array.from(allText.matchAll(/(?:^|\n)\s*(\d{1,3})\s*(?:\n)/g))
        .map(function (match) { return Number.parseInt(match[1], 10); })
        .filter(function (value) { return Number.isFinite(value); });
    var consecutiveRun = 0;
    var maxConsecutiveRun = 0;
    var previous = null;
    for (var _i = 0, sequentialNumbers_1 = sequentialNumbers; _i < sequentialNumbers_1.length; _i++) {
        var value = sequentialNumbers_1[_i];
        if (previous !== null && value === previous + 1) {
            consecutiveRun += 1;
        }
        else {
            consecutiveRun = 1;
        }
        previous = value;
        if (consecutiveRun > maxConsecutiveRun) {
            maxConsecutiveRun = consecutiveRun;
        }
    }
    return Math.max(standaloneLineNumbers, gutterAlignedLines, shortNumberHeadings, repeatedStandaloneNumbers, maxConsecutiveRun * 2) >= 8;
}
function normalizeParsedPacketTemplateIds(packetConfig, sourceTemplateId, existingPacketConfig) {
    var legacyIds = new Set();
    if (existingPacketConfig === null || existingPacketConfig === void 0 ? void 0 : existingPacketConfig.id)
        legacyIds.add(existingPacketConfig.id);
    if (Array.isArray(existingPacketConfig === null || existingPacketConfig === void 0 ? void 0 : existingPacketConfig.legacyPacketIds)) {
        for (var _i = 0, _a = existingPacketConfig.legacyPacketIds; _i < _a.length; _i++) {
            var legacy = _a[_i];
            if (legacy)
                legacyIds.add(legacy);
        }
    }
    packetConfig.id = sourceTemplateId;
    if (legacyIds.size > 0) {
        packetConfig.legacyPacketIds = __spreadArray([], legacyIds, true).filter(function (id) { return id !== sourceTemplateId; });
    }
    else {
        delete packetConfig.legacyPacketIds;
    }
    return packetConfig;
}
// Analyze extracted text to produce structured PacketTemplate metadata
function analyzePacketTemplateWithAI(rawText, templateName) {
    return __awaiter(this, void 0, void 0, function () {
        var referenceExample, prompt, response, textBlock, jsonText, extracted, id, captionFields, BOILERPLATE_SECTIONS, rawExtraSections, indexTitle, template, sampleName, sampleFirmName, headingIdx, firmIdx, sampleAttorneyNames, sampleCaptionValues, textFields, namePattern, _i, textFields_1, field, firmPattern, _a, textFields_2, field, _b, sampleAttorneyNames_1, attorneyName, attyPattern, _c, textFields_3, field, _d, _e, _f, key, value, valuePattern, _g, textFields_4, field, text;
        var _h, _j, _k, _l, _m, _o;
        return __generator(this, function (_p) {
            switch (_p.label) {
                case 0:
                    referenceExample = JSON.stringify({
                        heading: "BEFORE THE APPEALS OFFICER",
                        captionPreambleLines: ["In the Matter of the Contested", "Industrial Insurance Claim of"],
                        captionFields: [
                            { label: "Claim No.:", key: "claimNumber" },
                            { label: "Appeal No.:", key: "hearingNumber" },
                            { label: "Date/Time:", key: "hearingDateTime" },
                            { label: "Appearance:", key: "appearance" },
                        ],
                        extraSections: [{ title: "ISSUE ON APPEAL", key: "issueOnAppeal" }],
                        indexTitle: "DOCUMENT INDEX",
                        counselPreamble: "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.",
                        affirmationTitle: "AFFIRMATION",
                        affirmationText: "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
                        certTitle: "CERTIFICATE OF SERVICE",
                        certIntro: "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
                        firmBlockPosition: "header",
                        signerBlockAlign: "right",
                    }, null, 2);
                    prompt = "You are analyzing a legal evidence packet front matter template to extract its REUSABLE STRUCTURE. The goal is to create a template that works for ANY case \u2014 all case-specific names, numbers, addresses, and dates must be removed.\n\nTEMPLATE NAME: ".concat(templateName, "\n\nRAW EXTRACTED TEXT:\n").concat(rawText, "\n\n---\n\nREFERENCE EXAMPLE (shows the expected format for an Appeals Officer template):\n").concat(referenceExample, "\n\n---\n\nExtract the template structure into JSON. CRITICAL RULES:\n\n**GENERICIZATION \u2014 the most important rule:**\n- counselPreamble: Use {{claimantName}} for the claimant. Replace ALL attorney names, firm names, and specific references with generic language. Example: \"by and through her attorneys, JASON WEINSTOCK, ESQ., of LAW OFFICE...\" becomes \"by and through counsel\"\n- affirmationText: Keep it generic. Do NOT reference specific case numbers or field values. Just describe the legal affirmation. Example: \"filed in Appeal No.: 12345\" becomes just the affirmation statement without the case number.\n- certIntro: Replace ALL firm names, attorney names, and specific addresses (except court/agency addresses which are standard). Example: \"an employee of the Law Office of Jason Weinstock\" becomes \"an employee of counsel\"\n- NEVER include hardcoded attorney names, firm names, bar numbers, or case-specific numbers in any text field\n\n**FIELDS:**\n- \"heading\": Main heading (e.g. \"BEFORE THE HEARING OFFICER\" or \"BEFORE THE APPEALS OFFICER\")\n- \"captionPreambleLines\": Lines above the claimant name on the left side of the caption\n- \"captionFields\": Array of {label, key} for the right-side fields. Use standard camelCase keys: claimNumber, hearingNumber, hearingDateTime, appearance. If the template uses \"Appeal No.\" instead of \"Hearing No.\", still use key \"hearingNumber\". Only include fields with a label and value area \u2014 do NOT include \"Employer:\" unless it appears as a right-side field with an input area.\n- \"extraSections\": ONLY sections where the USER FILLS IN VARIABLE TEXT per case (e.g. \"ISSUE ON APPEAL\" where the specific issue changes). Do NOT include fixed boilerplate sections like WITNESSES, DURATION, or any section with standard text that doesn't change per case. Empty array if none.\n- \"indexTitle\": The heading for the document index section. This should be something like \"DOCUMENT INDEX\" \u2014 NOT column headers like \"DATE / DOCUMENTS / PAGE NO(S)\".\n- \"counselPreamble\": The opening paragraph (genericized as described above)\n- \"affirmationTitle\": Title of the affirmation/certification section\n- \"affirmationText\": The affirmation paragraph (genericized, no case numbers)\n- \"certTitle\": Title of certificate of service/mailing section\n- \"certIntro\": The certificate intro paragraph (genericized as described above)\n- \"firmBlockPosition\": \"header\" if attorney info appears at page top, \"signature\" if only in signature block\n- \"signerBlockAlign\": \"left\" or \"right\" for the signature block position\n\n**SAMPLE VALUES (for post-processing cleanup):**\n- \"sampleClaimantName\": The actual claimant name in the document\n- \"sampleAttorneyNames\": Array of attorney names found\n- \"sampleFirmName\": The law firm name found\n- \"sampleCaptionValues\": Object mapping caption field keys to actual values shown\n\nRespond with ONLY valid JSON, no markdown fences.");
                    return [4 /*yield*/, getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 3000,
                            messages: [{ role: "user", content: prompt }],
                        })];
                case 1:
                    response = _p.sent();
                    textBlock = response.content.find(function (block) { return block.type === "text"; });
                    if (!textBlock || textBlock.type !== "text") {
                        throw new Error("Packet template analysis returned no text content");
                    }
                    jsonText = textBlock.text
                        .replace(/^```(?:json)?\s*/m, "")
                        .replace(/\s*```$/m, "")
                        .trim();
                    try {
                        extracted = JSON.parse(jsonText);
                    }
                    catch (_q) {
                        throw new Error("Failed to parse packet template analysis as JSON");
                    }
                    id = "custom-".concat(Date.now());
                    captionFields = Array.isArray(extracted.captionFields)
                        ? extracted.captionFields.map(function (f) { return ({ label: String((f === null || f === void 0 ? void 0 : f.label) || ""), key: String((f === null || f === void 0 ? void 0 : f.key) || "") }); })
                        : [];
                    BOILERPLATE_SECTIONS = new Set(["witnesses", "duration", "exhibits", "summary"]);
                    rawExtraSections = Array.isArray(extracted.extraSections)
                        ? extracted.extraSections
                            .map(function (s) { return ({ title: String((s === null || s === void 0 ? void 0 : s.title) || ""), key: String((s === null || s === void 0 ? void 0 : s.key) || "") }); })
                            .filter(function (s) { return s.title && s.key && !BOILERPLATE_SECTIONS.has(s.key.toLowerCase()); })
                        : [];
                    indexTitle = String(extracted.indexTitle || "DOCUMENT INDEX");
                    if (!/index/i.test(indexTitle) || /\bDATE\b/i.test(indexTitle)) {
                        indexTitle = "DOCUMENT INDEX";
                    }
                    template = {
                        id: id,
                        name: templateName,
                        heading: String(extracted.heading || "BEFORE THE HEARING OFFICER"),
                        captionPreambleLines: Array.isArray(extracted.captionPreambleLines)
                            ? extracted.captionPreambleLines.map(String)
                            : ["In the Matter of the Contested", "Industrial Insurance Claim of"],
                        captionFields: captionFields,
                        extraSections: rawExtraSections,
                        indexTitle: indexTitle,
                        counselPreamble: String(extracted.counselPreamble || ""),
                        affirmationTitle: String(extracted.affirmationTitle || "AFFIRMATION"),
                        affirmationText: String(extracted.affirmationText || ""),
                        certTitle: String(extracted.certTitle || "CERTIFICATE OF SERVICE"),
                        certIntro: String(extracted.certIntro || ""),
                        sourceFile: templateName,
                        firmBlockPosition: String(extracted.firmBlockPosition || "").trim().toLowerCase() === "signature"
                            ? "signature"
                            : "header",
                        signerBlockAlign: String(extracted.signerBlockAlign || "").trim().toLowerCase() === "left"
                            ? "left"
                            : "right",
                    };
                    sampleName = typeof extracted.sampleClaimantName === "string"
                        ? extracted.sampleClaimantName.trim()
                        : "";
                    sampleFirmName = typeof extracted.sampleFirmName === "string"
                        ? extracted.sampleFirmName.trim()
                        : "";
                    // Heuristic: verify firmBlockPosition by checking the raw text.
                    // If the firm/attorney name appears BEFORE the main heading ("BEFORE THE"),
                    // it's genuinely in a header position. Otherwise, override to "signature".
                    if (template.firmBlockPosition === "header" && sampleFirmName) {
                        headingIdx = rawText.search(/BEFORE\s+THE\s+(HEARING|APPEALS)\s+OFFICER/i);
                        firmIdx = rawText.indexOf(sampleFirmName);
                        // Firm name must appear before the heading to be a true header position
                        if (headingIdx >= 0 && (firmIdx < 0 || firmIdx > headingIdx)) {
                            template.firmBlockPosition = "signature";
                        }
                    }
                    sampleAttorneyNames = Array.isArray(extracted.sampleAttorneyNames)
                        ? extracted.sampleAttorneyNames.filter(function (n) { return typeof n === "string" && n.trim(); }).map(function (n) { return String(n).trim(); })
                        : [];
                    sampleCaptionValues = extracted.sampleCaptionValues && typeof extracted.sampleCaptionValues === "object"
                        ? Object.fromEntries(Object.entries(extracted.sampleCaptionValues)
                            .filter(function (_a) {
                            var v = _a[1];
                            return typeof v === "string" && v.trim();
                        })
                            .map(function (_a) {
                            var k = _a[0], v = _a[1];
                            return [k, String(v).trim()];
                        }))
                        : {};
                    textFields = [
                        "counselPreamble", "affirmationText", "certIntro",
                    ];
                    // Replace hardcoded claimant name with {{claimantName}}
                    if (sampleName) {
                        namePattern = new RegExp(sampleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                        for (_i = 0, textFields_1 = textFields; _i < textFields_1.length; _i++) {
                            field = textFields_1[_i];
                            template[field] = ((_h = template[field]) !== null && _h !== void 0 ? _h : "").replace(namePattern, "{{claimantName}}");
                        }
                    }
                    // Replace hardcoded firm name with "counsel" / generic reference
                    if (sampleFirmName) {
                        firmPattern = new RegExp(sampleFirmName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                        for (_a = 0, textFields_2 = textFields; _a < textFields_2.length; _a++) {
                            field = textFields_2[_a];
                            template[field] = ((_j = template[field]) !== null && _j !== void 0 ? _j : "").replace(firmPattern, "counsel");
                        }
                    }
                    // Replace hardcoded attorney names
                    for (_b = 0, sampleAttorneyNames_1 = sampleAttorneyNames; _b < sampleAttorneyNames_1.length; _b++) {
                        attorneyName = sampleAttorneyNames_1[_b];
                        if (!attorneyName || attorneyName.length < 3)
                            continue;
                        attyPattern = new RegExp(attorneyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                        for (_c = 0, textFields_3 = textFields; _c < textFields_3.length; _c++) {
                            field = textFields_3[_c];
                            template[field] = ((_k = template[field]) !== null && _k !== void 0 ? _k : "").replace(attyPattern, "counsel");
                        }
                    }
                    // Replace hardcoded caption values (case numbers, etc.)
                    for (_d = 0, _e = Object.entries(sampleCaptionValues); _d < _e.length; _d++) {
                        _f = _e[_d], key = _f[0], value = _f[1];
                        if (!value)
                            continue;
                        valuePattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                        template.affirmationText = ((_l = template.affirmationText) !== null && _l !== void 0 ? _l : "").replace(valuePattern, "{{".concat(key, "}}"));
                        template.certIntro = ((_m = template.certIntro) !== null && _m !== void 0 ? _m : "").replace(valuePattern, "{{".concat(key, "}}"));
                    }
                    // Replace hardcoded dates in certIntro
                    if (template.certIntro) {
                        template.certIntro = template.certIntro
                            .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*\d{4}\b/gi, "___")
                            .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*,?\s*\d{4}\b/gi, "___");
                    }
                    // Clean up any double-genericized artifacts (e.g. "counsel, ESQ., and counsel, ESQ., of counsel")
                    for (_g = 0, textFields_4 = textFields; _g < textFields_4.length; _g++) {
                        field = textFields_4[_g];
                        text = (_o = template[field]) !== null && _o !== void 0 ? _o : "";
                        // Collapse patterns like "counsel, ESQ.," or "counsel, Esq." to just "counsel"
                        text = text.replace(/counsel,?\s*ESQ\.?,?/gi, "counsel");
                        // Collapse "by and through her/his attorneys, counsel and counsel, of counsel" patterns
                        text = text.replace(/(?:her|his|their)\s+attorneys?,\s*counsel\s+and\s+counsel,\s*of\s+counsel/gi, "counsel");
                        // Simpler: "counsel and counsel" -> "counsel"
                        text = text.replace(/counsel\s+and\s+counsel/gi, "counsel");
                        // "of counsel," -> "of counsel"
                        text = text.replace(/,\s*of\s+counsel/gi, "");
                        // "an employee of counsel" is correct — keep it
                        template[field] = text;
                    }
                    // Keep extracted exemplar values for DOCX HTML genericization.
                    return [2 /*return*/, {
                            template: template,
                            sampleClaimantName: sampleName,
                            sampleFirmName: sampleFirmName,
                            sampleAttorneyNames: sampleAttorneyNames,
                            sampleCaptionValues: sampleCaptionValues,
                        }];
            }
        });
    });
}
// Reindex meta with semantic tags
app.post("/reindex-meta", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, knowledgeDir, manifestPath, manifest, _a, _b, tagInputs, _i, _c, section, filename, content, _d, _e, tagsMap, knowledgeSummary, _f, manifestMtime, sectionMtimes, sections, _g, _h, section, filename, st, _j, content, tags, metaIndex, metaIndexPath, error_22;
    return __generator(this, function (_k) {
        switch (_k.label) {
            case 0: return [4 /*yield*/, c.req.json()];
            case 1:
                root = (_k.sent()).root;
                if (!root) {
                    return [2 /*return*/, c.json({ error: "root required" }, 400)];
                }
                _k.label = 2;
            case 2:
                _k.trys.push([2, 23, , 24]);
                knowledgeDir = (0, path_1.join)(root, ".ai_tool", "knowledge");
                manifestPath = (0, path_1.join)(knowledgeDir, "manifest.json");
                _b = (_a = JSON).parse;
                return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
            case 3:
                manifest = _b.apply(_a, [_k.sent()]);
                tagInputs = [];
                _i = 0, _c = manifest.sections || [];
                _k.label = 4;
            case 4:
                if (!(_i < _c.length)) return [3 /*break*/, 9];
                section = _c[_i];
                filename = section.filename;
                if (!filename)
                    return [3 /*break*/, 8];
                _k.label = 5;
            case 5:
                _k.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, filename), "utf-8")];
            case 6:
                content = _k.sent();
                tagInputs.push({ filename: filename, title: section.title || filename, content: content });
                return [3 /*break*/, 8];
            case 7:
                _d = _k.sent();
                return [3 /*break*/, 8];
            case 8:
                _i++;
                return [3 /*break*/, 4];
            case 9:
                if (!(tagInputs.length > 0)) return [3 /*break*/, 11];
                return [4 /*yield*/, Promise.all([
                        (0, knowledge_tagger_1.generateTagsForAllSections)(tagInputs),
                        (0, knowledge_tagger_1.generateKnowledgeSummary)(tagInputs),
                    ])];
            case 10:
                _f = _k.sent();
                return [3 /*break*/, 12];
            case 11:
                _f = [new Map(), ""];
                _k.label = 12;
            case 12:
                _e = _f, tagsMap = _e[0], knowledgeSummary = _e[1];
                return [4 /*yield*/, (0, promises_1.stat)(manifestPath)];
            case 13:
                manifestMtime = (_k.sent()).mtimeMs;
                sectionMtimes = {};
                sections = [];
                _g = 0, _h = manifest.sections || [];
                _k.label = 14;
            case 14:
                if (!(_g < _h.length)) return [3 /*break*/, 21];
                section = _h[_g];
                filename = section.filename;
                if (!filename)
                    return [3 /*break*/, 20];
                _k.label = 15;
            case 15:
                _k.trys.push([15, 17, , 18]);
                return [4 /*yield*/, (0, promises_1.stat)((0, path_1.join)(knowledgeDir, filename))];
            case 16:
                st = _k.sent();
                sectionMtimes[filename] = st.mtimeMs;
                return [3 /*break*/, 18];
            case 17:
                _j = _k.sent();
                return [3 /*break*/, 18];
            case 18: return [4 /*yield*/, (0, promises_1.readFile)((0, path_1.join)(knowledgeDir, filename), "utf-8").catch(function () { return ""; })];
            case 19:
                content = _k.sent();
                tags = tagsMap.get(filename);
                sections.push(__assign({ id: section.id, title: section.title || filename, filename: filename, path: ".ai_tool/knowledge/".concat(filename), preview: content.replace(/\s+/g, " ").trim().slice(0, 420), char_count: content.length }, (tags ? { topics: tags.topics, applies_to: tags.applies_to, summary: tags.summary } : {})));
                _k.label = 20;
            case 20:
                _g++;
                return [3 /*break*/, 14];
            case 21:
                metaIndex = {
                    indexed_at: new Date().toISOString(),
                    source: ".ai_tool/knowledge/manifest.json",
                    source_mtime: manifestMtime,
                    practice_area: manifest.practiceArea,
                    jurisdiction: manifest.jurisdiction,
                    section_count: sections.length,
                    sections: sections,
                    section_mtimes: sectionMtimes,
                    has_semantic_tags: tagsMap.size > 0,
                };
                if (knowledgeSummary) {
                    metaIndex.knowledge_summary = knowledgeSummary;
                }
                metaIndexPath = (0, path_1.join)(knowledgeDir, "meta_index.json");
                return [4 /*yield*/, (0, promises_1.writeFile)(metaIndexPath, JSON.stringify(metaIndex, null, 2))];
            case 22:
                _k.sent();
                clearKnowledgeCache(root);
                return [2 /*return*/, c.json({
                        success: true,
                        section_count: sections.length,
                        tagged_count: tagsMap.size,
                        has_summary: !!knowledgeSummary,
                    })];
            case 23:
                error_22 = _k.sent();
                console.error("Reindex meta error:", error_22);
                return [2 /*return*/, c.json({
                        error: error_22 instanceof Error ? error_22.message : String(error_22),
                    }, 500)];
            case 24: return [2 /*return*/];
        }
    });
}); });
// ============================================================================
// PACKET TEMPLATE LISTING (unified with doc-templates)
// ============================================================================
// List packet templates: built-in + auto-detected from doc-templates index
app.get("/packet-templates", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var root, indexPath, customPackets, indexContent, index, _a, all, error_23;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                root = c.req.query("root");
                if (!root)
                    return [2 /*return*/, c.json({ error: "root query param required" }, 400)];
                _b.label = 1;
            case 1:
                _b.trys.push([1, 6, , 7]);
                indexPath = (0, path_1.join)(root, ".ai_tool", "templates", "templates.json");
                customPackets = [];
                _b.label = 2;
            case 2:
                _b.trys.push([2, 4, , 5]);
                return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
            case 3:
                indexContent = _b.sent();
                index = JSON.parse(indexContent);
                customPackets = index.templates
                    .filter(function (t) { return t.type === "packet" && t.packetConfig; })
                    .map(function (t) { return t.packetConfig; });
                return [3 /*break*/, 5];
            case 4:
                _a = _b.sent();
                return [3 /*break*/, 5];
            case 5:
                all = __spreadArray(__spreadArray([], evidence_packet_1.BUILT_IN_TEMPLATES, true), customPackets, true);
                return [2 /*return*/, c.json({ templates: all })];
            case 6:
                error_23 = _b.sent();
                console.error("List packet templates error:", error_23);
                return [2 /*return*/, c.json({ error: "Failed to list packet templates" }, 500)];
            case 7: return [2 /*return*/];
        }
    });
}); });
/**
 * Load document templates for agent context.
 * Returns a formatted string describing available templates.
 */
function loadDocumentTemplates(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var indexPath, indexContent, index, parsed, lines, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    indexPath = (0, path_1.join)(firmRoot, ".ai_tool", "templates", "templates.json");
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 2:
                    indexContent = _b.sent();
                    index = JSON.parse(indexContent);
                    if (index.templates.length === 0) {
                        return [2 /*return*/, ""];
                    }
                    parsed = index.templates.filter(function (t) { return t.parsedFile; });
                    if (parsed.length === 0) {
                        return [2 /*return*/, ""];
                    }
                    lines = parsed.map(function (t) { return "- **".concat(t.name, "** (").concat(t.id, "): ").concat(t.description || "No description"); });
                    return [2 /*return*/, "DOCUMENT TEMPLATES:\n".concat(lines.join("\n"), "\n\nTo use a template, read .ai_tool/templates/parsed/{id}.md for the template content.")];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, ""];
                case 4: return [2 /*return*/];
            }
        });
    });
}
exports.default = app;
