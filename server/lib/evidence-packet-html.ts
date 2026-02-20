import { htmlToPdf } from "./export";
import type { PacketTemplate, EvidencePacketCaption, EvidencePacketServiceInfo, EvidencePacketTocEntry } from "./evidence-packet";

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

export function interpolateTemplate(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key] ?? match;
  });
}

// ---------------------------------------------------------------------------
// Document index table (HTML)
// ---------------------------------------------------------------------------

function formatPageRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

function formatTocLabel(entry: { title: string; date?: string }, index: number): string {
  const title = (entry.title || "").trim();
  const date = (entry.date || "").trim();
  const label = date && !title.toLowerCase().includes(date.toLowerCase())
    ? `${title} - ${date}`
    : title;
  return `${index + 1}. ${label}`;
}

export function buildDocumentIndexHtml(
  tocEntries: Array<{ title: string; date?: string; startPage: number; endPage: number }>,
  indexTitle: string,
  counselPreamble: string,
): string {
  const rows = tocEntries
    .map((entry, i) => {
      const label = formatTocLabel(entry, i);
      const pages = `Pg. ${formatPageRange(entry.startPage, entry.endPage)}`;
      return `<tr><td class="toc-doc">${escapeHtml(label)}</td><td class="toc-pages">${escapeHtml(pages)}</td></tr>`;
    })
    .join("\n");

  return `
<div class="document-index-section">
  <h2 class="section-title">${escapeHtml(indexTitle)}</h2>
  <p class="counsel-preamble">${escapeHtml(counselPreamble)}</p>
  <table class="toc-table">
    <thead>
      <tr><th class="toc-doc-header">Document</th><th class="toc-pages-header">Page(s)</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
}

// ---------------------------------------------------------------------------
// Affirmation + Certificate of Service (HTML)
// ---------------------------------------------------------------------------

export function buildAffirmationHtml(options: {
  affirmationTitle: string;
  affirmationText: string;
  certTitle: string;
  certIntro: string;
  serviceDate: string;
  serviceMethod: string;
  recipients: string[];
  signerName: string;
  servedBy?: string;
}): string {
  const recipientItems = options.recipients.length > 0
    ? options.recipients.map(r => `<p class="recipient">${escapeHtml(r)}</p>`).join("\n")
    : `<p class="recipient">Recipient details to be provided by counsel.</p>`;

  return `
<div class="affirmation-section" style="page-break-before: always;">
  <h2 class="section-title">${escapeHtml(options.affirmationTitle)}</h2>
  <p>${escapeHtml(options.affirmationText)}</p>
  <p class="dated-line">Dated: ${escapeHtml(options.serviceDate)}</p>

  <div class="signer-block">
    <p>Claimant's Counsel</p>
    <p>${escapeHtml(options.signerName)}</p>
  </div>

  <h2 class="section-title cert-title">${escapeHtml(options.certTitle)}</h2>
  <p>${escapeHtml(options.certIntro)}</p>
  <p class="service-method">[x] ${escapeHtml(options.serviceMethod)}</p>
  ${recipientItems}
  <p class="dated-line">Dated: ${escapeHtml(options.serviceDate)}</p>
  <p class="served-by">${escapeHtml(options.servedBy || "An employee of counsel")}</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Firm block (HTML)
// ---------------------------------------------------------------------------

export function buildFirmBlockHtml(firmBlockLines: string[]): string {
  const lines = firmBlockLines.slice(0, 7);
  while (lines.length < 7) lines.push("");
  const divs = lines
    .map(line => {
      const cleaned = line.trim().replace(/\[[^\]]+\]/g, "").trim();
      const visible = /not configured/i.test(cleaned) ? "" : cleaned;
      return `<div class="firm-line">${visible ? escapeHtml(visible) : "&nbsp;"}</div>`;
    })
    .join("\n");

  return `<div class="firm-block">${divs}</div>`;
}

// ---------------------------------------------------------------------------
// Full HTML wrapper with pleading paper CSS
// ---------------------------------------------------------------------------

