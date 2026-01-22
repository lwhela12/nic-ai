import { Hono } from "hono";
import { readdir, stat, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

const app = new Hono();

// Browse directories for folder picker
app.get("/browse", async (c) => {
  const dir = c.req.query("dir") || homedir();

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: join(dir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      current: dir,
      parent: dirname(dir),
      folders,
    });
  } catch (error) {
    return c.json({ error: "Could not read directory" }, 500);
  }
});

// List case folders in a directory
app.get("/cases", async (c) => {
  const baseDir = c.req.query("dir");

  if (!baseDir) {
    return c.json({ error: "dir query param required" }, 400);
  }

  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: join(baseDir, e.name),
      }));

    return c.json({ folders });
  } catch (error) {
    return c.json({ error: "Could not read directory" }, 500);
  }
});

// Get document index for a case
app.get("/index", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  try {
    const content = await readFile(indexPath, "utf-8");
    return c.json(JSON.parse(content));
  } catch (error) {
    return c.json({ error: "No document index found. Run /init-case first." }, 404);
  }
});

// Check if index needs refresh (new/modified files)
app.get("/index-status", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  // Get all current files
  async function getAllFiles(dir: string, base: string = ""): Promise<{ path: string; mtime: number }[]> {
    const files: { path: string; mtime: number }[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        const relativePath = base ? join(base, entry.name) : entry.name;

        if (entry.isDirectory()) {
          const subFiles = await getAllFiles(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          const stats = await stat(fullPath);
          files.push({ path: relativePath, mtime: stats.mtimeMs });
        }
      }
    } catch {
      // Ignore errors
    }
    return files;
  }

  const currentFiles = await getAllFiles(caseFolder);

  // Helper to normalize paths (strip ./ prefix)
  const normalizePath = (p: string) => p.replace(/^\.\//, "");

  // Normalize filenames for comparison (collapse multiple spaces, trim space before extension)
  const normalizeFilename = (p: string) => {
    return p
      .replace(/\s+/g, ' ')           // Collapse multiple spaces to single
      .replace(/\s+\./g, '.')          // Remove space before dot (extension)
      .trim();
  };

  // Try to load existing index
  let index: any = null;
  let indexedAt: number = 0;
  let indexedFiles: Set<string> = new Set();

  try {
    const content = await readFile(indexPath, "utf-8");
    index = JSON.parse(content);

    // Use the index FILE's mtime as the reliable timestamp (not the JSON date which can be wrong)
    const indexStats = await stat(indexPath);
    indexedAt = indexStats.mtimeMs;

    // Collect all indexed file paths (build full path from folder + filename)
    if (index.folders) {
      for (const [folderName, folderData] of Object.entries(index.folders)) {
        // Handle both formats: direct array or {files: [...]} object
        let docs: any[] = [];
        if (Array.isArray(folderData)) {
          docs = folderData;
        } else if (folderData && typeof folderData === 'object' && Array.isArray((folderData as any).files)) {
          docs = (folderData as any).files;
        }

        for (const doc of docs) {
          // Handle both 'file' and 'filename' property names
          const fileName = doc.file || doc.filename;
          if (fileName) {
            // Build full relative path: "Intake/Intake.pdf" (normalized for comparison)
            const fullPath = normalizeFilename(join(normalizePath(folderName), fileName));
            indexedFiles.add(fullPath);
          }
        }
      }
    }
    // Also check files_indexed if present (array format from old index)
    if (Array.isArray(index.files_indexed)) {
      for (const f of index.files_indexed) {
        indexedFiles.add(normalizePath(f));
      }
    }
  } catch {
    // No index exists
    return c.json({
      needsIndex: true,
      reason: "no_index",
      newFiles: currentFiles.map((f) => f.path),
      modifiedFiles: [],
      message: "No index found. Click to index this case.",
    });
  }

  // Find new and modified files
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];

  for (const file of currentFiles) {
    const normalizedPath = normalizeFilename(file.path);
    if (!indexedFiles.has(normalizedPath)) {
      newFiles.push(file.path);
    } else if (file.mtime > indexedAt) {
      modifiedFiles.push(file.path);
    }
  }

  const needsIndex = newFiles.length > 0 || modifiedFiles.length > 0;

  return c.json({
    needsIndex,
    reason: needsIndex ? (newFiles.length > 0 ? "new_files" : "modified_files") : "up_to_date",
    newFiles,
    modifiedFiles,
    indexedAt: index.indexed_at,
    message: needsIndex
      ? `${newFiles.length} new, ${modifiedFiles.length} modified files since last index.`
      : "Index is up to date.",
  });
});

