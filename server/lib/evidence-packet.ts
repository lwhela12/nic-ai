import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { runPdftotext } from "./pdftotext";

type SortBy = "none" | "date" | "title" | "path";
type SortDirection = "asc" | "desc";

export interface EvidencePacketDocumentInput {
  path: string;
  title: string;
  date?: string;
  docType?: string;
  include?: boolean;
}

export interface EvidencePacketOrderRule {
  id: string;
  required?: boolean;
  match?: {
    docTypes?: string[];
    pathRegex?: string;
    titleRegex?: string;
  };
  sortBy?: SortBy;
  sortDirection?: SortDirection;
}

export interface EvidencePacketRedactionOptions {
  enabled?: boolean;
  mode?: "detect_only" | "best_effort";
  failOnDetection?: boolean;
  failOnUnprocessable?: boolean;
}

export interface EvidencePacketCaption {
  claimantName: string;
  claimNumber?: string;
  hearingNumber?: string;
  hearingDateTime?: string;
  appearance?: string;
  introductoryCounselLine?: string;
}

export interface EvidencePacketServiceInfo {
  serviceDate?: string;
  serviceMethod?: string;
  recipients?: string[];
  servedBy?: string;
}

export interface BuildEvidencePacketOptions {
  caseFolder: string;
  documents: EvidencePacketDocumentInput[];
  caption: EvidencePacketCaption;
  orderRules?: EvidencePacketOrderRule[];
  redaction?: EvidencePacketRedactionOptions;
  service?: EvidencePacketServiceInfo;
  includeAffirmationPage?: boolean;
  pageStampPrefix?: string;
  pageStampStart?: number;
  firmBlockLines?: string[];
}

export interface EvidencePacketTocEntry {
  title: string;
  path: string;
  startPage: number;
  endPage: number;
}

export interface EvidencePacketRedactionFinding {
  path: string;
  page: number;
  kind: "dob" | "ssn";
  preview: string;
}

export interface BuildEvidencePacketResult {
  pdfBytes: Uint8Array;
  orderedDocuments: EvidencePacketDocumentInput[];
  tocEntries: EvidencePacketTocEntry[];
  warnings: string[];
  redactionFindings: EvidencePacketRedactionFinding[];
  totalPages: number;
}

interface ProcessedDocument {
  document: EvidencePacketDocumentInput;
  absolutePath: string;
  pdfBytes: Uint8Array;
  pageCount: number;
}

interface WordBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface SensitiveBox {
  kind: "dob" | "ssn";
  box: WordBox;
  preview: string;
}

const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/;
const SSN_NO_DASH_REGEX = /^\d{9}$/;
const DATE_REGEX = /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/;
const DOB_CONTEXT_REGEX = /\b(dob|d\.?o\.?b|date of birth|birth date)\b/i;
const SSN_CONTEXT_REGEX = /\b(ssn|social security|social)\b/i;

