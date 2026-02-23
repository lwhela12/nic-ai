"use strict";
/**
 * Year-Based Folder Structure Support
 *
 * Detects and manages firms organized by year: Root/2024/Smith, John/, Root/2025/Smith, John/
 * Creates virtual case folders under .ai_tool/clients/<slug>/ with unified .ai_tool/ directories.
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
exports.isYearFolder = isYearFolder;
exports.yearFromFolder = yearFromFolder;
exports.slugify = slugify;
exports.detectYearBasedMode = detectYearBasedMode;
exports.loadClientRegistry = loadClientRegistry;
exports.scanAndBuildRegistry = scanAndBuildRegistry;
exports.ensureRegistryFresh = ensureRegistryFresh;
exports.refreshRegistry = refreshRegistry;
exports.resolveFirmRoot = resolveFirmRoot;
exports.getClientSlug = getClientSlug;
exports.getSourceFolders = getSourceFolders;
exports.resolveYearFilePath = resolveYearFilePath;
exports.listYearBasedCaseFiles = listYearBasedCaseFiles;
exports.walkYearBasedFiles = walkYearBasedFiles;
var promises_1 = require("fs/promises");
var path_1 = require("path");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isYearFolder(name) {
    return /^(19|20)\d{2}(\s|$)/.test(name);
}
/** Extract the 4-digit year from a year folder name, or null. */
function yearFromFolder(name) {
    var m = name.match(/^((?:19|20)\d{2})/);
    return m ? parseInt(m[1], 10) : null;
}
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/,/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function pathExists(p) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.stat)(p)];
                case 1:
                    _b.sent();
                    return [2 /*return*/, true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
/**
 * Returns true if at least 2 direct children of firmRoot are year folders.
 */
function detectYearBasedMode(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, dirs, yearCount, result, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.readdir)(firmRoot, { withFileTypes: true })];
                case 1:
                    entries = _a.sent();
                    dirs = entries.filter(function (e) { return e.isDirectory() && !e.name.startsWith("."); });
                    yearCount = dirs.filter(function (e) { return isYearFolder(e.name); }).length;
                    result = yearCount >= 2;
                    console.log("[year-mode] detect: ".concat(dirs.length, " dirs, ").concat(yearCount, " year folders \u2192 ").concat(result ? "YEAR MODE" : "flat mode"), dirs.map(function (d) { return d.name; }));
                    return [2 /*return*/, result];
                case 2:
                    err_1 = _a.sent();
                    console.error("[year-mode] detect error:", err_1);
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------
var AI_TOOL_DIR = ".ai_tool";
var REGISTRY_FILE = "client-registry.json";
var CLIENTS_DIR = "clients";
function registryPath(firmRoot) {
    return (0, path_1.join)(firmRoot, AI_TOOL_DIR, REGISTRY_FILE);
}
function loadClientRegistry(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var content, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.readFile)(registryPath(firmRoot), "utf-8")];
                case 1:
                    content = _b.sent();
                    return [2 /*return*/, JSON.parse(content)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function saveClientRegistry(firmRoot, registry) {
    return __awaiter(this, void 0, void 0, function () {
        var dir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dir = (0, path_1.join)(firmRoot, AI_TOOL_DIR);
                    return [4 /*yield*/, (0, promises_1.mkdir)(dir, { recursive: true })];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)(registryPath(firmRoot), JSON.stringify(registry, null, 2))];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
/**
 * Count files in a directory recursively (excludes .ai_tool and dot-files).
 */
function countDirFiles(dir) {
    return __awaiter(this, void 0, void 0, function () {
        var count, entries, _a, _i, entries_1, e, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    count = 0;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                case 2:
                    entries = _c.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _c.sent();
                    return [2 /*return*/, 0];
                case 4:
                    _i = 0, entries_1 = entries;
                    _c.label = 5;
                case 5:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 9];
                    e = entries_1[_i];
                    if (e.name === AI_TOOL_DIR || e.name.startsWith("."))
                        return [3 /*break*/, 8];
                    if (!e.isDirectory()) return [3 /*break*/, 7];
                    _b = count;
                    return [4 /*yield*/, countDirFiles((0, path_1.join)(dir, e.name))];
                case 6:
                    count = _b + _c.sent();
                    return [3 /*break*/, 8];
                case 7:
                    count++;
                    _c.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 5];
                case 9: return [2 /*return*/, count];
            }
        });
    });
}
/**
 * Walk all year folders, group clients by exact name, count files,
 * and create .ai_tool/clients/<slug>/ dirs.
 */
