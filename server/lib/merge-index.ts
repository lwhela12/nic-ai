/**
 * Programmatic Index Merge
 *
 * Merges hypergraph output + Haiku case summary into final document index.
 * No LLM calls - pure data transformation.
 */

import type { CaseSummaryResult } from "./case-summary";

// Hypergraph structure from Haiku
export interface HypergraphField {
  values: Array<{
    value: string;
    sources: string[];
    count: number;
  }>;
  consensus: string;
  confidence: number;
  has_conflict: boolean;
}

export interface HypergraphConflict {
  field: string;
  consensus_value: string;
  consensus_sources: string[];
  outlier_value: string;
  outlier_sources: string[];
  likely_reason?: string;
}

export interface HypergraphResult {
  hypergraph: Record<string, HypergraphField>;
  conflicts: HypergraphConflict[];
  summary: {
    total_fields_analyzed: number;
    fields_with_conflicts: number;
    confidence_score: number;
  };
}

// Needs review item for final index
export interface NeedsReviewItem {
  field: string;
  conflicting_values: string[];
  sources: string[];
  reason: string;
}

// Errata item for final index
export interface ErrataItem {
  field: string;
  decision: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

// Policy limit detail structure (matches canonical schema)
export interface PolicyLimitDetail {
  carrier: string;
  bodily_injury?: string;
  medical_payments?: string;
  um_uim?: string;
  property_damage?: string;
}

// Final summary structure
export interface CaseSummary {
  client: string;
  dol: string;
  dob?: string;
  providers: string[];
  total_charges: number;
  policy_limits?: Record<string, PolicyLimitDetail>;
  contact?: {
    phone?: string;
    email?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  health_insurance?: {
    carrier?: string;
    group_no?: string;
    member_no?: string;
  };
  claim_numbers?: Record<string, string>;
  case_summary: string;
}

/**
 * Parse an address string into components.
 * Handles formats like "123 Main St, Las Vegas, NV 89101"
 */
function parseAddress(addressStr: string): { street?: string; city?: string; state?: string; zip?: string } {
  if (!addressStr) return {};

  // Try to parse "Street, City, State ZIP" format
  const match = addressStr.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (match) {
    return {
      street: match[1].trim(),
      city: match[2].trim(),
      state: match[3],
      zip: match[4] || undefined
    };
  }

  // Fallback: just put whole thing in street
  return { street: addressStr };
}

/**
 * Convert confidence score to high/medium/low.
 */
function confidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

/**
 * Extract provider names from hypergraph charge fields.
 * Charge fields are named like "charges:Provider Name" or "provider_charges:Provider Name"
 */
function extractProviders(hypergraph: Record<string, HypergraphField>): string[] {
  const providers: string[] = [];

  for (const fieldName of Object.keys(hypergraph)) {
    let providerName: string | null = null;
    if (fieldName.startsWith("charges:")) {
      providerName = fieldName.replace("charges:", "").trim();
    } else if (fieldName.startsWith("provider_charges:")) {
      providerName = fieldName.replace("provider_charges:", "").trim();
    }
    if (providerName && !providers.includes(providerName)) {
      providers.push(providerName);
    }
  }

  return providers;
}

/**
 * Calculate total charges from hypergraph charge fields.
 * Uses values even if UNCERTAIN - better to show approximate data than nothing.
 */
function calculateTotalCharges(hypergraph: Record<string, HypergraphField>): number {
  let total = 0;

  for (const [fieldName, field] of Object.entries(hypergraph)) {
    // Support both "charges:" and "provider_charges:" prefixes for consistency
    if ((fieldName.startsWith("charges:") || fieldName.startsWith("provider_charges:")) && field.values?.length > 0) {
      // Use consensus if available, otherwise use the first value
      const valueToUse = field.consensus && field.consensus !== "UNCERTAIN"
        ? field.consensus
        : field.values[0]?.value;
      if (valueToUse) {
        const amount = parseFloat(valueToUse.replace(/[$,]/g, ""));
        if (!isNaN(amount)) {
          total += amount;
        }
      }
    }
  }

  // Also check for total_medical field
  const totalMedical = hypergraph["total_medical"];
  if (totalMedical?.values?.length > 0) {
    const valueToUse = totalMedical.consensus && totalMedical.consensus !== "UNCERTAIN"
      ? totalMedical.consensus
      : totalMedical.values[0]?.value;
    if (valueToUse) {
      const amount = parseFloat(valueToUse.replace(/[$,]/g, ""));
      if (!isNaN(amount) && amount > total) {
        total = amount; // Use the higher value
      }
    }
  }

  return total;
}

/**
 * Convert hypergraph conflicts to needs_review items.
 * Also adds UNCERTAIN fields as needs_review.
 */
function buildNeedsReview(hypergraphResult: HypergraphResult): NeedsReviewItem[] {
  const needsReview: NeedsReviewItem[] = [];

  // Add explicit conflicts
  for (const conflict of hypergraphResult.conflicts) {
    needsReview.push({
      field: conflict.field,
      conflicting_values: [conflict.consensus_value, conflict.outlier_value],
      sources: [...conflict.consensus_sources, ...conflict.outlier_sources],
      reason: conflict.likely_reason || `Conflicting values found: "${conflict.consensus_value}" vs "${conflict.outlier_value}"`
    });
  }

  // Add UNCERTAIN fields
  for (const [fieldName, field] of Object.entries(hypergraphResult.hypergraph)) {
    if (field.consensus === "UNCERTAIN") {
      const values = field.values.map(v => v.value);
      const sources = field.values.flatMap(v => v.sources);

      needsReview.push({
        field: fieldName,
        conflicting_values: values,
        sources: [...new Set(sources)],
        reason: `No clear consensus - values have equal support`
      });
    }
  }

  return needsReview;
}

/**
 * Generate errata entries documenting decisions made.
 */
function buildErrata(hypergraphResult: HypergraphResult): ErrataItem[] {
  const errata: ErrataItem[] = [];

  // Document each field where we have a consensus
  for (const [fieldName, field] of Object.entries(hypergraphResult.hypergraph)) {
    // Skip UNCERTAIN fields (they go to needs_review)
    if (field.consensus === "UNCERTAIN") continue;

    // Skip fields with no conflicts (high confidence, obvious)
    if (!field.has_conflict && field.confidence >= 0.9) continue;

    // Document the decision
    const valueCount = field.values.length;
    const consensusValue = field.values.find(v => v.value === field.consensus);
    const sourceCount = consensusValue?.count || 0;

    let evidence = `${sourceCount} of ${field.values.reduce((sum, v) => sum + v.count, 0)} documents support this value`;
    if (field.has_conflict) {
      const outliers = field.values.filter(v => v.value !== field.consensus);
      evidence += `. Outliers: ${outliers.map(o => `"${o.value}" (${o.count} doc${o.count > 1 ? 's' : ''})`).join(", ")}`;
    }

    errata.push({
      field: fieldName,
      decision: field.consensus,
      evidence,
      confidence: confidenceLevel(field.confidence)
    });
  }

  return errata;
}

/**
 * Build claim_numbers object from hypergraph.
 * Uses new field names: claim_number_1p, claim_number_3p
 * Falls back to legacy insurance_claim_numbers field if new fields not present.
 */
function buildClaimNumbers(hypergraph: Record<string, HypergraphField>): Record<string, string> {
  const claims: Record<string, string> = {};

  // Try new structured fields first
  const claim1p = hypergraph["claim_number_1p"];
  if (claim1p?.consensus && claim1p.consensus !== "UNCERTAIN") {
    claims["1P"] = claim1p.consensus;
  }

  const claim3p = hypergraph["claim_number_3p"];
  if (claim3p?.consensus && claim3p.consensus !== "UNCERTAIN") {
    claims["3P"] = claim3p.consensus;
  }

  // Fallback to legacy field if no new fields
  if (Object.keys(claims).length === 0) {
    const legacyField = hypergraph["insurance_claim_numbers"];
    if (legacyField && legacyField.consensus !== "UNCERTAIN") {
      for (const valueEntry of legacyField.values) {
        const value = valueEntry.value;
        const sources = valueEntry.sources.join(" ").toLowerCase();

        if (sources.includes("1p") || sources.includes("medpay")) {
          claims["1P"] = value;
        } else if (sources.includes("3p") || sources.includes("geico")) {
          claims["3P"] = value;
        } else {
          claims[`claim_${Object.keys(claims).length + 1}`] = value;
        }
      }
    }
  }

  return claims;
}

/**
 * Parse a policy limits object from hypergraph consensus.
 * Handles both JSON object strings and simple limit strings.
 */
function parsePolicyLimitObject(value: string): {
  carrier?: string;
  bodily_injury?: string;
  medical_payments?: string;
  um_uim?: string;
  property_damage?: string;
} | null {
  if (!value || value === "UNCERTAIN") return null;

  // Try to parse as JSON object
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        carrier: typeof parsed.carrier === "string" ? parsed.carrier : undefined,
        bodily_injury: typeof parsed.bodily_injury === "string" ? parsed.bodily_injury : undefined,
        medical_payments: typeof parsed.medical_payments === "string" ? parsed.medical_payments : undefined,
        um_uim: typeof parsed.um_uim === "string" ? parsed.um_uim : undefined,
        property_damage: typeof parsed.property_damage === "string" ? parsed.property_damage : undefined,
      };
    }
  } catch {
    // Not JSON - treat as simple limits string
  }

  // Simple string like "$25,000/$50,000" - put in bodily_injury
  return {
    carrier: "Unknown",
    bodily_injury: value,
  };
}

