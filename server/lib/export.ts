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
  HeadingLevel,
  AlignmentType,
  ImageRun,
} from "docx";
import puppeteer from "puppeteer";
import { readFile } from "fs/promises";
import { join } from "path";
import type { DocxStyles } from "./extract";

// Export options interface for customization
export interface ExportOptions {
  documentType?: "demand" | "settlement" | "memo" | "letter" | "generic";
  firmInfo?: FirmInfo;
  caseName?: string;
  showPageNumbers?: boolean;
  showLetterhead?: boolean;
  templateStyles?: DocxStyles;
}

export interface FirmInfo {
  name: string;
  address: string;
  cityStateZip?: string;
  phone: string;
  fax?: string;
  website?: string;
  attorney?: string;
  logoBase64?: string;
}

// Load firm logo as base64
async function loadFirmLogo(firmRoot: string): Promise<string | undefined> {
  const logoExtensions = ["png", "jpg", "jpeg"];
  for (const ext of logoExtensions) {
    try {
      const logoPath = join(firmRoot, ".pi_tool", `firm-logo.${ext}`);
      console.log(`[Logo] Trying to load logo from: ${logoPath}`);
      const logoBuffer = await readFile(logoPath);
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      console.log(`[Logo] Successfully loaded logo (${logoBuffer.length} bytes)`);
      return `data:${mimeType};base64,${logoBuffer.toString("base64")}`;
    } catch (err) {
      // Try next extension
    }
  }
  console.log(`[Logo] No logo found in ${firmRoot}/.pi_tool/`);
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

  // First try firm-config.json (from Firm Settings UI)
  try {
    const configPath = join(firmRoot, ".pi_tool", "firm-config.json");
    const configContent = await readFile(configPath, "utf-8");
    const config = JSON.parse(configContent);

    if (config.firmName) {
      firmInfo.name = config.firmName;
      hasAnyInfo = true;
    }
    if (config.address) {
      firmInfo.address = config.address;
      hasAnyInfo = true;
    }
    if (config.phone) {
      firmInfo.phone = config.phone;
      hasAnyInfo = true;
    }
  } catch {
    // No firm-config.json, try legacy format
  }

  // Fall back to 12-firm-preferences.md if no config found
  if (!hasAnyInfo) {
    try {
      const prefsPath = join(firmRoot, ".pi_tool", "knowledge", "12-firm-preferences.md");
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

// Convert markdown to HTML with legal document styling
export function markdownToHtml(markdown: string, options: ExportOptions = {}): string {
  const html = marked.parse(markdown, { async: false }) as string;
  const styles = options.templateStyles;

  const showLetterhead = options.showLetterhead && options.firmInfo;
  console.log(`[Export] markdownToHtml: showLetterhead option=${options.showLetterhead}, hasFirmInfo=${!!options.firmInfo}, result=${showLetterhead}`);
  if (options.firmInfo) {
    console.log(`[Export] firmInfo: name="${options.firmInfo.name}", hasLogo=${!!options.firmInfo.logoBase64}`);
  }
  const letterheadHtml = showLetterhead ? generateLetterheadHtml(options.firmInfo!) : "";

  // Apply extracted template styles or use defaults
  const fontFamily = styles?.defaultFont
    ? `'${styles.defaultFont}', Times, serif`
    : "'Times New Roman', Times, serif";
  const fontSize = styles?.defaultFontSize || 12;
  const lineHeight = styles?.bodyText?.lineHeight || 1.6;

  // Heading styles from template or defaults
  const h1Size = styles?.heading1?.size || 16;
  const h1Color = styles?.heading1?.color || "#000";
  const h2Size = styles?.heading2?.size || 14;
  const h2Color = styles?.heading2?.color || "#000";
  const h3Size = styles?.heading3?.size || 12;
  const h3Color = styles?.heading3?.color || "#000";

  // Page margins from template or defaults
  const margins = styles?.pageMargins || { top: 1, right: 1, bottom: 1, left: 1 };
  const paddingCss = `${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in`;

  // Table styling
  const tableBorderColor = styles?.tableBorderColor || "#666";
  const tableHeaderBg = styles?.tableHeaderBg || "#f5f5f5";

  // Primary color for borders etc
  const primaryColor = styles?.primaryColor || "#666";

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
    /* Letter-specific overrides: no formal headers, no dividers */
    h1 {
      font-size: ${fontSize}pt;
      font-weight: bold;
      text-align: left;
      margin-top: 12pt;
      margin-bottom: 6pt;
    }
    h2 {
      font-size: ${fontSize}pt;
      font-weight: bold;
      font-variant: normal;
      border-bottom: none;
      padding-bottom: 0;
      margin-top: 12pt;
      margin-bottom: 6pt;
    }
    h3 {
      font-size: ${fontSize}pt;
      font-weight: bold;
      margin-top: 12pt;
      margin-bottom: 6pt;
    }
    hr {
      display: none;
    }
    p {
      text-indent: 0;
      margin: 6pt 0;
    }
    `
    : "";

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
    /* Zebra striping for table rows */
    tbody tr:nth-child(even) {
      background-color: #fafafa;
    }
    tbody tr:hover {
      background-color: #f0f0f0;
    }
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
<body>
  ${letterheadHtml}
  ${html}
</body>
</html>`;
}

// Options for DOCX conversion
export interface DocxConvertOptions {
  documentType?: "demand" | "settlement" | "memo" | "letter" | "generic";
  firmInfo?: FirmInfo;
  showLetterhead?: boolean;
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
  let inTable = false;
  let tableRows: TableRow[] = [];
  let currentRowCells: TableCell[] = [];
  let isHeaderRow = false;

  const flushText = (heading?: HeadingLevel, alignment?: AlignmentType) => {
    if (currentText.length > 0) {
      const para = new Paragraph({
        children: currentText,
        heading,
        alignment,
        spacing: { after: 200 },
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
          if (isClosing) {
            // For letters: render as bold paragraph, not styled heading
            flushText(isLetter ? undefined : HeadingLevel.HEADING_1, isLetter ? undefined : AlignmentType.CENTER);
          }
          break;
        case "h2":
          if (isClosing) {
            // For letters: render as bold paragraph, not styled heading
            flushText(isLetter ? undefined : HeadingLevel.HEADING_2);
          }
          break;
        case "h3":
          if (isClosing) {
            // For letters: render as bold paragraph, not styled heading
            flushText(isLetter ? undefined : HeadingLevel.HEADING_3);
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
          if (isLetter) {
            // For letters: add blank paragraph spacing instead of visible line
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
            bold: inBold,
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

// PDF header/footer configuration by document type
interface PdfHeaderFooterConfig {
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  marginTop: string;
  marginBottom: string;
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
    };
  }

  // Generic documents: page numbers in footer
  return {
    displayHeaderFooter: true,
    headerTemplate: "",
    footerTemplate: pageNumberFooter,
    marginTop: "1in",
    marginBottom: "1.25in",
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
        right: "1in",
        bottom: headerFooterConfig.marginBottom,
        left: "1in",
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
