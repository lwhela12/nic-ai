import { marked } from "marked";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ImageRun,
  LineNumberRestartFormat,
  LineRuleType,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  TableLayoutType,
} from "docx";
import PizZip from "pizzip";
import puppeteer from "puppeteer";
import { PDFDocument, StandardFonts, type PDFFont, rgb, degrees } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import type { DocxStyles } from "./extract";

export type ExportStyleProfile = "auto" | "court_safe" | "template" | "text_only";

// Export options interface for customization
export interface ExportOptions {
  documentType?: "demand" | "settlement" | "memo" | "letter" | "hearing_decision" | "generic";
  firmInfo?: FirmInfo;
  caseName?: string;
  showPageNumbers?: boolean;
  showLetterhead?: boolean;
  templateStyles?: DocxStyles;
  styleProfile?: ExportStyleProfile;
}

export interface FirmInfo {
  name: string;
  address: string;
  cityStateZip?: string;
  phone: string;
  nevadaBarNo?: string;
  fax?: string;
  website?: string;
  attorney?: string;
  logoBase64?: string;
}

const HEARING_DECISION_SEED_DOCX_PATH = fileURLToPath(
  new URL("../assets/builtin-templates/hearing-decision-seed.docx", import.meta.url)
);

const DOCX_REL_TYPE_HEADER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";

// Load firm logo as base64
async function loadFirmLogo(firmRoot: string): Promise<string | undefined> {
  const logoExtensions = ["png", "jpg", "jpeg"];
  for (const ext of logoExtensions) {
    try {
      const logoPath = join(firmRoot, ".ai_tool", `firm-logo.${ext}`);
      console.log(`[Logo] Trying to load logo from: ${logoPath}`);
      const logoBuffer = await readFile(logoPath);
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      console.log(`[Logo] Successfully loaded logo (${logoBuffer.length} bytes)`);
      return `data:${mimeType};base64,${logoBuffer.toString("base64")}`;
    } catch (err) {
      // Try next extension
    }
  }
  console.log(`[Logo] No logo found in ${firmRoot}/.ai_tool/`);
  return undefined;
}

