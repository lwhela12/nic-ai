"use strict";
/**
 * Personal Injury Practice Area Configuration
 *
 * This module defines all PI-specific document types, case phases,
 * and other configuration. Core code imports from here rather than
 * hardcoding PI-specific values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PI_METADATA = exports.PI_PHASES = exports.PI_DOC_TYPES = void 0;
/**
 * PI-specific document types.
 * These are in addition to the shared types defined in ../types.ts
 */
exports.PI_DOC_TYPES = [
    "lor", // Letter of Representation
    "declaration", // Insurance declarations page
    "police_report", // Accident/police reports
    "demand", // Demand letter
    "balance_request", // Balance confirmation requests
    "balance_confirmation", // Confirmed balances from providers
    "property_damage", // Vehicle repair estimates, rental receipts
];
/**
 * PI case lifecycle phases.
 */
exports.PI_PHASES = [
    "Intake",
    "Investigation",
    "Treatment",
    "Demand",
    "Negotiation",
    "Settlement",
    "Complete",
];
/**
 * PI practice area metadata.
 */
exports.PI_METADATA = {
    code: "PI",
    name: "Personal Injury",
    description: "Motor vehicle accidents, premises liability, and other personal injury claims",
};