function scanAndBuildRegistry(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var registry, entries, yearDirs, yearResults, _i, yearResults_1, yearClients, _a, yearClients_1, _b, yearName, clientName, slug, relFolder, _c, _d, entry;
        var _this = this;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    registry = {
                        mode: "year-based",
                        firmRoot: firmRoot,
                        clients: {},
                    };
                    return [4 /*yield*/, (0, promises_1.readdir)(firmRoot, { withFileTypes: true })];
                case 1:
                    entries = _e.sent();
                    yearDirs = entries.filter(function (e) { return e.isDirectory() && isYearFolder(e.name); });
                    return [4 /*yield*/, Promise.all(yearDirs.map(function (yearDir) { return __awaiter(_this, void 0, void 0, function () {
                            var yearPath, clients, _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        yearPath = (0, path_1.join)(firmRoot, yearDir.name);
                                        _b.label = 1;
                                    case 1:
                                        _b.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, (0, promises_1.readdir)(yearPath, { withFileTypes: true })];
                                    case 2:
                                        clients = _b.sent();
                                        return [3 /*break*/, 4];
                                    case 3:
                                        _a = _b.sent();
                                        return [2 /*return*/, []];
                                    case 4: return [2 /*return*/, clients
                                            .filter(function (c) { return c.isDirectory() && !c.name.startsWith("."); })
                                            .map(function (c) { return ({ yearName: yearDir.name, clientName: c.name }); })];
                                }
                            });
                        }); }))];
                case 2:
                    yearResults = _e.sent();
                    // Build registry from parallel results
                    for (_i = 0, yearResults_1 = yearResults; _i < yearResults_1.length; _i++) {
                        yearClients = yearResults_1[_i];
                        for (_a = 0, yearClients_1 = yearClients; _a < yearClients_1.length; _a++) {
                            _b = yearClients_1[_a], yearName = _b.yearName, clientName = _b.clientName;
                            slug = slugify(clientName);
                            relFolder = "".concat(yearName, "/").concat(clientName);
                            if (!registry.clients[slug]) {
                                registry.clients[slug] = {
                                    name: clientName,
                                    slug: slug,
                                    sourceFolders: [],
                                };
                            }
                            if (!registry.clients[slug].sourceFolders.includes(relFolder)) {
                                registry.clients[slug].sourceFolders.push(relFolder);
                            }
                        }
                    }
                    // Sort source folders chronologically
                    for (_c = 0, _d = Object.values(registry.clients); _c < _d.length; _c++) {
                        entry = _d[_c];
                        entry.sourceFolders.sort();
                    }
                    // Count files and create client dirs in parallel
                    return [4 /*yield*/, Promise.all(Object.values(registry.clients).map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                            var counts;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, Promise.all(entry.sourceFolders.map(function (rel) { return countDirFiles((0, path_1.join)(firmRoot, rel)); }))];
                                    case 1:
                                        counts = _a.sent();
                                        entry.fileCount = counts.reduce(function (a, b) { return a + b; }, 0);
                                        // Ensure virtual client dir exists
                                        return [4 /*yield*/, (0, promises_1.mkdir)((0, path_1.join)(firmRoot, AI_TOOL_DIR, CLIENTS_DIR, entry.slug), {
                                                recursive: true,
                                            })];
                                    case 2:
                                        // Ensure virtual client dir exists
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 3:
                    // Count files and create client dirs in parallel
                    _e.sent();
                    console.log("[year-mode] scanned ".concat(yearDirs.length, " year folders \u2192 ").concat(Object.keys(registry.clients).length, " clients"));
                    return [4 /*yield*/, saveClientRegistry(firmRoot, registry)];
                case 4:
                    _e.sent();
                    return [2 /*return*/, registry];
            }
        });
    });
}
/**
 * Lightweight freshness check: only scan the current year folder and any
 * year folders not yet in the registry. Prior years are considered frozen.
 * Returns the (possibly updated) registry — callers should use this instead
 * of the one they loaded from disk.
 */
