"use strict";
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
var promises_1 = require("fs/promises");
var jszip_1 = require("jszip");
var docxtemplater_1 = require("docxtemplater");
var pizzip_1 = require("pizzip");
function runTest() {
    return __awaiter(this, void 0, void 0, function () {
        var sourceFile, rawBuffer, p, d, replacementMap_1, zipDocx, documentXml, xmlContent, modifiedBuffer, zip, doc, error_1, zip, xml, error_2;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sourceFile = "/Users/lucaswhelan/Downloads/AO STMT and Doc Evidence -2691432-GK.docx";
                    console.log("Reading source file:", sourceFile);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 15, , 16]);
                    return [4 /*yield*/, (0, promises_1.readFile)(sourceFile)];
                case 2:
                    rawBuffer = _b.sent();
                    // Check if it's already corrupted (just in case)
                    console.log("Checking if source file is already corrupted...");
                    try {
                        p = new pizzip_1.default(rawBuffer);
                        d = new docxtemplater_1.default(p, { paragraphLoop: true, linebreaks: true });
                        console.log("Source file is clean (docxtemplater didn't throw).");
                    }
                    catch (e) {
                        console.log("SOURCE FILE IS ALREADY CORRUPTED BEFORE WE EVEN TOUCH IT!");
                        console.error(e.message || e);
                    }
                    replacementMap_1 = {
                        "AO STMT and Doc Evidence -2691432-GK": "{{caseCaption}}",
                        "Peyton Hunton": "{{claimantName}}",
                        "2691432": "{{appealNumber}}",
                        "GK": "{{claimNumber}}",
                        "123456": "{{hearingNumber}}",
                        "Sears": "{{employerName}}",
                        "Smith & Jones": "{{firmName}}",
                        "12/17/2025": "{{hearingOfficerDecisionDate}}",
                        "John Smith": "{{attorneyName1}}",
                        "Jane Doe": "{{attorneyName2}}",
                        "12345": "{{barNumber1}}",
                        "67890": "{{barNumber2}}",
                        "Las Vegas": "{{firmCity}}",
                        "NV": "{{firmState}}",
                        "89101": "{{firmZip}}",
                        "12/01/2025": "{{tpaDenialDate}}"
                    };
                    console.log("Mocking templateDocxWithAI...");
                    return [4 /*yield*/, jszip_1.default.loadAsync(rawBuffer)];
                case 3:
                    zipDocx = _b.sent();
                    documentXml = zipDocx.file("word/document.xml");
                    if (!documentXml)
                        throw new Error("Invalid DOCX");
                    return [4 /*yield*/, documentXml.async("text")];
                case 4:
                    xmlContent = _b.sent();
                    // We use a regex replacer that only touches inner text of <w:t> tags
                    xmlContent = xmlContent.replace(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g, function (match, innerText) {
                        var closeBracketIdx = match.indexOf('>');
                        if (closeBracketIdx === -1)
                            return match;
                        var openingTag = match.substring(0, closeBracketIdx + 1);
                        var newText = match.substring(closeBracketIdx + 1, match.length - 6);
                        var sortedReplacements = Object.entries(replacementMap_1)
                            .filter(function (_a) {
                            var literal = _a[0];
                            return literal && literal.length >= 2;
                        })
                            .sort(function (a, b) { return b[0].length - a[0].length; });
                        if (sortedReplacements.length > 0) {
                            // Build a single Regex with all literals joined by OR (|)
                            // This guarantees a single pass over the string, preventing
                            // the chance of nested/overlapping string replacement bugs.
                            var escapedLiterals = sortedReplacements.map(function (_a) {
                                var literalText = _a[0];
                                var escaped = literalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                                return escaped
                                    .replace(/&/g, "&amp;")
                                    .replace(/</g, "&lt;")
                                    .replace(/>/g, "&gt;");
                            });
                            var masterRegex = new RegExp("(".concat(escapedLiterals.join('|'), ")"), 'g');
                            // Fast map lookup for the replacer
                            var literalToTag_1 = new Map(sortedReplacements.map(function (_a) {
                                var literal = _a[0], tag = _a[1];
                                var xmlEscaped = literal
                                    .replace(/&/g, "&amp;")
                                    .replace(/</g, "&lt;")
                                    .replace(/>/g, "&gt;");
                                return [xmlEscaped, tag];
                            }));
                            newText = newText.replace(masterRegex, function (matchedLiteral) {
                                return literalToTag_1.get(matchedLiteral) || matchedLiteral;
                            });
                        }
                        var blankRegex = /_{4,}/g;
                        newText = newText.replace(blankRegex, "{{blankVariable}}");
                        return "".concat(openingTag).concat(newText, "</w:t>");
                    });
                    zipDocx.file("word/document.xml", xmlContent);
                    return [4 /*yield*/, zipDocx.generateAsync({
                            type: "uint8array",
                            compression: "DEFLATE",
                        })];
                case 5:
                    modifiedBuffer = _b.sent();
                    console.log("Saving modified buffer to test-output.docx...");
                    return [4 /*yield*/, (0, promises_1.writeFile)("test-output.docx", modifiedBuffer)];
                case 6:
                    _b.sent();
                    console.log("Testing docxtemplater on modified buffer...");
                    _b.label = 7;
                case 7:
                    _b.trys.push([7, 8, , 14]);
                    zip = new pizzip_1.default(modifiedBuffer);
                    doc = new docxtemplater_1.default(zip, { paragraphLoop: true, linebreaks: true });
                    console.log("SUCCESS! docxtemplater parsed the modified file perfectly.");
                    return [3 /*break*/, 14];
                case 8:
                    error_1 = _b.sent();
                    console.log("ERROR! docxtemplater failed on modified file.");
                    if (!(error_1.properties && error_1.properties.errors)) return [3 /*break*/, 12];
                    error_1.properties.errors.forEach(function (err) {
                        console.log("Error:", err.message);
                        console.log("Context:", err.properties.context);
                        console.log("Offset:", err.properties.offset);
                        console.log("---");
                    });
                    return [4 /*yield*/, jszip_1.default.loadAsync(modifiedBuffer)];
                case 9:
                    zip = _b.sent();
                    return [4 /*yield*/, ((_a = zip.file("word/document.xml")) === null || _a === void 0 ? void 0 : _a.async("text"))];
                case 10:
                    xml = _b.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)("test-output.xml", xml || "")];
                case 11:
                    _b.sent();
                    console.log("Saved the raw modified XML to test-output.xml for inspection.");
                    return [3 /*break*/, 13];
                case 12:
                    console.error(error_1);
                    _b.label = 13;
                case 13: return [3 /*break*/, 14];
                case 14: return [3 /*break*/, 16];
                case 15:
                    error_2 = _b.sent();
                    console.error("Fatal test error:", error_2);
                    return [3 /*break*/, 16];
                case 16: return [2 /*return*/];
            }
        });
    });
}
runTest();
