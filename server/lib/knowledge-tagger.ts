/**
 * Knowledge Section Semantic Tagger
 *
 * Uses Groq GPT-OSS 120B to generate semantic tags (topics, applicable workflows,
 * summary) for each knowledge section. Tags are stored in meta_index.json and used
 * for precise section lookups instead of regex guessing.
 */

import { getGroqClient } from "./groq-client";

export interface SectionSemanticTags {
  topics: string[];
  applies_to: string[];
  summary: string;
}

const APPLIES_TO_ENUM = [
  "financial_review",
  "medical_review",
  "estate_plan",
  "family_plan",
  "business_admin",
  "care_coordination",
  "general_reference",
] as const;

const MODEL_PRIMARY = "openai/gpt-oss-120b";
const MODEL_FALLBACK = "openai/gpt-oss-20b";
const CONCURRENCY = 5;

const SYSTEM_PROMPT = `You are a classifier for a general-purpose personal/family/business assistant knowledge base.

Output only plain text in this exact format:

topics: <comma-separated tags>
applies_to: <comma-separated workflow ids>
summary: <single sentence summary>

- topics must be 2-6 short lowercase kebab-case tags (e.g. document-ordering, hearing-procedures, medical-records)
- topics must be 2-6 short lowercase kebab-case tags (e.g. care-coordination, estate-documents, financial-review)
- applies_to must be one or more values from this list only:
  ${APPLIES_TO_ENUM.join(", ")}
- summary is one short sentence (max 120 chars) explaining what this section is for

Use only these three lines. No markdown fences, no JSON, no extra fields.`;

