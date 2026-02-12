/**
 * Meta-index: two-tier index system for efficient LLM context.
 *
 * - meta_index.json: deduped facts + filenames per folder (fits in prompt)
 * - indexes/{FolderName}.json: full per-folder detail (on-demand via read_file)
 *
 * Both are derived views regenerated from document_index.json on every save.
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { buildCaseMap } from "./case-map";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MetaIndexFolder {
  file_count: number;
  types: string[];
  date_range: { earliest?: string; latest?: string };
  filenames: string[];
  facts: Record<string, any>;
  index_file: string;
}

export interface MetaIndex {
  indexed_at: string;
  case_name?: string;
  case_phase?: string;
  summary: Record<string, any>;
  folder_count: number;
  document_count: number;
  folders: Record<string, MetaIndexFolder>;
  needs_review?: any[];
  issues_found?: any[];
  open_hearings?: any[];
}

// Fields to skip when merging extracted_data into folder facts
const SKIP_FIELDS = new Set([
  "type",
  "has_handwritten_data",
  "handwritten_fields",
  "document_date",
  "document_date_confidence",
  "document_date_reason",
]);

// ── generateMetaIndex ──────────────────────────────────────────────────────

export function generateMetaIndex(indexData: Record<string, any>): MetaIndex {
  const folders: Record<string, MetaIndexFolder> = {};
  const rawFolders = indexData?.folders || {};
  let totalDocs = 0;

  for (const [folderName, folderData] of Object.entries(rawFolders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files;
    if (!Array.isArray(files)) continue;

    const filenames: string[] = [];
    const typesSet = new Set<string>();
    const dates: string[] = [];
    const mergedFacts: Record<string, any> = {};

    for (const file of files) {
      // Collect filename
      if (file?.filename) filenames.push(file.filename);

      // Collect type
      if (typeof file?.type === "string") typesSet.add(file.type);

      // Collect date
      if (typeof file?.date === "string" && file.date) dates.push(file.date);

      // Merge extracted_data: keep richest (longest) value for each key
      if (file?.extracted_data && typeof file.extracted_data === "object") {
        mergeExtractedData(mergedFacts, file.extracted_data);
      }
    }

    // Compute date range
    const sortedDates = dates.filter(Boolean).sort();
    const dateRange: { earliest?: string; latest?: string } = {};
    if (sortedDates.length > 0) {
      dateRange.earliest = sortedDates[0];
      dateRange.latest = sortedDates[sortedDates.length - 1];
    }

    // Sanitize folder name for index_file path
    const indexFile = `.pi_tool/indexes/${folderName}.json`;

    folders[folderName] = {
      file_count: files.length,
      types: Array.from(typesSet),
      date_range: dateRange,
      filenames,
      facts: mergedFacts,
      index_file: indexFile,
    };

    totalDocs += files.length;
  }

  const meta: MetaIndex = {
    indexed_at: indexData?.indexed_at || new Date().toISOString(),
    case_name: indexData?.case_name,
    case_phase: indexData?.case_phase,
    summary: indexData?.summary || {},
    folder_count: Object.keys(folders).length,
    document_count: totalDocs,
    folders,
  };

  if (Array.isArray(indexData?.needs_review) && indexData.needs_review.length > 0) {
    meta.needs_review = indexData.needs_review;
  }
  if (Array.isArray(indexData?.issues_found) && indexData.issues_found.length > 0) {
    meta.issues_found = indexData.issues_found;
  }
  if (Array.isArray(indexData?.open_hearings) && indexData.open_hearings.length > 0) {
    meta.open_hearings = indexData.open_hearings;
  }

  return meta;
}

/**
 * Recursively merge extracted_data into target, keeping richest value per key.
 */
function mergeExtractedData(
  target: Record<string, any>,
  source: Record<string, any>,
  prefix = ""
): void {
  for (const [key, value] of Object.entries(source)) {
    if (SKIP_FIELDS.has(key)) continue;

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      // Recurse into nested objects
      mergeExtractedData(target, value, fullKey);
      continue;
    }

    // Compare richness: longer string wins, arrays with more items win
    const existing = target[fullKey];
    if (existing === undefined) {
      target[fullKey] = value;
    } else {
      const newLen = stringLength(value);
      const existingLen = stringLength(existing);
      if (newLen > existingLen) {
        target[fullKey] = value;
      }
    }
  }
}

function stringLength(val: any): number {
  if (typeof val === "string") return val.length;
  if (Array.isArray(val)) return JSON.stringify(val).length;
  return String(val).length;
}

// ── splitIndexToFolders ────────────────────────────────────────────────────

