import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type { DocumentIndex, ErrataItem, NeedsReviewItem } from '../App'
import type { PacketPiiResult, PacketRedactionBox } from '../types/packet'
import { formatDateMMDDYYYY } from '../utils/dateFormat'

// Set up PDF.js worker (using local copy since CDN may not have latest version)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface Draft {
  id: string
  name: string
  path: string
  type: string
  createdAt: string
  targetPath: string
  workingDocxPath?: string
  workingDocxMtimeMs?: number
  previewPdfPath?: string
  generatedAt?: string
  outputPath?: string
}

type ExportStyleProfile = 'court_safe' | 'd_and_o' | 'letter' | 'text_only'

const EXPORT_STYLE_OPTIONS: Array<{ value: ExportStyleProfile; label: string }> = [
  { value: 'court_safe', label: 'Court Safe' },
  { value: 'd_and_o', label: 'D&O' },
  { value: 'letter', label: 'Letter' },
  { value: 'text_only', label: 'Text Only' },
]

const IMAGE_PDF_AUTO_DETECT_WARNING = "I can't auto-detect on images or image based PDFs. Sorry!"
const DASH_LIKE_CHARS = /[-\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/

const inferStyleProfileFromHint = (hint: string): ExportStyleProfile => {
  const normalized = hint.toLowerCase()
  if (
    normalized.includes('hearing_decision') ||
    normalized.includes('decision_and_order') ||
    normalized.includes('decision_order') ||
    normalized.includes('d&o') ||
    normalized.includes('dao') ||
    normalized.includes('decision and order') ||
    normalized.includes('hearing officer') ||
    normalized.includes('appeals officer')
  ) {
    return 'd_and_o'
  }
  if (
    normalized.includes('letter') ||
    normalized.includes('lor') ||
    normalized.includes('letter_of_representation') ||
    normalized.includes('demand')
  ) {
    return 'letter'
  }
  return 'court_safe'
}

const inferStyleProfileFromDraft = (draft: Draft | null): ExportStyleProfile => {
  if (!draft) return 'court_safe'
  const hint = [draft.type, draft.name, draft.path].filter(Boolean).join(' ')
  return inferStyleProfileFromHint(hint)
}

interface Props {
  content: string
  docPath: string | null
  fileUrl: string | null
  fileName: string
  filePath: string | null
  caseFolder: string
  apiUrl: string
  documentIndex: DocumentIndex | null
  firmRoot?: string
  onCloseFile: () => void
  onIndexUpdated: () => void
  onDraftsUpdated?: () => void
  refreshDraftsKey?: number  // Increment to trigger drafts reload
  viewMode?: 'summary' | 'document'
  onToggleViewMode?: () => void
  hasFile?: boolean
  hasSummary?: boolean
  evidencePacketPath?: string | null
  evidencePacketVersion?: number
  onOpenFilePath?: (path: string) => void
  onOpenPacketDraft?: (draftId: string) => void
  packetPiiActive?: boolean
  packetPiiResult?: PacketPiiResult | null
  onPacketPiiResultUpdate?: (path: string, updater: (prev: PacketPiiResult) => PacketPiiResult) => void
}

interface PiiFinding {
  path: string
  page: number
  kind: 'dob' | 'ssn'
  preview: string
}

interface RedactionBoxInput {
  page: number
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

interface OverlayRedactionBox extends RedactionBoxInput {
  id: string
  source: 'manual' | 'detected'
  kind?: 'dob' | 'ssn'
  preview?: string
}

interface DraftRedactionBox {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface EditableDocumentSummaryFields {
  title: string
  type: string
  date: string
  key_info: string
  issues: string
}

interface IndexedSummaryTarget {
  filePath: string
  fileName: string
  fields: EditableDocumentSummaryFields
  extractedData: unknown
  isUserReviewed: boolean
}

const normalizeRelativePath = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()

const joinRelativePath = (folderName: string, fileName: string): string => {
  const folder = normalizeRelativePath(folderName)
  const file = normalizeRelativePath(fileName)
  if (!file) return ''
  if (!folder || folder === '.' || folder.toLowerCase() === 'root') return file
  return `${folder}/${file}`
}

const getFolderFiles = (folderData: unknown): unknown[] => {
  if (Array.isArray(folderData)) return folderData
  if (folderData && typeof folderData === 'object') {
    const folderObject = folderData as Record<string, unknown>
    if (Array.isArray(folderObject.files)) return folderObject.files
    if (Array.isArray(folderObject.documents)) return folderObject.documents
  }
  return []
}

const getObjectStringValue = (value: unknown, key: string): string => {
  if (!value || typeof value !== 'object') return ''
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : ''
}

const getIndexedFileName = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const entry = value as Record<string, unknown>
  if (typeof entry.filename === 'string' && entry.filename.trim()) return entry.filename
  if (typeof entry.file === 'string' && entry.file.trim()) return entry.file
  if (typeof entry.path === 'string' && entry.path.trim()) {
    const normalized = normalizeRelativePath(entry.path)
    return normalized.split('/').pop() || normalized
  }
  return ''
}

const getIndexedFilePath = (folderName: string, value: unknown): string => {
  if (value && typeof value === 'object') {
    const directPath = getObjectStringValue(value, 'path')
    if (directPath.trim()) {
      const normalizedDirectPath = normalizeRelativePath(directPath)
      if (normalizedDirectPath.includes('/')) {
        return normalizedDirectPath
      }
      return joinRelativePath(folderName, normalizedDirectPath)
    }
  }
  const fileName = getIndexedFileName(value)
  return joinRelativePath(folderName, fileName)
}

const emptyEditableSummaryFields = (): EditableDocumentSummaryFields => ({
  title: '',
  type: '',
  date: '',
  key_info: '',
  issues: '',
})

const cloneJsonValue = <T,>(value: T): T => {
  if (value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

const areEditableSummaryFieldsEqual = (
  a: EditableDocumentSummaryFields | null,
  b: EditableDocumentSummaryFields | null,
): boolean => {
  if (!a || !b) return false
  return (
    a.title === b.title &&
    a.type === b.type &&
    a.date === b.date &&
    a.key_info === b.key_info &&
    a.issues === b.issues
  )
}

interface ExtractedFieldEntry {
  path: string
  value: string
}

interface DisplayedExtractedField extends ExtractedFieldEntry {
  rawPath: string
  section: string
  label: string
}

interface ExtractedFieldSection {
  section: string
  fields: DisplayedExtractedField[]
}

type PathSegment = string | number

const parsePathSegments = (path: string): PathSegment[] => {
  const segments: PathSegment[] = []
  const matcher = /([^[.\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1])
    } else if (match[2] !== undefined) {
      segments.push(Number(match[2]))
    }
  }
  return segments
}

const FIELD_WORD_OVERRIDES: Record<string, string> = {
  aoe: 'AOE',
  amw: 'AMW',
  coe: 'COE',
  dob: 'DOB',
  doi: 'DOI',
  dol: 'DOL',
  id: 'ID',
  mmi: 'MMI',
  ppd: 'PPD',
  ptd: 'PTD',
  ssn: 'SSN',
  tpd: 'TPD',
  ttd: 'TTD',
  uim: 'UIM',
  um: 'UM',
  vin: 'VIN',
  wc: 'WC',
  zip: 'ZIP',
}

const splitIdentifierWords = (token: string): string[] =>
  token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

const singularizeToken = (token: string): string => {
  if (token.endsWith('ies') && token.length > 3) return `${token.slice(0, -3)}y`
  if (token.endsWith('ses') && token.length > 3) return token.slice(0, -2)
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1)
  return token
}

const formatIdentifierToken = (token: string): string => {
  const words = splitIdentifierWords(token)
  if (words.length === 0) return token
  return words
    .map((word) => {
      const normalized = word.toLowerCase()
      if (FIELD_WORD_OVERRIDES[normalized]) return FIELD_WORD_OVERRIDES[normalized]
      return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    })
    .join(' ')
}

const formatSectionNameFromSegments = (segments: PathSegment[]): string => {
  if (segments.length === 0) return 'General'
  const parts: string[] = []

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (typeof segment === 'number') {
      parts.push(`Item ${segment + 1}`)
      continue
    }

    const next = segments[i + 1]
    if (typeof next === 'number') {
      parts.push(`${formatIdentifierToken(segment)} ${next + 1}`)
      i += 1
      continue
    }

    parts.push(formatIdentifierToken(segment))
  }

  return parts.join(' / ')
}

const formatExtractedFieldForDisplay = (entry: ExtractedFieldEntry): DisplayedExtractedField => {
  const segments = parsePathSegments(entry.path)
  if (segments.length === 0) {
    return {
      ...entry,
      rawPath: entry.path,
      section: 'General',
      label: 'Value',
    }
  }

  const lastSegment = segments[segments.length - 1]
  const sectionSegments = segments.slice(0, -1)

  if (typeof lastSegment === 'number') {
    const previous = segments.length > 1 && typeof segments[segments.length - 2] === 'string'
      ? singularizeToken(segments[segments.length - 2] as string)
      : 'item'
    return {
      ...entry,
      rawPath: entry.path,
      section: formatSectionNameFromSegments(sectionSegments),
      label: `${formatIdentifierToken(previous)} ${lastSegment + 1}`,
    }
  }

  return {
    ...entry,
    rawPath: entry.path,
    section: formatSectionNameFromSegments(sectionSegments),
    label: formatIdentifierToken(lastSegment),
  }
}

const flattenExtractedFields = (
  value: unknown,
  parentPath = '',
  acc: ExtractedFieldEntry[] = [],
): ExtractedFieldEntry[] => {
  if (value === null || value === undefined) {
    if (parentPath) {
      acc.push({ path: parentPath, value: '' })
    }
    return acc
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nextPath = parentPath ? `${parentPath}[${i}]` : `[${i}]`
      flattenExtractedFields(value[i], nextPath, acc)
    }
    return acc
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = parentPath ? `${parentPath}.${key}` : key
      flattenExtractedFields(child, nextPath, acc)
    }
    return acc
  }

  acc.push({ path: parentPath, value: String(value) })
  return acc
}

const writeValueAtPath = (value: unknown, path: string, nextRawValue: string): unknown => {
  const clone = cloneJsonValue(value)
  const segments = parsePathSegments(path)
  if (segments.length === 0) return clone

  let cursor: unknown = clone
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor)) return clone
      cursor = cursor[segment]
      continue
    }
    if (!cursor || typeof cursor !== 'object') return clone
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  const last = segments[segments.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(cursor)) return clone
    const currentValue = cursor[last]
    cursor[last] = coerceEditedPrimitive(nextRawValue, currentValue)
    return clone
  }

  if (!cursor || typeof cursor !== 'object') return clone
  const target = cursor as Record<string, unknown>
  target[last] = coerceEditedPrimitive(nextRawValue, target[last])
  return clone
}

