/**
 * Groq Extraction Functions
 *
 * Replaces all Anthropic API calls in the indexing pipeline with Groq models:
 * - extractWithGptOss: Text-based PDF extraction (Path 1) via GPT-OSS 120B
 * - extractWithVision: Scanned PDF extraction (Path 2) via Llama 4 Scout → Maverick fallback
 * - generateHypergraphWithGptOss: Cross-document consistency analysis via GPT-OSS 120B
 * - generateCaseSummaryWithGptOss: Case summary generation via GPT-OSS 120B
 */

import { getGroqClient } from "./groq-client";
import { pdfToImages, getPdfPageCount, type PdfPageImage } from "./pdftoppm";
import { FILE_EXTRACTION_TOOL_SCHEMA } from "./index-schema";

// ============================================================================
// Types
// ============================================================================

export interface GroqUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ExtractionResult {
  type: string;
  key_info: string;
  has_handwritten_data: boolean;
  handwritten_fields: string[];
  extracted_data: Record<string, unknown>;
}

// ============================================================================
// Model Constants & Rate Limit Tracking
// ============================================================================

const TEXT_PRIMARY = "openai/gpt-oss-120b";
const TEXT_FALLBACK = "openai/gpt-oss-20b";

const VISION_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
const VISION_MAVERICK = "meta-llama/llama-4-maverick-17b-128e-instruct";

/** Conservative estimate of tokens per text extraction call */
const ESTIMATED_TEXT_TOKENS = 8_000;
/** Conservative estimate of tokens per vision call (images are token-heavy) */
const ESTIMATED_VISION_TOKENS = 20_000;

/** Adaptive vision quality targets */
const MAX_VISION_PAGES = 5;
const VISION_DPI_HIGH = 150;
const VISION_DPI_MEDIUM = 120;
const VISION_DPI_LOW = 100;
const SIZE_BASED_DPI_SAMPLES = [
  { maxFileMB: 4, dpi: VISION_DPI_HIGH },
  { maxFileMB: 10, dpi: VISION_DPI_MEDIUM },
  { maxFileMB: 20, dpi: VISION_DPI_LOW },
];

/** Per-model rate limit state, updated from Groq response headers */
const rateLimitState: Record<string, { remainingTokens: number; resetAt: number }> = {};

function updateRateLimitState(model: string, headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining-tokens");
  const resetMs = headers.get("x-ratelimit-reset-tokens");

  if (remaining !== null) {
    const resetAt = resetMs
      ? Date.now() + parseResetDuration(resetMs)
      : Date.now() + 60_000; // default 60s window

    rateLimitState[model] = {
      remainingTokens: parseInt(remaining, 10),
      resetAt,
    };
  }
}

/** Parse Groq reset duration like "1m30s", "45s", "2m" into milliseconds */
function parseResetDuration(value: string): number {
  let ms = 0;
  const minMatch = value.match(/(\d+)m/);
  const secMatch = value.match(/(\d+(?:\.\d+)?)s/);
  if (minMatch) ms += parseInt(minMatch[1], 10) * 60_000;
  if (secMatch) ms += parseFloat(secMatch[1]) * 1_000;
  return ms || 60_000;
}

function shouldUseFallback(model: string, estimatedTokens: number = ESTIMATED_VISION_TOKENS): boolean {
  const state = rateLimitState[model];
  if (!state) return false;

  // If the reset window has passed, state is stale — don't fallback
  if (Date.now() > state.resetAt) return false;

  return state.remainingTokens < estimatedTokens;
}

// ============================================================================
// Schema Helpers
// ============================================================================

/**
 * Convert the FILE_EXTRACTION_TOOL_SCHEMA into a JSON description for embedding
 * in the system prompt (GPT-OSS json_object mode doesn't support json_schema).
 */
