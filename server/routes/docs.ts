import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile, mkdir, stat, unlink } from "fs/promises";
import { join, dirname, basename, resolve, sep, extname } from "path";
import { resolveFirmRoot, getClientSlug, loadClientRegistry, scanAndBuildRegistry, resolveYearFilePath } from "../lib/year-mode";
import { exec } from "child_process";
import { promisify } from "util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  markdownToHtml,
  htmlToDocx,
  htmlToPdf,
  markdownToHearingDecisionPdf,
  loadFirmInfo,
} from "../lib/export";
import type { ExportOptions, ExportStyleProfile } from "../lib/export";
import type { DocxStyles } from "../lib/extract";
import { requireCaseAccess } from "../lib/team-access";
import {
  scanPdfForSensitiveData,
  applyManualRedactionBoxes,
  buildEvidencePacket,
  buildFrontMatterPreview,
  BUILT_IN_TEMPLATES,
  type PacketTemplate,
  type EvidencePacketManualRedactionBox,
  type EvidencePacketCaption,
  type EvidencePacketServiceInfo,
} from "../lib/evidence-packet";

const execAsync = promisify(exec);

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return _anthropic;
}

function isCourtCriticalDocumentType(documentType?: ExportOptions["documentType"]): boolean {
  return documentType === "letter" || documentType === "hearing_decision";
}

function resolveStyleProfile(
  documentType: ExportOptions["documentType"],
  requested?: unknown
): ExportStyleProfile {
  if (requested === "court_safe" || requested === "template" || requested === "auto") {
    if (requested !== "auto") return requested;
  }
  return isCourtCriticalDocumentType(documentType) ? "court_safe" : "template";
}

