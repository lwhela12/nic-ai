import { useEffect, useMemo, useState } from 'react'
import type { AgentDocumentView, DocumentFile, DocumentFolder, DocumentIndex, GeneratedDoc, NeedsReviewItem } from '../App'

interface IndexStatus {
  needsIndex: boolean
  newFiles: string[]
  modifiedFiles: string[]
}

interface Props {
  documentIndex: DocumentIndex | null
  generatedDocs: GeneratedDoc[]
  caseFolder: string
  apiUrl: string
  onDocSelect: (content: string, docPath?: string, filePath?: string) => void
  onFileView: (url: string, filename: string, filePath: string) => void
  indexStatus?: IndexStatus | null
  agentView?: AgentDocumentView | null
  onClearAgentView?: () => void
  savedAgentViews?: AgentDocumentView[]
  activeAgentViewId?: string | null
  onApplyAgentView?: (view: AgentDocumentView) => void
  onClearSavedAgentViews?: () => void
}

type SortOption = 'folder' | 'date' | 'type'
type SortDirection = 'asc' | 'desc'
type FilterOption =
  | 'all'
  | 'medical'
  | 'intake'
  | 'insurance'
  | 'liability'
  | 'claims'
  | 'benefits'
  | 'hearings'
  | 'employment'
  | 'review'

type FileDataObject = Exclude<DocumentFile, string>

interface FileRow {
  path: string
  folder: string
  fileName: string
  fileData: FileDataObject | null
  lowerFolder: string
  lowerFileName: string
  lowerType: string
  timestamp: number | null
  reviewInfo?: NeedsReviewItem
  needsReview: boolean
  reindexStatus?: 'NEW' | 'MOD'
}

interface FilterDefinition {
  value: FilterOption
  label: string
  matches: (row: FileRow) => boolean
}

const hasAny = (value: string, needles: string[]): boolean =>
  needles.some((needle) => value.includes(needle))

const normalizeRelativePath = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
    .toLowerCase()

const normalizeFileName = (file: DocumentFile): string => {
  if (typeof file === 'string') return file
  if (typeof file.file === 'string' && file.file.trim()) return file.file
  if (typeof file.filename === 'string' && file.filename.trim()) return file.filename
  return 'Unknown'
}

const parseDateString = (value: string): number | null => {
  const direct = Date.parse(value)
  if (!Number.isNaN(direct)) return direct

  const mdy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!mdy) return null

  const month = Number(mdy[1]) - 1
  const day = Number(mdy[2])
  let year = Number(mdy[3])
  if (year < 100) year += year >= 70 ? 1900 : 2000

  const ts = new Date(year, month, day).getTime()
  return Number.isNaN(ts) ? null : ts
}

const parseDateFromFileName = (fileName: string): number | null => {
  const ymd = fileName.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2]) - 1
    const day = Number(ymd[3])
    const ts = new Date(year, month, day).getTime()
    if (!Number.isNaN(ts)) return ts
  }

  const mdy = fileName.match(/(\d{1,2})[-_](\d{1,2})[-_](20\d{2})/)
  if (mdy) {
    const month = Number(mdy[1]) - 1
    const day = Number(mdy[2])
    const year = Number(mdy[3])
    const ts = new Date(year, month, day).getTime()
    if (!Number.isNaN(ts)) return ts
  }

  return null
}

const parseDocumentTimestamp = (fileData: FileDataObject | null, fileName: string): number | null => {
  if (fileData && typeof fileData.date === 'string') {
    const parsed = parseDateString(fileData.date.trim())
    if (parsed !== null) return parsed
  }
  return parseDateFromFileName(fileName)
}

