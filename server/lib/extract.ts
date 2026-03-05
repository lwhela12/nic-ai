import mammoth from "mammoth";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { runPdftotext } from "./pdftotext";
import { getVfs } from "./vfs";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import { writeFile, mkdir } from "fs/promises";

export const IMAGE_EXTENSIONS = new Set([
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

const BINARY_FILE_EXTENSIONS = new Set([
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
  "ogg",
  ...IMAGE_EXTENSIONS,
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "exe",
  "dll",
  "pkg",
]);

function isBinaryFileByExtension(ext: string | undefined): boolean {
  return !!ext && BINARY_FILE_EXTENSIONS.has(ext.toLowerCase());
}

function getFileExtension(filePath: string): string | undefined {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return undefined;
  return fileName.slice(lastDot + 1).toLowerCase();
}

function isLikelyTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/xml"
    || mimeType === "application/x-javascript"
    || mimeType === "application/javascript";
}

export function isImageFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export function getImageMimeType(filename: string): string {
  const ext = getFileExtension(filename);
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
 * Extracted style information from a DOCX file.
 */
export interface DocxStyles {
  // Document-level settings
  defaultFont: string;
  defaultFontSize: number; // in points
  pageMargins: {
    top: number;    // in inches
    right: number;
    bottom: number;
    left: number;
  };

  // Heading styles
  heading1?: { font?: string; size?: number; bold?: boolean; color?: string };
  heading2?: { font?: string; size?: number; bold?: boolean; color?: string };
  heading3?: { font?: string; size?: number; bold?: boolean; color?: string };

  // Paragraph styles
  bodyText?: { font?: string; size?: number; lineHeight?: number };

  // Table styles
  tableBorderColor?: string;
  tableHeaderBg?: string;

  // Colors
  primaryColor?: string;

  // Raw letterhead image (if embedded)
  letterheadImage?: string; // base64 data URI
}

export interface DocxHtmlExtract {
  html: string;
  css: string;
}

/**
 * Extract text content from a PDF file using pdftotext (poppler).
 * For scanned/image PDFs, returns empty string to trigger agent fallback
 * (which uses Claude's vision for better accuracy than OCR).
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  const vfs = getVfs();
  let localPdfPath = filePath;
  let isTemp = false;

  if (vfs.name !== "local") {
    // Download to temp
    const tmpDir = join(process.cwd(), "tmp");
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
    localPdfPath = join(tmpDir, `${randomUUID()}.pdf`);
    const buffer = await vfs.readFile(filePath);
    await writeFile(localPdfPath, buffer);
    isTemp = true;
  }

  try {
    const args = ["-layout", localPdfPath, "-"];
    const text = (await runPdftotext(args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 })).trim();

    if (text.length > 50) {
      return text;
    }
    // Text too short - likely a scanned PDF, return empty to trigger agent fallback
    console.log(`[Extract] pdftotext returned only ${text.length} chars, deferring to agent`);
    return '';
  } catch (e) {
    // pdftotext failed (not installed or PDF issue), return empty to trigger agent fallback
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.log(`[Extract] pdftotext failed for ${filePath}: ${errorMsg.slice(0, 100)}`);
    return '';
  } finally {
    if (isTemp && existsSync(localPdfPath)) {
      unlinkSync(localPdfPath);
    }
  }
}

/**
 * Extract text content from a DOCX file.
 * Returns the extracted text as markdown-formatted string.
 */
export async function extractTextFromDocx(filePath: string): Promise<string> {
  const vfs = getVfs();
  const dataBuffer = await vfs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  return result.value;
}

/**
 * Extract text from a DOCX file including header/footer content.
 * Mammoth only extracts body text; this also parses header/footer XML parts
 * so that firm info in footers is visible for templatization.
 */
export async function extractFullTextFromDocx(filePath: string): Promise<string> {
  const bodyText = await extractTextFromDocx(filePath);
  const vfs = getVfs();
  const dataBuffer = await vfs.readFile(filePath);
  const zip = await JSZip.loadAsync(dataBuffer);
  const extraParts = [
    "word/header1.xml", "word/header2.xml", "word/header3.xml",
    "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
  ];
  const sections: string[] = [];
  for (const part of extraParts) {
    const file = zip.file(part);
    if (!file) continue;
    const xml = await file.async("text");
    const texts: string[] = [];
    for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
      const decoded = decodeDocxXmlEntities(m[1]);
      if (decoded.trim()) texts.push(decoded);
    }
    if (texts.length) {
      const label = part.includes("header") ? "HEADER" : "FOOTER";
      sections.push(`\n[${label}]\n${texts.join("\n")}`);
    }
  }
  return bodyText + sections.join("\n");
}

/**
 * Extract rendered HTML and embedded CSS from a DOCX file.
 */
export async function extractHtmlFromDocx(filePath: string): Promise<DocxHtmlExtract> {
  const vfs = getVfs();
  const dataBuffer = await vfs.readFile(filePath);
  const result = await mammoth.convertToHtml(
    { buffer: dataBuffer },
    {
      convertImage: mammoth.images.inline(async (image) => {
        const base64 = await image.read("base64");
        return {
          src: `data:${image.contentType};base64,${base64}`,
        };
      }),
    }
  );

  let html = result.value || "";
  const cssFragments: string[] = [];

  // Pull style blocks into a separate stylesheet while keeping body html clean.
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    const style = match.replace(/^<style[^>]*>/i, "").replace(/<\/style>$/i, "").trim();
    if (style) cssFragments.push(style);
    return "";
  });

  return {
    html: html.trim(),
    css: cssFragments.join("\n\n"),
  };
}

