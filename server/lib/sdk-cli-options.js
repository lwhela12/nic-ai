"use strict";
/**
 * SDK CLI Options Helper
 *
 * Provides the correct CLI configuration for the Claude Agent SDK
 * based on whether we're using direct `claude` command or npx.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSDKCliOptions = getSDKCliOptions;
exports.isNpxMode = isNpxMode;
exports.getCliCommand = getCliCommand;
var child_process_1 = require("child_process");
/**
 * Get the SDK options for CLI execution.
 * Returns either pathToClaudeCodeExecutable or spawnClaudeCodeProcess
 * depending on the detected CLI mode.
 *
 * NOTE: Environment variables are read at call time, not module load time,
 * because they may be set after the module is imported.
 */
function getSDKCliOptions() {
    var _a;
    // Read env vars at call time (not module load time)
    var claudeCliCommand = process.env.CLAUDE_CLI_COMMAND;
    var claudeCodeCliPath = process.env.CLAUDE_CODE_CLI_PATH;
    var useNpxMode = (_a = claudeCliCommand === null || claudeCliCommand === void 0 ? void 0 : claudeCliCommand.includes("npx")) !== null && _a !== void 0 ? _a : false;
    // If we have a CLI path set, use it directly
    if (claudeCodeCliPath) {
        return {
            pathToClaudeCodeExecutable: claudeCodeCliPath,
        };
    }
    // For npx mode, spawn npx with the package
    if (useNpxMode) {
        return {
            spawnClaudeCodeProcess: function (options) {
                return (0, child_process_1.spawn)("npx", __spreadArray(["@anthropic-ai/claude-code"], options.args, true), {
                    cwd: options.cwd,
                    env: options.env,
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
            spawnClaudeCodeProcess: function (options) {
                var _a, _b;
                var fs = require('fs');
                var os = require('os');
                var path = require('path');
                var logFile = path.join(os.tmpdir(), 'claude-pi-spawn.log');
                var log = function (msg) {
                    try {
                        fs.appendFileSync(logFile, "[".concat(new Date().toISOString(), "] ").concat(msg, "\n"));
                    }
                    catch (_a) { }
                };
                // Build environment: start with SDK env, overlay process.env critical vars
                var mergedEnv = __assign(__assign({}, options.env), { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, PATH: process.env.PATH, HOME: process.env.HOME || process.env.USERPROFILE, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA });
                // Filter out SDK's internal CLI path and problematic args
                // The SDK passes its bundled cli.js as first arg, but we're using global 'claude'
                // Also filter out --setting-sources with empty value which corrupts arg parsing
                var filteredArgs = [];
                for (var i = 0; i < options.args.length; i++) {
                    var arg = options.args[i];
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
                log("=== SPAWN START ===");
                log("Command: claude");
                log("Original Args: ".concat(JSON.stringify(options.args)));
                log("Filtered Args: ".concat(JSON.stringify(filteredArgs)));
                log("CWD: ".concat(options.cwd));
                log("API Key present: ".concat(mergedEnv.ANTHROPIC_API_KEY ? 'YES' : 'NO'));
                log("PATH: ".concat((_a = mergedEnv.PATH) === null || _a === void 0 ? void 0 : _a.substring(0, 100), "..."));
                var child = (0, child_process_1.spawn)("claude", filteredArgs, {
                    cwd: options.cwd,
                    env: mergedEnv,
                    stdio: ["pipe", "pipe", "pipe"],
                    shell: process.platform === "win32",
                });
                (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', function (data) {
                    log("STDERR: ".concat(data.toString()));
                });
                child.on('error', function (err) {
                    log("ERROR: ".concat(err.message));
                });
                child.on('exit', function (code, signal) {
                    log("EXIT: code=".concat(code, ", signal=").concat(signal));
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
function isNpxMode() {
    var _a;
    var claudeCliCommand = process.env.CLAUDE_CLI_COMMAND;
    return (_a = claudeCliCommand === null || claudeCliCommand === void 0 ? void 0 : claudeCliCommand.includes("npx")) !== null && _a !== void 0 ? _a : false;
}
/**
 * Get the CLI command being used (for logging/debugging)
 */
function getCliCommand() {
    return process.env.CLAUDE_CLI_COMMAND;
}