export async function splitIndexToFolders(
  indexData: Record<string, any>,
  caseFolder: string
): Promise<void> {
  const rawFolders = indexData?.folders || {};
  const indexesDir = join(caseFolder, ".pi_tool", "indexes");

  // Ensure base indexes directory exists
  await mkdir(indexesDir, { recursive: true });

  for (const [folderName, folderData] of Object.entries(rawFolders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files;
    if (!Array.isArray(files)) continue;

    // Build per-folder data: full file entries
    const folderIndex = {
      folder: folderName,
      file_count: files.length,
      files: files.map((file: any) => ({
        filename: file.filename,
        type: file.type,
        key_info: file.key_info,
        date: file.date,
        extracted_data: file.extracted_data,
        issues: file.issues,
        doc_id: file.doc_id,
      })),
    };

    // Create nested directories for folder names with slashes
    const outPath = join(indexesDir, `${folderName}.json`);
    await mkdir(join(outPath, ".."), { recursive: true });
    await writeFile(outPath, JSON.stringify(folderIndex, null, 2));
  }
}

// ── writeIndexDerivedFiles ──────────────────────────────────────────────────

/**
 * Regenerate all derived views from the canonical document_index.json.
 * Call this after any write to document_index.json so that case_map,
 * per-folder indexes, and meta_index stay in sync.
 */
export async function writeIndexDerivedFiles(
  caseFolder: string,
  index: Record<string, any>
): Promise<void> {
  const piToolDir = join(caseFolder, ".pi_tool");
  // Case map
  const caseMap = buildCaseMap(index);
  await writeFile(join(piToolDir, "case_map.json"), JSON.stringify(caseMap, null, 2));
  // Meta-index + per-folder files
  await splitIndexToFolders(index, caseFolder);
  const metaIndex = generateMetaIndex(index);
  await writeFile(join(piToolDir, "meta_index.json"), JSON.stringify(metaIndex, null, 2));
}

// ── buildMetaIndexPromptView ───────────────────────────────────────────────

export function buildMetaIndexPromptView(
  metaIndex: MetaIndex,
  maxChars = 200000
): string {
  const parts: string[] = [];

  // Header
  const caseName = metaIndex.case_name || "Unknown Case";
  const phase = metaIndex.case_phase || "Unknown";
  parts.push(
    `## CASE INDEX — ${caseName}`,
    `Phase: ${phase} | ${metaIndex.folder_count} folders, ${metaIndex.document_count} documents`,
    ""
  );

  // Case summary
  if (metaIndex.summary && Object.keys(metaIndex.summary).length > 0) {
    parts.push("### Case Summary");
    renderFlatFacts(parts, metaIndex.summary);
    parts.push("");
  }

  // Open hearings
  if (metaIndex.open_hearings && metaIndex.open_hearings.length > 0) {
    parts.push("### Open Hearings");
    for (const hearing of metaIndex.open_hearings) {
      if (typeof hearing === "object" && hearing !== null) {
        const fields = Object.entries(hearing)
          .map(([k, v]) => `${k}: ${flattenValue(v)}`)
          .join(", ");
        parts.push(`- ${fields}`);
      } else {
        parts.push(`- ${String(hearing)}`);
      }
    }
    parts.push("");
  }

  // Folders
  const folderEntries = Object.entries(metaIndex.folders);
  for (const [folderName, folder] of folderEntries) {
    const typesStr = folder.types.join(", ");
    const dateStr = formatDateRange(folder.date_range);

    parts.push(`### ${folderName} — ${folder.file_count} files`);
    if (typesStr) parts.push(`Types: ${typesStr}`);
    if (dateStr) parts.push(`Dates: ${dateStr}`);
    parts.push(`Files: ${folder.filenames.join(", ")}`);

    if (Object.keys(folder.facts).length > 0) {
      parts.push("Facts:");
      for (const [key, value] of Object.entries(folder.facts)) {
        parts.push(`  ${key}: ${flattenValue(value)}`);
      }
    }
    parts.push("");
  }

  // Needs review / conflicts
  if (metaIndex.needs_review && metaIndex.needs_review.length > 0) {
    parts.push(`### Unresolved Conflicts (${metaIndex.needs_review.length})`);
    for (const item of metaIndex.needs_review) {
      if (item.field && item.conflicting_values) {
        const values = item.conflicting_values.map((v: any) => flattenValue(v)).join(" vs ");
        const sources = item.sources
          ? ` (${item.sources.map((s: any) => typeof s === "string" ? s : s?.file || s?.filename || "unknown").join(" vs ")})`
          : "";
        parts.push(`- ${item.field}: ${values}${sources}`);
      } else if (item.field) {
        parts.push(`- ${item.field}: ${flattenValue(item)}`);
      }
    }
    parts.push("");
  }

  // Issues
  if (metaIndex.issues_found && metaIndex.issues_found.length > 0) {
    parts.push(`### Issues Found (${metaIndex.issues_found.length})`);
    for (const issue of metaIndex.issues_found.slice(0, 20)) {
      parts.push(`- ${flattenValue(issue)}`);
    }
    if (metaIndex.issues_found.length > 20) {
      parts.push(`  ... ${metaIndex.issues_found.length - 20} more issues`);
    }
    parts.push("");
  }

  // Footer
  parts.push(`To read full details for any folder, use: read_file(".pi_tool/indexes/{FolderName}.json")`);

  let result = parts.join("\n");

  // Truncation if needed
  if (result.length > maxChars) {
    result = truncatePromptView(metaIndex, maxChars);
  }

  return result;
}

/**
 * Progressive truncation: trim facts from largest folders first.
 */
function truncatePromptView(metaIndex: MetaIndex, maxChars: number): string {
  const parts: string[] = [];
  const caseName = metaIndex.case_name || "Unknown Case";
  const phase = metaIndex.case_phase || "Unknown";
  parts.push(
    `## CASE INDEX — ${caseName}`,
    `Phase: ${phase} | ${metaIndex.folder_count} folders, ${metaIndex.document_count} documents`,
    ""
  );

  // Summary always included
  if (metaIndex.summary && Object.keys(metaIndex.summary).length > 0) {
    parts.push("### Case Summary");
    renderFlatFacts(parts, metaIndex.summary);
    parts.push("");
  }

  // Sort folders by file_count descending for progressive trimming
  const folderEntries = Object.entries(metaIndex.folders)
    .sort(([, a], [, b]) => b.file_count - a.file_count);

  // First pass: include all folders with filenames but limit facts
  const MAX_FACTS_PER_FOLDER = 15;
  for (const [folderName, folder] of folderEntries) {
    const typesStr = folder.types.join(", ");
    const dateStr = formatDateRange(folder.date_range);

    parts.push(`### ${folderName} — ${folder.file_count} files`);
    if (typesStr) parts.push(`Types: ${typesStr}`);
    if (dateStr) parts.push(`Dates: ${dateStr}`);
    parts.push(`Files: ${folder.filenames.join(", ")}`);

    const factEntries = Object.entries(folder.facts);
    if (factEntries.length > 0) {
      parts.push("Facts:");
      const shown = factEntries.slice(0, MAX_FACTS_PER_FOLDER);
      for (const [key, value] of shown) {
        parts.push(`  ${key}: ${flattenValue(value)}`);
      }
      if (factEntries.length > MAX_FACTS_PER_FOLDER) {
        parts.push(`  ... ${factEntries.length - MAX_FACTS_PER_FOLDER} more facts. Use read_file("${folder.index_file}") for full details.`);
      }
    }
    parts.push("");
  }

  // Conflicts
  if (metaIndex.needs_review && metaIndex.needs_review.length > 0) {
    parts.push(`### Unresolved Conflicts (${metaIndex.needs_review.length})`);
    for (const item of metaIndex.needs_review.slice(0, 10)) {
      if (item.field && item.conflicting_values) {
        const values = item.conflicting_values.map((v: any) => flattenValue(v)).join(" vs ");
        parts.push(`- ${item.field}: ${values}`);
      }
    }
    if (metaIndex.needs_review.length > 10) {
      parts.push(`  ... ${metaIndex.needs_review.length - 10} more conflicts`);
    }
    parts.push("");
  }

  parts.push(`To read full details for any folder, use: read_file(".pi_tool/indexes/{FolderName}.json")`);

  let result = parts.join("\n");

  // If still too long, hard truncate
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) +
      "\n...\n[NOTE: Meta-index truncated. Use read_file(\".pi_tool/indexes/{FolderName}.json\") for per-folder details.]";
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDateRange(range: { earliest?: string; latest?: string }): string {
  if (range.earliest && range.latest && range.earliest !== range.latest) {
    return `${range.earliest} to ${range.latest}`;
  }
  return range.earliest || range.latest || "";
}

/**
 * Flatten a value to a single-line string for prompt rendering.
 */
function flattenValue(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return val.map(flattenValue).filter(Boolean).join(", ");
  }
  if (typeof val === "object") {
    // Flatten object to "key: value" pairs on a single line
    const entries = Object.entries(val)
      .map(([k, v]) => {
        const fv = flattenValue(v);
        return fv ? `${k}: ${fv}` : null;
      })
      .filter(Boolean);
    return entries.join("; ");
  }
  return String(val);
}

/**
 * Render a facts object (like summary) as flat Key: Value lines.
 */
function renderFlatFacts(parts: string[], obj: Record<string, any>, indent = ""): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      // Recurse into nested objects with indent
      parts.push(`${indent}${key}:`);
      renderFlatFacts(parts, value, indent + "  ");
    } else {
      parts.push(`${indent}${key}: ${flattenValue(value)}`);
    }
  }
}