export function wrapWithPleadingCss(bodyHtml: string, extraCss?: string): string {
  const lineNumbers = Array.from({ length: 28 }, (_, i) =>
    `<div class="pleading-line-number">${i + 1}</div>`
  ).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: letter;
    margin: 0.35in 0.35in 0.52in 0.35in;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.4;
    color: #000;
    margin: 0;
    padding: 0;
  }

  /* Pleading paper gutter + line numbers */
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

  /* Main content area */
  .pleading-content {
    margin-left: 0.60in;
    margin-right: 0.30in;
    padding-top: 0.38in;
  }

  /* Firm block – top-left of first page */
  .firm-block {
    margin-bottom: 12pt;
    font-size: 12pt;
    color: #333;
  }
  .firm-line {
    line-height: 1.08;
    min-height: 12.5pt;
  }

  /* Section titles */
  .section-title {
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    margin: 16pt 0 10pt;
  }

  /* Counsel preamble */
  .counsel-preamble {
    margin: 12pt 0;
    text-align: justify;
  }

  /* TOC table with dot leaders */
  .toc-table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
  }
  .toc-table th {
    text-align: left;
    font-weight: bold;
    font-size: 12pt;
    padding-bottom: 6pt;
    border-bottom: none;
  }
  .toc-pages-header {
    text-align: right;
    width: 80pt;
  }
  .toc-table td {
    padding: 4pt 0;
    vertical-align: top;
    border: none;
  }
  .toc-doc {
    padding-right: 12pt;
  }
  .toc-pages {
    text-align: right;
    white-space: nowrap;
    width: 80pt;
  }

  /* Affirmation section */
  .affirmation-section .dated-line {
    margin-top: 16pt;
    margin-bottom: 6pt;
  }
  .signer-block {
    text-align: right;
    margin-top: 40pt;
    margin-bottom: 24pt;
    font-size: 10.5pt;
  }
  .cert-title {
    margin-top: 24pt;
  }
  .service-method {
    margin: 8pt 0;
  }
  .recipient {
    margin: 4pt 0 4pt 20pt;
    font-size: 10.5pt;
  }
  .served-by {
    margin-top: 28pt;
    font-size: 10.5pt;
  }

  ${extraCss || ""}
</style>
</head>
<body>
  <div class="pleading-gutter" aria-hidden="true">
    ${lineNumbers}
  </div>
  <div class="pleading-content">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface RenderHtmlFrontMatterOptions {
  caption: EvidencePacketCaption;
  template: PacketTemplate;
  firmBlockLines?: string[];
  service?: EvidencePacketServiceInfo;
  signerName?: string;
  extraSectionValues?: Record<string, string>;
  includeAffirmationPage?: boolean;
}

export async function renderHtmlFrontMatter(
  options: RenderHtmlFrontMatterOptions,
  tocEntries: Array<{ title: string; date?: string; startPage: number; endPage: number }>,
): Promise<Buffer> {
  const tpl = options.template;

  // Build value map from all available fields
  const values: Record<string, string> = {
    claimantName: options.caption.claimantName || "",
    claimNumber: options.caption.claimNumber || "",
    hearingNumber: options.caption.hearingNumber || "",
    hearingDateTime: options.caption.hearingDateTime || "",
    appearance: options.caption.appearance || "",
    signerName: options.signerName || options.caption.introductoryCounselLine || "",
  };

  // Merge captionValues (custom template fields)
  if (options.caption.captionValues) {
    for (const [k, v] of Object.entries(options.caption.captionValues)) {
      if (!(k in values)) values[k] = v;
    }
  }

  // Merge extra section values
  if (options.extraSectionValues) {
    for (const [k, v] of Object.entries(options.extraSectionValues)) {
      values[k] = v;
    }
  }

  // Build firm block
  if (options.firmBlockLines) {
    values.firmBlock = buildFirmBlockHtml(options.firmBlockLines);
  }

  // Build document index HTML
  const counselPreambleRaw = tpl.counselPreamble
    || "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.";
  const counselPreamble = counselPreambleRaw.replace(/\{\{claimantName\}\}/g, options.caption.claimantName);

  const documentIndexHtml = buildDocumentIndexHtml(
    tocEntries,
    tpl.indexTitle || "DOCUMENT INDEX",
    counselPreamble,
  );
  values.documentIndex = documentIndexHtml;

  // Build affirmation HTML
  const serviceDate = options.service?.serviceDate || new Date().toLocaleDateString("en-US");
  const affirmationHtml = buildAffirmationHtml({
    affirmationTitle: tpl.affirmationTitle || "AFFIRMATION",
    affirmationText: tpl.affirmationText || "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
    certTitle: tpl.certTitle || "CERTIFICATE OF SERVICE",
    certIntro: tpl.certIntro || "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
    serviceDate,
    serviceMethod: options.service?.serviceMethod || "Via E-File",
    recipients: options.service?.recipients || [],
    signerName: values.signerName,
    servedBy: options.service?.servedBy,
  });
  values.affirmationSection = affirmationHtml;

  // Interpolate template
  let htmlBody = interpolateTemplate(tpl.htmlTemplate!, values);

  // If template doesn't include dynamic sections, append them
  if (!tpl.htmlTemplate!.includes("{{documentIndex}}")) {
    htmlBody += documentIndexHtml;
  }
  if (options.includeAffirmationPage !== false && !tpl.htmlTemplate!.includes("{{affirmationSection}}")) {
    htmlBody += affirmationHtml;
  }

  const fullHtml = wrapWithPleadingCss(htmlBody, tpl.htmlTemplateCss);
  return htmlToPdf(fullHtml, "front-matter");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