function ensureRegistryFresh(firmRoot, registry) {
    return __awaiter(this, void 0, void 0, function () {
        var currentYear, entries, yearDirs, knownFolders, _i, _a, client, _b, _c, sf, foldersToScan, missingCounts, changed, scanResults, _d, scanResults_1, yearClients, _e, yearClients_2, _f, yearName, clientName, slug, relFolder, changedSlugs, _g, scanResults_2, yearClients, _h, yearClients_3, clientName;
        var _this = this;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    currentYear = new Date().getFullYear();
                    return [4 /*yield*/, (0, promises_1.readdir)(firmRoot, { withFileTypes: true })];
                case 1:
                    entries = _j.sent();
                    yearDirs = entries.filter(function (e) { return e.isDirectory() && isYearFolder(e.name); });
                    knownFolders = new Set();
                    for (_i = 0, _a = Object.values(registry.clients); _i < _a.length; _i++) {
                        client = _a[_i];
                        for (_b = 0, _c = client.sourceFolders; _b < _c.length; _b++) {
                            sf = _c[_b];
                            knownFolders.add(sf);
                        }
                    }
                    foldersToScan = yearDirs.filter(function (d) {
                        var y = yearFromFolder(d.name);
                        if (y === currentYear)
                            return true;
                        // Check if ANY client has a source folder starting with this year dir name
                        var prefix = d.name + "/";
                        for (var _i = 0, knownFolders_1 = knownFolders; _i < knownFolders_1.length; _i++) {
                            var sf = knownFolders_1[_i];
                            if (sf.startsWith(prefix))
                                return false;
                        }
                        return true; // entirely new year folder
                    });
                    missingCounts = Object.values(registry.clients).filter(function (e) { return e.fileCount == null; });
                    if (!(missingCounts.length > 0)) return [3 /*break*/, 4];
                    console.log("[year-mode] migrating file counts for ".concat(missingCounts.length, " clients"));
                    return [4 /*yield*/, Promise.all(missingCounts.map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                            var counts;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, Promise.all(entry.sourceFolders.map(function (rel) { return countDirFiles((0, path_1.join)(firmRoot, rel)); }))];
                                    case 1:
                                        counts = _a.sent();
                                        entry.fileCount = counts.reduce(function (a, b) { return a + b; }, 0);
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 2:
                    _j.sent();
                    return [4 /*yield*/, saveClientRegistry(firmRoot, registry)];
                case 3:
                    _j.sent();
                    _j.label = 4;
                case 4:
                    if (foldersToScan.length === 0)
                        return [2 /*return*/, registry];
                    changed = false;
                    return [4 /*yield*/, Promise.all(foldersToScan.map(function (yearDir) { return __awaiter(_this, void 0, void 0, function () {
                            var yearPath, clients, _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        yearPath = (0, path_1.join)(firmRoot, yearDir.name);
                                        _b.label = 1;
                                    case 1:
                                        _b.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, (0, promises_1.readdir)(yearPath, { withFileTypes: true })];
                                    case 2:
                                        clients = _b.sent();
                                        return [3 /*break*/, 4];
                                    case 3:
                                        _a = _b.sent();
                                        return [2 /*return*/, []];
                                    case 4: return [2 /*return*/, clients
                                            .filter(function (c) { return c.isDirectory() && !c.name.startsWith("."); })
                                            .map(function (c) { return ({ yearName: yearDir.name, clientName: c.name }); })];
                                }
                            });
                        }); }))];
                case 5:
                    scanResults = _j.sent();
                    for (_d = 0, scanResults_1 = scanResults; _d < scanResults_1.length; _d++) {
                        yearClients = scanResults_1[_d];
                        for (_e = 0, yearClients_2 = yearClients; _e < yearClients_2.length; _e++) {
                            _f = yearClients_2[_e], yearName = _f.yearName, clientName = _f.clientName;
                            slug = slugify(clientName);
                            relFolder = "".concat(yearName, "/").concat(clientName);
                            if (!registry.clients[slug]) {
                                registry.clients[slug] = {
                                    name: clientName,
                                    slug: slug,
                                    sourceFolders: [],
                                };
                                changed = true;
                            }
                            if (!registry.clients[slug].sourceFolders.includes(relFolder)) {
                                registry.clients[slug].sourceFolders.push(relFolder);
                                registry.clients[slug].sourceFolders.sort();
                                changed = true;
                            }
                        }
                    }
                    if (!changed)
                        return [2 /*return*/, registry];
                    changedSlugs = new Set();
                    for (_g = 0, scanResults_2 = scanResults; _g < scanResults_2.length; _g++) {
                        yearClients = scanResults_2[_g];
                        for (_h = 0, yearClients_3 = yearClients; _h < yearClients_3.length; _h++) {
                            clientName = yearClients_3[_h].clientName;
                            changedSlugs.add(slugify(clientName));
                        }
                    }
                    return [4 /*yield*/, Promise.all(__spreadArray([], changedSlugs, true).map(function (slug) { return __awaiter(_this, void 0, void 0, function () {
                            var entry, counts;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        entry = registry.clients[slug];
                                        if (!entry)
                                            return [2 /*return*/];
                                        return [4 /*yield*/, Promise.all(entry.sourceFolders.map(function (rel) { return countDirFiles((0, path_1.join)(firmRoot, rel)); }))];
                                    case 1:
                                        counts = _a.sent();
                                        entry.fileCount = counts.reduce(function (a, b) { return a + b; }, 0);
                                        return [4 /*yield*/, (0, promises_1.mkdir)((0, path_1.join)(firmRoot, AI_TOOL_DIR, CLIENTS_DIR, entry.slug), {
                                                recursive: true,
                                            })];
                                    case 2:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 6:
                    _j.sent();
                    console.log("[year-mode] freshness check: scanned ".concat(foldersToScan.map(function (d) { return d.name; }).join(", "), " \u2192 ").concat(changedSlugs.size, " clients updated"));
                    return [4 /*yield*/, saveClientRegistry(firmRoot, registry)];
                case 7:
                    _j.sent();
                    return [2 /*return*/, registry];
            }
        });
    });
}
/**
 * Re-scan and detect new clients or new year entries for existing clients.
 */
