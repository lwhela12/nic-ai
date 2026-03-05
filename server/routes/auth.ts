import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { google } from "googleapis";
import {
  bootstrapTeamFounder,
  ensureTeamMember,
  requireTeamContext,
  type TeamRole,
} from "../lib/team";
import { invalidateAuthCache } from "../middleware/auth";
import { setVfsProvider } from "../lib/vfs";
import { GDriveProvider } from "../lib/vfs/gdrive-provider";
import { LocalFileSystemProvider } from "../lib/vfs/local-provider";

const auth = new Hono();

// Config file location
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Subscription server URL
const SUBSCRIPTION_SERVER =
  process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";

// Validate daily; allow up to 48 hours of offline grace for root users.
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
const OFFLINE_GRACE_PERIOD = 48 * 60 * 60 * 1000;

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
  groqApiKey?: string;
  lastValidated?: string;
  subscriptionStatus?: string;
  expiresAt?: string;
  accountType?: "root" | "sub_user";
  ownerEmail?: string | null;
  maxLicenses?: number;
  // Google Drive Integration
  gdriveTokens?: any;
  gdriveRootFolderId?: string;
  vfsMode?: "local" | "gdrive";
}

async function validateFirmAccess(
  firmRoot: string | undefined,
  email: string,
  options?: { bootstrapIfMissing?: boolean; autoProvision?: boolean; provisionRole?: TeamRole }
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
  if (
    options?.autoProvision &&
    (teamResult.reason === "firm_not_bootstrapped" || teamResult.reason === "invite_required")
  ) {
    await ensureTeamMember(firmRoot, email, options.provisionRole || "member");
    return { ok: true };
  }
  return { ok: false, reason: teamResult.reason };
}

/**
 * Load config from file
 */
