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
  "evidence_packet",
  "demand_letter",
  "case_memo",
  "settlement",
  "general_reference",
  "case_evaluation",
  "indexing",
  "case_management",
  "medical_treatment",
  "benefits_calculation",
  "litigation",
  "client_communication",
] as const;

const MODEL_PRIMARY = "openai/gpt-oss-120b";
const MODEL_FALLBACK = "openai/gpt-oss-20b";
const CONCURRENCY = 5;

const SYSTEM_PROMPT = `You are a classifier for law firm knowledge base sections. Given a section title and content, output a JSON object with exactly these fields:

- "topics": array of 2-6 short lowercase kebab-case topic tags (e.g. "document-ordering", "hearing-procedures", "medical-records")
- "applies_to": array of workflow identifiers this section provides SUBSTANTIVE GUIDANCE for. Only include a workflow if this section contains detailed instructions, rules, or procedures for that workflow — not if it merely mentions the workflow in passing.
  Valid values: ${APPLIES_TO_ENUM.join(", ")}
- "summary": a single sentence (max 120 chars) describing what this section is FOR — what a practitioner would use it to accomplish.

Output ONLY valid JSON, no markdown fences, no explanation.`;

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
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Section title: ${title}\n\nContent:\n${content}` },
    ],
  });
  return response.choices?.[0]?.message?.content || "";
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
    let text: string;
    try {
      text = await callGroq(title, content, MODEL_PRIMARY);
    } catch {
      text = await callGroq(title, content, MODEL_FALLBACK);
    }

    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

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
    console.warn(
      `[knowledge-tagger] Failed to generate tags for "${title}":`,
      err instanceof Error ? err.message : err
    );
    return fallback;
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