// Parse firm info from firm-config.json or 12-firm-preferences.md file
export async function loadFirmInfo(firmRoot: string): Promise<FirmInfo | null> {
  console.log(`[FirmInfo] Loading firm info from: ${firmRoot}`);

  const firmInfo: FirmInfo = {
    name: "",
    address: "",
    phone: "",
  };

  let hasAnyInfo = false;
  const pickConfigValue = (config: Record<string, any>, keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return undefined;
  };

  // First try firm-config.json (from Firm Settings UI)
  try {
    const configPath = join(firmRoot, ".ai_tool", "firm-config.json");
    const configContent = await readFile(configPath, "utf-8");
    const config = JSON.parse(configContent);
    const configObj = config as Record<string, any>;

    const firmName = pickConfigValue(configObj, ["firmName", "name", "lawFirm", "firm"]);
    if (firmName) {
      firmInfo.name = firmName;
      hasAnyInfo = true;
    }
    const attorney = pickConfigValue(configObj, ["attorneyName", "attorney", "lawyerName"]);
    if (attorney) {
      firmInfo.attorney = attorney;
      hasAnyInfo = true;
    }
    const nevadaBarNo = pickConfigValue(configObj, ["nevadaBarNo", "barNo", "barNumber", "nevadaBarNumber"]);
    if (nevadaBarNo) {
      firmInfo.nevadaBarNo = nevadaBarNo;
      hasAnyInfo = true;
    }
    const address = pickConfigValue(configObj, ["address", "streetAddress", "addressLine1"]);
    if (address) {
      firmInfo.address = address;
      hasAnyInfo = true;
    }
    const cityStateZip = pickConfigValue(configObj, ["cityStateZip"]);
    if (cityStateZip) {
      firmInfo.cityStateZip = cityStateZip;
      hasAnyInfo = true;
    } else {
      const city = pickConfigValue(configObj, ["city"]);
      const state = pickConfigValue(configObj, ["state"]);
      const zip = pickConfigValue(configObj, ["zip", "postalCode"]);
      const fallbackCityStateZip = `${city || ""}${city && state ? ", " : ""}${state || ""}${(city || state) && zip ? " " : ""}${zip || ""}`.trim();
      if (fallbackCityStateZip) {
        firmInfo.cityStateZip = fallbackCityStateZip;
        hasAnyInfo = true;
      }
    }
    const phone = pickConfigValue(configObj, ["phone", "phoneNumber", "telephone"]);
    if (phone) {
      firmInfo.phone = phone;
      hasAnyInfo = true;
    }
  } catch {
    // No firm-config.json, try legacy format
  }

  // Fall back to 12-firm-preferences.md if no config found
  if (!hasAnyInfo) {
    try {
      const prefsPath = join(firmRoot, ".ai_tool", "knowledge", "12-firm-preferences.md");
      const content = await readFile(prefsPath, "utf-8");

      // Parse the firm information block (between triple backticks)
      const firmBlockMatch = content.match(/### Firm Information\s*```([\s\S]*?)```/);
      if (firmBlockMatch) {
        const firmBlock = firmBlockMatch[1].trim();
        const lines = firmBlock.split("\n").map((l) => l.trim()).filter(Boolean);

        // First line is firm name
        if (lines[0]) {
          firmInfo.name = lines[0];
          hasAnyInfo = true;
        }

        // Second line is street address
        if (lines[1]) firmInfo.address = lines[1];

        // Third line is city, state, zip
        if (lines[2]) firmInfo.cityStateZip = lines[2];

        // Parse phone/fax/website from the contact line
        const contactLine = lines.find((l) => l.includes("Phone:"));
        if (contactLine) {
          const phoneMatch = contactLine.match(/Phone:\s*([\d.-]+)/);
          const faxMatch = contactLine.match(/Fax:\s*([\d.-]+)/);
          if (phoneMatch) firmInfo.phone = phoneMatch[1];
          if (faxMatch) firmInfo.fax = faxMatch[1];

          // Website might be on the same line or next line
          const websiteMatch = contactLine.match(/www\.[^\s]+/);
          if (websiteMatch) firmInfo.website = websiteMatch[0];
        }

        // Check for website on separate line
        const websiteLine = lines.find((l) => l.startsWith("www.") || l.includes("http"));
        if (websiteLine && !firmInfo.website) {
          firmInfo.website = websiteLine.replace(/^https?:\/\//, "");
        }

        // Parse attorney name
        const attorneyLine = lines.find((l) => l.includes("Attorney:"));
        if (attorneyLine) {
          firmInfo.attorney = attorneyLine.replace("Attorney:", "").trim();
        }

        // Parse Nevada bar line if present.
        const barLine = lines.find((l) => /bar\s*no\.?/i.test(l));
        if (barLine) {
          const barMatch = barLine.match(/bar\s*no\.?\s*[:#-]?\s*(.+)$/i);
          firmInfo.nevadaBarNo = barMatch ? barMatch[1].trim() : barLine.trim();
        }
      }
    } catch {
      // No preferences file either
    }
  }

  // Always try to load logo, regardless of whether other firm info exists
  const logo = await loadFirmLogo(firmRoot);
  if (logo) {
    firmInfo.logoBase64 = logo;
    hasAnyInfo = true;
  }

  console.log(`[FirmInfo] Result: hasAnyInfo=${hasAnyInfo}, hasLogo=${!!firmInfo.logoBase64}, name="${firmInfo.name}"`);
  return hasAnyInfo ? firmInfo : null;
}

function normalizeFirmField(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildAttorneyFirmBlockLines(firmInfo?: FirmInfo | null): string[] {
  if (!firmInfo) return [];

  const firmName = normalizeFirmField(firmInfo.name);
  const address = normalizeFirmField(firmInfo.address);
  const cityStateZip = normalizeFirmField(firmInfo.cityStateZip);
  const phone = normalizeFirmField(firmInfo.phone);
  const attorney = normalizeFirmField(firmInfo.attorney);
  const barValue = normalizeFirmField(firmInfo.nevadaBarNo);
  const barLine = barValue
    ? (/bar\s*no\.?/i.test(barValue) ? barValue : `Nevada Bar No. ${barValue}`)
    : undefined;

  const addressLine = address && cityStateZip
    ? `${address}, ${cityStateZip}`
    : (address || cityStateZip);

  const orderedLines = [
    firmName,
    addressLine,
    barLine,
    phone,
  ].filter((line): line is string => Boolean(line));

  if (orderedLines.length > 0) {
    return orderedLines;
  }
  return attorney ? [attorney] : [];
}

// Generate letterhead HTML block
function generateLetterheadHtml(firmInfo: FirmInfo): string {
  const logo = firmInfo.logoBase64
    ? `<img src="${firmInfo.logoBase64}" class="firm-logo" alt="Firm Logo">`
    : "";

  const contactParts: string[] = [];
  if (firmInfo.phone) contactParts.push(`Phone: ${firmInfo.phone}`);
  if (firmInfo.fax) contactParts.push(`Fax: ${firmInfo.fax}`);
  if (firmInfo.website) contactParts.push(firmInfo.website);

  // Use markers so DOCX converter can easily strip this section
  return `<!-- LETTERHEAD_START -->
    <div class="letterhead">
      ${logo}
      <div class="firm-name">${firmInfo.name ? firmInfo.name.toUpperCase() : ""}</div>
      <div class="firm-address">${firmInfo.address || ""}${firmInfo.cityStateZip ? ` | ${firmInfo.cityStateZip}` : ""}</div>
      <div class="firm-contact">${contactParts.join(" | ")}</div>
    </div>
    <hr class="letterhead-divider">
<!-- LETTERHEAD_END -->`;
}

function generatePleadingFirmRailHtml(firmInfo?: FirmInfo): string {
  if (!firmInfo) return "";

  const pieces: string[] = [];
  if (firmInfo.name) pieces.push(firmInfo.name.toUpperCase());
  if (firmInfo.address) pieces.push(firmInfo.address);
  if (firmInfo.cityStateZip) pieces.push(firmInfo.cityStateZip);
  if (firmInfo.phone) pieces.push(firmInfo.phone);
  if (firmInfo.fax) pieces.push(`FAX ${firmInfo.fax}`);

  if (pieces.length === 0) return "";

  return `<div class="pleading-firm-rail">${pieces.join(" | ")}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function markdownToPlainText(
  markdown: string,
  options: { wrapWidth?: number; doubleSpace?: boolean } = {}
): string {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: true }) as any[];
  const lines: string[] = [];
  const wrapWidth = Math.max(40, options.wrapWidth ?? 96);
  const doubleSpace = options.doubleSpace ?? true;

  const pushBlank = () => {
    if (lines.length === 0 || lines[lines.length - 1] === "") return;
    lines.push("");
  };

  const pushDoubleSpacedText = (value: string, options: { prefix?: string; indent?: string } = {}) => {
    const prefix = options.prefix || "";
    const indent = options.indent || "";
    const segments = String(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .split(/\r?\n+/)
      .map((segment) => cleanInlineMarkdown(segment))
      .filter(Boolean);

    for (let s = 0; s < segments.length; s += 1) {
      const wrapped = wrapPlainText(
        segments[s],
        wrapWidth - prefix.length,
        s === 0 ? prefix : indent,
        indent
      );
      for (const line of wrapped) {
        lines.push(line);
        if (doubleSpace) lines.push("");
      }
    }
  };

  const renderListItems = (token: any, depth = 0) => {
    if (!Array.isArray(token.items)) return;
    for (let i = 0; i < token.items.length; i += 1) {
      const item = token.items[i];
      const marker = token.ordered ? `${(token.start || 1) + i}. ` : "• ";
      const indent = "  ".repeat(depth);
      pushDoubleSpacedText(item.text || "", {
        prefix: `${indent}${marker}`,
        indent: `${indent}${" ".repeat(marker.length)}`,
      });
      if (Array.isArray(item.tokens)) {
        for (const nested of item.tokens) {
          if (nested.type === "list") {
            renderListItems(nested, depth + 1);
          }
        }
      }
    }
  };

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        pushBlank();
        break;
      case "heading":
        pushBlank();
        lines.push(cleanInlineMarkdown(token.text || "").toUpperCase());
        lines.push("");
        break;
      case "paragraph":
        pushDoubleSpacedText(token.text || "");
        break;
      case "list":
        renderListItems(token);
        break;
      case "blockquote":
        pushDoubleSpacedText(token.text || "", { prefix: "> ", indent: "  " });
        break;
      case "code": {
        pushBlank();
        const codeLines = String(token.text || "")
          .replace(/\r/g, "")
          .split("\n")
          .map((line) => line.trimEnd());
        for (const codeLine of codeLines) {
          lines.push(codeLine);
          if (doubleSpace) lines.push("");
        }
        break;
      }
      case "table": {
        const header = Array.isArray(token.header)
          ? token.header.map((cell: string) => cleanInlineMarkdown(cell)).join(" | ")
          : "";
        if (header) {
          lines.push(header);
          if (doubleSpace) lines.push("");
        }
        if (Array.isArray(token.rows)) {
          for (const row of token.rows) {
            const rowText = Array.isArray(row)
              ? row.map((cell: string) => cleanInlineMarkdown(cell)).join(" | ")
              : "";
            if (!rowText) continue;
            lines.push(rowText);
            if (doubleSpace) lines.push("");
          }
        }
        break;
      }
      default:
        break;
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function wrapPlainText(
  text: string,
  width: number,
  firstPrefix = "",
  continuationPrefix = ""
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const rows: string[] = [];
  let currentPrefix = firstPrefix;
  let current = currentPrefix;

  for (const word of words) {
    const candidate = current.trimEnd().length === currentPrefix.length
      ? `${current}${word}`
      : `${current} ${word}`;

    if (candidate.length > width && current.trim().length > 0) {
      rows.push(current);
      currentPrefix = continuationPrefix;
      current = `${currentPrefix}${word}`;
    } else {
      current = candidate;
    }
  }

  if (current.trim().length > 0) rows.push(current);
  return rows;
}

// Convert markdown to HTML with legal document styling
export function markdownToHtml(markdown: string, options: ExportOptions = {}): string {
  const styleProfile = options.styleProfile ?? "auto";
  if (styleProfile === "text_only") {
    const plainText = markdownToPlainText(markdown);
    const textWithBreaks = escapeHtml(plainText).replace(/\n/g, "<br>");
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: "Courier New", Courier, monospace;
      font-size: 11pt;
      line-height: 1.5;
      margin: 0;
      padding: 1in;
      color: #000;
      background: #fff;
    }
    .text-only-content {
      margin: 0;
      word-break: break-word;
    }
    @page {
      size: letter;
      margin: 1in;
    }
    @media print {
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="text-only-content">${textWithBreaks}</div>
</body>
</html>`;
  }

  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true }) as string;
  const styles = options.templateStyles;
  const isPleadingPaper = options.documentType === "hearing_decision";
  const isCourtCriticalByType = options.documentType === "letter" || options.documentType === "hearing_decision";
  const isCourtCritical = styleProfile === "court_safe" || (styleProfile === "auto" && isCourtCriticalByType);
  const effectiveStyles = isCourtCritical ? undefined : styles;

  const showLetterhead = options.showLetterhead && options.firmInfo;
  console.log(`[Export] markdownToHtml: showLetterhead option=${options.showLetterhead}, hasFirmInfo=${!!options.firmInfo}, result=${showLetterhead}`);
  if (options.firmInfo) {
    console.log(`[Export] firmInfo: name="${options.firmInfo.name}", hasLogo=${!!options.firmInfo.logoBase64}`);
  }
  const letterheadHtml = showLetterhead ? generateLetterheadHtml(options.firmInfo!) : "";

  // Apply extracted template styles or use defaults
  const fontFamily = effectiveStyles?.defaultFont
    ? `'${effectiveStyles.defaultFont}', Times, serif`
    : "'Times New Roman', Times, serif";
  const fontSize = effectiveStyles?.defaultFontSize || 12;
  const lineHeight = effectiveStyles?.bodyText?.lineHeight || 1.6;

  // Heading styles from template or defaults
  const h1Size = effectiveStyles?.heading1?.size || 16;
  const h1Color = effectiveStyles?.heading1?.color || "#000";
  const h2Size = effectiveStyles?.heading2?.size || 14;
  const h2Color = effectiveStyles?.heading2?.color || "#000";
  const h3Size = effectiveStyles?.heading3?.size || 12;
  const h3Color = effectiveStyles?.heading3?.color || "#000";

  // Page margins from template or defaults
  const margins = effectiveStyles?.pageMargins || { top: 1, right: 1, bottom: 1, left: 1 };
  const paddingCss = `${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in`;

  // Table styling
  const tableBorderColor = effectiveStyles?.tableBorderColor || "#666";
  const tableHeaderBg = effectiveStyles?.tableHeaderBg || "#f5f5f5";

  // Primary color for borders etc
  const primaryColor = effectiveStyles?.primaryColor || "#666";

  // Add letterhead-specific CSS only if showing letterhead
  const letterheadCss = showLetterhead
    ? `
    .letterhead {
      text-align: center;
      margin-bottom: 24pt;
    }
    .firm-logo {
      max-height: 60pt;
      margin-bottom: 8pt;
    }
    .firm-name {
      font-size: 18pt;
      font-weight: bold;
      letter-spacing: 2pt;
    }
    .firm-address {
      font-size: 10pt;
      margin-top: 4pt;
    }
    .firm-contact {
      font-size: 10pt;
      color: #444;
    }
    .letterhead-divider {
      border: none;
      border-top: 2px solid #000;
      margin: 12pt 0 24pt;
    }
    `
    : "";

  // Letter-specific CSS - converts headers to bold inline text, hides horizontal rules
  const isLetter = options.documentType === "letter";
  const letterCss = isLetter
    ? `
    /* Letter-specific overrides: no formal headers, no dividers, clean business letter look */
    h1 {
      font-size: 14pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      font-variant: normal;
      margin-top: 0;
      margin-bottom: 12pt;
      border-bottom: none;
    }
    h2 {
      font-size: ${fontSize}pt;
      font-weight: bold;
      font-variant: normal;
      text-transform: none;
      border-bottom: none;
      padding-bottom: 0;
      margin-top: 18pt;
      margin-bottom: 6pt;
    }
    h3 {
      font-size: ${fontSize}pt;
      font-weight: bold;
      font-variant: normal;
      text-transform: none;
      margin-top: 12pt;
      margin-bottom: 6pt;
    }
    hr {
      display: none;
    }
    p {
      text-indent: 0;
      margin: 6pt 0;
      text-align: left;
    }
    `
    : "";

  // Demand letter CSS - clean professional styling without decorative elements
  const isDemand = options.documentType === "demand";
  const demandCss = isDemand
    ? `
    /* Demand letter overrides: clean formal look, no decorative lines */
    h1 {
      font-size: 14pt;
      font-weight: bold;
      text-align: center;
      margin-top: 18pt;
      margin-bottom: 12pt;
      text-transform: uppercase;
    }
    h2 {
      font-size: 12pt;
      font-weight: bold;
      font-variant: normal;
      border-bottom: none;
      padding-bottom: 0;
      margin-top: 18pt;
      margin-bottom: 10pt;
      text-transform: uppercase;
    }
    h3 {
      font-size: 12pt;
      font-weight: bold;
      margin-top: 14pt;
      margin-bottom: 8pt;
    }
    hr {
      display: none;
    }
    p {
      text-indent: 0;
      margin: 10pt 0;
      text-align: left;
    }
    `
    : "";

  const pleadingLinesHtml = Array.from({ length: 28 }, (_, idx) => {
    const lineNumber = idx + 1;
    return `<div class="pleading-line-number">${lineNumber}</div>`;
  }).join("\n");

  const pleadingCss = isPleadingPaper
    ? `
    body.pleading-paper {
      max-width: none;
      padding: 0;
      margin: 0;
    }
    .pleading-page {
      position: relative;
      min-height: 10.5in;
      padding: 0.72in 0.65in 0.72in 0.94in;
      box-sizing: border-box;
    }
    .pleading-frame {
      position: fixed;
      left: 0.84in;
      right: 0.34in;
      top: 0.34in;
      bottom: 0.58in;
      border: 1px solid #3a3a3a;
      pointer-events: none;
      z-index: 0;
    }
    .pleading-gutter {
      position: fixed;
      top: 1.05in;
      bottom: 0.86in;
      left: 0.14in;
      width: 0.54in;
      display: grid;
      grid-template-rows: repeat(28, minmax(0, 1fr));
      justify-items: end;
      align-items: start;
      z-index: 1;
      pointer-events: none;
      color: #111;
      font-size: 9.5pt;
      line-height: 1;
    }
    .pleading-gutter::after {
      content: "";
      position: absolute;
      right: -0.08in;
      top: -0.72in;
      bottom: -0.26in;
      border-right: 1px solid #000;
    }
    .pleading-line-number {
      padding-right: 0.09in;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pleading-firm-rail {
      position: fixed;
      left: 0.03in;
      top: 50%;
      transform: translateY(-50%) rotate(180deg);
      writing-mode: vertical-rl;
      font-size: 8pt;
      line-height: 1.25;
      color: #2b2b2b;
      white-space: nowrap;
      z-index: 1;
      pointer-events: none;
      font-weight: 600;
      letter-spacing: 0.2px;
      text-transform: uppercase;
    }
    .pleading-content {
      position: relative;
      z-index: 2;
    }
    .pleading-content h1 {
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-top: 2pt;
      margin-bottom: 8pt;
      font-size: 13pt;
      border-bottom: none;
    }
    .pleading-content h2 {
      text-transform: uppercase;
      font-variant: normal;
      text-align: center;
      border-bottom: none;
      margin-top: 10pt;
      margin-bottom: 6pt;
      padding-bottom: 0;
      font-size: 12pt;
    }
    .pleading-content h3 {
      font-variant: normal;
      text-transform: uppercase;
      margin-top: 8pt;
      margin-bottom: 4pt;
      font-size: 11.5pt;
    }
    .pleading-content p {
      text-indent: 0;
      text-align: left;
      margin: 6pt 0;
      line-height: 1.38;
    }
    .pleading-content ul,
    .pleading-content ol {
      margin: 6pt 0;
      padding-left: 24pt;
    }
    .pleading-content li {
      margin: 3pt 0;
    }
    .pleading-content table {
      border-collapse: collapse;
      margin: 8pt 0;
      font-size: 11pt;
    }
    .pleading-content th,
    .pleading-content td {
      border: 1px solid #444;
      padding: 5px 7px;
      background: transparent;
    }
    .pleading-content hr {
      display: none;
    }
    `
    : "";

  const bodyClass = isPleadingPaper ? "pleading-paper" : "";
  const pleadingFirmRailHtml = isPleadingPaper ? generatePleadingFirmRailHtml(options.firmInfo) : "";
  const contentHtml = isPleadingPaper
    ? `
    <div class="pleading-frame" aria-hidden="true"></div>
    <div class="pleading-gutter" aria-hidden="true">
      ${pleadingLinesHtml}
    </div>
    ${pleadingFirmRailHtml}
    <div class="pleading-page">
      <div class="pleading-content">
        ${html}
      </div>
    </div>
    `
    : `
    ${letterheadHtml}
    ${html}
    `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: ${fontFamily};
      font-size: ${fontSize}pt;
      line-height: ${lineHeight};
      max-width: 8.5in;
      margin: 0 auto;
      padding: ${paddingCss};
      color: #000;
    }
    h1 {
      font-size: ${h1Size}pt;
      font-weight: bold;
      margin-top: 24pt;
      margin-bottom: 12pt;
      text-align: center;
      color: ${h1Color};
    }
    h2 {
      font-size: ${h2Size}pt;
      font-weight: bold;
      margin-top: 18pt;
      margin-bottom: 10pt;
      font-variant: small-caps;
      border-bottom: 1px solid ${primaryColor};
      padding-bottom: 4pt;
      color: ${h2Color};
    }
    h3 {
      font-size: ${h3Size}pt;
      font-weight: bold;
      margin-top: 14pt;
      margin-bottom: 8pt;
      color: ${h3Color};
    }
    p {
      margin: 10pt 0;
      text-align: justify;
      text-indent: 0.5in;
    }
    /* Don't indent first paragraph after headers or in special contexts */
    h1 + p, h2 + p, h3 + p, .letterhead + hr + p, .no-indent {
      text-indent: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
    }
    th, td {
      border: 1px solid ${tableBorderColor};
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background-color: ${tableHeaderBg};
      font-weight: bold;
      border-bottom: 2px solid ${tableBorderColor};
    }
    ${isCourtCritical ? "" : `
    /* Zebra striping for table rows */
    tbody tr:nth-child(even) {
      background-color: #fafafa;
    }
    tbody tr:hover {
      background-color: #f0f0f0;
    }
    `}
    ul, ol {
      margin: 10pt 0;
      padding-left: 36pt;
    }
    li {
      margin: 3pt 0;
      text-indent: 0;
    }
    li p {
      text-indent: 0;
      margin: 2pt 0;
    }
    hr {
      border: none;
      border-top: 1px solid #000;
      margin: 18pt 0;
    }
    strong {
      font-weight: bold;
    }
    em {
      font-style: italic;
    }
    blockquote {
      margin: 12pt 24pt;
      padding-left: 12pt;
      border-left: 3px solid #ccc;
      font-style: italic;
    }
    ${letterheadCss}
    ${letterCss}
    ${demandCss}
    ${pleadingCss}
    @page {
      size: letter;
      margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
    }
    @media print {
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body class="${bodyClass}">
  ${contentHtml}
</body>
</html>`;
}

// Options for DOCX conversion
export interface DocxConvertOptions {
  documentType?: "demand" | "settlement" | "memo" | "letter" | "hearing_decision" | "generic";
  firmInfo?: FirmInfo;
  showLetterhead?: boolean;
}

export async function markdownToPlainTextDocx(markdown: string, title: string): Promise<Buffer> {
  const plainText = markdownToPlainText(markdown, { wrapWidth: 10000, doubleSpace: false });
  const lines = plainText.split(/\r?\n/);
  const size = 22; // 11pt
  const children: Paragraph[] = lines.map((line) =>
    new Paragraph({
      children: [new TextRun({ text: line || "", size })],
      spacing: {
        before: 0,
        after: 0,
        line: 480, // Double spacing
        lineRule: LineRuleType.AUTO,
      },
    })
  );

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "", size })] }));
  }

  const doc = new Document({
    title,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240,
              height: 15840,
            },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

// Get image dimensions from buffer
function getImageDimensions(buffer: Buffer, type: string): { width: number; height: number } | null {
  try {
    if (type === "png") {
      // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
      if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (type === "jpg" || type === "jpeg") {
      // JPEG: find SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
      let offset = 2; // Skip SOI marker
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        // SOF0, SOF1, SOF2 markers contain dimensions
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        // Skip to next marker
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }
  } catch (err) {
    console.error("[Image] Failed to get dimensions:", err);
  }
  return null;
}

// Generate DOCX letterhead elements
function generateDocxLetterhead(firmInfo: FirmInfo): (Paragraph | Table)[] {
  const elements: Paragraph[] = [];

  // Logo (if available)
  if (firmInfo.logoBase64) {
    try {
      // Extract base64 data from data URL
      const base64Match = firmInfo.logoBase64.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
      if (base64Match) {
        const imageBuffer = Buffer.from(base64Match[2], "base64");
        const imageType = base64Match[1].toLowerCase() === "png" ? "png" : "jpg";

        // Get actual dimensions and scale to fit max size while preserving aspect ratio
        const dims = getImageDimensions(imageBuffer, imageType);
        const maxWidth = 192;  // ~2 inches at 96 DPI
        const maxHeight = 96;  // ~1 inch at 96 DPI

        let width = maxWidth;
        let height = maxHeight;

        if (dims) {
          const aspectRatio = dims.width / dims.height;
          // Scale to fit within max bounds while preserving aspect ratio
          if (dims.width > dims.height) {
            // Wider than tall - constrain by width
            width = Math.min(dims.width, maxWidth);
            height = width / aspectRatio;
          } else {
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

        elements.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                type: imageType as "png" | "jpg",
                transformation: {
                  width: Math.round(width),
                  height: Math.round(height),
                },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
          })
        );
      }
    } catch (err) {
      console.error("[DOCX] Failed to add logo:", err);
    }
  }

  // Firm name
  if (firmInfo.name) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: firmInfo.name.toUpperCase(),
            bold: true,
            size: 28, // 14pt
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      })
    );
  }

  // Address
  const addressParts: string[] = [];
  if (firmInfo.address) addressParts.push(firmInfo.address);
  if (firmInfo.cityStateZip) addressParts.push(firmInfo.cityStateZip);
  if (addressParts.length > 0) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: addressParts.join(" | "),
            size: 20, // 10pt
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
      })
    );
  }

  // Contact info
  const contactParts: string[] = [];
  if (firmInfo.phone) contactParts.push(`Phone: ${firmInfo.phone}`);
  if (firmInfo.fax) contactParts.push(`Fax: ${firmInfo.fax}`);
  if (firmInfo.website) contactParts.push(firmInfo.website);
  if (contactParts.length > 0) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: contactParts.join(" | "),
            size: 20, // 10pt
            color: "444444",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  // Divider line
  elements.push(
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000" },
      },
      spacing: { after: 300 },
    })
  );

  return elements;
}

// Parse HTML and convert to DOCX elements
export async function htmlToDocx(
  html: string,
  title: string,
  options?: DocxConvertOptions
): Promise<Buffer> {
  const isLetter = options?.documentType === "letter";
  const isDemand = options?.documentType === "demand";
  const isHearingDecision = options?.documentType === "hearing_decision";
  const isCleanFormat = isLetter || isDemand; // Both use clean formatting without decorative styles
  // Parse the HTML body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Remove letterhead HTML if present (we'll generate it natively in DOCX)
  bodyContent = bodyContent.replace(/<!-- LETTERHEAD_START -->[\s\S]*?<!-- LETTERHEAD_END -->/gi, "");

  const children: (Paragraph | Table)[] = [];

  // Add DOCX-native letterhead if requested
  if (options?.showLetterhead && options?.firmInfo) {
    const letterheadElements = generateDocxLetterhead(options.firmInfo);
    children.push(...letterheadElements);
  }

  // Simple HTML to DOCX parsing
  const lines = bodyContent.split(/(<[^>]+>)/g).filter(Boolean);

  let currentText: TextRun[] = [];
  let inBold = false;
  let inItalic = false;
  let inList = false;
  let listType: "bullet" | "number" = "bullet";
  let headingLevel: 0 | 1 | 2 | 3 = 0;
  let inTable = false;
  let tableRows: TableRow[] = [];
  let currentRowCells: TableCell[] = [];
  let isHeaderRow = false;

  const flushText = (alignment?: AlignmentType, spacingAfter: number = 200) => {
    if (currentText.length > 0) {
      const para = new Paragraph({
        children: currentText,
        alignment,
        spacing: { after: spacingAfter },
      });
      children.push(para);
      currentText = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      const table = new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      });
      children.push(table);
      tableRows = [];
    }
    inTable = false;
  };

  for (const part of lines) {
    if (!part.trim()) continue;

    // Handle tags
    if (part.trim().startsWith("<")) {
      const tagMatch = part.trim().match(/<\/?(\w+)[^>]*>/i);
      if (!tagMatch) continue;

      const tag = tagMatch[1].toLowerCase();
      const isClosing = part.trim().startsWith("</");

      switch (tag) {
        case "h1":
          if (!isClosing) headingLevel = 1;
          if (isClosing) {
            flushText(AlignmentType.CENTER, 280);
            headingLevel = 0;
          }
          break;
        case "h2":
          if (!isClosing) headingLevel = 2;
          if (isClosing) {
            flushText(undefined, 240);
            headingLevel = 0;
          }
          break;
        case "h3":
          if (!isClosing) headingLevel = 3;
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
            children.push(
              new Paragraph({
                children: currentText,
                bullet: listType === "bullet" ? { level: 0 } : undefined,
                numbering:
                  listType === "number"
                    ? { reference: "default-numbering", level: 0 }
                    : undefined,
                spacing: { after: 100 },
              })
            );
            currentText = [];
          }
          break;
        case "table":
          if (!isClosing) {
            flushText();
            inTable = true;
            tableRows = [];
          } else {
            flushTable();
          }
          break;
        case "thead":
          if (!isClosing) isHeaderRow = true;
          break;
        case "tbody":
          isHeaderRow = false;
          break;
        case "tr":
          if (isClosing && currentRowCells.length > 0) {
            tableRows.push(
              new TableRow({
                children: currentRowCells,
                tableHeader: isHeaderRow,
              })
            );
            currentRowCells = [];
          }
          break;
        case "th":
        case "td":
          if (isClosing && currentText.length > 0) {
            currentRowCells.push(
              new TableCell({
                children: [new Paragraph({ children: currentText })],
                shading:
                  tag === "th" ? { fill: "f0f0f0" } : undefined,
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1 },
                  bottom: { style: BorderStyle.SINGLE, size: 1 },
                  left: { style: BorderStyle.SINGLE, size: 1 },
                  right: { style: BorderStyle.SINGLE, size: 1 },
                },
              })
            );
            currentText = [];
          } else if (isClosing) {
            // Empty cell
            currentRowCells.push(
              new TableCell({
                children: [new Paragraph({})],
                shading:
                  tag === "th" ? { fill: "f0f0f0" } : undefined,
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1 },
                  bottom: { style: BorderStyle.SINGLE, size: 1 },
                  left: { style: BorderStyle.SINGLE, size: 1 },
                  right: { style: BorderStyle.SINGLE, size: 1 },
                },
              })
            );
          }
          break;
        case "hr":
          flushText();
          if (isCleanFormat) {
            // For letters and demands: add blank paragraph spacing instead of visible line
            children.push(
              new Paragraph({
                children: [],
                spacing: { after: 200 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6 },
                },
                spacing: { after: 200 },
              })
            );
          }
          break;
        case "br":
          currentText.push(new TextRun({ break: 1 }));
          break;
      }
    } else {
      // Text content - decode HTML entities, preserve all whitespace for inline formatting
      const decoded = part
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");

      if (decoded) {
        currentText.push(
          new TextRun({
            text: decoded,
            bold: inBold || headingLevel > 0,
            italics: inItalic,
          })
        );
      }
    }
  }

  // Flush any remaining content
  flushText();
  flushTable();

  // Create document
  const doc = new Document({
    title,
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
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
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

interface HearingDecisionLayoutData {
  filingStamp?: string;
  agencyLine: string;
  officerLine: string;
  claimantName: string;
  employerName?: string;
  insurerName?: string;
  dateOfInjury?: string;
  claimNumber?: string;
  hearingNumber?: string;
  appealNumbers: string[];
  bodyMarkdown: string;
}

type HearingDecisionBlock =
  | { kind: "heading"; text: string; level: number }
  | { kind: "paragraph"; text: string }
  | { kind: "list_item"; text: string; marker: string }
  | { kind: "spacer"; lines: number };

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanInlineMarkdown(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_~]+/g, "")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderValue(value: string): boolean {
  const line = cleanInlineMarkdown(value);
  if (!line) return true;
  return (
    /^\[[^\]]+\],?$/.test(line) ||
    /\bclaimant\s*name\b/i.test(line) ||
    /\bverify\b/i.test(line) ||
    /\bplaceholder\b/i.test(line)
  );
}

function isCaptionDescriptor(value: string): boolean {
  const line = cleanInlineMarkdown(value).toLowerCase();
  return (
    line.includes("industrial insurance claim of") ||
    line.includes("in the matter of") ||
    line.includes("state of nevada") ||
    line.includes("department of administration") ||
    line.includes("hearings division") ||
    line.includes("before the appeals officer") ||
    line.includes("before the hearing officer") ||
    line.includes("decision & order") ||
    line.includes("decision and order")
  );
}

function isFieldLine(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9\s/&.'()-]{1,40}:\s*/.test(value.trim());
}

function parseSingleValueField(lines: string[], regexes: RegExp[]): string | undefined {
  for (const line of lines) {
    const normalizedLine = cleanInlineMarkdown(line);
    const candidates = normalizedLine && normalizedLine !== line ? [line, normalizedLine] : [line];
    for (const regex of regexes) {
      for (const candidate of candidates) {
        const match = candidate.match(regex);
        if (match?.[1]) {
          const cleaned = cleanInlineMarkdown(match[1]);
          if (cleaned && !isPlaceholderValue(cleaned)) return cleaned;
        }
      }
    }
  }
  return undefined;
}

function parseAppealNumbers(lines: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = cleanInlineMarkdown(lines[i]);
    const match = line.match(/^\s*Appeal\s*No(?:s)?\.?\s*:\s*(.*)$/i);
    if (!match) continue;

    const current = match[1]?.trim();
    if (current) values.push(current);

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = cleanInlineMarkdown(lines[j]).trim();
      if (!next) break;
      if (isFieldLine(next)) break;
      if (!/[0-9]/.test(next)) break;
      values.push(next);
      i = j;
    }
  }

  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => cleanInlineMarkdown(entry))
    .filter(Boolean);
}

function extractClaimantName(lines: string[], fallback?: string): string {
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i].trim();
    if (!/^claimant[,.]?$/i.test(current)) continue;

    for (let j = i - 1; j >= 0; j -= 1) {
      const prior = cleanInlineMarkdown(lines[j]);
      if (!prior) continue;
      if (isFieldLine(prior)) continue;
      if (/^in the matter of/i.test(prior)) continue;
      if (isPlaceholderValue(prior)) continue;
      if (isCaptionDescriptor(prior)) continue;
      return prior.replace(/[,.;:]$/, "");
    }
  }

  const claimBlock = lines.join("\n");
  const claimRegex = /claim(?:\s+of|\s*:\s*)\s*\n*\s*([^\n]+)/ig;
  let match: RegExpExecArray | null;
  while ((match = claimRegex.exec(claimBlock)) !== null) {
    const candidate = cleanInlineMarkdown(match[1]).replace(/[,.;:]$/, "");
    if (candidate && !isPlaceholderValue(candidate) && !isCaptionDescriptor(candidate)) return candidate;
  }

  const fallbackClean = cleanInlineMarkdown(fallback || "");
  if (fallbackClean && !isPlaceholderValue(fallbackClean)) return fallbackClean;

  for (const line of lines) {
    const candidate = cleanInlineMarkdown(line).replace(/[,.;:]$/, "");
    if (!candidate || isPlaceholderValue(candidate)) continue;
    if (isCaptionDescriptor(candidate)) continue;
    if (/^[A-Z][A-Z\s.'-]{4,}$/.test(candidate) && !isFieldLine(candidate)) {
      return candidate;
    }
  }

  return "[CLAIMANT NAME]";
}

function extractRolePartyName(lines: string[], roleMatchers: RegExp[]): string | undefined {
  const normalizedLines = lines.map((line) => cleanInlineMarkdown(line));

  for (let i = 0; i < normalizedLines.length; i += 1) {
    const current = normalizedLines[i];
    if (!current) continue;
    if (!roleMatchers.some((matcher) => matcher.test(current))) continue;

    for (let j = i - 1; j >= Math.max(0, i - 6); j -= 1) {
      const candidate = normalizedLines[j].replace(/[,.;:]$/, "").trim();
      if (!candidate) continue;
      if (isFieldLine(candidate)) continue;
      if (isCaptionDescriptor(candidate)) continue;
      if (isPlaceholderValue(candidate)) continue;
      if (/^(claimant|employer|insurer|insurer\/tpa|administrator)[,.]?$/i.test(candidate)) continue;
      if (/^(v\.?|vs\.?|and|\)+)$/i.test(candidate)) continue;
      return candidate;
    }
  }

  return undefined;
}

function isCaptionNoiseLine(value: string): boolean {
  const line = cleanInlineMarkdown(value);
  if (!line) return true;

  return (
    /^#*\s*decision\s*(?:&|and)\s*order\s*$/i.test(line) ||
    /^electronic(?:ally)? filed/i.test(line) ||
    /^state of nevada$/i.test(line) ||
    /^state of nevada.*department of administration/i.test(line) ||
    /^nevada department of administration$/i.test(line) ||
    /^nevada department of administration.*hearings division/i.test(line) ||
    /^department of administration$/i.test(line) ||
    /^before the (?:appeals|hearing) officer$/i.test(line) ||
    /^issue before the (?:appeals|hearing) officer$/i.test(line) ||
    /^hearings division$/i.test(line) ||
    /^hearings division\s*-\s*workers'? compensation$/i.test(line) ||
    /^in the matter of/i.test(line) ||
    /^industrial insurance claim of/i.test(line) ||
    /^claimant[,.]?$/i.test(line) ||
    /^employer[,.]?$/i.test(line) ||
    /^insurer[,.]?$/i.test(line) ||
    /^insurer\/tpa[,.]?$/i.test(line) ||
    /^\[[^\]]+\],?$/.test(line) ||
    /^claim no\.?:/i.test(line) ||
    /^claim number:/i.test(line) ||
    /^appeal no(?:s)?\.?:/i.test(line) ||
    /^hearing no\.?:/i.test(line) ||
    /^hearing number:/i.test(line) ||
    /^vs\.?$/i.test(line) ||
    /^and$/i.test(line) ||
    /^\)+$/.test(line) ||
    /^_+$/.test(line)
  );
}

function isBodyAnchorLine(value: string): boolean {
  const line = cleanInlineMarkdown(value);
  if (!line) return false;
  const unnumbered = line.replace(/^(?:[ivxlcdm]+|\d+)\.\s*/i, "");
  return (
    /^(on|the|after|following|having|based|pursuant)\b/i.test(line) ||
    /^this\s+(?:matter|case|hearing|appeal)\b/i.test(line) ||
    /^(findings of fact|conclusions of law|order|procedural history|background|appearances|issue presented|exhibits admitted|notice of appeal rights|certificate of service)\b/i.test(unnumbered) ||
    /^(the following documents were admitted into evidence)/i.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

function removeRepeatedCaptionBody(lines: string[]): string[] {
  let bodyLines = [...lines];

  while (bodyLines.length > 0 && isCaptionNoiseLine(bodyLines[0])) {
    bodyLines.shift();
  }

  const preview = bodyLines.slice(0, 35).map((line) => cleanInlineMarkdown(line));
  const hasCaptionSignals = preview.some((line) =>
    /industrial insurance claim of|claimant|employer|insurer\/tpa|state of nevada|department of administration|appeals officer|hearing officer|claim no|appeal nos?/i.test(line)
  );

  if (hasCaptionSignals) {
    let cutIndex = -1;
    for (let i = 0; i < bodyLines.length; i += 1) {
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

function extractDecisionBodyMarkdown(lines: string[]): string {
  const trimmed = lines.map((line) => line.trim());

  const decisionHeading = trimmed.findIndex((line) =>
    /^(#{1,6}\s*)?(?:(?:hearing|appeals)\s+officer\s+)?decision\s*(?:&|and)\s*order\b/i.test(line)
  );

  const firstBodyHeading = trimmed.findIndex((line) =>
    /^(#{1,6}\s*)?(?:[ivxlcdm]+\.\s*|\d+\.\s*)?(findings of fact|conclusions of law|order|procedural history|background)\b/i.test(line)
  );

  let start = 0;
  if (decisionHeading >= 0) {
    start = decisionHeading + 1;
  } else if (firstBodyHeading >= 0) {
    start = firstBodyHeading;
  } else {
    const narrativeStart = trimmed.findIndex((line) => /^(On|The)\s.+/.test(line) && line.length > 32);
    if (narrativeStart >= 0) start = narrativeStart;
  }

  const bodyLines = removeRepeatedCaptionBody(lines.slice(Math.max(0, start)));

  const body = bodyLines.join("\n").trim();
  return body || lines.join("\n").trim();
}

function parseHearingDecisionLayout(markdown: string, options: ExportOptions): HearingDecisionLayoutData {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const filingStamp = lines
    .map((line) => line.trim())
    .find((line) => /^electronic(?:ally)? filed/i.test(line));

  const agencyLine = lines
    .map((line) => line.trim())
    .find((line) => /nevada department of administration/i.test(line))
    || "NEVADA DEPARTMENT OF ADMINISTRATION";

  let officerLine = lines
    .map((line) => line.trim())
    .find((line) => /before the (?:appeals|hearing) officer/i.test(line));

  if (!officerLine) {
    officerLine = lines.some((line) => /hearings division/i.test(line))
      ? "HEARINGS DIVISION"
      : "BEFORE THE APPEALS OFFICER";
  }

  const normalizedOfficerLine = cleanInlineMarkdown(officerLine);
  if (/appeals officer/i.test(normalizedOfficerLine)) {
    officerLine = "BEFORE THE APPEALS OFFICER";
  } else if (/hearing officer/i.test(normalizedOfficerLine)) {
    officerLine = "BEFORE THE HEARING OFFICER";
  } else if (/hearings division/i.test(normalizedOfficerLine)) {
    officerLine = "HEARINGS DIVISION";
  } else {
    officerLine = normalizedOfficerLine || "BEFORE THE APPEALS OFFICER";
  }

  const claimNumber = parseSingleValueField(lines, [
    /^\s*Claim\s*No\.?\s*:\s*(.+)$/i,
    /^\s*Claim\s*Number\s*:\s*(.+)$/i,
  ]);

  const hearingNumber = parseSingleValueField(lines, [
    /^\s*Hearing\s*No\.?\s*:\s*(.+)$/i,
    /^\s*Hearing\s*Number\s*:\s*(.+)$/i,
  ]);

  const dateOfInjury = parseSingleValueField(lines, [
    /^\s*Date\s*of\s*Injury\s*:\s*(.+)$/i,
    /^\s*DOI\s*:\s*(.+)$/i,
  ]);

  const employerName = parseSingleValueField(lines, [
    /^\s*Employer\s*:\s*(.+)$/i,
  ]) || extractRolePartyName(lines, [
    /^employer[,.]?$/i,
  ]);

  const insurerName = parseSingleValueField(lines, [
    /^\s*(?:Insurer|Carrier|Insurer\/TPA)\s*:\s*(.+)$/i,
  ]) || extractRolePartyName(lines, [
    /^insurer[,.]?$/i,
    /^insurer\/tpa[,.]?$/i,
    /^carrier[,.]?$/i,
  ]);

  const appealNumbers = parseAppealNumbers(lines);
  const claimantName = extractClaimantName(lines, options.caseName);
  const bodyMarkdown = extractDecisionBodyMarkdown(lines);

  return {
    filingStamp,
    agencyLine: "NEVADA DEPARTMENT OF ADMINISTRATION",
    officerLine: cleanInlineMarkdown(officerLine).toUpperCase(),
    claimantName,
    employerName,
    insurerName,
    dateOfInjury,
    claimNumber,
    hearingNumber,
    appealNumbers,
    bodyMarkdown,
  };
}

function markdownToHearingDecisionBlocks(markdown: string): HearingDecisionBlock[] {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: true }) as any[];
  const blocks: HearingDecisionBlock[] = [];

  const addParagraph = (text: string) => {
    const cleaned = cleanInlineMarkdown(text);
    if (cleaned) blocks.push({ kind: "paragraph", text: cleaned });
  };

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        blocks.push({ kind: "spacer", lines: 1 });
        break;
      case "heading": {
        const text = cleanInlineMarkdown(token.text || "");
        if (text) blocks.push({ kind: "heading", text, level: token.depth || 2 });
        break;
      }
      case "paragraph":
        addParagraph(token.text || "");
        break;
      case "list": {
        const start = typeof token.start === "number" ? token.start : 1;
        for (let i = 0; i < token.items.length; i += 1) {
          const item = token.items[i];
          const text = cleanInlineMarkdown(item.text || "");
          if (!text) continue;
          const marker = token.ordered ? `${start + i}.` : "\u2022";
          blocks.push({ kind: "list_item", text, marker });
        }
        break;
      }
      case "blockquote": {
        const quoteText = cleanInlineMarkdown(token.text || "");
        if (quoteText) blocks.push({ kind: "paragraph", text: quoteText });
        break;
      }
      case "hr":
        blocks.push({ kind: "spacer", lines: 1 });
        break;
      case "table": {
        const headers = Array.isArray(token.header)
          ? token.header.map((cell: string) => cleanInlineMarkdown(cell)).filter(Boolean)
          : [];
        if (headers.length > 0) {
          blocks.push({ kind: "paragraph", text: headers.join(" | ") });
        }
        if (Array.isArray(token.rows)) {
          for (const row of token.rows) {
            const cells = row.map((cell: string) => cleanInlineMarkdown(cell)).filter(Boolean);
            if (cells.length > 0) blocks.push({ kind: "paragraph", text: cells.join(" | ") });
          }
        }
        break;
      }
      default: {
        if (typeof token.text === "string") addParagraph(token.text);
      }
    }
  }

  const filtered = blocks.filter((block) => !(block.kind === "paragraph" && isCaptionNoiseLine(block.text)));
  return filtered.length > 0 ? filtered : [{ kind: "paragraph", text: cleanInlineMarkdown(markdown) }];
}

function wrapText(font: PDFFont, size: number, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > 0) {
      let chunk = remaining;
      while (chunk.length > 1 && font.widthOfTextAtSize(chunk, size) > maxWidth) {
        chunk = chunk.slice(0, -1);
      }
      lines.push(chunk);
      remaining = remaining.slice(chunk.length);
    }
    current = "";
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function drawCenteredText(page: any, font: PDFFont, text: string, size: number, y: number): number {
  const width = page.getWidth();
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = (width - textWidth) / 2;
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
  return x;
}

function buildFirmRailText(firmInfo?: FirmInfo): string | undefined {
  if (!firmInfo) return undefined;

  const parts: string[] = [];
  if (firmInfo.name) parts.push(firmInfo.name.toUpperCase());
  if (firmInfo.address) parts.push(firmInfo.address);
  if (firmInfo.cityStateZip) parts.push(firmInfo.cityStateZip);
  if (firmInfo.phone) parts.push(firmInfo.phone);
  if (firmInfo.fax) parts.push(`FAX ${firmInfo.fax}`);
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function drawPleadingPaperPage(
  page: any,
  options: ExportOptions,
  regularFont: PDFFont,
  pageNumber: number,
  firstPage: boolean,
  filingStamp?: string
): void {
  const lineTop = 736;
  const lineBottom = 86;
  const lineCount = 28;
  const spacing = (lineTop - lineBottom) / (lineCount - 1);

  page.drawRectangle({
    x: 58,
    y: 34,
    width: 528,
    height: 744,
    borderColor: rgb(0.55, 0.55, 0.55),
    borderWidth: 0.9,
  });

  page.drawLine({
    start: { x: 52, y: lineBottom - 10 },
    end: { x: 52, y: lineTop + 8 },
    thickness: 0.75,
    color: rgb(0.25, 0.25, 0.25),
  });

  for (let line = 1; line <= lineCount; line += 1) {
    const y = lineTop - (line - 1) * spacing;
    const label = String(line);
    const width = regularFont.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: 42 - width,
      y: y - 3,
      size: 9,
      font: regularFont,
      color: rgb(0.18, 0.18, 0.18),
    });
  }

  const firmRail = buildFirmRailText(options.firmInfo);
  if (firmRail) {
    page.drawText(firmRail, {
      x: 17,
      y: 210,
      size: 7.4,
      font: regularFont,
      color: rgb(0.18, 0.18, 0.18),
      rotate: degrees(90),
    });
  }

  if (firstPage && filingStamp) {
    drawCenteredText(page, regularFont, filingStamp, 10, 775);
  }

  if (options.showPageNumbers !== false) {
    const pageLabel = String(pageNumber);
    const labelWidth = regularFont.widthOfTextAtSize(pageLabel, 10);
    page.drawText(pageLabel, {
      x: (page.getWidth() - labelWidth) / 2,
      y: 20,
      size: 10,
      font: regularFont,
      color: rgb(0, 0, 0),
    });
  }
}

function drawRightField(
  page: any,
  boldFont: PDFFont,
  regularFont: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number
): number {
  const labelSize = 10.5;
  const valueSize = 10.5;
  const rowLineStep = 18;
  page.drawText(label, { x, y, size: labelSize, font: boldFont, color: rgb(0, 0, 0) });
  const valueOffset = 76;
  const valueX = x + valueOffset;
  const valueLines = wrapText(regularFont, valueSize, value, Math.max(40, maxWidth - valueOffset));
  valueLines.forEach((line, idx) => {
    page.drawText(line, {
      x: valueX,
      y: y - idx * rowLineStep,
      size: valueSize,
      font: regularFont,
      color: rgb(0, 0, 0),
    });
  });
  return y - Math.max(1, valueLines.length) * rowLineStep;
}

function drawHearingDecisionCaption(
  page: any,
  data: HearingDecisionLayoutData,
  boldFont: PDFFont,
  regularFont: PDFFont
): number {
  drawCenteredText(page, boldFont, data.agencyLine, 12.3, 736);
  const officerX = drawCenteredText(page, boldFont, data.officerLine, 11.8, 714);
  const officerWidth = boldFont.widthOfTextAtSize(data.officerLine, 11.8);
  page.drawLine({
    start: { x: officerX, y: 710 },
    end: { x: officerX + officerWidth, y: 710 },
    thickness: 0.9,
    color: rgb(0, 0, 0),
  });

  const leftX = 88;
  const captionTop = 682;
  page.drawText("In the Matter of the Contested", { x: leftX, y: captionTop, size: 11.2, font: regularFont });
  page.drawText("Industrial Insurance Claim of", { x: leftX, y: captionTop - 15, size: 11.2, font: regularFont });

  for (let i = 0; i < 8; i += 1) {
    page.drawText(")", { x: 315, y: captionTop - i * 16, size: 11.5, font: regularFont });
  }

  const claimantLine = `${data.claimantName.toUpperCase()},`;
  page.drawText(claimantLine, { x: leftX, y: captionTop - 62, size: 11.2, font: boldFont });
  page.drawText("Claimant.", { x: leftX + 70, y: captionTop - 88, size: 11.2, font: regularFont });
  page.drawLine({
    start: { x: leftX, y: captionTop - 103 },
    end: { x: 300, y: captionTop - 103 },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });

  const rightX = 338;
  let rightY = captionTop - 30;
  if (data.claimNumber) {
    rightY = drawRightField(page, boldFont, regularFont, "Claim No.:", data.claimNumber, rightX, rightY, 162);
  }
  if (data.appealNumbers.length > 0) {
    rightY = drawRightField(
      page,
      boldFont,
      regularFont,
      "Appeal Nos.:",
      data.appealNumbers.join(", "),
      rightX,
      rightY,
      162
    );
  } else if (data.hearingNumber) {
    rightY = drawRightField(page, boldFont, regularFont, "Hearing No.:", data.hearingNumber, rightX, rightY, 162);
  }
  if (data.dateOfInjury) {
    rightY = drawRightField(page, boldFont, regularFont, "Date of Injury:", data.dateOfInjury, rightX, rightY, 162);
  }

  const title = "DECISION & ORDER";
  const titleX = drawCenteredText(page, boldFont, title, 13, 546);
  const titleWidth = boldFont.widthOfTextAtSize(title, 13);
  page.drawLine({
    start: { x: titleX, y: 542 },
    end: { x: titleX + titleWidth, y: 542 },
    thickness: 0.95,
    color: rgb(0, 0, 0),
  });

  return 518;
}

function ensureContentTypeOverride(
  contentTypesXml: string,
  partName: string,
  contentType: string
): string {
  const escapedPart = partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingPattern = new RegExp(
    `<Override[^>]*PartName="${escapedPart}"[^>]*\\/?>`,
    "i"
  );
  if (existingPattern.test(contentTypesXml)) {
    return contentTypesXml;
  }
  return contentTypesXml.replace(
    "</Types>",
    `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`
  );
}

function extractWordStyle(stylesXml: string, styleId: string): string | null {
  const stylePattern = new RegExp(
    `<w:style[^>]*w:styleId="${styleId}"[\\s\\S]*?<\\/w:style>`,
    "i"
  );
  const match = stylesXml.match(stylePattern);
  return match ? match[0] : null;
}

function upsertLineNumbersStyle(stylesXml: string): string {
  const lineNumbersStyleXml =
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="LineNumbers">` +
    `<w:name w:val="Line Numbers"/>` +
    `<w:qFormat/>` +
    `<w:pPr>` +
    `<w:spacing w:before="0" w:after="0" w:line="440" w:lineRule="exact"/>` +
    `<w:ind w:left="0" w:right="0" w:firstLine="0"/>` +
    `<w:jc w:val="right"/>` +
    `</w:pPr>` +
    `<w:rPr>` +
    `<w:sz w:val="16"/>` +
    `<w:szCs w:val="16"/>` +
    `</w:rPr>` +
    `</w:style>`;

  if (/w:styleId="LineNumbers"/.test(stylesXml)) {
    return stylesXml.replace(
      /<w:style[^>]*w:styleId="LineNumbers"[\s\S]*?<\/w:style>/i,
      lineNumbersStyleXml
    );
  }
  return stylesXml.replace("</w:styles>", `${lineNumbersStyleXml}</w:styles>`);
}

function sanitizeSeedHeaderXml(headerXml: string): string {
  let updatedXml = headerXml;

  // Remove duplicate outer-left border line shape.
  updatedXml = updatedXml.replace(
    /<wps:wsp><wps:cNvPr[^>]*name="LeftBorder1"[\s\S]*?<\/wps:wsp>/g,
    ""
  );
  updatedXml = updatedXml.replace(
    /<v:line[^>]*id="LeftBorder1"[^>]*\/>/g,
    ""
  );

  // Prefer DrawingML "Choice" content in LibreOffice to avoid duplicate fallback rendering artifacts.
  updatedXml = updatedXml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");

  // Remove hidden line artifacts from the line-number textbox that can render as an extra gutter line.
  updatedXml = updatedXml.replace(
    /<a:ext uri="\{91240B29-F687-4F45-9708-019B960494DF\}">[\s\S]*?<\/a:ext>/g,
    ""
  );

  // Ensure LibreOffice applies pleading-number spacing even when style inheritance is ignored in text boxes.
  updatedXml = updatedXml.replace(
    /<w:pPr>\s*<w:pStyle w:val="LineNumbers"\/>\s*<\/w:pPr>/g,
    `<w:pPr><w:pStyle w:val="LineNumbers"/><w:spacing w:before="0" w:after="0" w:line="440" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="right"/></w:pPr>`
  );

  return updatedXml;
}

async function applyHearingDecisionSeedScaffold(docxBuffer: Buffer): Promise<Buffer> {
  let seedBuffer: Buffer;
  try {
    seedBuffer = await readFile(HEARING_DECISION_SEED_DOCX_PATH);
  } catch {
    return docxBuffer;
  }

  try {
    const outputZip = new PizZip(docxBuffer);
    const seedZip = new PizZip(seedBuffer);

    const seedHeaderXml = seedZip.file("word/header1.xml")?.asText();
    if (!seedHeaderXml) {
      return docxBuffer;
    }

    outputZip.file("word/header1.xml", sanitizeSeedHeaderXml(seedHeaderXml));

    const seedStylesXml = seedZip.file("word/styles.xml")?.asText();
    if (seedStylesXml) {
      const stylesNode = outputZip.file("word/styles.xml");
      if (stylesNode) {
        let stylesXml = stylesNode.asText();
        const lineNumbersStyle = extractWordStyle(seedStylesXml, "LineNumbers");
        if (lineNumbersStyle && !/w:styleId="LineNumbers"/.test(stylesXml)) {
          stylesXml = stylesXml.replace("</w:styles>", `${lineNumbersStyle}</w:styles>`);
        }
        stylesXml = upsertLineNumbersStyle(stylesXml);
        outputZip.file("word/styles.xml", stylesXml);
      }
    }

    const relsNode = outputZip.file("word/_rels/document.xml.rels");
    if (!relsNode) {
      return docxBuffer;
    }

    let relsXml = relsNode.asText();
    relsXml = relsXml.replace(
      /<Relationship[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/(?:header|footer)"[^>]*\/>/g,
      ""
    );

    const usedRelationshipIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)]
      .map((match) => Number.parseInt(match[1], 10))
      .filter((id) => Number.isFinite(id));
    let nextRelationshipId = usedRelationshipIds.length > 0
      ? Math.max(...usedRelationshipIds) + 1
      : 1;

    const headerRelationshipId = `rId${nextRelationshipId++}`;

    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${headerRelationshipId}" Type="${DOCX_REL_TYPE_HEADER}" Target="header1.xml"/>` +
      "</Relationships>"
    );
    outputZip.file("word/_rels/document.xml.rels", relsXml);

    const contentTypesNode = outputZip.file("[Content_Types].xml");
    if (contentTypesNode) {
      let contentTypesXml = contentTypesNode.asText();
      contentTypesXml = ensureContentTypeOverride(
        contentTypesXml,
        "/word/header1.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"
      );
      outputZip.file("[Content_Types].xml", contentTypesXml);
    }

    const documentNode = outputZip.file("word/document.xml");
    if (!documentNode) {
      return docxBuffer;
    }

    let documentXml = documentNode.asText();
    documentXml = documentXml.replace(/<w:lnNumType[^>]*\/>/g, "");
    documentXml = documentXml.replace(/<w:headerReference[^>]*\/>/g, "");
    documentXml = documentXml.replace(/<w:footerReference[^>]*\/>/g, "");
    documentXml = documentXml.replace(/<w:pgBorders[^>]*>[\s\S]*?<\/w:pgBorders>/g, "");
    documentXml = documentXml.replace(
      /<w:pgMar[^>]*\/>/g,
      '<w:pgMar w:top="1440" w:right="270" w:bottom="1440" w:left="1440" w:header="720" w:footer="1440" w:gutter="0"/>'
    );
    documentXml = documentXml.replace(
      /<w:sectPr([^>]*)>/g,
      `<w:sectPr$1><w:headerReference w:type="default" r:id="${headerRelationshipId}"/>`
    );
    outputZip.file("word/document.xml", documentXml);

    return outputZip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch {
    return docxBuffer;
  }
}

function isMajorSectionHeading(value: string): boolean {
  return /^(findings of fact|conclusions of law|order|appeal issues|procedural history|facts)$/i.test(value.trim());
}

const HEARING_DOCX_FONT_SIZE = 24;
const HEARING_DOCX_LINE = 240;
const HEARING_DOCX_BODY_LINE = 480;
const HEARING_DOCX_LEFT_INDENT = 270;
const HEARING_DOCX_RIGHT_INDENT = 90;
const HEARING_DOCX_FIRST_LINE = 450;

function hearingDecisionSpacing(before = 0, after = 0) {
  return {
    before,
    after,
    line: HEARING_DOCX_LINE,
    lineRule: LineRuleType.AUTO,
  };
}

function hearingDecisionBodySpacing(before = 0, after = 0) {
  return {
    before,
    after,
    line: HEARING_DOCX_BODY_LINE,
    lineRule: LineRuleType.AUTO,
  };
}

function formatCaptionPartyName(value: string): string {
  return cleanInlineMarkdown(value)
    .replace(/[,.;:]$/, "")
    .trim()
    .toUpperCase();
}

function resolveHearingDecisionTitle(officerLine: string): string {
  const normalizedOfficer = cleanInlineMarkdown(officerLine).toUpperCase();
  if (normalizedOfficer.includes("APPEALS OFFICER")) {
    return "APPEALS OFFICER DECISION AND ORDER";
  }
  if (normalizedOfficer.includes("HEARING OFFICER")) {
    return "HEARING OFFICER DECISION AND ORDER";
  }
  return "DECISION AND ORDER";
}

function buildHearingDecisionCaptionTable(data: HearingDecisionLayoutData): Table {
  const captionLeftIndent = 160;
  const captionParagraph = (
    text: string,
    options: { bold?: boolean; italics?: boolean; indentLeft?: number } = {}
  ): Paragraph =>
    new Paragraph({
      children: [
        new TextRun({
          text,
          size: HEARING_DOCX_FONT_SIZE,
          bold: options.bold,
          italics: options.italics,
        }),
      ],
      indent: {
        left: options.indentLeft ?? 0,
        firstLine: 0,
      },
      spacing: hearingDecisionSpacing(),
    });

  const leftCaption: Paragraph[] = [];
  const claimant = formatCaptionPartyName(data.claimantName || "[CLAIMANT NAME]");
  const employer = data.employerName ? formatCaptionPartyName(data.employerName) : undefined;
  const insurer = data.insurerName ? formatCaptionPartyName(data.insurerName) : undefined;

  leftCaption.push(captionParagraph("In the Matter of the Contested", { indentLeft: captionLeftIndent }));
  leftCaption.push(captionParagraph("Industrial Insurance Claim of", { indentLeft: captionLeftIndent }));
  leftCaption.push(captionParagraph("", { indentLeft: captionLeftIndent }));
  leftCaption.push(captionParagraph(`${claimant},`, { bold: true, indentLeft: captionLeftIndent }));
  leftCaption.push(captionParagraph("Claimant,", { italics: true, indentLeft: captionLeftIndent }));

  if (employer || insurer) {
    leftCaption.push(captionParagraph("v.", { indentLeft: captionLeftIndent }));

    if (employer) {
      leftCaption.push(captionParagraph(`${employer},`, { bold: true, indentLeft: captionLeftIndent }));
      leftCaption.push(captionParagraph("Employer,", { italics: true, indentLeft: captionLeftIndent }));
    }

    if (insurer) {
      if (employer) {
        leftCaption.push(captionParagraph("and", { indentLeft: captionLeftIndent }));
      }
      leftCaption.push(captionParagraph(`${insurer},`, { bold: true, indentLeft: captionLeftIndent }));
      leftCaption.push(captionParagraph("Insurer.", { italics: true, indentLeft: captionLeftIndent }));
    }
  }

  const rightFields: Array<{ label: string; value?: string }> = [
    { label: data.appealNumbers.length > 1 ? "Appeal Nos.:" : "Appeal No.:", value: data.appealNumbers.join(", ") || undefined },
    { label: "Claim No.:", value: data.claimNumber },
    { label: "Hearing No.:", value: data.hearingNumber },
    { label: "Date of Injury:", value: data.dateOfInjury },
  ];

  const rightCaptionRows = rightFields.filter((field) => field.value);
  const rightCaptionChildren: Array<Paragraph | Table> = [];

  if (rightCaptionRows.length > 0) {
    const buildRightFieldRow = (field: { label: string; value?: string }, index: number): TableRow =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 44, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: [
              new Paragraph({
                children: [new TextRun({ text: field.label, bold: true, size: HEARING_DOCX_FONT_SIZE })],
                spacing: hearingDecisionBodySpacing(index === 0 ? 220 : 0, 220),
              }),
            ],
          }),
          new TableCell({
            width: { size: 56, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: [
              new Paragraph({
                children: [new TextRun({ text: cleanInlineMarkdown(field.value || ""), size: HEARING_DOCX_FONT_SIZE })],
                spacing: hearingDecisionBodySpacing(index === 0 ? 220 : 0, 220),
              }),
            ],
          }),
        ],
      });

    const rightTableRows = rightCaptionRows.map((field, index) => buildRightFieldRow(field, index));

    rightCaptionChildren.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: rightTableRows,
    }));
  } else {
    rightCaptionChildren.push(captionParagraph(""));
  }

  return new Table({
    width: { size: 92, type: WidthType.PERCENTAGE },
    indent: { size: HEARING_DOCX_LEFT_INDENT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 68, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            },
            children: leftCaption,
          }),
          new TableCell({
            width: { size: 32, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: rightCaptionChildren,
          }),
        ],
      }),
    ],
  });
}

