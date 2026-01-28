import { Hono } from "hono";
import { sql } from "@vercel/postgres";
import {
  addApiKey,
  resetDailyUsage,
  deleteExpiredTokens,
  ensureDatabase,
} from "../db";
import type { ApiKey } from "../db";

const admin = new Hono();

// Admin API key for managing the service
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "admin-secret-key";

// Simple encryption for API keys (use proper KMS in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-encryption-key-32bytes!!!!";

function encryptApiKey(key: string): string {
  const keyBuffer = Buffer.from(key);
  const encKeyBuffer = Buffer.from(ENCRYPTION_KEY);
  const encrypted = Buffer.alloc(keyBuffer.length);

  for (let i = 0; i < keyBuffer.length; i++) {
    encrypted[i] = keyBuffer[i] ^ encKeyBuffer[i % encKeyBuffer.length];
  }

  return encrypted.toString("base64");
}

// Middleware to check admin auth
async function adminAuth(c: any, next: any) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== ADMIN_API_KEY) {
    return c.json({ error: "Invalid admin key" }, 403);
  }

  return next();
}

// Apply admin auth to all routes
admin.use("/*", adminAuth);

/**
 * Add API key to pool
 */
admin.post("/api-keys", async (c) => {
  await ensureDatabase();
  const body = await c.req.json();
  const { key, name } = body;

  if (!key) {
    return c.json({ error: "API key is required" }, 400);
  }

  const encryptedKey = encryptApiKey(key);
  const apiKey = await addApiKey(encryptedKey, name);

  if (!apiKey) {
    return c.json({ error: "Failed to add API key" }, 500);
  }

  return c.json({
    id: apiKey.id,
    name: apiKey.key_name,
    isActive: apiKey.is_active,
    createdAt: apiKey.created_at,
  });
});

/**
 * List all API keys (without exposing actual keys)
 */
admin.get("/api-keys", async (c) => {
  await ensureDatabase();
  const { rows } = await sql`
    SELECT id, key_name, is_active, assigned_to_user_id, daily_usage_tokens,
           last_usage_reset, created_at
    FROM api_key_pool
    ORDER BY created_at DESC
  `;

  return c.json({
    keys: rows.map((k: any) => ({
      id: k.id,
      name: k.key_name,
      isActive: k.is_active,
      assignedToUserId: k.assigned_to_user_id,
      dailyUsageTokens: k.daily_usage_tokens,
      lastUsageReset: k.last_usage_reset,
      createdAt: k.created_at,
    })),
  });
});

/**
 * Toggle API key active status
 */
admin.patch("/api-keys/:id", async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.isActive !== undefined) {
    values.push(body.isActive);
    updates.push(`is_active = $${values.length}`);
  }

  if (body.name !== undefined) {
    values.push(body.name);
    updates.push(`key_name = $${values.length}`);
  }

  if (updates.length === 0) {
    return c.json({ error: "No updates provided" }, 400);
  }

  values.push(id);
  const query = `UPDATE api_key_pool SET ${updates.join(", ")} WHERE id = $${values.length}`;
  await sql.query(query, values);

  return c.json({ success: true });
});

/**
 * Delete API key
 */
admin.delete("/api-keys/:id", async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  await sql`DELETE FROM api_key_pool WHERE id = ${id}`;

  return c.json({ success: true });
});

/**
 * List all users with subscription info
 */
admin.get("/users", async (c) => {
  await ensureDatabase();
  const { rows } = await sql`
    SELECT u.id, u.email, u.created_at,
           s.status as subscription_status, s.trial_ends_at, s.current_period_end,
           s.stripe_customer_id, s.stripe_subscription_id
    FROM users u
    LEFT JOIN subscriptions s ON u.id = s.user_id
    ORDER BY u.created_at DESC
  `;

  return c.json({
    users: rows.map((u: any) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      subscriptionStatus: u.subscription_status || "none",
      trialEndsAt: u.trial_ends_at,
      currentPeriodEnd: u.current_period_end,
      stripeCustomerId: u.stripe_customer_id,
    })),
  });
});

/**
 * Get usage statistics
 */
admin.get("/stats", async (c) => {
  await ensureDatabase();

  const { rows: [userCount] } = await sql`SELECT COUNT(*) as count FROM users`;
  const { rows: [activeSubCount] } = await sql`
    SELECT COUNT(*) as count FROM subscriptions WHERE status IN ('active', 'trialing')
  `;
  const { rows: [apiKeyCount] } = await sql`
    SELECT COUNT(*) as count FROM api_key_pool WHERE is_active = TRUE
  `;
  const { rows: [validationsToday] } = await sql`
    SELECT COUNT(*) as count FROM daily_validations WHERE validated_at > NOW() - INTERVAL '1 day'
  `;

  return c.json({
    totalUsers: Number(userCount.count),
    activeSubscriptions: Number(activeSubCount.count),
    activeApiKeys: Number(apiKeyCount.count),
    validationsLast24h: Number(validationsToday.count),
  });
});

/**
 * Run maintenance tasks (cleanup tokens, reset usage)
 */
admin.post("/maintenance", async (c) => {
  await ensureDatabase();
  const body = await c.req.json().catch(() => ({}));
  const results: Record<string, any> = {};

  if (body.cleanupTokens !== false) {
    const deleted = await deleteExpiredTokens();
    results.expiredTokensDeleted = deleted;
  }

  if (body.resetDailyUsage) {
    const reset = await resetDailyUsage();
    results.apiKeysReset = reset;
  }

  return c.json({ success: true, results });
});

export default admin;
