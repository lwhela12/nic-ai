"use strict";
/**
 * Keep dashboard-facing summary fields synchronized after manual corrections.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyResolvedFieldToSummary = applyResolvedFieldToSummary;
function formatCaseName(clientName) {
    if (!clientName)
        return "Unknown";
    var parts = clientName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "Unknown";
    if (parts.length === 1)
        return parts[0].toUpperCase();
    var last = parts[parts.length - 1].toUpperCase();
    var first = parts.slice(0, -1).join(" ");
    return "".concat(last, ", ").concat(first);
}
function parseAddress(addressStr) {
    if (!addressStr)
        return {};
    var match = addressStr.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
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
function toNumber(value) {
    var num = parseFloat(String(value !== null && value !== void 0 ? value : "").replace(/[$,]/g, ""));
    return isNaN(num) ? undefined : num;
}
function ensureObject(target, key) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
        target[key] = {};
    }
    return target[key];
}
/**
 * Apply a resolved field/value to summary fields that power dashboard views.
 * Returns true if anything was updated.
 */
function applyResolvedFieldToSummary(index, field, resolvedValue) {
    if (!index || !field || !index.summary || typeof index.summary !== "object")
        return false;
    var rawField = String(field).trim();
    var f = rawField.toLowerCase();
    var value = typeof resolvedValue === "string" ? resolvedValue.trim() : resolvedValue;
    var updated = false;
    if (f === "date_of_loss" || f === "date_of_injury" || f === "dol" || f === "doi" || f === "incident_date") {
        index.summary.dol = value;
        index.summary.incident_date = value;
        return true;
    }
    if (f === "client_name" || f === "claimant_name" || f === "client") {
        var client = String(value || "");
        index.summary.client = client;
        index.case_name = formatCaseName(client);
        return true;
    }
    if (f === "date_of_birth" || f === "dob") {
        index.summary.dob = value;
        return true;
    }
    if (f === "client_phone" || f === "phone") {
        var contact = ensureObject(index.summary, "contact");
        contact.phone = value;
        return true;
    }
    if (f === "client_email" || f === "email") {
        var contact = ensureObject(index.summary, "contact");
        contact.email = value;
        return true;
    }
    if (f === "client_address" || f === "address") {
        var contact = ensureObject(index.summary, "contact");
        contact.address = typeof value === "string" ? parseAddress(value) : value;
        return true;
    }
    if (f === "claim_number_1p") {
        var claimNumbers = ensureObject(index.summary, "claim_numbers");
        claimNumbers["1P"] = value;
        return true;
    }
    if (f === "claim_number_3p") {
        var claimNumbers = ensureObject(index.summary, "claim_numbers");
        claimNumbers["3P"] = value;
        return true;
    }
    if (/^claim_numbers:/i.test(rawField)) {
        var key = rawField.replace(/^claim_numbers:/i, "").trim();
        var claimNumbers = ensureObject(index.summary, "claim_numbers");
        claimNumbers[key] = value;
        return true;
    }
    // PI adjuster fields (stored inside policy_limits)
    if (f === "adjuster_name_1p" || f === "adjuster_phone_1p" || f === "adjuster_email_1p") {
        var policyLimits = ensureObject(index.summary, "policy_limits");
        var party = ensureObject(policyLimits, "1P");
        if (!party.carrier)
            party.carrier = "Unknown";
        var adjField = f.replace("_1p", ""); // adjuster_name, adjuster_phone, adjuster_email
        party[adjField] = value;
        return true;
    }
    if (f === "adjuster_name_3p" || f === "adjuster_phone_3p" || f === "adjuster_email_3p") {
        var policyLimits = ensureObject(index.summary, "policy_limits");
        var party = ensureObject(policyLimits, "3P");
        if (!party.carrier)
            party.carrier = "Unknown";
        var adjField = f.replace("_3p", ""); // adjuster_name, adjuster_phone, adjuster_email
        party[adjField] = value;
        return true;
    }
    if (f === "policy_limits_1p" || f === "policy_limits_3p") {
        var party = f.endsWith("_1p") ? "1P" : "3P";
        var policyLimits = ensureObject(index.summary, "policy_limits");
        if (!policyLimits[party] || typeof policyLimits[party] !== "object") {
            policyLimits[party] = { carrier: "Unknown" };
        }
        if (typeof value === "string") {
            policyLimits[party].bodily_injury = value;
        }
        else if (value && typeof value === "object") {
            policyLimits[party] = __assign(__assign({}, policyLimits[party]), value);
        }
        return true;
    }
    if (/^policy_limits:/i.test(rawField)) {
        var parts = rawField.replace(/^policy_limits:/i, "").split(":").filter(Boolean);
        if (parts.length > 0) {
            var policyLimits = ensureObject(index.summary, "policy_limits");
            var party = parts[0];
            if (!policyLimits[party] || typeof policyLimits[party] !== "object") {
                policyLimits[party] = {};
            }
            if (parts.length === 1) {
                policyLimits[party] = value;
            }
            else {
                policyLimits[party][parts[1]] = value;
            }
            return true;
        }
    }
    if (f === "health_insurance") {
        if (typeof value === "string") {
            try {
                index.summary.health_insurance = JSON.parse(value);
            }
            catch (_a) {
                index.summary.health_insurance = { carrier: value };
            }
        }
        else {
            index.summary.health_insurance = value;
        }
        return true;
    }
    if (f === "health_insurance_carrier") {
        var hi = ensureObject(index.summary, "health_insurance");
        hi.carrier = value;
        return true;
    }
    if (f === "health_insurance_group") {
        var hi = ensureObject(index.summary, "health_insurance");
        hi.group_no = value;
        return true;
    }
    if (f === "health_insurance_member") {
        var hi = ensureObject(index.summary, "health_insurance");
        hi.member_no = value;
        return true;
    }
    if (f === "employer_name" || f === "employer") {
        var employer = ensureObject(index.summary, "employer");
        employer.name = value;
        return true;
    }
    if (f === "employer_address") {
        var employer = ensureObject(index.summary, "employer");
        employer.address = value;
        return true;
    }
    if (f === "employer_phone") {
        var employer = ensureObject(index.summary, "employer");
        employer.phone = value;
        return true;
    }
    if (f === "wc_carrier" || f === "wc_insurance_carrier") {
        var wc = ensureObject(index.summary, "wc_carrier");
        wc.carrier = value;
        return true;
    }
    if (f === "wc_claim_number" || f === "claim_number") {
        var wc = ensureObject(index.summary, "wc_carrier");
        wc.claim_number = value;
        return true;
    }
    if (f === "adjuster_name") {
        var wc = ensureObject(index.summary, "wc_carrier");
        wc.adjuster = value;
        return true;
    }
    if (f === "adjuster_phone") {
        var wc = ensureObject(index.summary, "wc_carrier");
        wc.adjuster_phone = value;
        return true;
    }
    if (f === "tpa_name" || f === "third_party_administrator") {
        var wc = ensureObject(index.summary, "wc_carrier");
        wc.tpa = value;
        return true;
    }
    if (f === "amw" || f === "aww" || f === "average_monthly_wage") {
        var disability = ensureObject(index.summary, "disability_status");
        disability.amw = toNumber(value);
        return true;
    }
    if (f === "compensation_rate" || f === "weekly_compensation_rate") {
        var disability = ensureObject(index.summary, "disability_status");
        disability.compensation_rate = toNumber(value);
        return true;
    }
    if (f === "disability_type") {
        var disability = ensureObject(index.summary, "disability_status");
        disability.type = value;
        return true;
    }
    if (f === "mmi_date") {
        var disability = ensureObject(index.summary, "disability_status");
        disability.mmi_date = value;
        return true;
    }
    if (f === "ppd_rating") {
        var disability = ensureObject(index.summary, "disability_status");
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
            index.summary.body_parts = value.map(function (v) { return String(v); }).filter(Boolean);
        }
        else if (typeof value === "string") {
            index.summary.body_parts = value.split(/[,;]/).map(function (v) { return v.trim(); }).filter(Boolean);
        }
        return true;
    }
    if (f.startsWith("charges:") || f.startsWith("provider_charges:")) {
        // Specialized charge recalculation is handled at call sites.
        updated = false;
    }
    return updated;
}
