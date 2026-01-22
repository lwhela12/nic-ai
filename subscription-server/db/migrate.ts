import { mkdirSync, existsSync } from "fs";
import { initDatabase, SCHEMA_VERSION } from "./schema";

// Ensure data directory exists
const dataDir = "./data";
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log("Created data directory");
}

// Initialize database
const dbPath = process.env.DATABASE_PATH || "./data/claude-pi.db";
console.log(`Initializing database at: ${dbPath}`);

const db = initDatabase(dbPath);

// Check schema version
const versionResult = db.query("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | null;
const currentVersion = versionResult?.version || 0;

console.log(`Current schema version: ${currentVersion}`);
console.log(`Target schema version: ${SCHEMA_VERSION}`);

if (currentVersion < SCHEMA_VERSION) {
  console.log("Running migrations...");
  // Add migration logic here as schema evolves
  // For now, just update the version
  db.run("UPDATE schema_version SET version = ?", [SCHEMA_VERSION]);
  console.log(`Migrated to version ${SCHEMA_VERSION}`);
} else {
  console.log("Database is up to date");
}

// Show table info
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
console.log("\nTables:");
tables.forEach(t => console.log(`  - ${t.name}`));

db.close();
console.log("\nMigration complete!");
