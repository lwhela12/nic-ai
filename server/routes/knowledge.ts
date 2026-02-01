import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile, mkdir, copyFile, unlink, stat } from "fs/promises";
import { join, dirname, basename, extname } from "path";
import { extractTextFromPdf, extractTextFromDocx, extractStylesFromDocx, DocxStyles } from "../lib/extract";

// Lazy client creation - API key is set by auth middleware before requests
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

const app = new Hono();

const templatesDir = join(import.meta.dir, "../../agent/templates");

// ============================================================================
// TEMPLATE ENDPOINTS
// ============================================================================

// List available practice area templates
app.get("/templates", async (c) => {
  try {
    const entries = await readdir(templatesDir, { withFileTypes: true });
    const templates: Array<{ id: string; practiceArea: string; jurisdiction: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifestPath = join(templatesDir, entry.name, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
        templates.push({
          id: entry.name,
          practiceArea: manifest.practiceArea,
          jurisdiction: manifest.jurisdiction,
        });
      } catch {
        // Skip templates without valid manifest
      }
    }

    return c.json(templates);
  } catch (error) {
    return c.json({ error: "Failed to list templates" }, 500);
  }
});

// Initialize knowledge from template
app.post("/init", async (c) => {
  const { root, templateId } = await c.req.json();

  if (!root || !templateId) {
    return c.json({ error: "root and templateId required" }, 400);
  }

  const templateDir = join(templatesDir, templateId);
  const knowledgeDir = join(root, ".pi_tool", "knowledge");

  try {
    // Verify template exists
    const manifestPath = join(templateDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // Create knowledge directory
    await mkdir(knowledgeDir, { recursive: true });

    // Copy manifest
    await copyFile(manifestPath, join(knowledgeDir, "manifest.json"));

    // Copy all section files
    for (const section of manifest.sections) {
      const src = join(templateDir, section.filename);
      const dest = join(knowledgeDir, section.filename);
      await copyFile(src, dest);
    }

    // Create default firm-config.json if it doesn't exist
    const firmConfigPath = join(root, ".pi_tool", "firm-config.json");
    try {
      await stat(firmConfigPath);
    } catch {
      const defaultConfig = {
        firmName: "",
        address: "",
        phone: "",
        practiceArea: manifest.practiceArea,
        jurisdiction: manifest.jurisdiction,
        feeStructure: "",
      };
      await writeFile(firmConfigPath, JSON.stringify(defaultConfig, null, 2));
    }

    return c.json({ success: true, practiceArea: manifest.practiceArea });
  } catch (error) {
    console.error("Knowledge init error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// ============================================================================
// MANIFEST & SECTION ENDPOINTS
// ============================================================================

// Load manifest
app.get("/manifest", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const manifestPath = join(root, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    return c.json(manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "No knowledge base found" }, 404);
    }
    return c.json({ error: "Failed to load manifest" }, 500);
  }
});

// Load section content
app.get("/section/:id", async (c) => {
  const root = c.req.query("root");
  const sectionId = c.req.param("id");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const manifestPath = join(root, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const section = manifest.sections.find((s: any) => s.id === sectionId);

    if (!section) {
      return c.json({ error: "Section not found" }, 404);
    }

    const content = await readFile(
      join(root, ".pi_tool", "knowledge", section.filename),
      "utf-8"
    );

    return c.json({ ...section, content });
  } catch (error) {
    return c.json({ error: "Failed to load section" }, 500);
  }
});

// Save section content
app.put("/section/:id", async (c) => {
  const sectionId = c.req.param("id");
  const { root, content } = await c.req.json();
  if (!root || content === undefined) {
    return c.json({ error: "root and content required" }, 400);
  }

  try {
    const knowledgeDir = join(root, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const section = manifest.sections.find((s: any) => s.id === sectionId);

    if (!section) {
      return c.json({ error: "Section not found" }, 404);
    }

    const filePath = join(knowledgeDir, section.filename);

    // Create backup
    try {
      const existing = await readFile(filePath, "utf-8");
      const backupDir = join(knowledgeDir, ".backups");
      await mkdir(backupDir, { recursive: true });
      await writeFile(
        join(backupDir, `${section.filename}.${Date.now()}.bak`),
        existing
      );
    } catch {
      // No existing file to backup
    }

    await writeFile(filePath, content);

    // Clear knowledge cache
    clearKnowledgeCache(root);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to save section" }, 500);
  }
});

// Create new section
app.post("/section", async (c) => {
  const { root, id, title, content } = await c.req.json();
  if (!root || !id || !title) {
    return c.json({ error: "root, id, and title required" }, 400);
  }

  try {
    const knowledgeDir = join(root, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    // Check for duplicate id
    if (manifest.sections.find((s: any) => s.id === id)) {
      return c.json({ error: "Section with this ID already exists" }, 409);
    }

    const order = manifest.sections.length + 1;
    const filename = `${String(order).padStart(2, "0")}-${id}.md`;

    manifest.sections.push({ id, title, filename, order });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await writeFile(join(knowledgeDir, filename), content || `## ${title}\n\n`);

    clearKnowledgeCache(root);

    return c.json({ success: true, filename });
  } catch (error) {
    return c.json({ error: "Failed to create section" }, 500);
  }
});

// Delete section
app.delete("/section/:id", async (c) => {
  const sectionId = c.req.param("id");
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const knowledgeDir = join(root, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const sectionIdx = manifest.sections.findIndex((s: any) => s.id === sectionId);

    if (sectionIdx === -1) {
      return c.json({ error: "Section not found" }, 404);
    }

    const section = manifest.sections[sectionIdx];

    // Remove file
    try {
      await unlink(join(knowledgeDir, section.filename));
    } catch {
      // File may already be gone
    }

    // Remove from manifest
    manifest.sections.splice(sectionIdx, 1);
    // Reorder
    manifest.sections.forEach((s: any, i: number) => { s.order = i + 1; });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    clearKnowledgeCache(root);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to delete section" }, 500);
  }
});

// ============================================================================
// KNOWLEDGE CHAT
// ============================================================================

app.post("/chat", async (c) => {
  const { root, message } = await c.req.json();
  if (!root || !message) {
    return c.json({ error: "root and message required" }, 400);
  }

  // Load all knowledge sections as context
  let knowledgeContext = "";
  try {
    const knowledgeDir = join(root, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    const sections: string[] = [];
    for (const section of manifest.sections) {
      try {
        const content = await readFile(join(knowledgeDir, section.filename), "utf-8");
        sections.push(`### Section: ${section.title} (id: ${section.id})\n\n${content}`);
      } catch {
        // Skip unreadable sections
      }
    }
    knowledgeContext = sections.join("\n\n---\n\n");
  } catch {
    return c.json({ error: "No knowledge base found" }, 404);
  }

  const systemPrompt = `You are a practice knowledge assistant for a law firm. You have access to the firm's practice knowledge base.

Your role:
1. Answer questions about the practice knowledge
2. Suggest edits to sections when asked
3. Help refine and improve the knowledge base

When suggesting edits, output them in this exact format:
[[EDIT_SUGGESTION: {"section_id":"<section-id>","old_text":"<exact text to replace>","new_text":"<replacement text>"}]]

Rules for edit suggestions:
- old_text must be an EXACT substring of the current section content
- Keep suggestions focused and specific
- You may suggest multiple edits in one response
- Explain your reasoning before or after each suggestion

PRACTICE KNOWLEDGE BASE:

${knowledgeContext}`;

  return streamSSE(c, async (stream) => {
    try {
      for await (const msg of query({
        prompt: message,
        options: {
          systemPrompt,
          model: "sonnet",
          allowedTools: [],
          permissionMode: "acceptEdits",
          maxTurns: 3,
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            }
          }
        }

        if (msg.type === "result") {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              success: msg.subtype === "success",
            }),
          });
        }
      }
    } catch (error) {
      console.error("Knowledge chat error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Apply an edit suggestion
app.post("/apply-edit", async (c) => {
  const { root, section_id, old_text, new_text } = await c.req.json();
  if (!root || !section_id || !old_text || new_text === undefined) {
    return c.json({ error: "root, section_id, old_text, and new_text required" }, 400);
  }

  try {
    const knowledgeDir = join(root, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const section = manifest.sections.find((s: any) => s.id === section_id);

    if (!section) {
      return c.json({ error: "Section not found" }, 404);
    }

    const filePath = join(knowledgeDir, section.filename);
    const content = await readFile(filePath, "utf-8");

    if (!content.includes(old_text)) {
      return c.json({ error: "old_text not found in section" }, 400);
    }

    // Create backup
    const backupDir = join(knowledgeDir, ".backups");
    await mkdir(backupDir, { recursive: true });
    await writeFile(
      join(backupDir, `${section.filename}.${Date.now()}.bak`),
      content
    );

    // Apply edit
    const updated = content.replace(old_text, new_text);
    await writeFile(filePath, updated);

    clearKnowledgeCache(root);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to apply edit" }, 500);
  }
});

// ============================================================================
// FIRM LOGO
// ============================================================================

// Upload firm logo
app.post("/firm-logo/upload", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file type
    const ext = extname(file.name).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(ext)) {
      return c.json({ error: "Only PNG and JPG images are supported" }, 400);
    }

    const piToolDir = join(root, ".pi_tool");
    await mkdir(piToolDir, { recursive: true });

    // Delete any existing logo first
    for (const oldExt of [".png", ".jpg", ".jpeg"]) {
      try {
        await unlink(join(piToolDir, `firm-logo${oldExt}`));
      } catch {
        // File may not exist
      }
    }

    // Save new logo
    const logoPath = join(piToolDir, `firm-logo${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(logoPath, buffer);

    return c.json({ success: true, filename: `firm-logo${ext}` });
  } catch (error) {
    console.error("Logo upload error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Get firm logo
app.get("/firm-logo", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const piToolDir = join(root, ".pi_tool");

  // Check for logo with any supported extension
  for (const ext of [".png", ".jpg", ".jpeg"]) {
    const logoPath = join(piToolDir, `firm-logo${ext}`);
    try {
      const logoStat = await stat(logoPath);
      if (logoStat.isFile()) {
        const logoData = await readFile(logoPath);
        const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
        return new Response(logoData, {
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "max-age=3600",
          },
        });
      }
    } catch {
      // Try next extension
    }
  }

  return c.json({ error: "No logo found" }, 404);
});

// Delete firm logo
app.delete("/firm-logo", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const piToolDir = join(root, ".pi_tool");
  let deleted = false;

  // Delete logo with any supported extension
  for (const ext of [".png", ".jpg", ".jpeg"]) {
    try {
      await unlink(join(piToolDir, `firm-logo${ext}`));
      deleted = true;
    } catch {
      // File may not exist
    }
  }

  if (deleted) {
    return c.json({ success: true });
  }
  return c.json({ error: "No logo found" }, 404);
});

// ============================================================================
// FIRM CONFIG
// ============================================================================

app.get("/firm-config", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const configPath = join(root, ".pi_tool", "firm-config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    return c.json(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({
        firmName: "",
        address: "",
        phone: "",
        practiceArea: "",
        jurisdiction: "",
        feeStructure: "",
      });
    }
    return c.json({ error: "Failed to load firm config" }, 500);
  }
});

app.put("/firm-config", async (c) => {
  const { root, ...config } = await c.req.json();
  if (!root) return c.json({ error: "root required" }, 400);

  try {
    const piToolDir = join(root, ".pi_tool");
    await mkdir(piToolDir, { recursive: true });
    const configPath = join(piToolDir, "firm-config.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to save firm config" }, 500);
  }
});

// ============================================================================
// KNOWLEDGE CACHE (used by firm.ts)
// ============================================================================

const knowledgeCache = new Map<string, string>();

export async function loadPracticeGuide(firmRoot?: string): Promise<string> {
  if (firmRoot) {
    const cacheKey = firmRoot;
    if (knowledgeCache.has(cacheKey)) return knowledgeCache.get(cacheKey)!;

    try {
      const knowledgeDir = join(firmRoot, ".pi_tool", "knowledge");
      const manifestPath = join(knowledgeDir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

      const sections: string[] = [];
      for (const section of manifest.sections) {
        try {
          const content = await readFile(join(knowledgeDir, section.filename), "utf-8");
          sections.push(content);
        } catch {
          // Skip unreadable sections
        }
      }

      if (sections.length > 0) {
        const combined = sections.join("\n\n---\n\n");
        knowledgeCache.set(cacheKey, combined);
        return combined;
      }
    } catch {
      // Fall through to default
    }
  }

  // Fallback to default practice-guide.md
  const defaultKey = "__default__";
  if (knowledgeCache.has(defaultKey)) return knowledgeCache.get(defaultKey)!;

  const guidePath = join(import.meta.dir, "../../agent/practice-guide.md");
  const guide = await readFile(guidePath, "utf-8");
  knowledgeCache.set(defaultKey, guide);
  return guide;
}

export function clearKnowledgeCache(firmRoot?: string) {
  if (firmRoot) {
    knowledgeCache.delete(firmRoot);
  } else {
    knowledgeCache.clear();
  }
}

/**
 * Load specific knowledge sections by ID from the firm's knowledge base.
 * Falls back to loading the full practice-guide.md if no manifest exists.
 * If sectionIds is empty/undefined, loads ALL sections.
 */
export async function loadSectionsByIds(
  firmRoot: string | undefined,
  sectionIds?: string[]
): Promise<string> {
  if (!firmRoot) {
    return loadPracticeGuide();
  }

  try {
    const knowledgeDir = join(firmRoot, ".pi_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    const targetSections = sectionIds && sectionIds.length > 0
      ? manifest.sections.filter((s: any) => sectionIds.includes(s.id))
      : manifest.sections;

    const parts: string[] = [];
    for (const section of targetSections) {
      try {
        const content = await readFile(join(knowledgeDir, section.filename), "utf-8");
        parts.push(content);
      } catch {
        // Skip unreadable sections
      }
    }

    if (parts.length > 0) {
      return parts.join("\n\n---\n\n");
    }
  } catch {
    // Fall through to full guide
  }

  return loadPracticeGuide(firmRoot);
}

// ============================================================================
// DOCUMENT TEMPLATES
// ============================================================================

interface TemplateEntry {
  id: string;
  sourceFile: string;
  parsedFile: string | null;
  name: string;
  description: string;
  descriptionSource?: "ai" | "user";  // Track if description was AI-generated or user-edited
  parsedAt: string | null;
  sourceModified: string;
}

interface TemplatesIndex {
  templates: TemplateEntry[];
}

// List document templates and detect new source files
app.get("/doc-templates", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");
  const parsedDir = join(templatesDir, "parsed");
  const indexPath = join(templatesDir, "templates.json");

  try {
    // Ensure directories exist
    await mkdir(sourceDir, { recursive: true });
    await mkdir(parsedDir, { recursive: true });

    // Load existing index
    let index: TemplatesIndex = { templates: [] };
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    // Scan source directory for files
    const sourceFiles = await readdir(sourceDir);
    const validExtensions = [".pdf", ".docx"];
    const templateFiles = sourceFiles.filter((f) =>
      validExtensions.includes(extname(f).toLowerCase())
    );

    // Build result with status for each file
    const templates: Array<TemplateEntry & { status: "parsed" | "needs_parsing" | "outdated" }> = [];

    for (const filename of templateFiles) {
      const sourceFilePath = join(sourceDir, filename);
      const sourceStat = await stat(sourceFilePath);
      const id = basename(filename, extname(filename));
      const existing = index.templates.find((t) => t.id === id);

      if (existing) {
        // Check if source is newer than parsed
        const sourceModified = sourceStat.mtime.toISOString();
        const isOutdated = existing.parsedAt
          ? new Date(sourceModified) > new Date(existing.parsedAt)
          : true;

        templates.push({
          ...existing,
          sourceModified,
          status: existing.parsedFile
            ? isOutdated
              ? "outdated"
              : "parsed"
            : "needs_parsing",
        });
      } else {
        // New file not in index
        templates.push({
          id,
          sourceFile: `source/${filename}`,
          parsedFile: null,
          name: formatTemplateName(id),
          description: "",
          parsedAt: null,
          sourceModified: sourceStat.mtime.toISOString(),
          status: "needs_parsing",
        });
      }
    }

    return c.json({ templates });
  } catch (error) {
    console.error("List templates error:", error);
    return c.json({ error: "Failed to list templates" }, 500);
  }
});

// Upload a new template file
app.post("/doc-templates/upload", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");

  try {
    // Ensure directory exists
    await mkdir(sourceDir, { recursive: true });

    // Get the uploaded file from form data
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file type
    const ext = extname(file.name).toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) {
      return c.json({ error: "Only PDF and DOCX files are supported" }, 400);
    }

    // Save file to source directory
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); // Sanitize filename
    const filePath = join(sourceDir, filename);

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));

    const id = basename(filename, ext);

    return c.json({
      success: true,
      id,
      filename,
      message: "Template uploaded successfully",
    });
  } catch (error) {
    console.error("Upload template error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Parse a template source file into markdown
app.post("/doc-templates/:id/parse", async (c) => {
  const root = c.req.query("root");
  const templateId = c.req.param("id");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");
  const parsedDir = join(templatesDir, "parsed");
  const indexPath = join(templatesDir, "templates.json");

  try {
    // Find source file
    const sourceFiles = await readdir(sourceDir);
    const sourceFile = sourceFiles.find(
      (f) => basename(f, extname(f)) === templateId
    );

    if (!sourceFile) {
      return c.json({ error: "Source file not found" }, 404);
    }

    const sourceFilePath = join(sourceDir, sourceFile);
    const sourceStat = await stat(sourceFilePath);
    const ext = extname(sourceFile).toLowerCase();

    // Extract text based on file type
    let extractedText: string;
    let extractedStyles: DocxStyles | null = null;

    if (ext === ".pdf") {
      extractedText = await extractTextFromPdf(sourceFilePath);
    } else if (ext === ".docx") {
      extractedText = await extractTextFromDocx(sourceFilePath);
      // Also extract styles from DOCX (non-fatal if this fails)
      try {
        extractedStyles = await extractStylesFromDocx(sourceFilePath);
      } catch (styleErr) {
        console.error("Style extraction failed (non-fatal):", styleErr);
      }
    } else {
      return c.json({ error: "Unsupported file format" }, 400);
    }

    // Use Claude to intelligently analyze and structure the template
    const templateName = formatTemplateName(templateId);
    const analysis = await analyzeTemplateWithAI(extractedText, templateName);

    // Save parsed file
    const parsedFilename = `${templateId}.md`;
    const parsedFilePath = join(parsedDir, parsedFilename);
    await writeFile(parsedFilePath, analysis.markdown);

    // Save extracted styles if available (DOCX only)
    if (extractedStyles) {
      const stylesData = {
        sourceTemplate: sourceFile,
        templateName,
        extractedAt: new Date().toISOString(),
        styles: extractedStyles,
      };
      const stylesPath = join(root, ".pi_tool", "template-styles.json");
      await writeFile(stylesPath, JSON.stringify(stylesData, null, 2));
    }

    // Update index
    let index: TemplatesIndex = { templates: [] };
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    const existingIdx = index.templates.findIndex((t) => t.id === templateId);
    const existing = existingIdx >= 0 ? index.templates[existingIdx] : null;

    // Only preserve description if user manually set it; regenerate AI descriptions
    const isUserDescription = existing?.descriptionSource === "user";
    const description = isUserDescription ? existing.description : analysis.description;

    const entry: TemplateEntry = {
      id: templateId,
      sourceFile: `source/${sourceFile}`,
      parsedFile: `parsed/${parsedFilename}`,
      name: existing?.name || formatTemplateName(templateId),
      description,
      descriptionSource: isUserDescription ? "user" : "ai",
      parsedAt: new Date().toISOString(),
      sourceModified: sourceStat.mtime.toISOString(),
    };

    if (existingIdx >= 0) {
      index.templates[existingIdx] = entry;
    } else {
      index.templates.push(entry);
    }

    await writeFile(indexPath, JSON.stringify(index, null, 2));

    return c.json({
      success: true,
      template: entry,
      previewLength: analysis.markdown.length,
      stylesExtracted: extractedStyles !== null,
      styles: extractedStyles,
      generatedDescription: analysis.description,
    });
  } catch (error) {
    console.error("Parse template error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Batch parse templates with parallel Haiku calls
const TEMPLATE_CONCURRENCY = 10;

interface ParseResult {
  id: string;
  success: boolean;
  error?: string;
  previewLength?: number;
}

async function processTemplatesWithLimit(
  templates: Array<{ id: string; sourceFile: string }>,
  root: string,
  limit: number,
  onProgress: (event: { type: string; [key: string]: any }) => Promise<void>
): Promise<ParseResult[]> {
  const results: ParseResult[] = new Array(templates.length);
  let currentIndex = 0;

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");
  const parsedDir = join(templatesDir, "parsed");
  const indexPath = join(templatesDir, "templates.json");

  async function worker() {
    while (currentIndex < templates.length) {
      const index = currentIndex++;
      const template = templates[index];

      try {
        await onProgress({
          type: "template_start",
          index,
          total: templates.length,
          id: template.id,
        });

        // Find and read source file
        const sourceFiles = await readdir(sourceDir);
        const sourceFile = sourceFiles.find(
          (f) => basename(f, extname(f)) === template.id
        );

        if (!sourceFile) {
          results[index] = { id: template.id, success: false, error: "Source file not found" };
          continue;
        }

        const sourceFilePath = join(sourceDir, sourceFile);
        const sourceStat = await stat(sourceFilePath);
        const ext = extname(sourceFile).toLowerCase();

        // Extract text
        let extractedText: string;
        let extractedStyles: DocxStyles | null = null;

        if (ext === ".pdf") {
          extractedText = await extractTextFromPdf(sourceFilePath);
        } else if (ext === ".docx") {
          extractedText = await extractTextFromDocx(sourceFilePath);
          try {
            extractedStyles = await extractStylesFromDocx(sourceFilePath);
          } catch {
            // Non-fatal
          }
        } else {
          results[index] = { id: template.id, success: false, error: "Unsupported format" };
          continue;
        }

        // Analyze with AI (Haiku)
        const templateName = formatTemplateName(template.id);
        const analysis = await analyzeTemplateWithAI(extractedText, templateName);

        // Save parsed file
        const parsedFilename = `${template.id}.md`;
        const parsedFilePath = join(parsedDir, parsedFilename);
        await writeFile(parsedFilePath, analysis.markdown);

        // Save styles if available
        if (extractedStyles) {
          const stylesData = {
            sourceTemplate: sourceFile,
            templateName,
            extractedAt: new Date().toISOString(),
            styles: extractedStyles,
          };
          const stylesPath = join(root, ".pi_tool", "template-styles.json");
          await writeFile(stylesPath, JSON.stringify(stylesData, null, 2));
        }

        // Update index
        let indexData: TemplatesIndex = { templates: [] };
        try {
          const indexContent = await readFile(indexPath, "utf-8");
          indexData = JSON.parse(indexContent);
        } catch {
          // No index yet
        }

        const existingIdx = indexData.templates.findIndex((t) => t.id === template.id);
        const existing = existingIdx >= 0 ? indexData.templates[existingIdx] : null;

        // Only preserve description if user manually set it; regenerate AI descriptions
        const isUserDescription = existing?.descriptionSource === "user";
        const description = isUserDescription ? existing.description : analysis.description;

        const entry: TemplateEntry = {
          id: template.id,
          sourceFile: `source/${sourceFile}`,
          parsedFile: `parsed/${parsedFilename}`,
          name: existing?.name || formatTemplateName(template.id),
          description,
          descriptionSource: isUserDescription ? "user" : "ai",
          parsedAt: new Date().toISOString(),
          sourceModified: sourceStat.mtime.toISOString(),
        };

        if (existingIdx >= 0) {
          indexData.templates[existingIdx] = entry;
        } else {
          indexData.templates.push(entry);
        }

        await writeFile(indexPath, JSON.stringify(indexData, null, 2));

        results[index] = { id: template.id, success: true, previewLength: analysis.markdown.length };

        await onProgress({
          type: "template_done",
          index,
          total: templates.length,
          id: template.id,
          previewLength: analysis.markdown.length,
        });

      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[Batch Parse] Error for ${template.id}:`, error);
        results[index] = { id: template.id, success: false, error };

        await onProgress({
          type: "template_error",
          index,
          total: templates.length,
          id: template.id,
          error,
        });
      }
    }
  }

  // Start workers up to the limit
  const workers = Array(Math.min(limit, templates.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

app.post("/doc-templates/parse-batch", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const { templateIds, reparse } = await c.req.json();

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");
  const indexPath = join(templatesDir, "templates.json");

  // Get list of templates to parse
  let templates: Array<{ id: string; sourceFile: string; status: string }> = [];

  try {
    // Ensure directories exist
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(templatesDir, "parsed"), { recursive: true });

    // Load existing index
    let index: TemplatesIndex = { templates: [] };
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    // Scan source directory
    const sourceFiles = await readdir(sourceDir);
    const validExtensions = [".pdf", ".docx"];
    const templateFiles = sourceFiles.filter((f) =>
      validExtensions.includes(extname(f).toLowerCase())
    );

    for (const filename of templateFiles) {
      const id = basename(filename, extname(filename));

      // Filter by templateIds if provided
      if (templateIds && templateIds.length > 0 && !templateIds.includes(id)) {
        continue;
      }

      const existing = index.templates.find((t) => t.id === id);
      const sourceFilePath = join(sourceDir, filename);
      const sourceStat = await stat(sourceFilePath);
      const sourceModified = sourceStat.mtime.toISOString();

      // Determine status
      let status = "needs_parsing";
      if (existing?.parsedFile) {
        const isOutdated = existing.parsedAt
          ? new Date(sourceModified) > new Date(existing.parsedAt)
          : true;
        status = isOutdated ? "outdated" : "parsed";
      }

      // Include if reparse=true or not already parsed
      if (reparse || status !== "parsed") {
        templates.push({ id, sourceFile: `source/${filename}`, status });
      }
    }

    if (templates.length === 0) {
      return c.json({ message: "No templates to parse", parsed: 0 });
    }

  } catch (error) {
    return c.json({ error: "Failed to scan templates" }, 500);
  }

  // Stream progress via SSE
  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "start",
          total: templates.length,
          templates: templates.map((t) => ({ id: t.id, status: t.status })),
        }),
      });

      const results = await processTemplatesWithLimit(
        templates,
        root,
        TEMPLATE_CONCURRENCY,
        async (event) => {
          await stream.writeSSE({ data: JSON.stringify(event) });
        }
      );

      const successCount = results.filter((r) => r.success).length;

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success: successCount === templates.length,
          successCount,
          total: templates.length,
          results,
        }),
      });
    } catch (error) {
      console.error("Batch parse error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Update template metadata (name, description)
app.put("/doc-templates/:id", async (c) => {
  const root = c.req.query("root");
  const templateId = c.req.param("id");
  const { name, description } = await c.req.json();

  if (!root) return c.json({ error: "root query param required" }, 400);

  const indexPath = join(root, ".pi_tool", "templates", "templates.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index: TemplatesIndex = JSON.parse(indexContent);

    const existing = index.templates.find((t) => t.id === templateId);
    if (!existing) {
      return c.json({ error: "Template not found" }, 404);
    }

    if (name !== undefined) existing.name = name;
    if (description !== undefined) {
      existing.description = description;
      existing.descriptionSource = "user";  // Mark as user-edited so reparse won't overwrite
    }

    await writeFile(indexPath, JSON.stringify(index, null, 2));

    return c.json({ success: true, template: existing });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "Template index not found" }, 404);
    }
    return c.json({ error: "Failed to update template" }, 500);
  }
});

