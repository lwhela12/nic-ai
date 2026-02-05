/**
 * Personal Injury Practice Area Configuration
 *
 * This module defines all PI-specific document types, case phases,
 * and other configuration. Core code imports from here rather than
 * hardcoding PI-specific values.
 */

/**
 * PI-specific document types.
 * These are in addition to the shared types defined in ../types.ts
 */
export const PI_DOC_TYPES = [
  "lor",                    // Letter of Representation
  "declaration",            // Insurance declarations page
  "police_report",          // Accident/police reports
  "demand",                 // Demand letter
  "balance_request",        // Balance confirmation requests
  "balance_confirmation",   // Confirmed balances from providers
  "property_damage",        // Vehicle repair estimates, rental receipts
] as const;

export type PIDocumentType = (typeof PI_DOC_TYPES)[number];

/**
 * PI case lifecycle phases.
 */
export const PI_PHASES = [
  "Intake",
  "Investigation",
  "Treatment",
  "Demand",
  "Negotiation",
  "Settlement",
  "Complete",
] as const;

export type PICasePhase = (typeof PI_PHASES)[number];

/**
 * PI practice area metadata.
 */
export const PI_METADATA = {
  code: "PI",
  name: "Personal Injury",
  description: "Motor vehicle accidents, premises liability, and other personal injury claims",
} as const;
