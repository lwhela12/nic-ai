import { readFile, writeFile, mkdtemp, rm, mkdir, stat } from "fs/promises";
import { resolve, sep, join } from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { runPdftotext } from "./pdftotext";
import { renderHtmlFrontMatter, buildFrontMatterHtml } from "./evidence-packet-html";
import { htmlToDocx } from "./export";
import { injectVariablesIntoDocx } from "./extract";
import {
  Document as WordDocument,
  Packer as WordPacker,
  Paragraph as WordParagraph,
  TextRun as WordTextRun,
  Table as WordTable,
  TableRow as WordTableRow,
  TableCell as WordTableCell,
  WidthType as WordWidthType,
  AlignmentType as WordAlignmentType,
  BorderStyle as WordBorderStyle,
  UnderlineType as WordUnderlineType,
  LineNumberRestartFormat as WordLineNumberRestartFormat,
  PageBorderDisplay as WordPageBorderDisplay,
  PageBorderOffsetFrom as WordPageBorderOffsetFrom,
} from "docx";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { execFileSync } from "child_process";
import * as os from "os";
import { fileURLToPath } from "url";

type SortBy = "none" | "date" | "title" | "path";
type SortDirection = "asc" | "desc";

export interface PacketTemplate {
  id: string;
  name: string;
  heading: string;
  captionPreambleLines: string[];
  captionFields: Array<{
    label: string;
    key: string;
  }>;
  extraSections?: Array<{
    title: string;
    key: string;
  }>;
  indexTitle: string;
  counselPreamble: string;
  affirmationTitle: string;
  affirmationText: string;
  certTitle: string;
  certIntro: string;
  sourceFile?: string;
  builtIn?: boolean;
  htmlTemplate?: string;
  htmlTemplateCss?: string;
  /** Where to place the firm/attorney info block.
   *  "header"    – top-left of first page (default, standard HO templates)
   *  "signature" – in the signer block on the affirmation page only */
  firmBlockPosition?: "header" | "signature";
  /** Alignment of the signer/attorney block on the affirmation page. */
  signerBlockAlign?: "left" | "right";
  /** Rendering mode for HTML-based front matter flow. */
  renderMode?: "template-native" | "pleading-legacy";
  /** When true, suppress generated pleading gutter/line-number column for HTML templates. */
  suppressPleadingLineNumbers?: boolean;
  /** Backward-compatible IDs previously stored in packetConfig.id. */
  legacyPacketIds?: string[];
  /** Agency line drawn centered above the heading (e.g. "STATE OF NEVADA DEPARTMENT OF ADMINISTRATION"). */
  agencyLine?: string;
  /** Document title drawn centered below the caption (e.g. "CLAIMANT'S HEARING STATEMENT..."). */
  documentTitle?: string;
  /** Page ordering: "index-first" (default HO) puts doc index before affirmation;
   *  "statement-first" (AO) puts hearing statement on page 1, doc index on page 2, cert on page 3. */
  pageFlow?: "index-first" | "statement-first";
  /** TOC format: "numbered" (default) for "1. Title ... Pg. X"; "date-doc-page" for 3-column DATE/DOCUMENTS/PAGE NO(S). */
  tocFormat?: "numbered" | "date-doc-page";
}

export const BUILT_IN_TEMPLATES: PacketTemplate[] = [
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
    counselPreamble:
      "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.",
    affirmationTitle: "AFFIRMATION",
    affirmationText:
      "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
    certTitle: "CERTIFICATE OF SERVICE",
    certIntro:
      "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
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
    counselPreamble:
      'COMES NOW, Claimant, {{claimantName}}, (hereinafter referred to as "Claimant"), by and through his attorneys, and hereby submits this Hearing Statement and Documentary Evidence for the Appeals Officer\'s consideration.',
    affirmationTitle: "AFFIRMATION PURSUANT TO NRS 239B.030",
    affirmationText:
      "The undersigned does hereby affirm that the attached Claimant's Documentary Evidence filed in Appeal No.: {{hearingNumber}}",
    certTitle: "CERTIFICATE OF MAILING",
    certIntro:
      "On this ______ day of {{serviceMonth}}, {{serviceYear}}, the undersigned, an employee of the {{firmName}}, does hereby certify that a true and correct copy of the foregoing was served upon the following by the method indicated below:",
    firmBlockPosition: "signature",
    signerBlockAlign: "left",
    builtIn: true,
  },
];

type BuiltInPacketTemplateId = "ho-standard" | "ao-standard";

const BUILT_IN_DOCX_FILENAMES: Record<BuiltInPacketTemplateId, string> = {
  "ho-standard": "__builtin-ho-standard.docx",
  "ao-standard": "__builtin-ao-standard.docx",
};

const BUILT_IN_DOCX_TEMPLATE_VERSION = 11;
const BUILT_IN_DOCX_VERSION_FILE = "__builtin-docx-versions.json";
const DOC_INDEX_RIGHT_TAB_POS = 9360;
const DOC_INDEX_LEFT_MAX_CHARS = 76;
const HO_SEED_DOCX_PATH = fileURLToPath(
  new URL("../assets/builtin-templates/ho-standard-seed.docx", import.meta.url)
);
const AO_SEED_DOCX_PATH = fileURLToPath(
  new URL("../assets/builtin-templates/ao-standard-seed.docx", import.meta.url)
);

const HO_SEED_DOCX_REPLACEMENTS: Record<string, string> = {
  "STATE OF NEVADA DEPARTMENT OF ADMINISTRATION": "{{omit}}",
  "BEFORE THE APPEALS OFFICER": "{{heading}}",
  "Industrial Insurance Claim of:": "{{hoCaptionPreamble2}}",
  "VALerie owens,": "{{claimantName}},",
  "Appeal No. : 2691432-GK": "{{hoCaptionLine1}}",
  "Claim No.   : 003071-029380-WC-01": "{{hoCaptionLine2}}",
  "Hearing No.: 2687918-TH": "{{hoCaptionLine3}}",
  "Employer    : Mechanics Bank": "{{hoCaptionLine4}}",
  "CLAIMANT’S HEARING STATEMENT AND DOCUMENTARY EVIDENCE": "{{indexTitle}}",
  "COMES NOW, Claimant, VALERIE OWENS, (hereinafter referred to as “Claimant”), by and through her attorneys, JASON H. WEINSTOCK, ESQ., and NICOLE C. FARRELL, ESQ., of LAW OFFICE OF JASON H. WEINSTOCK, PLLC., and submit the attached Hearing Statement and Index of Documents relating to the above-referenced matter.": "{{counselPreamble}}",
  "ISSUE": "{{omit}}",
  "This is Claimant’s appeal of the 1/23/26 Hearing Officer’s Decision and Order remanding the TPA’s 12/15/2025 denial to offer the PPD award.": "{{omit}}",
  "WITNESSES": "{{omit}}",
  "The Claimant may testify regarding the events of this industrial insurance claim.": "{{omit}}",
  "DURATION": "{{omit}}",
  "It is estimated that this case will take approximately 30 minutes to present.": "{{omit}}",
  "///": "{{omit}}",
  "AFFIRMATION PURSUANT TO NRS 239B.030": "{{affirmationTitle}}",
  "The undersigned does hereby affirm that the attached Claimant’s Documentary Evidence filed in Appeal No.: 2691432-GK": "{{affirmationText}}",
  "Dated this ____  day of February, 2026.": "{{datedLine}}",
  "×  Does not contain the social security number of any person.": "{{omit}}",
  "Respectfully submitted,": "{{omit}}",
  "LAW OFFICES OF JASON H. WEINSTOCK, PLLC.": "{{firmName}}",
  "By:": "{{omit}}",
  "JASON H. WEINSTOCK, ESQ.": "{{signerName}}",
  "Nevada Bar No.: 15114": "{{signatureFirmBlock}}",
  "NICOLE C. FARRELL": "{{omit}}",
  "Nevada Bar No.: 16532": "{{omit}}",
  "2470 St. Rose Pkwy., Suite 214": "{{omit}}",
  "Henderson, Nevada 89074": "{{omit}}",
  "Attorney for Claimant": "{{omit}}",
  "On this ______ day February, 2026, the undersigned, an employee of the Law Office of Jason H. Weinstock, PLLC., does hereby certify that on the date shown below, a true and correct copy of the foregoing CLAIMANT’S HEARING STATEMENT AND DOCUMENTARY EVIDENCE was duly mailed, postage prepaid OR placed in the appropriate addressee runner file maintained by the State of Nevada Department of Administration, Appeals Division, 2200 S. Rancho Dr., Ste. 220, Las Vegas, NV 89102, to the following:": "{{certIntro}}",
  "Valerie Owens": "{{serviceRecipientsText}}",
  "6118 Wheat Penny Ave.": "{{omit}}",
  "Las Vegas, NV 89122": "{{omit}}",
  "Mechanics Bank": "{{omit}}",
  "915 Highland Pointe Dr.": "{{omit}}",
  "Walnut Creek, CA 95678": "{{omit}}",
  "Gallagher Bassett": "{{omit}}",
  "PO Box 2934": "{{omit}}",
  "Clinton, IA 52733-2934": "{{omit}}",
  "Daniel L. Schwartz, Esq.": "{{omit}}",
  "Hooks Meng and Clement": "{{omit}}",
  "2300 W. Sahara Ave., Ste. 1100": "{{omit}}",
  "Las Vegas, NV 89102": "{{omit}}",
  "An Employee of Law Office of Jason H. Weinstock, PLLC.": "{{servedBy}}",
};