export async function buildEvidencePacket(
  options: BuildEvidencePacketOptions
): Promise<BuildEvidencePacketResult> {
  const warnings: string[] = [];
  const redactionFindings: EvidencePacketRedactionFinding[] = [];

  const filteredDocs = options.documents.filter((doc) => doc.include !== false);
  if (filteredDocs.length === 0) {
    throw new Error("No documents selected for packet");
  }

  const orderedDocs = orderDocuments(filteredDocs, options.orderRules, warnings);
  const processedDocs: ProcessedDocument[] = [];

  for (const doc of orderedDocs) {
    const absolutePath = resolveCasePath(options.caseFolder, doc.path);
    if (!doc.path.toLowerCase().endsWith(".pdf")) {
      throw new Error(`Only PDF documents are supported in packets: ${doc.path}`);
    }

    const originalBytes = await readFile(absolutePath);
    let pdfBytes: Uint8Array = originalBytes;

    if (options.redaction?.enabled) {
      const redactResult = await redactPdfIfRequested(
        absolutePath,
        originalBytes,
        doc.path,
        options.redaction
      );
      pdfBytes = redactResult.pdfBytes;
      redactionFindings.push(...redactResult.findings);
      warnings.push(...redactResult.warnings);
    }

    const pageCount = await getPdfPageCount(pdfBytes, doc.path);
    processedDocs.push({
      document: doc,
      absolutePath,
      pdfBytes,
      pageCount,
    });
  }

  if (options.redaction?.enabled && options.redaction.failOnDetection && redactionFindings.length > 0) {
    throw new Error(
      `Sensitive data was detected in ${redactionFindings.length} locations. ` +
      `Review and rerun without failOnDetection to proceed.`
    );
  }

  const pageStampPrefix = options.pageStampPrefix ?? "Page ";
  const pageStampStart = options.pageStampStart ?? 1;

  const tocEntries: EvidencePacketTocEntry[] = [];
  let runningExhibitPage = pageStampStart;
  for (const processed of processedDocs) {
    const startPage = runningExhibitPage;
    const endPage = runningExhibitPage + processed.pageCount - 1;
    tocEntries.push({
      title: processed.document.title,
      path: processed.document.path,
      startPage,
      endPage,
    });
    runningExhibitPage = endPage + 1;
  }

  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdf.embedFont(StandardFonts.TimesRomanBold);

  let frontMatterPages = addIndexPages(pdf, regularFont, boldFont, options, tocEntries);
  if (options.includeAffirmationPage !== false) {
    frontMatterPages += addAffirmationPage(pdf, regularFont, boldFont, options, frontMatterPages + 1);
  }

  let exhibitPageNumber = pageStampStart;
  for (const processed of processedDocs) {
    const sourcePdf = await PDFDocument.load(processed.pdfBytes);
    const copiedPages = await pdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of copiedPages) {
      pdf.addPage(page);
      stampExhibitPageNumber(page, regularFont, `${pageStampPrefix}${exhibitPageNumber}`);
      exhibitPageNumber += 1;
    }
  }

  const pdfBytes = await pdf.save();
  return {
    pdfBytes,
    orderedDocuments: orderedDocs,
    tocEntries,
    warnings,
    redactionFindings,
    totalPages: pdf.getPageCount(),
  };
}

