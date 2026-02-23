"use strict";
/**
 * Canonical Document Index Schema
 *
 * This is the SINGLE SOURCE OF TRUTH for document_index.json structure.
 * All extraction output flows through normalizeIndex() before being written.
 * The UI can trust this schema completely - no defensive coding needed.
 *
 * PRACTICE AREA SUPPORT:
 * - Personal Injury (PI): Original schema, default when practice_area is undefined
 * - Workers' Compensation (WC): Extended schema with WC-specific fields
 *
 * Backward compatibility: Indexes without practice_area field are treated as PI.
 *
 * NOTE: Document types and phases are now defined in practice-areas modules
 * and imported here for backward compatibility.
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_EXTRACTION_TOOL_SCHEMA = exports.WC_DOC_TYPES = exports.PI_DOC_TYPES = exports.SHARED_DOC_TYPES = exports.ALL_DOC_TYPES = exports.DocumentIndexSchema = exports.ClaimTypeSchema = exports.CompensabilitySchema = exports.ContainerInfoSchema = exports.AssignmentSchema = exports.RelatedCaseSchema = exports.LinkedCaseSchema = exports.InjuryTierSchema = exports.LiabilitySchema = exports.WC_PHASES = exports.PI_PHASES = exports.CasePhaseSchema = exports.ALL_PHASES = exports.ErrataSchema = exports.NeedsReviewSchema = exports.FolderSchema = exports.FileEntrySchema = exports.SummarySchema = exports.DisabilityStatusSchema = exports.WCCarrierSchema = exports.EmployerSchema = exports.PolicyLimitDetailSchema = exports.HealthInsuranceSchema = exports.ContactSchema = exports.AddressSchema = exports.PracticeAreaSchema = exports.PRACTICE_AREAS = void 0;
exports.getPracticeArea = getPracticeArea;
exports.isWorkersComp = isWorkersComp;
exports.getPhasesForPracticeArea = getPhasesForPracticeArea;
exports.getDefaultPhase = getDefaultPhase;
exports.getDocTypesForPracticeArea = getDocTypesForPracticeArea;
exports.parseAmount = parseAmount;
exports.parseAddress = parseAddress;
exports.normalizePolicyLimits = normalizePolicyLimits;
exports.normalizeProviders = normalizeProviders;
exports.normalizeFolders = normalizeFolders;
exports.normalizeHealthInsurance = normalizeHealthInsurance;
exports.normalizeContact = normalizeContact;
exports.normalizeClaimNumbers = normalizeClaimNumbers;
exports.normalizeEmployer = normalizeEmployer;
exports.normalizeWCCarrier = normalizeWCCarrier;
exports.normalizeDisabilityStatus = normalizeDisabilityStatus;
exports.normalizeIndex = normalizeIndex;
exports.validateIndex = validateIndex;
var zod_1 = require("zod");
// Import from practice-areas modules (source of truth for law-specific config)
var types_1 = require("../practice-areas/types");
Object.defineProperty(exports, "SHARED_DOC_TYPES", { enumerable: true, get: function () { return types_1.SHARED_DOC_TYPES; } });
var config_1 = require("../practice-areas/personal-injury/config");
Object.defineProperty(exports, "PI_DOC_TYPES", { enumerable: true, get: function () { return config_1.PI_DOC_TYPES; } });
Object.defineProperty(exports, "PI_PHASES", { enumerable: true, get: function () { return config_1.PI_PHASES; } });
var config_2 = require("../practice-areas/workers-comp/config");
Object.defineProperty(exports, "WC_DOC_TYPES", { enumerable: true, get: function () { return config_2.WC_DOC_TYPES; } });
Object.defineProperty(exports, "WC_PHASES", { enumerable: true, get: function () { return config_2.WC_PHASES; } });
// =============================================================================
// PRACTICE AREA DEFINITIONS
// =============================================================================
exports.PRACTICE_AREAS = {
    PI: "Personal Injury",
    WC: "Workers' Compensation",
};
exports.PracticeAreaSchema = zod_1.z.enum([
    exports.PRACTICE_AREAS.PI,
    exports.PRACTICE_AREAS.WC,
]);
// =============================================================================
// SHARED SCHEMA DEFINITIONS
// =============================================================================
exports.AddressSchema = zod_1.z.object({
    street: zod_1.z.string().optional(),
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    zip: zod_1.z.string().optional(),
});
exports.ContactSchema = zod_1.z.object({
    phone: zod_1.z.string().optional(),
    email: zod_1.z.string().optional(),
    address: exports.AddressSchema.optional(),
});
exports.HealthInsuranceSchema = zod_1.z.object({
    carrier: zod_1.z.string().optional(),
    group_no: zod_1.z.string().optional(),
    member_no: zod_1.z.string().optional(),
});
// =============================================================================
// PERSONAL INJURY SPECIFIC SCHEMAS
// =============================================================================
exports.PolicyLimitDetailSchema = zod_1.z.object({
    carrier: zod_1.z.string(),
    bodily_injury: zod_1.z.string().optional(),
    medical_payments: zod_1.z.string().optional(),
    um_uim: zod_1.z.string().optional(),
    property_damage: zod_1.z.string().optional(),
    adjuster_name: zod_1.z.string().optional(),
    adjuster_phone: zod_1.z.string().optional(),
    adjuster_email: zod_1.z.string().optional(),
});
// =============================================================================
// WORKERS' COMPENSATION SPECIFIC SCHEMAS
// =============================================================================
exports.EmployerSchema = zod_1.z.object({
    name: zod_1.z.string(),
    address: exports.AddressSchema.optional(),
    phone: zod_1.z.string().optional(),
    contact_name: zod_1.z.string().optional(),
});
exports.WCCarrierSchema = zod_1.z.object({
    name: zod_1.z.string(),
    claim_number: zod_1.z.string().optional(),
    adjuster_name: zod_1.z.string().optional(),
    adjuster_phone: zod_1.z.string().optional(),
    adjuster_email: zod_1.z.string().optional(),
    tpa_name: zod_1.z.string().optional(), // Third Party Administrator
});
exports.DisabilityStatusSchema = zod_1.z.object({
    type: zod_1.z.enum(["TTD", "TPD", "PPD", "PTD"]).optional(), // Temporary Total, Temporary Partial, Permanent Partial, Permanent Total
    amw: zod_1.z.number().optional(), // Average Monthly Wage
    compensation_rate: zod_1.z.number().optional(), // Weekly benefit rate
    mmi_date: zod_1.z.string().optional(), // Maximum Medical Improvement date
    ppd_rating: zod_1.z.number().optional(), // Permanent Partial Disability percentage
    ppd_weeks: zod_1.z.number().optional(), // Weeks of PPD benefits
    return_to_work_date: zod_1.z.string().optional(),
    work_restrictions: zod_1.z.string().optional(),
});
// =============================================================================
// UNIFIED SUMMARY SCHEMA
// =============================================================================
exports.SummarySchema = zod_1.z.object({
    // Common fields (all practice areas)
    client: zod_1.z.string(),
    dob: zod_1.z.string().optional(),
    providers: zod_1.z.array(zod_1.z.string()),
    total_charges: zod_1.z.number(),
    contact: exports.ContactSchema.optional(),
    health_insurance: exports.HealthInsuranceSchema.optional(),
    case_summary: zod_1.z.string(),
    // Incident date - stored as "incident_date" but accepts dol/doi on input
    incident_date: zod_1.z.string(),
    // PI-specific fields (optional, only populated for PI cases)
    policy_limits: zod_1.z.record(zod_1.z.string(), exports.PolicyLimitDetailSchema).optional(),
    claim_numbers: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(), // 1P/3P claim numbers
    // WC-specific fields (optional, only populated for WC cases)
    employer: exports.EmployerSchema.optional(),
    wc_carrier: exports.WCCarrierSchema.optional(),
    disability_status: exports.DisabilityStatusSchema.optional(),
    job_title: zod_1.z.string().optional(),
    injury_description: zod_1.z.string().optional(),
    body_parts: zod_1.z.array(zod_1.z.string()).optional(), // Affected body parts
});
exports.FileEntrySchema = zod_1.z.object({
    filename: zod_1.z.string(),
    type: zod_1.z.string(),
    key_info: zod_1.z.string(),
    date: zod_1.z.string().optional(),
    issues: zod_1.z.string().optional(),
    has_handwritten_data: zod_1.z.boolean().optional(),
    handwritten_fields: zod_1.z.array(zod_1.z.string()).optional(),
    user_reviewed: zod_1.z.boolean().optional(),
    reviewed_at: zod_1.z.string().optional(),
    review_notes: zod_1.z.string().optional(),
    extracted_data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
exports.FolderSchema = zod_1.z.object({
    files: zod_1.z.array(exports.FileEntrySchema),
});
exports.NeedsReviewSchema = zod_1.z.object({
    field: zod_1.z.string(),
    conflicting_values: zod_1.z.array(zod_1.z.string()),
    sources: zod_1.z.array(zod_1.z.string()),
    reason: zod_1.z.string(),
});
exports.ErrataSchema = zod_1.z.object({
    field: zod_1.z.string(),
    decision: zod_1.z.string(),
    evidence: zod_1.z.string(),
    confidence: zod_1.z.enum(["high", "medium", "low"]),
});
// =============================================================================
// CASE PHASE SCHEMAS (Practice Area Specific)
// Phases are imported from practice-areas modules
// =============================================================================
// Combined for schema validation (accepts either PI or WC phases)
exports.ALL_PHASES = __spreadArray([], new Set(__spreadArray(__spreadArray([], config_1.PI_PHASES, true), config_2.WC_PHASES, true)), true);
exports.CasePhaseSchema = zod_1.z.enum(exports.ALL_PHASES);
// =============================================================================
// PI-SPECIFIC ASSESSMENT SCHEMAS
// =============================================================================
exports.LiabilitySchema = zod_1.z.enum(["clear", "moderate", "contested"]);
exports.InjuryTierSchema = zod_1.z.enum([
    "tier_1_soft_tissue",
    "tier_2_structural",
    "tier_3_surgical",
]);
// Linked case relationship schema
exports.LinkedCaseSchema = zod_1.z.object({
    path: zod_1.z.string(),
    name: zod_1.z.string(),
});
exports.RelatedCaseSchema = zod_1.z.object({
    path: zod_1.z.string(),
    name: zod_1.z.string(),
    type: zod_1.z.enum(["subcase", "sibling", "doi_sibling"]),
    dateOfInjury: zod_1.z.string().optional(), // For DOI siblings: injury date from folder name
});
exports.AssignmentSchema = zod_1.z.object({
    userId: zod_1.z.string(),
    assignedAt: zod_1.z.string(),
    assignedBy: zod_1.z.string(),
});
// =============================================================================
// DOI CONTAINER SCHEMA (for multi-injury WC clients)
// =============================================================================
/**
 * Container info for clients with multiple DOI subfolders.
 * Stored in ClientName/.ai_tool/container_info.json
 */
