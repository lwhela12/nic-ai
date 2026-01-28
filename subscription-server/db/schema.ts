import { sql } from "@vercel/postgres";

// Database schema version for migrations
export const SCHEMA_VERSION = 1;

// Initialize database tables
export async function initDatabase(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'trialing',
      trial_ends_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS api_key_pool (
      id SERIAL PRIMARY KEY,
      key_encrypted TEXT NOT NULL,
      key_name TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      daily_usage_tokens INTEGER DEFAULT 0,
      last_usage_reset TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS daily_validations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      validated_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT,
      success BOOLEAN DEFAULT TRUE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_key_id INTEGER REFERENCES api_key_pool(id) ON DELETE SET NULL,
      tokens_used INTEGER NOT NULL,
      request_type TEXT,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `;

  // Insert schema version if not exists
  const { rows } = await sql`SELECT version FROM schema_version LIMIT 1`;
  if (rows.length === 0) {
    await sql`INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`;
  }

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_key_pool_active ON api_key_pool(is_active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_daily_validations_user ON daily_validations(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id)`;
}

// Type definitions for database records
export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: number;
  user_id: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: "trialing" | "active" | "canceled" | "past_due" | "unpaid" | "expired";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKey {
  id: number;
  key_encrypted: string;
  key_name: string | null;
  is_active: boolean;
  assigned_to_user_id: number | null;
  daily_usage_tokens: number;
  last_usage_reset: string;
  created_at: string;
}

export interface DailyValidation {
  id: number;
  user_id: number;
  validated_at: string;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
}

export interface UsageLog {
  id: number;
  user_id: number;
  api_key_id: number | null;
  tokens_used: number;
  request_type: string | null;
  logged_at: string;
}
