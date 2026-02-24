import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { promisify } from "util";
import { BUILT_IN_TEMPLATES, buildEvidencePacket } from "../lib/evidence-packet";
import { resolvePoppler, runPdftotext } from "../lib/pdftotext";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

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

async function createOnePageFormPdf(path: string, fieldValue: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText("Wage Calculation Form", { x: 72, y: 740, size: 14, font });
  page.drawText("Employee:", { x: 72, y: 700, size: 12, font });
  const form = pdf.getForm();
  const employeeField = form.createTextField("employee_name");
  employeeField.setText(fieldValue);
  employeeField.addToPage(page, {
    x: 145,
    y: 694,
    width: 240,
    height: 18,
    font,
  });
  const bytes = await pdf.save();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

interface ParsedPgm {
  width: number;
  height: number;
  maxValue: number;
  dataOffset: number;
}

function parsePgm(buffer: Buffer): ParsedPgm {
  let offset = 0;
  const whitespace = new Set([9, 10, 13, 32]);

  const readToken = (): string => {
    while (offset < buffer.length) {
      const ch = buffer[offset];
      if (ch === 35) {
        while (offset < buffer.length && buffer[offset] !== 10 && buffer[offset] !== 13) offset += 1;
        continue;
      }
      if (whitespace.has(ch)) {
        offset += 1;
        continue;
      }
      break;
    }
    if (offset >= buffer.length) {
      throw new Error("Unexpected end of PGM header");
    }
    const start = offset;
    while (offset < buffer.length) {
      const ch = buffer[offset];
      if (whitespace.has(ch) || ch === 35) break;
      offset += 1;
    }
    return buffer.toString("ascii", start, offset);
  };

  const magic = readToken();
  if (magic !== "P5") {
    throw new Error(`Unsupported PGM format: ${magic}`);
  }
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  while (offset < buffer.length && whitespace.has(buffer[offset])) {
    offset += 1;
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxValue)) {
    throw new Error("Invalid numeric header values in PGM file");
  }

  return { width, height, maxValue, dataOffset: offset };
}

const ONE_PIXEL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAGgAwAEAAAAAQAAAAEAAAAA/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8AKKKK+kPnz//Z";