// Get case memo
app.get("/memo", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const memoPath = join(caseFolder, ".pi_tool", "case_memo.md");

  try {
    const content = await readFile(memoPath, "utf-8");
    return c.json({ content });
  } catch (error) {
    return c.json({ error: "No case memo found. Run /case-memo first." }, 404);
  }
});

// List all files in a case folder (for file viewer)
app.get("/list", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  async function walkDir(dir: string, base: string = ""): Promise<any[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: any[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = join(dir, entry.name);
      const relativePath = base ? join(base, entry.name) : entry.name;

      if (entry.isDirectory()) {
        const children = await walkDir(fullPath, relativePath);
        results.push({
          name: entry.name,
          type: "folder",
          path: relativePath,
          children,
        });
      } else {
        const stats = await stat(fullPath);
        results.push({
          name: entry.name,
          type: "file",
          path: relativePath,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }

    return results;
  }

  try {
    const tree = await walkDir(caseFolder);
    return c.json({ tree });
  } catch (error) {
    return c.json({ error: "Could not read case folder" }, 500);
  }
});

// Get content type for file - ensure PDFs and images always display inline
function getContentType(filename: string, bunType: string | undefined): string {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'txt': 'text/plain',
    'html': 'text/html',
    'json': 'application/json',
  };
  return mimeTypes[ext || ''] || bunType || 'application/octet-stream';
}

// Serve a file from the case folder - ALWAYS inline, never download
app.get("/view", async (c) => {
  const caseFolder = c.req.query("case");
  const filePath = c.req.query("path");

  if (!caseFolder || !filePath) {
    return c.json({ error: "case and path query params required" }, 400);
  }

  const fullPath = join(caseFolder, filePath);
  const filename = filePath.split("/").pop() || "file";

  try {
    const file = Bun.file(fullPath);
    const exists = await file.exists();

    if (!exists) {
      return c.json({ error: "File not found" }, 404);
    }

    const contentType = getContentType(filename, file.type);
    const arrayBuffer = await file.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(file.size),
        // Prevent browser from overriding inline display
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("File view error:", error);
    return c.json({ error: "Could not read file" }, 500);
  }
});

// Get verified review items for a case
app.get("/verified-items", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const verifiedPath = join(caseFolder, ".pi_tool", "verified_items.json");

  try {
    const content = await readFile(verifiedPath, "utf-8");
    return c.json(JSON.parse(content));
  } catch {
    // No verified items file exists yet, return empty
    return c.json({ verified: [] });
  }
});

// Save verified review items for a case
app.post("/verified-items", async (c) => {
  const body = await c.req.json();
  const { caseFolder, verified } = body;

  if (!caseFolder) {
    return c.json({ error: "caseFolder required" }, 400);
  }

  if (!Array.isArray(verified)) {
    return c.json({ error: "verified must be an array" }, 400);
  }

  const piToolDir = join(caseFolder, ".pi_tool");
  const verifiedPath = join(piToolDir, "verified_items.json");

  try {
    // Ensure .pi_tool directory exists
    await mkdir(piToolDir, { recursive: true });

    await writeFile(verifiedPath, JSON.stringify({ verified }, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to save verified items:", error);
    return c.json({ error: "Could not save verified items" }, 500);
  }
});

export default app;
