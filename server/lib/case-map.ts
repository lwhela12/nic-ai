/**
 * Case map: compact, navigable abstraction layer over document_index.json.
 * This is an index layer, not a replacement for source truth.
 */

export interface CaseMapSourceRef {
  doc_path: string;
  folder: string;
  filename: string;
  page?: number;
  snippet?: string;
}

export interface CaseMapFact {
  id: string;
  field: string;
  value_raw: string | number | boolean | null;
  value_normalized: string;
  confidence: number;
  index_refs: string[];
  source_refs: CaseMapSourceRef[];
}

export interface CaseMapDocument {
  id: string;
  path: string;
  folder: string;
  filename: string;
  type?: string;
  date?: string;
  key_info?: string;
  index_ref: string;
}

export interface CaseMapData {
  version: "1.0";
  generated_at: string;
  case_name?: string;
  case_phase?: string;
  overview: {
    total_folders: number;
    total_documents: number;
    total_facts: number;
    conflict_count: number;
  };
  pointers: {
    canonical_index: string;
    canonical_docs_root: string;
  };
  documents: CaseMapDocument[];
  facts: CaseMapFact[];
  relationships: Array<{
    type: "supports" | "conflicts_with";
    from_fact_id: string;
    to_fact_id?: string;
    field: string;
  }>;
  unmapped_segments: Array<{
    doc_path: string;
    index_ref: string;
    note: string;
  }>;
}

