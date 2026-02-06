import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import {
  createTeamInvite,
  loadTeamState,
  requireTeamContext,
  saveTeamState,
  type TeamState,
} from "../lib/team";
import { acquireCaseLock, getActiveCaseLock, releaseCaseLock } from "../lib/case-lock";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

function seedTeam(email: string, role: "attorney" | "case_manager_lead" | "case_manager" | "case_manager_assistant" = "attorney"): TeamState {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [
      {
        id: "seed-user-1",
        email,
        role,
        status: "active",
        joinedAt: new Date().toISOString(),
      },
    ],
    invites: [],
  };
}

describe("auth/team/scope/lock integration", () => {
  it("requires an invite when team is configured", async () => {
    process.env.DEV_MODE = "false";
    process.env.CLAUDE_PI_AUTO_BOOTSTRAP = "false";
    process.env.CLAUDE_PI_APPROVED_FOUNDERS = "";

    const firmRoot = await makeTempDir("claude-pi-firm-");
    await saveTeamState(firmRoot, seedTeam("owner@firm.com", "attorney"));

    const result = await requireTeamContext(firmRoot, "newuser@firm.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invite_required");
  });

  it("accepts pending invite on first successful resolution", async () => {
    process.env.DEV_MODE = "false";
    process.env.CLAUDE_PI_AUTO_BOOTSTRAP = "false";
    process.env.CLAUDE_PI_APPROVED_FOUNDERS = "";

    const firmRoot = await makeTempDir("claude-pi-firm-");
    await saveTeamState(firmRoot, seedTeam("owner@firm.com", "attorney"));

    const inviteResult = await createTeamInvite(
      firmRoot,
      "owner@firm.com",
      "cm1@firm.com",
      "case_manager"
    );
    expect(inviteResult.ok).toBe(true);
    if (!inviteResult.ok) return;

    const context = await requireTeamContext(firmRoot, "cm1@firm.com");
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.context.role).toBe("case_manager");

    const team = await loadTeamState(firmRoot);
    const accepted = team.invites.find((invite) => invite.email === "cm1@firm.com");
    expect(accepted?.status).toBe("accepted");
  });

  it("blocks auth login when email has no active invite for configured firm", async () => {
    process.env.DEV_MODE = "true";
    process.env.NODE_ENV = "development";
    process.env.CLAUDE_PI_AUTO_BOOTSTRAP = "false";
    process.env.CLAUDE_PI_APPROVED_FOUNDERS = "";

    const firmRoot = await makeTempDir("claude-pi-firm-");
    const configDir = await makeTempDir("claude-pi-config-");
    process.env.CLAUDE_PI_CONFIG_DIR = configDir;

    await saveTeamState(firmRoot, seedTeam("owner@firm.com", "attorney"));

    const { default: authRoute } = await import(`../routes/auth.ts?case=${Date.now()}`);
    const app = new Hono();
    app.route("/api/auth", authRoute);

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "notinvited@firm.com",
        password: "test-password",
        firmRoot,
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("invite_required");
  });

  it("rejects member-scoped firm chat with invalid member id", async () => {
    process.env.DEV_MODE = "false";
    process.env.CLAUDE_PI_AUTO_BOOTSTRAP = "false";
    process.env.CLAUDE_PI_APPROVED_FOUNDERS = "";

    const firmRoot = await makeTempDir("claude-pi-firm-");
    await saveTeamState(firmRoot, seedTeam("lead@firm.com", "case_manager_lead"));

    const { default: firmRoute } = await import(`../routes/firm.ts?case=${Date.now()}`);
    const app = new Hono();
    app.use("/api/firm/*", async (c, next) => {
      c.set("authEmail", "lead@firm.com");
      await next();
    });
    app.route("/api/firm", firmRoute);

    const res = await app.request("/api/firm/direct-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: firmRoot,
        message: "Tell me about this view",
        history: [],
        scope: { mode: "member", memberId: "missing-member-id" },
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("invalid_member_scope");
  });

  it("enforces exclusive case write locks by owner", async () => {
    const caseFolder = await makeTempDir("claude-pi-case-");

    const first = await acquireCaseLock(caseFolder, "user:a", "User A");
    expect(first.acquired).toBe(true);

    const second = await acquireCaseLock(caseFolder, "user:b", "User B");
    expect(second.acquired).toBe(false);
    expect(second.lock?.owner).toBe("user:a");

    await releaseCaseLock(caseFolder, "user:b");
    const stillLocked = await getActiveCaseLock(caseFolder);
    expect(stillLocked?.owner).toBe("user:a");

    await releaseCaseLock(caseFolder, "user:a");
    const cleared = await getActiveCaseLock(caseFolder);
    expect(cleared).toBeNull();
  });
});
