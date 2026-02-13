import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { randomUUID } from "crypto";

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function seedTeam(
  email: string,
  role: "attorney" | "case_manager_lead" | "case_manager" | "case_manager_assistant" = "attorney"
) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [{ id: randomUUID(), email, role, status: "active", joinedAt: new Date().toISOString() }],
    invites: [],
  } as any;
}

(async () => {
  process.env.DEV_MODE = "true";
  process.env.NODE_ENV = "development";
  process.env.CLAUDE_PI_AUTO_BOOTSTRAP = "false";
  process.env.CLAUDE_PI_APPROVED_FOUNDERS = "";

  const { saveTeamState } = await import("./lib/team.ts");
  const authRoute = (await import(`./routes/auth.ts?case=${Date.now()}`)).default;
  const firmRoute = (await import(`./routes/firm.ts?case=${Date.now()}`)).default;

  const firmRoot = await tmp("claude-pi-firm-");
  await saveTeamState(firmRoot, seedTeam("owner@firm.com", "attorney"));
  const configDir = await tmp("claude-pi-config-");
  process.env.CLAUDE_PI_CONFIG_DIR = configDir;

  const authApp = new Hono();
  authApp.route("/api/auth", authRoute);

  const login = await authApp.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "notinvited@firm.com",
      password: "test-password",
      firmRoot,
    }),
  });

  console.log("AUTH status", login.status);
  console.log("AUTH body", await login.text());

  const firmApp = new Hono();
  firmApp.use("/api/firm/*", async (c, next) => {
    c.set("authEmail", "lead@firm.com");
    await next();
  });
  firmApp.route("/api/firm", firmRoute);

  const direct = await firmApp.request("/api/firm/direct-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      root: firmRoot,
      message: "Tell me about this view",
      history: [],
      scope: { mode: "member", memberId: "missing-member-id" },
    }),
  });

  console.log("DIRECT status", direct.status);
  console.log("DIRECT body", await direct.text());
})();
