"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDocumentPath = normalizeDocumentPath;
exports.buildDocumentIdFromPath = buildDocumentIdFromPath;
exports.buildDocumentId = buildDocumentId;
function normalizeDocumentPath(path) {
    return String(path || "")
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .trim()
        .toLowerCase();
}
function fnv1a32(input) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function buildDocumentIdFromPath(path) {
    var normalized = normalizeDocumentPath(path);
    return "doc_".concat(fnv1a32(normalized));
}
function buildDocumentId(folder, filename) {
    var normalizedFolder = normalizeDocumentPath(folder);
    var normalizedFile = normalizeDocumentPath(filename);
    var canonical = normalizedFolder && normalizedFolder !== "." && normalizedFolder !== "root"
        ? "".concat(normalizedFolder, "/").concat(normalizedFile)
        : normalizedFile;
    return buildDocumentIdFromPath(canonical);
}
