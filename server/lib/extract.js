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
exports.IMAGE_EXTENSIONS = void 0;
exports.isImageFile = isImageFile;
exports.getImageMimeType = getImageMimeType;
exports.extractTextFromPdf = extractTextFromPdf;
exports.extractTextFromDocx = extractTextFromDocx;
exports.extractHtmlFromDocx = extractHtmlFromDocx;
exports.extractTextFromFile = extractTextFromFile;
exports.extractStylesFromDocx = extractStylesFromDocx;
exports.templateDocxWithAI = templateDocxWithAI;
exports.templatePdfWithAI = templatePdfWithAI;
var mammoth_1 = require("mammoth");
var promises_1 = require("fs/promises");
var jszip_1 = require("jszip");
var fast_xml_parser_1 = require("fast-xml-parser");
var pdftotext_1 = require("./pdftotext");
exports.IMAGE_EXTENSIONS = new Set([
    "jpg",
    "jpeg",
    "png",
    "tif",
    "tiff",
    "bmp",
    "gif",
    "webp",
    "heic",
    "heif",
]);
var BINARY_FILE_EXTENSIONS = new Set(__spreadArray(__spreadArray([
    "avi",
    "mp4",
    "mov",
    "m4v",
    "wmv",
    "flv",
    "mkv",
    "webm",
    "mpeg",
    "mpg",
    "m4a",
    "mp3",
    "wav",
    "aac",
    "flac",
    "ogg"
], exports.IMAGE_EXTENSIONS, true), [
    "zip",
    "rar",
    "7z",
    "tar",
    "gz",
    "exe",
    "dll",
    "pkg",
], false));
function isBinaryFileByExtension(ext) {
    return !!ext && BINARY_FILE_EXTENSIONS.has(ext.toLowerCase());
}
function isImageFile(filename) {
    var ext = filename.toLowerCase().split(".").pop();
    return !!ext && exports.IMAGE_EXTENSIONS.has(ext);
}
function getImageMimeType(filename) {
    var ext = filename.toLowerCase().split(".").pop();
    switch (ext) {
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "png":
            return "image/png";
        case "gif":
            return "image/gif";
        case "webp":
            return "image/webp";
        case "tif":
        case "tiff":
            return "image/tiff";
        case "bmp":
            return "image/bmp";
        case "heic":
            return "image/heic";
        case "heif":
            return "image/heif";
        default:
            return "image/jpeg";
    }
}
/**
 * Extract text content from a PDF file using pdftotext (poppler).
 * For scanned/image PDFs, returns empty string to trigger agent fallback
 * (which uses Claude's vision for better accuracy than OCR).
 */
function extractTextFromPdf(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var text, e_1, errorMsg;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, pdftotext_1.extractPdfText)(filePath, {
                            layout: true,
                            timeout: 30000,
                            maxBuffer: 10 * 1024 * 1024,
                        })];
                case 1:
                    text = _a.sent();
                    if (text.length > 50) {
                        return [2 /*return*/, text];
                    }
                    // Text too short - likely a scanned PDF, return empty to trigger agent fallback
                    console.log("[Extract] pdftotext returned only ".concat(text.length, " chars, deferring to agent"));
                    return [2 /*return*/, ''];
                case 2:
                    e_1 = _a.sent();
                    errorMsg = e_1 instanceof Error ? e_1.message : String(e_1);
                    console.log("[Extract] pdftotext failed for ".concat(filePath, ": ").concat(errorMsg.slice(0, 100)));
                    return [2 /*return*/, ''];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract text content from a DOCX file.
 * Returns the extracted text as markdown-formatted string.
 */
function extractTextFromDocx(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dataBuffer, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, promises_1.readFile)(filePath)];
                case 1:
                    dataBuffer = _a.sent();
                    return [4 /*yield*/, mammoth_1.default.extractRawText({ buffer: dataBuffer })];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, result.value];
            }
        });
    });
}
/**
 * Extract rendered HTML and embedded CSS from a DOCX file.
 */
