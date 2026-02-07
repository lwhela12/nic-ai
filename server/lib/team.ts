import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export type TeamRole =
  | "attorney"
  | "case_manager_lead"
  | "case_manager"
  | "case_manager_assistant";

export interface TeamMember {
  id: string;
  email: string;
  name?: string;
  role: TeamRole;
  status: "pending" | "active" | "deactivated";
  invitedAt?: string;
  joinedAt?: string;
  invitedBy?: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: TeamRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  invitedAt: string;
  expiresAt?: string;
  acceptedAt?: string;
}

export interface TeamState {
  version: number;
  createdAt: string;
  updatedAt: string;
  members: TeamMember[];
  invites: TeamInvite[];
}

export interface TeamPermissions {
  canManageTeam: boolean;
  canAssignCases: boolean;
  canViewAllCases: boolean;
  canEditKnowledge: boolean;
}

export interface TeamContext {
  userId: string;
  email: string;
  role: TeamRole;
  status: TeamMember["status"];
  permissions: TeamPermissions;
}

const TEAM_FILE = "team.json";
const TOOL_DIR = ".pi_tool";
const TEAM_VERSION = 1;
const INVITE_EXPIRY_DAYS = 30;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function getFoundersFromEnv(): string[] {
  const raw = process.env.CLAUDE_PI_APPROVED_FOUNDERS || "";
  return raw
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

function getTeamPath(firmRoot: string): string {
  return join(firmRoot, TOOL_DIR, TEAM_FILE);
}

function createEmptyTeam(): TeamState {
  const timestamp = nowIso();
  return {
    version: TEAM_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    members: [],
    invites: [],
  };
}

export function getPermissionsForRole(role: TeamRole): TeamPermissions {
  switch (role) {
    case "attorney":
      return {
        canManageTeam: true,
        canAssignCases: true,
        canViewAllCases: true,
        canEditKnowledge: true,
      };
    case "case_manager_lead":
      return {
        canManageTeam: false,
        canAssignCases: true,
        canViewAllCases: true,
        canEditKnowledge: false,
      };
    case "case_manager":
      return {
        canManageTeam: false,
        canAssignCases: false,
        canViewAllCases: true,
        canEditKnowledge: false,
      };
    case "case_manager_assistant":
      return {
        canManageTeam: false,
        canAssignCases: false,
        canViewAllCases: true,
        canEditKnowledge: false,
      };
    default:
      return {
        canManageTeam: false,
        canAssignCases: false,
        canViewAllCases: false,
        canEditKnowledge: false,
      };
  }
}

function toContext(member: TeamMember): TeamContext {
  return {
    userId: member.id,
    email: member.email,
    role: member.role,
    status: member.status,
    permissions: getPermissionsForRole(member.role),
  };
}

function normalizeTeamState(input: unknown): TeamState {
  if (!input || typeof input !== "object") {
    return createEmptyTeam();
  }
  const team = input as Partial<TeamState>;
  return {
    version: typeof team.version === "number" ? team.version : TEAM_VERSION,
    createdAt: typeof team.createdAt === "string" ? team.createdAt : nowIso(),
    updatedAt: typeof team.updatedAt === "string" ? team.updatedAt : nowIso(),
    members: Array.isArray(team.members)
      ? team.members.filter((m): m is TeamMember => !!m && typeof m.email === "string")
      : [],
    invites: Array.isArray(team.invites)
      ? team.invites.filter((i): i is TeamInvite => !!i && typeof i.email === "string")
      : [],
  };
}

export async function loadTeamState(firmRoot: string): Promise<TeamState> {
  const path = getTeamPath(firmRoot);
  if (!existsSync(path)) {
    return createEmptyTeam();
  }
  try {
    const raw = await readFile(path, "utf-8");
    return normalizeTeamState(JSON.parse(raw));
  } catch {
    return createEmptyTeam();
  }
}

export async function saveTeamState(firmRoot: string, team: TeamState): Promise<void> {
  const dir = join(firmRoot, TOOL_DIR);
  await mkdir(dir, { recursive: true });
  const next: TeamState = {
    ...team,
    version: TEAM_VERSION,
    updatedAt: nowIso(),
  };
  await writeFile(getTeamPath(firmRoot), JSON.stringify(next, null, 2), "utf-8");
}

function isInviteActive(invite: TeamInvite): boolean {
  if (invite.status !== "pending") return false;
  if (!invite.expiresAt) return true;
  return new Date(invite.expiresAt).getTime() > Date.now();
}

function expireStaleInvites(team: TeamState): TeamState {
  let changed = false;
  const invites = team.invites.map((invite) => {
    if (
      invite.status === "pending" &&
      invite.expiresAt &&
      new Date(invite.expiresAt).getTime() <= Date.now()
    ) {
      changed = true;
      return {
        ...invite,
        status: "expired" as const,
      };
    }
    return invite;
  });
  if (!changed) return team;
  return { ...team, invites };
}

function shouldAutoBootstrapFounder(team: TeamState, email: string): boolean {
  if (team.members.length > 0) return false;
  if (process.env.DEV_MODE === "true") return true;
  if (process.env.CLAUDE_PI_AUTO_BOOTSTRAP === "true") return true;
  const founders = getFoundersFromEnv();
  return founders.includes(email);
}

async function bootstrapFounderIfAllowed(
  firmRoot: string,
  team: TeamState,
  email: string
): Promise<TeamState> {
  if (!shouldAutoBootstrapFounder(team, email)) {
    return team;
  }
  const founder: TeamMember = {
    id: randomUUID(),
    email,
    role: "attorney",
    status: "active",
    joinedAt: nowIso(),
  };
  const next = {
    ...team,
    members: [founder],
  };
  await saveTeamState(firmRoot, next);
  return next;
}

function findActiveMember(team: TeamState, email: string): TeamMember | undefined {
  return team.members.find(
    (member) =>
      normalizeEmail(member.email) === email &&
      member.status === "active"
  );
}

function findPendingInvite(team: TeamState, email: string): TeamInvite | undefined {
  return team.invites.find(
    (invite) => normalizeEmail(invite.email) === email && isInviteActive(invite)
  );
}

export async function resolveTeamContext(
  firmRoot: string,
  rawEmail: string
): Promise<{ configured: boolean; team: TeamState; context?: TeamContext }> {
  const email = normalizeEmail(rawEmail);
  let team = await loadTeamState(firmRoot);
  team = expireStaleInvites(team);
  team = await bootstrapFounderIfAllowed(firmRoot, team, email);

  const member = findActiveMember(team, email);
  if (member) {
    return { configured: team.members.length > 0, team, context: toContext(member) };
  }

  const invite = findPendingInvite(team, email);
  if (!invite) {
    if (team.updatedAt !== (await loadTeamState(firmRoot)).updatedAt) {
      await saveTeamState(firmRoot, team);
    }
    return { configured: team.members.length > 0, team };
  }

  const acceptedMember: TeamMember = {
    id: randomUUID(),
    email,
    role: invite.role,
    status: "active",
    invitedAt: invite.invitedAt,
    invitedBy: invite.invitedBy,
    joinedAt: nowIso(),
  };

  const next: TeamState = {
    ...team,
    members: [...team.members, acceptedMember],
    invites: team.invites.map((i) =>
      i.id === invite.id
        ? {
            ...i,
            status: "accepted",
            acceptedAt: nowIso(),
          }
        : i
    ),
  };
  await saveTeamState(firmRoot, next);
  return { configured: true, team: next, context: toContext(acceptedMember) };
}

export async function requireTeamContext(
  firmRoot: string,
  rawEmail: string
): Promise<{ ok: true; team: TeamState; context: TeamContext } | { ok: false; reason: string; team: TeamState }> {
  const resolved = await resolveTeamContext(firmRoot, rawEmail);
  if (resolved.context) {
    return { ok: true, team: resolved.team, context: resolved.context };
  }
  if (!resolved.configured) {
    return {
      ok: false,
      reason: "firm_not_bootstrapped",
      team: resolved.team,
    };
  }
  return {
    ok: false,
    reason: "invite_required",
    team: resolved.team,
  };
}

function calculateInviteExpiry(): string {
  return new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function createTeamInvite(
  firmRoot: string,
  invitedByEmail: string,
  inviteEmail: string,
  role: TeamRole
): Promise<{ ok: true; invite: TeamInvite } | { ok: false; error: string }> {
  const inviterResult = await requireTeamContext(firmRoot, invitedByEmail);
  if (!inviterResult.ok) {
    return { ok: false, error: "not_authorized" };
  }
  if (!inviterResult.context.permissions.canManageTeam) {
    return { ok: false, error: "insufficient_permissions" };
  }

  const email = normalizeEmail(inviteEmail);
  const team = inviterResult.team;

  const existingMember = team.members.find(
    (m) => normalizeEmail(m.email) === email && m.status === "active"
  );
  if (existingMember) {
    return { ok: false, error: "already_member" };
  }

  const existingInvite = findPendingInvite(team, email);
  if (existingInvite) {
    return { ok: true, invite: existingInvite };
  }

  const invite: TeamInvite = {
    id: randomUUID(),
    email,
    role,
    status: "pending",
    invitedBy: normalizeEmail(invitedByEmail),
    invitedAt: nowIso(),
    expiresAt: calculateInviteExpiry(),
  };

  const next: TeamState = {
    ...team,
    invites: [...team.invites, invite],
  };
  await saveTeamState(firmRoot, next);

  return { ok: true, invite };
}

export async function revokeInvite(
  firmRoot: string,
  actorEmail: string,
  inviteId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actorResult = await requireTeamContext(firmRoot, actorEmail);
  if (!actorResult.ok || !actorResult.context.permissions.canManageTeam) {
    return { ok: false, error: "insufficient_permissions" };
  }

  const hasInvite = actorResult.team.invites.some((invite) => invite.id === inviteId);
  if (!hasInvite) {
    return { ok: false, error: "not_found" };
  }

  const next: TeamState = {
    ...actorResult.team,
    invites: actorResult.team.invites.map((invite) =>
      invite.id === inviteId ? { ...invite, status: "revoked" } : invite
    ),
  };
  await saveTeamState(firmRoot, next);
  return { ok: true };
}

export async function updateMemberRole(
  firmRoot: string,
  actorEmail: string,
  memberId: string,
  role: TeamRole
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actorResult = await requireTeamContext(firmRoot, actorEmail);
  if (!actorResult.ok || !actorResult.context.permissions.canManageTeam) {
    return { ok: false, error: "insufficient_permissions" };
  }

  const member = actorResult.team.members.find((m) => m.id === memberId);
  if (!member) {
    return { ok: false, error: "not_found" };
  }

  const next: TeamState = {
    ...actorResult.team,
    members: actorResult.team.members.map((m) =>
      m.id === memberId ? { ...m, role } : m
    ),
  };
  await saveTeamState(firmRoot, next);
  return { ok: true };
}

export async function listTeamForUser(firmRoot: string, actorEmail: string): Promise<{
  ok: boolean;
  error?: string;
  context?: TeamContext;
  team?: TeamState;
}> {
  const actorResult = await requireTeamContext(firmRoot, actorEmail);
  if (!actorResult.ok) {
    return { ok: false, error: actorResult.reason, team: actorResult.team };
  }
  return {
    ok: true,
    context: actorResult.context,
    team: actorResult.team,
  };
}

export async function ensureTeamMember(
  firmRoot: string,
  rawEmail: string,
  role: TeamRole
): Promise<{ team: TeamState; context: TeamContext }> {
  const email = normalizeEmail(rawEmail);
  let team = await loadTeamState(firmRoot);
  team = expireStaleInvites(team);

  const existing = findActiveMember(team, email);
  if (existing) {
    return { team, context: toContext(existing) };
  }

  const member: TeamMember = {
    id: randomUUID(),
    email,
    role,
    status: "active",
    joinedAt: nowIso(),
    invitedBy: "remote_sync",
  };

  const next: TeamState = {
    ...team,
    members: [...team.members, member],
  };
  await saveTeamState(firmRoot, next);

  return { team: next, context: toContext(member) };
}

export async function bootstrapTeamFounder(
  firmRoot: string,
  rawEmail: string
): Promise<
  | { ok: true; team: TeamState; context: TeamContext }
  | { ok: false; reason: "already_configured" }
> {
  const email = normalizeEmail(rawEmail);
  const team = await loadTeamState(firmRoot);

  const existingMember = findActiveMember(team, email);
  if (existingMember) {
    return { ok: true, team, context: toContext(existingMember) };
  }

  if (team.members.length > 0) {
    return { ok: false, reason: "already_configured" };
  }

  const founder: TeamMember = {
    id: randomUUID(),
    email,
    role: "attorney",
    status: "active",
    joinedAt: nowIso(),
  };

  const next: TeamState = {
    ...team,
    members: [founder],
  };
  await saveTeamState(firmRoot, next);
  return { ok: true, team: next, context: toContext(founder) };
}
