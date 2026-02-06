import { Hono } from "hono";
import {
  createTeamInvite,
  listTeamForUser,
  revokeInvite,
  type TeamRole,
  updateMemberRole,
} from "../lib/team";

const app = new Hono();

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