const AO_SEED_DOCX_REPLACEMENTS: Record<string, string> = {
  "VALerie owens,": "{{claimantName}},",
  "VALERIE OWENS": "{{claimantName}}",
  "2691432-GK": "{{hearingNumber}}",
  "003071-029380-WC-01": "{{claimNumber}}",
  "2687918-TH": "{{hearingNo}}",
  "Mechanics Bank": "{{employer}}",
  "COMES NOW, Claimant, VALERIE OWENS, (hereinafter referred to as “Claimant”), by and through her attorneys, JASON H. WEINSTOCK, ESQ., and NICOLE C. FARRELL, ESQ., of LAW OFFICE OF JASON H. WEINSTOCK, PLLC., and submit the attached Hearing Statement and Index of Documents relating to the above-referenced matter.": "{{counselPreamble}}",
  "This is Claimant’s appeal of the 1/23/26 Hearing Officer’s Decision and Order remanding the TPA’s 12/15/2025 denial to offer the PPD award.": "{{issueOnAppeal}}",
  "The Claimant may testify regarding the events of this industrial insurance claim.": "{{witnesses}}",
  "It is estimated that this case will take approximately 30 minutes to present.": "{{duration}}",
  "AFFIRMATION PURSUANT TO NRS 239B.030": "{{affirmationTitle}}",
  "The undersigned does hereby affirm that the attached Claimant’s Documentary Evidence filed in Appeal No.\t: 2691432-GK": "{{affirmationText}}",
  "Dated this ____  day of February, 2026.": "{{datedLine}}",
  "LAW OFFICES OF JASON H. WEINSTOCK, PLLC.": "{{firmName}}",
  "JASON H. WEINSTOCK, ESQ.": "{{signerName}}",
  "Nevada Bar No.: 15114": "{{signatureFirmBlock}}",
  "NICOLE C. FARRELL": "{{omit}}",
  "Nevada Bar No.: 16532": "{{omit}}",
  "2470 St. Rose Pkwy., Suite 214": "{{omit}}",
  "Henderson, Nevada 89074": "{{omit}}",
  "On this ______ day February, 2026, the undersigned, an employee of the Law Office of Jason H. Weinstock, PLLC., does hereby certify that on the date shown below, a true and correct copy of the foregoing CLAIMANT’S HEARING STATEMENT AND DOCUMENTARY EVIDENCE was duly mailed, postage prepaid OR placed in the appropriate addressee runner file maintained by the State of Nevada Department of Administration, Appeals Division, 2200 S. Rancho Dr., Ste. 220, Las Vegas, NV 89102, to the following:": "{{certIntro}}",
  "Valerie Owens": "{{serviceRecipientsText}}",
  "6118 Wheat Penny Ave.": "{{omit}}",
  "Las Vegas, NV 89122": "{{omit}}",
  "915 Highland Pointe Dr.": "{{omit}}",
  "Walnut Creek, CA 95678": "{{omit}}",
  "Gallagher Bassett": "{{omit}}",
  "PO Box 2934": "{{omit}}",
  "Clinton, IA 52733-2934": "{{omit}}",
  "Daniel L. Schwartz, Esq.": "{{omit}}",
  "Hooks Meng and Clement": "{{omit}}",
  "2300 W. Sahara Ave., Ste. 1100": "{{omit}}",
  "Las Vegas, NV 89102": "{{omit}}",
  "An Employee of Law Office of Jason H. Weinstock, PLLC.": "{{servedBy}}",
};

function moveHoDocumentIndexAfterCounselPreamble(docxBytes: Buffer): Buffer {
  try {
    const zip = new PizZip(docxBytes);
    const docNode = zip.file("word/document.xml");
    if (!docNode) return docxBytes;
    let xml = docNode.asText();
    const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    const paragraphs: Array<{ start: number; end: number; xml: string; text: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = paraRegex.exec(xml)) !== null) {
      const text = [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join("");
      paragraphs.push({
        start: match.index,
        end: match.index + match[0].length,
        xml: match[0],
        text,
      });
    }

    const indexParagraph = paragraphs.find((p) => p.text.includes("{{documentIndexText}}"));
    if (!indexParagraph) return docxBytes;
    const insertionTarget =
      paragraphs.find((p) => p.text.includes("{{counselPreamble}}"))
      ?? paragraphs.find((p) => p.text.includes("{{indexTitle}}"));
    if (!insertionTarget) return docxBytes;

    const removedLength = indexParagraph.end - indexParagraph.start;
    let insertAt = insertionTarget.end;
    if (insertAt > indexParagraph.start) {
      insertAt -= removedLength;
    }

    xml = xml.slice(0, indexParagraph.start) + xml.slice(indexParagraph.end);
    xml = xml.slice(0, insertAt) + indexParagraph.xml + xml.slice(insertAt);
    zip.file("word/document.xml", xml);
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch {
    return docxBytes;
  }
}

function enforceDocumentIndexRightTabLeader(docxBytes: Buffer): Buffer {
  try {
    const zip = new PizZip(docxBytes);
    const docNode = zip.file("word/document.xml");
    if (!docNode) return docxBytes;
    let xml = docNode.asText();
    const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let match: RegExpExecArray | null;
    while ((match = paraRegex.exec(xml)) !== null) {
      const paragraphXml = match[0];
      const paragraphText = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join("");
      if (!paragraphText.includes("{{documentIndexText}}")) continue;

      const tabSpec = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${DOC_INDEX_RIGHT_TAB_POS}"/></w:tabs>`;
      let updatedParagraph = paragraphXml;
      if (updatedParagraph.includes("<w:pPr>")) {
        updatedParagraph = updatedParagraph.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_full, inner) => {
          const withoutTabs = String(inner).replace(/<w:tabs>[\s\S]*?<\/w:tabs>/g, "");
          return `<w:pPr>${tabSpec}${withoutTabs}</w:pPr>`;
        });
      } else {
        updatedParagraph = updatedParagraph.replace(/^<w:p([^>]*)>/, `<w:p$1><w:pPr>${tabSpec}</w:pPr>`);
      }

      xml = xml.slice(0, match.index) + updatedParagraph + xml.slice(match.index + paragraphXml.length);
      zip.file("word/document.xml", xml);
      return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
    }

    return docxBytes;
  } catch {
    return docxBytes;
  }
}

function truncateDocIndexLabel(text: string, maxChars = DOC_INDEX_LEFT_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, Math.max(0, maxChars - 3));
  const breakAt = slice.lastIndexOf(" ");
  const safe = (breakAt > Math.floor(maxChars * 0.6) ? slice.slice(0, breakAt) : slice)
    .replace(/[\s.,;:!-]+$/g, "");
  return `${safe}...`;
}

