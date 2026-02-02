/**
 * SDK CLI Options Helper
 *
 * Provides the correct CLI configuration for the Claude Agent SDK
 * based on whether we're using direct `claude` command or npx.
 */

import { spawn, type ChildProcess } from "child_process";

// CLI configuration from environment
const claudeCliCommand = process.env.CLAUDE_CLI_COMMAND;
const claudeCodeCliPath = process.env.CLAUDE_CODE_CLI_PATH;

// Determine if we're using npx mode
const useNpxMode = claudeCliCommand?.includes("npx") ?? false;

/**
 * Get the SDK options for CLI execution.
 * Returns either pathToClaudeCodeExecutable or spawnClaudeCodeProcess
 * depending on the detected CLI mode.
 */
export function getSDKCliOptions(): {
  pathToClaudeCodeExecutable?: string;
  spawnClaudeCodeProcess?: (args: string[]) => ChildProcess;
} {
  if (useNpxMode) {
    // Use custom spawn function for npx mode
    return {
      spawnClaudeCodeProcess: (args: string[]) => {
        return spawn("npx", ["@anthropic-ai/claude-code", ...args], {
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          // On Windows, we need shell: true for npx to work properly
          shell: process.platform === "win32",
        });
      },
    };
  }

  // Direct mode - use path if available, otherwise let SDK find it
  return {
    pathToClaudeCodeExecutable: claudeCodeCliPath || undefined,
  };
}

/**
 * Check if we're running in npx mode (for logging/debugging)
 */
export function isNpxMode(): boolean {
  return useNpxMode;
}

/**
 * Get the CLI command being used (for logging/debugging)
 */
export function getCliCommand(): string | undefined {
  return claudeCliCommand;
}
