import type { Context } from "hono";
import { requireTeamContext } from "./team";
import { migratePiTool } from "./migrate-pi-tool";
import { resolveFirmRoot } from "./year-mode";

interface AccessResultOk {
  ok: true;
  userEmail: string;
  team: Awaited<ReturnType<typeof requireTeamContext>> extends { ok: true; team: infer T } ? T : never;
  context: Awaited<ReturnType<typeof requireTeamContext>> extends { ok: true; context: infer C } ? C : never;
}

interface AccessResultDenied {
  ok: false;
  response: Response;
}

type AccessResult = AccessResultOk | AccessResultDenied;

function getAuthEmail(c: Context): string | null {
  const email = c.get("authEmail");
  return typeof email === "string" && email.trim() ? email : null;
}

function deny(c: Context, reason: string, status: number = 403): AccessResultDenied {
  return {
    ok: false,
    response: c.json(
      {
        error: "firm_access_denied",
        reason,
        message:
          reason === "invite_required"
            ? "Your email does not have an active invite for this firm."
            : "You are not authorized for this firm.",
      },
      status
    ) as unknown as Response,
  };
}

export async function requireFirmAccess(c: Context, firmRoot: string): Promise<AccessResult> {
  const userEmail = getAuthEmail(c);
  if (!userEmail) {
    return {
      ok: false,
      response: c.json({ error: "authentication_required" }, 401) as unknown as Response,
    };
  }

  const result = await requireTeamContext(firmRoot, userEmail);
  if (!result.ok) {
    return deny(c, result.reason);
  }

  return {
    ok: true,
    userEmail,
    team: result.team,
    context: result.context,
  };
}

export async function requireCaseAccess(c: Context, casePath: string): Promise<AccessResult> {
  await migratePiTool(casePath);
  const firmRoot = resolveFirmRoot(casePath);
  return requireFirmAccess(c, firmRoot);
}