export async function markdownToHearingDecisionDocx(
  markdown: string,
  title: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  const data = parseHearingDecisionLayout(markdown, options);
  const blocks = markdownToHearingDecisionBlocks(data.bodyMarkdown);

  const children: (Paragraph | Table)[] = [];

  if (data.filingStamp) {
    children.push(new Paragraph({
      children: [new TextRun({ text: cleanInlineMarkdown(data.filingStamp), size: 20 })],
      alignment: AlignmentType.CENTER,
      spacing: hearingDecisionSpacing(0, HEARING_DOCX_LINE),
    }));
  }

  children.push(new Paragraph({
    children: [new TextRun({ text: "STATE OF NEVADA", bold: true, size: HEARING_DOCX_FONT_SIZE })],
    alignment: AlignmentType.CENTER,
    spacing: hearingDecisionSpacing(),
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "DEPARTMENT OF ADMINISTRATION", bold: true, size: HEARING_DOCX_FONT_SIZE })],
    alignment: AlignmentType.CENTER,
    spacing: hearingDecisionSpacing(),
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: cleanInlineMarkdown(data.officerLine).toUpperCase(), bold: true, size: HEARING_DOCX_FONT_SIZE })],
    alignment: AlignmentType.CENTER,
    spacing: hearingDecisionSpacing(),
  }));

  children.push(buildHearingDecisionCaptionTable(data));
  children.push(new Paragraph({ spacing: hearingDecisionSpacing(0, HEARING_DOCX_LINE) }));

  const headingTitle = resolveHearingDecisionTitle(data.officerLine);
  children.push(new Paragraph({
    children: [
      new TextRun({
        text: headingTitle,
        bold: true,
        size: HEARING_DOCX_FONT_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: hearingDecisionSpacing(),
  }));

  for (const block of blocks) {
    if (block.kind === "spacer") {
      // Keep body paragraphs contiguous; legal body copy should not add extra blank spacer lines.
      continue;
    }

    if (block.kind === "heading") {
      const headingText = cleanInlineMarkdown(block.text).toUpperCase();
      if (!headingText) continue;
      const majorHeading = isMajorSectionHeading(block.text);
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: headingText,
            bold: true,
            size: HEARING_DOCX_FONT_SIZE,
          }),
        ],
        indent: {
          left: HEARING_DOCX_LEFT_INDENT,
          right: HEARING_DOCX_RIGHT_INDENT,
          firstLine: 0,
        },
        spacing: hearingDecisionBodySpacing(0, 0),
      }));
      continue;
    }

    if (block.kind === "paragraph") {
      const text = cleanInlineMarkdown(block.text);
      if (!text) continue;
      children.push(new Paragraph({
        children: [new TextRun({ text, size: HEARING_DOCX_FONT_SIZE })],
        alignment: AlignmentType.BOTH,
        indent: {
          left: HEARING_DOCX_LEFT_INDENT,
          right: HEARING_DOCX_RIGHT_INDENT,
          firstLine: HEARING_DOCX_FIRST_LINE,
        },
        spacing: hearingDecisionBodySpacing(),
      }));
      continue;
    }

    if (block.kind === "list_item") {
      const itemText = cleanInlineMarkdown(block.text);
      if (!itemText) continue;
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${block.marker} `, size: HEARING_DOCX_FONT_SIZE, bold: true }),
          new TextRun({ text: itemText, size: HEARING_DOCX_FONT_SIZE }),
        ],
        alignment: AlignmentType.BOTH,
        indent: {
          left: HEARING_DOCX_LEFT_INDENT + 360,
          right: HEARING_DOCX_RIGHT_INDENT,
          hanging: 320,
        },
        spacing: hearingDecisionBodySpacing(),
      }));
    }
  }

  const doc = new Document({
    title,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240,
              height: 15840,
            },
            margin: {
              top: 1440,
              right: 270,
              bottom: 1440,
              left: 1440,
            },
            borders: {
              pageBorders: {
                display: PageBorderDisplay.ALL_PAGES,
                offsetFrom: PageBorderOffsetFrom.PAGE,
              },
              pageBorderLeft: {
                style: BorderStyle.SINGLE,
                size: 8,
                color: "8A8A8A",
                space: 24,
              },
              pageBorderTop: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              pageBorderRight: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              pageBorderBottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
          },
          lineNumbers: {
            countBy: 1,
            start: 1,
            restart: LineNumberRestartFormat.NEW_PAGE,
            distance: 420,
          },
        },
        children,
      },
    ],
  });

  const packedBuffer = Buffer.from(await Packer.toBuffer(doc));
  return applyHearingDecisionSeedScaffold(packedBuffer);
}

export async function markdownToHearingDecisionPdf(
  markdown: string,
  title: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  const data = parseHearingDecisionLayout(markdown, options);
  const blocks = markdownToHearingDecisionBlocks(data.bodyMarkdown);

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);

  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  let pageNumber = 1;
  let page = pdf.addPage([612, 792]);
  drawPleadingPaperPage(page, options, regular, pageNumber, true, data.filingStamp);
  let y = drawHearingDecisionCaption(page, data, bold, regular);

  const leftX = 88;
  const bodyWidth = 468;
  const bottomY = 72;

  const addPage = () => {
    pageNumber += 1;
    page = pdf.addPage([612, 792]);
    drawPleadingPaperPage(page, options, regular, pageNumber, false);
    y = 742;
  };

  const ensureSpace = (required: number) => {
    if (y - required < bottomY) addPage();
  };

  for (const block of blocks) {
    if (block.kind === "spacer") {
      y -= Math.max(6, block.lines * 9);
      continue;
    }

    if (block.kind === "heading") {
      const headingText = block.text.toUpperCase();
      const major = isMajorSectionHeading(block.text);
      const size = block.level <= 2 ? 12.3 : 11.7;
      ensureSpace(24);

      if (major) {
        const hx = drawCenteredText(page, bold, headingText, size, y);
        const width = bold.widthOfTextAtSize(headingText, size);
        page.drawLine({
          start: { x: hx, y: y - 3 },
          end: { x: hx + width, y: y - 3 },
          thickness: 0.7,
          color: rgb(0, 0, 0),
        });
      } else {
        page.drawText(headingText, { x: leftX, y, size, font: bold, color: rgb(0, 0, 0) });
      }

      y -= 22;
      continue;
    }

    if (block.kind === "paragraph") {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (!text) continue;

      const firstLineIndent = 22;
      const lines = wrapText(regular, 11.4, text, bodyWidth - firstLineIndent);

      for (let i = 0; i < lines.length; i += 1) {
        ensureSpace(15);
        const x = leftX + (i === 0 ? firstLineIndent : 0);
        page.drawText(lines[i], { x, y, size: 11.4, font: regular, color: rgb(0, 0, 0) });
        y -= 15;
      }
      y -= 4;
      continue;
    }

    if (block.kind === "list_item") {
      const textLines = wrapText(regular, 11.2, block.text, bodyWidth - 36);
      for (let i = 0; i < textLines.length; i += 1) {
        ensureSpace(15);
        if (i === 0) {
          page.drawText(block.marker, {
            x: leftX + 4,
            y,
            size: 11.2,
            font: regular,
            color: rgb(0, 0, 0),
          });
        }
        page.drawText(textLines[i], {
          x: leftX + 30,
          y,
          size: 11.2,
          font: regular,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
      y -= 2;
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

// PDF header/footer configuration by document type
interface PdfHeaderFooterConfig {
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
}

function getPdfHeaderFooterConfig(options: ExportOptions = {}): PdfHeaderFooterConfig {
  const { documentType, caseName, showPageNumbers = true } = options;

  // Base config - no headers/footers
  const noHeaderFooter: PdfHeaderFooterConfig = {
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
  const pageNumberFooter = `
    <div style="font-size: 9pt; width: 100%; text-align: center; color: #666;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>
  `;

  // Demand letters: case name in header, page numbers in footer
  if (documentType === "demand") {
    return {
      displayHeaderFooter: true,
      headerTemplate: caseName
        ? `<div style="font-size: 9pt; width: 100%; text-align: right; padding-right: 0.75in; color: #666;">
            ${caseName}
          </div>`
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
      headerTemplate: `<div style="font-size:0; width:100%;"></div>`,
      footerTemplate: `
        <div style="font-size: 9pt; width: 100%; text-align: center; color: #111;">
          <span class="pageNumber"></span>
        </div>
      `,
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
export async function htmlToPdf(
  html: string,
  title: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const headerFooterConfig = getPdfHeaderFooterConfig(options);

    const pdfBuffer = await page.pdf({
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
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
