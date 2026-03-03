import { describe, expect, it } from "bun:test";
import type { PageExtractionResult } from "../lib/groq-extract";
import { groupPagesIntoVirtualDocuments } from "../lib/virtual-documents";

function makePage(
  page: number,
  type: string,
  extracted_data: Record<string, unknown> = {},
  key_info = ""
): PageExtractionResult {
  return {
    page,
    type,
    key_info,
    has_handwritten_data: false,
    handwritten_fields: [],
    extracted_data,
  };
}

describe("groupPagesIntoVirtualDocuments", () => {
  it("keeps 'other' disclosure pages with the surrounding document", () => {
    const pages: PageExtractionResult[] = [
      makePage(1, "medical_bill", { document_date: "01-15-2026", document_date_confidence: "high" }, "Billing statement"),
      makePage(2, "other", {}, "Disclosure page"),
      makePage(3, "medical_bill", {}, "Statement continued"),
      makePage(4, "correspondence", {}, "Cover letter"),
    ];

    const docs = groupPagesIntoVirtualDocuments(pages, "compound.pdf", "doc_test");
    expect(docs.length).toBe(2);

    expect(docs[0].type).toBe("medical_bill");
    expect(docs[0].start_page).toBe(1);
    expect(docs[0].end_page).toBe(3);

    expect(docs[1].type).toBe("correspondence");
    expect(docs[1].start_page).toBe(4);
    expect(docs[1].end_page).toBe(4);
  });

  it("promotes leading 'other' pages into the following anchored type", () => {
    const pages: PageExtractionResult[] = [
      makePage(1, "other", {}, "Generic intro page"),
      makePage(2, "medical_bill", { document_date: "02-01-2026", document_date_confidence: "high" }, "Provider bill"),
      makePage(3, "medical_bill", {}, "Provider bill continued"),
      makePage(4, "hearing_notice", {}, "DIR hearing notice"),
    ];

    const docs = groupPagesIntoVirtualDocuments(pages, "mixed.pdf", "doc_test");
    expect(docs.length).toBe(2);

    expect(docs[0].type).toBe("medical_bill");
    expect(docs[0].start_page).toBe(1);
    expect(docs[0].end_page).toBe(3);

    expect(docs[1].type).toBe("hearing_notice");
    expect(docs[1].start_page).toBe(4);
    expect(docs[1].end_page).toBe(4);
  });

  it("splits same-type groups when trusted document dates change", () => {
    const pages: PageExtractionResult[] = [
      makePage(1, "medical_bill", { document_date: "01-10-2026", document_date_confidence: "high" }, "January statement"),
      makePage(2, "medical_bill", { document_date: "01-10-2026", document_date_confidence: "high" }, "January statement page 2"),
      makePage(3, "medical_bill", { document_date: "02-12-2026", document_date_confidence: "high" }, "February statement"),
      makePage(4, "medical_bill", { document_date: "02-12-2026", document_date_confidence: "high" }, "February statement page 2"),
    ];

    const docs = groupPagesIntoVirtualDocuments(pages, "statements.pdf", "doc_test");
    expect(docs.length).toBe(2);
    expect(docs[0].start_page).toBe(1);
    expect(docs[0].end_page).toBe(2);
    expect(docs[1].start_page).toBe(3);
    expect(docs[1].end_page).toBe(4);
  });

  it("does not split on date changes when date confidence is low or unknown", () => {
    const pages: PageExtractionResult[] = [
      makePage(1, "medical_bill", { document_date: "01-10-2026", document_date_confidence: "low" }, "Statement page 1"),
      makePage(2, "medical_bill", { document_date: "02-12-2026", document_date_confidence: "unknown" }, "Statement page 2"),
      makePage(3, "medical_bill", {}, "Statement page 3"),
    ];

    const docs = groupPagesIntoVirtualDocuments(pages, "single-doc.pdf", "doc_test");
    expect(docs).toEqual([]);
  });
});
