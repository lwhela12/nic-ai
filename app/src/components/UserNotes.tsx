import { useState, useEffect, useCallback, useRef } from 'react'

interface Note {
  id: number
  text: string
  createdAt: string
  editedAt: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  caseFolder: string
  apiUrl: string
}

export default function UserNotes({ isOpen, onClose, caseFolder, apiUrl }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [editorText, setEditorText] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [, setIsDirty] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/notes/list?case=${encodeURIComponent(caseFolder)}`)
      const data = await res.json()
      setNotes(data.notes || [])
    } catch {
      // Ignore fetch errors
    }
  }, [apiUrl, caseFolder])

  // On open: fetch notes, show list view
  useEffect(() => {
    if (isOpen) {
      fetchNotes()
      setActiveNote(null)
      setEditorText('')
      setIsDirty(false)
      setShowEditor(false)
    }
  }, [isOpen, fetchNotes])

  // Focus textarea when editor slides in
  useEffect(() => {
    if (isOpen && showEditor) {
      setTimeout(() => textareaRef.current?.focus(), 300)
    }
  }, [isOpen, showEditor])

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEditor) {
          setShowEditor(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, showEditor, onClose])

  const handleSave = useCallback(async () => {
    if (!editorText.trim() || isSaving) return
    setIsSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/notes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          note: {
            id: activeNote?.id || null,
            text: editorText,
          },
        }),
      })
      const data = await res.json()
      if (data.success && data.note) {
        setIsDirty(false)
        // Update local notes list
        setNotes(prev => {
          const idx = prev.findIndex(n => n.id === data.note.id)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = data.note
            return updated
          }
          return [...prev, data.note]
        })
        // Return to list view
        setActiveNote(null)
        setEditorText('')
        setShowEditor(false)
      }
    } catch {
      // Ignore save errors
    } finally {
      setIsSaving(false)
    }
  }, [apiUrl, caseFolder, activeNote, editorText, isSaving])

  const handleSelectNote = useCallback((note: Note) => {
    setActiveNote(note)
    setEditorText(note.text)
    setIsDirty(false)
    setShowEditor(true)
  }, [])

  const handleNewNote = useCallback(() => {
    setActiveNote(null)
    setEditorText('')
    setIsDirty(false)
    setShowEditor(true)
  }, [])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  if (!isOpen) return null

  const sortedNotes = [...notes].sort((a, b) => b.id - a.id)

  return (
    <div
      className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-elevated w-full max-w-lg mx-4 overflow-hidden flex flex-col"
           style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-200 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-brand-900">Notes</h2>
          <div className="flex items-center gap-2">
            {!showEditor && (
              <button
                onClick={handleNewNote}
                className="text-sm font-medium text-brand-600 hover:text-brand-800 px-3 py-1.5
                           rounded-lg hover:bg-surface-100 transition-colors"
              >
                + New Note
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content area with sliding panes */}
        <div className="relative flex-1 overflow-hidden min-h-0">
          <div
            className="w-[200%] flex transition-transform duration-300 ease-in-out h-full"
            style={{ transform: showEditor ? 'translateX(-50%)' : 'translateX(0)' }}
          >
            {/* Notes list pane (default) */}
            <div className="w-1/2 shrink-0 flex flex-col p-6 h-full">
              <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                {sortedNotes.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-brand-400 mb-3">No notes yet</p>
                    <button
                      onClick={handleNewNote}
                      className="text-sm font-medium text-brand-600 hover:text-brand-800 px-4 py-2
                                 rounded-lg hover:bg-surface-100 transition-colors"
                    >
                      + Write your first note
                    </button>
                  </div>
                ) : (
                  sortedNotes.map(note => (
                    <button
                      key={note.id}
                      onClick={() => handleSelectNote(note)}
                      className="w-full text-left p-3 rounded-lg border border-surface-200
                                 hover:border-brand-300 hover:bg-surface-50 transition-colors"
                    >
                      <p className="text-sm text-brand-800 line-clamp-2">{note.text}</p>
                      <p className="text-xs text-brand-400 mt-1">
                        {formatDate(note.editedAt || note.createdAt)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Editor pane (slides in) */}
            <div className="w-1/2 shrink-0 flex flex-col p-6 h-full">
              <button
                onClick={() => setShowEditor(false)}
                className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-700
                           transition-colors mb-4 self-start"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back
              </button>
              <textarea
                ref={textareaRef}
                value={editorText}
                onChange={(e) => { setEditorText(e.target.value); setIsDirty(true) }}
                placeholder="Write a note..."
                className="w-full flex-1 min-h-[200px] resize-none rounded-lg border border-surface-200
                           p-3 text-sm text-brand-800 placeholder-brand-400
                           focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              {activeNote && (
                <div className="mt-2 text-xs text-brand-400">
                  Created {formatDate(activeNote.createdAt)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer — only show save button when editor is open */}
        {showEditor && (
          <div className="px-6 py-3 border-t border-surface-200 flex items-center justify-between shrink-0">
            <span className="text-xs text-brand-400">
              {activeNote?.editedAt ? `Last edited ${formatDate(activeNote.editedAt)}` : ''}
            </span>
            <button
              onClick={handleSave}
              disabled={!editorText.trim() || isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg
                         hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
