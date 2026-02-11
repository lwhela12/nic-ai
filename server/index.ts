// CRITICAL: Must be first import - forces web runtime for Anthropic SDK
// This fixes "getDefaultAgent is not a function" error in Bun bundled builds
import "./shim";

// Load .env file explicitly - Bun auto-loads from CWD, but we need to handle
// cases where the server is run from different directories
import { existsSync, readFileSync } from "fs";
import { join, join as pathJoin, dirname as pathDirname } from "path";
import { fileURLToPath as fileURLToPathUtil } from "url";

const __envFilename = fileURLToPathUtil(import.meta.url);
const __envDirname = pathDirname(__envFilename);

// Try multiple locations for .env file
const envPaths = [
  pathJoin(__envDirname, ".env"),           // server/.env
  pathJoin(__envDirname, "..", ".env"),     // repo root/.env
  ".env",                                    // CWD/.env
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=");
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
    console.log(`[env] Loaded from ${envPath}`);
    break;
  }
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import claude from "./routes/claude";
import files from "./routes/files";
import docs from "./routes/docs";
import firm from "./routes/firm";
import knowledge from "./routes/knowledge";
import auth from "./routes/auth";
import team from "./routes/team";
import notes from "./routes/notes";
import { authMiddleware } from "./middleware/auth";

// Reuse the dirname from env loading
const __filename = __envFilename;
const __dirname = __envDirname;

const app = new Hono();

// Determine paths - support Electron bundled resources
const frontendDistPath = process.env.ELECTRON_FRONTEND_PATH || join(__dirname, "..", "app", "dist");
const isProduction = existsSync(frontendDistPath);

// Enable CORS for frontend (needed in dev mode)
app.use("/*", cors());

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", service: "claude-pi" }));

// Auth routes (no middleware)
app.route("/api/auth", auth);

// Apply auth middleware to protected routes
app.use("/api/claude/*", authMiddleware);
app.use("/api/files/*", authMiddleware);
app.use("/api/docs/*", authMiddleware);
app.use("/api/firm/*", authMiddleware);
app.use("/api/knowledge/*", authMiddleware);
app.use("/api/team", authMiddleware);
app.use("/api/team/*", authMiddleware);
app.use("/api/notes/*", authMiddleware);

// Mount protected routes
app.route("/api/claude", claude);
app.route("/api/files", files);
app.route("/api/docs", docs);
app.route("/api/firm", firm);
app.route("/api/knowledge", knowledge);
app.route("/api/team", team);
app.route("/api/notes", notes);

// In production, serve static frontend
if (isProduction) {
  // Serve static assets
  app.use("/*", serveStatic({ root: frontendDistPath }));

  // SPA fallback - serve index.html for all non-API routes
  app.get("*", async (c) => {
    const indexPath = join(frontendDistPath, "index.html");
    if (existsSync(indexPath)) {
      const file = Bun.file(indexPath);
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    }
    return c.notFound();
  });
}

const port = process.env.PORT || 3001;
console.log(`Server running on http://localhost:${port}`);
if (isProduction) {
  console.log("Serving frontend from:", frontendDistPath);
}

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // Max timeout for long-running Claude requests
};