/**
 * Build policy_limits object from hypergraph.
 * Uses new field names: policy_limits_1p, policy_limits_3p
 * Falls back to legacy policy_limits field if new fields not present.
 */
function buildPolicyLimits(hypergraph: Record<string, HypergraphField>): Record<string, {
  carrier: string;
  bodily_injury?: string;
  medical_payments?: string;
  um_uim?: string;
  property_damage?: string;
}> {
  const limits: Record<string, {
    carrier: string;
    bodily_injury?: string;
    medical_payments?: string;
    um_uim?: string;
    property_damage?: string;
  }> = {};

  // Try new structured fields first
  // Use values even if UNCERTAIN - they'll be flagged for review but still displayed
  const limits1p = hypergraph["policy_limits_1p"];
  if (limits1p?.values?.length > 0) {
    // Use consensus if available, otherwise use the first (most common) value
    const valueToUse = limits1p.consensus && limits1p.consensus !== "UNCERTAIN"
      ? limits1p.consensus
      : limits1p.values[0]?.value;
    if (valueToUse) {
      const parsed = parsePolicyLimitObject(valueToUse);
      if (parsed) {
        limits["1P"] = { carrier: parsed.carrier || "Unknown", ...parsed };
      }
    }
  }

  const limits3p = hypergraph["policy_limits_3p"];
  if (limits3p?.values?.length > 0) {
    const valueToUse = limits3p.consensus && limits3p.consensus !== "UNCERTAIN"
      ? limits3p.consensus
      : limits3p.values[0]?.value;
    if (valueToUse) {
      const parsed = parsePolicyLimitObject(valueToUse);
      if (parsed) {
        limits["3P"] = { carrier: parsed.carrier || "Unknown", ...parsed };
      }
    }
  }

  // Fallback to legacy policy_limits field if no new fields
  if (Object.keys(limits).length === 0) {
    const legacyField = hypergraph["policy_limits"];
    if (legacyField && legacyField.values.length > 0) {
      for (const valueEntry of legacyField.values) {
        const sources = valueEntry.sources.join(" ").toLowerCase();
        const parsed = parsePolicyLimitObject(valueEntry.value);
        if (!parsed) continue;

        if (sources.includes("1p") || sources.includes("medpay") || sources.includes("mp")) {
          limits["1P"] = { carrier: parsed.carrier || "Unknown", ...parsed };
        } else if (sources.includes("3p") || sources.includes("geico") || sources.includes("adverse")) {
          limits["3P"] = { carrier: parsed.carrier || "Unknown", ...parsed };
        } else if (legacyField.values.length === 1) {
          limits["3P"] = { carrier: parsed.carrier || "Unknown", ...parsed };
        }
      }
    }
  }

  return limits;
}

