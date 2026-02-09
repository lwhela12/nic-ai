import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface PdftotextOptions {
  timeout?: number;
  maxBuffer?: number;
}

function getBundledPdftotextPath(): string | null {
  const resourcesPath = process.env.RESOURCES_PATH;
  if (!resourcesPath) return null;

  const candidates =
    process.platform === "win32"
      ? [join(resourcesPath, "tools", "pdftotext", "pdftotext.exe")]
      : [
          join(resourcesPath, "tools", "pdftotext", "pdftotext"),
          join(resourcesPath, "tools", "pdftotext", "pdftotext.exe"),
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolvePdftotextCommand(): string {
  return getBundledPdftotextPath() ?? "pdftotext";
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
  const args = options.layout === false
    ? [filePath, "-"]
    : ["-layout", filePath, "-"];
  const output = await runPdftotext(args, options);
  return output.trim();
}
