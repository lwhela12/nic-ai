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

// Final summary structure
export interface CaseSummary {
  client: string;
  dol: string;
  dob?: string;
  providers: string[];
  total_charges: number;
  policy_limits?: Record<string, string>;
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
 * Charge fields are named like "charges:Provider Name"
 */
function extractProviders(hypergraph: Record<string, HypergraphField>): string[] {
  const providers: string[] = [];

  for (const fieldName of Object.keys(hypergraph)) {
    if (fieldName.startsWith("charges:")) {
      const providerName = fieldName.replace("charges:", "").trim();
      if (providerName && !providers.includes(providerName)) {
        providers.push(providerName);
      }
    }
  }

  return providers;
}

/**
 * Calculate total charges from hypergraph charge fields.
 */
function calculateTotalCharges(hypergraph: Record<string, HypergraphField>): number {
  let total = 0;

  for (const [fieldName, field] of Object.entries(hypergraph)) {
    if (fieldName.startsWith("charges:") && field.consensus && field.consensus !== "UNCERTAIN") {
      const amount = parseFloat(field.consensus.replace(/[$,]/g, ""));
      if (!isNaN(amount)) {
        total += amount;
      }
    }
  }

  // Also check for total_medical field
  const totalMedical = hypergraph["total_medical"];
  if (totalMedical?.consensus && totalMedical.consensus !== "UNCERTAIN") {
    const amount = parseFloat(totalMedical.consensus.replace(/[$,]/g, ""));
    if (!isNaN(amount) && amount > total) {
      total = amount; // Use the higher value
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
 * Attempts to identify 1P vs 3P claims.
 */
function buildClaimNumbers(hypergraph: Record<string, HypergraphField>): Record<string, string> {
  const claims: Record<string, string> = {};

  const claimField = hypergraph["insurance_claim_numbers"];
  if (!claimField || claimField.consensus === "UNCERTAIN") {
    return claims;
  }

  // Try to categorize claims by source document names
  for (const valueEntry of claimField.values) {
    const value = valueEntry.value;
    const sources = valueEntry.sources.join(" ").toLowerCase();

    if (sources.includes("1p") || sources.includes("travelers") || sources.includes("medpay")) {
      claims["1P"] = value;
    } else if (sources.includes("3p") || sources.includes("geico")) {
      claims["3P"] = value;
    } else {
      // Unknown party - just store with generic key
      claims[`claim_${Object.keys(claims).length + 1}`] = value;
    }
  }

  return claims;
}

/**
 * Build policy_limits object from hypergraph.
 */
function buildPolicyLimits(hypergraph: Record<string, HypergraphField>): Record<string, string> {
  const limits: Record<string, string> = {};

  const limitsField = hypergraph["policy_limits"];
  if (!limitsField || limitsField.consensus === "UNCERTAIN") {
    return limits;
  }

  // For now, assume all policy limits are 3P BI unless source indicates otherwise
  for (const valueEntry of limitsField.values) {
    const sources = valueEntry.sources.join(" ").toLowerCase();

    if (sources.includes("1p")) {
      limits["1P"] = valueEntry.value;
    } else {
      limits["3P"] = valueEntry.value;
    }
  }

  // If we only found one value and couldn't categorize, default to 3P
  if (Object.keys(limits).length === 0 && limitsField.consensus) {
    limits["3P"] = limitsField.consensus;
  }

  return limits;
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
    dol: getConsensus("date_of_loss", "Unknown"),
    dob: getConsensus("date_of_birth") || undefined,
    providers: extractProviders(hg),
    total_charges: calculateTotalCharges(hg),
    policy_limits: buildPolicyLimits(hg),
    contact: {
      phone: getConsensus("client_phone") || undefined,
      email: getConsensus("client_email") || undefined,
      address: parseAddress(getConsensus("client_address"))
    },
    health_insurance: {
      carrier: getConsensus("health_insurance_carrier") || undefined,
      group_no: getConsensus("health_insurance_group") || undefined,
      member_no: getConsensus("health_insurance_member") || undefined
    },
    claim_numbers: buildClaimNumbers(hg),
    case_summary: caseSummaryResult.case_summary
  };

  // Clean up empty nested objects
  if (!summary.contact?.phone && !summary.contact?.email && !summary.contact?.address?.street) {
    delete summary.contact;
  }
  if (!summary.health_insurance?.carrier && !summary.health_insurance?.group_no && !summary.health_insurance?.member_no) {
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
