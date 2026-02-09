/**
 * Programmatic Index Merge
 *
 * Merges hypergraph output + Haiku case summary into final document index.
 * No LLM calls - pure data transformation.
 */

import type { CaseSummaryResult } from "./case-summary";
import { PRACTICE_AREAS } from "./index-schema";

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
  confidence: "high" | "medium" | "low" | string;
  resolution_type?: "user_decision" | "batch_review" | "auto";
  resolved_at?: string;
  rejected_values?: string[];
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
  // Common fields
  client: string;
  dol: string;  // PI: date_of_loss, WC: date_of_injury
  incident_date?: string;  // Canonical field (normalized from dol/doi)
  dob?: string;
  providers: string[];
  total_charges: number;
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
  claim_numbers?: Record<string, string>;
  case_summary: string;

  // PI-specific fields
  policy_limits?: Record<string, PolicyLimitDetail>;
  health_insurance?: {
    carrier?: string;
    group_no?: string;
    member_no?: string;
  };

  // WC-specific fields
  employer?: {
    name?: string;
    address?: string;
    phone?: string;
  };
  wc_carrier?: {
    carrier?: string;
    claim_number?: string;
    adjuster?: string;
    adjuster_phone?: string;
    tpa?: string;
  };
  disability_status?: {
    type?: string;  // TTD, TPD, PPD, PTD
    amw?: number;   // Average Monthly Wage
    compensation_rate?: number;
    mmi_date?: string;
    ppd_rating?: number;
  };
  job_title?: string;
  injury_description?: string;
  body_parts?: string[];
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
 * Return the best available value for a hypergraph field.
 * Prefers explicit consensus, otherwise highest-support value.
 */