// Get parsed template content for preview
app.get("/doc-templates/:id/preview", async (c) => {
  const root = c.req.query("root");
  const templateId = c.req.param("id");

  if (!root) return c.json({ error: "root query param required" }, 400);

  const parsedFilePath = join(root, ".pi_tool", "templates", "parsed", `${templateId}.md`);

  try {
    const content = await readFile(parsedFilePath, "utf-8");
    return c.json({ content });
  } catch {
    return c.json({ error: "Parsed template not found" }, 404);
  }
});

// Delete a template
app.delete("/doc-templates/:id", async (c) => {
  const root = c.req.query("root");
  const templateId = c.req.param("id");

  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".pi_tool", "templates");
  const indexPath = join(templatesDir, "templates.json");

  try {
    // Load index
    const indexContent = await readFile(indexPath, "utf-8");
    const index: TemplatesIndex = JSON.parse(indexContent);

    const existingIdx = index.templates.findIndex((t) => t.id === templateId);
    if (existingIdx < 0) {
      return c.json({ error: "Template not found" }, 404);
    }

    const template = index.templates[existingIdx];

    // Delete source file
    try {
      await unlink(join(templatesDir, template.sourceFile));
    } catch {
      // File may not exist
    }

    // Delete parsed file
    if (template.parsedFile) {
      try {
        await unlink(join(templatesDir, template.parsedFile));
      } catch {
        // File may not exist
      }
    }

    // Remove from index
    index.templates.splice(existingIdx, 1);
    await writeFile(indexPath, JSON.stringify(index, null, 2));

    return c.json({ success: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "Template index not found" }, 404);
    }
    return c.json({ error: "Failed to delete template" }, 500);
  }
});

