"use strict";
/**
 * Workers' Compensation Practice Area Configuration
 *
 * This module defines all WC-specific document types, case phases,
 * and other configuration. Core code imports from here rather than
 * hardcoding WC-specific values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WC_METADATA = exports.WC_PHASES = exports.WC_DOC_TYPES = void 0;
/**
 * WC-specific document types.
 * These are in addition to the shared types defined in ../types.ts
 */
exports.WC_DOC_TYPES = [
    "c4_claim", // Employee's Claim for Compensation (C-4)
    "c3_employer_report", // Employer's First Report of Injury (C-3)
    "c4_supplemental", // Supplemental claim form
    "ime_report", // Independent Medical Examination
    "fce_report", // Functional Capacity Evaluation
    "work_status_report", // ATP work status/restrictions
    "ppd_rating", // PPD rating report
    "vocational_report", // Vocational rehabilitation report
    "wage_statement", // Wage documentation
    "d9_form", // Request for Hearing
    "hearing_notice", // Notice of hearing
    "hearing_decision", // AO/HO decision and order
    "d16_form", // Petition to Reopen
    "aoe_coe_investigation", // Compensability investigation
    "utilization_review", // UR decision
];
/**
 * WC case lifecycle phases.
 */
exports.WC_PHASES = [
    "Intake",
    "Investigation",
    "Treatment",
    "MMI Evaluation",
    "Benefits Resolution",
    "Settlement/Hearing",
    "Closed",
];
/**
 * WC practice area metadata.
 */
exports.WC_METADATA = {
    code: "WC",
    name: "Workers' Compensation",
    description: "Workplace injuries, occupational diseases, and cumulative trauma claims",
};
