import { resolve, relative } from "path";
import { realpath } from "fs/promises";

/**
 * Check if a path is within the allowed boundary.
 * Handles relative paths, ../ traversal, and symlinks.
 */
export async function isPathWithinBounds(
  targetPath: string,
  boundaryPath: string,
  cwd: string
): Promise<boolean> {
  try {
    // Resolve the target path (handles relative paths and ../)
    const resolvedTarget = resolve(cwd, targetPath);

    // Get real paths to handle symlinks
    const realBoundary = await realpath(boundaryPath).catch(() => boundaryPath);

    // Check if resolved path starts with boundary
    const relativePath = relative(realBoundary, resolvedTarget);

    // If relative path starts with "..", it's outside the boundary
    return !relativePath.startsWith("..") && !relativePath.startsWith("/");
  } catch {
    return false; // Deny on any error
  }
}

/**
 * Extract file paths from a bash command (basic extraction).
 */
export function extractPathsFromBash(command: string): string[] {
  const paths: string[] = [];

  // Match common file operation patterns
  const patterns = [
    /(?:>|>>)\s*["']?([^"'\s|&;]+)/g,     // Redirects: > file, >> file
    /(?:mkdir|touch|rm|mv|cp)\s+(?:-[^\s]+\s+)*["']?([^"'\s|&;]+)/g,  // File commands
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      if (match[1]) paths.push(match[1]);
    }
  }

  return paths;
}