// Helper to load template styles from .ai_tool/template-styles.json
async function loadTemplateStyles(
  firmRoot: string,
  styleProfile: ExportStyleProfile
): Promise<DocxStyles | undefined> {
  if (styleProfile === "court_safe") {
    return undefined;
  }

  try {
    const stylesPath = join(firmRoot, ".ai_tool", "template-styles.json");
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
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
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

/**
 * Build a year-mode-aware path resolver for a case folder.
 * Returns a function that resolves relative doc paths to absolute paths.
 * For non-year-based cases, falls back to standard resolution.
 */
async function buildDocPathResolver(caseFolder: string): Promise<(relativePath: string) => string> {
  const slug = getClientSlug(caseFolder);
  if (slug) {
    const firmRoot = resolveFirmRoot(caseFolder);
    let registry = await loadClientRegistry(firmRoot);
    if (!registry) {
      registry = await scanAndBuildRegistry(firmRoot);
    }
    return (relativePath: string) => resolveYearFilePath(firmRoot, registry!, slug, relativePath);
  }
  return (relativePath: string) => resolveCasePath(caseFolder, relativePath);
}

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function normalizeComparablePath(path: string): string {
  return normalizeRelativePath(path)
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .toLowerCase();
}

function joinRelativePath(folderName: string, fileName: string): string {
  const folder = normalizeRelativePath(folderName);
  const file = normalizeRelativePath(fileName);
  if (!file) return "";
  if (!folder || folder === "." || folder.toLowerCase() === "root") return file;
  return `${folder}/${file}`;
}

function buildIndexedPathMaps(indexData: any): {
  byPath: Map<string, string>;
  byBasename: Map<string, string>;
  ambiguousBasenames: Set<string>;
} {
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string>();
  const ambiguousBasenames = new Set<string>();

  const folders = indexData?.folders;
  if (!folders || typeof folders !== "object") {
    return { byPath, byBasename, ambiguousBasenames };
  }

  const add = (path: string) => {
    const canonicalPath = normalizeRelativePath(path);
    const key = normalizeComparablePath(canonicalPath);
    if (!canonicalPath || !key) return;
    if (!byPath.has(key)) {
      byPath.set(key, canonicalPath);
    }
    const basename = normalizeComparablePath(canonicalPath.split("/").pop() || canonicalPath);
    if (!basename) return;
    if (!byBasename.has(basename)) {
      byBasename.set(basename, canonicalPath);
    } else if (byBasename.get(basename) !== canonicalPath) {
      ambiguousBasenames.add(basename);
    }
  };

  for (const [folderName, folderData] of Object.entries(folders)) {
    let files: any[] = [];
    if (Array.isArray(folderData)) {
      files = folderData;
    } else if (folderData && typeof folderData === "object") {
      const folderObj = folderData as any;
      if (Array.isArray(folderObj.files)) files = folderObj.files;
      else if (Array.isArray(folderObj.documents)) files = folderObj.documents;
    }

    for (const file of files) {
      if (typeof file === "string") {
        add(joinRelativePath(folderName, file));
        continue;
      }
      if (!file || typeof file !== "object") continue;
      const entryPath = typeof file.path === "string" ? normalizeRelativePath(file.path) : "";
      const entryFile = typeof file.filename === "string" ? file.filename : typeof file.file === "string" ? file.file : "";
      const canonicalPath =
        entryPath && entryPath.includes("/")
          ? entryPath
          : joinRelativePath(folderName, entryPath || entryFile);
      if (!canonicalPath) continue;
      add(canonicalPath);
    }
  }

  return { byPath, byBasename, ambiguousBasenames };
}

function canonicalizeDocumentPath(
  requestedPath: string,
  maps: { byPath: Map<string, string>; byBasename: Map<string, string>; ambiguousBasenames: Set<string> }
): string | null {
  const normalized = normalizeRelativePath(requestedPath);
  const byPathKey = normalizeComparablePath(normalized);
  const direct = maps.byPath.get(byPathKey);
  if (direct) return direct;

  const basename = normalizeComparablePath(normalized.split("/").pop() || normalized);
  if (basename && !maps.ambiguousBasenames.has(basename)) {
    return maps.byBasename.get(basename) || null;
  }

  return null;
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
  generatedAt?: string;
  outputPath?: string;
}

// List generated documents in .ai_tool and standard locations
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

  // Check .ai_tool folder
  const piToolPath = join(caseFolder, ".ai_tool");
  try {
    const entries = await readdir(piToolPath);
    for (const entry of entries) {
      if (entry.endsWith(".md") || entry.endsWith(".json")) {
        const content = await readFile(join(piToolPath, entry), "utf-8");
        docs.push({
          name: entry,
          path: join(".ai_tool", entry),
          fullPath: join(piToolPath, entry),
          type: entry.includes("memo") ? "memo" : entry.includes("index") ? "index" : "report",
          size: content.length,
        });
      }
    }
  } catch {
    // .ai_tool doesn't exist yet
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
    styleProfile,
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
    const resolvedStyleProfile = resolveStyleProfile(inferredType, styleProfile);
    console.log(`[Export] caseFolder=${caseFolder}, sourcePath=${sourcePath}, documentType=${inferredType}`);

    // Load firm info if firmRoot provided (or try parent of caseFolder)
    const firmInfoRoot = firmRoot || resolveFirmRoot(caseFolder);
    console.log(`[Export] firmInfoRoot=${firmInfoRoot} (firmRoot param=${firmRoot})`);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    // Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot, resolvedStyleProfile);

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
      styleProfile: resolvedStyleProfile,
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
  const styleProfile = c.req.query("styleProfile");

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
    const resolvedStyleProfile = resolveStyleProfile(documentType, styleProfile);
    const firmInfoRoot = firmRoot || resolveFirmRoot(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    // Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot, resolvedStyleProfile);

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
      styleProfile: resolvedStyleProfile,
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

// List drafts in .ai_tool/drafts/ folder
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
  const draftsPath = join(caseFolder, ".ai_tool", "drafts");

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
          path: `.ai_tool/drafts/${entry}`,
          type,
          createdAt: meta.createdAt || fileStat.mtime.toISOString(),
          targetPath,
        });
      } else if (entry.endsWith(".json") && entry.startsWith("packet-")) {
        // Packet creation mode drafts
        const filePath = join(draftsPath, entry);
        const fileStat = await stat(filePath);
        const id = entry.replace(/\.json$/, "");

        // Try to read draftName, generatedAt, outputPath from the JSON
        let draftName = "Evidence Packet Draft";
        let generatedAt: string | undefined;
        let outputPath: string | undefined;
        try {
          const jsonContent = await readFile(filePath, "utf-8");
          const parsed = JSON.parse(jsonContent);
          if (typeof parsed.draftName === "string" && parsed.draftName.trim()) {
            draftName = parsed.draftName;
          }
          if (typeof parsed.generatedAt === "string" && parsed.generatedAt.trim()) {
            generatedAt = parsed.generatedAt;
          }
          if (typeof parsed.outputPath === "string" && parsed.outputPath.trim()) {
            outputPath = parsed.outputPath;
          }
        } catch { /* ignore parse errors */ }

        drafts.push({
          id,
          name: draftName,
          path: `.ai_tool/drafts/${entry}`,
          type: "packet",
          createdAt: fileStat.mtime.toISOString(),
          targetPath: "Hearing/Evidence Packet.pdf",
          generatedAt,
          outputPath,
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
      return ".ai_tool/case_memo.pdf";
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
    styleProfile,
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
      targetPath || draftPath.replace(/\.md$/, `.${format}`).replace(".ai_tool/drafts/", "");
    const fullOutputPath = join(caseFolder, outputPath);

    // 3. Infer document type and load firm info
    const documentType = inferTypeFromPath(draftPath);
    const resolvedStyleProfile = resolveStyleProfile(documentType, styleProfile);
    const firmInfoRoot = firmRoot || resolveFirmRoot(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    const clientName = await resolveCaseName(caseFolder, caseName);

    // 4. Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot, resolvedStyleProfile);

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
      styleProfile: resolvedStyleProfile,
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
    const manifestPath = join(caseFolder, ".ai_tool", "drafts", "manifest.json");
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
    const resolvePath = await buildDocPathResolver(caseFolder);
    const fullPath = resolvePath(relativePath);
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
    const resolvePath = await buildDocPathResolver(caseFolder);
    const fullInputPath = resolvePath(relativePath);
    const fullOutputPath = resolvePath(resolvedOutputPath);

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
    // 1. Read the manifest from .ai_tool/drafts/manifest.json
    const manifestPath = join(caseFolder, ".ai_tool", "drafts", "manifest.json");
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
    const demandLetterPath = join(caseFolder, ".ai_tool", "drafts", "demand_letter.md");
    let demandContent: string;
    try {
      demandContent = await readFile(demandLetterPath, "utf-8");
    } catch (err) {
      return c.json({
        error: "Demand letter markdown not found at .ai_tool/drafts/demand_letter.md",
      }, 404);
    }

    // 4. Convert demand letter to PDF using existing export logic
    const firmInfoRoot = firmRoot || resolveFirmRoot(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Try to get client name from document index
    let clientName: string | undefined;
    try {
      const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
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
    const manifestPath = join(caseFolder, ".ai_tool", "drafts", "manifest.json");
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
    const demandLetterPath = join(caseFolder, ".ai_tool", "drafts", "demand_letter.md");
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

// --- Packet creation mode endpoints ---

// Save packet draft
app.post("/packet-draft", async (c) => {
  const { caseFolder, state } = await c.req.json();

  if (!caseFolder || !state) {
    return c.json({ error: "caseFolder and state required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const draftsDir = join(caseFolder, ".ai_tool", "drafts");
    await mkdir(draftsDir, { recursive: true });

    const draftId = state.draftId || `packet-${Date.now()}`;
    const draftPath = join(draftsDir, `${draftId}.json`);
    await writeFile(draftPath, JSON.stringify(state, null, 2), "utf-8");

    return c.json({ success: true, draftId });
  } catch (err) {
    console.error("packet-draft save error:", err);
    return c.json({ error: `Save failed: ${err}` }, 500);
  }
});

// Load packet draft
app.get("/packet-draft/:id", async (c) => {
  const caseFolder = c.req.query("case");
  const draftId = c.req.param("id");

  if (!caseFolder || !draftId) {
    return c.json({ error: "case query param and draft id required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const draftPath = join(caseFolder, ".ai_tool", "drafts", `${draftId}.json`);
    const content = await readFile(draftPath, "utf-8");
    return c.json(JSON.parse(content));
  } catch {
    return c.json({ error: "Draft not found" }, 404);
  }
});

// Duplicate a packet draft
app.post("/packet-draft/duplicate", async (c) => {
  const { caseFolder, draftId } = await c.req.json();

  if (!caseFolder || !draftId) {
    return c.json({ error: "caseFolder and draftId required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const sourcePath = join(caseFolder, ".ai_tool", "drafts", `${draftId}.json`);
    const content = await readFile(sourcePath, "utf-8");
    const state = JSON.parse(content);

    // Create new draft with fresh ID
    const newDraftId = `packet-${Date.now()}`;
    state.draftId = newDraftId;
    // Clear generation artifacts so the copy is a fresh working copy
    state.generatedAt = null;
    state.outputPath = null;
    // Append " (copy)" to the draft name
    if (typeof state.draftName === "string" && state.draftName.trim()) {
      state.draftName = `${state.draftName} (copy)`;
    } else {
      state.draftName = "Evidence Packet Draft (copy)";
    }

    const draftsDir = join(caseFolder, ".ai_tool", "drafts");
    await writeFile(join(draftsDir, `${newDraftId}.json`), JSON.stringify(state, null, 2), "utf-8");

    return c.json({ success: true, draftId: newDraftId });
  } catch {
    return c.json({ error: "Source draft not found" }, 404);
  }
});

// Delete a packet draft
app.delete("/packet-draft/:id", async (c) => {
  const caseFolder = c.req.query("case");
  const draftId = c.req.param("id");

  if (!caseFolder || !draftId) {
    return c.json({ error: "case query param and draft id required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const draftPath = join(caseFolder, ".ai_tool", "drafts", `${draftId}.json`);
    await unlink(draftPath);
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Draft not found" }, 404);
  }
});

// Preview front matter PDF
app.post("/preview-front-matter", async (c) => {
  const { caseFolder, frontMatter, documents, documentCount, firmRoot, templateId } = await c.req.json();

  if (!caseFolder || !frontMatter) {
    return c.json({ error: "caseFolder and frontMatter required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    // Build TOC entries from actual document data when available, else placeholders
    const docList: Array<{ title?: string; date?: string }> = Array.isArray(documents) ? documents : [];
    const entryCount = docList.length > 0 ? docList.length : (documentCount || 5);
    const placeholderEntries = [];
    for (let i = 0; i < entryCount; i++) {
      const d = docList[i];
      placeholderEntries.push({
        title: d?.title || `Document ${i + 1}`,
        date: d?.date || undefined,
        startPage: i * 3 + 1,
        endPage: (i + 1) * 3,
      });
    }

    // If firmBlockLines are empty, try to build from firm config
    let firmBlockLines: string[] = Array.isArray(frontMatter.firmBlockLines) ? frontMatter.firmBlockLines : [];
    const hasNonEmptyLines = firmBlockLines.some((l: string) => typeof l === "string" && l.trim());
    if (!hasNonEmptyLines) {
      const configRoot = firmRoot || resolveFirmRoot(caseFolder);
      try {
        const configPath = join(configRoot, ".ai_tool", "firm-config.json");
        const configContent = await readFile(configPath, "utf-8");
        const config = JSON.parse(configContent);
        const built: string[] = [];
        if (config.attorneyName) built.push(config.attorneyName);
        if (config.nevadaBarNo) built.push(`NV Bar No. ${config.nevadaBarNo}`);
        if (config.firmName) built.push(config.firmName);
        if (config.address) built.push(config.address);
        if (config.cityStateZip) built.push(config.cityStateZip);
        if (config.phone) built.push(`Phone: ${config.phone}`);
        if (config.email) built.push(config.email);
        if (built.length > 0) firmBlockLines = built;
      } catch {
        // No firm config available, leave lines empty
      }
    }

    // Extract firmName from config for interpolation and signature block
    const configRoot = firmRoot || resolveFirmRoot(caseFolder);
    let firmNameValue = "";
    try {
      const configPath = join(configRoot, ".ai_tool", "firm-config.json");
      const configContent = await readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);
      firmNameValue = config?.firmName || "";
    } catch { /* no config */ }

    // Compute service date tokens for template interpolation
    const sDateRaw = frontMatter.serviceDate || new Date().toLocaleDateString("en-US");
    const sDate = new Date(sDateRaw);
    const serviceMonth = sDate.toLocaleString("en-US", { month: "long" });
    const serviceYear = String(sDate.getFullYear());

    const caption: EvidencePacketCaption = {
      claimantName: frontMatter.claimantName || "",
      claimNumber: frontMatter.claimNumber,
      hearingNumber: frontMatter.hearingNumber,
      hearingDateTime: frontMatter.hearingDateTime,
      appearance: frontMatter.appearance,
      introductoryCounselLine: frontMatter.introductoryCounselLine,
      captionValues: {
        ...frontMatter.captionValues,
        serviceMonth,
        serviceYear,
        firmName: firmNameValue,
      },
    };

    const service: EvidencePacketServiceInfo = {
      serviceDate: frontMatter.serviceDate,
      serviceMethod: frontMatter.serviceMethod ? `[x] ${frontMatter.serviceMethod}` : undefined,
      recipients: frontMatter.recipients,
    };

    // Load template if specified
    let template: PacketTemplate | undefined;
    if (templateId) {
      template = (await findTemplateById(configRoot, templateId)) ?? undefined;
    }

    const pdfBytes = await buildFrontMatterPreview({
      caption,
      firmBlockLines,
      service,
      tocEntries: placeholderEntries,
      includeAffirmationPage: true,
      template,
      signerName: frontMatter.signerName,
      extraSectionValues: frontMatter.extraSectionValues,
      firmName: firmNameValue,
    });

    // Write to .ai_tool so the preview can be served via GET /api/files/view
    // (blob URLs don't work with Electron's window.open pop-out on Windows)
    const piToolDir = join(caseFolder, ".ai_tool");
    await mkdir(piToolDir, { recursive: true });
    const previewPath = join(piToolDir, "front-matter-preview.pdf");
    await writeFile(previewPath, pdfBytes);

    const viewUrl = `/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(".ai_tool/front-matter-preview.pdf")}#view=FitH`;
    return c.json({ url: viewUrl });
  } catch (err) {
    console.error("preview-front-matter error:", err);
    return c.json({ error: `Preview failed: ${err}` }, 500);
  }
});

// Generate final evidence packet
app.post("/generate-packet", async (c) => {
  const { caseFolder, documents, frontMatter, redactionMode, firmRoot, templateId } = await c.req.json();

  if (!caseFolder || !documents || !frontMatter) {
    return c.json({ error: "caseFolder, documents, and frontMatter required" }, 400);
  }
  if (!Array.isArray(documents)) {
    return c.json({ error: "documents must be an array" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);
    const maps = buildIndexedPathMaps(indexData);

    const unresolvedPaths: string[] = [];
    const canonicalDocuments = (documents as any[])
      .map((d: any) => {
        const requestedPath = typeof d?.path === "string" ? d.path : "";
        const canonicalPath = canonicalizeDocumentPath(requestedPath, maps);
        if (!canonicalPath) {
          if (requestedPath.trim()) unresolvedPaths.push(requestedPath);
          return null;
        }
        return {
          path: canonicalPath,
          title: d?.title || "",
          date: d?.date || undefined,
          docType: d?.docType || d?.type || undefined,
          include: d?.include !== false,
        };
      })
      .filter((d): d is { path: string; title: string; date?: string; docType?: string; include: boolean } => Boolean(d));

    if (unresolvedPaths.length > 0) {
      return c.json({
        error: "Some selected documents could not be resolved from the current index. Refresh the packet selections and try again.",
        invalidPaths: unresolvedPaths,
      }, 400);
    }

    if (canonicalDocuments.length === 0) {
      return c.json({ error: "None of the selected documents matched indexed files" }, 400);
    }

    // Extract firmName from config for interpolation and signature block
    const configRoot = firmRoot || resolveFirmRoot(caseFolder);
    let firmNameValue = "";
    try {
      const configPath = join(configRoot, ".ai_tool", "firm-config.json");
      const configContent = await readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);
      firmNameValue = config?.firmName || "";
    } catch { /* no config */ }

    // Compute service date tokens for template interpolation
    const sDateRaw = frontMatter.serviceDate || new Date().toLocaleDateString("en-US");
    const sDate = new Date(sDateRaw);
    const serviceMonth = sDate.toLocaleString("en-US", { month: "long" });
    const serviceYear = String(sDate.getFullYear());

    const caption: EvidencePacketCaption = {
      claimantName: frontMatter.claimantName || "",
      claimNumber: frontMatter.claimNumber,
      hearingNumber: frontMatter.hearingNumber,
      hearingDateTime: frontMatter.hearingDateTime,
      appearance: frontMatter.appearance,
      introductoryCounselLine: frontMatter.introductoryCounselLine,
      captionValues: {
        ...frontMatter.captionValues,
        serviceMonth,
        serviceYear,
        firmName: firmNameValue,
      },
    };

    const service: EvidencePacketServiceInfo = {
      serviceDate: frontMatter.serviceDate,
      serviceMethod: frontMatter.serviceMethod ? `[x] ${frontMatter.serviceMethod}` : undefined,
      recipients: frontMatter.recipients,
    };

    const resolveDocPath = await buildDocPathResolver(caseFolder);

    // Load template if specified
    let template: PacketTemplate | undefined;
    if (templateId || frontMatter.templateId) {
      template = (await findTemplateById(configRoot, templateId || frontMatter.templateId)) ?? undefined;
    }

    const result = await buildEvidencePacket({
      caseFolder,
      documents: canonicalDocuments,
      caption,
      redaction: redactionMode
        ? { enabled: true, mode: redactionMode }
        : undefined,
      service,
      includeAffirmationPage: true,
      firmBlockLines: frontMatter.firmBlockLines,
      resolveDocPath,
      template,
      signerName: frontMatter.signerName,
      extraSectionValues: frontMatter.extraSectionValues,
      firmName: firmNameValue,
    });

    // Determine output path
    const dateStr = new Date().toISOString().slice(0, 10);
    const outputRelPath = `Evidence Packet - ${dateStr}.pdf`;
    const fullOutputPath = join(caseFolder, outputRelPath);
    await mkdir(dirname(fullOutputPath), { recursive: true });
    await writeFile(fullOutputPath, result.pdfBytes);

    // Auto-save state as a draft for future reference
    try {
      const draftsDir = join(caseFolder, ".ai_tool", "drafts");
      await mkdir(draftsDir, { recursive: true });
      const draftId = `packet-${Date.now()}`;
      await writeFile(
        join(draftsDir, `${draftId}.json`),
        JSON.stringify({ documents: canonicalDocuments, frontMatter, generatedAt: new Date().toISOString(), outputPath: outputRelPath }, null, 2),
        "utf-8"
      );
    } catch { /* ignore draft save errors */ }

    return c.json({
      success: true,
      outputPath: outputRelPath,
      totalPages: result.totalPages,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error("generate-packet error:", err);
    return c.json({ error: `Generation failed: ${err}` }, 500);
  }
});

// Batch PII scan for multiple documents
app.post("/batch-scan-pii", async (c) => {
  const { caseFolder, paths } = await c.req.json();

  if (!caseFolder || !Array.isArray(paths) || paths.length === 0) {
    return c.json({ error: "caseFolder and paths[] required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);
    const maps = buildIndexedPathMaps(indexData);
    const resolvePath = await buildDocPathResolver(caseFolder);

    const results = await Promise.all(
      paths.map(async (relativePath: string) => {
        const requestedPath = normalizeRelativePath(relativePath);
        const normalized = canonicalizeDocumentPath(requestedPath, maps) || requestedPath;
        if (!normalized.toLowerCase().endsWith(".pdf")) {
          return { path: normalized, findings: [], approved: true };
        }
        try {
          const fullPath = resolvePath(normalized);
          const scan = await scanPdfForSensitiveData(fullPath, normalized);
          return {
            path: normalized,
            findings: scan.findings.map(f => ({
              page: f.page,
              kind: f.kind,
              preview: f.preview,
            })),
            approved: false,
          };
        } catch {
          return { path: normalized, findings: [], approved: true };
        }
      })
    );

    return c.json({ results });
  } catch (err) {
    console.error("batch-scan-pii error:", err);
    return c.json({ error: `Batch scan failed: ${err}` }, 500);
  }
});

// ============================================================================
// PACKET TEMPLATE ENDPOINTS
// ============================================================================

async function findTemplateById(firmRoot: string, id: string): Promise<PacketTemplate | null> {
  // 1. Check built-in templates
  const builtIn = BUILT_IN_TEMPLATES.find(t => t.id === id);
  if (builtIn) return builtIn;

  // 2. Check doc-templates index for auto-detected packet templates
  try {
    const indexPath = join(firmRoot, ".ai_tool", "templates", "templates.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    const entry = (index.templates || []).find(
      (t: any) => {
        if (t.type !== "packet" || !t.packetConfig) return false;
        if (t.id === id || t.packetConfig.id === id) return true;
        return Array.isArray(t.packetConfig.legacyPacketIds)
          && t.packetConfig.legacyPacketIds.includes(id);
      }
    );
    if (entry?.packetConfig) return entry.packetConfig;
  } catch {
    // No index or parse error
  }

  return null;
}

// Generate an "Issue on Appeal" statement from case data
app.post("/generate-issue", async (c) => {
  const { caseFolder, hearingNumber } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  // Load document index for case context
  let indexData: any;
  try {
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    indexData = JSON.parse(indexContent);
  } catch {
    return c.json({ error: "Case has not been indexed yet" }, 404);
  }

  const summary = indexData?.summary || {};
  const contextParts: string[] = [];
  if (summary.client) contextParts.push(`Claimant: ${summary.client}`);
  if (summary.injury_date) contextParts.push(`Date of Injury: ${summary.injury_date}`);
  if (summary.employer) contextParts.push(`Employer: ${summary.employer}`);
  if (summary.body_parts) contextParts.push(`Body Parts: ${Array.isArray(summary.body_parts) ? summary.body_parts.join(", ") : summary.body_parts}`);
  if (summary.case_phase) contextParts.push(`Case Phase: ${summary.case_phase}`);
  if (hearingNumber) contextParts.push(`Hearing/Appeal Number: ${hearingNumber}`);
  if (summary.reconciled) {
    const rec = summary.reconciled;
    if (rec.accepted_conditions) contextParts.push(`Accepted Conditions: ${Array.isArray(rec.accepted_conditions) ? rec.accepted_conditions.join(", ") : rec.accepted_conditions}`);
    if (rec.denied_conditions) contextParts.push(`Denied Conditions: ${Array.isArray(rec.denied_conditions) ? rec.denied_conditions.join(", ") : rec.denied_conditions}`);
    if (rec.disputed_issues) contextParts.push(`Disputed Issues: ${Array.isArray(rec.disputed_issues) ? rec.disputed_issues.join(", ") : rec.disputed_issues}`);
  }

  const caseContext = contextParts.join("\n");

  const prompt = `You are a workers' compensation legal assistant. Based on the following case data, write a concise 1-2 sentence "Issue on Appeal" statement in the standard "Whether..." format used in Nevada workers' compensation hearings.

CASE DATA:
${caseContext}

Return ONLY the issue statement, nothing else. Do not include quotes around it.`;

  try {
    const response = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return c.json({ error: "No response from model" }, 500);
    }

    // Strip surrounding quotes if present
    let issue = textBlock.text.trim();
    if ((issue.startsWith('"') && issue.endsWith('"')) || (issue.startsWith("'") && issue.endsWith("'"))) {
      issue = issue.slice(1, -1).trim();
    }

    return c.json({ success: true, issue });
  } catch (err) {
    console.error("generate-issue error:", err);
    return c.json({ error: `Generation failed: ${err}` }, 500);
  }
});

export default app;
