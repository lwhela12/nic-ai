import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
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
  date?: string;
  startPage: number;
  endPage: number;
}

export interface EvidencePacketRedactionFinding {
  path: string;
  page: number;
  kind: "dob" | "ssn";
  preview: string;
}

export interface EvidencePacketSensitiveDetectionBox {
  path: string;
  page: number;
  kind: "dob" | "ssn";
  preview: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface EvidencePacketManualRedactionBox {
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

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

    let originalBytes: Buffer;
    try {
      originalBytes = await readFile(absolutePath);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        warnings.push(`Skipped missing file: ${doc.path}`);
        continue;
      }
      throw err;
    }
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

  if (processedDocs.length === 0) {
    throw new Error("No documents could be included — all files were missing or unreadable");
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
      date: processed.document.date,
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
    const embeddedPages = await pdf.embedPdf(sourcePdf, sourcePdf.getPageIndices());
    for (let i = 0; i < embeddedPages.length; i++) {
      const sourcePage = sourcePdf.getPage(i);
      const { width, height } = sourcePage.getSize();
      const sourceRotation = sourcePage.getRotation().angle;
      const newPage = pdf.addPage([width, height]);
      newPage.drawPage(embeddedPages[i], { x: 0, y: 0, width, height });
      if (sourceRotation !== 0) {
        newPage.setRotation(degrees(sourceRotation));
      }
      stampExhibitPageNumber(newPage, regularFont, `${pageStampPrefix}${exhibitPageNumber}`, sourceRotation);
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

export async function buildFrontMatterPreview(options: {
  caption: EvidencePacketCaption;
  firmBlockLines?: string[];
  service?: EvidencePacketServiceInfo;
  tocEntries: Array<{ title: string; startPage: number; endPage: number }>;
  includeAffirmationPage?: boolean;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const packetOptions: BuildEvidencePacketOptions = {
    caseFolder: "",
    documents: [],
    caption: options.caption,
    firmBlockLines: options.firmBlockLines,
    service: options.service,
  };

  const tocEntries: EvidencePacketTocEntry[] = options.tocEntries.map((e) => ({
    title: e.title,
    path: "",
    startPage: e.startPage,
    endPage: e.endPage,
  }));

  let frontMatterPages = addIndexPages(pdf, regularFont, boldFont, packetOptions, tocEntries);
  if (options.includeAffirmationPage !== false) {
    addAffirmationPage(pdf, regularFont, boldFont, packetOptions, frontMatterPages + 1);
  }

  return pdf.save();
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

export async function scanPdfForSensitiveData(
  absolutePath: string,
  relativePath: string,
  options: { failOnUnprocessable?: boolean } = {}
): Promise<{
  findings: EvidencePacketRedactionFinding[];
  warnings: string[];
  boxes: EvidencePacketSensitiveDetectionBox[];
}> {
  const warnings: string[] = [];

  const bboxHtml = await extractBboxLayout(absolutePath);
  if (!bboxHtml) {
    const message = `Could not extract text coordinates for ${relativePath}; PII scan skipped`;
    if (options.failOnUnprocessable) {
      throw new Error(message);
    }
    warnings.push(message);
    return { findings: [], warnings, boxes: [] };
  }

  const sensitiveBoxes = detectSensitiveBoxes(bboxHtml, relativePath);
  const boxes: EvidencePacketSensitiveDetectionBox[] = sensitiveBoxes.map((item) => ({
    path: relativePath,
    page: item.page,
    kind: item.kind,
    preview: item.preview,
    xMin: item.box.xMin,
    yMin: item.box.yMin,
    xMax: item.box.xMax,
    yMax: item.box.yMax,
  }));

  const findings: EvidencePacketRedactionFinding[] = boxes.map((item) => ({
    path: item.path,
    page: item.page,
    kind: item.kind,
    preview: item.preview,
  }));

  return { findings, warnings, boxes };
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

export async function applyManualRedactionBoxes(
  pdfBytes: Uint8Array,
  boxes: EvidencePacketManualRedactionBox[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);

  for (const item of boxes) {
    if (!item || !Number.isFinite(item.page)) continue;
    const page = pdf.getPage(Math.floor(item.page) - 1);
    if (!page) continue;

    const { width, height } = page.getSize();
    const x = clamp01(item.xPct) * width;
    const yFromTop = clamp01(item.yPct) * height;
    const redactionWidth = clamp01(item.widthPct) * width;
    const redactionHeight = clamp01(item.heightPct) * height;
    if (redactionWidth < 1 || redactionHeight < 1) continue;

    const y = Math.max(0, height - yFromTop - redactionHeight);

    page.drawRectangle({
      x,
      y,
      width: redactionWidth,
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
  const firmBlockBottomY = drawPleadingPaper(page, regularFont, options.firmBlockLines, 1, true);
  const baseFirstCaptionLineY = 693;
  const requiredCaptionGap = 16;
  const preferredExtraDrop = 64;
  const captionYOffset = typeof firmBlockBottomY === "number"
    ? Math.max(preferredExtraDrop, (firmBlockBottomY + requiredCaptionGap) - baseFirstCaptionLineY)
    : preferredExtraDrop;
  const cy = (y: number) => y - captionYOffset;

  drawCentered(page, boldFont, "BEFORE THE HEARING OFFICER", 12, cy(724));

  drawCaptionDivider(page, regularFont, captionYOffset);

  page.drawText("In the Matter of the Contested", { x: 84, y: cy(693), size: 12, font: regularFont });
  page.drawText("Industrial Insurance Claim of", { x: 84, y: cy(678), size: 12, font: regularFont });
  page.drawText(`${options.caption.claimantName},`, { x: 84, y: cy(646), size: 12, font: regularFont });
  page.drawText("Claimant.", { x: 84, y: cy(631), size: 12, font: regularFont });

  const rightX = 362;
  drawRightField(page, boldFont, regularFont, rightX, cy(693), "Claim No.:", options.caption.claimNumber ?? "", 12);
  drawRightField(page, boldFont, regularFont, rightX, cy(673), "Hearing No.:", options.caption.hearingNumber ?? "", 12);
  drawRightField(page, boldFont, regularFont, rightX, cy(653), "Date/Time:", options.caption.hearingDateTime ?? "", 12);
  drawRightField(page, boldFont, regularFont, rightX, cy(633), "Appearance:", options.caption.appearance ?? "", 12);

  const captionBottomY = 618 - captionYOffset;
  const docIndexY = captionBottomY - 20;
  drawCentered(page, boldFont, "DOCUMENT INDEX", 14, docIndexY);

  const intro = options.caption.introductoryCounselLine ||
    `COMES NOW, ${options.caption.claimantName}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.`;
  const introStartY = docIndexY - 48;
  let currentY = drawWrappedText(page, intro, 84, introStartY, 470, regularFont, 12, 16);
  currentY -= 12;

  page.drawText("Document", { x: 84, y: currentY, size: 12, font: boldFont });
  page.drawText("Page(s)", { x: 500, y: currentY, size: 12, font: boldFont });
  currentY -= 22;

  const tableBottom = 90;
  const rowHeight = 30;
  let index = 0;
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

    const entry = tocEntries[index];
    const left = `${index + 1}. ${formatTocDocumentLabel(entry)}`;
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
  drawPleadingPaper(page, regularFont, options.firmBlockLines, frontMatterPageNumber, false);

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
  pageNumber: number,
  showFirmBlock = true
): number | undefined {
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

  let firmBlockBottomY: number | undefined;

  if (showFirmBlock) {
    const providedFirmLines = (firmBlockLines || [])
      .map((line) => line.trim())
      .map((line) => line.replace(/\[[^\]]+\]/g, "").trim())
      .map((line) => (/not configured/i.test(line) ? "" : line));

    // Keep a consistent 7-line attorney block footprint in the top-left.
    // If firm data is missing, preserve blank lines instead of injecting fallback text.
    const attorneyBlockLineCount = 7;
    const visibleFirmLines: string[] = [];
    for (let i = 0; i < attorneyBlockLineCount; i += 1) {
      visibleFirmLines.push(providedFirmLines[i] ?? "");
    }

    const blockLineHeight = 12.5;
    // Keep the full attorney block inside page bounds and above the caption.
    // Previous anchoring was too high and could clip the top lines.
    let firmY = 758;
    for (const line of visibleFirmLines) {
      if (line) {
        page.drawText(line, {
          x: 60,
          y: firmY,
          size: 12,
          font,
          color: rgb(0.2, 0.2, 0.2),
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
    font,
    color: rgb(0, 0, 0),
  });

  return firmBlockBottomY;
}

function drawRightField(
  page: PDFPage,
  labelFont: PDFFont,
  valueFont: PDFFont,
  x: number,
  y: number,
  label: string,
  value: string,
  size = 10
): void {
  page.drawText(label, { x, y, size, font: labelFont });
  page.drawText(value, { x: x + 76, y, size, font: valueFont });
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
  const size = 12;
  const leftX = 84;
  const rightX = 500;
  const maxLeftWidth = rightX - leftX - 40;
  const safeLeft = truncateToWidth(left, font, size, maxLeftWidth);
  const leftWidth = font.widthOfTextAtSize(safeLeft, size);

  page.drawText(safeLeft, { x: leftX, y, size, font });
  // Keep page refs left-aligned under the "P" in "Page(s)".
  page.drawText(right, { x: rightX, y, size, font });

  const dotWidth = font.widthOfTextAtSize(".", size);
  const dotsStart = leftX + leftWidth + 4;
  const dotsEnd = rightX - 4;
  if (dotsEnd > dotsStart + dotWidth * 3) {
    const count = Math.floor((dotsEnd - dotsStart) / dotWidth);
    page.drawText(".".repeat(Math.max(3, count)), { x: dotsStart, y, size, font });
  }
}

function drawCaptionDivider(page: PDFPage, font: PDFFont, yOffset = 0): void {
  const dividerX = 336;
  const topY = 708 - yOffset;
  const bottomY = 618 - yOffset;
  const parenSpacing = 14;

  for (let y = topY - 2; y >= bottomY + 2; y -= parenSpacing) {
    page.drawText(")", { x: dividerX, y, size: 11, font });
  }

  // Match court index style: only a bottom rule ending at the parenthesis column.
  page.drawLine({
    start: { x: 84, y: bottomY },
    end: { x: dividerX - 6, y: bottomY },
    thickness: 0.4,
    color: rgb(0.72, 0.72, 0.72),
  });
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

function formatTocDocumentLabel(entry: EvidencePacketTocEntry): string {
  const title = (entry.title || "").trim();
  const date = (entry.date || "").trim();
  if (!date) return title;
  if (title.toLowerCase().includes(date.toLowerCase())) return title;
  return `${title} - ${date}`;
}

function stampExhibitPageNumber(page: PDFPage, font: PDFFont, label: string, pageRotation = 0): void {
  const size = 11;
  const { width, height } = page.getSize();
  const textWidth = font.widthOfTextAtSize(label, size);
  const margin = 18;

  // Normalize to 0, 90, 180, or 270.
  const rotation = ((pageRotation % 360) + 360) % 360;

  // For rotated pages the viewer applies /Rotate after rendering the content
  // stream, so the stamp coordinates must be in the *unrotated* coordinate
  // space at a position that maps to the displayed bottom-center.
  let x: number;
  let y: number;
  let textRotate = degrees(0);

  switch (rotation) {
    case 90:
      // Displayed bottom = unrotated right edge
      x = width - margin;
      y = (height - textWidth) / 2;
      textRotate = degrees(90);
      break;
    case 180:
      // Displayed bottom = unrotated top edge
      x = (width + textWidth) / 2;
      y = height - margin;
      textRotate = degrees(180);
      break;
    case 270:
      // Displayed bottom = unrotated left edge
      x = margin;
      y = (height + textWidth) / 2;
      textRotate = degrees(-90);
      break;
    default:
      x = (width - textWidth) / 2;
      y = margin;
      break;
  }

  page.drawText(label, {
    x,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
    rotate: textRotate,
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
