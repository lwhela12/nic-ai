import { initDatabase, SCHEMA_VERSION } from "./schema";
import { sql } from "@vercel/postgres";

async function migrate() {
  console.log("Initializing database tables...");
  await initDatabase();

  // Check schema version
  const { rows } = await sql`SELECT version FROM schema_version LIMIT 1`;
  const currentVersion = rows[0]?.version || 0;

  console.log(`Current schema version: ${currentVersion}`);
  console.log(`Target schema version: ${SCHEMA_VERSION}`);

  if (currentVersion < SCHEMA_VERSION) {
    console.log("Running migrations...");
    // Add migration logic here as schema evolves
    await sql`UPDATE schema_version SET version = ${SCHEMA_VERSION}`;
    console.log(`Migrated to version ${SCHEMA_VERSION}`);
  } else {
    console.log("Database is up to date");
  }

  // Show table info
  const { rows: tables } = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  console.log("\nTables:");
  tables.forEach((t: any) => console.log(`  - ${t.tablename}`));

  console.log("\nMigration complete!");
}

migrate().catch(console.error);