/**
 * Build health_insurance object from hypergraph.
 * Uses new structured health_insurance field or falls back to individual fields.
 */
function buildHealthInsurance(hypergraph: Record<string, HypergraphField>): {
  carrier?: string;
  group_no?: string;
  member_no?: string;
} | undefined {
  // Try new structured field first
  const hiField = hypergraph["health_insurance"];
  if (hiField?.consensus && hiField.consensus !== "UNCERTAIN") {
    try {
      const parsed = JSON.parse(hiField.consensus);
      if (typeof parsed === "object" && parsed !== null) {
        const result: { carrier?: string; group_no?: string; member_no?: string } = {};
        if (typeof parsed.carrier === "string") result.carrier = parsed.carrier;
        if (typeof parsed.group_no === "string") result.group_no = parsed.group_no;
        if (typeof parsed.member_no === "string") result.member_no = parsed.member_no;
        if (Object.keys(result).length > 0) return result;
      }
    } catch {
      // Not JSON - treat as carrier name only
      return { carrier: hiField.consensus };
    }
  }

  // Fallback to legacy individual fields
  const getConsensus = (field: string): string | undefined => {
    const f = hypergraph[field];
    if (!f || f.consensus === "UNCERTAIN") return undefined;
    return f.consensus;
  };

  const carrier = getConsensus("health_insurance_carrier");
  const group_no = getConsensus("health_insurance_group");
  const member_no = getConsensus("health_insurance_member");

  if (!carrier && !group_no && !member_no) return undefined;

  return { carrier, group_no, member_no };
}

