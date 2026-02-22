import mammoth from "mammoth";
import { readFile } from "fs/promises";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { extractPdfText } from "./pdftotext";

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

export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export function getImageMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
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
  try {
    const text = await extractPdfText(filePath, {
      layout: true,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

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
  }
}

/**
 * Extract text content from a DOCX file.
 * Returns the extracted text as markdown-formatted string.
 */
export async function extractTextFromDocx(filePath: string): Promise<string> {
  const dataBuffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  return result.value;
}

/**
 * Extract rendered HTML and embedded CSS from a DOCX file.
 */
export async function extractHtmlFromDocx(filePath: string): Promise<DocxHtmlExtract> {
  const dataBuffer = await readFile(filePath);
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
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop();
  if (isBinaryFileByExtension(ext)) {
    return `[Binary file: ${ext}]`;
  }

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
      return readFile(filePath, "utf-8");
    default:
      // Try to read as text, return empty if binary
      try {
        const content = await readFile(filePath, "utf-8");
        // Check if content looks like binary (high ratio of non-printable chars)
        const nonPrintable = content.split('').filter(c => {
          const code = c.charCodeAt(0);
          return code < 32 && code !== 9 && code !== 10 && code !== 13;
        }).length;
        if (nonPrintable / content.length > 0.1) {
          return `[Binary file: ${ext}]`;
        }
        return content;
      } catch {
        return `[Could not read file: ${ext}]`;
      }
  }
}

/**
 * Extract style information from a DOCX file by parsing its internal XML.
 * Returns font, color, and margin settings.
 */
export async function extractStylesFromDocx(filePath: string): Promise<DocxStyles> {
  const dataBuffer = await readFile(filePath);
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
      affirmationText: "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
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

## CONSTRAINTS

- Variable names in \`replacementMap\` values must match the corresponding \`captionFields[].key\` or \`extraSections[].key\`. For example, if you define a captionField with key \`employer\`, the replacement value must be \`{{employer}}\`.
- \`claimantName\` must always be identified — it is required by the rendering pipeline. Find the primary litigant's name in the raw text and map it to \`{{claimantName}}\`.
- If a "DOCUMENT INDEX" section exists, map its content area to \`{{documentIndexText}}\`.
- Text in \`counselPreamble\`, \`affirmationText\`, and \`certIntro\` should be the reusable version with \`{{variable}}\` placeholders where case-specific values appeared. These fields must work for ANY case, so replace all attorney names, firm names, and specific addresses with generic language like "counsel" or "by and through counsel".`;

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

  return payload;
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
    const wtMatch = fullXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
    if (wtMatch) {
      const rawContent = wtMatch[1];
      const wtTagStart = fullXml.indexOf(wtMatch[0]);
      const contentOffset = wtMatch[0].indexOf(rawContent);
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
    return replaceTextInParagraph(paragraph, sortedReplacements);
  });
}

/**
 * Replaces exact literal string matches with {{variables}} in the DOCX XML.
 * Handles text split across multiple XML runs (caused by formatting changes,
 * spell-check, tracked changes, etc.) by doing character-level replacement.
 * Processes document.xml plus all headers and footers.
 */
export async function injectVariablesIntoDocx(
  filePath: string,
  replacementMap: Record<string, string>
): Promise<Uint8Array> {
  const fs = await import("fs/promises");
  const PizZip = (await import("pizzip")).default;

  const docBytes = await fs.readFile(filePath);
  const zip = new PizZip(docBytes);

  // Sort replacements longest-first to prevent partial matches
  const sortedReplacements = Object.keys(replacementMap)
    .filter((key) => replacementMap[key].startsWith("{{"))
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

    const xmlText = xmlNode.asText();
    const processed = processDocxXmlForInjection(xmlText, sortedReplacements);
    if (processed !== xmlText) {
      zip.file(xmlPath, processed);
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
