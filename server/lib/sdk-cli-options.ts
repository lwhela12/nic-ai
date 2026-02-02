/**
 * SDK CLI Options Helper
 *
 * Provides the correct CLI configuration for the Claude Agent SDK
 * based on whether we're using direct `claude` command or npx.
 */

import { spawn, type ChildProcess } from "child_process";

/**
 * SpawnOptions interface matching the SDK's expected interface.
 * See sdk.d.ts lines 1565-1578
 */
interface SpawnOptions {
  /** Command to execute */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env: { [envVar: string]: string | undefined };
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

/**
 * Get the SDK options for CLI execution.
 * Returns either pathToClaudeCodeExecutable or spawnClaudeCodeProcess
 * depending on the detected CLI mode.
 *
 * NOTE: Environment variables are read at call time, not module load time,
 * because they may be set after the module is imported.
 */
export function getSDKCliOptions(): {
  pathToClaudeCodeExecutable?: string;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => ChildProcess;
} {
  // Read env vars at call time (not module load time)
  const claudeCliCommand = process.env.CLAUDE_CLI_COMMAND;
  const claudeCodeCliPath = process.env.CLAUDE_CODE_CLI_PATH;
  const useNpxMode = claudeCliCommand?.includes("npx") ?? false;

  // If we have a CLI path set, use it directly
  if (claudeCodeCliPath) {
    return {
      pathToClaudeCodeExecutable: claudeCodeCliPath,
    };
  }

  // For npx mode, spawn npx with the package
  if (useNpxMode) {
    return {
      spawnClaudeCodeProcess: (options: SpawnOptions) => {
        return spawn("npx", ["@anthropic-ai/claude-code", ...options.args], {
          cwd: options.cwd,
          env: options.env as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });
      },
    };
  }

  // For direct 'claude' command (global install), spawn it directly
  // This is needed because the SDK can't find the CLI when bundled with Bun
  if (claudeCliCommand === "claude") {
    return {
      spawnClaudeCodeProcess: (options: SpawnOptions) => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const logFile = path.join(os.tmpdir(), 'claude-pi-spawn.log');
        const log = (msg: string) => {
          try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
        };

        // Build environment: start with SDK env, overlay process.env critical vars
        const mergedEnv = {
          ...options.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          PATH: process.env.PATH,
          HOME: process.env.HOME || process.env.USERPROFILE,
          USERPROFILE: process.env.USERPROFILE,
          APPDATA: process.env.APPDATA,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
        } as NodeJS.ProcessEnv;

        // Filter out SDK's internal CLI path and problematic args
        // The SDK passes its bundled cli.js as first arg, but we're using global 'claude'
        // Also filter out --setting-sources with empty value which corrupts arg parsing
        const filteredArgs: string[] = [];
        for (let i = 0; i < options.args.length; i++) {
          const arg = options.args[i];
          // Skip first arg if it looks like a CLI path
          if (i === 0 && (arg.endsWith('cli.js') || arg.includes('~BUN') || arg.includes('BUN'))) {
            continue;
          }
          // Skip --setting-sources and its empty value (corrupts parsing)
          if (arg === '--setting-sources' && options.args[i + 1] === '') {
            i++; // Skip the empty value too
            continue;
          }
          filteredArgs.push(arg);
        }

        log(`=== SPAWN START ===`);
        log(`Command: claude`);
        log(`Original Args: ${JSON.stringify(options.args)}`);
        log(`Filtered Args: ${JSON.stringify(filteredArgs)}`);
        log(`CWD: ${options.cwd}`);
        log(`API Key present: ${mergedEnv.ANTHROPIC_API_KEY ? 'YES' : 'NO'}`);
        log(`PATH: ${mergedEnv.PATH?.substring(0, 100)}...`);

        const child = spawn("claude", filteredArgs, {
          cwd: options.cwd,
          env: mergedEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        child.stderr?.on('data', (data: Buffer) => {
          log(`STDERR: ${data.toString()}`);
        });

        child.on('error', (err: Error) => {
          log(`ERROR: ${err.message}`);
        });

        child.on('exit', (code: number | null, signal: string | null) => {
          log(`EXIT: code=${code}, signal=${signal}`);
        });

        return child;
      },
    };
  }

  // Fallback - let SDK try to find it (may not work in bundled binary)
  return {};
}

/**
 * Check if we're running in npx mode (for logging/debugging)
 */
export function isNpxMode(): boolean {
  const claudeCliCommand = process.env.CLAUDE_CLI_COMMAND;
  return claudeCliCommand?.includes("npx") ?? false;
}

/**
 * Get the CLI command being used (for logging/debugging)
 */
export function getCliCommand(): string | undefined {
  return process.env.CLAUDE_CLI_COMMAND;
}
