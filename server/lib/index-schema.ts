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

import { z } from "zod";

// Import from practice-areas modules (source of truth for law-specific config)
import { SHARED_DOC_TYPES } from "../practice-areas/types";
import { PI_DOC_TYPES, PI_PHASES } from "../practice-areas/personal-injury/config";
import { WC_DOC_TYPES, WC_PHASES } from "../practice-areas/workers-comp/config";

// =============================================================================
// PRACTICE AREA DEFINITIONS
// =============================================================================

export const PRACTICE_AREAS = {
  PI: "Personal Injury",
  WC: "Workers' Compensation",
} as const;

export type PracticeAreaCode = keyof typeof PRACTICE_AREAS;
export type PracticeAreaName = (typeof PRACTICE_AREAS)[PracticeAreaCode];

export const PracticeAreaSchema = z.enum([
  PRACTICE_AREAS.PI,
  PRACTICE_AREAS.WC,
]);

// =============================================================================
// SHARED SCHEMA DEFINITIONS
// =============================================================================

export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
});

export const ContactSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  address: AddressSchema.optional(),
});

export const HealthInsuranceSchema = z.object({
  carrier: z.string().optional(),
  group_no: z.string().optional(),
  member_no: z.string().optional(),
});

// =============================================================================
// PERSONAL INJURY SPECIFIC SCHEMAS
// =============================================================================

export const PolicyLimitDetailSchema = z.object({
  carrier: z.string(),
  bodily_injury: z.string().optional(),
  medical_payments: z.string().optional(),
  um_uim: z.string().optional(),
  property_damage: z.string().optional(),
});

// =============================================================================
// WORKERS' COMPENSATION SPECIFIC SCHEMAS
// =============================================================================

export const EmployerSchema = z.object({
  name: z.string(),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  contact_name: z.string().optional(),
});

export const WCCarrierSchema = z.object({
  name: z.string(),
  claim_number: z.string().optional(),
  adjuster_name: z.string().optional(),
  adjuster_phone: z.string().optional(),
  adjuster_email: z.string().optional(),
  tpa_name: z.string().optional(), // Third Party Administrator
});

export const DisabilityStatusSchema = z.object({
  type: z.enum(["TTD", "TPD", "PPD", "PTD"]).optional(), // Temporary Total, Temporary Partial, Permanent Partial, Permanent Total
  amw: z.number().optional(), // Average Monthly Wage
  compensation_rate: z.number().optional(), // Weekly benefit rate
  mmi_date: z.string().optional(), // Maximum Medical Improvement date
  ppd_rating: z.number().optional(), // Permanent Partial Disability percentage
  ppd_weeks: z.number().optional(), // Weeks of PPD benefits
  return_to_work_date: z.string().optional(),
  work_restrictions: z.string().optional(),
});

// =============================================================================
// UNIFIED SUMMARY SCHEMA
// =============================================================================

export const SummarySchema = z.object({
  // Common fields (all practice areas)
  client: z.string(),
  dob: z.string().optional(),
  providers: z.array(z.string()),
  total_charges: z.number(),
  contact: ContactSchema.optional(),
  health_insurance: HealthInsuranceSchema.optional(),
  case_summary: z.string(),

  // Incident date - stored as "incident_date" but accepts dol/doi on input
  incident_date: z.string(),

  // PI-specific fields (optional, only populated for PI cases)
  policy_limits: z.record(z.string(), PolicyLimitDetailSchema).optional(),
  claim_numbers: z.record(z.string(), z.string()).optional(), // 1P/3P claim numbers

  // WC-specific fields (optional, only populated for WC cases)
  employer: EmployerSchema.optional(),
  wc_carrier: WCCarrierSchema.optional(),
  disability_status: DisabilityStatusSchema.optional(),
  job_title: z.string().optional(),
  injury_description: z.string().optional(),
  body_parts: z.array(z.string()).optional(), // Affected body parts
});

export const FileEntrySchema = z.object({
  filename: z.string(),
  type: z.string(),
  key_info: z.string(),
  date: z.string().optional(),
  issues: z.string().optional(),
  has_handwritten_data: z.boolean().optional(),
  handwritten_fields: z.array(z.string()).optional(),
  user_reviewed: z.boolean().optional(),
  reviewed_at: z.string().optional(),
  review_notes: z.string().optional(),
  extracted_data: z.record(z.string(), z.unknown()).optional(),
});

export const FolderSchema = z.object({
  files: z.array(FileEntrySchema),
});

export const NeedsReviewSchema = z.object({
  field: z.string(),
  conflicting_values: z.array(z.string()),
  sources: z.array(z.string()),
  reason: z.string(),
});

