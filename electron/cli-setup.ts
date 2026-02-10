/**
 * Claude Code CLI Setup Utilities
 *
 * Handles first-run detection and installation of Claude Code CLI.
 * Required for the Claude Agent SDK to function.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const execAsync = promisify(exec);

// File-based logging for debugging GUI launch issues
function getLogDir(): string {
  if (process.platform === "win32") {
    return join(homedir(), "AppData", "Local", "Claude PI");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Logs", "Claude PI");
  }
  return join(homedir(), ".local", "state", "claude-pi");
}

const LOG_DIR = getLogDir();
const LOG_FILE = join(LOG_DIR, "debug.log");
const CLI_CACHE_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CLI_CACHE_FILE = join(CLI_CACHE_DIR, "cli-command-cache.json");

function debugLog(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [cli-setup] ${msg}\n`;
  console.log(`[cli-setup] ${msg}`);
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(LOG_FILE, line);
  } catch (e) {
    // Ignore logging errors
  }
}

export interface CLIStatus {
  available: boolean;
  version?: string;
  path?: string;
  method?: "direct" | "npx";
  error?: string;
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

export interface CheckCLIOptions {
  allowNpxFallback?: boolean;
  useCache?: boolean;
  directTimeoutMs?: number;
  npxTimeoutMs?: number;
}

interface CachedCLIStatus {
  path: string;
  method: "direct" | "npx";
  version?: string;
  checkedAt: string;
}

const DEFAULT_CHECK_OPTIONS: Required<CheckCLIOptions> = {
  allowNpxFallback: true,
  useCache: true,
  directTimeoutMs: 3000,
  npxTimeoutMs: 60000,
};

function getVersionCommand(command: string): string {
  if (command.startsWith("npx ")) {
    return `${command} --version`;
  }
  if (command.includes(" ")) {
    return `"${command}" --version`;
  }
  return `${command} --version`;
}

function readCachedCLIStatus(): CachedCLIStatus | null {
  if (!existsSync(CLI_CACHE_FILE)) return null;

  try {
    const raw = readFileSync(CLI_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CachedCLIStatus>;

    if (
      typeof parsed.path !== "string" ||
      (parsed.method !== "direct" && parsed.method !== "npx")
    ) {
      return null;
    }

    return {
      path: parsed.path,
      method: parsed.method,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      checkedAt:
        typeof parsed.checkedAt === "string"
          ? parsed.checkedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeCachedCLIStatus(status: CLIStatus): void {
  if (!status.available || !status.path || !status.method) {
    return;
  }

  const cached: CachedCLIStatus = {
    path: status.path,
    method: status.method,
    version: status.version,
    checkedAt: new Date().toISOString(),
  };

  try {
    if (!existsSync(CLI_CACHE_DIR)) {
      mkdirSync(CLI_CACHE_DIR, { recursive: true });
    }
    writeFileSync(CLI_CACHE_FILE, JSON.stringify(cached, null, 2));
    debugLog(`Cached CLI command: ${cached.path} (${cached.method})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    debugLog(`Failed to cache CLI command: ${errMsg}`);
  }
}

async function probeCommand(
  command: string,
  method: "direct" | "npx",
  timeoutMs: number,
  source: "cache" | "probe"
): Promise<CLIStatus | null> {
  try {
    const versionCommand = getVersionCommand(command);
    debugLog(
      `Trying ${source} ${method} command: ${versionCommand} (timeout: ${timeoutMs}ms)`
    );
    const { stdout, stderr } = await execAsync(versionCommand, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    const version = stdout.trim();
    debugLog(`${source} ${method} command SUCCESS: ${version}`);
    if (stderr) debugLog(`stderr: ${stderr}`);

    return {
      available: true,
      version,
      path: command,
      method,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    debugLog(`${source} ${method} command FAILED: ${errMsg}`);
    return null;
  }
}

/**
 * Return the last known-good CLI command without probing.
 * Used to keep app startup fast.
 */
export function getCachedCLICommand(): string | null {
  const cached = readCachedCLIStatus();
  return cached?.path || null;
}

/**
 * Check if Claude Code CLI is available.
 * Tries direct 'claude' command first, then falls back to npx.
 */
