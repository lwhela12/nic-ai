"use strict";
// Single source of truth for case phase detection logic.
// Used by claude.ts /determine-phase endpoint and referenced by firm.ts synthesisSystemPrompt.
//
// Practice Area Support:
// - Personal Injury (PI): Original phases (Intake → Investigation → Treatment → Demand → Negotiation → Settlement → Complete)
// - Workers' Compensation (WC): WC phases (Intake → Investigation → Treatment → MMI Evaluation → Benefits Resolution → Settlement/Hearing → Closed)
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_INDICATORS = exports.PHASE_RULES = exports.WC_PHASE_INDICATORS = exports.WC_PHASE_RULES = exports.PI_PHASE_INDICATORS = exports.PI_PHASE_RULES = void 0;
exports.getPhaseRules = getPhaseRules;
exports.getPhaseIndicators = getPhaseIndicators;
exports.buildPhasePrompt = buildPhasePrompt;
var index_schema_1 = require("../lib/index-schema");
// =============================================================================
// PERSONAL INJURY PHASE RULES
// =============================================================================
exports.PI_PHASE_RULES = {
    Intake: "Has intake docs but no LOR files sent",
    Investigation: "LORs sent, gathering insurance/police info",
    Treatment: "Medical records accumulating, no demand yet",
    Demand: "Demand letter exists in 3P folder",
    Negotiation: "Settlement correspondence exists, no settlement memo",
    Settlement: "Settlement memo exists",
    Complete: "Release signed, case complete",
};
exports.PI_PHASE_INDICATORS = [
    { check: "LOR files (LOR 1P, LOR 3P)", phase: "Investigation" },
    { check: 'Medical records in "Records & Bills"', phase: "Treatment" },
    { check: '"Demand" in filename in 3P folder', phase: "Demand" },
    { check: "Settlement correspondence", phase: "Negotiation" },
    { check: "Settlement memo in Settlement folder", phase: "Settlement" },
    { check: "Signed release in Settlement folder", phase: "Complete" },
];
// =============================================================================
// WORKERS' COMPENSATION PHASE RULES
// =============================================================================
exports.WC_PHASE_RULES = {
    Intake: "C-4 filed, initial documentation gathered",
    Investigation: "Compensability investigation underway, gathering employment/medical records",
    Treatment: "Active medical treatment, ATP visits, work status reports accumulating",
    "MMI Evaluation": "Treatment stabilized, awaiting or reviewing MMI determination and PPD rating",
    "Benefits Resolution": "Disputing benefits, negotiating PPD award, or pursuing additional compensation",
    "Settlement/Hearing": "Settlement negotiations active or hearing scheduled/completed",
    Closed: "Case resolved, settlement executed or hearing decision final",
};
exports.WC_PHASE_INDICATORS = [
    { check: "C-4 Employee Claim form filed", phase: "Intake" },
    { check: "C-3 Employer Report received", phase: "Investigation" },
    { check: "Medical records from treating physician", phase: "Treatment" },
    { check: "Work status reports or light duty documentation", phase: "Treatment" },
    { check: "IME report or MMI determination", phase: "MMI Evaluation" },
    { check: "PPD rating report", phase: "MMI Evaluation" },
    { check: "Benefit dispute correspondence or D-9 hearing request", phase: "Benefits Resolution" },
    { check: "Settlement offer or stipulation draft", phase: "Settlement/Hearing" },
    { check: "Signed settlement agreement or hearing decision", phase: "Closed" },
];
// =============================================================================
// BACKWARD COMPATIBLE EXPORTS (default to PI)
// =============================================================================
exports.PHASE_RULES = exports.PI_PHASE_RULES;
exports.PHASE_INDICATORS = exports.PI_PHASE_INDICATORS;
// =============================================================================
// PRACTICE AREA HELPERS
// =============================================================================
/**
 * Get phase rules for a practice area.
 */
function getPhaseRules(practiceArea) {
    if (practiceArea === index_schema_1.PRACTICE_AREAS.WC)
        return exports.WC_PHASE_RULES;
    return exports.PI_PHASE_RULES;
}
/**
 * Get phase indicators for a practice area.
 */
function getPhaseIndicators(practiceArea) {
    if (practiceArea === index_schema_1.PRACTICE_AREAS.WC)
        return exports.WC_PHASE_INDICATORS;
    return exports.PI_PHASE_INDICATORS;
}
/**
 * Build a phase detection prompt for the agent.
 * @param practiceArea - Optional practice area (defaults to PI)
 */
function buildPhasePrompt(practiceArea) {
    var rules = getPhaseRules(practiceArea);
    var indicators = getPhaseIndicators(practiceArea);
    var practiceAreaName = practiceArea === index_schema_1.PRACTICE_AREAS.WC ? "Workers' Compensation" : "Personal Injury";
    var rulesSection = Object.entries(rules)
        .map(function (_a) {
        var phase = _a[0], desc = _a[1];
        return "- **".concat(phase, "**: ").concat(desc);
    })
        .join("\n");
    var indicatorsSection = indicators
        .map(function (ind, i) { return "".concat(i + 1, ". ").concat(ind.check, " \u2192 at least ").concat(ind.phase, " phase"); })
        .join("\n");
    return "Read .ai_tool/document_index.json and determine the case phase based on these markers.\n\n**Practice Area:** ".concat(practiceAreaName, "\n\n**Phase Detection Logic:**\n").concat(rulesSection, "\n\n**Check the folders object for these indicator files:**\n").concat(indicatorsSection, "\n\nRead the index, determine the phase, update the \"case_phase\" field, and write the updated index back to .ai_tool/document_index.json.");
}