const createFilterDefinitions = (isWC: boolean): FilterDefinition[] => {
  const common: FilterDefinition[] = [
    {
      value: 'all',
      label: 'All Files',
      matches: () => true,
    },
    {
      value: 'review',
      label: 'Needs Review',
      matches: (row) => row.needsReview,
    },
  ]

  if (!isWC) {
    return [
      common[0],
      {
        value: 'medical',
        label: 'Medical',
        matches: (row) =>
          hasAny(row.lowerFolder, ['record', 'bill', 'medical', 'balance', 'mrb', 'mre']) ||
          hasAny(row.lowerType, ['medical_record', 'medical_bill', 'lien', 'balance_request', 'balance_confirmation']),
      },
      {
        value: 'insurance',
        label: 'Insurance (1P/3P)',
        matches: (row) =>
          hasAny(row.lowerFolder, ['1p', '3p', 'insurance', 'policy', 'declaration', 'coverage']) ||
          hasAny(row.lowerType, ['declaration', 'lor', 'correspondence']),
      },
      {
        value: 'liability',
        label: 'Liability',
        matches: (row) =>
          hasAny(row.lowerFolder, ['investigation', 'police', 'demand', 'litigation']) ||
          hasAny(row.lowerType, ['police_report', 'demand', 'correspondence', 'settlement']),
      },
      {
        value: 'intake',
        label: 'Intake',
        matches: (row) =>
          row.lowerFolder.includes('intake') || row.lowerType.includes('intake_form'),
      },
      common[1],
    ]
  }

  return [
    common[0],
    {
      value: 'medical',
      label: 'Medical',
      matches: (row) =>
        hasAny(row.lowerFolder, ['medical', 'treatment', 'provider']) ||
        hasAny(row.lowerType, ['medical_record', 'medical_bill', 'ime_report', 'fce_report', 'work_status_report']),
    },
    {
      value: 'claims',
      label: 'Claims',
      matches: (row) =>
        hasAny(row.lowerFolder, ['claim', 'intake', 'investigation']) ||
        hasAny(row.lowerType, ['c4_claim', 'c3_employer_report', 'c5_carrier_acceptance', 'aoe_coe_investigation']),
    },
    {
      value: 'benefits',
      label: 'Benefits',
      matches: (row) =>
        hasAny(row.lowerFolder, ['benefit', 'wage', 'compensation', 'ttd', 'tpd', 'ppd', 'mmi']) ||
        hasAny(row.lowerType, ['ttd_check', 'wage_records', 'wage_statement', 'ppd_rating', 'mmi_determination', 'work_status_report']),
    },
    {
      value: 'hearings',
      label: 'Hearings',
      matches: (row) =>
        hasAny(row.lowerFolder, ['hearing', 'appeal', 'litigation', 'a.o', 'h.o']) ||
        hasAny(row.lowerType, ['d9_hearing', 'hearing_notice', 'hearing_decision']),
    },
    {
      value: 'employment',
      label: 'Employment',
      matches: (row) =>
        hasAny(row.lowerFolder, ['employment', 'work status', 'return to work', 'job']) ||
        hasAny(row.lowerType, ['job_description', 'wage_records', 'work_status_report', 'vocational_report']),
    },
    common[1],
  ]
}

const normalizeFolders = (documentIndex: DocumentIndex | null): Record<string, DocumentFile[]> => {
  if (!documentIndex?.folders) return {}

  const normalized: Record<string, DocumentFile[]> = {}
  for (const [key, value] of Object.entries(documentIndex.folders)) {
    const folderData = value as DocumentFolder
    if (Array.isArray(folderData)) {
      normalized[key] = folderData
    } else if (
      folderData &&
      typeof folderData === 'object' &&
      'files' in folderData &&
      Array.isArray(folderData.files)
    ) {
      normalized[key] = folderData.files
    } else if (
      folderData &&
      typeof folderData === 'object' &&
      'documents' in folderData &&
      Array.isArray(folderData.documents)
    ) {
      normalized[key] = folderData.documents
    }
  }
  return normalized
}

const sortFilesForView = (rows: FileRow[], sort: SortOption, dateDirection: SortDirection = 'desc'): FileRow[] => {
  const copy = [...rows]
  if (sort === 'date') {
    copy.sort((a, b) => {
      const ta = a.timestamp ?? -Infinity
      const tb = b.timestamp ?? -Infinity
      if (tb !== ta) return dateDirection === 'asc' ? ta - tb : tb - ta
      return a.fileName.localeCompare(b.fileName)
    })
    return copy
  }
  if (sort === 'type') {
    copy.sort((a, b) => {
      const byType = (a.lowerType || '').localeCompare(b.lowerType || '')
      if (byType !== 0) return byType
      return a.fileName.localeCompare(b.fileName)
    })
    return copy
  }
  copy.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return copy
}

