import type { Context, Next } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Electron production sets ELECTRON_FRONTEND_PATH - if present, always production
// Dev mode is ONLY for running server directly with `bun run`
const IS_ELECTRON = !!process.env.ELECTRON_FRONTEND_PATH;
// IMPORTANT: require explicit opt-in via DEV_MODE=true.
const DEV_MODE = !IS_ELECTRON && process.env.DEV_MODE === "true";

// Log auth mode at startup
console.log(`[auth] Mode: ${DEV_MODE ? "DEV (auth bypassed)" : "PRODUCTION"}`);

// Config file location
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Subscription server URL
const SUBSCRIPTION_SERVER =
  process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";

// 24 hours in milliseconds
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
// 48 hour grace period
const OFFLINE_GRACE_PERIOD = 48 * 60 * 60 * 1000;

interface Config {
  authToken?: string;
  email?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
  lastValidated?: string;
  subscriptionStatus?: string;
  expiresAt?: string;
  accountType?: "root" | "sub_user";
}

/**
 * Load config from file
 */
function loadConfig(): Config | null {
  // Check if config was passed via env (from CLI)
  if (process.env.CLAUDE_PI_CONFIG) {
    try {
      return JSON.parse(process.env.CLAUDE_PI_CONFIG);
    } catch {
      // Fall through to file-based config
    }
  }

  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Check if validation is needed (more than 24 hours since last validation)
 */
function needsValidation(config: Config): boolean {
  if (!config.lastValidated) return true;
  const lastValidated = new Date(config.lastValidated).getTime();
  const now = Date.now();
  return now - lastValidated > VALIDATION_INTERVAL;
}

/**
 * Check if within offline grace period
 */
function isWithinGracePeriod(config: Config): boolean {
  if (!config.lastValidated) return false;
  const lastValidated = new Date(config.lastValidated).getTime();
  const now = Date.now();
  return now - lastValidated < OFFLINE_GRACE_PERIOD;
}

/**
 * Validate subscription with remote server
 */
async function validateSubscription(
  authToken: string
): Promise<{ anthropicApiKey: string | null; groqApiKey: string | null; subscriptionStatus: string; expiresAt: string } | null> {
  const url = `${SUBSCRIPTION_SERVER}/v1/auth/validate`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

// Cache for validated config to avoid repeated file reads
let cachedConfig: Config | null = null;
let lastConfigCheck = 0;
const CONFIG_CACHE_DURATION = 60 * 1000; // 1 minute

/**
 * Invalidate the cached config so the next request re-reads from disk.
 * Call this after login/logout/signup to avoid stale auth state.
 */
export function invalidateAuthCache() {
  cachedConfig = null;
  lastConfigCheck = 0;
}

/**
 * Auth middleware - validates subscription and injects API key
 */
export async function authMiddleware(c: Context, next: Next) {
  // In dev mode, skip subscription validation but still load API key from config if needed
  if (DEV_MODE) {
    const config = loadConfig();
    if (!config || !config.authToken) {
      return c.json(
        {
          error: "authentication_required",
          reauthRequired: true,
          message: "Please log in to use Claude PI",
        },
        401
      );
    }
    c.set("authEmail", config.email || null);
    if (!process.env.ANTHROPIC_API_KEY) {
      if (config?.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
      }
    }
    if (!process.env.GROQ_API_KEY) {
      if (config?.groqApiKey) {
        process.env.GROQ_API_KEY = config.groqApiKey;
      }
    }
    return next();
  }

  // Load config (with caching)
  const now = Date.now();
  if (!cachedConfig || now - lastConfigCheck > CONFIG_CACHE_DURATION) {
    cachedConfig = loadConfig();
    lastConfigCheck = now;
  }

  const config = cachedConfig;

  // No config or auth token
  if (!config || !config.authToken) {
    return c.json(
      {
        error: "authentication_required",
        reauthRequired: true,
        message: "Please log in to use Claude PI",
      },
      401
    );
  }

  c.set("authEmail", config.email || null);

  // Check subscription status
  if (config.subscriptionStatus === "canceled" || config.subscriptionStatus === "expired") {
    return c.json(
      {
        error: "subscription_expired",
        reauthRequired: true,
        message: "Your subscription has expired. Please renew to continue.",
      },
      403
    );
  }

  // Check if validation is needed
  const isSubUser = config.accountType === "sub_user";
  if (isSubUser || needsValidation(config)) {
    const validation = await validateSubscription(config.authToken);

    if (validation) {
      // Update cached config
      cachedConfig = {
        ...config,
        anthropicApiKey: validation.anthropicApiKey,
        groqApiKey: validation.groqApiKey,
        lastValidated: new Date().toISOString(),
        subscriptionStatus: validation.subscriptionStatus,
        expiresAt: validation.expiresAt,
      };

      // Note: We don't write to file here - that's handled by the CLI
      // Just update the env so the API key is available
      if (validation.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = validation.anthropicApiKey;
      }
      if (validation.groqApiKey) {
        process.env.GROQ_API_KEY = validation.groqApiKey;
      }
    } else {
      // Sub-users require fresh root-backed validation to continue.
      if (isSubUser) {
        return c.json(
          {
            error: "reauth_required",
            reauthRequired: true,
            message: "Session validation failed. Please sign in again.",
          },
          401
        );
      }
      // Validation failed - check grace period
      if (!isWithinGracePeriod(config)) {
        return c.json(
          {
            error: "reauth_required",
            reauthRequired: true,
            message: "Session validation expired. Please sign in again.",
          },
          401
        );
      }
      // Within grace period - allow request but add warning header
      c.header("X-Claude-PI-Warning", "offline-mode");
    }
  }

  // Ensure API key is set
  if (config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }
  if (config.groqApiKey && !process.env.GROQ_API_KEY) {
    process.env.GROQ_API_KEY = config.groqApiKey;
  }

  // Final check - if no API key is available, fail the request
  const hasAnthropicApiKey = !!process.env.ANTHROPIC_API_KEY || !!config.anthropicApiKey;
  const hasGroqApiKey = !!process.env.GROQ_API_KEY || !!config.groqApiKey;
  if (!hasAnthropicApiKey || !hasGroqApiKey) {
    return c.json(
      {
        error: "reauth_required",
        reauthRequired: true,
        message: "No API key available. Please sign in again.",
      },
      401
    );
  }

  return next();
}
