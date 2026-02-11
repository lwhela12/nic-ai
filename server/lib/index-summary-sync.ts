/**
 * Keep dashboard-facing summary fields synchronized after manual corrections.
 */

function formatCaseName(clientName: string): string {
  if (!clientName) return "Unknown";
  const parts = clientName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  if (parts.length === 1) return parts[0].toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const first = parts.slice(0, -1).join(" ");
  return `${last}, ${first}`;
}

function parseAddress(addressStr: string): { street?: string; city?: string; state?: string; zip?: string } {
  if (!addressStr) return {};
  const match = addressStr.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (match) {
    return {
      street: match[1].trim(),
      city: match[2].trim(),
      state: match[3],
      zip: match[4] || undefined,
    };
  }
  return { street: addressStr };
}

function toNumber(value: unknown): number | undefined {
  const num = parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return isNaN(num) ? undefined : num;
}

function ensureObject(target: any, key: string): any {
  if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
    target[key] = {};
  }
  return target[key];
}

/**
 * Apply a resolved field/value to summary fields that power dashboard views.
 * Returns true if anything was updated.
 */
export function applyResolvedFieldToSummary(index: any, field: string, resolvedValue: unknown): boolean {
  if (!index || !field || !index.summary || typeof index.summary !== "object") return false;

  const rawField = String(field).trim();
  const f = rawField.toLowerCase();
  const value = typeof resolvedValue === "string" ? resolvedValue.trim() : resolvedValue;
  let updated = false;

  if (f === "date_of_loss" || f === "date_of_injury" || f === "dol" || f === "doi" || f === "incident_date") {
    index.summary.dol = value;
    index.summary.incident_date = value;
    return true;
  }

  if (f === "client_name" || f === "claimant_name" || f === "client") {
    const client = String(value || "");
    index.summary.client = client;
    index.case_name = formatCaseName(client);
    return true;
  }

  if (f === "date_of_birth" || f === "dob") {
    index.summary.dob = value;
    return true;
  }

  if (f === "client_phone" || f === "phone") {
    const contact = ensureObject(index.summary, "contact");
    contact.phone = value;
    return true;
  }

  if (f === "client_email" || f === "email") {
    const contact = ensureObject(index.summary, "contact");
    contact.email = value;
    return true;
  }

  if (f === "client_address" || f === "address") {
    const contact = ensureObject(index.summary, "contact");
    contact.address = typeof value === "string" ? parseAddress(value) : value;
    return true;
  }

  if (f === "claim_number_1p") {
    const claimNumbers = ensureObject(index.summary, "claim_numbers");
    claimNumbers["1P"] = value;
    return true;
  }

  if (f === "claim_number_3p") {
    const claimNumbers = ensureObject(index.summary, "claim_numbers");
    claimNumbers["3P"] = value;
    return true;
  }

  if (/^claim_numbers:/i.test(rawField)) {
    const key = rawField.replace(/^claim_numbers:/i, "").trim();
    const claimNumbers = ensureObject(index.summary, "claim_numbers");
    claimNumbers[key] = value;
    return true;
  }

  // PI adjuster fields (stored inside policy_limits)
  if (f === "adjuster_name_1p" || f === "adjuster_phone_1p" || f === "adjuster_email_1p") {
    const policyLimits = ensureObject(index.summary, "policy_limits");
    const party = ensureObject(policyLimits, "1P");
    if (!party.carrier) party.carrier = "Unknown";
    const adjField = f.replace("_1p", ""); // adjuster_name, adjuster_phone, adjuster_email
    party[adjField] = value;
    return true;
  }
  if (f === "adjuster_name_3p" || f === "adjuster_phone_3p" || f === "adjuster_email_3p") {
    const policyLimits = ensureObject(index.summary, "policy_limits");
    const party = ensureObject(policyLimits, "3P");
    if (!party.carrier) party.carrier = "Unknown";
    const adjField = f.replace("_3p", ""); // adjuster_name, adjuster_phone, adjuster_email
    party[adjField] = value;
    return true;
  }

  if (f === "policy_limits_1p" || f === "policy_limits_3p") {
    const party = f.endsWith("_1p") ? "1P" : "3P";
    const policyLimits = ensureObject(index.summary, "policy_limits");
    if (!policyLimits[party] || typeof policyLimits[party] !== "object") {
      policyLimits[party] = { carrier: "Unknown" };
    }
    if (typeof value === "string") {
      policyLimits[party].bodily_injury = value;
    } else if (value && typeof value === "object") {
      policyLimits[party] = { ...policyLimits[party], ...(value as Record<string, unknown>) };
    }
    return true;
  }

  if (/^policy_limits:/i.test(rawField)) {
    const parts = rawField.replace(/^policy_limits:/i, "").split(":").filter(Boolean);
    if (parts.length > 0) {
      const policyLimits = ensureObject(index.summary, "policy_limits");
      const party = parts[0];
      if (!policyLimits[party] || typeof policyLimits[party] !== "object") {
        policyLimits[party] = {};
      }
      if (parts.length === 1) {
        policyLimits[party] = value;
      } else {
        policyLimits[party][parts[1]] = value;
      }
      return true;
    }
  }

  if (f === "health_insurance") {
    if (typeof value === "string") {
      try {
        index.summary.health_insurance = JSON.parse(value);
      } catch {
        index.summary.health_insurance = { carrier: value };
      }
    } else {
      index.summary.health_insurance = value;
    }
    return true;
  }

  if (f === "health_insurance_carrier") {
    const hi = ensureObject(index.summary, "health_insurance");
    hi.carrier = value;
    return true;
  }
  if (f === "health_insurance_group") {
    const hi = ensureObject(index.summary, "health_insurance");
    hi.group_no = value;
    return true;
  }
  if (f === "health_insurance_member") {
    const hi = ensureObject(index.summary, "health_insurance");
    hi.member_no = value;
    return true;
  }

  if (f === "employer_name" || f === "employer") {
    const employer = ensureObject(index.summary, "employer");
    employer.name = value;
    return true;
  }
  if (f === "employer_address") {
    const employer = ensureObject(index.summary, "employer");
    employer.address = value;
    return true;
  }
  if (f === "employer_phone") {
    const employer = ensureObject(index.summary, "employer");
    employer.phone = value;
    return true;
  }

  if (f === "wc_carrier" || f === "wc_insurance_carrier") {
    const wc = ensureObject(index.summary, "wc_carrier");
    wc.carrier = value;
    return true;
  }
  if (f === "wc_claim_number" || f === "claim_number") {
    const wc = ensureObject(index.summary, "wc_carrier");
    wc.claim_number = value;
    return true;
  }
  if (f === "adjuster_name") {
    const wc = ensureObject(index.summary, "wc_carrier");
    wc.adjuster = value;
    return true;
  }
  if (f === "adjuster_phone") {
    const wc = ensureObject(index.summary, "wc_carrier");
    wc.adjuster_phone = value;
    return true;
  }
  if (f === "tpa_name" || f === "third_party_administrator") {
    const wc = ensureObject(index.summary, "wc_carrier");
    wc.tpa = value;
    return true;
  }

  if (f === "amw" || f === "aww" || f === "average_monthly_wage") {
    const disability = ensureObject(index.summary, "disability_status");
    disability.amw = toNumber(value);
    return true;
  }
  if (f === "compensation_rate" || f === "weekly_compensation_rate") {
    const disability = ensureObject(index.summary, "disability_status");
    disability.compensation_rate = toNumber(value);
    return true;
  }
  if (f === "disability_type") {
    const disability = ensureObject(index.summary, "disability_status");
    disability.type = value;
    return true;
  }
  if (f === "mmi_date") {
    const disability = ensureObject(index.summary, "disability_status");
    disability.mmi_date = value;
    return true;
  }
  if (f === "ppd_rating") {
    const disability = ensureObject(index.summary, "disability_status");
    disability.ppd_rating = toNumber(value);
    return true;
  }

  if (f === "job_title") {
    index.summary.job_title = value;
    return true;
  }
  if (f === "injury_description") {
    index.summary.injury_description = value;
    return true;
  }
  if (f === "body_parts" || f === "body_parts_injured") {
    if (Array.isArray(value)) {
      index.summary.body_parts = value.map((v) => String(v)).filter(Boolean);
    } else if (typeof value === "string") {
      index.summary.body_parts = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
    }
    return true;
  }

  if (f.startsWith("charges:") || f.startsWith("provider_charges:")) {
    // Specialized charge recalculation is handled at call sites.
    updated = false;
  }

  return updated;
}