/**
 * Extract text from a file based on its extension.
 * Supports PDF, DOCX, and plain text formats.
 */
export async function extractTextFromFile(
  filePath: string,
  options?: { mimeType?: string }
): Promise<string> {
  const ext = getFileExtension(filePath);
  const mimeType = typeof options?.mimeType === "string"
    ? options.mimeType.toLowerCase()
    : undefined;

  if (mimeType === "application/pdf") {
    return extractTextFromPdf(filePath);
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractTextFromDocx(filePath);
  }

  // Google Workspace files (Docs/Sheets/Slides) are exported by GDrive VFS.
  if (mimeType?.startsWith("application/vnd.google-apps.")) {
    const vfs = getVfs();
    try {
      return await vfs.readFile(filePath, "utf-8");
    } catch {
      return `[Could not read file: ${mimeType}]`;
    }
  }

  if (mimeType?.startsWith("image/")) {
    return `[Binary file: ${mimeType}]`;
  }

  if (mimeType && isLikelyTextMimeType(mimeType)) {
    const vfs = getVfs();
    return vfs.readFile(filePath, "utf-8");
  }

  if (isBinaryFileByExtension(ext)) {
    return `[Binary file: ${ext || "unknown"}]`;
  }

  const vfs = getVfs();

  switch (ext) {
    case "pdf":
      return extractTextFromPdf(filePath);
    case "docx":
      return extractTextFromDocx(filePath);
    case "txt":
    case "md":
    case "json":
    case "csv":
      // Plain text files - read directly
      return vfs.readFile(filePath, "utf-8");
    default:
      // Try to read as text, return empty if binary
      try {
        const content = await vfs.readFile(filePath, "utf-8");
        if (!content) return content;
        // Check if content looks like binary (high ratio of non-printable chars)
        const nonPrintable = content.split('').filter((c: string) => {
          const code = c.charCodeAt(0);
          return code < 32 && code !== 9 && code !== 10 && code !== 13;
        }).length;
        if (content.length > 0 && nonPrintable / content.length > 0.1) {
          return `[Binary file: ${ext || mimeType || "unknown"}]`;
        }
        return content;
      } catch {
        return `[Could not read file: ${ext || mimeType || "unknown"}]`;
      }
  }
}

/**
 * Extract style information from a DOCX file by parsing its internal XML.
 * Returns font, color, and margin settings.
 */