async function createOnePixelJpeg(path: string): Promise<void> {
  const bytes = Buffer.from(ONE_PIXEL_JPEG_BASE64, "base64");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function createImageOnlyPdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const imageBytes = Buffer.from(ONE_PIXEL_JPEG_BASE64, "base64");
  const image = await pdf.embedJpg(imageBytes);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const bytes = await pdf.save();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function createRotatedImageOnlyPdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.setRotation(degrees(90));
  const imageBytes = Buffer.from(ONE_PIXEL_JPEG_BASE64, "base64");
  const image = await pdf.embedJpg(imageBytes);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
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

  it("preserves filled form values in packet exhibits", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    const sourcePath = join(caseFolder, "records/wage-form.pdf");
    const employeeName = "Peyton Hunton";
    await createOnePageFormPdf(sourcePath, employeeName);

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [{ path: "records/wage-form.pdf", title: "Wage Form" }],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
    });

    const packetPath = join(caseFolder, "packet-form-output.pdf");
    await writeFile(packetPath, result.pdfBytes);

    try {
      const extractedText = await runPdftotext([packetPath, "-"], { timeout: 20000 });
      expect(extractedText).toContain(employeeName);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        console.warn("[evidence-packet.test] pdftotext unavailable; skipped filled-form text assertion");
        return;
      }
      throw error;
    }
  });

  it("keeps manual redaction overlays after packet merge", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createOnePagePdf(join(caseFolder, "records/plain.pdf"), "Plain exhibit text");

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [{ path: "records/plain.pdf", title: "Plain Exhibit" }],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
      manualRedactionsByPath: {
        "records/plain.pdf": [
          {
            page: 1,
            xPct: 0.25,
            yPct: 0.25,
            widthPct: 0.2,
            heightPct: 0.08,
          },
        ],
      },
    });

    const packetPath = join(caseFolder, "packet-redaction-output.pdf");
    await writeFile(packetPath, result.pdfBytes);

    const rasterPrefix = join(caseFolder, "packet-exhibit-page");
    try {
      const pdftoppm = resolvePoppler("pdftoppm");
      await execFileAsync(
        pdftoppm,
        [
          "-gray",
          "-singlefile",
          "-r", "72",
          "-f", "2",
          "-l", "2",
          packetPath,
          rasterPrefix,
        ],
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
      );
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        console.warn("[evidence-packet.test] pdftoppm unavailable; skipped redaction raster assertion");
        return;
      }
      throw error;
    }

    const pgmPath = `${rasterPrefix}.pgm`;
    const pgmBytes = await readFile(pgmPath);
    const parsed = parsePgm(pgmBytes);
    expect(parsed.maxValue).toBe(255);

    const sampleX = Math.floor((0.25 + 0.2 / 2) * 612);
    const sampleY = Math.floor((0.25 + 0.08 / 2) * 792);
    const sampleOffset = parsed.dataOffset + sampleY * parsed.width + sampleX;

    expect(sampleX).toBeLessThan(parsed.width);
    expect(sampleY).toBeLessThan(parsed.height);
    expect(sampleOffset).toBeLessThan(pgmBytes.length);
    expect(pgmBytes[sampleOffset]).toBeLessThan(32);
  });

  it("keeps manual redaction overlays on filled form exhibits", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createOnePageFormPdf(join(caseFolder, "records/wage-form.pdf"), "Peyton Hunton");

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [{ path: "records/wage-form.pdf", title: "Wage Form" }],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
      manualRedactionsByPath: {
        "records/wage-form.pdf": [
          {
            page: 1,
            xPct: 0.23,
            yPct: 0.10,
            widthPct: 0.22,
            heightPct: 0.03,
          },
        ],
      },
    });

    const packetPath = join(caseFolder, "packet-form-redaction-output.pdf");
    await writeFile(packetPath, result.pdfBytes);

    const rasterPrefix = join(caseFolder, "packet-form-exhibit-page");
    try {
      const pdftoppm = resolvePoppler("pdftoppm");
      await execFileAsync(
        pdftoppm,
        [
          "-gray",
          "-singlefile",
          "-r", "72",
          "-f", "2",
          "-l", "2",
          packetPath,
          rasterPrefix,
        ],
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
      );
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        console.warn("[evidence-packet.test] pdftoppm unavailable; skipped form redaction raster assertion");
        return;
      }
      throw error;
    }

    const pgmPath = `${rasterPrefix}.pgm`;
    const pgmBytes = await readFile(pgmPath);
    const parsed = parsePgm(pgmBytes);
    expect(parsed.maxValue).toBe(255);

    const sampleX = Math.floor((0.23 + 0.22 / 2) * 612);
    const sampleY = Math.floor((0.10 + 0.03 / 2) * 792);
    const sampleOffset = parsed.dataOffset + sampleY * parsed.width + sampleX;

    expect(sampleX).toBeLessThan(parsed.width);
    expect(sampleY).toBeLessThan(parsed.height);
    expect(sampleOffset).toBeLessThan(pgmBytes.length);
    expect(pgmBytes[sampleOffset]).toBeLessThan(32);
  });

  it("keeps manual redaction overlays on image-based PDF exhibits", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createImageOnlyPdf(join(caseFolder, "records/scanned.pdf"));

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [{ path: "records/scanned.pdf", title: "Scanned Exhibit" }],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
      manualRedactionsByPath: {
        "records/scanned.pdf": [
          {
            page: 1,
            xPct: 0.30,
            yPct: 0.30,
            widthPct: 0.20,
            heightPct: 0.10,
          },
        ],
      },
    });

    const packetPath = join(caseFolder, "packet-scanned-redaction-output.pdf");
    await writeFile(packetPath, result.pdfBytes);

    const rasterPrefix = join(caseFolder, "packet-scanned-exhibit-page");
    try {
      const pdftoppm = resolvePoppler("pdftoppm");
      await execFileAsync(
        pdftoppm,
        [
          "-gray",
          "-singlefile",
          "-r", "72",
          "-f", "2",
          "-l", "2",
          packetPath,
          rasterPrefix,
        ],
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
      );
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        console.warn("[evidence-packet.test] pdftoppm unavailable; skipped image-based redaction raster assertion");
        return;
      }
      throw error;
    }

    const pgmPath = `${rasterPrefix}.pgm`;
    const pgmBytes = await readFile(pgmPath);
    const parsed = parsePgm(pgmBytes);
    expect(parsed.maxValue).toBe(255);

    const sampleX = Math.floor((0.30 + 0.20 / 2) * 612);
    const sampleY = Math.floor((0.30 + 0.10 / 2) * 792);
    const sampleOffset = parsed.dataOffset + sampleY * parsed.width + sampleX;

    expect(sampleX).toBeLessThan(parsed.width);
    expect(sampleY).toBeLessThan(parsed.height);
    expect(sampleOffset).toBeLessThan(pgmBytes.length);
    expect(pgmBytes[sampleOffset]).toBeLessThan(32);
  });

  it("preserves rotated page geometry when rasterizing redacted PDFs", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");
    await createRotatedImageOnlyPdf(join(caseFolder, "records/rotated-scanned.pdf"));

    const result = await buildEvidencePacket({
      caseFolder,
      documents: [{ path: "records/rotated-scanned.pdf", title: "Rotated Scanned Exhibit" }],
      caption: { claimantName: "Test Claimant" },
      includeAffirmationPage: false,
      manualRedactionsByPath: {
        "records/rotated-scanned.pdf": [
          {
            page: 1,
            xPct: 0.20,
            yPct: 0.20,
            widthPct: 0.20,
            heightPct: 0.08,
          },
        ],
      },
    });

    const packetPdf = await PDFDocument.load(result.pdfBytes);
    const exhibitPage = packetPdf.getPage(1);
    const { width, height } = exhibitPage.getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
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
