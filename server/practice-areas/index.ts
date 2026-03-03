/**
 * Practice Areas Registry
 *
 * Central registry for all practice area modules.
 * Core code uses this registry to access practice-area-specific
 * configuration without hardcoding law-specific values.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { PracticeAreaConfig, PracticeAreaRegistry } from "./types";
import { SHARED_DOC_TYPES } from "./types";
import { PI_DOC_TYPES, PI_PHASES, PI_METADATA } from "./personal-injury/config";
import { WC_DOC_TYPES, WC_PHASES, WC_METADATA } from "./workers-comp/config";

// Get directory path for loading markdown files
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a markdown prompt file for a practice area.
 * Returns empty string if file doesn't exist.
 */
const EC_METADATA = { code: "EC", name: "Elder Care" };

function loadPrompt(areaCode: string, filename: string): string {
  const areaDirMap: Record<string, string> = { PI: "personal-injury", WC: "workers-comp" };
  const areaDir = areaDirMap[areaCode];
  if (!areaDir) return "";
  const promptPath = join(__dirname, areaDir, filename);

  if (!existsSync(promptPath)) {
    console.warn(`[PracticeAreas] Prompt file not found: ${promptPath}`);
    return "";
  }

  try {
    return readFileSync(promptPath, "utf-8");
  } catch (err) {
    console.error(`[PracticeAreas] Error loading prompt: ${promptPath}`, err);
    return "";
  }
}

/**
 * Build the full practice area config by loading prompts from files.
 */
function buildConfig(
  metadata: { code: string; name: string },
  documentTypes: readonly string[],
  phases: readonly string[]
): PracticeAreaConfig {
  return {
    code: metadata.code,
    name: metadata.name,
    documentTypes,
    phases,
    extractionPrompt: loadPrompt(metadata.code, "extraction.md"),
    extractionPromptWithTools: loadPrompt(metadata.code, "extraction-with-tools.md"),
    synthesisPrompt: loadPrompt(metadata.code, "synthesis.md"),
  };
}

// Build configs (prompts loaded lazily on first access)
let _piConfig: PracticeAreaConfig | null = null;
let _wcConfig: PracticeAreaConfig | null = null;
let _ecConfig: PracticeAreaConfig | null = null;

function getPIConfig(): PracticeAreaConfig {
  if (!_piConfig) {
    _piConfig = buildConfig(PI_METADATA, PI_DOC_TYPES, PI_PHASES);
  }
  return _piConfig;
}

function getWCConfig(): PracticeAreaConfig {
  if (!_wcConfig) {
    _wcConfig = buildConfig(WC_METADATA, WC_DOC_TYPES, WC_PHASES);
  }
  return _wcConfig;
}

function getECConfig(): PracticeAreaConfig {
  if (!_ecConfig) {
    _ecConfig = buildConfig(EC_METADATA, SHARED_DOC_TYPES, []);
  }
  return _ecConfig;
}

/**
 * Practice area registry implementation.
 */
export const practiceAreaRegistry: PracticeAreaRegistry = {
  get(code: string): PracticeAreaConfig | undefined {
    const upperCode = code.toUpperCase();
    if (upperCode === "PI") return getPIConfig();
    if (upperCode === "WC") return getWCConfig();
    if (upperCode === "EC") return getECConfig();
    return undefined;
  },

  getByName(name: string): PracticeAreaConfig | undefined {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("personal") || lowerName.includes("injury")) {
      return getPIConfig();
    }
    if (lowerName.includes("worker") || lowerName.includes("compensation")) {
      return getWCConfig();
    }
    if (lowerName.includes("elder") || lowerName.includes("care")) {
      return getECConfig();
    }
    return undefined;
  },

  getDefault(): PracticeAreaConfig {
    return getECConfig();
  },

  list(): PracticeAreaConfig[] {
    return [getPIConfig(), getWCConfig(), getECConfig()];
  },

  getAllDocumentTypes(): readonly string[] {
    return [...SHARED_DOC_TYPES, ...PI_DOC_TYPES, ...WC_DOC_TYPES];
  },

  getDocumentTypesFor(code: string): readonly string[] {
    const upperCode = code.toUpperCase();
    if (upperCode === "PI") {
      return [...SHARED_DOC_TYPES, ...PI_DOC_TYPES];
    }
    if (upperCode === "WC") {
      return [...SHARED_DOC_TYPES, ...WC_DOC_TYPES];
    }
    // Default to all types
    return this.getAllDocumentTypes();
  },
};

// Re-export types and shared constants
export * from "./types";
export { PI_DOC_TYPES, PI_PHASES } from "./personal-injury/config";
export { WC_DOC_TYPES, WC_PHASES } from "./workers-comp/config";

/**
 * Convenience constants matching the old PRACTICE_AREAS object.
 * For backward compatibility during migration.
 */
export const PRACTICE_AREAS = {
  PI: "Personal Injury",
  WC: "Workers' Compensation",
  EC: "Elder Care",
} as const;
