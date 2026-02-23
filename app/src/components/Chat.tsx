import { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface EvidencePacketPlanData {
  documents: Array<{
    docId?: string
    path?: string
    title?: string
  }>
  frontMatter: Partial<{
    claimantName: string
    claimNumber: string
    issueOnAppeal: string
    extraSectionValues: Record<string, string>
  }>
}

interface Props {
  caseFolder: string
  apiUrl: string
  onViewUpdate: (content: string) => void
  initialPrompt?: string
  onInitialPromptUsed?: () => void
  onIndexMayHaveChanged?: () => void
  onDraftsMayHaveChanged?: () => void
  onEvidencePacketGenerated?: (filePath: string) => void
  onShowFile?: (filePath: string) => void
  onDocumentView?: (view: AgentDocumentViewPayload) => void
  onIndexStatusChange?: (status: IndexStatus | null) => void
  onStartReindex?: (forceFullReindex?: boolean) => void
  isReindexing?: boolean
  onEvidencePacketPlanned?: (data: EvidencePacketPlanData) => void
}

interface AgentDocumentViewPayload {
  id: string
  name: string
  description?: string
  paths: string[]
  sortBy?: 'folder' | 'date' | 'type'
  sortDirection?: 'asc' | 'desc'
  createdAt: string
  totalMatches: number
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


const PaperAirplaneIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
)


const ExclamationTriangleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
)

const WrenchIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
  </svg>
)

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113.151 2.788L8.757 20.006a3 3 0 01-1.533.928l-3.39.838.838-3.39a3 3 0 01.928-1.533L16.862 4.487z" />
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

// Keep this many recent messages after summarization
const KEEP_RECENT = 2

// Context usage thresholds
const CONTEXT_DANGER_PERCENT = 55   // Red warning, trigger auto-summarize

