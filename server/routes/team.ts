import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  createTeamInvite,
  listTeamForUser,
  revokeInvite,
  type TeamRole,
  updateMemberRole,
} from "../lib/team";

const app = new Hono();
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SUBSCRIPTION_SERVER = process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";

function loadAuthToken(): string | null {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as { authToken?: string };
    return typeof parsed.authToken === "string" && parsed.authToken ? parsed.authToken : null;
  } catch {
    return null;
  }
}

async function createRemoteSubUserInvite(inviteEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authToken = loadAuthToken();
  if (!authToken) return { ok: false, error: "root_auth_required" };
  try {
    const response = await fetch(`${SUBSCRIPTION_SERVER}/v1/account/invite-subuser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ email: inviteEmail }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || "remote_invite_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "remote_invite_unreachable" };
  }
}

function getAuthEmail(c: any): string | null {
  const email = c.get("authEmail");
  return typeof email === "string" && email.trim() ? email : null;
}

const VALID_ROLES: TeamRole[] = [
  "attorney",
  "case_manager_lead",
  "case_manager",
  "case_manager_assistant",
];

app.get("/", async (c) => {
  const root = c.req.query("root");
  const email = getAuthEmail(c);

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }
  if (!email) {
    return c.json({ error: "authentication_required" }, 401);
  }

  const result = await listTeamForUser(root, email);
  if (!result.ok) {
    return c.json({
      configured: !!result.team && result.team.members.length > 0,
      team: result.team,
      context: null,
      error: result.error,
    });
  }

  const canManageTeam = !!result.context?.permissions.canManageTeam;
  const team = result.team!;

  return c.json({
    configured: team.members.length > 0,
    context: result.context,
    team: {
      version: team.version,
      members: team.members,
      invites: canManageTeam
        ? team.invites
        : team.invites.filter((invite) => invite.email === email),
      updatedAt: team.updatedAt,
      createdAt: team.createdAt,
    },
  });
});

app.post("/invite", async (c) => {
  const email = getAuthEmail(c);
  if (!email) {
    return c.json({ error: "authentication_required" }, 401);
  }

  const body = await c.req.json();
  const { root, inviteEmail, role } = body as {
    root?: string;
    inviteEmail?: string;
    role?: TeamRole;
  };

  if (!root || !inviteEmail || !role) {
    return c.json({ error: "root, inviteEmail, and role are required" }, 400);
  }
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: "invalid_role" }, 400);
  }

  const remoteInvite = await createRemoteSubUserInvite(inviteEmail.toLowerCase());
  if (!remoteInvite.ok) {
    return c.json({ error: remoteInvite.error }, 403);
  }

  const result = await createTeamInvite(root, email, inviteEmail, role);
  if (!result.ok) {
    return c.json({ error: result.error }, 403);
  }

  return c.json({ success: true, invite: result.invite });
});

app.delete("/invite/:id", async (c) => {
  const root = c.req.query("root");
  const inviteId = c.req.param("id");
  const email = getAuthEmail(c);

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }
  if (!inviteId) {
    return c.json({ error: "invite id required" }, 400);
  }
  if (!email) {
    return c.json({ error: "authentication_required" }, 401);
  }

  const result = await revokeInvite(root, email, inviteId);
  if (!result.ok) {
    return c.json({ error: result.error }, 403);
  }

  return c.json({ success: true });
});

app.put("/member/:id/role", async (c) => {
  const memberId = c.req.param("id");
  const email = getAuthEmail(c);
  if (!email) {
    return c.json({ error: "authentication_required" }, 401);
  }

  const body = await c.req.json();
  const { root, role } = body as { root?: string; role?: TeamRole };

  if (!root || !memberId || !role) {
    return c.json({ error: "root and role are required" }, 400);
  }
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: "invalid_role" }, 400);
  }

  const result = await updateMemberRole(root, email, memberId, role);
  if (!result.ok) {
    return c.json({ error: result.error }, 403);
  }

  return c.json({ success: true });
});

export default app;
