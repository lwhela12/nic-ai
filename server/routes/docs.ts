import { Hono } from "hono";
import { readdir, readFile, writeFile, mkdir, stat, unlink } from "fs/promises";
import { join, dirname, basename } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import {
  markdownToHtml,
  htmlToDocx,
  htmlToPdf,
  loadFirmInfo,
  ExportOptions,
} from "../lib/export";
import type { DocxStyles } from "../lib/extract";

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

    // Load firm info if firmRoot provided (or try parent of caseFolder)
    const firmInfoRoot = firmRoot || dirname(caseFolder);
    const firmInfo = await loadFirmInfo(firmInfoRoot);

    // Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Build export options
    const exportOptions: ExportOptions = {
      documentType: inferredType,
      firmInfo: firmInfo || undefined,
      caseName,
      showLetterhead: showLetterhead ?? inferredType === "demand",
      showPageNumbers: showPageNumbers ?? inferredType !== "memo",
      templateStyles,
    };

    const html = markdownToHtml(content, exportOptions);

    if (format === "docx") {
      const docxBuffer = await htmlToDocx(html, nameWithoutExt);
      await writeFile(fullOutputPath, docxBuffer);
    } else {
      const pdfBuffer = await htmlToPdf(html, nameWithoutExt, exportOptions);
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

    const exportOptions: ExportOptions = {
      documentType,
      firmInfo: firmInfo || undefined,
      caseName: caseName || undefined,
      showLetterhead: showLetterhead && documentType === "demand",
      showPageNumbers: showPageNumbers && documentType !== "memo",
      templateStyles,
    };

    switch (format) {
      case "docx": {
        const html = markdownToHtml(content, exportOptions);
        const docxBuffer = await htmlToDocx(html, nameWithoutExt);
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
        const html = markdownToHtml(content, exportOptions);
        const pdfBuffer = await htmlToPdf(html, nameWithoutExt, exportOptions);
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

    // Try to get client name from document index for header
    let clientName = caseName;
    if (!clientName) {
      try {
        const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
        const indexContent = await readFile(indexPath, "utf-8");
        const documentIndex = JSON.parse(indexContent);
        clientName = documentIndex?.summary?.client;
      } catch {
        // No index, that's fine
      }
    }

    // 4. Load template styles if available
    const templateStyles = await loadTemplateStyles(firmInfoRoot);

    // Build export options
    const exportOptions: ExportOptions = {
      documentType,
      firmInfo: firmInfo || undefined,
      caseName: clientName,
      showLetterhead: showLetterhead ?? documentType === "demand",
      showPageNumbers: showPageNumbers ?? documentType !== "memo",
      templateStyles,
    };

    const html = markdownToHtml(content, exportOptions);

    // 5. Ensure output directory exists
    await mkdir(dirname(fullOutputPath), { recursive: true });

    // 6. Convert and save
    if (format === "docx") {
      const nameWithoutExt = basename(outputPath).replace(/\.[^/.]+$/, "");
      const docxBuffer = await htmlToDocx(html, nameWithoutExt);
      await writeFile(fullOutputPath, docxBuffer);
    } else {
      const nameWithoutExt = basename(outputPath).replace(/\.[^/.]+$/, "");
      const pdfBuffer = await htmlToPdf(html, nameWithoutExt, exportOptions);
      await writeFile(fullOutputPath, pdfBuffer);
    }

    // 7. Delete the draft file
    await unlink(fullDraftPath);

    // 8. Update manifest to remove this draft entry
    const manifestPath = join(caseFolder, ".pi_tool", "drafts", "manifest.json");
    try {
      const manifestContent = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      const draftId = basename(draftPath).replace(/\.md$/, "");
      delete manifest[draftId];
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

export default app;