function refreshRegistry(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var existing, fresh, added, updated, _loop_1, _i, _a, _b, slug, entry;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, loadClientRegistry(firmRoot)];
                case 1:
                    existing = _c.sent();
                    return [4 /*yield*/, scanAndBuildRegistry(firmRoot)];
                case 2:
                    fresh = _c.sent();
                    added = [];
                    updated = [];
                    _loop_1 = function (slug, entry) {
                        if (!(existing === null || existing === void 0 ? void 0 : existing.clients[slug])) {
                            added.push(entry.name);
                        }
                        else {
                            var oldFolders_1 = new Set(existing.clients[slug].sourceFolders);
                            var hasNew = entry.sourceFolders.some(function (f) { return !oldFolders_1.has(f); });
                            if (hasNew)
                                updated.push(entry.name);
                        }
                    };
                    for (_i = 0, _a = Object.entries(fresh.clients); _i < _a.length; _i++) {
                        _b = _a[_i], slug = _b[0], entry = _b[1];
                        _loop_1(slug, entry);
                    }
                    return [2 /*return*/, { added: added, updated: updated }];
            }
        });
    });
}
// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------
var AI_TOOL_CLIENTS_SEGMENT = "".concat(AI_TOOL_DIR).concat(path_1.sep).concat(CLIENTS_DIR).concat(path_1.sep);
var AI_TOOL_CLIENTS_SEGMENT_FWD = "".concat(AI_TOOL_DIR, "/").concat(CLIENTS_DIR, "/");
/**
 * If caseFolder is a virtual path like /Root/.ai_tool/clients/smith-john/,
 * walk up to find the firm root. Otherwise fall back to dirname(caseFolder).
 */
function resolveFirmRoot(caseFolder) {
    var normalized = caseFolder.replace(/\\/g, "/");
    var idx = normalized.indexOf("/".concat(AI_TOOL_DIR, "/").concat(CLIENTS_DIR, "/"));
    if (idx !== -1) {
        return normalized.slice(0, idx);
    }
    // Also check without leading slash for relative paths
    if (normalized.startsWith("".concat(AI_TOOL_DIR, "/").concat(CLIENTS_DIR, "/"))) {
        return ".";
    }
    return (0, path_1.dirname)(caseFolder);
}
/**
 * Extract slug from a .ai_tool/clients/<slug>/ virtual path, or null if not virtual.
 */