export default function Chat({ caseFolder, apiUrl, onViewUpdate, initialPrompt, onInitialPromptUsed, onIndexMayHaveChanged, onDraftsMayHaveChanged, onEvidencePacketGenerated, onShowFile, onDocumentView, onIndexStatusChange, onStartReindex, isReindexing, onEvidencePacketPlanned }: Props) {
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
  const [viewingArchiveId, setViewingArchiveId] = useState<string | null>(null)
  const [sourceArchiveId, setSourceArchiveId] = useState<string | null>(null) // Track original archive for overwrites
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
    setViewingArchiveId(null)
    setSourceArchiveId(null)
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

  // Start new chat (clears UI, archives current conversation if needed)
  const archiveConversation = () => {
    if (messages.length === 0) return

    // If viewing an already-archived conversation without changes, just clear
    const shouldArchive = !viewingArchiveId
    const archiveIdToOverwrite = sourceArchiveId

    // Clear UI immediately for instant feedback
    setMessages([])
    setSessionId(null)
    setConversationSummary(null)
    setContextUsage(null)
    setViewingArchiveId(null)
    setSourceArchiveId(null)

    // Archive in background if this was a new conversation OR had new messages added
    if (shouldArchive) {
      fetch(`${apiUrl}/api/claude/history/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, overwriteId: archiveIdToOverwrite }),
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.archive) {
            if (archiveIdToOverwrite) {
              // Replace existing archive in list
              setArchives(prev => prev.map(a => a.id === archiveIdToOverwrite ? data.archive : a))
            } else {
              // Add new archive to list
              setArchives(prev => [data.archive, ...prev])
            }
          }
        })
        .catch(() => {
          // Ignore archive errors
        })
    }
  }

  // Load an archived conversation (read-only view)
  const loadArchive = async (archiveId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/claude/history/archive/${archiveId}?case=${encodeURIComponent(caseFolder)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.messages) {
          setMessages(data.messages)
          setSessionId(null)
          setConversationSummary(null)
          setContextUsage(null)
          setShowArchives(false)
          setViewingArchiveId(archiveId) // Mark as viewing archived conversation
          setSourceArchiveId(archiveId) // Track for potential overwrite
        }
      }
    } catch {
      // Ignore load errors
    }
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
  const [showIndexDetails, setShowIndexDetails] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const indexStatusRequestIdRef = useRef(0)
  const wasReindexingRef = useRef<boolean>(!!isReindexing)

  const checkIndexStatus = useCallback(async () => {
    const requestId = ++indexStatusRequestIdRef.current
    try {
      const res = await fetch(`${apiUrl}/api/files/index-status?case=${encodeURIComponent(caseFolder)}`)
      const data = await res.json()
      if (requestId !== indexStatusRequestIdRef.current) return
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

  useEffect(() => {
    const nowReindexing = !!isReindexing
    if (wasReindexingRef.current && !nowReindexing && caseFolder) {
      checkIndexStatus()
      onIndexMayHaveChanged?.()
    }
    wasReindexingRef.current = nowReindexing
  }, [isReindexing, caseFolder, checkIndexStatus, onIndexMayHaveChanged])

  // Notify parent when indexStatus changes (for FileViewer badges)
  useEffect(() => {
    onIndexStatusChange?.(indexStatus)
  }, [indexStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const runReindex = async (forceFullReindex = false) => {
    if (onStartReindex) {
      // Delegate to App-level indexing (survives navigation)
      onStartReindex(forceFullReindex)
      return
    }

    // Fallback: local SSE (only if App doesn't provide callback)
    if (isIndexing) return
    setIsIndexing(true)

    try {
      let filesToIndex: string[] | undefined

      if (!forceFullReindex) {
        const statusRes = await fetch(`${apiUrl}/api/files/index-status?case=${encodeURIComponent(caseFolder)}`)
        const status = await statusRes.json()

        if (!status.needsIndex) {
          setIndexStatus(status)
          setIsIndexing(false)
          return
        }

        const changedFiles = [...(status.newFiles || []), ...(status.modifiedFiles || [])]
        if (changedFiles.length > 0 && status.reason !== 'no_index') {
          filesToIndex = changedFiles
        }
      }

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
      let buffer = ''
      let diffSummary: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const event = JSON.parse(line.slice(5).trim())
              if (event.type === 'done' && event.diff?.summary) {
                diffSummary = event.diff.summary
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        }
      }

      await checkIndexStatus()
      onIndexMayHaveChanged?.()

      if (diffSummary) {
        setMessages(prev => [...prev, {
          role: 'assistant' as const,
          content: `**Index Updated** — ${diffSummary}`,
          tools: [],
        }])
      }
    } catch {
      // Ignore
    } finally {
      setIsIndexing(false)
    }
  }

  // Summarize older messages to reduce context size
  const summarizeConversation = async (currentMessages: Message[]) => {
    if (currentMessages.length <= KEEP_RECENT) return

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
    // If viewing an archived conversation, mark it as active now (will be saved on New Chat)
    setViewingArchiveId(null)
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

      const requestBody: {
        caseFolder: string
        message: string
        history: Array<{ role: 'user' | 'assistant'; content: string }>
        sessionId?: string
      } = {
        caseFolder,
        message: messageWithContext,
        history: historyForApi,
      }
      if (sessionId) {
        requestBody.sessionId = sessionId
      }

      // Use direct API chat endpoint (faster, no agent SDK overhead)
      const response = await fetch(`${apiUrl}/api/claude/chat-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      let toolsUsed: string[] = []
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        if (done && buffer) {
          lines.push(buffer)
          buffer = ''
        }

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            try {
              const dataStr = trimmed.startsWith('data: ')
                ? trimmed.slice(6)
                : trimmed.slice(5).trim()
              if (!dataStr) continue
              const data = JSON.parse(dataStr)

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

              if (data.type === 'document_view' && data.view) {
                onDocumentView?.(data.view)
              }

              if (data.type === 'evidence_packet_plan' && data.plan && onEvidencePacketPlanned) {
                const proposed = data.plan.proposedDocuments || []
                const caption = data.plan.caption || {}
                const service = data.plan.service || {}
                const issueOnAppeal = data.plan.issueOnAppeal || ''
                const templateId = data.plan.templateId || ''
                onEvidencePacketPlanned({
                  documents: proposed
                    .map((d: { docId?: string; doc_id?: string; path?: string; title?: string }) => ({
                      docId: (d.docId || d.doc_id || '').trim() || undefined,
                      path: (d.path || '').trim() || undefined,
                      title: d.title,
                    }))
                    .filter((d: { docId?: string; path?: string }) => Boolean(d.docId || d.path)),
                  frontMatter: {
                    ...caption,
                    hearingNumber: caption.hearingNumber,
                    hearingDateTime: caption.hearingDateTime,
                    appearance: caption.appearance,
                    serviceDate: service.serviceDate,
                    serviceMethod: service.serviceMethod,
                    recipients: service.recipients,
                    issueOnAppeal,
                    ...(templateId ? { templateId } : {}),
                    ...(issueOnAppeal ? { extraSectionValues: { issueOnAppeal } } : {}),
                  },
                })
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
                const indexTools = ['Edit', 'Bash', 'update_index', 'update_file_entry', 'write_file', 'resolve_conflict', 'batch_resolve_conflicts']
                if (toolsUsed.some(t => indexTools.some(it => t.includes(it))) && onIndexMayHaveChanged) {
                  onIndexMayHaveChanged()
                }
                // Check if file-writing tools were used or document agent created a file
                const writeTools = ['Write', 'write_file', 'build_evidence_packet', 'create_evidence_packet']
                const hasWriteTools = toolsUsed.some(t => writeTools.some(wt => t.includes(wt)))
                const hasDocGenFile = !!data.filePath
                if ((hasWriteTools || hasDocGenFile) && onDraftsMayHaveChanged) {
                  onDraftsMayHaveChanged()
                }

                const generatedPreviewPath = typeof data.previewPath === 'string' ? data.previewPath.trim() : ''
                if (generatedPreviewPath && onShowFile) {
                  onShowFile(generatedPreviewPath)
                }

                // Trigger Drafts takeover flow when evidence packet tools create a file.
                const evidencePacketTools = ['build_evidence_packet', 'create_evidence_packet']
                const hasEvidencePacketWrite = toolsUsed.some(t => evidencePacketTools.some(tool => t.includes(tool)))
                if (hasEvidencePacketWrite && typeof data.filePath === 'string' && data.filePath.trim() && onEvidencePacketGenerated) {
                  onEvidencePacketGenerated(data.filePath.trim())
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
        if (done) break
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

      // Check if we need to summarize based on context usage
      setMessages((currentMessages) => {
        if (contextUsage && contextUsage.percent >= CONTEXT_DANGER_PERCENT) {
          console.log(`Triggering summarization: messages=${currentMessages.length}, context=${contextUsage.percent}%`)
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

  return (
    <div className="relative flex flex-col h-full">
      {/* Index status banner */}
      {indexStatus?.needsIndex && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                <ExclamationTriangleIcon />
              </div>
              <div>
                <p className="text-sm font-medium text-amber-800">{indexStatus.message}</p>
                {(indexStatus.newFiles.length > 0 || indexStatus.modifiedFiles.length > 0) && (
                  <button
                    onClick={() => setShowIndexDetails(d => !d)}
                    className="text-xs text-amber-600 mt-0.5 hover:text-amber-800 underline decoration-dotted"
                  >
                    {indexStatus.newFiles.length} new, {indexStatus.modifiedFiles.length} modified
                    {showIndexDetails ? ' ▴' : ' ▾'}
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runReindex()}
                disabled={isIndexing || isReindexing}
                className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white
                           rounded-lg disabled:opacity-50 transition-colors"
                title="Index only new and modified files"
              >
                {(isIndexing || isReindexing) ? 'Indexing...' : 'Update Index'}
              </button>
              <button
                onClick={() => runReindex(true)}
                disabled={isIndexing || isReindexing}
                className="px-3 py-2 text-sm font-medium bg-surface-200 hover:bg-surface-300 text-brand-700
                           rounded-lg disabled:opacity-50 transition-colors"
                title="Re-index all files from scratch"
              >
                Full
              </button>
            </div>
          </div>
          {showIndexDetails && (
            <div className="mt-2 ml-11 space-y-1">
              {indexStatus.newFiles.map((f, i) => (
                <div key={`new-${i}`} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">NEW</span>
                  <span className="truncate">{f.split('/').pop()}</span>
                </div>
              ))}
              {indexStatus.modifiedFiles.map((f, i) => (
                <div key={`mod-${i}`} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">MOD</span>
                  <span className="truncate">{f.split('/').pop()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


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
                  <button
                    key={archive.id}
                    onClick={() => loadArchive(archive.id)}
                    className="w-full text-left p-3 bg-white rounded-lg border border-surface-200 hover:border-accent-300 hover:bg-surface-50 transition-colors"
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
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 relative">
        {messages.length > 0 && (
          <div className="sticky top-2 z-10 flex justify-end pointer-events-none">
            <button
              onClick={archiveConversation}
              className="pointer-events-auto h-10 w-10 rounded-full border border-surface-200 bg-white text-brand-600 shadow-sm
                         hover:bg-surface-50 hover:border-surface-300 hover:text-brand-700 transition-colors
                         flex items-center justify-center"
              title="Archive and start new chat"
              aria-label="Archive and start new chat"
            >
              <PencilIcon />
            </button>
          </div>
        )}
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
