import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

// SDK CLI options helper - handles both direct and npx modes
import { getSDKCliOptions } from "../lib/sdk-cli-options";
import { readdir, readFile, writeFile, mkdir, copyFile, unlink, stat } from "fs/promises";
import { join, dirname, basename, extname } from "path";
import { extractTextFromPdf, extractTextFromDocx, extractFullTextFromDocx, extractStylesFromDocx, extractHtmlFromDocx, DocxStyles, DocxHtmlExtract } from "../lib/extract";
import { requireFirmAccess } from "../lib/team-access";
import { BUILT_IN_TEMPLATES, type PacketTemplate } from "../lib/evidence-packet";
import { generateSectionTags, generateTagsForAllSections, generateKnowledgeSummary } from "../lib/knowledge-tagger";
import { updateMetaIndexSectionTags } from "../lib/direct-chat";

// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    // Explicitly pass API key - env var reading may not work in bundled binary
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return _anthropic;
}

const app = new Hono();

async function resolveRootFromRequest(c: any): Promise<string | null> {
  const queryRoot = c.req.query("root");
  if (queryRoot) return queryRoot;

  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/json")) return null;

  try {
    const body = await c.req.raw.clone().json() as Record<string, unknown>;
    return typeof body.root === "string" ? body.root : null;
  } catch {
    return null;
  }
}

