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
exports.BUILT_IN_TEMPLATES = void 0;
exports.buildEvidencePacket = buildEvidencePacket;
exports.buildFrontMatterPreview = buildFrontMatterPreview;
exports.scanPdfForSensitiveData = scanPdfForSensitiveData;
exports.applyManualRedactionBoxes = applyManualRedactionBoxes;
var promises_1 = require("fs/promises");
var path_1 = require("path");
var pdf_lib_1 = require("pdf-lib");
var pdftotext_1 = require("./pdftotext");
var evidence_packet_html_1 = require("./evidence-packet-html");
var docxtemplater_1 = require("docxtemplater");
var pizzip_1 = require("pizzip");
var child_process_1 = require("child_process");
var promises_2 = require("fs/promises");
var path_2 = require("path");
exports.BUILT_IN_TEMPLATES = [
    {
        id: "ho-standard",
        name: "HO - Hearing Officer",
        heading: "BEFORE THE HEARING OFFICER",
        captionPreambleLines: [
            "In the Matter of the Contested",
            "Industrial Insurance Claim of",
        ],
        captionFields: [
            { label: "Claim No.:", key: "claimNumber" },
            { label: "Hearing No.:", key: "hearingNumber" },
            { label: "Date/Time:", key: "hearingDateTime" },
            { label: "Appearance:", key: "appearance" },
        ],
        indexTitle: "DOCUMENT INDEX",
        counselPreamble: "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.",
        affirmationTitle: "AFFIRMATION",
        affirmationText: "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
        certTitle: "CERTIFICATE OF SERVICE",
        certIntro: "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
        firmBlockPosition: "signature",
        signerBlockAlign: "left",
        builtIn: true,
    },
    {
        id: "ao-standard",
        name: "AO - Appeals Officer",
        agencyLine: "STATE OF NEVADA  DEPARTMENT OF ADMINISTRATION",
        heading: "BEFORE THE APPEALS OFFICER",
        documentTitle: "CLAIMANT'S HEARING STATEMENT AND DOCUMENTARY EVIDENCE",
        pageFlow: "statement-first",
        tocFormat: "date-doc-page",
        captionPreambleLines: [
            "In the Matter of the Contested",
            "Industrial Insurance Claim of:",
        ],
        captionFields: [
            { label: "Appeal No.:", key: "hearingNumber" },
            { label: "Claim No.:", key: "claimNumber" },
            { label: "Hearing No.:", key: "hearingNo" },
            { label: "Employer:", key: "employer" },
        ],
        extraSections: [
            { title: "ISSUE", key: "issueOnAppeal" },
            { title: "WITNESSES", key: "witnesses" },
            { title: "DURATION", key: "duration" },
        ],
        indexTitle: "DOCUMENT INDEX",
        counselPreamble: 'COMES NOW, Claimant, {{claimantName}}, (hereinafter referred to as "Claimant"), by and through his attorneys, and hereby submits this Hearing Statement and Documentary Evidence for the Appeals Officer\'s consideration.',
        affirmationTitle: "AFFIRMATION PURSUANT TO NRS 239B.030",
        affirmationText: "The undersigned does hereby affirm that the attached Claimant's Documentary Evidence filed in Appeal No.: {{hearingNumber}}",
        certTitle: "CERTIFICATE OF MAILING",
        certIntro: "On this ______ day of {{serviceMonth}}, {{serviceYear}}, the undersigned, an employee of the {{firmName}}, does hereby certify that a true and correct copy of the foregoing was served upon the following by the method indicated below:",
        firmBlockPosition: "signature",
        signerBlockAlign: "left",
        builtIn: true,
    },
];
var SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/;
var SSN_NO_DASH_REGEX = /^\d{9}$/;
var DATE_REGEX = /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/;
var DOB_CONTEXT_REGEX = /\b(dob|d\.?o\.?b|date of birth|birth date)\b/i;
var SSN_CONTEXT_REGEX = /\b(ssn|social security|social)\b/i;
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
function buildEvidencePacket(options) {
    return __awaiter(this, void 0, void 0, function () {
        var warnings, redactionFindings, filteredDocs, orderedDocs, processedDocs, _i, orderedDocs_1, doc, absolutePath, originalBytes, err_1, pdfBytes_1, redactResult, pageCount, pageStampPrefix, pageStampStart, tocEntries, runningExhibitPage, _a, processedDocs_1, processed, startPage, endPage, pdf, regularFont, boldFont, docxPdfBytes, frontMatterPdf, fmPages, _b, fmPages_1, page, pdfBytes_2, frontMatterPdf, fmPages, _c, fmPages_2, page, htmlBuffer, frontMatterPdf, fmPages, _d, fmPages_3, page, frontMatterPages, exhibitPageNumber, _e, processedDocs_2, processed, sourcePdf, embeddedPages, i, sourcePage, _f, width, height, sourceRotation, newPage, pdfBytes;
        var _g, _h, _j, _k, _l, _m, _o, _p;
        return __generator(this, function (_q) {
            switch (_q.label) {
                case 0:
                    warnings = [];
                    redactionFindings = [];
                    filteredDocs = options.documents.filter(function (doc) { return doc.include !== false; });
                    if (filteredDocs.length === 0) {
                        throw new Error("No documents selected for packet");
                    }
                    orderedDocs = orderDocuments(filteredDocs, options.orderRules, warnings);
                    processedDocs = [];
                    _i = 0, orderedDocs_1 = orderedDocs;
                    _q.label = 1;
                case 1:
                    if (!(_i < orderedDocs_1.length)) return [3 /*break*/, 10];
                    doc = orderedDocs_1[_i];
                    absolutePath = options.resolveDocPath
                        ? options.resolveDocPath(doc.path)
                        : resolveCasePath(options.caseFolder, doc.path);
                    if (!doc.path.toLowerCase().endsWith(".pdf")) {
                        throw new Error("Only PDF documents are supported in packets: ".concat(doc.path));
                    }
                    originalBytes = void 0;
                    _q.label = 2;
                case 2:
                    _q.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, promises_1.readFile)(absolutePath)];
                case 3:
                    originalBytes = _q.sent();
                    return [3 /*break*/, 5];
                case 4:
                    err_1 = _q.sent();
                    if ((err_1 === null || err_1 === void 0 ? void 0 : err_1.code) === "ENOENT") {
                        warnings.push("Skipped missing file: ".concat(doc.path));
                        return [3 /*break*/, 9];
                    }
                    throw err_1;
                case 5:
                    pdfBytes_1 = originalBytes;
                    if (!((_g = options.redaction) === null || _g === void 0 ? void 0 : _g.enabled)) return [3 /*break*/, 7];
                    return [4 /*yield*/, redactPdfIfRequested(absolutePath, originalBytes, doc.path, options.redaction)];
                case 6:
                    redactResult = _q.sent();
                    pdfBytes_1 = redactResult.pdfBytes;
                    redactionFindings.push.apply(redactionFindings, redactResult.findings);
                    warnings.push.apply(warnings, redactResult.warnings);
                    _q.label = 7;
                case 7: return [4 /*yield*/, getPdfPageCount(pdfBytes_1, doc.path)];
                case 8:
                    pageCount = _q.sent();
                    processedDocs.push({
                        document: doc,
                        absolutePath: absolutePath,
                        pdfBytes: pdfBytes_1,
                        pageCount: pageCount,
                    });
                    _q.label = 9;
                case 9:
                    _i++;
                    return [3 /*break*/, 1];
                case 10:
                    if (processedDocs.length === 0) {
                        throw new Error("No documents could be included — all files were missing or unreadable");
                    }
                    if (((_h = options.redaction) === null || _h === void 0 ? void 0 : _h.enabled) && options.redaction.failOnDetection && redactionFindings.length > 0) {
                        throw new Error("Sensitive data was detected in ".concat(redactionFindings.length, " locations. ") +
                            "Review and rerun without failOnDetection to proceed.");
                    }
                    pageStampPrefix = (_j = options.pageStampPrefix) !== null && _j !== void 0 ? _j : "Page ";
                    pageStampStart = (_k = options.pageStampStart) !== null && _k !== void 0 ? _k : 1;
                    tocEntries = [];
                    runningExhibitPage = pageStampStart;
                    for (_a = 0, processedDocs_1 = processedDocs; _a < processedDocs_1.length; _a++) {
                        processed = processedDocs_1[_a];
                        startPage = runningExhibitPage;
                        endPage = runningExhibitPage + processed.pageCount - 1;
                        tocEntries.push({
                            title: processed.document.title,
                            path: processed.document.path,
                            date: processed.document.date,
                            startPage: startPage,
                            endPage: endPage,
                        });
                        runningExhibitPage = endPage + 1;
                    }
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.create()];
                case 11:
                    pdf = _q.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRoman)];
                case 12:
                    regularFont = _q.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRomanBold)];
                case 13:
                    boldFont = _q.sent();
                    if (!(((_l = options.template) === null || _l === void 0 ? void 0 : _l.sourceFile) && options.template.sourceFile.toLowerCase().endsWith(".docx"))) return [3 /*break*/, 17];
                    return [4 /*yield*/, buildDocxFrontMatter(options.template, options.caption, options.service, tocEntries, options.firmName, options.resolveDocPath || (function (p) { return resolveCasePath(options.caseFolder, p); }))];
                case 14:
                    docxPdfBytes = _q.sent();
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(docxPdfBytes)];
                case 15:
                    frontMatterPdf = _q.sent();
                    return [4 /*yield*/, pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices())];
                case 16:
                    fmPages = _q.sent();
                    for (_b = 0, fmPages_1 = fmPages; _b < fmPages_1.length; _b++) {
                        page = fmPages_1[_b];
                        pdf.addPage(page);
                    }
                    return [3 /*break*/, 28];
                case 17:
                    if (!(((_m = options.template) === null || _m === void 0 ? void 0 : _m.sourceFile) && options.template.sourceFile.toLowerCase().endsWith(".pdf"))) return [3 /*break*/, 21];
                    return [4 /*yield*/, buildPdfFrontMatter(options.template, options.caption, options.service, tocEntries, options.firmName, options.resolveDocPath || (function (p) { return resolveCasePath(options.caseFolder, p); }))];
                case 18:
                    pdfBytes_2 = _q.sent();
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(pdfBytes_2)];
                case 19:
                    frontMatterPdf = _q.sent();
                    return [4 /*yield*/, pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices())];
                case 20:
                    fmPages = _q.sent();
                    for (_c = 0, fmPages_2 = fmPages; _c < fmPages_2.length; _c++) {
                        page = fmPages_2[_c];
                        pdf.addPage(page);
                    }
                    return [3 /*break*/, 28];
                case 21:
                    if (!((_o = options.template) === null || _o === void 0 ? void 0 : _o.htmlTemplate)) return [3 /*break*/, 25];
                    return [4 /*yield*/, (0, evidence_packet_html_1.renderHtmlFrontMatter)({
                            caption: options.caption,
                            template: options.template,
                            firmBlockLines: options.firmBlockLines,
                            service: options.service,
                            signerName: options.signerName,
                            extraSectionValues: options.extraSectionValues,
                            includeAffirmationPage: options.includeAffirmationPage,
                        }, tocEntries)];
                case 22:
                    htmlBuffer = _q.sent();
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(htmlBuffer)];
                case 23:
                    frontMatterPdf = _q.sent();
                    return [4 /*yield*/, pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices())];
                case 24:
                    fmPages = _q.sent();
                    for (_d = 0, fmPages_3 = fmPages; _d < fmPages_3.length; _d++) {
                        page = fmPages_3[_d];
                        pdf.addPage(page);
                    }
                    return [3 /*break*/, 28];
                case 25:
                    if (!(((_p = options.template) === null || _p === void 0 ? void 0 : _p.pageFlow) === "statement-first")) return [3 /*break*/, 27];
                    return [4 /*yield*/, addStatementPages(pdf, regularFont, boldFont, options, tocEntries)];
                case 26:
                    _q.sent();
                    return [3 /*break*/, 28];
                case 27:
                    frontMatterPages = addIndexPages(pdf, regularFont, boldFont, options, tocEntries);
                    if (options.includeAffirmationPage !== false) {
                        frontMatterPages += addAffirmationPage(pdf, regularFont, boldFont, options, frontMatterPages + 1);
                    }
                    _q.label = 28;
                case 28:
                    exhibitPageNumber = pageStampStart;
                    _e = 0, processedDocs_2 = processedDocs;
                    _q.label = 29;
                case 29:
                    if (!(_e < processedDocs_2.length)) return [3 /*break*/, 33];
                    processed = processedDocs_2[_e];
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(processed.pdfBytes)];
                case 30:
                    sourcePdf = _q.sent();
                    return [4 /*yield*/, pdf.embedPdf(sourcePdf, sourcePdf.getPageIndices())];
                case 31:
                    embeddedPages = _q.sent();
                    for (i = 0; i < embeddedPages.length; i++) {
                        sourcePage = sourcePdf.getPage(i);
                        _f = sourcePage.getSize(), width = _f.width, height = _f.height;
                        sourceRotation = sourcePage.getRotation().angle;
                        newPage = pdf.addPage([width, height]);
                        newPage.drawPage(embeddedPages[i], { x: 0, y: 0, width: width, height: height });
                        if (sourceRotation !== 0) {
                            newPage.setRotation((0, pdf_lib_1.degrees)(sourceRotation));
                        }
                        stampExhibitPageNumber(newPage, regularFont, "".concat(pageStampPrefix).concat(exhibitPageNumber), sourceRotation);
                        exhibitPageNumber += 1;
                    }
                    _q.label = 32;
                case 32:
                    _e++;
                    return [3 /*break*/, 29];
                case 33: return [4 /*yield*/, pdf.save()];
                case 34:
                    pdfBytes = _q.sent();
                    return [2 /*return*/, {
                            pdfBytes: pdfBytes,
                            orderedDocuments: orderedDocs,
                            tocEntries: tocEntries,
                            warnings: warnings,
                            redactionFindings: redactionFindings,
                            totalPages: pdf.getPageCount(),
                        }];
            }
        });
    });
}
function buildFrontMatterPreview(options) {
    return __awaiter(this, void 0, void 0, function () {
        var resolveDoc, htmlBuffer, pdf, regularFont, boldFont, packetOptions, tocEntries, frontMatterPages;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    resolveDoc = options.caseFolder
                        ? function (p) { return resolveCasePath(options.caseFolder, p); }
                        : function (p) { return (0, path_2.join)(process.cwd(), p); };
                    if (!(((_a = options.template) === null || _a === void 0 ? void 0 : _a.sourceFile) && options.template.sourceFile.toLowerCase().endsWith(".docx"))) return [3 /*break*/, 1];
                    return [2 /*return*/, buildDocxFrontMatter(options.template, options.caption, options.service, options.tocEntries, options.firmName, resolveDoc)];
                case 1:
                    if (!(((_b = options.template) === null || _b === void 0 ? void 0 : _b.sourceFile) && options.template.sourceFile.toLowerCase().endsWith(".pdf"))) return [3 /*break*/, 2];
                    return [2 /*return*/, buildPdfFrontMatter(options.template, options.caption, options.service, options.tocEntries, options.firmName, resolveDoc)];
                case 2:
                    if (!((_c = options.template) === null || _c === void 0 ? void 0 : _c.htmlTemplate)) return [3 /*break*/, 4];
                    return [4 /*yield*/, (0, evidence_packet_html_1.renderHtmlFrontMatter)({
                            caption: options.caption,
                            template: options.template,
                            firmBlockLines: options.firmBlockLines,
                            service: options.service,
                            signerName: options.signerName,
                            extraSectionValues: options.extraSectionValues,
                            includeAffirmationPage: options.includeAffirmationPage,
                        }, options.tocEntries)];
                case 3:
                    htmlBuffer = _e.sent();
                    return [2 /*return*/, new Uint8Array(htmlBuffer)];
                case 4: return [4 /*yield*/, pdf_lib_1.PDFDocument.create()];
                case 5:
                    pdf = _e.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRoman)];
                case 6:
                    regularFont = _e.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRomanBold)];
                case 7:
                    boldFont = _e.sent();
                    packetOptions = {
                        caseFolder: "",
                        documents: [],
                        caption: options.caption,
                        firmBlockLines: options.firmBlockLines,
                        service: options.service,
                        template: options.template,
                        signerName: options.signerName,
                        extraSectionValues: options.extraSectionValues,
                        firmName: options.firmName,
                    };
                    tocEntries = options.tocEntries.map(function (e) { return ({
                        title: e.title,
                        path: "",
                        date: e.date,
                        startPage: e.startPage,
                        endPage: e.endPage,
                    }); });
                    if (!(((_d = options.template) === null || _d === void 0 ? void 0 : _d.pageFlow) === "statement-first")) return [3 /*break*/, 9];
                    return [4 /*yield*/, addStatementPages(pdf, regularFont, boldFont, packetOptions, tocEntries)];
                case 8:
                    _e.sent();
                    return [3 /*break*/, 10];
                case 9:
                    frontMatterPages = addIndexPages(pdf, regularFont, boldFont, packetOptions, tocEntries);
                    if (options.includeAffirmationPage !== false) {
                        addAffirmationPage(pdf, regularFont, boldFont, packetOptions, frontMatterPages + 1);
                    }
                    _e.label = 10;
                case 10: return [2 /*return*/, pdf.save()];
            }
        });
    });
}
function resolveCasePath(caseFolder, relativePath) {
    var base = (0, path_1.resolve)(caseFolder);
    var target = (0, path_1.resolve)(base, relativePath);
    if (target !== base && !target.startsWith(base + path_1.sep)) {
        throw new Error("Path is outside case folder: ".concat(relativePath));
    }
    return target;
}
function parseDateValue(value) {
    if (!value)
        return Number.MAX_SAFE_INTEGER;
    var parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}
