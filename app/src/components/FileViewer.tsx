import { useState, useMemo, useEffect } from 'react'
import type { DocumentIndex, NeedsReviewItem } from '../App'

interface Props {
  documentIndex: DocumentIndex | null
  generatedDocs: any[]
  caseFolder: string
  apiUrl: string
  onDocSelect: (content: string, docPath?: string) => void
  onFileView: (url: string, filename: string) => void
}

type SortOption = 'folder' | 'date' | 'type'
type FilterOption = 'all' | 'medical' | '1p' | '3p' | 'intake'

// Icons
const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
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

export default function FileViewer({ documentIndex, generatedDocs, caseFolder, apiUrl, onDocSelect, onFileView }: Props) {
  const [sort, setSort] = useState<SortOption>('folder')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  // Expand all folders when index loads or changes
  useEffect(() => {
    if (documentIndex?.folders) {
      setExpandedFolders(new Set(Object.keys(documentIndex.folders)))
    }
  }, [documentIndex])

  // Build a map of filenames that need review, with their review info
  const filesNeedingReview = useMemo(() => {
    const reviewMap = new Map<string, NeedsReviewItem>()
    if (!documentIndex?.needs_review) return reviewMap

    for (const item of documentIndex.needs_review) {
      for (const source of item.sources) {
        // Extract filename from source string like "MRB Spinal Rehab Center.PDF (itemized bill)"
        const filename = source.replace(/\s*\([^)]*\)\s*$/, '').trim()
        reviewMap.set(filename.toLowerCase(), item)
      }
    }
    return reviewMap
  }, [documentIndex])

  const toggleFolder = (folder: string) => {
    const next = new Set(expandedFolders)
    if (next.has(folder)) {
      next.delete(folder)
    } else {
      next.add(folder)
    }
    setExpandedFolders(next)
  }

  // Normalize all folders (regardless of filter) - used for file lookup
  const allFolders = useMemo(() => {
    if (!documentIndex?.folders) return {}

    const normalizedFolders: Record<string, any[]> = {}
    for (const [key, val] of Object.entries(documentIndex.folders)) {
      if (Array.isArray(val)) {
        normalizedFolders[key] = val
      } else if (val && typeof val === 'object' && 'files' in val && Array.isArray((val as any).files)) {
        normalizedFolders[key] = (val as any).files
      } else if (val && typeof val === 'object' && 'documents' in val && Array.isArray((val as any).documents)) {
        normalizedFolders[key] = (val as any).documents
      } else {
        continue
      }
    }
    return normalizedFolders
  }, [documentIndex])

  const filteredFolders = useMemo(() => {
    if (filter === 'all') return allFolders

    // Use partial matching for filters
    const filterMatchers: Record<FilterOption, (folderName: string) => boolean> = {
      all: () => true,
      medical: (name) => {
        const lower = name.toLowerCase()
        return lower.includes('record') || lower.includes('bill') || lower.includes('balance') || lower.includes('mrb') || lower.includes('mre')
      },
      '1p': (name) => name.toLowerCase().includes('1p'),
      '3p': (name) => name.toLowerCase().includes('3p'),
      intake: (name) => name.toLowerCase().includes('intake'),
    }

    const matcher = filterMatchers[filter]
    return Object.fromEntries(
      Object.entries(allFolders).filter(([key]) => matcher(key))
    )
  }, [allFolders, filter])

  const getFileUrl = (folder: string, filename: string) => {
    const path = `${folder}/${filename}`
    const url = `${apiUrl}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(path)}`
    // Add PDF viewer hint for inline display
    return filename.toLowerCase().endsWith('.pdf') ? `${url}#view=FitH` : url
  }

  // Find which folder a file is in by filename (case-insensitive) - searches ALL folders
  const findFileFolder = (filename: string): string | null => {
    const lowerFilename = filename.toLowerCase()
    for (const [folder, files] of Object.entries(allFolders)) {
      for (const file of files) {
        const fn = typeof file === 'string' ? file : (file.file || file.filename || '')
        if (fn.toLowerCase() === lowerFilename) {
          return folder
        }
      }
    }
    return null
  }

  const totalFiles = Object.values(filteredFolders).reduce((acc, files) => acc + files.length, 0)

  // Sort folders alphabetically
  const sortedFolderEntries = useMemo(() => {
    return Object.entries(filteredFolders).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredFolders])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-surface-200">
        <h2 className="text-sm font-semibold text-brand-900 mb-3">Case Documents</h2>
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
            <option value="all">All Files</option>
            <option value="medical">Medical</option>
            <option value="1p">First Party</option>
            <option value="3p">Third Party</option>
            <option value="intake">Intake</option>
          </select>
        </div>
      </div>

      {/* File tree */}
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
              <span className="text-brand-400 transition-transform duration-200"
                    style={{ transform: expandedFolders.has(folder) ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
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
                {files.map((file: any, i: number) => {
                  // Handle both object format and string format (legacy indexes)
                  const isStringFile = typeof file === 'string'
                  const fileName = isStringFile ? file : (file.file || file.filename || 'Unknown')
                  const fileData = isStringFile ? { filename: file } : file
                  const reviewInfo = filesNeedingReview.get(fileName.toLowerCase())
                  const needsReview = !!reviewInfo
                  return (
                    <div key={i} className={`flex items-center gap-1 group ${needsReview ? 'bg-amber-50 rounded-lg' : ''}`}>
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
  <h2 class="text-lg font-semibold text-gray-900 mb-1">${fileData.title || fileName}</h2>
  <p class="text-sm text-gray-500 mb-4">${fileName}</p>
  ${fileData.date ? `<div class="text-sm mb-3"><span class="font-medium text-gray-700">Date:</span> <span class="text-gray-600">${fileData.date}</span></div>` : ''}
  <div class="bg-gray-50 rounded-xl p-4">
    <p class="text-sm font-medium text-gray-900 mb-2">Key Information</p>
    <p class="text-sm text-gray-600 leading-relaxed">${fileData.key_info || 'No details extracted'}</p>
  </div>
  ${fileData.issues ? `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><span class="font-medium">Issue:</span> ${fileData.issues}</div>` : ''}
  ${reviewWarning}
</div>`
                          onDocSelect(content)
                        }}
                        className={`flex-1 flex items-center gap-2 text-left px-2 py-1.5 text-sm
                                   ${needsReview ? 'text-amber-700 hover:bg-amber-100' : 'text-brand-600 hover:bg-surface-100 hover:text-brand-900'}
                                   rounded-lg truncate transition-colors`}
                        title={`${fileData.title || fileName}${needsReview ? '\n\n⚠️ NEEDS REVIEW: ' + reviewInfo?.reason : ''}\n\nClick for info, eye icon to view file`}
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
                      </button>
                      <button
                        onClick={() => onFileView(getFileUrl(folder, fileName), fileName)}
                        className="p-1.5 text-brand-300 hover:text-accent-600 hover:bg-accent-50
                                   rounded-md opacity-0 group-hover:opacity-100 transition-all"
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
            <p className="text-xs text-brand-400 mt-1">Try adjusting filters</p>
          </div>
        )}

        {/* Generated Documents */}
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
                      onDocSelect(data.content, doc.path)
                    }
                  } catch {
                    onDocSelect(`Error loading ${doc.name}`)
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
