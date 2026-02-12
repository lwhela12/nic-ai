/**
 * PDF-to-PNG conversion using poppler's pdftoppm/pdfinfo.
 *
 * Follows the same binary resolution pattern as pdftotext.ts.
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface PdfPageImage {
  page: number;
  base64: string; // PNG data as base64
  sizeBytes: number;
}

function getBundledPdftoppmPath(): string | null {
  const resourcesPath = process.env.RESOURCES_PATH;
  if (!resourcesPath) return null;

  const candidates =
    process.platform === "win32"
      ? [join(resourcesPath, "tools", "pdftotext", "pdftoppm.exe")]
      : [
          join(resourcesPath, "tools", "pdftotext", "pdftoppm"),
          join(resourcesPath, "tools", "pdftotext", "pdftoppm.exe"),
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBundledPdfinfoPath(): string | null {
  const resourcesPath = process.env.RESOURCES_PATH;
  if (!resourcesPath) return null;

  const candidates =
    process.platform === "win32"
      ? [join(resourcesPath, "tools", "pdftotext", "pdfinfo.exe")]
      : [
          join(resourcesPath, "tools", "pdftotext", "pdfinfo"),
          join(resourcesPath, "tools", "pdftotext", "pdfinfo.exe"),
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePdftoppmCommand(): string {
  return getBundledPdftoppmPath() ?? "pdftoppm";
}

function resolvePdfinfoCommand(): string {
  return getBundledPdfinfoPath() ?? "pdfinfo";
}

/**
 * Get the page count of a PDF via pdfinfo.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync(resolvePdfinfoCommand(), [pdfPath], {
    timeout: 15000,
    windowsHide: true,
  });

  const match = stdout.match(/Pages:\s+(\d+)/);
  if (!match) {
    throw new Error(`Could not determine page count for ${pdfPath}`);
  }
  return parseInt(match[1], 10);
}

/**
 * Convert PDF pages to PNG images using pdftoppm.
 *
 * @param pdfPath  Absolute path to the PDF
 * @param firstPage  First page to convert (1-based)
 * @param lastPage   Last page to convert (1-based, inclusive)
 * @param dpi        Resolution (default 200)
 * @returns Array of PdfPageImage with base64-encoded PNG data
 */
export async function pdfToImages(
  pdfPath: string,
  firstPage: number,
  lastPage: number,
  dpi: number = 200
): Promise<PdfPageImage[]> {
  const prefix = join(tmpdir(), `groq-pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  try {
    await execFileAsync(
      resolvePdftoppmCommand(),
      [
        "-png",
        "-r", String(dpi),
        "-f", String(firstPage),
        "-l", String(lastPage),
        pdfPath,
        prefix,
      ],
      {
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      }
    );

    const images: PdfPageImage[] = [];
    for (let page = firstPage; page <= lastPage; page++) {
      // pdftoppm names files like prefix-01.png, prefix-02.png, etc.
      // The number of digits depends on total pages: could be -1.png, -01.png, -001.png
      const candidates = [
        `${prefix}-${page}.png`,
        `${prefix}-${String(page).padStart(2, "0")}.png`,
        `${prefix}-${String(page).padStart(3, "0")}.png`,
      ];

      let found = false;
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          const buf = await readFile(candidate);
          images.push({
            page,
            base64: buf.toString("base64"),
            sizeBytes: buf.length,
          });
          // Clean up temp file
          await unlink(candidate).catch(() => {});
          found = true;
          break;
        }
      }

      if (!found) {
        console.warn(`[pdftoppm] Missing output for page ${page} of ${pdfPath}`);
      }
    }

    return images;
  } catch (err) {
    // Clean up any temp files on error
    for (let page = firstPage; page <= lastPage; page++) {
      for (const suffix of [
        `${page}.png`,
        `${String(page).padStart(2, "0")}.png`,
        `${String(page).padStart(3, "0")}.png`,
      ]) {
        await unlink(`${prefix}-${suffix}`).catch(() => {});
      }
    }
    throw err;
  }
}
