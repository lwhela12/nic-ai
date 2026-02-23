"use strict";
/**
 * Programmatic Index Merge
 *
 * Merges hypergraph output + Haiku case summary into final document index.
 * No LLM calls - pure data transformation.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.mergeToIndex = mergeToIndex;
exports.diffIndexes = diffIndexes;
var index_schema_1 = require("./index-schema");
/**
 * Parse an address string into components.
 * Handles formats like "123 Main St, Las Vegas, NV 89101"
 */
function parseAddress(addressStr) {
    if (!addressStr)
        return {};
    // Try to parse "Street, City, State ZIP" format
    var match = addressStr.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
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
function confidenceLevel(confidence) {
    if (confidence >= 0.8)
        return "high";
    if (confidence >= 0.5)
        return "medium";
    return "low";
}
/**
 * Return the best available value for a hypergraph field.
 * Prefers explicit consensus, otherwise highest-support value.
 */
function mostLikelyFieldValue(field) {
    var _a;
    if (!field || !Array.isArray(field.values) || field.values.length === 0)
        return undefined;
    if (field.consensus && field.consensus !== "UNCERTAIN")
        return field.consensus;
    var sorted = __spreadArray([], field.values, true).sort(function (a, b) { return b.count - a.count; });
    return (_a = sorted[0]) === null || _a === void 0 ? void 0 : _a.value;
}
/**
 * Extract provider names from hypergraph charge fields.
 * Charge fields are named like "charges:Provider Name" or "provider_charges:Provider Name"
 */
function extractProviders(hypergraph) {
    var providers = [];
    for (var _i = 0, _a = Object.keys(hypergraph); _i < _a.length; _i++) {
        var fieldName = _a[_i];
        var providerName = null;
        if (fieldName.startsWith("charges:")) {
            providerName = fieldName.replace("charges:", "").trim();
        }
        else if (fieldName.startsWith("provider_charges:")) {
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
function calculateTotalCharges(hypergraph) {
    var _a, _b, _c, _d;
    var total = 0;
    for (var _i = 0, _e = Object.entries(hypergraph); _i < _e.length; _i++) {
        var _f = _e[_i], fieldName = _f[0], field = _f[1];
        // Support both "charges:" and "provider_charges:" prefixes for consistency
        if ((fieldName.startsWith("charges:") || fieldName.startsWith("provider_charges:")) && ((_a = field.values) === null || _a === void 0 ? void 0 : _a.length) > 0) {
            // Use consensus if available, otherwise use the first value
            var valueToUse = field.consensus && field.consensus !== "UNCERTAIN"
                ? field.consensus
                : (_b = field.values[0]) === null || _b === void 0 ? void 0 : _b.value;
            if (valueToUse) {
                var amount = parseFloat(valueToUse.replace(/[$,]/g, ""));
                if (!isNaN(amount)) {
                    total += amount;
                }
            }
        }
    }
    // Also check for total_medical field
    var totalMedical = hypergraph["total_medical"];
    if (((_c = totalMedical === null || totalMedical === void 0 ? void 0 : totalMedical.values) === null || _c === void 0 ? void 0 : _c.length) > 0) {
        var valueToUse = totalMedical.consensus && totalMedical.consensus !== "UNCERTAIN"
            ? totalMedical.consensus
            : (_d = totalMedical.values[0]) === null || _d === void 0 ? void 0 : _d.value;
        if (valueToUse) {
            var amount = parseFloat(valueToUse.replace(/[$,]/g, ""));
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
function mergeNeedsReviewItems(items) {
    var merged = new Map();
    for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
        var item = items_1[_i];
        var key = (item.field || "").trim().toLowerCase();
        if (!key)
            continue;
        var existing = merged.get(key);
        if (!existing) {
            existing = {
                field: item.field,
                conflicting_values: new Set(),
                sources: new Set(),
                reasons: new Set(),
            };
            merged.set(key, existing);
        }
        for (var _a = 0, _b = item.conflicting_values || []; _a < _b.length; _a++) {
            var value = _b[_a];
            existing.conflicting_values.add(String(value));
        }
        for (var _c = 0, _d = item.sources || []; _c < _d.length; _c++) {
            var source = _d[_c];
            existing.sources.add(String(source));
        }
        if (item.reason) {
            existing.reasons.add(item.reason);
        }
    }
    return Array.from(merged.values()).map(function (item) {
        var reasons = Array.from(item.reasons);
        return {
            field: item.field,
            conflicting_values: Array.from(item.conflicting_values),
            sources: Array.from(item.sources),
            reason: reasons.length > 0 ? reasons.join(" | ") : "Conflicting values found",
        };
    });
}
function buildNeedsReview(hypergraphResult) {
    var needsReview = [];
    // Add explicit conflicts
    for (var _i = 0, _a = hypergraphResult.conflicts; _i < _a.length; _i++) {
        var conflict = _a[_i];
        // UNCERTAIN fields are handled from hypergraph values below with a cleaner value set.
        if (conflict.consensus_value === "UNCERTAIN")
            continue;
        needsReview.push({
            field: conflict.field,
            conflicting_values: [conflict.consensus_value, conflict.outlier_value],
            sources: __spreadArray(__spreadArray([], conflict.consensus_sources, true), conflict.outlier_sources, true),
            reason: conflict.likely_reason || "Conflicting values found: \"".concat(conflict.consensus_value, "\" vs \"").concat(conflict.outlier_value, "\"")
        });
    }
    // Add UNCERTAIN fields
    for (var _b = 0, _c = Object.entries(hypergraphResult.hypergraph); _b < _c.length; _b++) {
        var _d = _c[_b], fieldName = _d[0], field = _d[1];
        if (field.consensus === "UNCERTAIN") {
            var values = field.values.map(function (v) { return v.value; });
            var sources = field.values.flatMap(function (v) { return v.sources; });
            needsReview.push({
                field: fieldName,
                conflicting_values: values,
                sources: __spreadArray([], new Set(sources), true),
                reason: "No clear consensus - values have equal support"
            });
        }
    }
    return mergeNeedsReviewItems(needsReview);
}
/**
 * Generate errata entries documenting decisions made.
 */
function buildErrata(hypergraphResult) {
    var errata = [];
    var _loop_1 = function (fieldName, field) {
        // Skip UNCERTAIN fields (they go to needs_review)
        if (field.consensus === "UNCERTAIN")
            return "continue";
        // Skip fields with no conflicts (high confidence, obvious)
        if (!field.has_conflict && field.confidence >= 0.9)
            return "continue";
        // Document the decision
        var valueCount = field.values.length;
        var consensusValue = field.values.find(function (v) { return v.value === field.consensus; });
        var sourceCount = (consensusValue === null || consensusValue === void 0 ? void 0 : consensusValue.count) || 0;
        var evidence = "".concat(sourceCount, " of ").concat(field.values.reduce(function (sum, v) { return sum + v.count; }, 0), " documents support this value");
        if (field.has_conflict) {
            var outliers = field.values.filter(function (v) { return v.value !== field.consensus; });
            evidence += ". Outliers: ".concat(outliers.map(function (o) { return "\"".concat(o.value, "\" (").concat(o.count, " doc").concat(o.count > 1 ? 's' : '', ")"); }).join(", "));
        }
        errata.push({
            field: fieldName,
            decision: field.consensus,
            evidence: evidence,
            confidence: confidenceLevel(field.confidence)
        });
    };
    // Document each field where we have a consensus
    for (var _i = 0, _a = Object.entries(hypergraphResult.hypergraph); _i < _a.length; _i++) {
        var _b = _a[_i], fieldName = _b[0], field = _b[1];
        _loop_1(fieldName, field);
    }
    return errata;
}
/**
 * Build claim_numbers object from hypergraph.
 * Uses new field names: claim_number_1p, claim_number_3p
 * Falls back to legacy insurance_claim_numbers field if new fields not present.
 */
function buildClaimNumbers(hypergraph) {
    var _a;
    var claims = {};
    // Try new structured fields first
    var claim1p = mostLikelyFieldValue(hypergraph["claim_number_1p"]);
    if (claim1p) {
        claims["1P"] = claim1p;
    }
    var claim3p = mostLikelyFieldValue(hypergraph["claim_number_3p"]);
    if (claim3p) {
        claims["3P"] = claim3p;
    }
    // Fallback to legacy field if no new fields
    if (Object.keys(claims).length === 0) {
        var legacyField = hypergraph["insurance_claim_numbers"];
        if ((_a = legacyField === null || legacyField === void 0 ? void 0 : legacyField.values) === null || _a === void 0 ? void 0 : _a.length) {
            for (var _i = 0, _b = legacyField.values; _i < _b.length; _i++) {
                var valueEntry = _b[_i];
                var value = valueEntry.value;
                var sources = valueEntry.sources.join(" ").toLowerCase();
                if (sources.includes("1p") || sources.includes("medpay")) {
                    claims["1P"] = value;
                }
                else if (sources.includes("3p") || sources.includes("geico")) {
                    claims["3P"] = value;
                }
                else {
                    claims["claim_".concat(Object.keys(claims).length + 1)] = value;
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
function parsePolicyLimitObject(value) {
    if (!value || value === "UNCERTAIN")
        return null;
    // Try to parse as JSON object
    try {
        var parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
            var result = {
                carrier: typeof parsed.carrier === "string" ? parsed.carrier : undefined,
                bodily_injury: typeof parsed.bodily_injury === "string" ? parsed.bodily_injury : undefined,
                medical_payments: typeof parsed.medical_payments === "string" ? parsed.medical_payments : undefined,
                um_uim: typeof parsed.um_uim === "string" ? parsed.um_uim : undefined,
                property_damage: typeof parsed.property_damage === "string" ? parsed.property_damage : undefined,
            };
            if (typeof parsed.adjuster_name === "string")
                result.adjuster_name = parsed.adjuster_name;
            if (typeof parsed.adjuster_phone === "string")
                result.adjuster_phone = parsed.adjuster_phone;
            if (typeof parsed.adjuster_email === "string")
                result.adjuster_email = parsed.adjuster_email;
            return result;
        }
    }
    catch (_a) {
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
function buildPolicyLimits(hypergraph) {
    var _a, _b, _c, _d;
    var limits = {};
    // Try new structured fields first
    // Use values even if UNCERTAIN - they'll be flagged for review but still displayed
    var limits1p = hypergraph["policy_limits_1p"];
    if (((_a = limits1p === null || limits1p === void 0 ? void 0 : limits1p.values) === null || _a === void 0 ? void 0 : _a.length) > 0) {
        // Use consensus if available, otherwise use the first (most common) value
        var valueToUse = limits1p.consensus && limits1p.consensus !== "UNCERTAIN"
            ? limits1p.consensus
            : (_b = limits1p.values[0]) === null || _b === void 0 ? void 0 : _b.value;
        if (valueToUse) {
            var parsed = parsePolicyLimitObject(valueToUse);
            if (parsed) {
                limits["1P"] = __assign({ carrier: parsed.carrier || "Unknown" }, parsed);
            }
        }
    }
    var limits3p = hypergraph["policy_limits_3p"];
    if (((_c = limits3p === null || limits3p === void 0 ? void 0 : limits3p.values) === null || _c === void 0 ? void 0 : _c.length) > 0) {
        var valueToUse = limits3p.consensus && limits3p.consensus !== "UNCERTAIN"
            ? limits3p.consensus
            : (_d = limits3p.values[0]) === null || _d === void 0 ? void 0 : _d.value;
        if (valueToUse) {
            var parsed = parsePolicyLimitObject(valueToUse);
            if (parsed) {
                limits["3P"] = __assign({ carrier: parsed.carrier || "Unknown" }, parsed);
            }
        }
    }
    // Merge adjuster info from hypergraph into policy limits
    if (limits["1P"]) {
        var adj1pName = mostLikelyFieldValue(hypergraph["adjuster_name_1p"]);
        var adj1pPhone = mostLikelyFieldValue(hypergraph["adjuster_phone_1p"]);
        var adj1pEmail = mostLikelyFieldValue(hypergraph["adjuster_email_1p"]);
        if (adj1pName)
            limits["1P"].adjuster_name = adj1pName;
        if (adj1pPhone)
            limits["1P"].adjuster_phone = adj1pPhone;
        if (adj1pEmail)
            limits["1P"].adjuster_email = adj1pEmail;
    }
    if (limits["3P"]) {
        var adj3pName = mostLikelyFieldValue(hypergraph["adjuster_name_3p"]);
        var adj3pPhone = mostLikelyFieldValue(hypergraph["adjuster_phone_3p"]);
        var adj3pEmail = mostLikelyFieldValue(hypergraph["adjuster_email_3p"]);
        if (adj3pName)
            limits["3P"].adjuster_name = adj3pName;
        if (adj3pPhone)
            limits["3P"].adjuster_phone = adj3pPhone;
        if (adj3pEmail)
            limits["3P"].adjuster_email = adj3pEmail;
        // Fallback: top-level adjuster fields default to 3P if not already set
        if (!limits["3P"].adjuster_name) {
            var topName = mostLikelyFieldValue(hypergraph["adjuster_name"]);
            if (topName)
                limits["3P"].adjuster_name = topName;
        }
        if (!limits["3P"].adjuster_phone) {
            var topPhone = mostLikelyFieldValue(hypergraph["adjuster_phone"]);
            if (topPhone)
                limits["3P"].adjuster_phone = topPhone;
        }
        if (!limits["3P"].adjuster_email) {
            var topEmail = mostLikelyFieldValue(hypergraph["adjuster_email"]);
            if (topEmail)
                limits["3P"].adjuster_email = topEmail;
        }
    }
    // Fallback to legacy policy_limits field if no new fields
    if (Object.keys(limits).length === 0) {
        var legacyField = hypergraph["policy_limits"];
        if (legacyField && legacyField.values.length > 0) {
            for (var _i = 0, _e = legacyField.values; _i < _e.length; _i++) {
                var valueEntry = _e[_i];
                var sources = valueEntry.sources.join(" ").toLowerCase();
                var parsed = parsePolicyLimitObject(valueEntry.value);
                if (!parsed)
                    continue;
                if (sources.includes("1p") || sources.includes("medpay") || sources.includes("mp")) {
                    limits["1P"] = __assign({ carrier: parsed.carrier || "Unknown" }, parsed);
                }
                else if (sources.includes("3p") || sources.includes("geico") || sources.includes("adverse")) {
                    limits["3P"] = __assign({ carrier: parsed.carrier || "Unknown" }, parsed);
                }
                else if (legacyField.values.length === 1) {
                    limits["3P"] = __assign({ carrier: parsed.carrier || "Unknown" }, parsed);
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
function buildHealthInsurance(hypergraph) {
    // Try new structured field first
    var hiField = hypergraph["health_insurance"];
    var hiValue = mostLikelyFieldValue(hiField);
    if (hiValue) {
        try {
            var parsed = JSON.parse(hiValue);
            if (typeof parsed === "object" && parsed !== null) {
                var result = {};
                if (typeof parsed.carrier === "string")
                    result.carrier = parsed.carrier;
                if (typeof parsed.group_no === "string")
                    result.group_no = parsed.group_no;
                if (typeof parsed.member_no === "string")
                    result.member_no = parsed.member_no;
                if (Object.keys(result).length > 0)
                    return result;
            }
        }
        catch (_a) {
            // Not JSON - treat as carrier name only
            return { carrier: hiValue };
        }
    }
    // Fallback to legacy individual fields
    var getLikely = function (field) {
        return mostLikelyFieldValue(hypergraph[field]);
    };
    var carrier = getLikely("health_insurance_carrier");
    var group_no = getLikely("health_insurance_group");
    var member_no = getLikely("health_insurance_member");
    if (!carrier && !group_no && !member_no)
        return undefined;
    return { carrier: carrier, group_no: group_no, member_no: member_no };
}
/**
 * Format client name as case name (LASTNAME, Firstname).
 */
function formatCaseName(clientName) {
    if (!clientName)
        return "Unknown";
    var parts = clientName.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].toUpperCase();
    }
    var lastName = parts[parts.length - 1].toUpperCase();
    var firstName = parts.slice(0, -1).join(" ");
    return "".concat(lastName, ", ").concat(firstName);
}
/**
 * Main merge function: combines hypergraph + case summary into final index structure.
 */
function mergeToIndex(hypergraphResult, caseSummaryResult, existingIndex) {
    var _a, _b, _c, _d;
    var hg = hypergraphResult.hypergraph;
    var isWC = existingIndex.practice_area === index_schema_1.PRACTICE_AREAS.WC;
    // Get consensus values with fallback
    var getConsensus = function (field, fallback) {
        if (fallback === void 0) { fallback = ""; }
        var f = hg[field];
        if (!f || f.consensus === "UNCERTAIN")
            return fallback;
        return f.consensus;
    };
    // Get best available value even when UNCERTAIN (use highest-count value).
    // For critical fields like DOI where showing approximate data beats showing nothing.
    var getBestValue = function (field) {
        var _a;
        var f = hg[field];
        if (!f || !f.values || f.values.length === 0)
            return "";
        if (f.consensus && f.consensus !== "UNCERTAIN")
            return f.consensus;
        // Pick the value with the highest document count
        var sorted = __spreadArray([], f.values, true).sort(function (a, b) { return b.count - a.count; });
        return ((_a = sorted[0]) === null || _a === void 0 ? void 0 : _a.value) || "";
    };
    // Prefer hard consensus; if uncertain, use the highest-support value so dashboard
    // can still display the most likely data while conflicts remain in needs_review.
    var getPreferredValue = function () {
        var fields = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            fields[_i] = arguments[_i];
        }
        for (var _a = 0, fields_1 = fields; _a < fields_1.length; _a++) {
            var field = fields_1[_a];
            var v = getConsensus(field);
            if (v)
                return v;
        }
        for (var _b = 0, fields_2 = fields; _b < fields_2.length; _b++) {
            var field = fields_2[_b];
            var v = getBestValue(field);
            if (v)
                return v;
        }
        return "";
    };
    // Parse amount from string (handles "$1,234.56" format)
    var parseAmount = function (val) {
        if (!val)
            return undefined;
        var cleaned = val.replace(/[$,]/g, '');
        var num = parseFloat(cleaned);
        return isNaN(num) ? undefined : num;
    };
    // Get incident date - WC uses doi (date_of_injury), PI uses dol (date_of_loss)
    // Use getBestValue for dates since showing approximate data is better than "Unknown"
    var incidentDate = isWC
        ? getPreferredValue("date_of_injury", "doi")
        : getPreferredValue("date_of_loss", "dol");
    // Build summary object with common fields
    var summary = {
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
        var employerName = getPreferredValue("employer_name", "employer");
        var employerAddress = getPreferredValue("employer_address");
        var employerPhone = getPreferredValue("employer_phone");
        if (employerName || employerAddress || employerPhone) {
            summary.employer = {
                name: employerName || undefined,
                address: employerAddress || undefined,
                phone: employerPhone || undefined,
            };
        }
        // WC carrier info
        var wcCarrier = getPreferredValue("wc_carrier", "wc_insurance_carrier");
        var wcClaimNumber = getPreferredValue("wc_claim_number", "claim_number");
        var adjusterName = getPreferredValue("adjuster_name");
        var adjusterPhone = getPreferredValue("adjuster_phone");
        var tpa = getPreferredValue("tpa_name", "third_party_administrator");
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
        var disabilityType = getPreferredValue("disability_type");
        var amwStr = getPreferredValue("amw", "average_monthly_wage", "aww");
        var compRateStr = getPreferredValue("compensation_rate", "weekly_compensation_rate");
        var mmiDate = getPreferredValue("mmi_date");
        var ppdRatingStr = getPreferredValue("ppd_rating");
        var amw = parseAmount(amwStr);
        var compRate = parseAmount(compRateStr);
        var ppdRating = parseAmount(ppdRatingStr);
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
        var jobTitle = getPreferredValue("job_title");
        if (jobTitle) {
            summary.job_title = jobTitle;
        }
        // Injury details
        var injuryDescription = getPreferredValue("injury_description");
        if (injuryDescription) {
            summary.injury_description = injuryDescription;
        }
        // Body parts (parse from consensus or extract from hypergraph)
        var bodyPartsConsensus = getPreferredValue("body_parts", "body_parts_injured");
        if (bodyPartsConsensus) {
            // Parse comma-separated or array-like string
            var parts = bodyPartsConsensus.split(/[,;]/).map(function (p) { return p.trim(); }).filter(function (p) { return p; });
            if (parts.length > 0) {
                summary.body_parts = parts;
            }
        }
    }
    // Clean up empty nested objects
    if (!((_a = summary.contact) === null || _a === void 0 ? void 0 : _a.phone) && !((_b = summary.contact) === null || _b === void 0 ? void 0 : _b.email) && !((_d = (_c = summary.contact) === null || _c === void 0 ? void 0 : _c.address) === null || _d === void 0 ? void 0 : _d.street)) {
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
    var freshNeedsReview = buildNeedsReview(hypergraphResult);
    var freshErrata = buildErrata(hypergraphResult);
    // Reconcile with existing user resolutions — user decisions survive reindexing
    var existingErrata = existingIndex.errata || [];
    var userResolutions = existingErrata.filter(function (e) { return e.resolution_type === "user_decision" || e.resolution_type === "batch_review"; });
    var reconciledValues = (typeof existingIndex.reconciled_values === "object" && existingIndex.reconciled_values !== null)
        ? existingIndex.reconciled_values
        : {};
    var reconciledOverrides = new Map();
    for (var _i = 0, _e = Object.entries(reconciledValues); _i < _e.length; _i++) {
        var _f = _e[_i], field = _f[0], raw = _f[1];
        if (!field)
            continue;
        if (raw && typeof raw === "object" && "value" in raw && raw.value !== undefined) {
            reconciledOverrides.set(field, String(raw.value));
            continue;
        }
        if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
            reconciledOverrides.set(field, String(raw));
        }
    }
    // Build set of fields that users have already resolved
    var resolvedFields = new Set(__spreadArray(__spreadArray([], userResolutions.map(function (r) { return r.field; }), true), Array.from(reconciledOverrides.keys()), true));
    // Filter out needs_review items for fields that have user resolutions
    var reconciledNeedsReview = freshNeedsReview.filter(function (item) { return !resolvedFields.has(item.field); });
    // Merge errata: user resolutions first, then fresh auto-errata for non-resolved fields
    var reconciledErrata = __spreadArray(__spreadArray([], userResolutions, true), freshErrata.filter(function (e) { return !resolvedFields.has(e.field); }), true);
    // Apply user resolution overrides to summary values
    var fieldToSummaryKey = {
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
    var summaryOverrides = new Map();
    for (var _g = 0, userResolutions_1 = userResolutions; _g < userResolutions_1.length; _g++) {
        var resolution = userResolutions_1[_g];
        if (resolution.field && resolution.decision) {
            summaryOverrides.set(resolution.field, resolution.decision);
        }
    }
    for (var _h = 0, reconciledOverrides_1 = reconciledOverrides; _h < reconciledOverrides_1.length; _h++) {
        var _j = reconciledOverrides_1[_h], field = _j[0], decision = _j[1];
        summaryOverrides.set(field, decision);
    }
    for (var _k = 0, summaryOverrides_1 = summaryOverrides; _k < summaryOverrides_1.length; _k++) {
        var _l = summaryOverrides_1[_k], field = _l[0], decision = _l[1];
        var summaryKey = fieldToSummaryKey[field];
        if (!summaryKey || !decision)
            continue;
        summary[summaryKey] = decision;
        // Also set incident_date when dol is overridden
        if (summaryKey === "dol") {
            summary.incident_date = decision;
        }
    }
    // Aggregate open_hearings from per-file extracted_data (WC only)
    var openHearings;
    if (isWC && existingIndex.folders) {
        var hearingMap = new Map();
        for (var _m = 0, _o = Object.values(existingIndex.folders); _m < _o.length; _m++) {
            var folder = _o[_m];
            for (var _p = 0, _q = folder.files || []; _p < _q.length; _p++) {
                var file = _q[_p];
                var ed = file.extracted_data;
                if (!(ed === null || ed === void 0 ? void 0 : ed.hearing_case_number))
                    continue;
                // Handle semicolon-separated case numbers (e.g., "2680493-RA; 2680501-RA")
                var caseNumbers = ed.hearing_case_number.split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
                for (var _r = 0, caseNumbers_1 = caseNumbers; _r < caseNumbers_1.length; _r++) {
                    var rawCn = caseNumbers_1[_r];
                    // Normalize: strip HO-/AO- prefixes for dedup
                    var cn = rawCn.replace(/^(HO|AO)-/i, "");
                    var level = ed.hearing_level === "A.O." ? "A.O." : "H.O.";
                    var existing = hearingMap.get(cn);
                    if (!existing) {
                        hearingMap.set(cn, { hearing_level: level, next_date: ed.next_hearing_date, issue: ed.hearing_issue });
                    }
                    else if (level === "A.O.") {
                        // Escalate to A.O. if any document marks it as appeal-level
                        existing.hearing_level = "A.O.";
                    }
                }
            }
        }
        if (hearingMap.size > 0) {
            openHearings = Array.from(hearingMap.entries()).map(function (_a) {
                var cn = _a[0], info = _a[1];
                return (__assign(__assign({ case_number: cn, hearing_level: info.hearing_level }, (info.next_date ? { next_date: info.next_date } : {})), (info.issue ? { issue: info.issue } : {})));
            });
        }
    }
    // Merge into final index
    var result = __assign(__assign({}, existingIndex), { indexed_at: new Date().toISOString(), case_name: formatCaseName(summary.client), case_phase: caseSummaryResult.case_phase, summary: summary, needs_review: reconciledNeedsReview, errata: reconciledErrata, 
        // Preserve these from existing if present
        reconciled_values: existingIndex.reconciled_values || {}, case_notes: existingIndex.case_notes || [], chat_archives: existingIndex.chat_archives || [] });
    if (openHearings && openHearings.length > 0) {
        result.open_hearings = openHearings;
    }
    return result;
}
/**
 * Compare old vs new index and produce a human-readable diff.
 */
function diffIndexes(oldIndex, newIndex) {
    var _a, _b, _c, _d;
    // Find new files indexed
    var oldFiles = new Set();
    if (oldIndex === null || oldIndex === void 0 ? void 0 : oldIndex.folders) {
        for (var _i = 0, _e = Object.entries(oldIndex.folders); _i < _e.length; _i++) {
            var _f = _e[_i], folder = _f[0], data = _f[1];
            var files = extractFileNames(data);
            for (var _g = 0, files_1 = files; _g < files_1.length; _g++) {
                var f = files_1[_g];
                oldFiles.add("".concat(folder, "/").concat(f));
            }
        }
    }
    var newFilesIndexed = [];
    if (newIndex === null || newIndex === void 0 ? void 0 : newIndex.folders) {
        for (var _h = 0, _j = Object.entries(newIndex.folders); _h < _j.length; _h++) {
            var _k = _j[_h], folder = _k[0], data = _k[1];
            var files = extractFileNames(data);
            for (var _l = 0, files_2 = files; _l < files_2.length; _l++) {
                var f = files_2[_l];
                if (!oldFiles.has("".concat(folder, "/").concat(f))) {
                    newFilesIndexed.push(f);
                }
            }
        }
    }
    // Find new providers
    var oldProviders = new Set(((_a = oldIndex === null || oldIndex === void 0 ? void 0 : oldIndex.summary) === null || _a === void 0 ? void 0 : _a.providers) || []);
    var newProviders = (((_b = newIndex === null || newIndex === void 0 ? void 0 : newIndex.summary) === null || _b === void 0 ? void 0 : _b.providers) || []).filter(function (p) { return !oldProviders.has(p); });
    // Charges change
    var oldCharges = parseChargesNumber((_c = oldIndex === null || oldIndex === void 0 ? void 0 : oldIndex.summary) === null || _c === void 0 ? void 0 : _c.total_charges);
    var newCharges = parseChargesNumber((_d = newIndex === null || newIndex === void 0 ? void 0 : newIndex.summary) === null || _d === void 0 ? void 0 : _d.total_charges);
    var chargesChange = oldCharges !== newCharges
        ? { old: oldCharges, new: newCharges }
        : null;
    // Count new conflicts (needs_review items)
    var newConflicts = ((newIndex === null || newIndex === void 0 ? void 0 : newIndex.needs_review) || []).length;
    // Count preserved user resolutions
    var resolvedConflictsPreserved = ((newIndex === null || newIndex === void 0 ? void 0 : newIndex.errata) || []).filter(function (e) { return e.resolution_type === "user_decision" || e.resolution_type === "batch_review"; }).length;
    // Build summary string
    var parts = [];
    if (newFilesIndexed.length > 0) {
        parts.push("".concat(newFilesIndexed.length, " new file").concat(newFilesIndexed.length > 1 ? "s" : "", " indexed"));
    }
    if (newProviders.length > 0) {
        parts.push("".concat(newProviders.length, " new provider").concat(newProviders.length > 1 ? "s" : "", ": ").concat(newProviders.join(", ")));
    }
    if (chargesChange) {
        parts.push("charges updated: $".concat(chargesChange.old.toLocaleString(), " \u2192 $").concat(chargesChange.new.toLocaleString()));
    }
    if (newConflicts > 0) {
        parts.push("".concat(newConflicts, " conflict").concat(newConflicts > 1 ? "s" : "", " to review"));
    }
    if (resolvedConflictsPreserved > 0) {
        parts.push("".concat(resolvedConflictsPreserved, " user resolution").concat(resolvedConflictsPreserved > 1 ? "s" : "", " preserved"));
    }
    var summary = parts.length > 0
        ? parts.join("; ")
        : "Index updated (no significant changes)";
    return {
        newFilesIndexed: newFilesIndexed,
        newProviders: newProviders,
        chargesChange: chargesChange,
        newConflicts: newConflicts,
        resolvedConflictsPreserved: resolvedConflictsPreserved,
        summary: summary,
    };
}
/** Extract filenames from a folder data structure (handles all formats). */
function extractFileNames(data) {
    var files = Array.isArray(data)
        ? data
        : (data === null || data === void 0 ? void 0 : data.files) || (data === null || data === void 0 ? void 0 : data.documents) || [];
    return files.map(function (f) {
        return typeof f === "string" ? f : (f === null || f === void 0 ? void 0 : f.filename) || (f === null || f === void 0 ? void 0 : f.file) || "";
    }).filter(Boolean);
}
/** Parse charges from various formats to a number. */
function parseChargesNumber(val) {
    if (typeof val === "number")
        return val;
    if (typeof val === "string") {
        var cleaned = val.replace(/[$,]/g, "");
        var num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}