function buildExtractionSchemaDescription(): string {
  const props = FILE_EXTRACTION_TOOL_SCHEMA.input_schema.properties;
  const lines: string[] = [
    "You MUST return a JSON object with exactly these top-level fields:",
    "",
  ];

  for (const [key, schema] of Object.entries(props)) {
    const s = schema as any;
    let desc = s.description || "";
    if (s.enum) desc += ` (one of: ${s.enum.join(", ")})`;
    if (s.type === "array") desc += " (array of strings)";
    lines.push(`- "${key}" (${s.type}): ${desc}`);
  }

  lines.push("");
  lines.push("The extracted_data object should contain any specific data points found in the document,");
  lines.push("such as: client_name, dob, phone, email, address, dol, document_date,");
  lines.push("document_date_confidence, document_date_reason, insurance_1p, insurance_3p,");
  lines.push("health_insurance, provider_name, service_dates, charges, balance, diagnosis,");
  lines.push("treatment_summary, settlement_amount, demand_amount, etc.");

  return lines.join("\n");
}

/**
 * Build a JSON Schema object for vision models (best-effort json_schema mode).
 */
function buildVisionJsonSchema(): Record<string, any> {
  return {
    name: "document_extraction",
    strict: false,
    schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Document type classification" },
        key_info: { type: "string", description: "2-3 sentence summary" },
        has_handwritten_data: { type: "boolean" },
        handwritten_fields: { type: "array", items: { type: "string" } },
        extracted_data: {
          type: "object",
          description: "Structured data extracted from the document",
        },
      },
      required: ["type", "key_info", "has_handwritten_data", "handwritten_fields", "extracted_data"],
    },
  };
}

// ============================================================================
// Path 1: Text Extraction with GPT-OSS 120B → 20B Fallback
// ============================================================================

/**
 * Make a single GPT-OSS API call with a specific model.
 * Returns the parsed response and updates rate limit state from headers.
 */
async function callTextModel(
  modelId: string,
  messages: any[],
): Promise<{ content: string; usage: GroqUsage; model: string }> {
  const groq = getGroqClient();

  const { data: response, response: rawResponse } = await groq.chat.completions.create({
    model: modelId,
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    messages,
  }).withResponse();

  // Update rate limit state from response headers
  updateRateLimitState(modelId, rawResponse.headers);

  const modelShort = modelId.includes("120b") ? "120b" : "20b";
  return {
    content: response.choices[0]?.message?.content || "{}",
    usage: {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    },
    model: modelShort,
  };
}

/**
 * Make a GPT-OSS API call with 120B → 20B fallback.
 * 1. If proactive check says 120B is low on tokens → go straight to 20B
 * 2. Try 120B; on 429 → switch to 20B
 * 3. Try 20B; on 429 → wait retry-after, then retry 20B once
 * 4. On timeout → retry same model once
 */
