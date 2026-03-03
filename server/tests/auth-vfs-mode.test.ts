import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { setVfsProvider } from "../lib/vfs";
import { LocalFileSystemProvider } from "../lib/vfs/local-provider";

const tempDirs: string[] = [];

const originalConfigDir = process.env.CLAUDE_PI_CONFIG_DIR;
const originalInlineConfig = process.env.CLAUDE_PI_CONFIG;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function seedConfig(configDir: string, config: Record<string, unknown>) {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.json"), JSON.stringify(config, null, 2));
}

afterEach(async () => {
  setVfsProvider(new LocalFileSystemProvider());
  if (originalConfigDir === undefined) delete process.env.CLAUDE_PI_CONFIG_DIR;
  else process.env.CLAUDE_PI_CONFIG_DIR = originalConfigDir;
  if (originalInlineConfig === undefined) delete process.env.CLAUDE_PI_CONFIG;
  else process.env.CLAUDE_PI_CONFIG = originalInlineConfig;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("auth vfs mode switching", () => {
  it("mode=local keeps google credentials and root id", async () => {
    const configDir = await makeTempDir("claude-pi-config-");
    process.env.CLAUDE_PI_CONFIG_DIR = configDir;
    delete process.env.CLAUDE_PI_CONFIG;

    await seedConfig(configDir, {
      authToken: "token",
      email: "owner@firm.com",
      gdriveTokens: { access_token: "abc", refresh_token: "def" },
      gdriveRootFolderId: "folder_123",
      vfsMode: "gdrive",
    });

    const { default: authRoute } = await import(`../routes/auth.ts?vfsmode=${Date.now()}-${Math.random()}`);
    const app = new Hono();
    app.route("/api/auth", authRoute);

    const res = await app.request("/api/auth/vfs/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "local" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.vfsMode).toBe("local");
    expect(body.connected).toBe(true);
    expect(body.rootFolderId).toBe("folder_123");

    const savedRaw = await readFile(join(configDir, "config.json"), "utf-8");
    const saved = JSON.parse(savedRaw);
    expect(saved.vfsMode).toBe("local");
    expect(saved.gdriveRootFolderId).toBe("folder_123");
    expect(saved.gdriveTokens?.access_token).toBe("abc");
    expect(saved.gdriveTokens?.refresh_token).toBe("def");
  });

  it("mode=gdrive returns 400 if drive is not fully configured", async () => {
    const configDir = await makeTempDir("claude-pi-config-");
    process.env.CLAUDE_PI_CONFIG_DIR = configDir;
    delete process.env.CLAUDE_PI_CONFIG;

    await seedConfig(configDir, {
      authToken: "token",
      email: "owner@firm.com",
      vfsMode: "local",
      gdriveTokens: { access_token: "abc" },
    });

    const { default: authRoute } = await import(`../routes/auth.ts?vfsmode=${Date.now()}-${Math.random()}`);
    const app = new Hono();
    app.route("/api/auth", authRoute);

    const res = await app.request("/api/auth/vfs/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "gdrive" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Google Drive is not fully configured");
  });

  it("mode=gdrive succeeds when tokens and root are configured", async () => {
    const configDir = await makeTempDir("claude-pi-config-");
    process.env.CLAUDE_PI_CONFIG_DIR = configDir;
    delete process.env.CLAUDE_PI_CONFIG;

    await seedConfig(configDir, {
      authToken: "token",
      email: "owner@firm.com",
      gdriveTokens: { access_token: "abc", refresh_token: "def" },
      gdriveRootFolderId: "folder_456",
      vfsMode: "local",
    });

    const { default: authRoute } = await import(`../routes/auth.ts?vfsmode=${Date.now()}-${Math.random()}`);
    const app = new Hono();
    app.route("/api/auth", authRoute);

    const res = await app.request("/api/auth/vfs/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "gdrive" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.vfsMode).toBe("gdrive");
    expect(body.connected).toBe(true);
    expect(body.rootFolderId).toBe("folder_456");

    const savedRaw = await readFile(join(configDir, "config.json"), "utf-8");
    const saved = JSON.parse(savedRaw);
    expect(saved.vfsMode).toBe("gdrive");
    expect(saved.gdriveRootFolderId).toBe("folder_456");
  });
});