export const ErrataSchema = z.object({
  field: z.string(),
  decision: z.string(),
  evidence: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

// =============================================================================
// CASE PHASE SCHEMAS (Practice Area Specific)
// Phases are imported from practice-areas modules
// =============================================================================

// Combined for schema validation (accepts either PI or WC phases)
export const ALL_PHASES = [...new Set([...PI_PHASES, ...WC_PHASES])] as const;

export const CasePhaseSchema = z.enum(ALL_PHASES as unknown as [string, ...string[]]);

export type PICasePhase = (typeof PI_PHASES)[number];
export type WCCasePhase = (typeof WC_PHASES)[number];
export type CasePhase = PICasePhase | WCCasePhase;

// Re-export phases for backward compatibility
export { PI_PHASES, WC_PHASES };

// =============================================================================
// PI-SPECIFIC ASSESSMENT SCHEMAS
// =============================================================================

export const LiabilitySchema = z.enum(["clear", "moderate", "contested"]);

export const InjuryTierSchema = z.enum([
  "tier_1_soft_tissue",
  "tier_2_structural",
  "tier_3_surgical",
]);

// Linked case relationship schema
export const LinkedCaseSchema = z.object({
  path: z.string(),
  name: z.string(),
});

export const RelatedCaseSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["subcase", "sibling", "doi_sibling"]),
  dateOfInjury: z.string().optional(), // For DOI siblings: injury date from folder name
});

export const AssignmentSchema = z.object({
  userId: z.string(),
  assignedAt: z.string(),
  assignedBy: z.string(),
});

// =============================================================================
// DOI CONTAINER SCHEMA (for multi-injury WC clients)
// =============================================================================

/**
 * Container info for clients with multiple DOI subfolders.
 * Stored in ClientName/.pi_tool/container_info.json
 */