export async function checkClaudeCLI(
  options: CheckCLIOptions = {}
): Promise<CLIStatus> {
  const resolved = { ...DEFAULT_CHECK_OPTIONS, ...options };
  debugLog("=== checkClaudeCLI START ===");
  debugLog(`Options: ${JSON.stringify(resolved)}`);
  debugLog(`Platform: ${process.platform}`);
  debugLog(`PATH: ${process.env.PATH}`);
  debugLog(`APPDATA: ${process.env.APPDATA}`);
  debugLog(`LOCALAPPDATA: ${process.env.LOCALAPPDATA}`);

  // Try cached command first (fast path)
  if (resolved.useCache) {
    const cached = readCachedCLIStatus();
    if (cached) {
      if (cached.method === "npx" && !resolved.allowNpxFallback) {
        debugLog(
          "Skipping cached npx command because npx fallback is disabled for this check"
        );
      } else {
        const cacheTimeoutMs =
          cached.method === "npx" ? resolved.npxTimeoutMs : resolved.directTimeoutMs;
        const cachedStatus = await probeCommand(
          cached.path,
          cached.method,
          cacheTimeoutMs,
          "cache"
        );
        if (cachedStatus) {
          writeCachedCLIStatus(cachedStatus);
          return cachedStatus;
        }
      }
    }
  }

  const directStatus = await probeCommand(
    "claude",
    "direct",
    resolved.directTimeoutMs,
    "probe"
  );
  if (directStatus) {
    writeCachedCLIStatus(directStatus);
    return directStatus;
  }

  if (!resolved.allowNpxFallback) {
    debugLog("Skipping npx fallback per check options");
    debugLog("=== checkClaudeCLI END (not available) ===");
    return {
      available: false,
      error: "Claude Code CLI not found via direct command.",
    };
  }

  // Try npx as fallback (works if npm/node are installed)
  const npxStatus = await probeCommand(
    "npx @anthropic-ai/claude-code",
    "npx",
    resolved.npxTimeoutMs,
    "probe"
  );
  if (npxStatus) {
    writeCachedCLIStatus(npxStatus);
    return npxStatus;
  }

  debugLog("=== checkClaudeCLI END (not available) ===");
  return {
    available: false,
    error:
      "Claude Code CLI not found. npm/node may not be installed or not in PATH.",
  };
}

/**
 * Install Claude Code CLI globally via npm.
 * Returns success status and any error message.
 */
export async function installClaudeCLI(
  onProgress: (message: string) => void
): Promise<InstallResult> {
  onProgress("Installing Claude Code CLI globally...");

  try {
    // Run npm install -g with extended timeout
    // On Windows, we need to use cmd.exe to ensure PATH is properly resolved
    const installCommand =
      process.platform === "win32"
        ? 'cmd.exe /c "npm install -g @anthropic-ai/claude-code"'
        : "npm install -g @anthropic-ai/claude-code";

    await execAsync(installCommand, {
      timeout: 180000, // 3 minutes - npm can be slow
      windowsHide: true,
    });

    onProgress("Verifying installation...");

    // Give it a moment for PATH to potentially update
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify it works
    const status = await checkClaudeCLI();
    if (status.available) {
      onProgress(`Installation successful! Using ${status.method} method.`);
      return { success: true };
    } else {
      return {
        success: false,
        error:
          "Installation completed but CLI not accessible. You may need to restart the app for PATH changes to take effect.",
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check for common error conditions
    if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
      return {
        success: false,
        error:
          "npm is not installed or not in PATH. Please install Node.js first from https://nodejs.org",
      };
    }

    if (errorMessage.includes("EACCES") || errorMessage.includes("permission")) {
      return {
        success: false,
        error:
          "Permission denied. On macOS/Linux, you may need to run: sudo npm install -g @anthropic-ai/claude-code",
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get the working CLI command (either 'claude' or 'npx @anthropic-ai/claude-code').
 * Returns null if neither method works.
 */
export async function getWorkingCLICommand(
  options: CheckCLIOptions = {}
): Promise<string | null> {
  const status = await checkClaudeCLI(options);
  return status.available ? status.path || null : null;
}

/**
 * Check if npm is available (required for installation).
 */
export async function checkNpmAvailable(): Promise<boolean> {
  try {
    await execAsync("npm --version", {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
