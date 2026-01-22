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
} from "docx";
import puppeteer from "puppeteer";

// Convert markdown to HTML with legal document styling
export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 1in;
      color: #000;
    }
    h1 {
      font-size: 16pt;
      font-weight: bold;
      margin-top: 24pt;
      margin-bottom: 12pt;
      text-align: center;
    }
    h2 {
      font-size: 14pt;
      font-weight: bold;
      margin-top: 18pt;
      margin-bottom: 10pt;
    }
    h3 {
      font-size: 12pt;
      font-weight: bold;
      margin-top: 14pt;
      margin-bottom: 8pt;
    }
    p {
      margin: 10pt 0;
      text-align: justify;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
    }
    th, td {
      border: 1px solid #000;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background-color: #f0f0f0;
      font-weight: bold;
    }
    ul, ol {
      margin: 10pt 0;
      padding-left: 24pt;
    }
    li {
      margin: 4pt 0;
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
  ${html}
</body>
</html>`;
}

// Parse HTML and convert to DOCX elements
export async function htmlToDocx(
  html: string,
  title: string
): Promise<Buffer> {
  // Parse the HTML body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  const children: (Paragraph | Table)[] = [];

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
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Handle tags
    if (trimmed.startsWith("<")) {
      const tagMatch = trimmed.match(/<\/?(\w+)[^>]*>/i);
      if (!tagMatch) continue;

      const tag = tagMatch[1].toLowerCase();
      const isClosing = trimmed.startsWith("</");

      switch (tag) {
        case "h1":
          if (isClosing) {
            flushText(HeadingLevel.HEADING_1, AlignmentType.CENTER);
          }
          break;
        case "h2":
          if (isClosing) {
            flushText(HeadingLevel.HEADING_2);
          }
          break;
        case "h3":
          if (isClosing) {
            flushText(HeadingLevel.HEADING_3);
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
          children.push(
            new Paragraph({
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 6 },
              },
              spacing: { after: 200 },
            })
          );
          break;
        case "br":
          currentText.push(new TextRun({ break: 1 }));
          break;
      }
    } else {
      // Text content - decode HTML entities
      const decoded = trimmed
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

// Convert HTML to PDF using Puppeteer
export async function htmlToPdf(html: string, title: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: {
        top: "1in",
        right: "1in",
        bottom: "1in",
        left: "1in",
      },
      printBackground: true,
      displayHeaderFooter: false,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
