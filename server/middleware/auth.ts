import type { Context, Next } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Electron production sets ELECTRON_FRONTEND_PATH - if present, always production
// Dev mode is ONLY for running server directly with `bun run`
const IS_ELECTRON = !!process.env.ELECTRON_FRONTEND_PATH;
const DEV_MODE = !IS_ELECTRON &&
  (process.env.DEV_MODE === "true" || process.env.NODE_ENV !== "production");

// Log auth mode at startup
console.log(`[auth] Mode: ${DEV_MODE ? "DEV (auth bypassed)" : "PRODUCTION"}`);

// Config file location
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Subscription server URL
const SUBSCRIPTION_SERVER =
  process.env.CLAUDE_PI_SERVER || "https://api.claude-pi.com";

// 24 hours in milliseconds
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
// 48 hour grace period
const OFFLINE_GRACE_PERIOD = 48 * 60 * 60 * 1000;

interface Config {
  authToken?: string;
  email?: string;
  anthropicApiKey?: string;
  lastValidated?: string;
  subscriptionStatus?: string;
  expiresAt?: string;
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
): Promise<{ anthropicApiKey: string; subscriptionStatus: string; expiresAt: string } | null> {
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
 * Auth middleware - validates subscription and injects API key
 */
export async function authMiddleware(c: Context, next: Next) {
  // In dev mode, skip subscription validation but still load API key from config if needed
  if (DEV_MODE) {
    if (!process.env.ANTHROPIC_API_KEY) {
      const config = loadConfig();
      if (config?.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
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
        message: "Please log in to use Claude PI",
      },
      401
    );
  }

  // Check subscription status
  if (config.subscriptionStatus === "canceled" || config.subscriptionStatus === "expired") {
    return c.json(
      {
        error: "subscription_expired",
        message: "Your subscription has expired. Please renew to continue.",
      },
      403
    );
  }

  // Check if validation is needed
  if (needsValidation(config)) {
    const validation = await validateSubscription(config.authToken);

    if (validation) {
      // Update cached config
      cachedConfig = {
        ...config,
        anthropicApiKey: validation.anthropicApiKey,
        lastValidated: new Date().toISOString(),
        subscriptionStatus: validation.subscriptionStatus,
        expiresAt: validation.expiresAt,
      };

      // Note: We don't write to file here - that's handled by the CLI
      // Just update the env so the API key is available
      process.env.ANTHROPIC_API_KEY = validation.anthropicApiKey;
    } else {
      // Validation failed - check grace period
      if (!isWithinGracePeriod(config)) {
        return c.json(
          {
            error: "validation_failed",
            message: "Could not validate subscription. Please check your internet connection.",
          },
          503
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

  // Final check - if no API key is available, fail the request
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error: "api_key_missing",
        message: "No API key available. Please log in again to refresh your session.",
      },
      503
    );
  }

  return next();
}
