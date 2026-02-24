import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './index.css'
import FileViewer from './components/FileViewer'
import Chat from './components/Chat'
import Visualizer from './components/Visualizer'
import ResizablePanelLayout from './components/ResizablePanelLayout'
import FolderPicker from './components/FolderPicker'
import FirmDashboard from './components/FirmDashboard'
import Login from './components/Login'
import TodoDrawer from './components/TodoDrawer'
import UserNotes from './components/UserNotes'
import ContactCard from './components/ContactCard'
import PacketCreation from './components/PacketCreation'
import type { PacketDocument, PacketFrontMatter, PacketPiiResult, PacketState } from './types/packet'
const API_URL = ''  // Use relative URLs - Vite proxies /api to localhost:3001

interface FirmTodo {
  id: string
  text: string
  caseRef?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'completed'
  createdAt: string
}
const FIRM_ROOT_KEY = 'claude-pi-firm-root'

type PracticeArea = 'Personal Injury' | 'Workers\' Compensation'

// URL param helpers for persisting navigation state across refreshes
const getUrlParam = (key: string): string | null => {
  const params = new URLSearchParams(window.location.search)
  return params.get(key)
}

const setUrlParam = (key: string, value: string | null, replace = false) => {
  const params = new URLSearchParams(window.location.search)
  if (value) {
    params.set(key, value)
  } else {
    params.delete(key)
  }
  const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname
  if (replace) {
    window.history.replaceState({}, '', newUrl)
  } else {
    window.history.pushState({}, '', newUrl)
  }
}

const normalizePracticeArea = (value: unknown): PracticeArea | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'wc' || normalized.includes('worker') || normalized.includes('comp')) {
    return 'Workers\' Compensation'
  }
  if (normalized === 'pi' || normalized.includes('personal') || normalized.includes('injury')) {
    return 'Personal Injury'
  }
  return null
}

const getDefaultPacketPageSelection = (): PacketDocument['pageSelection'] => ({
  allPages: true,
  pageRanges: '',
})

const normalizePacketPageSelection = (
  pageSelection: PacketDocument['pageSelection'] | { allPages?: unknown; pageRanges?: unknown } | undefined
): PacketDocument['pageSelection'] => {
  if (pageSelection && typeof pageSelection === 'object') {
    const allPages = pageSelection.allPages !== false
    const pageRanges = typeof pageSelection.pageRanges === 'string' ? pageSelection.pageRanges : ''
    return {
      allPages,
      pageRanges: allPages ? '' : pageRanges,
    }
  }
  return getDefaultPacketPageSelection()
}

// Dev mode - skip auth in Vite dev server
// Set VITE_AUTH_ENABLED=true to force auth even in dev mode
const DEV_MODE = import.meta.env.DEV && import.meta.env.VITE_AUTH_ENABLED !== 'true'
const MAX_SAVED_AGENT_VIEWS = 4
const AGENT_VIEWS_STORAGE_KEY = 'claude-pi-agent-views-by-case-v1'

type TeamRole = 'attorney' | 'case_manager_lead' | 'case_manager' | 'case_manager_assistant'

interface TeamContext {
  userId: string
  name: string
  role: TeamRole
  status: 'pending' | 'active' | 'deactivated'
  permissions: {
    canManageTeam: boolean
    canAssignCases: boolean
    canViewAllCases: boolean
    canEditKnowledge: boolean
  }
}

interface AuthState {
  authenticated: boolean
  email?: string
  subscriptionStatus?: string
  devMode?: boolean
  teamError?: string
  team?: TeamContext
}

export interface NeedsReviewItem {
  field: string
  conflicting_values: string[]
  sources: string[]
  reason: string
  // Alternate field names that Sonnet might produce
  item?: string
  description?: string
}

export interface ErrataItem {
  field: string
  decision: string
  evidence: string
  confidence: string
  // Alternate field name that Sonnet might produce
  description?: string
}

export interface CaseNote {
  id: string
  content: string
  field_updated?: string
  previous_value?: unknown
  source: 'chat' | 'manual'
  createdAt: string
}

export interface ChatArchive {
  id: string
  date: string
  summary: string
  messageCount: number
  file: string
}

export type DocumentFile =
  | {
      filename?: string
      file?: string
      title?: string
      date?: string
      issues?: string
      type?: string
      key_info?: string
      has_handwritten_data?: boolean
      handwritten_fields?: string[]
      user_reviewed?: boolean
      reviewed_at?: string
      review_notes?: string
      extracted_data?: Record<string, unknown>
      [key: string]: unknown
    }
  | string

export type DocumentFolder =
  | { files: DocumentFile[] }
  | { documents: DocumentFile[] }
  | DocumentFile[]

export interface GeneratedDoc {
  name: string
  path: string
  fullPath?: string
  type?: string
  size?: number
}

export interface DocumentIndex {
  case_name: string
  indexed_at: string
  practice_area?: string
  folders: Record<string, DocumentFolder>
  summary: {
    client: string
    dol?: string
    incident_date?: string
    dob?: string
    providers: string[]
    total_charges: string | number
    policy_limits: Record<string, unknown> | string | null
    contact?: {
      phone?: string
      email?: string
      address?: {
        street?: string
        city?: string
        state?: string
        zip?: string
      }
    }
    health_insurance?: {
      carrier?: string
      group_no?: string
      member_no?: string
    }
    claim_numbers?: Record<string, string>
    employer?: {
      name?: string
      address?: { street?: string; city?: string; state?: string; zip?: string } | string
      phone?: string
      contact_name?: string
    }
    wc_carrier?: {
      name?: string
      carrier?: string
      claim_number?: string
      adjuster_name?: string
      adjuster?: string
      adjuster_phone?: string
      adjuster_email?: string
      tpa_name?: string
      tpa?: string
    }
    disability_status?: {
      type?: string
      amw?: number
      compensation_rate?: number
      mmi_date?: string
      ppd_rating?: number
    }
    job_title?: string
    injury_description?: string
    body_parts?: string[]
  }
  issues_found?: string[]
  case_analysis?: string
  needs_review?: NeedsReviewItem[]
  reconciled_values?: Record<string, unknown>
  errata?: ErrataItem[]
  case_notes?: CaseNote[]
  chat_archives?: ChatArchive[]
}

export interface AgentDocumentView {
  id: string
  name: string
  description?: string
  paths: string[]
  sortBy?: 'folder' | 'date' | 'type'
  sortDirection?: 'asc' | 'desc'
  createdAt: string
  totalMatches: number
}

// Derive contact info from per-file extracted_data when summary.contact is missing.
// Uses majority-voting across all files to pick the most common phone/email/address.
function deriveContactFromFiles(folders: Record<string, DocumentFolder>): {
  phone?: string; email?: string; address?: { street?: string; city?: string; state?: string; zip?: string }
} | undefined {
  const phones: Record<string, number> = {}
  const emails: Record<string, number> = {}
  const addresses: Record<string, { obj: Record<string, string>; count: number }> = {}

  for (const folder of Object.values(folders)) {
    for (const file of getFolderFiles(folder)) {
      if (typeof file === 'string') continue
      const ed = file.extracted_data as Record<string, unknown> | undefined
      if (!ed) continue

      const phone = ed.phone || ed.client_phone
      if (typeof phone === 'string' && phone.trim() && !phone.includes('UNKNOWN')) {
        const digits = phone.replace(/\D/g, '').replace(/^1/, '')
        if (digits.length >= 7) phones[digits] = (phones[digits] || 0) + 1
      }

      const email = ed.email || ed.client_email
      if (typeof email === 'string' && email.includes('@') && !email.includes('UNKNOWN')) {
        const normalized = email.trim().toLowerCase()
        emails[normalized] = (emails[normalized] || 0) + 1
      }

      const addr = ed.address || ed.client_address
      if (addr && typeof addr === 'object' && (addr as Record<string, unknown>).street) {
        const obj = addr as Record<string, string>
        const key = obj.street.trim().toUpperCase()
        if (!addresses[key]) addresses[key] = { obj, count: 0 }
        addresses[key].count++
      } else if (typeof addr === 'string' && addr.trim() && !addr.includes('UNKNOWN')) {
        const key = addr.trim().toUpperCase()
        if (!addresses[key]) addresses[key] = { obj: { street: addr.trim() }, count: 0 }
        addresses[key].count++
      }
    }
  }

  const topPhone = Object.entries(phones).sort((a, b) => b[1] - a[1])[0]
  const topEmail = Object.entries(emails).sort((a, b) => b[1] - a[1])[0]
  const topAddr = Object.values(addresses).sort((a, b) => b.count - a.count)[0]

  if (!topPhone && !topEmail && !topAddr) return undefined

  const result: { phone?: string; email?: string; address?: Record<string, string> } = {}
  if (topPhone) {
    const d = topPhone[0]
    result.phone = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d
  }
  if (topEmail) result.email = topEmail[0]
  if (topAddr) result.address = topAddr.obj
  return result
}

const normalizeAgentViewPath = (path: string): string =>
  path.replace(/\\/g, '/').trim().toLowerCase()

const getAgentViewCaseKey = (caseFolder: string): string =>
  encodeURIComponent(caseFolder)

const getAgentViewSignature = (view: AgentDocumentView): string => {
  const sortBy = view.sortBy || ''
  const sortDirection = view.sortDirection || ''
  const paths = view.paths.map(normalizeAgentViewPath).join('|')
  return `${sortBy}:${sortDirection}:${paths}`
}

const dedupeAndCapAgentViews = (views: AgentDocumentView[]): AgentDocumentView[] => {
  const deduped: AgentDocumentView[] = []
  const seenSignatures = new Set<string>()

  for (const view of views) {
    if (!view || typeof view.id !== 'string' || typeof view.name !== 'string' || !Array.isArray(view.paths)) {
      continue
    }
    const paths = view.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    if (paths.length === 0) continue

    const normalizedView: AgentDocumentView = {
      ...view,
      paths,
      totalMatches: typeof view.totalMatches === 'number' && view.totalMatches > 0
        ? view.totalMatches
        : paths.length,
      createdAt: typeof view.createdAt === 'string' && view.createdAt
        ? view.createdAt
        : new Date().toISOString(),
    }

    const signature = getAgentViewSignature(normalizedView)
    if (seenSignatures.has(signature)) continue

    seenSignatures.add(signature)
    deduped.push(normalizedView)
    if (deduped.length >= MAX_SAVED_AGENT_VIEWS) break
  }

  return deduped
}

