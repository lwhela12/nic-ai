import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildEvidencePacket } from "../lib/evidence-packet";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createOnePagePdf(path: string, text: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 72, y: 720, size: 14, font });
  const bytes = await pdf.save();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

describe("evidence packet", () => {
  it("builds a packet with deterministic ordering and toc ranges", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createOnePagePdf(join(caseFolder, "records/later.pdf"), "Later record");
    await createOnePagePdf(join(caseFolder, "records/earlier.pdf"), "Earlier record");
    await createOnePagePdf(join(caseFolder, "records/unmatched.pdf"), "Unmatched record");

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [
        { path: "records/later.pdf", title: "Later", date: "2025-06-01", docType: "medical" },
        { path: "records/earlier.pdf", title: "Earlier", date: "2025-01-01", docType: "medical" },
        { path: "records/unmatched.pdf", title: "Unmatched", docType: "other" },
      ],
      caption: { claimantName: "Test Claimant" },
      orderRules: [
        {
          id: "medical-by-date",
          match: { docTypes: ["medical"] },
          sortBy: "date",
          sortDirection: "asc",
        },
      ],
      includeAffirmationPage: false,
    });

    expect(result.orderedDocuments.map((doc) => doc.path)).toEqual([
      "records/earlier.pdf",
      "records/later.pdf",
      "records/unmatched.pdf",
    ]);
    expect(result.tocEntries.map((entry) => `${entry.path}:${entry.startPage}-${entry.endPage}`)).toEqual([
      "records/earlier.pdf:1-1",
      "records/later.pdf:2-2",
      "records/unmatched.pdf:3-3",
    ]);
    expect(result.totalPages).toBe(4);
    expect(result.warnings.some((warning) => warning.includes("did not match any ordering rule"))).toBe(true);
  });
});