export async function extractStylesFromDocx(filePath: string): Promise<DocxStyles> {
  const vfs = getVfs();
  const dataBuffer = await vfs.readFile(filePath);
  const zip = await JSZip.loadAsync(dataBuffer);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  // Default styles
  const styles: DocxStyles = {
    defaultFont: "Times New Roman",
    defaultFontSize: 12,
    pageMargins: {
      top: 1,
      right: 1,
      bottom: 1,
      left: 1,
    },
  };

  // Parse word/document.xml for page setup (margins) and default paragraph styles
  const documentXml = zip.file("word/document.xml");
  if (documentXml) {
    try {
      const content = await documentXml.async("text");
      const parsed = parser.parse(content);

      // Navigate to section properties for page margins
      const body = parsed?.["w:document"]?.["w:body"];
      if (body) {
        // sectPr is usually at the end of body
        const sectPr = body["w:sectPr"];
        if (sectPr) {
          const pgMar = sectPr["w:pgMar"];
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
    } catch {
      // Ignore parsing errors
    }
  }

  // Parse word/styles.xml for style definitions
  const stylesXml = zip.file("word/styles.xml");
  if (stylesXml) {
    try {
      const content = await stylesXml.async("text");
      const parsed = parser.parse(content);

      const stylesList = parsed?.["w:styles"]?.["w:style"];
      if (Array.isArray(stylesList)) {
        for (const style of stylesList) {
          const styleId = style["@_w:styleId"];
          const styleType = style["@_w:type"];
          const isDefault = style["@_w:default"] === "1";

          // Get run properties (font, size, color)
          const rPr = style["w:rPr"];
          const font = rPr?.["w:rFonts"]?.["@_w:ascii"] || rPr?.["w:rFonts"]?.["@_w:hAnsi"];
          const sizeVal = rPr?.["w:sz"]?.["@_w:val"];
          const size = sizeVal ? parseInt(sizeVal, 10) / 2 : undefined; // Half-points to points
          const colorVal = rPr?.["w:color"]?.["@_w:val"];
          const color = colorVal && colorVal !== "auto" ? `#${colorVal}` : undefined;
          const bold = rPr?.["w:b"] !== undefined || rPr?.["w:b"]?.["@_w:val"] === "1";

          // Get paragraph properties (line height)
          const pPr = style["w:pPr"];
          const spacingVal = pPr?.["w:spacing"]?.["@_w:line"];
          const lineHeight = spacingVal ? parseInt(spacingVal, 10) / 240 : undefined; // 240 twips = 1 line

          // Apply to appropriate style category
          if (isDefault && styleType === "paragraph") {
            // Default paragraph style
            if (font) styles.defaultFont = font;
            if (size) styles.defaultFontSize = size;
            styles.bodyText = { font, size, lineHeight };
          } else if (styleId === "Heading1" || styleId?.toLowerCase() === "heading1") {
            styles.heading1 = { font, size, bold, color };
          } else if (styleId === "Heading2" || styleId?.toLowerCase() === "heading2") {
            styles.heading2 = { font, size, bold, color };
          } else if (styleId === "Heading3" || styleId?.toLowerCase() === "heading3") {
            styles.heading3 = { font, size, bold, color };
          } else if (styleId === "Normal" || styleId?.toLowerCase() === "normal") {
            // Normal/Body style
            if (font) styles.defaultFont = font;
            if (size) styles.defaultFontSize = size;
            styles.bodyText = { font: font || styles.defaultFont, size: size || styles.defaultFontSize, lineHeight };
          }

          // Extract primary color from heading1 if available
          if ((styleId === "Heading1" || styleId?.toLowerCase() === "heading1") && color) {
            styles.primaryColor = color;
          }
        }
      }

      // Check document defaults
      const docDefaults = parsed?.["w:styles"]?.["w:docDefaults"];
      if (docDefaults) {
        const rPrDefault = docDefaults["w:rPrDefault"]?.["w:rPr"];
        if (rPrDefault) {
          const defaultFont = rPrDefault["w:rFonts"]?.["@_w:ascii"];
          const defaultSizeVal = rPrDefault["w:sz"]?.["@_w:val"];
          if (defaultFont) styles.defaultFont = defaultFont;
          if (defaultSizeVal) styles.defaultFontSize = parseInt(defaultSizeVal, 10) / 2;
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Try to extract header image (letterhead) from word/media/
  const headerXml = zip.file("word/header1.xml");
  if (headerXml) {
    try {
      const content = await headerXml.async("text");
      const parsed = parser.parse(content);

      // Look for image references in header
      const findImageRefs = (obj: any): string[] => {
        const refs: string[] = [];
        if (!obj) return refs;
        if (typeof obj === "object") {
          if (obj["@_r:embed"]) refs.push(obj["@_r:embed"]);
          for (const key of Object.keys(obj)) {
            refs.push(...findImageRefs(obj[key]));
          }
        } else if (Array.isArray(obj)) {
          for (const item of obj) {
            refs.push(...findImageRefs(item));
          }
        }
        return refs;
      };

      const imageRefs = findImageRefs(parsed);

      if (imageRefs.length > 0) {
        // Parse relationships to find the actual image file
        const relsXml = zip.file("word/_rels/header1.xml.rels");
        if (relsXml) {
          const relsContent = await relsXml.async("text");
          const relsParsed = parser.parse(relsContent);
          const relationships = relsParsed?.Relationships?.Relationship;
          const relsList = Array.isArray(relationships) ? relationships : [relationships].filter(Boolean);

          for (const rel of relsList) {
            if (imageRefs.includes(rel["@_Id"]) && rel["@_Target"]) {
              const imagePath = rel["@_Target"].replace("../", "word/");
              const imageFile = zip.file(imagePath);
              if (imageFile) {
                const imageData = await imageFile.async("base64");
                const ext = imagePath.split(".").pop()?.toLowerCase();
                const mimeType = ext === "png" ? "image/png" : "image/jpeg";
                styles.letterheadImage = `data:${mimeType};base64,${imageData}`;
                break; // Only take first image
              }
            }
          }
        }
      }
    } catch {
      // Ignore header parsing errors
    }
  }

  return styles;
}

/**
 * Convert DOCX twips to inches (1440 twips = 1 inch)
 */
function twipsToInches(twips: string | undefined): number {
  if (!twips) return 1; // default to 1 inch
  const val = parseInt(twips, 10);
  if (isNaN(val)) return 1;
  return Math.round((val / 1440) * 100) / 100; // Round to 2 decimal places
}

/**
 * Unified AI Translation Pipeline:
 * Returns BOTH the UI rendering schema (packetConfig) AND the exact variable map
 * for injecting `{{variableNames}}` into the master template.
 */
export async function extractTemplateSchemaAndInjectionMap(
  templateName: string,
  rawText: string
): Promise<{
  packetConfig: any;
  replacementMap: Record<string, string>;
}> {
  const { getClient } = await import("./doc-agent");

  const referenceExample = JSON.stringify({
    packetConfig: {
      heading: "BEFORE THE APPEALS OFFICER",
      captionPreambleLines: ["In the Matter of the Contested", "Industrial Insurance Claim of"],
      captionFields: [
        { label: "Claim No.:", key: "claimNumber" },
        { label: "Appeal No.:", key: "hearingNumber" },
        { label: "Date/Time:", key: "hearingDateTime" },
        { label: "Employer:", key: "employer" },
        { label: "Appearance:", key: "appearance" },
      ],
      extraSections: [{ title: "ISSUE ON APPEAL", key: "issueOnAppeal" }],
      indexTitle: "DOCUMENT INDEX",
      counselPreamble: "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.",
      affirmationTitle: "AFFIRMATION",
      affirmationText: "Pursuant to NRS 239B.030, the undersigned does hereby affirm the attached documents do not expose the personal information of any person",
      certTitle: "CERTIFICATE OF SERVICE",
      certIntro: "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
      firmBlockPosition: "header",
      signerBlockAlign: "right",
    },
    replacementMap: {
      "John Doe": "{{claimantName}}",
      "123-456": "{{claimNumber}}",
      "789-012": "{{hearingNumber}}",
      "January 1, 2024 at 9:00 AM": "{{hearingDateTime}}",
      "Acme Corp": "{{employer}}",
      "Telephonic": "{{appearance}}",
      "[INSERT ISSUE HERE]": "{{issueOnAppeal}}"
    }
  }, null, 2);

  const prompt = `You are analyzing a legal evidence packet template to produce a unified configuration JSON.

TEMPLATE NAME: ${templateName}

RAW EXTRACTED TEXT:
${rawText}

---

## DOWNSTREAM PIPELINE (how your output is consumed)

1. **replacementMap** — consumed by \`injectVariablesIntoDocx()\`, which performs literal find-and-replace in the DOCX XML. Each key must be an **exact, character-for-character substring** copied from the raw text above. If a key doesn't appear verbatim in the text, the replacement silently fails and the original text remains in the document.

2. **packetConfig** — drives a UI form where users fill in case-specific values per packet. Each \`captionFields[].key\` becomes a form field. The user's input is stored in a \`caption\` object and later injected into the rendered document via docxtemplater.

3. **Available render-time variables** — at render time these hardcoded fields are always available: \`claimantName\`, \`claimNumber\`, \`hearingNumber\`, \`hearingDateTime\`, \`appearance\`, \`firmName\`, \`currentDate\`, \`serviceMonth\`, \`serviceYear\`, \`serviceDay\`, \`documentIndexText\`. Any custom key you define in \`captionFields\` or \`extraSections\` is also available via a \`captionValues\` spread.

4. **Filtering** — only \`replacementMap\` entries whose value starts with \`{{\` are processed. All others are silently ignored. Variable names inside \`{{}}\` must match the regex \`\\w+\` (alphanumeric and underscores only).

---

## OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown fences) containing two top-level keys:

- **packetConfig**: JSON object describing the template's reusable structure. Fields: \`heading\`, \`captionPreambleLines\`, \`captionFields\` (array of \`{label, key}\`), \`extraSections\` (array of \`{title, key}\` — only sections where user fills in variable text per case), \`indexTitle\`, \`counselPreamble\`, \`affirmationTitle\`, \`affirmationText\`, \`certTitle\`, \`certIntro\`, \`firmBlockPosition\` ("header" or "signature"), \`signerBlockAlign\` ("left" or "right").

- **replacementMap**: JSON object where each key is an exact substring from the raw text, and each value is \`{{variableName}}\`.

---

## REFERENCE EXAMPLE

${referenceExample}

---

## GOAL

You are creating a **reusable legal template**. The output document should preserve all structural language but allow a different client's case-specific details to be swapped in. Think of it like a mail-merge: the legal prose, labels, headings, and boilerplate stay fixed — only the facts that change from case to case become variables.

## WHAT TO VARIABLIZE

Identify every piece of **case-specific information** — anything that would be different if this same document type were filed for a different client:
- **Party names** (claimant, employer, attorneys)
- **Case identifiers** (claim numbers, appeal/hearing numbers, docket numbers)
- **Dates and times** (hearing dates, filing dates)
- **Firm information** (firm name, address blocks — including in headers/footers)
- **Case-specific narrative** (e.g. the specific legal issue on appeal)
- **Procedural details** (appearance type, venue)

Each of these values in the raw text should appear as a key in \`replacementMap\`, mapped to a \`{{variableName}}\`.

## WHAT TO PRESERVE

Everything else is structural and must remain untouched:
- **Labels and field descriptors** ("Appeal No.:", "Claim No.:", "Employer:", "Claimant.") — these are the document's skeleton. Only replace the value next to a label, never the label itself.
- **Legal boilerplate** (affirmation language, certification language, standard witness/duration sections)
- **Headings and section titles**
- **Procedural preamble** ("In the Matter of the Contested...")

## CONSTRAINTS

- Variable names in \`replacementMap\` values must match the corresponding \`captionFields[].key\` or \`extraSections[].key\`.
- \`claimantName\` must always be identified — it is required by the rendering pipeline.
- If a "DOCUMENT INDEX" section exists, map its content area to \`{{documentIndexText}}\`.
- Text in \`counselPreamble\`, \`affirmationText\`, and \`certIntro\` should be the reusable version with \`{{variable}}\` placeholders where case-specific values appeared.
- \`extraSections\` is only for sections where the user writes **unique narrative text per case** (e.g. "ISSUE ON APPEAL"). Standard sections with fixed boilerplate text (witnesses, duration, exhibits) are not extraSections.
- \`claimantName\` is always a dedicated top-level UI field — do not duplicate it in \`captionFields\`.
- Use standard key names from the available render-time variables listed above (e.g. \`hearingNumber\` not \`appealNumber\`, \`claimNumber\` not \`caseNumber\`).`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block: any) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI analysis returned no text content for DOCX templating");
  }

  const jsonText = textBlock.text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse Unified Template Pipeline analysis as JSON");
  }

  // Validate replacementMap entries against downstream expectations
  for (const [key, value] of Object.entries(payload.replacementMap || {})) {
    const val = value as string;
    if (!val.startsWith("{{") || !val.endsWith("}}")) {
      console.warn(`[Template] Invalid replacement value for "${key}": "${val}" — must be {{variableName}}`);
    } else {
      const varName = val.slice(2, -2);
      if (!/^\w+$/.test(varName)) {
        console.warn(`[Template] Variable name "${varName}" contains non-word characters — must match \\w+`);
      }
    }
    if (!rawText.includes(key)) {
      console.warn(`[Template] Replacement key not found in raw text: "${key}" — injection will silently fail`);
    }
  }

  // --- Deterministic post-processing of AI output ---

  // a) Remove claimantName from captionFields (it's always a dedicated top-level field)
  if (payload.packetConfig?.captionFields) {
    const before = payload.packetConfig.captionFields.length;
    payload.packetConfig.captionFields = payload.packetConfig.captionFields
      .filter((f: any) => f.key !== "claimantName");
    if (payload.packetConfig.captionFields.length < before) {
      console.log(`[Template] Removed claimantName from captionFields (duplicate of dedicated field)`);
    }
  }

  // b) Normalize appealNumber → hearingNumber everywhere
  if (payload.packetConfig?.captionFields) {
    for (const f of payload.packetConfig.captionFields) {
      if (f.key === "appealNumber") {
        f.key = "hearingNumber";
        console.log(`[Template] Normalized captionField key: appealNumber → hearingNumber`);
      }
    }
  }
  if (payload.replacementMap) {
    for (const [k, v] of Object.entries(payload.replacementMap)) {
      if (v === "{{appealNumber}}") {
        payload.replacementMap[k] = "{{hearingNumber}}";
        console.log(`[Template] Normalized replacementMap value: {{appealNumber}} → {{hearingNumber}}`);
      }
    }
  }

  // c) Filter out boilerplate sections that shouldn't be user-editable
  const BOILERPLATE_KEYS = new Set(["witnesses", "duration", "exhibits", "summary"]);
  if (payload.packetConfig?.extraSections) {
    const before = payload.packetConfig.extraSections.length;
    payload.packetConfig.extraSections = payload.packetConfig.extraSections
      .filter((s: any) => !BOILERPLATE_KEYS.has(s.key?.toLowerCase()));
    const removed = before - payload.packetConfig.extraSections.length;
    if (removed > 0) {
      console.log(`[Template] Removed ${removed} boilerplate extraSection(s) (witnesses/duration/exhibits/summary)`);
    }
  }

  return payload;
}

/**
 * Build a replacementMap deterministically from the markdown variable table
 * produced by analyzeTemplateWithAI (section 3: PLACEHOLDERS & VARIABLES).
 * For each variable, performs case-insensitive search of rawText to find ALL
 * occurrences (e.g. "VALerie owens", "VALERIE OWENS", "Valerie Owens").
 */
export function buildReplacementMapFromMarkdown(
  markdown: string,
  rawText: string
): Record<string, string> {
  const replacementMap: Record<string, string> = {};

  // Parse the variable table: | `{{NAME}}` | description | example_value |
  const tableRows = markdown.matchAll(
    /\|\s*`\{\{(\w+)\}\}`\s*\|[^|]*\|\s*(.+?)\s*\|/g
  );

  // Map SCREAMING_SNAKE to camelCase with domain overrides
  const KEY_MAP: Record<string, string> = {
    CLAIMANT_NAME: "claimantName",
    APPEAL_NUMBER: "hearingNumber",
    CLAIM_NUMBER: "claimNumber",
    HEARING_NUMBER: "priorHearingNumber",
    EMPLOYER_NAME: "employer",
    EMPLOYER: "employer",
    ATTORNEY_1_NAME: "attorney1Name",
    ATTORNEY_2_NAME: "attorney2Name",
    ATTORNEY_1_BAR_NUMBER: "attorney1BarNumber",
    ATTORNEY_2_BAR_NUMBER: "attorney2BarNumber",
    LAW_FIRM_NAME: "firmName",
    FIRM_NAME: "firmName",
    LAW_FIRM_ADDRESS: "firmAddress",
    FIRM_ADDRESS: "firmAddress",
    ISSUE_STATEMENT: "issueOnAppeal",
    ISSUE_ON_APPEAL: "issueOnAppeal",
    HEARING_DATE_TIME: "hearingDateTime",
    HEARING_DATE: "hearingDateTime",
    APPEARANCE: "appearance",
    APPEARANCE_TYPE: "appearance",
    CURRENT_DATE: "currentDate",
    DATE: "currentDate",
    DOCUMENT_INDEX: "documentIndexText",
    DOCUMENT_INDEX_TEXT: "documentIndexText",
    SERVICE_MONTH: "serviceMonth",
    SERVICE_YEAR: "serviceYear",
    SERVICE_DAY: "serviceDay",
    ATTORNEY_NAME: "attorney1Name",
    BAR_NUMBER: "attorney1BarNumber",
    PRIOR_HEARING_NUMBER: "priorHearingNumber",
  };
  const toKey = (name: string) =>
    KEY_MAP[name] ||
    name.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  // Normalize curly/smart quotes to straight for matching
  // DOCX often has \u2018/\u2019 (curly single) and \u201C/\u201D (curly double)
  // while the AI markdown uses straight quotes
  const normalizeQuotes = (s: string) =>
    s.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"');

  const normalizedRaw = normalizeQuotes(rawText);

  for (const match of tableRows) {
    const [, varName, exampleValue] = match;
    const camelKey = toKey(varName);
    const trimmed = exampleValue.trim();
    if (!trimmed || trimmed === "—" || trimmed === "-" || trimmed === "N/A") continue;

    const normalizedExample = normalizeQuotes(trimmed);

    // Case-insensitive search: find ALL occurrences in raw text
    const lowerRaw = normalizedRaw.toLowerCase();
    const lowerExample = normalizedExample.toLowerCase();
    let searchFrom = 0;
    while (searchFrom <= lowerRaw.length - lowerExample.length) {
      const idx = lowerRaw.indexOf(lowerExample, searchFrom);
      if (idx < 0) break;
      // Use the ORIGINAL rawText chars (preserving curly quotes) so the
      // replacement map keys match what injectVariablesIntoDocx will see in the XML
      const exactText = rawText.substring(idx, idx + trimmed.length);
      replacementMap[exactText] = `{{${camelKey}}}`;
      searchFrom = idx + 1;
    }
  }

  return replacementMap;
}

/**
 * Decode XML entities in text content from <w:t> elements.
 */
function decodeDocxXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Re-encode text for safe embedding inside <w:t> XML elements.
 */
function encodeDocxXmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DocxRunInfo {
  /** Full XML of the <w:r> element */
  fullXml: string;
  /** Start index of this run in the paragraph XML */
  xmlStart: number;
  /** End index (exclusive) of this run in the paragraph XML */
  xmlEnd: number;
  /** Decoded text content from <w:t>, or null if no <w:t> */
  text: string | null;
  /** Raw XML content of the <w:t> element (encoded) */
  rawWtContent: string | null;
  /** Start index of <w:t> content within fullXml */
  wtContentStart: number;
  /** End index (exclusive) of <w:t> content within fullXml */
  wtContentEnd: number;
}

/**
 * Extract run info from a paragraph XML string.
 */
function extractRunsFromParagraph(paragraphXml: string): DocxRunInfo[] {
  const runs: DocxRunInfo[] = [];
  const runRegex = /<w:r[\s>][\s\S]*?<\/w:r>/g;
  let match: RegExpExecArray | null;

  while ((match = runRegex.exec(paragraphXml)) !== null) {
    const fullXml = match[0];
    const xmlStart = match.index;
    const xmlEnd = xmlStart + fullXml.length;

    // Extract <w:t> content
    const wtMatch = fullXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    if (wtMatch) {
      const rawContent = wtMatch[1];
      const wtTagStart = fullXml.indexOf(wtMatch[0]);
      // Calculate content offset from the closing tag, not indexOf which can
      // match characters inside the <w:t> tag itself (e.g. a space in
      // '<w:t xml:space="preserve"> </w:t>' would match at position 4 instead of 30)
      const closingTagStr = "</w:t>";
      const closingTagPos = wtMatch[0].indexOf(closingTagStr);
      const contentOffset = closingTagPos - rawContent.length;
      runs.push({
        fullXml,
        xmlStart,
        xmlEnd,
        text: decodeDocxXmlEntities(rawContent),
        rawWtContent: rawContent,
        wtContentStart: wtTagStart + contentOffset,
        wtContentEnd: wtTagStart + contentOffset + rawContent.length,
      });
    } else {
      // Run without <w:t> (e.g., image, symbol, break)
      runs.push({
        fullXml,
        xmlStart,
        xmlEnd,
        text: null,
        rawWtContent: null,
        wtContentStart: 0,
        wtContentEnd: 0,
      });
    }
  }

  return runs;
}

/**
 * Perform cross-run text replacement within a single paragraph.
 * Handles text that is split across multiple <w:r> elements.
 */
function replaceTextInParagraph(
  paragraphXml: string,
  replacements: Array<{ literal: string; replacement: string }>
): string {
  const runs = extractRunsFromParagraph(paragraphXml);
  const textRuns = runs.filter((r) => r.text !== null);
  if (textRuns.length === 0) return paragraphXml;

  // Build a character-to-run position map
  // For each character in the concatenated text, record which run and offset within that run
  interface CharPosition {
    runIndex: number;  // index into textRuns array
    charOffset: number; // offset within that run's decoded text
  }

  const charMap: CharPosition[] = [];
  for (let ri = 0; ri < textRuns.length; ri++) {
    const runText = textRuns[ri].text!;
    for (let ci = 0; ci < runText.length; ci++) {
      charMap.push({ runIndex: ri, charOffset: ci });
    }
  }

  const concatenatedText = textRuns.map((r) => r.text!).join("");
  if (concatenatedText.length === 0) return paragraphXml;

  // Track modifications per text run: array of {start, end, replacement} per run
  interface RunModification {
    charStart: number; // start offset within the run's text
    charEnd: number;   // end offset (exclusive) within the run's text
    replacement: string; // replacement text (only non-empty for first run of a match)
  }
  const runMods: Map<number, RunModification[]> = new Map();

  // Process replacements (longest first already sorted by caller)
  // Use a "consumed" bitmap to avoid overlapping replacements
  const consumed = new Uint8Array(concatenatedText.length);

  for (const { literal, replacement } of replacements) {
    let searchFrom = 0;
    while (searchFrom <= concatenatedText.length - literal.length) {
      const matchIdx = concatenatedText.indexOf(literal, searchFrom);
      if (matchIdx < 0) break;

      // Check if any character in the match range is already consumed
      let overlap = false;
      for (let i = matchIdx; i < matchIdx + literal.length; i++) {
        if (consumed[i]) { overlap = true; break; }
      }
      if (overlap) {
        searchFrom = matchIdx + 1;
        continue;
      }

      // Mark as consumed
      for (let i = matchIdx; i < matchIdx + literal.length; i++) {
        consumed[i] = 1;
      }

      // Determine which runs are affected
      const matchEnd = matchIdx + literal.length;
      const firstCharPos = charMap[matchIdx];
      const lastCharPos = charMap[matchEnd - 1];

      if (firstCharPos.runIndex === lastCharPos.runIndex) {
        // Entire match is within a single run - simple replacement
        const mods = runMods.get(firstCharPos.runIndex) || [];
        mods.push({
          charStart: firstCharPos.charOffset,
          charEnd: firstCharPos.charOffset + literal.length,
          replacement,
        });
        runMods.set(firstCharPos.runIndex, mods);
      } else {
        // Match spans multiple runs
        // First run: replace from match start to end of run's contribution
        const firstRunText = textRuns[firstCharPos.runIndex].text!;
        const firstMods = runMods.get(firstCharPos.runIndex) || [];
        firstMods.push({
          charStart: firstCharPos.charOffset,
          charEnd: firstRunText.length,
          replacement, // Put the full replacement tag in the first run
        });
        runMods.set(firstCharPos.runIndex, firstMods);

        // Middle runs: empty out their text
        for (let ri = firstCharPos.runIndex + 1; ri < lastCharPos.runIndex; ri++) {
          const midText = textRuns[ri].text!;
          const midMods = runMods.get(ri) || [];
          midMods.push({
            charStart: 0,
            charEnd: midText.length,
            replacement: "", // Empty the middle run
          });
          runMods.set(ri, midMods);
        }

        // Last run: remove matched prefix
        const lastMods = runMods.get(lastCharPos.runIndex) || [];
        lastMods.push({
          charStart: 0,
          charEnd: lastCharPos.charOffset + 1,
          replacement: "", // Remove prefix from last run
        });
        runMods.set(lastCharPos.runIndex, lastMods);
      }

      searchFrom = matchEnd;
    }
  }

  if (runMods.size === 0) return paragraphXml;

  // Apply modifications to each affected run's text
  // Build new run XML strings, working backwards through the paragraph
  let result = paragraphXml;

  // Process runs in reverse order (by xmlStart) to preserve indices
  const sortedRunIndices = [...runMods.keys()].sort(
    (a, b) => textRuns[b].xmlStart - textRuns[a].xmlStart
  );

  for (const runIdx of sortedRunIndices) {
    const run = textRuns[runIdx];
    const mods = runMods.get(runIdx)!;
    // Sort modifications in reverse order by charStart
    mods.sort((a, b) => b.charStart - a.charStart);

    let newText = run.text!;
    for (const mod of mods) {
      newText = newText.slice(0, mod.charStart) + mod.replacement + newText.slice(mod.charEnd);
    }

    // Re-encode the modified text for XML
    const encodedNewText = encodeDocxXmlEntities(newText);

    // Replace the <w:t> content within the run's XML
    const newRunXml =
      run.fullXml.slice(0, run.wtContentStart) +
      encodedNewText +
      run.fullXml.slice(run.wtContentEnd);

    // Replace in the paragraph XML
    result =
      result.slice(0, run.xmlStart) +
      newRunXml +
      result.slice(run.xmlEnd);
  }

  return result;
}

/**
 * Process a single XML file from the DOCX, performing cross-run replacements.
 */
function processDocxXmlForInjection(
  xmlText: string,
  sortedReplacements: Array<{ literal: string; replacement: string }>
): string {
  // Process each <w:p> paragraph
  return xmlText.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (paragraph) => {
    // Skip paragraphs containing text boxes — nested <w:p> elements
    // would cause the regex to slice incorrectly, corrupting the XML
    if (paragraph.includes("<w:txbxContent>")) return paragraph;
    return replaceTextInParagraph(paragraph, sortedReplacements);
  });
}

/**
 * Replace the document index block (column headers + entry rows) with a single
 * paragraph containing {{documentIndexText}}.  Operates on the raw XML string
 * after per-paragraph variable injection so any partially-templatized entries
 * are also swept up.
 *
 * Detection heuristic:
 *   - Start: a <w:p> whose concatenated <w:t> text matches the column-header
 *     pattern (DATE … DOCUMENTS … PAGE).
 *   - End:   the next <w:p> whose text starts with "CERTIFICATE OF" (or end
 *     of document body).
 *   - Everything between (inclusive of start, exclusive of end) that contains
 *     visible text is removed.  Empty spacer paragraphs are kept.
 *
 * A single replacement paragraph is inserted where the header row was, using
 * the same paragraph/run properties as the first entry row so formatting is
 * preserved.
 */
function replaceDocumentIndexBlock(xml: string): string {
  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  const paragraphs: { match: string; start: number; end: number; text: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(xml)) !== null) {
    const texts = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]);
    paragraphs.push({
      match: m[0],
      start: m.index,
      end: m.index + m[0].length,
      text: texts.join("").trim(),
    });
  }

  // Find the column-header paragraph: contains DATE, DOCUMENTS, and PAGE
  const headerIdx = paragraphs.findIndex(p => {
    const upper = p.text.toUpperCase();
    return upper.includes("DATE") && upper.includes("DOCUMENT") && upper.includes("PAGE");
  });
  if (headerIdx < 0) return xml; // no document index section found

  // Find the end boundary: first paragraph after header whose text starts with CERTIFICATE OF
  let endIdx = paragraphs.length;
  for (let i = headerIdx + 1; i < paragraphs.length; i++) {
    if (/^CERTIFICATE\s+OF/i.test(paragraphs[i].text)) {
      endIdx = i;
      break;
    }
  }

  // Collect indices of paragraphs with visible text between header and end (these are entries to remove)
  const removeIndices: number[] = [];
  for (let i = headerIdx; i < endIdx; i++) {
    if (paragraphs[i].text.length > 0) {
      removeIndices.push(i);
    }
  }

  if (removeIndices.length === 0) return xml;

  // Build the replacement paragraph using formatting from the first entry row
  // (or the header row if no entries). Extract <w:pPr> and <w:rPr> from it.
  const entryPara = removeIndices.length > 1 ? paragraphs[removeIndices[1]] : paragraphs[removeIndices[0]];
  const pPrMatch = entryPara.match.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const rPrMatch = entryPara.match.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);

  const pPr = pPrMatch ? pPrMatch[0] : "";
  const rPr = rPrMatch ? rPrMatch[0] : "";

  const replacementPara =
    `<w:p><w:pPr>${pPr ? pPr.replace(/<\/?w:pPr>/g, "") : ""}</w:pPr>` +
    `<w:r>${rPr}` +
    `<w:t xml:space="preserve">{{documentIndexText}}</w:t>` +
    `</w:r></w:p>`;

  // Build the new XML by replacing removed paragraphs
  // Work backwards so indices stay valid
  let result = xml;
  for (let i = removeIndices.length - 1; i >= 0; i--) {
    const pi = removeIndices[i];
    const p = paragraphs[pi];
    if (i === 0) {
      // First removed paragraph: replace with the template placeholder
      result = result.slice(0, p.start) + replacementPara + result.slice(p.end);
    } else {
      // Subsequent entry paragraphs: just remove them
      result = result.slice(0, p.start) + result.slice(p.end);
    }
  }

  return result;
}