function extractHtmlFromDocx(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dataBuffer, result, html, cssFragments;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, promises_1.readFile)(filePath)];
                case 1:
                    dataBuffer = _a.sent();
                    return [4 /*yield*/, mammoth_1.default.convertToHtml({ buffer: dataBuffer }, {
                            convertImage: mammoth_1.default.images.inline(function (image) { return __awaiter(_this, void 0, void 0, function () {
                                var base64;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, image.read("base64")];
                                        case 1:
                                            base64 = _a.sent();
                                            return [2 /*return*/, {
                                                    src: "data:".concat(image.contentType, ";base64,").concat(base64),
                                                }];
                                    }
                                });
                            }); }),
                        })];
                case 2:
                    result = _a.sent();
                    html = result.value || "";
                    cssFragments = [];
                    // Pull style blocks into a separate stylesheet while keeping body html clean.
                    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, function (match) {
                        var style = match.replace(/^<style[^>]*>/i, "").replace(/<\/style>$/i, "").trim();
                        if (style)
                            cssFragments.push(style);
                        return "";
                    });
                    return [2 /*return*/, {
                            html: html.trim(),
                            css: cssFragments.join("\n\n"),
                        }];
            }
        });
    });
}
/**
 * Extract text from a file based on its extension.
 * Supports PDF, DOCX, and plain text formats.
 */
