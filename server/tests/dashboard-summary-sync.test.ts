import { describe, expect, it } from "bun:test";
import { mergeToIndex, type HypergraphResult } from "../lib/merge-index";
import { applyResolvedFieldToSummary } from "../lib/index-summary-sync";

describe("dashboard summary sync", () => {
  it("uses most likely client name when hypergraph consensus is UNCERTAIN", () => {
    const hypergraphResult: HypergraphResult = {
      hypergraph: {
        client_name: {
          values: [
            { value: "Jane Doe", sources: ["intake.pdf", "lor.pdf"], count: 2 },
            { value: "Janet Doe", sources: ["billing.pdf"], count: 1 },
          ],
          consensus: "UNCERTAIN",
          confidence: 0,
          has_conflict: true,
        },
      },
      conflicts: [],
      summary: {
        total_fields_analyzed: 1,
        fields_with_conflicts: 1,
        confidence_score: 0.4,
      },
    };

    const merged = mergeToIndex(
      hypergraphResult,
      {
        case_summary: "Test case summary",
        case_phase: "Intake",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      {
        folders: {},
      }
    );

    expect(merged.summary.client).toBe("Jane Doe");
    expect(merged.case_name).toBe("DOE, Jane");
    expect(Array.isArray(merged.needs_review)).toBe(true);
    expect(merged.needs_review[0]?.field).toBe("client_name");
  });

  it("applies reconciled client_name overrides after reindex merge", () => {
    const hypergraphResult: HypergraphResult = {
      hypergraph: {
        client_name: {
          values: [{ value: "Wrong Name", sources: ["intake.pdf"], count: 1 }],
          consensus: "Wrong Name",
          confidence: 0.9,
          has_conflict: false,
        },
      },
      conflicts: [],
      summary: {
        total_fields_analyzed: 1,
        fields_with_conflicts: 0,
        confidence_score: 0.9,
      },
    };

    const merged = mergeToIndex(
      hypergraphResult,
      {
        case_summary: "Test case summary",
        case_phase: "Intake",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      {
        folders: {},
        reconciled_values: {
          client_name: { value: "Corrected Name" },
        },
      }
    );

    expect(merged.summary.client).toBe("Corrected Name");
    expect(merged.case_name).toBe("NAME, Corrected");
  });

  it("updates dashboard-facing fields immediately when a conflict is resolved", () => {
    const index: any = {
      case_name: "Unknown",
      summary: {
        client: "Unknown",
        claim_numbers: {},
      },
    };

    const changed = applyResolvedFieldToSummary(index, "client_name", "Alex Rivera");

    expect(changed).toBe(true);
    expect(index.summary.client).toBe("Alex Rivera");
    expect(index.case_name).toBe("RIVERA, Alex");
  });
});

