import { execFile } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { promisify } from "util";
import { withLocalVfsFile } from "./vfs";

const execFileAsync = promisify(execFile);

export interface PdftotextOptions {
  timeout?: number;
  maxBuffer?: number;
}

/** Resolve a Poppler binary by checking RESOURCES_PATH, then project-root tools/ dir, then PATH. */
export function resolvePoppler(binaryName: string): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  const withExt = binaryName + ext;

  // 1. Production: RESOURCES_PATH (set by Electron)
  const resourcesPath = process.env.RESOURCES_PATH;
  if (resourcesPath) {
    const p = join(resourcesPath, "tools", "pdftotext", withExt);
    if (existsSync(p)) return p;
  }

  // 2. Dev mode: tools/pdftotext/ relative to project root (server/..)
  const projectRoot = join(dirname(__dirname), "..");
  const devPath = join(projectRoot, "tools", "pdftotext", withExt);
  if (existsSync(devPath)) return devPath;

  // 3. Fallback: system PATH
  return binaryName;
}

export function resolvePdftotextCommand(): string {
  return resolvePoppler("pdftotext");
}

export async function runPdftotext(
  args: string[],
  options: PdftotextOptions = {}
): Promise<string> {
  const { stdout } = await execFileAsync(resolvePdftotextCommand(), args, {
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    windowsHide: true,
  });

  return stdout;
}

export async function extractPdfText(
  filePath: string,
  options: PdftotextOptions & { layout?: boolean } = {}
): Promise<string> {
  return withLocalVfsFile(filePath, async (localPath) => {
    const args = options.layout === false
      ? [localPath, "-"]
      : ["-layout", localPath, "-"];
    const output = await runPdftotext(args, options);
    return output.trim();
  });
}

/**
 * Extract text from a single page of a PDF using pdftotext -f N -l N.
 */
export async function extractPdfTextByPage(
  filePath: string,
  page: number,
  options: PdftotextOptions & { layout?: boolean } = {}
): Promise<string> {
  return withLocalVfsFile(filePath, async (localPath) => {
    const args = [
      "-f", String(page),
      "-l", String(page),
      ...(options.layout === false ? [] : ["-layout"]),
      localPath,
      "-",
    ];
    const output = await runPdftotext(args, options);
    return output.trim();
  });
}
