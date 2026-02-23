"use strict";
/**
 * Meta-index: two-tier index system for efficient LLM context.
 *
 * - meta_index.json: deduped facts + filenames per folder (fits in prompt)
 * - indexes/{FolderName}.json: full per-folder detail (on-demand via read_file)
 *
 * Both are derived views regenerated from document_index.json on every save.
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
exports.generateMetaIndex = generateMetaIndex;
exports.splitIndexToFolders = splitIndexToFolders;
exports.writeIndexDerivedFiles = writeIndexDerivedFiles;
exports.buildMetaIndexPromptView = buildMetaIndexPromptView;
var promises_1 = require("fs/promises");
var path_1 = require("path");
// Fields to skip when merging extracted_data into folder facts
var SKIP_FIELDS = new Set([
    "type",
    "has_handwritten_data",
    "handwritten_fields",
    "document_date",
    "document_date_confidence",
    "document_date_reason",
]);
// ── generateMetaIndex ──────────────────────────────────────────────────────
function generateMetaIndex(indexData) {
    var folders = {};
    var rawFolders = (indexData === null || indexData === void 0 ? void 0 : indexData.folders) || {};
    var totalDocs = 0;
    for (var _i = 0, _a = Object.entries(rawFolders); _i < _a.length; _i++) {
        var _b = _a[_i], folderName = _b[0], folderData = _b[1];
        var files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
        if (!Array.isArray(files))
            continue;
        var filenames = [];
        var typesSet = new Set();
        var dates = [];
        var mergedFacts = {};
        for (var _c = 0, files_1 = files; _c < files_1.length; _c++) {
            var file = files_1[_c];
            // Collect filename
            if (file === null || file === void 0 ? void 0 : file.filename)
                filenames.push(file.filename);
            // Collect type
            if (typeof (file === null || file === void 0 ? void 0 : file.type) === "string")
                typesSet.add(file.type);
            // Collect date
            if (typeof (file === null || file === void 0 ? void 0 : file.date) === "string" && file.date)
                dates.push(file.date);
            // Merge extracted_data: keep richest (longest) value for each key
            if ((file === null || file === void 0 ? void 0 : file.extracted_data) && typeof file.extracted_data === "object") {
                mergeExtractedData(mergedFacts, file.extracted_data);
            }
        }
        // Compute date range
        var sortedDates = dates.filter(Boolean).sort();
        var dateRange = {};
        if (sortedDates.length > 0) {
            dateRange.earliest = sortedDates[0];
            dateRange.latest = sortedDates[sortedDates.length - 1];
        }
        // Sanitize folder name for index_file path
        var indexFile = ".ai_tool/indexes/".concat(folderName, ".json");
        folders[folderName] = {
            file_count: files.length,
            types: Array.from(typesSet),
            date_range: dateRange,
            filenames: filenames,
            facts: mergedFacts,
            index_file: indexFile,
        };
        totalDocs += files.length;
    }
    var meta = {
        indexed_at: (indexData === null || indexData === void 0 ? void 0 : indexData.indexed_at) || new Date().toISOString(),
        case_name: indexData === null || indexData === void 0 ? void 0 : indexData.case_name,
        case_phase: indexData === null || indexData === void 0 ? void 0 : indexData.case_phase,
        summary: (indexData === null || indexData === void 0 ? void 0 : indexData.summary) || {},
        folder_count: Object.keys(folders).length,
        document_count: totalDocs,
        folders: folders,
    };
    if (Array.isArray(indexData === null || indexData === void 0 ? void 0 : indexData.needs_review) && indexData.needs_review.length > 0) {
        meta.needs_review = indexData.needs_review;
    }
    if (Array.isArray(indexData === null || indexData === void 0 ? void 0 : indexData.issues_found) && indexData.issues_found.length > 0) {
        meta.issues_found = indexData.issues_found;
    }
    if (Array.isArray(indexData === null || indexData === void 0 ? void 0 : indexData.open_hearings) && indexData.open_hearings.length > 0) {
        meta.open_hearings = indexData.open_hearings;
    }
    return meta;
}
/**
 * Recursively merge extracted_data into target, keeping richest value per key.
 */