function resolveCasePath(caseFolder: string, relativePath: string): string {
  const base = resolve(caseFolder);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Path is outside case folder: ${relativePath}`);
  }
  return target;
}

function parseDateValue(value?: string): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function compileRuleRegex(input?: string): RegExp | null {
  if (!input) return null;
  try {
    return new RegExp(input, "i");
  } catch {
    return null;
  }
}

function orderDocuments(
  documents: EvidencePacketDocumentInput[],
  orderRules: EvidencePacketOrderRule[] | undefined,
  warnings: string[]
): EvidencePacketDocumentInput[] {
  const annotated = documents.map((doc, originalIndex) => ({ doc, originalIndex }));
  if (!orderRules || orderRules.length === 0) {
    return annotated.sort((a, b) => a.originalIndex - b.originalIndex).map((item) => item.doc);
  }

  const remaining = [...annotated];
  const ordered: Array<{ doc: EvidencePacketDocumentInput; originalIndex: number }> = [];

  for (const rule of orderRules) {
    const pathRegex = compileRuleRegex(rule.match?.pathRegex);
    const titleRegex = compileRuleRegex(rule.match?.titleRegex);
    if ((rule.match?.pathRegex && !pathRegex) || (rule.match?.titleRegex && !titleRegex)) {
      warnings.push(`Rule "${rule.id}" has invalid regex and was skipped`);
      continue;
    }

    const matches = remaining.filter(({ doc }) => matchesRule(doc, rule, pathRegex, titleRegex));

    if (rule.required && matches.length === 0) {
      warnings.push(`Required rule "${rule.id}" matched no documents`);
      continue;
    }

    matches.sort((a, b) => compareDocs(a, b, rule.sortBy ?? "none", rule.sortDirection ?? "asc"));

    for (const match of matches) {
      ordered.push(match);
      const idx = remaining.findIndex((candidate) => candidate === match);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  // Keep unmatched files stable at the end.
  remaining.sort((a, b) => a.originalIndex - b.originalIndex);
  if (remaining.length > 0) {
    warnings.push(`${remaining.length} document(s) did not match any ordering rule and were appended as-is`);
  }

  return [...ordered, ...remaining].map((item) => item.doc);
}

function matchesRule(
  doc: EvidencePacketDocumentInput,
  rule: EvidencePacketOrderRule,
  pathRegex: RegExp | null,
  titleRegex: RegExp | null
): boolean {
  const match = rule.match;
  if (!match) return false;

  if (match.docTypes && match.docTypes.length > 0) {
    const docType = (doc.docType || "").toLowerCase();
    if (!match.docTypes.some((type) => type.toLowerCase() === docType)) {
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

function compareDocs(
  a: { doc: EvidencePacketDocumentInput; originalIndex: number },
  b: { doc: EvidencePacketDocumentInput; originalIndex: number },
  sortBy: SortBy,
  direction: SortDirection
): number {
  const multiplier = direction === "desc" ? -1 : 1;
  let result = 0;

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

async function getPdfPageCount(pdfBytes: Uint8Array, pathLabel: string): Promise<number> {
  try {
    const pdf = await PDFDocument.load(pdfBytes);
    return pdf.getPageCount();
  } catch (error) {
    throw new Error(`Failed to read PDF page count for ${pathLabel}: ${formatError(error)}`);
  }
}

async function redactPdfIfRequested(
  absolutePath: string,
  pdfBytes: Uint8Array,
  relativePath: string,
  redaction: EvidencePacketRedactionOptions
): Promise<{ pdfBytes: Uint8Array; findings: EvidencePacketRedactionFinding[]; warnings: string[] }> {
  const mode = redaction.mode ?? "detect_only";
  const findings: EvidencePacketRedactionFinding[] = [];
  const warnings: string[] = [];

  const bboxHtml = await extractBboxLayout(absolutePath);
  if (!bboxHtml) {
    const message = `Could not extract text coordinates for ${relativePath}; automatic redaction skipped`;
    if (redaction.failOnUnprocessable) {
      throw new Error(message);
    }
    warnings.push(message);
    return { pdfBytes, findings, warnings };
  }

  const sensitiveBoxes = detectSensitiveBoxes(bboxHtml, relativePath);
  for (const box of sensitiveBoxes) {
    findings.push({
      path: relativePath,
      page: box.page,
      kind: box.kind,
      preview: box.preview,
    });
  }

  if (mode === "detect_only" || sensitiveBoxes.length === 0) {
    return { pdfBytes, findings, warnings };
  }

  const redactedBytes = await applyRedactionBoxes(pdfBytes, sensitiveBoxes);
  return { pdfBytes: redactedBytes, findings, warnings };
}

async function extractBboxLayout(pdfPath: string): Promise<string | null> {
  try {
    const stdout = await runPdftotext(["-bbox-layout", pdfPath, "-"], {
      maxBuffer: 30 * 1024 * 1024,
      timeout: 30000,
    });
    return stdout;
  } catch {
    return null;
  }
}

function decodeXmlEntity(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)));
}

function detectSensitiveBoxes(
  bboxHtml: string,
  relativePath: string
): Array<{ page: number; kind: "dob" | "ssn"; box: WordBox; preview: string }> {
  const findings: Array<{ page: number; kind: "dob" | "ssn"; box: WordBox; preview: string }> = [];
  const pageRegex = /<page\b[^>]*>([\s\S]*?)<\/page>/g;

  let pageMatch: RegExpExecArray | null;
  let pageNumber = 0;
  while ((pageMatch = pageRegex.exec(bboxHtml)) !== null) {
    pageNumber += 1;
    const pageContent = pageMatch[1];
    const wordRegex = /<word\b[^>]*xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g;
    const words: WordBox[] = [];

    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordRegex.exec(pageContent)) !== null) {
      words.push({
        xMin: parseFloat(wordMatch[1]),
        yMin: parseFloat(wordMatch[2]),
        xMax: parseFloat(wordMatch[3]),
        yMax: parseFloat(wordMatch[4]),
        text: decodeXmlEntity(wordMatch[5]).trim(),
      });
    }

    if (words.length === 0) continue;

    const seen = new Set<string>();
    for (let i = 0; i < words.length; i += 1) {
      const current = words[i];
      if (!current.text) continue;

      const cleaned = cleanToken(current.text);
      const contextBefore = words
        .slice(Math.max(0, i - 5), i)
        .map((word) => cleanPhrase(word.text))
        .join(" ");

      if (SSN_REGEX.test(cleaned) || (SSN_NO_DASH_REGEX.test(cleaned) && SSN_CONTEXT_REGEX.test(contextBefore))) {
        const preview = maskSensitive(cleaned);
        const dedupeKey = `${pageNumber}:${current.xMin}:${current.yMin}:${current.xMax}:${current.yMax}:ssn`;
        if (!seen.has(dedupeKey)) {
          findings.push({ page: pageNumber, kind: "ssn", box: current, preview });
          seen.add(dedupeKey);
        }
        continue;
      }

      const dateMatch = cleaned.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/);
      if (dateMatch && DATE_REGEX.test(dateMatch[0]) && DOB_CONTEXT_REGEX.test(contextBefore)) {
        const preview = maskSensitive(dateMatch[0]);
        const dedupeKey = `${pageNumber}:${current.xMin}:${current.yMin}:${current.xMax}:${current.yMax}:dob`;
        if (!seen.has(dedupeKey)) {
          findings.push({ page: pageNumber, kind: "dob", box: current, preview });
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

async function applyRedactionBoxes(
  pdfBytes: Uint8Array,
  boxes: Array<{ page: number; kind: "dob" | "ssn"; box: WordBox; preview: string }>
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);

  for (const item of boxes) {
    const pageIndex = item.page - 1;
    const page = pdf.getPage(pageIndex);
    if (!page) continue;

    const { height } = page.getSize();
    const x = Math.max(0, item.box.xMin - 1);
    const width = Math.max(2, item.box.xMax - item.box.xMin + 2);
    const targetY = height - item.box.yMax - 1;
    const y = Math.max(0, targetY);
    const maxHeight = Math.max(6, item.box.yMax - item.box.yMin + 2);
    const redactionHeight = Math.min(maxHeight, height - y);

    page.drawRectangle({
      x,
      y,
      width,
      height: redactionHeight,
      color: rgb(0, 0, 0),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0,
    });
  }

  return pdf.save();
}

function cleanToken(value: string): string {
  return value.replace(/[^\w\/-]/g, "").toLowerCase();
}

function cleanPhrase(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function maskSensitive(value: string): string {
  if (SSN_REGEX.test(value)) {
    const last4 = value.slice(-4);
    return `***-**-${last4}`;
  }

  if (DATE_REGEX.test(value)) {
    return "**/**/****";
  }

  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

function addIndexPages(
  pdf: PDFDocument,
  regularFont: PDFFont,
  boldFont: PDFFont,
  options: BuildEvidencePacketOptions,
  tocEntries: EvidencePacketTocEntry[]
): number {
  const pages: PDFPage[] = [];
  let page = pdf.addPage([612, 792]);
  pages.push(page);
  drawPleadingPaper(page, regularFont, options.firmBlockLines, 1);

  drawCentered(page, boldFont, "NEVADA DEPARTMENT OF ADMINISTRATION", 13, 744);
  drawCentered(page, boldFont, "BEFORE THE HEARING OFFICER", 12, 724);

  page.drawText("In the Matter of the Contested", { x: 84, y: 693, size: 11, font: regularFont });
  page.drawText("Industrial Insurance Claim of", { x: 84, y: 678, size: 11, font: regularFont });
  page.drawText(`${options.caption.claimantName},`, { x: 84, y: 646, size: 11, font: regularFont });
  page.drawText("Claimant.", { x: 84, y: 631, size: 11, font: regularFont });

  const rightX = 362;
  drawRightField(page, boldFont, regularFont, rightX, 693, "Claim No.:", options.caption.claimNumber ?? "");
  drawRightField(page, boldFont, regularFont, rightX, 673, "Hearing No.:", options.caption.hearingNumber ?? "");
  drawRightField(page, boldFont, regularFont, rightX, 653, "Date/Time:", options.caption.hearingDateTime ?? "");
  drawRightField(page, boldFont, regularFont, rightX, 633, "Appearance:", options.caption.appearance ?? "");

  drawCentered(page, boldFont, "DOCUMENT INDEX", 14, 598);

  const intro = options.caption.introductoryCounselLine ||
    `COMES NOW, ${options.caption.claimantName}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.`;
  let currentY = drawWrappedText(page, intro, 84, 572, 470, regularFont, 11, 14);
  currentY -= 12;

  page.drawText("Document", { x: 84, y: currentY, size: 11, font: boldFont });
  page.drawText("Page(s)", { x: 500, y: currentY, size: 11, font: boldFont });
  currentY -= 18;

  const tableBottom = 90;
  const rowHeight = 16;
  let index = 0;
  while (index < tocEntries.length) {
    if (currentY < tableBottom) {
      page = pdf.addPage([612, 792]);
      pages.push(page);
      drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length);
      drawCentered(page, boldFont, "DOCUMENT INDEX (CONT.)", 14, 724);
      page.drawText("Document", { x: 84, y: 692, size: 11, font: boldFont });
      page.drawText("Page(s)", { x: 500, y: 692, size: 11, font: boldFont });
      currentY = 672;
    }

    const entry = tocEntries[index];
    const left = `${index + 1}. ${entry.title}`;
    const right = `Pg. ${formatPageRange(entry.startPage, entry.endPage)}`;
    drawTocRow(page, regularFont, left, right, currentY);
    currentY -= rowHeight;
    index += 1;
  }

  return pages.length;
}

function addAffirmationPage(
  pdf: PDFDocument,
  regularFont: PDFFont,
  boldFont: PDFFont,
  options: BuildEvidencePacketOptions,
  frontMatterPageNumber: number
): number {
  const page = pdf.addPage([612, 792]);
  drawPleadingPaper(page, regularFont, options.firmBlockLines, frontMatterPageNumber);

  drawCentered(page, boldFont, "AFFIRMATION", 14, 726);

  const serviceDate = options.service?.serviceDate || new Date().toLocaleDateString("en-US");
  const affirmationText =
    "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.";
  let y = drawWrappedText(page, affirmationText, 84, 702, 470, regularFont, 11, 14);
  y -= 20;
  page.drawText(`Dated: ${serviceDate}`, { x: 84, y, size: 11, font: regularFont });

  const signY = y - 65;
  const signerBlock = [
    "Claimant's Counsel",
    options.caption.introductoryCounselLine || "",
  ].filter(Boolean);
  let sigLineY = signY;
  for (const line of signerBlock) {
    page.drawText(line, { x: 360, y: sigLineY, size: 10.5, font: regularFont });
    sigLineY -= 14;
  }

  drawCentered(page, boldFont, "CERTIFICATE OF SERVICE", 13, 430);
  const serviceIntro =
    "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:";
  y = drawWrappedText(page, serviceIntro, 84, 406, 470, regularFont, 11, 14);
  y -= 12;

  const method = options.service?.serviceMethod || "[x] Via E-File";
  page.drawText(method, { x: 84, y, size: 11, font: regularFont });
  y -= 18;

  const recipients = options.service?.recipients && options.service.recipients.length > 0
    ? options.service.recipients
    : ["Recipient details to be provided by counsel."];
  for (const recipient of recipients) {
    y = drawWrappedText(page, recipient, 104, y, 430, regularFont, 10.5, 13);
    y -= 8;
  }

  y -= 8;
  page.drawText(`Dated: ${serviceDate}`, { x: 84, y, size: 11, font: regularFont });
  y -= 34;
  page.drawText(options.service?.servedBy || "An employee of counsel", { x: 84, y, size: 10.5, font: regularFont });

  return 1;
}

function drawPleadingPaper(
  page: PDFPage,
  font: PDFFont,
  firmBlockLines: string[] | undefined,
  pageNumber: number
): void {
  const top = 760;
  const bottom = 76;
  const totalLines = 28;
  const spacing = (top - bottom) / (totalLines - 1);

  for (let line = 1; line <= totalLines; line += 1) {
    const y = top - (line - 1) * spacing;
    const label = line.toString();
    const width = font.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: 46 - width,
      y: y - 3,
      size: 9,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  page.drawLine({
    start: { x: 52, y: bottom - 10 },
    end: { x: 52, y: top + 8 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  const firmLines = firmBlockLines && firmBlockLines.length > 0
    ? firmBlockLines
    : ["FIRM NAME", "Address Line 1", "Address Line 2", "(000) 000-0000"];

  let firmY = 520;
  for (const line of firmLines.slice(0, 6)) {
    page.drawText(line, {
      x: 60,
      y: firmY,
      size: 8.5,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    firmY -= 12;
  }

  page.drawText(String(pageNumber), {
    x: 565,
    y: 24,
    size: 10,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawRightField(
  page: PDFPage,
  labelFont: PDFFont,
  valueFont: PDFFont,
  x: number,
  y: number,
  label: string,
  value: string
): void {
  page.drawText(label, { x, y, size: 10, font: labelFont });
  page.drawText(value, { x: x + 76, y, size: 10, font: valueFont });
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, size: number, y: number): void {
  const width = page.getWidth();
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (width - textWidth) / 2,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number
): number {
  const paragraphs = text.split(/\n+/);
  let cursorY = y;
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      cursorY -= lineHeight;
      continue;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width <= maxWidth) {
        line = candidate;
      } else {
        if (line) {
          page.drawText(line, { x, y: cursorY, size, font });
          cursorY -= lineHeight;
        }
        line = word;
      }
    }

    if (line) {
      page.drawText(line, { x, y: cursorY, size, font });
      cursorY -= lineHeight;
    }
  }

  return cursorY;
}

function drawTocRow(page: PDFPage, font: PDFFont, left: string, right: string, y: number): void {
  const size = 11;
  const leftX = 84;
  const rightX = 500;
  const maxLeftWidth = rightX - leftX - 40;
  const safeLeft = truncateToWidth(left, font, size, maxLeftWidth);
  const leftWidth = font.widthOfTextAtSize(safeLeft, size);
  const rightWidth = font.widthOfTextAtSize(right, size);

  page.drawText(safeLeft, { x: leftX, y, size, font });
  page.drawText(right, { x: rightX + (48 - rightWidth), y, size, font });

  const dotWidth = font.widthOfTextAtSize(".", size);
  const dotsStart = leftX + leftWidth + 4;
  const dotsEnd = rightX - 4;
  if (dotsEnd > dotsStart + dotWidth * 3) {
    const count = Math.floor((dotsEnd - dotsStart) / dotWidth);
    page.drawText(".".repeat(Math.max(3, count)), { x: dotsStart, y, size, font });
  }
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (value.length > 3 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function formatPageRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

function stampExhibitPageNumber(page: PDFPage, font: PDFFont, label: string): void {
  const size = 11;
  const { width } = page.getSize();
  const textWidth = font.widthOfTextAtSize(label, size);
  page.drawText(label, {
    x: (width - textWidth) / 2,
    y: 18,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
