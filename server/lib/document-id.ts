export function normalizeDocumentPath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim()
    .toLowerCase();
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildDocumentIdFromPath(path: string): string {
  const normalized = normalizeDocumentPath(path);
  return `doc_${fnv1a32(normalized)}`;
}

export function buildDocumentId(folder: string, filename: string): string {
  const normalizedFolder = normalizeDocumentPath(folder);
  const normalizedFile = normalizeDocumentPath(filename);
  const canonical = normalizedFolder && normalizedFolder !== "." && normalizedFolder !== "root"
    ? `${normalizedFolder}/${normalizedFile}`
    : normalizedFile;
  return buildDocumentIdFromPath(canonical);
}
