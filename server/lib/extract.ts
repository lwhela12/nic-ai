import mammoth from "mammoth";
import { readFile } from "fs/promises";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import pdfParse from "pdf-parse";

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

/**
 * Extract text content from a PDF file using pdf-parse.
 * For scanned/image PDFs, returns empty string to trigger agent fallback
 * (which uses Claude's vision for better accuracy than OCR).
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = await readFile(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text.trim();

    if (text.length > 50) {
      return text;
    }
    // Text too short - likely a scanned PDF, return empty to trigger agent fallback
    console.log(`[Extract] pdf-parse returned only ${text.length} chars, deferring to agent`);
    return '';
  } catch (e) {
    // pdf-parse failed, return empty to trigger agent fallback
    console.log(`[Extract] pdf-parse failed for ${filePath}, deferring to agent`);
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
 * Extract text from a file based on its extension.
 * Supports PDF, DOCX, and plain text formats.
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop();

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