function mostLikelyFieldValue(field?: HypergraphField): string | undefined {
  if (!field || !Array.isArray(field.values) || field.values.length === 0) return undefined;
  if (field.consensus && field.consensus !== "UNCERTAIN") return field.consensus;
  const sorted = [...field.values].sort((a, b) => b.count - a.count);
  return sorted[0]?.value;
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
function mergeNeedsReviewItems(items: NeedsReviewItem[]): NeedsReviewItem[] {
  const merged = new Map<string, {
    field: string;
    conflicting_values: Set<string>;
    sources: Set<string>;
    reasons: Set<string>;
  }>();

  for (const item of items) {
    const key = (item.field || "").trim().toLowerCase();
    if (!key) continue;

    let existing = merged.get(key);
    if (!existing) {
      existing = {
        field: item.field,
        conflicting_values: new Set<string>(),
        sources: new Set<string>(),
        reasons: new Set<string>(),
      };
      merged.set(key, existing);
    }

    for (const value of item.conflicting_values || []) {
      existing.conflicting_values.add(String(value));
    }
    for (const source of item.sources || []) {
      existing.sources.add(String(source));
    }
    if (item.reason) {
      existing.reasons.add(item.reason);
    }
  }

  return Array.from(merged.values()).map((item) => {
    const reasons = Array.from(item.reasons);
    return {
      field: item.field,
      conflicting_values: Array.from(item.conflicting_values),
      sources: Array.from(item.sources),
      reason: reasons.length > 0 ? reasons.join(" | ") : "Conflicting values found",
    };
  });
}

function buildNeedsReview(hypergraphResult: HypergraphResult): NeedsReviewItem[] {
  const needsReview: NeedsReviewItem[] = [];

  // Add explicit conflicts
  for (const conflict of hypergraphResult.conflicts) {
    // UNCERTAIN fields are handled from hypergraph values below with a cleaner value set.
    if (conflict.consensus_value === "UNCERTAIN") continue;

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

  return mergeNeedsReviewItems(needsReview);
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
  const claim1p = mostLikelyFieldValue(hypergraph["claim_number_1p"]);
  if (claim1p) {
    claims["1P"] = claim1p;
  }

  const claim3p = mostLikelyFieldValue(hypergraph["claim_number_3p"]);
  if (claim3p) {
    claims["3P"] = claim3p;
  }

  // Fallback to legacy field if no new fields
  if (Object.keys(claims).length === 0) {
    const legacyField = hypergraph["insurance_claim_numbers"];
    if (legacyField?.values?.length) {
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
  const hiValue = mostLikelyFieldValue(hiField);
  if (hiValue) {
    try {
      const parsed = JSON.parse(hiValue);
      if (typeof parsed === "object" && parsed !== null) {
        const result: { carrier?: string; group_no?: string; member_no?: string } = {};
        if (typeof parsed.carrier === "string") result.carrier = parsed.carrier;
        if (typeof parsed.group_no === "string") result.group_no = parsed.group_no;
        if (typeof parsed.member_no === "string") result.member_no = parsed.member_no;
        if (Object.keys(result).length > 0) return result;
      }
    } catch {
      // Not JSON - treat as carrier name only
      return { carrier: hiValue };
    }
  }

  // Fallback to legacy individual fields
  const getLikely = (field: string): string | undefined => {
    return mostLikelyFieldValue(hypergraph[field]);
  };

  const carrier = getLikely("health_insurance_carrier");
  const group_no = getLikely("health_insurance_group");
  const member_no = getLikely("health_insurance_member");

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
  const isWC = existingIndex.practice_area === PRACTICE_AREAS.WC;

  // Get consensus values with fallback
  const getConsensus = (field: string, fallback: string = ""): string => {
    const f = hg[field];
    if (!f || f.consensus === "UNCERTAIN") return fallback;
    return f.consensus;
  };

  // Get best available value even when UNCERTAIN (use highest-count value).
  // For critical fields like DOI where showing approximate data beats showing nothing.
  const getBestValue = (field: string): string => {
    const f = hg[field];
    if (!f || !f.values || f.values.length === 0) return "";
    if (f.consensus && f.consensus !== "UNCERTAIN") return f.consensus;
    // Pick the value with the highest document count
    const sorted = [...f.values].sort((a, b) => b.count - a.count);
    return sorted[0]?.value || "";
  };

  // Prefer hard consensus; if uncertain, use the highest-support value so dashboard
  // can still display the most likely data while conflicts remain in needs_review.
  const getPreferredValue = (...fields: string[]): string => {
    for (const field of fields) {
      const v = getConsensus(field);
      if (v) return v;
    }
    for (const field of fields) {
      const v = getBestValue(field);
      if (v) return v;
    }
    return "";
  };

  // Parse amount from string (handles "$1,234.56" format)
  const parseAmount = (val: string): number | undefined => {
    if (!val) return undefined;
    const cleaned = val.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  };

  // Get incident date - WC uses doi (date_of_injury), PI uses dol (date_of_loss)
  // Use getBestValue for dates since showing approximate data is better than "Unknown"
  const incidentDate = isWC
    ? getPreferredValue("date_of_injury", "doi")
    : getPreferredValue("date_of_loss", "dol");

  // Build summary object with common fields
  const summary: CaseSummary = {
    client: getPreferredValue("client_name", "claimant_name") || "Unknown",
    dol: incidentDate || "Unknown",
    incident_date: incidentDate || undefined,
    dob: getPreferredValue("date_of_birth", "dob") || undefined,
    providers: extractProviders(hg),
    total_charges: calculateTotalCharges(hg),
    contact: {
      phone: getPreferredValue("client_phone", "phone") || undefined,
      email: getPreferredValue("client_email", "email") || undefined,
      address: parseAddress(getPreferredValue("client_address", "address"))
    },
    claim_numbers: buildClaimNumbers(hg),
    case_summary: caseSummaryResult.case_summary
  };

  // Add PI-specific fields
  if (!isWC) {
    summary.policy_limits = buildPolicyLimits(hg);
    summary.health_insurance = buildHealthInsurance(hg);
  }

  // Add WC-specific fields
  if (isWC) {
    // Employer info
    const employerName = getPreferredValue("employer_name", "employer");
    const employerAddress = getPreferredValue("employer_address");
    const employerPhone = getPreferredValue("employer_phone");
    if (employerName || employerAddress || employerPhone) {
      summary.employer = {
        name: employerName || undefined,
        address: employerAddress || undefined,
        phone: employerPhone || undefined,
      };
    }

    // WC carrier info
    const wcCarrier = getPreferredValue("wc_carrier", "wc_insurance_carrier");
    const wcClaimNumber = getPreferredValue("wc_claim_number", "claim_number");
    const adjusterName = getPreferredValue("adjuster_name");
    const adjusterPhone = getPreferredValue("adjuster_phone");
    const tpa = getPreferredValue("tpa_name", "third_party_administrator");
    if (wcCarrier || wcClaimNumber || adjusterName || tpa) {
      summary.wc_carrier = {
        carrier: wcCarrier || undefined,
        claim_number: wcClaimNumber || undefined,
        adjuster: adjusterName || undefined,
        adjuster_phone: adjusterPhone || undefined,
        tpa: tpa || undefined,
      };
    }

    // Disability status
    const disabilityType = getPreferredValue("disability_type");
    const amwStr = getPreferredValue("amw", "average_monthly_wage", "aww");
    const compRateStr = getPreferredValue("compensation_rate", "weekly_compensation_rate");
    const mmiDate = getPreferredValue("mmi_date");
    const ppdRatingStr = getPreferredValue("ppd_rating");
    const amw = parseAmount(amwStr);
    const compRate = parseAmount(compRateStr);
    const ppdRating = parseAmount(ppdRatingStr);
    if (disabilityType || amw || compRate || mmiDate || ppdRating) {
      summary.disability_status = {
        type: disabilityType || undefined,
        amw: amw,
        compensation_rate: compRate,
        mmi_date: mmiDate || undefined,
        ppd_rating: ppdRating,
      };
    }

    // Job info
    const jobTitle = getPreferredValue("job_title");
    if (jobTitle) {
      summary.job_title = jobTitle;
    }

    // Injury details
    const injuryDescription = getPreferredValue("injury_description");
    if (injuryDescription) {
      summary.injury_description = injuryDescription;
    }

    // Body parts (parse from consensus or extract from hypergraph)
    const bodyPartsConsensus = getPreferredValue("body_parts", "body_parts_injured");
    if (bodyPartsConsensus) {
      // Parse comma-separated or array-like string
      const parts = bodyPartsConsensus.split(/[,;]/).map(p => p.trim()).filter(p => p);
      if (parts.length > 0) {
        summary.body_parts = parts;
      }
    }
  }

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
  // Clean up empty WC objects
  if (summary.employer && !summary.employer.name && !summary.employer.address && !summary.employer.phone) {
    delete summary.employer;
  }
  if (summary.wc_carrier && !summary.wc_carrier.carrier && !summary.wc_carrier.claim_number && !summary.wc_carrier.adjuster && !summary.wc_carrier.tpa) {
    delete summary.wc_carrier;
  }
  if (summary.disability_status && !summary.disability_status.type && !summary.disability_status.amw && !summary.disability_status.compensation_rate) {
    delete summary.disability_status;
  }

  // Build needs_review and errata from fresh hypergraph analysis
  const freshNeedsReview = buildNeedsReview(hypergraphResult);
  const freshErrata = buildErrata(hypergraphResult);

  // Reconcile with existing user resolutions — user decisions survive reindexing
  const existingErrata: ErrataItem[] = existingIndex.errata || [];
  const userResolutions = existingErrata.filter(
    (e: ErrataItem) => e.resolution_type === "user_decision" || e.resolution_type === "batch_review"
  );

  const reconciledValues = (typeof existingIndex.reconciled_values === "object" && existingIndex.reconciled_values !== null)
    ? existingIndex.reconciled_values as Record<string, any>
    : {};
  const reconciledOverrides = new Map<string, string>();
  for (const [field, raw] of Object.entries(reconciledValues)) {
    if (!field) continue;
    if (raw && typeof raw === "object" && "value" in raw && (raw as any).value !== undefined) {
      reconciledOverrides.set(field, String((raw as any).value));
      continue;
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      reconciledOverrides.set(field, String(raw));
    }
  }

  // Build set of fields that users have already resolved
  const resolvedFields = new Set([
    ...userResolutions.map((r: ErrataItem) => r.field),
    ...Array.from(reconciledOverrides.keys()),
  ]);

  // Filter out needs_review items for fields that have user resolutions
  const reconciledNeedsReview = freshNeedsReview.filter(
    (item) => !resolvedFields.has(item.field)
  );

  // Merge errata: user resolutions first, then fresh auto-errata for non-resolved fields
  const reconciledErrata: ErrataItem[] = [
    ...userResolutions,
    ...freshErrata.filter((e) => !resolvedFields.has(e.field)),
  ];

  // Apply user resolution overrides to summary values
  const fieldToSummaryKey: Record<string, string> = {
    date_of_loss: "dol",
    dol: "dol",
    date_of_injury: "dol",
    doi: "dol",
    client_name: "client",
    claimant_name: "client",
    date_of_birth: "dob",
    dob: "dob",
    incident_date: "incident_date",
  };

  const summaryOverrides = new Map<string, string>();
  for (const resolution of userResolutions) {
    if (resolution.field && resolution.decision) {
      summaryOverrides.set(resolution.field, resolution.decision);
    }
  }
  for (const [field, decision] of reconciledOverrides) {
    summaryOverrides.set(field, decision);
  }

  for (const [field, decision] of summaryOverrides) {
    const summaryKey = fieldToSummaryKey[field];
    if (!summaryKey || !decision) continue;
    (summary as Record<string, any>)[summaryKey] = decision;
    // Also set incident_date when dol is overridden
    if (summaryKey === "dol") {
      summary.incident_date = decision;
    }
  }

  // Aggregate open_hearings from per-file extracted_data (WC only)
  let openHearings: Array<{ case_number: string; hearing_level: "H.O." | "A.O."; next_date?: string; issue?: string }> | undefined;
  if (isWC && existingIndex.folders) {
    const hearingMap = new Map<string, { hearing_level: "H.O." | "A.O."; next_date?: string; issue?: string }>();
    for (const folder of Object.values(existingIndex.folders as Record<string, { files: any[] }>)) {
      for (const file of folder.files || []) {
        const ed = file.extracted_data;
        if (!ed?.hearing_case_number) continue;
        // Handle semicolon-separated case numbers (e.g., "2680493-RA; 2680501-RA")
        const caseNumbers = (ed.hearing_case_number as string).split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
        for (const rawCn of caseNumbers) {
          // Normalize: strip HO-/AO- prefixes for dedup
          const cn = rawCn.replace(/^(HO|AO)-/i, "");
          const level: "H.O." | "A.O." = ed.hearing_level === "A.O." ? "A.O." : "H.O.";
          const existing = hearingMap.get(cn);
          if (!existing) {
            hearingMap.set(cn, { hearing_level: level, next_date: ed.next_hearing_date, issue: ed.hearing_issue });
          } else if (level === "A.O.") {
            // Escalate to A.O. if any document marks it as appeal-level
            existing.hearing_level = "A.O.";
          }
        }
      }
    }
    if (hearingMap.size > 0) {
      openHearings = Array.from(hearingMap.entries()).map(([cn, info]) => ({
        case_number: cn,
        hearing_level: info.hearing_level,
        ...(info.next_date ? { next_date: info.next_date } : {}),
        ...(info.issue ? { issue: info.issue } : {}),
      }));
    }
  }

  // Merge into final index
  const result: Record<string, any> = {
    ...existingIndex,
    indexed_at: new Date().toISOString(),
    case_name: formatCaseName(summary.client),
    case_phase: caseSummaryResult.case_phase,
    summary,
    needs_review: reconciledNeedsReview,
    errata: reconciledErrata,
    // Preserve these from existing if present
    reconciled_values: existingIndex.reconciled_values || {},
    case_notes: existingIndex.case_notes || [],
    chat_archives: existingIndex.chat_archives || []
  };

  if (openHearings && openHearings.length > 0) {
    result.open_hearings = openHearings;
  }

  return result;
}

/**
 * Diff result from comparing old vs new index after reindexing.
 */
export interface IndexDiff {
  newFilesIndexed: string[];
  newProviders: string[];
  chargesChange: { old: number; new: number } | null;
  newConflicts: number;
  resolvedConflictsPreserved: number;
  summary: string;
}

/**
 * Compare old vs new index and produce a human-readable diff.
 */
export function diffIndexes(
  oldIndex: Record<string, any> | null,
  newIndex: Record<string, any>
): IndexDiff {
  // Find new files indexed
  const oldFiles = new Set<string>();
  if (oldIndex?.folders) {
    for (const [folder, data] of Object.entries(oldIndex.folders)) {
      const files = extractFileNames(data);
      for (const f of files) {
        oldFiles.add(`${folder}/${f}`);
      }
    }
  }

  const newFilesIndexed: string[] = [];
  if (newIndex?.folders) {
    for (const [folder, data] of Object.entries(newIndex.folders)) {
      const files = extractFileNames(data);
      for (const f of files) {
        if (!oldFiles.has(`${folder}/${f}`)) {
          newFilesIndexed.push(f);
        }
      }
    }
  }

  // Find new providers
  const oldProviders = new Set(oldIndex?.summary?.providers || []);
  const newProviders = (newIndex?.summary?.providers || []).filter(
    (p: string) => !oldProviders.has(p)
  );

  // Charges change
  const oldCharges = parseChargesNumber(oldIndex?.summary?.total_charges);
  const newCharges = parseChargesNumber(newIndex?.summary?.total_charges);
  const chargesChange = oldCharges !== newCharges
    ? { old: oldCharges, new: newCharges }
    : null;

  // Count new conflicts (needs_review items)
  const newConflicts = (newIndex?.needs_review || []).length;

  // Count preserved user resolutions
  const resolvedConflictsPreserved = (newIndex?.errata || []).filter(
    (e: ErrataItem) => e.resolution_type === "user_decision" || e.resolution_type === "batch_review"
  ).length;

  // Build summary string
  const parts: string[] = [];
  if (newFilesIndexed.length > 0) {
    parts.push(`${newFilesIndexed.length} new file${newFilesIndexed.length > 1 ? "s" : ""} indexed`);
  }
  if (newProviders.length > 0) {
    parts.push(`${newProviders.length} new provider${newProviders.length > 1 ? "s" : ""}: ${newProviders.join(", ")}`);
  }
  if (chargesChange) {
    parts.push(`charges updated: $${chargesChange.old.toLocaleString()} → $${chargesChange.new.toLocaleString()}`);
  }
  if (newConflicts > 0) {
    parts.push(`${newConflicts} conflict${newConflicts > 1 ? "s" : ""} to review`);
  }
  if (resolvedConflictsPreserved > 0) {
    parts.push(`${resolvedConflictsPreserved} user resolution${resolvedConflictsPreserved > 1 ? "s" : ""} preserved`);
  }

  const summary = parts.length > 0
    ? parts.join("; ")
    : "Index updated (no significant changes)";

  return {
    newFilesIndexed,
    newProviders,
    chargesChange,
    newConflicts,
    resolvedConflictsPreserved,
    summary,
  };
}

/** Extract filenames from a folder data structure (handles all formats). */
function extractFileNames(data: any): string[] {
  const files: any[] = Array.isArray(data)
    ? data
    : data?.files || data?.documents || [];
  return files.map((f: any) =>
    typeof f === "string" ? f : f?.filename || f?.file || ""
  ).filter(Boolean);
}

/** Parse charges from various formats to a number. */
function parseChargesNumber(val: any): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[$,]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}