const coerceEditedPrimitive = (rawValue: string, originalValue: unknown): unknown => {
  if (typeof originalValue === 'number') {
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? parsed : originalValue
  }
  if (typeof originalValue === 'boolean') {
    const normalized = rawValue.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
    return originalValue
  }
  return rawValue
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

const packetBoxKey = (box: {
  page: number
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}): string => {
  const page = Number.isFinite(box.page) ? Math.floor(box.page) : 0
  return [
    page,
    box.xPct.toFixed(5),
    box.yPct.toFixed(5),
    box.widthPct.toFixed(5),
    box.heightPct.toFixed(5),
  ].join(':')
}

const inferPiiKindFromText = (value: string): 'dob' | 'ssn' | undefined => {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (/^\d{3}[-\u2010-\u2015\u2212]\d{2}[-\u2010-\u2015\u2212]\d{4}$/.test(normalized)) return 'ssn'
  if (/^\d{9}$/.test(normalized)) return 'ssn'
  if (/^\d{1,2}[\/.\-\u2010-\u2015\u2212]\d{1,2}[\/.\-\u2010-\u2015\u2212]\d{2,4}$/.test(normalized)) return 'dob'
  return undefined
}

interface TextLayerSpanSegment {
  node: HTMLElement
  text: string
  left: number
  right: number
  top: number
  bottom: number
  centerY: number
  width: number
  height: number
}

interface TextLayerSpanRange {
  segment: TextLayerSpanSegment
  start: number
  end: number
}

interface AutoDetectedTextBox {
  left: number
  top: number
  width: number
  height: number
  text: string
  kind?: 'dob' | 'ssn'
}

const isTokenCharacter = (char: string): boolean => (
  /[0-9A-Za-z/._?*]/.test(char) ||
  DASH_LIKE_CHARS.test(char)
)

const normalizeDashCharacters = (value: string): string => (
  value.replace(/[\u2010-\u2015\u2212]/g, '-')
)

const normalizeCompactTokenText = (value: string): string => (
  normalizeDashCharacters(value).replace(/\s+/g, '')
)

const isLooseSsnToken = (value: string): boolean => {
  const compact = normalizeCompactTokenText(value)
  if (!compact) return false
  if (/[^0-9?*\-]/.test(compact)) return false

  const digitsOrPlaceholders = compact.replace(/-/g, '')
  if (digitsOrPlaceholders.length !== 9) return false

  if (compact.includes('-')) {
    return /^[0-9?*]{3}-[0-9?*]{2}-[0-9?*]{4}$/.test(compact)
  }
  return /^[0-9?*]{9}$/.test(compact)
}

const isLooseDobToken = (value: string): boolean => {
  const compact = normalizeCompactTokenText(value)
  if (!compact) return false
  if (/[^0-9?*\/.\-]/.test(compact)) return false
  return /^[0-9?*]{1,2}[\/.\-][0-9?*]{1,2}[\/.\-][0-9?*]{2,4}$/.test(compact)
}

const segmentCharWidth = (segment: TextLayerSpanSegment): number => {
  const nonSpaceChars = Math.max(1, segment.text.replace(/\s+/g, '').length)
  return segment.width / nonSpaceChars
}

const segmentGapWithinTokenTolerance = (left: TextLayerSpanSegment, right: TextLayerSpanSegment): boolean => {
  const gap = right.left - left.right
  if (gap <= 0) return true
  const avgCharWidth = (segmentCharWidth(left) + segmentCharWidth(right)) / 2
  return gap <= Math.max(16, avgCharWidth * 4.5)
}

interface PiiWindowMatch {
  startIndex: number
  endIndex: number
  kind: 'dob' | 'ssn'
  text: string
}

const findLoosePiiWindowMatch = (
  lineSegments: TextLayerSpanSegment[],
  clickedIndex: number,
): PiiWindowMatch | null => {
  if (clickedIndex < 0 || clickedIndex >= lineSegments.length) return null

  const searchRadius = 5
  const minStart = Math.max(0, clickedIndex - searchRadius)
  const maxEnd = Math.min(lineSegments.length - 1, clickedIndex + searchRadius)
  let best: PiiWindowMatch | null = null

  for (let start = minStart; start <= clickedIndex; start += 1) {
    for (let end = clickedIndex; end <= maxEnd; end += 1) {
      if (end - start + 1 > 10) continue

      let contiguous = true
      for (let i = start; i < end; i += 1) {
        if (!segmentGapWithinTokenTolerance(lineSegments[i], lineSegments[i + 1])) {
          contiguous = false
          break
        }
      }
      if (!contiguous) continue

      const candidateText = lineSegments
        .slice(start, end + 1)
        .map((segment) => segment.text)
        .join('')
      const compact = normalizeCompactTokenText(candidateText)
      const kind: 'dob' | 'ssn' | null = isLooseSsnToken(compact)
        ? 'ssn'
        : (isLooseDobToken(compact) ? 'dob' : null)
      if (!kind) continue

      const normalizedText = candidateText.replace(/\s+/g, ' ').trim()
      const score = normalizedText.length + (kind === 'ssn' ? 50 : 10)
      const bestScore = best ? (best.text.length + (best.kind === 'ssn' ? 50 : 10)) : -1
      if (!best || score > bestScore) {
        best = {
          startIndex: start,
          endIndex: end,
          kind,
          text: normalizedText,
        }
      }
    }
  }

  return best
}

const buildBoxFromSegmentSet = (
  matchedSegments: TextLayerSpanSegment[],
  pageRect: DOMRect,
  text: string,
  kind?: 'dob' | 'ssn',
): AutoDetectedTextBox | null => {
  if (matchedSegments.length === 0) return null
  const padding = 2
  const minLeft = Math.min(...matchedSegments.map((segment) => segment.left))
  const maxRight = Math.max(...matchedSegments.map((segment) => segment.right))
  const minTop = Math.min(...matchedSegments.map((segment) => segment.top))
  const maxBottom = Math.max(...matchedSegments.map((segment) => segment.bottom))

  const left = Math.max(0, minLeft - pageRect.left - padding)
  const top = Math.max(0, minTop - pageRect.top - padding)
  const right = Math.min(pageRect.width, maxRight - pageRect.left + padding)
  const bottom = Math.min(pageRect.height, maxBottom - pageRect.top + padding)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null

  return {
    left,
    top,
    width,
    height,
    text,
    kind,
  }
}

const selectLineTokenRange = (
  lineText: string,
  clickIndex: number,
): { start: number; end: number } | null => {
  if (!lineText.length || clickIndex < 0 || clickIndex >= lineText.length) return null
  if (!isTokenCharacter(lineText[clickIndex])) return null

  let start = clickIndex
  while (start > 0 && isTokenCharacter(lineText[start - 1])) {
    start -= 1
  }

  let end = clickIndex + 1
  while (end < lineText.length && isTokenCharacter(lineText[end])) {
    end += 1
  }

  if (start >= end) return null
  return { start, end }
}

const selectRegexTokenRange = (
  lineText: string,
  clickIndex: number,
): { start: number; end: number } | null => {
  const pattern = /\b(?:\d{3}[-\u2010-\u2015\u2212]\d{2}[-\u2010-\u2015\u2212]\d{4}|\d{9}|\d{1,2}[\/.\-\u2010-\u2015\u2212]\d{1,2}[\/.\-\u2010-\u2015\u2212]\d{2,4})\b/g
  let match: RegExpExecArray | null
  let nearest: { start: number; end: number; distance: number } | null = null

  while ((match = pattern.exec(lineText)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (clickIndex >= start && clickIndex < end) {
      return { start, end }
    }

    const distance = clickIndex < start
      ? start - clickIndex
      : clickIndex - (end - 1)
    if (!nearest || distance < nearest.distance) {
      nearest = { start, end, distance }
    }
  }

  if (nearest && nearest.distance <= 2) {
    return { start: nearest.start, end: nearest.end }
  }
  return null
}

const buildAutoDetectedTextBox = (
  target: HTMLElement,
  clickClientX: number,
  pageRect: DOMRect,
): AutoDetectedTextBox | null => {
  const clickedSpan = target.closest('.react-pdf__Page__textContent span') as HTMLElement | null
  if (!clickedSpan) return null
  const textLayer = clickedSpan.closest('.react-pdf__Page__textContent') as HTMLElement | null
  if (!textLayer) return null

  const segments: TextLayerSpanSegment[] = Array.from(textLayer.querySelectorAll('span'))
    .map((node) => {
      const text = (node.textContent || '').replace(/\u00A0/g, ' ')
      const rect = node.getBoundingClientRect()
      return {
        node,
        text,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        centerY: rect.top + (rect.height / 2),
        width: rect.width,
        height: rect.height,
      }
    })
    .filter((segment) => segment.text.length > 0 && segment.width > 0 && segment.height > 0)

  if (segments.length === 0) return null

  const clickedSegment = segments.find((segment) => segment.node === clickedSpan)
  if (!clickedSegment) return null

  const lineTolerance = Math.max(2, Math.min(6, clickedSegment.height * 0.45))
  const lineSegments = segments
    .filter((segment) => Math.abs(segment.centerY - clickedSegment.centerY) <= lineTolerance)
    .sort((a, b) => a.left - b.left)

  if (lineSegments.length === 0) return null
  const clickedLineIndex = lineSegments.findIndex((segment) => segment.node === clickedSpan)
  if (clickedLineIndex < 0) return null

  const loosePiiWindow = findLoosePiiWindowMatch(lineSegments, clickedLineIndex)
  if (loosePiiWindow) {
    return buildBoxFromSegmentSet(
      lineSegments.slice(loosePiiWindow.startIndex, loosePiiWindow.endIndex + 1),
      pageRect,
      loosePiiWindow.text,
      loosePiiWindow.kind,
    )
  }

  const ranges: TextLayerSpanRange[] = []
  let lineText = ''
  for (let i = 0; i < lineSegments.length; i += 1) {
    const segment = lineSegments[i]
    if (i > 0) {
      const prev = lineSegments[i - 1]
      const gap = segment.left - prev.right
      const prevChars = Math.max(1, prev.text.replace(/\s+/g, '').length)
      const currChars = Math.max(1, segment.text.replace(/\s+/g, '').length)
      const avgCharWidth = ((prev.width / prevChars) + (segment.width / currChars)) / 2
      const syntheticSpaceGap = Math.max(2, avgCharWidth * 0.9)
      if (gap > syntheticSpaceGap) {
        lineText += ' '
      }
    }
    const start = lineText.length
    lineText += segment.text
    const end = lineText.length
    ranges.push({ segment, start, end })
  }

  if (!lineText.trim().length) return null

  const clickedRange = ranges[clickedLineIndex]
  if (!clickedRange) return null

  const clickedLength = Math.max(1, clickedRange.end - clickedRange.start)
  const clickRatio = clickedSegment.width > 0
    ? clamp01((clickClientX - clickedSegment.left) / clickedSegment.width)
    : 0.5
  const clickIndex = Math.min(
    lineText.length - 1,
    clickedRange.start + Math.floor(clickRatio * clickedLength),
  )

  const preferredRange =
    selectRegexTokenRange(lineText, clickIndex) ||
    selectLineTokenRange(lineText, clickIndex) ||
    { start: clickedRange.start, end: clickedRange.end }

  const matchedRanges = ranges.filter((range) => (
    range.end > preferredRange.start && range.start < preferredRange.end
  ))
  const text = lineText.slice(preferredRange.start, preferredRange.end).replace(/\s+/g, ' ').trim()
  return buildBoxFromSegmentSet(
    matchedRanges.map((range) => range.segment),
    pageRect,
    text,
    inferPiiKindFromText(text),
  )
}

// Icons
const DocumentIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)


const ArrowDownTrayIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

const ClipboardIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
  </svg>
)

const XMarkIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const ArrowTopRightOnSquareIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
)

const ArrowsPointingOutIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
          d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
  </svg>
)

// Toggle icons for summary/document view
const DocumentViewIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const SummaryViewIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
  </svg>
)

const ClipboardCheckIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
)

const ArrowLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
)

const DocumentTextIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

