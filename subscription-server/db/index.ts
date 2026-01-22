import { Database } from "bun:sqlite";
import { initDatabase } from "./schema";
import type { User, Subscription, AuthToken, ApiKey } from "./schema";

// Singleton database instance
let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || "./data/claude-pi.db";
    db = initDatabase(dbPath);
  }
  return db;
}

// User operations
export function createUser(email: string, passwordHash: string): User | null {
  const db = getDatabase();
  try {
    const result = db.run(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)",
      [email.toLowerCase(), passwordHash]
    );
    return getUserById(Number(result.lastInsertRowid));
  } catch (error) {
    // Likely duplicate email
    return null;
  }
}

export function getUserById(id: number): User | null {
  const db = getDatabase();
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}

export function getUserByEmail(email: string): User | null {
  const db = getDatabase();
  return db.query("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as User | null;
}

// Subscription operations
export function createSubscription(userId: number, trialDays: number = 14): Subscription | null {
  const db = getDatabase();
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = db.run(
      `INSERT INTO subscriptions (user_id, status, trial_ends_at, current_period_end)
       VALUES (?, 'trialing', ?, ?)`,
      [userId, trialEndsAt, trialEndsAt]
    );
    return getSubscriptionByUserId(userId);
  } catch (error) {
    return null;
  }
}

export function getSubscriptionByUserId(userId: number): Subscription | null {
  const db = getDatabase();
  return db.query("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as Subscription | null;
}

export function getSubscriptionByStripeCustomerId(customerId: string): Subscription | null {
  const db = getDatabase();
  return db.query("SELECT * FROM subscriptions WHERE stripe_customer_id = ?").get(customerId) as Subscription | null;
}

export function updateSubscription(
  userId: number,
  updates: Partial<Omit<Subscription, "id" | "user_id" | "created_at">>
): boolean {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now')");
  values.push(userId);

  const result = db.run(
    `UPDATE subscriptions SET ${fields.join(", ")} WHERE user_id = ?`,
    values
  );

  return result.changes > 0;
}

// Auth token operations
export function createAuthToken(userId: number, tokenHash: string, expiresInDays: number = 30): AuthToken | null {
  const db = getDatabase();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = db.run(
      "INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
      [userId, tokenHash, expiresAt]
    );
    return db.query("SELECT * FROM auth_tokens WHERE id = ?").get(Number(result.lastInsertRowid)) as AuthToken | null;
  } catch (error) {
    return null;
  }
}

export function getAuthTokenByHash(tokenHash: string): AuthToken | null {
  const db = getDatabase();
  return db.query(
    "SELECT * FROM auth_tokens WHERE token_hash = ? AND expires_at > datetime('now')"
  ).get(tokenHash) as AuthToken | null;
}

export function updateTokenLastUsed(tokenId: number): void {
  const db = getDatabase();
  db.run("UPDATE auth_tokens SET last_used_at = datetime('now') WHERE id = ?", [tokenId]);
}

export function deleteExpiredTokens(): number {
  const db = getDatabase();
  const result = db.run("DELETE FROM auth_tokens WHERE expires_at <= datetime('now')");
  return result.changes;
}

export function deleteUserTokens(userId: number): number {
  const db = getDatabase();
  const result = db.run("DELETE FROM auth_tokens WHERE user_id = ?", [userId]);
  return result.changes;
}

// API key pool operations
export function addApiKey(encryptedKey: string, keyName?: string): ApiKey | null {
  const db = getDatabase();
  try {
    const result = db.run(
      "INSERT INTO api_key_pool (key_encrypted, key_name) VALUES (?, ?)",
      [encryptedKey, keyName || null]
    );
    return db.query("SELECT * FROM api_key_pool WHERE id = ?").get(Number(result.lastInsertRowid)) as ApiKey | null;
  } catch (error) {
    return null;
  }
}

export function getAvailableApiKey(): ApiKey | null {
  const db = getDatabase();
  // Get an active key with the lowest usage, preferring unassigned keys
  return db.query(`
    SELECT * FROM api_key_pool
    WHERE is_active = 1
    ORDER BY assigned_to_user_id IS NULL DESC, daily_usage_tokens ASC
    LIMIT 1
  `).get() as ApiKey | null;
}

export function getApiKeyForUser(userId: number): ApiKey | null {
  const db = getDatabase();
  // First check if user has an assigned key
  const assigned = db.query(
    "SELECT * FROM api_key_pool WHERE assigned_to_user_id = ? AND is_active = 1"
  ).get(userId) as ApiKey | null;

  if (assigned) return assigned;

  // Otherwise get any available key
  return getAvailableApiKey();
}

export function assignApiKeyToUser(keyId: number, userId: number): boolean {
  const db = getDatabase();
  const result = db.run(
    "UPDATE api_key_pool SET assigned_to_user_id = ? WHERE id = ?",
    [userId, keyId]
  );
  return result.changes > 0;
}

export function incrementApiKeyUsage(keyId: number, tokens: number): void {
  const db = getDatabase();
  db.run(
    "UPDATE api_key_pool SET daily_usage_tokens = daily_usage_tokens + ? WHERE id = ?",
    [tokens, keyId]
  );
}

export function resetDailyUsage(): number {
  const db = getDatabase();
  const result = db.run(
    "UPDATE api_key_pool SET daily_usage_tokens = 0, last_usage_reset = datetime('now')"
  );
  return result.changes;
}

// Daily validation logging
export function logValidation(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  success: boolean = true
): void {
  const db = getDatabase();
  db.run(
    "INSERT INTO daily_validations (user_id, ip_address, user_agent, success) VALUES (?, ?, ?, ?)",
    [userId, ipAddress || null, userAgent || null, success ? 1 : 0]
  );
}

// Usage logging
export function logUsage(
  userId: number,
  tokensUsed: number,
  apiKeyId?: number,
  requestType?: string
): void {
  const db = getDatabase();
  db.run(
    "INSERT INTO usage_logs (user_id, api_key_id, tokens_used, request_type) VALUES (?, ?, ?, ?)",
    [userId, apiKeyId || null, tokensUsed, requestType || null]
  );
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
