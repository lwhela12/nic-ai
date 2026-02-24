import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { BUILT_IN_TEMPLATES, buildEvidencePacket } from "../lib/evidence-packet";

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

const ONE_PIXEL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAGgAwAEAAAAAQAAAAEAAAAA/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8AKKKK+kPnz//Z";

async function createOnePixelJpeg(path: string): Promise<void> {
  const bytes = Buffer.from(ONE_PIXEL_JPEG_BASE64, "base64");
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

  it("includes JPG documents by converting them to packet pages", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createOnePagePdf(join(caseFolder, "records/record.pdf"), "PDF record");
    await createOnePixelJpeg(join(caseFolder, "records/photo.jpg"));

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [
        { path: "records/record.pdf", title: "PDF Record" },
        { path: "records/photo.jpg", title: "Photo Exhibit" },
      ],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
    });

    expect(result.orderedDocuments.map((doc) => doc.path)).toEqual([
      "records/record.pdf",
      "records/photo.jpg",
    ]);
    expect(result.tocEntries.map((entry) => `${entry.path}:${entry.startPage}-${entry.endPage}`)).toEqual([
      "records/record.pdf:1-1",
      "records/photo.jpg:2-2",
    ]);
    expect(result.totalPages).toBe(3);

    const finalPdf = await PDFDocument.load(result.pdfBytes);
    const imagePage = finalPdf.getPage(2);
    const { width, height } = imagePage.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("uses updated HO affirmation text and keeps AO affirmation text unchanged", () => {
    const hoTemplate = BUILT_IN_TEMPLATES.find((template) => template.id === "ho-standard");
    const aoTemplate = BUILT_IN_TEMPLATES.find((template) => template.id === "ao-standard");

    expect(hoTemplate?.affirmationText).toBe(
      "Pursuant to NRS 239B.030, the undersigned does hereby affirm the attached documents do not expose the personal information of any person"
    );
    expect(aoTemplate?.affirmationText).toBe(
      "The undersigned does hereby affirm that the attached Claimant's Documentary Evidence filed in Appeal No.: {{hearingNumber}}"
    );
  });
});
