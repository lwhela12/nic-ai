import { describe, expect, it } from "bun:test";
import { normalizeIndex } from "../lib/index-schema";

describe("index schema file metadata normalization", () => {
  it("preserves per-file date and issues fields", () => {
    const normalized = normalizeIndex({
      indexed_at: "2026-02-09T00:00:00.000Z",
      case_name: "TEST, Client",
      case_phase: "Intake",
      summary: {
        client: "Test Client",
        incident_date: "2026-01-01",
        providers: [],
        total_charges: 0,
        case_summary: "Test summary",
      },
      folders: {
        Intake: {
          files: [
            {
              filename: "Letter.pdf",
              type: "correspondence",
              key_info: "Dated correspondence",
              date: "2026-01-15",
              issues: "Document date extracted with low confidence.",
              has_handwritten_data: true,
              handwritten_fields: ["client_name", "document_date"],
              user_reviewed: true,
              reviewed_at: "2026-02-09T12:34:56.000Z",
              review_notes: "User confirmed and corrected extracted values.",
              extracted_data: {
                document_date: "2026-01-15",
                document_date_confidence: "low",
                document_date_reason: "Multiple dates in signature block and body",
              },
            },
          ],
        },
      },
    });

    const file = normalized.folders.Intake.files[0];
    expect(file.filename).toBe("Letter.pdf");
    expect(file.date).toBe("2026-01-15");
    expect(file.issues).toContain("low confidence");
    expect(file.has_handwritten_data).toBe(true);
    expect(file.handwritten_fields).toEqual(["client_name", "document_date"]);
    expect(file.user_reviewed).toBe(true);
    expect(file.reviewed_at).toBe("2026-02-09T12:34:56.000Z");
    expect(file.review_notes).toBe("User confirmed and corrected extracted values.");
    expect((file.extracted_data as any).document_date).toBe("2026-01-15");
  });

  it("defaults handwriting metadata and infers true when handwritten_fields exist", () => {
    const normalized = normalizeIndex({
      indexed_at: "2026-02-09T00:00:00.000Z",
      case_name: "TEST, Client",
      case_phase: "Intake",
      summary: {
        client: "Test Client",
        incident_date: "2026-01-01",
        providers: [],
        total_charges: 0,
        case_summary: "Test summary",
      },
      folders: {
        Intake: {
          files: [
            {
              filename: "NoHandwriting.pdf",
              type: "correspondence",
              key_info: "Typed letter",
            },
            {
              filename: "InferredHandwriting.pdf",
              type: "intake_form",
              key_info: "Includes handwritten notes",
              handwritten_fields: ["client_name", " client_name ", " "],
            },
            {
              filename: "SignatureOnly.pdf",
              type: "authorization",
              key_info: "Contains signed authorization",
              has_handwritten_data: true,
              handwritten_fields: ["signature", "signed_by", "initials"],
            },
            {
              filename: "AssignedDateField.pdf",
              type: "other",
              key_info: "Contains handwritten assigned date field",
              has_handwritten_data: true,
              handwritten_fields: ["assigned_date"],
            },
          ],
        },
      },
    });

    const typed = normalized.folders.Intake.files[0];
    const inferred = normalized.folders.Intake.files[1];
    const signatureOnly = normalized.folders.Intake.files[2];
    const assignedDate = normalized.folders.Intake.files[3];

    expect(typed.has_handwritten_data).toBe(false);
    expect(typed.handwritten_fields).toEqual([]);

    expect(inferred.has_handwritten_data).toBe(true);
    expect(inferred.handwritten_fields).toEqual(["client_name"]);

    expect(signatureOnly.has_handwritten_data).toBe(false);
    expect(signatureOnly.handwritten_fields).toEqual([]);

    expect(assignedDate.has_handwritten_data).toBe(true);
    expect(assignedDate.handwritten_fields).toEqual(["assigned_date"]);
  });
});
