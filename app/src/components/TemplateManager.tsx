import { useState, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Template {
  id: string
  sourceFile: string
  parsedFile: string | null
  name: string
  description: string
  parsedAt: string | null
  sourceModified: string
  status: 'parsed' | 'needs_parsing' | 'outdated'
}

interface Props {
  firmRoot: string
  apiUrl: string
}

const DocumentIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const ArrowLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
)

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
)

const XMarkIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
)

const ArrowPathIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
)

export default function TemplateManager({ firmRoot, apiUrl }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [parsing, setParsing] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${apiUrl}/api/knowledge/doc-templates?root=${encodeURIComponent(firmRoot)}`)
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, firmRoot])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const loadPreview = useCallback(async (template: Template) => {
    if (!template.parsedFile) {
      setPreviewContent('')
      return
    }
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/doc-templates/${template.id}/preview?root=${encodeURIComponent(firmRoot)}`)
      if (res.ok) {
        const data = await res.json()
        setPreviewContent(data.content || '')
      }
    } catch {
      setPreviewContent('')
    }
  }, [apiUrl, firmRoot])

  useEffect(() => {
    if (selectedTemplate) {
      loadPreview(selectedTemplate)
    }
  }, [selectedTemplate, loadPreview])

  const handleParse = async (template: Template) => {
    setParsing(template.id)
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/doc-templates/${template.id}/parse?root=${encodeURIComponent(firmRoot)}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Parse failed')
      }
      await loadTemplates()
      // If this template is selected, reload preview
      if (selectedTemplate?.id === template.id) {
        const data = await res.json()
        if (data.template) {
          setSelectedTemplate({ ...template, ...data.template, status: 'parsed' })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setParsing(null)
    }
  }

  const handleSaveMetadata = async () => {
    if (!selectedTemplate) return
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/doc-templates/${selectedTemplate.id}?root=${encodeURIComponent(firmRoot)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDescription }),
      })
      if (!res.ok) throw new Error('Save failed')
      await res.json() // Consume response
      setSelectedTemplate({ ...selectedTemplate, name: editName, description: editDescription })
      setEditing(false)
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (template: Template) => {
    if (!confirm(`Delete template "${template.name}"? This will remove both source and parsed files.`)) {
      return
    }
    try {
      const res = await fetch(`${apiUrl}/api/knowledge/doc-templates/${template.id}?root=${encodeURIComponent(firmRoot)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')
      if (selectedTemplate?.id === template.id) {
        setSelectedTemplate(null)
        setPreviewContent('')
      }
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getStatusBadge = (status: Template['status']) => {
    switch (status) {
      case 'parsed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            Parsed
          </span>
        )
      case 'needs_parsing':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            Needs Parsing
          </span>
        )
      case 'outdated':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            Outdated
          </span>
        )
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-pulse text-brand-400">Loading templates...</div>
      </div>
    )
  }

  // Detail view
  if (selectedTemplate) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-200 bg-surface-50">
          <button
            onClick={() => {
              setSelectedTemplate(null)
              setPreviewContent('')
              setEditing(false)
            }}
            className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-2"
          >
            <ArrowLeftIcon />
            Back to templates
          </button>

          {editing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Template name"
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="When should this template be used? (e.g., 'Use for 3P demands when liability is clear')"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveMetadata}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white
                             text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors
                             disabled:opacity-50"
                >
                  <CheckIcon />
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-100 text-brand-600
                             text-sm font-medium rounded-lg hover:bg-surface-200 transition-colors"
                >
                  <XMarkIcon />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-brand-900">{selectedTemplate.name}</h3>
                  <p className="text-xs text-brand-400 mt-0.5">
                    Source: {selectedTemplate.sourceFile}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedTemplate.status)}
                  <button
                    onClick={() => {
                      setEditName(selectedTemplate.name)
                      setEditDescription(selectedTemplate.description)
                      setEditing(true)
                    }}
                    className="p-1.5 text-brand-400 hover:text-brand-600 hover:bg-surface-100
                               rounded-lg transition-colors"
                    title="Edit"
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>
              {selectedTemplate.description && (
                <p className="text-sm text-brand-600 mt-2 bg-accent-50 px-3 py-2 rounded-lg border border-accent-200">
                  {selectedTemplate.description}
                </p>
              )}
              {!selectedTemplate.description && selectedTemplate.status === 'parsed' && (
                <button
                  onClick={() => {
                    setEditName(selectedTemplate.name)
                    setEditDescription('')
                    setEditing(true)
                  }}
                  className="mt-2 text-sm text-accent-600 hover:text-accent-700"
                >
                  + Add usage description
                </button>
              )}
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {selectedTemplate.status !== 'parsed' ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4 text-amber-600">
                <DocumentIcon />
              </div>
              <p className="text-lg font-medium text-brand-700">Template needs parsing</p>
              <p className="text-sm text-brand-400 mt-1 max-w-sm mx-auto mb-6">
                Parse this template to extract its content and make it available to the agent.
              </p>
              <button
                onClick={() => handleParse(selectedTemplate)}
                disabled={parsing === selectedTemplate.id}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent-600 text-white
                           font-medium rounded-lg hover:bg-accent-700 transition-colors
                           disabled:opacity-50"
              >
                {parsing === selectedTemplate.id ? (
                  <>
                    <ArrowPathIcon />
                    Parsing...
                  </>
                ) : (
                  <>
                    <ArrowPathIcon />
                    Parse Template
                  </>
                )}
              </button>
            </div>
          ) : previewContent ? (
            <div className="prose prose-sm max-w-none
                            prose-headings:my-3 prose-headings:text-brand-900
                            prose-p:my-2 prose-ul:my-2 prose-li:my-0.5
                            prose-pre:bg-surface-100 prose-pre:text-brand-800">
              <Markdown remarkPlugins={[remarkGfm]}>{previewContent}</Markdown>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-brand-400">Loading preview...</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {selectedTemplate.status === 'needs_parsing' ? null : (
          <div className="px-4 py-3 border-t border-surface-200 bg-surface-50 flex items-center gap-3">
            {selectedTemplate.status === 'outdated' && (
              <button
                onClick={() => handleParse(selectedTemplate)}
                disabled={parsing === selectedTemplate.id}
                className="inline-flex items-center gap-2 px-3 py-2 bg-accent-600 text-white
                           text-sm font-medium rounded-lg hover:bg-accent-700 transition-colors
                           disabled:opacity-50"
              >
                <ArrowPathIcon />
                Re-parse
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={() => handleDelete(selectedTemplate)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600
                         hover:bg-red-50 rounded-lg transition-colors"
            >
              <TrashIcon />
              Delete
            </button>
          </div>
        )}
      </div>
    )
  }

  // List view
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center text-accent-600">
          <DocumentIcon />
        </div>
        <div>
          <h3 className="font-semibold text-brand-900">Document Templates</h3>
          <p className="text-sm text-brand-500">
            Drop PDF/DOCX templates in <code className="text-xs bg-surface-100 px-1 py-0.5 rounded">.pi_tool/templates/source/</code>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">
            Dismiss
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-surface-300 rounded-xl">
          <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4 text-brand-400">
            <DocumentIcon />
          </div>
          <p className="text-lg font-medium text-brand-700">No templates yet</p>
          <p className="text-sm text-brand-400 mt-1 max-w-sm mx-auto">
            Add PDF or DOCX template files to <code className="bg-surface-100 px-1 py-0.5 rounded text-xs">.pi_tool/templates/source/</code> then refresh.
          </p>
          <button
            onClick={loadTemplates}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-surface-100
                       text-brand-700 font-medium rounded-lg hover:bg-surface-200 transition-colors"
          >
            <ArrowPathIcon />
            Refresh
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="p-4 bg-white rounded-xl border border-surface-200
                         hover:border-accent-300 hover:bg-accent-50 transition-all"
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setSelectedTemplate(template)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-brand-900">{template.name}</p>
                    {getStatusBadge(template.status)}
                  </div>
                  <p className="text-xs text-brand-400">
                    {template.sourceFile} • Modified {formatDate(template.sourceModified)}
                  </p>
                  {template.description && (
                    <p className="text-sm text-brand-600 mt-1.5 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-1">
                  {template.status !== 'parsed' && (
                    <button
                      onClick={() => handleParse(template)}
                      disabled={parsing === template.id}
                      className="px-3 py-1.5 bg-accent-600 text-white text-sm font-medium
                                 rounded-lg hover:bg-accent-700 transition-colors disabled:opacity-50"
                    >
                      {parsing === template.id ? 'Parsing...' : 'Parse'}
                    </button>
                  )}
                  {template.status === 'outdated' && (
                    <button
                      onClick={() => handleParse(template)}
                      disabled={parsing === template.id}
                      className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      title="Re-parse (source file updated)"
                    >
                      <ArrowPathIcon />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
