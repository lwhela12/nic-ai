import { sql } from "@vercel/postgres";
import { initDatabase } from "./schema";
import type { User, Subscription, AuthToken, ApiKey } from "./schema";

// Ensure tables exist (called once on cold start)
let initialized = false;
export async function ensureDatabase(): Promise<void> {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
}

// User operations
export async function createUser(email: string, passwordHash: string): Promise<User | null> {
  try {
    const { rows } = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email.toLowerCase()}, ${passwordHash})
      RETURNING *
    `;
    return rows[0] as User || null;
  } catch {
    return null;
  }
}

export async function getUserById(id: number): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] as User || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
  return rows[0] as User || null;
}

// Subscription operations
export async function createSubscription(userId: number, trialDays: number = 14): Promise<Subscription | null> {
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    await sql`
      INSERT INTO subscriptions (user_id, status, trial_ends_at, current_period_end)
      VALUES (${userId}, 'trialing', ${trialEndsAt}, ${trialEndsAt})
    `;
    return getSubscriptionByUserId(userId);
  } catch {
    return null;
  }
}

export async function getSubscriptionByUserId(userId: number): Promise<Subscription | null> {
  const { rows } = await sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`;
  return rows[0] as Subscription || null;
}

export async function getSubscriptionByStripeCustomerId(customerId: string): Promise<Subscription | null> {
  const { rows } = await sql`SELECT * FROM subscriptions WHERE stripe_customer_id = ${customerId}`;
  return rows[0] as Subscription || null;
}

export async function updateSubscription(
  userId: number,
  updates: Partial<Omit<Subscription, "id" | "user_id" | "created_at">>
): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) return false;

  values.push(userId);
  fields.push("updated_at = NOW()");

  const query = `UPDATE subscriptions SET ${fields.join(", ")} WHERE user_id = $${values.length}`;
  const result = await sql.query(query, values);
  return (result.rowCount ?? 0) > 0;
}

// Auth token operations
export async function createAuthToken(userId: number, tokenHash: string, expiresInDays: number = 30): Promise<AuthToken | null> {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { rows } = await sql`
      INSERT INTO auth_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt})
      RETURNING *
    `;
    return rows[0] as AuthToken || null;
  } catch {
    return null;
  }
}

export async function getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
  const { rows } = await sql`
    SELECT * FROM auth_tokens WHERE token_hash = ${tokenHash} AND expires_at > NOW()
  `;
  return rows[0] as AuthToken || null;
}

export async function updateTokenLastUsed(tokenId: number): Promise<void> {
  await sql`UPDATE auth_tokens SET last_used_at = NOW() WHERE id = ${tokenId}`;
}

export async function deleteExpiredTokens(): Promise<number> {
  const result = await sql`DELETE FROM auth_tokens WHERE expires_at <= NOW()`;
  return result.rowCount ?? 0;
}

export async function deleteUserTokens(userId: number): Promise<number> {
  const result = await sql`DELETE FROM auth_tokens WHERE user_id = ${userId}`;
  return result.rowCount ?? 0;
}

// API key pool operations
export async function addApiKey(encryptedKey: string, keyName?: string): Promise<ApiKey | null> {
  try {
    const { rows } = await sql`
      INSERT INTO api_key_pool (key_encrypted, key_name)
      VALUES (${encryptedKey}, ${keyName || null})
      RETURNING *
    `;
    return rows[0] as ApiKey || null;
  } catch {
    return null;
  }
}

export async function getAvailableApiKey(): Promise<ApiKey | null> {
  const { rows } = await sql`
    SELECT * FROM api_key_pool
    WHERE is_active = TRUE
    ORDER BY assigned_to_user_id IS NULL DESC, daily_usage_tokens ASC
    LIMIT 1
  `;
  return rows[0] as ApiKey || null;
}

export async function getApiKeyForUser(userId: number): Promise<ApiKey | null> {
  const { rows } = await sql`
    SELECT * FROM api_key_pool WHERE assigned_to_user_id = ${userId} AND is_active = TRUE
  `;
  if (rows[0]) return rows[0] as ApiKey;
  return getAvailableApiKey();
}

export async function assignApiKeyToUser(keyId: number, userId: number): Promise<boolean> {
  const result = await sql`
    UPDATE api_key_pool SET assigned_to_user_id = ${userId} WHERE id = ${keyId}
  `;
  return (result.rowCount ?? 0) > 0;
}

export async function incrementApiKeyUsage(keyId: number, tokens: number): Promise<void> {
  await sql`
    UPDATE api_key_pool SET daily_usage_tokens = daily_usage_tokens + ${tokens} WHERE id = ${keyId}
  `;
}

export async function resetDailyUsage(): Promise<number> {
  const result = await sql`
    UPDATE api_key_pool SET daily_usage_tokens = 0, last_usage_reset = NOW()
  `;
  return result.rowCount ?? 0;
}

// Daily validation logging
export async function logValidation(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  success: boolean = true
): Promise<void> {
  await sql`
    INSERT INTO daily_validations (user_id, ip_address, user_agent, success)
    VALUES (${userId}, ${ipAddress || null}, ${userAgent || null}, ${success})
  `;
}

// Usage logging
export async function logUsage(
  userId: number,
  tokensUsed: number,
  apiKeyId?: number,
  requestType?: string
): Promise<void> {
  await sql`
    INSERT INTO usage_logs (user_id, api_key_id, tokens_used, request_type)
    VALUES (${userId}, ${apiKeyId || null}, ${tokensUsed}, ${requestType || null})
  `;
}

// Check subscription status
export function isSubscriptionActive(subscription: Subscription): boolean {
  if (subscription.status === "active") return true;

  if (subscription.status === "trialing") {
    const trialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
    return trialEnd ? trialEnd > new Date() : false;
  }

  return false;
}

// Get subscription expiry date
export function getSubscriptionExpiry(subscription: Subscription): string | null {
  if (subscription.status === "trialing") {
    return subscription.trial_ends_at;
  }
  return subscription.current_period_end;
}

// Re-export types
export type { User, Subscription, AuthToken, ApiKey } from "./schema";
