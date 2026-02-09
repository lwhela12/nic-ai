import { Hono } from "hono";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, dirname, basename, resolve, sep } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  markdownToHtml,
  htmlToDocx,
  htmlToPdf,
  markdownToHearingDecisionPdf,
  loadFirmInfo,
  ExportOptions,
} from "../lib/export";
import type { DocxStyles } from "../lib/extract";
import { requireCaseAccess } from "../lib/team-access";
import {
  buildEvidencePacket,
  scanPdfForSensitiveData,
  applyManualRedactionBoxes,
  type EvidencePacketManualRedactionBox,
  type EvidencePacketDocumentInput,
  type EvidencePacketOrderRule,
} from "../lib/evidence-packet";

const execAsync = promisify(exec);

// Helper to load template styles from .pi_tool/template-styles.json
async function loadTemplateStyles(firmRoot: string): Promise<DocxStyles | undefined> {
  try {
    const stylesPath = join(firmRoot, ".pi_tool", "template-styles.json");
    const content = await readFile(stylesPath, "utf-8");
    const data = JSON.parse(content);
    return data.styles;
  } catch {
    // No template styles found, return undefined
    return undefined;
  }
}

async function resolveCaseName(caseFolder: string, providedCaseName?: string): Promise<string | undefined> {
  const direct = typeof providedCaseName === "string" ? providedCaseName.trim() : "";
  if (direct) return direct;

  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const fromSummary = typeof index?.summary?.client === "string"
      ? index.summary.client.trim()
      : "";
    if (fromSummary) return fromSummary;

    const fromSummaryAlt = typeof index?.summary?.client_name === "string"
      ? index.summary.client_name.trim()
      : "";
    if (fromSummaryAlt) return fromSummaryAlt;
  } catch {
    // No index or unreadable index; fall through
  }

  return undefined;
}