const getFolderFiles = (data: DocumentFolder): DocumentFile[] => {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'files' in data && Array.isArray(data.files)) {
    return data.files
  }
  if (data && typeof data === 'object' && 'documents' in data && Array.isArray(data.documents)) {
    return data.documents
  }
  return []
}

const getDocumentFileName = (file: DocumentFile): string | undefined => {
  if (typeof file === 'string') return file
  return file.filename || file.file
}

const normalizeDocumentLookupPath = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
    .toLowerCase()

const isPlaceholderPacketTitle = (value: string | undefined): boolean => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return true
  if (normalized === 'selected document' || normalized === 'selected doc' || normalized === 'document') {
    return true
  }
  return /^doc_[a-f0-9]{8}$/i.test(normalized)
}

const resolvePacketTitle = (value: string | undefined, fallback: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (isPlaceholderPacketTitle(trimmed)) return fallback
  return trimmed
}

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const buildDocumentIdFromPath = (path: string): string => {
  const normalized = normalizeDocumentLookupPath(path)
  return `doc_${fnv1a32(normalized)}`
}

const buildDocumentId = (folder: string, filename: string): string => {
  const normalizedFolder = normalizeDocumentLookupPath(folder)
  const normalizedFile = normalizeDocumentLookupPath(filename)
  const canonical = normalizedFolder && normalizedFolder !== '.' && normalizedFolder !== 'root'
    ? `${normalizedFolder}/${normalizedFile}`
    : normalizedFile
  return buildDocumentIdFromPath(canonical)
}

const getCanonicalPacketPath = (
  rawPath: string,
  docLookup: Map<string, { file: DocumentFile; folder: string }>
): string | null => {
  const normalizedPath = normalizeDocumentLookupPath(rawPath)
  const basename = normalizedPath.split('/').pop() || normalizedPath
  const entry = docLookup.get(normalizedPath) || docLookup.get(basename)
  if (!entry) return null
  const matchName = getDocumentFileName(entry.file)
  if (!matchName) return null
  return entry.folder && entry.folder !== '.' && entry.folder !== ''
    ? `${entry.folder}/${matchName}`
    : matchName
}

const getCanonicalPacketPathById = (
  docId: string,
  docLookupById: Map<string, { file: DocumentFile; folder: string }>
): string | null => {
  const entry = docLookupById.get(docId)
  if (!entry) return null
  const matchName = getDocumentFileName(entry.file)
  if (!matchName) return null
  return entry.folder && entry.folder !== '.' && entry.folder !== ''
    ? `${entry.folder}/${matchName}`
    : matchName
}


// Icon components
const FolderIcon = () => (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
)

const ArrowLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
)

const ScaleIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
  </svg>
)

const ClipboardListIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
)

const UserCircleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const NotepadIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
)


