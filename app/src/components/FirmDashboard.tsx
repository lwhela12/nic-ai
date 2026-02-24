import { useState, useEffect, useCallback, useMemo, useRef, type SetStateAction, type Dispatch } from 'react'
import FirmChat from './FirmChat'
import KnowledgeEditor from './KnowledgeEditor'
import KnowledgeChat from './KnowledgeChat'
import TemplateManager from './TemplateManager'
import TeamManager from './TeamManager'
import CaseAssignmentDropdown from './CaseAssignmentDropdown'
import { formatDateMMDDYYYY } from '../utils/dateFormat'

// URL param helpers for persisting view state across refreshes
const getUrlParam = (key: string): string | null => {
  const params = new URLSearchParams(window.location.search)
  return params.get(key)
}

const setUrlParam = (key: string, value: string | null, usePush = true) => {
  const params = new URLSearchParams(window.location.search)
  if (value && value !== 'dashboard') {
    params.set(key, value)
  } else {
    params.delete(key)
  }
  const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname
  if (usePush) {
    window.history.pushState({}, '', newUrl)
  } else {
    window.history.replaceState({}, '', newUrl)
  }
}

interface FirmTodo {
  id: string
  text: string
  caseRef?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'completed'
  createdAt: string
}

type PracticeArea = 'Personal Injury' | 'Workers\' Compensation'
type TeamRole = 'attorney' | 'case_manager_lead' | 'case_manager' | 'case_manager_assistant'
type AssignmentFilter = 'all' | 'mine' | 'unassigned' | `member:${string}`

interface TeamMember {
  id: string
  email: string
  name?: string
  role: TeamRole
  status: 'pending' | 'active' | 'deactivated'
}

interface CaseAssignment {
  userId: string
  assignedAt: string
  assignedBy: string
}

interface CaseSummary {
  path: string
  name: string
  indexed: boolean
  indexedAt?: string
  clientName?: string
  casePhase?: string
  dateOfLoss?: string  // Also used for DOI in WC
  totalSpecials?: number
  policyLimits?: string | Record<string, unknown>
  statuteOfLimitations?: string
  solDaysRemaining?: number
  needsReindex?: boolean
  providers?: string[]
  // Linked case fields
  isSubcase?: boolean
  parentPath?: string
  parentName?: string
  practiceArea?: string
  // WC-specific fields
  employer?: string
  ttdStatus?: string
  amw?: number
  compensationRate?: number
  openHearings?: Array<{ case_number: string; hearing_level: string; next_date?: string; issue?: string }>
  // Team assignments
  assignments?: CaseAssignment[]
  // DOI container fields (for WC multi-injury clients)
  isContainer?: boolean          // True for client containers (not a case itself)
  containerPath?: string         // Path to container (for DOI cases)
  containerName?: string         // Container display name
  siblingCases?: Array<{ path: string; name: string; dateOfInjury: string }>
  injuryDate?: string            // Parsed from DOI folder name (YYYY-MM-DD)
  fileCount?: number             // Total document files in case folder
  latestYear?: number            // Most recent year folder containing this client
}

interface FirmData {
  root: string
  cases: CaseSummary[]
  yearBasedMode?: boolean
  summary: {
    total: number
    indexed: number
    needsAttention: number
  }
}

interface BatchProgress {
  isRunning: boolean
  totalCases: number
  currentText: string
  toolsUsed: string[]
  logs: string[]
  filesTotal: number
  filesComplete: number
  currentFile: string
}

interface Props {
  apiUrl: string
  firmRoot: string
  practiceArea: PracticeArea
  onSelectCase: (casePath: string) => void
  onChangeFirmRoot: () => void
  userEmail?: string
  onLogout?: () => void
  // Todo props - managed by App.tsx
  todos: FirmTodo[]
  onDrawerOpen: () => void
  onTodosUpdated: (todos: FirmTodo[]) => void
  // Task generation props
  firmChatPrompt?: string
  forceShowFirmChat?: boolean
  onFirmChatPromptUsed?: () => void
  // Knowledge refresh trigger - increments after init
  knowledgeVersion?: number
  // Team context - from auth
  teamContext?: {
    userId: string
    role: TeamRole
    permissions: {
      canManageTeam: boolean
      canAssignCases: boolean
      canViewAllCases: boolean
      canEditKnowledge: boolean
    }
  }
  // Single-case indexing progress from App.tsx
  indexingProgress?: {
    caseFolder: string
    caseName: string
    isRunning: boolean
    filesTotal: number
    filesComplete: number
    currentFile: string
  } | null
  // Incremented when a case finishes indexing — triggers case list refresh
  firmCasesVersion?: number
  // When set, the firmCasesVersion effect refreshes only this case instead of all cases
  lastIndexedCasePath?: string | null
  // Batch indexing state — lifted to App.tsx so it survives navigation
  batchProgress?: BatchProgress | null
  showBatchModal?: boolean
  onBatchProgressChange?: Dispatch<SetStateAction<BatchProgress | null>>
  onShowBatchModalChange?: Dispatch<SetStateAction<boolean>>
  onBatchComplete?: () => void
}

type TableDensity = 'comfortable' | 'compact'

// Icons
const ScaleIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)


const FolderIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
)

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
)

const XMarkIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
)

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
)

// Chat icon
const ChatBubbleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
  </svg>
)

const TableCellsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5" />
  </svg>
)

const BookOpenIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
)

const CogIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const ClipboardDocumentListIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
)

// Module-level cache — survives component unmount/remount so the dashboard
// appears instantly when navigating back from a case view.
let firmDataCache: { root: string; data: FirmData; fetchedAt: number } | null = null

