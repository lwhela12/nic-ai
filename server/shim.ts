// This MUST be imported before any @anthropic-ai/sdk imports
// It forces the SDK to use web runtime (native fetch) instead of node runtime (node-fetch)
// Required for Bun bundling - the node-fetch shim breaks when compiled
// See: https://github.com/openai/openai-node/issues/903

console.log("[SHIM] === Shim module executing ===");

// Import the web shim synchronously (this is the key - must happen before SDK loads)
import "@anthropic-ai/sdk/shims/web";
console.log("[SHIM] Web shim import statement executed");

// Inspect what we got
import * as shimsIndex from "@anthropic-ai/sdk/_shims/index";
console.log("[SHIM] Shims index keys:", Object.keys(shimsIndex));
console.log("[SHIM] getDefaultAgent type:", typeof (shimsIndex as any).getDefaultAgent);

// If getDefaultAgent exists, log what it returns
if (typeof (shimsIndex as any).getDefaultAgent === 'function') {
  try {
    const result = (shimsIndex as any).getDefaultAgent("https://api.anthropic.com");
    console.log("[SHIM] getDefaultAgent('https://...') returned:", result);
  } catch (e) {
    console.log("[SHIM] getDefaultAgent threw:", e);
  }
} else {
  console.log("[SHIM] WARNING: getDefaultAgent is not a function!");
  console.log("[SHIM] shimsIndex full content:", JSON.stringify(shimsIndex, null, 2));
}
