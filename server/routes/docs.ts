import { Hono } from "hono";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, basename } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { markdownToHtml, htmlToDocx, htmlToPdf } from "../lib/export";

const execAsync = promisify(exec);

const app = new Hono();

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
  const { caseFolder, sourcePath, format, targetPath, openAfter } = await c.req.json();

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

    const html = markdownToHtml(content);

    if (format === "docx") {
      const docxBuffer = await htmlToDocx(html, nameWithoutExt);
      await writeFile(fullOutputPath, docxBuffer);
    } else {
      const pdfBuffer = await htmlToPdf(html, nameWithoutExt);
      await writeFile(fullOutputPath, pdfBuffer);
    }

    // Auto-open in default application if requested
    if (openAfter) {
      try {
        // Cross-platform open command
        const platform = process.platform;
        let openCmd: string;

        if (platform === 'darwin') {
          openCmd = `open "${fullOutputPath}"`;
        } else if (platform === 'win32') {
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
      message: `Exported ${sourcePath} to ${outputPath}${openAfter ? ' and opened in default application' : ''}`
    });
  } catch (err) {
    console.error("Export error:", err);
    return c.json({ error: `Export failed: ${err}` }, 500);
  }
});

// Download endpoint (returns file with download headers)
app.get("/download", async (c) => {
  const caseFolder = c.req.query("case");
  const docPath = c.req.query("path");
  const format = c.req.query("format") || "md";

  if (!caseFolder || !docPath) {
    return c.json({ error: "case and path query params required" }, 400);
  }

  const fullPath = join(caseFolder, docPath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const rawFilename = docPath.split("/").pop() || "document.md";
    const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "");

    switch (format) {
      case "docx": {
        const html = markdownToHtml(content);
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
        const html = markdownToHtml(content);
        const pdfBuffer = await htmlToPdf(html, nameWithoutExt);
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

export default app;