function resolveCasePath(caseFolder: string, relativePath: string): string {
  const base = resolve(caseFolder);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Path is outside case folder: ${relativePath}`);
  }
  return target;
}

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

const app = new Hono();

// Draft type definition
interface Draft {
  id: string;
  name: string;
  path: string;
  type: string;
  createdAt: string;
  targetPath: string;
}

// List generated documents in .pi_tool and standard locations
app.get("/list", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const docs: any[] = [];

  // Check .pi_tool folder
  const piToolPath = join(caseFolder, ".pi_tool");
  try {
    const entries = await readdir(piToolPath);
    for (const entry of entries) {
      if (entry.endsWith(".md") || entry.endsWith(".json")) {
        const content = await readFile(join(piToolPath, entry), "utf-8");
        docs.push({
          name: entry,
          path: join(".pi_tool", entry),
          fullPath: join(piToolPath, entry),
          type: entry.includes("memo") ? "memo" : entry.includes("index") ? "index" : "report",
          size: content.length,
        });
      }
    }
  } catch {
    // .pi_tool doesn't exist yet
  }

  // Check for demand letter draft
  const demandPath = join(caseFolder, "3P", "3P Demand - DRAFT.md");
  try {
    const content = await readFile(demandPath, "utf-8");
    docs.push({
      name: "3P Demand - DRAFT.md",
      path: "3P/3P Demand - DRAFT.md",
      fullPath: demandPath,
      type: "demand",
      size: content.length,
    });
  } catch {
    // No demand yet
  }

  // Check for settlement memo draft
  const settlementPath = join(caseFolder, "Settlement", "Settlement Memo - DRAFT.md");
  try {
    const content = await readFile(settlementPath, "utf-8");
    docs.push({
      name: "Settlement Memo - DRAFT.md",
      path: "Settlement/Settlement Memo - DRAFT.md",
      fullPath: settlementPath,
      type: "settlement",
      size: content.length,
    });
  } catch {
    // No settlement memo yet
  }

  return c.json({ docs });
});

// Get a specific generated document
app.get("/read", async (c) => {
  const caseFolder = c.req.query("case");
  const docPath = c.req.query("path");

  if (!caseFolder || !docPath) {
    return c.json({ error: "case and path query params required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const fullPath = join(caseFolder, docPath);

  try {
    const content = await readFile(fullPath, "utf-8");
    return c.json({ content, path: docPath });
  } catch {
    return c.json({ error: "Document not found" }, 404);
  }
});

// Save a document to the case folder
app.post("/save", async (c) => {
  const { caseFolder, targetPath, content } = await c.req.json();

  if (!caseFolder || !targetPath || !content) {
    return c.json({ error: "caseFolder, targetPath, and content required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const fullPath = join(caseFolder, targetPath);

  try {
    // Ensure directory exists
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    return c.json({ success: true, path: targetPath });
  } catch (error) {
    return c.json({ error: "Could not save document" }, 500);
  }
});

// Export endpoint - converts markdown to DOCX/PDF and saves to case folder
// Used by agent to generate proper binary files
app.post("/export", async (c) => {
  const {
    caseFolder,
    sourcePath,
    format,
    targetPath,
    openAfter,
    firmRoot,
    documentType,
    caseName,
    showLetterhead,
    showPageNumbers,
  } = await c.req.json();

  if (!caseFolder || !sourcePath || !format) {
    return c.json({ error: "caseFolder, sourcePath, and format required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  if (!["docx", "pdf"].includes(format)) {
    return c.json({ error: "format must be 'docx' or 'pdf'" }, 400);
  }

  const fullSourcePath = join(caseFolder, sourcePath);

  try {
    const content = await readFile(fullSourcePath, "utf-8");
    const rawFilename = sourcePath.split("/").pop() || "document.md";
    const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "");

    // Determine target path - use provided or default to same location with new extension
    const outputPath = targetPath || sourcePath.replace(/\.md$/, `.${format}`);
    const fullOutputPath = join(caseFolder, outputPath);

    // Ensure output directory exists
    await mkdir(dirname(fullOutputPath), { recursive: true });

    // Infer document type from path if not provided
    const inferredType = documentType || inferTypeFromPath(sourcePath);
    console.log(`[Export] caseFolder=${caseFolder}, sourcePath=${sourcePath}, documentType=${inferredType}`);

    // Load firm info if firmRoot provided (or try parent of caseFolder)
    const firmInfoRoot = firmRoot || dirname(caseFolder);
    console.log(`[Export] firmInfoRoot=${firmInfoRoot} (firmRoot param=${firmRoot})`);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    // Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Build export options
    // Show letterhead by default for demands and letters, or if explicitly requested
    // Don't show for memos (internal documents)
    const shouldShowLetterhead = showLetterhead ?? (inferredType === "demand" || inferredType === "letter");
    const resolvedCaseName = await resolveCaseName(caseFolder, caseName);

    const exportOptions: ExportOptions = {
      documentType: inferredType,
      firmInfo: firmInfo || undefined,
      caseName: resolvedCaseName,
      showLetterhead: shouldShowLetterhead,
      showPageNumbers: showPageNumbers ?? inferredType !== "memo",
      templateStyles,
    };
    console.log(`[Export] exportOptions: showLetterhead=${exportOptions.showLetterhead}, documentType=${inferredType}, hasFirmInfo=${!!exportOptions.firmInfo}`);

    if (format === "docx") {
      const html = markdownToHtml(content, exportOptions);
      const docxBuffer = await htmlToDocx(html, nameWithoutExt, {
        documentType: inferredType,
        firmInfo: firmInfo || undefined,
        showLetterhead: shouldShowLetterhead,
      });
      await writeFile(fullOutputPath, docxBuffer);
    } else {
      const pdfBuffer = inferredType === "hearing_decision"
        ? await markdownToHearingDecisionPdf(content, nameWithoutExt, exportOptions)
        : await htmlToPdf(markdownToHtml(content, exportOptions), nameWithoutExt, exportOptions);
      await writeFile(fullOutputPath, pdfBuffer);
    }

    // Auto-open in default application if requested
    if (openAfter) {
      try {
        // Cross-platform open command
        const platform = process.platform;
        let openCmd: string;

        if (platform === "darwin") {
          openCmd = `open "${fullOutputPath}"`;
        } else if (platform === "win32") {
          openCmd = `start "" "${fullOutputPath}"`;
        } else {
          // Linux and others
          openCmd = `xdg-open "${fullOutputPath}"`;
        }

        await execAsync(openCmd);
      } catch (openErr) {
        console.error("Failed to open file:", openErr);
        // Don't fail the export just because open failed
      }
    }

    return c.json({
      success: true,
      outputPath,
      fullPath: fullOutputPath,
      message: `Exported ${sourcePath} to ${outputPath}${openAfter ? " and opened in default application" : ""}`,
    });
  } catch (err) {
    console.error("Export error:", err);
    return c.json({ error: `Export failed: ${err}` }, 500);
  }
});

// Helper to infer document type from file path
function inferTypeFromPath(path: string): ExportOptions["documentType"] {
  const lower = path.toLowerCase();
  if (lower.includes("demand")) return "demand";
  if (lower.includes("settlement")) return "settlement";
  if (lower.includes("memo")) return "memo";
  if (
    lower.includes("decision_and_order") ||
    lower.includes("decision and order") ||
    lower.includes("decision & order") ||
    lower.includes("decision_order") ||
    lower.includes("hearing_decision") ||
    lower.includes("d&o") ||
    lower.includes("dao")
  ) return "hearing_decision";
  // Letter types: Bill HI, LOR, correspondence, requests, notices
  // Workers' Comp letters: light duty request, TTD request, authorization request, etc.
  if (lower.includes("bill_hi") || lower.includes("bill hi") ||
      lower.includes("lor") || lower.includes("letter_of_representation") ||
      lower.includes("letter") || lower.includes("request") ||
      lower.includes("notice") || lower.includes("correspondence")) return "letter";
  return "generic";
}

// Download endpoint (returns file with download headers)
app.get("/download", async (c) => {
  const caseFolder = c.req.query("case");
  const docPath = c.req.query("path");
  const format = c.req.query("format") || "md";
  const firmRoot = c.req.query("firmRoot");
  const caseName = c.req.query("caseName");
  const showLetterhead = c.req.query("letterhead") !== "false";
  const showPageNumbers = c.req.query("pageNumbers") !== "false";

  if (!caseFolder || !docPath) {
    return c.json({ error: "case and path query params required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const fullPath = join(caseFolder, docPath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const rawFilename = docPath.split("/").pop() || "document.md";
    const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "");

    // Infer document type and load firm info
    const documentType = inferTypeFromPath(docPath);
    const firmInfoRoot = firmRoot || dirname(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    // Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Show letterhead for demands and letters by default
    const shouldShowLetterhead = showLetterhead && (documentType === "demand" || documentType === "letter");
    const resolvedCaseName = await resolveCaseName(caseFolder, caseName || undefined);

    const exportOptions: ExportOptions = {
      documentType,
      firmInfo: firmInfo || undefined,
      caseName: resolvedCaseName,
      showLetterhead: shouldShowLetterhead,
      showPageNumbers: showPageNumbers && documentType !== "memo",
      templateStyles,
    };

    switch (format) {
      case "docx": {
        const html = markdownToHtml(content, exportOptions);
        const docxBuffer = await htmlToDocx(html, nameWithoutExt, {
          documentType,
          firmInfo: firmInfo || undefined,
          showLetterhead: shouldShowLetterhead,
        });
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        c.header(
          "Content-Disposition",
          `attachment; filename="${nameWithoutExt}.docx"`
        );
        return c.body(docxBuffer);
      }
      case "pdf": {
        const pdfBuffer = documentType === "hearing_decision"
          ? await markdownToHearingDecisionPdf(content, nameWithoutExt, exportOptions)
          : await htmlToPdf(markdownToHtml(content, exportOptions), nameWithoutExt, exportOptions);
        c.header("Content-Type", "application/pdf");
        c.header(
          "Content-Disposition",
          `inline; filename="${nameWithoutExt}.pdf"`
        );
        return c.body(pdfBuffer);
      }
      default: {
        // Return markdown as-is
        c.header("Content-Disposition", `attachment; filename="${rawFilename}"`);
        c.header("Content-Type", "text/markdown");
        return c.body(content);
      }
    }
  } catch (err) {
    console.error("Download error:", err);
    return c.json({ error: "Document not found" }, 404);
  }
});

// List drafts in .pi_tool/drafts/ folder
app.get("/drafts", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const drafts: Draft[] = [];
  const draftsPath = join(caseFolder, ".pi_tool", "drafts");

  try {
    // Read manifest if it exists
    const manifestPath = join(draftsPath, "manifest.json");
    let manifest: Record<string, any> = {};
    try {
      const manifestContent = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestContent);
    } catch {
      // No manifest, will infer from filenames
    }

    const entries = await readdir(draftsPath);
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        const filePath = join(draftsPath, entry);
        const fileStat = await stat(filePath);
        const id = entry.replace(/\.md$/, "");

        // Get metadata from manifest or infer from filename
        const meta = manifest[id] || {};
        const type = meta.type || inferTypeFromFilename(id);
        const targetPath = meta.targetPath || inferTargetPath(id, type);
        const name = meta.name || formatDraftName(id);

        drafts.push({
          id,
          name,
          path: `.pi_tool/drafts/${entry}`,
          type,
          createdAt: meta.createdAt || fileStat.mtime.toISOString(),
          targetPath,
        });
      }
    }
  } catch {
    // drafts folder doesn't exist yet
  }

  // Sort by creation date, newest first
  drafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return c.json({ drafts });
});

// Helper functions for draft metadata inference
function inferTypeFromFilename(id: string): string {
  if (id.includes("demand")) return "demand";
  if (id.includes("memo")) return "memo";
  if (id.includes("settlement")) return "settlement";
  if (
    id.includes("decision_and_order") ||
    id.includes("decision_order") ||
    id.includes("decision & order") ||
    id.includes("d&o") ||
    id.includes("decision") ||
    id.includes("dao")
  ) {
    return "hearing_decision";
  }
  // Letter types: Bill HI, LOR, correspondence letters
  if (id.includes("bill_hi") || id.includes("lor") ||
      id.includes("letter_of_representation") || id.includes("letter")) return "letter";
  return "document";
}

function inferTargetPath(id: string, type: string): string {
  switch (type) {
    case "demand":
      return "3P/3P Demand.pdf";
    case "settlement":
      return "Settlement/Settlement Memo.pdf";
    case "memo":
      return ".pi_tool/case_memo.pdf";
    case "hearing_decision":
      return "Litigation/Decision and Order.pdf";
    default:
      return `${id}.pdf`;
  }
}

function formatDraftName(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Approve a draft - export to PDF and delete the draft
app.post("/approve", async (c) => {
  const {
    caseFolder,
    draftPath,
    targetPath,
    format = "pdf",
    firmRoot,
    caseName,
    showLetterhead,
    showPageNumbers,
  } = await c.req.json();

  if (!caseFolder || !draftPath) {
    return c.json({ error: "caseFolder and draftPath required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const fullDraftPath = join(caseFolder, draftPath);

  try {
    // 1. Read markdown content
    const content = await readFile(fullDraftPath, "utf-8");

    // 2. Determine output path
    const outputPath =
      targetPath || draftPath.replace(/\.md$/, `.${format}`).replace(".pi_tool/drafts/", "");
    const fullOutputPath = join(caseFolder, outputPath);

    // 3. Infer document type and load firm info
    const documentType = inferTypeFromPath(draftPath);
    const firmInfoRoot = firmRoot || dirname(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    const clientName = await resolveCaseName(caseFolder, caseName);

    // 4. Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Build export options
    // Show letterhead for demands and letters by default
    const shouldShowLetterhead = showLetterhead ?? (documentType === "demand" || documentType === "letter");
    const exportOptions: ExportOptions = {
      documentType,
      firmInfo: firmInfo || undefined,
      caseName: clientName,
      showLetterhead: shouldShowLetterhead,
      showPageNumbers: showPageNumbers ?? documentType !== "memo",
      templateStyles,
    };

    // 5. Ensure output directory exists
    await mkdir(dirname(fullOutputPath), { recursive: true });

    // 6. Convert and save
    if (format === "docx") {
      const html = markdownToHtml(content, exportOptions);
      const nameWithoutExt = basename(outputPath).replace(/\.[^/.]+$/, "");
      const docxBuffer = await htmlToDocx(html, nameWithoutExt, {
        documentType,
        firmInfo: firmInfo || undefined,
        showLetterhead: shouldShowLetterhead,
      });
      await writeFile(fullOutputPath, docxBuffer);
    } else {
      const nameWithoutExt = basename(outputPath).replace(/\.[^/.]+$/, "");
      const pdfBuffer = documentType === "hearing_decision"
        ? await markdownToHearingDecisionPdf(content, nameWithoutExt, exportOptions)
        : await htmlToPdf(markdownToHtml(content, exportOptions), nameWithoutExt, exportOptions);
      await writeFile(fullOutputPath, pdfBuffer);
    }

    // 7. Keep the draft file for reference (don't delete)
    // The markdown source is preserved for future edits or reference

    // 8. Update manifest to mark this draft as approved
    const manifestPath = join(caseFolder, ".pi_tool", "drafts", "manifest.json");
    try {
      const manifestContent = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      const draftId = basename(draftPath).replace(/\.md$/, "");
      if (manifest[draftId]) {
        manifest[draftId].status = "approved";
        manifest[draftId].approvedAt = new Date().toISOString();
        manifest[draftId].exportedTo = outputPath;
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      // No manifest or couldn't update - that's fine
    }

    return c.json({
      success: true,
      outputPath,
      fullPath: fullOutputPath,
      message: `Approved and exported to ${outputPath}`,
    });
  } catch (err) {
    console.error("Approve error:", err);
    return c.json({ error: `Approve failed: ${err}` }, 500);
  }
});

// Exhibit interface for demand manifest
interface Exhibit {
  path: string;
  date?: string;
  description?: string;
}

// Scan a PDF for likely DOB/SSN locations.
// Non-blocking by design: returns findings/warnings only.
app.post("/scan-pii", async (c) => {
  const { caseFolder, path } = await c.req.json();

  if (!caseFolder || typeof path !== "string" || !path.trim()) {
    return c.json({ error: "caseFolder and path are required" }, 400);
  }

  if (!path.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "PII scan only supports PDF files" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const relativePath = normalizeRelativePath(path);

  try {
    const fullPath = resolveCasePath(caseFolder, relativePath);
    const scan = await scanPdfForSensitiveData(fullPath, relativePath);

    const pdfBytes = await readFile(fullPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const boxes = scan.boxes
      .map((item) => {
        const page = pdf.getPage(item.page - 1);
        if (!page) return null;
        const { width, height } = page.getSize();
        if (width <= 0 || height <= 0) return null;
        return {
          page: item.page,
          kind: item.kind,
          preview: item.preview,
          xPct: clamp01(item.xMin / width),
          yPct: clamp01(item.yMin / height),
          widthPct: clamp01((item.xMax - item.xMin) / width),
          heightPct: clamp01((item.yMax - item.yMin) / height),
        };
      })
      .filter((box): box is {
        page: number;
        kind: "dob" | "ssn";
        preview: string;
        xPct: number;
        yPct: number;
        widthPct: number;
        heightPct: number;
      } => Boolean(box));

    return c.json({
      success: true,
      path: relativePath,
      findings: scan.findings,
      warnings: scan.warnings,
      boxes,
      pages: Array.from(new Set(scan.findings.map((finding) => finding.page))).sort((a, b) => a - b),
      totalFindings: scan.findings.length,
    });
  } catch (err) {
    console.error("scan-pii error:", err);
    return c.json({ error: `PII scan failed: ${err}` }, 500);
  }
});

// Apply user-drawn redaction rectangles and save a redacted copy.
app.post("/redact-pdf-manual", async (c) => {
  const { caseFolder, path, boxes, outputPath } = await c.req.json();

  if (!caseFolder || typeof path !== "string" || !path.trim()) {
    return c.json({ error: "caseFolder and path are required" }, 400);
  }
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return c.json({ error: "boxes[] is required" }, 400);
  }
  if (!path.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "Manual redaction only supports PDF files" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const relativePath = normalizeRelativePath(path);

  const normalizedBoxes: EvidencePacketManualRedactionBox[] = boxes
    .map((item: any) => ({
      page: typeof item?.page === "number" ? item.page : Number(item?.page),
      xPct: typeof item?.xPct === "number" ? item.xPct : Number(item?.xPct),
      yPct: typeof item?.yPct === "number" ? item.yPct : Number(item?.yPct),
      widthPct: typeof item?.widthPct === "number" ? item.widthPct : Number(item?.widthPct),
      heightPct: typeof item?.heightPct === "number" ? item.heightPct : Number(item?.heightPct),
    }))
    .filter((item) =>
      Number.isFinite(item.page) &&
      Number.isFinite(item.xPct) &&
      Number.isFinite(item.yPct) &&
      Number.isFinite(item.widthPct) &&
      Number.isFinite(item.heightPct) &&
      item.page >= 1 &&
      item.widthPct > 0 &&
      item.heightPct > 0
    );

  if (normalizedBoxes.length === 0) {
    return c.json({ error: "No valid redaction boxes were provided" }, 400);
  }

  const baseName = basename(relativePath, ".pdf");
  const defaultOutputPath = normalizeRelativePath(
    join(dirname(relativePath), `${baseName} - REDACTED.pdf`)
  );
  const resolvedOutputPath = typeof outputPath === "string" && outputPath.trim()
    ? normalizeRelativePath(outputPath)
    : defaultOutputPath;

  if (!resolvedOutputPath.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "outputPath must be a PDF path" }, 400);
  }
  if (resolvedOutputPath.toLowerCase() === relativePath.toLowerCase()) {
    return c.json({ error: "outputPath must be different from source path" }, 400);
  }

  try {
    const fullInputPath = resolveCasePath(caseFolder, relativePath);
    const fullOutputPath = resolveCasePath(caseFolder, resolvedOutputPath);

    const inputBytes = await readFile(fullInputPath);
    const redactedBytes = await applyManualRedactionBoxes(inputBytes, normalizedBoxes);

    await mkdir(dirname(fullOutputPath), { recursive: true });
    await writeFile(fullOutputPath, redactedBytes);

    return c.json({
      success: true,
      sourcePath: relativePath,
      outputPath: resolvedOutputPath,
      fullPath: fullOutputPath,
      boxesApplied: normalizedBoxes.length,
    });
  } catch (err) {
    console.error("redact-pdf-manual error:", err);
    return c.json({ error: `Manual redaction failed: ${err}` }, 500);
  }
});

// Build a hearing/appeal evidence packet with:
// - pleading-paper front matter (index + affirmation/service page)
// - deterministic document ordering
// - merged PDF exhibits with page labels
// - optional DOB/SSN detection/redaction
app.post("/bundle-evidence-packet", async (c) => {
  const {
    caseFolder,
    documents,
    caption,
    orderRules,
    redaction,
    service,
    includeAffirmationPage,
    pageStampPrefix,
    pageStampStart,
    outputPath = "Litigation/Claimant Evidence Packet.pdf",
    firmBlockLines,
  } = await c.req.json();

  if (!caseFolder || !Array.isArray(documents) || documents.length === 0) {
    return c.json({ error: "caseFolder and documents[] are required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  let claimantName = caption?.claimantName as string | undefined;
  if (!claimantName) {
    try {
      const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const documentIndex = JSON.parse(indexContent);
      claimantName = documentIndex?.summary?.client;
    } catch {
      // no-op
    }
  }

  if (!claimantName) {
    return c.json({
      error: "caption.claimantName is required (or .pi_tool/document_index.json must contain summary.client)",
    }, 400);
  }

  const normalizedDocuments: EvidencePacketDocumentInput[] = [];
  for (const raw of documents as any[]) {
    if (!raw || typeof raw.path !== "string") {
      return c.json({ error: "Each document must include a string path" }, 400);
    }

    const title = typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : basename(raw.path);

    normalizedDocuments.push({
      path: raw.path,
      title,
      date: typeof raw.date === "string" ? raw.date : undefined,
      docType: typeof raw.docType === "string" ? raw.docType : undefined,
      include: typeof raw.include === "boolean" ? raw.include : true,
    });
  }

  const normalizedRules: EvidencePacketOrderRule[] | undefined = Array.isArray(orderRules)
    ? orderRules
      .filter((rule: any) => rule && typeof rule.id === "string")
      .map((rule: any) => ({
        id: rule.id,
        required: Boolean(rule.required),
        match: rule.match,
        sortBy: rule.sortBy,
        sortDirection: rule.sortDirection,
      }))
    : undefined;

  let resolvedFirmBlockLines: string[] | undefined = Array.isArray(firmBlockLines)
    ? firmBlockLines.filter((line: any) => typeof line === "string" && line.trim())
    : undefined;

  if (!resolvedFirmBlockLines || resolvedFirmBlockLines.length === 0) {
    try {
      const firmInfo = await loadFirmInfo(dirname(caseFolder));
      if (firmInfo) {
        resolvedFirmBlockLines = [
          firmInfo.firmName,
          firmInfo.address,
          `${firmInfo.city || ""}${firmInfo.city && firmInfo.state ? ", " : ""}${firmInfo.state || ""} ${firmInfo.zip || ""}`.trim(),
          firmInfo.phone,
        ].filter((line): line is string => Boolean(line && line.trim()));
      }
    } catch {
      // no-op
    }
  }

  try {
    const result = await buildEvidencePacket({
      caseFolder,
      documents: normalizedDocuments,
      caption: {
        claimantName,
        claimNumber: caption?.claimNumber,
        hearingNumber: caption?.hearingNumber,
        hearingDateTime: caption?.hearingDateTime,
        appearance: caption?.appearance,
        introductoryCounselLine: caption?.introductoryCounselLine,
      },
      orderRules: normalizedRules,
      redaction,
      service,
      includeAffirmationPage: includeAffirmationPage !== false,
      pageStampPrefix: typeof pageStampPrefix === "string" ? pageStampPrefix : undefined,
      pageStampStart: typeof pageStampStart === "number" ? pageStampStart : undefined,
      firmBlockLines: resolvedFirmBlockLines,
    });

    const fullOutputPath = join(caseFolder, outputPath);
    await mkdir(dirname(fullOutputPath), { recursive: true });
    await writeFile(fullOutputPath, result.pdfBytes);

    return c.json({
      success: true,
      outputPath,
      fullPath: fullOutputPath,
      totalPages: result.totalPages,
      tocEntries: result.tocEntries,
      orderedDocuments: result.orderedDocuments,
      warnings: result.warnings,
      redactionFindings: result.redactionFindings,
    });
  } catch (err) {
    console.error("bundle-evidence-packet error:", err);
    return c.json({ error: `Evidence packet build failed: ${err}` }, 500);
  }
});

// Bundle demand letter with exhibits into a single PDF package
app.post("/bundle-demand", async (c) => {
  const { caseFolder, firmRoot } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const warnings: string[] = [];

  try {
    // 1. Read the manifest from .pi_tool/drafts/manifest.json
    const manifestPath = join(caseFolder, ".pi_tool", "drafts", "manifest.json");
    let manifest: Record<string, any>;
    try {
      const manifestContent = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestContent);
    } catch (err) {
      return c.json({
        error: "Demand manifest not found. Please run /draft-demand first to generate the manifest.",
      }, 404);
    }

    // 2. Find the demand letter entry in the manifest
    const demandEntry = manifest["demand_letter"];
    if (!demandEntry) {
      return c.json({
        error: "No demand letter found in manifest. Please run /draft-demand first.",
      }, 404);
    }

    // 3. Read the demand letter markdown
    const demandLetterPath = join(caseFolder, ".pi_tool", "drafts", "demand_letter.md");
    let demandContent: string;
    try {
      demandContent = await readFile(demandLetterPath, "utf-8");
    } catch (err) {
      return c.json({
        error: "Demand letter markdown not found at .pi_tool/drafts/demand_letter.md",
      }, 404);
    }

    // 4. Convert demand letter to PDF using existing export logic
    const firmInfoRoot = firmRoot || dirname(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Try to get client name from document index
    let clientName: string | undefined;
    try {
      const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
      const indexContent = await readFile(indexPath, "utf-8");
      const documentIndex = JSON.parse(indexContent);
      clientName = documentIndex?.summary?.client;
    } catch {
      // No index, that's fine
    }

    const exportOptions: ExportOptions = {
      documentType: "demand",
      firmInfo: firmInfo || undefined,
      caseName: clientName,
      showLetterhead: true,
      showPageNumbers: true,
      templateStyles,
    };

    const demandHtml = markdownToHtml(demandContent, exportOptions);
    const demandPdfBuffer = await htmlToPdf(demandHtml, "demand_letter", exportOptions);

    // 5. Create the merged PDF document
    const mergedPdf = await PDFDocument.create();

    // 6. Add demand letter pages
    const demandPdf = await PDFDocument.load(demandPdfBuffer);
    const demandPages = await mergedPdf.copyPages(demandPdf, demandPdf.getPageIndices());
    for (const page of demandPages) {
      mergedPdf.addPage(page);
    }

    // 7. Create separator page with "EXHIBITS" header
    const separatorPage = mergedPdf.addPage([612, 792]); // Letter size
    const font = await mergedPdf.embedFont(StandardFonts.TimesRomanBold);
    const fontSize = 24;
    const text = "EXHIBITS";
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    separatorPage.drawText(text, {
      x: (612 - textWidth) / 2,
      y: 792 / 2 + 50,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    // Add a line below the header
    separatorPage.drawLine({
      start: { x: 156, y: 792 / 2 + 30 },
      end: { x: 456, y: 792 / 2 + 30 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    // 8. Load and append each exhibit PDF
    const exhibits: Exhibit[] = demandEntry.exhibits || [];
    const loadedExhibits: string[] = [];
    const missingExhibits: string[] = [];

    for (const exhibit of exhibits) {
      const exhibitPath = join(caseFolder, exhibit.path);
      try {
        const exhibitBuffer = await readFile(exhibitPath);

        // Only process PDF files
        if (!exhibit.path.toLowerCase().endsWith(".pdf")) {
          warnings.push(`Skipping non-PDF exhibit: ${exhibit.path}`);
          continue;
        }

        const exhibitPdf = await PDFDocument.load(exhibitBuffer);
        const exhibitPages = await mergedPdf.copyPages(exhibitPdf, exhibitPdf.getPageIndices());
        for (const page of exhibitPages) {
          mergedPdf.addPage(page);
        }
        loadedExhibits.push(exhibit.description || exhibit.path);
      } catch (err) {
        missingExhibits.push(exhibit.path);
        warnings.push(`Missing exhibit file: ${exhibit.path}`);
      }
    }

    // 9. Save the merged PDF
    const outputPath = "3P/3P Demand Package.pdf";
    const fullOutputPath = join(caseFolder, outputPath);
    await mkdir(dirname(fullOutputPath), { recursive: true });

    const mergedPdfBytes = await mergedPdf.save();
    await writeFile(fullOutputPath, mergedPdfBytes);

    // 10. Return the PDF for download
    const finalPdfBuffer = Buffer.from(mergedPdfBytes);

    c.header("Content-Type", "application/pdf");
    c.header(
      "Content-Disposition",
      `attachment; filename="3P Demand Package.pdf"`
    );

    // Log summary
    console.log(`[Bundle] Created demand package at ${fullOutputPath}`);
    console.log(`[Bundle] Total pages: ${mergedPdf.getPageCount()}`);
    console.log(`[Bundle] Exhibits included: ${loadedExhibits.length}`);
    if (missingExhibits.length > 0) {
      console.log(`[Bundle] Missing exhibits: ${missingExhibits.join(", ")}`);
    }

    return c.body(finalPdfBuffer);
  } catch (err) {
    console.error("Bundle demand error:", err);
    return c.json({ error: `Bundle failed: ${err}` }, 500);
  }
});

// Get bundle status - check if manifest and demand letter exist
app.get("/bundle-status", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    // Check for manifest
    const manifestPath = join(caseFolder, ".pi_tool", "drafts", "manifest.json");
    let manifest: Record<string, any> | null = null;
    let hasManifest = false;
    try {
      const manifestContent = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestContent);
      hasManifest = true;
    } catch {
      // No manifest
    }

    // Check for demand letter entry with exhibits
    const demandEntry = manifest?.["demand_letter"];
    const hasDemandLetter = !!demandEntry;
    const hasExhibits = Array.isArray(demandEntry?.exhibits) && demandEntry.exhibits.length > 0;

    // Check for demand letter markdown file
    const demandLetterPath = join(caseFolder, ".pi_tool", "drafts", "demand_letter.md");
    let hasDemandFile = false;
    try {
      await stat(demandLetterPath);
      hasDemandFile = true;
    } catch {
      // File doesn't exist
    }

    // Check which exhibit files exist
    const exhibits: Exhibit[] = demandEntry?.exhibits || [];
    const existingExhibits: string[] = [];
    const missingExhibits: string[] = [];

    for (const exhibit of exhibits) {
      const exhibitPath = join(caseFolder, exhibit.path);
      try {
        await stat(exhibitPath);
        existingExhibits.push(exhibit.path);
      } catch {
        missingExhibits.push(exhibit.path);
      }
    }

    return c.json({
      canBundle: hasManifest && hasDemandLetter && hasDemandFile && hasExhibits,
      hasManifest,
      hasDemandLetter,
      hasDemandFile,
      hasExhibits,
      exhibitCount: exhibits.length,
      existingExhibitCount: existingExhibits.length,
      missingExhibits,
    });
  } catch (err) {
    console.error("Bundle status error:", err);
    return c.json({ error: `Status check failed: ${err}` }, 500);
  }
});

export default app;
