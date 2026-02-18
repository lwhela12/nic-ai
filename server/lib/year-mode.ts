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
  return /^(19|20)\d{2}$/.test(name);
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
 * Returns true if the majority of direct children of firmRoot are year folders.
 */
export async function detectYearBasedMode(firmRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(firmRoot, { withFileTypes: true });
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".")
    );
    if (dirs.length === 0) return false;
    const yearCount = dirs.filter((e) => isYearFolder(e.name)).length;
    return yearCount > 0 && yearCount / dirs.length >= 0.5;
  } catch {
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
 * Walk all year folders, group clients by exact name, create .ai_tool/clients/<slug>/ dirs.
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

  for (const yearDir of yearDirs) {
    const yearPath = join(firmRoot, yearDir.name);
    let clients: Awaited<ReturnType<typeof readdir>>;
    try {
      clients = await readdir(yearPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const client of clients) {
      if (!client.isDirectory() || client.name.startsWith(".")) continue;

      const slug = slugify(client.name);
      const relFolder = `${yearDir.name}/${client.name}`;

      if (!registry.clients[slug]) {
        registry.clients[slug] = {
          name: client.name,
          slug,
          sourceFolders: [],
        };
      }

      if (!registry.clients[slug].sourceFolders.includes(relFolder)) {
        registry.clients[slug].sourceFolders.push(relFolder);
      }
    }
  }

  // Sort source folders chronologically for each client
  for (const entry of Object.values(registry.clients)) {
    entry.sourceFolders.sort();
  }

  // Ensure .ai_tool/clients/<slug>/ directories exist
  for (const entry of Object.values(registry.clients)) {
    const clientDir = join(firmRoot, AI_TOOL_DIR, CLIENTS_DIR, entry.slug);
    await mkdir(clientDir, { recursive: true });
  }

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
