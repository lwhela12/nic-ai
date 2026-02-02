/**
 * Claude Code CLI Setup Utilities
 *
 * Handles first-run detection and installation of Claude Code CLI.
 * Required for the Claude Agent SDK to function.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

/**
 * Check if Claude Code CLI is available.
 * Tries direct 'claude' command first, then falls back to npx.
 */
export async function checkClaudeCLI(): Promise<CLIStatus> {
  // Try direct command first (faster if globally installed)
  try {
    const { stdout } = await execAsync("claude --version", {
      timeout: 10000,
      windowsHide: true,
    });
    return {
      available: true,
      version: stdout.trim(),
      path: "claude",
      method: "direct",
    };
  } catch {
    // Direct command failed, try npx
  }

  // Try npx as fallback (works if npm/node are installed)
  try {
    const { stdout } = await execAsync(
      "npx @anthropic-ai/claude-code --version",
      {
        timeout: 60000, // npx can be slow first time
        windowsHide: true,
      }
    );
    return {
      available: true,
      version: stdout.trim(),
      path: "npx @anthropic-ai/claude-code",
      method: "npx",
    };
  } catch (npxErr) {
    return {
      available: false,
      error:
        "Claude Code CLI not found. npm/node may not be installed or not in PATH.",
    };
  }
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
export async function getWorkingCLICommand(): Promise<string | null> {
  const status = await checkClaudeCLI();
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
