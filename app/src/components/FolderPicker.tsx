import { useState, useEffect, useCallback } from 'react'

interface Props {
  apiUrl: string
  apiPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

interface Folder {
  name: string
  path: string
}

// Icons
const FolderIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
)

const ArrowUpIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
  </svg>
)

const XMarkIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

export default function FolderPicker({ apiUrl, apiPath = '/api/files/browse', onSelect, onCancel }: Props) {
  const [currentPath, setCurrentPath] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [manualPath, setManualPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const browse = useCallback(async (dir?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = dir
        ? `${apiUrl}${apiPath}?dir=${encodeURIComponent(dir)}`
        : `${apiUrl}${apiPath}`
      const res = await fetch(url)
      let data: unknown = null
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        data = await res.json()
      } else {
        const text = await res.text()
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
      }
      const payload = data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : null

      if (!res.ok) {
        const message = typeof payload?.error === 'string'
          ? payload.error
          : `Could not read directory (${res.status})`
        setError(message)
        setFolders([])
        return
      }

      const nextCurrent = typeof payload?.current === 'string' ? payload.current : ''
      const nextParent = typeof payload?.parent === 'string' ? payload.parent : nextCurrent
      const nextFolders = Array.isArray(payload?.folders)
        ? payload.folders.filter((folder: unknown): folder is Folder => (
          folder
          && typeof folder === 'object'
          && typeof folder.name === 'string'
          && typeof folder.path === 'string'
        ))
        : []

      setCurrentPath(nextCurrent)
      setParentPath(nextParent)
      setFolders(nextFolders)
      setManualPath(nextCurrent || '')
    } catch {
      setError('Could not read directory')
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [apiUrl, apiPath])

  useEffect(() => {
    browse()
  }, [browse])

  const handleSelect = () => {
    onSelect(currentPath)
  }

  return (
    <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-elevated w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-brand-900">Select Folder</h2>
            <p className="text-sm text-brand-500 mt-0.5">Choose your cases directory</p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
          >
            <XMarkIcon />
          </button>
        </div>

        {/* Path input */}
        <div className="px-6 py-3 border-b border-surface-200 bg-surface-50">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') browse(manualPath)
              }}
              className="flex-1 text-sm border border-surface-200 rounded-lg px-3 py-2 font-mono
                         bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
              placeholder="/path/to/folder"
            />
            <button
              onClick={() => browse(manualPath)}
              className="px-4 py-2 text-sm font-medium bg-brand-900 text-white rounded-lg
                         hover:bg-brand-800 transition-colors"
            >
              Go
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-6 py-3 border-b border-surface-200 flex items-center gap-3">
          <button
            onClick={() => browse(parentPath)}
            disabled={currentPath === parentPath}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                       bg-surface-100 hover:bg-surface-200 rounded-lg text-brand-700
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUpIcon />
            Up
          </button>
          <span className="text-sm text-brand-600 truncate flex-1 font-mono" title={currentPath}>
            {currentPath}
          </span>
        </div>
        {error && (
          <div className="px-6 py-2 border-b border-surface-200 bg-red-50 text-red-700 text-xs">
            {error}
          </div>
        )}

        {/* Folder list */}
        <div className="h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-2"></div>
                <p className="text-sm text-brand-400">Loading...</p>
              </div>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <div className="w-12 h-12 rounded-full bg-surface-100 flex items-center justify-center mb-3">
                <FolderIcon />
              </div>
              <p className="text-sm text-brand-500">No subfolders</p>
              <p className="text-xs text-brand-400 mt-1">This folder has no subdirectories</p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => browse(folder.path)}
                  className="w-full px-4 py-3 text-left hover:bg-surface-50 rounded-lg
                             flex items-center gap-3 group transition-colors"
                >
                  <span className="text-accent-600">
                    <FolderIcon />
                  </span>
                  <span className="text-sm font-medium text-brand-700 group-hover:text-brand-900">
                    {folder.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-200 flex justify-between items-center bg-surface-50">
          <p className="text-xs text-brand-400">
            Navigate to your cases folder, then click Select
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-brand-700 hover:bg-surface-200
                         rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={!currentPath}
              className="px-5 py-2 text-sm font-medium bg-brand-900 text-white
                         hover:bg-brand-800 rounded-lg transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
