import { useState, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Section {
  id: string
  title: string
  filename: string
  order: number
}

interface Manifest {
  practiceArea: string
  jurisdiction: string
  sections: Section[]
}

interface Props {
  apiUrl: string
  firmRoot: string
  canEditKnowledge: boolean
}

export default function KnowledgeEditor({ apiUrl, firmRoot, canEditKnowledge }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNewSection, setShowNewSection] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')

  const isDirty = content !== originalContent

  const loadManifest = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/manifest?root=${encodeURIComponent(firmRoot)}`)
      if (!res.ok) throw new Error('Failed to load manifest')
      const data = await res.json()
      setManifest(data)
      if (data.sections.length > 0 && !selectedSection) {
        setSelectedSection(data.sections[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge base')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, firmRoot, selectedSection])

  const loadSection = useCallback(async (sectionId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/section/${sectionId}?root=${encodeURIComponent(firmRoot)}`)
      if (!res.ok) throw new Error('Failed to load section')
      const data = await res.json()
      setContent(data.content)
      setOriginalContent(data.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load section')
    }
  }, [apiUrl, firmRoot])

  useEffect(() => { loadManifest() }, [loadManifest])

  useEffect(() => {
    if (selectedSection) loadSection(selectedSection)
  }, [selectedSection, loadSection])

  const saveSection = async () => {
    if (!selectedSection || !isDirty) return
    if (!canEditKnowledge) {
      setError('Only attorneys can edit firm knowledge.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/section/${selectedSection}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, content }),
      })
      if (!res.ok) {
        if (res.status === 403) throw new Error('Only attorneys can edit firm knowledge.')
        throw new Error('Failed to save')
      }
      setOriginalContent(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const deleteSection = async () => {
    if (!selectedSection) return
    if (!canEditKnowledge) {
      setError('Only attorneys can edit firm knowledge.')
      return
    }
    if (!confirm('Delete this section? This cannot be undone.')) return

    try {
      const res = await fetch(`${apiUrl}/api/knowledge/section/${selectedSection}?root=${encodeURIComponent(firmRoot)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        if (res.status === 403) throw new Error('Only attorneys can edit firm knowledge.')
        throw new Error('Failed to delete')
      }
      setSelectedSection(null)
      setContent('')
      setOriginalContent('')
      await loadManifest()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const createSection = async () => {
    const title = newSectionTitle.trim()
    if (!title) return
    if (!canEditKnowledge) {
      setError('Only attorneys can edit firm knowledge.')
      return
    }
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: firmRoot, title }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create')
      }
      const data = await res.json()
      setShowNewSection(false)
      await loadManifest()
      if (typeof data.id === 'string') {
        setSelectedSection(data.id)
      }
      setNewSectionTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create section')
    }
  }

  const handleSelectSection = (sectionId: string) => {
    if (isDirty && !confirm('You have unsaved changes. Discard?')) return
    setSelectedSection(sectionId)
    setMode('preview')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 border-r border-surface-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-surface-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-700">Sections</h3>
          {canEditKnowledge && (
            <button
              onClick={() => setShowNewSection(true)}
              className="text-xs px-2 py-1 bg-accent-50 text-accent-700 rounded hover:bg-accent-100 transition-colors"
            >
              + Add
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {manifest?.sections.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSelectSection(section.id)}
              className={`w-full text-left px-4 py-3 text-sm border-b border-surface-100 transition-colors ${
                selectedSection === section.id
                  ? 'bg-accent-50 text-accent-800 border-l-2 border-l-accent-500'
                  : 'text-brand-700 hover:bg-surface-50'
              }`}
            >
              <span className="text-xs text-brand-400 mr-1">{String(section.order).padStart(2, '0')}.</span>
              {section.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main editor */}
      <div className="flex-1 flex flex-col">
        {selectedSection ? (
          <>
            <div className="px-6 py-3 border-b border-surface-200 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-brand-800">
                  {manifest?.sections.find(s => s.id === selectedSection)?.title}
                </h2>
                {isDirty && (
                  <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded">Unsaved</span>
                )}
                {/* Preview / Edit toggle */}
                <div className="flex bg-surface-100 rounded-lg p-0.5 ml-2">
                  <button
                    onClick={() => setMode('preview')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      mode === 'preview' ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-500 hover:text-brand-700'
                    }`}
                  >
                    Preview
                  </button>
                  {canEditKnowledge && (
                    <button
                      onClick={() => setMode('edit')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        mode === 'edit' ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-500 hover:text-brand-700'
                      }`}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {canEditKnowledge && (
                  <button
                    onClick={deleteSection}
                    className="text-xs px-3 py-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                )}
                {canEditKnowledge && mode === 'edit' && (
                  <button
                    onClick={saveSection}
                    disabled={!isDirty || saving}
                    className="text-xs px-4 py-1.5 bg-brand-900 text-white rounded hover:bg-brand-800
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>
            {mode === 'preview' ? (
              <div className="flex-1 overflow-y-auto p-8 bg-white">
                {!canEditKnowledge && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    Read-only mode: only attorneys can edit firm knowledge.
                  </div>
                )}
                <div className="max-w-3xl mx-auto prose prose-sm
                                prose-headings:text-brand-900 prose-headings:font-semibold
                                prose-h2:text-xl prose-h2:border-b prose-h2:border-surface-200 prose-h2:pb-2 prose-h2:mb-4
                                prose-h3:text-base prose-h3:text-brand-800
                                prose-p:text-brand-700 prose-p:leading-relaxed
                                prose-li:text-brand-700
                                prose-strong:text-brand-900
                                prose-table:border-collapse
                                prose-th:border prose-th:border-surface-200 prose-th:bg-surface-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-th:text-brand-600
                                prose-td:border prose-td:border-surface-200 prose-td:px-3 prose-td:py-2 prose-td:text-sm
                                prose-code:text-accent-700 prose-code:bg-accent-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                                prose-ul:list-disc prose-ol:list-decimal
                                prose-a:text-accent-600 prose-a:no-underline hover:prose-a:underline">
                  <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                </div>
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 p-6 font-mono text-sm text-brand-800 bg-surface-50 resize-none
                           focus:outline-none border-none"
                placeholder="Section content (Markdown)..."
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-brand-400 text-sm">
            Select a section to edit
          </div>
        )}
      </div>

      {/* New section modal */}
      {showNewSection && (
        <div className="fixed inset-0 bg-brand-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-elevated p-6 w-96">
            <h3 className="text-lg font-semibold text-brand-900 mb-4">New Section</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-brand-600 mb-1 block">Title</label>
                <input
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  placeholder="e.g. Discovery Process"
                  className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => { setShowNewSection(false); setNewSectionTitle('') }}
                className="px-4 py-2 text-sm text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createSection}
                disabled={!newSectionTitle.trim()}
                className="px-4 py-2 text-sm bg-brand-900 text-white rounded-lg hover:bg-brand-800
                           disabled:opacity-50 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg z-50">
          <div className="flex items-center gap-2">
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        </div>
      )}
    </div>
  )
}