exports.ContainerInfoSchema = zod_1.z.object({
    clientName: zod_1.z.string(),
    practiceArea: exports.PracticeAreaSchema.optional(),
    contact: exports.ContactSchema.optional(),
    sharedFolders: zod_1.z.array(zod_1.z.string()).optional(), // Non-DOI folders that were indexed
    doiCases: zod_1.z.array(zod_1.z.object({
        path: zod_1.z.string(),
        dateOfInjury: zod_1.z.string(), // YYYY-MM-DD from DOI folder name
        indexed: zod_1.z.boolean().optional(),
    })).optional(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string().optional(),
});
// =============================================================================
// WC-SPECIFIC ASSESSMENT SCHEMAS
// =============================================================================
exports.CompensabilitySchema = zod_1.z.enum([
    "clearly_compensable", // AOE/COE clear, no defenses
    "likely_compensable", // Minor issues but should prevail
    "disputed", // Significant compensability questions
    "denied", // Carrier has denied, appeal needed
]);
exports.ClaimTypeSchema = zod_1.z.enum([
    "specific_injury", // Single incident
    "occupational_disease", // Illness from work exposure
    "cumulative_trauma", // Repetitive stress/injury over time
]);
// =============================================================================
// DOCUMENT INDEX SCHEMA
// =============================================================================
exports.DocumentIndexSchema = zod_1.z.object({
    // Core fields
    indexed_at: zod_1.z.string(),
    case_name: zod_1.z.string(),
    practice_area: exports.PracticeAreaSchema.optional(), // Undefined = PI (backward compat)
    case_phase: exports.CasePhaseSchema,
    summary: exports.SummarySchema,
    folders: zod_1.z.record(zod_1.z.string(), exports.FolderSchema),
    // Processing metadata
    failed_files: zod_1.z
        .array(zod_1.z.object({
        filename: zod_1.z.string(),
        folder: zod_1.z.string(),
        error: zod_1.z.string().optional(),
        failed_at: zod_1.z.string().optional(),
    }))
        .optional(),
    issues_found: zod_1.z.array(zod_1.z.string()).optional(),
    needs_review: zod_1.z.array(exports.NeedsReviewSchema).optional(),
    errata: zod_1.z.array(exports.ErrataSchema).optional(),
    reconciled_values: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    case_analysis: zod_1.z.string().optional(),
    case_notes: zod_1.z.array(zod_1.z.unknown()).optional(),
    chat_archives: zod_1.z.array(zod_1.z.unknown()).optional(),
    // PI-specific assessment fields
    liability_assessment: exports.LiabilitySchema.nullable().optional(),
    injury_tier: exports.InjuryTierSchema.nullable().optional(),
    estimated_value_range: zod_1.z.string().nullable().optional(),
    policy_limits_demand_appropriate: zod_1.z.boolean().nullable().optional(),
    // Linked case relationships
    parent_case: exports.LinkedCaseSchema.optional(),
    related_cases: zod_1.z.array(exports.RelatedCaseSchema).optional(),
    is_subcase: zod_1.z.boolean().optional(),
    assignments: zod_1.z.array(exports.AssignmentSchema).optional(),
    // DOI container relationships (for WC multi-injury clients)
    container: zod_1.z.object({
        path: zod_1.z.string(),
        clientName: zod_1.z.string(),
    }).optional(),
    is_doi_case: zod_1.z.boolean().optional(), // True if this case is a DOI subfolder
    injury_date: zod_1.z.string().optional(), // Date of injury from DOI folder name (YYYY-MM-DD)
    // WC-specific assessment fields
    compensability: exports.CompensabilitySchema.nullable().optional(),
    claim_type: exports.ClaimTypeSchema.nullable().optional(),
    estimated_ttd_weeks: zod_1.z.number().nullable().optional(),
    estimated_ppd_rating: zod_1.z.number().nullable().optional(),
    third_party_potential: zod_1.z.boolean().nullable().optional(),
    // WC hearings
    open_hearings: zod_1.z.array(zod_1.z.object({
        case_number: zod_1.z.string(),
        hearing_level: zod_1.z.enum(["H.O.", "A.O."]),
        next_date: zod_1.z.string().optional(),
        issue: zod_1.z.string().optional(),
    })).optional(),
});
// =============================================================================
// PRACTICE AREA HELPERS
// =============================================================================
/**
 * Get the practice area from an index, defaulting to PI for backward compatibility.
 */
function getPracticeArea(index) {
    var pa = index.practice_area;
    if (pa === exports.PRACTICE_AREAS.WC)
        return exports.PRACTICE_AREAS.WC;
    return exports.PRACTICE_AREAS.PI; // Default for undefined or "Personal Injury"
}
/**
 * Check if the practice area is Workers' Compensation.
 */
function isWorkersComp(index) {
    return getPracticeArea(index) === exports.PRACTICE_AREAS.WC;
}
/**
 * Get valid phases for a practice area.
 */
function getPhasesForPracticeArea(practiceArea) {
    if (practiceArea === exports.PRACTICE_AREAS.WC)
        return config_2.WC_PHASES;
    return config_1.PI_PHASES;
}
/**
 * Get the default/initial phase for a practice area.
 */
function getDefaultPhase(practiceArea) {
    return "Intake"; // Same for both
}
// =============================================================================
// JSON SCHEMA FOR ANTHROPIC API (tool_use)
// =============================================================================
/**
 * JSON Schema for per-file extraction via tool_use.
 * Used with direct Haiku calls (pre-extracted text path).
 */
// =============================================================================
// DOCUMENT TYPES BY PRACTICE AREA
// Document types are imported from practice-areas modules
// =============================================================================
// All document types combined (for schema validation)
exports.ALL_DOC_TYPES = __spreadArray(__spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_1.PI_DOC_TYPES, true), config_2.WC_DOC_TYPES, true);
/**
 * Get valid document types for a practice area.
 */
