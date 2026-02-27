/**
 * Groq Chat Client
 *
 * Thin wrapper around getGroqClient() for chat completions.
 * - groqChat(): returns raw string response
 * - groqChatJson<T>(): returns parsed JSON response
 * - 120b primary → 20b fallback on 429
 * - Rate limit tracking reuses pattern from groq-extract.ts
 */

import { getGroqClient } from "./groq-client";

// ============================================================================
// Types
// ============================================================================

export interface GroqChatOptions {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  /** Override model (defaults to gpt-oss-120b) */
  model?: string;
}

export interface GroqChatResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

// ============================================================================
// Model Constants & Rate Limit Tracking
// ============================================================================

const PRIMARY_MODEL = "openai/gpt-oss-120b";
const FALLBACK_MODEL = "openai/gpt-oss-20b";

const ESTIMATED_CHAT_TOKENS = 10_000;

const rateLimitState: Record<string, { remainingTokens: number; resetAt: number }> = {};

function updateRateLimitState(model: string, headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining-tokens");
  const resetMs = headers.get("x-ratelimit-reset-tokens");

  if (remaining !== null) {
    const resetAt = resetMs
      ? Date.now() + parseResetDuration(resetMs)
      : Date.now() + 60_000;

    rateLimitState[model] = {
      remainingTokens: parseInt(remaining, 10),
      resetAt,
    };
  }
}

function parseResetDuration(value: string): number {
  let ms = 0;
  const minMatch = value.match(/(\d+)m/);
  const secMatch = value.match(/(\d+(?:\.\d+)?)s/);
  if (minMatch) ms += parseInt(minMatch[1], 10) * 60_000;
  if (secMatch) ms += parseFloat(secMatch[1]) * 1_000;
  return ms || 60_000;
}

function shouldUseFallback(model: string, estimatedTokens: number): boolean {
  const state = rateLimitState[model];
  if (!state) return false;
  if (Date.now() > state.resetAt) return false;
  return state.remainingTokens < estimatedTokens;
}

// ============================================================================
// Core API Call
// ============================================================================

async function callModel(
  modelId: string,
  messages: GroqChatOptions["messages"],
  maxTokens: number,
  temperature: number,
  jsonMode: boolean,
): Promise<GroqChatResult> {
  const groq = getGroqClient();

  const opts: any = {
    model: modelId,
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (jsonMode) {
    opts.response_format = { type: "json_object" };
  }

  const { data: response, response: rawResponse } = await groq.chat.completions
    .create(opts)
    .withResponse();

  updateRateLimitState(modelId, rawResponse.headers);

  return {
    content: response.choices[0]?.message?.content || "",
    model: modelId.includes("120b") ? "120b" : "20b",
    usage: {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    },
  };
}

// ============================================================================
// Fallback Logic
// ============================================================================

async function callWithFallback(
  messages: GroqChatOptions["messages"],
  maxTokens: number,
  temperature: number,
  jsonMode: boolean,
  overrideModel?: string,
): Promise<GroqChatResult> {
  if (overrideModel) {
    return callModel(overrideModel, messages, maxTokens, temperature, jsonMode);
  }

  const skip120b = shouldUseFallback(PRIMARY_MODEL, ESTIMATED_CHAT_TOKENS);
  const primaryModel = skip120b ? FALLBACK_MODEL : PRIMARY_MODEL;

  try {
    return await callModel(primaryModel, messages, maxTokens, temperature, jsonMode);
  } catch (err: any) {
    const status = err?.status || err?.statusCode;
    const isTimeout = err?.name === "APIConnectionTimeoutError" || err?.code === "ETIMEDOUT" || err?.message?.includes("timed out");

    // Timeout → retry same model once
    if (isTimeout) {
      console.log(`[groq-chat] Timeout on ${primaryModel}, retrying once`);
      return callModel(primaryModel, messages, maxTokens, temperature, jsonMode);
    }

    // 429 on primary → try fallback
    if (status === 429 && primaryModel === PRIMARY_MODEL) {
      console.log(`[groq-chat] 429 on 120b, falling back to 20b`);
      const retryAfter = err?.headers?.get?.("retry-after");
      if (retryAfter) {
        const waitMs = Math.min(parseInt(retryAfter, 10) * 1000, 30_000);
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      }
      return callModel(FALLBACK_MODEL, messages, maxTokens, temperature, jsonMode);
    }

    throw err;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Send a chat completion to Groq and return the raw string response.
 */
export async function groqChat(opts: GroqChatOptions): Promise<GroqChatResult> {
  return callWithFallback(
    opts.messages,
    opts.maxTokens ?? 4000,
    opts.temperature ?? 0.3,
    false,
    opts.model,
  );
}

/**
 * Send a chat completion to Groq with JSON mode and return parsed result.
 */
export async function groqChatJson<T = Record<string, unknown>>(
  opts: GroqChatOptions,
): Promise<{ data: T; model: string; usage: GroqChatResult["usage"] }> {
  const result = await callWithFallback(
    opts.messages,
    opts.maxTokens ?? 4000,
    opts.temperature ?? 0.1,
    true,
    opts.model,
  );

  const data = JSON.parse(result.content) as T;
  return { data, model: result.model, usage: result.usage };
}