function getClientSlug(caseFolder) {
    var normalized = caseFolder.replace(/\\/g, "/");
    var marker = "/".concat(AI_TOOL_DIR, "/").concat(CLIENTS_DIR, "/");
    var idx = normalized.indexOf(marker);
    if (idx === -1)
        return null;
    var afterMarker = normalized.slice(idx + marker.length);
    // slug is everything up to the next slash (or end)
    var slug = afterMarker.split("/")[0];
    return slug || null;
}
/**
 * Return absolute paths for all source folders of a client.
 */
function getSourceFolders(firmRoot, registry, slug) {
    var entry = registry.clients[slug];
    if (!entry)
        return [];
    return entry.sourceFolders.map(function (rel) { return (0, path_1.join)(firmRoot, rel); });
}
/**
 * Resolve a year-prefixed relative path back to its absolute location.
 * e.g. "2024/Medical/report.pdf" → "/Root/2024/Smith, John/Medical/report.pdf"
 *
 * The first path segment is the year, the rest is relative within that year's client folder.
 */
function resolveYearFilePath(firmRoot, registry, slug, relativePath) {
    var entry = registry.clients[slug];
    if (!entry)
        return (0, path_1.join)(firmRoot, relativePath);
    var parts = relativePath.replace(/\\/g, "/").split("/");
    var yearPart = parts[0];
    var restParts = parts.slice(1);
    // Find the source folder that starts with this year
    var sourceFolder = entry.sourceFolders.find(function (sf) {
        return sf.startsWith(yearPart + "/");
    });
    if (sourceFolder) {
        return path_1.join.apply(void 0, __spreadArray([firmRoot, sourceFolder], restParts, false));
    }
    // Fallback — try direct resolution
    return (0, path_1.join)(firmRoot, relativePath);
}
// ---------------------------------------------------------------------------
// File Listing
// ---------------------------------------------------------------------------
/**
 * Walk all source folders for a client, returning year-prefixed relative paths.
 * e.g. ["2024/Medical/report.pdf", "2025/Hearing/notice.pdf"]
 */
function listYearBasedCaseFiles(firmRoot, registry, slug) {
    return __awaiter(this, void 0, void 0, function () {
        var entry, allFiles, _loop_2, _i, _a, relSourceFolder;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    entry = registry.clients[slug];
                    if (!entry)
                        return [2 /*return*/, []];
                    allFiles = [];
                    _loop_2 = function (relSourceFolder) {
                        function walkDir(dir, base) {
                            return __awaiter(this, void 0, void 0, function () {
                                var entries, _a, _i, entries_2, entry_1, fullPath, relativePath;
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
                                            _i = 0, entries_2 = entries;
                                            _b.label = 4;
                                        case 4:
                                            if (!(_i < entries_2.length)) return [3 /*break*/, 8];
                                            entry_1 = entries_2[_i];
                                            if (entry_1.name === ".ai_tool" || entry_1.name.startsWith("."))
                                                return [3 /*break*/, 7];
                                            fullPath = (0, path_1.join)(dir, entry_1.name);
                                            relativePath = base ? "".concat(base, "/").concat(entry_1.name) : entry_1.name;
                                            if (!entry_1.isDirectory()) return [3 /*break*/, 6];
                                            return [4 /*yield*/, walkDir(fullPath, relativePath)];
                                        case 5:
                                            _b.sent();
                                            return [3 /*break*/, 7];
                                        case 6:
                                            // Prefix with year: "2024/Medical/report.pdf"
                                            allFiles.push("".concat(yearPrefix, "/").concat(relativePath));
                                            _b.label = 7;
                                        case 7:
                                            _i++;
                                            return [3 /*break*/, 4];
                                        case 8: return [2 /*return*/];
                                    }
                                });
                            });
                        }
                        var absFolder, yearPrefix;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    absFolder = (0, path_1.join)(firmRoot, relSourceFolder);
                                    yearPrefix = relSourceFolder.split("/")[0];
                                    return [4 /*yield*/, walkDir(absFolder, "")];
                                case 1:
                                    _c.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, _a = entry.sourceFolders;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    relSourceFolder = _a[_i];
                    return [5 /*yield**/, _loop_2(relSourceFolder)];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, allFiles];
            }
        });
    });
}
/**
 * Build a file tree for all source folders of a client, grouped by year at top level.
 * Returns the same tree structure as the existing walkDir in files.ts.
 */