// Extract styles from a DOCX template
app.post("/doc-templates/:id/extract-styles", async (c) => {
  const root = c.req.query("root");
  const templateId = c.req.param("id");

  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".pi_tool", "templates");
  const sourceDir = join(templatesDir, "source");

  try {
    // Find source file
    const sourceFiles = await readdir(sourceDir);
    const sourceFile = sourceFiles.find(
      (f) => basename(f, extname(f)) === templateId && extname(f).toLowerCase() === ".docx"
    );

    if (!sourceFile) {
      return c.json({ error: "DOCX source file not found (style extraction only works with DOCX)" }, 404);
    }

    const sourceFilePath = join(sourceDir, sourceFile);

    // Extract styles from DOCX
    const styles = await extractStylesFromDocx(sourceFilePath);

    // Load existing index to get template name
    const indexPath = join(templatesDir, "templates.json");
    let templateName = formatTemplateName(templateId);
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      const index: TemplatesIndex = JSON.parse(indexContent);
      const template = index.templates.find((t) => t.id === templateId);
      if (template?.name) templateName = template.name;
    } catch {
      // No index, use default name
    }

    // Save to template-styles.json
    const stylesData = {
      sourceTemplate: sourceFile,
      templateName,
      extractedAt: new Date().toISOString(),
      styles,
    };

    const stylesPath = join(root, ".pi_tool", "template-styles.json");
    await writeFile(stylesPath, JSON.stringify(stylesData, null, 2));

    return c.json({
      success: true,
      styles,
      sourceTemplate: sourceFile,
    });
  } catch (error) {
    console.error("Extract styles error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Get current template styles
app.get("/template-styles", async (c) => {
  const root = c.req.query("root");

  if (!root) return c.json({ error: "root query param required" }, 400);

  const stylesPath = join(root, ".pi_tool", "template-styles.json");

  try {
    const content = await readFile(stylesPath, "utf-8");
    const data = JSON.parse(content);
    return c.json(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "No template styles found" }, 404);
    }
    return c.json({ error: "Failed to load template styles" }, 500);
  }
});