function extractTextFromFile(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var ext, _a, content, nonPrintable, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    ext = filePath.toLowerCase().split(".").pop();
                    if (isBinaryFileByExtension(ext)) {
                        return [2 /*return*/, "[Binary file: ".concat(ext, "]")];
                    }
                    _a = ext;
                    switch (_a) {
                        case "pdf": return [3 /*break*/, 1];
                        case "docx": return [3 /*break*/, 2];
                        case "txt": return [3 /*break*/, 3];
                        case "md": return [3 /*break*/, 3];
                        case "json": return [3 /*break*/, 3];
                        case "csv": return [3 /*break*/, 3];
                    }
                    return [3 /*break*/, 4];
                case 1: return [2 /*return*/, extractTextFromPdf(filePath)];
                case 2: return [2 /*return*/, extractTextFromDocx(filePath)];
                case 3: 
                // Plain text files - read directly
                return [2 /*return*/, (0, promises_1.readFile)(filePath, "utf-8")];
                case 4:
                    _c.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
                case 5:
                    content = _c.sent();
                    nonPrintable = content.split('').filter(function (c) {
                        var code = c.charCodeAt(0);
                        return code < 32 && code !== 9 && code !== 10 && code !== 13;
                    }).length;
                    if (nonPrintable / content.length > 0.1) {
                        return [2 /*return*/, "[Binary file: ".concat(ext, "]")];
                    }
                    return [2 /*return*/, content];
                case 6:
                    _b = _c.sent();
                    return [2 /*return*/, "[Could not read file: ".concat(ext, "]")];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract style information from a DOCX file by parsing its internal XML.
 * Returns font, color, and margin settings.
 */
function extractStylesFromDocx(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dataBuffer, zip, parser, styles, documentXml, content, parsed, body, sectPr, pgMar, _a, stylesXml, content, parsed, stylesList, _i, stylesList_1, style, styleId, styleType, isDefault, rPr, font, sizeVal, size, colorVal, color, bold, pPr, spacingVal, lineHeight, docDefaults, rPrDefault, defaultFont, defaultSizeVal, _b, headerXml, content, parsed, findImageRefs_1, imageRefs, relsXml, relsContent, relsParsed, relationships, relsList, _c, relsList_1, rel, imagePath, imageFile, imageData, ext, mimeType, _d;
        var _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        return __generator(this, function (_u) {
            switch (_u.label) {
                case 0: return [4 /*yield*/, (0, promises_1.readFile)(filePath)];
                case 1:
                    dataBuffer = _u.sent();
                    return [4 /*yield*/, jszip_1.default.loadAsync(dataBuffer)];
                case 2:
                    zip = _u.sent();
                    parser = new fast_xml_parser_1.XMLParser({
                        ignoreAttributes: false,
                        attributeNamePrefix: "@_",
                    });
                    styles = {
                        defaultFont: "Times New Roman",
                        defaultFontSize: 12,
                        pageMargins: {
                            top: 1,
                            right: 1,
                            bottom: 1,
                            left: 1,
                        },
                    };
                    documentXml = zip.file("word/document.xml");
                    if (!documentXml) return [3 /*break*/, 6];
                    _u.label = 3;
                case 3:
                    _u.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, documentXml.async("text")];
                case 4:
                    content = _u.sent();
                    parsed = parser.parse(content);
                    body = (_e = parsed === null || parsed === void 0 ? void 0 : parsed["w:document"]) === null || _e === void 0 ? void 0 : _e["w:body"];
                    if (body) {
                        sectPr = body["w:sectPr"];
                        if (sectPr) {
                            pgMar = sectPr["w:pgMar"];
                            if (pgMar) {
                                // DOCX uses twips (1/1440 inch)
                                styles.pageMargins = {
                                    top: twipsToInches(pgMar["@_w:top"]),
                                    right: twipsToInches(pgMar["@_w:right"]),
                                    bottom: twipsToInches(pgMar["@_w:bottom"]),
                                    left: twipsToInches(pgMar["@_w:left"]),
                                };
                            }
                        }
                    }
                    return [3 /*break*/, 6];
                case 5:
                    _a = _u.sent();
                    return [3 /*break*/, 6];
                case 6:
                    stylesXml = zip.file("word/styles.xml");
                    if (!stylesXml) return [3 /*break*/, 10];
                    _u.label = 7;
                case 7:
                    _u.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, stylesXml.async("text")];
                case 8:
                    content = _u.sent();
                    parsed = parser.parse(content);
                    stylesList = (_f = parsed === null || parsed === void 0 ? void 0 : parsed["w:styles"]) === null || _f === void 0 ? void 0 : _f["w:style"];
                    if (Array.isArray(stylesList)) {
                        for (_i = 0, stylesList_1 = stylesList; _i < stylesList_1.length; _i++) {
                            style = stylesList_1[_i];
                            styleId = style["@_w:styleId"];
                            styleType = style["@_w:type"];
                            isDefault = style["@_w:default"] === "1";
                            rPr = style["w:rPr"];
                            font = ((_g = rPr === null || rPr === void 0 ? void 0 : rPr["w:rFonts"]) === null || _g === void 0 ? void 0 : _g["@_w:ascii"]) || ((_h = rPr === null || rPr === void 0 ? void 0 : rPr["w:rFonts"]) === null || _h === void 0 ? void 0 : _h["@_w:hAnsi"]);
                            sizeVal = (_j = rPr === null || rPr === void 0 ? void 0 : rPr["w:sz"]) === null || _j === void 0 ? void 0 : _j["@_w:val"];
                            size = sizeVal ? parseInt(sizeVal, 10) / 2 : undefined;
                            colorVal = (_k = rPr === null || rPr === void 0 ? void 0 : rPr["w:color"]) === null || _k === void 0 ? void 0 : _k["@_w:val"];
                            color = colorVal && colorVal !== "auto" ? "#".concat(colorVal) : undefined;
                            bold = (rPr === null || rPr === void 0 ? void 0 : rPr["w:b"]) !== undefined || ((_l = rPr === null || rPr === void 0 ? void 0 : rPr["w:b"]) === null || _l === void 0 ? void 0 : _l["@_w:val"]) === "1";
                            pPr = style["w:pPr"];
                            spacingVal = (_m = pPr === null || pPr === void 0 ? void 0 : pPr["w:spacing"]) === null || _m === void 0 ? void 0 : _m["@_w:line"];
                            lineHeight = spacingVal ? parseInt(spacingVal, 10) / 240 : undefined;
                            // Apply to appropriate style category
                            if (isDefault && styleType === "paragraph") {
                                // Default paragraph style
                                if (font)
                                    styles.defaultFont = font;
                                if (size)
                                    styles.defaultFontSize = size;
                                styles.bodyText = { font: font, size: size, lineHeight: lineHeight };
                            }
                            else if (styleId === "Heading1" || (styleId === null || styleId === void 0 ? void 0 : styleId.toLowerCase()) === "heading1") {
                                styles.heading1 = { font: font, size: size, bold: bold, color: color };
                            }
                            else if (styleId === "Heading2" || (styleId === null || styleId === void 0 ? void 0 : styleId.toLowerCase()) === "heading2") {
                                styles.heading2 = { font: font, size: size, bold: bold, color: color };
                            }
                            else if (styleId === "Heading3" || (styleId === null || styleId === void 0 ? void 0 : styleId.toLowerCase()) === "heading3") {
                                styles.heading3 = { font: font, size: size, bold: bold, color: color };
                            }
                            else if (styleId === "Normal" || (styleId === null || styleId === void 0 ? void 0 : styleId.toLowerCase()) === "normal") {
                                // Normal/Body style
                                if (font)
                                    styles.defaultFont = font;
                                if (size)
                                    styles.defaultFontSize = size;
                                styles.bodyText = { font: font || styles.defaultFont, size: size || styles.defaultFontSize, lineHeight: lineHeight };
                            }
                            // Extract primary color from heading1 if available
                            if ((styleId === "Heading1" || (styleId === null || styleId === void 0 ? void 0 : styleId.toLowerCase()) === "heading1") && color) {
                                styles.primaryColor = color;
                            }
                        }
                    }
                    docDefaults = (_o = parsed === null || parsed === void 0 ? void 0 : parsed["w:styles"]) === null || _o === void 0 ? void 0 : _o["w:docDefaults"];
                    if (docDefaults) {
                        rPrDefault = (_p = docDefaults["w:rPrDefault"]) === null || _p === void 0 ? void 0 : _p["w:rPr"];
                        if (rPrDefault) {
                            defaultFont = (_q = rPrDefault["w:rFonts"]) === null || _q === void 0 ? void 0 : _q["@_w:ascii"];
                            defaultSizeVal = (_r = rPrDefault["w:sz"]) === null || _r === void 0 ? void 0 : _r["@_w:val"];
                            if (defaultFont)
                                styles.defaultFont = defaultFont;
                            if (defaultSizeVal)
                                styles.defaultFontSize = parseInt(defaultSizeVal, 10) / 2;
                        }
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _b = _u.sent();
                    return [3 /*break*/, 10];
                case 10:
                    headerXml = zip.file("word/header1.xml");
                    if (!headerXml) return [3 /*break*/, 19];
                    _u.label = 11;
                case 11:
                    _u.trys.push([11, 18, , 19]);
                    return [4 /*yield*/, headerXml.async("text")];
                case 12:
                    content = _u.sent();
                    parsed = parser.parse(content);
                    findImageRefs_1 = function (obj) {
                        var refs = [];
                        if (!obj)
                            return refs;
                        if (typeof obj === "object") {
                            if (obj["@_r:embed"])
                                refs.push(obj["@_r:embed"]);
                            for (var _i = 0, _a = Object.keys(obj); _i < _a.length; _i++) {
                                var key = _a[_i];
                                refs.push.apply(refs, findImageRefs_1(obj[key]));
                            }
                        }
                        else if (Array.isArray(obj)) {
                            for (var _b = 0, obj_1 = obj; _b < obj_1.length; _b++) {
                                var item = obj_1[_b];
                                refs.push.apply(refs, findImageRefs_1(item));
                            }
                        }
                        return refs;
                    };
                    imageRefs = findImageRefs_1(parsed);
                    if (!(imageRefs.length > 0)) return [3 /*break*/, 17];
                    relsXml = zip.file("word/_rels/header1.xml.rels");
                    if (!relsXml) return [3 /*break*/, 17];
                    return [4 /*yield*/, relsXml.async("text")];
                case 13:
                    relsContent = _u.sent();
                    relsParsed = parser.parse(relsContent);
                    relationships = (_s = relsParsed === null || relsParsed === void 0 ? void 0 : relsParsed.Relationships) === null || _s === void 0 ? void 0 : _s.Relationship;
                    relsList = Array.isArray(relationships) ? relationships : [relationships].filter(Boolean);
                    _c = 0, relsList_1 = relsList;
                    _u.label = 14;
                case 14:
                    if (!(_c < relsList_1.length)) return [3 /*break*/, 17];
                    rel = relsList_1[_c];
                    if (!(imageRefs.includes(rel["@_Id"]) && rel["@_Target"])) return [3 /*break*/, 16];
                    imagePath = rel["@_Target"].replace("../", "word/");
                    imageFile = zip.file(imagePath);
                    if (!imageFile) return [3 /*break*/, 16];
                    return [4 /*yield*/, imageFile.async("base64")];
                case 15:
                    imageData = _u.sent();
                    ext = (_t = imagePath.split(".").pop()) === null || _t === void 0 ? void 0 : _t.toLowerCase();
                    mimeType = ext === "png" ? "image/png" : "image/jpeg";
                    styles.letterheadImage = "data:".concat(mimeType, ";base64,").concat(imageData);
                    return [3 /*break*/, 17]; // Only take first image
                case 16:
                    _c++;
                    return [3 /*break*/, 14];
                case 17: return [3 /*break*/, 19];
                case 18:
                    _d = _u.sent();
                    return [3 /*break*/, 19];
                case 19: return [2 /*return*/, styles];
            }
        });
    });
}
/**
 * Convert DOCX twips to inches (1440 twips = 1 inch)
 */