export const ContainerInfoSchema = z.object({
  clientName: z.string(),
  practiceArea: PracticeAreaSchema.optional(),
  contact: ContactSchema.optional(),
  sharedFolders: z.array(z.string()).optional(), // Non-DOI folders that were indexed
  doiCases: z.array(z.object({
    path: z.string(),
    dateOfInjury: z.string(), // YYYY-MM-DD from DOI folder name
    indexed: z.boolean().optional(),
  })).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

// =============================================================================
// WC-SPECIFIC ASSESSMENT SCHEMAS
// =============================================================================

export const CompensabilitySchema = z.enum([
  "clearly_compensable",      // AOE/COE clear, no defenses
  "likely_compensable",       // Minor issues but should prevail
  "disputed",                 // Significant compensability questions
  "denied",                   // Carrier has denied, appeal needed
]);

export const ClaimTypeSchema = z.enum([
  "specific_injury",          // Single incident
  "occupational_disease",     // Illness from work exposure
  "cumulative_trauma",        // Repetitive stress/injury over time
]);

// =============================================================================
// DOCUMENT INDEX SCHEMA
// =============================================================================

export const DocumentIndexSchema = z.object({
  // Core fields
  indexed_at: z.string(),
  case_name: z.string(),
  practice_area: PracticeAreaSchema.optional(), // Undefined = PI (backward compat)
  case_phase: CasePhaseSchema,
  summary: SummarySchema,
  folders: z.record(z.string(), FolderSchema),

  // Processing metadata
  failed_files: z
    .array(
      z.object({
        filename: z.string(),
        folder: z.string(),
        error: z.string().optional(),
        failed_at: z.string().optional(),
      })
    )
    .optional(),
  issues_found: z.array(z.string()).optional(),
  needs_review: z.array(NeedsReviewSchema).optional(),
  errata: z.array(ErrataSchema).optional(),
  reconciled_values: z.record(z.string(), z.unknown()).optional(),
  case_analysis: z.string().optional(),
  case_notes: z.array(z.unknown()).optional(),
  chat_archives: z.array(z.unknown()).optional(),

  // PI-specific assessment fields
  liability_assessment: LiabilitySchema.nullable().optional(),
  injury_tier: InjuryTierSchema.nullable().optional(),
  estimated_value_range: z.string().nullable().optional(),
  policy_limits_demand_appropriate: z.boolean().nullable().optional(),
  // Linked case relationships
  parent_case: LinkedCaseSchema.optional(),
  related_cases: z.array(RelatedCaseSchema).optional(),
  is_subcase: z.boolean().optional(),
  assignments: z.array(AssignmentSchema).optional(),

  // DOI container relationships (for WC multi-injury clients)
  container: z.object({
    path: z.string(),
    clientName: z.string(),
  }).optional(),
  is_doi_case: z.boolean().optional(), // True if this case is a DOI subfolder
  injury_date: z.string().optional(), // Date of injury from DOI folder name (YYYY-MM-DD)

  // WC-specific assessment fields
  compensability: CompensabilitySchema.nullable().optional(),
  claim_type: ClaimTypeSchema.nullable().optional(),
  estimated_ttd_weeks: z.number().nullable().optional(),
  estimated_ppd_rating: z.number().nullable().optional(),
  third_party_potential: z.boolean().nullable().optional(),

  // WC hearings
  open_hearings: z.array(z.object({
    case_number: z.string(),
    hearing_level: z.enum(["H.O.", "A.O."]),
    next_date: z.string().optional(),
    issue: z.string().optional(),
  })).optional(),
});

export type DocumentIndex = z.infer<typeof DocumentIndexSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type PolicyLimitDetail = z.infer<typeof PolicyLimitDetailSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type HealthInsurance = z.infer<typeof HealthInsuranceSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type CasePhase = z.infer<typeof CasePhaseSchema>;
export type LinkedCase = z.infer<typeof LinkedCaseSchema>;
export type RelatedCase = z.infer<typeof RelatedCaseSchema>;
export type ContainerInfo = z.infer<typeof ContainerInfoSchema>;
export type Employer = z.infer<typeof EmployerSchema>;
export type WCCarrier = z.infer<typeof WCCarrierSchema>;
export type DisabilityStatus = z.infer<typeof DisabilityStatusSchema>;

// =============================================================================
// PRACTICE AREA HELPERS
// =============================================================================

/**
 * Get the practice area from an index, defaulting to PI for backward compatibility.
 */
export function getPracticeArea(index: DocumentIndex | Record<string, unknown>): PracticeAreaName {
  const pa = (index as Record<string, unknown>).practice_area;
  if (pa === PRACTICE_AREAS.WC) return PRACTICE_AREAS.WC;
  return PRACTICE_AREAS.PI; // Default for undefined or "Personal Injury"
}

/**
 * Check if the practice area is Workers' Compensation.
 */
export function isWorkersComp(index: DocumentIndex | Record<string, unknown>): boolean {
  return getPracticeArea(index) === PRACTICE_AREAS.WC;
}

/**
 * Get valid phases for a practice area.
 */
export function getPhasesForPracticeArea(practiceArea?: string): readonly string[] {
  if (practiceArea === PRACTICE_AREAS.WC) return WC_PHASES;
  return PI_PHASES;
}

/**
 * Get the default/initial phase for a practice area.
 */
export function getDefaultPhase(practiceArea?: string): string {
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
export const ALL_DOC_TYPES = [
  ...SHARED_DOC_TYPES,
  ...PI_DOC_TYPES,
  ...WC_DOC_TYPES,
] as const;

export type DocumentType = (typeof ALL_DOC_TYPES)[number];

/**
 * Get valid document types for a practice area.
 */
export function getDocTypesForPracticeArea(practiceArea?: string): readonly string[] {
  if (practiceArea === PRACTICE_AREAS.WC) {
    return [...SHARED_DOC_TYPES, ...WC_DOC_TYPES];
  }
  return [...SHARED_DOC_TYPES, ...PI_DOC_TYPES];
}

// Re-export document types for backward compatibility
export { SHARED_DOC_TYPES, PI_DOC_TYPES, WC_DOC_TYPES };

export const FILE_EXTRACTION_TOOL_SCHEMA = {
  name: "extract_document",
  description:
    "Extract structured information from a document. Call this tool with all extracted data.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: ALL_DOC_TYPES as unknown as string[],
        description: "Document type classification",
      },
      key_info: {
        type: "string" as const,
        description:
          "2-3 sentence summary of the most important information in this document",
      },
      has_handwritten_data: {
        type: "boolean" as const,
        description:
          "True only when extracted handwritten values include substantive data (not just signature/initial markers); otherwise false",
      },
      handwritten_fields: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "List of non-signature extracted field names that appear handwritten (for example: client_name, document_date). Exclude signature-only markers and use [] when none",
      },
      extracted_data: {
        type: "object" as const,
        description: "Structured data extracted from the document",
        properties: {
          // Client info
          client_name: { type: "string" as const },
          dob: {
            type: "string" as const,
            description: "Date of birth in MM-DD-YYYY format",
          },
          phone: { type: "string" as const },
          email: { type: "string" as const },
          address: {
            type: "object" as const,
            properties: {
              street: { type: "string" as const },
              city: { type: "string" as const },
              state: { type: "string" as const },
              zip: { type: "string" as const },
            },
          },

          // Accident info
          dol: {
            type: "string" as const,
            description: "Date of loss/accident in MM-DD-YYYY format",
          },
          document_date: {
            type: "string" as const,
            description:
              "Date of this document (e.g., letter/report/signature date) in MM-DD-YYYY or YYYY-MM-DD format",
          },
          document_date_confidence: {
            type: "string" as const,
            enum: ["high", "medium", "low", "unknown"],
            description:
              "Confidence that document_date is the document's own date rather than another date in the text",
          },
          document_date_reason: {
            type: "string" as const,
            description:
              "Short note explaining why this date was chosen when multiple dates appear",
          },
          accident_location: { type: "string" as const },
          accident_description: { type: "string" as const },

          // Insurance - 1P (client's own policy)
          insurance_1p: {
            type: "object" as const,
            description: "Client's own auto insurance (first party)",
            properties: {
              carrier: { type: "string" as const },
              policy_number: { type: "string" as const },
              claim_number: { type: "string" as const },
              bodily_injury: {
                type: "string" as const,
                description: "BI limits like $250,000/$500,000",
              },
              medical_payments: {
                type: "string" as const,
                description: "Med-pay limit like $5,000",
              },
              um_uim: {
                type: "string" as const,
                description: "UM/UIM limits like $250,000/$500,000",
              },
              property_damage: { type: "string" as const },
            },
          },

          // Insurance - 3P (at-fault party's policy)
          insurance_3p: {
            type: "object" as const,
            description: "At-fault party's insurance (third party)",
            properties: {
              carrier: { type: "string" as const },
              policy_number: { type: "string" as const },
              claim_number: { type: "string" as const },
              bodily_injury: {
                type: "string" as const,
                description: "BI limits like $25,000/$50,000",
              },
              property_damage: { type: "string" as const },
              insured_name: {
                type: "string" as const,
                description: "Name of at-fault driver or policyholder",
              },
            },
          },

          // Health insurance
          health_insurance: {
            type: "object" as const,
            properties: {
              carrier: { type: "string" as const },
              group_no: { type: "string" as const },
              member_no: { type: "string" as const },
            },
          },

          // Medical
          provider_name: {
            type: "string" as const,
            description: "Medical provider or facility name",
          },
          service_dates: {
            type: "string" as const,
            description: "Date or date range of services",
          },
          charges: {
            type: "number" as const,
            description: "Total charges in dollars (number, not string)",
          },
          balance: {
            type: "number" as const,
            description: "Outstanding balance in dollars",
          },
          diagnosis: { type: "string" as const },
          treatment_summary: { type: "string" as const },

          // Settlement/Demand
          settlement_amount: { type: "number" as const },
          demand_amount: { type: "number" as const },
          offer_amount: { type: "number" as const },

          // Adjuster info (PI and WC)
          adjuster_name: { type: "string" as const },
          adjuster_phone: { type: "string" as const },
          adjuster_email: { type: "string" as const },

          // WC-specific fields
          employer_name: { type: "string" as const },
          employer_address: {
            type: "object" as const,
            properties: {
              street: { type: "string" as const },
              city: { type: "string" as const },
              state: { type: "string" as const },
              zip: { type: "string" as const },
            },
          },
          employer_phone: { type: "string" as const },
          job_title: { type: "string" as const },
          doi: {
            type: "string" as const,
            description: "Date of injury in MM-DD-YYYY format (Workers' Comp)",
          },
          injury_description: { type: "string" as const },
          body_parts: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "List of affected body parts",
          },
          wc_carrier: { type: "string" as const },
          wc_claim_number: { type: "string" as const },
          tpa_name: { type: "string" as const },
          amw: {
            type: "number" as const,
            description: "Average Monthly Wage in dollars",
          },
          compensation_rate: {
            type: "number" as const,
            description: "Weekly compensation rate in dollars",
          },
          disability_type: {
            type: "string" as const,
            enum: ["TTD", "TPD", "PPD", "PTD"],
            description: "Type of disability status",
          },
          mmi_date: {
            type: "string" as const,
            description: "Maximum Medical Improvement date",
          },
          ppd_rating: {
            type: "number" as const,
            description: "Permanent Partial Disability rating percentage",
          },
          work_restrictions: { type: "string" as const },
          return_to_work_date: { type: "string" as const },
          hearing_level: {
            type: "string" as const,
            enum: ["H.O.", "A.O."],
            description: "Hearing level: H.O. (Hearing Officer, default) or A.O. (Appeals Officer, if appeal-related document)",
          },
          hearing_case_number: {
            type: "string" as const,
            description: "Hearing/docket case number (e.g., D-16-12345)",
          },
          next_hearing_date: {
            type: "string" as const,
            description: "Next hearing date if shown in the document",
          },
          hearing_issue: {
            type: "string" as const,
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
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Parse an address - handles both string and object formats.
 */
export function parseAddress(value: unknown): Address | undefined {
  if (!value) return undefined;

  // Already an object
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const result: Address = {};
    if (typeof obj.street === "string") result.street = obj.street;
    if (typeof obj.city === "string") result.city = obj.city;
    if (typeof obj.state === "string") result.state = obj.state;
    if (typeof obj.zip === "string") result.zip = obj.zip;
    // Return undefined if empty
    if (Object.keys(result).length === 0) return undefined;
    return result;
  }

  // String format: "123 Main St, Las Vegas, NV 89101"
  if (typeof value === "string") {
    const str = value.trim();
    if (!str) return undefined;

    // Try "Street, City, State ZIP" format
    const match = str.match(
      /^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/
    );
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
function normalizeShorthandLimits(value: string): string {
  // Already has dollar signs - return as-is
  if (value.includes("$")) return value;

  // Match patterns like "25/50" or "25/50/25"
  const match = value.match(/^(\d+)\/(\d+)(?:\/(\d+))?$/);
  if (match) {
    const per = parseInt(match[1]) * 1000;
    const acc = parseInt(match[2]) * 1000;
    return `$${per.toLocaleString()}/$${acc.toLocaleString()}`;
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
export function normalizePolicyLimits(
  value: unknown
): Record<string, PolicyLimitDetail> | undefined {
  if (!value) return undefined;

  // Handle JSON strings (from LLM or update_index tool)
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        // Not valid JSON - treat as simple limit string
        return {
          "3P": {
            carrier: "Unknown",
            bodily_injury: normalizeShorthandLimits(trimmed),
          },
        };
      }
    } else {
      // Simple string like "$25,000/$50,000"
      return {
        "3P": {
          carrier: "Unknown",
          bodily_injury: normalizeShorthandLimits(trimmed),
        },
      };
    }
  }

  if (typeof value !== "object") return undefined;

  const result: Record<string, PolicyLimitDetail> = {};
  const raw = value as Record<string, unknown>;

  for (const [party, partyValue] of Object.entries(raw)) {
    // Normalize party key to 1P/3P
    const normalizedParty = party.toUpperCase().startsWith("1")
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
    } else if (typeof partyValue === "object" && partyValue !== null) {
      const obj = partyValue as Record<string, unknown>;
      result[normalizedParty] = {
        carrier:
          typeof obj.carrier === "string" ? obj.carrier : "Unknown",
        bodily_injury:
          typeof obj.bodily_injury === "string"
            ? obj.bodily_injury
            : typeof obj.bi === "string"
              ? obj.bi
              : undefined,
        medical_payments:
          typeof obj.medical_payments === "string"
            ? obj.medical_payments
            : typeof obj.med_pay === "string"
              ? obj.med_pay
              : undefined,
        um_uim:
          typeof obj.um_uim === "string"
            ? obj.um_uim
            : typeof obj.um === "string"
              ? obj.um
              : undefined,
        property_damage:
          typeof obj.property_damage === "string"
            ? obj.property_damage
            : typeof obj.pd === "string"
              ? obj.pd
              : undefined,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Normalize providers to array of strings.
 * Handles: string[], object[], mixed arrays
 */
export function normalizeProviders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        return typeof obj.name === "string" ? obj.name : null;
      }
      return null;
    })
    .filter((x): x is string => x !== null && x.length > 0);
}

/**
 * Normalize folders to canonical { files: [...] } structure.
 */
export function normalizeFolders(
  value: unknown
): Record<string, Folder> {
  const result: Record<string, Folder> = {};

  if (!value || typeof value !== "object") return result;

  for (const [name, folderData] of Object.entries(
    value as Record<string, unknown>
  )) {
    let files: unknown[] = [];

    if (Array.isArray(folderData)) {
      files = folderData;
    } else if (typeof folderData === "object" && folderData !== null) {
      const obj = folderData as Record<string, unknown>;
      files = Array.isArray(obj.files)
        ? obj.files
        : Array.isArray(obj.documents)
          ? obj.documents
          : [];
    }

    result[name] = {
      files: files.map((f) => normalizeFileEntry(f)),
    };
  }

  return result;
}

function isSignatureOnlyHandwrittenField(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  return (
    /\bsignature\b/.test(normalized) ||
    /\bsigned by\b/.test(normalized) ||
    /\bsigned\b/.test(normalized) ||
    /\bsigner\b/.test(normalized) ||
    /\binitials?\b/.test(normalized) ||
    normalized === "sign"
  );
}

function normalizeFileEntry(value: unknown): FileEntry {
  if (!value || typeof value !== "object") {
    return {
      filename: "unknown",
      type: "other",
      key_info: "",
      has_handwritten_data: false,
      handwritten_fields: [],
    };
  }

  const obj = value as Record<string, unknown>;
  const seenHandwrittenFields = new Set<string>();
  const handwrittenFields = Array.isArray(obj.handwritten_fields)
    ? obj.handwritten_fields
        .filter(
          (field): field is string =>
            typeof field === "string" && field.trim().length > 0
        )
        .map((field) => field.trim())
        .filter((field) => !isSignatureOnlyHandwrittenField(field))
        .filter((field) => {
          const key = field.toLowerCase();
          if (seenHandwrittenFields.has(key)) return false;
          seenHandwrittenFields.add(key);
          return true;
        })
    : [];
  const hasHandwrittenData = handwrittenFields.length > 0;

  return {
    filename: typeof obj.filename === "string" ? obj.filename : "unknown",
    type: typeof obj.type === "string" ? obj.type : "other",
    key_info: typeof obj.key_info === "string" ? obj.key_info : "",
    date: typeof obj.date === "string" && obj.date.trim() ? obj.date.trim() : undefined,
    issues:
      typeof obj.issues === "string" && obj.issues.trim()
        ? obj.issues.trim()
        : undefined,
    has_handwritten_data: hasHandwrittenData,
    handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
    user_reviewed: typeof obj.user_reviewed === "boolean" ? obj.user_reviewed : undefined,
    reviewed_at:
      typeof obj.reviewed_at === "string" && obj.reviewed_at.trim()
        ? obj.reviewed_at.trim()
        : undefined,
    review_notes:
      typeof obj.review_notes === "string" && obj.review_notes.trim()
        ? obj.review_notes.trim()
        : undefined,
    extracted_data:
      typeof obj.extracted_data === "object" && obj.extracted_data !== null
        ? (obj.extracted_data as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Normalize health_insurance to canonical structure.
 */
export function normalizeHealthInsurance(
  value: unknown
): HealthInsurance | undefined {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;

  // Handle various field name variations
  const carrier = obj.carrier ?? obj.primary_carrier ?? obj.insurance_carrier;
  const group = obj.group_no ?? obj.group_number ?? obj.group;
  const member =
    obj.member_no ??
    obj.member_id ??
    obj.member_number ??
    obj.primary_member_no ??
    obj.member;

  const result: HealthInsurance = {};
  if (typeof carrier === "string") result.carrier = carrier;
  if (typeof group === "string") result.group_no = group;
  if (typeof member === "string") result.member_no = member;

  // Return undefined if all fields are empty
  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
}

/**
 * Normalize contact to canonical structure.
 */
export function normalizeContact(value: unknown): Contact | undefined {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;
  const result: Contact = {};

  if (typeof obj.phone === "string" && obj.phone.trim()) {
    result.phone = obj.phone.trim();
  }
  if (typeof obj.email === "string" && obj.email.trim()) {
    result.email = obj.email.trim();
  }

  const address = parseAddress(obj.address);
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
export function normalizeClaimNumbers(
  value: unknown
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const result: Record<string, string> = {};
  const obj = value as Record<string, unknown>;

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string" && val.trim()) {
      // Normalize key format: 1P_CarrierName, 3P_CarrierName
      const normalizedKey = key
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
export function normalizeEmployer(value: unknown): Employer | undefined {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;
  const name = obj.name ?? obj.employer_name ?? obj.employer;

  if (typeof name !== "string" || !name.trim()) return undefined;

  const result: Employer = { name: name.trim() };

  const address = parseAddress(obj.address ?? obj.employer_address);
  if (address) result.address = address;

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
export function normalizeWCCarrier(value: unknown): WCCarrier | undefined {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;
  const name = obj.name ?? obj.carrier ?? obj.wc_carrier ?? obj.insurer;

  if (typeof name !== "string" || !name.trim()) return undefined;

  const result: WCCarrier = { name: name.trim() };

  if (typeof obj.claim_number === "string" && obj.claim_number.trim()) {
    result.claim_number = obj.claim_number.trim();
  } else if (typeof obj.wc_claim_number === "string" && obj.wc_claim_number.trim()) {
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
export function normalizeDisabilityStatus(value: unknown): DisabilityStatus | undefined {
  if (!value || typeof value !== "object") return undefined;

  const obj = value as Record<string, unknown>;
  const result: DisabilityStatus = {};

  const disabilityType = validateDisabilityType(obj.type ?? obj.disability_type);
  if (disabilityType) result.type = disabilityType;

  // Accept both amw (canonical) and aww (legacy), store as amw
  const amwRaw = obj.amw ?? obj.aww;
  if (typeof amwRaw === "number") result.amw = amwRaw;
  else if (typeof amwRaw === "string") result.amw = parseAmount(amwRaw);

  if (typeof obj.compensation_rate === "number") result.compensation_rate = obj.compensation_rate;
  else if (typeof obj.compensation_rate === "string") result.compensation_rate = parseAmount(obj.compensation_rate);

  if (typeof obj.mmi_date === "string" && obj.mmi_date.trim()) {
    result.mmi_date = obj.mmi_date.trim();
  }

  if (typeof obj.ppd_rating === "number") result.ppd_rating = obj.ppd_rating;
  else if (typeof obj.ppd_rating === "string") result.ppd_rating = parseFloat(obj.ppd_rating) || undefined;

  if (typeof obj.ppd_weeks === "number") result.ppd_weeks = obj.ppd_weeks;

  if (typeof obj.return_to_work_date === "string" && obj.return_to_work_date.trim()) {
    result.return_to_work_date = obj.return_to_work_date.trim();
  }

  if (typeof obj.work_restrictions === "string" && obj.work_restrictions.trim()) {
    result.work_restrictions = obj.work_restrictions.trim();
  }

  // Return undefined if empty
  if (Object.keys(result).length === 0) return undefined;

  return result;
}

// =============================================================================
// PHASE AND ENUM VALIDATORS
// =============================================================================

/**
 * Validate phase based on practice area.
 * Invalid phases default to "Intake".
 */
function validatePhase(value: unknown, practiceArea?: string): CasePhase {
  if (typeof value !== "string") return "Intake";

  const validPhases = getPhasesForPracticeArea(practiceArea);
  if (validPhases.includes(value as CasePhase)) {
    return value as CasePhase;
  }

  // Try to map PI phases to WC equivalents and vice versa
  if (practiceArea === PRACTICE_AREAS.WC) {
    const piToWcMap: Record<string, CasePhase> = {
      "Demand": "Benefits Resolution",
      "Negotiation": "Benefits Resolution",
      "Complete": "Closed",
    };
    if (piToWcMap[value]) return piToWcMap[value];
  } else {
    const wcToPiMap: Record<string, CasePhase> = {
      "MMI Evaluation": "Treatment",
      "Benefits Resolution": "Negotiation",
      "Settlement/Hearing": "Settlement",
      "Closed": "Complete",
    };
    if (wcToPiMap[value]) return wcToPiMap[value];
  }

  return "Intake";
}

const VALID_LIABILITY = ["clear", "moderate", "contested"] as const;

function validateLiability(
  value: unknown
): "clear" | "moderate" | "contested" | null {
  if (
    typeof value === "string" &&
    VALID_LIABILITY.includes(value as (typeof VALID_LIABILITY)[number])
  ) {
    return value as "clear" | "moderate" | "contested";
  }
  return null;
}

const VALID_INJURY_TIERS = [
  "tier_1_soft_tissue",
  "tier_2_structural",
  "tier_3_surgical",
] as const;

function validateInjuryTier(
  value: unknown
): (typeof VALID_INJURY_TIERS)[number] | null {
  if (
    typeof value === "string" &&
    VALID_INJURY_TIERS.includes(value as (typeof VALID_INJURY_TIERS)[number])
  ) {
    return value as (typeof VALID_INJURY_TIERS)[number];
  }
  return null;
}

const VALID_COMPENSABILITY = [
  "clearly_compensable",
  "likely_compensable",
  "disputed",
  "denied",
] as const;

function validateCompensability(
  value: unknown
): (typeof VALID_COMPENSABILITY)[number] | null {
  if (
    typeof value === "string" &&
    VALID_COMPENSABILITY.includes(value as (typeof VALID_COMPENSABILITY)[number])
  ) {
    return value as (typeof VALID_COMPENSABILITY)[number];
  }
  return null;
}

const VALID_CLAIM_TYPES = [
  "specific_injury",
  "occupational_disease",
  "cumulative_trauma",
] as const;

function validateClaimType(
  value: unknown
): (typeof VALID_CLAIM_TYPES)[number] | null {
  if (
    typeof value === "string" &&
    VALID_CLAIM_TYPES.includes(value as (typeof VALID_CLAIM_TYPES)[number])
  ) {
    return value as (typeof VALID_CLAIM_TYPES)[number];
  }
  return null;
}

const VALID_DISABILITY_TYPES = ["TTD", "TPD", "PPD", "PTD"] as const;

function validateDisabilityType(
  value: unknown
): (typeof VALID_DISABILITY_TYPES)[number] | undefined {
  if (
    typeof value === "string" &&
    VALID_DISABILITY_TYPES.includes(value as (typeof VALID_DISABILITY_TYPES)[number])
  ) {
    return value as (typeof VALID_DISABILITY_TYPES)[number];
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
export function normalizeIndex(raw: unknown, practiceArea?: string): DocumentIndex {
  if (!raw || typeof raw !== "object") {
    throw new Error("normalizeIndex: input must be an object");
  }

  const input = raw as Record<string, unknown>;
  const rawSummary = (input.summary ?? {}) as Record<string, unknown>;

  // Determine practice area (param > data > default to PI)
  const detectedPracticeArea =
    practiceArea ??
    (typeof input.practice_area === "string" ? input.practice_area : undefined);
  const isWC = detectedPracticeArea === PRACTICE_AREAS.WC;

  // Normalize incident date - accept dol (PI), doi (WC), or incident_date
  const incidentDate =
    typeof rawSummary.incident_date === "string"
      ? rawSummary.incident_date
      : typeof rawSummary.dol === "string"
        ? rawSummary.dol
        : typeof rawSummary.doi === "string"
          ? rawSummary.doi
          : "Unknown";

  // Build normalized summary with common fields
  const summary: Summary = {
    client:
      typeof rawSummary.client === "string" ? rawSummary.client : "Unknown",
    incident_date: incidentDate,
    dob: typeof rawSummary.dob === "string" ? rawSummary.dob : undefined,
    providers: normalizeProviders(rawSummary.providers),
    total_charges: parseAmount(rawSummary.total_charges),
    contact: normalizeContact(rawSummary.contact),
    health_insurance: normalizeHealthInsurance(rawSummary.health_insurance),
    case_summary:
      typeof rawSummary.case_summary === "string"
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
      summary.body_parts = rawSummary.body_parts.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
      if (summary.body_parts.length === 0) delete summary.body_parts;
    }
  }

  // Clean up undefined optional fields
  if (!summary.dob) delete summary.dob;
  if (!summary.policy_limits) delete summary.policy_limits;
  if (!summary.contact) delete summary.contact;
  if (!summary.health_insurance) delete summary.health_insurance;
  if (!summary.claim_numbers) delete summary.claim_numbers;
  if (!summary.employer) delete summary.employer;
  if (!summary.wc_carrier) delete summary.wc_carrier;
  if (!summary.disability_status) delete summary.disability_status;
  if (!summary.job_title) delete summary.job_title;
  if (!summary.injury_description) delete summary.injury_description;

  // Build full normalized index
  const normalized: DocumentIndex = {
    indexed_at:
      typeof input.indexed_at === "string"
        ? input.indexed_at
        : new Date().toISOString(),
    case_name:
      typeof input.case_name === "string" ? input.case_name : "Unknown",
    case_phase: validatePhase(input.case_phase, detectedPracticeArea),
    summary,
    folders: normalizeFolders(input.folders),
  };

  // Add practice_area if explicitly set (omit for PI to maintain backward compat)
  if (detectedPracticeArea === PRACTICE_AREAS.WC) {
    normalized.practice_area = PRACTICE_AREAS.WC;
  }

  // Optional arrays - only include if present
  if (Array.isArray(input.failed_files) && input.failed_files.length > 0) {
    normalized.failed_files = input.failed_files as DocumentIndex["failed_files"];
  }
  if (Array.isArray(input.issues_found) && input.issues_found.length > 0) {
    normalized.issues_found = input.issues_found.filter(
      (x): x is string => typeof x === "string"
    );
  }
  if (Array.isArray(input.needs_review) && input.needs_review.length > 0) {
    normalized.needs_review = input.needs_review as DocumentIndex["needs_review"];
  }
  if (Array.isArray(input.errata) && input.errata.length > 0) {
    normalized.errata = input.errata as DocumentIndex["errata"];
  }
  if (
    typeof input.reconciled_values === "object" &&
    input.reconciled_values !== null
  ) {
    normalized.reconciled_values = input.reconciled_values as Record<
      string,
      unknown
    >;
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
      normalized.open_hearings = (input.open_hearings as any[])
        .filter((h: any) => h && typeof h === "object" && typeof h.case_number === "string")
        .map((h: any) => ({
          case_number: h.case_number,
          hearing_level: h.hearing_level === "A.O." ? "A.O." as const
            : h.type === "A.O." ? "A.O." as const  // Legacy field mapping
            : "H.O." as const,
          next_date: typeof h.next_date === "string" ? h.next_date : undefined,
          issue: typeof h.issue === "string" ? h.issue : undefined,
        }));
      if (normalized.open_hearings.length === 0) delete normalized.open_hearings;
    }
  }

  // Linked case relationships
  if (input.parent_case && typeof input.parent_case === "object") {
    const pc = input.parent_case as Record<string, unknown>;
    if (typeof pc.path === "string" && typeof pc.name === "string") {
      normalized.parent_case = { path: pc.path, name: pc.name };
    }
  }
  if (Array.isArray(input.related_cases) && input.related_cases.length > 0) {
    const filtered = input.related_cases.filter(
      (rc): rc is { path: string; name: string; type: "subcase" | "sibling" | "doi_sibling"; dateOfInjury?: string } =>
        rc && typeof rc === "object" &&
        typeof (rc as any).path === "string" &&
        typeof (rc as any).name === "string" &&
        ["subcase", "sibling", "doi_sibling"].includes((rc as any).type)
    ).map((rc) => {
      const result: RelatedCase = {
        path: (rc as any).path,
        name: (rc as any).name,
        type: (rc as any).type,
      };
      // Include dateOfInjury for DOI siblings
      if ((rc as any).dateOfInjury && typeof (rc as any).dateOfInjury === "string") {
        result.dateOfInjury = (rc as any).dateOfInjury;
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
    const assignments = input.assignments
      .filter((assignment): assignment is { userId: string; assignedAt: string; assignedBy: string } =>
        !!assignment &&
        typeof assignment === "object" &&
        typeof (assignment as any).userId === "string" &&
        typeof (assignment as any).assignedAt === "string" &&
        typeof (assignment as any).assignedBy === "string"
      )
      .map((assignment) => ({
        userId: assignment.userId,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
      }));
    if (assignments.length > 0) {
      normalized.assignments = assignments;
    }
  }

  // DOI container relationships
  if (input.container && typeof input.container === "object") {
    const cont = input.container as Record<string, unknown>;
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
export function validateIndex(
  data: unknown
): { valid: boolean; issues: string[] } {
  const result = DocumentIndexSchema.safeParse(data);
  if (result.success) {
    return { valid: true, issues: [] };
  }
  return {
    valid: false,
    issues: result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    ),
  };
}
