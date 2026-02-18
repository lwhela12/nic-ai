import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

const LOCK_DIR = ".ai_tool/locks";
const LOCK_FILE = "write.lock.json";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface CaseLock {
  owner: string;
  displayName?: string;
  acquiredAt: string;
  expiresAt: string;
}

function lockPath(caseFolder: string): string {
  return join(caseFolder, LOCK_DIR, LOCK_FILE);
}

function isExpired(lock: CaseLock): boolean {
  return new Date(lock.expiresAt).getTime() <= Date.now();
}

async function readLock(caseFolder: string): Promise<CaseLock | null> {
  const path = lockPath(caseFolder);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as CaseLock;
    if (isExpired(parsed)) {
      await rm(path, { force: true });
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getActiveCaseLock(caseFolder: string): Promise<CaseLock | null> {
  return readLock(caseFolder);
}

export async function acquireCaseLock(
  caseFolder: string,
  owner: string,
  displayName?: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ acquired: true; lock: CaseLock } | { acquired: false; lock: CaseLock | null }> {
  const current = await readLock(caseFolder);
  if (current && current.owner !== owner) {
    return { acquired: false, lock: current };
  }

  const dir = join(caseFolder, LOCK_DIR);
  await mkdir(dir, { recursive: true });

  const lock: CaseLock = {
    owner,
    displayName,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };

  await writeFile(lockPath(caseFolder), JSON.stringify(lock, null, 2), "utf-8");
  return { acquired: true, lock };
}

export async function releaseCaseLock(caseFolder: string, owner: string): Promise<void> {
  const current = await readLock(caseFolder);
  if (!current) return;
  if (current.owner !== owner) return;
  await rm(lockPath(caseFolder), { force: true });
}