function App() {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [firmRoot, setFirmRoot] = useState<string | null>(() => {
    return localStorage.getItem(FIRM_ROOT_KEY)
  })
  const [practiceArea, setPracticeArea] = useState<PracticeArea | null>(null)
  const [folderSetupError, setFolderSetupError] = useState<string | null>(null)
  const [caseFolder, setCaseFolderState] = useState<string | null>(() => {
    return getUrlParam('case')
  })

  // Wrapper to sync caseFolder with URL
  const setCaseFolder = (folder: string | null) => {
    setCaseFolderState(folder)
    setUrlParam('case', folder)
  }
  const [documentIndex, setDocumentIndex] = useState<DocumentIndex | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [viewContent, setViewContent] = useState<string>('')
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [fileViewUrl, setFileViewUrl] = useState<string | null>(null)
  const [fileViewName, setFileViewName] = useState<string>('')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)  // Track selected file for view toggling
  const [visualizerMode, setVisualizerMode] = useState<'summary' | 'document'>('summary')
  const [reviewPrompt, setReviewPrompt] = useState<string>('')
  const [viewDocPath, setViewDocPath] = useState<string | null>(null)
  const [refreshDraftsKey, setRefreshDraftsKey] = useState(0)
  const [evidencePacketTakeover, setEvidencePacketTakeover] = useState<{ path: string; version: number } | null>(null)
  const [indexStatusForViewer, setIndexStatusForViewer] = useState<{ needsIndex: boolean; newFiles: string[]; modifiedFiles: string[] } | null>(null)
  const [agentDocumentView, setAgentDocumentView] = useState<AgentDocumentView | null>(null)
  const [savedAgentViews, setSavedAgentViews] = useState<AgentDocumentView[]>([])

  // Packet creation mode state — persisted to sessionStorage so Vite HMR reloads don't lose it
  const [packetMode, setPacketMode] = useState(() => {
    try { return sessionStorage.getItem('pi-packet-mode') === '1' } catch { return false }
  })
  const [packetPiiTabActive, setPacketPiiTabActive] = useState(false)
  const [packetState, setPacketState] = useState<PacketState | null>(() => {
    try {
      const raw = sessionStorage.getItem('pi-packet-state')
      const parsed = raw ? JSON.parse(raw) as PacketState : null
      if (!parsed) return null
      return {
        ...parsed,
        documents: Array.isArray(parsed.documents)
          ? parsed.documents.map((doc) => ({
            ...doc,
            pageSelection: normalizePacketPageSelection((doc as PacketDocument).pageSelection),
          }))
          : [],
        frontMatterDocxPath: typeof parsed.frontMatterDocxPath === 'string' ? parsed.frontMatterDocxPath : null,
        frontMatterWorkingDocxPath: typeof parsed.frontMatterWorkingDocxPath === 'string' ? parsed.frontMatterWorkingDocxPath : null,
        frontMatterWorkingDocxMtime: typeof parsed.frontMatterWorkingDocxMtime === 'number' ? parsed.frontMatterWorkingDocxMtime : null,
      }
    } catch { return null }
  })

  // Sync packet mode to sessionStorage so it survives page reloads (Vite HMR)
  useEffect(() => {
    try {
      if (packetMode) {
        sessionStorage.setItem('pi-packet-mode', '1')
      } else {
        sessionStorage.removeItem('pi-packet-mode')
        sessionStorage.removeItem('pi-packet-state')
        setPacketPiiTabActive(false)
      }
    } catch { /* ignore */ }
  }, [packetMode])

  useEffect(() => {
    try {
      if (packetState) {
        sessionStorage.setItem('pi-packet-state', JSON.stringify(packetState))
      } else {
        sessionStorage.removeItem('pi-packet-state')
      }
    } catch { /* ignore */ }
  }, [packetState])

  // Sync packet document metadata (date, title, type) when the document index updates
  useEffect(() => {
    if (!packetState || !documentIndex?.folders) return
    const lookup = new Map<string, DocumentFile>()
    for (const [folder, data] of Object.entries(documentIndex.folders)) {
      for (const file of getFolderFiles(data)) {
        if (typeof file === 'string') continue
        const name = getDocumentFileName(file)
        if (!name) continue
        const fullPath = normalizeDocumentLookupPath(
          folder === '.' || folder === '' ? name : `${folder}/${name}`
        )
        lookup.set(fullPath, file)
      }
    }
    let changed = false
    const updated = packetState.documents.map(doc => {
      const match = lookup.get(normalizeDocumentLookupPath(doc.path))
      if (!match || typeof match === 'string') return doc
      const newDate = typeof match.date === 'string' ? match.date : null
      const newTitle = typeof match.title === 'string' ? match.title : doc.title
      const newType = typeof match.type === 'string' ? match.type : doc.type
      if (newDate !== doc.date || newTitle !== doc.title || newType !== doc.type) {
        changed = true
        const hasWarning = !newDate || (doc.hasWarning && doc.warningReason !== 'No date')
        const warningReason = !newDate ? 'No date' : (doc.warningReason !== 'No date' ? doc.warningReason : undefined)
        return { ...doc, date: newDate, title: newTitle, type: newType, hasWarning, warningReason }
      }
      return doc
    })
    if (changed) {
      setPacketState(prev => prev ? { ...prev, documents: updated } : prev)
    }
  }, [documentIndex])

  // Ref to track current caseFolder for async completions
  const caseFolderRef = useRef(caseFolder)
  caseFolderRef.current = caseFolder

  // Agent-generated document views are case-specific and persist per-case locally
  useEffect(() => {
    setAgentDocumentView(null)
    setEvidencePacketTakeover(null)
    if (!caseFolder) {
      setSavedAgentViews([])
      return
    }

    try {
      const raw = localStorage.getItem(AGENT_VIEWS_STORAGE_KEY)
      if (!raw) {
        setSavedAgentViews([])
        return
      }

      const byCase = JSON.parse(raw) as Record<string, AgentDocumentView[]>
      const caseKey = getAgentViewCaseKey(caseFolder)
      const storedViews = Array.isArray(byCase?.[caseKey]) ? byCase[caseKey] : []
      setSavedAgentViews(dedupeAndCapAgentViews(storedViews))
    } catch {
      setSavedAgentViews([])
    }
  }, [caseFolder])

  useEffect(() => {
    if (!caseFolder) return
    try {
      const raw = localStorage.getItem(AGENT_VIEWS_STORAGE_KEY)
      const byCase = raw ? (JSON.parse(raw) as Record<string, AgentDocumentView[]>) : {}
      const caseKey = getAgentViewCaseKey(caseFolder)

      if (savedAgentViews.length > 0) {
        byCase[caseKey] = dedupeAndCapAgentViews(savedAgentViews)
      } else {
        delete byCase[caseKey]
      }

      localStorage.setItem(AGENT_VIEWS_STORAGE_KEY, JSON.stringify(byCase))
    } catch {
      // Ignore localStorage persistence failures
    }
  }, [caseFolder, savedAgentViews])

  const handleDocumentView = useCallback((view: AgentDocumentView) => {
    setAgentDocumentView(view)
    setSavedAgentViews((prev) => {
      const incomingSignature = getAgentViewSignature(view)
      const withoutDuplicate = prev.filter((existing) => getAgentViewSignature(existing) !== incomingSignature)
      return dedupeAndCapAgentViews([view, ...withoutDuplicate])
    })
  }, [])

  const handleApplySavedAgentView = useCallback((view: AgentDocumentView) => {
    setAgentDocumentView(view)
    setSavedAgentViews((prev) => {
      const reordered = [view, ...prev.filter((item) => item.id !== view.id)]
      return dedupeAndCapAgentViews(reordered)
    })
  }, [])

  const handleClearSavedAgentViews = useCallback(() => {
    setAgentDocumentView(null)
    setSavedAgentViews([])
  }, [])

  // --- Packet creation mode handlers ---
  const createDefaultFrontMatter = useCallback(async (): Promise<PacketFrontMatter> => {
    const summary = documentIndex?.summary
    const fm: PacketFrontMatter = {
      claimantName: summary?.client || '',
      claimNumber:
        (typeof summary?.wc_carrier?.claim_number === 'string' && summary.wc_carrier.claim_number) ||
        (summary?.claim_numbers && typeof summary.claim_numbers === 'object'
          ? Object.values(summary.claim_numbers).find(v => typeof v === 'string') as string || ''
          : '') || '',
      hearingNumber: '',
      hearingDateTime: '',
      appearance: 'Telephonic',
      introductoryCounselLine: '',
      serviceDate: new Date().toLocaleDateString('en-US'),
      serviceMethod: 'Via E-File',
      recipients: [],
      firmBlockLines: [],
      templateId: 'ho-standard',
      signerName: '',
      issueOnAppeal: '',
      extraSectionValues: {},
    }
    // Try to load firm config for firm block lines + default signer
    if (firmRoot) {
      try {
        const res = await fetch(`${API_URL}/api/knowledge/firm-config?root=${encodeURIComponent(firmRoot)}`)
        if (res.ok) {
          const config = await res.json()
          if (Array.isArray(config?.firmBlockLines) && config.firmBlockLines.some((l: string) => l?.trim())) {
            fm.firmBlockLines = config.firmBlockLines
          } else {
            // Build from individual firm config fields
            const lines: string[] = []
            const primaryAttorney = Array.isArray(config?.attorneys)
              ? config.attorneys.find((a: any) => typeof a?.name === 'string' && a.name.trim())
              : null
            if (primaryAttorney?.name) lines.push(primaryAttorney.name)
            const credentialNumber = typeof primaryAttorney?.barNo === 'string' ? primaryAttorney.barNo.trim() : ''
            const credentialLabel = typeof primaryAttorney?.barLabel === 'string' && primaryAttorney.barLabel.trim()
              ? primaryAttorney.barLabel.trim()
              : 'NV Bar No.'
            if (credentialNumber) {
              if (credentialNumber.toLowerCase().startsWith(credentialLabel.toLowerCase())) {
                lines.push(credentialNumber)
              } else {
                lines.push(`${credentialLabel} ${credentialNumber}`)
              }
            } else if (config.nevadaBarNo) {
              lines.push(`NV Bar No. ${config.nevadaBarNo}`)
            }
            if (config.firmName) lines.push(config.firmName)
            if (config.address) lines.push(config.address)
            if (config.cityStateZip) lines.push(config.cityStateZip)
            if (config.phone) lines.push(`Phone: ${config.phone}`)
            if (config.email) lines.push(config.email)
            if (lines.length > 0) fm.firmBlockLines = lines
          }
          if (typeof config?.introductoryCounselLine === 'string') {
            fm.introductoryCounselLine = config.introductoryCounselLine
          }
          if (Array.isArray(config?.serviceRecipients)) {
            fm.recipients = config.serviceRecipients
          }
        }
      } catch { /* ignore */ }
    }
    return fm
  }, [documentIndex, firmRoot])

  const handleEnterPacketMode = useCallback(async () => {
    const fm = await createDefaultFrontMatter()
    setPacketState({
      documents: [],
      frontMatter: fm,
      piiResults: [],
      piiScanned: false,
      generatedAt: null,
      outputPath: null,
      frontMatterDocxPath: null,
      frontMatterWorkingDocxPath: null,
      frontMatterWorkingDocxMtime: null,
      draftId: null,
    })
    setPacketMode(true)
  }, [createDefaultFrontMatter])

  // Pre-build lookup map: keyed by full path and bare filename (both lowercase, with and without .pdf)
  const docLookup = useMemo(() => {
    const map = new Map<string, { file: DocumentFile; folder: string }>()
    if (!documentIndex?.folders) return map
    for (const [folder, data] of Object.entries(documentIndex.folders)) {
      for (const file of getFolderFiles(data)) {
        if (typeof file === 'string') continue
        const name = getDocumentFileName(file)
        if (!name) continue
        const normalizedName = normalizeDocumentLookupPath(name)
        const fullPath = folder === '.' || folder === '' ? normalizedName : normalizeDocumentLookupPath(`${folder}/${name}`)
        const entry = { file, folder }
        // Full path keys (highest priority — set first, never overwritten)
        if (!map.has(fullPath)) map.set(fullPath, entry)
        const noExt = fullPath.replace('.pdf', '')
        if (noExt !== fullPath && !map.has(noExt)) map.set(noExt, entry)
        // Bare filename keys (lower priority — only set if not already taken)
        if (!map.has(normalizedName)) map.set(normalizedName, entry)
        const nameNoExt = normalizedName.replace('.pdf', '')
        if (nameNoExt !== normalizedName && !map.has(nameNoExt)) map.set(nameNoExt, entry)
      }
    }
    return map
  }, [documentIndex])

  const docLookupById = useMemo(() => {
    const map = new Map<string, { file: DocumentFile; folder: string }>()
    if (!documentIndex?.folders) return map
    for (const [folder, data] of Object.entries(documentIndex.folders)) {
      for (const file of getFolderFiles(data)) {
        if (typeof file === 'string') {
          const docId = buildDocumentId(folder, file)
          map.set(docId, { file, folder })
          continue
        }
        const name = getDocumentFileName(file)
        if (!name) continue
        const docId =
          typeof file.doc_id === 'string' && file.doc_id.trim()
            ? file.doc_id.trim()
            : buildDocumentId(folder, name)
        map.set(docId, { file, folder })
      }
    }
    return map
  }, [documentIndex])

  const handleEnterPacketModeFromAgent = useCallback(async (
    proposedDocs: Array<{ docId?: string; path?: string; title?: string }>,
    frontMatter: Partial<PacketFrontMatter>
  ) => {
    const defaultFm = await createDefaultFrontMatter()
    const cleaned = Object.fromEntries(
      Object.entries(frontMatter).filter(([, v]) => v !== undefined && v !== '')
    )
    const resolvedDocs = proposedDocs.flatMap((doc) => {
      const canonicalPath =
        (doc.docId ? getCanonicalPacketPathById(doc.docId, docLookupById) : null)
        || (doc.path ? getCanonicalPacketPath(doc.path, docLookup) : null)
      if (!canonicalPath) return []
      return [{ ...doc, canonicalPath, docId: doc.docId || buildDocumentIdFromPath(canonicalPath) }]
    })

    const documents: PacketDocument[] = resolvedDocs.map((doc, i) => {
      const normalizedPath = normalizeDocumentLookupPath(doc.canonicalPath)
      const basename = normalizedPath.split('/').pop() || normalizedPath
      const entry = docLookup.get(normalizedPath) || docLookup.get(basename)
      const match = entry?.file
      const fileName = doc.canonicalPath.split('/').pop() || doc.canonicalPath
      if (match && typeof match !== 'string') {
        // Resolve the actual path from the index (folder + filename) rather than trusting the agent's path
        const actualFileName = getDocumentFileName(match) || fileName
        const resolvedPath = entry.folder && entry.folder !== '.' && entry.folder !== ''
          ? `${entry.folder}/${actualFileName}`
          : actualFileName
        const indexTitle = typeof match.title === 'string'
          ? resolvePacketTitle(match.title, '')
          : ''
        const providedTitle = resolvePacketTitle(doc.title, '')
        const title = indexTitle || providedTitle || actualFileName
        const date = typeof match.date === 'string' ? match.date : null
        const type = typeof match.type === 'string' ? match.type : ''
        const hasHandwrittenData = match.has_handwritten_data === true
        const hasHandwrittenFields = Array.isArray(match.handwritten_fields) && match.handwritten_fields.length > 0
        const extractionIssue = typeof match.issues === 'string' && match.issues.trim() ? match.issues.trim() : null
        const isUserReviewed = Boolean(match.user_reviewed)
        const needsReview = (hasHandwrittenData || hasHandwrittenFields || !!extractionIssue) && !isUserReviewed
        const hasWarning = needsReview || !date
        const warningReason = hasHandwrittenData || hasHandwrittenFields
          ? 'Handwritten data'
          : extractionIssue
            ? 'Extraction issue'
            : !date ? 'No date' : undefined
        return {
          path: resolvedPath,
          title,
          date,
          type,
          fileName: actualFileName,
          pageSelection: getDefaultPacketPageSelection(),
          pinned: false,
          order: i,
          hasWarning,
          warningReason,
        }
      }
      // Should be unreachable because unresolved docs are filtered above.
      return {
        path: doc.canonicalPath,
        title: resolvePacketTitle(doc.title, fileName),
        date: null,
        type: '',
        fileName,
        pageSelection: getDefaultPacketPageSelection(),
        pinned: false,
        order: i,
        hasWarning: true,
        warningReason: 'No date'
      }
    })
    setPacketState({
      documents,
      frontMatter: { ...defaultFm, ...cleaned },
      piiResults: [],
      piiScanned: false,
      generatedAt: null,
      outputPath: null,
      frontMatterDocxPath: null,
      frontMatterWorkingDocxPath: null,
      frontMatterWorkingDocxMtime: null,
      draftId: null,
    })
    setPacketMode(true)
  }, [createDefaultFrontMatter, docLookup, docLookupById])

  const handleEnterPacketModeFromDraft = useCallback(async (draftId: string) => {
    if (!caseFolder) return
    try {
      const res = await fetch(`${API_URL}/api/docs/packet-draft/${encodeURIComponent(draftId)}?case=${encodeURIComponent(caseFolder)}`)
      if (res.ok) {
        const draft = await res.json() as PacketState
        const canonicalDocs = (draft.documents || [])
          .map((doc, index) => {
            const derivedDocId = (doc as PacketDocument & { docId?: string }).docId
              || buildDocumentIdFromPath(doc.path)
            const canonicalPath =
              getCanonicalPacketPathById(derivedDocId, docLookupById)
              || getCanonicalPacketPath(doc.path, docLookup)
            if (!canonicalPath) return null
            return {
              ...doc,
              pageSelection: normalizePacketPageSelection((doc as PacketDocument).pageSelection),
              path: canonicalPath,
              title: resolvePacketTitle(doc.title, canonicalPath.split('/').pop() || canonicalPath),
              order: index,
            }
          })
          .filter((doc): doc is PacketDocument => Boolean(doc))

        setPacketState({
          ...draft,
          documents: canonicalDocs,
          draftId,
          frontMatterDocxPath: typeof draft.frontMatterDocxPath === 'string' ? draft.frontMatterDocxPath : null,
          frontMatterWorkingDocxPath: typeof draft.frontMatterWorkingDocxPath === 'string' ? draft.frontMatterWorkingDocxPath : null,
          frontMatterWorkingDocxMtime: typeof draft.frontMatterWorkingDocxMtime === 'number' ? draft.frontMatterWorkingDocxMtime : null,
        })
        setPacketMode(true)
      }
    } catch { /* ignore */ }
  }, [caseFolder, docLookup, docLookupById])

  const handleExitPacketMode = useCallback(() => {
    setPacketMode(false)
    setPacketState(null)
  }, [])

  const handlePacketToggleFile = useCallback((path: string, fileData: {
    title: string; date?: string; type?: string; fileName: string;
    hasWarning: boolean; warningReason?: string
  } | null) => {
    setPacketState(prev => {
      if (!prev) return prev
      const existing = prev.documents.findIndex(d => d.path === path)
      if (existing >= 0) {
        // Remove
        const docs = prev.documents.filter((_, i) => i !== existing)
          .map((d, i) => ({ ...d, order: i }))
        return { ...prev, documents: docs }
      }
      if (!fileData) return prev
      // Add - insert chronologically among unpinned docs
      const newDoc: PacketDocument = {
        path,
        title: fileData.title,
        date: fileData.date || null,
        type: fileData.type || '',
        fileName: fileData.fileName,
        pageSelection: getDefaultPacketPageSelection(),
        pinned: false,
        order: prev.documents.length,
        hasWarning: fileData.hasWarning,
        warningReason: fileData.warningReason,
      }
      const docs = [...prev.documents, newDoc].map((d, i) => ({ ...d, order: i }))
      return { ...prev, documents: docs }
    })
  }, [])

  const handlePacketUpdateState = useCallback((updater: (prev: PacketState) => PacketState) => {
    setPacketState(prev => prev ? updater(prev) : prev)
  }, [])

  const packetSelectedPaths = useMemo(() => {
    if (!packetState) return new Set<string>()
    return new Set(packetState.documents.map(d => d.path))
  }, [packetState])

  const activePacketPiiResult = useMemo<PacketPiiResult | null>(() => {
    if (!packetMode || !packetState || !selectedFilePath) return null
    const selected = normalizeDocumentLookupPath(selectedFilePath)
    return packetState.piiResults.find((result) => normalizeDocumentLookupPath(result.path) === selected) || null
  }, [packetMode, packetState, selectedFilePath])

  const handleUpdatePacketPiiResult = useCallback(
    (path: string, updater: (prev: PacketPiiResult) => PacketPiiResult) => {
      const normalizedPath = normalizeDocumentLookupPath(path)
      setPacketState((prev) => {
        if (!prev) return prev
        let updated = false
        const piiResults = prev.piiResults.map((result) => {
          if (normalizeDocumentLookupPath(result.path) !== normalizedPath) return result
          updated = true
          return updater(result)
        })
        if (!updated) return prev
        return { ...prev, piiResults }
      })
    },
    []
  )

  // Contact card state
  const [isContactCardOpen, setIsContactCardOpen] = useState(false)
  const [isNotesOpen, setIsNotesOpen] = useState(false)
  const contactButtonRef = useRef<HTMLButtonElement>(null)
  const derivedContact = useMemo(() => {
    if (documentIndex?.summary?.contact) return documentIndex.summary.contact
    if (documentIndex?.folders) return deriveContactFromFiles(documentIndex.folders)
    return undefined
  }, [documentIndex])

  // Todo drawer state (global - accessible from any view)
  const [todos, setTodos] = useState<FirmTodo[]>([])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false)
  const [hasAttemptedGenerate, setHasAttemptedGenerate] = useState(false)
  const [firmChatPrompt, setFirmChatPrompt] = useState<string>('')
  const [forceShowFirmChat, setForceShowFirmChat] = useState(false)

  // Indexing progress state — persists across navigation
  const [indexingProgress, setIndexingProgress] = useState<{
    caseFolder: string
    caseName: string
    isRunning: boolean
    status: string
    progress: string[]
    filesTotal: number
    filesComplete: number
    currentFile: string
    error: string | null
  } | null>(null)
  const [showIndexingModal, setShowIndexingModal] = useState(false)
  const indexingAbortRef = useRef<AbortController | null>(null)
  const [firmCasesVersion, setFirmCasesVersion] = useState(0)
  const [lastIndexedCasePath, setLastIndexedCasePath] = useState<string | null>(null)

  // Batch indexing state — lifted from FirmDashboard so it survives navigation
  const [batchProgress, setBatchProgress] = useState<{
    isRunning: boolean
    totalCases: number
    currentText: string
    toolsUsed: string[]
    logs: string[]
    filesTotal: number
    filesComplete: number
    currentFile: string
  } | null>(null)
  const [showBatchModal, setShowBatchModal] = useState(false)

  // Knowledge init state — shown when selecting a firm root without knowledge
  const [showKnowledgeInit, setShowKnowledgeInit] = useState(false)
  const [knowledgeTemplates, setKnowledgeTemplates] = useState<Array<{ id: string; practiceArea: string; jurisdiction: string }>>([])
  const [knowledgeInitLoading, setKnowledgeInitLoading] = useState(false)
  const [knowledgeVersion, setKnowledgeVersion] = useState(0) // Increments after init to trigger re-fetch

  const checkAuthStatus = useCallback(async (rootOverride?: string): Promise<AuthState> => {
    const rootForCheck = typeof rootOverride === 'string' ? rootOverride : firmRoot
    const endpoint = rootForCheck
      ? `${API_URL}/api/auth/status?firmRoot=${encodeURIComponent(rootForCheck)}`
      : `${API_URL}/api/auth/status`

    let nextState: AuthState = { authenticated: false }

    try {
      const res = await fetch(endpoint)
      if (res.ok) {
        nextState = await res.json() as AuthState
      }
    } catch {
      nextState = { authenticated: false }
    }

    setAuthState(nextState)
    setAuthChecked(true)
    return nextState
  }, [firmRoot])

  const loadTodos = useCallback(async () => {
    if (!firmRoot) return
    try {
      const res = await fetch(`${API_URL}/api/firm/todos?root=${encodeURIComponent(firmRoot)}`)
      if (res.status === 401) {
        setAuthState({ authenticated: false })
        return
      }
      if (res.ok) {
        const data = await res.json()
        setTodos(data.todos || [])
      }
    } catch {
      // Ignore errors loading todos
    }
  }, [firmRoot])

  // Load todos when firmRoot changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTodos()
  }, [loadTodos])

  const saveFolderPracticeArea = useCallback(async (root: string, area: PracticeArea): Promise<boolean> => {
    let existingConfig: Record<string, unknown> = {}

    try {
      const existingRes = await fetch(`${API_URL}/api/knowledge/firm-config?root=${encodeURIComponent(root)}`)
      if (existingRes.status === 401 || existingRes.status === 403) {
        if (existingRes.status === 403) {
          await checkAuthStatus(root)
        } else {
          setAuthState({ authenticated: false })
        }
        return false
      }
      if (existingRes.ok) {
        existingConfig = await existingRes.json()
      }
    } catch {
      // Continue with a minimal config payload.
    }

    try {
      const saveRes = await fetch(`${API_URL}/api/knowledge/firm-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root,
          ...existingConfig,
          practiceArea: area,
        }),
      })

      if (saveRes.status === 401 || saveRes.status === 403) {
        if (saveRes.status === 403) {
          await checkAuthStatus(root)
        } else {
          setAuthState({ authenticated: false })
        }
        return false
      }

      return saveRes.ok
    } catch {
      return false
    }
  }, [checkAuthStatus])

  const resolveFolderPracticeArea = useCallback(async (root: string): Promise<PracticeArea | null> => {
    let configArea: PracticeArea | null = null

    try {
      const configRes = await fetch(`${API_URL}/api/knowledge/firm-config?root=${encodeURIComponent(root)}`)
      if (configRes.status === 401 || configRes.status === 403) {
        if (configRes.status === 403) {
          await checkAuthStatus(root)
        } else {
          setAuthState({ authenticated: false })
        }
        return null
      }
      if (configRes.ok) {
        const config = await configRes.json()
        configArea = normalizePracticeArea(config?.practiceArea)
        if (configArea) return configArea
      }
    } catch {
      // Continue to manifest fallback.
    }

    try {
      const manifestRes = await fetch(`${API_URL}/api/knowledge/manifest?root=${encodeURIComponent(root)}`)
      if (manifestRes.status === 401 || manifestRes.status === 403) {
        if (manifestRes.status === 403) {
          await checkAuthStatus(root)
        } else {
          setAuthState({ authenticated: false })
        }
        return null
      }
      if (manifestRes.ok) {
        const manifest = await manifestRes.json()
        const manifestArea = normalizePracticeArea(manifest?.practiceArea)
        if (manifestArea) {
          if (!configArea) {
            await saveFolderPracticeArea(root, manifestArea)
          }
          return manifestArea
        }
      }
    } catch {
      // Folder has no knowledge manifest yet.
    }

    return null
  }, [checkAuthStatus, saveFolderPracticeArea])

  const loadKnowledgeTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/knowledge/templates`)
      if (res.status === 401) {
        setAuthState({ authenticated: false })
        return [] as Array<{ id: string; practiceArea: string; jurisdiction: string }>
      }
      const data = await res.json()
      return Array.isArray(data) ? data : []
    } catch {
      return [] as Array<{ id: string; practiceArea: string; jurisdiction: string }>
    }
  }, [])

  const clearCaseView = useCallback(() => {
    setCaseFolder(null)
    setDocumentIndex(null)
    setViewContent('')
    setFileViewUrl(null)
    setPacketMode(false)
    setPacketState(null)
  }, [])

  const beginFolderSetup = useCallback(async (path: string) => {
    setShowKnowledgeInit(false)
    setFolderSetupError(null)

    const status = await checkAuthStatus(path)
    if (!status.authenticated) return

    const resolved = await resolveFolderPracticeArea(path)

    // If folder already has an area configured, continue directly.
    if (resolved) {
      clearCaseView()
      setPracticeArea(resolved)
      setFirmRoot(path)
      return
    }

    // Workers' Comp only – auto-select and save without prompting.
    const area: PracticeArea = 'Workers\' Compensation'
    await saveFolderPracticeArea(path, area) // best-effort persist
    clearCaseView()
    setPracticeArea(area)
    setFirmRoot(path)
  }, [checkAuthStatus, clearCaseView, resolveFolderPracticeArea, saveFolderPracticeArea])


  const startCaseIndexing = useCallback(async (targetFolder: string, files?: string[]) => {
    // Abort any existing indexing SSE
    if (indexingAbortRef.current) {
      indexingAbortRef.current.abort()
    }
    const abort = new AbortController()
    indexingAbortRef.current = abort

    const caseName = targetFolder.split('/').pop() || targetFolder
    setIndexingProgress({
      caseFolder: targetFolder,
      caseName,
      isRunning: true,
      status: 'Initializing case...',
      progress: ['Starting indexing...'],
      filesTotal: 0,
      filesComplete: 0,
      currentFile: '',
      error: null,
    })
    setShowIndexingModal(true)

    try {
      const response = await fetch(`${API_URL}/api/claude/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder: targetFolder, ...(files ? { files } : {}) }),
        signal: abort.signal,
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:') && !line.startsWith('data: ')) continue
          const jsonStr = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
          try {
            const data = JSON.parse(jsonStr.trim())

            if (data.type === 'status') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                status: data.message || data.text || '',
                progress: [...prev.progress.slice(-50), data.message || data.text || ''],
              } : prev)
            }

            if (data.type === 'progress' || data.type === 'output') {
              const text = (data.text || '').trim()
              if (text) {
                setIndexingProgress(prev => prev ? {
                  ...prev,
                  status: text.length > 60 ? text.slice(0, 60) + '...' : text,
                  progress: [...prev.progress.slice(-50), text],
                } : prev)
              }
            }

            if (data.type === 'files_found') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                filesTotal: data.count,
                progress: [...prev.progress, `Found ${data.count} files to extract`],
              } : prev)
            }

            if (data.type === 'file_start') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                currentFile: data.filename,
              } : prev)
            }

            if (data.type === 'file_done') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                filesComplete: prev.filesComplete + 1,
                currentFile: '',
                // Fallback: set filesTotal from file_done's totalFiles if files_found was missed
                ...(prev.filesTotal === 0 && data.totalFiles ? { filesTotal: data.totalFiles } : {}),
                progress: [...prev.progress.slice(-50), `✓ ${data.filename}${data.docType ? ` (${data.docType})` : ''}`],
              } : prev)
            }

            if (data.type === 'file_error') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                filesComplete: prev.filesComplete + 1,
                progress: [...prev.progress.slice(-50), `✗ ${data.filename}: ${data.error}`],
              } : prev)
            }

            if (data.type === 'done' || data.type === 'case_done') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                isRunning: false,
                status: 'Complete',
                progress: [...prev.progress, 'Indexing complete!'],
              } : prev)
              // Auto-reopen modal so user sees completion
              setShowIndexingModal(true)
              // Refresh dashboard — use incremental single-case refresh
              setLastIndexedCasePath(targetFolder)
              setFirmCasesVersion(v => v + 1)
            }

            if (data.type === 'error') {
              setIndexingProgress(prev => prev ? {
                ...prev,
                isRunning: false,
                error: data.error || 'Unknown error',
                progress: [...prev.progress, `Error: ${data.error || 'Unknown error'}`],
              } : prev)
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Reload case data if user is currently viewing this case
      if (caseFolderRef.current === targetFolder) {
        try {
          const res = await fetch(`${API_URL}/api/files/index?case=${encodeURIComponent(targetFolder)}`)
          if (res.ok) {
            const index = await res.json()
            setDocumentIndex(index)
            loadGeneratedDocs(targetFolder)
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setIndexingProgress(prev => prev ? {
        ...prev,
        isRunning: false,
        error: err instanceof Error ? err.message : 'Failed to initialize case',
      } : prev)
    }
  }, [])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const newCase = getUrlParam('case')
      setCaseFolderState(newCase)
      if (!newCase) {
        // Going back to dashboard - clear case state
        setDocumentIndex(null)
        setViewContent('')
        setFileViewUrl(null)
        setIsLoading(false)
      } else {
        // Going to a different case - clear state so it reloads
        setDocumentIndex(null)
        setIsLoading(false)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Load case data when caseFolder is set but documentIndex is not loaded
  // This handles both: 1) initial load from URL, and 2) popstate navigation
  useEffect(() => {
    const loadCaseData = async () => {
      if (!caseFolder || documentIndex || isLoading) return

      // Try to load existing index
      try {
        const res = await fetch(`${API_URL}/api/files/index?case=${encodeURIComponent(caseFolder)}`)
        if (res.ok) {
          const index = await res.json()
          setDocumentIndex(index)
          // Load generated docs
          try {
            const docsRes = await fetch(`${API_URL}/api/docs/list?case=${encodeURIComponent(caseFolder)}`)
            if (docsRes.ok) {
              const data = await docsRes.json() as { docs?: GeneratedDoc[] }
              setGeneratedDocs(data.docs || [])
            }
          } catch {
            // Ignore
          }
          return
        }
      } catch {
        // No index exists
      }

      // No index - start background indexing and go back to dashboard
      startCaseIndexing(caseFolder)
      setCaseFolder(null)
    }

    loadCaseData()
  }, [caseFolder, documentIndex, isLoading, startCaseIndexing])

  const handleToggleTodo = async (id: string) => {
    const updatedTodos = todos.map(t =>
      t.id === id ? { ...t, status: t.status === 'pending' ? 'completed' as const : 'pending' as const } : t
    )
    setTodos(updatedTodos)

    if (!firmRoot) return
    try {
      await fetch(`${API_URL}/api/firm/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, todos: updatedTodos }),
      })
    } catch {
      setTodos(todos) // Revert on error
    }
  }

  const handleClearCompleted = async () => {
    const pendingTodos = todos.filter(t => t.status === 'pending')
    setTodos(pendingTodos)

    if (!firmRoot) return
    try {
      await fetch(`${API_URL}/api/firm/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, todos: pendingTodos }),
      })
    } catch {
      setTodos(todos) // Revert on error
    }
  }

  const handleTodosUpdated = (newTodos: FirmTodo[]) => {
    setTodos(newTodos)
    setIsDrawerOpen(true)
    setIsGeneratingTasks(false)
    setHasAttemptedGenerate(true)
  }

  const handleGenerateTasks = () => {
    // If in case view, go back to dashboard
    if (caseFolder) {
      setCaseFolder(null)
      setDocumentIndex(null)
      setViewContent('')
      setFileViewUrl(null)
    }
    // Set up to show Firm Chat with the generate tasks prompt
    setIsGeneratingTasks(true)
    setForceShowFirmChat(true)
    setFirmChatPrompt('Generate a prioritized task list based on case deadlines and status')
    setIsDrawerOpen(false) // Close drawer while generating
  }

  const handleFirmChatPromptUsed = () => {
    setFirmChatPrompt('')
    setForceShowFirmChat(false)
  }

  const handleKnowledgeInit = useCallback(async (templateId: string, rootOverride?: string): Promise<boolean> => {
    const targetRoot = rootOverride || firmRoot
    if (!targetRoot) return false

    setKnowledgeInitLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/knowledge/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: targetRoot, templateId }),
      })
      if (res.status === 401) {
        setAuthState({ authenticated: false })
        return false
      }
      if (!res.ok) return false

      const data = await res.json()
      const initializedArea = normalizePracticeArea(data?.practiceArea)
      if (initializedArea) {
        setPracticeArea(initializedArea)
        await saveFolderPracticeArea(targetRoot, initializedArea)
      }

      setShowKnowledgeInit(false)
      setKnowledgeVersion(v => v + 1) // Trigger FirmDashboard to re-fetch knowledge
      return true
    } catch {
      return false
    } finally {
      setKnowledgeInitLoading(false)
    }
  }, [firmRoot, saveFolderPracticeArea])

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus()
  }, [checkAuthStatus])

  // Background auth checks to ensure reauth flow is triggered before stale sessions break the app
  useEffect(() => {
    if (DEV_MODE) return

    const interval = window.setInterval(() => {
      checkAuthStatus()
    }, 5 * 60 * 1000)

    const onFocus = () => {
      checkAuthStatus()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [checkAuthStatus])

  // Sync folder-scoped practice area and ensure knowledge context matches it.
  useEffect(() => {
    if (!firmRoot) return

    let cancelled = false
    localStorage.setItem(FIRM_ROOT_KEY, firmRoot)
    checkAuthStatus()

    const syncFolderContext = async () => {
      const detectedArea = await resolveFolderPracticeArea(firmRoot)
      if (cancelled) return

      let effectiveArea = detectedArea
      if (!effectiveArea) {
        // Workers' Comp only – auto-save without prompting.
        const area: PracticeArea = 'Workers\' Compensation'
        const saved = await saveFolderPracticeArea(firmRoot, area)
        if (cancelled) return
        if (!saved) {
          // Don't nuke firmRoot here — beginFolderSetup may have already
          // succeeded.  Just default the area so the dashboard can load.
          console.warn('[syncFolderContext] Could not persist practice area; defaulting to Workers\' Comp')
        }
        effectiveArea = area
      }

      setPracticeArea(effectiveArea)
      setFolderSetupError(null)

      try {
        const manifestRes = await fetch(`${API_URL}/api/knowledge/manifest?root=${encodeURIComponent(firmRoot)}`)
        if (cancelled) return
        if (manifestRes.status === 401) {
          setAuthState({ authenticated: false })
          return
        }
        if (manifestRes.ok) {
          const manifest = await manifestRes.json()
          const manifestArea = normalizePracticeArea(manifest?.practiceArea)
          if (manifestArea && manifestArea !== effectiveArea) {
            const templates = await loadKnowledgeTemplates()
            if (cancelled) return
            setKnowledgeTemplates(templates)

            const matchingTemplate = templates.find((template) => {
              return normalizePracticeArea(template.practiceArea) === effectiveArea
            })

            if (matchingTemplate) {
              const initialized = await handleKnowledgeInit(matchingTemplate.id, firmRoot)
              if (cancelled) return
              if (!initialized) {
                setShowKnowledgeInit(templates.length > 0)
              }
            } else {
              setShowKnowledgeInit(templates.length > 0)
            }
            return
          }
          setShowKnowledgeInit(false)
          return
        }
      } catch {
        // Continue to template initialization.
      }

      const templates = await loadKnowledgeTemplates()
      if (cancelled) return
      setKnowledgeTemplates(templates)

      const matchingTemplate = templates.find((template) => {
        return normalizePracticeArea(template.practiceArea) === effectiveArea
      })

      if (matchingTemplate) {
        const initialized = await handleKnowledgeInit(matchingTemplate.id, firmRoot)
        if (cancelled) return
        if (!initialized) {
          setShowKnowledgeInit(templates.length > 0)
        }
        return
      }

      setShowKnowledgeInit(templates.length > 0)
    }

    syncFolderContext()

    return () => {
      cancelled = true
    }
  }, [
    checkAuthStatus,
    firmRoot,
    handleKnowledgeInit,
    loadKnowledgeTemplates,
    resolveFolderPracticeArea,
    saveFolderPracticeArea,
  ])

  // Pre-build lookup map: keyed by full path and bare filename (both lowercase, with and without .pdf)
  const buildDocSummaryContent = useCallback((filePath: string): string | null => {
    const entry = docLookup.get(filePath.toLowerCase())
    const match = entry?.file
    if (!match || typeof match === 'string') return null

    const fileName = getDocumentFileName(match) || filePath.split('/').pop() || filePath
    const title = typeof match.title === 'string' ? match.title : fileName
    const date = typeof match.date === 'string' ? match.date : ''
    const keyInfo = typeof match.key_info === 'string' ? match.key_info : 'No details extracted'
    const issues = typeof match.issues === 'string' ? match.issues : ''
    const hasHandwrittenData = match.has_handwritten_data === true
    const handwrittenFields = Array.isArray(match.handwritten_fields)
      ? (match.handwritten_fields as string[]).filter(f => typeof f === 'string' && f.trim() !== '')
      : []
    const isUserReviewed = Boolean(match.user_reviewed)
    const reviewedAt = typeof match.reviewed_at === 'string' ? match.reviewed_at.trim() : ''
    const reviewNotes = typeof match.review_notes === 'string' ? match.review_notes.trim() : ''

    const handwrittenWarning = hasHandwrittenData
      ? `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <span class="font-medium">⚠️ Handwritten Data Detected:</span> Verify extracted values from this document.
          ${handwrittenFields.length > 0 ? `<div class="mt-2 text-xs">Handwritten fields: ${handwrittenFields.join(', ')}</div>` : ''}
        </div>`
      : ''
    const reviewedBlock = isUserReviewed
      ? `<div class="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
          <span class="font-medium">✅ User Reviewed</span>
          ${reviewedAt ? `<div class="mt-2 text-xs">Reviewed at: ${reviewedAt}</div>` : ''}
          ${reviewNotes ? `<div class="mt-2 text-xs">${reviewNotes}</div>` : ''}
        </div>`
      : ''

    return `
<div class="p-6">
  <h2 class="text-lg font-semibold text-gray-900 mb-1">${title}</h2>
  <p class="text-sm text-gray-500 mb-4">${fileName}</p>
  ${date ? `<div class="text-sm mb-3"><span class="font-medium text-gray-700">Date:</span> <span class="text-gray-600">${date}</span></div>` : ''}
  <div class="bg-gray-50 rounded-xl p-4">
    <p class="text-sm font-medium text-gray-900 mb-2">Key Information</p>
    <p class="text-sm text-gray-600 leading-relaxed">${keyInfo}</p>
  </div>
  ${issues ? `<div class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><span class="font-medium">Issue:</span> ${issues}</div>` : ''}
  ${handwrittenWarning}
  ${reviewedBlock}
</div>`
  }, [docLookup])

  const handleShowFile = useCallback((filePath: string, mode: 'summary' | 'document' = 'summary') => {
    if (!caseFolder) return
    const normalizedPath = normalizeDocumentLookupPath(filePath)
    const basename = normalizedPath.split('/').pop() || normalizedPath
    const entry = docLookup.get(normalizedPath) || docLookup.get(basename)
    let resolvedPath = filePath
    if (entry) {
      const matchName = getDocumentFileName(entry.file)
      if (matchName) {
        const folder = entry.folder
        resolvedPath = folder === '.' || folder === '' ? matchName : `${folder}/${matchName}`
      }
    }

    const url = `${API_URL}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(resolvedPath)}`
    setFileViewUrl(url)
    setFileViewName(resolvedPath.split('/').pop() || resolvedPath)
    setSelectedFilePath(resolvedPath)
    const summary = buildDocSummaryContent(resolvedPath)
    setViewContent(summary || '')
    setVisualizerMode(mode)
  }, [caseFolder, docLookup, buildDocSummaryContent])

  const handleShowPacketFile = useCallback((filePath: string) => {
    handleShowFile(filePath, 'document')
  }, [handleShowFile])

  const handleEvidencePacketGenerated = useCallback((filePath: string) => {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) return
    handleShowFile(normalizedPath, 'document')
    setEvidencePacketTakeover({
      path: normalizedPath,
      version: Date.now(),
    })
  }, [handleShowFile])

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST' })
    } catch {
      // Ignore errors
    }
    setAuthState({ authenticated: false })
    setCaseFolder(null)
    setDocumentIndex(null)
    setPracticeArea(null)
    setFolderSetupError(null)
    localStorage.removeItem(FIRM_ROOT_KEY)
  }

  // Handle login success
  const handleLoginSuccess = (email: string, subscriptionStatus: string) => {
    // Preserve saved firm root across logins — user can switch via "Change Folder"
    const savedRoot = localStorage.getItem(FIRM_ROOT_KEY)
    setCaseFolder(null)
    setDocumentIndex(null)
    setFolderSetupError(null)
    if (!savedRoot) {
      setFirmRoot(null)
      setPracticeArea(null)
    }
    setAuthState({
      authenticated: true,
      email,
      subscriptionStatus,
    })
    checkAuthStatus()
  }

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="animate-pulse text-brand-400">Loading...</div>
      </div>
    )
  }

  // Show login screen if not authenticated
  if (!authState || !authState.authenticated) {
    const setupError =
      authState?.teamError === 'invite_required'
        ? 'Your email does not have an active invite for this firm.'
        : authState?.teamError === 'firm_not_bootstrapped'
          ? 'This firm is not initialized yet. Sign in with the first approved attorney account to bootstrap it.'
          : undefined
    return <Login apiUrl={API_URL} onLoginSuccess={handleLoginSuccess} initialError={setupError} firmRoot={firmRoot} />
  }

  const handleCaseSelect = (folder: string) => {
    // Just set the folder - the useEffect will handle loading the case data
    setCaseFolder(folder)
  }

  const loadGeneratedDocs = async (folder: string) => {
    try {
      const res = await fetch(`${API_URL}/api/docs/list?case=${encodeURIComponent(folder)}`)
      if (res.ok) {
        const data = await res.json() as { docs?: GeneratedDoc[] }
        setGeneratedDocs(data.docs || [])
      }
    } catch {
      // Ignore
    }
  }

  const reloadDocumentIndex = async () => {
    if (!caseFolder) return
    try {
      const res = await fetch(`${API_URL}/api/files/index?case=${encodeURIComponent(caseFolder)}`)
      if (res.ok) {
        const index = await res.json()
        setDocumentIndex(index)
      }
    } catch {
      // Ignore
    }
  }

  const handleViewUpdate = (content: string, docPath?: string) => {
    setViewContent(content)
    setViewDocPath(docPath || null)
  }

  // Initial screen - select firm root folder
  if (!firmRoot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="bg-white rounded-2xl shadow-elevated p-10 max-w-md w-full border border-surface-200">
          {/* Logo/Brand */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-brand-900 flex items-center justify-center text-white">
              <ScaleIcon />
            </div>
            <h1 className="font-serif text-3xl text-brand-900">Jason AI</h1>
          </div>
          <p className="text-brand-500 mb-8">Legal Case Management</p>

          <button
            onClick={() => setShowPicker(true)}
            className="w-full px-6 py-6 border-2 border-dashed border-surface-300 rounded-xl
                       hover:border-accent-500 hover:bg-accent-50 transition-all group"
          >
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full
                              bg-surface-100 text-brand-400 group-hover:bg-accent-100
                              group-hover:text-accent-600 transition-colors mb-3">
                <FolderIcon />
              </div>
              <p className="text-base font-medium text-brand-700 group-hover:text-brand-900">
                Select Cases Folder
              </p>
              <p className="mt-1 text-sm text-brand-400">
                Choose the folder containing all your case files first
              </p>
            </div>
          </button>

          {folderSetupError && (
            <p className="mt-4 text-xs text-red-700 text-center">{folderSetupError}</p>
          )}

          <p className="text-xs text-brand-400 text-center mt-6">
            Your cases are stored locally and never uploaded
          </p>
        </div>

        {showPicker && (
          <FolderPicker
            apiUrl={API_URL}
            onSelect={(path) => {
              setShowPicker(false)
              beginFolderSetup(path)
            }}
            onCancel={() => setShowPicker(false)}
          />
        )}

        {showKnowledgeInit && <KnowledgeInitModal />}
      </div>
    )
  }

  // Firm dashboard - show all cases
  if (!caseFolder) {
    if (!practiceArea) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-50">
          <div className="animate-pulse text-brand-400">Loading folder settings...</div>
        </div>
      )
    }

    return (
      <>
        <FirmDashboard
          apiUrl={API_URL}
          firmRoot={firmRoot}
          practiceArea={practiceArea}
          onSelectCase={(path) => handleCaseSelect(path)}
          onChangeFirmRoot={() => setShowPicker(true)}
          userEmail={authState?.email}
          onLogout={handleLogout}
          todos={todos}
          onDrawerOpen={() => setIsDrawerOpen(true)}
          onTodosUpdated={handleTodosUpdated}
          firmChatPrompt={firmChatPrompt}
          forceShowFirmChat={forceShowFirmChat}
          onFirmChatPromptUsed={handleFirmChatPromptUsed}
          knowledgeVersion={knowledgeVersion}
          teamContext={authState?.team}
          indexingProgress={indexingProgress}
          firmCasesVersion={firmCasesVersion}
          lastIndexedCasePath={lastIndexedCasePath}
          batchProgress={batchProgress}
          showBatchModal={showBatchModal}
          onBatchProgressChange={setBatchProgress}
          onShowBatchModalChange={setShowBatchModal}
          onBatchComplete={() => { setLastIndexedCasePath(null); setFirmCasesVersion(v => v + 1) }}
        />
        {showPicker && (
          <FolderPicker
            apiUrl={API_URL}
            onSelect={(path) => {
              setShowPicker(false)
              beginFolderSetup(path)
            }}
            onCancel={() => setShowPicker(false)}
          />
        )}
        <TodoDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          todos={todos}
          onToggleTodo={handleToggleTodo}
          onClearCompleted={handleClearCompleted}
          onGenerateTasks={handleGenerateTasks}
          isGenerating={isGeneratingTasks}
          hasAttemptedGenerate={hasAttemptedGenerate}
        />

        {showKnowledgeInit && <KnowledgeInitModal />}
        <IndexingUI />
      </>
    )
  }

  // Main three-panel layout
  return (
    <div className="h-screen flex flex-col bg-surface-50">
      {/* Header */}
      <header className="relative z-20 bg-brand-900/95 text-white px-6 py-4 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
              <ScaleIcon />
            </div>
            <div>
              <h1 className="font-serif text-xl tracking-tight">
                {documentIndex?.summary?.client || documentIndex?.case_name || caseFolder?.split('/').pop() || 'Case'}
              </h1>
              <div className="flex items-center gap-3 text-sm text-brand-300">
                <span>{documentIndex?.practice_area === "Workers' Compensation" ? 'DOI' : 'DOL'}: {documentIndex?.summary?.incident_date || documentIndex?.summary?.dol || '—'}</span>
                <span className="text-brand-500">•</span>
                {documentIndex?.practice_area === "Workers' Compensation" ? (
                  <span className="text-accent-400 font-medium">
                    {documentIndex?.summary?.disability_status?.type || '—'}
                  </span>
                ) : (
                  <span className="text-accent-400 font-medium">
                    {documentIndex?.summary?.total_charges || '—'} in specials
                  </span>
                )}
              </div>
            </div>
            {/* Packet Creation button - WC only */}
            {practiceArea === 'Workers\' Compensation' && documentIndex && (
              packetMode ? (
                <button
                  onClick={handleExitPacketMode}
                  className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
                             bg-accent-600 text-white hover:bg-accent-700 transition-colors ml-3"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Exit Packet Mode</span>
                </button>
              ) : (
                <button
                  onClick={handleEnterPacketMode}
                  className="flex items-center gap-2 text-sm text-brand-200 hover:text-white
                             transition-colors px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 ml-3"
                  title="Build Evidence Packet"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span>Packet</span>
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Review Items button - highlighted when there are items */}
            {documentIndex?.needs_review && documentIndex.needs_review.length > 0 && (
              <button
                onClick={async () => {
                  // Clear session first to prevent context overflow
                  try {
                    await fetch(`${API_URL}/api/claude/clear-session`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ caseFolder }),
                    })
                  } catch {
                    // Ignore clear errors
                  }

                  // Prompt that triggers batch conflict review
                  const count = documentIndex.needs_review?.length || 0
                  setReviewPrompt(`Review the ${count} document conflicts. Analyze them, make recommendations for the easy ones, and present them in batches for my approval.`)
                }}
                className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
                           bg-red-600 text-white hover:bg-red-700 transition-colors
                           ring-1 ring-red-300/30 shadow-card"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <span>Review Items</span>
                <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">
                  {documentIndex.needs_review.length}
                </span>
              </button>
            )}
            {/* Contact Card button */}
            <div className="relative">
              <button
                ref={contactButtonRef}
                onClick={() => setIsContactCardOpen(!isContactCardOpen)}
                className="flex items-center gap-2 text-sm text-brand-200 hover:text-white
                           transition-colors px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10"
                title="Client Contact Info"
              >
                <UserCircleIcon />
                <span>Contact</span>
              </button>
              <ContactCard
                isOpen={isContactCardOpen}
                onClose={() => setIsContactCardOpen(false)}
                anchorRef={contactButtonRef}
                clientName={documentIndex?.summary?.client}
                dob={documentIndex?.summary?.dob}
                contact={derivedContact}
                policyLimits={documentIndex?.summary?.policy_limits as Record<string, string> | string | undefined}
                healthInsurance={documentIndex?.summary?.health_insurance}
                claimNumbers={documentIndex?.summary?.claim_numbers}
                practiceArea={documentIndex?.practice_area}
                employer={documentIndex?.summary?.employer}
                wcCarrier={documentIndex?.summary?.wc_carrier}
                disabilityStatus={documentIndex?.summary?.disability_status}
                jobTitle={documentIndex?.summary?.job_title}
                bodyParts={documentIndex?.summary?.body_parts}
                caseFolder={caseFolder}
                onIndexUpdated={reloadDocumentIndex}
              />
            </div>
            {/* Notes button */}
            <button
              onClick={() => setIsNotesOpen(true)}
              className="flex items-center gap-2 text-sm text-brand-200 hover:text-white
                         transition-colors px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10"
              title="Case Notes"
            >
              <NotepadIcon />
              <span>Notes</span>
            </button>
            {/* Tasks button */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="relative flex items-center gap-2 text-sm text-brand-200 hover:text-white
                         transition-colors px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10"
              title="View Tasks"
            >
              <ClipboardListIcon />
              <span>Tasks</span>
              {todos.filter(t => t.status === 'pending').length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-semibold
                               bg-accent-500 text-white rounded-full flex items-center justify-center">
                  {todos.filter(t => t.status === 'pending').length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setCaseFolder(null)
                setDocumentIndex(null)
                setViewContent('')
                setFileViewUrl(null)
              }}
              className="flex items-center gap-2 text-sm text-brand-200 hover:text-white
                         transition-colors px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10"
            >
              <ArrowLeftIcon />
              <span>Dashboard</span>
            </button>
            {authState?.email && (
              <div className="flex items-center gap-3 border-l border-brand-700 pl-4">
                <span className="text-sm text-brand-300">{authState.email}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-brand-400 hover:text-white transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <ResizablePanelLayout
        leftLabel="Files"
        rightLabel="Preview"
        leftPanel={
          <FileViewer
            documentIndex={documentIndex}
            generatedDocs={generatedDocs}
            caseFolder={caseFolder}
            apiUrl={API_URL}
            packetMode={packetMode}
            packetSelectedPaths={packetSelectedPaths}
            onPacketToggleFile={handlePacketToggleFile}
            onDocSelect={(doc, docPath, filePath) => {
              handleViewUpdate(doc, docPath)
              setSelectedFilePath(filePath || null)
              // Also compute file URL so we can toggle to document view
              if (filePath) {
                const url = `${API_URL}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(filePath)}`
                setFileViewUrl(url)
                setFileViewName(filePath.split('/').pop() || filePath)
              } else {
                setFileViewUrl(null)
              }
              setVisualizerMode('document')
            }}
            onFileView={(url, filename, filePath) => {
              setFileViewUrl(url)
              setFileViewName(filename)
              setSelectedFilePath(filePath)
              const summary = buildDocSummaryContent(filePath)
              if (summary) setViewContent(summary)
              setVisualizerMode('document')
            }}
            indexStatus={indexStatusForViewer}
            agentView={agentDocumentView}
            onClearAgentView={() => setAgentDocumentView(null)}
            savedAgentViews={savedAgentViews}
            activeAgentViewId={agentDocumentView?.id || null}
            onApplyAgentView={handleApplySavedAgentView}
            onClearSavedAgentViews={handleClearSavedAgentViews}
          />
        }
        centerPanel={
              packetMode && packetState ? (
            <PacketCreation
              packetState={packetState}
              onUpdateState={handlePacketUpdateState}
              caseFolder={caseFolder}
              apiUrl={API_URL}
              firmRoot={firmRoot || undefined}
              onShowFile={handleShowFile}
              onShowPiiFile={handleShowPacketFile}
              onPiiTabActiveChange={setPacketPiiTabActive}
              onExit={handleExitPacketMode}
              onGenerated={(outputPath) => {
                handleShowPacketFile(outputPath)
                setEvidencePacketTakeover({ path: outputPath, version: Date.now() })
                setRefreshDraftsKey(k => k + 1)
              }}
              onPreviewReady={(blobUrl) => {
                setFileViewUrl(blobUrl)
                setFileViewName('Front Matter Preview.pdf')
                setSelectedFilePath(null)
                setViewContent('')
                setVisualizerMode('document')
              }}
            />
          ) : (
            <div className="relative h-full">
              <Chat
                caseFolder={caseFolder}
                apiUrl={API_URL}
                onViewUpdate={handleViewUpdate}
                initialPrompt={reviewPrompt}
                onInitialPromptUsed={() => setReviewPrompt('')}
                onIndexMayHaveChanged={reloadDocumentIndex}
                onDraftsMayHaveChanged={() => setRefreshDraftsKey(k => k + 1)}
                onEvidencePacketGenerated={handleEvidencePacketGenerated}
                onShowFile={handleShowFile}
                onDocumentView={handleDocumentView}
                onIndexStatusChange={setIndexStatusForViewer}
                onStartReindex={(forceFullReindex) => {
                  if (forceFullReindex) {
                    startCaseIndexing(caseFolder)
                  } else {
                    // Check for changed files first, then start indexing only those
                    fetch(`${API_URL}/api/files/index-status?case=${encodeURIComponent(caseFolder)}`)
                      .then(res => res.json())
                      .then(status => {
                        if (!status.needsIndex) return
                        const changedFiles = [...(status.newFiles || []), ...(status.modifiedFiles || [])]
                        if (changedFiles.length > 0 && status.reason !== 'no_index') {
                          startCaseIndexing(caseFolder, changedFiles)
                        } else {
                          startCaseIndexing(caseFolder)
                        }
                      })
                      .catch(() => startCaseIndexing(caseFolder))
                  }
                }}
                isReindexing={indexingProgress?.isRunning && indexingProgress?.caseFolder === caseFolder}
                onEvidencePacketPlanned={(data) => {
                  void handleEnterPacketModeFromAgent(data.documents, data.frontMatter).catch((error) => {
                    console.error("Failed to enter packet mode from agent plan", error)
                  })
                }}
              />
            </div>
          )
        }
        rightPanel={
          <Visualizer
            content={viewContent}
            docPath={viewDocPath}
            fileUrl={fileViewUrl}
            fileName={fileViewName}
            filePath={selectedFilePath}
            caseFolder={caseFolder}
            apiUrl={API_URL}
            documentIndex={documentIndex}
            firmRoot={firmRoot || undefined}
            onCloseFile={() => {
              setFileViewUrl(null)
              setSelectedFilePath(null)
              setViewContent('')
              setVisualizerMode('summary')
            }}
            onIndexUpdated={reloadDocumentIndex}
            onDraftsUpdated={() => loadGeneratedDocs(caseFolder)}
            refreshDraftsKey={refreshDraftsKey}
            viewMode={visualizerMode}
            onToggleViewMode={() => setVisualizerMode(m => m === 'summary' ? 'document' : 'summary')}
            hasFile={!!selectedFilePath}
            hasSummary={!!viewContent}
            evidencePacketPath={evidencePacketTakeover?.path || null}
            evidencePacketVersion={evidencePacketTakeover?.version || 0}
            onOpenFilePath={handleShowFile}
            onOpenPacketDraft={handleEnterPacketModeFromDraft}
            packetPiiActive={packetMode && packetPiiTabActive}
            packetPiiResult={activePacketPiiResult}
            onPacketPiiResultUpdate={handleUpdatePacketPiiResult}
          />
        }
      />

      {/* Global Todo drawer */}
      <TodoDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        todos={todos}
        onToggleTodo={handleToggleTodo}
        onClearCompleted={handleClearCompleted}
        onGenerateTasks={handleGenerateTasks}
        isGenerating={isGeneratingTasks}
        hasAttemptedGenerate={hasAttemptedGenerate}
      />

      {/* User Notes modal */}
      {caseFolder && (
        <UserNotes
          isOpen={isNotesOpen}
          onClose={() => setIsNotesOpen(false)}
          caseFolder={caseFolder}
          apiUrl={API_URL}
        />
      )}

      {/* Knowledge init modal — shown when firm root has no knowledge base */}
      {showKnowledgeInit && <KnowledgeInitModal />}
      <IndexingUI />
    </div>
  )

  function IndexingUI() {
    // Batch indexing floating pill — shown when batch is running and modal is hidden
    // (rendered here in App.tsx so it survives navigation away from the dashboard)
    const batchPill = batchProgress?.isRunning && !showBatchModal ? (
      <div
        onClick={() => {
          // Navigate back to dashboard and open the modal
          if (caseFolder) {
            setCaseFolder(null)
            setDocumentIndex(null)
            setViewContent('')
            setFileViewUrl(null)
          }
          setShowBatchModal(true)
        }}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-brand-900 text-white
                   rounded-full shadow-elevated cursor-pointer hover:bg-brand-800 transition-colors"
      >
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        <span className="text-sm font-medium">
          Indexing {batchProgress.totalCases} case{batchProgress.totalCases !== 1 ? 's' : ''}
        </span>
        {batchProgress.filesTotal > 0 && (
          <span className="text-xs text-brand-300">
            {batchProgress.filesComplete}/{batchProgress.filesTotal} files
          </span>
        )}
      </div>
    ) : null

    if (!indexingProgress) return batchPill

    const pct = indexingProgress.filesTotal > 0
      ? Math.round((indexingProgress.filesComplete / indexingProgress.filesTotal) * 100)
      : 0

    // Floating pill — shown when running and modal is hidden
    if (indexingProgress.isRunning && !showIndexingModal) {
      return (
        <>
          <div
            onClick={() => setShowIndexingModal(true)}
            className={`fixed ${batchPill ? 'bottom-20' : 'bottom-6'} right-6 z-50 flex items-center gap-3 px-4 py-3 bg-brand-900 text-white
                       rounded-full shadow-elevated cursor-pointer hover:bg-brand-800 transition-colors`}
          >
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-medium truncate max-w-48">{indexingProgress.caseName}</span>
            {indexingProgress.filesTotal > 0 && (
              <span className="text-xs text-brand-300">
                {indexingProgress.filesComplete}/{indexingProgress.filesTotal} files
              </span>
            )}
          </div>
          {batchPill}
        </>
      )
    }

    // Modal — shown when showIndexingModal is true
    if (!showIndexingModal) return batchPill

    return (
      <div
        className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={() => { if (indexingProgress.isRunning) setShowIndexingModal(false) }}
      >
        <div
          className="bg-white rounded-2xl shadow-elevated w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-surface-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-900 flex items-center justify-center text-white">
                  <ScaleIcon />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-brand-900">
                    {indexingProgress.isRunning ? 'Indexing Case...' : indexingProgress.error ? 'Indexing Error' : 'Indexing Complete'}
                  </h2>
                  <p className="text-sm text-brand-500 mt-0.5 truncate max-w-md" title={indexingProgress.caseFolder}>
                    {indexingProgress.caseName}
                    {indexingProgress.filesTotal > 0 && ` — ${indexingProgress.filesComplete}/${indexingProgress.filesTotal} files`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIndexingModal(false)}
                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Progress bar */}
            {indexingProgress.filesTotal > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-brand-500 mb-1.5">
                  <span className="truncate mr-4">
                    {indexingProgress.currentFile || (indexingProgress.isRunning ? indexingProgress.status : 'Complete')}
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 bg-surface-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      indexingProgress.error ? 'bg-red-500' : 'bg-accent-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
            {indexingProgress.filesTotal === 0 && indexingProgress.isRunning && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-brand-500 mb-1.5">
                  <span>{indexingProgress.status}</span>
                </div>
                <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-accent-500 to-accent-600 rounded-full w-full animate-pulse" />
                </div>
              </div>
            )}
          </div>

          {/* Error display */}
          {indexingProgress.error && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-800 text-sm font-medium">Error</p>
              <p className="text-red-700 text-sm mt-1">{indexingProgress.error}</p>
              <button
                onClick={() => startCaseIndexing(indexingProgress.caseFolder)}
                className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium
                           hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Terminal log */}
          <div className="flex-1 overflow-auto p-4 bg-brand-950 font-mono text-xs">
            {indexingProgress.progress.map((line, i) => {
              const isCheck = line.startsWith('✓')
              const isError = line.startsWith('✗') || line.startsWith('Error:')
              return (
                <div key={i} className={`py-0.5 ${isError ? 'text-red-400' : isCheck ? 'text-emerald-400' : 'text-brand-300'}`}>
                  <span className="text-brand-600 mr-2 select-none">$</span>
                  {line}
                </div>
              )
            })}
            {indexingProgress.isRunning && (
              <div className="text-emerald-400 py-0.5">
                <span className="text-brand-600 mr-2 select-none">$</span>
                {indexingProgress.currentFile || indexingProgress.status || 'Working...'}
                <span className="ml-1 animate-pulse">_</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-surface-200 flex justify-end gap-3 bg-surface-50">
            {indexingProgress.isRunning ? (
              <>
                <div className="flex items-center gap-3 text-sm text-brand-600 mr-auto">
                  <div className="w-4 h-4 border-2 border-accent-600 border-t-transparent rounded-full animate-spin" />
                  Processing...
                </div>
                <button
                  onClick={() => setShowIndexingModal(false)}
                  className="px-4 py-2 text-sm text-brand-500 hover:text-brand-700 transition-colors"
                >
                  Minimize
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setIndexingProgress(null)
                  setShowIndexingModal(false)
                }}
                className="px-5 py-2.5 bg-brand-900 text-white rounded-lg hover:bg-brand-800 font-medium transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  function KnowledgeInitModal() {
    const templates = Array.isArray(knowledgeTemplates) ? knowledgeTemplates : []
    const matchingTemplates = practiceArea
      ? templates.filter((template) => normalizePracticeArea(template.practiceArea) === practiceArea)
      : templates
    const templatesToShow = matchingTemplates.length > 0 ? matchingTemplates : templates

    return (
      <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-elevated w-full max-w-md p-6">
          <h2 className="text-lg font-semibold text-brand-900 mb-2">Set Up Practice Knowledge</h2>
          <p className="text-sm text-brand-500 mb-5">
            Initialize the knowledge base for this folder. You can customize sections after setup.
          </p>
          <div className="space-y-3">
            {templatesToShow.map(t => (
              <button
                key={t.id}
                onClick={() => handleKnowledgeInit(t.id)}
                disabled={knowledgeInitLoading}
                className="w-full text-left p-4 border border-surface-200 rounded-xl hover:border-accent-300
                           hover:bg-accent-50 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-brand-900">{t.practiceArea}</div>
                <div className="text-xs text-brand-400 mt-0.5">{t.jurisdiction}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-5">
            <button
              onClick={() => setShowKnowledgeInit(false)}
              className="px-4 py-2 text-sm text-brand-500 hover:text-brand-700 transition-colors"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default App