/**
 * Replaces exact literal string matches with {{variables}} in the DOCX XML.
 * Handles text split across multiple XML runs (caused by formatting changes,
 * spell-check, tracked changes, etc.) by doing character-level replacement.
 * Processes document.xml plus all headers and footers.
 */
export async function injectVariablesIntoDocx(
  filePath: string,
  replacementMap: Record<string, string>,
  options: {
    replaceDocumentIndexBlock?: boolean;
    allowPlainReplacements?: boolean;
  } = {}
): Promise<Uint8Array> {
  const fs = await import("fs/promises");
  const PizZip = (await import("pizzip")).default;

  const docBytes = await fs.readFile(filePath);
  const zip = new PizZip(docBytes);
  const allowPlainReplacements = options.allowPlainReplacements === true;
  const shouldReplaceDocumentIndexBlock = options.replaceDocumentIndexBlock !== false;

  // Sort replacements longest-first to prevent partial matches
  const sortedReplacements = Object.keys(replacementMap)
    .filter((key) => {
      const replacement = replacementMap[key];
      if (typeof replacement !== "string") return false;
      if (allowPlainReplacements) return true;
      return replacement.startsWith("{{");
    })
    .sort((a, b) => b.length - a.length)
    .map((literal) => ({ literal, replacement: replacementMap[literal] }));

  if (sortedReplacements.length === 0) {
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  }

  // Process all relevant XML files (same set as mergeDocxTemplateRuns)
  const xmlFiles = [
    "word/document.xml",
    "word/header1.xml", "word/header2.xml", "word/header3.xml",
    "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
  ];

  for (const xmlPath of xmlFiles) {
    const xmlNode = zip.file(xmlPath);
    if (!xmlNode) continue;

    let xmlText = xmlNode.asText();
    xmlText = processDocxXmlForInjection(xmlText, sortedReplacements);

    // Replace the document index block with {{documentIndexText}} placeholder
    if (xmlPath === "word/document.xml" && shouldReplaceDocumentIndexBlock) {
      xmlText = replaceDocumentIndexBlock(xmlText);
    }

    const original = xmlNode.asText();
    if (xmlText !== original) {
      zip.file(xmlPath, xmlText);
    }
  }

  return zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}