function isSkippableField(field: string): boolean {
  const lower = field.toLowerCase();
  return (
    lower.includes("extracted_text") ||
    lower.includes("full_text") ||
    lower.includes("raw_content") ||
    lower.includes("content") ||
    lower.includes("ocr")
  );
}

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function primitiveToFactValue(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function filePathFor(folder: string, filename: string): string {
  return folder ? `${folder}/${filename}` : filename;
}

function collectFactsFromObject(
  value: unknown,
  path: string,
  out: CaseMapFact[],
  sourceRef?: CaseMapSourceRef,
  depth = 0
): void {
  if (depth > 5 || value === undefined) return;

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    out.push({
      id: `fact-${out.length + 1}`,
      field: path,
      value_raw: primitiveToFactValue(value),
      value_normalized: normalizeScalar(value),
      confidence: sourceRef ? 0.7 : 0.6,
      index_refs: [path],
      source_refs: sourceRef ? [sourceRef] : [],
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, idx) => {
      collectFactsFromObject(entry, `${path}[${idx}]`, out, sourceRef, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSkippableField(key)) continue;
      collectFactsFromObject(child, `${path}.${key}`, out, sourceRef, depth + 1);
    }
  }
}

export function buildCaseMap(index: Record<string, any>): CaseMapData {
  const documents: CaseMapDocument[] = [];
  const facts: CaseMapFact[] = [];
  const relationships: CaseMapData["relationships"] = [];
  const unmappedSegments: CaseMapData["unmapped_segments"] = [];
  const folders = index?.folders || {};

  const conflicts: Array<{ field?: string; conflicting_values?: unknown[] }> = Array.isArray(index?.needs_review)
    ? index.needs_review
    : [];

  for (const [folderName, folderData] of Object.entries(folders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files;
    if (!Array.isArray(files)) continue;

    files.forEach((file: any, fileIdx: number) => {
      const filename = String(file?.filename || "unknown");
      const docPath = filePathFor(folderName, filename);
      const indexRef = `folders.${folderName}.files[${fileIdx}]`;

      documents.push({
        id: `doc-${documents.length + 1}`,
        path: docPath,
        folder: folderName,
        filename,
        type: typeof file?.type === "string" ? file.type : undefined,
        date: typeof file?.date === "string" ? file.date : undefined,
        key_info: typeof file?.key_info === "string" ? file.key_info.slice(0, 280) : undefined,
        index_ref: indexRef,
      });

      const sourceRef: CaseMapSourceRef = {
        doc_path: docPath,
        folder: folderName,
        filename,
        snippet: typeof file?.key_info === "string" ? file.key_info.slice(0, 240) : undefined,
      };

      collectFactsFromObject(file?.type, `${indexRef}.type`, facts, sourceRef);
      collectFactsFromObject(file?.date, `${indexRef}.date`, facts, sourceRef);
      collectFactsFromObject(file?.key_info, `${indexRef}.key_info`, facts, sourceRef);
      collectFactsFromObject(file?.extracted_data, `${indexRef}.extracted_data`, facts, sourceRef);

      if (!file?.extracted_data && typeof file?.key_info === "string" && file.key_info.trim()) {
        unmappedSegments.push({
          doc_path: docPath,
          index_ref: `${indexRef}.key_info`,
          note: "No extracted_data; key_info retained as unmapped segment.",
        });
      }
    });
  }

  // Top-level case facts and summary fields.
  collectFactsFromObject(index?.case_name, "case_name", facts);
  collectFactsFromObject(index?.case_phase, "case_phase", facts);
  collectFactsFromObject(index?.summary, "summary", facts);
  collectFactsFromObject(index?.reconciled_values, "reconciled_values", facts);

  // Deterministic conflict relationships.
  for (const conflict of conflicts) {
    const field = String(conflict.field || "unknown");
    const conflictFactIds: string[] = [];
    for (const raw of conflict.conflicting_values || []) {
      const conflictFact: CaseMapFact = {
        id: `fact-${facts.length + 1}`,
        field,
        value_raw: primitiveToFactValue(raw),
        value_normalized: normalizeScalar(raw),
        confidence: 0.4,
        index_refs: [`needs_review:${field}`],
        source_refs: [],
      };
      facts.push(conflictFact);
      conflictFactIds.push(conflictFact.id);
    }
    for (let i = 0; i < conflictFactIds.length; i++) {
      for (let j = i + 1; j < conflictFactIds.length; j++) {
        relationships.push({
          type: "conflicts_with",
          from_fact_id: conflictFactIds[i],
          to_fact_id: conflictFactIds[j],
          field,
        });
      }
    }
  }

  const caseMap: CaseMapData = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    case_name: typeof index?.case_name === "string" ? index.case_name : undefined,
    case_phase: typeof index?.case_phase === "string" ? index.case_phase : undefined,
    overview: {
      total_folders: Object.keys(folders).length,
      total_documents: documents.length,
      total_facts: facts.length,
      conflict_count: conflicts.length,
    },
    pointers: {
      canonical_index: ".pi_tool/document_index.json",
      canonical_docs_root: ".",
    },
    documents,
    facts,
    relationships,
    unmapped_segments: unmappedSegments,
  };

  return caseMap;
}

/**
 * Keep prompt context bounded while preserving map navigation fidelity.
 */
export function buildCaseMapPromptView(
  caseMap: CaseMapData,
  maxChars = 60000
): { text: string; truncated: boolean } {
  let text = JSON.stringify(caseMap, null, 2);
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const trimmed: Partial<CaseMapData> & { note?: string } = {
    version: caseMap.version,
    generated_at: caseMap.generated_at,
    case_name: caseMap.case_name,
    case_phase: caseMap.case_phase,
    overview: caseMap.overview,
    pointers: caseMap.pointers,
    documents: caseMap.documents.slice(0, 400),
    facts: caseMap.facts.slice(0, 1200),
    relationships: caseMap.relationships.slice(0, 500),
    unmapped_segments: caseMap.unmapped_segments.slice(0, 200),
    note: "Truncated map view. Use read_index_slice for deeper index inspection.",
  };

  text = JSON.stringify(trimmed, null, 2);
  if (text.length > maxChars) {
    const aggressivelyTrimmed = {
      version: caseMap.version,
      generated_at: caseMap.generated_at,
      case_name: caseMap.case_name,
      case_phase: caseMap.case_phase,
      overview: caseMap.overview,
      pointers: caseMap.pointers,
      documents: caseMap.documents.slice(0, 200).map((d) => ({
        id: d.id,
        path: d.path,
        type: d.type,
        date: d.date,
        index_ref: d.index_ref,
      })),
      facts: caseMap.facts.slice(0, 400).map((f) => ({
        id: f.id,
        field: f.field,
        value_raw: f.value_raw,
        index_refs: f.index_refs,
      })),
      note: "Aggressively truncated map view. Use read_index_slice to inspect full index contents.",
    };
    text = JSON.stringify(aggressivelyTrimmed, null, 2);
  }

  return { text, truncated: true };
}
