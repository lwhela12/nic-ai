/**
 * Backward-compatible migration: rename .pi_tool → .ai_tool
 *
 * Called once per folder when accessed. If .pi_tool exists and .ai_tool does not,
 * renames the directory. If both exist, leaves them as-is (manual resolution needed).
 */

import { rename, stat } from "fs/promises";
import { join } from "path";

const OLD_DIR = ".pi_tool";
const NEW_DIR = ".ai_tool";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate a single folder's .pi_tool to .ai_tool if needed.
 * Returns true if migration occurred, false if no action taken.
 */
export async function migratePiTool(folderPath: string): Promise<boolean> {
  const oldPath = join(folderPath, OLD_DIR);
  const newPath = join(folderPath, NEW_DIR);

  // Skip if old dir doesn't exist or new dir already exists
  if (!(await pathExists(oldPath))) return false;
  if (await pathExists(newPath)) return false;

  try {
    await rename(oldPath, newPath);
    console.log(`[migrate] Renamed ${oldPath} → ${newPath}`);
    return true;
  } catch (err) {
    console.error(`[migrate] Failed to rename ${oldPath}:`, err);
    return false;
  }
}
