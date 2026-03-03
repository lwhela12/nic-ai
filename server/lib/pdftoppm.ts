/**
 * PDF-to-JPEG conversion using poppler's pdftoppm/pdfinfo.
 *
 * Uses JPEG instead of PNG for 5-10x smaller file sizes on scanned documents,
 * which dramatically reduces memory pressure during vision API calls.
 *
 * Follows the same binary resolution pattern as pdftotext.ts.
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";
import { resolvePoppler } from "./pdftotext";
import { withLocalVfsFile } from "./vfs";

const execFileAsync = promisify(execFile);

export interface PdfPageImage {
  page: number;
  base64: string; // JPEG data as base64
  sizeBytes: number;
}

export interface PdfToImagesOptions {
  cropBox?: boolean;
  hideAnnotations?: boolean;
}

function resolvePdftoppmCommand(): string {
  return resolvePoppler("pdftoppm");
}

function resolvePdfinfoCommand(): string {
  return resolvePoppler("pdfinfo");
}

/**
 * Get the page count of a PDF via pdfinfo.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  return withLocalVfsFile(pdfPath, async (localPath) => {
    const { stdout } = await execFileAsync(resolvePdfinfoCommand(), [localPath], {
      timeout: 15000,
      windowsHide: true,
    });

    const match = stdout.match(/Pages:\s+(\d+)/);
    if (!match) {
      throw new Error(`Could not determine page count for ${pdfPath}`);
    }
    return parseInt(match[1], 10);
  });
}

/**
 * Convert PDF pages to JPEG images using pdftoppm.
 *
 * @param pdfPath  Absolute path to the PDF
 * @param firstPage  First page to convert (1-based)
 * @param lastPage   Last page to convert (1-based, inclusive)
 * @param dpi        Resolution (default 200)
 * @returns Array of PdfPageImage with base64-encoded JPEG data
 */
export async function pdfToImages(
  pdfPath: string,
  firstPage: number,
  lastPage: number,
  dpi: number = 200,
  options: PdfToImagesOptions = {}
): Promise<PdfPageImage[]> {
  return withLocalVfsFile(pdfPath, async (localPath) => {
    const prefix = join(tmpdir(), `groq-pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    try {
      const commandArgs = [
        "-jpeg",
        "-r", String(dpi),
        "-f", String(firstPage),
        "-l", String(lastPage),
        ...(options.cropBox ? ["-cropbox"] : []),
        ...(options.hideAnnotations ? ["-hide-annotations"] : []),
        localPath,
        prefix,
      ];
      await execFileAsync(
        resolvePdftoppmCommand(),
        commandArgs,
        {
          timeout: 60000,
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true,
        }
      );

      const images: PdfPageImage[] = [];
      for (let page = firstPage; page <= lastPage; page++) {
        // pdftoppm names files like prefix-01.jpg, prefix-02.jpg, etc.
        // The number of digits depends on total pages: could be -1.jpg, -01.jpg, -001.jpg
        const candidates = [
          `${prefix}-${page}.jpg`,
          `${prefix}-${String(page).padStart(2, "0")}.jpg`,
          `${prefix}-${String(page).padStart(3, "0")}.jpg`,
        ];

        let found = false;
        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            let buf: Buffer | null = await readFile(candidate);
            const b64 = buf.toString("base64");
            const size = buf.length;
            buf = null; // Release raw JPEG buffer immediately
            images.push({ page, base64: b64, sizeBytes: size });
            // Clean up temp file
            await unlink(candidate).catch(() => { });
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
          `${page}.jpg`,
          `${String(page).padStart(2, "0")}.jpg`,
          `${String(page).padStart(3, "0")}.jpg`,
        ]) {
          await unlink(`${prefix}-${suffix}`).catch(() => { });
        }
      }
      throw err;
    }
  });
}