/**
 * Format client name as case name (LASTNAME, Firstname).
 */
function formatCaseName(clientName: string): string {
  if (!clientName) return "Unknown";

  const parts = clientName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].toUpperCase();
  }

  const lastName = parts[parts.length - 1].toUpperCase();
  const firstName = parts.slice(0, -1).join(" ");

  return `${lastName}, ${firstName}`;
}

/**
 * Main merge function: combines hypergraph + case summary into final index structure.
 */
export function mergeToIndex(
  hypergraphResult: HypergraphResult,
  caseSummaryResult: CaseSummaryResult,
  existingIndex: Record<string, any>
): Record<string, any> {
  const hg = hypergraphResult.hypergraph;

  // Get consensus values with fallback
  const getConsensus = (field: string, fallback: string = ""): string => {
    const f = hg[field];
    if (!f || f.consensus === "UNCERTAIN") return fallback;
    return f.consensus;
  };

  // Build summary object
  const summary: CaseSummary = {
    client: getConsensus("client_name", "Unknown"),
    dol: getConsensus("date_of_loss") || getConsensus("dol", "Unknown"),
    dob: getConsensus("date_of_birth") || getConsensus("dob") || undefined,
    providers: extractProviders(hg),
    total_charges: calculateTotalCharges(hg),
    policy_limits: buildPolicyLimits(hg),
    contact: {
      phone: getConsensus("client_phone") || getConsensus("phone") || undefined,
      email: getConsensus("client_email") || getConsensus("email") || undefined,
      address: parseAddress(getConsensus("client_address") || getConsensus("address"))
    },
    health_insurance: buildHealthInsurance(hg),
    claim_numbers: buildClaimNumbers(hg),
    case_summary: caseSummaryResult.case_summary
  };

  // Clean up empty nested objects
  if (!summary.contact?.phone && !summary.contact?.email && !summary.contact?.address?.street) {
    delete summary.contact;
  }
  if (!summary.health_insurance) {
    delete summary.health_insurance;
  }
  if (Object.keys(summary.claim_numbers || {}).length === 0) {
    delete summary.claim_numbers;
  }
  if (Object.keys(summary.policy_limits || {}).length === 0) {
    delete summary.policy_limits;
  }

  // Build needs_review and errata
  const needsReview = buildNeedsReview(hypergraphResult);
  const errata = buildErrata(hypergraphResult);

  // Merge into final index
  return {
    ...existingIndex,
    indexed_at: new Date().toISOString(),
    case_name: formatCaseName(summary.client),
    case_phase: caseSummaryResult.case_phase,
    summary,
    needs_review: needsReview,
    errata,
    // Preserve these from existing if present
    reconciled_values: existingIndex.reconciled_values || {},
    case_notes: existingIndex.case_notes || [],
    chat_archives: existingIndex.chat_archives || []
  };
}
