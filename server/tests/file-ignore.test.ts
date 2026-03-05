import { describe, expect, it } from "bun:test";
import { shouldIgnoreFile } from "../lib/file-ignore";

describe("shouldIgnoreFile", () => {
  it("matches known system and temp files", () => {
    const ignored = [
      ".DS_Store",
      "Thumbs.db",
      "._report.pdf",
      "notes.swp",
      "draft.swo",
      "summary.md~",
      "~$intake.docx",
      ".~lock.case.docx#",
    ];

    for (const name of ignored) {
      expect(shouldIgnoreFile(name)).toBe(true);
    }
  });

  it("keeps normal case files indexable", () => {
    const kept = [
      "Intake Form.pdf",
      "Medical/records-2025.pdf",
      "demand-letter.docx",
      "photo.jpg",
      ".hidden-but-not-temp.pdf",
    ];

    for (const name of kept) {
      expect(shouldIgnoreFile(name)).toBe(false);
    }
  });
});
