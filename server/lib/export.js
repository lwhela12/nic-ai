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
exports.loadFirmInfo = loadFirmInfo;
exports.buildAttorneyFirmBlockLines = buildAttorneyFirmBlockLines;
exports.markdownToHtml = markdownToHtml;
exports.htmlToDocx = htmlToDocx;
exports.markdownToHearingDecisionPdf = markdownToHearingDecisionPdf;
exports.htmlToPdf = htmlToPdf;
var marked_1 = require("marked");
var docx_1 = require("docx");
var puppeteer_1 = require("puppeteer");
var pdf_lib_1 = require("pdf-lib");
var promises_1 = require("fs/promises");
var path_1 = require("path");
// Load firm logo as base64
function loadFirmLogo(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var logoExtensions, _i, logoExtensions_1, ext, logoPath, logoBuffer, mimeType, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logoExtensions = ["png", "jpg", "jpeg"];
                    _i = 0, logoExtensions_1 = logoExtensions;
                    _a.label = 1;
                case 1:
                    if (!(_i < logoExtensions_1.length)) return [3 /*break*/, 6];
                    ext = logoExtensions_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    logoPath = (0, path_1.join)(firmRoot, ".ai_tool", "firm-logo.".concat(ext));
                    console.log("[Logo] Trying to load logo from: ".concat(logoPath));
                    return [4 /*yield*/, (0, promises_1.readFile)(logoPath)];
                case 3:
                    logoBuffer = _a.sent();
                    mimeType = ext === "png" ? "image/png" : "image/jpeg";
                    console.log("[Logo] Successfully loaded logo (".concat(logoBuffer.length, " bytes)"));
                    return [2 /*return*/, "data:".concat(mimeType, ";base64,").concat(logoBuffer.toString("base64"))];
                case 4:
                    err_1 = _a.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    console.log("[Logo] No logo found in ".concat(firmRoot, "/.ai_tool/"));
                    return [2 /*return*/, undefined];
            }
        });
    });
}
// Parse firm info from firm-config.json or 12-firm-preferences.md file
function loadFirmInfo(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var firmInfo, hasAnyInfo, pickConfigValue, configPath, configContent, config, configObj, firmName, attorney, nevadaBarNo, address, cityStateZip, city, state, zip, fallbackCityStateZip, phone, _a, prefsPath, content, firmBlockMatch, firmBlock, lines, contactLine, phoneMatch, faxMatch, websiteMatch, websiteLine, attorneyLine, barLine, barMatch, _b, logo;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log("[FirmInfo] Loading firm info from: ".concat(firmRoot));
                    firmInfo = {
                        name: "",
                        address: "",
                        phone: "",
                    };
                    hasAnyInfo = false;
                    pickConfigValue = function (config, keys) {
                        for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
                            var key = keys_1[_i];
                            var value = config[key];
                            if (typeof value === "string" && value.trim().length > 0)
                                return value.trim();
                        }
                        return undefined;
                    };
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    configPath = (0, path_1.join)(firmRoot, ".ai_tool", "firm-config.json");
                    return [4 /*yield*/, (0, promises_1.readFile)(configPath, "utf-8")];
                case 2:
                    configContent = _c.sent();
                    config = JSON.parse(configContent);
                    configObj = config;
                    firmName = pickConfigValue(configObj, ["firmName", "name", "lawFirm", "firm"]);
                    if (firmName) {
                        firmInfo.name = firmName;
                        hasAnyInfo = true;
                    }
                    attorney = pickConfigValue(configObj, ["attorneyName", "attorney", "lawyerName"]);
                    if (attorney) {
                        firmInfo.attorney = attorney;
                        hasAnyInfo = true;
                    }
                    nevadaBarNo = pickConfigValue(configObj, ["nevadaBarNo", "barNo", "barNumber", "nevadaBarNumber"]);
                    if (nevadaBarNo) {
                        firmInfo.nevadaBarNo = nevadaBarNo;
                        hasAnyInfo = true;
                    }
                    address = pickConfigValue(configObj, ["address", "streetAddress", "addressLine1"]);
                    if (address) {
                        firmInfo.address = address;
                        hasAnyInfo = true;
                    }
                    cityStateZip = pickConfigValue(configObj, ["cityStateZip"]);
                    if (cityStateZip) {
                        firmInfo.cityStateZip = cityStateZip;
                        hasAnyInfo = true;
                    }
                    else {
                        city = pickConfigValue(configObj, ["city"]);
                        state = pickConfigValue(configObj, ["state"]);
                        zip = pickConfigValue(configObj, ["zip", "postalCode"]);
                        fallbackCityStateZip = "".concat(city || "").concat(city && state ? ", " : "").concat(state || "").concat((city || state) && zip ? " " : "").concat(zip || "").trim();
                        if (fallbackCityStateZip) {
                            firmInfo.cityStateZip = fallbackCityStateZip;
                            hasAnyInfo = true;
                        }
                    }
                    phone = pickConfigValue(configObj, ["phone", "phoneNumber", "telephone"]);
                    if (phone) {
                        firmInfo.phone = phone;
                        hasAnyInfo = true;
                    }
                    return [3 /*break*/, 4];
                case 3:
                    _a = _c.sent();
                    return [3 /*break*/, 4];
                case 4:
                    if (!!hasAnyInfo) return [3 /*break*/, 8];
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 7, , 8]);
                    prefsPath = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge", "12-firm-preferences.md");
                    return [4 /*yield*/, (0, promises_1.readFile)(prefsPath, "utf-8")];
                case 6:
                    content = _c.sent();
                    firmBlockMatch = content.match(/### Firm Information\s*```([\s\S]*?)```/);
                    if (firmBlockMatch) {
                        firmBlock = firmBlockMatch[1].trim();
                        lines = firmBlock.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
                        // First line is firm name
                        if (lines[0]) {
                            firmInfo.name = lines[0];
                            hasAnyInfo = true;
                        }
                        // Second line is street address
                        if (lines[1])
                            firmInfo.address = lines[1];
                        // Third line is city, state, zip
                        if (lines[2])
                            firmInfo.cityStateZip = lines[2];
                        contactLine = lines.find(function (l) { return l.includes("Phone:"); });
                        if (contactLine) {
                            phoneMatch = contactLine.match(/Phone:\s*([\d.-]+)/);
                            faxMatch = contactLine.match(/Fax:\s*([\d.-]+)/);
                            if (phoneMatch)
                                firmInfo.phone = phoneMatch[1];
                            if (faxMatch)
                                firmInfo.fax = faxMatch[1];
                            websiteMatch = contactLine.match(/www\.[^\s]+/);
                            if (websiteMatch)
                                firmInfo.website = websiteMatch[0];
                        }
                        websiteLine = lines.find(function (l) { return l.startsWith("www.") || l.includes("http"); });
                        if (websiteLine && !firmInfo.website) {
                            firmInfo.website = websiteLine.replace(/^https?:\/\//, "");
                        }
                        attorneyLine = lines.find(function (l) { return l.includes("Attorney:"); });
                        if (attorneyLine) {
                            firmInfo.attorney = attorneyLine.replace("Attorney:", "").trim();
                        }
                        barLine = lines.find(function (l) { return /bar\s*no\.?/i.test(l); });
                        if (barLine) {
                            barMatch = barLine.match(/bar\s*no\.?\s*[:#-]?\s*(.+)$/i);
                            firmInfo.nevadaBarNo = barMatch ? barMatch[1].trim() : barLine.trim();
                        }
                    }
                    return [3 /*break*/, 8];
                case 7:
                    _b = _c.sent();
                    return [3 /*break*/, 8];
                case 8: return [4 /*yield*/, loadFirmLogo(firmRoot)];
                case 9:
                    logo = _c.sent();
                    if (logo) {
                        firmInfo.logoBase64 = logo;
                        hasAnyInfo = true;
                    }
                    console.log("[FirmInfo] Result: hasAnyInfo=".concat(hasAnyInfo, ", hasLogo=").concat(!!firmInfo.logoBase64, ", name=\"").concat(firmInfo.name, "\""));
                    return [2 /*return*/, hasAnyInfo ? firmInfo : null];
            }
        });
    });
}
function normalizeFirmField(value) {
    if (typeof value !== "string")
        return undefined;
    var trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function buildAttorneyFirmBlockLines(firmInfo) {
    if (!firmInfo)
        return [];
    var firmName = normalizeFirmField(firmInfo.name);
    var address = normalizeFirmField(firmInfo.address);
    var cityStateZip = normalizeFirmField(firmInfo.cityStateZip);
    var phone = normalizeFirmField(firmInfo.phone);
    var attorney = normalizeFirmField(firmInfo.attorney);
    var barValue = normalizeFirmField(firmInfo.nevadaBarNo);
    var barLine = barValue
        ? (/bar\s*no\.?/i.test(barValue) ? barValue : "Nevada Bar No. ".concat(barValue))
        : undefined;
    var addressLine = address && cityStateZip
        ? "".concat(address, ", ").concat(cityStateZip)
        : (address || cityStateZip);
    var orderedLines = [
        firmName,
        addressLine,
        barLine,
        phone,
    ].filter(function (line) { return Boolean(line); });
    if (orderedLines.length > 0) {
        return orderedLines;
    }
    return attorney ? [attorney] : [];
}
// Generate letterhead HTML block
function generateLetterheadHtml(firmInfo) {
    var logo = firmInfo.logoBase64
        ? "<img src=\"".concat(firmInfo.logoBase64, "\" class=\"firm-logo\" alt=\"Firm Logo\">")
        : "";
    var contactParts = [];
    if (firmInfo.phone)
        contactParts.push("Phone: ".concat(firmInfo.phone));
    if (firmInfo.fax)
        contactParts.push("Fax: ".concat(firmInfo.fax));
    if (firmInfo.website)
        contactParts.push(firmInfo.website);
    // Use markers so DOCX converter can easily strip this section
    return "<!-- LETTERHEAD_START -->\n    <div class=\"letterhead\">\n      ".concat(logo, "\n      <div class=\"firm-name\">").concat(firmInfo.name ? firmInfo.name.toUpperCase() : "", "</div>\n      <div class=\"firm-address\">").concat(firmInfo.address || "").concat(firmInfo.cityStateZip ? " | ".concat(firmInfo.cityStateZip) : "", "</div>\n      <div class=\"firm-contact\">").concat(contactParts.join(" | "), "</div>\n    </div>\n    <hr class=\"letterhead-divider\">\n<!-- LETTERHEAD_END -->");
}
function generatePleadingFirmRailHtml(firmInfo) {
    if (!firmInfo)
        return "";
    var pieces = [];
    if (firmInfo.name)
        pieces.push(firmInfo.name.toUpperCase());
    if (firmInfo.address)
        pieces.push(firmInfo.address);
    if (firmInfo.cityStateZip)
        pieces.push(firmInfo.cityStateZip);
    if (firmInfo.phone)
        pieces.push(firmInfo.phone);
    if (firmInfo.fax)
        pieces.push("FAX ".concat(firmInfo.fax));
    if (pieces.length === 0)
        return "";
    return "<div class=\"pleading-firm-rail\">".concat(pieces.join(" | "), "</div>");
}
// Convert markdown to HTML with legal document styling
function markdownToHtml(markdown, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (options === void 0) { options = {}; }
    var html = marked_1.marked.parse(markdown, { async: false, breaks: true, gfm: true });
    var styles = options.templateStyles;
    var isPleadingPaper = options.documentType === "hearing_decision";
    var styleProfile = (_a = options.styleProfile) !== null && _a !== void 0 ? _a : "auto";
    var isCourtCriticalByType = options.documentType === "letter" || options.documentType === "hearing_decision";
    var isCourtCritical = styleProfile === "court_safe" || (styleProfile === "auto" && isCourtCriticalByType);
    var effectiveStyles = isCourtCritical ? undefined : styles;
    var showLetterhead = options.showLetterhead && options.firmInfo;
    console.log("[Export] markdownToHtml: showLetterhead option=".concat(options.showLetterhead, ", hasFirmInfo=").concat(!!options.firmInfo, ", result=").concat(showLetterhead));
    if (options.firmInfo) {
        console.log("[Export] firmInfo: name=\"".concat(options.firmInfo.name, "\", hasLogo=").concat(!!options.firmInfo.logoBase64));
    }
    var letterheadHtml = showLetterhead ? generateLetterheadHtml(options.firmInfo) : "";
    // Apply extracted template styles or use defaults
    var fontFamily = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.defaultFont)
        ? "'".concat(effectiveStyles.defaultFont, "', Times, serif")
        : "'Times New Roman', Times, serif";
    var fontSize = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.defaultFontSize) || 12;
    var lineHeight = ((_b = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.bodyText) === null || _b === void 0 ? void 0 : _b.lineHeight) || 1.6;
    // Heading styles from template or defaults
    var h1Size = ((_c = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading1) === null || _c === void 0 ? void 0 : _c.size) || 16;
    var h1Color = ((_d = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading1) === null || _d === void 0 ? void 0 : _d.color) || "#000";
    var h2Size = ((_e = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading2) === null || _e === void 0 ? void 0 : _e.size) || 14;
    var h2Color = ((_f = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading2) === null || _f === void 0 ? void 0 : _f.color) || "#000";
    var h3Size = ((_g = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading3) === null || _g === void 0 ? void 0 : _g.size) || 12;
    var h3Color = ((_h = effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.heading3) === null || _h === void 0 ? void 0 : _h.color) || "#000";
    // Page margins from template or defaults
    var margins = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.pageMargins) || { top: 1, right: 1, bottom: 1, left: 1 };
    var paddingCss = "".concat(margins.top, "in ").concat(margins.right, "in ").concat(margins.bottom, "in ").concat(margins.left, "in");
    // Table styling
    var tableBorderColor = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.tableBorderColor) || "#666";
    var tableHeaderBg = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.tableHeaderBg) || "#f5f5f5";
    // Primary color for borders etc
    var primaryColor = (effectiveStyles === null || effectiveStyles === void 0 ? void 0 : effectiveStyles.primaryColor) || "#666";
    // Add letterhead-specific CSS only if showing letterhead
    var letterheadCss = showLetterhead
        ? "\n    .letterhead {\n      text-align: center;\n      margin-bottom: 24pt;\n    }\n    .firm-logo {\n      max-height: 60pt;\n      margin-bottom: 8pt;\n    }\n    .firm-name {\n      font-size: 18pt;\n      font-weight: bold;\n      letter-spacing: 2pt;\n    }\n    .firm-address {\n      font-size: 10pt;\n      margin-top: 4pt;\n    }\n    .firm-contact {\n      font-size: 10pt;\n      color: #444;\n    }\n    .letterhead-divider {\n      border: none;\n      border-top: 2px solid #000;\n      margin: 12pt 0 24pt;\n    }\n    "
        : "";
    // Letter-specific CSS - converts headers to bold inline text, hides horizontal rules
    var isLetter = options.documentType === "letter";
    var letterCss = isLetter
        ? "\n    /* Letter-specific overrides: no formal headers, no dividers, clean business letter look */\n    h1 {\n      font-size: 14pt;\n      font-weight: bold;\n      text-align: center;\n      text-transform: uppercase;\n      font-variant: normal;\n      margin-top: 0;\n      margin-bottom: 12pt;\n      border-bottom: none;\n    }\n    h2 {\n      font-size: ".concat(fontSize, "pt;\n      font-weight: bold;\n      font-variant: normal;\n      text-transform: none;\n      border-bottom: none;\n      padding-bottom: 0;\n      margin-top: 18pt;\n      margin-bottom: 6pt;\n    }\n    h3 {\n      font-size: ").concat(fontSize, "pt;\n      font-weight: bold;\n      font-variant: normal;\n      text-transform: none;\n      margin-top: 12pt;\n      margin-bottom: 6pt;\n    }\n    hr {\n      display: none;\n    }\n    p {\n      text-indent: 0;\n      margin: 6pt 0;\n      text-align: left;\n    }\n    ")
        : "";
    // Demand letter CSS - clean professional styling without decorative elements
    var isDemand = options.documentType === "demand";
    var demandCss = isDemand
        ? "\n    /* Demand letter overrides: clean formal look, no decorative lines */\n    h1 {\n      font-size: 14pt;\n      font-weight: bold;\n      text-align: center;\n      margin-top: 18pt;\n      margin-bottom: 12pt;\n      text-transform: uppercase;\n    }\n    h2 {\n      font-size: 12pt;\n      font-weight: bold;\n      font-variant: normal;\n      border-bottom: none;\n      padding-bottom: 0;\n      margin-top: 18pt;\n      margin-bottom: 10pt;\n      text-transform: uppercase;\n    }\n    h3 {\n      font-size: 12pt;\n      font-weight: bold;\n      margin-top: 14pt;\n      margin-bottom: 8pt;\n    }\n    hr {\n      display: none;\n    }\n    p {\n      text-indent: 0;\n      margin: 10pt 0;\n      text-align: left;\n    }\n    "
        : "";
    var pleadingLinesHtml = Array.from({ length: 28 }, function (_, idx) {
        var lineNumber = idx + 1;
        return "<div class=\"pleading-line-number\">".concat(lineNumber, "</div>");
    }).join("\n");
    var pleadingCss = isPleadingPaper
        ? "\n    body.pleading-paper {\n      max-width: none;\n      padding: 0;\n      margin: 0;\n    }\n    .pleading-page {\n      position: relative;\n      min-height: 10.5in;\n      padding: 0.72in 0.65in 0.72in 0.94in;\n      box-sizing: border-box;\n    }\n    .pleading-frame {\n      position: fixed;\n      left: 0.84in;\n      right: 0.34in;\n      top: 0.34in;\n      bottom: 0.58in;\n      border: 1px solid #3a3a3a;\n      pointer-events: none;\n      z-index: 0;\n    }\n    .pleading-gutter {\n      position: fixed;\n      top: 1.05in;\n      bottom: 0.86in;\n      left: 0.14in;\n      width: 0.54in;\n      display: grid;\n      grid-template-rows: repeat(28, minmax(0, 1fr));\n      justify-items: end;\n      align-items: start;\n      z-index: 1;\n      pointer-events: none;\n      color: #111;\n      font-size: 9.5pt;\n      line-height: 1;\n    }\n    .pleading-gutter::after {\n      content: \"\";\n      position: absolute;\n      right: -0.08in;\n      top: -0.72in;\n      bottom: -0.26in;\n      border-right: 1px solid #000;\n    }\n    .pleading-line-number {\n      padding-right: 0.09in;\n      font-variant-numeric: tabular-nums;\n      white-space: nowrap;\n    }\n    .pleading-firm-rail {\n      position: fixed;\n      left: 0.03in;\n      top: 50%;\n      transform: translateY(-50%) rotate(180deg);\n      writing-mode: vertical-rl;\n      font-size: 8pt;\n      line-height: 1.25;\n      color: #2b2b2b;\n      white-space: nowrap;\n      z-index: 1;\n      pointer-events: none;\n      font-weight: 600;\n      letter-spacing: 0.2px;\n      text-transform: uppercase;\n    }\n    .pleading-content {\n      position: relative;\n      z-index: 2;\n    }\n    .pleading-content h1 {\n      text-transform: uppercase;\n      letter-spacing: 0.4px;\n      margin-top: 2pt;\n      margin-bottom: 8pt;\n      font-size: 13pt;\n      border-bottom: none;\n    }\n    .pleading-content h2 {\n      text-transform: uppercase;\n      font-variant: normal;\n      text-align: center;\n      border-bottom: none;\n      margin-top: 10pt;\n      margin-bottom: 6pt;\n      padding-bottom: 0;\n      font-size: 12pt;\n    }\n    .pleading-content h3 {\n      font-variant: normal;\n      text-transform: uppercase;\n      margin-top: 8pt;\n      margin-bottom: 4pt;\n      font-size: 11.5pt;\n    }\n    .pleading-content p {\n      text-indent: 0;\n      text-align: left;\n      margin: 6pt 0;\n      line-height: 1.38;\n    }\n    .pleading-content ul,\n    .pleading-content ol {\n      margin: 6pt 0;\n      padding-left: 24pt;\n    }\n    .pleading-content li {\n      margin: 3pt 0;\n    }\n    .pleading-content table {\n      border-collapse: collapse;\n      margin: 8pt 0;\n      font-size: 11pt;\n    }\n    .pleading-content th,\n    .pleading-content td {\n      border: 1px solid #444;\n      padding: 5px 7px;\n      background: transparent;\n    }\n    .pleading-content hr {\n      display: none;\n    }\n    "
        : "";
    var bodyClass = isPleadingPaper ? "pleading-paper" : "";
    var pleadingFirmRailHtml = isPleadingPaper ? generatePleadingFirmRailHtml(options.firmInfo) : "";
    var contentHtml = isPleadingPaper
        ? "\n    <div class=\"pleading-frame\" aria-hidden=\"true\"></div>\n    <div class=\"pleading-gutter\" aria-hidden=\"true\">\n      ".concat(pleadingLinesHtml, "\n    </div>\n    ").concat(pleadingFirmRailHtml, "\n    <div class=\"pleading-page\">\n      <div class=\"pleading-content\">\n        ").concat(html, "\n      </div>\n    </div>\n    ")
        : "\n    ".concat(letterheadHtml, "\n    ").concat(html, "\n    ");
    return "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"UTF-8\">\n  <style>\n    body {\n      font-family: ".concat(fontFamily, ";\n      font-size: ").concat(fontSize, "pt;\n      line-height: ").concat(lineHeight, ";\n      max-width: 8.5in;\n      margin: 0 auto;\n      padding: ").concat(paddingCss, ";\n      color: #000;\n    }\n    h1 {\n      font-size: ").concat(h1Size, "pt;\n      font-weight: bold;\n      margin-top: 24pt;\n      margin-bottom: 12pt;\n      text-align: center;\n      color: ").concat(h1Color, ";\n    }\n    h2 {\n      font-size: ").concat(h2Size, "pt;\n      font-weight: bold;\n      margin-top: 18pt;\n      margin-bottom: 10pt;\n      font-variant: small-caps;\n      border-bottom: 1px solid ").concat(primaryColor, ";\n      padding-bottom: 4pt;\n      color: ").concat(h2Color, ";\n    }\n    h3 {\n      font-size: ").concat(h3Size, "pt;\n      font-weight: bold;\n      margin-top: 14pt;\n      margin-bottom: 8pt;\n      color: ").concat(h3Color, ";\n    }\n    p {\n      margin: 10pt 0;\n      text-align: justify;\n      text-indent: 0.5in;\n    }\n    /* Don't indent first paragraph after headers or in special contexts */\n    h1 + p, h2 + p, h3 + p, .letterhead + hr + p, .no-indent {\n      text-indent: 0;\n    }\n    table {\n      border-collapse: collapse;\n      width: 100%;\n      margin: 12pt 0;\n    }\n    th, td {\n      border: 1px solid ").concat(tableBorderColor, ";\n      padding: 8px 12px;\n      text-align: left;\n    }\n    th {\n      background-color: ").concat(tableHeaderBg, ";\n      font-weight: bold;\n      border-bottom: 2px solid ").concat(tableBorderColor, ";\n    }\n    ").concat(isCourtCritical ? "" : "\n    /* Zebra striping for table rows */\n    tbody tr:nth-child(even) {\n      background-color: #fafafa;\n    }\n    tbody tr:hover {\n      background-color: #f0f0f0;\n    }\n    ", "\n    ul, ol {\n      margin: 10pt 0;\n      padding-left: 36pt;\n    }\n    li {\n      margin: 3pt 0;\n      text-indent: 0;\n    }\n    li p {\n      text-indent: 0;\n      margin: 2pt 0;\n    }\n    hr {\n      border: none;\n      border-top: 1px solid #000;\n      margin: 18pt 0;\n    }\n    strong {\n      font-weight: bold;\n    }\n    em {\n      font-style: italic;\n    }\n    blockquote {\n      margin: 12pt 24pt;\n      padding-left: 12pt;\n      border-left: 3px solid #ccc;\n      font-style: italic;\n    }\n    ").concat(letterheadCss, "\n    ").concat(letterCss, "\n    ").concat(demandCss, "\n    ").concat(pleadingCss, "\n    @page {\n      size: letter;\n      margin: ").concat(margins.top, "in ").concat(margins.right, "in ").concat(margins.bottom, "in ").concat(margins.left, "in;\n    }\n    @media print {\n      body {\n        padding: 0;\n      }\n    }\n  </style>\n</head>\n<body class=\"").concat(bodyClass, "\">\n  ").concat(contentHtml, "\n</body>\n</html>");
}
// Get image dimensions from buffer
function getImageDimensions(buffer, type) {
    try {
        if (type === "png") {
            // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
            if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
                var width = buffer.readUInt32BE(16);
                var height = buffer.readUInt32BE(20);
                return { width: width, height: height };
            }
        }
        else if (type === "jpg" || type === "jpeg") {
            // JPEG: find SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
            var offset = 2; // Skip SOI marker
            while (offset < buffer.length - 8) {
                if (buffer[offset] !== 0xff) {
                    offset++;
                    continue;
                }
                var marker = buffer[offset + 1];
                // SOF0, SOF1, SOF2 markers contain dimensions
                if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
                    var height = buffer.readUInt16BE(offset + 5);
                    var width = buffer.readUInt16BE(offset + 7);
                    return { width: width, height: height };
                }
                // Skip to next marker
                var segmentLength = buffer.readUInt16BE(offset + 2);
                offset += 2 + segmentLength;
            }
        }
    }
    catch (err) {
        console.error("[Image] Failed to get dimensions:", err);
    }
    return null;
}
// Generate DOCX letterhead elements
function generateDocxLetterhead(firmInfo) {
    var elements = [];
    // Logo (if available)
    if (firmInfo.logoBase64) {
        try {
            // Extract base64 data from data URL
            var base64Match = firmInfo.logoBase64.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
            if (base64Match) {
                var imageBuffer = Buffer.from(base64Match[2], "base64");
                var imageType = base64Match[1].toLowerCase() === "png" ? "png" : "jpg";
                // Get actual dimensions and scale to fit max size while preserving aspect ratio
                var dims = getImageDimensions(imageBuffer, imageType);
                var maxWidth = 192; // ~2 inches at 96 DPI
                var maxHeight = 96; // ~1 inch at 96 DPI
                var width = maxWidth;
                var height = maxHeight;
                if (dims) {
                    var aspectRatio = dims.width / dims.height;
                    // Scale to fit within max bounds while preserving aspect ratio
                    if (dims.width > dims.height) {
                        // Wider than tall - constrain by width
                        width = Math.min(dims.width, maxWidth);
                        height = width / aspectRatio;
                    }
                    else {
                        // Taller than wide - constrain by height
                        height = Math.min(dims.height, maxHeight);
                        width = height * aspectRatio;
                    }
                    // Ensure we don't exceed either max
                    if (height > maxHeight) {
                        height = maxHeight;
                        width = height * aspectRatio;
                    }
                    if (width > maxWidth) {
                        width = maxWidth;
                        height = width / aspectRatio;
                    }
                }
                elements.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.ImageRun({
                            data: imageBuffer,
                            type: imageType,
                            transformation: {
                                width: Math.round(width),
                                height: Math.round(height),
                            },
                        }),
                    ],
                    alignment: docx_1.AlignmentType.CENTER,
                    spacing: { after: 100 },
                }));
            }
        }
        catch (err) {
            console.error("[DOCX] Failed to add logo:", err);
        }
    }
    // Firm name
    if (firmInfo.name) {
        elements.push(new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: firmInfo.name.toUpperCase(),
                    bold: true,
                    size: 28, // 14pt
                }),
            ],
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 60 },
        }));
    }
    // Address
    var addressParts = [];
    if (firmInfo.address)
        addressParts.push(firmInfo.address);
    if (firmInfo.cityStateZip)
        addressParts.push(firmInfo.cityStateZip);
    if (addressParts.length > 0) {
        elements.push(new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: addressParts.join(" | "),
                    size: 20, // 10pt
                }),
            ],
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 40 },
        }));
    }
    // Contact info
    var contactParts = [];
    if (firmInfo.phone)
        contactParts.push("Phone: ".concat(firmInfo.phone));
    if (firmInfo.fax)
        contactParts.push("Fax: ".concat(firmInfo.fax));
    if (firmInfo.website)
        contactParts.push(firmInfo.website);
    if (contactParts.length > 0) {
        elements.push(new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: contactParts.join(" | "),
                    size: 20, // 10pt
                    color: "444444",
                }),
            ],
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 200 },
        }));
    }
    // Divider line
    elements.push(new docx_1.Paragraph({
        border: {
            bottom: { style: docx_1.BorderStyle.SINGLE, size: 12, color: "000000" },
        },
        spacing: { after: 300 },
    }));
    return elements;
}
// Parse HTML and convert to DOCX elements
function htmlToDocx(html, title, options) {
    return __awaiter(this, void 0, void 0, function () {
        var isLetter, isDemand, isHearingDecision, isCleanFormat, bodyMatch, bodyContent, children, letterheadElements, lines, currentText, inBold, inItalic, inList, listType, headingLevel, inTable, tableRows, currentRowCells, isHeaderRow, flushText, flushTable, _i, lines_1, part, tagMatch, tag, isClosing, decoded, doc, buffer;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    isLetter = (options === null || options === void 0 ? void 0 : options.documentType) === "letter";
                    isDemand = (options === null || options === void 0 ? void 0 : options.documentType) === "demand";
                    isHearingDecision = (options === null || options === void 0 ? void 0 : options.documentType) === "hearing_decision";
                    isCleanFormat = isLetter || isDemand;
                    bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                    bodyContent = bodyMatch ? bodyMatch[1] : html;
                    // Remove letterhead HTML if present (we'll generate it natively in DOCX)
                    bodyContent = bodyContent.replace(/<!-- LETTERHEAD_START -->[\s\S]*?<!-- LETTERHEAD_END -->/gi, "");
                    children = [];
                    // Add DOCX-native letterhead if requested
                    if ((options === null || options === void 0 ? void 0 : options.showLetterhead) && (options === null || options === void 0 ? void 0 : options.firmInfo)) {
                        letterheadElements = generateDocxLetterhead(options.firmInfo);
                        children.push.apply(children, letterheadElements);
                    }
                    lines = bodyContent.split(/(<[^>]+>)/g).filter(Boolean);
                    currentText = [];
                    inBold = false;
                    inItalic = false;
                    inList = false;
                    listType = "bullet";
                    headingLevel = 0;
                    inTable = false;
                    tableRows = [];
                    currentRowCells = [];
                    isHeaderRow = false;
                    flushText = function (alignment, spacingAfter) {
                        if (spacingAfter === void 0) { spacingAfter = 200; }
                        if (currentText.length > 0) {
                            var para = new docx_1.Paragraph({
                                children: currentText,
                                alignment: alignment,
                                spacing: { after: spacingAfter },
                            });
                            children.push(para);
                            currentText = [];
                        }
                    };
                    flushTable = function () {
                        if (tableRows.length > 0) {
                            var table = new docx_1.Table({
                                rows: tableRows,
                                width: { size: 100, type: docx_1.WidthType.PERCENTAGE },
                            });
                            children.push(table);
                            tableRows = [];
                        }
                        inTable = false;
                    };
                    for (_i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                        part = lines_1[_i];
                        if (!part.trim())
                            continue;
                        // Handle tags
                        if (part.trim().startsWith("<")) {
                            tagMatch = part.trim().match(/<\/?(\w+)[^>]*>/i);
                            if (!tagMatch)
                                continue;
                            tag = tagMatch[1].toLowerCase();
                            isClosing = part.trim().startsWith("</");
                            switch (tag) {
                                case "h1":
                                    if (!isClosing)
                                        headingLevel = 1;
                                    if (isClosing) {
                                        flushText(docx_1.AlignmentType.CENTER, 280);
                                        headingLevel = 0;
                                    }
                                    break;
                                case "h2":
                                    if (!isClosing)
                                        headingLevel = 2;
                                    if (isClosing) {
                                        flushText(undefined, 240);
                                        headingLevel = 0;
                                    }
                                    break;
                                case "h3":
                                    if (!isClosing)
                                        headingLevel = 3;
                                    if (isClosing) {
                                        flushText(undefined, 220);
                                        headingLevel = 0;
                                    }
                                    break;
                                case "p":
                                    if (isClosing) {
                                        flushText();
                                    }
                                    break;
                                case "strong":
                                case "b":
                                    inBold = !isClosing;
                                    break;
                                case "em":
                                case "i":
                                    inItalic = !isClosing;
                                    break;
                                case "ul":
                                    inList = !isClosing;
                                    listType = "bullet";
                                    break;
                                case "ol":
                                    inList = !isClosing;
                                    listType = "number";
                                    break;
                                case "li":
                                    if (isClosing && currentText.length > 0) {
                                        children.push(new docx_1.Paragraph({
                                            children: currentText,
                                            bullet: listType === "bullet" ? { level: 0 } : undefined,
                                            numbering: listType === "number"
                                                ? { reference: "default-numbering", level: 0 }
                                                : undefined,
                                            spacing: { after: 100 },
                                        }));
                                        currentText = [];
                                    }
                                    break;
                                case "table":
                                    if (!isClosing) {
                                        flushText();
                                        inTable = true;
                                        tableRows = [];
                                    }
                                    else {
                                        flushTable();
                                    }
                                    break;
                                case "thead":
                                    if (!isClosing)
                                        isHeaderRow = true;
                                    break;
                                case "tbody":
                                    isHeaderRow = false;
                                    break;
                                case "tr":
                                    if (isClosing && currentRowCells.length > 0) {
                                        tableRows.push(new docx_1.TableRow({
                                            children: currentRowCells,
                                            tableHeader: isHeaderRow,
                                        }));
                                        currentRowCells = [];
                                    }
                                    break;
                                case "th":
                                case "td":
                                    if (isClosing && currentText.length > 0) {
                                        currentRowCells.push(new docx_1.TableCell({
                                            children: [new docx_1.Paragraph({ children: currentText })],
                                            shading: tag === "th" ? { fill: "f0f0f0" } : undefined,
                                            borders: {
                                                top: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                bottom: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                left: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                right: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                            },
                                        }));
                                        currentText = [];
                                    }
                                    else if (isClosing) {
                                        // Empty cell
                                        currentRowCells.push(new docx_1.TableCell({
                                            children: [new docx_1.Paragraph({})],
                                            shading: tag === "th" ? { fill: "f0f0f0" } : undefined,
                                            borders: {
                                                top: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                bottom: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                left: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                                right: { style: docx_1.BorderStyle.SINGLE, size: 1 },
                                            },
                                        }));
                                    }
                                    break;
                                case "hr":
                                    flushText();
                                    if (isCleanFormat) {
                                        // For letters and demands: add blank paragraph spacing instead of visible line
                                        children.push(new docx_1.Paragraph({
                                            children: [],
                                            spacing: { after: 200 },
                                        }));
                                    }
                                    else {
                                        children.push(new docx_1.Paragraph({
                                            border: {
                                                bottom: { style: docx_1.BorderStyle.SINGLE, size: 6 },
                                            },
                                            spacing: { after: 200 },
                                        }));
                                    }
                                    break;
                                case "br":
                                    currentText.push(new docx_1.TextRun({ break: 1 }));
                                    break;
                            }
                        }
                        else {
                            decoded = part
                                .replace(/&amp;/g, "&")
                                .replace(/&lt;/g, "<")
                                .replace(/&gt;/g, ">")
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'")
                                .replace(/&nbsp;/g, " ");
                            if (decoded) {
                                currentText.push(new docx_1.TextRun({
                                    text: decoded,
                                    bold: inBold || headingLevel > 0,
                                    italics: inItalic,
                                }));
                            }
                        }
                    }
                    // Flush any remaining content
                    flushText();
                    flushTable();
                    doc = new docx_1.Document({
                        title: title,
                        numbering: {
                            config: [
                                {
                                    reference: "default-numbering",
                                    levels: [
                                        {
                                            level: 0,
                                            format: "decimal",
                                            text: "%1.",
                                            alignment: docx_1.AlignmentType.START,
                                        },
                                    ],
                                },
                            ],
                        },
                        sections: [
                            {
                                properties: {
                                    page: {
                                        size: {
                                            width: 12240, // 8.5 inches in twips
                                            height: 15840, // 11 inches in twips
                                        },
                                        margin: {
                                            top: 1440, // 1 inch in twips
                                            right: 1440,
                                            bottom: 1440,
                                            left: isHearingDecision ? 1872 : 1440, // 1.3in left margin for pleading-paper style docs
                                        },
                                    },
                                },
                                children: children,
                            },
                        ],
                    });
                    return [4 /*yield*/, docx_1.Packer.toBuffer(doc)];
                case 1:
                    buffer = _a.sent();
                    return [2 /*return*/, Buffer.from(buffer)];
            }
        });
    });
}
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function cleanInlineMarkdown(value) {
    return decodeHtmlEntities(value
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[*_~]+/g, "")
        .replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
}
function isPlaceholderValue(value) {
    var line = cleanInlineMarkdown(value);
    if (!line)
        return true;
    return (/^\[[^\]]+\],?$/.test(line) ||
        /\bclaimant\s*name\b/i.test(line) ||
        /\bverify\b/i.test(line) ||
        /\bplaceholder\b/i.test(line));
}
function isCaptionDescriptor(value) {
    var line = cleanInlineMarkdown(value).toLowerCase();
    return (line.includes("industrial insurance claim of") ||
        line.includes("in the matter of") ||
        line.includes("state of nevada") ||
        line.includes("department of administration") ||
        line.includes("before the appeals officer") ||
        line.includes("before the hearing officer") ||
        line.includes("decision & order") ||
        line.includes("decision and order"));
}
function isFieldLine(value) {
    return /^[A-Za-z][A-Za-z0-9\s/&.'()-]{1,40}:\s*/.test(value.trim());
}
function parseSingleValueField(lines, regexes) {
    for (var _i = 0, lines_2 = lines; _i < lines_2.length; _i++) {
        var line = lines_2[_i];
        for (var _a = 0, regexes_1 = regexes; _a < regexes_1.length; _a++) {
            var regex = regexes_1[_a];
            var match = line.match(regex);
            if (match === null || match === void 0 ? void 0 : match[1]) {
                var cleaned = cleanInlineMarkdown(match[1]);
                if (cleaned && !isPlaceholderValue(cleaned))
                    return cleaned;
            }
        }
    }
    return undefined;
}
function parseAppealNumbers(lines) {
    var _a;
    var values = [];
    for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i];
        var match = line.match(/^\s*Appeal\s*No(?:s)?\.?\s*:\s*(.*)$/i);
        if (!match)
            continue;
        var current = (_a = match[1]) === null || _a === void 0 ? void 0 : _a.trim();
        if (current)
            values.push(current);
        for (var j = i + 1; j < lines.length; j += 1) {
            var next = lines[j].trim();
            if (!next)
                break;
            if (isFieldLine(next))
                break;
            if (!/[0-9]/.test(next))
                break;
            values.push(next);
            i = j;
        }
    }
    return values
        .flatMap(function (entry) { return entry.split(","); })
        .map(function (entry) { return cleanInlineMarkdown(entry); })
        .filter(Boolean);
}
function extractClaimantName(lines, fallback) {
    for (var i = 0; i < lines.length; i += 1) {
        var current = lines[i].trim();
        if (!/^claimant\.?$/i.test(current))
            continue;
        for (var j = i - 1; j >= 0; j -= 1) {
            var prior = cleanInlineMarkdown(lines[j]);
            if (!prior)
                continue;
            if (isFieldLine(prior))
                continue;
            if (/^in the matter of/i.test(prior))
                continue;
            if (isPlaceholderValue(prior))
                continue;
            if (isCaptionDescriptor(prior))
                continue;
            return prior.replace(/[,.;:]$/, "");
        }
    }
    var claimBlock = lines.join("\n");
    var claimRegex = /claim(?:\s+of|\s*:\s*)\s*\n*\s*([^\n]+)/ig;
    var match;
    while ((match = claimRegex.exec(claimBlock)) !== null) {
        var candidate = cleanInlineMarkdown(match[1]).replace(/[,.;:]$/, "");
        if (candidate && !isPlaceholderValue(candidate) && !isCaptionDescriptor(candidate))
            return candidate;
    }
    var fallbackClean = cleanInlineMarkdown(fallback || "");
    if (fallbackClean && !isPlaceholderValue(fallbackClean))
        return fallbackClean;
    for (var _i = 0, lines_3 = lines; _i < lines_3.length; _i++) {
        var line = lines_3[_i];
        var candidate = cleanInlineMarkdown(line).replace(/[,.;:]$/, "");
        if (!candidate || isPlaceholderValue(candidate))
            continue;
        if (isCaptionDescriptor(candidate))
            continue;
        if (/^[A-Z][A-Z\s.'-]{4,}$/.test(candidate) && !isFieldLine(candidate)) {
            return candidate;
        }
    }
    return "[CLAIMANT NAME]";
}
function isCaptionNoiseLine(value) {
    var line = value.trim();
    if (!line)
        return true;
    return (/^#*\s*decision\s*(?:&|and)\s*order\s*$/i.test(line) ||
        /^electronic(?:ally)? filed/i.test(line) ||
        /^state of nevada$/i.test(line) ||
        /^state of nevada.*department of administration/i.test(line) ||
        /^nevada department of administration$/i.test(line) ||
        /^nevada department of administration.*hearings division/i.test(line) ||
        /^department of administration$/i.test(line) ||
        /^before the (?:appeals|hearing) officer$/i.test(line) ||
        /^issue before the (?:appeals|hearing) officer$/i.test(line) ||
        /^hearings division$/i.test(line) ||
        /^in the matter of/i.test(line) ||
        /^industrial insurance claim of/i.test(line) ||
        /^claimant\.?$/i.test(line) ||
        /^employer\.?$/i.test(line) ||
        /^insurer\/tpa\.?$/i.test(line) ||
        /^\[[^\]]+\],?$/.test(line) ||
        /^claim no\.?:/i.test(line) ||
        /^claim number:/i.test(line) ||
        /^appeal no(?:s)?\.?:/i.test(line) ||
        /^hearing no\.?:/i.test(line) ||
        /^hearing number:/i.test(line) ||
        /^vs\.?$/i.test(line) ||
        /^and$/i.test(line) ||
        /^\)+$/.test(line) ||
        /^_+$/.test(line));
}
function isBodyAnchorLine(value) {
    var line = cleanInlineMarkdown(value);
    if (!line)
        return false;
    return (/^(on|the|after|following|having|based|pursuant)\b/i.test(line) ||
        /^(findings of fact|conclusions of law|order|procedural history|background|appearances)\b/i.test(line) ||
        /^(the following documents were admitted into evidence)/i.test(line) ||
        /^\d+\.\s+/.test(line));
}
function removeRepeatedCaptionBody(lines) {
    var bodyLines = __spreadArray([], lines, true);
    while (bodyLines.length > 0 && isCaptionNoiseLine(bodyLines[0])) {
        bodyLines.shift();
    }
    var preview = bodyLines.slice(0, 35).map(function (line) { return cleanInlineMarkdown(line); });
    var hasCaptionSignals = preview.some(function (line) {
        return /industrial insurance claim of|claimant|employer|insurer\/tpa|state of nevada|department of administration|appeals officer|hearing officer|claim no|appeal nos?/i.test(line);
    });
    if (hasCaptionSignals) {
        var cutIndex = -1;
        for (var i = 0; i < bodyLines.length; i += 1) {
            if (isBodyAnchorLine(bodyLines[i])) {
                cutIndex = i;
                break;
            }
        }
        if (cutIndex > 0) {
            bodyLines = bodyLines.slice(cutIndex);
        }
    }
    while (bodyLines.length > 0 && isCaptionNoiseLine(bodyLines[0])) {
        bodyLines.shift();
    }
    return bodyLines;
}
function extractDecisionBodyMarkdown(lines) {
    var trimmed = lines.map(function (line) { return line.trim(); });
    var decisionHeading = trimmed.findIndex(function (line) {
        return /^(#{1,6}\s*)?decision\s*(?:&|and)\s*order\b/i.test(line);
    });
    var firstBodyHeading = trimmed.findIndex(function (line) {
        return /^(#{1,6}\s*)?(findings of fact|conclusions of law|order|procedural history|background)\b/i.test(line);
    });
    var start = 0;
    if (decisionHeading >= 0) {
        start = decisionHeading + 1;
    }
    else if (firstBodyHeading >= 0) {
        start = firstBodyHeading;
    }
    else {
        var narrativeStart = trimmed.findIndex(function (line) { return /^(On|The)\s.+/.test(line) && line.length > 32; });
        if (narrativeStart >= 0)
            start = narrativeStart;
    }
    var bodyLines = removeRepeatedCaptionBody(lines.slice(Math.max(0, start)));
    var body = bodyLines.join("\n").trim();
    return body || lines.join("\n").trim();
}
function parseHearingDecisionLayout(markdown, options) {
    var lines = markdown.replace(/\r/g, "").split("\n");
    var filingStamp = lines
        .map(function (line) { return line.trim(); })
        .find(function (line) { return /^electronic(?:ally)? filed/i.test(line); });
    var agencyLine = lines
        .map(function (line) { return line.trim(); })
        .find(function (line) { return /nevada department of administration/i.test(line); })
        || "NEVADA DEPARTMENT OF ADMINISTRATION";
    var officerLine = lines
        .map(function (line) { return line.trim(); })
        .find(function (line) { return /before the (?:appeals|hearing) officer/i.test(line); });
    if (!officerLine) {
        officerLine = lines.some(function (line) { return /hearings division/i.test(line); })
            ? "HEARINGS DIVISION"
            : "BEFORE THE APPEALS OFFICER";
    }
    var normalizedOfficerLine = cleanInlineMarkdown(officerLine);
    if (/appeals officer/i.test(normalizedOfficerLine)) {
        officerLine = "BEFORE THE APPEALS OFFICER";
    }
    else if (/hearing officer/i.test(normalizedOfficerLine)) {
        officerLine = "BEFORE THE HEARING OFFICER";
    }
    else if (/hearings division/i.test(normalizedOfficerLine)) {
        officerLine = "HEARINGS DIVISION";
    }
    else {
        officerLine = normalizedOfficerLine || "BEFORE THE APPEALS OFFICER";
    }
    var claimNumber = parseSingleValueField(lines, [
        /^\s*Claim\s*No\.?\s*:\s*(.+)$/i,
        /^\s*Claim\s*Number\s*:\s*(.+)$/i,
    ]);
    var hearingNumber = parseSingleValueField(lines, [
        /^\s*Hearing\s*No\.?\s*:\s*(.+)$/i,
        /^\s*Hearing\s*Number\s*:\s*(.+)$/i,
    ]);
    var appealNumbers = parseAppealNumbers(lines);
    var claimantName = extractClaimantName(lines, options.caseName);
    var bodyMarkdown = extractDecisionBodyMarkdown(lines);
    return {
        filingStamp: filingStamp,
        agencyLine: "NEVADA DEPARTMENT OF ADMINISTRATION",
        officerLine: cleanInlineMarkdown(officerLine).toUpperCase(),
        claimantName: claimantName,
        claimNumber: claimNumber,
        hearingNumber: hearingNumber,
        appealNumbers: appealNumbers,
        bodyMarkdown: bodyMarkdown,
    };
}
function markdownToHearingDecisionBlocks(markdown) {
    var tokens = marked_1.marked.lexer(markdown, { gfm: true, breaks: true });
    var blocks = [];
    var addParagraph = function (text) {
        var cleaned = cleanInlineMarkdown(text);
        if (cleaned)
            blocks.push({ kind: "paragraph", text: cleaned });
    };
    for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
        var token = tokens_1[_i];
        switch (token.type) {
            case "space":
                blocks.push({ kind: "spacer", lines: 1 });
                break;
            case "heading": {
                var text = cleanInlineMarkdown(token.text || "");
                if (text)
                    blocks.push({ kind: "heading", text: text, level: token.depth || 2 });
                break;
            }
            case "paragraph":
                addParagraph(token.text || "");
                break;
            case "list": {
                var start = typeof token.start === "number" ? token.start : 1;
                for (var i = 0; i < token.items.length; i += 1) {
                    var item = token.items[i];
                    var text = cleanInlineMarkdown(item.text || "");
                    if (!text)
                        continue;
                    var marker = token.ordered ? "".concat(start + i, ".") : "\u2022";
                    blocks.push({ kind: "list_item", text: text, marker: marker });
                }
                break;
            }
            case "blockquote": {
                var quoteText = cleanInlineMarkdown(token.text || "");
                if (quoteText)
                    blocks.push({ kind: "paragraph", text: quoteText });
                break;
            }
            case "hr":
                blocks.push({ kind: "spacer", lines: 1 });
                break;
            case "table": {
                var headers = Array.isArray(token.header)
                    ? token.header.map(function (cell) { return cleanInlineMarkdown(cell); }).filter(Boolean)
                    : [];
                if (headers.length > 0) {
                    blocks.push({ kind: "paragraph", text: headers.join(" | ") });
                }
                if (Array.isArray(token.rows)) {
                    for (var _a = 0, _b = token.rows; _a < _b.length; _a++) {
                        var row = _b[_a];
                        var cells = row.map(function (cell) { return cleanInlineMarkdown(cell); }).filter(Boolean);
                        if (cells.length > 0)
                            blocks.push({ kind: "paragraph", text: cells.join(" | ") });
                    }
                }
                break;
            }
            default: {
                if (typeof token.text === "string")
                    addParagraph(token.text);
            }
        }
    }
    var filtered = blocks.filter(function (block) { return !(block.kind === "paragraph" && isCaptionNoiseLine(block.text)); });
    return filtered.length > 0 ? filtered : [{ kind: "paragraph", text: cleanInlineMarkdown(markdown) }];
}
function wrapText(font, size, text, maxWidth) {
    var words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return [""];
    var lines = [];
    var current = "";
    for (var _i = 0, words_1 = words; _i < words_1.length; _i++) {
        var word = words_1[_i];
        var candidate = current ? "".concat(current, " ").concat(word) : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            current = candidate;
            continue;
        }
        if (current) {
            lines.push(current);
            current = word;
            continue;
        }
        var remaining = word;
        while (remaining.length > 0) {
            var chunk = remaining;
            while (chunk.length > 1 && font.widthOfTextAtSize(chunk, size) > maxWidth) {
                chunk = chunk.slice(0, -1);
            }
            lines.push(chunk);
            remaining = remaining.slice(chunk.length);
        }
        current = "";
    }
    if (current)
        lines.push(current);
    return lines.length > 0 ? lines : [""];
}
function drawCenteredText(page, font, text, size, y) {
    var width = page.getWidth();
    var textWidth = font.widthOfTextAtSize(text, size);
    var x = (width - textWidth) / 2;
    page.drawText(text, { x: x, y: y, size: size, font: font, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
    return x;
}
function buildFirmRailText(firmInfo) {
    if (!firmInfo)
        return undefined;
    var parts = [];
    if (firmInfo.name)
        parts.push(firmInfo.name.toUpperCase());
    if (firmInfo.address)
        parts.push(firmInfo.address);
    if (firmInfo.cityStateZip)
        parts.push(firmInfo.cityStateZip);
    if (firmInfo.phone)
        parts.push(firmInfo.phone);
    if (firmInfo.fax)
        parts.push("FAX ".concat(firmInfo.fax));
    return parts.length > 0 ? parts.join(" | ") : undefined;
}
function drawPleadingPaperPage(page, options, regularFont, pageNumber, firstPage, filingStamp) {
    var lineTop = 736;
    var lineBottom = 86;
    var lineCount = 28;
    var spacing = (lineTop - lineBottom) / (lineCount - 1);
    page.drawRectangle({
        x: 58,
        y: 34,
        width: 528,
        height: 744,
        borderColor: (0, pdf_lib_1.rgb)(0.55, 0.55, 0.55),
        borderWidth: 0.9,
    });
    page.drawLine({
        start: { x: 52, y: lineBottom - 10 },
        end: { x: 52, y: lineTop + 8 },
        thickness: 0.75,
        color: (0, pdf_lib_1.rgb)(0.25, 0.25, 0.25),
    });
    for (var line = 1; line <= lineCount; line += 1) {
        var y = lineTop - (line - 1) * spacing;
        var label = String(line);
        var width = regularFont.widthOfTextAtSize(label, 9);
        page.drawText(label, {
            x: 42 - width,
            y: y - 3,
            size: 9,
            font: regularFont,
            color: (0, pdf_lib_1.rgb)(0.18, 0.18, 0.18),
        });
    }
    var firmRail = buildFirmRailText(options.firmInfo);
    if (firmRail) {
        page.drawText(firmRail, {
            x: 17,
            y: 210,
            size: 7.4,
            font: regularFont,
            color: (0, pdf_lib_1.rgb)(0.18, 0.18, 0.18),
            rotate: (0, pdf_lib_1.degrees)(90),
        });
    }
    if (firstPage && filingStamp) {
        drawCenteredText(page, regularFont, filingStamp, 10, 775);
    }
    if (options.showPageNumbers !== false) {
        var pageLabel = String(pageNumber);
        var labelWidth = regularFont.widthOfTextAtSize(pageLabel, 10);
        page.drawText(pageLabel, {
            x: (page.getWidth() - labelWidth) / 2,
            y: 20,
            size: 10,
            font: regularFont,
            color: (0, pdf_lib_1.rgb)(0, 0, 0),
        });
    }
}
function drawRightField(page, boldFont, regularFont, label, value, x, y, maxWidth) {
    var labelSize = 10.5;
    var valueSize = 10.5;
    page.drawText(label, { x: x, y: y, size: labelSize, font: boldFont, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
    var labelWidth = boldFont.widthOfTextAtSize(label, labelSize);
    var valueX = x + labelWidth + 8;
    var valueLines = wrapText(regularFont, valueSize, value, Math.max(40, maxWidth - labelWidth - 8));
    valueLines.forEach(function (line, idx) {
        page.drawText(line, {
            x: valueX,
            y: y - idx * 13,
            size: valueSize,
            font: regularFont,
            color: (0, pdf_lib_1.rgb)(0, 0, 0),
        });
    });
    return y - Math.max(1, valueLines.length) * 13;
}
function drawHearingDecisionCaption(page, data, boldFont, regularFont) {
    drawCenteredText(page, boldFont, data.agencyLine, 12.3, 736);
    var officerX = drawCenteredText(page, boldFont, data.officerLine, 11.8, 714);
    var officerWidth = boldFont.widthOfTextAtSize(data.officerLine, 11.8);
    page.drawLine({
        start: { x: officerX, y: 710 },
        end: { x: officerX + officerWidth, y: 710 },
        thickness: 0.9,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
    var leftX = 88;
    var captionTop = 682;
    page.drawText("In the Matter of the Contested", { x: leftX, y: captionTop, size: 11.2, font: regularFont });
    page.drawText("Industrial Insurance Claim of", { x: leftX, y: captionTop - 15, size: 11.2, font: regularFont });
    for (var i = 0; i < 8; i += 1) {
        page.drawText(")", { x: 315, y: captionTop - i * 16, size: 11.5, font: regularFont });
    }
    var claimantLine = "".concat(data.claimantName.toUpperCase(), ",");
    page.drawText(claimantLine, { x: leftX, y: captionTop - 62, size: 11.2, font: boldFont });
    page.drawText("Claimant.", { x: leftX + 70, y: captionTop - 88, size: 11.2, font: regularFont });
    page.drawLine({
        start: { x: leftX, y: captionTop - 103 },
        end: { x: 300, y: captionTop - 103 },
        thickness: 0.75,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
    var rightX = 338;
    var rightY = captionTop - 13;
    if (data.claimNumber) {
        rightY = drawRightField(page, boldFont, regularFont, "Claim No.:", data.claimNumber, rightX, rightY, 162) - 5;
    }
    if (data.appealNumbers.length > 0) {
        rightY = drawRightField(page, boldFont, regularFont, "Appeal Nos.:", data.appealNumbers.join(", "), rightX, rightY, 162) - 3;
    }
    else if (data.hearingNumber) {
        rightY = drawRightField(page, boldFont, regularFont, "Hearing No.:", data.hearingNumber, rightX, rightY, 162) - 3;
    }
    var title = "DECISION & ORDER";
    var titleX = drawCenteredText(page, boldFont, title, 13, 546);
    var titleWidth = boldFont.widthOfTextAtSize(title, 13);
    page.drawLine({
        start: { x: titleX, y: 542 },
        end: { x: titleX + titleWidth, y: 542 },
        thickness: 0.95,
        color: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
    return 518;
}
function isMajorSectionHeading(value) {
    return /^(findings of fact|conclusions of law|order|appeal issues|procedural history|facts)$/i.test(value.trim());
}
function markdownToHearingDecisionPdf(markdown_1, title_1) {
    return __awaiter(this, arguments, void 0, function (markdown, title, options) {
        var data, blocks, pdf, regular, bold, pageNumber, page, y, leftX, bodyWidth, bottomY, addPage, ensureSpace, _i, blocks_1, block, headingText, major, size, hx, width, text, firstLineIndent, lines, i, x, textLines, i, bytes;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    data = parseHearingDecisionLayout(markdown, options);
                    blocks = markdownToHearingDecisionBlocks(data.bodyMarkdown);
                    return [4 /*yield*/, pdf_lib_1.PDFDocument.create()];
                case 1:
                    pdf = _a.sent();
                    pdf.setTitle(title);
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRoman)];
                case 2:
                    regular = _a.sent();
                    return [4 /*yield*/, pdf.embedFont(pdf_lib_1.StandardFonts.TimesRomanBold)];
                case 3:
                    bold = _a.sent();
                    pageNumber = 1;
                    page = pdf.addPage([612, 792]);
                    drawPleadingPaperPage(page, options, regular, pageNumber, true, data.filingStamp);
                    y = drawHearingDecisionCaption(page, data, bold, regular);
                    leftX = 88;
                    bodyWidth = 468;
                    bottomY = 72;
                    addPage = function () {
                        pageNumber += 1;
                        page = pdf.addPage([612, 792]);
                        drawPleadingPaperPage(page, options, regular, pageNumber, false);
                        y = 742;
                    };
                    ensureSpace = function (required) {
                        if (y - required < bottomY)
                            addPage();
                    };
                    for (_i = 0, blocks_1 = blocks; _i < blocks_1.length; _i++) {
                        block = blocks_1[_i];
                        if (block.kind === "spacer") {
                            y -= Math.max(6, block.lines * 9);
                            continue;
                        }
                        if (block.kind === "heading") {
                            headingText = block.text.toUpperCase();
                            major = isMajorSectionHeading(block.text);
                            size = block.level <= 2 ? 12.3 : 11.7;
                            ensureSpace(24);
                            if (major) {
                                hx = drawCenteredText(page, bold, headingText, size, y);
                                width = bold.widthOfTextAtSize(headingText, size);
                                page.drawLine({
                                    start: { x: hx, y: y - 3 },
                                    end: { x: hx + width, y: y - 3 },
                                    thickness: 0.7,
                                    color: (0, pdf_lib_1.rgb)(0, 0, 0),
                                });
                            }
                            else {
                                page.drawText(headingText, { x: leftX, y: y, size: size, font: bold, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                            }
                            y -= 22;
                            continue;
                        }
                        if (block.kind === "paragraph") {
                            text = block.text.replace(/\s+/g, " ").trim();
                            if (!text)
                                continue;
                            firstLineIndent = 22;
                            lines = wrapText(regular, 11.4, text, bodyWidth - firstLineIndent);
                            for (i = 0; i < lines.length; i += 1) {
                                ensureSpace(15);
                                x = leftX + (i === 0 ? firstLineIndent : 0);
                                page.drawText(lines[i], { x: x, y: y, size: 11.4, font: regular, color: (0, pdf_lib_1.rgb)(0, 0, 0) });
                                y -= 15;
                            }
                            y -= 4;
                            continue;
                        }
                        if (block.kind === "list_item") {
                            textLines = wrapText(regular, 11.2, block.text, bodyWidth - 36);
                            for (i = 0; i < textLines.length; i += 1) {
                                ensureSpace(15);
                                if (i === 0) {
                                    page.drawText(block.marker, {
                                        x: leftX + 4,
                                        y: y,
                                        size: 11.2,
                                        font: regular,
                                        color: (0, pdf_lib_1.rgb)(0, 0, 0),
                                    });
                                }
                                page.drawText(textLines[i], {
                                    x: leftX + 30,
                                    y: y,
                                    size: 11.2,
                                    font: regular,
                                    color: (0, pdf_lib_1.rgb)(0, 0, 0),
                                });
                                y -= 15;
                            }
                            y -= 2;
                        }
                    }
                    return [4 /*yield*/, pdf.save()];
                case 4:
                    bytes = _a.sent();
                    return [2 /*return*/, Buffer.from(bytes)];
            }
        });
    });
}
function getPdfHeaderFooterConfig(options) {
    if (options === void 0) { options = {}; }
    var documentType = options.documentType, caseName = options.caseName, _a = options.showPageNumbers, showPageNumbers = _a === void 0 ? true : _a;
    // Base config - no headers/footers
    var noHeaderFooter = {
        displayHeaderFooter: false,
        headerTemplate: "",
        footerTemplate: "",
        marginTop: "1in",
        marginBottom: "1in",
        marginLeft: "1in",
        marginRight: "1in",
    };
    // Don't show headers/footers for memos, letters, or if disabled
    // Letters should have clean formatting with no automatic page headers/footers
    if (documentType === "memo" || documentType === "letter" || !showPageNumbers) {
        return noHeaderFooter;
    }
    // Page number footer (common to most document types)
    var pageNumberFooter = "\n    <div style=\"font-size: 9pt; width: 100%; text-align: center; color: #666;\">\n      Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span>\n    </div>\n  ";
    // Demand letters: case name in header, page numbers in footer
    if (documentType === "demand") {
        return {
            displayHeaderFooter: true,
            headerTemplate: caseName
                ? "<div style=\"font-size: 9pt; width: 100%; text-align: right; padding-right: 0.75in; color: #666;\">\n            ".concat(caseName, "\n          </div>")
                : "",
            footerTemplate: pageNumberFooter,
            marginTop: caseName ? "1.25in" : "1in",
            marginBottom: "1.25in",
            marginLeft: "1in",
            marginRight: "1in",
        };
    }
    // Settlement memos: page numbers only
    if (documentType === "settlement") {
        return {
            displayHeaderFooter: true,
            headerTemplate: "",
            footerTemplate: pageNumberFooter,
            marginTop: "1in",
            marginBottom: "1.25in",
            marginLeft: "1in",
            marginRight: "1in",
        };
    }
    if (documentType === "hearing_decision") {
        return {
            displayHeaderFooter: true,
            headerTemplate: "<div style=\"font-size:0; width:100%;\"></div>",
            footerTemplate: "\n        <div style=\"font-size: 9pt; width: 100%; text-align: center; color: #111;\">\n          <span class=\"pageNumber\"></span>\n        </div>\n      ",
            marginTop: "0.35in",
            marginBottom: "0.52in",
            marginLeft: "0.35in",
            marginRight: "0.35in",
        };
    }
    // Generic documents: page numbers in footer
    return {
        displayHeaderFooter: true,
        headerTemplate: "",
        footerTemplate: pageNumberFooter,
        marginTop: "1in",
        marginBottom: "1.25in",
        marginLeft: "1in",
        marginRight: "1in",
    };
}
// Convert HTML to PDF using Puppeteer
function htmlToPdf(html_1, title_1) {
    return __awaiter(this, arguments, void 0, function (html, title, options) {
        var browser, page, headerFooterConfig, pdfBuffer;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, puppeteer_1.default.launch({
                        headless: true,
                        args: ["--no-sandbox", "--disable-setuid-sandbox"],
                    })];
                case 1:
                    browser = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, , 6, 8]);
                    return [4 /*yield*/, browser.newPage()];
                case 3:
                    page = _a.sent();
                    return [4 /*yield*/, page.setContent(html, { waitUntil: "networkidle0" })];
                case 4:
                    _a.sent();
                    headerFooterConfig = getPdfHeaderFooterConfig(options);
                    return [4 /*yield*/, page.pdf({
                            format: "Letter",
                            margin: {
                                top: headerFooterConfig.marginTop,
                                right: headerFooterConfig.marginRight,
                                bottom: headerFooterConfig.marginBottom,
                                left: headerFooterConfig.marginLeft,
                            },
                            printBackground: true,
                            displayHeaderFooter: headerFooterConfig.displayHeaderFooter,
                            headerTemplate: headerFooterConfig.headerTemplate,
                            footerTemplate: headerFooterConfig.footerTemplate,
                        })];
                case 5:
                    pdfBuffer = _a.sent();
                    return [2 /*return*/, Buffer.from(pdfBuffer)];
                case 6: return [4 /*yield*/, browser.close()];
                case 7:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 8: return [2 /*return*/];
            }
        });
    });
}
