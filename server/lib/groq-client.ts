/**
 * Groq SDK Client
 *
 * Singleton client for Groq API access. Requires GROQ_API_KEY env var.
 */

import Groq from "groq-sdk";

let _groq: Groq | null = null;
let _groqRequestCount = 0;
const GROQ_CLIENT_RESET_THRESHOLD = 50;

export function getGroqClient(): Groq {
  if (!_groq || _groqRequestCount >= GROQ_CLIENT_RESET_THRESHOLD) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY environment variable is required");
    }
    _groq = new Groq({ apiKey, timeout: 120_000 });
    _groqRequestCount = 0;
  }
  _groqRequestCount++;
  return _groq;
}