export default function FirmDashboard({
  apiUrl, firmRoot, practiceArea, onSelectCase, onChangeFirmRoot, userEmail, onLogout,
  todos, onDrawerOpen, onTodosUpdated,
  firmChatPrompt, forceShowFirmChat, onFirmChatPromptUsed,
  knowledgeVersion,
  teamContext,
  indexingProgress,
  firmCasesVersion,
  lastIndexedCasePath,
  batchProgress: batchProgressProp,
  showBatchModal: showBatchModalProp,
  onBatchProgressChange,
  onShowBatchModalChange,
  onBatchComplete,
}: Props) {
  const isWC = practiceArea === 'Workers\' Compensation'
  const firmCasesVersionRef = useRef(firmCasesVersion)
  const hasCachedData = firmDataCache?.root === firmRoot
  const [firmData, setFirmDataState] = useState<FirmData | null>(
    hasCachedData ? firmDataCache!.data : null
  )
  const setFirmData = useCallback((dataOrUpdater: FirmData | ((prev: FirmData | null) => FirmData | null)) => {
    if (typeof dataOrUpdater === 'function') {
      setFirmDataState(prev => {
        const next = dataOrUpdater(prev)
        if (next) {
          firmDataCache = { root: firmRoot, data: next, fetchedAt: Date.now() }
        }
        return next
      })
    } else {
      setFirmDataState(dataOrUpdater)
      firmDataCache = { root: firmRoot, data: dataOrUpdater, fetchedAt: Date.now() }
    }
  }, [firmRoot])

  const refreshSingleCase = useCallback(async (casePath: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/firm/case-summary?root=${encodeURIComponent(firmRoot)}&path=${encodeURIComponent(casePath)}`)
      if (!res.ok) return
      const updated: CaseSummary = await res.json()
      setFirmData(prev => {
        if (!prev) return prev
        const idx = prev.cases.findIndex(c => c.path === casePath)
        if (idx < 0) return prev
        const cases = [...prev.cases]
        cases[idx] = { ...cases[idx], ...updated }
        const indexedCount = cases.filter(c => c.indexed && !c.isContainer).length
        return {
          ...prev,
          cases,
          summary: { ...prev.summary, indexed: indexedCount },
        }
      })
    } catch {
      // Silently fail — full loadCases will catch up
    }
  }, [apiUrl, firmRoot, setFirmData])
  const [loading, setLoading] = useState(!hasCachedData)
  const [error, setError] = useState<string | null>(null)
  const [tableDensity, setTableDensity] = useState<TableDensity>('comfortable')
  // Use App-level batch state when available, local state as fallback
  const [localBatchProgress, setLocalBatchProgress] = useState<BatchProgress | null>(null)
  const [localShowBatchModal, setLocalShowBatchModal] = useState(false)
  const batchProgress = onBatchProgressChange ? (batchProgressProp ?? null) : localBatchProgress
  const showBatchModal = onShowBatchModalChange ? (showBatchModalProp ?? false) : localShowBatchModal
  const setBatchProgress = onBatchProgressChange || setLocalBatchProgress
  const setShowBatchModal = onShowBatchModalChange || setLocalShowBatchModal
  const [view, setViewState] = useState<'dashboard' | 'firmChat' | 'knowledge'>(() => {
    const urlView = getUrlParam('view')
    if (urlView === 'firmChat' || urlView === 'knowledge') return urlView
    return 'dashboard'
  })
  const [knowledgeSubTab, setKnowledgeSubTabState] = useState<'editor' | 'chat' | 'templates'>(() => {
    const urlTab = getUrlParam('knowledgeTab')
    if (urlTab === 'editor' || urlTab === 'chat' || urlTab === 'templates') return urlTab
    return 'editor'
  })

  // Wrapper to sync view with URL
  const setView = (newView: 'dashboard' | 'firmChat' | 'knowledge') => {
    setViewState(newView)
    setUrlParam('view', newView)
  }

  // Wrapper to sync knowledgeSubTab with URL
  const setKnowledgeSubTab = (newTab: 'editor' | 'chat' | 'templates') => {
    setKnowledgeSubTabState(newTab)
    setUrlParam('knowledgeTab', newTab === 'editor' ? null : newTab)
  }

  // Handle browser back/forward for view state
  useEffect(() => {
    const handlePopState = () => {
      const urlView = getUrlParam('view')
      if (urlView === 'firmChat' || urlView === 'knowledge') {
        setViewState(urlView)
      } else {
        setViewState('dashboard')
      }

      const urlTab = getUrlParam('knowledgeTab')
      if (urlTab === 'editor' || urlTab === 'chat' || urlTab === 'templates') {
        setKnowledgeSubTabState(urlTab)
      } else {
        setKnowledgeSubTabState('editor')
      }

      const urlSettingsTab = getUrlParam('settingsTab')
      setSettingsTab(urlSettingsTab === 'team' ? 'team' : 'firm')

      const shouldOpenSettings = getUrlParam('openSettings') === '1'
      setShowFirmConfig(shouldOpenSettings)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterYears, setFilterYears] = useState<Set<number>>(() => new Set([new Date().getFullYear()]))
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false)
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set())
  const [knowledgeExists, setKnowledgeExists] = useState<boolean | null>(null)
  const [showFirmConfig, setShowFirmConfig] = useState(false)
  const [firmConfig, setFirmConfig] = useState<Record<string, any>>({})
  const [firmConfigSaving, setFirmConfigSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoDragOver, setLogoDragOver] = useState(false)
  const [packetTemplates, setPacketTemplates] = useState<Array<{ id: string; name: string; heading: string; builtIn?: boolean }>>([])

  // Team management state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [settingsTab, setSettingsTab] = useState<'firm' | 'team'>(() => {
    const tab = getUrlParam('settingsTab')
    return tab === 'team' ? 'team' : 'firm'
  })
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all')
  const canFilterBySpecificMember = teamContext?.role === 'attorney' || teamContext?.role === 'case_manager_lead'
  const selectableMemberFilters = useMemo(
    () =>
      teamMembers.filter(
        (member) =>
          member.status === 'active' &&
          (member.role === 'case_manager' || member.role === 'case_manager_assistant')
      ),
    [teamMembers]
  )
  const selectedMemberFilterId = assignmentFilter.startsWith('member:')
    ? assignmentFilter.slice('member:'.length)
    : null
  const chatScope =
    assignmentFilter === 'mine'
      ? ({ mode: 'mine' } as const)
      : selectedMemberFilterId
        ? ({ mode: 'member', memberId: selectedMemberFilterId } as const)
        : ({ mode: 'firm' } as const)

  // Container expand/collapse state (for DOI multi-injury clients)
  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set())

  const toggleContainer = (containerPath: string) => {
    setExpandedContainers(prev => {
      const next = new Set(prev)
      if (next.has(containerPath)) next.delete(containerPath)
      else next.add(containerPath)
      return next
    })
  }

  const toggleCase = (path: string, isContainer?: boolean, siblingCases?: Array<{ path: string }>) => {
    setSelectedCases(prev => {
      const next = new Set(prev)
      if (isContainer && siblingCases) {
        // Selecting a container selects/deselects all its DOI cases
        const doiPaths = siblingCases.map(s => s.path)
        const allSelected = doiPaths.every(p => prev.has(p))
        if (allSelected) {
          doiPaths.forEach(p => next.delete(p))
        } else {
          doiPaths.forEach(p => next.add(p))
        }
      } else {
        if (next.has(path)) next.delete(path)
        else next.add(path)
      }
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedCases(prev => {
      // Exclude containers from selection (only select actual cases)
      const visiblePaths = sortedCases.filter(c => !c.isContainer).map(c => c.path)
      const allSelected = visiblePaths.every(p => prev.has(p))
      if (allSelected) {
        const next = new Set(prev)
        visiblePaths.forEach(p => next.delete(p))
        return next
      } else {
        const next = new Set(prev)
        visiblePaths.forEach(p => next.add(p))
        return next
      }
    })
  }

  const loadCases = useCallback(async () => {
    // Only show loading spinner if we have no data to display yet
    if (!firmDataCache || firmDataCache.root !== firmRoot) {
      setLoading(true)
    }
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/firm/cases?root=${encodeURIComponent(firmRoot)}`)
      if (!res.ok) throw new Error('Failed to load cases')
      const data = await res.json()
      setFirmData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cases')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, firmRoot, isWC, setFirmData])

  const loadTeamMembers = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/team?root=${encodeURIComponent(firmRoot)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.configured && data.team?.members) {
          setTeamMembers(data.team.members)
        }
      }
    } catch {}
  }, [apiUrl, firmRoot])

  const syncCaseAssignments = useCallback(async (casePath: string, newAssignments: CaseAssignment[]) => {
    if (!teamContext?.permissions?.canAssignCases) return

    const existing = firmData?.cases.find(c => c.path === casePath)?.assignments || []
    const existingSet = new Set(existing.map(a => a.userId))
    const nextSet = new Set(newAssignments.map(a => a.userId))

    const toAdd = Array.from(nextSet).filter(id => !existingSet.has(id))
    const toRemove = Array.from(existingSet).filter(id => !nextSet.has(id))

    if (toAdd.length > 0) {
      const addRes = await fetch(`${apiUrl}/api/firm/case/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          casePath,
          userIds: toAdd,
          assignedBy: (userEmail || teamContext.userId || 'system').toLowerCase(),
        }),
      })
      if (!addRes.ok) {
        const data = await addRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to assign users')
      }
    }

    for (const userId of toRemove) {
      const removeRes = await fetch(
        `${apiUrl}/api/firm/case/unassign?casePath=${encodeURIComponent(casePath)}&userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' }
      )
      if (!removeRes.ok) {
        const data = await removeRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to unassign user')
      }
    }
  }, [apiUrl, firmData?.cases, teamContext?.permissions?.canAssignCases, teamContext?.userId, userEmail])

  useEffect(() => {
    loadCases()
    loadTeamMembers()
  }, [loadCases, loadTeamMembers])

  // Reload cases when a case finishes indexing (skip initial mount — loadCases already runs above)
  useEffect(() => {
    if (firmCasesVersion === firmCasesVersionRef.current) return
    firmCasesVersionRef.current = firmCasesVersion
    // If a specific case was just indexed and we already have data, refresh only that case
    if (lastIndexedCasePath && firmData) {
      refreshSingleCase(lastIndexedCasePath)
    } else {
      loadCases()
    }
  }, [firmCasesVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!teamContext?.role) return

    setAssignmentFilter((prev) => {
      if (prev.startsWith('member:')) {
        const memberId = prev.slice('member:'.length)
        const memberStillSelectable = selectableMemberFilters.some((member) => member.id === memberId)
        if (!canFilterBySpecificMember || !memberStillSelectable) {
          return teamContext.role === 'case_manager' ? 'mine' : 'all'
        }
      }
      if (teamContext.role === 'case_manager' && prev === 'all') {
        return 'mine'
      }
      return prev
    })
  }, [canFilterBySpecificMember, selectableMemberFilters, teamContext?.role])

  // Check if knowledge base exists
  const checkKnowledge = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/manifest?root=${encodeURIComponent(firmRoot)}`)
      setKnowledgeExists(res.ok)
    } catch {
      setKnowledgeExists(false)
    }
  }, [apiUrl, firmRoot])

  useEffect(() => { checkKnowledge() }, [checkKnowledge, knowledgeVersion])

  const loadFirmConfig = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/firm-config?root=${encodeURIComponent(firmRoot)}`)
      if (res.ok) setFirmConfig(await res.json())
    } catch {}
  }, [apiUrl, firmRoot])

  const loadFirmLogo = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/firm-logo?root=${encodeURIComponent(firmRoot)}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setLogoPreview(url)
      } else {
        setLogoPreview(null)
      }
    } catch {
      setLogoPreview(null)
    }
  }, [apiUrl, firmRoot])

  const loadPacketTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/packet-templates?root=${encodeURIComponent(firmRoot)}`)
      if (res.ok) {
        const data = await res.json()
        setPacketTemplates(data.templates || [])
      }
    } catch {}
  }, [apiUrl, firmRoot])

  const openFirmSettings = useCallback((tab: 'firm' | 'team' = 'firm') => {
    setView('knowledge')
    setKnowledgeSubTab('editor')
    setSettingsTab(tab)
    loadFirmConfig()
    loadFirmLogo()
    loadTeamMembers()
    loadPacketTemplates()
    setShowFirmConfig(true)
    setUrlParam('openSettings', null, false)
  }, [loadFirmConfig, loadFirmLogo, loadTeamMembers, loadPacketTemplates])

  useEffect(() => {
    const shouldOpenSettings = getUrlParam('openSettings') === '1'
    if (!shouldOpenSettings) return
    const tab = getUrlParam('settingsTab')
    openFirmSettings(tab === 'team' ? 'team' : 'firm')
  }, [openFirmSettings])

  const handleLogoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const file = files[0]
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (!['png', 'jpg', 'jpeg'].includes(ext || '')) {
      alert('Only PNG and JPG images are supported')
      return
    }

    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${apiUrl}/api/knowledge/firm-logo/upload?root=${encodeURIComponent(firmRoot)}`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      // Reload the logo preview
      await loadFirmLogo()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleLogoDelete = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/firm-logo?root=${encodeURIComponent(firmRoot)}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        if (logoPreview) {
          URL.revokeObjectURL(logoPreview)
        }
        setLogoPreview(null)
      }
    } catch {
      // Ignore errors
    }
  }

  const handleLogoDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setLogoDragOver(false)
    handleLogoUpload(e.dataTransfer.files)
  }

  const handleLogoDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setLogoDragOver(true)
  }

  const handleLogoDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setLogoDragOver(false)
  }

  const saveFirmConfig = async () => {
    setFirmConfigSaving(true)
    try {
      await fetch(`${apiUrl}/api/knowledge/firm-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, ...firmConfig }),
      })
      setShowFirmConfig(false)
    } catch {}
    setFirmConfigSaving(false)
  }

  // Switch to Firm Chat when forceShowFirmChat is true
  useEffect(() => {
    if (forceShowFirmChat) {
      setView('firmChat')
    }
  }, [forceShowFirmChat])

  const startBatchIndex = async (casePaths?: string[]) => {
    setBatchProgress({
      isRunning: true,
      totalCases: casePaths?.length || 0,
      currentText: 'Starting batch indexing...',
      toolsUsed: [],
      logs: ['Starting batch indexing...'],
      filesTotal: 0,
      filesComplete: 0,
      currentFile: ''
    })
    setShowBatchModal(true)

    try {
      const res = await fetch(`${apiUrl}/api/firm/batch-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, cases: casePaths })
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let sseBuffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:') && !line.startsWith('data: ')) continue
          const jsonStr = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
          try {
            const data = JSON.parse(jsonStr.trim())

            if (data.type === 'start') {
              setBatchProgress(prev => prev ? {
                ...prev,
                totalCases: data.totalCases,
                logs: [...prev.logs, `Found ${data.totalCases} cases to index`]
              } : prev)
            }

            if (data.type === 'text') {
              setBatchProgress(prev => prev ? {
                ...prev,
                currentText: data.content,
                logs: [...prev.logs.slice(-100), data.content]
              } : prev)
            }

            if (data.type === 'tool') {
              const toolMsg = data.detail || `Using: ${data.name}`
              setBatchProgress(prev => prev ? {
                ...prev,
                toolsUsed: [...prev.toolsUsed, data.name],
                logs: [...prev.logs.slice(-100), toolMsg]
              } : prev)
            }

            if (data.type === 'tool_result') {
              setBatchProgress(prev => prev ? {
                ...prev,
                logs: [...prev.logs.slice(-100), `  → ${data.content}`]
              } : prev)
            }

            if (data.type === 'case_done' && data.casePath) {
              refreshSingleCase(data.casePath)
            }

            if (data.type === 'done') {
              setBatchProgress(prev => prev ? {
                ...prev,
                isRunning: false,
                logs: [...prev.logs, data.success ? 'Batch indexing complete!' : 'Batch indexing finished with errors']
              } : prev)
              setShowBatchModal(true)
              onBatchComplete?.()
            }

            if (data.type === 'error') {
              setBatchProgress(prev => prev ? {
                ...prev,
                isRunning: false,
                logs: [...prev.logs, `Error: ${data.error}`]
              } : prev)
            }

            // File-level progress events
            if (data.type === 'files_found') {
              setBatchProgress(prev => prev ? {
                ...prev,
                filesTotal: data.count,
                logs: [...prev.logs, `Found ${data.count} files to extract`]
              } : prev)
            }

            if (data.type === 'file_start') {
              setBatchProgress(prev => prev ? {
                ...prev,
                currentFile: data.filename
              } : prev)
            }

            if (data.type === 'file_done') {
              setBatchProgress(prev => prev ? {
                ...prev,
                filesComplete: prev.filesComplete + 1,
                currentFile: '',
                // Fallback: set filesTotal from file_done's totalFiles if files_found was missed
                ...(prev.filesTotal === 0 && data.totalFiles ? { filesTotal: data.totalFiles } : {}),
                logs: [...prev.logs.slice(-50), `✓ ${data.filename} (${data.docType})`]
              } : prev)
            }

            if (data.type === 'file_error') {
              setBatchProgress(prev => prev ? {
                ...prev,
                filesComplete: prev.filesComplete + 1,
                logs: [...prev.logs.slice(-50), `✗ ${data.filename}: ${data.error}`]
              } : prev)
            }

            if (data.type === 'status') {
              setBatchProgress(prev => prev ? {
                ...prev,
                currentText: data.message,
                logs: [...prev.logs.slice(-50), data.message]
              } : prev)
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

    } catch (err) {
      setBatchProgress(prev => prev ? {
        ...prev,
        isRunning: false,
        logs: [...prev.logs, `Error: ${err instanceof Error ? err.message : 'Unknown error'}`]
      } : prev)
    }
  }

  // Filter out containers when counting unindexed cases (containers are never indexed themselves)
  const unindexedCases = firmData?.cases.filter(c => !c.indexed && !c.isContainer) || []

  const formatCurrency = (amount?: number) => {
    if (amount === undefined) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr === 'Unknown') return '—'
    return formatDateMMDDYYYY(dateStr, dateStr)
  }

  /**
   * Format policy limits for display.
   * Canonical schema: { "1P": { bodily_injury, um_uim, ... }, "3P": { bodily_injury, ... } }
   */
  const formatPolicyLimits = (limits?: string | Record<string, unknown>): React.ReactNode => {
    if (!limits) return '—'

    // Handle JSON strings (legacy data)
    let parsed: Record<string, unknown>
    if (typeof limits === 'string') {
      if (limits.startsWith('{')) {
        try {
          parsed = JSON.parse(limits)
        } catch {
          return limits // Can't parse, show as-is
        }
      } else {
        return limits
      }
    } else if (typeof limits === 'object') {
      parsed = limits
    } else {
      return '—'
    }

    // Extract BI from a policy object, with fallbacks
    const extractBI = (obj: Record<string, unknown>): string | null => {
      const bi = obj.bodily_injury ?? obj.bi ?? obj.um_uim
      if (typeof bi === 'string') return bi
      if (typeof bi === 'number') return '$' + bi.toLocaleString()
      // Fallback: first string containing $
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && v.includes('$')) return v
      }
      return null
    }

    // Look for canonical 1P/3P keys (case-insensitive)
    let thirdParty: string | null = null
    let firstParty: string | null = null

    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'object' || val === null) continue
      const keyUpper = key.toUpperCase()
      if (keyUpper.includes('3P') || keyUpper.includes('THIRD')) {
        thirdParty = thirdParty || extractBI(val as Record<string, unknown>)
      }
      if (keyUpper.includes('1P') || keyUpper.includes('FIRST')) {
        firstParty = firstParty || extractBI(val as Record<string, unknown>)
      }
    }

    if (!thirdParty && !firstParty) return '—'

    return (
      <div className="leading-snug">
        {thirdParty && <div>3P: {thirdParty}</div>}
        {firstParty && <div>1P: {firstParty}</div>}
      </div>
    )
  }

  const getSolBadge = (days?: number) => {
    if (days === undefined) return null

    let config = 'bg-surface-100 text-brand-600 ring-1 ring-surface-200'
    if (days <= 30) config = 'bg-red-50 text-red-700 ring-1 ring-red-200'
    else if (days <= 90) config = 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    else if (days <= 180) config = 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200'

    return (
      <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md ${config}`}>
        {days}d
      </span>
    )
  }

  const getTTDStatusBadge = (status?: string) => {
    if (!status) return <span className="text-brand-400">—</span>

    const colors: Record<string, string> = {
      'active': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      'suspended': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      'terminated': 'bg-red-50 text-red-700 ring-1 ring-red-200',
      'closed': 'bg-surface-100 text-brand-600 ring-1 ring-surface-200',
    }
    const color = colors[status.toLowerCase()] || 'bg-surface-100 text-brand-500'
    return (
      <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md ${color}`}>
        {status}
      </span>
    )
  }

  const formatAMW = (amw?: number, rate?: number) => {
    if (!amw && !rate) return '—'
    const parts = []
    if (amw) parts.push(`AMW: ${formatCurrency(amw)}`)
    if (rate) parts.push(`Rate: ${formatCurrency(rate)}`)
    return parts.join(' / ')
  }

  const formatHearings = (hearings?: Array<{ case_number: string; hearing_level: string; next_date?: string }>) => {
    if (!hearings || hearings.length === 0) return '—'
    const hasAO = hearings.some(h => h.hearing_level === 'A.O.')
    const label = hasAO ? 'AO' : 'HO'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
        hasAO ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
      }`}>
        {label}
      </span>
    )
  }

  const getPhaseBadge = (phase?: string) => {
    const colors: Record<string, string> = {
      // PI phases
      'Intake': 'bg-surface-100 text-brand-600',
      'Investigation': 'bg-blue-50 text-blue-700',
      'Treatment': 'bg-purple-50 text-purple-700',
      'Demand': 'bg-orange-50 text-orange-700',
      'Negotiation': 'bg-yellow-50 text-yellow-700',
      'Settlement': 'bg-emerald-50 text-emerald-700',
      'Complete': 'bg-emerald-50 text-emerald-700',
      // WC phases
      'MMI Evaluation': 'bg-indigo-50 text-indigo-700',
      'Benefits Resolution': 'bg-orange-50 text-orange-700',
      'Settlement/Hearing': 'bg-amber-50 text-amber-700',
      'Closed': 'bg-emerald-50 text-emerald-700',
    }
    const color = colors[phase || ''] || 'bg-surface-100 text-brand-500'
    return (
      <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md ${color}`}>
        {phase || 'Unknown'}
      </span>
    )
  }

  const sortedCases = firmData?.cases
    .filter(c => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (c.clientName || '').toLowerCase().includes(q) ||
             c.name.toLowerCase().includes(q)
    })
    .filter(c => {
      if (!firmData?.yearBasedMode || filterYears.size === 0) return true
      return c.latestYear != null && filterYears.has(c.latestYear)
    })
    .filter(c => {
      // Assignment filter
      if (assignmentFilter === 'all') return true
      if (assignmentFilter === 'unassigned') return !c.assignments || c.assignments.length === 0
      if (assignmentFilter === 'mine' && teamContext?.userId) {
        return c.assignments?.some(a => a.userId === teamContext.userId)
      }
      if (assignmentFilter.startsWith('member:')) {
        const memberId = assignmentFilter.slice('member:'.length)
        return c.assignments?.some(a => a.userId === memberId)
      }
      return true
    })
    .sort((a, b) => (a.clientName || a.name).localeCompare(b.clientName || b.name)) || []

  const visibleCasePaths = useMemo(
    () => sortedCases.filter((c) => !c.isContainer).map((c) => c.path),
    [sortedCases]
  )

  const selectedVisibleCount = useMemo(
    () => visibleCasePaths.filter((path) => selectedCases.has(path)).length,
    [selectedCases, visibleCasePaths]
  )

  const handleIndexSelected = () => {
    const paths = Array.from(selectedCases)
    if (paths.length === 0) return
    setSelectedCases(new Set())
    startBatchIndex(paths)
  }

  const isCompact = tableDensity === 'compact'
  const headerCellPad = isCompact ? 'px-6 py-3' : 'px-6 py-4'
  const checkboxHeaderCellPad = isCompact ? 'px-4 py-3 w-10' : 'px-4 py-4 w-10'
  const checkboxBodyCellPad = isCompact ? 'px-4 py-3 w-10' : 'px-4 py-4 w-10'
  const bodyCellPad = isCompact ? 'px-6 py-3' : 'px-6 py-4'
  const containerRowCellPad = isCompact ? 'px-6 py-2.5' : 'px-6 py-3'
  const containerCheckboxCellPad = isCompact ? 'px-4 py-2.5 w-10' : 'px-4 py-3 w-10'


  // Available years for filter (descending), only for year-based mode
  const availableYears = useMemo(() => {
    if (!firmData?.yearBasedMode) return []
    const years = [...new Set(firmData.cases.map(c => c.latestYear).filter((y): y is number => !!y))]
    return years.sort((a, b) => b - a)
  }, [firmData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-brand-500">Loading cases...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 bg-surface-50">
        <div className="text-red-600 font-medium">{error}</div>
        <button
          onClick={loadCases}
          className="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-surface-50">
      {/* Header */}
      <div className="bg-brand-900/95 text-white px-8 py-6 backdrop-blur">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ScaleIcon />
            </div>
            <div>
              <h1 className="font-serif text-2xl tracking-tight">
                {isWC ? 'Workers\' Comp Dashboard' : 'Case Dashboard'}
              </h1>
              <p className="text-sm text-brand-300 mt-0.5">{firmRoot}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1">
              {firmData?.yearBasedMode && (
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`${apiUrl}/api/firm/scan-clients`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ root: firmRoot }),
                      })
                      if (res.ok) {
                        const result = await res.json()
                        if (result.added?.length > 0 || result.updated?.length > 0) {
                          loadCases()
                        }
                      }
                    } catch {}
                  }}
                  className="px-4 py-2 text-sm text-brand-200 hover:text-white bg-white/5 hover:bg-white/10
                             rounded-lg transition-colors"
                  title="Scan year folders for new or updated clients"
                >
                  Scan for Clients
                </button>
              )}
              <button
                onClick={loadCases}
                className="p-2 text-brand-200 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshIcon />
              </button>
              <button
                onClick={onChangeFirmRoot}
                className="px-4 py-2 text-sm text-brand-200 hover:text-white bg-white/5 hover:bg-white/10
                           rounded-lg transition-colors flex items-center gap-2"
              >
                <FolderIcon />
                <span>Change Folder</span>
              </button>
              <div className="h-6 w-px bg-white/15" />
              <div className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 text-brand-100">
                Workers' Comp
              </div>
            </div>

            {/* View toggle */}
            <div className="flex bg-white/10 rounded-lg p-1">
              <button
                onClick={() => setView('dashboard')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === 'dashboard'
                    ? 'bg-white text-brand-900'
                    : 'text-brand-300 hover:text-white'
                }`}
              >
                <TableCellsIcon />
                Dashboard
              </button>
              <button
                onClick={() => setView('firmChat')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === 'firmChat'
                    ? 'bg-white text-brand-900'
                    : 'text-brand-300 hover:text-white'
                }`}
              >
                <ChatBubbleIcon />
                Firm Chat
              </button>
              <button
                onClick={() => setView('knowledge')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === 'knowledge'
                    ? 'bg-white text-brand-900'
                    : 'text-brand-300 hover:text-white'
                }`}
              >
                <BookOpenIcon />
                Knowledge
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1">
              {/* Tasks drawer toggle */}
              <button
                onClick={onDrawerOpen}
                className="relative p-2 text-brand-200 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                title="View Tasks"
              >
                <ClipboardDocumentListIcon />
                {todos.filter(t => t.status === 'pending').length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-semibold
                                 bg-accent-500 text-white rounded-full flex items-center justify-center">
                    {todos.filter(t => t.status === 'pending').length}
                  </span>
                )}
              </button>
              <button
                onClick={() => openFirmSettings('firm')}
                className="p-2 text-brand-200 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                title="Settings"
              >
                <CogIcon />
              </button>
            </div>

            {userEmail && (
              <div className="flex items-center gap-3 border-l border-brand-700 pl-4">
                <span className="text-sm text-brand-300">{userEmail}</span>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="text-sm text-brand-400 hover:text-white transition-colors"
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Summary cards — reflect filtered view */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white/10 backdrop-blur rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">Indexed</p>
                <p className="text-4xl font-serif text-white mt-1">{sortedCases.filter(c => c.indexed && !c.isContainer).length}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircleIcon />
              </div>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">Active Cases</p>
                <p className="text-4xl font-serif text-white mt-1">{sortedCases.filter(c => !c.isContainer).length}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-brand-500/30 flex items-center justify-center text-brand-300">
                <FolderIcon />
              </div>
            </div>
          </div>
        </div>
      </div>

      {view === 'knowledge' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Knowledge sub-tabs */}
          <div className="bg-white border-b border-surface-200 px-8 py-3 flex items-center gap-4">
            <div className="flex bg-surface-100 rounded-lg p-1">
              <button
                onClick={() => setKnowledgeSubTab('editor')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  knowledgeSubTab === 'editor' ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setKnowledgeSubTab('chat')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  knowledgeSubTab === 'chat' ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setKnowledgeSubTab('templates')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  knowledgeSubTab === 'templates' ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                Templates
              </button>
            </div>
            <button
              onClick={() => openFirmSettings(settingsTab)}
              className="ml-auto flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-700 transition-colors"
            >
              <CogIcon />
              Firm Settings
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {knowledgeSubTab === 'templates' ? (
              <TemplateManager apiUrl={apiUrl} firmRoot={firmRoot} />
            ) : knowledgeExists ? (
              knowledgeSubTab === 'editor'
                ? <KnowledgeEditor apiUrl={apiUrl} firmRoot={firmRoot} canEditKnowledge={teamContext?.permissions?.canEditKnowledge || false} />
                : <KnowledgeChat apiUrl={apiUrl} firmRoot={firmRoot} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-brand-400 gap-2">
                <p>No knowledge base found for this folder.</p>
                <p className="text-sm">Select a different folder or re-select this one to initialize.</p>
              </div>
            )}
          </div>
        </div>
      ) : view === 'firmChat' ? (
        <FirmChat
          apiUrl={apiUrl}
          firmRoot={firmRoot}
          scope={chatScope}
          onTodosUpdated={onTodosUpdated}
          initialPrompt={firmChatPrompt}
          onInitialPromptUsed={onFirmChatPromptUsed}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-surface-200 px-8 py-4 flex gap-6 items-center">
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search cases..."
                  className="text-sm border border-surface-200 rounded-lg pl-9 pr-3 py-2 bg-white w-52
                             focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent
                             placeholder:text-brand-400"
                />
              </div>
            </div>
            {availableYears.length > 1 && (
              <div className="relative flex items-center gap-2">
                <label className="text-sm font-medium text-brand-600">Year</label>
                <button
                  onClick={() => setYearDropdownOpen(!yearDropdownOpen)}
                  className="text-sm border border-surface-200 rounded-lg px-3 py-2 bg-white
                             focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent
                             flex items-center gap-1.5"
                >
                  {filterYears.size === 0 || filterYears.size === availableYears.length
                    ? 'All Years'
                    : [...filterYears].sort((a, b) => b - a).join(', ')}
                  <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {yearDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setYearDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 z-40 bg-white border border-surface-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                      {availableYears.map(year => (
                        <label
                          key={year}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-50 cursor-pointer text-sm text-brand-700"
                        >
                          <input
                            type="checkbox"
                            checked={filterYears.has(year)}
                            onChange={() => {
                              setFilterYears(prev => {
                                const next = new Set(prev)
                                if (next.has(year)) {
                                  next.delete(year)
                                } else {
                                  next.add(year)
                                }
                                return next
                              })
                            }}
                            className="rounded border-surface-300 text-accent-600 focus:ring-accent-500"
                          />
                          {year}
                        </label>
                      ))}
                      <div className="border-t border-surface-100 mt-1 pt-1">
                        <button
                          onClick={() => {
                            setFilterYears(new Set(availableYears))
                            setYearDropdownOpen(false)
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-brand-500 hover:bg-surface-50"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => {
                            setFilterYears(new Set())
                            setYearDropdownOpen(false)
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-brand-500 hover:bg-surface-50"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Assignment filter - only show when team is configured */}
            {teamMembers.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-brand-600">Assignment</label>
                <select
                  value={assignmentFilter}
                  onChange={(e) => setAssignmentFilter(e.target.value as AssignmentFilter)}
                  className="text-sm border border-surface-200 rounded-lg px-3 py-2 bg-white
                             focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                >
                  <option value="all">All Cases</option>
                  <option value="mine">My Cases</option>
                  <option value="unassigned">Unassigned</option>
                  {canFilterBySpecificMember &&
                    selectableMemberFilters.map((member) => (
                      <option key={member.id} value={`member:${member.id}`}>
                        {member.name || member.email}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-1 rounded-lg bg-surface-100 p-1">
                <button
                  onClick={() => setTableDensity('comfortable')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    tableDensity === 'comfortable'
                      ? 'bg-white text-brand-900 shadow-sm'
                      : 'text-brand-500 hover:text-brand-700'
                  }`}
                >
                  Comfortable
                </button>
                <button
                  onClick={() => setTableDensity('compact')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    tableDensity === 'compact'
                      ? 'bg-white text-brand-900 shadow-sm'
                      : 'text-brand-500 hover:text-brand-700'
                  }`}
                >
                  Compact
                </button>
              </div>
              <div className="text-sm text-brand-500">
                {visibleCasePaths.length} case{visibleCasePaths.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Cases table */}
          <div className="flex-1 overflow-auto px-8 py-6">
        {selectedCases.size > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3">
            <div className="text-sm text-brand-700">
              <span className="font-semibold text-brand-900">{selectedCases.size}</span> case{selectedCases.size !== 1 ? 's' : ''} selected
              {selectedVisibleCount !== selectedCases.size && (
                <span className="text-brand-500"> ({selectedVisibleCount} in current view)</span>
              )}
            </div>
            <button
              onClick={handleIndexSelected}
              disabled={batchProgress?.isRunning}
              className="px-3.5 py-2 text-sm font-medium bg-accent-600 text-white rounded-lg
                         hover:bg-accent-500 disabled:opacity-50 transition-colors"
            >
              {batchProgress?.isRunning ? 'Indexing...' : 'Index Selected'}
            </button>
            <button
              onClick={() => setSelectedCases(new Set())}
              className="px-3.5 py-2 text-sm font-medium text-brand-700 bg-white border border-surface-200 rounded-lg
                         hover:bg-surface-100 transition-colors"
            >
              Clear Selection
            </button>
          </div>
        )}
        <div className="bg-white rounded-xl shadow-card border border-surface-200 overflow-hidden">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-surface-200">
                <th className={checkboxHeaderCellPad}>
                  <input
                    type="checkbox"
                    checked={sortedCases.filter(c => !c.isContainer).length > 0 && sortedCases.filter(c => !c.isContainer).every(c => selectedCases.has(c.path))}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                  />
                </th>
                <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Client</th>
                <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Phase</th>
                <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>
                  {isWC ? 'Date of Injury' : 'Date of Loss'}
                </th>
                {isWC ? (
                  <>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Employer</th>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>TTD Status</th>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>AMW / Rate</th>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Hearings</th>
                  </>
                ) : (
                  <>
                    <th className={`text-right ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Specials</th>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Policy Limits</th>
                    <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>SOL</th>
                  </>
                )}
                {teamMembers.length > 0 && (
                  <th className={`text-left ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Assigned To</th>
                )}
                <th className={`text-center ${headerCellPad} text-xs font-semibold text-brand-500 uppercase tracking-wider`}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {sortedCases.map((c) => {
                // Check if this is a DOI case that should be hidden (container collapsed)
                const isDOICase = !!c.containerPath
                const isContainerExpanded = c.containerPath ? expandedContainers.has(c.containerPath) : true
                if (isDOICase && !isContainerExpanded) return null

                // Container row rendering
                if (c.isContainer) {
                  const isExpanded = expandedContainers.has(c.path)
                  const doiCaseCount = c.siblingCases?.length || 0
                  const allDoiCasesSelected = c.siblingCases?.every(s => selectedCases.has(s.path)) || false
                  const someDoiCasesSelected = c.siblingCases?.some(s => selectedCases.has(s.path)) || false

                  return (
                    <tr
                      key={c.path}
                      onClick={() => toggleContainer(c.path)}
                      className="bg-brand-50 hover:bg-brand-100 cursor-pointer transition-colors"
                    >
                      <td className={containerCheckboxCellPad} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allDoiCasesSelected}
                          ref={(el) => { if (el) el.indeterminate = someDoiCasesSelected && !allDoiCasesSelected }}
                          onChange={() => toggleCase(c.path, true, c.siblingCases)}
                          className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                        />
                      </td>
                      <td className={containerRowCellPad} colSpan={isWC ? 9 : 7}>
                        <div className="flex items-center gap-3">
                          <span className={`text-brand-600 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                            <ChevronDownIcon />
                          </span>
                          <span className="text-brand-500">
                            <UsersIcon />
                          </span>
                          <div>
                            <div className="font-semibold text-brand-900">{c.clientName || c.name}</div>
                            <div className="text-xs text-brand-500 mt-0.5">
                              {doiCaseCount} injury claim{doiCaseCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                }

                // Regular case row or DOI case row
                return (
                  <tr
                    key={c.path}
                    onClick={() => c.indexed && onSelectCase(c.path)}
                    className={`group ${c.indexed
                      ? 'hover:bg-surface-50 cursor-pointer border-l-2 border-l-transparent hover:border-l-accent-500'
                      : 'bg-surface-50/50 opacity-60'} ${c.isSubcase || isDOICase ? 'bg-surface-25' : ''} transition-all`}
                  >
                    <td className={checkboxBodyCellPad} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedCases.has(c.path)}
                        onChange={() => toggleCase(c.path)}
                        className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                      />
                    </td>
                    <td className={`${isCompact ? 'py-3' : 'py-4'} ${c.isSubcase || isDOICase ? 'pl-10 pr-6' : 'px-6'}`}>
                      <div className="flex items-center gap-3">
                        {(c.isSubcase || isDOICase) && (
                          <span className="text-brand-300 mr-1 -ml-4">└</span>
                        )}
                        <div>
                          <div className="font-medium text-brand-900">
                            {isDOICase ? (
                              <>
                                {c.clientName || c.containerName}
                                <span className="ml-2 text-xs font-normal text-brand-500">
                                  DOI: {c.injuryDate}
                                </span>
                              </>
                            ) : (
                              c.clientName || c.name
                            )}
                          </div>
                          {c.isSubcase ? (
                            <div className="text-xs text-brand-400 mt-0.5">
                              Linked to: {c.parentName}
                            </div>
                          ) : !isDOICase && (
                            <div className="text-xs text-brand-400 mt-0.5">{c.name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={bodyCellPad}>{getPhaseBadge(c.casePhase)}</td>
                    <td className={`${bodyCellPad} text-sm text-brand-600`}>
                      {isDOICase ? c.injuryDate : formatDate(c.dateOfLoss)}
                    </td>
                    {isWC ? (
                      <>
                        <td className={`${bodyCellPad} text-sm text-brand-600`}>{c.employer || '—'}</td>
                        <td className={bodyCellPad}>{getTTDStatusBadge(c.ttdStatus)}</td>
                        <td className={`${bodyCellPad} text-sm text-brand-600 tabular-nums`}>{formatAMW(c.amw, c.compensationRate)}</td>
                        <td className={`${bodyCellPad} text-sm text-brand-600`}>{formatHearings(c.openHearings)}</td>
                      </>
                    ) : (
                      <>
                        <td className={`${bodyCellPad} text-sm text-brand-900 text-right font-semibold tabular-nums`}>
                          {formatCurrency(c.totalSpecials)}
                        </td>
                        <td className={`${bodyCellPad} text-sm text-brand-600`}>{formatPolicyLimits(c.policyLimits)}</td>
                        <td className={bodyCellPad}>{getSolBadge(c.solDaysRemaining)}</td>
                      </>
                    )}
                    {teamMembers.length > 0 && (
                      <td className={bodyCellPad} onClick={e => e.stopPropagation()}>
                        <CaseAssignmentDropdown
                          casePath={c.path}
                          assignments={c.assignments || []}
                          teamMembers={teamMembers}
                          userEmail={userEmail || ''}
                          canAssign={teamContext?.permissions?.canAssignCases || false}
                          onAssignmentChange={async (newAssignments) => {
                            await syncCaseAssignments(c.path, newAssignments)
                            // Update the case in firmData
                            if (firmData) {
                              setFirmData({
                                ...firmData,
                                cases: firmData.cases.map(cs =>
                                  cs.path === c.path ? { ...cs, assignments: newAssignments } : cs
                                )
                              })
                            }
                          }}
                          compact
                        />
                      </td>
                    )}
                    <td className={bodyCellPad}>
                      <div className="flex items-center justify-center">
                        {indexingProgress?.isRunning && indexingProgress.caseFolder === c.path ? (
                          <div className="flex flex-col items-center gap-1 min-w-24">
                            <div className="w-24 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-accent-500 rounded-full transition-all duration-300"
                                style={{ width: indexingProgress.filesTotal > 0
                                  ? `${(indexingProgress.filesComplete / indexingProgress.filesTotal) * 100}%`
                                  : '100%'
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-brand-500 truncate max-w-24">
                              {indexingProgress.filesTotal > 0
                                ? `${indexingProgress.filesComplete}/${indexingProgress.filesTotal} files`
                                : 'Indexing...'}
                            </span>
                          </div>
                        ) : !c.indexed ? (
                          <span className="text-xs text-brand-400">Not indexed{c.fileCount ? ` (${c.fileCount} files)` : ''}</span>
                        ) : c.needsReindex ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-600">
                            <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                            <span className="text-xs font-medium">Update</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-emerald-600">
                            <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                            <span className="text-xs font-medium">Current</span>
                          </span>
                        )}
                      </div>
                    </td>
                    {c.indexed && (
                      <td className="px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ChevronRightIcon />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {sortedCases.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
                <FolderIcon />
              </div>
              <p className="text-brand-600 font-medium">No cases found</p>
              <p className="text-sm text-brand-400 mt-1">Check your folder selection</p>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Firm Settings modal with tabs */}
      {showFirmConfig && (
        <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            {/* Tabs header */}
            <div className="flex border-b border-surface-200">
              <button
                onClick={() => setSettingsTab('firm')}
                className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                  settingsTab === 'firm'
                    ? 'text-brand-900 border-b-2 border-brand-900'
                    : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                Firm Info
              </button>
              <button
                onClick={() => setSettingsTab('team')}
                className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                  settingsTab === 'team'
                    ? 'text-brand-900 border-b-2 border-brand-900'
                    : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                Team
              </button>
            </div>

            {/* Tab content */}
            {settingsTab === 'firm' ? (
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-3">
                  {[
                    { key: 'firmName', label: 'Firm Name' },
                    { key: 'attorneyName', label: 'Attorney Name' },
                    { key: 'nevadaBarNo', label: 'Nevada Bar No.' },
                    { key: 'address', label: 'Address' },
                    { key: 'cityStateZip', label: 'City, State ZIP' },
                    { key: 'phone', label: 'Phone' },
                    { key: 'practiceArea', label: 'Practice Area' },
                    { key: 'feeStructure', label: 'Fee Structure' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="text-xs font-medium text-brand-600 mb-1 block">{field.label}</label>
                      <input
                        value={firmConfig[field.key] || ''}
                        onChange={(e) => setFirmConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
                    </div>
                  ))}

                  {/* Logo upload section */}
                  <div className="pt-3 border-t border-surface-200 mt-3">
                    <label className="text-xs font-medium text-brand-600 mb-2 block">Firm Logo</label>

                    {logoPreview ? (
                      <div className="flex items-center gap-4">
                        <img src={logoPreview} alt="Firm logo" className="h-16 object-contain rounded border border-surface-200" />
                        <button
                          onClick={handleLogoDelete}
                          className="text-sm text-red-500 hover:text-red-700 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div
                        onDrop={handleLogoDrop}
                        onDragOver={handleLogoDragOver}
                        onDragLeave={handleLogoDragLeave}
                        className={`relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                          ${logoDragOver ? 'border-accent-500 bg-accent-50' : 'border-surface-300 hover:border-accent-500'}
                          ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}
                        `}
                      >
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg"
                          onChange={(e) => handleLogoUpload(e.target.files)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          disabled={uploadingLogo}
                        />
                        {uploadingLogo ? (
                          <p className="text-sm text-brand-500">Uploading...</p>
                        ) : (
                          <>
                            <p className="text-sm text-brand-500">Drop image or click to upload</p>
                            <p className="text-xs text-brand-400 mt-1">PNG or JPG</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Attorneys / Signers section */}
                  <div className="pt-3 border-t border-surface-200 mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-brand-600">Attorneys / Signers</label>
                      <button
                        onClick={() => {
                          const attorneys = Array.isArray(firmConfig.attorneys) ? [...firmConfig.attorneys] : []
                          attorneys.push({ name: '', barLabel: 'NV Bar No.', barNo: '' })
                          setFirmConfig(prev => ({ ...prev, attorneys }))
                        }}
                        className="text-xs text-accent-600 hover:text-accent-800 font-medium"
                      >
                        + Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(Array.isArray(firmConfig.attorneys) ? firmConfig.attorneys : []).map((attorney: { name: string; barNo: string; barLabel?: string }, i: number) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            value={attorney.name || ''}
                            onChange={(e) => {
                              const attorneys = [...(firmConfig.attorneys || [])]
                              attorneys[i] = { ...attorneys[i], name: e.target.value }
                              setFirmConfig(prev => ({ ...prev, attorneys }))
                            }}
                            placeholder="Attorney Name, Esq."
                            className="flex-1 border border-surface-200 rounded-lg px-3 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-accent-500"
                          />
                          <select
                            value={attorney.barLabel || 'NV Bar No.'}
                            onChange={(e) => {
                              const attorneys = [...(firmConfig.attorneys || [])]
                              attorneys[i] = { ...attorneys[i], barLabel: e.target.value }
                              setFirmConfig(prev => ({ ...prev, attorneys }))
                            }}
                            className="w-40 border border-surface-200 rounded-lg px-2 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-accent-500"
                          >
                            <option value="NV Bar No.">NV Bar No.</option>
                            <option value="Nevada License #">Nevada License #</option>
                          </select>
                          <input
                            value={attorney.barNo || ''}
                            onChange={(e) => {
                              const attorneys = [...(firmConfig.attorneys || [])]
                              attorneys[i] = { ...attorneys[i], barNo: e.target.value }
                              setFirmConfig(prev => ({ ...prev, attorneys }))
                            }}
                            placeholder="Number"
                            className="w-24 border border-surface-200 rounded-lg px-3 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-accent-500"
                          />
                          <button
                            onClick={() => {
                              const attorneys = (firmConfig.attorneys || []).filter((_: unknown, idx: number) => idx !== i)
                              setFirmConfig(prev => ({ ...prev, attorneys }))
                            }}
                            className="p-1 text-brand-400 hover:text-red-500 transition-colors"
                          >
                            <XMarkIcon />
                          </button>
                          {i === 0 && (
                            <span className="text-[10px] text-brand-400 whitespace-nowrap">Primary</span>
                          )}
                        </div>
                      ))}
                      {(!Array.isArray(firmConfig.attorneys) || firmConfig.attorneys.length === 0) && (
                        <p className="text-xs text-brand-400 italic">No attorneys added</p>
                      )}
                    </div>
                  </div>

                  {/* Packet Templates section (auto-detected from doc-templates) */}
                  <div className="pt-3 border-t border-surface-200 mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-brand-600">Packet Templates</label>
                      <span className="text-[10px] text-brand-400">Auto-detected from uploads</span>
                    </div>
                    <div className="space-y-1">
                      {packetTemplates.map(t => (
                        <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-surface-200 bg-white">
                          <div>
                            <p className="text-sm text-brand-800">{t.name}</p>
                            <p className="text-[11px] text-brand-400">{t.heading}{t.builtIn ? ' (Built-in)' : ''}</p>
                          </div>
                        </div>
                      ))}
                      {packetTemplates.length === 0 && (
                        <p className="text-xs text-brand-400 italic">Loading templates...</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setShowFirmConfig(false)}
                    className="px-4 py-2 text-sm text-brand-500 hover:text-brand-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveFirmConfig}
                    disabled={firmConfigSaving}
                    className="px-4 py-2 text-sm bg-brand-900 text-white rounded-lg hover:bg-brand-800
                               disabled:opacity-50 transition-colors"
                  >
                    {firmConfigSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <TeamManager
                  apiUrl={apiUrl}
                  firmRoot={firmRoot}
                  userEmail={userEmail || ''}
                  canManageTeam={teamContext?.permissions?.canManageTeam || false}
                  onClose={() => setShowFirmConfig(false)}
                />
                <div className="px-6 pb-6 flex justify-end border-t border-surface-100 pt-4">
                  <button
                    onClick={() => { setShowFirmConfig(false); loadTeamMembers() }}
                    className="px-4 py-2 text-sm bg-brand-900 text-white rounded-lg hover:bg-brand-800 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Batch indexing progress modal */}
      {batchProgress && showBatchModal && (
        <div
          className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => { if (batchProgress.isRunning) setShowBatchModal(false) }}
        >
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-surface-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-brand-900">
                    {batchProgress.isRunning ? 'Indexing Cases...' : 'Indexing Complete'}
                  </h2>
                  <p className="text-sm text-brand-500 mt-0.5">
                    {batchProgress.totalCases} case{batchProgress.totalCases !== 1 ? 's' : ''}
                    {batchProgress.filesTotal > 0 && ` • ${batchProgress.filesComplete}/${batchProgress.filesTotal} files`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (batchProgress.isRunning) {
                      setShowBatchModal(false)
                    } else {
                      setBatchProgress(null)
                      setShowBatchModal(false)
                    }
                  }}
                  className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
                >
                  <XMarkIcon />
                </button>
              </div>

              {/* Progress bar */}
              {batchProgress.filesTotal > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-brand-500 mb-1.5">
                    <span>{batchProgress.currentFile || (batchProgress.isRunning ? 'Processing...' : 'Complete')}</span>
                    <span>{Math.round((batchProgress.filesComplete / batchProgress.filesTotal) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-surface-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-500 rounded-full transition-all duration-300"
                      style={{ width: `${(batchProgress.filesComplete / batchProgress.filesTotal) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4 bg-brand-950 font-mono text-xs">
              {batchProgress.logs.map((log, i) => {
                const isResult = log.startsWith('  →')
                const isTask = log.startsWith('Task:')
                const isReading = log.startsWith('Reading:')
                const isWriting = log.startsWith('Writing:')
                return (
                  <div key={i} className={`py-0.5 ${isResult ? 'text-brand-400 pl-4' : isTask ? 'text-amber-400' : isReading || isWriting ? 'text-cyan-400' : 'text-emerald-400'}`}>
                    {!isResult && <span className="text-brand-600 mr-2 select-none">$</span>}
                    {log}
                  </div>
                )
              })}
              {batchProgress.isRunning && (
                <div className="text-emerald-400 py-0.5">
                  <span className="text-brand-600 mr-2 select-none">$</span>
                  {batchProgress.currentText || 'Working...'}
                  <span className="ml-1 animate-pulse">_</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-surface-200 flex justify-end gap-3 bg-surface-50">
              {batchProgress.isRunning ? (
                <>
                  <div className="flex items-center gap-3 text-sm text-brand-600 mr-auto">
                    <div className="w-4 h-4 border-2 border-accent-600 border-t-transparent rounded-full animate-spin"></div>
                    Processing...
                  </div>
                  <button
                    onClick={() => setShowBatchModal(false)}
                    className="px-4 py-2 text-sm text-brand-500 hover:text-brand-700 transition-colors"
                  >
                    Minimize
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setBatchProgress(null); setShowBatchModal(false) }}
                  className="px-5 py-2.5 bg-brand-900 text-white rounded-lg hover:bg-brand-800
                             font-medium transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
