import { useState, useRef, useEffect, useCallback, memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface FirmTodo {
  id: string
  text: string
  caseRef?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'completed'
  createdAt: string
}

interface Props {
  apiUrl: string
  firmRoot: string
  onTodosUpdated?: (todos: FirmTodo[]) => void
  initialPrompt?: string
  onInitialPromptUsed?: () => void
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  hasTodos?: boolean
}

interface ParsedTodo {
  text: string
  caseRef?: string
  priority?: 'high' | 'medium' | 'low'
}

// Icons
const ChartBarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
)

const ExclamationTriangleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
)

const ClipboardDocumentListIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
)

const CurrencyDollarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const ListBulletIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
)

const PaperAirplaneIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
)

const BookmarkIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
  </svg>
)

// Quick actions for firm-level analysis
const quickActions = [
  { label: 'Portfolio Overview', prompt: 'Give me a portfolio overview with key metrics', icon: ChartBarIcon },
  { label: 'SOL Alerts', prompt: 'Which cases have statute of limitations deadlines approaching in the next 90 days?', icon: ExclamationTriangleIcon },
  { label: 'Generate Tasks', prompt: 'Generate a prioritized task list based on case deadlines and status', icon: ClipboardDocumentListIcon },
  { label: 'Phase Distribution', prompt: 'Show me the distribution of cases by phase', icon: ListBulletIcon },
  { label: 'Financial Summary', prompt: 'Summarize total medical specials and compare to policy limits', icon: CurrencyDollarIcon },
  { label: 'Stale Cases', prompt: 'Which cases might need attention based on their phase and how long they have been there?', icon: ClockIcon },
]