// Helper: Format template ID to readable name
function formatTemplateName(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Helper: Format extracted text as markdown (fallback if AI fails)
function formatAsMarkdown(text: string, title: string): string {
  // Clean up the extracted text
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `# ${title}

${cleaned}
`;
}

// Helper: Use Claude to intelligently analyze and structure template content
interface TemplateAnalysis {
  markdown: string;
  description: string;
}

async function analyzeTemplateWithAI(rawText: string, templateName: string): Promise<TemplateAnalysis> {
  const prompt = `You are analyzing a legal document template to make it useful for an AI agent that will generate similar documents.

TEMPLATE NAME: ${templateName}

RAW EXTRACTED TEXT:
${rawText}

---

Please analyze this template and produce TWO things:

## PART 1: AGENT DESCRIPTION (output first, on its own line starting with "DESCRIPTION:")

Write a concise description that tells an AI agent WHEN to use this template. Include all relevant details:
- What type of document it creates
- Key conditions or triggers (e.g., "when liability is clear", "for 3P carriers", "after treatment complete")
- Any special features of this template (e.g., "includes loss of consortium", "with wage loss section", "premises liability specific")
- What case types or situations it's designed for

Keep it to 1-2 sentences but include all important details. The description helps the agent choose the right template.

## PART 2: TEMPLATE ANALYSIS (output after the description)

Produce a well-structured markdown document that includes:

1. **TEMPLATE OVERVIEW** (at the top)
   - What type of document this is
   - When to use this template
   - Key characteristics or tone

2. **STRUCTURE ANALYSIS**
   - Identify all major sections/headings
   - Explain the purpose of each section
   - Note the typical order and flow

3. **PLACEHOLDERS & VARIABLES**
   - List all placeholders you find (things like [CLIENT NAME], blanks, or variable content)
   - For each, explain what information should go there
   - Use consistent placeholder format: \`{{PLACEHOLDER_NAME}}\`

4. **TEMPLATE CONTENT**
   - Reproduce the template with:
     - Placeholders converted to \`{{PLACEHOLDER_NAME}}\` format
     - Preserved formatting and structure
     - Any boilerplate language clearly marked

   **IMPORTANT FORMATTING RULES:**
   - If this is a LETTER template (LOR, Bill HI, correspondence, client letter):
     - Use **Bold Text** for section labels, NOT ## markdown headers
     - Do NOT add --- horizontal rules between sections
     - Preserve the continuous flowing letter format
     - Keep the business letter style with natural paragraph breaks
   - If this is a FORMAL DOCUMENT (demand letter, memo, legal brief):
     - Use ## headers for major sections
     - Horizontal rules are acceptable between major sections

5. **USAGE NOTES**
   - Any special considerations
   - Required information to fill this template
   - Common variations or optional sections

Format everything as clean markdown. The goal is to help an AI agent understand this template well enough to generate high-quality documents following the same structure and style.`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI analysis returned no text content");
  }

  const fullText = textBlock.text;

  // Parse out the description (first line starting with "DESCRIPTION:")
  let description = "";
  let markdown = fullText;

  const descMatch = fullText.match(/^DESCRIPTION:\s*(.+?)(?:\n|$)/im);
  if (descMatch) {
    description = descMatch[1].trim();
    // Remove the description line from the markdown
    markdown = fullText.replace(/^DESCRIPTION:\s*.+?\n+/im, "").trim();
  }

  return { markdown, description };
}

/**
 * Load document templates for agent context.
 * Returns a formatted string describing available templates.
 */
export async function loadDocumentTemplates(firmRoot: string): Promise<string> {
  const indexPath = join(firmRoot, ".pi_tool", "templates", "templates.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index: TemplatesIndex = JSON.parse(indexContent);

    if (index.templates.length === 0) {
      return "";
    }

    const parsed = index.templates.filter((t) => t.parsedFile);
    if (parsed.length === 0) {
      return "";
    }

    const lines = parsed.map(
      (t) => `- **${t.name}** (${t.id}): ${t.description || "No description"}`
    );

    return `DOCUMENT TEMPLATES:
${lines.join("\n")}

To use a template, read .pi_tool/templates/parsed/{id}.md for the template content.`;
  } catch {
    return "";
  }
}

export default app;
