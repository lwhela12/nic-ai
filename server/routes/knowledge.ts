import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdir, readFile, writeFile, mkdir, copyFile, unlink, stat } from "fs/promises";
import { join, dirname, basename, extname } from "path";
import { extractTextFromPdf, extractTextFromDocx } from "../lib/extract";

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
    if (ext === ".pdf") {
      extractedText = await extractTextFromPdf(sourceFilePath);
    } else if (ext === ".docx") {
      extractedText = await extractTextFromDocx(sourceFilePath);
    } else {
      return c.json({ error: "Unsupported file format" }, 400);
    }

    // Format as markdown
    const markdown = formatAsMarkdown(extractedText, formatTemplateName(templateId));

    // Save parsed file
    const parsedFilename = `${templateId}.md`;
    const parsedFilePath = join(parsedDir, parsedFilename);
    await writeFile(parsedFilePath, markdown);

    // Update index
    let index: TemplatesIndex = { templates: [] };
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    const existingIdx = index.templates.findIndex((t) => t.id === templateId);
    const entry: TemplateEntry = {
      id: templateId,
      sourceFile: `source/${sourceFile}`,
      parsedFile: `parsed/${parsedFilename}`,
      name: existingIdx >= 0 ? index.templates[existingIdx].name : formatTemplateName(templateId),
      description: existingIdx >= 0 ? index.templates[existingIdx].description : "",
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
      previewLength: markdown.length,
    });
  } catch (error) {
    console.error("Parse template error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
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
    if (description !== undefined) existing.description = description;

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

// Helper: Format template ID to readable name
function formatTemplateName(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Helper: Format extracted text as markdown
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