function twipsToInches(twips) {
    if (!twips)
        return 1; // default to 1 inch
    var val = parseInt(twips, 10);
    if (isNaN(val))
        return 1;
    return Math.round((val / 1440) * 100) / 100; // Round to 2 decimal places
}
/**
 * Uses AI to map literal text placeholders in a DOCX file to {{docxtemplater}} variables,
 * then directly modifies the document.xml inside the DOCX to inject these variables.
 * Returns the modified DOCX bytes.
 */
function templateDocxWithAI(filePath, templateName, rawText) {
    return __awaiter(this, void 0, void 0, function () {
        var getClient, prompt, response, textBlock, jsonText, replacementMap, dataBuffer, zip, documentXml, xmlContent, modifiedBuffer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("./doc-agent"); })];
                case 1:
                    getClient = (_a.sent()).getClient;
                    prompt = "You are a template processor. I am going to give you the raw extracted text from a legal document template file. Your job is to identify the literal placeholder text in the document (such as \"John Doe\", \"123-456\", blanks like \"______\", or bracketed text like \"[CLIENT NAME]\") and map them to standard generic variable names.\n\nTEMPLATE NAME: ".concat(templateName, "\n\nRAW EXTRACTED TEXT:\n").concat(rawText, "\n\n---\n\nIdentify all case-specific information or blanks. Output a JSON object where the keys are the EXACT literal strings as they appear in the raw text, and the values are the variable placeholder they should be replaced with (must be wrapped in double brackets, e.g., \"{{claimantName}}\").\n\nStandard variable names to use:\n- {{claimantName}}\n- {{claimNumber}}\n- {{hearingNumber}}\n- {{hearingDateTime}}\n- {{firmName}}\n- {{appearance}}\n\nIf you see dates like \"January 1, 2024\", map the whole date string to \"{{currentDate}}\" or something similar.\n\nRespond with ONLY valid JSON. Keep the keys AS EXACT AS POSSIBLE to the source text.");
                    return [4 /*yield*/, getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 4000,
                            messages: [{ role: "user", content: prompt }],
                        })];
                case 2:
                    response = _a.sent();
                    textBlock = response.content.find(function (block) { return block.type === "text"; });
                    if (!textBlock || textBlock.type !== "text") {
                        throw new Error("AI analysis returned no text content for DOCX templating");
                    }
                    jsonText = textBlock.text
                        .replace(/^```(?:json)?\s*/m, "")
                        .replace(/\s*```$/m, "")
                        .trim();
                    try {
                        replacementMap = JSON.parse(jsonText);
                    }
                    catch (_b) {
                        throw new Error("Failed to parse DOCX templating analysis as JSON");
                    }
                    return [4 /*yield*/, (0, promises_1.readFile)(filePath)];
                case 3:
                    dataBuffer = _a.sent();
                    return [4 /*yield*/, jszip_1.default.loadAsync(dataBuffer)];
                case 4:
                    zip = _a.sent();
                    documentXml = zip.file("word/document.xml");
                    if (!documentXml) {
                        throw new Error("Invalid DOCX: missing word/document.xml");
                    }
                    return [4 /*yield*/, documentXml.async("text")];
                case 5:
                    xmlContent = _a.sent();
                    // We use a regex replacer that only touches inner text of <w:t> tags
                    // We use `(?:\\s+[^>]*)?` to ensure we don't accidentally match <w:tbl> or <w:txbxContent>
                    xmlContent = xmlContent.replace(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g, function (match, innerText) {
                        // The previous regex had two capturing groups: attributes and innerText.
                        // Wait, regex: `/<w:t(?:\\s+([^>]*))?>([\\s\\S]*?)<\\/w:t>/g`
                        // Let's use string manipulation to extract the attributes to be 100% safe.
                        var closeBracketIdx = match.indexOf('>');
                        if (closeBracketIdx === -1)
                            return match; // malformed tag
                        var openingTag = match.substring(0, closeBracketIdx + 1);
                        var newText = match.substring(closeBracketIdx + 1, match.length - 6); // remove </w:t>
                        // Use a two-pass approach with temporary tokens to prevent replacing text
                        // *inside* already injected tags (e.g. replacing 'Date' inside '{{hearingDate}}').
                        var tokenMap = new Map();
                        // Sort literals by length descending so longer strings are replaced before substrings
                        var sortedReplacements = Object.entries(replacementMap)
                            .filter(function (_a) {
                            var literal = _a[0];
                            return literal && literal.length >= 2;
                        })
                            .sort(function (a, b) { return b[0].length - a[0].length; });
                        for (var _i = 0, sortedReplacements_1 = sortedReplacements; _i < sortedReplacements_1.length; _i++) {
                            var _a = sortedReplacements_1[_i], literalText = _a[0], variableTag = _a[1];
                            // Escape special characters in the literal text to build a safe regex
                            var escapedLiteral = literalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                            // We must account for the fact that innerText might be XML-escaped (e.g. &amp;)
                            // but Haiku gives us plain text. For simplicity, we assume literal strings 
                            // without complex XML entities, but we allow simple replacements.
                            // E.g., if Haiku found "Smith & Jones", in XML it is "Smith &amp; Jones".
                            var xmlEscapedLiteral = escapedLiteral
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;");
                            var regex = new RegExp(xmlEscapedLiteral, "g");
                            var tempToken = "__TMP_".concat(Math.random().toString(36).substring(2, 12), "__");
                            var replacedText = newText.replace(regex, tempToken);
                            if (replacedText !== newText) {
                                tokenMap.set(tempToken, variableTag);
                                newText = replacedText;
                            }
                        }
                        // Handle standard Word blanks (e.g. ________)
                        var blankRegex = /_{4,}/g;
                        var blankToken = "__TMP_".concat(Math.random().toString(36).substring(2, 12), "__");
                        var replacedBlank = newText.replace(blankRegex, blankToken);
                        if (replacedBlank !== newText) {
                            tokenMap.set(blankToken, "{{blankVariable}}");
                            newText = replacedBlank;
                        }
                        // Second pass: Restore all the actual docxtemplater tags
                        for (var _b = 0, _c = tokenMap.entries(); _b < _c.length; _b++) {
                            var _d = _c[_b], tempToken = _d[0], variableTag = _d[1];
                            newText = newText.replace(new RegExp(tempToken, "g"), variableTag);
                        }
                        return "".concat(openingTag).concat(newText, "</w:t>");
                    });
                    zip.file("word/document.xml", xmlContent);
                    return [4 /*yield*/, zip.generateAsync({
                            type: "uint8array",
                            compression: "DEFLATE",
                        })];
                case 6:
                    modifiedBuffer = _a.sent();
                    return [2 /*return*/, modifiedBuffer];
            }
        });
    });
}
/**
 * Returns a JSON object containing the X/Y coordinates for variables that need
 * to be written over the original PDF template. Uses `pdftotext -bbox-layout` and Haiku.
 */