async function callGroq(
  title: string,
  content: string,
  model: string
): Promise<string> {
  const groq = getGroqClient();
  const response = await groq.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Section title: ${title}\n\nContent:\n${content}` },
    ],
  });
  return response.choices?.[0]?.message?.content || "";
}

function getGroqErrorDetails(err: unknown): { code?: string; message?: string; failedGeneration?: string } {
  const candidate = err as {
    error?: { code?: string; message?: string; failed_generation?: string };
    code?: string;
    message?: string;
  };
  return {
    code: candidate?.error?.code || candidate?.code,
    message: candidate?.error?.message || candidate?.message,
    failedGeneration: candidate?.error?.failed_generation,
  };
}

function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseTagPayload(raw: string): {
  topics: string[];
  applies_to: string[];
  summary: string;
} {
  const sanitized = raw.replace(/```[a-zA-Z]*\s*$/gm, "").replace(/```$/gm, "").trim();
  const lines = sanitized.split(/\r?\n/);
  const buckets: Record<"topics" | "applies_to" | "summary", string[]> = {
    topics: [],
    applies_to: [],
    summary: [],
  };
  let current: keyof typeof buckets | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current === "summary") current = null;
      continue;
    }

    const headingMatch = trimmed.match(
      /^(topics|applies_to|summary)\s*:\s*(.*)$/i
    );
    if (headingMatch) {
      const key = headingMatch[1].toLowerCase() as keyof typeof buckets;
      current = key;
      const initial = headingMatch[2].trim();
      if (initial) buckets[key].push(initial);
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s*(.+)$/);
    if (bullet && current && current !== "summary") {
      buckets[current].push(bullet[1].trim());
      continue;
    }

    if (current === "summary") {
      buckets.summary.push(trimmed);
    }
  }

  const topics = splitCommaList(buckets.topics.join(","))
    .filter((topic) => topic.length > 0)
    .slice(0, 8);

  const applies_to = splitCommaList(buckets.applies_to.join(","))
    .filter((value) => (APPLIES_TO_ENUM as readonly string[]).includes(value))
    .slice(0, 12);

  const summary = buckets.summary.join(" ").replace(/\s+/g, " ").trim().slice(0, 200) || "";

  return {
    topics,
    applies_to: applies_to.length > 0 ? applies_to : ["general_reference"],
    summary,
  };
}

async function generateTagsWithRetry(title: string, content: string): Promise<string> {
  const attempts: string[] = [MODEL_PRIMARY, MODEL_FALLBACK];

  let lastErr: unknown = null;
  for (const model of attempts) {
    try {
      return await callGroq(title, content, model);
    } catch (err) {
      lastErr = err;
      const details = getGroqErrorDetails(err);
      console.warn(
        `[knowledge-tagger] Failed to run tags model for "${title}" using ${model}:`,
        JSON.stringify({
          code: details.code,
          message: details.message,
          failed_generation: details.failedGeneration || "",
        })
      );
      continue;
    }
  }

  throw lastErr;
}

export async function generateSectionTags(
  title: string,
  content: string
): Promise<SectionSemanticTags> {
  const fallback: SectionSemanticTags = {
    topics: [],
    applies_to: ["general_reference"],
    summary: title,
  };

  try {
    const text = await generateTagsWithRetry(title, content);
    const parsed = parseTagPayload(text);

    return {
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.filter((t: any) => typeof t === "string").slice(0, 8)
        : [],
      applies_to: Array.isArray(parsed.applies_to)
        ? parsed.applies_to.filter(
            (v: any) =>
              typeof v === "string" &&
              (APPLIES_TO_ENUM as readonly string[]).includes(v)
          )
        : ["general_reference"],
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 200)
          : title,
    };
  } catch (err) {
    const details = getGroqErrorDetails(err);
    if (details.code) {
      console.warn(
        `[knowledge-tagger] Failed to generate tags for "${title}":`,
        JSON.stringify({
          code: details.code,
          message: details.message,
          failed_generation: details.failedGeneration || "",
        })
      );
    }
    console.warn(
      `[knowledge-tagger] Failed to generate tags for "${title}":`,
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are a knowledge summarizer. Given the full text of all knowledge sections, produce a concise, unified reference summary in markdown.

Requirements:
- Summarize the most important rules, thresholds, deadlines, and formulas across ALL sections
- Use markdown bullet points, organize by topic
- No redundancy — state each fact exactly once
- Include specific numbers, percentages, and time limits
- After the summary, add a "### Definitive Sources" section mapping key topics to their source filenames so the agent knows where to read_file for full detail
- Target approximately 600-700 words (~3000-4000 characters)
- Output ready-to-render markdown — no JSON wrapping, no code fences, no explanation prefix`;

/**
 * Generate a holistic knowledge summary across ALL sections.
 * One Groq call reads all sections and produces a unified markdown summary.
 * Returns raw markdown string (empty string on error).
 */
export async function generateKnowledgeSummary(
  sections: Array<{ filename: string; title: string; content: string }>
): Promise<string> {
  if (sections.length === 0) return "";

  const concatenated = sections
    .map((s) => `=== Section: ${s.title} (${s.filename}) ===\n${s.content}`)
    .join("\n\n---\n\n");

  const groq = getGroqClient();

  async function callSummary(model: string): Promise<string> {
    const response = await groq.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: concatenated },
      ],
    });
    return response.choices?.[0]?.message?.content || "";
  }

  try {
    let result: string;
    try {
      result = await callSummary(MODEL_PRIMARY);
    } catch {
      result = await callSummary(MODEL_FALLBACK);
    }
    return result.trim();
  } catch (err) {
    console.warn(
      "[knowledge-tagger] Failed to generate knowledge summary:",
      err instanceof Error ? err.message : err
    );
    return "";
  }
}

export async function generateTagsForAllSections(
  sections: Array<{ filename: string; title: string; content: string }>
): Promise<Map<string, SectionSemanticTags>> {
  const results = new Map<string, SectionSemanticTags>();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < sections.length; i += CONCURRENCY) {
    const batch = sections.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (section) => {
        const tags = await generateSectionTags(section.title, section.content);
        return { filename: section.filename, tags };
      })
    );
    for (const { filename, tags } of batchResults) {
      results.set(filename, tags);
    }
  }

  return results;
}