function mergeExtractedData(target, source, prefix) {
    if (prefix === void 0) { prefix = ""; }
    for (var _i = 0, _a = Object.entries(source); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        if (SKIP_FIELDS.has(key))
            continue;
        var fullKey = prefix ? "".concat(prefix, ".").concat(key) : key;
        if (value === null || value === undefined)
            continue;
        if (typeof value === "object" && !Array.isArray(value)) {
            // Recurse into nested objects
            mergeExtractedData(target, value, fullKey);
            continue;
        }
        // Compare richness: longer string wins, arrays with more items win
        var existing = target[fullKey];
        if (existing === undefined) {
            target[fullKey] = value;
        }
        else {
            var newLen = stringLength(value);
            var existingLen = stringLength(existing);
            if (newLen > existingLen) {
                target[fullKey] = value;
            }
        }
    }
}
function stringLength(val) {
    if (typeof val === "string")
        return val.length;
    if (Array.isArray(val))
        return JSON.stringify(val).length;
    return String(val).length;
}
// ── splitIndexToFolders ────────────────────────────────────────────────────
function splitIndexToFolders(indexData, caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var rawFolders, indexesDir, _i, _a, _b, folderName, folderData, files, folderIndex, outPath;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    rawFolders = (indexData === null || indexData === void 0 ? void 0 : indexData.folders) || {};
                    indexesDir = (0, path_1.join)(caseFolder, ".ai_tool", "indexes");
                    // Ensure base indexes directory exists
                    return [4 /*yield*/, (0, promises_1.mkdir)(indexesDir, { recursive: true })];
                case 1:
                    // Ensure base indexes directory exists
                    _c.sent();
                    _i = 0, _a = Object.entries(rawFolders);
                    _c.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    _b = _a[_i], folderName = _b[0], folderData = _b[1];
                    files = Array.isArray(folderData) ? folderData : folderData === null || folderData === void 0 ? void 0 : folderData.files;
                    if (!Array.isArray(files))
                        return [3 /*break*/, 5];
                    folderIndex = {
                        folder: folderName,
                        file_count: files.length,
                        files: files.map(function (file) { return ({
                            filename: file.filename,
                            type: file.type,
                            key_info: file.key_info,
                            date: file.date,
                            extracted_data: file.extracted_data,
                            issues: file.issues,
                            doc_id: file.doc_id,
                        }); }),
                    };
                    outPath = (0, path_1.join)(indexesDir, "".concat(folderName, ".json"));
                    return [4 /*yield*/, (0, promises_1.mkdir)((0, path_1.join)(outPath, ".."), { recursive: true })];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)(outPath, JSON.stringify(folderIndex, null, 2))];
                case 4:
                    _c.sent();
                    _c.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 2];
                case 6: return [2 /*return*/];
            }
        });
    });
}
// ── writeIndexDerivedFiles ──────────────────────────────────────────────────
/**
 * Regenerate all derived views from the canonical document_index.json.
 * Call this after any write to document_index.json so that
 * per-folder indexes and meta_index stay in sync.
 */