function ensurePageBreakBeforeHeadings(
  docxBytes: Buffer,
  headingNeedles: string[]
): Buffer {
  try {
    const zip = new PizZip(docxBytes);
    const docNode = zip.file("word/document.xml");
    if (!docNode) return docxBytes;
    const xml = docNode.asText();
    const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    const normalizedNeedles = headingNeedles.map((value) => value.toUpperCase());
    type Segment = { type: "raw"; xml: string } | { type: "paragraph"; xml: string };
    const segments: Segment[] = [];
    let changed = false;
    let cursor = 0;

    const paragraphText = (paragraphXml: string): string => {
      return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    };

    const isSpacerParagraph = (paragraphXml: string): boolean => {
      const text = paragraphText(paragraphXml);
      if (!text) return true;
      const withoutOmit = text.replace(/\{\{\s*omit\s*\}\}/gi, "").trim();
      if (!withoutOmit) return true;
      return /^[\/\\|._-]+$/.test(withoutOmit);
    };

    let match: RegExpExecArray | null;
    while ((match = paraRegex.exec(xml)) !== null) {
      if (match.index > cursor) {
        segments.push({ type: "raw", xml: xml.slice(cursor, match.index) });
      }
      segments.push({ type: "paragraph", xml: match[0] });
      cursor = match.index + match[0].length;
    }
    if (cursor < xml.length) {
      segments.push({ type: "raw", xml: xml.slice(cursor) });
    }

    const output: Segment[] = [];
    for (const segment of segments) {
      if (segment.type !== "paragraph") {
        output.push(segment);
        continue;
      }

      const textUpper = paragraphText(segment.xml).toUpperCase();
      const shouldBreak = normalizedNeedles.some((needle) => textUpper.includes(needle));
      if (!shouldBreak) {
        output.push(segment);
        continue;
      }

      while (output.length > 0) {
        const previous = output[output.length - 1];
        if (previous.type === "raw") {
          if (previous.xml.trim().length > 0) break;
          output.pop();
          changed = true;
          continue;
        }
        if (!isSpacerParagraph(previous.xml)) break;
        output.pop();
        changed = true;
      }

      let updatedParagraph = segment.xml;
      if (updatedParagraph.includes("<w:lastRenderedPageBreak/>")) {
        updatedParagraph = updatedParagraph.replace(/<w:lastRenderedPageBreak\/>/g, "");
        changed = true;
      }
      if (!updatedParagraph.includes("<w:pageBreakBefore")) {
        if (updatedParagraph.includes("<w:pPr>")) {
          updatedParagraph = updatedParagraph.replace("<w:pPr>", "<w:pPr><w:pageBreakBefore/>");
        } else {
          updatedParagraph = updatedParagraph.replace(/^<w:p([^>]*)>/, "<w:p$1><w:pPr><w:pageBreakBefore/></w:pPr>");
        }
        changed = true;
      }

      output.push({ type: "paragraph", xml: updatedParagraph });
    }

    if (!changed) return docxBytes;
    zip.file("word/document.xml", output.map((segment) => segment.xml).join(""));
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch {
    return docxBytes;
  }
}

function trimSpacerParagraphsBeforeNeedles(
  docxBytes: Buffer,
  targetNeedles: string[]
): Buffer {
  try {
    const zip = new PizZip(docxBytes);
    const docNode = zip.file("word/document.xml");
    if (!docNode) return docxBytes;
    const xml = docNode.asText();
    const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    const normalizedNeedles = targetNeedles.map((needle) => needle.toUpperCase());
    type Segment = { type: "raw"; xml: string } | { type: "paragraph"; xml: string };
    const segments: Segment[] = [];
    let cursor = 0;
    let changed = false;

    const paragraphText = (paragraphXml: string): string => {
      return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    };

    const isSpacerParagraph = (paragraphXml: string): boolean => {
      const text = paragraphText(paragraphXml);
      if (!text) return true;
      const withoutOmit = text.replace(/\{\{\s*omit\s*\}\}/gi, "").trim();
      if (!withoutOmit) return true;
      return /^[\/\\|._-]+$/.test(withoutOmit);
    };

    let match: RegExpExecArray | null;
    while ((match = paraRegex.exec(xml)) !== null) {
      if (match.index > cursor) {
        segments.push({ type: "raw", xml: xml.slice(cursor, match.index) });
      }
      segments.push({ type: "paragraph", xml: match[0] });
      cursor = match.index + match[0].length;
    }
    if (cursor < xml.length) {
      segments.push({ type: "raw", xml: xml.slice(cursor) });
    }

    const output: Segment[] = [];
    for (const segment of segments) {
      if (segment.type !== "paragraph") {
        output.push(segment);
        continue;
      }

      const textUpper = paragraphText(segment.xml).toUpperCase();
      const isTarget = normalizedNeedles.some((needle) => textUpper.includes(needle));
      if (!isTarget) {
        output.push(segment);
        continue;
      }

      while (output.length > 0) {
        const previous = output[output.length - 1];
        if (previous.type === "raw") {
          if (previous.xml.trim().length > 0) break;
          output.pop();
          changed = true;
          continue;
        }
        if (!isSpacerParagraph(previous.xml)) break;
        output.pop();
        changed = true;
      }

      output.push(segment);
    }

    if (!changed) return docxBytes;
    zip.file("word/document.xml", output.map((segment) => segment.xml).join(""));
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch {
    return docxBytes;
  }
}

function ensureDocxFooterPageNumberFields(docxBytes: Buffer): Buffer {
  try {
    const zip = new PizZip(docxBytes);
    const footerParts = ["word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
    let changed = false;
    const hasPageFieldRegex = /<w:fldSimple[^>]*w:instr="[^"]*\bPAGE\b[^"]*"|<w:instrText[^>]*>[^<]*\bPAGE\b[^<]*<\/w:instrText>/i;
    const pageFieldParagraphRegex =
      /<w:p[\s\S]*?(?:<w:fldSimple[^>]*w:instr="[^"]*\bPAGE\b[^"]*"[\s\S]*?<\/w:fldSimple>|<w:instrText[^>]*>[^<]*\bPAGE\b[^<]*<\/w:instrText>[\s\S]*?)<\/w:p>/gi;
    const pageFieldParagraph =
      `<w:p>` +
      `<w:pPr>` +
      `<w:pStyle w:val="Footer"/>` +
      `<w:jc w:val="right"/>` +
      `<w:ind w:right="420"/>` +
      `<w:spacing w:before="180" w:after="0"/>` +
      `</w:pPr>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>1</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`;

    for (const part of footerParts) {
      const footerNode = zip.file(part);
      if (!footerNode) continue;
      const xml = footerNode.asText();
      if (!xml.includes("</w:ftr>")) continue;
      let updated = xml;
      if (hasPageFieldRegex.test(updated)) {
        updated = updated.replace(pageFieldParagraphRegex, "");
        updated = updated.replace("</w:ftr>", `${pageFieldParagraph}</w:ftr>`);
      } else {
        updated = updated.replace("</w:ftr>", `${pageFieldParagraph}</w:ftr>`);
      }
      if (updated !== xml) {
        zip.file(part, updated);
        changed = true;
      }
    }

    if (!changed) return docxBytes;
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch {
    return docxBytes;
  }
}

async function buildHoDocxTemplateFromSeed(): Promise<Buffer> {
  const templated = await injectVariablesIntoDocx(
    HO_SEED_DOCX_PATH,
    HO_SEED_DOCX_REPLACEMENTS
  );
  let output = moveHoDocumentIndexAfterCounselPreamble(Buffer.from(templated));
  output = enforceDocumentIndexRightTabLeader(output);
  output = ensurePageBreakBeforeHeadings(output, ["{{affirmationTitle}}", "CERTIFICATE OF MAILING"]);
  return output;
}

async function buildAoDocxTemplateFromSeed(): Promise<Buffer> {
  const templated = await injectVariablesIntoDocx(
    AO_SEED_DOCX_PATH,
    AO_SEED_DOCX_REPLACEMENTS
  );
  let output = enforceDocumentIndexRightTabLeader(Buffer.from(templated));
  output = trimSpacerParagraphsBeforeNeedles(output, ["{{documentIndexText}}"]);
  output = ensurePageBreakBeforeHeadings(output, [
    "{{documentIndexText}}",
    "{{affirmationTitle}}",
    "CERTIFICATE OF MAILING",
  ]);
  return output;
}

interface BuiltInWordParagraphOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: (typeof WordAlignmentType)[keyof typeof WordAlignmentType];
  spacingAfter?: number;
  spacingBefore?: number;
  pageBreakBefore?: boolean;
}

function builtInWordRun(
  text: string,
  options: Partial<Record<string, unknown>> = {}
): WordTextRun {
  return new WordTextRun({
    text,
    font: "Times New Roman",
    size: 24, // 12pt (half-point units)
    ...(options as Record<string, unknown>),
  });
}

function builtInWordParagraph(
  text: string,
  options: BuiltInWordParagraphOptions = {}
): WordParagraph {
  const runs: WordTextRun[] = [];
  if (text.length > 0) {
    runs.push(
      builtInWordRun(text, {
        bold: options.bold,
        italics: options.italic,
        underline: options.underline ? { type: WordUnderlineType.SINGLE } : undefined,
      })
    );
  } else {
    runs.push(builtInWordRun(""));
  }

  return new WordParagraph({
    children: runs,
    alignment: options.alignment,
    pageBreakBefore: options.pageBreakBefore,
    spacing: {
      before: options.spacingBefore ?? 0,
      after: options.spacingAfter ?? 120,
    },
  });
}

function builtInWordHeading(text: string): WordParagraph {
  return builtInWordParagraph(text, {
    bold: true,
    underline: true,
    alignment: WordAlignmentType.CENTER,
    spacingAfter: 180,
  });
}

function builtInWordCaptionTable(template: PacketTemplate): WordTable {
  const leftCellParagraphs: WordParagraph[] = (template.captionPreambleLines || []).map((line) =>
    builtInWordParagraph(line, { spacingAfter: 80 })
  );
  leftCellParagraphs.push(builtInWordParagraph("", { spacingAfter: 60 }));
  leftCellParagraphs.push(builtInWordParagraph("{{claimantName}},", { spacingAfter: 80 }));
  leftCellParagraphs.push(builtInWordParagraph("Claimant.", { spacingAfter: 0 }));

  const rightCellParagraphs: WordParagraph[] = (template.captionFields || []).map((field) =>
    new WordParagraph({
      children: [
        builtInWordRun(field.label, { bold: true }),
        builtInWordRun(` {{${field.key}}}`),
      ],
      spacing: { after: 80 },
    })
  );

  const border = { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new WordTable({
    width: { size: 100, type: WordWidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new WordTableRow({
        children: [
          new WordTableCell({
            width: { size: 62, type: WordWidthType.PERCENTAGE },
            children: leftCellParagraphs,
          }),
          new WordTableCell({
            width: { size: 38, type: WordWidthType.PERCENTAGE },
            children: rightCellParagraphs,
          }),
        ],
      }),
    ],
  });
}

function builtInWordHoIndexTable(): WordTable {
  const border = { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new WordTable({
    width: { size: 100, type: WordWidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new WordTableRow({
        children: [
          new WordTableCell({
            width: { size: 78, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("Document", { bold: true })],
          }),
          new WordTableCell({
            width: { size: 22, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("Page(s)", { bold: true, alignment: WordAlignmentType.RIGHT })],
          }),
        ],
      }),
      new WordTableRow({
        children: [
          new WordTableCell({
            width: { size: 78, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("{{#tocEntries}}{{number}}. {{title}}{{dateLine}}", { spacingAfter: 60 })],
          }),
          new WordTableCell({
            width: { size: 22, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("Pg. {{pageRange}}{{/tocEntries}}", { alignment: WordAlignmentType.RIGHT, spacingAfter: 60 })],
          }),
        ],
      }),
    ],
  });
}

function builtInWordAoIndexTable(): WordTable {
  const border = { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new WordTable({
    width: { size: 100, type: WordWidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new WordTableRow({
        children: [
          new WordTableCell({
            width: { size: 20, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("DATE", { bold: true })],
          }),
          new WordTableCell({
            width: { size: 62, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("DOCUMENTS", { bold: true })],
          }),
          new WordTableCell({
            width: { size: 18, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("PAGE NO(S)", { bold: true, alignment: WordAlignmentType.RIGHT })],
          }),
        ],
      }),
      new WordTableRow({
        children: [
          new WordTableCell({
            width: { size: 20, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("{{#tocEntries}}{{date}}", { spacingAfter: 60 })],
          }),
          new WordTableCell({
            width: { size: 62, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("{{title}}", { spacingAfter: 60 })],
          }),
          new WordTableCell({
            width: { size: 18, type: WordWidthType.PERCENTAGE },
            children: [builtInWordParagraph("{{pageRange}}{{/tocEntries}}", { alignment: WordAlignmentType.RIGHT, spacingAfter: 60 })],
          }),
        ],
      }),
    ],
  });
}

function buildBuiltInHoDocxChildren(template: PacketTemplate): Array<WordParagraph | WordTable> {
  const children: Array<WordParagraph | WordTable> = [];
  children.push(builtInWordParagraph("{{firmBlockText}}", { spacingAfter: 180 }));
  children.push(builtInWordHeading(template.heading));
  children.push(builtInWordCaptionTable(template));
  children.push(builtInWordParagraph("", { spacingAfter: 140 }));
  children.push(builtInWordHeading(template.indexTitle || "DOCUMENT INDEX"));
  children.push(builtInWordParagraph("{{counselPreamble}}", { spacingAfter: 180 }));
  children.push(builtInWordHoIndexTable());
  children.push(builtInWordParagraph("", { pageBreakBefore: true, spacingAfter: 0 }));
  children.push(builtInWordHeading(template.affirmationTitle || "AFFIRMATION"));
  children.push(builtInWordParagraph("{{affirmationText}}", { spacingAfter: 180 }));
  children.push(builtInWordParagraph("Dated: {{serviceDate}}", { spacingAfter: 180 }));
  children.push(builtInWordParagraph("Respectfully submitted,", { spacingAfter: 80 }));
  children.push(builtInWordParagraph("{{firmName}}", { bold: true, spacingAfter: 80 }));
  children.push(builtInWordParagraph("By: __________________________", { spacingAfter: 80 }));
  children.push(builtInWordParagraph("{{signerName}}", { spacingAfter: 80 }));
  children.push(builtInWordParagraph("Attorney for Claimant", { italic: true, spacingAfter: 220 }));
  children.push(builtInWordHeading(template.certTitle || "CERTIFICATE OF SERVICE"));
  children.push(builtInWordParagraph("{{certIntro}}", { spacingAfter: 180 }));
  children.push(builtInWordParagraph("{{serviceMethodPlain}}", { spacingAfter: 140 }));
  children.push(builtInWordParagraph("{{serviceRecipientsText}}", { spacingAfter: 140 }));
  return children;
}

function buildBuiltInAoDocxChildren(template: PacketTemplate): Array<WordParagraph | WordTable> {
  const children: Array<WordParagraph | WordTable> = [];
  children.push(builtInWordParagraph("{{firmBlockText}}", { spacingAfter: 180 }));
  if (template.agencyLine) {
    children.push(builtInWordHeading(template.agencyLine));
  }
  children.push(builtInWordHeading(template.heading));
  children.push(builtInWordCaptionTable(template));
  children.push(builtInWordParagraph("", { spacingAfter: 120 }));
  if (template.documentTitle) {
    children.push(builtInWordHeading(template.documentTitle));
  }
  children.push(builtInWordParagraph("{{counselPreamble}}", { spacingAfter: 180 }));
  for (const section of template.extraSections || []) {
    children.push(builtInWordHeading(section.title));
    children.push(builtInWordParagraph(`{{${section.key}}}`, { spacingAfter: 180 }));
  }
  children.push(builtInWordParagraph("", { pageBreakBefore: true, spacingAfter: 0 }));
  children.push(builtInWordHeading(template.indexTitle || "DOCUMENT INDEX"));
  children.push(builtInWordAoIndexTable());
  children.push(builtInWordParagraph("", { pageBreakBefore: true, spacingAfter: 0 }));
  children.push(builtInWordHeading(template.certTitle || "CERTIFICATE OF SERVICE"));
  children.push(builtInWordParagraph("{{certIntro}}", { spacingAfter: 180 }));
  children.push(builtInWordParagraph("{{serviceMethodPlain}}", { spacingAfter: 120 }));
  children.push(builtInWordParagraph("{{serviceRecipientsText}}", { spacingAfter: 120 }));
  children.push(builtInWordParagraph("Dated: {{serviceDate}}", { spacingAfter: 120 }));
  children.push(builtInWordParagraph("{{signerName}}", { spacingAfter: 80 }));
  children.push(builtInWordParagraph("{{firmName}}", { bold: true, spacingAfter: 80 }));
  return children;
}

async function buildBuiltInDocxTemplateBuffer(template: PacketTemplate): Promise<Buffer> {
  if (template.id === "ho-standard") {
    try {
      return await buildHoDocxTemplateFromSeed();
    } catch (error) {
      console.warn(
        `[EvidencePacket] Failed to build HO seed DOCX template, falling back to generated template: ${formatError(error)}`
      );
    }
  }

  if (template.id === "ao-standard" || template.pageFlow === "statement-first") {
    try {
      return await buildAoDocxTemplateFromSeed();
    } catch (error) {
      console.warn(
        `[EvidencePacket] Failed to build AO seed DOCX template, falling back to generated template: ${formatError(error)}`
      );
    }
  }

  const children = template.pageFlow === "statement-first"
    ? buildBuiltInAoDocxChildren(template)
    : buildBuiltInHoDocxChildren(template);

  const doc = new WordDocument({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080,
              right: 936,
              bottom: 1080,
              left: 1440,
            },
            borders: {
              pageBorders: {
                display: WordPageBorderDisplay.ALL_PAGES,
                offsetFrom: WordPageBorderOffsetFrom.PAGE,
              },
              pageBorderLeft: {
                style: WordBorderStyle.SINGLE,
                size: 8,
                color: "8A8A8A",
                space: 24,
              },
              pageBorderTop: { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" },
              pageBorderRight: { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" },
              pageBorderBottom: { style: WordBorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
          },
          lineNumbers: {
            countBy: 1,
            start: 1,
            restart: WordLineNumberRestartFormat.NEW_PAGE,
            distance: 420,
          },
        },
        children,
      },
    ],
  });
  return WordPacker.toBuffer(doc);
}

async function readBuiltInDocxVersionMap(
  versionsPath: string
): Promise<Partial<Record<BuiltInPacketTemplateId, number>>> {
  try {
    const raw = await readFile(versionsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: Partial<Record<BuiltInPacketTemplateId, number>> = {};
    for (const id of Object.keys(BUILT_IN_DOCX_FILENAMES) as BuiltInPacketTemplateId[]) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === "number" && Number.isFinite(value)) {
        result[id] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function ensureBuiltInPacketDocxTemplate(
  firmRoot: string,
  templateId: BuiltInPacketTemplateId,
  options: { force?: boolean } = {}
): Promise<string> {
  const filename = BUILT_IN_DOCX_FILENAMES[templateId];
  const relativePath = `source/${filename}`;
  const sourceDir = join(firmRoot, ".ai_tool", "templates", "source");
  const fullPath = join(sourceDir, filename);
  const versionsPath = join(sourceDir, BUILT_IN_DOCX_VERSION_FILE);

  await mkdir(sourceDir, { recursive: true });
  const existingVersions = await readBuiltInDocxVersionMap(versionsPath);
  let hasExistingFile = false;
  try {
    await stat(fullPath);
    hasExistingFile = true;
  } catch {
    hasExistingFile = false;
  }

  const currentVersion = existingVersions[templateId] ?? 0;
  if (!options.force && hasExistingFile && currentVersion >= BUILT_IN_DOCX_TEMPLATE_VERSION) {
    return relativePath;
  }

  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.id === templateId);
  if (!builtIn) {
    throw new Error(`Built-in packet template not found: ${templateId}`);
  }

  const docxBuffer = await buildBuiltInDocxTemplateBuffer(builtIn);
  await writeFile(fullPath, docxBuffer);
  const nextVersions: Partial<Record<BuiltInPacketTemplateId, number>> = {
    ...existingVersions,
    [templateId]: BUILT_IN_DOCX_TEMPLATE_VERSION,
  };
  await writeFile(versionsPath, JSON.stringify(nextVersions, null, 2), "utf-8");

  return relativePath;
}

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
  captionValues?: Record<string, string>;
  [key: string]: unknown;
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
  /** Override default path resolution (for year-based cases). */
  resolveDocPath?: (relativePath: string) => string;
  /** Override template path resolution (defaults to resolveDocPath). */
  resolveTemplatePath?: (relativePath: string) => string;
  /** Template to drive front matter heading, caption layout, and boilerplate. */
  template?: PacketTemplate;
  /** Name to display in the signer block (overrides introductoryCounselLine). */
  signerName?: string;
  /** Values for template extraSections, keyed by section key (e.g. "issueOnAppeal"). */
  extraSectionValues?: Record<string, string>;
  /** Firm name for bold display in signature block (separate from firmBlockLines). */
  firmName?: string;
}

export interface EvidencePacketTocEntry {
  title: string;
  path?: string;
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

function drawFrontMatterPageBadge(page: PDFPage, font: PDFFont, label: string): void {
  const size = 10;
  const marginRight = 30;
  const marginBottom = 16;
  const textWidth = font.widthOfTextAtSize(label, size);
  const { width } = page.getSize();
  const x = width - marginRight - textWidth;
  const y = marginBottom;

  page.drawText(label, {
    x,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

function stampFrontMatterPageNumbers(
  pdf: PDFDocument,
  font: PDFFont,
  frontMatterPageCount: number
): void {
  if (frontMatterPageCount <= 0) return;
  for (let i = 0; i < frontMatterPageCount; i++) {
    const page = pdf.getPage(i);
    const label = `${i + 1}`;
    drawFrontMatterPageBadge(page, font, label);
  }
}

export async function addFrontMatterPageNumberBadgesToPdfBytes(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  stampFrontMatterPageNumbers(pdf, font, pdf.getPageCount());
  return pdf.save();
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
  frontMatterDocxBytes?: Buffer;
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
    const absolutePath = options.resolveDocPath
      ? options.resolveDocPath(doc.path)
      : resolveCasePath(options.caseFolder, doc.path);
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

  // Track front matter HTML for DOCX export (populated by HTML-template path)
  let frontMatterHtml: string | undefined;
  let frontMatterDocxBytes: Buffer | undefined;
  let frontMatterHasNativePageNumbers = false;

  // Branch: HTML-template path vs pdf-lib path
  // CRITICAL: .docx files MUST use the native docxtemplater + LibreOffice path
  // to preserve pleading paper fidelity and absolute formatting.
  // DO NOT REVERT .docx FILES TO THE HTML PATH.
  if (options.template?.sourceFile && options.template.sourceFile.toLowerCase().endsWith(".docx")) {
    let docxRendered = false;
    try {
      console.log(`[EvidencePacket] Using DOCX template path: ${options.template.sourceFile}`);
      const { pdfBytes: docxPdfBytes, docxBytes } = await buildDocxFrontMatter(
        options.template,
        options.caption,
        options.service,
        tocEntries,
        options.firmName,
        options.resolveTemplatePath
          || options.resolveDocPath
          || ((p) => resolveCasePath(options.caseFolder, p)),
        options.extraSectionValues,
        options.firmBlockLines,
        options.signerName,
      );
      const frontMatterPdf = await PDFDocument.load(docxPdfBytes);
      const fmPages = await pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices());
      for (const page of fmPages) {
        pdf.addPage(page);
      }
      frontMatterDocxBytes = docxBytes;
      frontMatterHasNativePageNumbers = true;
      docxRendered = true;
    } catch (docxErr) {
      console.error(`[EvidencePacket] DOCX rendering failed:`, docxErr);
      console.error(`[EvidencePacket] FALLING BACK to pdf-lib layout`);
      const errMsg = docxErr instanceof Error ? docxErr.message : String(docxErr);
      warnings.push(`DOCX template rendering failed (${errMsg}). Used built-in layout as fallback.`);
    }
    if (!docxRendered) {
      // Fallback to pdf-lib built-in layout
      if (options.template?.pageFlow === "statement-first") {
        await addStatementPages(pdf, regularFont, boldFont, options, tocEntries);
      } else {
        let frontMatterPages = addIndexPages(pdf, regularFont, boldFont, options, tocEntries);
        if (options.includeAffirmationPage !== false) {
          frontMatterPages += addAffirmationPage(pdf, regularFont, boldFont, options, frontMatterPages + 1);
        }
      }
    }
  } else if (options.template?.sourceFile && options.template.sourceFile.toLowerCase().endsWith(".pdf")) {
    const pdfBytes = await buildPdfFrontMatter(
      options.template,
      options.caption,
      options.service,
      tocEntries,
      options.firmName,
      options.resolveDocPath || ((p) => resolveCasePath(options.caseFolder, p))
    );
    const frontMatterPdf = await PDFDocument.load(pdfBytes);
    const fmPages = await pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices());
    for (const page of fmPages) {
      pdf.addPage(page);
    }
  } else if (options.template?.htmlTemplate) {
    const htmlFmOptions = {
      caption: options.caption,
      template: options.template,
      firmBlockLines: options.firmBlockLines,
      service: options.service,
      signerName: options.signerName,
      extraSectionValues: options.extraSectionValues,
      includeAffirmationPage: options.includeAffirmationPage,
    };
    frontMatterHtml = buildFrontMatterHtml(htmlFmOptions, tocEntries);
    const htmlBuffer = await renderHtmlFrontMatter(htmlFmOptions, tocEntries);
    const frontMatterPdf = await PDFDocument.load(htmlBuffer);
    const fmPages = await pdf.copyPages(frontMatterPdf, frontMatterPdf.getPageIndices());
    for (const page of fmPages) {
      pdf.addPage(page);
    }
  } else if (options.template?.pageFlow === "statement-first") {
    await addStatementPages(pdf, regularFont, boldFont, options, tocEntries);
  } else {
    let frontMatterPages = addIndexPages(pdf, regularFont, boldFont, options, tocEntries);
    if (options.includeAffirmationPage !== false) {
      frontMatterPages += addAffirmationPage(pdf, regularFont, boldFont, options, frontMatterPages + 1);
    }
  }
  const frontMatterPageCount = pdf.getPageCount();
  if (!frontMatterHasNativePageNumbers) {
    stampFrontMatterPageNumbers(pdf, regularFont, frontMatterPageCount);
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

  // Generate front matter DOCX for editable Word export
  if (frontMatterHtml && !frontMatterDocxBytes) {
    try {
      frontMatterDocxBytes = await htmlToDocx(frontMatterHtml, "Front Matter", {
        documentType: "hearing_decision",
      });
    } catch (docxErr) {
      console.error(`[EvidencePacket] Front matter DOCX generation failed:`, docxErr);
      warnings.push("Front matter Word document could not be generated.");
    }
  }

  const pdfBytes = await pdf.save();
  return {
    pdfBytes,
    frontMatterDocxBytes,
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
  tocEntries: Array<{ title: string; startPage: number; endPage: number; date?: string }>;
  includeAffirmationPage?: boolean;
  template?: PacketTemplate;
  signerName?: string;
  extraSectionValues?: Record<string, string>;
  firmName?: string;
  caseFolder?: string;
  resolveTemplatePath?: (relativePath: string) => string;
}): Promise<{ pdfBytes: Uint8Array; docxBytes?: Buffer }> {
  const resolveDoc = options.caseFolder
    ? (p: string) => resolveCasePath(options.caseFolder!, p)
    : (p: string) => join(process.cwd(), p);
  const resolveTemplatePath = options.resolveTemplatePath || resolveDoc;

  // Branch: HTML-template path vs pdf-lib path
  // CRITICAL: .docx files MUST use the native docxtemplater + LibreOffice path
  // to preserve pleading paper fidelity and absolute formatting.
  // DO NOT REVERT .docx FILES TO THE HTML PATH.
  if (options.template?.sourceFile && options.template.sourceFile.toLowerCase().endsWith(".docx")) {
    try {
      console.log(`[FrontMatterPreview] Using DOCX template path: ${options.template.sourceFile}`);
      const result = await buildDocxFrontMatter(
        options.template,
        options.caption,
        options.service,
        options.tocEntries,
        options.firmName,
        resolveTemplatePath,
        options.extraSectionValues,
        options.firmBlockLines,
        options.signerName,
      );
      return result;
    } catch (docxErr) {
      console.error(`[FrontMatterPreview] DOCX rendering failed:`, docxErr);
      console.error(`[FrontMatterPreview] FALLING BACK to pdf-lib layout`);
      // Fall through to pdf-lib fallback below
    }
  } else if (options.template?.sourceFile && options.template.sourceFile.toLowerCase().endsWith(".pdf")) {
    const pdfBytes = await buildPdfFrontMatter(
      options.template,
      options.caption,
      options.service,
      options.tocEntries as EvidencePacketTocEntry[],
      options.firmName,
      resolveDoc
    );
    return { pdfBytes: await addFrontMatterPageNumberBadgesToPdfBytes(pdfBytes) };
  } else if (options.template?.htmlTemplate) {
    const htmlBuffer = await renderHtmlFrontMatter(
      {
        caption: options.caption,
        template: options.template,
        firmBlockLines: options.firmBlockLines,
        service: options.service,
        signerName: options.signerName,
        extraSectionValues: options.extraSectionValues,
        includeAffirmationPage: options.includeAffirmationPage,
      },
      options.tocEntries,
    );
    return {
      pdfBytes: await addFrontMatterPageNumberBadgesToPdfBytes(new Uint8Array(htmlBuffer)),
    };
  }

  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const packetOptions: BuildEvidencePacketOptions = {
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

  const tocEntries: EvidencePacketTocEntry[] = options.tocEntries.map((e) => ({
    title: e.title,
    path: "",
    date: e.date,
    startPage: e.startPage,
    endPage: e.endPage,
  }));

  if (options.template?.pageFlow === "statement-first") {
    await addStatementPages(pdf, regularFont, boldFont, packetOptions, tocEntries);
  } else {
    let frontMatterPages = addIndexPages(pdf, regularFont, boldFont, packetOptions, tocEntries);
    if (options.includeAffirmationPage !== false) {
      addAffirmationPage(pdf, regularFont, boldFont, packetOptions, frontMatterPages + 1);
    }
  }

  return { pdfBytes: await addFrontMatterPageNumberBadgesToPdfBytes(await pdf.save()) };
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

/**
 * Replace {{key}} placeholders in template text with values from the caption.
 * Checks top-level caption properties first, then captionValues map.
 */
function interpolateTemplateText(
  text: string,
  caption: EvidencePacketCaption,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const topLevel = (caption as Record<string, unknown>)[key];
    if (typeof topLevel === "string" && topLevel) return topLevel;
    const fromValues = caption.captionValues?.[key];
    if (typeof fromValues === "string" && fromValues) return fromValues;
    return match; // leave placeholder if no value available
  });
}

function drawCenteredUnderline(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  y: number,
): void {
  const pageWidth = page.getWidth();
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = (pageWidth - textWidth) / 2;
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
  page.drawLine({
    start: { x, y: y - 1.5 },
    end: { x: x + textWidth, y: y - 1.5 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
}

function drawTocRow3Col(
  page: PDFPage,
  font: PDFFont,
  date: string,
  docTitle: string,
  pageRange: string,
  y: number,
): void {
  const size = 12;
  const dateX = 84;
  const docX = 170;
  const pageX = 530;
  const maxDocWidth = pageX - docX - 20;
  const safeTitle = truncateToWidth(docTitle, font, size, maxDocWidth);
  page.drawText(date, { x: dateX, y, size, font });
  page.drawText(safeTitle, { x: docX, y, size, font });
  const rangeWidth = font.widthOfTextAtSize(pageRange, size);
  page.drawText(pageRange, { x: pageX - rangeWidth, y, size, font });
}

async function addStatementPages(
  pdf: PDFDocument,
  regularFont: PDFFont,
  boldFont: PDFFont,
  options: BuildEvidencePacketOptions,
  tocEntries: EvidencePacketTocEntry[],
): Promise<number> {
  const italicFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const tpl = options.template!;
  const isAO = tpl.pageFlow === "statement-first";
  const dblLeft = isAO;
  const rLine = isAO;

  // ── Page 1: Statement ──────────────────────────────────────────────
  const pages: PDFPage[] = [];
  let page = pdf.addPage([612, 792]);
  pages.push(page);
  const showFirmAtTop = (tpl.firmBlockPosition ?? "header") === "header";
  const firmBlockBottomY = drawPleadingPaper(page, regularFont, options.firmBlockLines, 1, showFirmAtTop, dblLeft, rLine);

  const baseFirstCaptionLineY = 693;
  const requiredCaptionGap = 16;
  const preferredExtraDrop = 64;
  const captionYOffset = typeof firmBlockBottomY === "number"
    ? Math.max(preferredExtraDrop, (firmBlockBottomY + requiredCaptionGap) - baseFirstCaptionLineY)
    : preferredExtraDrop;
  const cy = (y: number) => y - captionYOffset;

  // Agency line (centered, bold, underlined)
  if (tpl.agencyLine) {
    drawCenteredUnderline(page, boldFont, tpl.agencyLine, 12, cy(738));
  }

  // Officer line (centered, bold, underlined)
  drawCenteredUnderline(page, boldFont, tpl.heading, 12, cy(724));

  // Caption divider
  drawCaptionDivider(page, regularFont, captionYOffset);

  // Caption preamble (left side)
  const preambleLines = tpl.captionPreambleLines;
  const preambleStartY = cy(693);
  for (let i = 0; i < preambleLines.length; i++) {
    page.drawText(preambleLines[i], { x: 84, y: preambleStartY - i * 15, size: 12, font: regularFont });
  }
  const afterPreambleY = preambleStartY - preambleLines.length * 15 - 17;
  page.drawText(`${options.caption.claimantName},`, { x: 84, y: afterPreambleY, size: 12, font: regularFont });
  page.drawText("Claimant.", { x: 84, y: afterPreambleY - 15, size: 12, font: regularFont });

  // Caption fields (right side)
  const rightX = 362;
  const captionFieldDefs = tpl.captionFields;
  const captionFieldSpacing = 20;
  for (let i = 0; i < captionFieldDefs.length; i++) {
    const field = captionFieldDefs[i];
    const value = (options.caption as Record<string, unknown>)[field.key]
      ?? options.caption.captionValues?.[field.key];
    drawRightField(page, boldFont, regularFont, rightX, cy(693) - i * captionFieldSpacing, field.label, String(value ?? ""), 12);
  }

  const captionBottomY = 618 - captionYOffset;
  let currentY = captionBottomY;

  // Document title (centered, bold + underline)
  if (tpl.documentTitle) {
    currentY -= 24;
    drawCenteredUnderline(page, boldFont, tpl.documentTitle, 12, currentY);
    currentY -= 24;
  }

  // COMES NOW paragraph (first-line indent ~25pt, double-spaced)
  const counselPreambleRaw = tpl.counselPreamble;
  const intro = interpolateTemplateText(counselPreambleRaw, options.caption);
  currentY = drawWrappedTextIndented(page, intro, 84, currentY, 461, regularFont, 12, 24, 25);
  currentY -= 12;

  // Extra sections (ISSUE, WITNESSES, DURATION)
  if (tpl.extraSections && tpl.extraSections.length > 0) {
    for (const section of tpl.extraSections) {
      drawCenteredUnderline(page, boldFont, section.title, 12, currentY);
      currentY -= 24;
      const sectionValue = options.extraSectionValues?.[section.key] || "";
      if (sectionValue) {
        currentY = drawWrappedTextIndented(page, sectionValue, 84, currentY, 461, regularFont, 12, 24, 25);
        currentY -= 12;
      }
    }
  }

  // ── Compute signature block data before measuring height ──
  const sigLineHeight = 14;
  const displayFirmName = options.firmName || "";
  const signerDisplayName = options.signerName || options.caption.introductoryCounselLine || "";
  const cleanedFirmLines = (options.firmBlockLines || [])
    .map((l) => l.trim().replace(/\[[^\]]+\]/g, "").trim())
    .filter((l) => l && !/not configured/i.test(l));
  const filteredFirmLines = cleanedFirmLines.filter((line) => {
    if (displayFirmName && line.toLowerCase() === displayFirmName.toLowerCase()) return false;
    if (signerDisplayName && line.toLowerCase() === signerDisplayName.toLowerCase()) return false;
    return true;
  });

  // Count signature block lines
  let sigBlockLineCount = 2; // "Respectfully submitted," + "By: ___"
  if (displayFirmName) sigBlockLineCount += 1;
  if (signerDisplayName) sigBlockLineCount += 1;
  sigBlockLineCount += filteredFirmLines.length;
  sigBlockLineCount += 1; // "Attorney for Claimant"

  const affirmHeight =
    24 +       // affirmation title
    32 +       // affirmation text (~2 lines at 16pt)
    6 +        // gap
    20 +       // checkbox
    24 +       // dated line
    (sigBlockLineCount * sigLineHeight) +
    6 +        // gap before "By:"
    50;        // bottom margin safety

  const pageBottom = 76;
  const affirmStartY = pageBottom + affirmHeight;

  // ── Smart page overflow ──
  if (currentY < affirmStartY) {
    // Not enough room — start a new page
    page = pdf.addPage([612, 792]);
    pages.push(page);
    drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
    currentY = 724;
  }

  // ── AFFIRMATION heading ──
  currentY = affirmStartY;
  drawCenteredUnderline(page, boldFont, tpl.affirmationTitle, 12, currentY);
  currentY -= 24;

  // Affirmation text
  const affirmationText = interpolateTemplateText(tpl.affirmationText, options.caption);
  currentY = drawWrappedText(page, affirmationText, 84, currentY, 461, regularFont, 12, 16);
  currentY -= 6;

  // "× Does not contain..." checkbox line
  page.drawText("\u00D7 Does not contain personal information as defined by NRS 603A.040", {
    x: 84, y: currentY, size: 11, font: regularFont,
  });
  currentY -= 20;

  // Dated line
  const serviceDate = options.service?.serviceDate || new Date().toLocaleDateString("en-US");
  page.drawText(`Dated: ${serviceDate}`, { x: 84, y: currentY, size: 12, font: regularFont });
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
  for (const line of filteredFirmLines) {
    page.drawText(line, { x: 84, y: currentY, size: 12, font: regularFont });
    currentY -= sigLineHeight;
  }

  // "Attorney for Claimant" (italic)
  page.drawText("Attorney for Claimant", { x: 84, y: currentY, size: 12, font: italicFont });

  // ── Page 2: Document Index ─────────────────────────────────────────
  page = pdf.addPage([612, 792]);
  pages.push(page);
  drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);

  let idxY = 724;
  drawCenteredUnderline(page, boldFont, tpl.indexTitle ?? "DOCUMENT INDEX", 12, idxY);
  idxY -= 30;

  // Column headers (underlined)
  const hdrSize = 12;
  const dateHdrX = 84;
  const docHdrX = 170;
  const pageHdrX = 530;
  const dateHdrText = "DATE";
  const docHdrText = "DOCUMENTS";
  const pageHdrText = "PAGE NO(S)";

  page.drawText(dateHdrText, { x: dateHdrX, y: idxY, size: hdrSize, font: boldFont });
  const dateHdrW = boldFont.widthOfTextAtSize(dateHdrText, hdrSize);
  page.drawLine({ start: { x: dateHdrX, y: idxY - 1.5 }, end: { x: dateHdrX + dateHdrW, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });

  page.drawText(docHdrText, { x: docHdrX, y: idxY, size: hdrSize, font: boldFont });
  const docHdrW = boldFont.widthOfTextAtSize(docHdrText, hdrSize);
  page.drawLine({ start: { x: docHdrX, y: idxY - 1.5 }, end: { x: docHdrX + docHdrW, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });

  const pageHdrW = boldFont.widthOfTextAtSize(pageHdrText, hdrSize);
  page.drawText(pageHdrText, { x: pageHdrX - pageHdrW, y: idxY, size: hdrSize, font: boldFont });
  page.drawLine({ start: { x: pageHdrX - pageHdrW, y: idxY - 1.5 }, end: { x: pageHdrX, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });

  idxY -= 28;

  const tableBottom = 90;
  const rowHeight = 24;
  for (let i = 0; i < tocEntries.length; i++) {
    if (idxY < tableBottom) {
      page = pdf.addPage([612, 792]);
      pages.push(page);
      drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);
      drawCenteredUnderline(page, boldFont, "DOCUMENT INDEX (CONT.)", 12, 724);
      // Repeat column headers
      idxY = 694;
      page.drawText(dateHdrText, { x: dateHdrX, y: idxY, size: hdrSize, font: boldFont });
      page.drawLine({ start: { x: dateHdrX, y: idxY - 1.5 }, end: { x: dateHdrX + dateHdrW, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });
      page.drawText(docHdrText, { x: docHdrX, y: idxY, size: hdrSize, font: boldFont });
      page.drawLine({ start: { x: docHdrX, y: idxY - 1.5 }, end: { x: docHdrX + docHdrW, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });
      page.drawText(pageHdrText, { x: pageHdrX - pageHdrW, y: idxY, size: hdrSize, font: boldFont });
      page.drawLine({ start: { x: pageHdrX - pageHdrW, y: idxY - 1.5 }, end: { x: pageHdrX, y: idxY - 1.5 }, thickness: 0.5, color: rgb(0, 0, 0) });
      idxY -= 28;
    }

    const entry = tocEntries[i];
    const dateStr = entry.date || "";
    const pgRange = formatPageRange(entry.startPage, entry.endPage);
    drawTocRow3Col(page, regularFont, dateStr, entry.title, pgRange, idxY);
    idxY -= rowHeight;
  }

  // ── Page 3: Certificate of Mailing ─────────────────────────────────
  page = pdf.addPage([612, 792]);
  pages.push(page);
  drawPleadingPaper(page, regularFont, options.firmBlockLines, pages.length, false, dblLeft, rLine);

  let certY = 724;
  drawCenteredUnderline(page, boldFont, tpl.certTitle ?? "CERTIFICATE OF MAILING", 12, certY);
  certY -= 30;

  // Cert intro paragraph
  const certIntroRaw = tpl.certIntro;
  const certIntro = interpolateTemplateText(certIntroRaw, options.caption);
  certY = drawWrappedTextIndented(page, certIntro, 84, certY, 461, regularFont, 12, 24, 25);
  certY -= 24;

  // Recipients in single-spaced address blocks
  const recipients = options.service?.recipients && options.service.recipients.length > 0
    ? options.service.recipients
    : ["Recipient details to be provided by counsel."];
  for (const recipient of recipients) {
    // Each recipient may have multi-line address separated by newlines
    const lines = recipient.split(/\n/);
    for (const line of lines) {
      page.drawText(line.trim(), { x: 120, y: certY, size: 12, font: regularFont });
      certY -= 14;
    }
    certY -= 10; // blank line between recipients
  }

  return pages.length;
}

/** Like drawWrappedText but with a first-line indent for each paragraph. */
function drawWrappedTextIndented(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  firstLineIndent: number,
): number {
  const paragraphs = text.split(/\n+/);
  let cursorY = y;
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      cursorY -= lineHeight;
      continue;
    }

    let isFirstLine = true;
    let line = "";
    const indentedX = x + firstLineIndent;
    const firstLineMaxWidth = maxWidth - firstLineIndent;

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const currentMaxWidth = isFirstLine ? firstLineMaxWidth : maxWidth;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width <= currentMaxWidth) {
        line = candidate;
      } else {
        if (line) {
          const drawX = isFirstLine ? indentedX : x;
          page.drawText(line, { x: drawX, y: cursorY, size, font });
          cursorY -= lineHeight;
          isFirstLine = false;
        }
        line = word;
      }
    }

    if (line) {
      const drawX = isFirstLine ? indentedX : x;
      page.drawText(line, { x: drawX, y: cursorY, size, font });
      cursorY -= lineHeight;
    }
  }

  return cursorY;
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
  const showFirmAtTop = (options.template?.firmBlockPosition ?? "header") === "header";
  const firmBlockBottomY = drawPleadingPaper(page, regularFont, options.firmBlockLines, 1, showFirmAtTop);
  const baseFirstCaptionLineY = 693;
  const requiredCaptionGap = 16;
  const preferredExtraDrop = 64;
  const captionYOffset = typeof firmBlockBottomY === "number"
    ? Math.max(preferredExtraDrop, (firmBlockBottomY + requiredCaptionGap) - baseFirstCaptionLineY)
    : preferredExtraDrop;
  const cy = (y: number) => y - captionYOffset;

  const tpl = options.template;
  drawCentered(page, boldFont, tpl?.heading ?? "BEFORE THE HEARING OFFICER", 12, cy(724));

  drawCaptionDivider(page, regularFont, captionYOffset);

  // Caption preamble (left side)
  const preambleLines = tpl?.captionPreambleLines ?? [
    "In the Matter of the Contested",
    "Industrial Insurance Claim of",
  ];
  const preambleStartY = cy(693);
  for (let i = 0; i < preambleLines.length; i++) {
    page.drawText(preambleLines[i], { x: 84, y: preambleStartY - i * 15, size: 12, font: regularFont });
  }
  const afterPreambleY = preambleStartY - preambleLines.length * 15 - 17;
  page.drawText(`${options.caption.claimantName},`, { x: 84, y: afterPreambleY, size: 12, font: regularFont });
  page.drawText("Claimant.", { x: 84, y: afterPreambleY - 15, size: 12, font: regularFont });

  // Caption fields (right side)
  const rightX = 362;
  const captionFieldDefs = tpl?.captionFields ?? [
    { label: "Claim No.:", key: "claimNumber" },
    { label: "Hearing No.:", key: "hearingNumber" },
    { label: "Date/Time:", key: "hearingDateTime" },
    { label: "Appearance:", key: "appearance" },
  ];
  const captionFieldSpacing = 20;
  for (let i = 0; i < captionFieldDefs.length; i++) {
    const field = captionFieldDefs[i];
    const value = (options.caption as Record<string, unknown>)[field.key]
      ?? options.caption.captionValues?.[field.key];
    drawRightField(page, boldFont, regularFont, rightX, cy(693) - i * captionFieldSpacing, field.label, String(value ?? ""), 12);
  }

  const captionBottomY = 618 - captionYOffset;
  let sectionY = captionBottomY;

  // Extra sections (e.g. "ISSUE ON APPEAL" for AO template)
  if (tpl?.extraSections && tpl.extraSections.length > 0) {
    for (const section of tpl.extraSections) {
      sectionY -= 10;
      drawCentered(page, boldFont, section.title, 13, sectionY);
      sectionY -= 20;
      const sectionValue = options.extraSectionValues?.[section.key] || "";
      if (sectionValue) {
        sectionY = drawWrappedText(page, sectionValue, 84, sectionY, 470, regularFont, 12, 16);
        sectionY -= 8;
      }
    }
  }

  const docIndexY = sectionY - 20;
  drawCentered(page, boldFont, tpl?.indexTitle ?? "DOCUMENT INDEX", 14, docIndexY);

  const counselPreambleRaw = tpl?.counselPreamble
    ?? options.caption.introductoryCounselLine
    ?? "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.";
  const intro = interpolateTemplateText(counselPreambleRaw, options.caption);
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

  const tpl = options.template;
  drawCentered(page, boldFont, tpl?.affirmationTitle ?? "AFFIRMATION", 14, 726);

  const serviceDate = options.service?.serviceDate || new Date().toLocaleDateString("en-US");
  const affirmationTextRaw = tpl?.affirmationText ??
    "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.";
  const affirmationText = interpolateTemplateText(affirmationTextRaw, options.caption);
  let y = drawWrappedText(page, affirmationText, 84, 702, 470, regularFont, 11, 14);
  y -= 20;
  page.drawText(`Dated: ${serviceDate}`, { x: 84, y, size: 11, font: regularFont });

  const signY = y - 65;
  const signerDisplayName = options.signerName || options.caption.introductoryCounselLine || "";
  const signerLines = [
    "Claimant's Counsel",
    signerDisplayName,
  ].filter(Boolean);

  // When firm info belongs in the signature block (not the page header),
  // append the firm block lines below the signer name.
  if (tpl?.firmBlockPosition === "signature" && options.firmBlockLines) {
    const cleaned = options.firmBlockLines
      .map((l) => l.trim().replace(/\[[^\]]+\]/g, "").trim())
      .filter((l) => l && !/not configured/i.test(l));
    // Skip lines that duplicate the signer name already shown
    for (const line of cleaned) {
      if (signerDisplayName && line.toLowerCase() === signerDisplayName.toLowerCase()) continue;
      signerLines.push(line);
    }
  }

  const signerAlign = tpl?.signerBlockAlign ?? "right";
  const signerX = signerAlign === "left" ? 84 : 360;
  let sigLineY = signY;
  for (const line of signerLines) {
    page.drawText(line, { x: signerX, y: sigLineY, size: 10.5, font: regularFont });
    sigLineY -= 14;
  }

  drawCentered(page, boldFont, tpl?.certTitle ?? "CERTIFICATE OF SERVICE", 13, 430);
  const serviceIntroRaw = tpl?.certIntro ??
    "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:";
  const serviceIntro = interpolateTemplateText(serviceIntroRaw, options.caption);
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
  showFirmBlock = true,
  doubleLeftLine = false,
  rightLine = false
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

  if (doubleLeftLine) {
    page.drawLine({
      start: { x: 58, y: bottom - 10 },
      end: { x: 58, y: top + 8 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  }

  if (rightLine) {
    page.drawLine({
      start: { x: 556, y: bottom - 10 },
      end: { x: 556, y: top + 8 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  }

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

/**
 * Flatten inline SDTs (structured document tags / content controls) in DOCX XML.
 * Docxtemplater cannot parse inline SDTs and throws "Malformed xml".
 * Replace each <w:sdt>...</w:sdt> with the runs inside <w:sdtContent>.
 */
function flattenInlineSDTs(xml: string): string {
  return xml.replace(/<w:sdt>[\s\S]*?<w:sdtContent>([\s\S]*?)<\/w:sdtContent>[\s\S]*?<\/w:sdt>/g, "$1");
}

/**
 * Merge split template tags in DOCX XML.
 */
function mergeDocxTemplateRuns(zip: PizZip): void {
  const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
  for (const xmlPath of xmlFiles) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    let xml = file.asText();
    // Repair common XML corruption from injectVariablesIntoDocx:
    // Missing space between tag name and attribute, e.g. <w:txml:space="preserve">
    xml = xml.replace(/<w:txml:space=/g, '<w:t xml:space=');
    // Flatten inline SDTs before merging runs (docxtemplater can't handle them)
    xml = flattenInlineSDTs(xml);
    xml = xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (paragraph) => {
      // Skip paragraphs containing text boxes — nested <w:p> elements
      // would cause the regex to slice incorrectly, corrupting the XML
      if (paragraph.includes("<w:txbxContent>")) return paragraph;
      const runRegex = /<w:r[\s>][\s\S]*?<\/w:r>/g;
      const runs: { match: string; index: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = runRegex.exec(paragraph)) !== null) {
        runs.push({ match: m[0], index: m.index });
      }
      if (runs.length < 2) return paragraph;
      const getRunText = (run: string): string => {
        const tMatch = run.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
        return tMatch ? tMatch[1] : "";
      };
      const allText = runs.map((r) => getRunText(r.match)).join("");
      if (!allText.includes("{{") && !allText.includes("}}")) return paragraph;
      const mergedRuns: { match: string; index: number }[] = [];
      let i = 0;
      while (i < runs.length) {
        const startText = getRunText(runs[i].match);
        let combined = startText;
        let groupEnd = i;
        const needsMerge = (text: string): boolean => {
          let depth = 0;
          for (let ci = 0; ci < text.length - 1; ci++) {
            if (text[ci] === "{" && text[ci + 1] === "{") { depth++; ci++; }
            else if (text[ci] === "}" && text[ci + 1] === "}") { depth--; ci++; }
          }
          return depth !== 0;
        };
        if (needsMerge(combined)) {
          while (groupEnd + 1 < runs.length && needsMerge(combined)) {
            groupEnd++;
            combined += getRunText(runs[groupEnd].match);
          }
          if (groupEnd > i) {
            const firstRun = runs[i].match;
            const escapedCombined = combined.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            let mergedRun: string;
            if (/<w:t(?:\s[^>]*)?>/.test(firstRun)) {
              mergedRun = firstRun.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${escapedCombined}</w:t>`);
            } else {
              mergedRun = firstRun.replace(/<\/w:r>/, `<w:t xml:space="preserve">${escapedCombined}</w:t></w:r>`);
            }
            mergedRuns.push({ match: mergedRun, index: runs[i].index });
            for (let j = i + 1; j <= groupEnd; j++) {
              mergedRuns.push({ match: "", index: runs[j].index });
            }
            i = groupEnd + 1;
            continue;
          }
        }
        mergedRuns.push(runs[i]);
        i++;
      }
      let result = paragraph;
      for (let ri = mergedRuns.length - 1; ri >= 0; ri--) {
        const original = runs[ri];
        const merged = mergedRuns[ri];
        if (merged.match === "" && original.match !== "") {
          result = result.slice(0, original.index) + result.slice(original.index + original.match.length);
        } else if (merged.match !== original.match) {
          result = result.slice(0, original.index) + merged.match + result.slice(original.index + original.match.length);
        }
      }
      return result;
    });
    zip.file(xmlPath, xml);
  }
}

/**
 * Convert a DOCX buffer to PDF using LibreOffice.
 * Reusable helper for any DOCX-to-PDF conversion.
 */
export async function renderDocxWithLibreOffice(docxBuffer: Buffer): Promise<Uint8Array> {
  const tmpDir = await mkdtemp(join(os.tmpdir(), "docx-render-"));
  const inputPath = join(tmpDir, "input.docx");
  const outputPath = join(tmpDir, "input.pdf");
  try {
    await writeFile(inputPath, docxBuffer);
    const macOsPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    const isMac = os.platform() === "darwin";
    const cmd = isMac ? macOsPath : "libreoffice";
    try {
      execFileSync(cmd, ["--headless", "--invisible", "--nologo", "--nodefault", "--convert-to", "pdf", "input.docx"], { cwd: tmpDir, stdio: "ignore" });
    } catch {
      execFileSync(isMac ? "libreoffice" : "soffice", ["--headless", "--invisible", "--nologo", "--nodefault", "--convert-to", "pdf", "input.docx"], { cwd: tmpDir, stdio: "ignore" });
    }
    const pdfBuffer = await readFile(outputPath);
    return new Uint8Array(pdfBuffer);
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderDocxWithLibreOfficeWithRetry(
  docxBuffer: Buffer,
  options: { attempts?: number; initialDelayMs?: number } = {}
): Promise<Uint8Array> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const initialDelayMs = Math.max(10, options.initialDelayMs ?? 150);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await renderDocxWithLibreOffice(docxBuffer);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(initialDelayMs * (2 ** attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`DOCX render failed: ${String(lastError)}`);
}

/**
 * Native DOCX Front Matter Generation
 */
async function buildDocxFrontMatter(
  template: PacketTemplate,
  caption: EvidencePacketCaption,
  service: EvidencePacketServiceInfo | undefined,
  tocEntries: EvidencePacketTocEntry[],
  firmName: string | undefined,
  resolveDocPath: (relativePath: string) => string,
  extraSectionValues?: Record<string, string>,
  firmBlockLines?: string[],
  signerName?: string,
): Promise<{ pdfBytes: Uint8Array; docxBytes: Buffer }> {
  if (!template.sourceFile) throw new Error("Template missing sourceFile property");
  // sourceFile can be "templatized/filename.docx" or "source/filename.docx"
  // Resolve the path accordingly
  const templatizedMatch = template.sourceFile.match(/^templatized\/(.+)$/);
  const sourceMatch = template.sourceFile.match(/^source\/(.+)$/);
  let masterPath: string;
  if (templatizedMatch) {
    masterPath = resolveDocPath(join(".ai_tool", "templates", "templatized", templatizedMatch[1]));
  } else if (sourceMatch) {
    masterPath = resolveDocPath(join(".ai_tool", "templates", "source", sourceMatch[1]));
  } else {
    // Fallback: try templatized first, then source
    const filename = template.sourceFile.replace(/^.*\//, "");
    const templatizedPath = resolveDocPath(join(".ai_tool", "templates", "templatized", filename));
    try {
      await readFile(templatizedPath);
      masterPath = templatizedPath;
    } catch {
      masterPath = resolveDocPath(join(".ai_tool", "templates", "source", filename));
    }
  }
  let masterBytes: Buffer;
  try { masterBytes = await readFile(masterPath); } catch (err) {
    throw new Error(`Failed to load master DOCX template at ${masterPath}: ${formatError(err)}`);
  }
  const sDate = service?.serviceDate ? new Date(service.serviceDate) : new Date();

  // Build document index text for {{documentIndexText}} placeholder
  const documentIndexLines: string[] = [];
  const useNumberedRightAlignedIndex =
    template.id === "ho-standard"
    || template.id === "ao-standard"
    || template.sourceFile === "source/__builtin-ho-standard.docx"
    || template.sourceFile === "source/__builtin-ao-standard.docx";
  for (let i = 0; i < tocEntries.length; i++) {
    const entry = tocEntries[i];
    const pageRange = entry.startPage === entry.endPage
      ? `${entry.startPage}`
      : `${entry.startPage}-${entry.endPage}`;
    const dateStr = entry.date || "";
    if (useNumberedRightAlignedIndex) {
      const label = truncateDocIndexLabel(
        `${i + 1}. ${entry.title}${dateStr ? ` - ${dateStr}` : ""}`
      );
      documentIndexLines.push(`${label}\tPg. ${pageRange}`);
    } else if (template.tocFormat === "date-doc-page") {
      documentIndexLines.push(`${dateStr}\t${entry.title}\t${pageRange}`);
    } else {
      const label = truncateDocIndexLabel(
        `${i + 1}. ${entry.title}${dateStr ? ` - ${dateStr}` : ""}`
      );
      documentIndexLines.push(`${label}\tPg. ${pageRange}`);
    }
  }
  const documentIndexText = documentIndexLines.join("\n");
  const serviceDate = service?.serviceDate || new Date().toLocaleDateString("en-US");
  const serviceMethodPlain = (service?.serviceMethod || "")
    .replace(/^\[[xX]\]\s*/, "")
    .trim()
    || "Via E-File";
  const serviceRecipientsText = (service?.recipients || []).join("\n");
  const datedLine = `Dated this ____  day of ${sDate.toLocaleString('default', { month: 'long' })}, ${sDate.getFullYear()}.`;
  const hoCaptionLine1 = `Claim No.: ${caption.claimNumber || caption.captionValues?.["claimNumber"] || ""}`.trimEnd();
  const hoCaptionLine2 = `Hearing No.: ${caption.hearingNumber || caption.captionValues?.["hearingNumber"] || ""}`.trimEnd();
  const hoCaptionLine3 = `Date/Time: ${caption.hearingDateTime || caption.captionValues?.["hearingDateTime"] || ""}`.trimEnd();
  const hoCaptionLine4 = `Appearance: ${caption.appearance || caption.captionValues?.["appearance"] || ""}`.trimEnd();
  const hoCaptionPreamble2 = template.captionPreambleLines?.[1] || "Industrial Insurance Claim of";
  const cleanedFirmLines = (firmBlockLines || [])
    .map((line) => line.replace(/\[[^\]]+\]/g, "").trim())
    .filter((line) => line && !/not configured/i.test(line));
  const signerDisplayName = signerName || caption.introductoryCounselLine || "";
  const signatureFirmLines = cleanedFirmLines.filter((line) => {
    if (signerDisplayName && line.toLowerCase() === signerDisplayName.toLowerCase()) return false;
    if (firmName && line.toLowerCase() === firmName.toLowerCase()) return false;
    return true;
  });
  const signatureFirmBlock = signatureFirmLines.join("\n");

  const docxData: Record<string, string | object[]> = {
    // Standard fields
    claimantName: caption.claimantName || "",
    claimNumber: caption.claimNumber || "",
    hearingNumber: caption.hearingNumber || "",
    hearingDateTime: caption.hearingDateTime || "",
    firmName: firmName || "Our Firm",
    appearance: caption.appearance || "",
    // Common aliases — DOCX injector may use different variable names than the UI keys
    appealNumber: caption.hearingNumber || caption.captionValues?.["hearingNumber"] || "",
    employer: caption.captionValues?.["employer"] || "",
    hearingNo: caption.captionValues?.["hearingNo"] || "",
    currentDate: new Date().toLocaleDateString(),
    serviceMonth: sDate.toLocaleString('default', { month: 'long' }),
    serviceYear: sDate.getFullYear().toString(),
    serviceDay: sDate.getDate().toString(),
    serviceDate,
    serviceMethodPlain,
    serviceRecipientsText,
    serviceRecipients: serviceRecipientsText,
    datedLine,
    servedBy: service?.servedBy || "An employee of counsel",
    omit: "",
    hoCaptionLine1,
    hoCaptionLine2,
    hoCaptionLine3,
    hoCaptionLine4,
    hoCaptionPreamble2,
    signatureFirmBlock,
    documentIndexText,
    tocEntries: tocEntries.map((entry, i) => ({
      number: String(i + 1),
      title: entry.title,
      date: entry.date || "",
      dateLine: entry.date ? ` - ${entry.date}` : "",
      startPage: String(entry.startPage),
      endPage: String(entry.endPage),
      pageRange: entry.startPage === entry.endPage
        ? String(entry.startPage)
        : `${entry.startPage}-${entry.endPage}`,
    })),
    // Template text fields the AI may have injected
    counselPreamble: interpolateTemplateText(template.counselPreamble || "", caption),
    affirmationTitle: template.affirmationTitle || "",
    affirmationText: interpolateTemplateText(template.affirmationText || "", caption),
    certTitle: template.certTitle || "",
    certIntro: interpolateTemplateText(template.certIntro || "", caption),
    indexTitle: template.indexTitle || "",
    heading: template.heading || "",
    agencyLine: template.agencyLine || "",
    documentTitle: template.documentTitle || "",
    // Firm/signer data
    signerName: signerName || "",
    firmBlockText: (firmBlockLines || []).join("\n"),
    attorneyNames: (firmBlockLines || []).join("\n"),
    // Extra section values (issueOnAppeal, etc.)
    ...(extraSectionValues || {}),
    // Caption values LAST (user input overrides defaults)
    ...caption.captionValues,
  };
  const zip = new PizZip(masterBytes);
  mergeDocxTemplateRuns(zip);

  // --- DIAGNOSTIC: scan template for variables ---
  const allXmlParts = ["word/document.xml", "word/header1.xml", "word/header2.xml",
    "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
  const templateVars = new Set<string>();
  for (const part of allXmlParts) {
    const f = zip.file(part);
    if (!f) continue;
    const xml = f.asText();
    for (const m of xml.matchAll(/\{\{(\w+)\}\}/g)) {
      templateVars.add(m[1]);
    }
  }
  const dataKeys = new Set(Object.keys(docxData));
  const loopValueKeys = new Set(["number", "title", "date", "dateLine", "startPage", "endPage", "pageRange"]);
  const unresolved = [...templateVars].filter(v => !dataKeys.has(v) && !loopValueKeys.has(v));
  const unused = [...dataKeys].filter(k => !templateVars.has(k));
  console.log(`[DOCX] Template variables found: ${[...templateVars].join(", ") || "(none)"}`);
  console.log(`[DOCX] Data keys provided: ${[...dataKeys].join(", ")}`);
  if (unresolved.length) console.warn(`[DOCX] UNRESOLVED (in template but not in data): ${unresolved.join(", ")}`);
  if (unused.length) console.log(`[DOCX] Unused data keys (not in template): ${unused.join(", ")}`);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  doc.render(docxData);

  // --- DIAGNOSTIC: check for unresolved variables in rendered output ---
  const renderedZip = doc.getZip();
  const remainingVars: string[] = [];
  for (const part of allXmlParts) {
    const f = renderedZip.file(part);
    if (!f) continue;
    for (const m of f.asText().matchAll(/\{\{(\w+)\}\}/g)) {
      remainingVars.push(m[1]);
    }
  }
  if (remainingVars.length) {
    console.error(`[DOCX] REMAINING UNRESOLVED after render: ${remainingVars.join(", ")}`);
  } else {
    console.log(`[DOCX] All template variables resolved successfully`);
  }

  const renderedBuffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  const fulfilledBuffer = ensureDocxFooterPageNumberFields(renderedBuffer);

  // --- Save debug DOCX for inspection ---
  try {
    const debugDir = resolveDocPath(join(".ai_tool", "templates"));
    await writeFile(join(debugDir, "debug-pre-libreoffice.docx"), fulfilledBuffer);
    console.log(`[DOCX] Pre-LibreOffice DOCX saved for inspection`);
  } catch { /* non-fatal */ }

  const pdfBytes = await renderDocxWithLibreOfficeWithRetry(fulfilledBuffer);
  return { pdfBytes, docxBytes: fulfilledBuffer };
}

/**
 * Native PDF Front Matter Generation
 */
async function buildPdfFrontMatter(
  template: PacketTemplate,
  caption: EvidencePacketCaption,
  service: EvidencePacketServiceInfo | undefined,
  tocEntries: EvidencePacketTocEntry[],
  firmName: string | undefined,
  resolveDocPath: (relativePath: string) => string
): Promise<Uint8Array> {
  if (!template.sourceFile) throw new Error("Template missing sourceFile property");
  const match = template.sourceFile.match(/source\/(.+)$/);
  const sourceRelative = match ? match[1] : template.sourceFile;
  const basenameStr = sourceRelative.replace(/\.[^/.]+$/, "");
  const coordsPath = resolveDocPath(join(".ai_tool", "templates", "parsed", `${basenameStr}-coords.json`));
  const masterPath = resolveDocPath(join(".ai_tool", "templates", "source", sourceRelative));
  let coordsMap: Record<string, { page: number; x: number; y: number; width: number; height: number; }> = {};
  try {
    const coordsStr = await readFile(coordsPath, "utf-8");
    coordsMap = JSON.parse(coordsStr);
  } catch (e) { console.warn(`Missing coordinate map for PDF template: ${coordsPath}`); }
  const masterBytes = await readFile(masterPath);
  const pdf = await PDFDocument.load(masterBytes);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const sDate = service?.serviceDate ? new Date(service.serviceDate) : new Date();
  const renderData: Record<string, string> = {
    claimantName: caption.claimantName || "",
    claimNumber: caption.claimNumber || "",
    hearingNumber: caption.hearingNumber || "",
    hearingDateTime: caption.hearingDateTime || "",
    firmName: firmName || "Our Firm",
    appearance: caption.appearance || "",
    currentDate: new Date().toLocaleDateString(),
    serviceMonth: sDate.toLocaleString('default', { month: 'long' }),
    serviceYear: sDate.getFullYear().toString(),
    serviceDay: sDate.getDate().toString(),
    ...caption.captionValues,
  };
  const pages = pdf.getPages();
  const fontSize = 12;
  for (const [varName, varValue] of Object.entries(renderData)) {
    const coord = coordsMap[varName];
    if (coord && typeof varValue === "string" && varValue) {
      const pageIndex = coord.page - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const pageHeight = page.getHeight();
        const pdfLibY = pageHeight - coord.y - coord.height;
        page.drawText(varValue, { x: coord.x, y: pdfLibY + 2, size: fontSize, font, color: rgb(0, 0, 0) });
      }
    }
  }
  return pdf.save();
}
