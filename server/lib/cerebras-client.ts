/**
 * Cerebras SDK Client
 *
 * Singleton client for Cerebras API access. Requires CEREBRAS_API_KEY env var.
 */

import Cerebras from "@cerebras/cerebras_cloud_sdk";

let _cerebras: Cerebras | null = null;
let _cerebrasRequestCount = 0;
const CEREBRAS_CLIENT_RESET_THRESHOLD = 50;

export function getCerebrasClient(): Cerebras {
  if (!_cerebras || _cerebrasRequestCount >= CEREBRAS_CLIENT_RESET_THRESHOLD) {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new Error("CEREBRAS_API_KEY environment variable is required");
    }
    _cerebras = new Cerebras({ apiKey, timeout: 120_000 });
    _cerebrasRequestCount = 0;
  }
  _cerebrasRequestCount++;
  return _cerebras;
}