// Memoized message component
const MessageItem = memo(function MessageItem({
  msg,
  onSaveTodos
}: {
  msg: Message
  onSaveTodos?: (content: string) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-brand-900 text-white rounded-2xl rounded-tr-md px-5 py-3">
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    )
  }

  // Check if message contains todo JSON
  const hasTodoJson = msg.content.includes('"todos"') && msg.content.includes('"text"')

  return (
    <div className="flex justify-start">
      <div className="flex gap-3 max-w-[85%]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-600 to-accent-800
                        flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
          AI
        </div>
        <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
          <div className="text-sm prose prose-sm max-w-none
                          prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                          prose-headings:my-3 prose-headings:text-brand-900
                          prose-table:border-collapse prose-th:border prose-th:border-surface-200
                          prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2
                          prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2
                          prose-a:text-accent-600 prose-a:no-underline hover:prose-a:underline">
            <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
          </div>
          {hasTodoJson && onSaveTodos && (
            <div className="mt-3 pt-3 border-t border-surface-100">
              <button
                onClick={() => onSaveTodos(msg.content)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium
                           bg-accent-50 text-accent-700 rounded-lg hover:bg-accent-100 transition-colors"
              >
                <BookmarkIcon />
                Save Tasks
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export default function FirmChat({ apiUrl, firmRoot, onTodosUpdated, initialPrompt, onInitialPromptUsed }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const initialPromptUsedRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async (overrideMessage?: string) => {
    const userMessage = (overrideMessage || input).trim()
    if (!userMessage || isLoading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const response = await fetch(`${apiUrl}/api/firm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, message: userMessage, sessionId }),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
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

              if (data.type === 'init' && data.sessionId) {
                setSessionId(data.sessionId)
              }

              if (data.type === 'text') {
                assistantMessage += data.content
                setMessages((prev) => {
                  const updated = [...prev]
                  const lastIdx = updated.length - 1
                  if (updated[lastIdx]?.role === 'assistant') {
                    updated[lastIdx] = { role: 'assistant', content: assistantMessage }
                  } else {
                    updated.push({ role: 'assistant', content: assistantMessage })
                  }
                  return updated
                })
              }

              if (data.type === 'compaction') {
                // Show compaction indicator (SDK is auto-compacting context)
                setIsCompacting(true)
              }

              if (data.type === 'done') {
                if (data.sessionId) setSessionId(data.sessionId)
              }

              if (data.type === 'error') {
                const errorMsg = data.error || 'Unknown error'
                const errorLower = errorMsg.toLowerCase()

                // Check if this is a compaction-related error (SDK will auto-recover)
                const isCompactionError =
                  errorLower.includes('prompt is too long') ||
                  errorLower.includes('process exited with code 1')

                if (isCompactionError) {
                  // Show compaction indicator instead of error - SDK will auto-compact
                  setIsCompacting(true)
                } else {
                  setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: `Error: ${errorMsg}` },
                  ])
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error communicating with the agent. Please try again.' },
      ])
    } finally {
      setIsLoading(false)
      setIsCompacting(false)
    }
  }, [apiUrl, firmRoot, input, isLoading, sessionId])

  // Handle initial prompt (e.g., from "Generate Tasks" button)
  useEffect(() => {
    if (initialPrompt && !initialPromptUsedRef.current && !isLoading) {
      initialPromptUsedRef.current = true
      sendMessage(initialPrompt)
      onInitialPromptUsed?.()
    }
  }, [initialPrompt, isLoading, onInitialPromptUsed, sendMessage])

  const clearSession = async () => {
    try {
      await fetch(`${apiUrl}/api/firm/clear-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot }),
      })
      setSessionId(null)
      setMessages([])
    } catch {
      // Ignore
    }
  }

  const handleSaveTodos = async (content: string) => {
    // Try to extract JSON from the content
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*"todos"[\s\S]*\}/)
      if (!jsonMatch) {
        console.error('No todos JSON found in content')
        return
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0]
      const parsed = JSON.parse(jsonStr) as { todos?: ParsedTodo[] }

      if (!parsed.todos || !Array.isArray(parsed.todos)) {
        console.error('Invalid todos format')
        return
      }

      // Transform to FirmTodo format with IDs
      const todos: FirmTodo[] = parsed.todos.map((t, i) => ({
        id: `todo-${Date.now()}-${i}`,
        text: t.text,
        caseRef: t.caseRef,
        priority: t.priority || 'medium',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }))

      // Save to server
      const response = await fetch(`${apiUrl}/api/firm/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, todos }),
      })

      if (response.ok) {
        onTodosUpdated?.(todos)
        // Add a confirmation message
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Saved ${todos.length} tasks to your firm todo list.` },
        ])
      }
    } catch (error) {
      console.error('Failed to parse or save todos:', error)
    }
  }

  return (
    <div className="flex flex-col h-full">
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
            <span className="text-brand-300 mx-2">|</span>
            <span className="text-accent-600 font-medium">Firm-level Analysis</span>
          </div>
          {sessionId && (
            <button
              onClick={clearSession}
              className="text-sm text-brand-400 hover:text-brand-600 transition-colors"
            >
              Clear session
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => sendMessage(action.prompt)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                         bg-surface-100 text-brand-700
                         hover:bg-accent-600 hover:text-white
                         disabled:opacity-50 transition-colors"
            >
              <action.icon />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-surface-50">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-accent-100 flex items-center justify-center mx-auto mb-4">
              <ChartBarIcon />
            </div>
            <p className="text-lg font-medium text-brand-700">Firm-Level Case Analysis</p>
            <p className="text-sm text-brand-400 mt-1">
              Ask about your portfolio, deadlines, or generate task lists
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem
            key={i}
            msg={msg}
            onSaveTodos={handleSaveTodos}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-600 to-accent-800
                              flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                AI
              </div>
              <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-accent-300 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-accent-300 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 bg-accent-300 rounded-full animate-bounce [animation-delay:0.3s]" />
                  </div>
                  <span className="text-xs text-brand-400">Analyzing portfolio...</span>
                </div>
              </div>
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
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about your case portfolio..."
            className="flex-1 border border-surface-200 rounded-xl px-4 py-3 text-sm
                       placeholder:text-brand-400 focus:outline-none focus:ring-2
                       focus:ring-accent-500 focus:border-transparent transition-shadow"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-accent-600 text-white rounded-xl hover:bg-accent-700
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
