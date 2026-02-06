import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { bootstrapTeamFounder, requireTeamContext } from "../lib/team";

const auth = new Hono();

// Config file location
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Subscription server URL
const SUBSCRIPTION_SERVER =
  process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";

// Dev mode flag - must match middleware/auth.ts logic
// Electron sets ELECTRON_FRONTEND_PATH, so we're only in dev mode when running directly with bun
const IS_ELECTRON = !!process.env.ELECTRON_FRONTEND_PATH;
// IMPORTANT: require explicit opt-in via DEV_MODE=true.
// Running `npm run dev` should still hit remote auth when DEV_MODE is false.
const DEV_MODE = !IS_ELECTRON && process.env.DEV_MODE === "true";

interface Config {
  authToken?: string;
  email?: string;
  anthropicApiKey?: string;
  lastValidated?: string;
  subscriptionStatus?: string;
  expiresAt?: string;
  accountType?: "root" | "sub_user";
  ownerEmail?: string | null;
  maxLicenses?: number;
}

async function validateFirmAccess(
  firmRoot: string | undefined,
  email: string,
  options?: { bootstrapIfMissing?: boolean }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!firmRoot) return { ok: true };
  const teamResult = await requireTeamContext(firmRoot, email);
  if (teamResult.ok) return { ok: true };
  if (
    options?.bootstrapIfMissing &&
    teamResult.reason === "firm_not_bootstrapped"
  ) {
    const bootstrap = await bootstrapTeamFounder(firmRoot, email);
    if (bootstrap.ok) {
      return { ok: true };
    }
  }
  return { ok: false, reason: teamResult.reason };
}

/**
 * Load config from file
 */
