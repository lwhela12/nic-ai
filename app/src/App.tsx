import { useState, useEffect, useRef, useCallback } from 'react'
import './index.css'
import FileViewer from './components/FileViewer'
import Chat from './components/Chat'
import Visualizer from './components/Visualizer'
import ResizablePanelLayout from './components/ResizablePanelLayout'
import CaseLoader from './components/CaseLoader'
import FolderPicker from './components/FolderPicker'
import FirmDashboard from './components/FirmDashboard'
import Login from './components/Login'
import TodoDrawer from './components/TodoDrawer'
import ContactCard from './components/ContactCard'

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

// Dev mode - skip auth in Vite dev server
const DEV_MODE = import.meta.env.DEV

interface AuthState {
  authenticated: boolean
  email?: string
  subscriptionStatus?: string
  devMode?: boolean
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
  folders: Record<string, DocumentFolder>
  summary: {
    client: string
    dol: string
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
  }
  issues_found?: string[]
  case_analysis?: string
  needs_review?: NeedsReviewItem[]
  reconciled_values?: Record<string, unknown>
  errata?: ErrataItem[]
  case_notes?: CaseNote[]
  chat_archives?: ChatArchive[]
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

function App() {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [firmRoot, setFirmRoot] = useState<string | null>(() => {
    return localStorage.getItem(FIRM_ROOT_KEY)
  })
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
  const [reviewPrompt, setReviewPrompt] = useState<string>('')
  const [viewDocPath, setViewDocPath] = useState<string | null>(null)
  const [refreshDraftsKey, setRefreshDraftsKey] = useState(0)

  // Contact card state
  const [isContactCardOpen, setIsContactCardOpen] = useState(false)
  const contactButtonRef = useRef<HTMLButtonElement>(null)

  // Todo drawer state (global - accessible from any view)
  const [todos, setTodos] = useState<FirmTodo[]>([])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false)
  const [hasAttemptedGenerate, setHasAttemptedGenerate] = useState(false)
  const [firmChatPrompt, setFirmChatPrompt] = useState<string>('')
  const [forceShowFirmChat, setForceShowFirmChat] = useState(false)

  // Knowledge init state — shown when selecting a firm root without knowledge
  const [showKnowledgeInit, setShowKnowledgeInit] = useState(false)
  const [knowledgeTemplates, setKnowledgeTemplates] = useState<Array<{ id: string; practiceArea: string; jurisdiction: string }>>([])
  const [knowledgeInitLoading, setKnowledgeInitLoading] = useState(false)

  const loadTodos = useCallback(async () => {
    if (!firmRoot) return
    try {
      const res = await fetch(`${API_URL}/api/firm/todos?root=${encodeURIComponent(firmRoot)}`)
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

      // No index - need to initialize the case
      setIsLoading(true)
    }

    loadCaseData()
  }, [caseFolder, documentIndex, isLoading])

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