async function callTextWithFallback(
  messages: any[],
  filename: string,
): Promise<{ content: string; usage: GroqUsage; model: string }> {
  // Proactive check: if 120B is known to be low, skip straight to 20B
  const skip120b = shouldUseFallback(TEXT_PRIMARY, ESTIMATED_TEXT_TOKENS);
  if (skip120b) {
    console.log(`[GPT-OSS] ${filename}: 120B low on tokens, using 20B`);
  }

  const primaryModel = skip120b ? TEXT_FALLBACK : TEXT_PRIMARY;

  try {
    return await callTextModel(primaryModel, messages);
  } catch (err: any) {
    const status = err?.status || err?.statusCode;
    const isTimeout = err?.name === "APIConnectionTimeoutError" || err?.code === "ETIMEDOUT" || err?.message?.includes("timed out");

    // Timeout → retry same model once
    if (isTimeout) {
      console.log(`[GPT-OSS] ${filename}: ${primaryModel.includes("120b") ? "120B" : "20B"} timeout, retrying`);
      await sleep(3000);
      return await callTextModel(primaryModel, messages);
    }

    if (status !== 429) throw err; // non-rate-limit error — propagate

    // If we already tried 20B, wait and retry once
    if (primaryModel === TEXT_FALLBACK) {
      const retryAfter = parseRetryAfter(err?.headers?.["retry-after"] ?? null);
      console.log(`[GPT-OSS] ${filename}: 20B 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return await callTextModel(TEXT_FALLBACK, messages);
    }

    // 120B 429 → fall back to 20B
    console.log(`[GPT-OSS] ${filename}: 120B 429, falling back to 20B`);
    try {
      return await callTextModel(TEXT_FALLBACK, messages);
    } catch (fallbackErr: any) {
      const fallbackStatus = fallbackErr?.status || fallbackErr?.statusCode;
      if (fallbackStatus !== 429) throw fallbackErr;

      // 20B also 429 → wait and retry once
      const retryAfter = parseRetryAfter(fallbackErr?.headers?.["retry-after"] ?? null);
      console.log(`[GPT-OSS] ${filename}: 20B also 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return await callTextModel(TEXT_FALLBACK, messages);
    }
  }
}

/**
 * Extract structured data from pre-extracted document text using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
export async function extractWithGptOss(
  text: string,
  filename: string,
  folder: string,
  systemPrompt: string
): Promise<{ result: ExtractionResult; usage: GroqUsage }> {
  const schemaDesc = buildExtractionSchemaDescription();

  const messages = [
    {
      role: "system" as const,
      content: `${systemPrompt}

## OUTPUT FORMAT

You must respond with a single JSON object. No markdown, no explanation, no text outside the JSON.

${schemaDesc}`,
    },
    {
      role: "user" as const,
      content: `Extract information from this document.

FILENAME: ${filename}
FOLDER: ${folder}

DOCUMENT TEXT:
${text}

CRITICAL:
- Include extracted_data.document_date for this specific document's own date.
- If multiple dates appear, include extracted_data.document_date_confidence and extracted_data.document_date_reason.
- Set has_handwritten_data to true only for substantive handwritten extracted values (exclude signature/initial-only markings).
- Include handwritten_fields as non-signature extracted field names that are handwritten (use [] when none).

Return the JSON extraction now.`,
    },
  ];

  const { content, usage } = await callTextWithFallback(messages, filename);
  const parsed = JSON.parse(content);

  return {
    result: {
      type: parsed.type || "other",
      key_info: parsed.key_info || "",
      has_handwritten_data: parsed.has_handwritten_data === true,
      handwritten_fields: Array.isArray(parsed.handwritten_fields) ? parsed.handwritten_fields : [],
      extracted_data: parsed.extracted_data || {},
    },
    usage,
  };
}

// ============================================================================
// Path 2: Vision Extraction with Scout → Maverick Fallback
// ============================================================================

/**
 * Make a single vision API call with a specific model.
 * Returns the parsed response and updates rate limit state from headers.
 */
async function callVisionModel(
  modelId: string,
  messages: any[],
): Promise<{ content: string; usage: GroqUsage; model: string }> {
  const groq = getGroqClient();

  const { data: response, response: rawResponse } = await groq.chat.completions.create({
    model: modelId,
    temperature: 0.1,
    max_tokens: 6000,
    response_format: {
      type: "json_schema",
      json_schema: buildVisionJsonSchema(),
    } as any,
    messages,
  }).withResponse();

  // Update rate limit state from response headers
  updateRateLimitState(modelId, rawResponse.headers);

  const modelShort = modelId.includes("scout") ? "scout" : "maverick";
  return {
    content: response.choices[0]?.message?.content || "{}",
    usage: {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    },
    model: modelShort,
  };
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse retry-after header value (seconds) */
function parseRetryAfter(value: string | null): number {
  if (!value) return 5;
  const n = parseFloat(value);
  return isNaN(n) ? 5 : n;
}

/**
 * Make a vision API call with Scout → Maverick fallback.
 * 1. If proactive check says Scout is low on tokens → go straight to Maverick
 * 2. Try Scout; on 429 → switch to Maverick
 * 3. Try Maverick; on 429 → wait retry-after, then retry Maverick once
 */
async function callVisionWithFallback(
  messages: any[],
  filename: string,
  batchLabel: string,
): Promise<{ content: string; usage: GroqUsage; model: string }> {
  // Proactive check: if Scout is known to be low, skip straight to Maverick
  const skipScout = shouldUseFallback(VISION_SCOUT);
  if (skipScout) {
    console.log(`[Vision] ${filename} ${batchLabel}: Scout low on tokens, using Maverick`);
  }

  const primaryModel = skipScout ? VISION_MAVERICK : VISION_SCOUT;

  try {
    return await callVisionModel(primaryModel, messages);
  } catch (err: any) {
    const status = err?.status || err?.statusCode;
    if (status !== 429) throw err; // non-rate-limit error — propagate

    // If we already tried Maverick, wait and retry once
    if (primaryModel === VISION_MAVERICK) {
      const retryAfter = parseRetryAfter(err?.headers?.["retry-after"] ?? null);
      console.log(`[Vision] ${filename} ${batchLabel}: Maverick 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return await callVisionModel(VISION_MAVERICK, messages);
    }

    // Scout 429 → fall back to Maverick
    console.log(`[Vision] ${filename} ${batchLabel}: Scout 429, falling back to Maverick`);
    try {
      return await callVisionModel(VISION_MAVERICK, messages);
    } catch (maverickErr: any) {
      const maverickStatus = maverickErr?.status || maverickErr?.statusCode;
      if (maverickStatus !== 429) throw maverickErr;

      // Maverick also 429 → wait and retry once
      const retryAfter = parseRetryAfter(maverickErr?.headers?.["retry-after"] ?? null);
      console.log(`[Vision] ${filename} ${batchLabel}: Maverick also 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return await callVisionModel(VISION_MAVERICK, messages);
    }
  }
}

/**
 * Extract structured data from a scanned PDF using vision models.
 * Uses Scout as primary with Maverick fallback on rate limits.
 * Converts PDF pages to PNG images and processes once per PDF with a max of 5 pages.
 */
export async function extractWithVision(
  pdfPath: string,
  filename: string,
  folder: string,
  fileSizeMB: number = 0,
  systemPrompt: string
): Promise<{ result: ExtractionResult; usage: GroqUsage }> {
  const totalUsage: GroqUsage = { inputTokens: 0, outputTokens: 0 };

  // Get page count
  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(pdfPath);
  } catch {
    pageCount = 1;
  }

  const pickVisionDpi = (sizeMB: number, pages: number): number => {
    if (pages <= 2 && sizeMB <= 6) return VISION_DPI_HIGH;
    if (!Number.isFinite(sizeMB) || sizeMB <= 0) return VISION_DPI_MEDIUM;
    for (const tier of SIZE_BASED_DPI_SAMPLES) {
      if (sizeMB <= tier.maxFileMB) return tier.dpi;
    }
    return VISION_DPI_LOW;
  };

  // Single API call per PDF, up to 5 pages
  const maxPages = Math.min(pageCount, MAX_VISION_PAGES);
  const PAGES_PER_BATCH = maxPages; // keep batching loop structure but this forces one batch per PDF
  const batchCount = Math.ceil(maxPages / PAGES_PER_BATCH);
  const chosenDpi = pickVisionDpi(fileSizeMB, maxPages);

  console.log(`[Vision] ${filename}: ${pageCount} pages, processing ${maxPages} (${batchCount} batch(es)), using ${chosenDpi} DPI`);

  const batchResults: ExtractionResult[] = [];

  for (let batch = 0; batch < batchCount; batch++) {
    const firstPage = batch * PAGES_PER_BATCH + 1;
    const lastPage = Math.min(firstPage + PAGES_PER_BATCH - 1, maxPages);

    // Convert pages to images once using adaptive quality.
    let images: PdfPageImage[] | null = await pdfToImages(pdfPath, firstPage, lastPage, chosenDpi);
    const totalSize = images.reduce((sum, img) => sum + img.sizeBytes, 0);
    if (totalSize > 3.5 * 1024 * 1024) {
      console.log(`[Vision] ${filename} batch ${batch + 1}: ${(totalSize / 1024 / 1024).toFixed(1)}MB at ${chosenDpi} DPI`);
    }

    // Build image content blocks, clearing base64 from each image as we go
    // to avoid holding two copies of the same data simultaneously
    let imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> | null = [];
    for (let i = 0; i < images.length; i++) {
      imageBlocks.push({
        type: "image_url" as const,
        image_url: {
          url: `data:image/jpeg;base64,${images[i].base64}`,
        },
      });
      (images[i] as any).base64 = ''; // Release original base64 immediately
    }
    images = null; // Release images array

    const pageRange = firstPage === lastPage ? `page ${firstPage}` : `pages ${firstPage}-${lastPage}`;
    const batchLabel = `batch ${batch + 1}/${batchCount}`;

    let messages: any[] | null = [
      {
        role: "system",
        content: `${systemPrompt}

You must respond with a single JSON object. No markdown, no explanation.
Required fields: type, key_info, has_handwritten_data, handwritten_fields, extracted_data.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text" as const,
            text: `Extract information from ${pageRange} of this document.

FILENAME: ${filename}
FOLDER: ${folder}

CRITICAL:
- Include extracted_data.document_date for this specific document's own date.
- If multiple dates appear, include extracted_data.document_date_confidence and extracted_data.document_date_reason.
- Set has_handwritten_data to true only for substantive handwritten extracted values.
- Include handwritten_fields as non-signature extracted field names that are handwritten (use [] when none).

Return the JSON extraction now.`,
          },
          ...imageBlocks,
        ],
      },
    ];
    imageBlocks = null; // Release imageBlocks after building messages

    try {
      const visionResult = await callVisionWithFallback(messages, filename, batchLabel);
      messages = null; // Release messages immediately after API call

      // Signal GC that significant memory was freed
      if (typeof Bun !== 'undefined' && Bun.gc) Bun.gc(false);

      const parsed = JSON.parse(visionResult.content);

      console.log(`[Vision] ${filename} ${batchLabel}: done [groq-${visionResult.model}]`);

      batchResults.push({
        type: parsed.type || "other",
        key_info: parsed.key_info || "",
        has_handwritten_data: parsed.has_handwritten_data === true,
        handwritten_fields: Array.isArray(parsed.handwritten_fields) ? parsed.handwritten_fields : [],
        extracted_data: parsed.extracted_data || {},
      });

      totalUsage.inputTokens += visionResult.usage.inputTokens;
      totalUsage.outputTokens += visionResult.usage.outputTokens;
    } catch (err) {
      messages = null; // Release messages on error path too

      // Signal GC that significant memory was freed
      if (typeof Bun !== 'undefined' && Bun.gc) Bun.gc(false);

      console.error(`[Vision] ${filename} ${batchLabel} failed:`, err);
      // Continue with remaining batches
    }
  }

  // Merge batch results
  const merged = mergeExtractions(batchResults, filename);

  return { result: merged, usage: totalUsage };
}

/**
 * Merge multiple extraction results from vision batches into a single result.
 * First batch result is the primary; later batches contribute extracted_data fields.
 */
function mergeExtractions(results: ExtractionResult[], filename: string): ExtractionResult {
  if (results.length === 0) {
    return {
      type: "other",
      key_info: `Vision extraction produced no results for ${filename}`,
      has_handwritten_data: false,
      handwritten_fields: [],
      extracted_data: {},
    };
  }

  if (results.length === 1) {
    return results[0];
  }

  // Use first batch as the base (it has the document header/type info)
  const base = { ...results[0] };
  const mergedData = { ...base.extracted_data };
  const allHandwrittenFields = new Set(base.handwritten_fields || []);
  const keyInfoParts = [base.key_info];

  for (let i = 1; i < results.length; i++) {
    const r = results[i];

    // Merge extracted_data — later batches fill in missing fields only
    for (const [key, value] of Object.entries(r.extracted_data || {})) {
      if (!(key in mergedData) && value !== null && value !== undefined && value !== "") {
        mergedData[key] = value;
      }
    }

    // Merge handwritten fields
    for (const field of r.handwritten_fields || []) {
      allHandwrittenFields.add(field);
    }

    // Append key_info if it adds new information
    if (r.key_info && !keyInfoParts.includes(r.key_info)) {
      keyInfoParts.push(r.key_info);
    }

    // If any batch detected handwritten data, the overall result should reflect it
    if (r.has_handwritten_data) {
      base.has_handwritten_data = true;
    }
  }

  return {
    type: base.type,
    key_info: keyInfoParts.join(" "),
    has_handwritten_data: allHandwrittenFields.size > 0 || base.has_handwritten_data,
    handwritten_fields: Array.from(allHandwrittenFields),
    extracted_data: mergedData,
  };
}

// ============================================================================
// Hypergraph Generation with GPT-OSS 120B → 20B Fallback
// ============================================================================

/**
 * Generate a hypergraph analysis chunk using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
export async function generateHypergraphWithGptOss(
  chunkJson: string,
  chunkId: number,
  chunkCount: number,
  systemPrompt: string
): Promise<{
  result: {
    hypergraph: Record<string, any>;
    conflicts: any[];
    summary: { total_fields_analyzed: number; fields_with_conflicts: number; confidence_score: number };
  };
  usage: GroqUsage;
}> {
  const messages = [
    {
      role: "system" as const,
      content: `${systemPrompt}

You must respond with a single JSON object. No markdown, no explanation, no text outside the JSON.`,
    },
    {
      role: "user" as const,
      content: `<document_index chunk="${chunkId}/${chunkCount}">
${chunkJson}
</document_index>

Return ONLY the JSON hypergraph for this chunk. No explanation, no planning - just the JSON object.`,
    },
  ];

  // Hypergraph uses higher max_tokens — use callTextModel directly with fallback logic
  const label = `hypergraph-${chunkId}/${chunkCount}`;
  const skip120b = shouldUseFallback(TEXT_PRIMARY, ESTIMATED_TEXT_TOKENS);
  if (skip120b) {
    console.log(`[Hypergraph] chunk ${chunkId}/${chunkCount}: 120B low on tokens, using 20B`);
  }
  const primaryModel = skip120b ? TEXT_FALLBACK : TEXT_PRIMARY;

  const callWithModel = (model: string) => {
    const groq = getGroqClient();
    return groq.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: "json_object" },
      messages,
    }).withResponse();
  };

  let content: string;
  let usage: GroqUsage;

  try {
    const { data: response, response: rawResponse } = await callWithModel(primaryModel);
    updateRateLimitState(primaryModel, rawResponse.headers);
    content = response.choices[0]?.message?.content || "{}";
    usage = { inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
  } catch (err: any) {
    const status = err?.status || err?.statusCode;
    const isTimeout = err?.name === "APIConnectionTimeoutError" || err?.code === "ETIMEDOUT" || err?.message?.includes("timed out");

    if (isTimeout) {
      console.log(`[Hypergraph] chunk ${chunkId}/${chunkCount}: timeout, retrying`);
      await sleep(5000);
      const { data: response, response: rawResponse } = await callWithModel(primaryModel);
      updateRateLimitState(primaryModel, rawResponse.headers);
      content = response.choices[0]?.message?.content || "{}";
      usage = { inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
    } else if (status === 429 && primaryModel === TEXT_PRIMARY) {
      console.log(`[Hypergraph] chunk ${chunkId}/${chunkCount}: 120B 429, falling back to 20B`);
      try {
        const { data: response, response: rawResponse } = await callWithModel(TEXT_FALLBACK);
        updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
        content = response.choices[0]?.message?.content || "{}";
        usage = { inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
      } catch (fallbackErr: any) {
        const fallbackStatus = fallbackErr?.status || fallbackErr?.statusCode;
        if (fallbackStatus === 429) {
          const retryAfter = parseRetryAfter(fallbackErr?.headers?.["retry-after"] ?? null);
          console.log(`[Hypergraph] chunk ${chunkId}/${chunkCount}: 20B also 429, waiting ${retryAfter}s`);
          await sleep(retryAfter * 1000);
          const { data: response, response: rawResponse } = await callWithModel(TEXT_FALLBACK);
          updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
          content = response.choices[0]?.message?.content || "{}";
          usage = { inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
        } else {
          throw fallbackErr;
        }
      }
    } else if (status === 429) {
      const retryAfter = parseRetryAfter(err?.headers?.["retry-after"] ?? null);
      console.log(`[Hypergraph] chunk ${chunkId}/${chunkCount}: 20B 429, waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      const { data: response, response: rawResponse } = await callWithModel(TEXT_FALLBACK);
      updateRateLimitState(TEXT_FALLBACK, rawResponse.headers);
      content = response.choices[0]?.message?.content || "{}";
      usage = { inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
    } else {
      throw err;
    }
  }

  const parsed = JSON.parse(content);

  return {
    result: {
      hypergraph: parsed.hypergraph || {},
      conflicts: parsed.conflicts || [],
      summary: parsed.summary || {
        total_fields_analyzed: 0,
        fields_with_conflicts: 0,
        confidence_score: 0,
      },
    },
    usage,
  };
}

/**
 * Generate concise conflict annotations for deterministic hypergraph review.
 *
 * Called after deterministic conflict detection to add lightweight context on
 * what to investigate (e.g., duplicate IDs, stale values, partial billing).
 */
export async function generateHypergraphConflictReviewWithGptOss(
  reviewPayload: string
): Promise<{ result: { annotations: Array<{ field: string; likely_reason: string }> }; usage: GroqUsage }> {
  const messages = [
    {
      role: "system" as const,
      content: `You are a legal case data consistency reviewer.

Only reason over the provided hypergraph candidates.

Return a single JSON object with this exact shape and no extra text:
{
  "annotations": [
    {
      "field": "<field_name>",
      "likely_reason": "<short likely explanation for why values conflict>"
    }
  ]
}

If you cannot infer a reason, return the field with a concise best-effort reason.
You can use wording like "signature date vs. loss date", "partial vs. full amount", or "source document typo".
`,
    },
    {
      role: "user" as const,
      content: reviewPayload,
    },
  ];

  const { content, usage } = await callTextWithFallback(messages, "hypergraph-review");
  const parsed = JSON.parse(content);

  return {
    result: {
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    },
    usage,
  };
}

// ============================================================================
// Case Summary Generation with GPT-OSS 120B → 20B Fallback
// ============================================================================

/**
 * Generate case summary and phase using GPT-OSS.
 * Uses 120B as primary with 20B fallback on rate limits.
 */
export async function generateCaseSummaryWithGptOss(
  condensedIndex: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{
  result: { case_summary: string; case_phase: string };
  usage: GroqUsage;
}> {
  const messages = [
    {
      role: "system" as const,
      content: `${systemPrompt}

## OUTPUT FORMAT

You must respond with a single JSON object containing exactly these fields:
- "case_summary" (string): Brief narrative summary of the case (2-4 sentences). Include incident type, injuries, treatment/procedural status, and current posture.
- "case_phase" (string): Current lifecycle phase based on documents present.

No markdown, no explanation, no text outside the JSON.`,
    },
    {
      role: "user" as const,
      content: userPrompt,
    },
  ];

  const { content, usage } = await callTextWithFallback(messages, "case-summary");
  const parsed = JSON.parse(content);

  return {
    result: {
      case_summary: parsed.case_summary || "Case summary generation failed.",
      case_phase: parsed.case_phase || "Intake",
    },
    usage,
  };
}
