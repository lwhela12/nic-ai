import { Hono } from "hono";
import { readdir, stat, readFile, writeFile, mkdir } from "fs/promises";
import { getVfs } from "../lib/vfs";
import { join, dirname, resolve, sep } from "path";
import { homedir } from "os";
import { requireCaseAccess, requireFirmAccess } from "../lib/team-access";
import { applyResolvedFieldToSummary } from "../lib/index-summary-sync";
import { writeIndexDerivedFiles } from "../lib/meta-index";
import { shouldIgnoreFile } from "../lib/file-ignore";
import {
  getClientSlug,
  resolveFirmRoot,
  loadClientRegistry,
  resolveYearFilePath,
  walkYearBasedFiles,
  listYearBasedCaseFiles,
} from "../lib/year-mode";

function normalizeFieldName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[''`]/g, "'");
}

function findMatchingFieldIndexes(needsReview: any[], field: string): number[] {
  const normalizedField = normalizeFieldName(field);
  if (!normalizedField) return [];

  const indexes: number[] = [];
  for (let i = 0; i < needsReview.length; i++) {
    if (normalizeFieldName(needsReview[i]?.field || "") === normalizedField) {
      indexes.push(i);
    }
  }
  return indexes;
}

function dedupeNeedsReviewEntries(needsReview: any[]): any[] {
  const merged = new Map<string, {
    field: string;
    conflicting_values: Set<string>;
    sources: Set<string>;
    reasons: Set<string>;
  }>();

  for (const item of needsReview || []) {
    const field = item?.field;
    const key = normalizeFieldName(field || "");
    if (!key) continue;

    let existing = merged.get(key);
    if (!existing) {
      existing = {
        field: field || "",
        conflicting_values: new Set<string>(),
        sources: new Set<string>(),
        reasons: new Set<string>(),
      };
      merged.set(key, existing);
    }

    for (const value of Array.isArray(item?.conflicting_values) ? item.conflicting_values : []) {
      existing.conflicting_values.add(String(value));
    }
    for (const source of Array.isArray(item?.sources) ? item.sources : []) {
      existing.sources.add(String(source));
    }
    if (item?.reason) {
      existing.reasons.add(String(item.reason));
    }
  }

  return Array.from(merged.values()).map((item) => {
    const reasons = Array.from(item.reasons);
    return {
      field: item.field,
      conflicting_values: Array.from(item.conflicting_values),
      sources: Array.from(item.sources),
      reason: reasons.length > 0 ? reasons.join(" | ") : "Conflicting values found",
    };
  });
}

const app = new Hono();
const REINDEX_DEBUG = process.env.REINDEX_DEBUG !== "false";

function reindexLog(scope: string, payload: Record<string, unknown>) {
  if (!REINDEX_DEBUG) return;
  try {
    console.log(`[reindex-debug][${scope}] ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[reindex-debug][${scope}]`, payload);
  }
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function normalizeComparablePath(value: string): string {
  return normalizePath(value)
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .toLowerCase();
}

function joinRelativePath(folderName: string, fileName: string): string {
  const folder = normalizePath(folderName);
  const file = normalizePath(fileName);
  if (!file) return "";
  if (!folder || folder === "." || folder.toLowerCase() === "root") return file;
  return `${folder}/${file}`;
}

function resolveCasePath(caseFolder: string, relativePath: string): string {
  if (getVfs().name !== 'local') {
    let cleanFolder = caseFolder.replace(/\\/g, '/').replace(/\/$/, '');
    let cleanRel = relativePath.replace(/\\/g, '/').replace(/^\//, '');
    return `${cleanFolder}/${cleanRel}`;
  }

  const base = resolve(caseFolder);
  const target = resolve(base, relativePath);
  // Use endsWith(sep) to avoid double-separator when base is a drive root (e.g. "C:\")
  const prefix = base.endsWith(sep) ? base : base + sep;
  if (target !== base && !target.startsWith(prefix)) {
    throw new Error(`Path is outside case folder: ${relativePath}`);
  }
  return target;
}

async function pathExists(path: string): Promise<boolean> {
  const vfs = getVfs();
  return vfs.exists(path);
}

function buildIndexedPathMap(index: any): Map<string, string> {
  const pathMap = new Map<string, string>();
  const folders = index?.folders;
  if (!folders || typeof folders !== "object") return pathMap;

  const addPath = (candidate: string, canonical: string) => {
    const candidateKey = normalizeComparablePath(candidate);
    const canonicalPath = normalizePath(canonical);
    if (!candidateKey || !canonicalPath) return;
    if (!pathMap.has(candidateKey)) {
      pathMap.set(candidateKey, canonicalPath);
    }
  };

  for (const [folderName, folderData] of Object.entries(folders)) {
    let docs: any[] = [];
    if (Array.isArray(folderData)) {
      docs = folderData;
    } else if (folderData && typeof folderData === "object") {
      const folderObj = folderData as any;
      if (Array.isArray(folderObj.files)) docs = folderObj.files;
      else if (Array.isArray(folderObj.documents)) docs = folderObj.documents;
    }

    for (const doc of docs) {
      let entryPath = "";
      let fileName = "";

      if (typeof doc === "string") {
        fileName = doc;
      } else if (doc && typeof doc === "object") {
        const rawPath = typeof doc.path === "string" ? normalizePath(doc.path) : "";
        const rawFilename = typeof doc.filename === "string" ? doc.filename : "";
        const rawFile = typeof doc.file === "string" ? doc.file : "";
        fileName = rawFilename || rawFile || (rawPath ? rawPath.split("/").pop() || "" : "");
        entryPath = rawPath;
      }

      const canonicalPath =
        entryPath && entryPath.includes("/")
          ? entryPath
          : joinRelativePath(folderName, entryPath || fileName);

      if (!canonicalPath) continue;

      addPath(canonicalPath, canonicalPath);
      const canonicalName = canonicalPath.split("/").pop() || canonicalPath;
      addPath(canonicalName, canonicalPath);

      const noExtPath = canonicalPath.replace(/\.pdf$/i, "");
      const noExtName = canonicalName.replace(/\.pdf$/i, "");
      if (noExtPath !== canonicalPath) addPath(noExtPath, canonicalPath);
      if (noExtName !== canonicalName) addPath(noExtName, canonicalPath);
    }
  }

  return pathMap;
}

async function resolveDocumentPath(
  caseFolder: string,
  requestedPath: string
): Promise<{ fullPath: string; relativePath: string }> {
  const normalizedRequestedPath = normalizePath(requestedPath);
  if (!normalizedRequestedPath) {
    throw new Error("Missing file path");
  }

  const directFullPath = resolveCasePath(caseFolder, normalizedRequestedPath);
  if (await pathExists(directFullPath)) {
    return { fullPath: directFullPath, relativePath: normalizedRequestedPath };
  }

  try {
    const vfs = getVfs();
    const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
    const indexContent = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    const pathMap = buildIndexedPathMap(index);
    const requestedComparablePath = normalizeComparablePath(normalizedRequestedPath);

    const candidates = [
      requestedComparablePath,
      normalizeComparablePath(normalizedRequestedPath.replace(/\.pdf$/i, "")),
      normalizeComparablePath(normalizedRequestedPath.split("/").pop() || normalizedRequestedPath),
      normalizeComparablePath(
        (normalizedRequestedPath.split("/").pop() || normalizedRequestedPath).replace(/\.pdf$/i, "")
      ),
    ].filter(Boolean);

    const yearSlug = getClientSlug(caseFolder);
    const yearFirmRoot = yearSlug ? resolveFirmRoot(caseFolder) : null;
    const yearRegistry = yearSlug && yearFirmRoot
      ? await loadClientRegistry(yearFirmRoot)
      : null;

    for (const candidate of candidates) {
      const mappedPath = pathMap.get(candidate);
      if (!mappedPath) continue;

      // Try direct resolution first
      try {
        const fullPath = resolveCasePath(caseFolder, mappedPath);
        if (await pathExists(fullPath)) {
          return { fullPath, relativePath: mappedPath };
        }
      } catch {
        // Path outside case folder — try year-based resolution
      }

      // Year-based resolution for indexed paths
      if (yearSlug && yearFirmRoot && yearRegistry?.clients[yearSlug]) {
        const resolved = resolveYearFilePath(yearFirmRoot, yearRegistry, yearSlug, mappedPath);
        if (await pathExists(resolved)) {
          return { fullPath: resolved, relativePath: mappedPath };
        }
      }
    }
  } catch {
    // Fall through to year-based fallback
  }

  // Year-based fallback: resolve through source folders
  const slug = getClientSlug(caseFolder);
  if (slug) {
    const firmRoot = resolveFirmRoot(caseFolder);
    const registry = await loadClientRegistry(firmRoot);
    if (registry?.clients[slug]) {
      const resolved = resolveYearFilePath(
        firmRoot,
        registry,
        slug,
        normalizedRequestedPath
      );
      if (await pathExists(resolved)) {
        return { fullPath: resolved, relativePath: normalizedRequestedPath };
      }
    }
  }

  throw new Error("File not found");
}

// Browse directories for folder picker
app.get("/browse", async (c) => {
  const dir = c.req.query("dir") || homedir();
  const vfs = getVfs();

  try {
    const entries = await vfs.readdir(dir, { withFileTypes: true }) as any[];
    const folders = entries
      .filter((e) => {
        const isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDirectory
        return isDir && e.name !== ".ai_tool"
      })
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

  const access = await requireFirmAccess(c, baseDir);
  if (!access.ok) {
    return access.response;
  }

  try {
    const vfs = getVfs();
    const entries = await vfs.readdir(baseDir, { withFileTypes: true }) as any[];
    const folders = entries
      .filter((e) => {
        const isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDirectory
        return isDir && e.name !== ".ai_tool"
      })
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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  const vfs = getVfs();

  try {
    const content = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);
    if (Array.isArray(index.needs_review)) {
      index.needs_review = dedupeNeedsReviewEntries(index.needs_review);
    }

    return c.json(index);
  } catch (error) {
    return c.json({ error: "No document index found. Run /init-case first." }, 404);
  }
});

// Update extracted summary metadata for a single indexed document
app.post("/document-summary", async (c) => {
  const body = await c.req.json();
  const caseFolder = typeof body?.caseFolder === "string" ? body.caseFolder : "";
  const filePath = typeof body?.filePath === "string" ? body.filePath : "";
  const updatesRaw = body?.updates && typeof body.updates === "object" ? body.updates : null;
  const hasExtractedDataUpdate = Object.prototype.hasOwnProperty.call(body ?? {}, "extractedData");
  const extractedDataRaw = hasExtractedDataUpdate ? body?.extractedData : undefined;
  const approveOnly = body?.approveOnly === true;
  const reviewNotesRaw = typeof body?.reviewNotes === "string" ? body.reviewNotes.trim() : "";

  if (!caseFolder || !filePath) {
    return c.json({ error: "caseFolder and filePath are required" }, 400);
  }

  if (!updatesRaw && !hasExtractedDataUpdate && !approveOnly) {
    return c.json({ error: "Provide updates/extractedData or set approveOnly=true" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");

  const normalizePath = (value: string): string =>
    value
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .trim();

  const normalizeComparablePath = (value: string): string =>
    normalizePath(value)
      .replace(/\s+/g, " ")
      .replace(/\s+\./g, ".")
      .toLowerCase();

  const joinRelativePath = (folderName: string, fileName: string): string => {
    const folder = normalizePath(folderName);
    const file = normalizePath(fileName);
    if (!file) return "";
    if (!folder || folder === "." || folder.toLowerCase() === "root") return file;
    return `${folder}/${file}`;
  };

  const allowedFields = new Set(["title", "type", "date", "key_info", "issues"]);
  const updates: Record<string, string> = {};

  if (updatesRaw) {
    for (const [key, rawValue] of Object.entries(updatesRaw as Record<string, unknown>)) {
      if (!allowedFields.has(key)) continue;
      if (rawValue === null || rawValue === undefined) {
        updates[key] = "";
        continue;
      }
      updates[key] = typeof rawValue === "string" ? rawValue : String(rawValue);
    }
  }

  if (hasExtractedDataUpdate && extractedDataRaw !== null && typeof extractedDataRaw !== "object") {
    return c.json({ error: "extractedData must be an object, array, or null" }, 400);
  }

  const buildUpdatedFields = (): string[] => {
    const fields = Object.keys(updates);
    if (hasExtractedDataUpdate) {
      fields.push("extracted_data");
    }
    return fields;
  };
  const updatedFields = buildUpdatedFields();

  if (updatedFields.length === 0 && !approveOnly) {
    return c.json({ error: "No valid update fields provided. Set approveOnly=true to mark reviewed without edits." }, 400);
  }

  const vfs = getVfs();
  try {
    const content = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);
    const reviewedAt = new Date().toISOString();

    if (!index.folders || typeof index.folders !== "object") {
      return c.json({ error: "Index has no folders section" }, 400);
    }

    const requestedPath = normalizeComparablePath(filePath);
    let matched = false;
    let updatedFilePath = normalizePath(filePath);
    let updatedFileName = "";
    let previousValues: Record<string, unknown> = {};
    let wasPreviouslyReviewed = false;

    for (const [folderName, folderData] of Object.entries(index.folders)) {
      let filesRef: any[] | null = null;
      if (Array.isArray(folderData)) {
        filesRef = folderData as any[];
      } else if (folderData && typeof folderData === "object") {
        const folderObj = folderData as Record<string, unknown>;
        if (Array.isArray(folderObj.files)) {
          filesRef = folderObj.files as any[];
        } else if (Array.isArray(folderObj.documents)) {
          filesRef = folderObj.documents as any[];
        }
      }

      if (!filesRef) continue;

      for (let i = 0; i < filesRef.length; i++) {
        const fileEntry = filesRef[i];
        let candidatePath = "";
        let fallbackFileName = "";

        if (typeof fileEntry === "string") {
          fallbackFileName = fileEntry;
          candidatePath = joinRelativePath(folderName, fileEntry);
        } else if (fileEntry && typeof fileEntry === "object") {
          const entry = fileEntry as Record<string, unknown>;
          const entryPathRaw = typeof entry.path === "string" ? normalizePath(entry.path) : "";
          const entryFile = typeof entry.file === "string" ? entry.file : "";
          const entryFilename = typeof entry.filename === "string" ? entry.filename : "";
          fallbackFileName =
            entryFilename ||
            entryFile ||
            (entryPathRaw ? entryPathRaw.split("/").pop() || "" : "");
          const entryPath =
            entryPathRaw && entryPathRaw.includes("/")
              ? entryPathRaw
              : joinRelativePath(folderName, entryPathRaw || fallbackFileName);
          candidatePath = entryPath || joinRelativePath(folderName, fallbackFileName);
        }

        if (!candidatePath || normalizeComparablePath(candidatePath) !== requestedPath) {
          continue;
        }

        const nextEntry: Record<string, unknown> =
          typeof fileEntry === "string"
            ? { filename: fileEntry }
            : { ...(fileEntry as Record<string, unknown>) };

        if (!nextEntry.filename && typeof nextEntry.file === "string") {
          nextEntry.filename = nextEntry.file;
        }

        wasPreviouslyReviewed = Boolean(nextEntry.user_reviewed);
        previousValues = {};
        for (const [field, value] of Object.entries(updates)) {
          previousValues[field] = nextEntry[field];
          const normalizedValue = value.trim();
          if ((field === "date" || field === "issues" || field === "type" || field === "title") && normalizedValue === "") {
            delete nextEntry[field];
          } else {
            nextEntry[field] = normalizedValue;
          }
        }

        if (hasExtractedDataUpdate) {
          previousValues.extracted_data = nextEntry.extracted_data;
          if (extractedDataRaw === null) {
            delete nextEntry.extracted_data;
          } else {
            nextEntry.extracted_data = JSON.parse(JSON.stringify(extractedDataRaw));
          }
        }

        nextEntry.user_reviewed = true;
        nextEntry.reviewed_at = reviewedAt;
        nextEntry.review_notes =
          reviewNotesRaw ||
          (updatedFields.length > 0
            ? `User reviewed and updated fields: ${updatedFields.join(", ")}`
            : wasPreviouslyReviewed
              ? "User re-approved extraction with no changes."
              : "User reviewed and approved extraction with no changes.");

        filesRef[i] = nextEntry;
        updatedFilePath = candidatePath;
        updatedFileName =
          (typeof nextEntry.filename === "string" && nextEntry.filename) ||
          (typeof nextEntry.file === "string" && nextEntry.file) ||
          fallbackFileName ||
          updatedFilePath.split("/").pop() ||
          updatedFilePath;
        matched = true;
        break;
      }

      if (matched) break;
    }

    if (!matched) {
      return c.json({ error: "File not found in document index" }, 404);
    }

    if (!Array.isArray(index.case_notes)) {
      index.case_notes = [];
    }

    const approvalOnly = updatedFields.length === 0;
    const reviewStatus = approvalOnly
      ? (wasPreviouslyReviewed ? "already-reviewed" : "approved")
      : "updated";
    index.case_notes.push({
      id: `note-${Date.now()}`,
      content: approvalOnly
        ? (wasPreviouslyReviewed
          ? `Re-approved extracted data for ${updatedFileName} with no metadata changes`
          : `Approved extracted data for ${updatedFileName} with no metadata changes`)
        : `Updated document summary fields for ${updatedFileName}: ${updatedFields.join(", ")}`,
      field_updated: `document:${updatedFilePath}`,
      previous_value: previousValues,
      source: "manual",
      createdAt: new Date().toISOString(),
    });

    await vfs.writeFile(indexPath, JSON.stringify(index, null, 2));
    await writeIndexDerivedFiles(caseFolder, index);

    return c.json({
      success: true,
      filePath: updatedFilePath,
      updatedFields,
      approvalOnly,
      reviewStatus,
    });
  } catch (error) {
    if ((error as any)?.code === "ENOENT") {
      return c.json({ error: "Document index not found. Run /init-case first." }, 404);
    }
    console.error("Failed to update document summary:", error);
    return c.json({ error: "Could not update document summary" }, 500);
  }
});

// Check if index needs refresh (new/modified files)
app.get("/index-status", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  reindexLog("index-status:start", {
    caseFolder,
    vfs: getVfs().name,
  });

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    reindexLog("index-status:access_denied", { caseFolder });
    return access.response;
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  const vfs = getVfs();

  // Get all current files
  async function getAllFiles(dir: string, base: string = ""): Promise<{ path: string; mtime: number }[]> {
    const files: { path: string; mtime: number }[] = [];
    try {
      const entries = await vfs.readdir(dir, { withFileTypes: true }) as any[];
      for (const entry of entries) {
        if (entry.name === ".ai_tool" || shouldIgnoreFile(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        const relativePath = (base ? join(base, entry.name) : entry.name).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          const subFiles = await getAllFiles(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          const stats = await vfs.stat(fullPath);
          files.push({ path: relativePath, mtime: stats.mtimeMs });
        }
      }
    } catch (error) {
      reindexLog("index-status:walk_error", {
        caseFolder,
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return files;
  }

  // Year-based mode: scan all source folders instead of virtual caseFolder
  let currentFiles: { path: string; mtime: number }[];
  const statusSlug = getClientSlug(caseFolder);
  if (statusSlug) {
    const firmRoot = resolveFirmRoot(caseFolder);
    const registry = await loadClientRegistry(firmRoot);
    if (registry?.clients[statusSlug]) {
      const entry = registry.clients[statusSlug];
      reindexLog("index-status:year_mode", {
        caseFolder,
        slug: statusSlug,
        sourceFolders: entry.sourceFolders,
      });
      const allFiles: { path: string; mtime: number }[] = [];
      for (const relSourceFolder of entry.sourceFolders) {
        const absFolder = join(firmRoot, relSourceFolder);
        const yearPrefix = relSourceFolder.split("/")[0];
        const folderFiles = await getAllFiles(absFolder, "");
        // Prefix with year
        for (const f of folderFiles) {
          allFiles.push({ path: `${yearPrefix}/${f.path}`, mtime: f.mtime });
        }
      }
      currentFiles = allFiles;
    } else {
      reindexLog("index-status:year_mode_registry_miss", {
        caseFolder,
        slug: statusSlug,
        firmRoot,
      });
      currentFiles = await getAllFiles(caseFolder);
    }
  } else {
    currentFiles = await getAllFiles(caseFolder);
  }

  // Normalize paths for robust comparison across index shape variants.
  const normalizePath = (p: string) =>
    p
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .trim();

  const normalizeComparablePath = (p: string) =>
    normalizePath(p)
      .replace(/\s+/g, " ")  // Collapse repeated whitespace
      .replace(/\s+\./g, ".") // Remove stray space before extension
      .toLowerCase();

  const joinRelativePath = (folderName: string, fileName: string): string => {
    const folder = normalizePath(folderName);
    const file = normalizePath(fileName);
    if (!file) return "";
    if (!folder || folder === "." || folder.toLowerCase() === "root") return file;
    return `${folder}/${file}`;
  };

  // Try to load existing index
  let index: any = null;
  let indexedAt: number = 0;
  let indexedFiles: Set<string> = new Set();

  try {
    const content = await vfs.readFile(indexPath, "utf-8");
    index = JSON.parse(content);


    // Use the index FILE's mtime as the reliable timestamp (not the JSON date which can be wrong)
    const indexStats = await vfs.stat(indexPath);
    indexedAt = indexStats.mtimeMs;

    const addIndexedPath = (pathLike: unknown, folderName?: string) => {
      if (typeof pathLike !== "string" || !pathLike.trim()) return;
      const resolved = folderName !== undefined
        ? joinRelativePath(folderName, pathLike)
        : normalizePath(pathLike);
      const normalized = normalizeComparablePath(resolved);
      if (normalized) indexedFiles.add(normalized);
    };

    // Collect all indexed file paths.
    if (index.folders) {
      for (const [folderName, folderData] of Object.entries(index.folders)) {
        // Handle all folder formats: array, {files}, or legacy {documents}.
        let docs: any[] = [];
        if (Array.isArray(folderData)) {
          docs = folderData;
        } else if (folderData && typeof folderData === "object") {
          const folderObj = folderData as any;
          if (Array.isArray(folderObj.files)) {
            docs = folderObj.files;
          } else if (Array.isArray(folderObj.documents)) {
            docs = folderObj.documents;
          }
        }

        for (const doc of docs) {
          if (typeof doc === "string") {
            addIndexedPath(doc, folderName);
            continue;
          }
          if (doc && typeof doc === "object") {
            // path may already be full relative path.
            addIndexedPath((doc as any).path);
            addIndexedPath((doc as any).file, folderName);
            addIndexedPath((doc as any).filename, folderName);
          }
        }
      }
    }
    // Also check files_indexed if present (array format from old index)
    if (Array.isArray(index.files_indexed)) {
      for (const f of index.files_indexed) {
        addIndexedPath(f);
      }
    }
  } catch (error) {
    reindexLog("index-status:no_index", {
      caseFolder,
      indexPath,
      currentFileCount: currentFiles.length,
      error: error instanceof Error ? error.message : String(error),
    });
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
    const normalizedPath = normalizeComparablePath(file.path);
    if (!indexedFiles.has(normalizedPath)) {
      newFiles.push(file.path);
    } else if (file.mtime > indexedAt) {
      modifiedFiles.push(file.path);
    }
  }

  const needsIndex = newFiles.length > 0 || modifiedFiles.length > 0;

  reindexLog("index-status:result", {
    caseFolder,
    vfs: getVfs().name,
    currentFileCount: currentFiles.length,
    indexedFileCount: indexedFiles.size,
    indexedAtEpochMs: indexedAt,
    needsIndex,
    reason: needsIndex ? (newFiles.length > 0 ? "new_files" : "modified_files") : "up_to_date",
    newCount: newFiles.length,
    modifiedCount: modifiedFiles.length,
    newSample: newFiles.slice(0, 8),
    modifiedSample: modifiedFiles.slice(0, 8),
  });

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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const memoPath = join(caseFolder, ".ai_tool", "case_memo.md");
  const vfs = getVfs();

  try {
    const content = await vfs.readFile(memoPath, "utf-8");
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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  async function walkDir(dir: string, base: string = ""): Promise<any[]> {
    const vfs = getVfs();
    const entries = await vfs.readdir(dir, { withFileTypes: true }) as any[];
    const results: any[] = [];

    for (const entry of entries) {
      if (entry.name === ".ai_tool" || shouldIgnoreFile(entry.name)) continue;

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
        const stats = await vfs.stat(fullPath);
        results.push({
          name: entry.name,
          type: "file",
          path: relativePath,
          size: stats.size,
          modified: stats.mtimeMs,
        });
      }
    }

    return results;
  }

  try {
    // Year-based mode: walk source folders grouped by year
    const slug = getClientSlug(caseFolder);
    if (slug) {
      const firmRoot = resolveFirmRoot(caseFolder);
      const registry = await loadClientRegistry(firmRoot);
      if (registry?.clients[slug]) {
        const tree = await walkYearBasedFiles(firmRoot, registry, slug);
        return c.json({ tree });
      }
    }

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

  const vfs = getVfs();

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  try {
    const { fullPath, relativePath } = await resolveDocumentPath(caseFolder, filePath);
    const filename = relativePath.split("/").pop() || "file";

    // We cannot use Bun.file for a virtual remote view without an intermediate buffer/stream
    let contentType = getContentType(filename, undefined);

    // For local files we can still use Bun.file for speed, or we can just always use the VFS
    if (vfs.name === 'local') {
      const file = Bun.file(fullPath);
      contentType = getContentType(filename, file.type);
      const arrayBuffer = await file.arrayBuffer();
      return new Response(arrayBuffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Content-Length": String(file.size),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // For GDrive (or others), use the stream response directly if possible
    try {
      const stream = await vfs.createReadStream(fullPath);
      return new Response(stream as any, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      // fallback buffer
      const buffer = await vfs.readFile(fullPath);
      return new Response(buffer as any, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "File not found") {
      return c.json({ error: "File not found" }, 404);
    }
    console.error("File view error:", error);
    return c.json({ error: "Could not read file" }, 500);
  }
});

// Resolve a discrepancy in needs_review
app.post("/resolve", async (c) => {
  const body = await c.req.json();
  const { caseFolder, field, resolvedValue, evidence, recalculateCharges } = body;

  if (!caseFolder || !field || resolvedValue === undefined) {
    return c.json({ error: "caseFolder, field, and resolvedValue required" }, 400);
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  const vfs = getVfs();

  try {
    // Read current index
    const content = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);

    // Find the item in needs_review
    const needsReview: any[] = dedupeNeedsReviewEntries(index.needs_review || []);
    const matchingIndexes = findMatchingFieldIndexes(needsReview, field);

    if (matchingIndexes.length === 0) {
      return c.json({ error: `Field "${field}" not found in needs_review` }, 404);
    }

    const resolvedItems = matchingIndexes.map((idx) => needsReview[idx]);
    const resolvedField = resolvedItems[0]?.field || field;
    const rejectedValues = Array.from(new Set(
      resolvedItems
        .flatMap((item) => Array.isArray(item?.conflicting_values) ? item.conflicting_values : [])
        .map((v: any) => String(v))
        .filter((v) => v !== String(resolvedValue))
    ));

    // Remove all matching duplicates from needs_review
    const indexSet = new Set(matchingIndexes);
    index.needs_review = needsReview.filter((_: any, idx: number) => !indexSet.has(idx));

    // Add to errata
    const errata: any[] = index.errata || [];
    const errataEntry = {
      field: resolvedField,
      decision: resolvedValue,
      rejected_values: rejectedValues,
      evidence: evidence || "User confirmed correct value",
      resolution_type: "user_decision",
      resolved_at: new Date().toISOString(),
    };
    errata.push(errataEntry);
    index.errata = errata;

    // Add to case_notes (ensure it's an array)
    let caseNotes: any[] = Array.isArray(index.case_notes) ? index.case_notes : [];
    const noteEntry = {
      id: `note-${Date.now()}`,
      content: `Resolved ${resolvedField}: ${resolvedValue} (was conflicting: ${rejectedValues.join(", ")}). ${evidence || ""}`.trim(),
      field_updated: resolvedField,
      previous_value: rejectedValues,
      source: "chat",
      createdAt: new Date().toISOString(),
    };
    caseNotes.push(noteEntry);
    index.case_notes = caseNotes;

    // Handle specific field types
    let summaryUpdated = false;

    // For charges fields, update the provider entry in summary.providers if it exists
    if (resolvedField.startsWith("charges:") && index.summary?.providers) {
      const providerName = resolvedField.replace("charges:", "");
      const numericValue = parseFloat(String(resolvedValue).replace(/[$,]/g, ""));

      // Find matching provider in summary.providers (handles both array-of-strings and array-of-objects)
      const providers = index.summary.providers;
      if (Array.isArray(providers)) {
        for (let i = 0; i < providers.length; i++) {
          const prov = providers[i];
          if (typeof prov === "object" && prov.name) {
            // Object format: { name, charges, ... }
            if (prov.name.toLowerCase().includes(providerName.toLowerCase()) ||
              providerName.toLowerCase().includes(prov.name.toLowerCase())) {
              const oldCharges = prov.charges;
              prov.charges = numericValue;

              // Adjust total_charges by the delta
              if (!isNaN(numericValue) && index.summary.total_charges !== undefined) {
                const oldTotal = index.summary.total_charges;
                const delta = numericValue - (parseFloat(String(oldCharges).replace(/[$,]/g, "")) || 0);
                index.summary.total_charges = oldTotal + delta;
                noteEntry.content += ` Updated total_charges: $${oldTotal.toLocaleString()} → $${index.summary.total_charges.toLocaleString()}`;
              }
              summaryUpdated = true;
              break;
            }
          }
        }
      }

      // If no matching provider found, just note it
      if (!summaryUpdated) {
        noteEntry.content += ` Note: total_charges may need manual adjustment.`;
      }
    }

    // If resolving claim_numbers, update summary
    if (resolvedField.startsWith("claim_numbers:") && index.summary) {
      const claimKey = resolvedField.replace("claim_numbers:", "");
      if (!index.summary.claim_numbers) {
        index.summary.claim_numbers = {};
      }
      index.summary.claim_numbers[claimKey] = resolvedValue;
      summaryUpdated = true;
    }

    // If resolving policy_limits, update summary
    if (resolvedField.startsWith("policy_limits:") && index.summary) {
      // Handle nested paths like "policy_limits:3P:bodily_injury"
      const parts = resolvedField.replace("policy_limits:", "").split(":");
      if (parts.length >= 1) {
        if (!index.summary.policy_limits) {
          index.summary.policy_limits = {};
        }
        if (parts.length === 1) {
          index.summary.policy_limits[parts[0]] = resolvedValue;
        } else if (parts.length === 2) {
          if (!index.summary.policy_limits[parts[0]]) {
            index.summary.policy_limits[parts[0]] = {};
          }
          index.summary.policy_limits[parts[0]][parts[1]] = resolvedValue;
        }
        summaryUpdated = true;
      }
    }

    // If resolving date fields, update summary.dol and summary.incident_date
    if ((resolvedField === "date_of_loss" || resolvedField === "date_of_injury" || resolvedField === "doi" || resolvedField === "dol") && index.summary) {
      index.summary.dol = resolvedValue;
      index.summary.incident_date = resolvedValue;
      summaryUpdated = true;
    }

    // If resolving AMW/compensation_rate, update disability_status
    if ((resolvedField === "amw" || resolvedField === "aww" || resolvedField === "average_monthly_wage") && index.summary) {
      if (!index.summary.disability_status) index.summary.disability_status = {};
      index.summary.disability_status.amw = parseFloat(String(resolvedValue).replace(/[$,]/g, "")) || undefined;
      summaryUpdated = true;
    }
    if ((resolvedField === "compensation_rate" || resolvedField === "weekly_compensation_rate") && index.summary) {
      if (!index.summary.disability_status) index.summary.disability_status = {};
      index.summary.disability_status.compensation_rate = parseFloat(String(resolvedValue).replace(/[$,]/g, "")) || undefined;
      summaryUpdated = true;
    }

    // Apply generic summary synchronization for dashboard-visible fields
    summaryUpdated = applyResolvedFieldToSummary(index, resolvedField, resolvedValue) || summaryUpdated;

    // Write updated index
    await vfs.writeFile(indexPath, JSON.stringify(index, null, 2));
    await writeIndexDerivedFiles(caseFolder, index);

    return c.json({
      success: true,
      field: resolvedField,
      resolvedValue,
      rejectedValues,
      remainingConflicts: index.needs_review.length,
      summaryUpdated,
      errataEntry,
    });
  } catch (error) {
    console.error("Failed to resolve discrepancy:", error);
    if ((error as any).code === "ENOENT") {
      return c.json({ error: "Document index not found. Run /init-case first." }, 404);
    }
    return c.json({ error: "Could not resolve discrepancy" }, 500);
  }
});

// Update contact card fields in the document index
app.patch("/contact-card", async (c) => {
  const body = await c.req.json();
  const caseFolder = typeof body?.caseFolder === "string" ? body.caseFolder : "";
  const updates = body?.updates && typeof body.updates === "object" ? body.updates : null;

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }
  if (!updates) {
    return c.json({ error: "updates object is required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  const vfs = getVfs();

  try {
    const content = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);

    if (!index.summary || typeof index.summary !== "object") {
      return c.json({ error: "Index has no summary section" }, 400);
    }

    const changedFields: string[] = [];
    const previousValues: Record<string, unknown> = {};

    // Helper to deep-merge an object section
    const mergeSection = (target: any, source: any, prefix: string) => {
      for (const [key, val] of Object.entries(source)) {
        if (val === undefined) continue;
        if (val !== null && typeof val === "object" && !Array.isArray(val) && target[key] && typeof target[key] === "object") {
          mergeSection(target[key], val, `${prefix}.${key}`);
        } else {
          previousValues[`${prefix}.${key}`] = target[key];
          target[key] = val;
          changedFields.push(`${prefix}.${key}`);
        }
      }
    };

    // Apply top-level summary fields
    if (typeof updates.client === "string") {
      previousValues["client"] = index.summary.client;
      index.summary.client = updates.client;
      changedFields.push("client");
      // Also update case_name
      const parts = updates.client.trim().split(/\s+/);
      if (parts.length === 1) {
        index.case_name = parts[0].toUpperCase();
      } else {
        const last = parts[parts.length - 1].toUpperCase();
        const first = parts.slice(0, -1).join(" ");
        index.case_name = `${last}, ${first}`;
      }
    }

    if (typeof updates.dob === "string") {
      previousValues["dob"] = index.summary.dob;
      index.summary.dob = updates.dob;
      changedFields.push("dob");
    }

    // Contact section
    if (updates.contact && typeof updates.contact === "object") {
      if (!index.summary.contact) index.summary.contact = {};
      mergeSection(index.summary.contact, updates.contact, "contact");
    }

    // Policy limits section (PI)
    if (updates.policy_limits && typeof updates.policy_limits === "object") {
      if (!index.summary.policy_limits) index.summary.policy_limits = {};
      for (const [party, partyUpdates] of Object.entries(updates.policy_limits)) {
        if (!partyUpdates || typeof partyUpdates !== "object") continue;
        if (!index.summary.policy_limits[party]) {
          index.summary.policy_limits[party] = { carrier: "Unknown" };
        }
        mergeSection(index.summary.policy_limits[party], partyUpdates, `policy_limits.${party}`);
      }
    }

    // Health insurance section
    if (updates.health_insurance && typeof updates.health_insurance === "object") {
      if (!index.summary.health_insurance) index.summary.health_insurance = {};
      mergeSection(index.summary.health_insurance, updates.health_insurance, "health_insurance");
    }

    // Claim numbers section
    if (updates.claim_numbers && typeof updates.claim_numbers === "object") {
      if (!index.summary.claim_numbers) index.summary.claim_numbers = {};
      mergeSection(index.summary.claim_numbers, updates.claim_numbers, "claim_numbers");
    }

    // Add audit case_note
    if (!Array.isArray(index.case_notes)) {
      index.case_notes = [];
    }
    index.case_notes.push({
      id: `note-${Date.now()}`,
      content: `Contact card updated: ${changedFields.join(", ")}`,
      field_updated: changedFields.join(", "),
      previous_value: previousValues,
      source: "manual",
      createdAt: new Date().toISOString(),
    });

    await vfs.writeFile(indexPath, JSON.stringify(index, null, 2));
    await writeIndexDerivedFiles(caseFolder, index);

    return c.json({
      success: true,
      changedFields,
      summary: index.summary,
    });
  } catch (error) {
    if ((error as any)?.code === "ENOENT") {
      return c.json({ error: "Document index not found. Run /init-case first." }, 404);
    }
    console.error("Failed to update contact card:", error);
    return c.json({ error: "Could not update contact card" }, 500);
  }
});

// Get needs_review items with resolved file paths
app.get("/needs-review", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");
  const vfs = getVfs();

  try {
    const content = await vfs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);

    const needsReview: any[] = index.needs_review || [];

    // Build a filename -> path lookup from all folders
    const filePathMap: Record<string, string> = {};

    if (index.folders) {
      for (const [folderName, folderData] of Object.entries(index.folders)) {
        const files: any[] = Array.isArray(folderData)
          ? folderData
          : (folderData as any)?.files || [];

        for (const file of files) {
          const filename = file.file || file.filename;
          if (filename) {
            // Store both the exact filename and lowercase version for matching
            const fullPath = join(folderName, filename);
            filePathMap[filename] = fullPath;
            filePathMap[filename.toLowerCase()] = fullPath;
          }
        }
      }
    }

    // Enrich each needs_review item with resolved file paths
    const enrichedItems = needsReview.map((item) => {
      const sources = Array.isArray(item.sources) ? item.sources : [];

      // Resolve source strings to file paths
      // Sources look like: "MRB Spinal Rehab Center.PDF ($1,234.56)" or just "filename.pdf"
      const resolvedSources = sources.map((source: string) => {
        // Extract filename from source string (remove parenthetical notes)
        const filename = source.replace(/\s*\([^)]*\)\s*$/, "").trim();
        const note = source.match(/\(([^)]*)\)$/)?.[1] || "";

        // Try to find the file path
        const path = filePathMap[filename] || filePathMap[filename.toLowerCase()];

        return {
          original: source,
          filename,
          path: path || null,
          note,
        };
      });

      return {
        ...item,
        resolved_sources: resolvedSources,
      };
    });

    return c.json({
      count: enrichedItems.length,
      items: enrichedItems,
      case_name: index.case_name || index.summary?.client,
    });
  } catch (error) {
    if ((error as any).code === "ENOENT") {
      return c.json({ error: "Document index not found. Run /init-case first." }, 404);
    }
    return c.json({ error: "Could not load needs_review items" }, 500);
  }
});

// Get verified review items for a case
app.get("/verified-items", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const verifiedPath = join(caseFolder, ".ai_tool", "verified_items.json");
  const vfs = getVfs();

  try {
    const content = await vfs.readFile(verifiedPath, "utf-8");
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

  const piToolDir = join(caseFolder, ".ai_tool");
  const verifiedPath = join(piToolDir, "verified_items.json");

  const vfs = getVfs();
  try {
    // Ensure .ai_tool directory exists
    await vfs.mkdir(piToolDir, { recursive: true });

    await vfs.writeFile(verifiedPath, JSON.stringify({ verified }, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to save verified items:", error);
    return c.json({ error: "Could not save verified items" }, 500);
  }
});

export default app;