function getDocTypesForPracticeArea(practiceArea) {
    if (practiceArea === exports.PRACTICE_AREAS.WC) {
        return __spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_2.WC_DOC_TYPES, true);
    }
    return __spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_1.PI_DOC_TYPES, true);
}
exports.FILE_EXTRACTION_TOOL_SCHEMA = {
    name: "extract_document",
    description: "Extract structured information from a document. Call this tool with all extracted data.",
    input_schema: {
        type: "object",
        properties: {
            type: {
                type: "string",
                enum: exports.ALL_DOC_TYPES,
                description: "Document type classification",
            },
            key_info: {
                type: "string",
                description: "2-3 sentence summary of the most important information in this document",
            },
            has_handwritten_data: {
                type: "boolean",
                description: "True only when extracted handwritten values include substantive data (not just signature/initial markers); otherwise false",
            },
            handwritten_fields: {
                type: "array",
                items: { type: "string" },
                description: "List of non-signature extracted field names that appear handwritten (for example: client_name, document_date). Exclude signature-only markers and use [] when none",
            },
            extracted_data: {
                type: "object",
                description: "Structured data extracted from the document",
                properties: {
                    // Client info
                    client_name: { type: "string" },
                    dob: {
                        type: "string",
                        description: "Date of birth in MM-DD-YYYY format",
                    },
                    phone: { type: "string" },
                    email: { type: "string" },
                    address: {
                        type: "object",
                        properties: {
                            street: { type: "string" },
                            city: { type: "string" },
                            state: { type: "string" },
                            zip: { type: "string" },
                        },
                    },
                    // Accident info
                    dol: {
                        type: "string",
                        description: "Date of loss/accident in MM-DD-YYYY format",
                    },
                    document_date: {
                        type: "string",
                        description: "Date of this document (e.g., letter/report/signature date) in MM-DD-YYYY or YYYY-MM-DD format",
                    },
                    document_date_confidence: {
                        type: "string",
                        enum: ["high", "medium", "low", "unknown"],
                        description: "Confidence that document_date is the document's own date rather than another date in the text",
                    },
                    document_date_reason: {
                        type: "string",
                        description: "Short note explaining why this date was chosen when multiple dates appear",
                    },
                    accident_location: { type: "string" },
                    accident_description: { type: "string" },
                    // Insurance - 1P (client's own policy)
                    insurance_1p: {
                        type: "object",
                        description: "Client's own auto insurance (first party)",
                        properties: {
                            carrier: { type: "string" },
                            policy_number: { type: "string" },
                            claim_number: { type: "string" },
                            bodily_injury: {
                                type: "string",
                                description: "BI limits like $250,000/$500,000",
                            },
                            medical_payments: {
                                type: "string",
                                description: "Med-pay limit like $5,000",
                            },
                            um_uim: {
                                type: "string",
                                description: "UM/UIM limits like $250,000/$500,000",
                            },
                            property_damage: { type: "string" },
                            adjuster_name: { type: "string", description: "1P claims adjuster name" },
                            adjuster_phone: { type: "string", description: "1P claims adjuster phone" },
                            adjuster_email: { type: "string", description: "1P claims adjuster email" },
                        },
                    },
                    // Insurance - 3P (at-fault party's policy)
                    insurance_3p: {
                        type: "object",
                        description: "At-fault party's insurance (third party)",
                        properties: {
                            carrier: { type: "string" },
                            policy_number: { type: "string" },
                            claim_number: { type: "string" },
                            bodily_injury: {
                                type: "string",
                                description: "BI limits like $25,000/$50,000",
                            },
                            property_damage: { type: "string" },
                            insured_name: {
                                type: "string",
                                description: "Name of at-fault driver or policyholder",
                            },
                            adjuster_name: { type: "string", description: "3P claims adjuster name" },
                            adjuster_phone: { type: "string", description: "3P claims adjuster phone" },
                            adjuster_email: { type: "string", description: "3P claims adjuster email" },
                        },
                    },
                    // Health insurance
                    health_insurance: {
                        type: "object",
                        properties: {
                            carrier: { type: "string" },
                            group_no: { type: "string" },
                            member_no: { type: "string" },
                        },
                    },
                    // Medical
                    provider_name: {
                        type: "string",
                        description: "Medical provider or facility name",
                    },
                    service_dates: {
                        type: "string",
                        description: "Date or date range of services",
                    },
                    charges: {
                        type: "number",
                        description: "Total charges in dollars (number, not string)",
                    },
                    balance: {
                        type: "number",
                        description: "Outstanding balance in dollars",
                    },
                    diagnosis: { type: "string" },
                    treatment_summary: { type: "string" },
                    // Settlement/Demand
                    settlement_amount: { type: "number" },
                    demand_amount: { type: "number" },
                    offer_amount: { type: "number" },
                    // Adjuster info (PI and WC)
                    adjuster_name: { type: "string" },
                    adjuster_phone: { type: "string" },
                    adjuster_email: { type: "string" },
                    // WC-specific fields
                    employer_name: { type: "string" },
                    employer_address: {
                        type: "object",
                        properties: {
                            street: { type: "string" },
                            city: { type: "string" },
                            state: { type: "string" },
                            zip: { type: "string" },
                        },
                    },
                    employer_phone: { type: "string" },
                    job_title: { type: "string" },
                    doi: {
                        type: "string",
                        description: "Date of injury in MM-DD-YYYY format (Workers' Comp)",
                    },
                    injury_description: { type: "string" },
                    body_parts: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of affected body parts",
                    },
                    wc_carrier: { type: "string" },
                    wc_claim_number: { type: "string" },
                    tpa_name: { type: "string" },
                    amw: {
                        type: "number",
                        description: "Average Monthly Wage in dollars",
                    },
                    compensation_rate: {
                        type: "number",
                        description: "Weekly compensation rate in dollars",
                    },
                    disability_type: {
                        type: "string",
                        enum: ["TTD", "TPD", "PPD", "PTD"],
                        description: "Type of disability status",
                    },
                    mmi_date: {
                        type: "string",
                        description: "Maximum Medical Improvement date",
                    },
                    ppd_rating: {
                        type: "number",
                        description: "Permanent Partial Disability rating percentage",
                    },
                    work_restrictions: { type: "string" },
                    return_to_work_date: { type: "string" },
                    hearing_level: {
                        type: "string",
                        enum: ["H.O.", "A.O."],
                        description: "Hearing level: H.O. (Hearing Officer, default) or A.O. (Appeals Officer, if appeal-related document)",
                    },
                    hearing_case_number: {
                        type: "string",
                        description: "Hearing/docket case number (e.g., D-16-12345)",
                    },
                    next_hearing_date: {
                        type: "string",
                        description: "Next hearing date if shown in the document",
                    },
                    hearing_issue: {
                        type: "string",
                        description: "Issue in dispute for the hearing",
                    },
                },
            },
        },
        required: [
            "type",
            "key_info",
            "has_handwritten_data",
            "handwritten_fields",
            "extracted_data",
        ],
    },
};
// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================
/**
 * Parse a dollar amount to a number.
 * Handles: 12500, "12500", "$12,500", "$12,500.00", "12500.00"
 */
