"use strict";
/**
 * PDF-to-JPEG conversion using poppler's pdftoppm/pdfinfo.
 *
 * Uses JPEG instead of PNG for 5-10x smaller file sizes on scanned documents,
 * which dramatically reduces memory pressure during vision API calls.
 *
 * Follows the same binary resolution pattern as pdftotext.ts.
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
exports.getPdfPageCount = getPdfPageCount;
exports.pdfToImages = pdfToImages;
var child_process_1 = require("child_process");
var fs_1 = require("fs");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var os_1 = require("os");
var util_1 = require("util");
var pdftotext_1 = require("./pdftotext");
var execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function resolvePdftoppmCommand() {
    return (0, pdftotext_1.resolvePoppler)("pdftoppm");
}
function resolvePdfinfoCommand() {
    return (0, pdftotext_1.resolvePoppler)("pdfinfo");
}
/**
 * Get the page count of a PDF via pdfinfo.
 */
function getPdfPageCount(pdfPath) {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, match;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, execFileAsync(resolvePdfinfoCommand(), [pdfPath], {
                        timeout: 15000,
                        windowsHide: true,
                    })];
                case 1:
                    stdout = (_a.sent()).stdout;
                    match = stdout.match(/Pages:\s+(\d+)/);
                    if (!match) {
                        throw new Error("Could not determine page count for ".concat(pdfPath));
                    }
                    return [2 /*return*/, parseInt(match[1], 10)];
            }
        });
    });
}
/**
 * Convert PDF pages to JPEG images using pdftoppm.
 *
 * @param pdfPath  Absolute path to the PDF
 * @param firstPage  First page to convert (1-based)
 * @param lastPage   Last page to convert (1-based, inclusive)
 * @param dpi        Resolution (default 200)
 * @returns Array of PdfPageImage with base64-encoded JPEG data
 */
function pdfToImages(pdfPath_1, firstPage_1, lastPage_1) {
    return __awaiter(this, arguments, void 0, function (pdfPath, firstPage, lastPage, dpi) {
        var prefix, images, page, candidates, found, _i, candidates_1, candidate, buf, b64, size, err_1, page, _a, _b, suffix;
        if (dpi === void 0) { dpi = 200; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    prefix = (0, path_1.join)((0, os_1.tmpdir)(), "groq-pi-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 8)));
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 11, , 18]);
                    return [4 /*yield*/, execFileAsync(resolvePdftoppmCommand(), [
                            "-jpeg",
                            "-r", String(dpi),
                            "-f", String(firstPage),
                            "-l", String(lastPage),
                            pdfPath,
                            prefix,
                        ], {
                            timeout: 60000,
                            maxBuffer: 5 * 1024 * 1024,
                            windowsHide: true,
                        })];
                case 2:
                    _c.sent();
                    images = [];
                    page = firstPage;
                    _c.label = 3;
                case 3:
                    if (!(page <= lastPage)) return [3 /*break*/, 10];
                    candidates = [
                        "".concat(prefix, "-").concat(page, ".jpg"),
                        "".concat(prefix, "-").concat(String(page).padStart(2, "0"), ".jpg"),
                        "".concat(prefix, "-").concat(String(page).padStart(3, "0"), ".jpg"),
                    ];
                    found = false;
                    _i = 0, candidates_1 = candidates;
                    _c.label = 4;
                case 4:
                    if (!(_i < candidates_1.length)) return [3 /*break*/, 8];
                    candidate = candidates_1[_i];
                    if (!(0, fs_1.existsSync)(candidate)) return [3 /*break*/, 7];
                    return [4 /*yield*/, (0, promises_1.readFile)(candidate)];
                case 5:
                    buf = _c.sent();
                    b64 = buf.toString("base64");
                    size = buf.length;
                    buf = null; // Release raw JPEG buffer immediately
                    images.push({ page: page, base64: b64, sizeBytes: size });
                    // Clean up temp file
                    return [4 /*yield*/, (0, promises_1.unlink)(candidate).catch(function () { })];
                case 6:
                    // Clean up temp file
                    _c.sent();
                    found = true;
                    return [3 /*break*/, 8];
                case 7:
                    _i++;
                    return [3 /*break*/, 4];
                case 8:
                    if (!found) {
                        console.warn("[pdftoppm] Missing output for page ".concat(page, " of ").concat(pdfPath));
                    }
                    _c.label = 9;
                case 9:
                    page++;
                    return [3 /*break*/, 3];
                case 10: return [2 /*return*/, images];
                case 11:
                    err_1 = _c.sent();
                    page = firstPage;
                    _c.label = 12;
                case 12:
                    if (!(page <= lastPage)) return [3 /*break*/, 17];
                    _a = 0, _b = [
                        "".concat(page, ".jpg"),
                        "".concat(String(page).padStart(2, "0"), ".jpg"),
                        "".concat(String(page).padStart(3, "0"), ".jpg"),
                    ];
                    _c.label = 13;
                case 13:
                    if (!(_a < _b.length)) return [3 /*break*/, 16];
                    suffix = _b[_a];
                    return [4 /*yield*/, (0, promises_1.unlink)("".concat(prefix, "-").concat(suffix)).catch(function () { })];
                case 14:
                    _c.sent();
                    _c.label = 15;
                case 15:
                    _a++;
                    return [3 /*break*/, 13];
                case 16:
                    page++;
                    return [3 /*break*/, 12];
                case 17: throw err_1;
                case 18: return [2 /*return*/];
            }
        });
    });
}
