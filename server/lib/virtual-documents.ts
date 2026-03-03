/**
 * Virtual Document Grouping
 *
 * Groups consecutive pages from per-page extraction results into logical
 * "virtual documents" — sub-documents within a single compound PDF.
 *
 * Algorithm:
 * 1. Treat "other" and "blank_page" as weak page types that usually continue
 *    the current document (common for disclosure/back pages).
 * 2. Build groups around strong anchor types (e.g., medical_bill, correspondence);
 *    weak pages absorb into the nearest anchored group.
 * 3. Split on strong type changes, and secondarily on reliable date shifts within
 *    the same anchor type.
 * 4. If only one group spans all pages, return empty array (no splitting needed).
 */

import type { PageExtractionResult } from "./groq-extract";

export interface VirtualDocument {
  vdoc_id: string;
  parent_filename: string;
  start_page: number; // 1-based inclusive
  end_page: number; // 1-based inclusive
  type: string;
  key_info: string;
  date?: string;
  extracted_data: Record<string, any>;
  has_handwritten_data: boolean;
  handwritten_fields: string[];
}

interface PageGroup {
  pages: PageExtractionResult[];
  anchorType: string | null;
}

const WEAK_TYPES = new Set(["other", "blank_page"]);
const TRUSTED_DATE_CONFIDENCE = new Set(["high", "medium"]);

function normalizeType(type: string | undefined): string {
  const normalized = String(type || "other").trim().toLowerCase();
  return normalized || "other";
}

function isWeakType(type: string): boolean {
  return WEAK_TYPES.has(normalizeType(type));
}

function getPageDate(page: PageExtractionResult): string | undefined {
  const ed = page.extracted_data;
  if (!ed || typeof ed !== "object") return undefined;
  const date = ed.document_date;
  return typeof date === "string" && date.trim() ? date.trim() : undefined;
}

function getPageDateConfidence(page: PageExtractionResult): string | undefined {
  const ed = page.extracted_data;
  if (!ed || typeof ed !== "object") return undefined;
  const confidence = ed.document_date_confidence;
  return typeof confidence === "string" && confidence.trim()
    ? confidence.trim().toLowerCase()
    : undefined;
}

function hasTrustedDocumentDate(page: PageExtractionResult): boolean {
  const confidence = getPageDateConfidence(page);
  return confidence ? TRUSTED_DATE_CONFIDENCE.has(confidence) : false;
}

function datesSignificantlyDiffer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  // Normalize to comparable form
  const na = a.replace(/[\/\-\s]/g, "").toLowerCase();
  const nb = b.replace(/[\/\-\s]/g, "").toLowerCase();
  return na !== nb;
}

function shouldSplitGroupByDate(group: PageGroup, nextPage: PageExtractionResult): boolean {
  if (!group.anchorType) return false;
  if (!hasTrustedDocumentDate(nextPage)) return false;

  const nextDate = getPageDate(nextPage);
  if (!nextDate) return false;

  const previousAnchorPage = [...group.pages]
    .reverse()
    .find((page) => normalizeType(page.type) === group.anchorType && !!getPageDate(page));

  if (!previousAnchorPage) return false;
  if (!hasTrustedDocumentDate(previousAnchorPage)) return false;

  const previousDate = getPageDate(previousAnchorPage);
  return datesSignificantlyDiffer(previousDate, nextDate);
}

function getOutputGroupType(group: PageGroup): string {
  const counts = new Map<string, number>();
  const firstSeenOrder: string[] = [];

  for (const page of group.pages) {
    const pageType = normalizeType(page.type);
    if (isWeakType(pageType)) continue;
    if (!counts.has(pageType)) firstSeenOrder.push(pageType);
    counts.set(pageType, (counts.get(pageType) || 0) + 1);
  }

  if (counts.size === 0) {
    const firstNonBlank = group.pages.find((page) => normalizeType(page.type) !== "blank_page");
    return firstNonBlank ? normalizeType(firstNonBlank.type) : "other";
  }

  let bestType = firstSeenOrder[0];
  let bestCount = counts.get(bestType) || 0;
  for (const type of firstSeenOrder) {
    const count = counts.get(type) || 0;
    if (count > bestCount) {
      bestType = type;
      bestCount = count;
    }
  }

  return bestType;
}

