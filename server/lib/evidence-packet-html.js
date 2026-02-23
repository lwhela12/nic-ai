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
exports.interpolateTemplate = interpolateTemplate;
exports.buildDocumentIndexHtml = buildDocumentIndexHtml;
exports.buildAffirmationHtml = buildAffirmationHtml;
exports.buildFirmBlockHtml = buildFirmBlockHtml;
exports.wrapWithPleadingCss = wrapWithPleadingCss;
exports.renderHtmlFrontMatter = renderHtmlFrontMatter;
var export_1 = require("./export");
/**
 * HTML-template-driven evidence packet front matter rendering.
 *
 * Custom templates that carry an `htmlTemplate` field are rendered through
 * Puppeteer (via `htmlToPdf`) instead of the pdf-lib code path, so the
 * user's uploaded layout is preserved.
 */
// ---------------------------------------------------------------------------
// Placeholder interpolation
// ---------------------------------------------------------------------------
function interpolateTemplate(html, values) {
    return html.replace(/\{\{(\w+)\}\}/g, function (match, key) {
        var _a;
        return (_a = values[key]) !== null && _a !== void 0 ? _a : match;
    });
}
// ---------------------------------------------------------------------------
// Document index table (HTML)
// ---------------------------------------------------------------------------
function formatPageRange(start, end) {
    return start === end ? "".concat(start) : "".concat(start, "-").concat(end);
}
function formatTocLabel(entry, index) {
    var title = (entry.title || "").trim();
    var date = (entry.date || "").trim();
    var label = date && !title.toLowerCase().includes(date.toLowerCase())
        ? "".concat(title, " - ").concat(date)
        : title;
    return "".concat(index + 1, ". ").concat(label);
}
function buildDocumentIndexHtml(tocEntries, indexTitle, counselPreamble) {
    var rows = tocEntries
        .map(function (entry, i) {
        var label = formatTocLabel(entry, i);
        var pages = "Pg. ".concat(formatPageRange(entry.startPage, entry.endPage));
        return "<tr><td class=\"toc-doc\">".concat(escapeHtml(label), "</td><td class=\"toc-pages\">").concat(escapeHtml(pages), "</td></tr>");
    })
        .join("\n");
    var preambleHtml = counselPreamble
        ? "\n  <p class=\"counsel-preamble\">".concat(escapeHtml(counselPreamble), "</p>")
        : "";
    return "\n<div class=\"document-index-section\">\n  <h2 class=\"section-title\">".concat(escapeHtml(indexTitle), "</h2>").concat(preambleHtml, "\n  <table class=\"toc-table\">\n    <thead>\n      <tr><th class=\"toc-doc-header\">Document</th><th class=\"toc-pages-header\">Page(s)</th></tr>\n    </thead>\n    <tbody>\n      ").concat(rows, "\n    </tbody>\n  </table>\n</div>");
}
// ---------------------------------------------------------------------------
// Affirmation + Certificate of Service (HTML)
// ---------------------------------------------------------------------------
function buildAffirmationHtml(options) {
    var recipientItems = options.recipients.length > 0
        ? options.recipients.map(function (r) { return "<p class=\"recipient\">".concat(escapeHtml(r), "</p>"); }).join("\n")
        : "<p class=\"recipient\">Recipient details to be provided by counsel.</p>";
    var signerAlign = options.signerBlockAlign === "left" ? "left" : "right";
    var signatureFirmBlock = (options.signatureFirmBlock || "").trim()
        ? "<div class=\"signature-firm-block\">".concat(options.signatureFirmBlock, "</div>")
        : "";
    var signerClass = "signer-block signer-block-".concat(signerAlign);
    var signerStyle = "text-align: ".concat(signerAlign, ";");
    return "\n<div class=\"affirmation-section\" style=\"page-break-before: always;\">\n  <h2 class=\"section-title\">".concat(escapeHtml(options.affirmationTitle), "</h2>\n  <p>").concat(escapeHtml(options.affirmationText), "</p>\n  <p class=\"dated-line\">Dated: ").concat(escapeHtml(options.serviceDate), "</p>\n\n  <div class=\"").concat(signerClass, "\" style=\"").concat(signerStyle, "\">\n    <p>Claimant's Counsel</p>\n    <p>").concat(escapeHtml(options.signerName), "</p>\n    ").concat(signatureFirmBlock, "\n  </div>\n\n  <h2 class=\"section-title cert-title\">").concat(escapeHtml(options.certTitle), "</h2>\n  <p>").concat(escapeHtml(options.certIntro), "</p>\n  <p class=\"service-method\">[x] ").concat(escapeHtml(options.serviceMethod), "</p>\n  ").concat(recipientItems, "\n  <p class=\"dated-line\">Dated: ").concat(escapeHtml(options.serviceDate), "</p>\n  <p class=\"served-by\">").concat(escapeHtml(options.servedBy || "An employee of counsel"), "</p>\n</div>");
}
// ---------------------------------------------------------------------------
// Firm block (HTML)
// ---------------------------------------------------------------------------
function buildFirmBlockHtml(firmBlockLines) {
    var lines = firmBlockLines.slice(0, 7);
    while (lines.length < 7)
        lines.push("");
    var divs = lines
        .map(function (line) {
        var cleaned = line.trim().replace(/\[[^\]]+\]/g, "").trim();
        var visible = /not configured/i.test(cleaned) ? "" : cleaned;
        return "<div class=\"firm-line\">".concat(visible ? escapeHtml(visible) : "&nbsp;", "</div>");
    })
        .join("\n");
    return "<div class=\"firm-block\">".concat(divs, "</div>");
}
function wrapWithPleadingCss(bodyHtml, extraCss, options) {
    var _a, _b;
    if (options === void 0) { options = {}; }
    var renderMode = (_a = options.renderMode) !== null && _a !== void 0 ? _a : "pleading-legacy";
    var suppressPleadingLineNumbers = (_b = options.suppressPleadingLineNumbers) !== null && _b !== void 0 ? _b : false;
    var isTemplateNative = renderMode === "template-native";
    var showPleadingGutter = !isTemplateNative || !suppressPleadingLineNumbers;
    var lineNumbers = Array.from({ length: 28 }, function (_, i) {
        return "<div class=\"pleading-line-number\">".concat(i + 1, "</div>");
    }).join("\n");
    return "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"UTF-8\">\n<style>\n  @page {\n    size: letter;\n    margin: 0.35in 0.35in 0.52in 0.35in;\n  }\n  * { box-sizing: border-box; }\n  body {\n    font-family: 'Times New Roman', Times, serif;\n    font-size: 12pt;\n    line-height: 1.4;\n    color: #000;\n    margin: 0;\n    padding: 0;\n  }\n\n".concat(showPleadingGutter ? "\n  /* Pleading paper gutter + line numbers */\n  .pleading-gutter {\n    position: fixed;\n    top: 1.05in;\n    bottom: 0.86in;\n    left: 0.14in;\n    width: 0.54in;\n    display: grid;\n    grid-template-rows: repeat(28, minmax(0, 1fr));\n    justify-items: end;\n    align-items: start;\n    z-index: 1;\n    pointer-events: none;\n    color: #111;\n    font-size: 9.5pt;\n    line-height: 1;\n  }\n  .pleading-gutter::after {\n    content: \"\";\n    position: absolute;\n    right: -0.08in;\n    top: -0.72in;\n    bottom: -0.26in;\n    border-right: 1px solid #000;\n  }\n  .pleading-line-number {\n    padding-right: 0.09in;\n    font-variant-numeric: tabular-nums;\n    white-space: nowrap;\n  }" : "", "\n\n  /* Main content area */\n  .pleading-content {\n    margin-left: ").concat(showPleadingGutter ? "0.60in" : "0in", ";\n    margin-right: 0.30in;\n    padding-top: 0.38in;\n  }\n\n  /* Firm block \u2013 top-left of first page */\n  .firm-block {\n    margin-bottom: 12pt;\n    font-size: 12pt;\n    color: #333;\n  }\n  .firm-line {\n    line-height: 1.08;\n    min-height: 12.5pt;\n  }\n\n  /* Section titles */\n  .section-title {\n    text-align: center;\n    font-size: 14pt;\n    font-weight: bold;\n    margin: 16pt 0 10pt;\n  }\n\n  /* Counsel preamble */\n  .counsel-preamble {\n    margin: 12pt 0;\n    text-align: justify;\n  }\n\n  /* TOC table with dot leaders */\n  .toc-table {\n    width: 100%;\n    border-collapse: collapse;\n    margin: 8pt 0;\n  }\n  .toc-table th {\n    text-align: left;\n    font-weight: bold;\n    font-size: 12pt;\n    padding-bottom: 6pt;\n    border-bottom: none;\n  }\n  .toc-pages-header {\n    text-align: right;\n    width: 80pt;\n  }\n  .toc-table td {\n    padding: 4pt 0;\n    vertical-align: top;\n    border: none;\n  }\n  .toc-doc {\n    padding-right: 12pt;\n  }\n  .toc-pages {\n    text-align: right;\n    white-space: nowrap;\n    width: 80pt;\n  }\n\n  /* Caption two-column layout */\n  .caption-grid {\n    display: flex;\n    margin: 8pt 0 12pt;\n    font-size: 12pt;\n  }\n  .caption-left {\n    flex: 1;\n    max-width: 52%;\n  }\n  .caption-divider {\n    width: 20pt;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    font-size: 11pt;\n    line-height: 1.4;\n    color: #666;\n  }\n  .caption-right {\n    flex: 1;\n    padding-left: 4pt;\n  }\n  .caption-field {\n    margin-bottom: 6pt;\n  }\n  .caption-field-label {\n    font-weight: bold;\n  }\n  .caption-vs {\n    margin: 4pt 0;\n  }\n\n  /* Affirmation section */\n  .affirmation-section .dated-line {\n    margin-top: 16pt;\n    margin-bottom: 6pt;\n  }\n  .dated-line {\n    margin-top: 16pt;\n    margin-bottom: 6pt;\n  }\n  .signer-block {\n    text-align: right;\n    margin-top: 40pt;\n    margin-bottom: 24pt;\n    font-size: 10.5pt;\n  }\n  .signer-block-left {\n    text-align: left;\n  }\n  .signer-block-right {\n    text-align: right;\n  }\n  .signature-firm-block {\n    margin-top: 12pt;\n  }\n  .cert-title {\n    margin-top: 24pt;\n  }\n  .service-method {\n    margin: 8pt 0;\n  }\n  .recipient {\n    margin: 4pt 0 4pt 20pt;\n    font-size: 10.5pt;\n  }\n  .served-by {\n    margin-top: 28pt;\n    font-size: 10.5pt;\n  }\n\n  ").concat(extraCss || "", "\n</style>\n</head>\n<body>\n").concat(showPleadingGutter ? "\n  <div class=\"pleading-gutter\" aria-hidden=\"true\">\n    ".concat(lineNumbers, "\n  </div>") : "", "\n  <div class=\"pleading-content\">\n    ").concat(bodyHtml, "\n  </div>\n</body>\n</html>");
}
function renderHtmlFrontMatter(options, tocEntries) {
    return __awaiter(this, void 0, void 0, function () {
        var tpl, values, _i, _a, _b, k, v, _c, _d, _e, k, v, serviceDate, firmBlock, firmPos, signatureFirmBlock, counselPreambleRaw, counselPreamble, templateAlreadyHasPreamble, effectivePreamble, documentIndexHtml, affirmationHtml, htmlBody, templateHasDocumentIndexHeading, templateHandlesAffirmation, fullHtml;
        var _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        return __generator(this, function (_s) {
            tpl = options.template;
            values = {
                claimantName: options.caption.claimantName || "",
                claimNumber: options.caption.claimNumber || "",
                hearingNumber: options.caption.hearingNumber || "",
                hearingDateTime: options.caption.hearingDateTime || "",
                appearance: options.caption.appearance || "",
                signerName: options.signerName || options.caption.introductoryCounselLine || "",
            };
            // Merge captionValues (custom template fields)
            if (options.caption.captionValues) {
                for (_i = 0, _a = Object.entries(options.caption.captionValues); _i < _a.length; _i++) {
                    _b = _a[_i], k = _b[0], v = _b[1];
                    if (!(k in values))
                        values[k] = v;
                }
            }
            // Merge extra section values
            if (options.extraSectionValues) {
                for (_c = 0, _d = Object.entries(options.extraSectionValues); _c < _d.length; _c++) {
                    _e = _d[_c], k = _e[0], v = _e[1];
                    values[k] = v;
                }
            }
            serviceDate = ((_f = options.service) === null || _f === void 0 ? void 0 : _f.serviceDate) || new Date().toLocaleDateString("en-US");
            values.serviceDate = serviceDate;
            values.serviceMethod = ((_g = options.service) === null || _g === void 0 ? void 0 : _g.serviceMethod) || "Via E-File";
            values.servedBy = ((_h = options.service) === null || _h === void 0 ? void 0 : _h.servedBy) || "An employee of counsel";
            if (((_j = options.service) === null || _j === void 0 ? void 0 : _j.recipients) && options.service.recipients.length > 0) {
                values.recipients = options.service.recipients.map(function (r) { return "<p class=\"recipient\">".concat(escapeHtml(r), "</p>"); }).join("\n");
            }
            else {
                values.recipients = "<p class=\"recipient\">Recipient details to be provided by counsel.</p>";
            }
            firmBlock = options.firmBlockLines
                ? buildFirmBlockHtml(options.firmBlockLines)
                : "";
            firmPos = (_k = tpl.firmBlockPosition) !== null && _k !== void 0 ? _k : "header";
            signatureFirmBlock = firmPos === "signature" ? firmBlock : "";
            // Build firm block (backward-compatible placeholder when template expects
            // `{{firmBlock}}` while intentionally using signature placement).
            if (options.firmBlockLines) {
                if (firmPos === "header") {
                    values.firmBlock = firmBlock;
                    values.signatureFirmBlock = "";
                }
                else {
                    values.firmBlock = "";
                    values.signatureFirmBlock = firmBlock;
                }
            }
            else {
                values.firmBlock = "";
                values.signatureFirmBlock = "";
            }
            counselPreambleRaw = tpl.counselPreamble
                || "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.";
            counselPreamble = counselPreambleRaw.replace(/\{\{claimantName\}\}/g, options.caption.claimantName);
            templateAlreadyHasPreamble = /comes\s+now/i.test(tpl.htmlTemplate);
            effectivePreamble = templateAlreadyHasPreamble ? "" : counselPreamble;
            documentIndexHtml = buildDocumentIndexHtml(tocEntries, tpl.indexTitle || "DOCUMENT INDEX", effectivePreamble);
            values.documentIndex = documentIndexHtml;
            affirmationHtml = buildAffirmationHtml({
                affirmationTitle: tpl.affirmationTitle || "AFFIRMATION",
                affirmationText: tpl.affirmationText || "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
                certTitle: tpl.certTitle || "CERTIFICATE OF SERVICE",
                certIntro: tpl.certIntro || "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
                serviceDate: serviceDate,
                serviceMethod: ((_l = options.service) === null || _l === void 0 ? void 0 : _l.serviceMethod) || "Via E-File",
                recipients: ((_m = options.service) === null || _m === void 0 ? void 0 : _m.recipients) || [],
                signerName: values.signerName,
                signerBlockAlign: (_o = tpl.signerBlockAlign) !== null && _o !== void 0 ? _o : "right",
                signatureFirmBlock: signatureFirmBlock,
                servedBy: (_p = options.service) === null || _p === void 0 ? void 0 : _p.servedBy,
            });
            values.affirmationSection = affirmationHtml;
            htmlBody = interpolateTemplate(tpl.htmlTemplate, values);
            templateHasDocumentIndexHeading = /document\s*index/i.test(tpl.htmlTemplate);
            if (!tpl.htmlTemplate.includes("{{documentIndex}}") && !templateHasDocumentIndexHeading) {
                htmlBody += documentIndexHtml;
            }
            templateHandlesAffirmation = tpl.htmlTemplate.includes("{{affirmationSection}}")
                || /affirmation|certificate\s+of\s+(service|mailing)/i.test(tpl.htmlTemplate);
            if (options.includeAffirmationPage !== false && !templateHandlesAffirmation) {
                htmlBody += affirmationHtml;
            }
            fullHtml = wrapWithPleadingCss(htmlBody, tpl.htmlTemplateCss, {
                renderMode: (_q = tpl.renderMode) !== null && _q !== void 0 ? _q : "pleading-legacy",
                suppressPleadingLineNumbers: tpl.renderMode === "template-native"
                    ? ((_r = tpl.suppressPleadingLineNumbers) !== null && _r !== void 0 ? _r : true)
                    : false,
            });
            return [2 /*return*/, (0, export_1.htmlToPdf)(fullHtml, "front-matter", {
                    documentType: "hearing_decision",
                })];
        });
    });
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
