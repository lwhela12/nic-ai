"use strict";
/**
 * Practice Area Module Types
 *
 * These interfaces define the contract for practice area modules.
 * Each practice area (PI, WC, etc.) implements these interfaces
 * to provide law-specific configuration without touching core code.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHARED_DOC_TYPES = void 0;
/**
 * Shared document types used across all practice areas.
 */
exports.SHARED_DOC_TYPES = [
    "intake_form",
    "medical_record",
    "medical_bill",
    "correspondence",
    "authorization",
    "identification",
    "settlement",
    "lien",
    "other",
];
