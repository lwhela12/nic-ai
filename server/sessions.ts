import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const SESSIONS_DIR = ".ai_tool";
const SESSIONS_FILE = "session.json";

interface SessionData {
  sessionId: string;
  lastUpdated: string;
}

export async function getSession(caseFolder: string): Promise<string | null> {
  try {
    const path = join(caseFolder, SESSIONS_DIR, SESSIONS_FILE);
    const data = await readFile(path, "utf-8");
    const session: SessionData = JSON.parse(data);
    return session.sessionId || null;
  } catch {
    return null;
  }
}

export async function saveSession(caseFolder: string, sessionId: string): Promise<void> {
  const dir = join(caseFolder, SESSIONS_DIR);
  const path = join(dir, SESSIONS_FILE);

  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }

  const data: SessionData = {
    sessionId,
    lastUpdated: new Date().toISOString(),
  };

  await writeFile(path, JSON.stringify(data, null, 2));
}

// Firm-level session management (stored in .ai_tool/)
const FIRM_SESSIONS_DIR = ".ai_tool";

export async function getFirmSession(firmRoot: string): Promise<string | null> {
  try {
    const path = join(firmRoot, FIRM_SESSIONS_DIR, SESSIONS_FILE);
    const data = await readFile(path, "utf-8");
    const session: SessionData = JSON.parse(data);
    return session.sessionId || null;
  } catch {
    return null;
  }
}

export async function saveFirmSession(firmRoot: string, sessionId: string): Promise<void> {
  const dir = join(firmRoot, FIRM_SESSIONS_DIR);
  const path = join(dir, SESSIONS_FILE);

  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }

  const data: SessionData = {
    sessionId,
    lastUpdated: new Date().toISOString(),
  };

  await writeFile(path, JSON.stringify(data, null, 2));
}
