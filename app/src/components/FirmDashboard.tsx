import { useState, useEffect, useCallback } from 'react'
import FirmChat from './FirmChat'

interface FirmTodo {
  id: string
  text: string
  caseRef?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'completed'
  createdAt: string
}

interface CaseSummary {
  path: string
  name: string
  indexed: boolean
  indexedAt?: string
  clientName?: string
  casePhase?: string
  dateOfLoss?: string
  totalSpecials?: number
  policyLimits?: string | Record<string, unknown>
  statuteOfLimitations?: string
  solDaysRemaining?: number
  needsReindex?: boolean
  providers?: string[]
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

const ClipboardDocumentListIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
)

export default function FirmDashboard({
  apiUrl, firmRoot, onSelectCase, onChangeFirmRoot, userEmail, onLogout,
  todos, onDrawerOpen, onTodosUpdated,
  firmChatPrompt, forceShowFirmChat, onFirmChatPromptUsed
}: Props) {
  const [firmData, setFirmData] = useState<FirmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('sol')
  const [filterPhase, setFilterPhase] = useState<string>('all')
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [view, setView] = useState<'dashboard' | 'firmChat'>('dashboard')

  const loadCases = useCallback(async () => {
    setLoading(true)
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
  }, [apiUrl, firmRoot])

  useEffect(() => {
    loadCases()
  }, [loadCases])

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
        body: JSON.stringify({ root: firmRoot, cases: casePaths })
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

  const unindexedCases = firmData?.cases.filter(c => !c.indexed) || []

  const formatCurrency = (amount?: number) => {
    if (amount === undefined) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    } catch {
      return dateStr
    }
  }

  const formatPolicyLimits = (limits?: string | Record<string, unknown>): React.ReactNode => {
    if (!limits) return '—'
    if (typeof limits === 'string') return limits

    const formatNum = (n: number) => '$' + n.toLocaleString()

    const extractPrimary = (val: unknown): string | null => {
      if (typeof val === 'string') return val.length > 30 ? val.slice(0, 27) + '…' : val
      if (typeof val === 'number') return formatNum(val)
      if (typeof val === 'object' && val !== null) {
        const obj = val as Record<string, unknown>
        for (const k of ['bodily_injury', 'bodily_injury_per_person', 'bi', 'bi_limit', 'bodily_injury_settlement']) {
          const v = obj[k]
          if (typeof v === 'string') return v
          if (typeof v === 'number') return formatNum(v)
        }
        for (const v of Object.values(obj)) {
          if (typeof v === 'string' && v.includes('$')) return v
        }
      }
      return null
    }

    const is3P = (key: string) => {
      const k = key.toLowerCase()
      return k.startsWith('3p') || k.includes('third_party') || k.includes('third')
    }
    const is1P = (key: string) => {
      const k = key.toLowerCase()
      return k.startsWith('1p') || k.includes('first_party') || k.includes('first')
    }

    let thirdParty: string | null = null
    let firstParty: string | null = null

    if (typeof limits === 'object') {
      for (const [key, val] of Object.entries(limits)) {
        if (!thirdParty && is3P(key)) thirdParty = extractPrimary(val)
        if (!firstParty && is1P(key)) firstParty = extractPrimary(val)
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

  const getPhaseBadge = (phase?: string) => {
    const colors: Record<string, string> = {
      'Intake': 'bg-surface-100 text-brand-600',
      'Investigation': 'bg-blue-50 text-blue-700',
      'Treatment': 'bg-purple-50 text-purple-700',
      'Demand': 'bg-orange-50 text-orange-700',
      'Negotiation': 'bg-yellow-50 text-yellow-700',
      'Settlement': 'bg-emerald-50 text-emerald-700',
      'Complete': 'bg-emerald-50 text-emerald-700',
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
              <h1 className="font-serif text-2xl tracking-tight">Case Dashboard</h1>
              <p className="text-sm text-brand-300 mt-0.5">{firmRoot}</p>
            </div>
          </div>
          <div className="flex gap-3">
            {unindexedCases.length > 0 && (
              <button
                onClick={() => startBatchIndex(unindexedCases.map(c => c.path))}
                disabled={batchProgress?.isRunning}
                className="px-4 py-2 text-sm font-medium bg-accent-600 text-white rounded-lg
                           hover:bg-accent-500 disabled:opacity-50 transition-colors"
              >
                {batchProgress?.isRunning ? 'Indexing...' : `Index All (${unindexedCases.length})`}
              </button>
            )}
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
                <p className="text-sm font-medium text-brand-300 uppercase tracking-wide">SOL {'<'} 90 Days</p>
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

      {view === 'firmChat' ? (
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
                <option value="sol">SOL Urgency</option>
                <option value="name">Client Name</option>
                <option value="phase">Case Phase</option>
                <option value="specials">Total Specials</option>
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
            <div className="ml-auto text-sm text-brand-500">
              {sortedCases.length} case{sortedCases.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Cases table */}
          <div className="flex-1 overflow-auto px-8 py-6">
        <div className="bg-white rounded-xl shadow-card border border-surface-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-200">
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Client</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Phase</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Date of Loss</th>
                <th className="text-right px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Specials</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Policy Limits</th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">SOL</th>
                <th className="text-center px-6 py-4 text-xs font-semibold text-brand-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {sortedCases.map((c) => (
                <tr
                  key={c.path}
                  onClick={() => c.indexed && onSelectCase(c.path)}
                  className={`group ${c.indexed
                    ? 'hover:bg-surface-50 cursor-pointer border-l-2 border-l-transparent hover:border-l-accent-500'
                    : 'bg-surface-50/50 opacity-60'} transition-all`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium text-brand-900">{c.clientName || c.name}</div>
                        <div className="text-xs text-brand-400 mt-0.5">{c.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">{getPhaseBadge(c.casePhase)}</td>
                  <td className="px-6 py-4 text-sm text-brand-600">{formatDate(c.dateOfLoss)}</td>
                  <td className="px-6 py-4 text-sm text-brand-900 text-right font-semibold tabular-nums">
                    {formatCurrency(c.totalSpecials)}
                  </td>
                  <td className="px-6 py-4 text-sm text-brand-600">{formatPolicyLimits(c.policyLimits)}</td>
                  <td className="px-6 py-4">{getSolBadge(c.solDaysRemaining)}</td>
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
              ))}
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