/**
 * Returns a JSON object containing the X/Y coordinates for variables that need
 * to be written over the original PDF template. Uses `pdftotext -bbox-layout` and Haiku.
 */
export async function templatePdfWithAI(
  filePath: string,
  templateName: string
): Promise<Record<string, { page: number; x: number; y: number; width: number; height: number; }>> {
  const { getClient } = await import("./doc-agent");
  const { runPdftotext } = await import("./pdftotext");

  // 1. Get raw bounding box HTML from pdftotext
  const bboxHtml = await runPdftotext(["-bbox-layout", filePath, "-"]);

  // 2. Feed it to AI to map logical variables to bounding boxes
  const prompt = `You are a legal document template processor analyzing the structural bounding box output from \`pdftotext\`.
Your job is to identify literal placeholder text (e.g., "John Doe", "123-456", blanks like "______", bracketed text like "[CLIENT NAME]", or the date field) and map them to their exact coordinates on the page.

TEMPLATE NAME: ${templateName}

BBOX HTML LAYOUT:
<limited representation - do your best>
${bboxHtml.substring(0, 30000)}
<EOF>

---

Analyze the HTML structure. Look for <word> elements or <line> elements that contain the placeholder blanks or text. 

Identify all case-specific information or blanks. Output a JSON object where the keys are the standard generic variables below, and the value is a coordinate object:
Standard variable names to use:
- claimantName
- claimNumber
- hearingNumber
- hearingDateTime
- firmName
- appearance
- currentDate

Output JSON Schema:
{
  "variableName": {
    "page": 1, // 1-indexed based on <page> tags
    "x": 12.34,
    "y": 56.78,
    "width": 100.0,
    "height": 12.0
  }
}

Respond ONLY with valid JSON. Extract the xMin, yMin from the matching tags. Map them to x, y, and calculate width and height from xMax-xMin and yMax-yMin.`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block: any) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI analysis returned no text content for PDF BBox mapping");
  }

  const jsonText = textBlock.text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse PDF BBox AI analysis as JSON");
  }
}
