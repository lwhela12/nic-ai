import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { mkdirSync, existsSync } from "fs";
import auth from "./routes/auth";
import subscriptions from "./routes/subscriptions";
import admin from "./routes/admin";
import { initDatabase } from "./db/schema";

// Ensure data directory exists
const dataDir = "./data";
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log("Created data directory");
}

// Initialize database
const dbPath = process.env.DATABASE_PATH || "./data/claude-pi.db";
console.log(`Initializing database at: ${dbPath}`);
initDatabase(dbPath);

const app = new Hono();

// Middleware
app.use("/*", cors());
app.use("/*", logger());

// Health check
app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "claude-pi-subscription-server",
    version: "0.1.0",
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  })
);

// API routes
app.route("/v1/auth", auth);
app.route("/v1/subscriptions", subscriptions);
app.route("/v1/admin", admin);

// 404 handler
app.notFound((c) =>
  c.json({ error: "Not found" }, 404)
);

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = parseInt(process.env.PORT || "3002");
console.log(`\nSubscription server running on http://localhost:${port}`);
console.log("\nEnvironment:");
console.log(`  - Database: ${dbPath}`);
console.log(`  - Stripe: ${process.env.STRIPE_SECRET_KEY ? "configured" : "not configured"}`);
console.log(`  - Admin key: ${process.env.ADMIN_API_KEY ? "custom" : "default (insecure)"}`);

export default {
  port,
  fetch: app.fetch,
};