  const handleKnowledgeInit = async (templateId: string) => {
    if (!firmRoot) return
    setKnowledgeInitLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/knowledge/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, templateId }),
      })
      if (res.ok) {
        setShowKnowledgeInit(false)
      }
    } catch {
      // Ignore
    } finally {
      setKnowledgeInitLoading(false)
    }
  }

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      // In dev mode, skip auth check
      if (DEV_MODE) {
        setAuthState({ authenticated: true, devMode: true, email: 'dev@localhost' })
        setAuthChecked(true)
        return
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/status`)
        if (res.ok) {
          const data = await res.json()
          setAuthState(data)
        } else {
          setAuthState({ authenticated: false })
        }
      } catch {
        setAuthState({ authenticated: false })
      }
      setAuthChecked(true)
    }
    checkAuth()
  }, [])

  // Save firm root to localStorage and check for knowledge base
  useEffect(() => {
    if (firmRoot) {
      localStorage.setItem(FIRM_ROOT_KEY, firmRoot)

      // Check if knowledge base exists for this firm root
      fetch(`${API_URL}/api/knowledge/manifest?root=${encodeURIComponent(firmRoot)}`)
        .then(res => {
          if (!res.ok) {
            // No knowledge — fetch templates and show init modal
            return fetch(`${API_URL}/api/knowledge/templates`)
              .then(r => r.json())
              .then(data => {
                setKnowledgeTemplates(data)
                setShowKnowledgeInit(true)
              })
          }
          // Knowledge exists — nothing to do
        })
        .catch(() => {})
    }
  }, [firmRoot])

  const handleShowFile = useCallback((filePath: string) => {
    if (!caseFolder) return
    // Try to find the file in the document index to get the correct path
    let resolvedPath = filePath
    const filename = filePath.split('/').pop()?.toLowerCase() || filePath.toLowerCase()

    if (documentIndex?.folders) {
      // Search through all folders to find matching file
      for (const [folder, data] of Object.entries(documentIndex.folders)) {
        const files = getFolderFiles(data)
        const match = files.find((file) => {
          const matchName = getDocumentFileName(file)?.toLowerCase()
          if (!matchName) return false
          const trimmed = filename.replace('.pdf', '')
          return matchName === filename || matchName.includes(trimmed)
        })
        if (match) {
          const matchName = getDocumentFileName(match)
          if (matchName) {
            resolvedPath = folder === '.' || folder === '' ? matchName : `${folder}/${matchName}`
          }
          break
        }
      }
    }

    const url = `${API_URL}/api/files/view?case=${encodeURIComponent(caseFolder)}&path=${encodeURIComponent(resolvedPath)}`
    setFileViewUrl(url)
    setFileViewName(resolvedPath.split('/').pop() || resolvedPath)
    setViewContent('')
  }, [caseFolder, documentIndex])

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
  }

  // Handle login success
  const handleLoginSuccess = (email: string, subscriptionStatus: string) => {
    setAuthState({
      authenticated: true,
      email,
      subscriptionStatus,
    })
  }

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="animate-pulse text-brand-400">Loading...</div>
      </div>
    )
  }

  // Show login screen if not authenticated (and not in dev mode)
  if (!DEV_MODE && (!authState || !authState.authenticated)) {
    return <Login apiUrl={API_URL} onLoginSuccess={handleLoginSuccess} />
  }

  const handleCaseSelect = (folder: string) => {
    // Just set the folder - the useEffect will handle loading the case data
    setCaseFolder(folder)
  }

  const handleInitComplete = (index: DocumentIndex) => {
    setDocumentIndex(index)
    setIsLoading(false)
    if (caseFolder) loadGeneratedDocs(caseFolder)
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
            <h1 className="font-serif text-3xl text-brand-900">Claude PI</h1>
          </div>
          <p className="text-brand-500 mb-8">Personal Injury Case Management</p>

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
                Choose the folder containing all your case files
              </p>
            </div>
          </button>

          <p className="text-xs text-brand-400 text-center mt-6">
            Your cases are stored locally and never uploaded
          </p>
        </div>

        {showPicker && (
          <FolderPicker
            apiUrl={API_URL}
            onSelect={(path) => {
              setShowPicker(false)
              setFirmRoot(path)
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
    return (
      <>
        <FirmDashboard
          apiUrl={API_URL}
          firmRoot={firmRoot}
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
        />
        {showPicker && (
          <FolderPicker
            apiUrl={API_URL}
            onSelect={(path) => {
              setShowPicker(false)
              setFirmRoot(path)
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
      </>
    )
  }

  // Loading / initializing screen
  if (isLoading && !documentIndex) {
    return (
      <CaseLoader
        caseFolder={caseFolder}
        onComplete={handleInitComplete}
        apiUrl={API_URL}
      />
    )
  }

  // Main three-panel layout
  return (
    <div className="h-screen flex flex-col bg-surface-50">
      {/* Header */}
      <header className="bg-brand-900 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
              <ScaleIcon />
            </div>
            <div>
              <h1 className="font-serif text-xl tracking-tight">
                {documentIndex?.summary?.client || documentIndex?.case_name || caseFolder?.split('/').pop() || 'Case'}
              </h1>
              <div className="flex items-center gap-3 text-sm text-brand-300">
                <span>DOL: {documentIndex?.summary?.dol || '—'}</span>
                <span className="text-brand-500">•</span>
                <span className="text-accent-400 font-medium">
                  {documentIndex?.summary?.total_charges || '—'} in specials
                </span>
              </div>
            </div>
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
                           bg-amber-500 text-white hover:bg-amber-600 transition-colors
                           animate-pulse hover:animate-none"
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
                className="flex items-center gap-2 text-sm text-brand-300 hover:text-white
                           transition-colors px-3 py-2 rounded-lg hover:bg-white/10"
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
                contact={documentIndex?.summary?.contact}
                policyLimits={documentIndex?.summary?.policy_limits as Record<string, string> | string | undefined}
                healthInsurance={documentIndex?.summary?.health_insurance}
                claimNumbers={documentIndex?.summary?.claim_numbers}
              />
            </div>
            {/* Tasks button */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="relative flex items-center gap-2 text-sm text-brand-300 hover:text-white
                         transition-colors px-3 py-2 rounded-lg hover:bg-white/10"
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
              className="flex items-center gap-2 text-sm text-brand-300 hover:text-white
                         transition-colors px-3 py-2 rounded-lg hover:bg-white/10"
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
            onDocSelect={(doc, docPath) => {
              setFileViewUrl(null)
              handleViewUpdate(doc, docPath)
            }}
            onFileView={(url, filename) => {
              setViewContent('')
              setFileViewUrl(url)
              setFileViewName(filename)
            }}
          />
        }
        centerPanel={
          <Chat
            caseFolder={caseFolder}
            apiUrl={API_URL}
            onViewUpdate={handleViewUpdate}
            initialPrompt={reviewPrompt}
            onInitialPromptUsed={() => setReviewPrompt('')}
            onIndexMayHaveChanged={reloadDocumentIndex}
            onDraftsMayHaveChanged={() => setRefreshDraftsKey(k => k + 1)}
            onShowFile={handleShowFile}
          />
        }
        rightPanel={
          <Visualizer
            content={viewContent}
            docPath={viewDocPath}
            fileUrl={fileViewUrl}
            fileName={fileViewName}
            caseFolder={caseFolder}
            apiUrl={API_URL}
            documentIndex={documentIndex}
            firmRoot={firmRoot || undefined}
            onCloseFile={() => setFileViewUrl(null)}
            onIndexUpdated={reloadDocumentIndex}
            onDraftsUpdated={() => loadGeneratedDocs(caseFolder)}
            refreshDraftsKey={refreshDraftsKey}
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

      {/* Knowledge init modal — shown when firm root has no knowledge base */}
      {showKnowledgeInit && <KnowledgeInitModal />}
    </div>
  )

  function KnowledgeInitModal() {
    return (
      <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-elevated w-full max-w-md p-6">
          <h2 className="text-lg font-semibold text-brand-900 mb-2">Set Up Practice Knowledge</h2>
          <p className="text-sm text-brand-500 mb-5">
            Choose a practice area to initialize the knowledge base for this folder. You can customize sections after setup.
          </p>
          <div className="space-y-3">
            {knowledgeTemplates.map(t => (
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
