import { Database } from "bun:sqlite";

// Database schema version for migrations
export const SCHEMA_VERSION = 1;

// Initialize database and create tables
export function initDatabase(dbPath: string = "./data/claude-pi.db"): Database {
  const db = new Database(dbPath, { create: true });

  // Enable foreign keys
  db.run("PRAGMA foreign_keys = ON");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'trialing',
      trial_ends_at TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      canceled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_key_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_encrypted TEXT NOT NULL,
      key_name TEXT,
      is_active INTEGER DEFAULT 1,
      assigned_to_user_id INTEGER,
      daily_usage_tokens INTEGER DEFAULT 0,
      last_usage_reset TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      validated_at TEXT DEFAULT (datetime('now')),
      ip_address TEXT,
      user_agent TEXT,
      success INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      api_key_id INTEGER,
      tokens_used INTEGER NOT NULL,
      request_type TEXT,
      logged_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_key_pool(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  // Insert schema version if not exists
  const versionResult = db.query("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | null;
  if (!versionResult) {
    db.run("INSERT INTO schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
  }

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  db.run("CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash)");
  db.run("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_api_key_pool_active ON api_key_pool(is_active)");
  db.run("CREATE INDEX IF NOT EXISTS idx_daily_validations_user ON daily_validations(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id)");

  return db;
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
  is_active: number;
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
  success: number;
}

export interface UsageLog {
  id: number;
  user_id: number;
  api_key_id: number | null;
  tokens_used: number;
  request_type: string | null;
  logged_at: string;
}