function mergeGroupPages(pages: PageExtractionResult[]): {
  key_info: string;
  date?: string;
  extracted_data: Record<string, any>;
  has_handwritten_data: boolean;
  handwritten_fields: string[];
} {
  const mergedData: Record<string, any> = {};
  const allHandwrittenFields = new Set<string>();
  const keyInfoParts: string[] = [];
  let hasHandwrittenData = false;
  let date: string | undefined;

  for (const page of pages) {
    if (page.type === "blank_page") continue;

    // Merge extracted_data — first non-empty value wins per key
    for (const [key, value] of Object.entries(page.extracted_data || {})) {
      if (!(key in mergedData) && value !== null && value !== undefined && value !== "") {
        mergedData[key] = value;
      }
    }

    // Collect handwritten fields
    for (const field of page.handwritten_fields || []) {
      allHandwrittenFields.add(field);
    }
    if (page.has_handwritten_data) {
      hasHandwrittenData = true;
    }

    // Append unique key_info
    if (page.key_info && !keyInfoParts.includes(page.key_info)) {
      keyInfoParts.push(page.key_info);
    }

    // Take first non-empty date
    if (!date) {
      date = getPageDate(page);
    }
  }

  const handwrittenFields = Array.from(allHandwrittenFields);

  return {
    key_info: keyInfoParts.join(" "),
    date,
    extracted_data: mergedData,
    has_handwritten_data: hasHandwrittenData || handwrittenFields.length > 0,
    handwritten_fields: handwrittenFields,
  };
}

export function groupPagesIntoVirtualDocuments(
  pages: PageExtractionResult[],
  filename: string,
  parentDocId: string
): VirtualDocument[] {
  if (pages.length <= 1) return [];

  const orderedPages = [...pages].sort((a, b) => a.page - b.page);
  const groups: PageGroup[] = [];
  let currentGroup: PageGroup | null = null;

  for (const page of orderedPages) {
    const pageType = normalizeType(page.type);
    const isBlank = pageType === "blank_page";
    const pageIsWeak = isWeakType(pageType);

    if (isBlank) {
      // Absorb blank pages into the current group
      if (currentGroup) {
        currentGroup.pages.push(page);
      }
      continue;
    }

    if (!currentGroup) {
      // First non-blank page starts a new group
      currentGroup = {
        pages: [page],
        anchorType: pageIsWeak ? null : pageType,
      };
      groups.push(currentGroup);
      continue;
    }

    // Weak pages are usually continuation pages (disclosures, reverse sides, etc.)
    if (pageIsWeak) {
      currentGroup.pages.push(page);
      continue;
    }

    // Promote an unanchored weak-only group once we hit a strong page type
    if (!currentGroup.anchorType) {
      currentGroup.pages.push(page);
      currentGroup.anchorType = pageType;
      continue;
    }

    // Same anchor type: optionally split by reliable date shift
    if (pageType === currentGroup.anchorType) {
      if (shouldSplitGroupByDate(currentGroup, page)) {
        currentGroup = { pages: [page], anchorType: pageType };
        groups.push(currentGroup);
      } else {
        currentGroup.pages.push(page);
      }
      continue;
    }

    // Strong type changed: start a new group
    currentGroup = { pages: [page], anchorType: pageType };
    groups.push(currentGroup);
  }

  // If only one group spans all pages, no splitting needed
  if (groups.length <= 1) return [];

  return groups.map((group, index) => {
    const merged = mergeGroupPages(group.pages);
    const startPage = Math.min(...group.pages.map((p) => p.page));
    const endPage = Math.max(...group.pages.map((p) => p.page));
    const outputType = getOutputGroupType(group);

    return {
      vdoc_id: `${parentDocId}_vd${index + 1}`,
      parent_filename: filename,
      start_page: startPage,
      end_page: endPage,
      type: outputType,
      key_info: merged.key_info,
      date: merged.date,
      extracted_data: merged.extracted_data,
      has_handwritten_data: merged.has_handwritten_data,
      handwritten_fields: merged.handwritten_fields,
    };
  });
}