function loadConfig(): Config | null {
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
 * Save config to file
 */
function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get current auth status
 */
auth.get("/status", async (c) => {
  const firmRoot = c.req.query("firmRoot");

  // In dev mode, use local config-backed auth (no remote validation)
  if (DEV_MODE) {
    const config = loadConfig();
    if (!config || !config.authToken) {
      return c.json({
        authenticated: false,
        devMode: true,
      });
    }

    const email = config.email || "dev@localhost";
    let teamPayload: Record<string, unknown> = {};
    let teamAllowed = true;
    if (firmRoot) {
      const teamResult = await requireTeamContext(firmRoot, email);
      if (!teamResult.ok) {
        teamAllowed = false;
        teamPayload = {
          team: null,
          teamConfigured: teamResult.team.members.length > 0,
          teamError: teamResult.reason,
        };
      } else {
        teamPayload = {
          team: teamResult.context,
          teamConfigured: true,
        };
      }
    }
    return c.json({
      authenticated: teamAllowed,
      devMode: true,
      email,
      subscriptionStatus: config.subscriptionStatus || "active",
      accountType: config.accountType || "root",
      ownerEmail: config.ownerEmail || null,
      maxLicenses: config.maxLicenses || 0,
      ...teamPayload,
    });
  }

  const config = loadConfig();

  if (!config || !config.authToken) {
    return c.json({
      authenticated: false,
    });
  }

  // Check if subscription is valid
  const isValid =
    config.subscriptionStatus === "active" ||
    config.subscriptionStatus === "trialing";

  let teamPayload: Record<string, unknown> = {};
  let teamAllowed = true;
  if (firmRoot && config.email) {
    const teamResult = await requireTeamContext(firmRoot, config.email);
    if (!teamResult.ok) {
      teamAllowed = false;
      teamPayload = {
        team: null,
        teamConfigured: teamResult.team.members.length > 0,
        teamError: teamResult.reason,
      };
    } else {
      teamPayload = {
        team: teamResult.context,
        teamConfigured: true,
      };
    }
  }

  return c.json({
    authenticated: isValid && teamAllowed,
    reauthRequired: !isValid,
    email: config.email,
    subscriptionStatus: config.subscriptionStatus,
    expiresAt: config.expiresAt,
    lastValidated: config.lastValidated,
    accountType: config.accountType || "root",
    ownerEmail: config.ownerEmail || null,
    maxLicenses: config.maxLicenses || 0,
    ...teamPayload,
  });
});

/**
 * Login with email and password
 */
auth.post("/login", async (c) => {
  const body = await c.req.json();
  const { email, password, firmRoot } = body;

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  // In dev mode, accept any credentials
  if (DEV_MODE) {
    const firmAccess = await validateFirmAccess(
      typeof firmRoot === "string" ? firmRoot : undefined,
      email,
      { bootstrapIfMissing: true }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    const config: Config = {
      authToken: "dev_token_" + Date.now(),
      email,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
      lastValidated: new Date().toISOString(),
      subscriptionStatus: "active",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      accountType: "root",
      ownerEmail: null,
    };
    saveConfig(config);

    return c.json({
      success: true,
      email: config.email,
      subscriptionStatus: config.subscriptionStatus,
    });
  }

  // Call subscription server
  try {
    const response = await fetch(`${SUBSCRIPTION_SERVER}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Login failed" }));
      return c.json(
        { error: error.error || error.message || "Invalid credentials" },
        response.status
      );
    }

    const data = await response.json();

    const firmAccess = await validateFirmAccess(
      typeof firmRoot === "string" ? firmRoot : undefined,
      data.email,
      { bootstrapIfMissing: true }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    // Save config locally
    const config: Config = {
      authToken: data.authToken,
      email: data.email,
      anthropicApiKey: data.anthropicApiKey,
      lastValidated: new Date().toISOString(),
      subscriptionStatus: data.subscriptionStatus,
      expiresAt: data.expiresAt,
      accountType: data.accountType || "root",
      ownerEmail: data.ownerEmail || null,
      maxLicenses: data.maxLicenses || 0,
    };
    saveConfig(config);

    // Set API key in env
    if (data.anthropicApiKey) {
      process.env.ANTHROPIC_API_KEY = data.anthropicApiKey;
    }

    return c.json({
      success: true,
      email: config.email,
      subscriptionStatus: config.subscriptionStatus,
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Could not connect to authentication server" }, 503);
  }
});

/**
 * Sign up for new account
 */
auth.post("/signup", async (c) => {
  const body = await c.req.json();
  const { email, password, firmRoot } = body;

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  // In dev mode, just create a local config
  if (DEV_MODE) {
    const firmAccess = await validateFirmAccess(
      typeof firmRoot === "string" ? firmRoot : undefined,
      email,
      { bootstrapIfMissing: true }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    const config: Config = {
      authToken: "dev_token_" + Date.now(),
      email,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
      lastValidated: new Date().toISOString(),
      subscriptionStatus: "trialing",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      accountType: "root",
      ownerEmail: null,
    };
    saveConfig(config);

    return c.json({
      success: true,
      email: config.email,
      subscriptionStatus: config.subscriptionStatus,
      message: "Account created with 14-day trial",
    });
  }

  // Call subscription server
  try {
    const response = await fetch(`${SUBSCRIPTION_SERVER}/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Signup failed" }));
      return c.json(
        { error: error.error || error.message || "Could not create account" },
        response.status
      );
    }

    const data = await response.json();

    const firmAccess = await validateFirmAccess(
      typeof firmRoot === "string" ? firmRoot : undefined,
      data.email,
      { bootstrapIfMissing: true }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    // Save config locally
    const config: Config = {
      authToken: data.authToken,
      email: data.email,
      anthropicApiKey: data.anthropicApiKey,
      lastValidated: new Date().toISOString(),
      subscriptionStatus: data.subscriptionStatus,
      expiresAt: data.expiresAt,
      accountType: data.accountType || "root",
      ownerEmail: data.ownerEmail || null,
      maxLicenses: data.maxLicenses || 0,
    };
    saveConfig(config);

    // Set API key in env
    if (data.anthropicApiKey) {
      process.env.ANTHROPIC_API_KEY = data.anthropicApiKey;
    }

    return c.json({
      success: true,
      email: config.email,
      subscriptionStatus: config.subscriptionStatus,
      message: "Account created with 14-day trial",
    });
  } catch (error) {
    console.error("Signup error:", error);
    return c.json({ error: "Could not connect to authentication server" }, 503);
  }
});

/**
 * Logout - clear local config
 */
auth.post("/logout", async (c) => {
  const config = loadConfig();

  if (config) {
    // Clear sensitive fields but keep some state
    const clearedConfig: Config = {
      email: config.email, // Keep email for convenience
    };
    saveConfig(clearedConfig);
  }

  // Clear env
  delete process.env.ANTHROPIC_API_KEY;

  return c.json({ success: true });
});

/**
 * Get subscription management URL (redirect to Stripe portal)
 */
auth.get("/subscription-portal", async (c) => {
  if (DEV_MODE) {
    return c.json({ url: "https://billing.stripe.com/test" });
  }

  const config = loadConfig();

  if (!config || !config.authToken) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const response = await fetch(
      `${SUBSCRIPTION_SERVER}/v1/subscriptions/portal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.authToken}`,
        },
      }
    );

    if (!response.ok) {
      return c.json({ error: "Could not get portal URL" }, 500);
    }

    const data = await response.json();
    return c.json({ url: data.url });
  } catch (error) {
    console.error("Portal error:", error);
    return c.json({ error: "Could not connect to subscription server" }, 503);
  }
});

export default auth;