function templatePdfWithAI(filePath, templateName) {
    return __awaiter(this, void 0, void 0, function () {
        var getClient, runPdftotext, bboxHtml, prompt, response, textBlock, jsonText;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("./doc-agent"); })];
                case 1:
                    getClient = (_a.sent()).getClient;
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("./pdftotext"); })];
                case 2:
                    runPdftotext = (_a.sent()).runPdftotext;
                    return [4 /*yield*/, runPdftotext(["-bbox-layout", filePath, "-"])];
                case 3:
                    bboxHtml = _a.sent();
                    prompt = "You are a legal document template processor analyzing the structural bounding box output from `pdftotext`.\nYour job is to identify literal placeholder text (e.g., \"John Doe\", \"123-456\", blanks like \"______\", bracketed text like \"[CLIENT NAME]\", or the date field) and map them to their exact coordinates on the page.\n\nTEMPLATE NAME: ".concat(templateName, "\n\nBBOX HTML LAYOUT:\n<limited representation - do your best>\n").concat(bboxHtml.substring(0, 30000), "\n<EOF>\n\n---\n\nAnalyze the HTML structure. Look for <word> elements or <line> elements that contain the placeholder blanks or text. \n\nIdentify all case-specific information or blanks. Output a JSON object where the keys are the standard generic variables below, and the value is a coordinate object:\nStandard variable names to use:\n- claimantName\n- claimNumber\n- hearingNumber\n- hearingDateTime\n- firmName\n- appearance\n- currentDate\n\nOutput JSON Schema:\n{\n  \"variableName\": {\n    \"page\": 1, // 1-indexed based on <page> tags\n    \"x\": 12.34,\n    \"y\": 56.78,\n    \"width\": 100.0,\n    \"height\": 12.0\n  }\n}\n\nRespond ONLY with valid JSON. Extract the xMin, yMin from the matching tags. Map them to x, y, and calculate width and height from xMax-xMin and yMax-yMin.");
                    return [4 /*yield*/, getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 4000,
                            messages: [{ role: "user", content: prompt }],
                        })];
                case 4:
                    response = _a.sent();
                    textBlock = response.content.find(function (block) { return block.type === "text"; });
                    if (!textBlock || textBlock.type !== "text") {
                        throw new Error("AI analysis returned no text content for PDF BBox mapping");
                    }
                    jsonText = textBlock.text
                        .replace(/^```(?:json)?\s*/m, "")
                        .replace(/\s*```$/m, "")
                        .trim();
                    try {
                        return [2 /*return*/, JSON.parse(jsonText)];
                    }
                    catch (_b) {
                        throw new Error("Failed to parse PDF BBox AI analysis as JSON");
                    }
                    return [2 /*return*/];
            }
        });
    });
}
