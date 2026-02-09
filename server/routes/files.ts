import { Hono } from "hono";
import { readdir, stat, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { requireCaseAccess, requireFirmAccess } from "../lib/team-access";
import { applyResolvedFieldToSummary } from "../lib/index-summary-sync";

// System/temporary files to ignore during file enumeration
const IGNORED_FILES = new Set([
  '.DS_Store',
  '._.DS_Store',
  'Thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.Spotlight-V100',
  '.Trashes',
  '.TemporaryItems',
]);

const IGNORED_PATTERNS = [
  /^\._/,           // macOS resource forks (._filename)
  /\.swp$/,         // vim swap files
  /\.swo$/,         // vim swap files
  /~$/,             // backup files (file~)
  /^~\$/,           // Office temp files (~$document.docx)
  /^\.~lock\./,     // LibreOffice locks
];

function shouldIgnoreFile(name: string): boolean {
  if (IGNORED_FILES.has(name)) return true;
  return IGNORED_PATTERNS.some(pattern => pattern.test(name));
}

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

// Browse directories for folder picker
app.get("/browse", async (c) => {
  const dir = c.req.query("dir") || homedir();

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && e.name !== ".pi_tool")
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
    const entries = await readdir(baseDir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && e.name !== ".pi_tool")
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

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  try {
    const content = await readFile(indexPath, "utf-8");
    const index = JSON.parse(content);
    if (Array.isArray(index.needs_review)) {
      index.needs_review = dedupeNeedsReviewEntries(index.needs_review);
    }
    return c.json(index);
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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  // Get all current files
  async function getAllFiles(dir: string, base: string = ""): Promise<{ path: string; mtime: number }[]> {
    const files: { path: string; mtime: number }[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".pi_tool" || shouldIgnoreFile(entry.name)) continue;
        // Keep status checks aligned with indexCase/listCaseFiles behavior.
        // Dot-prefixed folders are linked subcases and are indexed separately.
        if (entry.isDirectory() && entry.name.startsWith(".")) continue;
        if (!entry.isDirectory() && entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        const relativePath = (base ? join(base, entry.name) : entry.name).replace(/\\/g, "/");

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
    const content = await readFile(indexPath, "utf-8");
    index = JSON.parse(content);

    // Use the index FILE's mtime as the reliable timestamp (not the JSON date which can be wrong)
    const indexStats = await stat(indexPath);
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
    const normalizedPath = normalizeComparablePath(file.path);
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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  async function walkDir(dir: string, base: string = ""): Promise<any[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: any[] = [];

    for (const entry of entries) {
      if (entry.name === ".pi_tool" || shouldIgnoreFile(entry.name)) continue;

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

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
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

// Resolve a discrepancy in needs_review
app.post("/resolve", async (c) => {
  const body = await c.req.json();
  const { caseFolder, field, resolvedValue, evidence, recalculateCharges } = body;

  if (!caseFolder || !field || resolvedValue === undefined) {
    return c.json({ error: "caseFolder, field, and resolvedValue required" }, 400);
  }

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  try {
    // Read current index
    const content = await readFile(indexPath, "utf-8");
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
    await writeFile(indexPath, JSON.stringify(index, null, 2));

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

// Get needs_review items with resolved file paths
app.get("/needs-review", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  try {
    const content = await readFile(indexPath, "utf-8");
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