function walkYearBasedFiles(firmRoot, registry, slug) {
    return __awaiter(this, void 0, void 0, function () {
        var entry, yearNodes, _loop_3, _i, _a, relSourceFolder;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    entry = registry.clients[slug];
                    if (!entry)
                        return [2 /*return*/, []];
                    yearNodes = [];
                    _loop_3 = function (relSourceFolder) {
                        function walkDir(dir, base) {
                            return __awaiter(this, void 0, void 0, function () {
                                var results, entries, _a, _i, entries_3, dirEntry, fullPath, relativePath, children_1, stats;
                                return __generator(this, function (_b) {
                                    switch (_b.label) {
                                        case 0:
                                            results = [];
                                            _b.label = 1;
                                        case 1:
                                            _b.trys.push([1, 3, , 4]);
                                            return [4 /*yield*/, (0, promises_1.readdir)(dir, { withFileTypes: true })];
                                        case 2:
                                            entries = _b.sent();
                                            return [3 /*break*/, 4];
                                        case 3:
                                            _a = _b.sent();
                                            return [2 /*return*/, results];
                                        case 4:
                                            _i = 0, entries_3 = entries;
                                            _b.label = 5;
                                        case 5:
                                            if (!(_i < entries_3.length)) return [3 /*break*/, 10];
                                            dirEntry = entries_3[_i];
                                            if (dirEntry.name === ".ai_tool" || dirEntry.name.startsWith("."))
                                                return [3 /*break*/, 9];
                                            // Also skip common system/temp files
                                            if (dirEntry.name === ".DS_Store" ||
                                                dirEntry.name === "Thumbs.db" ||
                                                dirEntry.name.startsWith("._"))
                                                return [3 /*break*/, 9];
                                            fullPath = (0, path_1.join)(dir, dirEntry.name);
                                            relativePath = base
                                                ? "".concat(base, "/").concat(dirEntry.name)
                                                : dirEntry.name;
                                            if (!dirEntry.isDirectory()) return [3 /*break*/, 7];
                                            return [4 /*yield*/, walkDir(fullPath, relativePath)];
                                        case 6:
                                            children_1 = _b.sent();
                                            results.push({
                                                name: dirEntry.name,
                                                type: "folder",
                                                path: "".concat(yearPrefix, "/").concat(relativePath),
                                                children: children_1,
                                            });
                                            return [3 /*break*/, 9];
                                        case 7: return [4 /*yield*/, (0, promises_1.stat)(fullPath)];
                                        case 8:
                                            stats = _b.sent();
                                            results.push({
                                                name: dirEntry.name,
                                                type: "file",
                                                path: "".concat(yearPrefix, "/").concat(relativePath),
                                                size: stats.size,
                                                modified: stats.mtime,
                                            });
                                            _b.label = 9;
                                        case 9:
                                            _i++;
                                            return [3 /*break*/, 5];
                                        case 10: return [2 /*return*/, results];
                                    }
                                });
                            });
                        }
                        var absFolder, yearPrefix, children;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    absFolder = (0, path_1.join)(firmRoot, relSourceFolder);
                                    yearPrefix = relSourceFolder.split("/")[0];
                                    return [4 /*yield*/, walkDir(absFolder, "")];
                                case 1:
                                    children = _c.sent();
                                    yearNodes.push({
                                        name: yearPrefix,
                                        type: "folder",
                                        path: yearPrefix,
                                        children: children,
                                    });
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, _a = entry.sourceFolders;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    relSourceFolder = _a[_i];
                    return [5 /*yield**/, _loop_3(relSourceFolder)];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    // Sort year nodes chronologically
                    yearNodes.sort(function (a, b) { return a.name.localeCompare(b.name); });
                    return [2 /*return*/, yearNodes];
            }
        });
    });
}
