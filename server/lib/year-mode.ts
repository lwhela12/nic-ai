/**
 * Year-Based Folder Structure Support
 *
 * Detects and manages firms organized by year: Root/2024/Smith, John/, Root/2025/Smith, John/
 * Creates virtual case folders under .ai_tool/clients/<slug>/ with unified .ai_tool/ directories.
 */

import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, dirname, sep, resolve } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientRegistryEntry {
  name: string;           // "Smith, John"
  slug: string;           // "smith-john"
  sourceFolders: string[]; // ["2024/Smith, John", "2025/Smith, John"]
  fileCount?: number;     // total files across all source folders
}

export interface ClientRegistry {
  mode: "year-based";
  firmRoot: string;
  clients: Record<string, ClientRegistryEntry>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isYearFolder(name: string): boolean {
  return /^(19|20)\d{2}(\s|$)/.test(name);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if at least 2 direct children of firmRoot are year folders.
 */
export async function detectYearBasedMode(firmRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(firmRoot, { withFileTypes: true });
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".")
    );
    const yearCount = dirs.filter((e) => isYearFolder(e.name)).length;
    const result = yearCount >= 2;
    console.log(
      `[year-mode] detect: ${dirs.length} dirs, ${yearCount} year folders → ${result ? "YEAR MODE" : "flat mode"}`,
      dirs.map((d) => d.name)
    );
    return result;
  } catch (err) {
    console.error("[year-mode] detect error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

const AI_TOOL_DIR = ".ai_tool";
const REGISTRY_FILE = "client-registry.json";
const CLIENTS_DIR = "clients";

function registryPath(firmRoot: string): string {
  return join(firmRoot, AI_TOOL_DIR, REGISTRY_FILE);
}

export async function loadClientRegistry(
  firmRoot: string
): Promise<ClientRegistry | null> {
  try {
    const content = await readFile(registryPath(firmRoot), "utf-8");
    return JSON.parse(content) as ClientRegistry;
  } catch {
    return null;
  }
}

async function saveClientRegistry(
  firmRoot: string,
  registry: ClientRegistry
): Promise<void> {
  const dir = join(firmRoot, AI_TOOL_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(registryPath(firmRoot), JSON.stringify(registry, null, 2));
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Count files in a directory recursively (excludes .ai_tool and dot-files).
 */
async function countDirFiles(dir: string): Promise<number> {
  let count = 0;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name === AI_TOOL_DIR || e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      count += await countDirFiles(join(dir, e.name));
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Walk all year folders, group clients by exact name, count files,
 * and create .ai_tool/clients/<slug>/ dirs.
 */
export async function scanAndBuildRegistry(
  firmRoot: string
): Promise<ClientRegistry> {
  const registry: ClientRegistry = {
    mode: "year-based",
    firmRoot,
    clients: {},
  };

  const entries = await readdir(firmRoot, { withFileTypes: true });
  const yearDirs = entries.filter(
    (e) => e.isDirectory() && isYearFolder(e.name)
  );

  // Read all year folders in parallel
  const yearResults = await Promise.all(
    yearDirs.map(async (yearDir) => {
      const yearPath = join(firmRoot, yearDir.name);
      let clients: Awaited<ReturnType<typeof readdir>>;
      try {
        clients = await readdir(yearPath, { withFileTypes: true });
      } catch {
        return [];
      }
      return clients
        .filter((c) => c.isDirectory() && !c.name.startsWith("."))
        .map((c) => ({ yearName: yearDir.name, clientName: c.name }));
    })
  );

  // Build registry from parallel results
  for (const yearClients of yearResults) {
    for (const { yearName, clientName } of yearClients) {
      const slug = slugify(clientName);
      const relFolder = `${yearName}/${clientName}`;

      if (!registry.clients[slug]) {
        registry.clients[slug] = {
          name: clientName,
          slug,
          sourceFolders: [],
        };
      }

      if (!registry.clients[slug].sourceFolders.includes(relFolder)) {
        registry.clients[slug].sourceFolders.push(relFolder);
      }
    }
  }

  // Sort source folders chronologically
  for (const entry of Object.values(registry.clients)) {
    entry.sourceFolders.sort();
  }

  // Count files and create client dirs in parallel
  await Promise.all(
    Object.values(registry.clients).map(async (entry) => {
      // Count files across all source folders
      const counts = await Promise.all(
        entry.sourceFolders.map((rel) => countDirFiles(join(firmRoot, rel)))
      );
      entry.fileCount = counts.reduce((a, b) => a + b, 0);

      // Ensure virtual client dir exists
      await mkdir(join(firmRoot, AI_TOOL_DIR, CLIENTS_DIR, entry.slug), {
        recursive: true,
      });
    })
  );

  console.log(
    `[year-mode] scanned ${yearDirs.length} year folders → ${Object.keys(registry.clients).length} clients`
  );

  await saveClientRegistry(firmRoot, registry);
  return registry;
}

/**
 * Re-scan and detect new clients or new year entries for existing clients.
 */
export async function refreshRegistry(
  firmRoot: string
): Promise<{ added: string[]; updated: string[] }> {
  const existing = await loadClientRegistry(firmRoot);
  const fresh = await scanAndBuildRegistry(firmRoot);

  const added: string[] = [];
  const updated: string[] = [];

  for (const [slug, entry] of Object.entries(fresh.clients)) {
    if (!existing?.clients[slug]) {
      added.push(entry.name);
    } else {
      const oldFolders = new Set(existing.clients[slug].sourceFolders);
      const hasNew = entry.sourceFolders.some((f) => !oldFolders.has(f));
      if (hasNew) updated.push(entry.name);
    }
  }

  return { added, updated };
}

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

const AI_TOOL_CLIENTS_SEGMENT = `${AI_TOOL_DIR}${sep}${CLIENTS_DIR}${sep}`;
const AI_TOOL_CLIENTS_SEGMENT_FWD = `${AI_TOOL_DIR}/${CLIENTS_DIR}/`;

/**
 * If caseFolder is a virtual path like /Root/.ai_tool/clients/smith-john/,
 * walk up to find the firm root. Otherwise fall back to dirname(caseFolder).
 */
export function resolveFirmRoot(caseFolder: string): string {
  const normalized = caseFolder.replace(/\\/g, "/");
  const idx = normalized.indexOf(`/${AI_TOOL_DIR}/${CLIENTS_DIR}/`);
  if (idx !== -1) {
    return normalized.slice(0, idx);
  }
  // Also check without leading slash for relative paths
  if (normalized.startsWith(`${AI_TOOL_DIR}/${CLIENTS_DIR}/`)) {
    return ".";
  }
  return dirname(caseFolder);
}

/**
 * Extract slug from a .ai_tool/clients/<slug>/ virtual path, or null if not virtual.
 */
export function getClientSlug(caseFolder: string): string | null {
  const normalized = caseFolder.replace(/\\/g, "/");
  const marker = `/${AI_TOOL_DIR}/${CLIENTS_DIR}/`;
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  const afterMarker = normalized.slice(idx + marker.length);
  // slug is everything up to the next slash (or end)
  const slug = afterMarker.split("/")[0];
  return slug || null;
}

/**
 * Return absolute paths for all source folders of a client.
 */
export function getSourceFolders(
  firmRoot: string,
  registry: ClientRegistry,
  slug: string
): string[] {
  const entry = registry.clients[slug];
  if (!entry) return [];
  return entry.sourceFolders.map((rel) => join(firmRoot, rel));
}

/**
 * Resolve a year-prefixed relative path back to its absolute location.
 * e.g. "2024/Medical/report.pdf" → "/Root/2024/Smith, John/Medical/report.pdf"
 *
 * The first path segment is the year, the rest is relative within that year's client folder.
 */
export function resolveYearFilePath(
  firmRoot: string,
  registry: ClientRegistry,
  slug: string,
  relativePath: string
): string {
  const entry = registry.clients[slug];
  if (!entry) return join(firmRoot, relativePath);

  const parts = relativePath.replace(/\\/g, "/").split("/");
  const yearPart = parts[0];
  const restParts = parts.slice(1);

  // Find the source folder that starts with this year
  const sourceFolder = entry.sourceFolders.find((sf) =>
    sf.startsWith(yearPart + "/")
  );
  if (sourceFolder) {
    return join(firmRoot, sourceFolder, ...restParts);
  }

  // Fallback — try direct resolution
  return join(firmRoot, relativePath);
}

// ---------------------------------------------------------------------------
// File Listing
// ---------------------------------------------------------------------------

/**
 * Walk all source folders for a client, returning year-prefixed relative paths.
 * e.g. ["2024/Medical/report.pdf", "2025/Hearing/notice.pdf"]
 */
export async function listYearBasedCaseFiles(
  firmRoot: string,
  registry: ClientRegistry,
  slug: string
): Promise<string[]> {
  const entry = registry.clients[slug];
  if (!entry) return [];

  const allFiles: string[] = [];

  for (const relSourceFolder of entry.sourceFolders) {
    const absFolder = join(firmRoot, relSourceFolder);
    // relSourceFolder is e.g. "2024/Smith, John"
    // We want the year prefix: "2024"
    const yearPrefix = relSourceFolder.split("/")[0];

    async function walkDir(dir: string, base: string) {
      let entries: Awaited<ReturnType<typeof readdir>>;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === ".ai_tool" || entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        const relativePath = base ? `${base}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walkDir(fullPath, relativePath);
        } else {
          // Prefix with year: "2024/Medical/report.pdf"
          allFiles.push(`${yearPrefix}/${relativePath}`);
        }
      }
    }

    await walkDir(absFolder, "");
  }

  return allFiles;
}

/**
 * Build a file tree for all source folders of a client, grouped by year at top level.
 * Returns the same tree structure as the existing walkDir in files.ts.
 */
export async function walkYearBasedFiles(
  firmRoot: string,
  registry: ClientRegistry,
  slug: string
): Promise<any[]> {
  const entry = registry.clients[slug];
  if (!entry) return [];

  const yearNodes: any[] = [];

  for (const relSourceFolder of entry.sourceFolders) {
    const absFolder = join(firmRoot, relSourceFolder);
    const yearPrefix = relSourceFolder.split("/")[0];

    async function walkDir(dir: string, base: string): Promise<any[]> {
      const results: any[] = [];
      let entries: Awaited<ReturnType<typeof readdir>>;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return results;
      }

      for (const dirEntry of entries) {
        if (dirEntry.name === ".ai_tool" || dirEntry.name.startsWith("."))
          continue;
        // Also skip common system/temp files
        if (
          dirEntry.name === ".DS_Store" ||
          dirEntry.name === "Thumbs.db" ||
          dirEntry.name.startsWith("._")
        )
          continue;

        const fullPath = join(dir, dirEntry.name);
        const relativePath = base
          ? `${base}/${dirEntry.name}`
          : dirEntry.name;

        if (dirEntry.isDirectory()) {
          const children = await walkDir(fullPath, relativePath);
          results.push({
            name: dirEntry.name,
            type: "folder",
            path: `${yearPrefix}/${relativePath}`,
            children,
          });
        } else {
          const stats = await stat(fullPath);
          results.push({
            name: dirEntry.name,
            type: "file",
            path: `${yearPrefix}/${relativePath}`,
            size: stats.size,
            modified: stats.mtime,
          });
        }
      }

      return results;
    }

    const children = await walkDir(absFolder, "");
    yearNodes.push({
      name: yearPrefix,
      type: "folder",
      path: yearPrefix,
      children,
    });
  }

  // Sort year nodes chronologically
  yearNodes.sort((a, b) => a.name.localeCompare(b.name));
  return yearNodes;
}
