import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { requireCaseAccess } from "../lib/team-access";

interface Note {
  id: number;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

interface NotesData {
  notes: Note[];
}

const app = new Hono();

// List all notes for a case
app.get("/list", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const notesPath = join(caseFolder, ".pi_tool", "notes.json");

  try {
    const content = await readFile(notesPath, "utf-8");
    const data: NotesData = JSON.parse(content);
    return c.json({ notes: data.notes });
  } catch {
    return c.json({ notes: [] });
  }
});

// Create or update a note
app.post("/save", async (c) => {
  const { caseFolder, note } = await c.req.json();

  if (!caseFolder || !note || typeof note.text !== "string") {
    return c.json({ error: "caseFolder and note.text required" }, 400);
  }

  const access = await requireCaseAccess(c, caseFolder);
  if (!access.ok) {
    return access.response;
  }

  const piToolDir = join(caseFolder, ".pi_tool");
  const notesPath = join(piToolDir, "notes.json");

  // Load existing notes
  let data: NotesData = { notes: [] };
  try {
    const content = await readFile(notesPath, "utf-8");
    data = JSON.parse(content);
  } catch {
    // No existing notes file
  }

  const now = new Date().toISOString();
  let savedNote: Note;

  if (note.id) {
    // Update existing note
    const existing = data.notes.find((n) => n.id === note.id);
    if (!existing) {
      return c.json({ error: "Note not found" }, 404);
    }
    existing.text = note.text;
    existing.editedAt = now;
    savedNote = existing;
  } else {
    // Create new note
    savedNote = {
      id: Date.now(),
      text: note.text,
      createdAt: now,
      editedAt: null,
    };
    data.notes.push(savedNote);
  }

  try {
    await mkdir(piToolDir, { recursive: true });
    await writeFile(notesPath, JSON.stringify(data, null, 2));
    return c.json({ success: true, note: savedNote });
  } catch (error) {
    console.error("Failed to save note:", error);
    return c.json({ error: "Could not save note" }, 500);
  }
});

export default app;
