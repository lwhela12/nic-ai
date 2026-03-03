import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { Hono } from "hono";
import { saveTeamState, type TeamState } from "../lib/team";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function seedTeam(email: string): TeamState {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [
      {
        id: "seed-user-1",
        email,
        role: "attorney",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
    ],
    invites: [],
  };
}

async function createAuthedDocsApp(authEmail: string) {
  const { default: docsRoute } = await import(`../routes/docs.ts?docs-flow=${Date.now()}-${Math.random()}`);
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authEmail", authEmail);
    await next();
  });
  app.route("/", docsRoute);
  return app;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe.skip("docs front-matter DOCX flow", () => {
  it("preview-front-matter returns a preview URL and writes preview PDF", async () => {
    const authEmail = "lawyer@example.com";
    const firmRoot = await makeTempDir("claude-pi-firm-");
    const caseFolder = join(firmRoot, "Case A");
    await mkdir(caseFolder, { recursive: true });
    await saveTeamState(firmRoot, seedTeam(authEmail));

    const app = await createAuthedDocsApp(authEmail);
    const res = await app.request("/preview-front-matter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseFolder,
        firmRoot,
        frontMatter: {
          claimantName: "Jane Claimant",
          hearingNumber: "H-123",
          serviceDate: "2026-02-23",
          recipients: ["Carrier"],
        },
        documents: [{ title: "Medical report", date: "2026-02-20" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.url).toBe("string");
    expect(body.url).toContain("/api/files/view?");
    expect(body.docxPath).toBeNull();
    expect(body.docxMtimeMs).toBeNull();

    const previewPath = join(caseFolder, ".ai_tool", "working-docs", "front-matter-preview.pdf");
    const previewBytes = await readFile(previewPath);
    expect(previewBytes.length).toBeGreaterThan(0);
  });

  it("file-mtime reports monotonic mtime changes", async () => {
    const authEmail = "lawyer@example.com";
    const firmRoot = await makeTempDir("claude-pi-firm-");
    const caseFolder = join(firmRoot, "Case C");
    await mkdir(caseFolder, { recursive: true });
    await saveTeamState(firmRoot, seedTeam(authEmail));

    const app = await createAuthedDocsApp(authEmail);
    const relativePath = ".ai_tool/working-docs/front-matter-working.docx";
    const fullPath = join(caseFolder, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, "v1", "utf-8");

    const first = await app.request(
      `/file-mtime?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(relativePath)}`
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.exists).toBe(true);
    expect(typeof firstBody.mtimeMs).toBe("number");

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(fullPath, "v2", "utf-8");

    const second = await app.request(
      `/file-mtime?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(relativePath)}`
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.exists).toBe(true);
    expect(typeof secondBody.mtimeMs).toBe("number");
    expect(secondBody.mtimeMs).toBeGreaterThan(firstBody.mtimeMs);
  });
});