function compileRuleRegex(input) {
    if (!input)
        return null;
    try {
        return new RegExp(input, "i");
    }
    catch (_a) {
        return null;
    }
}
function orderDocuments(documents, orderRules, warnings) {
    var _a, _b, _c, _d;
    var annotated = documents.map(function (doc, originalIndex) { return ({ doc: doc, originalIndex: originalIndex }); });
    if (!orderRules || orderRules.length === 0) {
        return annotated.sort(function (a, b) { return a.originalIndex - b.originalIndex; }).map(function (item) { return item.doc; });
    }
    var remaining = __spreadArray([], annotated, true);
    var ordered = [];
    var _loop_1 = function (rule) {
        var pathRegex = compileRuleRegex((_a = rule.match) === null || _a === void 0 ? void 0 : _a.pathRegex);
        var titleRegex = compileRuleRegex((_b = rule.match) === null || _b === void 0 ? void 0 : _b.titleRegex);
        if ((((_c = rule.match) === null || _c === void 0 ? void 0 : _c.pathRegex) && !pathRegex) || (((_d = rule.match) === null || _d === void 0 ? void 0 : _d.titleRegex) && !titleRegex)) {
            warnings.push("Rule \"".concat(rule.id, "\" has invalid regex and was skipped"));
            return "continue";
        }
        var matches = remaining.filter(function (_a) {
            var doc = _a.doc;
            return matchesRule(doc, rule, pathRegex, titleRegex);
        });
        if (rule.required && matches.length === 0) {
            warnings.push("Required rule \"".concat(rule.id, "\" matched no documents"));
            return "continue";
        }
        matches.sort(function (a, b) { var _a, _b; return compareDocs(a, b, (_a = rule.sortBy) !== null && _a !== void 0 ? _a : "none", (_b = rule.sortDirection) !== null && _b !== void 0 ? _b : "asc"); });
        var _loop_2 = function (match) {
            ordered.push(match);
            var idx = remaining.findIndex(function (candidate) { return candidate === match; });
            if (idx >= 0)
                remaining.splice(idx, 1);
        };
        for (var _e = 0, matches_1 = matches; _e < matches_1.length; _e++) {
            var match = matches_1[_e];
            _loop_2(match);
        }
    };
    for (var _i = 0, orderRules_1 = orderRules; _i < orderRules_1.length; _i++) {
        var rule = orderRules_1[_i];
        _loop_1(rule);
    }
    // Keep unmatched files stable at the end.
    remaining.sort(function (a, b) { return a.originalIndex - b.originalIndex; });
    if (remaining.length > 0) {
        warnings.push("".concat(remaining.length, " document(s) did not match any ordering rule and were appended as-is"));
    }
    return __spreadArray(__spreadArray([], ordered, true), remaining, true).map(function (item) { return item.doc; });
}
function matchesRule(doc, rule, pathRegex, titleRegex) {
    var match = rule.match;
    if (!match)
        return false;
    if (match.docTypes && match.docTypes.length > 0) {
        var docType_1 = (doc.docType || "").toLowerCase();
        if (!match.docTypes.some(function (type) { return type.toLowerCase() === docType_1; })) {
            return false;
        }
    }
    if (pathRegex && !pathRegex.test(doc.path)) {
        return false;
    }
    if (titleRegex && !titleRegex.test(doc.title)) {
        return false;
    }
    return true;
}
function compareDocs(a, b, sortBy, direction) {
    var multiplier = direction === "desc" ? -1 : 1;
    var result = 0;
    switch (sortBy) {
        case "date":
            result = parseDateValue(a.doc.date) - parseDateValue(b.doc.date);
            break;
        case "title":
            result = a.doc.title.localeCompare(b.doc.title);
            break;
        case "path":
            result = a.doc.path.localeCompare(b.doc.path);
            break;
        default:
            result = a.originalIndex - b.originalIndex;
            break;
    }
    if (result === 0) {
        result = a.originalIndex - b.originalIndex;
    }
    return result * multiplier;
}
function getPdfPageCount(pdfBytes, pathLabel) {
    return __awaiter(this, void 0, void 0, function () {
        var pdf, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(pdfBytes)];
                case 1:
                    pdf = _a.sent();
                    return [2 /*return*/, pdf.getPageCount()];
                case 2:
                    error_1 = _a.sent();
                    throw new Error("Failed to read PDF page count for ".concat(pathLabel, ": ").concat(formatError(error_1)));
                case 3: return [2 /*return*/];
            }
        });
    });
}
function redactPdfIfRequested(absolutePath, pdfBytes, relativePath, redaction) {
    return __awaiter(this, void 0, void 0, function () {
        var mode, findings, warnings, bboxHtml, message, sensitiveBoxes, _i, sensitiveBoxes_1, box, redactedBytes;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    mode = (_a = redaction.mode) !== null && _a !== void 0 ? _a : "detect_only";
                    findings = [];
                    warnings = [];
                    return [4 /*yield*/, extractBboxLayout(absolutePath)];
                case 1:
                    bboxHtml = _b.sent();
                    if (!bboxHtml) {
                        message = "Could not extract text coordinates for ".concat(relativePath, "; automatic redaction skipped");
                        if (redaction.failOnUnprocessable) {
                            throw new Error(message);
                        }
                        warnings.push(message);
                        return [2 /*return*/, { pdfBytes: pdfBytes, findings: findings, warnings: warnings }];
                    }
                    sensitiveBoxes = detectSensitiveBoxes(bboxHtml, relativePath);
                    for (_i = 0, sensitiveBoxes_1 = sensitiveBoxes; _i < sensitiveBoxes_1.length; _i++) {
                        box = sensitiveBoxes_1[_i];
                        findings.push({
                            path: relativePath,
                            page: box.page,
                            kind: box.kind,
                            preview: box.preview,
                        });
                    }
                    if (mode === "detect_only" || sensitiveBoxes.length === 0) {
                        return [2 /*return*/, { pdfBytes: pdfBytes, findings: findings, warnings: warnings }];
                    }
                    return [4 /*yield*/, applyRedactionBoxes(pdfBytes, sensitiveBoxes)];
                case 2:
                    redactedBytes = _b.sent();
                    return [2 /*return*/, { pdfBytes: redactedBytes, findings: findings, warnings: warnings }];
            }
        });
    });
}
function scanPdfForSensitiveData(absolutePath_1, relativePath_1) {
    return __awaiter(this, arguments, void 0, function (absolutePath, relativePath, options) {
        var warnings, bboxHtml, message, sensitiveBoxes, boxes, findings;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    warnings = [];
                    return [4 /*yield*/, extractBboxLayout(absolutePath)];
                case 1:
                    bboxHtml = _a.sent();
                    if (!bboxHtml) {
                        message = "Could not extract text coordinates for ".concat(relativePath, "; PII scan skipped");
                        if (options.failOnUnprocessable) {
                            throw new Error(message);
                        }
                        warnings.push(message);
                        return [2 /*return*/, { findings: [], warnings: warnings, boxes: [] }];
                    }
                    sensitiveBoxes = detectSensitiveBoxes(bboxHtml, relativePath);
                    boxes = sensitiveBoxes.map(function (item) { return ({
                        path: relativePath,
                        page: item.page,
                        kind: item.kind,
                        preview: item.preview,
                        xMin: item.box.xMin,
                        yMin: item.box.yMin,
                        xMax: item.box.xMax,
                        yMax: item.box.yMax,
                    }); });
                    findings = boxes.map(function (item) { return ({
                        path: item.path,
                        page: item.page,
                        kind: item.kind,
                        preview: item.preview,
                    }); });
                    return [2 /*return*/, { findings: findings, warnings: warnings, boxes: boxes }];
            }
        });
    });
}
function extractBboxLayout(pdfPath) {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, pdftotext_1.runPdftotext)(["-bbox-layout", pdfPath, "-"], {
                            maxBuffer: 30 * 1024 * 1024,
                            timeout: 30000,
                        })];
                case 1:
                    stdout = _b.sent();
                    return [2 /*return*/, stdout];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function decodeXmlEntity(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
        .replace(/&#([0-9]+);/g, function (_, num) { return String.fromCharCode(parseInt(num, 10)); });
}
function detectSensitiveBoxes(bboxHtml, relativePath) {
    var findings = [];
    var pageRegex = /<page\b[^>]*>([\s\S]*?)<\/page>/g;
    var pageMatch;
    var pageNumber = 0;
    while ((pageMatch = pageRegex.exec(bboxHtml)) !== null) {
        pageNumber += 1;
        var pageContent = pageMatch[1];
        var wordRegex = /<word\b[^>]*xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g;
        var words = [];
        var wordMatch = void 0;
        while ((wordMatch = wordRegex.exec(pageContent)) !== null) {
            words.push({
                xMin: parseFloat(wordMatch[1]),
                yMin: parseFloat(wordMatch[2]),
                xMax: parseFloat(wordMatch[3]),
                yMax: parseFloat(wordMatch[4]),
                text: decodeXmlEntity(wordMatch[5]).trim(),
            });
        }
        if (words.length === 0)
            continue;
        var seen = new Set();
        for (var i = 0; i < words.length; i += 1) {
            var current = words[i];
            if (!current.text)
                continue;
            var cleaned = cleanToken(current.text);
            var contextBefore = words
                .slice(Math.max(0, i - 5), i)
                .map(function (word) { return cleanPhrase(word.text); })
                .join(" ");
            if (SSN_REGEX.test(cleaned) || (SSN_NO_DASH_REGEX.test(cleaned) && SSN_CONTEXT_REGEX.test(contextBefore))) {
                var preview = maskSensitive(cleaned);
                var dedupeKey = "".concat(pageNumber, ":").concat(current.xMin, ":").concat(current.yMin, ":").concat(current.xMax, ":").concat(current.yMax, ":ssn");
                if (!seen.has(dedupeKey)) {
                    findings.push({ page: pageNumber, kind: "ssn", box: current, preview: preview });
                    seen.add(dedupeKey);
                }
                continue;
            }
            var dateMatch = cleaned.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/);
            if (dateMatch && DATE_REGEX.test(dateMatch[0]) && DOB_CONTEXT_REGEX.test(contextBefore)) {
                var preview = maskSensitive(dateMatch[0]);
                var dedupeKey = "".concat(pageNumber, ":").concat(current.xMin, ":").concat(current.yMin, ":").concat(current.xMax, ":").concat(current.yMax, ":dob");
                if (!seen.has(dedupeKey)) {
                    findings.push({ page: pageNumber, kind: "dob", box: current, preview: preview });
                    seen.add(dedupeKey);
                }
            }
        }
    }
    if (findings.length === 0) {
        // Keep this branch explicit for future debugging / telemetry and path traceability.
        void relativePath;
    }
    return findings;
}
function applyRedactionBoxes(pdfBytes, boxes) {
    return __awaiter(this, void 0, void 0, function () {
        var pdf, _i, boxes_1, item, pageIndex, page, height, x, width, targetY, y, maxHeight, redactionHeight;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, pdf_lib_1.PDFDocument.load(pdfBytes)];
                case 1:
                    pdf = _a.sent();
                    for (_i = 0, boxes_1 = boxes; _i < boxes_1.length; _i++) {
                        item = boxes_1[_i];
                        pageIndex = item.page - 1;
                        page = pdf.getPage(pageIndex);
                        if (!page)
                            continue;
                        height = page.getSize().height;
                        x = Math.max(0, item.box.xMin - 1);
                        width = Math.max(2, item.box.xMax - item.box.xMin + 2);
                        targetY = height - item.box.yMax - 1;
                        y = Math.max(0, targetY);
                        maxHeight = Math.max(6, item.box.yMax - item.box.yMin + 2);
                        redactionHeight = Math.min(maxHeight, height - y);
                        page.drawRectangle({
                            x: x,
                            y: y,
                            width: width,
                            height: redactionHeight,
                            color: (0, pdf_lib_1.rgb)(0, 0, 0),
                            borderColor: (0, pdf_lib_1.rgb)(0, 0, 0),
                            borderWidth: 0,
                        });
                    }
                    return [2 /*return*/, pdf.save()];
            }
        });
    });
}
function applyManualRedactionBoxes(pdfBytes, boxes) {
    return __awaiter(this, void 0, void 0, function () {
        var pdf, _i, boxes_2, item, page, _a, width, height, x, yFromTop, redactionWidth, redactionHeight, y;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, pdf_lib_1.PDFDocument.load(pdfBytes)];
                case 1:
                    pdf = _b.sent();
                    for (_i = 0, boxes_2 = boxes; _i < boxes_2.length; _i++) {
                        item = boxes_2[_i];
                        if (!item || !Number.isFinite(item.page))
                            continue;
                        page = pdf.getPage(Math.floor(item.page) - 1);
                        if (!page)
                            continue;
                        _a = page.getSize(), width = _a.width, height = _a.height;
                        x = clamp01(item.xPct) * width;
                        yFromTop = clamp01(item.yPct) * height;
                        redactionWidth = clamp01(item.widthPct) * width;
                        redactionHeight = clamp01(item.heightPct) * height;
                        if (redactionWidth < 1 || redactionHeight < 1)
                            continue;
                        y = Math.max(0, height - yFromTop - redactionHeight);
                        page.drawRectangle({
                            x: x,
                            y: y,
                            width: redactionWidth,
                            height: redactionHeight,
                            color: (0, pdf_lib_1.rgb)(0, 0, 0),
                            borderColor: (0, pdf_lib_1.rgb)(0, 0, 0),
                            borderWidth: 0,
                        });
                    }
                    return [2 /*return*/, pdf.save()];
            }
        });
    });
}
function cleanToken(value) {
    return value.replace(/[^\w\/-]/g, "").toLowerCase();
}
function cleanPhrase(value) {
    return value.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function maskSensitive(value) {
    if (SSN_REGEX.test(value)) {
        var last4 = value.slice(-4);
        return "***-**-".concat(last4);
    }
    if (DATE_REGEX.test(value)) {
        return "**/**/****";
    }
    if (value.length <= 4)
        return "****";
    return "".concat("*".repeat(Math.max(4, value.length - 4))).concat(value.slice(-4));
}
/**
 * Replace {{key}} placeholders in template text with values from the caption.
 * Checks top-level caption properties first, then captionValues map.
 */
function interpolateTemplateText(text, caption) {
    return text.replace(/\{\{(\w+)\}\}/g, function (match, key) {
        var _a;
        var topLevel = caption[key];
        if (typeof topLevel === "string" && topLevel)
            return topLevel;
        var fromValues = (_a = caption.captionValues) === null || _a === void 0 ? void 0 : _a[key];
        if (typeof fromValues === "string" && fromValues)
            return fromValues;
        return match; // leave placeholder if no value available
    });
}
function drawCenteredUnderline(page, font, text, size, y) {
    var pageWidth = page.getWidth();
    var textWidth = font.widthOfTextAtSize(text, size);
    var x = (pageWidth - textWidth) / 2;
    page.drawText(text, { x: x, y: y, size: size, font: font, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
    page.drawLine({
        start: { x: x, y: y - 1.5 },
        end: { x: x + textWidth, y: y - 1.5 },
        thickness: 0.5,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
}
function drawTocRow3Col(page, font, date, docTitle, pageRange, y) {
    var size = 12;
    var dateX = 84;
    var docX = 170;
    var pageX = 530;
    var maxDocWidth = pageX - docX - 20;
    var safeTitle = truncateToWidth(docTitle, font, size, maxDocWidth);
    page.drawText(date, { x: dateX, y: y, size: size, font: font });
    page.drawText(safeTitle, { x: docX, y: y, size: size, font: font });
    var rangeWidth = font.widthOfTextAtSize(pageRange, size);
    page.drawText(pageRange, { x: pageX - rangeWidth, y: y, size: size, font: font });
}
function addStatementPages(pdf, regularFont, boldFont, options, tocEntries) {
    return __awaiter(this, void 0, void 0, function () {
        var italicFont, tpl, isAO, dblLeft, rLine, pages, page, showFirmAtTop, firmBlockBottomY, baseFirstCaptionLineY, requiredCaptionGap, preferredExtraDrop, captionYOffset, cy, preambleLines, preambleStartY, i, afterPreambleY, rightX, captionFieldDefs, captionFieldSpacing, i, field, value, captionBottomY, currentY, counselPreambleRaw, intro, _i, _a, section, sectionValue, sigLineHeight, displayFirmName, signerDisplayName, cleanedFirmLines, filteredFirmLines, sigBlockLineCount, affirmHeight, pageBottom, affirmStartY, minFillerSpace, affirmationText, serviceDate, _b, filteredFirmLines_1, line, idxY, hdrSize, dateHdrX, docHdrX, pageHdrX, dateHdrText, docHdrText, pageHdrText, dateHdrW, docHdrW, pageHdrW, tableBottom, rowHeight, i, entry, dateStr, pgRange, certY, certIntroRaw, certIntro, recipients, _c, recipients_1, recipient, lines, _d, lines_1, line;
        var _e, _f, _g, _h, _j, _k, _l, _m;
        return __generator(this, function (_o) {
            switch (_o.label) {
                case 0: return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRomanItalic)];
                case 1:
                    italicFont = _o.sent();
                    tpl = options.template;
                    isAO = tpl.pageFlow === "statement-first";
                    dblLeft = isAO;
                    rLine = isAO;
                    pages = [];
                    page = pdf.addPage([612, 792]);
                    pages.push(page);
                    showFirmAtTop = ((_e = tpl.firmBlockPosition) !== null && _e !== void 0 ? _e : "header") === "header";
                    firmBlockBottomY = drawPleadingPaper(page, regularFont, options.firmBlockLines, 1, showFirmAtTop, dblLeft, rLine);
                    baseFirstCaptionLineY = 693;
                    requiredCaptionGap = 16;
                    preferredExtraDrop = 64;
                    captionYOffset = typeof firmBlockBottomY === "number"
                        ? Math.max(preferredExtraDrop, (firmBlockBottomY + requiredCaptionGap) - baseFirstCaptionLineY)
                        : preferredExtraDrop;
                    cy = function (y) { return y - captionYOffset; };
                    // Agency line (centered, bold, underlined)
                    if (tpl.agencyLine) {
                        drawCenteredUnderline(page, boldFont, tpl.agencyLine, 12, cy(738));
                    }
                    // Officer line (centered, bold, underlined)
                    drawCenteredUnderline(page, boldFont, tpl.heading, 12, cy(724));
                    // Caption divider
                    drawCaptionDivider(page, regularFont, captionYOffset);
                    preambleLines = tpl.captionPreambleLines;
                    preambleStartY = cy(693);
                    for (i = 0; i < preambleLines.length; i++) {
                        page.drawText(preambleLines[i], { x: 84, y: preambleStartY - i * 15, size: 12, font: regularFont });
                    }
                    afterPreambleY = preambleStartY - preambleLines.length * 15 - 17;
                    page.drawText("".concat(options.caption.claimantName, ","), { x: 84, y: afterPreambleY, size: 12, font: regularFont });
                    page.drawText("Claimant.", { x: 84, y: afterPreambleY - 15, size: 12, font: regularFont });
                    rightX = 362;
                    captionFieldDefs = tpl.captionFields;
                    captionFieldSpacing = 20;
                    for (i = 0; i < captionFieldDefs.length; i++) {
                        field = captionFieldDefs[i];
                        value = (_f = options.caption[field.key]) !== null && _f !== void 0 ? _f : (_g = options.caption.captionValues) === null || _g === void 0 ? void 0 : _g[field.key];
                        drawRightField(page, boldFont, regularFont, rightX, cy(693) - i * captionFieldSpacing, field.label, String(value !== null && value !== void 0 ? value : ""), 12);
                    }
                    captionBottomY = 618 - captionYOffset;
                    currentY = captionBottomY;
                    // Document title (centered, bold + underline)
                    if (tpl.documentTitle) {
                        currentY -= 24;
                        drawCenteredUnderline(page, boldFont, tpl.documentTitle, 12, currentY);
                        currentY -= 24;
                    }
                    counselPreambleRaw = tpl.counselPreamble;
                    intro = interpolateTemplateText(counselPreambleRaw, options.caption);
                    currentY = drawWrappedTextIndented(page, intro, 84, currentY, 461, regularFont, 12, 24, 25);
                    currentY -= 12;
                    // Extra sections (ISSUE, WITNESSES, DURATION)
                    if (tpl.extraSections && tpl.extraSections.length > 0) {
                        for (_i = 0, _a = tpl.extraSections; _i < _a.length; _i++) {
                            section = _a[_i];
                            drawCenteredUnderline(page, boldFont, section.title, 12, currentY);
                            currentY -= 24;
                            sectionValue = ((_h = options.extraSectionValues) === null || _h === void 0 ? void 0 : _h[section.key]) || "";
                            if (sectionValue) {
                                currentY = drawWrappedTextIndented(page, sectionValue, 84, currentY, 461, regularFont, 12, 24, 25);
                                currentY -= 12;
                            }
                        }
                    }
                    sigLineHeight = 14;
                    displayFirmName = options.firmName || "";
                    signerDisplayName = options.signerName || options.caption.introductoryCounselLine || "";
                    cleanedFirmLines = (options.firmBlockLines || [])
                        .map(function (l) { return l.trim().replace(/\[[^\]]+\]/g, "").trim(); })
                        .filter(function (l) { return l && !/not configured/i.test(l); });
                    filteredFirmLines = cleanedFirmLines.filter(function (line) {
                        if (displayFirmName && line.toLowerCase() === displayFirmName.toLowerCase())
                            return false;
                        if (signerDisplayName && line.toLowerCase() === signerDisplayName.toLowerCase())
                            return false;
                        return true;
                    });
                    sigBlockLineCount = 2;
                    if (displayFirmName)
                        sigBlockLineCount += 1;
                    if (signerDisplayName)
                        sigBlockLineCount += 1;
                    sigBlockLineCount += filteredFirmLines.length;
                    sigBlockLineCount += 1; // "Attorney for Claimant"
                    affirmHeight = 24 + // affirmation title
                        32 + // affirmation text (~2 lines at 16pt)
                        6 + // gap
                        20 + // checkbox
                        24 + // dated line
                        (sigBlockLineCount * sigLineHeight) +
                        6 + // gap before "By:"
                        50;
                    pageBottom = 76;
                    affirmStartY = pageBottom + affirmHeight;
                    minFillerSpace = 24;
                    if (currentY < affirmStartY + minFillerSpace) {
                        // Not enough room — fill this page with "///" then start a new page
                        while (currentY > pageBottom) {
                            drawCentered(page, regularFont, "///", 12, currentY);
                            currentY -= 24;
                        }
                        page = pdf.addPage([612, 792]);
                        pages.push(page);
                        drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
                        currentY = 724;
                    }
                    // Fill with "///" down to the affirmation start
                    while (currentY > affirmStartY + 24) {
                        drawCentered(page, regularFont, "///", 12, currentY);
                        currentY -= 24;
                    }
                    // ── AFFIRMATION heading ──
                    currentY = affirmStartY;
                    drawCenteredUnderline(page, boldFont, tpl.affirmationTitle, 12, currentY);
                    currentY -= 24;
                    affirmationText = interpolateTemplateText(tpl.affirmationText, options.caption);
                    currentY = drawWrappedText(page, affirmationText, 84, currentY, 461, regularFont, 12, 16);
                    currentY -= 6;
                    // "× Does not contain..." checkbox line
                    page.drawText("\u00D7 Does not contain personal information as defined by NRS 603A.040", {
                        x: 84, y: currentY, size: 11, font: regularFont,
                    });
                    currentY -= 20;
                    serviceDate = ((_j = options.service) === null || _j === void 0 ? void 0 : _j.serviceDate) || new Date().toLocaleDateString("en-US");
                    page.drawText("Dated: ".concat(serviceDate), { x: 84, y: currentY, size: 12, font: regularFont });
                    currentY -= 24;
                    // ── Signature block ──
                    page.drawText("Respectfully submitted,", { x: 84, y: currentY, size: 12, font: regularFont });
                    currentY -= sigLineHeight;
                    // Bold firm name (from dedicated firmName, not firmBlockLines[0])
                    if (displayFirmName) {
                        page.drawText(displayFirmName, { x: 84, y: currentY, size: 12, font: boldFont });
                        currentY -= sigLineHeight;
                    }
                    currentY -= 6;
                    page.drawText("By: ________________", { x: 84, y: currentY, size: 12, font: regularFont });
                    currentY -= sigLineHeight;
                    // Signer name
                    if (signerDisplayName) {
                        page.drawText(signerDisplayName, { x: 84, y: currentY, size: 12, font: regularFont });
                        currentY -= sigLineHeight;
                    }
                    // Remaining firm lines (bar number, address, phone) — skip firm name & signer duplicates
                    for (_b = 0, filteredFirmLines_1 = filteredFirmLines; _b < filteredFirmLines_1.length; _b++) {
                        line = filteredFirmLines_1[_b];
                        page.drawText(line, { x: 84, y: currentY, size: 12, font: regularFont });
                        currentY -= sigLineHeight;
                    }
                    // "Attorney for Claimant" (italic)
                    page.drawText("Attorney for Claimant", { x: 84, y: currentY, size: 12, font: italicFont });
                    // ── Page 2: Document Index ─────────────────────────────────────────
                    page = pdf.addPage([612, 792]);
                    pages.push(page);
                    drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
                    idxY = 724;
                    drawCenteredUnderline(page, boldFont, (_k = tpl.indexTitle) !== null && _k !== void 0 ? _k : "DOCUMENT INDEX", 12, idxY);
                    idxY -= 30;
                    hdrSize = 12;
                    dateHdrX = 84;
                    docHdrX = 170;
                    pageHdrX = 530;
                    dateHdrText = "DATE";
                    docHdrText = "DOCUMENTS";
                    pageHdrText = "PAGE NO(S)";
                    page.drawText(dateHdrText, { x: dateHdrX, y: idxY, size: hdrSize, font: boldFont });
                    dateHdrW = boldFont.widthOfTextAtSize(dateHdrText, hdrSize);
                    page.drawLine({ start: { x: dateHdrX, y: idxY - 1.5 }, end: { x: dateHdrX + dateHdrW, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                    page.drawText(docHdrText, { x: docHdrX, y: idxY, size: hdrSize, font: boldFont });
                    docHdrW = boldFont.widthOfTextAtSize(docHdrText, hdrSize);
                    page.drawLine({ start: { x: docHdrX, y: idxY - 1.5 }, end: { x: docHdrX + docHdrW, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                    pageHdrW = boldFont.widthOfTextAtSize(pageHdrText, hdrSize);
                    page.drawText(pageHdrText, { x: pageHdrX - pageHdrW, y: idxY, size: hdrSize, font: boldFont });
                    page.drawLine({ start: { x: pageHdrX - pageHdrW, y: idxY - 1.5 }, end: { x: pageHdrX, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                    idxY -= 28;
                    tableBottom = 90;
                    rowHeight = 24;
                    for (i = 0; i < tocEntries.length; i++) {
                        if (idxY < tableBottom) {
                            page = pdf.addPage([612, 792]);
                            pages.push(page);
                            drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
                            drawCenteredUnderline(page, boldFont, "DOCUMENT INDEX (CONT.)", 12, 724);
                            // Repeat column headers
                            idxY = 694;
                            page.drawText(dateHdrText, { x: dateHdrX, y: idxY, size: hdrSize, font: boldFont });
                            page.drawLine({ start: { x: dateHdrX, y: idxY - 1.5 }, end: { x: dateHdrX + dateHdrW, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                            page.drawText(docHdrText, { x: docHdrX, y: idxY, size: hdrSize, font: boldFont });
                            page.drawLine({ start: { x: docHdrX, y: idxY - 1.5 }, end: { x: docHdrX + docHdrW, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                            page.drawText(pageHdrText, { x: pageHdrX - pageHdrW, y: idxY, size: hdrSize, font: boldFont });
                            page.drawLine({ start: { x: pageHdrX - pageHdrW, y: idxY - 1.5 }, end: { x: pageHdrX, y: idxY - 1.5 }, thickness: 0.5, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                            idxY -= 28;
                        }
                        entry = tocEntries[i];
                        dateStr = entry.date || "";
                        pgRange = formatPageRange(entry.startPage, entry.endPage);
                        drawTocRow3Col(page, regularFont, dateStr, entry.title, pgRange, idxY);
                        idxY -= rowHeight;
                    }
                    // ── Page 3: Certificate of Mailing ─────────────────────────────────
                    page = pdf.addPage([612, 792]);
                    pages.push(page);
                    drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
                    certY = 724;
                    drawCenteredUnderline(page, boldFont, (_l = tpl.certTitle) !== null && _l !== void 0 ? _l : "CERTIFICATE OF MAILING", 12, certY);
                    certY -= 30;
                    certIntroRaw = tpl.certIntro;
                    certIntro = interpolateTemplateText(certIntroRaw, options.caption);
                    certY = drawWrappedTextIndented(page, certIntro, 84, certY, 461, regularFont, 12, 24, 25);
                    certY -= 24;
                    recipients = ((_m = options.service) === null || _m === void 0 ? void 0 : _m.recipients) && options.service.recipients.length > 0
                        ? options.service.recipients
                        : ["Recipient details to be provided by counsel."];
                    for (_c = 0, recipients_1 = recipients; _c < recipients_1.length; _c++) {
                        recipient = recipients_1[_c];
                        lines = recipient.split(/\n/);
                        for (_d = 0, lines_1 = lines; _d < lines_1.length; _d++) {
                            line = lines_1[_d];
                            page.drawText(line.trim(), { x: 120, y: certY, size: 12, font: regularFont });
                            certY -= 14;
                        }
                        certY -= 10; // blank line between recipients
                    }
                    return [2 /*return*/, pages.length];
            }
        });
    });
}
/** Like drawWrappedText but with a first-line indent for each paragraph. */
function drawWrappedTextIndented(page, text, x, y, maxWidth, font, size, lineHeight, firstLineIndent) {
    var paragraphs = text.split(/\n+/);
    var cursorY = y;
    for (var _i = 0, paragraphs_1 = paragraphs; _i < paragraphs_1.length; _i++) {
        var paragraph = paragraphs_1[_i];
        var words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            cursorY -= lineHeight;
            continue;
        }
        var isFirstLine = true;
        var line = "";
        var indentedX = x + firstLineIndent;
        var firstLineMaxWidth = maxWidth - firstLineIndent;
        for (var _a = 0, words_1 = words; _a < words_1.length; _a++) {
            var word = words_1[_a];
            var candidate = line ? "".concat(line, " ").concat(word) : word;
            var currentMaxWidth = isFirstLine ? firstLineMaxWidth : maxWidth;
            var width = font.widthOfTextAtSize(candidate, size);
            if (width <= currentMaxWidth) {
                line = candidate;
            }
            else {
                if (line) {
                    var drawX = isFirstLine ? indentedX : x;
                    page.drawText(line, { x: drawX, y: cursorY, size: size, font: font });
                    cursorY -= lineHeight;
                    isFirstLine = false;
                }
                line = word;
            }
        }
        if (line) {
            var drawX = isFirstLine ? indentedX : x;
            page.drawText(line, { x: drawX, y: cursorY, size: size, font: font });
            cursorY -= lineHeight;
        }
    }
    return cursorY;
}
function addIndexPages(pdf, regularFont, boldFont, options, tocEntries) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    var pages = [];
    var page = pdf.addPage([612, 792]);
    pages.push(page);
    var showFirmAtTop = ((_b = (_a = options.template) === null || _a === void 0 ? void 0 : _a.firmBlockPosition) !== null && _b !== void 0 ? _b : "header") === "header";
    var firmBlockBottomY = drawPleadingPaper(page, regularFont, options.firmBlockLines, 1, showFirmAtTop);
    var baseFirstCaptionLineY = 693;
    var requiredCaptionGap = 16;
    var preferredExtraDrop = 64;
    var captionYOffset = typeof firmBlockBottomY === "number"
        ? Math.max(preferredExtraDrop, (firmBlockBottomY + requiredCaptionGap) - baseFirstCaptionLineY)
        : preferredExtraDrop;
    var cy = function (y) { return y - captionYOffset; };
    var tpl = options.template;
    drawCentered(page, boldFont, (_c = tpl === null || tpl === void 0 ? void 0 : tpl.heading) !== null && _c !== void 0 ? _c : "BEFORE THE HEARING OFFICER", 12, cy(724));
    drawCaptionDivider(page, regularFont, captionYOffset);
    // Caption preamble (left side)
    var preambleLines = (_d = tpl === null || tpl === void 0 ? void 0 : tpl.captionPreambleLines) !== null && _d !== void 0 ? _d : [
        "In the Matter of the Contested",
        "Industrial Insurance Claim of",
    ];
    var preambleStartY = cy(693);
    for (var i = 0; i < preambleLines.length; i++) {
        page.drawText(preambleLines[i], { x: 84, y: preambleStartY - i * 15, size: 12, font: regularFont });
    }
    var afterPreambleY = preambleStartY - preambleLines.length * 15 - 17;
    page.drawText("".concat(options.caption.claimantName, ","), { x: 84, y: afterPreambleY, size: 12, font: regularFont });
    page.drawText("Claimant.", { x: 84, y: afterPreambleY - 15, size: 12, font: regularFont });
    // Caption fields (right side)
    var rightX = 362;
    var captionFieldDefs = (_e = tpl === null || tpl === void 0 ? void 0 : tpl.captionFields) !== null && _e !== void 0 ? _e : [
        { label: "Claim No.:", key: "claimNumber" },
        { label: "Hearing No.:", key: "hearingNumber" },
        { label: "Date/Time:", key: "hearingDateTime" },
        { label: "Appearance:", key: "appearance" },
    ];
    var captionFieldSpacing = 20;
    for (var i = 0; i < captionFieldDefs.length; i++) {
        var field = captionFieldDefs[i];
        var value = (_f = options.caption[field.key]) !== null && _f !== void 0 ? _f : (_g = options.caption.captionValues) === null || _g === void 0 ? void 0 : _g[field.key];
        drawRightField(page, boldFont, regularFont, rightX, cy(693) - i * captionFieldSpacing, field.label, String(value !== null && value !== void 0 ? value : ""), 12);
    }
    var captionBottomY = 618 - captionYOffset;
    var sectionY = captionBottomY;
    // Extra sections (e.g. "ISSUE ON APPEAL" for AO template)
    if ((tpl === null || tpl === void 0 ? void 0 : tpl.extraSections) && tpl.extraSections.length > 0) {
        for (var _i = 0, _m = tpl.extraSections; _i < _m.length; _i++) {
            var section = _m[_i];
            sectionY -= 10;
            drawCentered(page, boldFont, section.title, 13, sectionY);
            sectionY -= 20;
            var sectionValue = ((_h = options.extraSectionValues) === null || _h === void 0 ? void 0 : _h[section.key]) || "";
            if (sectionValue) {
                sectionY = drawWrappedText(page, sectionValue, 84, sectionY, 470, regularFont, 12, 16);
                sectionY -= 8;
            }
        }
    }
    var docIndexY = sectionY - 20;
    drawCentered(page, boldFont, (_j = tpl === null || tpl === void 0 ? void 0 : tpl.indexTitle) !== null && _j !== void 0 ? _j : "DOCUMENT INDEX", 14, docIndexY);
    var counselPreambleRaw = (_l = (_k = tpl === null || tpl === void 0 ? void 0 : tpl.counselPreamble) !== null && _k !== void 0 ? _k : options.caption.introductoryCounselLine) !== null && _l !== void 0 ? _l : "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.";
    var intro = interpolateTemplateText(counselPreambleRaw, options.caption);
    var introStartY = docIndexY - 48;
    var currentY = drawWrappedText(page, intro, 84, introStartY, 470, regularFont, 12, 16);
    currentY -= 12;
    page.drawText("Document", { x: 84, y: currentY, size: 12, font: boldFont });
    page.drawText("Page(s)", { x: 500, y: currentY, size: 12, font: boldFont });
    currentY -= 22;
    var tableBottom = 90;
    var rowHeight = 30;
    var index = 0;
    while (index < tocEntries.length) {
        if (currentY < tableBottom) {
            page = pdf.addPage([612, 792]);
            pages.push(page);
            drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false);
            drawCentered(page, boldFont, "DOCUMENT INDEX (CONT.)", 14, 724);
            page.drawText("Document", { x: 84, y: 692, size: 12, font: boldFont });
            page.drawText("Page(s)", { x: 500, y: 692, size: 12, font: boldFont });
            currentY = 666;
        }
        var entry = tocEntries[index];
        var left = "".concat(index + 1, ". ").concat(formatTocDocumentLabel(entry));
        var right = "Pg. ".concat(formatPageRange(entry.startPage, entry.endPage));
        drawTocRow(page, regularFont, left, right, currentY);
        currentY -= rowHeight;
        index += 1;
    }
    return pages.length;
}
function addAffirmationPage(pdf, regularFont, boldFont, options, frontMatterPageNumber) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var page = pdf.addPage([612, 792]);
    drawPleadingPaper(page, regularFont, options.firmBlockLines, frontMatterPageNumber, false);
    var tpl = options.template;
    drawCentered(page, boldFont, (_a = tpl === null || tpl === void 0 ? void 0 : tpl.affirmationTitle) !== null && _a !== void 0 ? _a : "AFFIRMATION", 14, 726);
    var serviceDate = ((_b = options.service) === null || _b === void 0 ? void 0 : _b.serviceDate) || new Date().toLocaleDateString("en-US");
    var affirmationTextRaw = (_c = tpl === null || tpl === void 0 ? void 0 : tpl.affirmationText) !== null && _c !== void 0 ? _c : "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.";
    var affirmationText = interpolateTemplateText(affirmationTextRaw, options.caption);
    var y = drawWrappedText(page, affirmationText, 84, 702, 470, regularFont, 11, 14);
    y -= 20;
    page.drawText("Dated: ".concat(serviceDate), { x: 84, y: y, size: 11, font: regularFont });
    var signY = y - 65;
    var signerDisplayName = options.signerName || options.caption.introductoryCounselLine || "";
    var signerLines = [
        "Claimant's Counsel",
        signerDisplayName,
    ].filter(Boolean);
    // When firm info belongs in the signature block (not the page header),
    // append the firm block lines below the signer name.
    if ((tpl === null || tpl === void 0 ? void 0 : tpl.firmBlockPosition) === "signature" && options.firmBlockLines) {
        var cleaned = options.firmBlockLines
            .map(function (l) { return l.trim().replace(/\[[^\]]+\]/g, "").trim(); })
            .filter(function (l) { return l && !/not configured/i.test(l); });
        // Skip lines that duplicate the signer name already shown
        for (var _i = 0, cleaned_1 = cleaned; _i < cleaned_1.length; _i++) {
            var line = cleaned_1[_i];
            if (signerDisplayName && line.toLowerCase() === signerDisplayName.toLowerCase())
                continue;
            signerLines.push(line);
        }
    }
    var signerAlign = (_d = tpl === null || tpl === void 0 ? void 0 : tpl.signerBlockAlign) !== null && _d !== void 0 ? _d : "right";
    var signerX = signerAlign === "left" ? 84 : 360;
    var sigLineY = signY;
    for (var _k = 0, signerLines_1 = signerLines; _k < signerLines_1.length; _k++) {
        var line = signerLines_1[_k];
        page.drawText(line, { x: signerX, y: sigLineY, size: 10.5, font: regularFont });
        sigLineY -= 14;
    }
    drawCentered(page, boldFont, (_e = tpl === null || tpl === void 0 ? void 0 : tpl.certTitle) !== null && _e !== void 0 ? _e : "CERTIFICATE OF SERVICE", 13, 430);
    var serviceIntroRaw = (_f = tpl === null || tpl === void 0 ? void 0 : tpl.certIntro) !== null && _f !== void 0 ? _f : "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:";
    var serviceIntro = interpolateTemplateText(serviceIntroRaw, options.caption);
    y = drawWrappedText(page, serviceIntro, 84, 406, 470, regularFont, 11, 14);
    y -= 12;
    var method = ((_g = options.service) === null || _g === void 0 ? void 0 : _g.serviceMethod) || "[x] Via E-File";
    page.drawText(method, { x: 84, y: y, size: 11, font: regularFont });
    y -= 18;
    var recipients = ((_h = options.service) === null || _h === void 0 ? void 0 : _h.recipients) && options.service.recipients.length > 0
        ? options.service.recipients
        : ["Recipient details to be provided by counsel."];
    for (var _l = 0, recipients_2 = recipients; _l < recipients_2.length; _l++) {
        var recipient = recipients_2[_l];
        y = drawWrappedText(page, recipient, 104, y, 430, regularFont, 10.5, 13);
        y -= 8;
    }
    y -= 8;
    page.drawText("Dated: ".concat(serviceDate), { x: 84, y: y, size: 11, font: regularFont });
    y -= 34;
    page.drawText(((_j = options.service) === null || _j === void 0 ? void 0 : _j.servedBy) || "An employee of counsel", { x: 84, y: y, size: 10.5, font: regularFont });
    return 1;
}
function drawPleadingPaper(page, font, firmBlockLines, pageNumber, showFirmBlock, doubleLeftLine, rightLine) {
    var _a;
    if (showFirmBlock === void 0) { showFirmBlock = true; }
    if (doubleLeftLine === void 0) { doubleLeftLine = false; }
    if (rightLine === void 0) { rightLine = false; }
    var top = 760;
    var bottom = 76;
    var totalLines = 28;
    var spacing = (top - bottom) / (totalLines - 1);
    for (var line = 1; line <= totalLines; line += 1) {
        var y = top - (line - 1) * spacing;
        var label = line.toString();
        var width = font.widthOfTextAtSize(label, 9);
        page.drawText(label, {
            x: 46 - width,
            y: y - 3,
            size: 9,
            font: font,
            color: (0, pdf_lib_1.rgb)(0.25, 0.25, 0.25),
        });
    }
    page.drawLine({
        start: { x: 52, y: bottom - 10 },
        end: { x: 52, y: top + 8 },
        thickness: 0.5,
        color: (0, pdf_lib_1.rgb)(0.7, 0.7, 0.7),
    });
    if (doubleLeftLine) {
        page.drawLine({
            start: { x: 58, y: bottom - 10 },
            end: { x: 58, y: top + 8 },
            thickness: 0.5,
            color: (0, pdf_lib_1.rgb)(0.7, 0.7, 0.7),
        });
    }
    if (rightLine) {
        page.drawLine({
            start: { x: 556, y: bottom - 10 },
            end: { x: 556, y: top + 8 },
            thickness: 0.5,
            color: (0, pdf_lib_1.rgb)(0.7, 0.7, 0.7),
        });
    }
    var firmBlockBottomY;
    if (showFirmBlock) {
        var providedFirmLines = (firmBlockLines || [])
            .map(function (line) { return line.trim(); })
            .map(function (line) { return line.replace(/\[[^\]]+\]/g, "").trim(); })
            .map(function (line) { return (/not configured/i.test(line) ? "" : line); });
        // Keep a consistent 7-line attorney block footprint in the top-left.
        // If firm data is missing, preserve blank lines instead of injecting fallback text.
        var attorneyBlockLineCount = 7;
        var visibleFirmLines = [];
        for (var i = 0; i < attorneyBlockLineCount; i += 1) {
            visibleFirmLines.push((_a = providedFirmLines[i]) !== null && _a !== void 0 ? _a : "");
        }
        var blockLineHeight = 12.5;
        // Keep the full attorney block inside page bounds and above the caption.
        // Previous anchoring was too high and could clip the top lines.
        var firmY = 758;
        for (var _i = 0, visibleFirmLines_1 = visibleFirmLines; _i < visibleFirmLines_1.length; _i++) {
            var line = visibleFirmLines_1[_i];
            if (line) {
                page.drawText(line, {
                    x: 60,
                    y: firmY,
                    size: 12,
                    font: font,
                    color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
                });
            }
            firmY -= blockLineHeight;
        }
        firmBlockBottomY = firmY + blockLineHeight;
    }
    page.drawText(String(pageNumber), {
        x: 565,
        y: 24,
        size: 10,
        font: font,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
    return firmBlockBottomY;
}
function drawRightField(page, labelFont, valueFont, x, y, label, value, size) {
    if (size === void 0) { size = 10; }
    page.drawText(label, { x: x, y: y, size: size, font: labelFont });
    page.drawText(value, { x: x + 76, y: y, size: size, font: valueFont });
}
function drawCentered(page, font, text, size, y) {
    var width = page.getWidth();
    var textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
        x: (width - textWidth) / 2,
        y: y,
        size: size,
        font: font,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
}
function drawWrappedText(page, text, x, y, maxWidth, font, size, lineHeight) {
    var paragraphs = text.split(/\n+/);
    var cursorY = y;
    for (var _i = 0, paragraphs_2 = paragraphs; _i < paragraphs_2.length; _i++) {
        var paragraph = paragraphs_2[_i];
        var words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            cursorY -= lineHeight;
            continue;
        }
        var line = "";
        for (var _a = 0, words_2 = words; _a < words_2.length; _a++) {
            var word = words_2[_a];
            var candidate = line ? "".concat(line, " ").concat(word) : word;
            var width = font.widthOfTextAtSize(candidate, size);
            if (width <= maxWidth) {
                line = candidate;
            }
            else {
                if (line) {
                    page.drawText(line, { x: x, y: cursorY, size: size, font: font });
                    cursorY -= lineHeight;
                }
                line = word;
            }
        }
        if (line) {
            page.drawText(line, { x: x, y: cursorY, size: size, font: font });
            cursorY -= lineHeight;
        }
    }
    return cursorY;
}
function drawTocRow(page, font, left, right, y) {
    var size = 12;
    var leftX = 84;
    var rightX = 500;
    var maxLeftWidth = rightX - leftX - 40;
    var safeLeft = truncateToWidth(left, font, size, maxLeftWidth);
    var leftWidth = font.widthOfTextAtSize(safeLeft, size);
    page.drawText(safeLeft, { x: leftX, y: y, size: size, font: font });
    // Keep page refs left-aligned under the "P" in "Page(s)".
    page.drawText(right, { x: rightX, y: y, size: size, font: font });
    var dotWidth = font.widthOfTextAtSize(".", size);
    var dotsStart = leftX + leftWidth + 4;
    var dotsEnd = rightX - 4;
    if (dotsEnd > dotsStart + dotWidth * 3) {
        var count = Math.floor((dotsEnd - dotsStart) / dotWidth);
        page.drawText(".".repeat(Math.max(3, count)), { x: dotsStart, y: y, size: size, font: font });
    }
}
function drawCaptionDivider(page, font, yOffset) {
    if (yOffset === void 0) { yOffset = 0; }
    var dividerX = 336;
    var topY = 708 - yOffset;
    var bottomY = 618 - yOffset;
    var parenSpacing = 14;
    for (var y = topY - 2; y >= bottomY + 2; y -= parenSpacing) {
        page.drawText(")", { x: dividerX, y: y, size: 11, font: font });
    }
    // Match court index style: only a bottom rule ending at the parenthesis column.
    page.drawLine({
        start: { x: 84, y: bottomY },
        end: { x: dividerX - 6, y: bottomY },
        thickness: 0.4,
        color: (0, pdf_lib_1.rgb)(0.72, 0.72, 0.72),
    });
}
function truncateToWidth(text, font, size, maxWidth) {
    if (font.widthOfTextAtSize(text, size) <= maxWidth)
        return text;
    var value = text;
    while (value.length > 3 && font.widthOfTextAtSize("".concat(value, "..."), size) > maxWidth) {
        value = value.slice(0, -1);
    }
    return "".concat(value, "...");
}
function formatPageRange(start, end) {
    return start === end ? "".concat(start) : "".concat(start, "-").concat(end);
}
function formatTocDocumentLabel(entry) {
    var title = (entry.title || "").trim();
    var date = (entry.date || "").trim();
    if (!date)
        return title;
    if (title.toLowerCase().includes(date.toLowerCase()))
        return title;
    return "".concat(title, " - ").concat(date);
}
function stampExhibitPageNumber(page, font, label, pageRotation) {
    if (pageRotation === void 0) { pageRotation = 0; }
    var size = 11;
    var _a = page.getSize(), width = _a.width, height = _a.height;
    var textWidth = font.widthOfTextAtSize(label, size);
    var margin = 18;
    // Normalize to 0, 90, 180, or 270.
    var rotation = ((pageRotation % 360) + 360) % 360;
    // For rotated pages the viewer applies /Rotate after rendering the content
    // stream, so the stamp coordinates must be in the *unrotated* coordinate
    // space at a position that maps to the displayed bottom-center.
    var x;
    var y;
    var textRotate = (0, pdf_lib_1.degrees)(0);
    switch (rotation) {
        case 90:
            // Displayed bottom = unrotated right edge
            x = width - margin;
            y = (height - textWidth) / 2;
            textRotate = (0, pdf_lib_1.degrees)(90);
            break;
        case 180:
            // Displayed bottom = unrotated top edge
            x = (width + textWidth) / 2;
            y = height - margin;
            textRotate = (0, pdf_lib_1.degrees)(180);
            break;
        case 270:
            // Displayed bottom = unrotated left edge
            x = margin;
            y = (height + textWidth) / 2;
            textRotate = (0, pdf_lib_1.degrees)(-90);
            break;
        default:
            x = (width - textWidth) / 2;
            y = margin;
            break;
    }
    page.drawText(label, {
        x: x,
        y: y,
        size: size,
        font: font,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
        rotate: textRotate,
    });
}
function formatError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Merge split template tags in DOCX XML.
 *
 * Word often splits `{{variable}}` across multiple `<w:r>` runs in the XML,
 * e.g. `<w:r><w:t>{{firm</w:t></w:r><w:r><w:t>City}}</w:t></w:r>`.
 * docxtemplater can't parse these split tags and throws "duplicate open/close tag"
 * errors. This function merges adjacent runs whose combined text forms template
 * tags, writing the cleaned XML back to the zip before docxtemplater sees it.
 */
function mergeDocxTemplateRuns(zip) {
    var xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
    for (var _i = 0, xmlFiles_1 = xmlFiles; _i < xmlFiles_1.length; _i++) {
        var xmlPath = xmlFiles_1[_i];
        var file = zip.file(xmlPath);
        if (!file)
            continue;
        var xml = file.asText();
        // Process each paragraph — template tags should not span paragraphs
        xml = xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, function (paragraph) {
            // Extract all <w:r>...</w:r> runs in this paragraph
            var runRegex = /<w:r[\s>][\s\S]*?<\/w:r>/g;
            var runs = [];
            var m;
            while ((m = runRegex.exec(paragraph)) !== null) {
                runs.push({ match: m[0], index: m.index });
            }
            if (runs.length < 2)
                return paragraph;
            // Extract text from a run's <w:t> element
            var getRunText = function (run) {
                var tMatch = run.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
                return tMatch ? tMatch[1] : "";
            };
            // Check if we need to merge anything — look for split {{ or }} across runs
            var allText = runs.map(function (r) { return getRunText(r.match); }).join("");
            if (!allText.includes("{{") && !allText.includes("}}"))
                return paragraph;
            // Walk through runs and find groups that need merging
            // A group needs merging when combined text contains a {{ or }} that
            // no single run contains on its own (i.e. the delimiter is split)
            var mergedRuns = [];
            var i = 0;
            while (i < runs.length) {
                var startText = getRunText(runs[i].match);
                // Check if this run has an unclosed {{ (opened but not closed)
                // or starts mid-tag (has }} without a prior {{)
                var combined = startText;
                var groupEnd = i;
                // Count open/close delimiters to detect split tags
                var needsMerge = function (text) {
                    var depth = 0;
                    for (var ci = 0; ci < text.length - 1; ci++) {
                        if (text[ci] === "{" && text[ci + 1] === "{") {
                            depth++;
                            ci++;
                        }
                        else if (text[ci] === "}" && text[ci + 1] === "}") {
                            depth--;
                            ci++;
                        }
                    }
                    return depth !== 0;
                };
                if (needsMerge(combined)) {
                    // Extend the group until delimiters are balanced
                    while (groupEnd + 1 < runs.length && needsMerge(combined)) {
                        groupEnd++;
                        combined += getRunText(runs[groupEnd].match);
                    }
                    if (groupEnd > i) {
                        // Merge: put all text into the first run's <w:t>, remove others
                        var firstRun = runs[i].match;
                        var escapedCombined = combined
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");
                        // Replace the <w:t> content in the first run (or add one)
                        var mergedRun = void 0;
                        if (/<w:t[^>]*>/.test(firstRun)) {
                            mergedRun = firstRun.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, "<w:t xml:space=\"preserve\">".concat(escapedCombined, "</w:t>"));
                        }
                        else {
                            // Shouldn't happen, but handle gracefully
                            mergedRun = firstRun.replace(/<\/w:r>/, "<w:t xml:space=\"preserve\">".concat(escapedCombined, "</w:t></w:r>"));
                        }
                        mergedRuns.push({ match: mergedRun, index: runs[i].index });
                        // Skip the merged runs — they'll be removed
                        for (var j = i + 1; j <= groupEnd; j++) {
                            mergedRuns.push({ match: "", index: runs[j].index }); // mark for removal
                        }
                        i = groupEnd + 1;
                        continue;
                    }
                }
                mergedRuns.push(runs[i]);
                i++;
            }
            // Rebuild the paragraph by replacing runs
            // Work backwards to preserve indices
            var result = paragraph;
            for (var ri = mergedRuns.length - 1; ri >= 0; ri--) {
                var original = runs[ri];
                var merged = mergedRuns[ri];
                if (merged.match === "" && original.match !== "") {
                    // Remove this run
                    result =
                        result.slice(0, original.index) +
                            result.slice(original.index + original.match.length);
                }
                else if (merged.match !== original.match) {
                    // Replace this run
                    result =
                        result.slice(0, original.index) +
                            merged.match +
                            result.slice(original.index + original.match.length);
                }
            }
            return result;
        });
        zip.file(xmlPath, xml);
    }
}
/**
 * Native DOCX Front Matter Generation
 * Fulfills a DOCX master template with exact case data using docxtemplater,
 * and then converts the resulting DOCX to PDF using macOS's built-in `cupsfilter`.
 * This preserves perfect pleading paper fidelity.
 */
function buildDocxFrontMatter(template, caption, service, tocEntries, firmName, resolveDocPath) {
    return __awaiter(this, void 0, void 0, function () {
        var os, match, sourceRelative, masterPath, masterBytes, err_2, serviceMonth, serviceYear, serviceDay, docxData, zip, doc, fulfilledBuffer, tmpDir, inputPath, outputPath, macOsPath, isMac, cmd, pdfBuffer, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("os"); })];
                case 1:
                    os = _a.sent();
                    if (!template.sourceFile) {
                        throw new Error("Template missing sourceFile property");
                    }
                    match = template.sourceFile.match(/source\/(.+)$/);
                    sourceRelative = match ? match[1] : template.sourceFile;
                    masterPath = resolveDocPath((0, path_2.join)(".ai_tool", "templates", "source", sourceRelative));
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, promises_1.readFile)(masterPath)];
                case 3:
                    masterBytes = _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    err_2 = _a.sent();
                    throw new Error("Failed to load master DOCX template at ".concat(masterPath, ": ").concat(formatError(err_2)));
                case 5:
                    serviceMonth = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).toLocaleString('default', { month: 'long' })
                        : "";
                    serviceYear = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).getFullYear().toString()
                        : "";
                    serviceDay = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).getDate().toString()
                        : "";
                    docxData = __assign({ claimantName: caption.claimantName || "", claimNumber: caption.claimNumber || "", hearingNumber: caption.hearingNumber || "", hearingDateTime: caption.hearingDateTime || "", firmName: firmName || "Our Firm", appearance: caption.appearance || "", currentDate: new Date().toLocaleDateString(), serviceMonth: serviceMonth, serviceYear: serviceYear, serviceDay: serviceDay, blankVariable: "___________________________" }, caption.captionValues);
                    zip = new pizzip_1.default(masterBytes);
                    mergeDocxTemplateRuns(zip); // fix Word-split template tags before docxtemplater parses
                    doc = new docxtemplater_1.default(zip, {
                        paragraphLoop: true,
                        linebreaks: true,
                    });
                    doc.render(docxData);
                    fulfilledBuffer = doc.getZip().generate({
                        type: "nodebuffer",
                        compression: "DEFLATE",
                    });
                    return [4 /*yield*/, (0, promises_2.mkdtemp)((0, path_2.join)(os.tmpdir(), "packet-gen-"))];
                case 6:
                    tmpDir = _a.sent();
                    inputPath = (0, path_2.join)(tmpDir, "input.docx");
                    outputPath = (0, path_2.join)(tmpDir, "output.pdf");
                    _a.label = 7;
                case 7:
                    _a.trys.push([7, , 10, 14]);
                    return [4 /*yield*/, (0, promises_2.writeFile)(inputPath, fulfilledBuffer)];
                case 8:
                    _a.sent();
                    macOsPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
                    isMac = os.platform() === "darwin";
                    cmd = isMac ? macOsPath : "libreoffice";
                    try {
                        (0, child_process_1.execFileSync)(cmd, ["--headless", "--convert-to", "pdf", "input.docx"], {
                            cwd: tmpDir,
                            stdio: "ignore", // LibreOffice prints to stdout/stderr
                        });
                    }
                    catch (e) {
                        // Fallback to checking the system PATH just in case it's named 'soffice' or 'libreoffice'
                        try {
                            (0, child_process_1.execFileSync)(isMac ? "libreoffice" : "soffice", ["--headless", "--convert-to", "pdf", "input.docx"], {
                                cwd: tmpDir,
                                stdio: "ignore",
                            });
                        }
                        catch (e2) {
                            throw new Error("Failed to convert DOCX to PDF. Please ensure LibreOffice is installed. Initial error: ".concat(e.message));
                        }
                    }
                    return [4 /*yield*/, (0, promises_1.readFile)(outputPath)];
                case 9:
                    pdfBuffer = _a.sent();
                    return [2 /*return*/, new Uint8Array(pdfBuffer)];
                case 10:
                    _a.trys.push([10, 12, , 13]);
                    return [4 /*yield*/, (0, promises_2.rm)(tmpDir, { recursive: true, force: true })];
                case 11:
                    _a.sent();
                    return [3 /*break*/, 13];
                case 12:
                    e_1 = _a.sent();
                    console.warn("Failed to cleanup tmp dir ".concat(tmpDir));
                    return [3 /*break*/, 13];
                case 13: return [7 /*endfinally*/];
                case 14: return [2 /*return*/];
            }
        });
    });
}
/**
 * Native PDF Front Matter Generation
 * Fulfills a PDF master template with exact case data using `pdf-lib` and AI BBox coordinates.
 */
function buildPdfFrontMatter(template, caption, service, tocEntries, firmName, resolveDocPath) {
    return __awaiter(this, void 0, void 0, function () {
        var match, sourceRelative, basenameStr, coordsPath, masterPath, coordsMap, coordsStr, e_2, masterBytes, pdf, font, serviceMonth, serviceYear, serviceDay, renderData, pages, fontSize, _i, _a, _b, varName, varValue, coord, pageIndex, page, pageHeight, pdfLibY;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!template.sourceFile) {
                        throw new Error("Template missing sourceFile property");
                    }
                    match = template.sourceFile.match(/source\/(.+)$/);
                    sourceRelative = match ? match[1] : template.sourceFile;
                    basenameStr = sourceRelative.replace(/\.[^/.]+$/, "");
                    coordsPath = resolveDocPath((0, path_2.join)(".ai_tool", "templates", "parsed", "".concat(basenameStr, "-coords.json")));
                    masterPath = resolveDocPath((0, path_2.join)(".ai_tool", "templates", "source", sourceRelative));
                    coordsMap = {};
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(coordsPath, "utf-8")];
                case 2:
                    coordsStr = _c.sent();
                    coordsMap = JSON.parse(coordsStr);
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _c.sent();
                    console.warn("Missing or invalid coordinate map for PDF template: ".concat(coordsPath, ". Variables will not be injected into the PDF."));
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, (0, promises_1.readFile)(masterPath)];
                case 5:
                    masterBytes = _c.sent();
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.load(masterBytes)];
                case 6:
                    pdf = _c.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRoman)];
                case 7:
                    font = _c.sent();
                    serviceMonth = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).toLocaleString('default', { month: 'long' })
                        : "";
                    serviceYear = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).getFullYear().toString()
                        : "";
                    serviceDay = (service === null || service === void 0 ? void 0 : service.serviceDate)
                        ? new Date(service.serviceDate).getDate().toString()
                        : "";
                    renderData = __assign({ claimantName: caption.claimantName || "", claimNumber: caption.claimNumber || "", hearingNumber: caption.hearingNumber || "", hearingDateTime: caption.hearingDateTime || "", firmName: firmName || "Our Firm", appearance: caption.appearance || "", currentDate: new Date().toLocaleDateString(), serviceMonth: serviceMonth, serviceYear: serviceYear, serviceDay: serviceDay }, caption.captionValues);
                    pages = pdf.getPages();
                    fontSize = 12;
                    // Render variables to physical locations
                    for (_i = 0, _a = Object.entries(renderData); _i < _a.length; _i++) {
                        _b = _a[_i], varName = _b[0], varValue = _b[1];
                        coord = coordsMap[varName];
                        if (coord && typeof varValue === "string" && varValue) {
                            pageIndex = coord.page - 1;
                            if (pageIndex >= 0 && pageIndex < pages.length) {
                                page = pages[pageIndex];
                                pageHeight = page.getHeight();
                                pdfLibY = pageHeight - coord.y - coord.height;
                                // Optionally, we could draw a white box under the text to hide literal template variables 
                                // if the PDF contains physical placeholder text like "[CLAIMANT]".
                                // page.drawRectangle({
                                //   x: coord.x, y: pdfLibY, width: coord.width, height: coord.height, color: rgb(1,1,1)
                                // });
                                page.drawText(varValue, {
                                    x: coord.x,
                                    y: pdfLibY + 2, // Minor optical baseline adjustment
                                    size: fontSize,
                                    font: font,
                                    color: (0, pdf_lib_1.rgb)(0, 0, 0),
                                });
                            }
                        }
                    }
                    // TODO: Add DOCX TOC Entries and Service appending logic to End of PDF if required
                    return [2 /*return*/, pdf.save()];
            }
        });
    });
}
