import { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  caseFolder: string
  apiUrl: string
  onViewUpdate: (content: string) => void
  initialPrompt?: string
  onInitialPromptUsed?: () => void
  onIndexMayHaveChanged?: () => void
  onDraftsMayHaveChanged?: () => void
  onShowFile?: (filePath: string) => void
}

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
  isView?: boolean
  tools?: string[]
}

interface ChatArchive {
  id: string
  date: string
  summary: string
  messageCount: number
  file: string
}

interface IndexStatus {
  needsIndex: boolean
  reason: string
  newFiles: string[]
  modifiedFiles: string[]
  message: string
}

// Icons
const DocumentIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const MagnifyingGlassIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
)

const PencilSquareIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
)

const CalculatorIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" />
  </svg>
)

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const ArchiveBoxIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
)

const ChevronUpIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
  </svg>
)

const CurrencyDollarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const PaperAirplaneIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
)

// Static data moved outside component to prevent recreation on every render
const quickActions = [
  { label: 'Case Memo', prompt: 'Generate a case memo summarizing this case', icon: DocumentIcon },
  { label: 'Gap Analysis', prompt: 'Identify missing documents and gaps in this case', icon: MagnifyingGlassIcon },
  { label: 'Draft Demand', prompt: 'Draft a demand letter for this case', icon: PencilSquareIcon },
  { label: 'Settlement Calc', prompt: 'Calculate the settlement disbursement', icon: CalculatorIcon },
  { label: 'Timeline', prompt: 'Show me a timeline of this case', icon: ClockIcon },
  { label: 'Financials', prompt: 'Show me a financial breakdown of medical expenses', icon: CurrencyDollarIcon },
]

const ExclamationTriangleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const WrenchIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
  </svg>
)

// Regex to match [[SHOW_FILE: path]] syntax
const SHOW_FILE_REGEX = /\[\[SHOW_FILE:\s*([^\]]+)\]\]/g

// Parse content and extract SHOW_FILE commands
function parseShowFileCommands(content: string): { displayContent: string; filePaths: string[] } {
  const filePaths: string[] = []
  const displayContent = content.replace(SHOW_FILE_REGEX, (_, path) => {
    const trimmedPath = path.trim()
    filePaths.push(trimmedPath)
    const fileName = trimmedPath.split('/').pop() || trimmedPath
    return `📄 **[${fileName}]**`
  })
  return { displayContent, filePaths }
}