function parseAmount(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string") {
        var cleaned = value.replace(/[$,]/g, "");
        var num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}
/**
 * Parse an address - handles both string and object formats.
 */
function parseAddress(value) {
    if (!value)
        return undefined;
    // Already an object
    if (typeof value === "object" && value !== null) {
        var obj = value;
        var result = {};
        if (typeof obj.street === "string")
            result.street = obj.street;
        if (typeof obj.city === "string")
            result.city = obj.city;
        if (typeof obj.state === "string")
            result.state = obj.state;
        if (typeof obj.zip === "string")
            result.zip = obj.zip;
        // Return undefined if empty
        if (Object.keys(result).length === 0)
            return undefined;
        return result;
    }
    // String format: "123 Main St, Las Vegas, NV 89101"
    if (typeof value === "string") {
        var str = value.trim();
        if (!str)
            return undefined;
        // Try "Street, City, State ZIP" format
        var match = str.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
        if (match) {
            return {
                street: match[1].trim(),
                city: match[2].trim(),
                state: match[3],
                zip: match[4] || undefined,
            };
        }
        // Can't parse - put whole thing in street
        return { street: str };
    }
    return undefined;
}
/**
 * Expand shorthand like "25/50/25" to "$25,000/$50,000"
 */
function normalizeShorthandLimits(value) {
    // Already has dollar signs - return as-is
    if (value.includes("$"))
        return value;
    // Match patterns like "25/50" or "25/50/25"
    var match = value.match(/^(\d+)\/(\d+)(?:\/(\d+))?$/);
    if (match) {
        var per = parseInt(match[1]) * 1000;
        var acc = parseInt(match[2]) * 1000;
        return "$".concat(per.toLocaleString(), "/$").concat(acc.toLocaleString());
    }
    return value;
}
/**
 * Normalize policy_limits to canonical nested structure.
 *
 * Handles:
 * - JSON string: '{"1P": {...}}' → parsed and normalized
 * - String: "$25,000/$50,000" → { bodily_injury: "$25,000/$50,000", carrier: "Unknown" }
 * - Flat object: { carrier: "X", bodily_injury: "Y" } → same
 * - Shorthand: "25/50/25" → { bodily_injury: "$25,000/$50,000", carrier: "Unknown" }
 * - Already canonical: pass through
 */
