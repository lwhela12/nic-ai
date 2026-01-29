import { useState, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentIndex, ErrataItem, NeedsReviewItem } from '../App'

interface Draft {
  id: string
  name: string
  path: string
  type: string
  createdAt: string
  targetPath: string
}

interface Props {
  content: string
  docPath: string | null
  fileUrl: string | null
  fileName: string
  caseFolder: string
  apiUrl: string
  documentIndex: DocumentIndex | null
  firmRoot?: string
  onCloseFile: () => void
  onIndexUpdated: () => void
  onDraftsUpdated?: () => void
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

export default function Visualizer({ content, docPath, fileUrl, fileName, caseFolder, apiUrl, documentIndex, firmRoot, onCloseFile, onIndexUpdated, onDraftsUpdated }: Props) {
  const [activeTab, setActiveTab] = useState<'view' | 'review' | 'drafts'>('view')
  const [verifiedItems, setVerifiedItems] = useState<Set<string>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [correctionValue, setCorrectionValue] = useState('')

  // Drafts state
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null)
  const [draftContent, setDraftContent] = useState<string>('')
  const [isApprovingDraft, setIsApprovingDraft] = useState(false)
  const [draftExportMenuOpen, setDraftExportMenuOpen] = useState(false)

  const errata: ErrataItem[] = Array.isArray(documentIndex?.errata) ? documentIndex.errata : []
  const needsReview: NeedsReviewItem[] = Array.isArray(documentIndex?.needs_review) ? documentIndex.needs_review : []

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

  // Load draft content when selected
  useEffect(() => {
    if (!selectedDraft || !caseFolder) {
      setDraftContent('')
      return
    }

    const loadDraftContent = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/docs/read?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(selectedDraft.path)}`)
        if (res.ok) {
          const data = await res.json()
          setDraftContent(data.content || '')
        }
      } catch (err) {
        console.error('Failed to load draft content:', err)
      }
    }

    loadDraftContent()
  }, [selectedDraft, caseFolder, apiUrl])

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

  const handleExportDraft = (format: 'md' | 'docx' | 'pdf') => {
    setDraftExportMenuOpen(false)
    if (!selectedDraft || !caseFolder) return

    const url = `${apiUrl}/api/docs/download?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(selectedDraft.path)}&format=${format}`

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
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDraftTypeIcon = (type: string) => {
    switch (type) {
      case 'demand':
        return '📄'
      case 'settlement':
        return '💰'
      case 'memo':
        return '📋'
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
    if (fileUrl) {
      window.open(fileUrl, '_blank')
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

  const handleExport = (format: 'md' | 'docx' | 'pdf') => {
    setExportMenuOpen(false)
    if (!docPath || !caseFolder) return

    const url = `${apiUrl}/api/docs/download?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(docPath)}&format=${format}`

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

  const isHtml = content.includes('<div') || content.includes('<table')
  const isMarkdown = content.startsWith('#') || content.includes('\n##') || content.includes('\n- ') || content.includes('\n* ')
  const isPdf = fileName.toLowerCase().endsWith('.pdf')
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)

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
          onClick={() => setActiveTab('drafts')}
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
          {selectedDraft ? (
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
                <div className="prose prose-sm max-w-none
                                prose-headings:my-3 prose-headings:text-brand-900
                                prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                                prose-table:border-collapse prose-th:border prose-th:border-surface-200
                                prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2
                                prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2
                                prose-a:text-accent-600">
                  <Markdown remarkPlugins={[remarkGfm]}>{draftContent}</Markdown>
                </div>
              </div>

              {/* Draft actions */}
              <div className="px-4 py-3 border-t border-surface-200 bg-surface-50 flex items-center gap-3">
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

                <div className="flex-1" />

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
                  {drafts.map((draft) => (
                    <button
                      key={draft.id}
                      onClick={() => setSelectedDraft(draft)}
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
                        <span className="text-brand-300">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeTab === 'view' ? (
        <div className="flex-1 overflow-auto flex flex-col">
          {fileUrl ? (
            <>
              {/* File viewing header */}
              <div className="px-4 py-3 border-b border-surface-200 flex items-center justify-between bg-surface-50">
                <span className="text-sm font-medium text-brand-700 truncate flex-1" title={fileName}>
                  {fileName}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                               bg-white border border-surface-200 hover:bg-surface-100
                               rounded-lg text-brand-700 transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon />
                    Open
                  </button>
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
              <div className="flex-1 relative bg-surface-100">
                {isPdf ? (
                  <embed
                    src={fileUrl}
                    type="application/pdf"
                    className="absolute inset-0 w-full h-full"
                  />
                ) : isImage ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <img
                      src={fileUrl}
                      alt={fileName}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-card"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={() => window.open(fileUrl, '_blank')}
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
          ) : content ? (
            <>
              {/* Actions bar */}
              <div className="px-4 py-3 border-b border-surface-200 flex gap-2 bg-surface-50">
                {isExportable ? (
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
                        <div className="absolute left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-20">
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
                ) : (
                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                               bg-white border border-surface-200 hover:bg-surface-100
                               rounded-lg text-brand-700 transition-colors"
                  >
                    <ArrowDownTrayIcon />
                    Download
                  </button>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(content)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                             bg-white border border-surface-200 hover:bg-surface-100
                             rounded-lg text-brand-700 transition-colors"
                >
                  <ClipboardIcon />
                  Copy
                </button>
              </div>

              {/* Rendered content */}
              <div className="p-6 flex-1 overflow-auto">
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
