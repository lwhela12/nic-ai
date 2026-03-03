import { useState, useRef, useEffect } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  apiUrl: string
  firmRoot: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface EditSuggestion {
  section_id: string
  old_text: string
  new_text: string
  status: 'pending' | 'applied' | 'rejected'
}

const EDIT_REGEX = /\[\[EDIT_SUGGESTION:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})\]\]/g

function parseEditSuggestions(content: string): { displayContent: string; suggestions: EditSuggestion[] } {
  const suggestions: EditSuggestion[] = []
  let idx = 0
  const displayContent = content.replace(EDIT_REGEX, (_, json) => {
    try {
      const parsed = JSON.parse(json)
      suggestions.push({ ...parsed, status: 'pending' })
      idx++
      return `\n\n---\n**Edit Suggestion #${idx}** (section: \`${parsed.section_id}\`)\n\n`
    } catch {
      return _
    }
  })
  return { displayContent, suggestions }
}

export default function KnowledgeChat({ apiUrl, firmRoot }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<EditSuggestion[]>([])
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const userMessage = input.trim()
    if (!userMessage || isLoading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const res = await fetch(`${apiUrl}/api/knowledge/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, message: userMessage }),
      })

      const reader = res.body?.getReader()
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

              if (data.type === 'text') {
                assistantMessage += data.content
                setMessages(prev => {
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

              if (data.type === 'done') {
                // Parse edit suggestions from final message
                const { suggestions: newSuggestions } = parseEditSuggestions(assistantMessage)
                if (newSuggestions.length > 0) {
                  setSuggestions(prev => [...prev, ...newSuggestions])
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Error communicating with the knowledge assistant.' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const applyEdit = async (idx: number) => {
    const suggestion = suggestions[idx]
    if (!suggestion || suggestion.status !== 'pending') return

    setApplyingIdx(idx)
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/apply-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: firmRoot,
          section_id: suggestion.section_id,
          old_text: suggestion.old_text,
          new_text: suggestion.new_text,
        }),
      })

      if (res.ok) {
        setSuggestions(prev => prev.map((s, i) => i === idx ? { ...s, status: 'applied' } : s))
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to apply edit')
      }
    } catch {
      alert('Failed to apply edit')
    } finally {
      setApplyingIdx(null)
    }
  }

  const rejectEdit = (idx: number) => {
    setSuggestions(prev => prev.map((s, i) => i === idx ? { ...s, status: 'rejected' } : s))
  }

  const { displayContent: _, suggestions: __ } = { displayContent: '', suggestions: [] }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg font-medium text-brand-700">Knowledge Assistant</p>
            <p className="text-sm text-brand-400 mt-1">
              Ask questions about your practice knowledge or request edits
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {[
                'What are our lien reduction targets?',
                'Update the fee structure section',
                'Summarize Nevada comparative fault rules',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0) }}
                  className="text-xs px-3 py-1.5 bg-surface-100 text-brand-600 rounded-lg hover:bg-surface-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[75%] bg-brand-900 text-white rounded-2xl rounded-tr-md px-5 py-3">
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            )
          }

          const { displayContent } = parseEditSuggestions(msg.content)

          return (
            <div key={i} className="flex justify-start">
              <div className="flex gap-3 max-w-[85%]">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-600 to-accent-800
                                flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  KB
                </div>
                <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
                  <div className="text-sm prose prose-sm max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-600 to-accent-800
                              flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                KB
              </div>
              <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 shadow-card border border-surface-100">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-2 h-2 bg-brand-300 rounded-full animate-bounce [animation-delay:0.3s]" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Edit suggestions panel */}
      {suggestions.filter(s => s.status === 'pending').length > 0 && (
        <div className="border-t border-surface-200 bg-amber-50 px-6 py-3 max-h-48 overflow-y-auto">
          <h4 className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
            Pending Edit Suggestions ({suggestions.filter(s => s.status === 'pending').length})
          </h4>
          <div className="space-y-2">
            {suggestions.map((s, i) => {
              if (s.status !== 'pending') return null
              return (
                <div key={i} className="bg-white rounded-lg p-3 border border-amber-200">
                  <div className="text-xs text-brand-500 mb-2">Section: <code>{s.section_id}</code></div>
                  <div className="flex gap-4 text-xs mb-2">
                    <div className="flex-1">
                      <div className="text-red-600 font-medium mb-1">Remove:</div>
                      <div className="bg-red-50 p-2 rounded text-red-800 line-through whitespace-pre-wrap">
                        {s.old_text.slice(0, 200)}{s.old_text.length > 200 ? '...' : ''}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-accent-600 font-medium mb-1">Add:</div>
                      <div className="bg-accent-50 p-2 rounded text-accent-800 whitespace-pre-wrap">
                        {s.new_text.slice(0, 200)}{s.new_text.length > 200 ? '...' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => rejectEdit(i)}
                      className="text-xs px-3 py-1 text-brand-600 hover:bg-surface-100 rounded transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => applyEdit(i)}
                      disabled={applyingIdx === i}
                      className="text-xs px-3 py-1 bg-accent-600 text-white rounded hover:bg-accent-700
                                 disabled:opacity-50 transition-colors"
                    >
                      {applyingIdx === i ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-6 py-4 border-t border-surface-200 bg-white">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about or edit practice knowledge..."
            className="flex-1 border border-surface-200 rounded-xl px-4 py-3 text-sm
                       placeholder:text-brand-400 focus:outline-none focus:ring-2
                       focus:ring-accent-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-brand-900 text-white rounded-xl hover:bg-brand-800
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