const maxTimestamp = (rows: FileRow[]): number =>
  rows.reduce((max, row) => Math.max(max, row.timestamp ?? -Infinity), -Infinity)

const minTimestamp = (rows: FileRow[]): number =>
  rows.reduce((min, row) => Math.min(min, row.timestamp ?? Infinity), Infinity)

// Icons
const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
)

const FolderIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
)

const DocumentIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const DocumentTextIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const WarningIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
)

export default function FileViewer({
  documentIndex,
  generatedDocs,
  caseFolder,
  apiUrl,
  onDocSelect,
  onFileView,
  indexStatus,
  agentView,
  onClearAgentView,
  savedAgentViews = [],
  activeAgentViewId,
  onApplyAgentView,
  onClearSavedAgentViews,
}: Props) {
  const isWC = documentIndex?.practice_area === "Workers' Compensation"
  const [sort, setSort] = useState<SortOption>('folder')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const filterDefinitions = useMemo(() => createFilterDefinitions(isWC), [isWC])
  useEffect(() => {
    if (!filterDefinitions.some((definition) => definition.value === filter)) {
      setFilter('all')
    }
  }, [filterDefinitions, filter])

  useEffect(() => {
    if (!agentView) return
    setFilter('all')
    setSearchQuery('')
    if (agentView.sortBy) {
      setSort(agentView.sortBy)
    }
  }, [agentView?.id, agentView?.sortBy, agentView])

  const folderKeys = useMemo(() => Object.keys(documentIndex?.folders || {}), [documentIndex])
  const expandedFolders = useMemo(() => {
    const expanded = new Set<string>()
    for (const key of folderKeys) {
      if (!collapsedFolders.has(key)) expanded.add(key)
    }
    return expanded
  }, [folderKeys, collapsedFolders])

  const filesNeedingReview = useMemo(() => {
    const reviewMap = new Map<string, NeedsReviewItem>()
    if (!documentIndex?.needs_review) return reviewMap

    for (const item of documentIndex.needs_review) {
      const sources = Array.isArray(item.sources) ? item.sources : []
      for (const source of sources) {
        const filename = source.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
        reviewMap.set(filename, item)
        reviewMap.set(filename.replace(/\.pdf$/, ''), item)
      }
    }
    return reviewMap
  }, [documentIndex])

  const filesNeedingReindex = useMemo(() => {
    const map = new Map<string, 'NEW' | 'MOD'>()
    if (!indexStatus?.needsIndex) return map
    for (const filePath of indexStatus.modifiedFiles || []) {
      const basename = filePath.split('/').pop()?.toLowerCase()
      if (basename) map.set(basename, 'MOD')
    }
    return map
  }, [indexStatus])

  const pendingFiles = useMemo(() => {
    if (!indexStatus?.needsIndex || !indexStatus.newFiles?.length) return []
    return indexStatus.newFiles.map((path) => ({
      path,
      folder: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '.',
      filename: path.split('/').pop() || path,
    }))
  }, [indexStatus])

  const allFolders = useMemo(() => normalizeFolders(documentIndex), [documentIndex])
  const allFileRows = useMemo(() => {
    const rows: FileRow[] = []
    for (const [folder, files] of Object.entries(allFolders)) {
      const lowerFolder = folder.toLowerCase()
      for (const file of files) {
        const fileData = typeof file === 'string' ? null : file
        const fileName = normalizeFileName(file)
        const lowerFileName = fileName.toLowerCase()
        const lowerType = (fileData?.type || '').toLowerCase()
        const path = folder === '.' || folder === '' ? fileName : `${folder}/${fileName}`
        const reviewInfo = filesNeedingReview.get(lowerFileName) || filesNeedingReview.get(lowerFileName.replace(/\.pdf$/, ''))

        rows.push({
          path,
          folder,
          fileName,
          fileData,
          lowerFolder,
          lowerFileName,
          lowerType,
          timestamp: parseDocumentTimestamp(fileData, fileName),
          reviewInfo,
          needsReview: !!reviewInfo,
          reindexStatus: filesNeedingReindex.get(lowerFileName),
        })
      }
    }
    return rows
  }, [allFolders, filesNeedingReview, filesNeedingReindex])

  const selectedFilter = useMemo(
    () => filterDefinitions.find((definition) => definition.value === filter) ?? filterDefinitions[0],
    [filterDefinitions, filter],
  )

  const agentPathSet = useMemo(() => {
    if (!agentView?.paths?.length) return null
    const set = new Set<string>()
    for (const path of agentView.paths) {
      set.add(normalizeRelativePath(path))
    }
    return set
  }, [agentView])

  const effectiveDateSortDirection: SortDirection = useMemo(() => {
    if (sort !== 'date') return 'desc'
    if (agentView?.sortBy === 'date' && agentView.sortDirection === 'asc') {
      return 'asc'
    }
    if (agentView?.sortBy === 'date' && agentView.sortDirection === 'desc') {
      return 'desc'
    }
    return 'desc'
  }, [sort, agentView])

  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const activeRows = useMemo(() => {
    return allFileRows
      .filter((row) => {
        if (!agentPathSet) return true
        return agentPathSet.has(normalizeRelativePath(row.path))
      })
      .filter((row) => selectedFilter.matches(row))
      .filter((row) => {
        if (!normalizedSearchQuery) return true
        return row.lowerFileName.includes(normalizedSearchQuery) || row.lowerFolder.includes(normalizedSearchQuery)
      })
  }, [allFileRows, normalizedSearchQuery, selectedFilter, agentPathSet])

  const sortedFolderEntries = useMemo(() => {
    const grouped = new Map<string, FileRow[]>()
    for (const row of activeRows) {
      if (!grouped.has(row.folder)) grouped.set(row.folder, [])
      grouped.get(row.folder)?.push(row)
    }

    const entries = Array.from(grouped.entries()).map(([folder, rows]) =>
      [folder, sortFilesForView(rows, sort, effectiveDateSortDirection)] as [string, FileRow[]]
    )

    if (sort === 'date') {
      entries.sort(([folderA, rowsA], [folderB, rowsB]) => {
        const markerA = effectiveDateSortDirection === 'asc' ? minTimestamp(rowsA) : maxTimestamp(rowsA)
        const markerB = effectiveDateSortDirection === 'asc' ? minTimestamp(rowsB) : maxTimestamp(rowsB)
        if (markerA !== markerB) return effectiveDateSortDirection === 'asc' ? markerA - markerB : markerB - markerA
        return folderA.localeCompare(folderB)
      })
      return entries
    }

    entries.sort(([a], [b]) => a.localeCompare(b))
    return entries
  }, [activeRows, sort, effectiveDateSortDirection])

  const totalFiles = activeRows.length

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) {
        next.delete(folder)
      } else {
        next.add(folder)
      }
      return next
    })
  }

  const getFileUrl = (filePath: string, filename: string): string => {
    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(filePath)}`
    return filename.toLowerCase().endsWith('.pdf') ? `${url}#view=FitH` : url
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-surface-200">
        <h2 className="text-sm font-semibold text-brand-900 mb-3">Case Documents</h2>
        <div className="relative mb-2">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by folder or filename..."
            className="w-full text-xs border border-surface-200 rounded-lg pl-8 pr-2.5 py-2 bg-white
                       text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500
                       placeholder:text-brand-400"
          />
        </div>
        {savedAgentViews.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] text-brand-400">Recent Agent Views</p>
              {onClearSavedAgentViews && (
                <button
                  onClick={onClearSavedAgentViews}
                  className="text-[11px] text-brand-400 hover:text-brand-600 underline decoration-dotted"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {onClearAgentView && (
                <button
                  onClick={onClearAgentView}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                    agentView
                      ? 'bg-white border-surface-200 text-brand-600 hover:bg-surface-100'
                      : 'bg-brand-900 border-brand-900 text-white'
                  }`}
                >
                  All Files
                </button>
              )}
              {savedAgentViews.map((view) => {
                const isActive = (activeAgentViewId || agentView?.id) === view.id
                return (
                  <button
                    key={view.id}
                    onClick={() => onApplyAgentView?.(view)}
                    disabled={!onApplyAgentView}
                    className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                      isActive
                        ? 'bg-accent-600 border-accent-600 text-white'
                        : 'bg-white border-surface-200 text-brand-600 hover:bg-surface-100 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={`${view.name} (${view.totalMatches})`}
                  >
                    <span className="truncate max-w-[140px]">{view.name}</span>
                    <span className={`px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-surface-100 text-brand-500'}`}>
                      {view.totalMatches}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="flex-1 text-xs border border-surface-200 rounded-lg px-2.5 py-2 bg-white
                       text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            <option value="folder">By Folder</option>
            <option value="date">By Date</option>
            <option value="type">By Type</option>
          </select>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterOption)}
            className="flex-1 text-xs border border-surface-200 rounded-lg px-2.5 py-2 bg-white
                       text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            {filterDefinitions.map((definition) => (
              <option key={definition.value} value={definition.value}>
                {definition.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-center justify-between px-2 py-1.5 mb-2">
          <span className="text-xs font-semibold text-brand-500 uppercase tracking-wide">
            Files
          </span>
          <span className="text-xs text-brand-400">{totalFiles}</span>
        </div>

        {sortedFolderEntries.map(([folder, files]) => (
          <div key={folder} className="mb-1">
            <button
              onClick={() => toggleFolder(folder)}
              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-brand-700
                         hover:bg-surface-100 rounded-lg transition-colors group"
            >
              <span
                className="text-brand-400 transition-transform duration-200"
                style={{ transform: expandedFolders.has(folder) ? 'rotate(0deg)' : 'rotate(-90deg)' }}
              >
                <ChevronDownIcon />
              </span>
              <span className="text-accent-600">
                <FolderIcon />
              </span>
              <span className="font-medium flex-1 text-left truncate">{folder}</span>
              <span className="text-xs text-brand-400 bg-surface-100 px-2 py-0.5 rounded-full">
                {files.length}
              </span>
            </button>

            {expandedFolders.has(folder) && (
              <div className="ml-4 pl-4 border-l border-surface-200 mt-1 space-y-0.5">
                {files.map((row, i) => {
                  const fileName = row.fileName
                  const fileData = row.fileData
                  const reviewInfo = row.reviewInfo
                  const needsReview = row.needsReview
                  const reindexStatus = row.reindexStatus
                  const title = fileData && typeof fileData.title === 'string' ? fileData.title : fileName
                  const date = fileData && typeof fileData.date === 'string' ? fileData.date : ''
                  const keyInfo = fileData && typeof fileData.key_info === 'string' ? fileData.key_info : 'No details extracted'
                  const issues = fileData && typeof fileData.issues === 'string' ? fileData.issues : ''
                  const filePath = row.path

                  return (
                    <div key={`${folder}/${fileName}-${i}`} className={`flex items-center gap-1 group rounded-lg focus-within:bg-surface-100 ${needsReview ? 'bg-amber-50' : ''}`}>
                      <button
                        onClick={() => {
                          const reviewWarning = reviewInfo
                            ? `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                                <span class="font-medium">⚠️ Needs Review:</span> ${reviewInfo.reason}
                                <div class="mt-2 text-xs">Conflicting values: ${reviewInfo.conflicting_values.join(' vs ')}</div>
                              </div>`
                            : ''
                          const content = `
<div class="p-6">
  <h2 class="text-lg font-semibold text-gray-900 mb-1">${title}</h2>
  <p class="text-sm text-gray-500 mb-4">${fileName}</p>
  ${date ? `<div class="text-sm mb-3"><span class="font-medium text-gray-700">Date:</span> <span class="text-gray-600">${date}</span></div>` : ''}
  <div class="bg-gray-50 rounded-xl p-4">
    <p class="text-sm font-medium text-gray-900 mb-2">Key Information</p>
    <p class="text-sm text-gray-600 leading-relaxed">${keyInfo}</p>
  </div>
  ${issues ? `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><span class="font-medium">Issue:</span> ${issues}</div>` : ''}
  ${reviewWarning}
</div>`
                          onDocSelect(content, undefined, filePath)
                        }}
                        className={`flex-1 flex items-center gap-2 text-left px-2 py-1.5 text-sm
                                   ${needsReview ? 'text-amber-700 hover:bg-amber-100' : 'text-brand-600 hover:bg-surface-100 hover:text-brand-900'}
                                   rounded-lg truncate transition-colors`}
                        title={`${title}${needsReview ? '\n\n⚠️ NEEDS REVIEW: ' + reviewInfo?.reason : ''}\n\nClick for info, eye icon to view file`}
                      >
                        {needsReview ? (
                          <span className="text-amber-500">
                            <WarningIcon />
                          </span>
                        ) : (
                          <span className="text-brand-400">
                            <DocumentIcon />
                          </span>
                        )}
                        <span className="truncate">{fileName}</span>
                        {reindexStatus && (
                          <span
                            className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                              reindexStatus === 'NEW'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {reindexStatus}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => onFileView(getFileUrl(filePath, fileName), fileName, filePath)}
                        className="p-1.5 text-brand-300 hover:text-accent-600 hover:bg-accent-50
                                   rounded-md opacity-70 group-hover:opacity-100 group-focus-within:opacity-100
                                   focus-visible:opacity-100 transition-all"
                        title="View file"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {sortedFolderEntries.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-3">
              <FolderIcon />
            </div>
            <p className="text-sm text-brand-500">No files found</p>
            <p className="text-xs text-brand-400 mt-1">Try adjusting filters or search text</p>
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="mt-4 pt-3 border-t border-amber-200">
            <div className="flex items-center justify-between px-2 py-1.5 mb-2">
              <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">
                Pending
              </span>
              <span className="text-xs text-amber-500">{pendingFiles.length}</span>
            </div>

            {pendingFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-1 group rounded-lg focus-within:bg-amber-50">
                <div className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm text-amber-700 truncate">
                  <span className="text-amber-400">
                    <DocumentIcon />
                  </span>
                  <span className="truncate">{file.filename}</span>
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-100 text-emerald-700">
                    NEW
                  </span>
                </div>
                <button
                  onClick={() => {
                    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(file.path)}`
                    const viewUrl = file.filename.toLowerCase().endsWith('.pdf') ? `${url}#view=FitH` : url
                    onFileView(viewUrl, file.filename, file.path)
                  }}
                  className="p-1.5 text-brand-300 hover:text-accent-600 hover:bg-accent-50
                             rounded-md opacity-70 group-hover:opacity-100 group-focus-within:opacity-100
                             focus-visible:opacity-100 transition-all"
                  title="View file"
                >
                  <EyeIcon />
                </button>
              </div>
            ))}

            <p className="px-2 mt-2 text-[11px] text-amber-500 italic">
              Update index to include these files
            </p>
          </div>
        )}

        {generatedDocs.length > 0 && (
          <div className="mt-6 pt-4 border-t border-surface-200">
            <div className="flex items-center justify-between px-2 py-1.5 mb-2">
              <span className="text-xs font-semibold text-brand-500 uppercase tracking-wide">
                Generated
              </span>
              <span className="text-xs text-brand-400">{generatedDocs.length}</span>
            </div>

            {generatedDocs.map((doc, i) => (
              <button
                key={i}
                onClick={async () => {
                  try {
                    const res = await fetch(`${apiUrl}/api/docs/read?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(doc.path)}`)
                    const data = await res.json()
                    if (data.content) {
                      onDocSelect(data.content, doc.path, doc.path)
                    }
                  } catch {
                    onDocSelect(`Error loading ${doc.name}`, undefined, undefined)
                  }
                }}
                className="w-full flex items-center gap-2 px-2 py-2 text-sm text-emerald-700
                           hover:bg-emerald-50 rounded-lg truncate transition-colors"
              >
                <span className="text-emerald-500">
                  <DocumentTextIcon />
                </span>
                <span className="truncate">{doc.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