function loadConfig(): Config | null {
  // CLI launch can inject a pre-validated config here.
  if (process.env.CLAUDE_PI_CONFIG) {
    try {
      return JSON.parse(process.env.CLAUDE_PI_CONFIG);
    } catch {
      // Fall back to disk config
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
 * Save config to file
 */
function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  process.env.CLAUDE_PI_CONFIG = JSON.stringify(config);
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
  try {
    const response = await fetch(`${SUBSCRIPTION_SERVER}/v1/auth/validate`, {
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
      const teamAccess = await validateFirmAccess(firmRoot, email, {
        bootstrapIfMissing: true,
        autoProvision: true,
        provisionRole: config.accountType === "sub_user" ? "member" : "owner",
      });
      const teamResult = await requireTeamContext(firmRoot, email);
      if (!teamAccess.ok || !teamResult.ok) {
        teamAllowed = false;
        teamPayload = {
          team: null,
          teamConfigured: teamResult.ok ? true : teamResult.team.members.length > 0,
          teamError: teamAccess.ok ? (teamResult.ok ? null : teamResult.reason) : teamAccess.reason,
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
      reauthRequired: true,
      error: "authentication_required",
    });
  }

  let effectiveConfig: Config = { ...config };
  let reauthRequired = false;
  let authError: string | undefined;
  const isSubUser = effectiveConfig.accountType === "sub_user";

  if (isSubUser || needsValidation(effectiveConfig)) {
    const validation = await validateSubscription(effectiveConfig.authToken);
    if (validation) {
      effectiveConfig = {
        ...effectiveConfig,
        anthropicApiKey:
          validation.anthropicApiKey ?? effectiveConfig.anthropicApiKey,
        groqApiKey: validation.groqApiKey ?? effectiveConfig.groqApiKey,
        lastValidated: new Date().toISOString(),
        subscriptionStatus: validation.subscriptionStatus,
        expiresAt: validation.expiresAt,
      };

      // Persist fresh validation so UI and middleware stay in sync.
      saveConfig(effectiveConfig);
      if (validation.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = validation.anthropicApiKey;
      }
      if (validation.groqApiKey) {
        process.env.GROQ_API_KEY = validation.groqApiKey;
      }
    } else if (isSubUser || !isWithinGracePeriod(effectiveConfig)) {
      reauthRequired = true;
      authError = "reauth_required";
    }
  }

  const isSubscriptionActive =
    effectiveConfig.subscriptionStatus === "active" ||
    effectiveConfig.subscriptionStatus === "trialing";

  if (!isSubscriptionActive && !reauthRequired) {
    authError = "subscription_expired";
  }

  if (!process.env.ANTHROPIC_API_KEY && effectiveConfig.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = effectiveConfig.anthropicApiKey;
  }
  if (!process.env.GROQ_API_KEY && effectiveConfig.groqApiKey) {
    process.env.GROQ_API_KEY = effectiveConfig.groqApiKey;
  }
  const hasAnthropicApiKey =
    !!process.env.ANTHROPIC_API_KEY || !!effectiveConfig.anthropicApiKey;
  const hasGroqApiKey =
    !!process.env.GROQ_API_KEY || !!effectiveConfig.groqApiKey;
  const hasRequiredApiKeys = hasAnthropicApiKey && hasGroqApiKey;

  // Keep status endpoint aligned with auth middleware behavior.
  if (!hasRequiredApiKeys && !reauthRequired && isSubscriptionActive) {
    reauthRequired = true;
    authError = "reauth_required";
  }

  let teamPayload: Record<string, unknown> = {};
  let teamAllowed = true;
  if (!reauthRequired && isSubscriptionActive && firmRoot && effectiveConfig.email) {
    const teamAccess = await validateFirmAccess(firmRoot, effectiveConfig.email, {
      bootstrapIfMissing: true,
      autoProvision: true,
      provisionRole: effectiveConfig.accountType === "sub_user" ? "member" : "owner",
    });
    const teamResult = await requireTeamContext(firmRoot, effectiveConfig.email);
    if (!teamAccess.ok || !teamResult.ok) {
      teamAllowed = false;
      teamPayload = {
        team: null,
        teamConfigured: teamResult.ok ? true : teamResult.team.members.length > 0,
        teamError: teamAccess.ok ? (teamResult.ok ? null : teamResult.reason) : teamAccess.reason,
      };
    } else {
      teamPayload = {
        team: teamResult.context,
        teamConfigured: true,
      };
    }
  }

  return c.json({
    authenticated: !reauthRequired && isSubscriptionActive && teamAllowed,
    reauthRequired,
    error: authError,
    email: effectiveConfig.email,
    subscriptionStatus: effectiveConfig.subscriptionStatus,
    expiresAt: effectiveConfig.expiresAt,
    lastValidated: effectiveConfig.lastValidated,
    accountType: effectiveConfig.accountType || "root",
    ownerEmail: effectiveConfig.ownerEmail || null,
    maxLicenses: effectiveConfig.maxLicenses || 0,
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
      { bootstrapIfMissing: true, autoProvision: true, provisionRole: "owner" }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    const config: Config = {
      authToken: "dev_token_" + Date.now(),
      email,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
      groqApiKey: process.env.GROQ_API_KEY || "",
      lastValidated: new Date().toISOString(),
      subscriptionStatus: "active",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      accountType: "root",
      ownerEmail: null,
    };
    saveConfig(config);
    invalidateAuthCache();

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
      {
        bootstrapIfMissing: true,
        autoProvision: true,
        provisionRole: data.accountType === "sub_user" ? "member" : "owner",
      }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    // Save config locally
    const config: Config = {
      authToken: data.authToken,
      email: data.email,
      anthropicApiKey: data.anthropicApiKey,
      groqApiKey: data.groqApiKey,
      lastValidated: new Date().toISOString(),
      subscriptionStatus: data.subscriptionStatus,
      expiresAt: data.expiresAt,
      accountType: data.accountType || "root",
      ownerEmail: data.ownerEmail || null,
      maxLicenses: data.maxLicenses || 0,
    };
    saveConfig(config);
    invalidateAuthCache();

    // Set API key in env
    if (data.anthropicApiKey) {
      process.env.ANTHROPIC_API_KEY = data.anthropicApiKey;
    }
    if (data.groqApiKey) {
      process.env.GROQ_API_KEY = data.groqApiKey;
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
      { bootstrapIfMissing: true, autoProvision: true, provisionRole: "owner" }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    const config: Config = {
      authToken: "dev_token_" + Date.now(),
      email,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
      groqApiKey: process.env.GROQ_API_KEY || "",
      lastValidated: new Date().toISOString(),
      subscriptionStatus: "trialing",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      accountType: "root",
      ownerEmail: null,
    };
    saveConfig(config);
    invalidateAuthCache();

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
      {
        bootstrapIfMissing: true,
        autoProvision: true,
        provisionRole: data.accountType === "sub_user" ? "member" : "owner",
      }
    );
    if (!firmAccess.ok) {
      return c.json({ error: firmAccess.reason }, 403);
    }

    // Save config locally
    const config: Config = {
      authToken: data.authToken,
      email: data.email,
      anthropicApiKey: data.anthropicApiKey,
      groqApiKey: data.groqApiKey,
      lastValidated: new Date().toISOString(),
      subscriptionStatus: data.subscriptionStatus,
      expiresAt: data.expiresAt,
      accountType: data.accountType || "root",
      ownerEmail: data.ownerEmail || null,
      maxLicenses: data.maxLicenses || 0,
    };
    saveConfig(config);
    invalidateAuthCache();

    // Set API key in env
    if (data.anthropicApiKey) {
      process.env.ANTHROPIC_API_KEY = data.anthropicApiKey;
    }
    if (data.groqApiKey) {
      process.env.GROQ_API_KEY = data.groqApiKey;
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
    invalidateAuthCache();
  }

  // Clear env
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GROQ_API_KEY;

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

// ==========================================
// Google Drive OAuth & VFS Initialization
// ==========================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

function getGoogleRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const port = process.env.PORT || 3001;
  return `http://localhost:${port}/api/auth/gdrive/callback`;
}

export function getGoogleApiClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getGoogleRedirectUri()
  );
}

export function initVfs() {
  const config = loadConfig();
  if (config?.vfsMode === "gdrive" && config?.gdriveTokens && config?.gdriveRootFolderId) {
    try {
      const oauth2Client = getGoogleApiClient();
      oauth2Client.setCredentials(config.gdriveTokens);
      const gdriveProvider = new GDriveProvider(oauth2Client, config.gdriveRootFolderId);
      setVfsProvider(gdriveProvider);
      console.log("[VFS] Initialized Google Drive Provider");
    } catch (err) {
      console.error("[VFS] Failed to initialize Google Drive Provider, falling back to local:", err);
      setVfsProvider(new LocalFileSystemProvider());
    }
  } else {
    setVfsProvider(new LocalFileSystemProvider());
    console.log("[VFS] Initialized Local File System Provider");
  }
}

async function resolveGdriveRootFolderName(config: Config | null): Promise<string | null> {
  if (!config?.gdriveTokens || !config.gdriveRootFolderId) return null;
  try {
    const oauth2Client = getGoogleApiClient();
    oauth2Client.setCredentials(config.gdriveTokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const response = await drive.files.get({
      fileId: config.gdriveRootFolderId,
      fields: "name",
    });
    return response.data.name || null;
  } catch {
    return null;
  }
}

async function buildGdriveStatusPayload(config: Config | null) {
  return {
    connected: !!config?.gdriveTokens,
    vfsMode: config?.vfsMode || "local",
    rootFolderId: config?.gdriveRootFolderId || null,
    rootFolderName: await resolveGdriveRootFolderName(config),
  };
}

auth.get("/gdrive/url", (c) => {
  const oauth2Client = getGoogleApiClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return c.json({ url: authUrl });
});

auth.get("/gdrive/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ error: "Missing code parameter" }, 400);

  try {
    const oauth2Client = getGoogleApiClient();
    const { tokens } = await oauth2Client.getToken(code);

    const config = loadConfig() || {};
    config.gdriveTokens = tokens;
    // We do not set vfsMode to 'gdrive' yet until a root folder is selected
    saveConfig(config);

    // Redirect or return success for the frontend
    return c.html(`<script>window.close();</script>Successfully authenticated with Google Drive. You can close this tab.`);
  } catch (error) {
    console.error("[GDrive] Authentication failed", error);
    return c.json({ error: "Failed to authenticate with Google Drive" }, 500);
  }
});

auth.get("/gdrive/status", async (c) => {
  const config = loadConfig();
  return c.json(await buildGdriveStatusPayload(config));
});

auth.post("/vfs/mode", async (c) => {
  try {
    const body = await c.req.json();
    const mode = typeof body?.mode === "string" ? body.mode : "";
    if (mode !== "local" && mode !== "gdrive") {
      return c.json({ error: "mode must be 'local' or 'gdrive'" }, 400);
    }

    const config = loadConfig() || {};
    if (mode === "gdrive" && (!config.gdriveTokens || !config.gdriveRootFolderId)) {
      return c.json({ error: "Google Drive is not fully configured" }, 400);
    }

    config.vfsMode = mode;
    saveConfig(config);
    initVfs();

    return c.json({
      success: true,
      ...(await buildGdriveStatusPayload(config)),
    });
  } catch (error) {
    console.error("[VFS] Failed to switch mode", error);
    return c.json({ error: "Failed to switch VFS mode" }, 500);
  }
});

auth.post("/gdrive/disconnect", (c) => {
  const config = loadConfig();
  if (config) {
    delete config.gdriveTokens;
    delete config.gdriveRootFolderId;
    config.vfsMode = "local";
    saveConfig(config);
    setVfsProvider(new LocalFileSystemProvider());
  }
  return c.json({ success: true });
});

auth.post("/gdrive/set-root", async (c) => {
  const { rootFolderId } = await c.req.json();
  if (!rootFolderId) return c.json({ error: "rootFolderId is required" }, 400);

  const config = loadConfig();
  if (!config || !config.gdriveTokens) {
    return c.json({ error: "Not authenticated with Google Drive" }, 401);
  }

  config.gdriveRootFolderId = rootFolderId;
  config.vfsMode = "gdrive";
  saveConfig(config);

  // Re-initialize VFS
  initVfs();

  return c.json({ success: true, vfsMode: "gdrive", rootFolderId });
});

auth.get("/gdrive/browse", async (c) => {
  const parentId = c.req.query("dir") || "root";
  const config = loadConfig();
  if (!config || !config.gdriveTokens) {
    return c.json({ error: "Not authenticated with Google Drive" }, 401);
  }

  try {
    const oauth2Client = getGoogleApiClient();
    oauth2Client.setCredentials(config.gdriveTokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Get current folder info if not root
    let parentFolder = "root";
    if (parentId !== "root") {
      try {
        const currentObj = await drive.files.get({ fileId: parentId, fields: "id, name, parents" });
        if (currentObj.data.parents && currentObj.data.parents.length > 0) {
          parentFolder = currentObj.data.parents[0];
        }
      } catch {
        parentFolder = "root";
      }
    }

    let folders: { name: string, path: string }[] = [];

    if (parentId === "root") {
      // In root, we want both "My Drive" root folders AND folders shared with the user
      const [rootRes, sharedRes] = await Promise.all([
        drive.files.list({
          q: `'root' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
          fields: "files(id, name)",
          orderBy: "name",
          pageSize: 1000
        }),
        drive.files.list({
          q: `sharedWithMe = true and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
          fields: "files(id, name)",
          orderBy: "name",
          pageSize: 1000
        })
      ]);

      const combined = [
        ...(rootRes.data.files || []),
        ...(sharedRes.data.files || [])
      ];

      // Deduplicate by ID just in case
      const seen = new Set();
      const uniqueFiles = combined.filter(f => {
        if (!f.id || seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      folders = uniqueFiles.map(f => ({
        name: f.name || "Unknown",
        path: f.id as string
      }));

      // Re-sort alphabetically
      folders.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
        fields: "files(id, name)",
        orderBy: "name",
        pageSize: 1000
      });

      folders = (res.data.files || []).map(f => ({
        name: f.name || "Unknown",
        path: f.id as string
      }));
    }

    return c.json({
      current: parentId,
      parent: parentFolder,
      folders
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default auth;
