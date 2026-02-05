/**
 * Practice Area Module Types
 *
 * These interfaces define the contract for practice area modules.
 * Each practice area (PI, WC, etc.) implements these interfaces
 * to provide law-specific configuration without touching core code.
 */

import { z } from "zod";

/**
 * Configuration for a practice area module.
 * Each area provides its own document types, phases, prompts, and schemas.
 */
export interface PracticeAreaConfig {
  // Identity
  code: string;           // Short code: "PI", "WC"
  name: string;           // Display name: "Personal Injury", "Workers' Compensation"

  // Document taxonomy
  documentTypes: readonly string[];

  // Case lifecycle phases
  phases: readonly string[];

  // Extraction prompts (loaded from markdown files)
  extractionPrompt: string;
  extractionPromptWithTools: string;

  // Synthesis configuration
  synthesisPrompt?: string;
  synthesisSchema?: Record<string, unknown>;  // JSON Schema for synthesis tool

  // Zod schemas for validation (optional extensions to base schema)
  summaryExtensions?: z.ZodObject<any>;
}

/**
 * Registry for accessing practice area configurations.
 */
export interface PracticeAreaRegistry {
  /**
   * Get a practice area config by code (e.g., "PI", "WC").
   * Returns undefined if not found.
   */
  get(code: string): PracticeAreaConfig | undefined;

  /**
   * Get a practice area config by display name.
   * Returns undefined if not found.
   */
  getByName(name: string): PracticeAreaConfig | undefined;

  /**
   * Get the default practice area (Personal Injury).
   */
  getDefault(): PracticeAreaConfig;

  /**
   * List all registered practice areas.
   */
  list(): PracticeAreaConfig[];

  /**
   * Get all document types across all practice areas.
   * Includes shared types.
   */
  getAllDocumentTypes(): readonly string[];

  /**
   * Get document types for a specific practice area.
   * Includes shared types.
   */
  getDocumentTypesFor(code: string): readonly string[];
}

/**
 * Shared document types used across all practice areas.
 */
export const SHARED_DOC_TYPES = [
  "intake_form",
  "medical_record",
  "medical_bill",
  "correspondence",
  "authorization",
  "identification",
  "settlement",
  "lien",
  "other",
] as const;

export type SharedDocumentType = (typeof SHARED_DOC_TYPES)[number];