function normalizePolicyLimits(value) {
    if (!value)
        return undefined;
    // Handle JSON strings (from LLM or update_index tool)
    if (typeof value === "string") {
        var trimmed = value.trim();
        if (trimmed.startsWith("{")) {
            try {
                value = JSON.parse(trimmed);
            }
            catch (_a) {
                // Not valid JSON - treat as simple limit string
                return {
                    "3P": {
                        carrier: "Unknown",
                        bodily_injury: normalizeShorthandLimits(trimmed),
                    },
                };
            }
        }
        else {
            // Simple string like "$25,000/$50,000"
            return {
                "3P": {
                    carrier: "Unknown",
                    bodily_injury: normalizeShorthandLimits(trimmed),
                },
            };
        }
    }
    if (typeof value !== "object")
        return undefined;
    var result = {};
    var raw = value;
    for (var _i = 0, _b = Object.entries(raw); _i < _b.length; _i++) {
        var _c = _b[_i], party = _c[0], partyValue = _c[1];
        // Normalize party key to 1P/3P
        var normalizedParty = party.toUpperCase().startsWith("1")
            ? "1P"
            : party.toUpperCase().startsWith("3")
                ? "3P"
                : party.toUpperCase();
        if (typeof partyValue === "string") {
            // Simple string like "$25,000/$50,000" or "25/50/25"
            result[normalizedParty] = {
                carrier: "Unknown",
                bodily_injury: normalizeShorthandLimits(partyValue),
            };
        }
        else if (typeof partyValue === "object" && partyValue !== null) {
            var obj = partyValue;
            var detail = {
                carrier: typeof obj.carrier === "string" ? obj.carrier : "Unknown",
                bodily_injury: typeof obj.bodily_injury === "string"
                    ? obj.bodily_injury
                    : typeof obj.bi === "string"
                        ? obj.bi
                        : undefined,
                medical_payments: typeof obj.medical_payments === "string"
                    ? obj.medical_payments
                    : typeof obj.med_pay === "string"
                        ? obj.med_pay
                        : undefined,
                um_uim: typeof obj.um_uim === "string"
                    ? obj.um_uim
                    : typeof obj.um === "string"
                        ? obj.um
                        : undefined,
                property_damage: typeof obj.property_damage === "string"
                    ? obj.property_damage
                    : typeof obj.pd === "string"
                        ? obj.pd
                        : undefined,
            };
            if (typeof obj.adjuster_name === "string" && obj.adjuster_name.trim()) {
                detail.adjuster_name = obj.adjuster_name.trim();
            }
            if (typeof obj.adjuster_phone === "string" && obj.adjuster_phone.trim()) {
                detail.adjuster_phone = obj.adjuster_phone.trim();
            }
            if (typeof obj.adjuster_email === "string" && obj.adjuster_email.trim()) {
                detail.adjuster_email = obj.adjuster_email.trim();
            }
            result[normalizedParty] = detail;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
/**
 * Normalize providers to array of strings.
 * Handles: string[], object[], mixed arrays
 */
function normalizeProviders(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map(function (item) {
        if (typeof item === "string")
            return item;
        if (typeof item === "object" && item !== null) {
            var obj = item;
            return typeof obj.name === "string" ? obj.name : null;
        }
        return null;
    })
        .filter(function (x) { return x !== null && x.length > 0; });
}
/**
 * Normalize folders to canonical { files: [...] } structure.
 */
function normalizeFolders(value) {
    var result = {};
    if (!value || typeof value !== "object")
        return result;
    for (var _i = 0, _a = Object.entries(value); _i < _a.length; _i++) {
        var _b = _a[_i], name_1 = _b[0], folderData = _b[1];
        var files = [];
        if (Array.isArray(folderData)) {
            files = folderData;
        }
        else if (typeof folderData === "object" && folderData !== null) {
            var obj = folderData;
            files = Array.isArray(obj.files)
                ? obj.files
                : Array.isArray(obj.documents)
                    ? obj.documents
                    : [];
        }
        result[name_1] = {
            files: files.map(function (f) { return normalizeFileEntry(f); }),
        };
    }
    return result;
}
function isSignatureOnlyHandwrittenField(value) {
    var normalized = value
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
    if (!normalized)
        return false;
    return (/\bsignature\b/.test(normalized) ||
        /\bsigned by\b/.test(normalized) ||
        /\bsigned\b/.test(normalized) ||
        /\bsigner\b/.test(normalized) ||
        /\binitials?\b/.test(normalized) ||
        normalized === "sign");
}
function normalizeFileEntry(value) {
    if (!value || typeof value !== "object") {
        return {
            filename: "unknown",
            type: "other",
            key_info: "",
            has_handwritten_data: false,
            handwritten_fields: [],
        };
    }
    var obj = value;
    var seenHandwrittenFields = new Set();
    var handwrittenFields = Array.isArray(obj.handwritten_fields)
        ? obj.handwritten_fields
            .filter(function (field) {
            return typeof field === "string" && field.trim().length > 0;
        })
            .map(function (field) { return field.trim(); })
            .filter(function (field) { return !isSignatureOnlyHandwrittenField(field); })
            .filter(function (field) {
            var key = field.toLowerCase();
            if (seenHandwrittenFields.has(key))
                return false;
            seenHandwrittenFields.add(key);
            return true;
        })
        : [];
    var hasHandwrittenData = handwrittenFields.length > 0;
    return {
        filename: typeof obj.filename === "string" ? obj.filename : "unknown",
        type: typeof obj.type === "string" ? obj.type : "other",
        key_info: typeof obj.key_info === "string" ? obj.key_info : "",
        date: typeof obj.date === "string" && obj.date.trim() ? obj.date.trim() : undefined,
        issues: typeof obj.issues === "string" && obj.issues.trim()
            ? obj.issues.trim()
            : undefined,
        has_handwritten_data: hasHandwrittenData,
        handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
        user_reviewed: typeof obj.user_reviewed === "boolean" ? obj.user_reviewed : undefined,
        reviewed_at: typeof obj.reviewed_at === "string" && obj.reviewed_at.trim()
            ? obj.reviewed_at.trim()
            : undefined,
        review_notes: typeof obj.review_notes === "string" && obj.review_notes.trim()
            ? obj.review_notes.trim()
            : undefined,
        extracted_data: typeof obj.extracted_data === "object" && obj.extracted_data !== null
            ? obj.extracted_data
            : undefined,
    };
}
/**
 * Normalize health_insurance to canonical structure.
 */
function normalizeHealthInsurance(value) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!value || typeof value !== "object")
        return undefined;
    var obj = value;
    // Handle various field name variations
    var carrier = (_b = (_a = obj.carrier) !== null && _a !== void 0 ? _a : obj.primary_carrier) !== null && _b !== void 0 ? _b : obj.insurance_carrier;
    var group = (_d = (_c = obj.group_no) !== null && _c !== void 0 ? _c : obj.group_number) !== null && _d !== void 0 ? _d : obj.group;
    var member = (_h = (_g = (_f = (_e = obj.member_no) !== null && _e !== void 0 ? _e : obj.member_id) !== null && _f !== void 0 ? _f : obj.member_number) !== null && _g !== void 0 ? _g : obj.primary_member_no) !== null && _h !== void 0 ? _h : obj.member;
    var result = {};
    if (typeof carrier === "string")
        result.carrier = carrier;
    if (typeof group === "string")
        result.group_no = group;
    if (typeof member === "string")
        result.member_no = member;
    // Return undefined if all fields are empty
    if (Object.keys(result).length === 0) {
        return undefined;
    }
    return result;
}
/**
 * Normalize contact to canonical structure.
 */
function normalizeContact(value) {
    if (!value || typeof value !== "object")
        return undefined;
    var obj = value;
    var result = {};
    if (typeof obj.phone === "string" && obj.phone.trim()) {
        result.phone = obj.phone.trim();
    }
    if (typeof obj.email === "string" && obj.email.trim()) {
        result.email = obj.email.trim();
    }
    var address = parseAddress(obj.address);
    if (address) {
        result.address = address;
    }
    // Return undefined if empty
    if (Object.keys(result).length === 0) {
        return undefined;
    }
    return result;
}
/**
 * Normalize claim_numbers to canonical structure.
 */
function normalizeClaimNumbers(value) {
    if (!value || typeof value !== "object")
        return undefined;
    var result = {};
    var obj = value;
    for (var _i = 0, _a = Object.entries(obj); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], val = _b[1];
        if (typeof val === "string" && val.trim()) {
            // Normalize key format: 1P_CarrierName, 3P_CarrierName
            var normalizedKey = key
                .replace(/^first.?party/i, "1P")
                .replace(/^third.?party/i, "3P")
                .replace(/^1p/i, "1P")
                .replace(/^3p/i, "3P");
            result[normalizedKey] = val.trim();
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
// =============================================================================
// WC-SPECIFIC NORMALIZATION FUNCTIONS
// =============================================================================
/**
 * Normalize employer information.
 */
function normalizeEmployer(value) {
    var _a, _b, _c;
    if (!value || typeof value !== "object")
        return undefined;
    var obj = value;
    var name = (_b = (_a = obj.name) !== null && _a !== void 0 ? _a : obj.employer_name) !== null && _b !== void 0 ? _b : obj.employer;
    if (typeof name !== "string" || !name.trim())
        return undefined;
    var result = { name: name.trim() };
    var address = parseAddress((_c = obj.address) !== null && _c !== void 0 ? _c : obj.employer_address);
    if (address)
        result.address = address;
    if (typeof obj.phone === "string" && obj.phone.trim()) {
        result.phone = obj.phone.trim();
    }
    if (typeof obj.contact_name === "string" && obj.contact_name.trim()) {
        result.contact_name = obj.contact_name.trim();
    }
    return result;
}
/**
 * Normalize WC carrier information.
 */
function normalizeWCCarrier(value) {
    var _a, _b, _c;
    if (!value || typeof value !== "object")
        return undefined;
    var obj = value;
    var name = (_c = (_b = (_a = obj.name) !== null && _a !== void 0 ? _a : obj.carrier) !== null && _b !== void 0 ? _b : obj.wc_carrier) !== null && _c !== void 0 ? _c : obj.insurer;
    if (typeof name !== "string" || !name.trim())
        return undefined;
    var result = { name: name.trim() };
    if (typeof obj.claim_number === "string" && obj.claim_number.trim()) {
        result.claim_number = obj.claim_number.trim();
    }
    else if (typeof obj.wc_claim_number === "string" && obj.wc_claim_number.trim()) {
        result.claim_number = obj.wc_claim_number.trim();
    }
    if (typeof obj.adjuster_name === "string" && obj.adjuster_name.trim()) {
        result.adjuster_name = obj.adjuster_name.trim();
    }
    if (typeof obj.adjuster_phone === "string" && obj.adjuster_phone.trim()) {
        result.adjuster_phone = obj.adjuster_phone.trim();
    }
    if (typeof obj.adjuster_email === "string" && obj.adjuster_email.trim()) {
        result.adjuster_email = obj.adjuster_email.trim();
    }
    if (typeof obj.tpa_name === "string" && obj.tpa_name.trim()) {
        result.tpa_name = obj.tpa_name.trim();
    }
    return result;
}
/**
 * Normalize disability status information.
 */
function normalizeDisabilityStatus(value) {
    var _a, _b;
    if (!value || typeof value !== "object")
        return undefined;
    var obj = value;
    var result = {};
    var disabilityType = validateDisabilityType((_a = obj.type) !== null && _a !== void 0 ? _a : obj.disability_type);
    if (disabilityType)
        result.type = disabilityType;
    // Accept both amw (canonical) and aww (legacy), store as amw
    var amwRaw = (_b = obj.amw) !== null && _b !== void 0 ? _b : obj.aww;
    if (typeof amwRaw === "number")
        result.amw = amwRaw;
    else if (typeof amwRaw === "string")
        result.amw = parseAmount(amwRaw);
    if (typeof obj.compensation_rate === "number")
        result.compensation_rate = obj.compensation_rate;
    else if (typeof obj.compensation_rate === "string")
        result.compensation_rate = parseAmount(obj.compensation_rate);
    if (typeof obj.mmi_date === "string" && obj.mmi_date.trim()) {
        result.mmi_date = obj.mmi_date.trim();
    }
    if (typeof obj.ppd_rating === "number")
        result.ppd_rating = obj.ppd_rating;
    else if (typeof obj.ppd_rating === "string")
        result.ppd_rating = parseFloat(obj.ppd_rating) || undefined;
    if (typeof obj.ppd_weeks === "number")
        result.ppd_weeks = obj.ppd_weeks;
    if (typeof obj.return_to_work_date === "string" && obj.return_to_work_date.trim()) {
        result.return_to_work_date = obj.return_to_work_date.trim();
    }
    if (typeof obj.work_restrictions === "string" && obj.work_restrictions.trim()) {
        result.work_restrictions = obj.work_restrictions.trim();
    }
    // Return undefined if empty
    if (Object.keys(result).length === 0)
        return undefined;
    return result;
}
// =============================================================================
// PHASE AND ENUM VALIDATORS
// =============================================================================
/**
 * Validate phase based on practice area.
 * Invalid phases default to "Intake".
 */
function validatePhase(value, practiceArea) {
    if (typeof value !== "string")
        return "Intake";
    var validPhases = getPhasesForPracticeArea(practiceArea);
    if (validPhases.includes(value)) {
        return value;
    }
    // Try to map PI phases to WC equivalents and vice versa
    if (practiceArea === exports.PRACTICE_AREAS.WC) {
        var piToWcMap = {
            "Demand": "Benefits Resolution",
            "Negotiation": "Benefits Resolution",
            "Complete": "Closed",
        };
        if (piToWcMap[value])
            return piToWcMap[value];
    }
    else {
        var wcToPiMap = {
            "MMI Evaluation": "Treatment",
            "Benefits Resolution": "Negotiation",
            "Settlement/Hearing": "Settlement",
            "Closed": "Complete",
        };
        if (wcToPiMap[value])
            return wcToPiMap[value];
    }
    return "Intake";
}
var VALID_LIABILITY = ["clear", "moderate", "contested"];
function validateLiability(value) {
    if (typeof value === "string" &&
        VALID_LIABILITY.includes(value)) {
        return value;
    }
    return null;
}
var VALID_INJURY_TIERS = [
    "tier_1_soft_tissue",
    "tier_2_structural",
    "tier_3_surgical",
];
function validateInjuryTier(value) {
    if (typeof value === "string" &&
        VALID_INJURY_TIERS.includes(value)) {
        return value;
    }
    return null;
}
var VALID_COMPENSABILITY = [
    "clearly_compensable",
    "likely_compensable",
    "disputed",
    "denied",
];
function validateCompensability(value) {
    if (typeof value === "string" &&
        VALID_COMPENSABILITY.includes(value)) {
        return value;
    }
    return null;
}
var VALID_CLAIM_TYPES = [
    "specific_injury",
    "occupational_disease",
    "cumulative_trauma",
];
function validateClaimType(value) {
    if (typeof value === "string" &&
        VALID_CLAIM_TYPES.includes(value)) {
        return value;
    }
    return null;
}
var VALID_DISABILITY_TYPES = ["TTD", "TPD", "PPD", "PTD"];
function validateDisabilityType(value) {
    if (typeof value === "string" &&
        VALID_DISABILITY_TYPES.includes(value)) {
        return value;
    }
    return undefined;
}
// =============================================================================
// MAIN NORMALIZATION ENTRY POINT
// =============================================================================
/**
 * Normalize any raw index data to conform to the canonical schema.
 *
 * This is the ONLY function that should be called before writing document_index.json.
 * It coerces all fields to their expected types and structures.
 *
 * @param raw - The raw index data to normalize
 * @param practiceArea - Optional practice area override (otherwise detected from data or defaults to PI)
 */
function normalizeIndex(raw, practiceArea) {
    var _a;
    if (!raw || typeof raw !== "object") {
        throw new Error("normalizeIndex: input must be an object");
    }
    var input = raw;
    var rawSummary = ((_a = input.summary) !== null && _a !== void 0 ? _a : {});
    // Determine practice area (param > data > default to PI)
    var detectedPracticeArea = practiceArea !== null && practiceArea !== void 0 ? practiceArea : (typeof input.practice_area === "string" ? input.practice_area : undefined);
    var isWC = detectedPracticeArea === exports.PRACTICE_AREAS.WC;
    // Normalize incident date - accept dol (PI), doi (WC), or incident_date
    var incidentDate = typeof rawSummary.incident_date === "string"
        ? rawSummary.incident_date
        : typeof rawSummary.dol === "string"
            ? rawSummary.dol
            : typeof rawSummary.doi === "string"
                ? rawSummary.doi
                : "Unknown";
    // Build normalized summary with common fields
    var summary = {
        client: typeof rawSummary.client === "string" ? rawSummary.client : "Unknown",
        incident_date: incidentDate,
        dob: typeof rawSummary.dob === "string" ? rawSummary.dob : undefined,
        providers: normalizeProviders(rawSummary.providers),
        total_charges: parseAmount(rawSummary.total_charges),
        contact: normalizeContact(rawSummary.contact),
        health_insurance: normalizeHealthInsurance(rawSummary.health_insurance),
        case_summary: typeof rawSummary.case_summary === "string"
            ? rawSummary.case_summary
            : "No summary available",
    };
    // PI-specific summary fields
    if (!isWC) {
        summary.policy_limits = normalizePolicyLimits(rawSummary.policy_limits);
        summary.claim_numbers = normalizeClaimNumbers(rawSummary.claim_numbers);
    }
    // WC-specific summary fields
    if (isWC) {
        summary.employer = normalizeEmployer(rawSummary.employer);
        summary.wc_carrier = normalizeWCCarrier(rawSummary.wc_carrier);
        summary.disability_status = normalizeDisabilityStatus(rawSummary.disability_status);
        if (typeof rawSummary.job_title === "string" && rawSummary.job_title.trim()) {
            summary.job_title = rawSummary.job_title.trim();
        }
        if (typeof rawSummary.injury_description === "string" && rawSummary.injury_description.trim()) {
            summary.injury_description = rawSummary.injury_description.trim();
        }
        if (Array.isArray(rawSummary.body_parts)) {
            summary.body_parts = rawSummary.body_parts.filter(function (x) { return typeof x === "string" && x.trim().length > 0; });
            if (summary.body_parts.length === 0)
                delete summary.body_parts;
        }
    }
    // Clean up undefined optional fields
    if (!summary.dob)
        delete summary.dob;
    if (!summary.policy_limits)
        delete summary.policy_limits;
    if (!summary.contact)
        delete summary.contact;
    if (!summary.health_insurance)
        delete summary.health_insurance;
    if (!summary.claim_numbers)
        delete summary.claim_numbers;
    if (!summary.employer)
        delete summary.employer;
    if (!summary.wc_carrier)
        delete summary.wc_carrier;
    if (!summary.disability_status)
        delete summary.disability_status;
    if (!summary.job_title)
        delete summary.job_title;
    if (!summary.injury_description)
        delete summary.injury_description;
    // Build full normalized index
    var normalized = {
        indexed_at: typeof input.indexed_at === "string"
            ? input.indexed_at
            : new Date().toISOString(),
        case_name: typeof input.case_name === "string" ? input.case_name : "Unknown",
        case_phase: validatePhase(input.case_phase, detectedPracticeArea),
        summary: summary,
        folders: normalizeFolders(input.folders),
    };
    // Add practice_area if explicitly set (omit for PI to maintain backward compat)
    if (detectedPracticeArea === exports.PRACTICE_AREAS.WC) {
        normalized.practice_area = exports.PRACTICE_AREAS.WC;
    }
    // Optional arrays - only include if present
    if (Array.isArray(input.failed_files) && input.failed_files.length > 0) {
        normalized.failed_files = input.failed_files;
    }
    if (Array.isArray(input.issues_found) && input.issues_found.length > 0) {
        normalized.issues_found = input.issues_found.filter(function (x) { return typeof x === "string"; });
    }
    if (Array.isArray(input.needs_review) && input.needs_review.length > 0) {
        normalized.needs_review = input.needs_review;
    }
    if (Array.isArray(input.errata) && input.errata.length > 0) {
        normalized.errata = input.errata;
    }
    if (typeof input.reconciled_values === "object" &&
        input.reconciled_values !== null) {
        normalized.reconciled_values = input.reconciled_values;
    }
    if (typeof input.case_analysis === "string" && input.case_analysis) {
        normalized.case_analysis = input.case_analysis;
    }
    if (Array.isArray(input.case_notes)) {
        normalized.case_notes = input.case_notes;
    }
    if (Array.isArray(input.chat_archives)) {
        normalized.chat_archives = input.chat_archives;
    }
    // PI-specific assessment fields
    if (!isWC) {
        normalized.liability_assessment = validateLiability(input.liability_assessment);
        normalized.injury_tier = validateInjuryTier(input.injury_tier);
        normalized.estimated_value_range =
            typeof input.estimated_value_range === "string"
                ? input.estimated_value_range
                : null;
        normalized.policy_limits_demand_appropriate =
            typeof input.policy_limits_demand_appropriate === "boolean"
                ? input.policy_limits_demand_appropriate
                : null;
    }
    // WC-specific assessment fields
    if (isWC) {
        normalized.compensability = validateCompensability(input.compensability);
        normalized.claim_type = validateClaimType(input.claim_type);
        normalized.estimated_ttd_weeks =
            typeof input.estimated_ttd_weeks === "number"
                ? input.estimated_ttd_weeks
                : null;
        normalized.estimated_ppd_rating =
            typeof input.estimated_ppd_rating === "number"
                ? input.estimated_ppd_rating
                : null;
        normalized.third_party_potential =
            typeof input.third_party_potential === "boolean"
                ? input.third_party_potential
                : null;
        // Open hearings normalization
        if (Array.isArray(input.open_hearings) && input.open_hearings.length > 0) {
            normalized.open_hearings = input.open_hearings
                .filter(function (h) { return h && typeof h === "object" && typeof h.case_number === "string"; })
                .map(function (h) { return ({
                case_number: h.case_number,
                hearing_level: h.hearing_level === "A.O." ? "A.O."
                    : h.type === "A.O." ? "A.O." // Legacy field mapping
                        : "H.O.",
                next_date: typeof h.next_date === "string" ? h.next_date : undefined,
                issue: typeof h.issue === "string" ? h.issue : undefined,
            }); });
            if (normalized.open_hearings.length === 0)
                delete normalized.open_hearings;
        }
    }
    // Linked case relationships
    if (input.parent_case && typeof input.parent_case === "object") {
        var pc = input.parent_case;
        if (typeof pc.path === "string" && typeof pc.name === "string") {
            normalized.parent_case = { path: pc.path, name: pc.name };
        }
    }
    if (Array.isArray(input.related_cases) && input.related_cases.length > 0) {
        var filtered = input.related_cases.filter(function (rc) {
            return rc && typeof rc === "object" &&
                typeof rc.path === "string" &&
                typeof rc.name === "string" &&
                ["subcase", "sibling", "doi_sibling"].includes(rc.type);
        }).map(function (rc) {
            var result = {
                path: rc.path,
                name: rc.name,
                type: rc.type,
            };
            // Include dateOfInjury for DOI siblings
            if (rc.dateOfInjury && typeof rc.dateOfInjury === "string") {
                result.dateOfInjury = rc.dateOfInjury;
            }
            return result;
        });
        if (filtered.length > 0) {
            normalized.related_cases = filtered;
        }
    }
    if (typeof input.is_subcase === "boolean") {
        normalized.is_subcase = input.is_subcase;
    }
    if (Array.isArray(input.assignments) && input.assignments.length > 0) {
        var assignments = input.assignments
            .filter(function (assignment) {
            return !!assignment &&
                typeof assignment === "object" &&
                typeof assignment.userId === "string" &&
                typeof assignment.assignedAt === "string" &&
                typeof assignment.assignedBy === "string";
        })
            .map(function (assignment) { return ({
            userId: assignment.userId,
            assignedAt: assignment.assignedAt,
            assignedBy: assignment.assignedBy,
        }); });
        if (assignments.length > 0) {
            normalized.assignments = assignments;
        }
    }
    // DOI container relationships
    if (input.container && typeof input.container === "object") {
        var cont = input.container;
        if (typeof cont.path === "string" && typeof cont.clientName === "string") {
            normalized.container = { path: cont.path, clientName: cont.clientName };
        }
    }
    if (typeof input.is_doi_case === "boolean") {
        normalized.is_doi_case = input.is_doi_case;
    }
    if (typeof input.injury_date === "string" && input.injury_date.trim()) {
        normalized.injury_date = input.injury_date.trim();
    }
    return normalized;
}
/**
 * Validate an index and return any issues found.
 * Useful for debugging extraction problems without failing.
 */
function validateIndex(data) {
    var result = exports.DocumentIndexSchema.safeParse(data);
    if (result.success) {
        return { valid: true, issues: [] };
    }
    return {
        valid: false,
        issues: result.error.issues.map(function (i) { return "".concat(i.path.join("."), ": ").concat(i.message); }),
    };
}
