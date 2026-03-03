import { readFile } from "fs/promises";
import { join } from "path";
import { PRACTICE_AREAS } from "../practice-areas";

export type PracticeAreaName =
  | typeof PRACTICE_AREAS.PI
  | typeof PRACTICE_AREAS.WC
  | typeof PRACTICE_AREAS.EC;

/**
 * Normalize any common practice-area representation to canonical display names.
 * Accepts short codes ("PI"/"WC") and common label variants.
 */
export function normalizePracticeArea(value: unknown): PracticeAreaName | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  if (
    normalized === "wc" ||
    normalized.includes("worker") ||
    normalized.includes("workers") ||
    normalized.includes("comp")
  ) {
    return PRACTICE_AREAS.WC;
  }

  if (
    normalized === "pi" ||
    normalized.includes("personal") ||
    normalized.includes("injury")
  ) {
    return PRACTICE_AREAS.PI;
  }

  if (
    normalized === "ec" ||
    normalized.includes("elder") ||
    normalized.includes("care")
  ) {
    return PRACTICE_AREAS.EC;
  }

  return undefined;
}

/**
 * Resolve a firm's practice area from folder metadata, preferring firm-config,
 * then falling back to knowledge manifest.
 */
export async function resolveFirmPracticeArea(
  firmRoot: string
): Promise<PracticeAreaName | undefined> {
  try {
    const firmConfigPath = join(firmRoot, ".ai_tool", "firm-config.json");
    const config = JSON.parse(await readFile(firmConfigPath, "utf-8"));
    const fromConfig = normalizePracticeArea(config?.practiceArea);
    if (fromConfig) return fromConfig;
  } catch {
    // Continue to manifest fallback.
  }

  try {
    const manifestPath = join(firmRoot, ".ai_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const fromManifest = normalizePracticeArea(manifest?.practiceArea);
    if (fromManifest) return fromManifest;
  } catch {
    // No configured area.
  }

  return undefined;
}