export default function Visualizer({
  content,
  docPath,
  fileUrl,
  fileName,
  filePath,
  caseFolder,
  apiUrl,
  documentIndex,
  firmRoot: _firmRoot,
  onCloseFile,
  onIndexUpdated,
  onDraftsUpdated,
  refreshDraftsKey,
  viewMode = 'summary',
  onToggleViewMode,
  hasFile,
  hasSummary,
  evidencePacketPath,
  evidencePacketVersion,
  onOpenFilePath,
  onOpenPacketDraft,
  packetPiiActive = false,
  packetPiiResult = null,
  onPacketPiiResultUpdate,
}: Props) {
  const [activeTab, setActiveTab] = useState<'view' | 'review' | 'drafts'>('view')
  const [verifiedItems, setVerifiedItems] = useState<Set<string>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportStyleProfile, setExportStyleProfile] = useState<ExportStyleProfile>('court_safe')
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [correctionValue, setCorrectionValue] = useState('')

  // Drafts state
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null)
  const [draftContent, setDraftContent] = useState<string>('')
  const [isApprovingDraft, setIsApprovingDraft] = useState(false)
  const [draftExportMenuOpen, setDraftExportMenuOpen] = useState(false)
  const [pendingEvidencePacketPath, setPendingEvidencePacketPath] = useState<string | null>(null)
  const [draftPreviewUrl, setDraftPreviewUrl] = useState<string | null>(null)
  const [isOpeningDraftWord, setIsOpeningDraftWord] = useState(false)
  const [isWatchingDraftWordEdits, setIsWatchingDraftWordEdits] = useState(false)
  const [isRefreshingDraftPreview, setIsRefreshingDraftPreview] = useState(false)
  const draftPreviewRefreshTimeoutRef = useRef<number | null>(null)
  const selectedDraftIdRef = useRef<string | null>(null)
  const previousStyleProfileRef = useRef<ExportStyleProfile>(exportStyleProfile)

  // Bundle state
  const [canBundle, setCanBundle] = useState(false)
  const [isBundling, setIsBundling] = useState(false)
  const [bundleError, setBundleError] = useState<string | null>(null)

  // PDF viewer state
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null)
  const [pdfPageNumber, setPdfPageNumber] = useState(1)
  const [pdfPageInput, setPdfPageInput] = useState('1')
  const [pdfScale, setPdfScale] = useState(1.0)
  const pdfContainerRef = useRef<HTMLDivElement>(null)
  const [pdfContainerWidth, setPdfContainerWidth] = useState<number | null>(null)
  const pageLayerRef = useRef<HTMLDivElement>(null)
  const activeDrawPointerIdRef = useRef<number | null>(null)
  const autoEnabledDrawForFileRef = useRef<string | null>(null)
  const [pageLayerSize, setPageLayerSize] = useState<{ width: number; height: number } | null>(null)
  const [currentPageHasSelectableText, setCurrentPageHasSelectableText] = useState<boolean | null>(null)

  const [piiFindings, setPiiFindings] = useState<PiiFinding[]>([])
  const [piiWarnings, setPiiWarnings] = useState<string[]>([])
  const [detectedBoxes, setDetectedBoxes] = useState<OverlayRedactionBox[]>([])
  const [manualBoxes, setManualBoxes] = useState<OverlayRedactionBox[]>([])
  const [showPiiPanel, setShowPiiPanel] = useState(false)
  const [isScanningPii, setIsScanningPii] = useState(false)
  const [isDrawMode, setIsDrawMode] = useState(false)
  const [draftRedactionBox, setDraftRedactionBox] = useState<DraftRedactionBox | null>(null)
  const [lastDrawnBoxId, setLastDrawnBoxId] = useState<string | null>(null)
  const [isSavingRedactions, setIsSavingRedactions] = useState(false)
  const [redactionMessage, setRedactionMessage] = useState<string | null>(null)
  const [redactionError, setRedactionError] = useState<string | null>(null)
  const [redactedOutputPath, setRedactedOutputPath] = useState<string | null>(null)
  const [editableSummary, setEditableSummary] = useState<EditableDocumentSummaryFields>(emptyEditableSummaryFields)
  const [initialEditableSummary, setInitialEditableSummary] = useState<EditableDocumentSummaryFields>(emptyEditableSummaryFields)
  const [editableExtractedData, setEditableExtractedData] = useState<unknown>(null)
  const [initialEditableExtractedData, setInitialEditableExtractedData] = useState<unknown>(null)
  const [isSavingDocumentSummary, setIsSavingDocumentSummary] = useState(false)
  const [documentSummarySaveError, setDocumentSummarySaveError] = useState<string | null>(null)
  const [documentSummarySaveMessage, setDocumentSummarySaveMessage] = useState<string | null>(null)

  const showImagePdfAutoDetectWarning = useCallback((asPopup = false) => {
    setRedactionMessage(IMAGE_PDF_AUTO_DETECT_WARNING)
    setRedactionError(null)
    if (asPopup) {
      window.alert(IMAGE_PDF_AUTO_DETECT_WARNING)
    }
  }, [])

  const handlePdfTextLayerSuccess = useCallback((textContent: any) => {
    const items = Array.isArray(textContent?.items) ? textContent.items : []
    const hasText = items.some((item: any) => typeof item?.str === 'string' && item.str.trim().length > 0)
    setCurrentPageHasSelectableText(hasText)
  }, [])

  const handlePdfTextLayerError = useCallback(() => {
    setCurrentPageHasSelectableText(false)
  }, [])

  const handleExportStyleChange = useCallback((nextStyle: ExportStyleProfile) => {
    setExportStyleProfile(nextStyle)
  }, [])

  const errata: ErrataItem[] = Array.isArray(documentIndex?.errata) ? documentIndex.errata : []
  const needsReview: NeedsReviewItem[] = Array.isArray(documentIndex?.needs_review) ? documentIndex.needs_review : []
  const normalizedFilePath = filePath ? normalizeRelativePath(filePath).toLowerCase() : ''
  const normalizedSelectedDraftPreviewPath = selectedDraft?.previewPdfPath
    ? normalizeRelativePath(selectedDraft.previewPdfPath).toLowerCase()
    : ''
  const normalizedSelectedDraftSourcePath = selectedDraft?.path
    ? normalizeRelativePath(selectedDraft.path).toLowerCase()
    : ''
  const normalizedSelectedDraftDocxPath = selectedDraft?.workingDocxPath
    ? normalizeRelativePath(selectedDraft.workingDocxPath).toLowerCase()
    : ''
  const isViewingSelectedDraft = Boolean(
    selectedDraft &&
    normalizedFilePath &&
    (
      normalizedFilePath === normalizedSelectedDraftPreviewPath ||
      normalizedFilePath === normalizedSelectedDraftSourcePath ||
      normalizedFilePath === normalizedSelectedDraftDocxPath
    ),
  )
  const activeFileUrl = isViewingSelectedDraft && draftPreviewUrl ? draftPreviewUrl : fileUrl
  const normalizedPacketPiiPath = packetPiiResult?.path
    ? normalizeRelativePath(packetPiiResult.path).toLowerCase()
    : ''
  const isPacketPiiReviewMode = Boolean(
    packetPiiActive &&
    packetPiiResult &&
    normalizedFilePath &&
    normalizedFilePath === normalizedPacketPiiPath
  )
  const packetBoxes: PacketRedactionBox[] = Array.isArray(packetPiiResult?.boxes) ? packetPiiResult.boxes : []
  const selectedPacketBoxes = packetBoxes.filter((box) => box.selected)
  const packetPiiWarnings = Array.isArray(packetPiiResult?.warnings) ? packetPiiResult.warnings : []
  const packetPiiFindings: PiiFinding[] = Array.isArray(packetPiiResult?.findings)
    ? packetPiiResult.findings
      .map((item) => {
        const kind: 'dob' | 'ssn' = item.kind === 'ssn' ? 'ssn' : 'dob'
        return {
          path: packetPiiResult.path,
          page: Number(item.page),
          kind,
          preview: typeof item.preview === 'string' ? item.preview : '',
        }
      })
      .filter((item): item is PiiFinding => Number.isFinite(item.page) && item.page >= 1)
    : []
  const packetRequiresManualDraw = Boolean(
    isPacketPiiReviewMode &&
    (
      packetPiiResult?.scanned === false ||
      packetPiiWarnings.some((warning) => warning.toLowerCase().includes('text coordinates'))
    )
  )

  const clampPdfPageNumber = useCallback((requestedPage: number): number => {
    const maxPage = pdfNumPages ?? 1
    return Math.min(maxPage, Math.max(1, requestedPage))
  }, [pdfNumPages])

  const goToPdfPage = useCallback((requestedPage: number) => {
    setPdfPageNumber(clampPdfPageNumber(requestedPage))
  }, [clampPdfPageNumber])

  const indexedSummaryTarget = useMemo<IndexedSummaryTarget | null>(() => {
    if (!documentIndex?.folders || !filePath) return null
    const requestedPath = normalizeRelativePath(filePath).toLowerCase()
    if (!requestedPath) return null

    for (const [folderName, folderData] of Object.entries(documentIndex.folders)) {
      const files = getFolderFiles(folderData)
      for (const fileEntry of files) {
        const entryPath = getIndexedFilePath(folderName, fileEntry)
        if (!entryPath || entryPath.toLowerCase() !== requestedPath) continue

        const fileName =
          getIndexedFileName(fileEntry) ||
          filePath.split('/').pop() ||
          filePath

        const titleFromIndex = getObjectStringValue(fileEntry, 'title')
        const keyInfoFromIndex = getObjectStringValue(fileEntry, 'key_info')
        const fields: EditableDocumentSummaryFields = {
          title: titleFromIndex || fileName,
          type: getObjectStringValue(fileEntry, 'type'),
          date: getObjectStringValue(fileEntry, 'date'),
          key_info: keyInfoFromIndex,
          issues: getObjectStringValue(fileEntry, 'issues'),
        }

        return {
          filePath: entryPath,
          fileName,
          fields,
          extractedData: fileEntry && typeof fileEntry === 'object'
            ? cloneJsonValue((fileEntry as Record<string, unknown>).extracted_data ?? null)
            : null,
          isUserReviewed: Boolean(
            fileEntry &&
            typeof fileEntry === 'object' &&
            (fileEntry as Record<string, unknown>).user_reviewed,
          ),
        }
      }
    }

    return null
  }, [documentIndex, filePath])

  // Load drafts when caseFolder changes or tab is activated
  const loadDrafts = useCallback(async () => {
    if (!caseFolder) return
    try {
      const res = await fetch(`${apiUrl}/api/docs/drafts?case=${encodeURIComponent(caseFolder)}`)
      if (res.ok) {
        const data = await res.json()
        setDrafts(data.drafts || [])
      }
    } catch (err) {
      console.error('Failed to load drafts:', err)
    }
  }, [caseFolder, apiUrl])

  useEffect(() => {
    if (activeTab === 'drafts') {
      loadDrafts()
    }
  }, [activeTab, loadDrafts])

  // Reload drafts when refreshDraftsKey changes (triggered by Write tool in Chat)
  useEffect(() => {
    if (refreshDraftsKey !== undefined && refreshDraftsKey > 0) {
      loadDrafts()
    }
  }, [refreshDraftsKey, loadDrafts])

  useEffect(() => {
    if (activeTab !== 'view' || !filePath || drafts.length === 0) return
    const normalizedFilePath = normalizeRelativePath(filePath).toLowerCase()
    if (!normalizedFilePath) return

    const matchingDraft = drafts.find((draft) => {
      const candidates = [draft.previewPdfPath, draft.path, draft.workingDocxPath]
      return candidates.some((candidate) => {
        if (!candidate) return false
        return normalizeRelativePath(candidate).toLowerCase() === normalizedFilePath
      })
    })

    if (matchingDraft) {
      setSelectedDraft((prev) => (prev?.id === matchingDraft.id ? prev : matchingDraft))
    }
  }, [activeTab, drafts, filePath])

  useEffect(() => {
    if (!filePath) return
    setActiveTab('view')
  }, [filePath])

  const clearDraftPreviewRefresh = useCallback(() => {
    if (draftPreviewRefreshTimeoutRef.current !== null) {
      window.clearTimeout(draftPreviewRefreshTimeoutRef.current)
      draftPreviewRefreshTimeoutRef.current = null
    }
  }, [])

  const refreshDraftPreviewFromDocx = useCallback(async (draft: Draft) => {
    if (!caseFolder || !draft.workingDocxPath || !draft.previewPdfPath) return

    setIsRefreshingDraftPreview(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/preview-draft-from-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          docxPath: draft.workingDocxPath,
          previewPath: draft.previewPdfPath,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Draft preview refresh failed' }))
        throw new Error(data.error || 'Draft preview refresh failed')
      }

      const data = await res.json()
      const refreshedPreviewPath = typeof data.previewPath === 'string' ? data.previewPath : draft.previewPdfPath
      const refreshedDocxMtime = typeof data.docxMtimeMs === 'number' ? data.docxMtimeMs : draft.workingDocxMtimeMs
      const refreshedUrl = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(refreshedPreviewPath)}&t=${Date.now()}#view=FitH`

      setSelectedDraft((prev) => {
        if (!prev || prev.id !== draft.id) return prev
        return {
          ...prev,
          previewPdfPath: refreshedPreviewPath,
          workingDocxMtimeMs: refreshedDocxMtime,
        }
      })
      setDraftPreviewUrl(refreshedUrl)
      await loadDrafts()
    } catch (err) {
      console.error('Failed to refresh draft preview:', err)
    } finally {
      setIsRefreshingDraftPreview(false)
    }
  }, [apiUrl, caseFolder, loadDrafts])

  const refreshDraftPreviewFromStyle = useCallback(async (draft: Draft, styleProfile: ExportStyleProfile) => {
    if (!caseFolder || !draft.path) return

    setIsRefreshingDraftPreview(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/preview-draft-from-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          draftPath: draft.path,
          docxPath: draft.workingDocxPath,
          previewPath: draft.previewPdfPath,
          styleProfile,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Styled draft preview refresh failed' }))
        throw new Error(data.error || 'Styled draft preview refresh failed')
      }

      const data = await res.json()
      const refreshedPreviewPath = typeof data.previewPath === 'string' ? data.previewPath : draft.previewPdfPath
      const refreshedDocxPath = typeof data.docxPath === 'string' ? data.docxPath : draft.workingDocxPath
      const refreshedDocxMtime = typeof data.docxMtimeMs === 'number' ? data.docxMtimeMs : draft.workingDocxMtimeMs

      setSelectedDraft((prev) => {
        if (!prev || prev.id !== draft.id) return prev
        return {
          ...prev,
          workingDocxPath: refreshedDocxPath,
          previewPdfPath: refreshedPreviewPath,
          workingDocxMtimeMs: refreshedDocxMtime,
        }
      })

      if (refreshedPreviewPath) {
        const refreshedUrl = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(refreshedPreviewPath)}&t=${Date.now()}#view=FitH`
        setDraftPreviewUrl(refreshedUrl)
      } else {
        setDraftPreviewUrl(null)
      }

      await loadDrafts()
    } catch (err) {
      console.error('Failed to refresh styled draft preview:', err)
    } finally {
      setIsRefreshingDraftPreview(false)
    }
  }, [apiUrl, caseFolder, loadDrafts])

  const handleEditDraftInWord = useCallback(async () => {
    const docxPath = selectedDraft?.workingDocxPath
    if (!caseFolder || !docxPath) return

    setIsOpeningDraftWord(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/open-local-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          path: docxPath,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Could not open Word' }))
        throw new Error(data.error || 'Could not open Word')
      }
      setIsWatchingDraftWordEdits(true)
    } catch (err) {
      console.error('Failed to open draft in Word:', err)
    } finally {
      setIsOpeningDraftWord(false)
    }
  }, [apiUrl, caseFolder, selectedDraft])

  const handleViewDraft = useCallback(async (draft: Draft) => {
    if (!caseFolder) return

    setSelectedDraft(draft)
    setActiveTab('view')

    let previewPath = draft.previewPdfPath
    let nextDraft = draft

    if (!previewPath && draft.workingDocxPath) {
      setIsRefreshingDraftPreview(true)
      try {
        const res = await fetch(`${apiUrl}/api/docs/preview-draft-from-docx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseFolder,
            docxPath: draft.workingDocxPath,
            previewPath: draft.workingDocxPath.replace(/\.docx$/i, '.preview.pdf'),
          }),
        })

        if (res.ok) {
          const data = await res.json()
          previewPath = typeof data.previewPath === 'string' ? data.previewPath : previewPath
          nextDraft = {
            ...draft,
            previewPdfPath: previewPath,
            workingDocxMtimeMs: typeof data.docxMtimeMs === 'number' ? data.docxMtimeMs : draft.workingDocxMtimeMs,
          }
          setSelectedDraft(nextDraft)
          await loadDrafts()
        }
      } catch (err) {
        console.error('Failed to generate draft preview:', err)
      } finally {
        setIsRefreshingDraftPreview(false)
      }
    }

    if (previewPath) {
      setDraftPreviewUrl(
        `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(previewPath)}&t=${Date.now()}#view=FitH`,
      )
      onOpenFilePath?.(previewPath)
      return
    }

    onOpenFilePath?.(nextDraft.path)
  }, [apiUrl, caseFolder, loadDrafts, onOpenFilePath])

  const handleDuplicatePacketDraft = useCallback(async (draftId: string) => {
    if (!caseFolder) return
    try {
      const res = await fetch(`${apiUrl}/api/docs/packet-draft/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, draftId }),
      })
      if (res.ok) {
        const data = await res.json()
        await loadDrafts()
        if (onOpenPacketDraft) onOpenPacketDraft(data.draftId)
      }
    } catch (err) {
      console.error('Failed to duplicate draft:', err)
    }
  }, [caseFolder, apiUrl, loadDrafts, onOpenPacketDraft])

  const handleDeletePacketDraft = useCallback(async (draftId: string, name: string) => {
    if (!caseFolder) return
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`${apiUrl}/api/docs/packet-draft/${draftId}?case=${encodeURIComponent(caseFolder)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await loadDrafts()
      }
    } catch (err) {
      console.error('Failed to delete draft:', err)
    }
  }, [caseFolder, apiUrl, loadDrafts])

  useEffect(() => {
    if (!evidencePacketPath || !caseFolder) return
    setPendingEvidencePacketPath(evidencePacketPath)
    setSelectedDraft(null)
    setActiveTab('view')
    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(evidencePacketPath)}#view=FitH`
    window.open(url, '_blank', 'width=1200,height=900')
  }, [apiUrl, caseFolder, evidencePacketPath, evidencePacketVersion])

  // Track currently selected draft preview metadata
  useEffect(() => {
    if (!selectedDraft || !caseFolder) {
      selectedDraftIdRef.current = null
      setDraftPreviewUrl(null)
      setIsWatchingDraftWordEdits(false)
      clearDraftPreviewRefresh()
      return
    }

    const isNewDraftSelection = selectedDraftIdRef.current !== selectedDraft.id
    if (isNewDraftSelection) {
      setIsWatchingDraftWordEdits(false)
      clearDraftPreviewRefresh()
    }
    selectedDraftIdRef.current = selectedDraft.id

    if (selectedDraft.previewPdfPath) {
      setDraftPreviewUrl(
        `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(selectedDraft.previewPdfPath)}&t=${Date.now()}#view=FitH`,
      )
    } else {
      setDraftPreviewUrl(null)
    }
  }, [selectedDraft, caseFolder, apiUrl, clearDraftPreviewRefresh])

  useEffect(() => {
    if (selectedDraft) {
      const inferredDraftStyle = inferStyleProfileFromDraft(selectedDraft)
      setExportStyleProfile((current) => (current === inferredDraftStyle ? current : inferredDraftStyle))
      return
    }

    const inferredDocumentStyle = inferStyleProfileFromHint(`${fileName} ${filePath || ''}`)
    setExportStyleProfile((current) => (current === inferredDocumentStyle ? current : inferredDocumentStyle))
  }, [selectedDraft?.id, selectedDraft?.type, fileName, filePath])

  useEffect(() => {
    if (previousStyleProfileRef.current === exportStyleProfile) return
    previousStyleProfileRef.current = exportStyleProfile
    if (activeTab !== 'view' || !selectedDraft || !isViewingSelectedDraft) return
    void refreshDraftPreviewFromStyle(selectedDraft, exportStyleProfile)
  }, [activeTab, exportStyleProfile, isViewingSelectedDraft, refreshDraftPreviewFromStyle, selectedDraft])

  useEffect(() => {
    return () => {
      clearDraftPreviewRefresh()
    }
  }, [clearDraftPreviewRefresh])

  useEffect(() => {
    if (activeTab !== 'view') {
      setIsWatchingDraftWordEdits(false)
      clearDraftPreviewRefresh()
    }
  }, [activeTab, clearDraftPreviewRefresh])

  useEffect(() => {
    if (activeTab === 'drafts') {
      setSelectedDraft(null)
      setDraftExportMenuOpen(false)
      setDraftContent('')
    }
  }, [activeTab])

  useEffect(() => {
    if (!isWatchingDraftWordEdits || activeTab !== 'view' || !selectedDraft) return
    const docxPath = selectedDraft.workingDocxPath
    const previewPath = selectedDraft.previewPdfPath
    if (!docxPath || !previewPath || !caseFolder) return

    let disposed = false
    const pollMtime = async () => {
      if (disposed || isRefreshingDraftPreview) return
      try {
        const res = await fetch(
          `${apiUrl}/api/docs/file-mtime?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(docxPath)}`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (!data.exists || typeof data.mtimeMs !== 'number') return

        const knownMtime = selectedDraft.workingDocxMtimeMs
        if (typeof knownMtime === 'number' && data.mtimeMs <= knownMtime) {
          return
        }

        setSelectedDraft((prev) => {
          if (!prev || prev.id !== selectedDraft.id) return prev
          return {
            ...prev,
            workingDocxMtimeMs: data.mtimeMs,
          }
        })

        clearDraftPreviewRefresh()
        draftPreviewRefreshTimeoutRef.current = window.setTimeout(() => {
          draftPreviewRefreshTimeoutRef.current = null
          void refreshDraftPreviewFromDocx({
            ...selectedDraft,
            workingDocxPath: docxPath,
            previewPdfPath: previewPath,
            workingDocxMtimeMs: data.mtimeMs,
          })
        }, 700)
      } catch {
        // Keep polling while Word may still be writing.
      }
    }

    void pollMtime()
    const intervalId = window.setInterval(() => {
      void pollMtime()
    }, 2000)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
    }
  }, [
    activeTab,
    apiUrl,
    caseFolder,
    clearDraftPreviewRefresh,
    isRefreshingDraftPreview,
    isWatchingDraftWordEdits,
    refreshDraftPreviewFromDocx,
    selectedDraft,
  ])

  // Check bundle status when a demand letter draft is selected
  useEffect(() => {
    if (!selectedDraft || !caseFolder || selectedDraft.type !== 'demand') {
      setCanBundle(false)
      setBundleError(null)
      return
    }

    const checkBundleStatus = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/docs/bundle-status?case=${encodeURIComponent(caseFolder)}`)
        if (res.ok) {
          const data = await res.json()
          setCanBundle(data.canBundle)
          if (!data.canBundle) {
            if (!data.hasExhibits) {
              setBundleError('No exhibits listed in manifest')
            } else if (data.missingExhibits?.length > 0) {
              setBundleError(`${data.missingExhibits.length} exhibit(s) missing`)
            }
          } else {
            setBundleError(null)
          }
        }
      } catch (err) {
        console.error('Failed to check bundle status:', err)
        setCanBundle(false)
      }
    }

    checkBundleStatus()
  }, [selectedDraft, caseFolder, apiUrl])

  useEffect(() => {
    setPendingEvidencePacketPath(null)
  }, [caseFolder])

  // Reset PDF state when file changes
  useEffect(() => {
    setPdfPageNumber(1)
    setPdfPageInput('1')
    setPdfNumPages(null)
    setPdfScale(1.0)
  }, [activeFileUrl])

  useEffect(() => {
    setPdfPageInput(String(pdfPageNumber))
  }, [pdfPageNumber])

  // Measure PDF container width for responsive sizing
  useEffect(() => {
    if (!pdfContainerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPdfContainerWidth(entry.contentRect.width)
      }
    })

    resizeObserver.observe(pdfContainerRef.current)
    return () => resizeObserver.disconnect()
  }, [activeFileUrl])

  useEffect(() => {
    if (!pageLayerRef.current) {
      setPageLayerSize(null)
      return
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPageLayerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })

    observer.observe(pageLayerRef.current)
    return () => observer.disconnect()
  }, [activeFileUrl, pdfPageNumber, pdfScale, pdfContainerWidth])

  useEffect(() => {
    setPiiFindings([])
    setPiiWarnings([])
    setDetectedBoxes([])
    setManualBoxes([])
    setShowPiiPanel(false)
    setIsDrawMode(false)
    setDraftRedactionBox(null)
    setLastDrawnBoxId(null)
    setRedactionMessage(null)
    setRedactionError(null)
    setRedactedOutputPath(null)
    activeDrawPointerIdRef.current = null
    autoEnabledDrawForFileRef.current = null
    setCurrentPageHasSelectableText(null)
  }, [filePath])

  useEffect(() => {
    if (isDrawMode) return
    setDraftRedactionBox(null)
    activeDrawPointerIdRef.current = null
  }, [isDrawMode])

  useEffect(() => {
    if (!fileName.toLowerCase().endsWith('.pdf')) return
    setCurrentPageHasSelectableText(null)
  }, [filePath, fileName, pdfPageNumber])

  useEffect(() => {
    if (!isPacketPiiReviewMode || !fileName.toLowerCase().endsWith('.pdf')) return
    if (!packetRequiresManualDraw) return
    setIsDrawMode(true)
    showImagePdfAutoDetectWarning(false)
  }, [fileName, isPacketPiiReviewMode, packetRequiresManualDraw, normalizedFilePath, showImagePdfAutoDetectWarning])

  useEffect(() => {
    if (!fileName.toLowerCase().endsWith('.pdf')) return
    if (currentPageHasSelectableText !== false) return
    const fileKey = normalizedFilePath || fileName.toLowerCase()
    if (!fileKey) return
    if (autoEnabledDrawForFileRef.current === fileKey) return
    autoEnabledDrawForFileRef.current = fileKey
    setIsDrawMode((prev) => (prev ? prev : true))
  }, [
    currentPageHasSelectableText,
    fileName,
    normalizedFilePath,
  ])

  useEffect(() => {
    if (!indexedSummaryTarget) {
      setEditableSummary(emptyEditableSummaryFields())
      setInitialEditableSummary(emptyEditableSummaryFields())
      setEditableExtractedData(null)
      setInitialEditableExtractedData(null)
      setDocumentSummarySaveError(null)
      setDocumentSummarySaveMessage(null)
      return
    }

    setEditableSummary(indexedSummaryTarget.fields)
    setInitialEditableSummary(indexedSummaryTarget.fields)
    setEditableExtractedData(cloneJsonValue(indexedSummaryTarget.extractedData))
    setInitialEditableExtractedData(cloneJsonValue(indexedSummaryTarget.extractedData))
    setDocumentSummarySaveError(null)
    setDocumentSummarySaveMessage(null)
  }, [indexedSummaryTarget])

  const handleEditableSummaryFieldChange = (
    field: keyof EditableDocumentSummaryFields,
    value: string,
  ) => {
    setEditableSummary((prev) => ({ ...prev, [field]: value }))
    if (documentSummarySaveError) setDocumentSummarySaveError(null)
    if (documentSummarySaveMessage) setDocumentSummarySaveMessage(null)
  }

  const commitPdfPageInput = useCallback(() => {
    const trimmedInput = pdfPageInput.trim()
    if (!trimmedInput) {
      setPdfPageInput(String(pdfPageNumber))
      return
    }

    const parsedPage = Number.parseInt(trimmedInput, 10)
    if (Number.isNaN(parsedPage)) {
      setPdfPageInput(String(pdfPageNumber))
      return
    }

    const clampedPage = clampPdfPageNumber(parsedPage)
    setPdfPageNumber(clampedPage)
    setPdfPageInput(String(clampedPage))
  }, [clampPdfPageNumber, pdfPageInput, pdfPageNumber])

  const handleResetEditableSummary = () => {
    setEditableSummary(initialEditableSummary)
    setEditableExtractedData(cloneJsonValue(initialEditableExtractedData))
    setDocumentSummarySaveError(null)
    setDocumentSummarySaveMessage(null)
  }

  const handleEditableExtractedFieldChange = (path: string, value: string) => {
    setEditableExtractedData((prev: unknown) => writeValueAtPath(prev, path, value))
    if (documentSummarySaveError) setDocumentSummarySaveError(null)
    if (documentSummarySaveMessage) setDocumentSummarySaveMessage(null)
  }

  const handleApproveEditableSummary = useCallback(async () => {
    if (!caseFolder || !indexedSummaryTarget) return

    setIsSavingDocumentSummary(true)
    setDocumentSummarySaveError(null)
    setDocumentSummarySaveMessage(null)

    try {
      const summaryIsDirty = !areEditableSummaryFieldsEqual(editableSummary, initialEditableSummary)
      const extractedDataIsDirty =
        JSON.stringify(editableExtractedData ?? null) !== JSON.stringify(initialEditableExtractedData ?? null)

      const requestBody: Record<string, unknown> = {
        caseFolder,
        filePath: indexedSummaryTarget.filePath,
      }

      if (summaryIsDirty) {
        requestBody.updates = {
          title: editableSummary.title,
          type: editableSummary.type,
          date: editableSummary.date,
          key_info: editableSummary.key_info,
          issues: editableSummary.issues,
        }
      }

      if (extractedDataIsDirty) {
        requestBody.extractedData = editableExtractedData
      }

      if (!summaryIsDirty && !extractedDataIsDirty) {
        requestBody.approveOnly = true
      }

      const res = await fetch(`${apiUrl}/api/files/document-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save document summary')
      }

      setInitialEditableSummary(editableSummary)
      setInitialEditableExtractedData(cloneJsonValue(editableExtractedData))
      const isApprovalOnly = Boolean(data?.approvalOnly)
      const reviewStatus = typeof data?.reviewStatus === 'string' ? data.reviewStatus : ''
      if (isApprovalOnly && reviewStatus === 'already-reviewed') {
        setDocumentSummarySaveMessage('Already approved.')
      } else if (isApprovalOnly) {
        setDocumentSummarySaveMessage('Approved with no changes.')
      } else {
        setDocumentSummarySaveMessage('Approved and saved to document index.')
      }
      onIndexUpdated()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save document summary'
      setDocumentSummarySaveError(message)
    } finally {
      setIsSavingDocumentSummary(false)
    }
  }, [apiUrl, caseFolder, editableExtractedData, editableSummary, indexedSummaryTarget, initialEditableExtractedData, initialEditableSummary, onIndexUpdated])

  const redactionBoxKey = useCallback((box: RedactionBoxInput) => (
    `${box.page}:${box.xPct.toFixed(5)}:${box.yPct.toFixed(5)}:${box.widthPct.toFixed(5)}:${box.heightPct.toFixed(5)}`
  ), [])

  const updatePacketPiiBoxes = useCallback((
    updater: (boxes: PacketRedactionBox[]) => PacketRedactionBox[]
  ) => {
    if (!isPacketPiiReviewMode || !packetPiiResult?.path || !onPacketPiiResultUpdate) return
    onPacketPiiResultUpdate(packetPiiResult.path, (prev) => ({
      ...prev,
      approved: false,
      boxes: updater(Array.isArray(prev.boxes) ? prev.boxes : []),
    }))
  }, [isPacketPiiReviewMode, onPacketPiiResultUpdate, packetPiiResult])

  const handleTogglePacketRedactionBox = useCallback((boxId: string) => {
    updatePacketPiiBoxes((boxes) => boxes.map((box) => (
      box.id === boxId ? { ...box, selected: !box.selected } : box
    )))
  }, [updatePacketPiiBoxes])

  const getOverlayPoint = (event: {
    currentTarget: HTMLDivElement
    clientX: number
    clientY: number
  }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    return { x, y }
  }

  const finalizeDraftRedactionBox = useCallback(() => {
    if (!draftRedactionBox) return

    const left = Math.min(draftRedactionBox.startX, draftRedactionBox.currentX)
    const top = Math.min(draftRedactionBox.startY, draftRedactionBox.currentY)
    const width = Math.abs(draftRedactionBox.currentX - draftRedactionBox.startX)
    const height = Math.abs(draftRedactionBox.currentY - draftRedactionBox.startY)

    setDraftRedactionBox(null)

    if (width < 6 || height < 6) {
      setRedactionError(null)
      return
    }

    const pageRect = pageLayerRef.current?.getBoundingClientRect()
    const layerWidth = pageRect && pageRect.width > 0
      ? pageRect.width
      : (pageLayerSize?.width || 0)
    const layerHeight = pageRect && pageRect.height > 0
      ? pageRect.height
      : (pageLayerSize?.height || 0)
    if (layerWidth <= 0 || layerHeight <= 0) {
      setRedactionError('Unable to measure page for drawing. Try zooming or reopening this file.')
      setRedactionMessage(null)
      return
    }

    const normalized = {
      page: pdfPageNumber,
      xPct: clamp01(left / layerWidth),
      yPct: clamp01(top / layerHeight),
      widthPct: clamp01(width / layerWidth),
      heightPct: clamp01(height / layerHeight),
    }

    let committedBoxId: string | null = null
    if (isPacketPiiReviewMode) {
      const key = packetBoxKey(normalized)
      const drawId = `draw:${key}`
      updatePacketPiiBoxes((boxes) => {
        const existingIndex = boxes.findIndex((box) => packetBoxKey(box) === key)
        if (existingIndex >= 0) {
          committedBoxId = boxes[existingIndex].id
          return boxes.map((box, index) => (
            index === existingIndex ? { ...box, selected: true, source: 'draw' } : box
          ))
        }
        committedBoxId = drawId
        return [
          ...boxes,
          {
            id: drawId,
            ...normalized,
            selected: true,
            source: 'draw',
          },
        ]
      })
    } else {
      const manualId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      committedBoxId = manualId
      setManualBoxes((prev) => [
        ...prev,
        {
          id: manualId,
          ...normalized,
          source: 'manual',
        },
      ])
    }
    setLastDrawnBoxId(committedBoxId)
    setRedactionMessage(null)
    setRedactionError(null)
  }, [draftRedactionBox, isPacketPiiReviewMode, pageLayerSize, pdfPageNumber, updatePacketPiiBoxes])

  const handlePacketAutoBoxClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!isPacketPiiReviewMode || isDrawMode || !packetPiiResult?.path || !onPacketPiiResultUpdate) return

    if (packetRequiresManualDraw) {
      showImagePdfAutoDetectWarning(true)
      return
    }

    const pageRect = pageLayerRef.current?.getBoundingClientRect()
    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return
    const clickXPct = clamp01((event.clientX - pageRect.left) / pageRect.width)
    const clickYPct = clamp01((event.clientY - pageRect.top) / pageRect.height)

    const clickedBox = selectedPacketBoxes.find((box) => (
      box.page === pdfPageNumber &&
      clickXPct >= box.xPct &&
      clickXPct <= box.xPct + box.widthPct &&
      clickYPct >= box.yPct &&
      clickYPct <= box.yPct + box.heightPct
    ))
    if (clickedBox) {
      handleTogglePacketRedactionBox(clickedBox.id)
      return
    }

    const target = event.target as HTMLElement | null
    if (!target) return

    const autoDetectedTextBox = buildAutoDetectedTextBox(target, event.clientX, pageRect)
    if (!autoDetectedTextBox) return
    const {
      left,
      top,
      width,
      height,
      text,
      kind: matchedKind,
    } = autoDetectedTextBox
    if (!text) return

    const normalized = {
      page: pdfPageNumber,
      xPct: clamp01(left / pageRect.width),
      yPct: clamp01(top / pageRect.height),
      widthPct: clamp01(width / pageRect.width),
      heightPct: clamp01(height / pageRect.height),
    }
    const key = packetBoxKey(normalized)
    const inferredKind = matchedKind || inferPiiKindFromText(text)
    const preview = text.length > 32 ? `${text.slice(0, 29)}...` : text

    onPacketPiiResultUpdate(packetPiiResult.path, (prev) => {
      const boxes = Array.isArray(prev.boxes) ? prev.boxes : []
      const existingIndex = boxes.findIndex((box) => packetBoxKey(box) === key)
      if (existingIndex >= 0) {
        const existing = boxes[existingIndex]
        return {
          ...prev,
          approved: false,
          boxes: boxes.map((box, index) => (
            index === existingIndex ? { ...existing, selected: !existing.selected } : box
          )),
        }
      }

      return {
        ...prev,
        approved: false,
        boxes: [
          ...boxes,
          {
            id: `text:${key}`,
            ...normalized,
            selected: true,
            source: 'text',
            kind: inferredKind,
            preview,
          },
        ],
      }
    })
    setRedactionMessage(null)
    setRedactionError(null)
  }, [
    handleTogglePacketRedactionBox,
    isDrawMode,
    isPacketPiiReviewMode,
    onPacketPiiResultUpdate,
    packetPiiResult?.path,
    packetRequiresManualDraw,
    pdfPageNumber,
    selectedPacketBoxes,
    showImagePdfAutoDetectWarning,
  ])

  const handleScanPii = useCallback(async () => {
    if (!caseFolder || !filePath || !fileName.toLowerCase().endsWith('.pdf')) return

    setIsScanningPii(true)
    setRedactionMessage(null)
    setRedactionError(null)

    try {
      const res = await fetch(`${apiUrl}/api/docs/scan-pii`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, path: filePath }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'PII scan failed')
      }

      const findings: PiiFinding[] = Array.isArray(data?.findings)
        ? data.findings
          .map((item: any) => ({
            path: typeof item?.path === 'string' ? item.path : filePath,
            page: typeof item?.page === 'number' ? item.page : Number(item?.page),
            kind: item?.kind === 'ssn' ? 'ssn' : 'dob',
            preview: typeof item?.preview === 'string' ? item.preview : '',
          }))
          .filter((item: PiiFinding) => Number.isFinite(item.page) && item.page >= 1)
          .sort((a: PiiFinding, b: PiiFinding) => a.page - b.page)
        : []

      const boxes: OverlayRedactionBox[] = Array.isArray(data?.boxes)
        ? data.boxes
          .map((item: any, index: number) => ({
            id: `detected-${Date.now()}-${index}`,
            page: typeof item?.page === 'number' ? item.page : Number(item?.page),
            xPct: clamp01(typeof item?.xPct === 'number' ? item.xPct : Number(item?.xPct)),
            yPct: clamp01(typeof item?.yPct === 'number' ? item.yPct : Number(item?.yPct)),
            widthPct: clamp01(typeof item?.widthPct === 'number' ? item.widthPct : Number(item?.widthPct)),
            heightPct: clamp01(typeof item?.heightPct === 'number' ? item.heightPct : Number(item?.heightPct)),
            source: 'detected' as const,
            kind: item?.kind === 'ssn' ? 'ssn' : 'dob',
            preview: typeof item?.preview === 'string' ? item.preview : '',
          }))
          .filter((item: OverlayRedactionBox) => Number.isFinite(item.page) && item.page >= 1 && item.widthPct > 0 && item.heightPct > 0)
        : []

      setPiiFindings(findings)
      setPiiWarnings(Array.isArray(data?.warnings) ? data.warnings.filter((w: any) => typeof w === 'string') : [])
      setDetectedBoxes(boxes)
      setShowPiiPanel(true)
      setRedactionMessage(findings.length > 0
        ? `Found ${findings.length} possible PII item(s).`
        : 'No likely DOB/SSN patterns found in this PDF scan.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PII scan failed'
      setRedactionError(message)
    } finally {
      setIsScanningPii(false)
    }
  }, [apiUrl, caseFolder, fileName, filePath])

  const handleUseDetectedBoxes = useCallback(() => {
    if (isPacketPiiReviewMode) {
      setRedactionMessage('Detected redactions are already active. Click highlighted boxes to toggle.')
      setRedactionError(null)
      return
    }
    if (detectedBoxes.length === 0) return

    setManualBoxes((prev) => {
      const seen = new Set(prev.map((box) => redactionBoxKey(box)))
      const next = [...prev]

      for (const box of detectedBoxes) {
        const normalized: OverlayRedactionBox = {
          id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          page: box.page,
          xPct: box.xPct,
          yPct: box.yPct,
          widthPct: box.widthPct,
          heightPct: box.heightPct,
          source: 'manual',
          kind: box.kind,
          preview: box.preview,
        }
        const key = redactionBoxKey(normalized)
        if (seen.has(key)) continue
        seen.add(key)
        next.push(normalized)
      }

      return next
    })

    setRedactionMessage('Detected boxes copied into manual redactions.')
    setRedactionError(null)
  }, [detectedBoxes, isPacketPiiReviewMode, redactionBoxKey])

  const handleUndoManualBox = useCallback(() => {
    if (isPacketPiiReviewMode) {
      updatePacketPiiBoxes((boxes) => {
        const selectedIndexes = boxes
          .map((box, index) => ({ box, index }))
          .filter(({ box }) => box.selected && box.page === pdfPageNumber)
        if (selectedIndexes.length === 0) return boxes
        const indexToToggle = selectedIndexes[selectedIndexes.length - 1].index
        return boxes.map((box, index) => (
          index === indexToToggle ? { ...box, selected: false } : box
        ))
      })
      setLastDrawnBoxId(null)
      return
    }
    setManualBoxes((prev) => {
      if (prev.length === 0) return prev
      const lastOnPageIndex = [...prev]
        .map((box, index) => ({ box, index }))
        .reverse()
        .find(({ box }) => box.page === pdfPageNumber)?.index
      if (lastOnPageIndex === undefined) return prev.slice(0, -1)
      return prev.filter((_, index) => index !== lastOnPageIndex)
    })
    setLastDrawnBoxId(null)
  }, [isPacketPiiReviewMode, pdfPageNumber, updatePacketPiiBoxes])

  const handleUndoLastDraw = useCallback(() => {
    if (!lastDrawnBoxId) {
      handleUndoManualBox()
      return
    }

    if (isPacketPiiReviewMode) {
      const exists = packetBoxes.some((box) => box.id === lastDrawnBoxId && box.selected)
      if (!exists) {
        handleUndoManualBox()
        return
      }
      updatePacketPiiBoxes((boxes) => boxes.map((box) => (
        box.id === lastDrawnBoxId ? { ...box, selected: false } : box
      )))
    } else {
      const exists = manualBoxes.some((box) => box.id === lastDrawnBoxId)
      if (!exists) {
        handleUndoManualBox()
        return
      }
      setManualBoxes((prev) => prev.filter((box) => box.id !== lastDrawnBoxId))
    }

    setLastDrawnBoxId(null)
    setRedactionMessage(null)
    setRedactionError(null)
  }, [
    handleUndoManualBox,
    isPacketPiiReviewMode,
    lastDrawnBoxId,
    manualBoxes,
    packetBoxes,
    updatePacketPiiBoxes,
  ])

  const handleClearCurrentPageBoxes = useCallback(() => {
    if (isPacketPiiReviewMode) {
      updatePacketPiiBoxes((boxes) => boxes.map((box) => (
        box.page === pdfPageNumber ? { ...box, selected: false } : box
      )))
      setLastDrawnBoxId(null)
      return
    }
    setManualBoxes((prev) => prev.filter((box) => box.page !== pdfPageNumber))
    setLastDrawnBoxId(null)
  }, [isPacketPiiReviewMode, pdfPageNumber, updatePacketPiiBoxes])

  const handleClearAllBoxes = useCallback(() => {
    if (isPacketPiiReviewMode) {
      updatePacketPiiBoxes((boxes) => boxes.map((box) => ({ ...box, selected: false })))
      setLastDrawnBoxId(null)
      return
    }
    setManualBoxes([])
    setLastDrawnBoxId(null)
  }, [isPacketPiiReviewMode, updatePacketPiiBoxes])

  const handleSaveRedactedCopy = useCallback(async () => {
    if (!caseFolder || !filePath || manualBoxes.length === 0) return

    setIsSavingRedactions(true)
    setRedactionMessage(null)
    setRedactionError(null)

    try {
      const boxes: RedactionBoxInput[] = manualBoxes.map((box) => ({
        page: box.page,
        xPct: box.xPct,
        yPct: box.yPct,
        widthPct: box.widthPct,
        heightPct: box.heightPct,
      }))

      const res = await fetch(`${apiUrl}/api/docs/redact-pdf-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, path: filePath, boxes }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save redacted copy')
      }

      const outputPath = typeof data?.outputPath === 'string' ? data.outputPath : null
      setRedactedOutputPath(outputPath)
      setRedactionMessage(outputPath
        ? `Saved redacted copy: ${outputPath}`
        : 'Saved redacted copy.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save redacted copy'
      setRedactionError(message)
    } finally {
      setIsSavingRedactions(false)
    }
  }, [apiUrl, caseFolder, filePath, manualBoxes])

  const handleOpenRedactedCopy = useCallback(() => {
    if (!caseFolder || !redactedOutputPath) return
    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(redactedOutputPath)}#view=FitH`
    window.open(url, '_blank', 'width=1200,height=900')
  }, [apiUrl, caseFolder, redactedOutputPath])

  const handleReviewEvidencePacket = useCallback(() => {
    if (!caseFolder || !pendingEvidencePacketPath) return
    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(pendingEvidencePacketPath)}#view=FitH`
    window.open(url, '_blank', 'width=1200,height=900')

    setActiveTab('view')
  }, [apiUrl, caseFolder, pendingEvidencePacketPath])

  // Handle bundle generation
  const handleGeneratePackage = async () => {
    if (!caseFolder) return
    setIsBundling(true)
    setBundleError(null)

    try {
      const res = await fetch(`${apiUrl}/api/docs/bundle-demand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder }),
      })

      if (res.ok) {
        // Download the PDF
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = '3P Demand Package.pdf'
        link.click()
        URL.revokeObjectURL(url)
      } else {
        const error = await res.json()
        setBundleError(error.error || 'Failed to generate package')
      }
    } catch (err) {
      console.error('Failed to generate package:', err)
      setBundleError('Failed to generate package')
    } finally {
      setIsBundling(false)
    }
  }

  const handleApproveDraft = async (draft: Draft, format: 'pdf' | 'docx' = 'pdf') => {
    if (!caseFolder) return
    setIsApprovingDraft(true)
    setDraftExportMenuOpen(false)

    try {
      const res = await fetch(`${apiUrl}/api/docs/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          draftPath: draft.path,
          targetPath: draft.targetPath.replace('.pdf', `.${format}`),
          format,
          styleProfile: exportStyleProfile,
        }),
      })

      if (res.ok) {
        // Refresh drafts list
        await loadDrafts()
        setSelectedDraft(null)
        setDraftContent('')
        onDraftsUpdated?.()
      } else {
        const error = await res.json()
        console.error('Approve failed:', error)
      }
    } catch (err) {
      console.error('Failed to approve draft:', err)
    } finally {
      setIsApprovingDraft(false)
    }
  }

  const buildExportUrl = useCallback((path: string, format: 'md' | 'docx' | 'pdf' | 'txt') => {
    const params = new URLSearchParams({
      case: caseFolder,
      path,
      format,
      styleProfile: exportStyleProfile,
    })
    return `${apiUrl}/api/docs/download?${params.toString()}`
  }, [apiUrl, caseFolder, exportStyleProfile])

  const handleExportDraft = (format: 'md' | 'docx' | 'pdf' | 'txt') => {
    setDraftExportMenuOpen(false)
    if (!selectedDraft || !caseFolder) return

    const url = buildExportUrl(selectedDraft.path, format)

    if (format === 'pdf') {
      window.open(url, '_blank')
    } else {
      const link = document.createElement('a')
      link.href = url
      link.download = ''
      link.click()
    }
  }

  const formatDate = (dateStr: string) => {
    return formatDateMMDDYYYY(dateStr, dateStr)
  }

  const getDraftTypeIcon = (type: string) => {
    switch (type) {
      case 'demand':
        return '📄'
      case 'settlement':
        return '💰'
      case 'memo':
        return '📋'
      case 'hearing_decision':
        return '⚖️'
      default:
        return '📝'
    }
  }

  // Load verified items from server when case changes
  useEffect(() => {
    if (!caseFolder) return

    const loadVerifiedItems = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/files/verified-items?case=${encodeURIComponent(caseFolder)}`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.verified)) {
            setVerifiedItems(new Set(data.verified))
          }
        }
      } catch (err) {
        console.error('Failed to load verified items:', err)
      }
    }

    loadVerifiedItems()
  }, [caseFolder, apiUrl])

  // Count unverified errata items (needsReview items require manual resolution, so always counted)
  const unverifiedErrataCount = errata.filter(rawItem => {
    const item = typeof rawItem === 'string' ? { field: `Note ${errata.indexOf(rawItem) + 1}` } : rawItem
    const field = item.field || `Item ${errata.indexOf(rawItem) + 1}`
    return !verifiedItems.has(field)
  }).length
  const totalReviewItems = unverifiedErrataCount + needsReview.length

  const handleVerify = async (field: string) => {
    const newVerified = new Set([...verifiedItems, field])
    setVerifiedItems(newVerified)

    // Persist to server
    try {
      await fetch(`${apiUrl}/api/files/verified-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, verified: Array.from(newVerified) })
      })
    } catch (err) {
      console.error('Failed to save verified item:', err)
    }
  }

  const handleCorrect = async (field: string, newValue: string) => {
    try {
      await fetch(`${apiUrl}/api/claude/errata-correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, field, correctedValue: newValue })
      })
      setEditingItem(null)
      setCorrectionValue('')
      onIndexUpdated()
    } catch (err) {
      console.error('Failed to save correction:', err)
    }
  }

  const handleDownload = () => {
    if (activeFileUrl) {
      window.open(activeFileUrl, '_blank')
      return
    }
    if (!content) return

    const blob = new Blob([content], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'view.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExport = (format: 'md' | 'docx' | 'pdf' | 'txt') => {
    setExportMenuOpen(false)
    if (!docPath || !caseFolder) return

    const url = buildExportUrl(docPath, format)

    if (format === 'pdf') {
      // PDF opens in new tab (browser renders it natively)
      window.open(url, '_blank')
    } else {
      // Word/Markdown downloads via link click (triggers OS file association)
      const link = document.createElement('a')
      link.href = url
      link.download = ''
      link.click()
    }
  }

  // Check if current content is exportable (has a doc path and is markdown-like)
  const isExportable = docPath && (docPath.endsWith('.md') || content.startsWith('#') || content.includes('\n##'))
  const hasIndexedSummaryEditor = viewMode === 'summary' && !!indexedSummaryTarget
  const extractedFieldRows = useMemo(
    () => flattenExtractedFields(editableExtractedData).filter((entry) => entry.path.trim().length > 0),
    [editableExtractedData],
  )
  const extractedFieldSections = useMemo<ExtractedFieldSection[]>(() => {
    const grouped = new Map<string, DisplayedExtractedField[]>()
    for (const row of extractedFieldRows) {
      const display = formatExtractedFieldForDisplay(row)
      if (!grouped.has(display.section)) {
        grouped.set(display.section, [])
      }
      grouped.get(display.section)?.push(display)
    }

    return Array.from(grouped.entries())
      .map(([section, fields]) => ({
        section,
        fields: [...fields].sort((a, b) => {
          const byLabel = a.label.localeCompare(b.label, undefined, { numeric: true })
          if (byLabel !== 0) return byLabel
          return a.rawPath.localeCompare(b.rawPath, undefined, { numeric: true })
        }),
      }))
      .sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }))
  }, [extractedFieldRows])
  const isEditableSummaryDirty = !areEditableSummaryFieldsEqual(editableSummary, initialEditableSummary)
  const isEditableExtractedDirty =
    JSON.stringify(editableExtractedData ?? null) !== JSON.stringify(initialEditableExtractedData ?? null)
  const hasAnyDocumentEdits = isEditableSummaryDirty || isEditableExtractedDirty
  const isIndexedSummaryReviewed = Boolean(indexedSummaryTarget?.isUserReviewed)
  const canSubmitDocumentReview = !isSavingDocumentSummary && (hasAnyDocumentEdits || !isIndexedSummaryReviewed)
  const documentReviewActionLabel = isSavingDocumentSummary
    ? 'Approving...'
    : hasAnyDocumentEdits
      ? 'Approve Changes'
      : isIndexedSummaryReviewed
        ? 'Approved'
        : 'Approve'

  const isHtml = content.includes('<div') || content.includes('<table')
  const isMarkdown = content.startsWith('#') || content.includes('\n##') || content.includes('\n- ') || content.includes('\n* ')
  const isPdf = fileName.toLowerCase().endsWith('.pdf')
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)
  const effectivePiiFindings = isPacketPiiReviewMode ? packetPiiFindings : piiFindings
  const effectivePiiWarnings = isPacketPiiReviewMode ? packetPiiWarnings : piiWarnings
  const selectedPacketBoxesOnPage = selectedPacketBoxes.filter((box) => box.page === pdfPageNumber)
  const currentPageDetectedBoxes = isPacketPiiReviewMode
    ? selectedPacketBoxesOnPage
      .filter((box) => box.source !== 'draw')
      .map((box) => ({
        id: box.id,
        page: box.page,
        xPct: box.xPct,
        yPct: box.yPct,
        widthPct: box.widthPct,
        heightPct: box.heightPct,
        source: 'detected' as const,
        kind: box.kind,
        preview: box.preview,
      }))
    : detectedBoxes.filter((box) => box.page === pdfPageNumber)
  const currentPageManualBoxes = isPacketPiiReviewMode
    ? selectedPacketBoxesOnPage
      .filter((box) => box.source === 'draw')
      .map((box) => ({
        id: box.id,
        page: box.page,
        xPct: box.xPct,
        yPct: box.yPct,
        widthPct: box.widthPct,
        heightPct: box.heightPct,
        source: 'manual' as const,
        kind: box.kind,
        preview: box.preview,
      }))
    : manualBoxes.filter((box) => box.page === pdfPageNumber)
  const effectiveManualBoxCount = isPacketPiiReviewMode ? selectedPacketBoxes.length : manualBoxes.length
  const effectiveCurrentPageManualCount = isPacketPiiReviewMode
    ? selectedPacketBoxesOnPage.length
    : currentPageManualBoxes.length
  const hasLastDrawnBox = Boolean(
    lastDrawnBoxId &&
    (
      isPacketPiiReviewMode
        ? packetBoxes.some((box) => box.id === lastDrawnBoxId && box.selected)
        : manualBoxes.some((box) => box.id === lastDrawnBoxId)
    )
  )

  const draftBoxStyle = draftRedactionBox
    ? {
        left: Math.min(draftRedactionBox.startX, draftRedactionBox.currentX),
        top: Math.min(draftRedactionBox.startY, draftRedactionBox.currentY),
        width: Math.abs(draftRedactionBox.currentX - draftRedactionBox.startX),
        height: Math.abs(draftRedactionBox.currentY - draftRedactionBox.startY),
      }
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-surface-200">
        <button
          onClick={() => setActiveTab('view')}
          className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'view'
              ? 'text-brand-900 border-b-2 border-brand-900 bg-white'
              : 'text-brand-500 hover:text-brand-700 hover:bg-surface-50'
          }`}
        >
          View
        </button>
        <button
          onClick={() => setActiveTab('review')}
          className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'review'
              ? 'text-brand-900 border-b-2 border-brand-900 bg-white'
              : 'text-brand-500 hover:text-brand-700 hover:bg-surface-50'
          }`}
        >
          Review {totalReviewItems > 0 && <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${needsReview.length > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{totalReviewItems}</span>}
        </button>
        <button
          onClick={() => {
            setSelectedDraft(null)
            setDraftContent('')
            setActiveTab('drafts')
          }}
          className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === 'drafts'
              ? 'text-brand-900 border-b-2 border-brand-900 bg-white'
              : 'text-brand-500 hover:text-brand-700 hover:bg-surface-50'
          }`}
        >
          Drafts {drafts.length > 0 && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">{drafts.length}</span>}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'drafts' ? (
        <div className="flex-1 overflow-auto">
          {selectedDraft && String(activeTab) === 'view' ? (
            // Draft preview view
            <div className="flex flex-col h-full">
              {/* Draft header */}
              <div className="px-4 py-3 border-b border-surface-200 bg-surface-50">
                <button
                  onClick={() => { setSelectedDraft(null); setDraftContent(''); }}
                  className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-2"
                >
                  <ArrowLeftIcon />
                  Back to drafts
                </button>
                <h3 className="font-medium text-brand-900">{selectedDraft.name}</h3>
                <p className="text-xs text-brand-400 mt-0.5">
                  Created {formatDate(selectedDraft.createdAt)} • Will export to {selectedDraft.targetPath}
                </p>
              </div>

              {/* Draft content */}
              <div className="flex-1 overflow-auto p-6">
                {draftPreviewUrl ? (
                  <div className="h-full min-h-[400px] border border-surface-200 rounded-xl overflow-hidden bg-surface-100">
                    <iframe
                      title={`${selectedDraft.name} PDF preview`}
                      src={draftPreviewUrl}
                      className="w-full h-full"
                    />
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none
                                  prose-headings:my-3 prose-headings:text-brand-900
                                  prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                                  prose-table:border-collapse prose-th:border prose-th:border-surface-200
                                  prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2
                                  prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2
                                  prose-a:text-accent-600">
                    <Markdown remarkPlugins={[remarkGfm]}>{draftContent}</Markdown>
                  </div>
                )}
              </div>

              {/* Draft actions */}
              <div className="px-4 py-3 border-t border-surface-200 bg-surface-50 flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-brand-600">
                  Style
                  <select
                    value={exportStyleProfile}
                    onChange={(e) => handleExportStyleChange(e.target.value as ExportStyleProfile)}
                    className="px-2 py-1.5 text-xs rounded border border-surface-300 bg-white text-brand-700"
                  >
                    {EXPORT_STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {/* Export dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setDraftExportMenuOpen(!draftExportMenuOpen)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                               bg-white border border-surface-200 hover:bg-surface-100
                               rounded-lg text-brand-700 transition-colors"
                  >
                    <ArrowDownTrayIcon />
                    Export
                    <ChevronDownIcon />
                  </button>
                  {draftExportMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setDraftExportMenuOpen(false)}
                      />
                      <div className="absolute left-0 bottom-full mb-1 w-40 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-20">
                        <button
                          onClick={() => handleExportDraft('docx')}
                          className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                        >
                          <span className="w-4 h-4 text-blue-600">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5zM7 12h2v5H7v-5zm3 0h2v5h-2v-5zm3 0h2v5h-2v-5z"/>
                            </svg>
                          </span>
                          Word (.docx)
                        </button>
                        <button
                          onClick={() => handleExportDraft('pdf')}
                          className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                        >
                          <span className="w-4 h-4 text-red-600">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5zM8.5 11a.5.5 0 00-.5.5v6a.5.5 0 001 0v-2h1a2 2 0 000-4h-1.5zm.5 3v-2h1a1 1 0 110 2H9z"/>
                            </svg>
                          </span>
                          PDF
                        </button>
                        <button
                          onClick={() => handleExportDraft('txt')}
                          className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                        >
                          <span className="w-4 h-4 text-brand-600">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 6h16M4 12h16M4 18h10"/>
                            </svg>
                          </span>
                          Text (.txt)
                        </button>
                        <hr className="my-1 border-surface-200" />
                        <button
                          onClick={() => handleExportDraft('md')}
                          className="w-full px-3 py-2 text-left text-sm text-brand-500 hover:bg-surface-100 flex items-center gap-2"
                        >
                          <span className="w-4 h-4">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 6h16M4 12h16M4 18h10"/>
                            </svg>
                          </span>
                          Markdown
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {selectedDraft.workingDocxPath && (
                  <button
                    onClick={handleEditDraftInWord}
                    disabled={isOpeningDraftWord}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                               bg-accent-600 text-white hover:bg-accent-700
                               rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isOpeningDraftWord ? 'Opening Word...' : 'Edit in Word'}
                  </button>
                )}

                {isRefreshingDraftPreview && (
                  <span className="text-xs text-brand-500">Refreshing preview...</span>
                )}
                {isWatchingDraftWordEdits && !isRefreshingDraftPreview && (
                  <span className="text-xs text-emerald-600">Watching for Word saves...</span>
                )}

                <div className="flex-1" />

                {/* Generate Package button - only for demand letter drafts */}
                {selectedDraft.type === 'demand' && (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={handleGeneratePackage}
                      disabled={isBundling || !canBundle}
                      title={!canBundle ? (bundleError || 'Cannot bundle - no exhibits') : 'Bundle demand letter with exhibits'}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
                                 bg-brand-700 text-white hover:bg-brand-800
                                 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 8.25l3 3m0 0l3-3m-3 3V7.5M6.75 21h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v12a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      {isBundling ? 'Bundling...' : 'Generate Package'}
                    </button>
                    {bundleError && (
                      <span className="text-xs text-amber-600">{bundleError}</span>
                    )}
                  </div>
                )}

                {/* Approve button */}
                <button
                  onClick={() => handleApproveDraft(selectedDraft)}
                  disabled={isApprovingDraft}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
                             bg-emerald-600 text-white hover:bg-emerald-700
                             rounded-lg transition-colors disabled:opacity-50"
                >
                  <CheckCircleIcon />
                  {isApprovingDraft ? 'Approving...' : 'Approve'}
                </button>
              </div>
            </div>
          ) : (
            // Drafts list view
            <div className="p-6">
              {pendingEvidencePacketPath && (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">Evidence packet ready for review</p>
                      <p className="text-xs text-emerald-700 mt-1 break-all">
                        {pendingEvidencePacketPath}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleReviewEvidencePacket}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
                      >
                        Review Packet
                      </button>
                      <button
                        onClick={() => setPendingEvidencePacketPath(null)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center text-accent-600">
                  <DocumentTextIcon />
                </div>
                <div>
                  <h3 className="font-semibold text-brand-900">Pending Drafts</h3>
                  <p className="text-sm text-brand-500">Review and approve generated documents</p>
                </div>
              </div>

              {drafts.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
                    <DocumentTextIcon />
                  </div>
                  <p className="text-lg font-medium text-brand-700">No pending drafts</p>
                  <p className="text-sm text-brand-400 mt-1">
                    Generated documents will appear here for review
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {drafts.map((draft) => {
                    // Detect packet drafts (JSON files with packet- prefix)
                    const isPacketDraft = draft.id.startsWith('packet-') || draft.type === 'packet'
                    if (isPacketDraft && onOpenPacketDraft) {
                      const isGenerated = !!draft.generatedAt
                      return (
                        <div
                          key={draft.id}
                          className={`p-4 rounded-xl border transition-all ${
                            isGenerated
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-white border-accent-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {isGenerated ? (
                              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                            ) : (
                              <span className="text-2xl">📦</span>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium ${isGenerated ? 'text-emerald-900' : 'text-brand-900'}`}>
                                {draft.name || 'Evidence Packet Draft'}
                              </p>
                              <p className={`text-xs mt-0.5 ${isGenerated ? 'text-emerald-600' : 'text-brand-400'}`}>
                                {isGenerated
                                  ? `Generated ${formatDate(draft.generatedAt!)}`
                                  : `Created ${formatDate(draft.createdAt)}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isGenerated ? (
                                <>
                                  <button
                                    onClick={() => handleDeletePacketDraft(draft.id, draft.name || 'Evidence Packet Draft')}
                                    className="p-1.5 rounded-lg text-emerald-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title="Delete draft"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => onOpenPacketDraft(draft.id)}
                                    className="px-2.5 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-lg
                                               hover:bg-emerald-200 transition-colors"
                                  >
                                    Edit
                                  </button>
                                  {draft.outputPath && onOpenFilePath && (
                                    <button
                                      onClick={() => { onOpenFilePath(draft.outputPath!); setActiveTab('view') }}
                                      className="px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded-lg
                                                 hover:bg-emerald-700 transition-colors"
                                    >
                                      View
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleDuplicatePacketDraft(draft.id)}
                                    className="p-1.5 rounded-lg text-brand-400 hover:text-accent-600 hover:bg-accent-50 transition-colors"
                                    title="Duplicate draft"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => handleDeletePacketDraft(draft.id, draft.name || 'Evidence Packet Draft')}
                                    className="p-1.5 rounded-lg text-brand-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title="Delete draft"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => onOpenPacketDraft(draft.id)}
                                    className="px-2.5 py-1 text-xs font-medium bg-accent-100 text-accent-700 rounded-lg
                                               hover:bg-accent-200 transition-colors"
                                  >
                                    Resume
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={draft.id}
                        onClick={() => { void handleViewDraft(draft) }}
                        className="w-full text-left p-4 bg-white rounded-xl border border-surface-200
                                   hover:border-accent-300 hover:bg-accent-50 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{getDraftTypeIcon(draft.type)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-brand-900">{draft.name}</p>
                            <p className="text-xs text-brand-400 mt-0.5">
                              Created {formatDate(draft.createdAt)}
                            </p>
                            <p className="text-xs text-brand-500 mt-1 truncate">
                              → {draft.targetPath}
                            </p>
                          </div>
                          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg bg-white border border-surface-200 text-brand-600">
                            View
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeTab === 'view' ? (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Determine what to show based on viewMode */}
          {(viewMode === 'document' && activeFileUrl) || (viewMode === 'summary' && !content && activeFileUrl && !hasIndexedSummaryEditor) ? (
            <>
              {/* File viewing header */}
              <div className="px-4 py-3 border-b border-surface-200 flex items-center justify-between bg-surface-50">
                <span className="text-sm font-medium text-brand-700 truncate flex-1" title={fileName}>
                  {fileName}
                </span>
                <div className="flex gap-2">
                  {/* Toggle button - show when both views available */}
                  {hasSummary && onToggleViewMode && (
                    <button
                      onClick={onToggleViewMode}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                 bg-white border border-surface-200 hover:bg-surface-100
                                 rounded-lg text-brand-700 transition-colors"
                      title="View AI summary"
                    >
                      <SummaryViewIcon />
                      Summary
                    </button>
                  )}
                  {isViewingSelectedDraft && selectedDraft && (
                    <>
                      <label className="inline-flex items-center gap-1.5 text-xs text-brand-600">
                        Style
                        <select
                          value={exportStyleProfile}
                          onChange={(e) => handleExportStyleChange(e.target.value as ExportStyleProfile)}
                          className="px-2 py-1 text-xs rounded border border-surface-300 bg-white text-brand-700"
                        >
                          {EXPORT_STYLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="relative">
                        <button
                          onClick={() => setDraftExportMenuOpen(!draftExportMenuOpen)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                     bg-white border border-surface-200 hover:bg-surface-100
                                     rounded-lg text-brand-700 transition-colors"
                        >
                          <ArrowDownTrayIcon />
                          Export
                          <ChevronDownIcon />
                        </button>
                        {draftExportMenuOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setDraftExportMenuOpen(false)}
                            />
                            <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-20">
                              <button
                                onClick={() => handleExportDraft('docx')}
                                className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100"
                              >
                                Word (.docx)
                              </button>
                              <button
                                onClick={() => handleExportDraft('pdf')}
                                className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100"
                              >
                                PDF
                              </button>
                              <button
                                onClick={() => handleExportDraft('txt')}
                                className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100"
                              >
                                Text (.txt)
                              </button>
                              <hr className="my-1 border-surface-200" />
                              <button
                                onClick={() => handleExportDraft('md')}
                                className="w-full px-3 py-2 text-left text-sm text-brand-500 hover:bg-surface-100"
                              >
                                Markdown
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      {selectedDraft.workingDocxPath && (
                        <button
                          onClick={handleEditDraftInWord}
                          disabled={isOpeningDraftWord}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                     bg-accent-600 text-white hover:bg-accent-700
                                     rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isOpeningDraftWord ? 'Opening Word...' : 'Edit in Word'}
                        </button>
                      )}
                      {selectedDraft.type === 'demand' && (
                        <button
                          onClick={handleGeneratePackage}
                          disabled={isBundling || !canBundle}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                     bg-brand-700 text-white hover:bg-brand-800
                                     rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={!canBundle ? (bundleError || 'Cannot bundle - no exhibits') : 'Bundle demand letter with exhibits'}
                        >
                          {isBundling ? 'Bundling...' : 'Generate Package'}
                        </button>
                      )}
                      <button
                        onClick={() => handleApproveDraft(selectedDraft)}
                        disabled={isApprovingDraft}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                   bg-emerald-600 text-white hover:bg-emerald-700
                                   rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isApprovingDraft ? 'Approving...' : 'Approve'}
                      </button>
                    </>
                  )}
                  {isViewingSelectedDraft && isRefreshingDraftPreview && (
                    <span className="text-xs text-brand-500 self-center">Refreshing preview...</span>
                  )}
                  {isViewingSelectedDraft && isWatchingDraftWordEdits && !isRefreshingDraftPreview && (
                    <span className="text-xs text-emerald-600 self-center">Watching for Word saves...</span>
                  )}
                  {isPdf ? (
                    <button
                      onClick={() => window.open(activeFileUrl, '_blank', 'width=1200,height=900')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                 bg-white border border-surface-200 hover:bg-surface-100
                                 rounded-lg text-brand-700 transition-colors"
                      title="Open in new window"
                    >
                      <ArrowsPointingOutIcon className="w-4 h-4" />
                      Popout
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                 bg-white border border-surface-200 hover:bg-surface-100
                                 rounded-lg text-brand-700 transition-colors"
                    >
                      <ArrowTopRightOnSquareIcon />
                      Open
                    </button>
                  )}
                  <button
                    onClick={onCloseFile}
                    className="p-1.5 text-brand-400 hover:text-brand-600 hover:bg-surface-100
                               rounded-lg transition-colors"
                  >
                    <XMarkIcon />
                  </button>
                </div>
              </div>

              {/* File content */}
              <div className="flex-1 relative bg-surface-100 flex flex-col">
                {isPdf ? (
                  <>
                    {/* PDF toolbar */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface-50 border-b border-surface-200 flex-wrap">
                      <button
                        onClick={() => goToPdfPage(pdfPageNumber - 1)}
                        disabled={pdfPageNumber <= 1}
                        className="p-1.5 rounded hover:bg-surface-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Previous page"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                      </button>
                      <div className="flex items-center gap-1 text-xs text-brand-600 min-w-[110px] justify-center">
                        <label htmlFor="pdf-page-input" className="sr-only">
                          Page number
                        </label>
                        <input
                          id="pdf-page-input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={pdfPageInput}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            if (nextValue === '' || /^\d+$/.test(nextValue)) {
                              setPdfPageInput(nextValue)
                            }
                          }}
                          onBlur={commitPdfPageInput}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitPdfPageInput()
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setPdfPageInput(String(pdfPageNumber))
                              event.currentTarget.blur()
                            }
                          }}
                          disabled={!pdfNumPages}
                          className="w-14 px-1 py-0.5 text-center rounded border border-surface-300 bg-white text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Page number"
                          title="Go to page"
                        />
                        <span>/ {pdfNumPages || '...'}</span>
                      </div>
                      <button
                        onClick={() => goToPdfPage(pdfPageNumber + 1)}
                        disabled={!pdfNumPages || pdfPageNumber >= pdfNumPages}
                        className="p-1.5 rounded hover:bg-surface-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Next page"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                      <div className="w-px h-4 bg-surface-300 mx-1" />
                      <button
                        onClick={() => setPdfScale(s => Math.max(0.5, s - 0.1))}
                        className="p-1.5 rounded hover:bg-surface-200"
                        title="Zoom out"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                        </svg>
                      </button>
                      <span className="text-xs text-brand-600 min-w-[45px] text-center">
                        {Math.round(pdfScale * 100)}%
                      </span>
                      <button
                        onClick={() => setPdfScale(s => Math.min(2.0, s + 0.1))}
                        className="p-1.5 rounded hover:bg-surface-200"
                        title="Zoom in"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPdfScale(1.0)}
                        className="px-2 py-1 text-xs rounded hover:bg-surface-200 text-brand-600"
                        title="Reset zoom"
                      >
                        Fit
                      </button>

                      <div className="w-px h-4 bg-surface-300 mx-1" />

                      {!isPacketPiiReviewMode && (
                        <button
                          onClick={handleScanPii}
                          disabled={!filePath || isScanningPii}
                          className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Detect likely DOB/SSN patterns"
                        >
                          {isScanningPii ? 'Scanning...' : 'Scan PII'}
                        </button>
                      )}
                      <button
                        onClick={() => setShowPiiPanel((prev) => !prev)}
                        disabled={effectivePiiFindings.length === 0 && effectivePiiWarnings.length === 0}
                        className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Show possible PII findings"
                      >
                        Findings {effectivePiiFindings.length > 0 ? `(${effectivePiiFindings.length})` : ''}
                      </button>
                      <button
                        onClick={() => {
                          if (!isDrawMode && isPacketPiiReviewMode && packetRequiresManualDraw) {
                            showImagePdfAutoDetectWarning(true)
                          }
                          setIsDrawMode((prev) => !prev)
                        }}
                        className={`px-2.5 py-1 text-xs rounded border ${
                          isDrawMode
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-surface-300 bg-white hover:bg-surface-100 text-brand-700'
                        }`}
                        title="Draw manual redaction rectangles on the page"
                      >
                        {isDrawMode ? 'Drawing On' : 'Draw Redaction'}
                      </button>
                      {!isPacketPiiReviewMode && (
                        <button
                          onClick={handleUseDetectedBoxes}
                          disabled={detectedBoxes.length === 0}
                          className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Copy detected boxes to manual redactions"
                        >
                          Use Detected
                        </button>
                      )}
                      <button
                        onClick={handleUndoManualBox}
                        disabled={effectiveManualBoxCount === 0}
                        className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Undo
                      </button>
                      <button
                        onClick={handleUndoLastDraw}
                        disabled={!hasLastDrawnBox}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          hasLastDrawnBox
                            ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800'
                            : 'border-surface-300 bg-white text-brand-700'
                        }`}
                      >
                        Undo Last Draw
                      </button>
                      <button
                        onClick={handleClearCurrentPageBoxes}
                        disabled={effectiveCurrentPageManualCount === 0}
                        className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Clear Page
                      </button>
                      <button
                        onClick={handleClearAllBoxes}
                        disabled={effectiveManualBoxCount === 0}
                        className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Clear All
                      </button>
                      {!isPacketPiiReviewMode && (
                        <button
                          onClick={handleSaveRedactedCopy}
                          disabled={!filePath || manualBoxes.length === 0 || isSavingRedactions}
                          className="px-2.5 py-1 text-xs rounded border border-surface-300 bg-brand-900 text-white hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Save a new redacted PDF copy"
                        >
                          {isSavingRedactions ? 'Saving...' : 'Save Redacted Copy'}
                        </button>
                      )}
                    </div>

                    {(redactionMessage || redactionError || redactedOutputPath) && (
                      <div className="px-3 py-2 border-b border-surface-200 bg-white flex items-center justify-between gap-2">
                        <div className={`text-xs ${redactionError ? 'text-red-700' : 'text-brand-700'}`}>
                          {redactionError || redactionMessage}
                        </div>
                        <div className="flex items-center gap-2">
                          {redactedOutputPath && (
                            <button
                              onClick={handleOpenRedactedCopy}
                              className="px-2 py-1 text-xs rounded border border-surface-300 bg-white hover:bg-surface-100 text-brand-700"
                            >
                              Open Redacted Copy
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {showPiiPanel && (
                      <div className="px-3 py-2 border-b border-surface-200 bg-amber-50/60">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-amber-800">
                            Possible PII Findings
                          </p>
                          <p className="text-xs text-amber-700">
                            Pages: {Array.from(new Set(effectivePiiFindings.map((item) => item.page))).sort((a, b) => a - b).join(', ') || 'none'}
                          </p>
                        </div>
                        {effectivePiiFindings.length === 0 ? (
                          <p className="text-xs text-amber-800">No likely DOB/SSN patterns found.</p>
                        ) : (
                          <div className="max-h-28 overflow-auto space-y-1">
                            {effectivePiiFindings.map((item, index) => (
                              <button
                                key={`${item.page}-${item.kind}-${index}`}
                                onClick={() => goToPdfPage(item.page)}
                                className="w-full text-left px-2 py-1 text-xs rounded bg-white border border-amber-200 hover:bg-amber-100 transition-colors"
                              >
                                Pg {item.page} • {item.kind.toUpperCase()} • {item.preview || 'masked'}
                              </button>
                            ))}
                          </div>
                        )}
                        {effectivePiiWarnings.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {effectivePiiWarnings.map((warning, index) => (
                              <p key={index} className="text-xs text-amber-900">{warning}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* PDF document - nested containers for proper scrollbar positioning */}
                    <div ref={pdfContainerRef} className="flex-1 overflow-hidden relative bg-surface-200">
                      <div className="absolute inset-0 overflow-auto p-4">
                        <div className="min-w-fit min-h-fit mx-auto" style={{ width: 'fit-content' }}>
                          <Document
                            file={activeFileUrl}
                            onLoadSuccess={({ numPages }) => {
                              setPdfNumPages(numPages)
                              setPdfPageNumber((currentPage) => Math.min(numPages, Math.max(1, currentPage)))
                            }}
                            loading={
                              <div className="flex items-center justify-center h-64">
                                <div className="text-brand-500">Loading PDF...</div>
                              </div>
                            }
                            error={
                              <div className="flex flex-col items-center justify-center h-64 gap-3">
                                <div className="text-red-500">Failed to load PDF</div>
                                <button
                                  onClick={() => window.open(activeFileUrl, '_blank')}
                                  className="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800 text-sm"
                                >
                                  Open in new tab
                                </button>
                              </div>
                            }
                          >
                            <div
                              ref={pageLayerRef}
                              className="relative inline-block"
                              onClickCapture={handlePacketAutoBoxClick}
                            >
                              <Page
                                pageNumber={pdfPageNumber}
                                width={pdfContainerWidth ? Math.min(pdfContainerWidth - 32, 800) * pdfScale : undefined}
                                className="shadow-lg"
                                renderTextLayer={true}
                                renderAnnotationLayer={true}
                                onGetTextSuccess={handlePdfTextLayerSuccess}
                                onGetTextError={handlePdfTextLayerError}
                              />
                              <div
                                className={`absolute inset-0 z-20 touch-none select-none ${isDrawMode ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
                                onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                                  if (!isDrawMode) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  activeDrawPointerIdRef.current = event.pointerId
                                  try {
                                    event.currentTarget.setPointerCapture(event.pointerId)
                                  } catch {
                                    // Ignore if pointer capture is unsupported.
                                  }
                                  const point = getOverlayPoint(event)
                                  setDraftRedactionBox({
                                    startX: point.x,
                                    startY: point.y,
                                    currentX: point.x,
                                    currentY: point.y,
                                  })
                                  setRedactionMessage(null)
                                  setRedactionError(null)
                                }}
                                onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
                                  if (!isDrawMode || !draftRedactionBox) return
                                  if (activeDrawPointerIdRef.current !== null && event.pointerId !== activeDrawPointerIdRef.current) return
                                  event.preventDefault()
                                  const point = getOverlayPoint(event)
                                  setDraftRedactionBox((prev) => {
                                    if (!prev) return prev
                                    return {
                                      ...prev,
                                      currentX: point.x,
                                      currentY: point.y,
                                    }
                                  })
                                }}
                                onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
                                  if (!isDrawMode) return
                                  if (activeDrawPointerIdRef.current !== null && event.pointerId !== activeDrawPointerIdRef.current) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  try {
                                    event.currentTarget.releasePointerCapture(event.pointerId)
                                  } catch {
                                    // Ignore if pointer capture is unsupported.
                                  }
                                  activeDrawPointerIdRef.current = null
                                  finalizeDraftRedactionBox()
                                }}
                                onPointerCancel={(event: ReactPointerEvent<HTMLDivElement>) => {
                                  if (!isDrawMode) return
                                  if (activeDrawPointerIdRef.current !== null && event.pointerId !== activeDrawPointerIdRef.current) return
                                  event.preventDefault()
                                  try {
                                    event.currentTarget.releasePointerCapture(event.pointerId)
                                  } catch {
                                    // Ignore if pointer capture is unsupported.
                                  }
                                  activeDrawPointerIdRef.current = null
                                  finalizeDraftRedactionBox()
                                }}
                                onPointerLeave={() => {
                                  if (!isDrawMode || activeDrawPointerIdRef.current !== null) return
                                  finalizeDraftRedactionBox()
                                }}
                              >
                                {currentPageDetectedBoxes.map((box) => (
                                  <div
                                    key={box.id}
                                    data-redaction-box-id={box.id}
                                    className="absolute border border-amber-500 bg-amber-300/30 pointer-events-none"
                                    style={{
                                      left: `${box.xPct * 100}%`,
                                      top: `${box.yPct * 100}%`,
                                      width: `${box.widthPct * 100}%`,
                                      height: `${box.heightPct * 100}%`,
                                    }}
                                  />
                                ))}
                                {currentPageManualBoxes.map((box) => (
                                  <div
                                    key={box.id}
                                    data-redaction-box-id={box.id}
                                    className="absolute border border-amber-500 bg-amber-300/30 pointer-events-none"
                                    style={{
                                      left: `${box.xPct * 100}%`,
                                      top: `${box.yPct * 100}%`,
                                      width: `${box.widthPct * 100}%`,
                                      height: `${box.heightPct * 100}%`,
                                    }}
                                  />
                                ))}
                                {draftBoxStyle && (
                                  <div
                                    className="absolute z-30 border-2 border-emerald-700 bg-emerald-300/35 pointer-events-none"
                                    style={draftBoxStyle}
                                  />
                                )}
                              </div>
                            </div>
                          </Document>
                        </div>
                      </div>
                    </div>
                  </>
                ) : isImage ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <img
                      src={activeFileUrl}
                      alt={fileName}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-card"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={() => window.open(activeFileUrl, '_blank')}
                      className="px-6 py-3 bg-brand-900 text-white rounded-xl hover:bg-brand-800
                                 font-medium transition-colors flex items-center gap-2"
                    >
                      <ArrowTopRightOnSquareIcon />
                      Open File
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : hasIndexedSummaryEditor || (viewMode === 'summary' && content) || (viewMode === 'document' && !activeFileUrl && content) ? (
            <>
              {/* Summary header */}
              <div className="px-4 py-3 border-b border-surface-200 flex items-center justify-between bg-surface-50">
                <span className="text-sm font-medium text-brand-700">
                  {hasIndexedSummaryEditor ? 'Document Summary' : 'AI Summary'}
                </span>
                <div className="flex gap-2">
                  {/* Toggle button - show when file is available */}
                  {hasFile && onToggleViewMode && (
                    <button
                      onClick={onToggleViewMode}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                 bg-white border border-surface-200 hover:bg-surface-100
                                 rounded-lg text-brand-700 transition-colors"
                      title="View document"
                    >
                      <DocumentViewIcon />
                      Document
                    </button>
                  )}
                  {hasIndexedSummaryEditor && (
                    <>
                      <button
                        onClick={handleResetEditableSummary}
                        disabled={!hasAnyDocumentEdits || isSavingDocumentSummary}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                   bg-white border border-surface-200 hover:bg-surface-100
                                   rounded-lg text-brand-700 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reset
                      </button>
                      <button
                        onClick={handleApproveEditableSummary}
                        disabled={!canSubmitDocumentReview}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                   bg-brand-900 border border-brand-900 text-white hover:bg-brand-800
                                   rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {documentReviewActionLabel}
                      </button>
                    </>
                  )}
                  {!hasIndexedSummaryEditor && isExportable && (
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-brand-600">
                        Style
                        <select
                          value={exportStyleProfile}
                          onChange={(e) => handleExportStyleChange(e.target.value as ExportStyleProfile)}
                          className="px-2 py-1 text-xs rounded border border-surface-300 bg-white text-brand-700"
                        >
                          {EXPORT_STYLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                   bg-white border border-surface-200 hover:bg-surface-100
                                   rounded-lg text-brand-700 transition-colors"
                      >
                        <ArrowDownTrayIcon />
                        Export
                        <ChevronDownIcon />
                      </button>
                      {exportMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setExportMenuOpen(false)}
                          />
                          <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-20">
                            <button
                              onClick={() => handleExport('docx')}
                              className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                            >
                              <span className="w-4 h-4 text-blue-600">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5zM7 12h2v5H7v-5zm3 0h2v5h-2v-5zm3 0h2v5h-2v-5z"/>
                                </svg>
                              </span>
                              Word (.docx)
                            </button>
                            <button
                              onClick={() => handleExport('pdf')}
                              className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                            >
                              <span className="w-4 h-4 text-red-600">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5zM8.5 11a.5.5 0 00-.5.5v6a.5.5 0 001 0v-2h1a2 2 0 000-4h-1.5zm.5 3v-2h1a1 1 0 110 2H9z"/>
                                </svg>
                              </span>
                              PDF
                            </button>
                            <button
                              onClick={() => handleExport('txt')}
                              className="w-full px-3 py-2 text-left text-sm text-brand-700 hover:bg-surface-100 flex items-center gap-2"
                            >
                              <span className="w-4 h-4 text-brand-600">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 6h16M4 12h16M4 18h10"/>
                                </svg>
                              </span>
                              Text (.txt)
                            </button>
                            <hr className="my-1 border-surface-200" />
                            <button
                              onClick={() => handleExport('md')}
                              className="w-full px-3 py-2 text-left text-sm text-brand-500 hover:bg-surface-100 flex items-center gap-2"
                            >
                              <span className="w-4 h-4">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 6h16M4 12h16M4 18h10"/>
                                </svg>
                              </span>
                              Markdown
                            </button>
                          </div>
                        </>
                      )}
                      </div>
                    </div>
                  )}
                  {!hasIndexedSummaryEditor && (
                    <button
                      onClick={() => navigator.clipboard.writeText(content)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                 bg-white border border-surface-200 hover:bg-surface-100
                                 rounded-lg text-brand-700 transition-colors"
                    >
                      <ClipboardIcon />
                      Copy
                    </button>
                  )}
                  {hasFile && (
                    <button
                      onClick={onCloseFile}
                      className="p-1.5 text-brand-400 hover:text-brand-600 hover:bg-surface-100
                                 rounded-lg transition-colors"
                    >
                      <XMarkIcon />
                    </button>
                  )}
                </div>
              </div>

              {/* Rendered content */}
              <div className="p-6 flex-1 overflow-auto">
                {hasIndexedSummaryEditor && indexedSummaryTarget ? (
                  <div className="max-w-3xl space-y-4">
                    <p className="text-xs text-brand-500">
                      Editing metadata for <span className="font-medium text-brand-700">{indexedSummaryTarget.fileName}</span>
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-xs font-medium text-brand-600 mb-1">Title</span>
                        <input
                          type="text"
                          value={editableSummary.title}
                          onChange={(e) => handleEditableSummaryFieldChange('title', e.target.value)}
                          disabled={isSavingDocumentSummary}
                          className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                     bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                     disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </label>

                      <label className="block">
                        <span className="block text-xs font-medium text-brand-600 mb-1">Type</span>
                        <input
                          type="text"
                          value={editableSummary.type}
                          onChange={(e) => handleEditableSummaryFieldChange('type', e.target.value)}
                          disabled={isSavingDocumentSummary}
                          className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                     bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                     disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </label>

                      <label className="block">
                        <span className="block text-xs font-medium text-brand-600 mb-1">Document Date</span>
                        <input
                          type="text"
                          value={editableSummary.date}
                          onChange={(e) => handleEditableSummaryFieldChange('date', e.target.value)}
                          placeholder="MM-DD-YYYY"
                          disabled={isSavingDocumentSummary}
                          className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                     bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                     disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="block text-xs font-medium text-brand-600 mb-1">Key Information</span>
                      <textarea
                        value={editableSummary.key_info}
                        onChange={(e) => handleEditableSummaryFieldChange('key_info', e.target.value)}
                        rows={8}
                        disabled={isSavingDocumentSummary}
                        className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                   bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                   disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-xs font-medium text-brand-600 mb-1">Issues</span>
                      <textarea
                        value={editableSummary.issues}
                        onChange={(e) => handleEditableSummaryFieldChange('issues', e.target.value)}
                        rows={3}
                        disabled={isSavingDocumentSummary}
                        className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                   bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                   disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </label>

                    {extractedFieldSections.length > 0 && (
                      <div className="rounded-xl border border-surface-200 bg-surface-50/60 p-4">
                        <p className="text-xs font-semibold text-brand-700 mb-1">Extracted Fields</p>
                        <p className="text-[11px] text-brand-500 mb-3">
                          Friendly labels for extracted values. Edits still map back to the original indexed data.
                        </p>
                        <div className="space-y-3 max-h-96 overflow-auto pr-1">
                          {extractedFieldSections.map((section) => (
                            <div key={section.section} className="rounded-lg border border-surface-200 bg-white p-3">
                              <p className="text-xs font-semibold text-brand-700 mb-2">{section.section}</p>
                              <div className="space-y-2">
                                {section.fields.map((field) => (
                                  <label key={field.rawPath} className="block">
                                    <span className="block text-xs text-brand-600 mb-1" title={field.rawPath}>
                                      {field.label}
                                    </span>
                                    <input
                                      type="text"
                                      value={field.value}
                                      onChange={(e) => handleEditableExtractedFieldChange(field.path, e.target.value)}
                                      disabled={isSavingDocumentSummary}
                                      className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                                                 bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                                                 disabled:opacity-60 disabled:cursor-not-allowed"
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {documentSummarySaveError && (
                      <p className="text-sm text-red-700">{documentSummarySaveError}</p>
                    )}
                    {documentSummarySaveMessage && (
                      <p className="text-sm text-emerald-700">{documentSummarySaveMessage}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {isHtml ? (
                      <div
                        className="prose prose-sm max-w-none prose-headings:text-brand-900"
                        dangerouslySetInnerHTML={{ __html: content }}
                      />
                    ) : isMarkdown ? (
                      <div className="prose prose-sm max-w-none
                                      prose-headings:my-3 prose-headings:text-brand-900
                                      prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                                      prose-table:border-collapse prose-th:border prose-th:border-surface-200
                                      prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2
                                      prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2
                                      prose-a:text-accent-600">
                        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                      </div>
                    ) : (
                      <pre className="text-sm text-brand-700 whitespace-pre-wrap font-mono
                                      bg-surface-50 rounded-xl p-4">
                        {content}
                      </pre>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mb-4">
                <DocumentIcon />
              </div>
              <p className="text-lg font-medium text-brand-700">No document selected</p>
              <p className="text-sm text-brand-400 mt-1 max-w-xs">
                Select a file from the sidebar to view details, or click the eye icon to preview
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
              <ClipboardCheckIcon />
            </div>
            <div>
              <h3 className="font-semibold text-brand-900">Review AI Decisions</h3>
              <p className="text-sm text-brand-500">Verify or correct extraction decisions</p>
            </div>
          </div>

          {!documentIndex ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
                <ClipboardCheckIcon />
              </div>
              <p className="text-lg font-medium text-brand-700">No case loaded</p>
              <p className="text-sm text-brand-400 mt-1">
                Index a case to review extraction decisions
              </p>
            </div>
          ) : totalReviewItems === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircleIcon />
              </div>
              <p className="text-lg font-medium text-brand-700">No decisions to review</p>
              <p className="text-sm text-brand-400 mt-1">
                All data was extracted with high confidence
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Critical items (needs_review) shown first */}
              {needsReview.map((item, i) => {
                // Handle both expected format and alternate formats Sonnet might produce
                const field = item.field || item.item || 'Unknown Field'
                const conflictingValues = item.conflicting_values || []
                const reason = item.reason || item.description || ''
                const sources = Array.isArray(item.sources) ? item.sources : []

                return (
                  <div
                    key={`critical-${i}`}
                    className="rounded-xl border-2 border-red-300 bg-red-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-red-900">
                          {String(field).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </p>
                        <span className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 bg-red-200 text-red-800 font-medium">
                          Critical - Needs Resolution
                        </span>
                      </div>
                    </div>

                    {conflictingValues.length > 0 && (
                      <p className="text-sm text-red-800 mb-2">
                        <span className="font-medium">Conflicting Values:</span> {conflictingValues.join(' vs ')}
                      </p>
                    )}

                    {reason && (
                      <p className="text-xs text-red-700 mb-3 leading-relaxed">
                        <span className="font-medium">Reason:</span> {reason}
                      </p>
                    )}

                    {sources.length > 0 && (
                      <p className="text-xs text-red-600">
                        <span className="font-medium">Sources:</span> {sources.join(', ')}
                      </p>
                    )}
                  </div>
                )
              })}

              {/* Regular errata items */}
              {errata.map((rawItem, i) => {
                // Handle both object format and string format
                const item = typeof rawItem === 'string'
                  ? { field: `Note ${i + 1}`, decision: rawItem, evidence: '', confidence: 'medium' }
                  : rawItem

                const field = item.field || `Item ${i + 1}`
                const decision = item.decision || item.description || String(item)
                const evidence = item.evidence || ''
                const confidence = item.confidence || 'medium'

                const isVerified = verifiedItems.has(field)
                const isEditing = editingItem === field

                return (
                  <div
                    key={i}
                    className={`rounded-xl border p-4 transition-all ${
                      isVerified
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-white border-surface-200 hover:border-surface-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-brand-900">
                          {String(field).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 ${
                          confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                          confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {confidence} confidence
                        </span>
                      </div>
                      {isVerified && (
                        <span className="text-emerald-600">
                          <CheckCircleIcon />
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-brand-700 mb-2">
                      <span className="font-medium">Decision:</span> {decision}
                    </p>

                    {evidence && (
                      <p className="text-xs text-brand-500 mb-3 leading-relaxed">
                        <span className="font-medium">Evidence:</span> {evidence}
                      </p>
                    )}

                    {isEditing ? (
                      <div className="flex gap-2 mt-3">
                        <input
                          type="text"
                          value={correctionValue}
                          onChange={(e) => setCorrectionValue(e.target.value)}
                          placeholder="Enter correct value..."
                          className="flex-1 px-3 py-2 text-sm border border-surface-300 rounded-lg
                                     focus:outline-none focus:ring-2 focus:ring-accent-500"
                        />
                        <button
                          onClick={() => handleCorrect(field, correctionValue)}
                          className="px-3 py-2 bg-accent-600 text-white text-sm font-medium
                                     rounded-lg hover:bg-accent-700 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingItem(null); setCorrectionValue('') }}
                          className="px-3 py-2 bg-surface-100 text-brand-600 text-sm font-medium
                                     rounded-lg hover:bg-surface-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : !isVerified && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleVerify(field)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white
                                     text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                          <CheckCircleIcon />
                          Correct
                        </button>
                        <button
                          onClick={() => { setEditingItem(field); setCorrectionValue('') }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-100 text-brand-600
                                     text-sm font-medium rounded-lg hover:bg-surface-200 transition-colors"
                        >
                          <PencilIcon />
                          Fix
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
