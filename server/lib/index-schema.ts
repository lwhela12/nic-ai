/**
 * Canonical Document Index Schema
 *
 * This is the SINGLE SOURCE OF TRUTH for document_index.json structure.
 * All extraction output flows through normalizeIndex() before being written.
 * The UI can trust this schema completely - no defensive coding needed.
 */

import { z } from "zod";

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
});

export const PolicyLimitDetailSchema = z.object({
  carrier: z.string(),
  bodily_injury: z.string().optional(),
  medical_payments: z.string().optional(),
  um_uim: z.string().optional(),
  property_damage: z.string().optional(),
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

export const SummarySchema = z.object({
  client: z.string(),
  dol: z.string(),
  dob: z.string().optional(),
  providers: z.array(z.string()),
  total_charges: z.number(),
  policy_limits: z.record(z.string(), PolicyLimitDetailSchema).optional(),
  contact: ContactSchema.optional(),
  health_insurance: HealthInsuranceSchema.optional(),
  claim_numbers: z.record(z.string(), z.string()).optional(),
  case_summary: z.string(),
});

export const FileEntrySchema = z.object({
  filename: z.string(),
  type: z.string(),
  key_info: z.string(),
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

export const CasePhaseSchema = z.enum([
  "Intake",
  "Investigation",
  "Treatment",
  "Demand",
  "Negotiation",
  "Settlement",
  "Complete",
]);

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
  type: z.enum(["subcase", "sibling"]),
});

export const DocumentIndexSchema = z.object({
  indexed_at: z.string(),
  case_name: z.string(),
  case_phase: CasePhaseSchema,
  summary: SummarySchema,
  folders: z.record(z.string(), FolderSchema),
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
  // Assessment fields
  liability_assessment: LiabilitySchema.nullable().optional(),
  injury_tier: InjuryTierSchema.nullable().optional(),
  estimated_value_range: z.string().nullable().optional(),
  policy_limits_demand_appropriate: z.boolean().nullable().optional(),
  // Linked case relationships
  parent_case: LinkedCaseSchema.optional(),
  related_cases: z.array(RelatedCaseSchema).optional(),
  is_subcase: z.boolean().optional(),
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

// =============================================================================
// JSON SCHEMA FOR ANTHROPIC API (tool_use)
// =============================================================================

/**
 * JSON Schema for per-file extraction via tool_use.
 * Used with direct Haiku calls (pre-extracted text path).
 */
export const FILE_EXTRACTION_TOOL_SCHEMA = {
  name: "extract_document",
  description:
    "Extract structured information from a document. Call this tool with all extracted data.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: [
          "intake_form",
          "lor",
          "declaration",
          "medical_record",
          "medical_bill",
          "correspondence",
          "authorization",
          "identification",
          "police_report",
          "demand",
          "settlement",
          "lien",
          "balance_request",
          "balance_confirmation",
          "property_damage",
          "other",
        ],
        description: "Document type classification",
      },
      key_info: {
        type: "string" as const,
        description:
          "2-3 sentence summary of the most important information in this document",
      },
      extracted_data: {
        type: "object" as const,
        description: "Structured data extracted from the document",
        properties: {
          // Client info
          client_name: { type: "string" as const },
          dob: {
            type: "string" as const,
            description: "Date of birth in MM/DD/YYYY format",
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
            description: "Date of loss/accident in MM/DD/YYYY format",
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

          // Adjuster info
          adjuster_name: { type: "string" as const },
          adjuster_phone: { type: "string" as const },
          adjuster_email: { type: "string" as const },
        },
      },
    },
    required: ["type", "key_info", "extracted_data"],
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

function normalizeFileEntry(value: unknown): FileEntry {
  if (!value || typeof value !== "object") {
    return { filename: "unknown", type: "other", key_info: "" };
  }

  const obj = value as Record<string, unknown>;
  return {
    filename: typeof obj.filename === "string" ? obj.filename : "unknown",
    type: typeof obj.type === "string" ? obj.type : "other",
    key_info: typeof obj.key_info === "string" ? obj.key_info : "",
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
// PHASE AND ENUM VALIDATORS
// =============================================================================

const VALID_PHASES = [
  "Intake",
  "Investigation",
  "Treatment",
  "Demand",
  "Negotiation",
  "Settlement",
  "Complete",
] as const;

function validatePhase(value: unknown): CasePhase {
  if (typeof value === "string" && VALID_PHASES.includes(value as CasePhase)) {
    return value as CasePhase;
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

// =============================================================================
// MAIN NORMALIZATION ENTRY POINT
// =============================================================================

/**
 * Normalize any raw index data to conform to the canonical schema.
 *
 * This is the ONLY function that should be called before writing document_index.json.
 * It coerces all fields to their expected types and structures.
 */
export function normalizeIndex(raw: unknown): DocumentIndex {
  if (!raw || typeof raw !== "object") {
    throw new Error("normalizeIndex: input must be an object");
  }

  const input = raw as Record<string, unknown>;
  const rawSummary = (input.summary ?? {}) as Record<string, unknown>;

  // Build normalized summary
  const summary: Summary = {
    client:
      typeof rawSummary.client === "string" ? rawSummary.client : "Unknown",
    dol: typeof rawSummary.dol === "string" ? rawSummary.dol : "Unknown",
    dob: typeof rawSummary.dob === "string" ? rawSummary.dob : undefined,
    providers: normalizeProviders(rawSummary.providers),
    total_charges: parseAmount(rawSummary.total_charges),
    policy_limits: normalizePolicyLimits(rawSummary.policy_limits),
    contact: normalizeContact(rawSummary.contact),
    health_insurance: normalizeHealthInsurance(rawSummary.health_insurance),
    claim_numbers: normalizeClaimNumbers(rawSummary.claim_numbers),
    case_summary:
      typeof rawSummary.case_summary === "string"
        ? rawSummary.case_summary
        : "No summary available",
  };

  // Clean up undefined optional fields (Zod handles this but cleaner JSON)
  if (!summary.dob) delete summary.dob;
  if (!summary.policy_limits) delete summary.policy_limits;
  if (!summary.contact) delete summary.contact;
  if (!summary.health_insurance) delete summary.health_insurance;
  if (!summary.claim_numbers) delete summary.claim_numbers;

  // Build full normalized index
  const normalized: DocumentIndex = {
    indexed_at:
      typeof input.indexed_at === "string"
        ? input.indexed_at
        : new Date().toISOString(),
    case_name:
      typeof input.case_name === "string" ? input.case_name : "Unknown",
    case_phase: validatePhase(input.case_phase),
    summary,
    folders: normalizeFolders(input.folders),
  };

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

  // Assessment fields
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

  // Linked case relationships
  if (input.parent_case && typeof input.parent_case === "object") {
    const pc = input.parent_case as Record<string, unknown>;
    if (typeof pc.path === "string" && typeof pc.name === "string") {
      normalized.parent_case = { path: pc.path, name: pc.name };
    }
  }
  if (Array.isArray(input.related_cases) && input.related_cases.length > 0) {
    const filtered = input.related_cases.filter(
      (rc): rc is { path: string; name: string; type: "subcase" | "sibling" } =>
        rc && typeof rc === "object" &&
        typeof (rc as any).path === "string" &&
        typeof (rc as any).name === "string" &&
        ["subcase", "sibling"].includes((rc as any).type)
    );
    if (filtered.length > 0) {
      normalized.related_cases = filtered;
    }
  }
  if (typeof input.is_subcase === "boolean") {
    normalized.is_subcase = input.is_subcase;
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