app.use("/*", async (c, next) => {
  const root = await resolveRootFromRequest(c);
  if (!root) {
    return next();
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  if (c.req.method !== "GET" && !access.context.permissions.canEditKnowledge) {
    return c.json({ error: "insufficient_permissions" }, 403);
  }

  return next();
});

// Use env var for production (set by Electron), fall back to relative path for dev
const agentPath = process.env.AGENT_PROMPT_PATH || join(import.meta.dir, "../../agent");
const templatesDir = join(agentPath, "templates");

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
  const knowledgeDir = join(root, ".ai_tool", "knowledge");

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
    const firmConfigPath = join(root, ".ai_tool", "firm-config.json");
    try {
      await stat(firmConfigPath);
    } catch {
      const defaultConfig = {
        firmName: "",
        attorneyName: "",
        nevadaBarNo: "",
        address: "",
        cityStateZip: "",
        phone: "",
        fax: "",
        email: "",
        practiceArea: manifest.practiceArea,
        jurisdiction: manifest.jurisdiction,
        feeStructure: "",
      };
      await writeFile(firmConfigPath, JSON.stringify(defaultConfig, null, 2));
    }

    // Generate semantic tags and holistic summary for all sections (non-blocking)
    (async () => {
      try {
        const tagInputs: Array<{ filename: string; title: string; content: string }> = [];
        for (const section of manifest.sections) {
          try {
            const content = await readFile(join(knowledgeDir, section.filename), "utf-8");
            tagInputs.push({ filename: section.filename, title: section.title, content });
          } catch { /* skip */ }
        }
        if (tagInputs.length > 0) {
          // Generate per-section tags and holistic summary in parallel
          const [tagsMap, knowledgeSummary] = await Promise.all([
            generateTagsForAllSections(tagInputs),
            generateKnowledgeSummary(tagInputs),
          ]);

          // Build and save meta-index with tags + summary
          const metaIndexPath = join(root, ".ai_tool", "knowledge", "meta_index.json");
          const manifestMtime = (await stat(join(knowledgeDir, "manifest.json"))).mtimeMs;
          const sectionMtimes: Record<string, number> = {};
          const sections: Array<any> = [];
          for (const section of manifest.sections) {
            try {
              const st = await stat(join(knowledgeDir, section.filename));
              sectionMtimes[section.filename] = st.mtimeMs;
            } catch { /* skip */ }
            const tags = tagsMap.get(section.filename);
            const content = await readFile(join(knowledgeDir, section.filename), "utf-8").catch(() => "");
            sections.push({
              id: section.id,
              title: section.title,
              filename: section.filename,
              path: `.ai_tool/knowledge/${section.filename}`,
              preview: content.replace(/\s+/g, " ").trim().slice(0, 420),
              char_count: content.length,
              ...(tags ? { topics: tags.topics, applies_to: tags.applies_to, summary: tags.summary } : {}),
            });
          }
          const metaIndex: Record<string, any> = {
            indexed_at: new Date().toISOString(),
            source: ".ai_tool/knowledge/manifest.json",
            source_mtime: manifestMtime,
            practice_area: manifest.practiceArea,
            jurisdiction: manifest.jurisdiction,
            section_count: sections.length,
            sections,
            section_mtimes: sectionMtimes,
            has_semantic_tags: tagsMap.size > 0,
          };
          if (knowledgeSummary) {
            metaIndex.knowledge_summary = knowledgeSummary;
          }
          await writeFile(metaIndexPath, JSON.stringify(metaIndex, null, 2));
        }
      } catch (err) {
        console.warn("[knowledge/init] Failed to generate semantic tags:", err instanceof Error ? err.message : err);
      }
    })();

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
    const manifestPath = join(root, ".ai_tool", "knowledge", "manifest.json");
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
    const manifestPath = join(root, ".ai_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    const section = manifest.sections.find((s: any) => s.id === sectionId);

    if (!section) {
      return c.json({ error: "Section not found" }, 404);
    }

    const content = await readFile(
      join(root, ".ai_tool", "knowledge", section.filename),
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
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
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

    // Generate semantic tags for the updated section (non-blocking)
    generateSectionTags(section.title, content)
      .then((tags) => updateMetaIndexSectionTags(root, section.filename, tags))
      .catch((err) => console.warn("[knowledge] Failed to tag section:", err instanceof Error ? err.message : err));

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
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
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
    const sectionContent = content || `## ${title}\n\n`;
    await writeFile(join(knowledgeDir, filename), sectionContent);

    clearKnowledgeCache(root);

    // Generate semantic tags for the new section (non-blocking)
    generateSectionTags(title, sectionContent)
      .then((tags) => updateMetaIndexSectionTags(root, filename, tags))
      .catch((err) => console.warn("[knowledge] Failed to tag new section:", err instanceof Error ? err.message : err));

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
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
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
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
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
          ...getSDKCliOptions(),
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
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
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

    const piToolDir = join(root, ".ai_tool");
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

  const piToolDir = join(root, ".ai_tool");

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

  const piToolDir = join(root, ".ai_tool");
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
    const configPath = join(root, ".ai_tool", "firm-config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    // Synthesize attorneys[] from legacy attorneyName/nevadaBarNo if missing
    if (!Array.isArray(config.attorneys) && config.attorneyName) {
      config.attorneys = [{ name: config.attorneyName, barNo: config.nevadaBarNo || "" }];
    }
    return c.json(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({
        firmName: "",
        attorneyName: "",
        nevadaBarNo: "",
        address: "",
        cityStateZip: "",
        phone: "",
        practiceArea: "",
        jurisdiction: "",
        feeStructure: "",
        attorneys: [],
      });
    }
    return c.json({ error: "Failed to load firm config" }, 500);
  }
});

app.put("/firm-config", async (c) => {
  const { root, ...config } = await c.req.json();
  if (!root) return c.json({ error: "root required" }, 400);

  // Sync attorneys[0] back to legacy attorneyName/nevadaBarNo for backward compat
  if (Array.isArray(config.attorneys) && config.attorneys.length > 0) {
    const primary = config.attorneys[0];
    if (primary?.name) config.attorneyName = primary.name;
    if (primary?.barNo !== undefined) config.nevadaBarNo = primary.barNo;
  }

  try {
    const piToolDir = join(root, ".ai_tool");
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
      const knowledgeDir = join(firmRoot, ".ai_tool", "knowledge");
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
    const knowledgeDir = join(firmRoot, ".ai_tool", "knowledge");
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
  type?: "document" | "packet";       // auto-detected during parse
  packetConfig?: PacketTemplate;      // structured metadata, only for packet type
}

interface PacketTemplateAnalysisResult {
  template: PacketTemplate;
  sampleClaimantName?: string;
  sampleFirmName?: string;
  sampleAttorneyNames: string[];
  sampleCaptionValues: Record<string, string>;
}

const DOCUMENT_INDEX_HEADING_RE = /\bDOCUMENT\s+INDEX\b/i;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTextInsensitive(source: string, target: string, replacement: string): string {
  if (!target) return source;
  return source.replace(new RegExp(escapeRegExp(target), "gi"), replacement);
}

function sanitizePacketHtml(html: string): string {
  let normalized = html
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>\s*<\/html>\s*$/i, "")
    .replace(/<\/body>/i, "")
    .trim();

  return normalized || html.trim();
}

function applyPacketTemplatePlaceholders(
  html: string,
  analysis: PacketTemplateAnalysisResult
): string {
  let result = sanitizePacketHtml(html);

  result = replaceTextInsensitive(
    result,
    analysis.sampleClaimantName || "",
    "{{claimantName}}"
  );

  for (const [key, value] of Object.entries(analysis.sampleCaptionValues || {})) {
    if (!value) continue;
    result = replaceTextInsensitive(result, value, `{{${key}}}`);
  }

  if (analysis.sampleFirmName) {
    result = replaceTextInsensitive(result, analysis.sampleFirmName, "counsel");
  }

  for (const attorney of analysis.sampleAttorneyNames) {
    if (!attorney) continue;
    result = replaceTextInsensitive(result, attorney, "counsel");
  }

  // If the template text already includes a document index heading, avoid
  // forcing a duplicate section by inserting a marker for the HTML renderer.
  if (!DOCUMENT_INDEX_HEADING_RE.test(result)) {
    result = `${result}\n\n{{documentIndex}}`;
  }

  return result.trim();
}

function applyPacketHtmlTemplate(
  packetTemplate: PacketTemplate,
  html: DocxHtmlExtract | null,
  analysis: PacketTemplateAnalysisResult | undefined
): PacketTemplate {
  if (!html || !analysis) return packetTemplate;

  const templateHtml = applyPacketTemplatePlaceholders(html.html, analysis);

  const templateCss = html.css;
  if (templateHtml) {
    packetTemplate.htmlTemplate = templateHtml;
  }
  if (templateCss) {
    packetTemplate.htmlTemplateCss = templateCss;
  }

  return packetTemplate;
}

interface TemplatesIndex {
  templates: TemplateEntry[];
}

// List document templates and detect new source files
app.get("/doc-templates", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  const templatesDir = join(root, ".ai_tool", "templates");
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

  const templatesDir = join(root, ".ai_tool", "templates");
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

  const templatesDir = join(root, ".ai_tool", "templates");
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
    let extractedHtml: DocxHtmlExtract | null = null;

    if (ext === ".pdf") {
      extractedText = await extractTextFromPdf(sourceFilePath);
      // Attempt to map PDF bounding boxes using AI
      try {
        const { templatePdfWithAI } = await import("../lib/extract");
        const templateName = formatTemplateName(templateId);
        const bboxMap = await templatePdfWithAI(sourceFilePath, templateName);

        // Save the coordinates map
        const coordsPath = join(parsedDir, `${templateId}-coords.json`);
        await writeFile(coordsPath, JSON.stringify(bboxMap, null, 2));
        console.log(`[Parse] Successfully parsed PDF BBoxes for: ${sourceFile}`);
      } catch (templErr) {
        console.warn(`[Parse] PDF BBox artificial mapping failed (non-fatal):`, templErr instanceof Error ? templErr.message : templErr);
      }
    } else if (ext === ".docx") {
      extractedText = await extractFullTextFromDocx(sourceFilePath);
      // Also extract styles from DOCX (non-fatal if this fails)
      try {
        extractedStyles = await extractStylesFromDocx(sourceFilePath);
      } catch (styleErr) {
        console.error("Style extraction failed (non-fatal):", styleErr);
      }
      try {
        extractedHtml = await extractHtmlFromDocx(sourceFilePath);
      } catch (htmlErr) {
        console.error("DOCX HTML extraction failed (non-fatal):", htmlErr);
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
      const stylesPath = join(root, ".ai_tool", "template-styles.json");
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
      type: "document",
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
      detectedType: entry.type,
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
  onProgress: (event: { type: string;[key: string]: any }) => Promise<void>
): Promise<ParseResult[]> {
  const results: ParseResult[] = new Array(templates.length);
  let currentIndex = 0;

  const templatesDir = join(root, ".ai_tool", "templates");
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
        const isDocxSource = ext === ".docx";

        // Extract text
        let extractedText: string;
        let extractedStyles: DocxStyles | null = null;
        let extractedHtml: DocxHtmlExtract | null = null;

        if (ext === ".pdf") {
          extractedText = await extractTextFromPdf(sourceFilePath);
        } else if (ext === ".docx") {
          extractedText = await extractFullTextFromDocx(sourceFilePath);
          try {
            extractedStyles = await extractStylesFromDocx(sourceFilePath);
          } catch {
            // Non-fatal
          }
          try {
            extractedHtml = await extractHtmlFromDocx(sourceFilePath);
          } catch (htmlErr) {
            console.warn(`[Batch Parse] DOCX HTML extraction failed for ${template.id} (non-fatal):`, htmlErr instanceof Error ? htmlErr.message : htmlErr);
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
          const stylesPath = join(root, ".ai_tool", "template-styles.json");
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
          type: "document",
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

  const templatesDir = join(root, ".ai_tool", "templates");
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

  const indexPath = join(root, ".ai_tool", "templates", "templates.json");

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

  const parsedFilePath = join(root, ".ai_tool", "templates", "parsed", `${templateId}.md`);

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

  const templatesDir = join(root, ".ai_tool", "templates");
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

  const templatesDir = join(root, ".ai_tool", "templates");
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

    const stylesPath = join(root, ".ai_tool", "template-styles.json");
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

  const stylesPath = join(root, ".ai_tool", "template-styles.json");

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

// Heuristic: detect if extracted text is an evidence packet front matter template.
// These templates have highly distinctive markers. If 3+ are present, classify as packet.
const PACKET_MARKERS = [
  /\bDOCUMENT\s+INDEX\b/i,
  /\bCOMES\s+NOW\b/i,
  /\bCERTIFICATE\s+OF\s+SERVICE\b/i,
  /\bAFFIRMATION\b/i,
  /\bClaim\s+No\b/i,
  /\bAppeal\s+No\b/i,
  /\bHearing\s+No\b/i,
  /\bBEFORE\s+THE\s+(HEARING|APPEALS)\s+OFFICER\b/i,
  /\bIndustrial\s+Insurance\s+Claim\b/i,
  /\bClaimant\b/i,
];

function isPacketTemplate(extractedText: string): boolean {
  let matchCount = 0;
  for (const marker of PACKET_MARKERS) {
    if (marker.test(extractedText)) {
      matchCount++;
      if (matchCount >= 3) return true;
    }
  }
  return false;
}

function detectPleadingLineNumbers(extractedText: string, extractedHtml?: string | null): boolean {
  const htmlText = (extractedHtml ?? "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ");
  const allText = `${extractedText}\n${htmlText}`;
  const normalizedLines = allText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const standaloneLineNumbers = normalizedLines.filter((line) => /^\d{1,3}$/.test(line)).length;
  const gutterAlignedLines = normalizedLines.filter((line) => /^\d{1,3}\s{2,}\S/.test(line)).length;
  const shortNumberHeadings = normalizedLines.filter((line) => /^\d{1,3}\s*\S{1,30}$/.test(line)).length;
  const repeatedStandaloneNumbers = (allText.match(/(?:^|\n)\s*\d{1,3}\s*(?:\n)/g) || []).length;
  const sequentialNumbers = Array.from(allText.matchAll(/(?:^|\n)\s*(\d{1,3})\s*(?:\n)/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value));

  let consecutiveRun = 0;
  let maxConsecutiveRun = 0;
  let previous: number | null = null;
  for (const value of sequentialNumbers) {
    if (previous !== null && value === previous + 1) {
      consecutiveRun += 1;
    } else {
      consecutiveRun = 1;
    }
    previous = value;
    if (consecutiveRun > maxConsecutiveRun) {
      maxConsecutiveRun = consecutiveRun;
    }
  }

  return Math.max(
    standaloneLineNumbers,
    gutterAlignedLines,
    shortNumberHeadings,
    repeatedStandaloneNumbers,
    maxConsecutiveRun * 2
  ) >= 8;
}

function normalizeParsedPacketTemplateIds(
  packetConfig: PacketTemplate,
  sourceTemplateId: string,
  existingPacketConfig?: PacketTemplate
): PacketTemplate {
  const legacyIds = new Set<string>();

  if (existingPacketConfig?.id) legacyIds.add(existingPacketConfig.id);
  if (Array.isArray(existingPacketConfig?.legacyPacketIds)) {
    for (const legacy of existingPacketConfig.legacyPacketIds) {
      if (legacy) legacyIds.add(legacy);
    }
  }

  packetConfig.id = sourceTemplateId;
  if (legacyIds.size > 0) {
    packetConfig.legacyPacketIds = [...legacyIds].filter((id) => id !== sourceTemplateId);
  } else {
    delete packetConfig.legacyPacketIds;
  }

  return packetConfig;
}

// Analyze extracted text to produce structured PacketTemplate metadata
async function analyzePacketTemplateWithAI(
  rawText: string,
  templateName: string
): Promise<PacketTemplateAnalysisResult> {
  // Provide the built-in AO template as a reference example so the AI
  // understands the expected output format — especially genericized text.
  const referenceExample = JSON.stringify({
    heading: "BEFORE THE APPEALS OFFICER",
    captionPreambleLines: ["In the Matter of the Contested", "Industrial Insurance Claim of"],
    captionFields: [
      { label: "Claim No.:", key: "claimNumber" },
      { label: "Appeal No.:", key: "hearingNumber" },
      { label: "Date/Time:", key: "hearingDateTime" },
      { label: "Appearance:", key: "appearance" },
    ],
    extraSections: [{ title: "ISSUE ON APPEAL", key: "issueOnAppeal" }],
    indexTitle: "DOCUMENT INDEX",
    counselPreamble: "COMES NOW, {{claimantName}}, by and through counsel, and submits the attached documentation for consideration in the above-cited matter.",
    affirmationTitle: "AFFIRMATION",
    affirmationText: "Pursuant to NRS 239B, the undersigned affirms the attached documents do not expose the personal information of any person.",
    certTitle: "CERTIFICATE OF SERVICE",
    certIntro: "I certify that a true and correct copy of the foregoing Claimant Document Index was served on the following:",
    firmBlockPosition: "header",
    signerBlockAlign: "right",
  }, null, 2);

  const prompt = `You are analyzing a legal evidence packet front matter template to extract its REUSABLE STRUCTURE. The goal is to create a template that works for ANY case — all case-specific names, numbers, addresses, and dates must be removed.

TEMPLATE NAME: ${templateName}

RAW EXTRACTED TEXT:
${rawText}

---

REFERENCE EXAMPLE (shows the expected format for an Appeals Officer template):
${referenceExample}

---

Extract the template structure into JSON. CRITICAL RULES:

**GENERICIZATION — the most important rule:**
- counselPreamble: Use {{claimantName}} for the claimant. Replace ALL attorney names, firm names, and specific references with generic language. Example: "by and through her attorneys, JASON WEINSTOCK, ESQ., of LAW OFFICE..." becomes "by and through counsel"
- affirmationText: Keep it generic. Do NOT reference specific case numbers or field values. Just describe the legal affirmation. Example: "filed in Appeal No.: 12345" becomes just the affirmation statement without the case number.
- certIntro: Replace ALL firm names, attorney names, and specific addresses (except court/agency addresses which are standard). Example: "an employee of the Law Office of Jason Weinstock" becomes "an employee of counsel"
- NEVER include hardcoded attorney names, firm names, bar numbers, or case-specific numbers in any text field

**FIELDS:**
- "heading": Main heading (e.g. "BEFORE THE HEARING OFFICER" or "BEFORE THE APPEALS OFFICER")
- "captionPreambleLines": Lines above the claimant name on the left side of the caption
- "captionFields": Array of {label, key} for the right-side fields. Use standard camelCase keys: claimNumber, hearingNumber, hearingDateTime, appearance. If the template uses "Appeal No." instead of "Hearing No.", still use key "hearingNumber". Only include fields with a label and value area — do NOT include "Employer:" unless it appears as a right-side field with an input area.
- "extraSections": ONLY sections where the USER FILLS IN VARIABLE TEXT per case (e.g. "ISSUE ON APPEAL" where the specific issue changes). Do NOT include fixed boilerplate sections like WITNESSES, DURATION, or any section with standard text that doesn't change per case. Empty array if none.
- "indexTitle": The heading for the document index section. This should be something like "DOCUMENT INDEX" — NOT column headers like "DATE / DOCUMENTS / PAGE NO(S)".
- "counselPreamble": The opening paragraph (genericized as described above)
- "affirmationTitle": Title of the affirmation/certification section
- "affirmationText": The affirmation paragraph (genericized, no case numbers)
- "certTitle": Title of certificate of service/mailing section
- "certIntro": The certificate intro paragraph (genericized as described above)
- "firmBlockPosition": "header" if attorney info appears at page top, "signature" if only in signature block
- "signerBlockAlign": "left" or "right" for the signature block position

**SAMPLE VALUES (for post-processing cleanup):**
- "sampleClaimantName": The actual claimant name in the document
- "sampleAttorneyNames": Array of attorney names found
- "sampleFirmName": The law firm name found
- "sampleCaptionValues": Object mapping caption field keys to actual values shown

Respond with ONLY valid JSON, no markdown fences.`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Packet template analysis returned no text content");
  }

  const jsonText = textBlock.text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse packet template analysis as JSON");
  }

  const id = `custom-${Date.now()}`;
  const captionFields = Array.isArray(extracted.captionFields)
    ? extracted.captionFields.map((f: any) => ({ label: String(f?.label || ""), key: String(f?.key || "") }))
    : [];

  // Filter extraSections: exclude well-known boilerplate sections
  const BOILERPLATE_SECTIONS = new Set(["witnesses", "duration", "exhibits", "summary"]);
  const rawExtraSections = Array.isArray(extracted.extraSections)
    ? extracted.extraSections
      .map((s: any) => ({ title: String(s?.title || ""), key: String(s?.key || "") }))
      .filter((s) => s.title && s.key && !BOILERPLATE_SECTIONS.has(s.key.toLowerCase()))
    : [];

  // Validate indexTitle — if it looks like column headers, fall back to "DOCUMENT INDEX"
  let indexTitle = String(extracted.indexTitle || "DOCUMENT INDEX");
  if (!/index/i.test(indexTitle) || /\bDATE\b/i.test(indexTitle)) {
    indexTitle = "DOCUMENT INDEX";
  }

  const template: PacketTemplate = {
    id,
    name: templateName,
    heading: String(extracted.heading || "BEFORE THE HEARING OFFICER"),
    captionPreambleLines: Array.isArray(extracted.captionPreambleLines)
      ? extracted.captionPreambleLines.map(String)
      : ["In the Matter of the Contested", "Industrial Insurance Claim of"],
    captionFields,
    extraSections: rawExtraSections,
    indexTitle,
    counselPreamble: String(extracted.counselPreamble || ""),
    affirmationTitle: String(extracted.affirmationTitle || "AFFIRMATION"),
    affirmationText: String(extracted.affirmationText || ""),
    certTitle: String(extracted.certTitle || "CERTIFICATE OF SERVICE"),
    certIntro: String(extracted.certIntro || ""),
    sourceFile: templateName,
    firmBlockPosition: String(extracted.firmBlockPosition || "").trim().toLowerCase() === "signature"
      ? "signature"
      : "header",
    signerBlockAlign: String(extracted.signerBlockAlign || "").trim().toLowerCase() === "left"
      ? "left"
      : "right",
  };

  // --- Post-processing: scrub any remaining case-specific values ---
  const sampleName = typeof extracted.sampleClaimantName === "string"
    ? extracted.sampleClaimantName.trim()
    : "";
  const sampleFirmName = typeof extracted.sampleFirmName === "string"
    ? extracted.sampleFirmName.trim()
    : "";

  // Heuristic: verify firmBlockPosition by checking the raw text.
  // If the firm/attorney name appears BEFORE the main heading ("BEFORE THE"),
  // it's genuinely in a header position. Otherwise, override to "signature".
  if (template.firmBlockPosition === "header" && sampleFirmName) {
    const headingIdx = rawText.search(/BEFORE\s+THE\s+(HEARING|APPEALS)\s+OFFICER/i);
    const firmIdx = rawText.indexOf(sampleFirmName);
    // Firm name must appear before the heading to be a true header position
    if (headingIdx >= 0 && (firmIdx < 0 || firmIdx > headingIdx)) {
      template.firmBlockPosition = "signature";
    }
  }
  const sampleAttorneyNames: string[] = Array.isArray(extracted.sampleAttorneyNames)
    ? extracted.sampleAttorneyNames.filter((n: unknown) => typeof n === "string" && (n as string).trim()).map((n: unknown) => String(n).trim())
    : [];
  const sampleCaptionValues: Record<string, string> =
    extracted.sampleCaptionValues && typeof extracted.sampleCaptionValues === "object"
      ? Object.fromEntries(
        Object.entries(extracted.sampleCaptionValues as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string" && (v as string).trim())
          .map(([k, v]) => [k, String(v).trim()])
      )
      : {};

  const textFields: Array<"counselPreamble" | "affirmationText" | "certIntro"> = [
    "counselPreamble", "affirmationText", "certIntro",
  ];

  // Replace hardcoded claimant name with {{claimantName}}
  if (sampleName) {
    const namePattern = new RegExp(sampleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const field of textFields) {
      template[field] = (template[field] ?? "").replace(namePattern, "{{claimantName}}");
    }
  }

  // Replace hardcoded firm name with "counsel" / generic reference
  if (sampleFirmName) {
    const firmPattern = new RegExp(sampleFirmName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const field of textFields) {
      template[field] = (template[field] ?? "").replace(firmPattern, "counsel");
    }
  }

  // Replace hardcoded attorney names
  for (const attorneyName of sampleAttorneyNames) {
    if (!attorneyName || attorneyName.length < 3) continue;
    const attyPattern = new RegExp(attorneyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const field of textFields) {
      template[field] = (template[field] ?? "").replace(attyPattern, "counsel");
    }
  }

  // Replace hardcoded caption values (case numbers, etc.)
  for (const [key, value] of Object.entries(sampleCaptionValues)) {
    if (!value) continue;
    const valuePattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    template.affirmationText = (template.affirmationText ?? "").replace(valuePattern, `{{${key}}}`);
    template.certIntro = (template.certIntro ?? "").replace(valuePattern, `{{${key}}}`);
  }

  // Replace hardcoded dates in certIntro
  if (template.certIntro) {
    template.certIntro = template.certIntro
      .replace(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*\d{4}\b/gi,
        "___"
      )
      .replace(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*,?\s*\d{4}\b/gi,
        "___"
      );
  }

  // Clean up any double-genericized artifacts (e.g. "counsel, ESQ., and counsel, ESQ., of counsel")
  for (const field of textFields) {
    let text = template[field] ?? "";
    // Collapse patterns like "counsel, ESQ.," or "counsel, Esq." to just "counsel"
    text = text.replace(/counsel,?\s*ESQ\.?,?/gi, "counsel");
    // Collapse "by and through her/his attorneys, counsel and counsel, of counsel" patterns
    text = text.replace(/(?:her|his|their)\s+attorneys?,\s*counsel\s+and\s+counsel,\s*of\s+counsel/gi, "counsel");
    // Simpler: "counsel and counsel" -> "counsel"
    text = text.replace(/counsel\s+and\s+counsel/gi, "counsel");
    // "of counsel," -> "of counsel"
    text = text.replace(/,\s*of\s+counsel/gi, "");
    // "an employee of counsel" is correct — keep it
    template[field] = text;
  }

  // Keep extracted exemplar values for DOCX HTML genericization.
  return {
    template,
    sampleClaimantName: sampleName,
    sampleFirmName: sampleFirmName,
    sampleAttorneyNames,
    sampleCaptionValues,
  };
}

// Reindex meta with semantic tags
app.post("/reindex-meta", async (c) => {
  const { root } = await c.req.json();
  if (!root) {
    return c.json({ error: "root required" }, 400);
  }

  try {
    const knowledgeDir = join(root, ".ai_tool", "knowledge");
    const manifestPath = join(knowledgeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    const tagInputs: Array<{ filename: string; title: string; content: string }> = [];
    for (const section of manifest.sections || []) {
      const filename = section.filename;
      if (!filename) continue;
      try {
        const content = await readFile(join(knowledgeDir, filename), "utf-8");
        tagInputs.push({ filename, title: section.title || filename, content });
      } catch { /* skip */ }
    }

    // Generate per-section tags and holistic summary in parallel
    const [tagsMap, knowledgeSummary] = tagInputs.length > 0
      ? await Promise.all([
        generateTagsForAllSections(tagInputs),
        generateKnowledgeSummary(tagInputs),
      ])
      : [new Map(), ""];

    // Build section entries
    const manifestMtime = (await stat(manifestPath)).mtimeMs;
    const sectionMtimes: Record<string, number> = {};
    const sections: Array<any> = [];

    for (const section of manifest.sections || []) {
      const filename = section.filename;
      if (!filename) continue;
      try {
        const st = await stat(join(knowledgeDir, filename));
        sectionMtimes[filename] = st.mtimeMs;
      } catch { /* skip */ }
      const content = await readFile(join(knowledgeDir, filename), "utf-8").catch(() => "");
      const tags = tagsMap.get(filename);
      sections.push({
        id: section.id,
        title: section.title || filename,
        filename,
        path: `.ai_tool/knowledge/${filename}`,
        preview: content.replace(/\s+/g, " ").trim().slice(0, 420),
        char_count: content.length,
        ...(tags ? { topics: tags.topics, applies_to: tags.applies_to, summary: tags.summary } : {}),
      });
    }

    const metaIndex: Record<string, any> = {
      indexed_at: new Date().toISOString(),
      source: ".ai_tool/knowledge/manifest.json",
      source_mtime: manifestMtime,
      practice_area: manifest.practiceArea,
      jurisdiction: manifest.jurisdiction,
      section_count: sections.length,
      sections,
      section_mtimes: sectionMtimes,
      has_semantic_tags: tagsMap.size > 0,
    };
    if (knowledgeSummary) {
      metaIndex.knowledge_summary = knowledgeSummary;
    }

    const metaIndexPath = join(knowledgeDir, "meta_index.json");
    await writeFile(metaIndexPath, JSON.stringify(metaIndex, null, 2));

    clearKnowledgeCache(root);

    return c.json({
      success: true,
      section_count: sections.length,
      tagged_count: tagsMap.size,
      has_summary: !!knowledgeSummary,
    });
  } catch (error) {
    console.error("Reindex meta error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// ============================================================================
// PACKET TEMPLATE LISTING (unified with doc-templates)
// ============================================================================

// List packet templates: built-in + auto-detected from doc-templates index
app.get("/packet-templates", async (c) => {
  const root = c.req.query("root");
  if (!root) return c.json({ error: "root query param required" }, 400);

  try {
    const indexPath = join(root, ".ai_tool", "templates", "templates.json");
    let customPackets: PacketTemplate[] = [];

    try {
      const indexContent = await readFile(indexPath, "utf-8");
      const index: TemplatesIndex = JSON.parse(indexContent);
      customPackets = index.templates
        .filter((t) => t.type === "packet" && t.packetConfig)
        .map((t) => t.packetConfig!);
    } catch {
      // No index yet
    }

    const all = [...BUILT_IN_TEMPLATES, ...customPackets];
    return c.json({ templates: all });
  } catch (error) {
    console.error("List packet templates error:", error);
    return c.json({ error: "Failed to list packet templates" }, 500);
  }
});

/**
 * Load document templates for agent context.
 * Returns a formatted string describing available templates.
 */
export async function loadDocumentTemplates(firmRoot: string): Promise<string> {
  const indexPath = join(firmRoot, ".ai_tool", "templates", "templates.json");

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

To use a template, read .ai_tool/templates/parsed/{id}.md for the template content.`;
  } catch {
    return "";
  }
}

export default app;
