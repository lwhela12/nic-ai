import { useState, useEffect, useCallback } from 'react'
import FirmChat from './FirmChat'
import KnowledgeEditor from './KnowledgeEditor'
import KnowledgeChat from './KnowledgeChat'
import TemplateManager from './TemplateManager'
import TeamManager from './TeamManager'
import CaseAssignmentDropdown from './CaseAssignmentDropdown'

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
type AssignmentFilter = 'all' | 'mine' | 'unassigned'

interface TeamMember {
  id: string
  email: string
  name: string
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
}

interface FirmData {
  root: string
  cases: CaseSummary[]
  summary: {
    total: number
    indexed: number
    needsAttention: number
  }
}

interface Props {
  apiUrl: string
  firmRoot: string
  practiceArea: PracticeArea
  onSelectCase: (casePath: string) => void
  onChangeFirmRoot: () => void
  onChangePracticeArea: (pa: PracticeArea) => void
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
    }
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

type SortField = 'name' | 'phase' | 'sol' | 'specials'

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

const ExclamationIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
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

export default function FirmDashboard({
  apiUrl, firmRoot, practiceArea, onSelectCase, onChangeFirmRoot, onChangePracticeArea, userEmail, onLogout,
  todos, onDrawerOpen, onTodosUpdated,
  firmChatPrompt, forceShowFirmChat, onFirmChatPromptUsed,
  knowledgeVersion,
  teamContext
}: Props) {
  const isWC = practiceArea === 'Workers\' Compensation'
  const [firmData, setFirmData] = useState<FirmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('sol')
  const [filterPhase, setFilterPhase] = useState<string>('all')
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
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
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set())
  const [knowledgeExists, setKnowledgeExists] = useState<boolean | null>(null)
  const [showFirmConfig, setShowFirmConfig] = useState(false)
  const [firmConfig, setFirmConfig] = useState<Record<string, string>>({})
  const [firmConfigSaving, setFirmConfigSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoDragOver, setLogoDragOver] = useState(false)

  // Team management state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [settingsTab, setSettingsTab] = useState<'firm' | 'team'>('firm')
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all')

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
    setLoading(true)
    setError(null)
    try {
      const practiceAreaParam = isWC ? 'WC' : 'PI'
      const res = await fetch(`${apiUrl}/api/firm/cases?root=${encodeURIComponent(firmRoot)}&practiceArea=${practiceAreaParam}`)
      if (!res.ok) throw new Error('Failed to load cases')
      const data = await res.json()
      setFirmData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cases')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, firmRoot, isWC])

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

  useEffect(() => {
    loadCases()
    loadTeamMembers()
  }, [loadCases, loadTeamMembers])

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

    try {
      const res = await fetch(`${apiUrl}/api/firm/batch-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, cases: casePaths, practiceArea })
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

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

              if (data.type === 'done') {
                setBatchProgress(prev => prev ? {
                  ...prev,
                  isRunning: false,
                  logs: [...prev.logs, data.success ? 'Batch indexing complete!' : 'Batch indexing finished with errors']
                } : prev)
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
      }

      await loadCases()
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
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    } catch {
      return dateStr
    }
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
    return (
      <div className="flex flex-col gap-1">
        {hearings.map((h, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${
              h.hearing_level === 'A.O.'
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {h.hearing_level || 'H.O.'}
            </span>
            <span className="text-xs text-brand-600">{h.case_number}</span>
          </div>
        ))}
      </div>
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
    .filter(c => filterPhase === 'all' || c.casePhase === filterPhase)
    .filter(c => {
      // Assignment filter
      if (assignmentFilter === 'all') return true
      if (assignmentFilter === 'unassigned') return !c.assignments || c.assignments.length === 0
      if (assignmentFilter === 'mine' && teamContext?.userId) {
        return c.assignments?.some(a => a.userId === teamContext.userId)
      }
      return true
    })
    .sort((a, b) => {
      switch (sortField) {
        case 'name':
          return (a.clientName || a.name).localeCompare(b.clientName || b.name)
        case 'phase':
          return (a.casePhase || '').localeCompare(b.casePhase || '')
        case 'sol':
          if (a.solDaysRemaining === undefined && b.solDaysRemaining === undefined) return 0
          if (a.solDaysRemaining === undefined) return 1
          if (b.solDaysRemaining === undefined) return -1
          return a.solDaysRemaining - b.solDaysRemaining
        case 'specials':
          return (b.totalSpecials || 0) - (a.totalSpecials || 0)
        default:
          return 0
      }
    }) || []

  const phases = [...new Set(firmData?.cases.map(c => c.casePhase).filter(Boolean))]

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
      <div className="bg-brand-900 text-white px-8 py-6">
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
          <div className="flex gap-3">
            {selectedCases.size > 0 ? (
              <button
                onClick={() => {
                  const paths = Array.from(selectedCases)
                  setSelectedCases(new Set())
                  startBatchIndex(paths)
                }}
                disabled={batchProgress?.isRunning}
                className="px-4 py-2 text-sm font-medium bg-accent-600 text-white rounded-lg
                           hover:bg-accent-500 disabled:opacity-50 transition-colors"
              >
                {batchProgress?.isRunning ? 'Indexing...' : `Index Selected (${selectedCases.size})`}
              </button>
            ) : unindexedCases.length > 0 ? (
              <button
                onClick={() => startBatchIndex(unindexedCases.map(c => c.path))}
                disabled={batchProgress?.isRunning}
                className="px-4 py-2 text-sm font-medium bg-accent-600 text-white rounded-lg
                           hover:bg-accent-500 disabled:opacity-50 transition-colors"
              >
                {batchProgress?.isRunning ? 'Indexing...' : `Index All (${unindexedCases.length})`}
              </button>
            ) : null}
            <button
              onClick={loadCases}
              className="p-2 text-brand-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
            <button
              onClick={onChangeFirmRoot}
              className="px-4 py-2 text-sm text-brand-300 hover:text-white hover:bg-white/10
                         rounded-lg transition-colors flex items-center gap-2"
            >
              <FolderIcon />
              <span>Change Folder</span>
            </button>
            {/* Practice Area toggle */}
            <div className="flex bg-white/10 rounded-lg p-1 ml-2">
              <button
                onClick={() => onChangePracticeArea('Personal Injury')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !isWC
                    ? 'bg-white text-brand-900'
                    : 'text-brand-300 hover:text-white'
                }`}
              >
                PI
              </button>
              <button
                onClick={() => onChangePracticeArea('Workers\' Compensation')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  isWC
                    ? 'bg-white text-brand-900'
                    : 'text-brand-300 hover:text-white'
                }`}
              >
                WC
              </button>
            </div>
            {/* View toggle */}
            <div className="flex bg-white/10 rounded-lg p-1 ml-2">
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
            {/* Tasks drawer toggle */}
            <button
              onClick={onDrawerOpen}
              className="relative p-2 text-brand-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-2"
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

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-6">
          <div className="bg-white/10 backdrop-blur rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">Active Cases</p>
                <p className="text-4xl font-serif text-white mt-1">{firmData?.summary.indexed || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircleIcon />
              </div>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">
                  {isWC ? 'Open Hearings' : 'SOL < 90 Days'}
                </p>
                <p className="text-4xl font-serif text-white mt-1">{firmData?.summary.needsAttention || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400">
                <ExclamationIcon />
              </div>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">Not Indexed</p>
                <p className="text-4xl font-serif text-white mt-1">{(firmData?.summary.total || 0) - (firmData?.summary.indexed || 0)}</p>
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
              onClick={() => { loadFirmConfig(); loadFirmLogo(); loadTeamMembers(); setShowFirmConfig(true) }}
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
                ? <KnowledgeEditor apiUrl={apiUrl} firmRoot={firmRoot} />
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
          onTodosUpdated={onTodosUpdated}
          initialPrompt={firmChatPrompt}
          onInitialPromptUsed={onFirmChatPromptUsed}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="bg-white border-b border-surface-200 px-8 py-4 flex gap-6 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-brand-600">Sort by</label>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="text-sm border border-surface-200 rounded-lg px-3 py-2 bg-white
                           focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              >
                {isWC ? (
                  <>
                    <option value="name">Client Name</option>
                    <option value="phase">Case Phase</option>
                    <option value="specials">Total Medical</option>
                  </>
                ) : (
                  <>
                    <option value="sol">SOL Urgency</option>
                    <option value="name">Client Name</option>
                    <option value="phase">Case Phase</option>
                    <option value="specials">Total Specials</option>
                  </>
                )}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-brand-600">Phase</label>
              <select
                value={filterPhase}
                onChange={(e) => setFilterPhase(e.target.value)}
                className="text-sm border border-surface-200 rounded-lg px-3 py-2 bg-white
                           focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              >
                <option value="all">All Phases</option>
                {phases.map(phase => (
                  <option key={phase} value={phase}>{phase}</option>
                ))}
              </select>
            </div>
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
                </select>
              </div>
            )}
            <div className="ml-auto text-sm text-brand-500">
              {sortedCases.filter(c => !c.isContainer).length} case{sortedCases.filter(c => !c.isContainer).length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Cases table */}
          <div className="flex-1 overflow-auto px-8 py-6">
        <div className="bg-white rounded-xl shadow-card border border-surface-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-200">
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={sortedCases.filter(c => !c.isContainer).length > 0 && sortedCases.filter(c => !c.isContainer).every(c => selectedCases.has(c.path))}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Client</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Phase</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">
                  {isWC ? 'Date of Injury' : 'Date of Loss'}
                </th>
                {isWC ? (
                  <>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Employer</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">TTD Status</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">AMW / Rate</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Hearings</th>
                  </>
                ) : (
                  <>
                    <th className="text-right px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Specials</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Policy Limits</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">SOL</th>
                  </>
                )}
                {teamMembers.length > 0 && (
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Assigned To</th>
                )}
                <th className="text-center px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Status</th>
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
                      <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allDoiCasesSelected}
                          ref={(el) => { if (el) el.indeterminate = someDoiCasesSelected && !allDoiCasesSelected }}
                          onChange={() => toggleCase(c.path, true, c.siblingCases)}
                          className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-3" colSpan={isWC ? 9 : 7}>
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
                    <td className="px-4 py-4 w-10" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedCases.has(c.path)}
                        onChange={() => toggleCase(c.path)}
                        className="w-4 h-4 rounded border-surface-300 text-accent-600 focus:ring-accent-500 cursor-pointer"
                      />
                    </td>
                    <td className={`py-4 ${c.isSubcase || isDOICase ? 'pl-10 pr-6' : 'px-6'}`}>
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
                    <td className="px-6 py-4">{getPhaseBadge(c.casePhase)}</td>
                    <td className="px-6 py-4 text-sm text-brand-600">
                      {isDOICase ? c.injuryDate : formatDate(c.dateOfLoss)}
                    </td>
                    {isWC ? (
                      <>
                        <td className="px-6 py-4 text-sm text-brand-600">{c.employer || '—'}</td>
                        <td className="px-6 py-4">{getTTDStatusBadge(c.ttdStatus)}</td>
                        <td className="px-6 py-4 text-sm text-brand-600 tabular-nums">{formatAMW(c.amw, c.compensationRate)}</td>
                        <td className="px-6 py-4 text-sm text-brand-600">{formatHearings(c.openHearings)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-sm text-brand-900 text-right font-semibold tabular-nums">
                          {formatCurrency(c.totalSpecials)}
                        </td>
                        <td className="px-6 py-4 text-sm text-brand-600">{formatPolicyLimits(c.policyLimits)}</td>
                        <td className="px-6 py-4">{getSolBadge(c.solDaysRemaining)}</td>
                      </>
                    )}
                    {teamMembers.length > 0 && (
                      <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                        <CaseAssignmentDropdown
                          casePath={c.path}
                          assignments={c.assignments || []}
                          teamMembers={teamMembers}
                          userEmail={userEmail || ''}
                          canAssign={teamContext?.permissions?.canAssignCases || false}
                          onAssignmentChange={(newAssignments) => {
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
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center">
                        {!c.indexed ? (
                          <span className="text-xs text-brand-400">Not indexed</span>
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
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-lg overflow-hidden">
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
              <div className="p-6">
                <div className="space-y-3">
                  {[
                    { key: 'firmName', label: 'Firm Name' },
                    { key: 'address', label: 'Address' },
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
      {batchProgress && (
        <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
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
                {!batchProgress.isRunning && (
                  <button
                    onClick={() => setBatchProgress(null)}
                    className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
                  >
                    <XMarkIcon />
                  </button>
                )}
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

            <div className="px-6 py-4 border-t border-surface-200 flex justify-end bg-surface-50">
              {batchProgress.isRunning ? (
                <div className="flex items-center gap-3 text-sm text-brand-600">
                  <div className="w-4 h-4 border-2 border-accent-600 border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </div>
              ) : (
                <button
                  onClick={() => setBatchProgress(null)}
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