function writeIndexDerivedFiles(caseFolder, index) {
    return __awaiter(this, void 0, void 0, function () {
        var piToolDir, metaIndex;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    piToolDir = (0, path_1.join)(caseFolder, ".ai_tool");
                    // Meta-index + per-folder files
                    return [4 /*yield*/, splitIndexToFolders(index, caseFolder)];
                case 1:
                    // Meta-index + per-folder files
                    _a.sent();
                    metaIndex = generateMetaIndex(index);
                    return [4 /*yield*/, (0, promises_1.writeFile)((0, path_1.join)(piToolDir, "meta_index.json"), JSON.stringify(metaIndex, null, 2))];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ── buildMetaIndexPromptView ───────────────────────────────────────────────
function buildMetaIndexPromptView(metaIndex, maxChars) {
    var _a;
    if (maxChars === void 0) { maxChars = 200000; }
    var parts = [];
    // Header
    var caseName = metaIndex.case_name || "Unknown Case";
    var phase = metaIndex.case_phase || "Unknown";
    parts.push("## CASE INDEX \u2014 ".concat(caseName), "Phase: ".concat(phase, " | ").concat(metaIndex.folder_count, " folders, ").concat(metaIndex.document_count, " documents"), "");
    // Case summary
    if (metaIndex.summary && Object.keys(metaIndex.summary).length > 0) {
        parts.push("### Case Summary");
        renderFlatFacts(parts, metaIndex.summary);
        parts.push("");
    }
    // Open hearings
    if (metaIndex.open_hearings && metaIndex.open_hearings.length > 0) {
        parts.push("### Open Hearings");
        for (var _i = 0, _b = metaIndex.open_hearings; _i < _b.length; _i++) {
            var hearing = _b[_i];
            if (typeof hearing === "object" && hearing !== null) {
                var fields = Object.entries(hearing)
                    .map(function (_a) {
                    var k = _a[0], v = _a[1];
                    return "".concat(k, ": ").concat(flattenValue(v));
                })
                    .join(", ");
                parts.push("- ".concat(fields));
            }
            else {
                parts.push("- ".concat(String(hearing)));
            }
        }
        parts.push("");
    }
    // Folders
    var folderEntries = Object.entries(metaIndex.folders);
    for (var _c = 0, folderEntries_1 = folderEntries; _c < folderEntries_1.length; _c++) {
        var _d = folderEntries_1[_c], folderName = _d[0], folder = _d[1];
        var typesStr = folder.types.join(", ");
        var dateStr = formatDateRange(folder.date_range);
        parts.push("### ".concat(folderName, " \u2014 ").concat(folder.file_count, " files"));
        if (typesStr)
            parts.push("Types: ".concat(typesStr));
        if (dateStr)
            parts.push("Dates: ".concat(dateStr));
        parts.push("Files: ".concat(folder.filenames.join(", ")));
        if (Object.keys(folder.facts).length > 0) {
            parts.push("Facts:");
            for (var _e = 0, _f = Object.entries(folder.facts); _e < _f.length; _e++) {
                var _g = _f[_e], key = _g[0], value = _g[1];
                parts.push("  ".concat(key, ": ").concat(flattenValue(value)));
            }
        }
        parts.push("");
    }
    // Needs review / conflicts
    if (metaIndex.needs_review && metaIndex.needs_review.length > 0) {
        parts.push("### Unresolved Conflicts (".concat(metaIndex.needs_review.length, ")"));
        for (var _h = 0, _j = metaIndex.needs_review; _h < _j.length; _h++) {
            var item = _j[_h];
            if (item.field && item.conflicting_values) {
                var values = item.conflicting_values.map(function (v) { return flattenValue(v); }).join(" vs ");
                var valCount = item.conflicting_values.length;
                var srcCount = ((_a = item.sources) === null || _a === void 0 ? void 0 : _a.length) || 0;
                parts.push("- ".concat(item.field, ": ").concat(values, " (").concat(valCount, " values, ").concat(srcCount, " sources)"));
            }
            else if (item.field) {
                parts.push("- ".concat(item.field, ": ").concat(flattenValue(item)));
            }
        }
        parts.push("");
    }
    // Issues
    if (metaIndex.issues_found && metaIndex.issues_found.length > 0) {
        parts.push("### Issues Found (".concat(metaIndex.issues_found.length, ")"));
        for (var _k = 0, _l = metaIndex.issues_found.slice(0, 20); _k < _l.length; _k++) {
            var issue = _l[_k];
            parts.push("- ".concat(flattenValue(issue)));
        }
        if (metaIndex.issues_found.length > 20) {
            parts.push("  ... ".concat(metaIndex.issues_found.length - 20, " more issues"));
        }
        parts.push("");
    }
    // Footer
    parts.push("To read full details for any folder, use: read_file(\".ai_tool/indexes/{FolderName}.json\")");
    var result = parts.join("\n");
    // Truncation if needed
    if (result.length > maxChars) {
        result = truncatePromptView(metaIndex, maxChars);
    }
    return result;
}
/**
 * Progressive truncation: trim facts from largest folders first.
 */
function truncatePromptView(metaIndex, maxChars) {
    var parts = [];
    var caseName = metaIndex.case_name || "Unknown Case";
    var phase = metaIndex.case_phase || "Unknown";
    parts.push("## CASE INDEX \u2014 ".concat(caseName), "Phase: ".concat(phase, " | ").concat(metaIndex.folder_count, " folders, ").concat(metaIndex.document_count, " documents"), "");
    // Summary always included
    if (metaIndex.summary && Object.keys(metaIndex.summary).length > 0) {
        parts.push("### Case Summary");
        renderFlatFacts(parts, metaIndex.summary);
        parts.push("");
    }
    // Sort folders by file_count descending for progressive trimming
    var folderEntries = Object.entries(metaIndex.folders)
        .sort(function (_a, _b) {
        var a = _a[1];
        var b = _b[1];
        return b.file_count - a.file_count;
    });
    // First pass: include all folders with filenames but limit facts
    var MAX_FACTS_PER_FOLDER = 15;
    for (var _i = 0, folderEntries_2 = folderEntries; _i < folderEntries_2.length; _i++) {
        var _a = folderEntries_2[_i], folderName = _a[0], folder = _a[1];
        var typesStr = folder.types.join(", ");
        var dateStr = formatDateRange(folder.date_range);
        parts.push("### ".concat(folderName, " \u2014 ").concat(folder.file_count, " files"));
        if (typesStr)
            parts.push("Types: ".concat(typesStr));
        if (dateStr)
            parts.push("Dates: ".concat(dateStr));
        parts.push("Files: ".concat(folder.filenames.join(", ")));
        var factEntries = Object.entries(folder.facts);
        if (factEntries.length > 0) {
            parts.push("Facts:");
            var shown = factEntries.slice(0, MAX_FACTS_PER_FOLDER);
            for (var _b = 0, shown_1 = shown; _b < shown_1.length; _b++) {
                var _c = shown_1[_b], key = _c[0], value = _c[1];
                parts.push("  ".concat(key, ": ").concat(flattenValue(value)));
            }
            if (factEntries.length > MAX_FACTS_PER_FOLDER) {
                parts.push("  ... ".concat(factEntries.length - MAX_FACTS_PER_FOLDER, " more facts. Use read_file(\"").concat(folder.index_file, "\") for full details."));
            }
        }
        parts.push("");
    }
    // Conflicts
    if (metaIndex.needs_review && metaIndex.needs_review.length > 0) {
        parts.push("### Unresolved Conflicts (".concat(metaIndex.needs_review.length, ")"));
        for (var _d = 0, _e = metaIndex.needs_review.slice(0, 10); _d < _e.length; _d++) {
            var item = _e[_d];
            if (item.field && item.conflicting_values) {
                var values = item.conflicting_values.map(function (v) { return flattenValue(v); }).join(" vs ");
                parts.push("- ".concat(item.field, ": ").concat(values));
            }
        }
        if (metaIndex.needs_review.length > 10) {
            parts.push("  ... ".concat(metaIndex.needs_review.length - 10, " more conflicts"));
        }
        parts.push("");
    }
    parts.push("To read full details for any folder, use: read_file(\".ai_tool/indexes/{FolderName}.json\")");
    var result = parts.join("\n");
    // If still too long, hard truncate
    if (result.length > maxChars) {
        result = result.slice(0, maxChars) +
            "\n...\n[NOTE: Meta-index truncated. Use read_file(\".ai_tool/indexes/{FolderName}.json\") for per-folder details.]";
    }
    return result;
}
// ── Helpers ────────────────────────────────────────────────────────────────
function formatDateRange(range) {
    if (range.earliest && range.latest && range.earliest !== range.latest) {
        return "".concat(range.earliest, " to ").concat(range.latest);
    }
    return range.earliest || range.latest || "";
}
/**
 * Flatten a value to a single-line string for prompt rendering.
 */
function flattenValue(val) {
    if (val === null || val === undefined)
        return "";
    if (typeof val === "string")
        return val;
    if (typeof val === "number" || typeof val === "boolean")
        return String(val);
    if (Array.isArray(val)) {
        return val.map(flattenValue).filter(Boolean).join(", ");
    }
    if (typeof val === "object") {
        // Flatten object to "key: value" pairs on a single line
        var entries = Object.entries(val)
            .map(function (_a) {
            var k = _a[0], v = _a[1];
            var fv = flattenValue(v);
            return fv ? "".concat(k, ": ").concat(fv) : null;
        })
            .filter(Boolean);
        return entries.join("; ");
    }
    return String(val);
}
/**
 * Render a facts object (like summary) as flat Key: Value lines.
 */
function renderFlatFacts(parts, obj, indent) {
    if (indent === void 0) { indent = ""; }
    for (var _i = 0, _a = Object.entries(obj); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        if (value === null || value === undefined)
            continue;
        if (typeof value === "object" && !Array.isArray(value)) {
            // Recurse into nested objects with indent
            parts.push("".concat(indent).concat(key, ":"));
            renderFlatFacts(parts, value, indent + "  ");
        }
        else {
            parts.push("".concat(indent).concat(key, ": ").concat(flattenValue(value)));
        }
    }
}