// Memoized message component to prevent re-rendering Markdown on input changes
const MessageItem = memo(function MessageItem({ msg, onShowFile }: { msg: Message; onShowFile?: (path: string) => void }) {
  // Parse SHOW_FILE commands from assistant messages
  const { displayContent, filePaths } = useMemo(
    () => parseShowFileCommands(msg.content),
    [msg.content]
  )

  // Trigger file display for the first file found (only on mount, not on every re-render)
  const hasTriggeredRef = useRef(false)
  useEffect(() => {
    if (!hasTriggeredRef.current && filePaths.length > 0 && onShowFile) {
      hasTriggeredRef.current = true
      onShowFile(filePaths[0])
    }
  }, [filePaths, onShowFile])

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-brand-900 text-white rounded-2xl rounded-tr-md px-5 py-3">
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="flex gap-3 max-w-[85%]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-700 to-brand-900
                        flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
          AI
        </div>
        <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
          {msg.isView ? (
            <p className="text-sm text-brand-500 italic flex items-center gap-2">
              <DocumentIcon />
              View generated — see right panel
            </p>
          ) : (
            <>
              <div className="text-sm prose prose-sm max-w-none
                              prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                              prose-headings:my-3 prose-headings:text-brand-900
                              prose-table:border-collapse prose-th:border prose-th:border-surface-200
                              prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2
                              prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2
                              prose-a:text-accent-600 prose-a:no-underline hover:prose-a:underline">
                <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
              </div>
              {/* Show clickable file links if files were referenced */}
              {filePaths.length > 0 && onShowFile && (
                <div className="mt-3 pt-3 border-t border-surface-100 flex flex-wrap gap-2">
                  {filePaths.map((path, i) => (
                    <button
                      key={i}
                      onClick={() => onShowFile(path)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium
                                 bg-accent-50 text-accent-700 rounded-lg hover:bg-accent-100 transition-colors"
                    >
                      <DocumentIcon />
                      {path.split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
              {msg.tools && msg.tools.length > 0 && (
                <div className="mt-3 pt-3 border-t border-surface-100 flex items-center gap-2">
                  <WrenchIcon />
                  <p className="text-xs text-brand-400">
                    {msg.tools.join(' → ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

// Summarize conversation when messages exceed this threshold
const MESSAGE_THRESHOLD = 8
// Keep this many recent messages after summarization
const KEEP_RECENT = 2

// Context usage thresholds
const CONTEXT_WARNING_PERCENT = 50  // Yellow warning
const CONTEXT_DANGER_PERCENT = 55   // Red warning, trigger auto-summarize (lowered for earlier prevention)

export default function Chat({ caseFolder, apiUrl, onViewUpdate, initialPrompt, onInitialPromptUsed, onIndexMayHaveChanged, onDraftsMayHaveChanged, onShowFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentTools, setCurrentTools] = useState<string[]>([])
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [conversationSummary, setConversationSummary] = useState<string | null>(null)
  const [contextUsage, setContextUsage] = useState<{ inputTokens: number; outputTokens: number; percent: number } | null>(null)
  const [archives, setArchives] = useState<ChatArchive[]>([])
  const [showArchives, setShowArchives] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const lastUserMessageRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset chat state when switching cases
  useEffect(() => {
    setMessages([])
    setSessionId(null)
    setConversationSummary(null)
    setContextUsage(null)
    setIsLoading(false)
    setCurrentTools([])
    setHistoryLoaded(false)
    setArchives([])
    setShowArchives(false)
  }, [caseFolder])

  // Load chat history when case folder changes
  useEffect(() => {
    if (!caseFolder || historyLoaded) return

    const loadHistory = async () => {
      try {
        // Load active chat history
        const historyRes = await fetch(`${apiUrl}/api/claude/history?case=${encodeURIComponent(caseFolder)}`)
        if (historyRes.ok) {
          const history = await historyRes.json()
          if (history.messages && history.messages.length > 0) {
            setMessages(history.messages)
          }
        }

        // Load archives list
        const archivesRes = await fetch(`${apiUrl}/api/claude/history/archives?case=${encodeURIComponent(caseFolder)}`)
        if (archivesRes.ok) {
          const data = await archivesRes.json()
          setArchives(data.archives || [])
        }
      } catch {
        // Ignore load errors - start fresh
      }
      setHistoryLoaded(true)
    }

    loadHistory()
  }, [caseFolder, apiUrl, historyLoaded])

  // Save chat history whenever messages change (debounced)
  useEffect(() => {
    if (!caseFolder || !historyLoaded || messages.length === 0) return

    const saveHistory = async () => {
      try {
        // Add IDs and timestamps to messages that don't have them
        const messagesWithMeta = messages.map((m, i) => ({
          ...m,
          id: m.id || `msg-${Date.now()}-${i}`,
          timestamp: m.timestamp || new Date().toISOString(),
        }))

        await fetch(`${apiUrl}/api/claude/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseFolder, messages: messagesWithMeta }),
        })
      } catch {
        // Ignore save errors
      }
    }

    // Debounce save - wait for streaming to finish
    const timeout = setTimeout(saveHistory, 1000)
    return () => clearTimeout(timeout)
  }, [messages, caseFolder, apiUrl, historyLoaded])

  // Archive conversation
  const archiveConversation = async () => {
    if (isArchiving || messages.length === 0) return

    setIsArchiving(true)
    try {
      const res = await fetch(`${apiUrl}/api/claude/history/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder }),
      })

      if (res.ok) {
        const data = await res.json()
        // Add new archive to list
        setArchives(prev => [data.archive, ...prev])
        // Clear messages and session
        setMessages([])
        setSessionId(null)
        setConversationSummary(null)
        setContextUsage(null)
      }
    } catch {
      // Ignore archive errors
    }
    setIsArchiving(false)
  }

  // Set input from initialPrompt when provided and auto-send
  useEffect(() => {
    if (initialPrompt && !isLoading) {
      // Auto-send the initial prompt (e.g., from Review Items button)
      onInitialPromptUsed?.()
      // Use setTimeout to ensure state is ready
      setTimeout(() => {
        sendMessage(initialPrompt)
      }, 100)
    }
  }, [initialPrompt]) // eslint-disable-line react-hooks/exhaustive-deps
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [isIndexing, setIsIndexing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const checkIndexStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/files/index-status?case=${encodeURIComponent(caseFolder)}`)
      const data = await res.json()
      setIndexStatus(data)
    } catch {
      // Ignore
    }
  }, [apiUrl, caseFolder])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!caseFolder) return
    checkIndexStatus()
    const interval = setInterval(checkIndexStatus, 30000)
    return () => clearInterval(interval)
  }, [caseFolder, checkIndexStatus])

  const runReindex = async (forceFullReindex = false) => {
    if (isIndexing) return
    setIsIndexing(true)

    try {
      // First check what files need updating (unless forcing full reindex)
      let filesToIndex: string[] | undefined

      if (!forceFullReindex) {
        const statusRes = await fetch(`${apiUrl}/api/files/index-status?case=${encodeURIComponent(caseFolder)}`)
        const status = await statusRes.json()

        if (!status.needsIndex) {
          // Index is already up to date
          setIndexStatus(status)
          setIsIndexing(false)
          return
        }

        // Combine new and modified files for incremental indexing
        const changedFiles = [...(status.newFiles || []), ...(status.modifiedFiles || [])]
        if (changedFiles.length > 0 && status.reason !== 'no_index') {
          filesToIndex = changedFiles
          console.log(`[Incremental] Indexing ${changedFiles.length} changed file(s)`)
        }
      }

      // Use the dedicated /init endpoint which has the explicit schema
      const response = await fetch(`${apiUrl}/api/claude/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          ...(filesToIndex ? { files: filesToIndex } : {})
        }),
      })

      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        decoder.decode(value)
      }

      await checkIndexStatus()
      onIndexMayHaveChanged?.()
    } catch {
      // Ignore
    } finally {
      setIsIndexing(false)
    }
  }

  // Summarize older messages to reduce context size
  const summarizeConversation = async (currentMessages: Message[]) => {
    if (currentMessages.length <= MESSAGE_THRESHOLD) return

    setIsSummarizing(true)

    try {
      // Messages to summarize (all but the most recent)
      const toSummarize = currentMessages.slice(0, -KEEP_RECENT)
      const toKeep = currentMessages.slice(-KEEP_RECENT)

      const response = await fetch(`${apiUrl}/api/claude/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toSummarize.map(m => ({ role: m.role, content: m.content }))
        }),
      })

      const data = await response.json()

      if (data.success && data.summary) {
        // Store the summary
        const newSummary = conversationSummary
          ? `${conversationSummary}\n\n---\n\n${data.summary}`
          : data.summary
        setConversationSummary(newSummary)

        // Replace messages with summary message + recent messages
        const summaryMessage: Message = {
          role: 'assistant',
          content: `*[Conversation summarized]*\n\n${data.summary}`,
          tools: []
        }
        setMessages([summaryMessage, ...toKeep])

        // Clear the session since we're compressing context
        await fetch(`${apiUrl}/api/claude/clear-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseFolder }),
        })
        setSessionId(null)

        console.log(`Summarized ${toSummarize.length} messages, keeping ${toKeep.length} recent`)
      }
    } catch (error) {
      console.error('Summarization failed:', error)
      // Don't fail silently - the conversation will just continue normally
    } finally {
      setIsSummarizing(false)
    }
  }

  const sendMessage = async (overrideMessage?: string, isRetry = false) => {
    const userMessage = (overrideMessage || input).trim()
    if (!userMessage || isLoading) return

    setInput('')
    if (!isRetry) {
      setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    }
    lastUserMessageRef.current = userMessage
    setIsLoading(true)
    setCurrentTools([])
    let compactionDetected = false

    try {
      // Build conversation history for the API (excluding the message we just added)
      const historyForApi = messages
        .filter(m => !m.isView) // Skip view-only messages
        .map(m => ({ role: m.role, content: m.content }))

      // Include conversation summary as context if we have one
      const messageWithContext = conversationSummary
        ? `[Previous conversation summary: ${conversationSummary}]\n\n${userMessage}`
        : userMessage

      // Use direct API chat endpoint (faster, no agent SDK overhead)
      const response = await fetch(`${apiUrl}/api/claude/chat-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, message: messageWithContext, history: historyForApi }),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      let toolsUsed: string[] = []
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

              // Note: chat-v2 doesn't use sessions, so no 'init' event
              if (data.type === 'init' && data.sessionId) {
                setSessionId(data.sessionId)
              }

              if (data.type === 'tool_executing') {
                // Tool is being executed (direct API mode)
                toolsUsed = [...toolsUsed, `${data.name}...`]
                setCurrentTools(toolsUsed)
              }

              if (data.type === 'delegating') {
                // Document agent is taking over
                toolsUsed = [...toolsUsed, '📄 ' + (data.message || 'Generating document...')]
                setCurrentTools(toolsUsed)
              }

              if (data.type === 'status') {
                // Status update from document agent
                toolsUsed = [...toolsUsed, data.message || 'Working...']
                setCurrentTools(toolsUsed)
              }

              if (data.type === 'text') {
                assistantMessage += data.content
                setMessages((prev) => {
                  const updated = [...prev]
                  const lastIdx = updated.length - 1
                  if (updated[lastIdx]?.role === 'assistant') {
                    updated[lastIdx] = { role: 'assistant', content: assistantMessage, tools: toolsUsed }
                  } else {
                    updated.push({ role: 'assistant', content: assistantMessage, tools: toolsUsed })
                  }
                  return updated
                })
              }

              if (data.type === 'tool') {
                toolsUsed = [...toolsUsed, data.name]
                setCurrentTools(toolsUsed)
              }

              if (data.type === 'usage') {
                setContextUsage({
                  inputTokens: data.inputTokens,
                  outputTokens: data.outputTokens,
                  percent: data.contextPercent,
                })
              }

              if (data.type === 'compaction') {
                // Show compaction indicator (SDK is auto-compacting context)
                compactionDetected = true
                setIsCompacting(true)
              }

              if (data.type === 'context_overflow_recovery') {
                // Server detected context overflow, cleared session, and provided a summary
                compactionDetected = false
                setSessionId(null)
                setIsCompacting(false)
                const summary = data.summary || 'Previous conversation context was reset.'
                setConversationSummary(summary)
                setContextUsage(null)

                // Show recovery message to user
                setMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    content: `**Context Reset** - The conversation grew too large and has been reset. Here's a summary of what was discussed:\n\n${summary}\n\n*Retrying your last message...*`,
                  },
                ])

                // Auto-retry the last user message with fresh session
                const retryMsg = lastUserMessageRef.current
                if (retryMsg) {
                  setTimeout(() => sendMessage(retryMsg, true), 500)
                }
              }

              if (data.type === 'done') {
                // chat-v2 doesn't use sessions
                if (data.sessionId) setSessionId(data.sessionId)
                // Update final usage if provided
                if (data.usage) {
                  setContextUsage({
                    inputTokens: data.usage.inputTokens,
                    outputTokens: data.usage.outputTokens,
                    percent: Math.round((data.usage.inputTokens / 200000) * 100),
                  })
                }
                setMessages((prev) => {
                  const updated = [...prev]
                  const lastIdx = updated.length - 1
                  if (updated[lastIdx]?.role === 'assistant') {
                    updated[lastIdx] = { ...updated[lastIdx], tools: toolsUsed.map(t => t.replace('...', '')) }
                  }
                  return updated
                })
                // Check if index-modifying tools were used
                const indexTools = ['Edit', 'Bash', 'update_index', 'write_file']
                if (toolsUsed.some(t => indexTools.some(it => t.includes(it))) && onIndexMayHaveChanged) {
                  onIndexMayHaveChanged()
                }
                // Check if file-writing tools were used or document agent created a file
                const writeTools = ['Write', 'write_file']
                const hasWriteTools = toolsUsed.some(t => writeTools.some(wt => t.includes(wt)))
                const hasDocGenFile = !!data.filePath
                if ((hasWriteTools || hasDocGenFile) && onDraftsMayHaveChanged) {
                  onDraftsMayHaveChanged()
                }
              }

              if (data.type === 'error') {
                const errorMsg = data.error || 'Unknown error'
                setMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: `Error: ${errorMsg}` },
                ])
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      if (assistantMessage.includes('<div') || assistantMessage.includes('<table')) {
        onViewUpdate(assistantMessage)
        setMessages((prev) => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], isView: true }
          }
          return updated
        })
      }

      // Check if we need to summarize based on message count OR context usage
      setMessages((currentMessages) => {
        const shouldSummarizeByCount = currentMessages.length > MESSAGE_THRESHOLD
        const shouldSummarizeByContext = contextUsage && contextUsage.percent >= CONTEXT_DANGER_PERCENT

        if (shouldSummarizeByCount || shouldSummarizeByContext) {
          // Trigger summarization asynchronously
          console.log(`Triggering summarization: messages=${currentMessages.length}, context=${contextUsage?.percent}%`)
          setTimeout(() => summarizeConversation(currentMessages), 100)
        }
        return currentMessages
      })
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error communicating with the agent. Please try again.' },
      ])
    } finally {
      setIsLoading(false)
      setCurrentTools([])
      // If compaction indicator was shown but no recovery event arrived,
      // the session is likely broken - clear it client-side
      if (compactionDetected) {
        setSessionId(null)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '**Session Reset** - Context compaction encountered an issue. Session has been cleared. Please try your message again.',
          },
        ])
        // Clear server-side session too
        fetch(`${apiUrl}/api/claude/clear-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseFolder }),
        }).catch(() => {})
      }
      setIsCompacting(false)
    }
  }

  const clearSession = async () => {
    try {
      await fetch(`${apiUrl}/api/claude/clear-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder }),
      })
      setSessionId(null)
      setMessages([])
      setConversationSummary(null)
      setContextUsage(null) // Reset context tracking
    } catch {
      // Ignore
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Index status banner */}
      {indexStatus?.needsIndex && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
              <ExclamationTriangleIcon />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800">{indexStatus.message}</p>
              {(indexStatus.newFiles.length > 0 || indexStatus.modifiedFiles.length > 0) && (
                <p className="text-xs text-amber-600 mt-0.5">
                  {indexStatus.newFiles.length} new, {indexStatus.modifiedFiles.length} modified
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runReindex()}
              disabled={isIndexing}
              className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white
                         rounded-lg disabled:opacity-50 transition-colors"
              title="Index only new and modified files"
            >
              {isIndexing ? 'Indexing...' : 'Update Index'}
            </button>
            <button
              onClick={() => runReindex(true)}
              disabled={isIndexing}
              className="px-3 py-2 text-sm font-medium bg-surface-200 hover:bg-surface-300 text-brand-700
                         rounded-lg disabled:opacity-50 transition-colors"
              title="Re-index all files from scratch"
            >
              Full
            </button>
          </div>
        </div>
      )}

      {/* Header with session info and quick actions */}
      <div className="px-6 py-4 border-b border-surface-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm">
            {sessionId ? (
              <span className="inline-flex items-center gap-1.5 text-brand-500">
                <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                Session active
              </span>
            ) : (
              <span className="text-brand-400">New conversation</span>
            )}
            {indexStatus && !indexStatus.needsIndex && (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 ml-3">
                <CheckCircleIcon />
                <span>Index current</span>
              </span>
            )}
          </div>
          {/* Context usage indicator */}
          {contextUsage && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-20 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      contextUsage.percent >= CONTEXT_DANGER_PERCENT
                        ? 'bg-red-500'
                        : contextUsage.percent >= CONTEXT_WARNING_PERCENT
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(contextUsage.percent, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-medium ${
                  contextUsage.percent >= CONTEXT_DANGER_PERCENT
                    ? 'text-red-600'
                    : contextUsage.percent >= CONTEXT_WARNING_PERCENT
                    ? 'text-amber-600'
                    : 'text-brand-400'
                }`}>
                  {contextUsage.percent}%
                </span>
              </div>
              <span className="text-xs text-brand-300" title={`${contextUsage.inputTokens.toLocaleString()} tokens`}>
                context
              </span>
            </div>
          )}
          {/* Archive and Clear buttons */}
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={archiveConversation}
                disabled={isArchiving}
                className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-accent-600 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
                title="Archive this conversation"
              >
                <ArchiveBoxIcon />
                <span>{isArchiving ? 'Archiving...' : 'Archive'}</span>
              </button>
            )}
            {sessionId && (
              <button
                onClick={clearSession}
                className="text-sm text-brand-400 hover:text-brand-600 transition-colors"
              >
                Clear session
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => sendMessage(action.prompt)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                         bg-surface-100 text-brand-700
                         hover:bg-brand-900 hover:text-white
                         disabled:opacity-50 transition-colors"
            >
              <action.icon />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Archives Panel (collapsible) */}
      {archives.length > 0 && (
        <div className="border-b border-surface-200 bg-surface-50">
          <button
            onClick={() => setShowArchives(!showArchives)}
            className="w-full px-6 py-2.5 flex items-center justify-between text-sm text-brand-600 hover:bg-surface-100 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ArchiveBoxIcon />
              Past Conversations ({archives.length})
            </span>
            {showArchives ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
          {showArchives && (
            <div className="px-6 pb-4 max-h-48 overflow-y-auto">
              <div className="space-y-2">
                {archives.map((archive) => (
                  <div
                    key={archive.id}
                    className="p-3 bg-white rounded-lg border border-surface-200 hover:border-accent-300 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-700 truncate">
                          {archive.date}
                        </p>
                        <p className="text-xs text-brand-500 mt-0.5 line-clamp-2">
                          {archive.summary}
                        </p>
                      </div>
                      <span className="text-xs text-brand-400 ml-2 shrink-0">
                        {archive.messageCount} msgs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-lg font-medium text-brand-700">Ask anything about this case</p>
            <p className="text-sm text-brand-400 mt-1">
              Try "Generate a case memo" or "What are the total medical expenses?"
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem key={i} msg={msg} onShowFile={onShowFile} />
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-700 to-brand-900
                              flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                AI
              </div>
              <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce [animation-delay:0.3s]" />
                  </div>
                  {currentTools.length > 0 && (
                    <span className="text-xs text-brand-400 flex items-center gap-1.5">
                      <WrenchIcon />
                      {currentTools[currentTools.length - 1]}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {isSummarizing && (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Summarizing conversation to reduce context...
            </div>
          </div>
        )}

        {isCompacting && (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Compacting context...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-surface-200 bg-white">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about this case..."
            className="flex-1 border border-surface-200 rounded-xl px-4 py-3 text-sm
                       placeholder:text-brand-400 focus:outline-none focus:ring-2
                       focus:ring-accent-500 focus:border-transparent transition-shadow"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-brand-900 text-white rounded-xl hover:bg-brand-800
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       flex items-center gap-2"
          >
            <PaperAirplaneIcon />
            <span className="font-medium">Send</span>
          </button>
        </div>
      </div>
    </div>
  )
}
