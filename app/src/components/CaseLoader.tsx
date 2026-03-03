import { useState, useEffect, useRef, useCallback } from 'react'
import type { DocumentIndex } from '../App'
import nicLogo from '../assets/nic_logo.png'

interface Props {
  caseFolder: string
  apiUrl: string
  onComplete: (index: DocumentIndex) => void
}

// Icons
const LeafIcon = () => (
  <img src={nicLogo} alt="NIC Logo" className="w-8 h-8 object-contain" />
)

export default function CaseLoader({ caseFolder, apiUrl, onComplete }: Props) {
  const [status, setStatus] = useState('Connecting...')
  const [progress, setProgress] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const initStarted = useRef(false)

  const runInit = useCallback(async () => {
    setStatus('Initializing case...')
    setProgress([])
    setError(null)

    try {
      const response = await fetch(`${apiUrl}/api/claude/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder }),
      })

      const reader = response.body?.getReader()
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

              if (data.type === 'progress' || data.type === 'output') {
                const text = data.text.trim()
                if (text) {
                  if (text.includes('Indexing') || text.includes('Processing') || text.includes('Reading')) {
                    setStatus(text.slice(0, 50))
                  }
                  setProgress((prev) => [...prev.slice(-10), text])
                }
              }

              if (data.type === 'done') {
                const indexRes = await fetch(
                  `${apiUrl}/api/files/index?case=${encodeURIComponent(caseFolder)}`
                )
                if (indexRes.ok) {
                  const index = await indexRes.json()
                  onComplete(index)
                } else {
                  setError('Index created but failed to load')
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize case')
    }
  }, [apiUrl, caseFolder, onComplete])

  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true
    runInit()
  }, [runInit])

  const caseName = caseFolder.split('/').pop() || caseFolder

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="bg-white rounded-2xl shadow-elevated p-8 max-w-lg w-full border border-surface-200">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand-900 flex items-center justify-center text-white">
            <LeafIcon />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-brand-900">Initializing Case</h2>
            <p className="text-sm text-brand-500 truncate max-w-xs" title={caseFolder}>
              {caseName}
            </p>
          </div>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-red-800 text-sm font-medium">Error</p>
            <p className="text-red-700 text-sm mt-1">{error}</p>
            <button
              onClick={runInit}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium
                         hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Status */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-brand-700">{status}</span>
                <div className="w-5 h-5 border-2 border-accent-200 border-t-accent-600 rounded-full animate-spin"></div>
              </div>
              <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-accent-500 to-accent-600 rounded-full w-full animate-pulse" />
              </div>
            </div>

            {/* Log output */}
            <div className="bg-brand-950 rounded-xl p-4 h-56 overflow-y-auto font-mono text-xs">
              {progress.map((line, i) => (
                <div key={i} className="text-accent-400 py-0.5">
                  <span className="text-brand-500 mr-2 select-none">$</span>
                  {line}
                </div>
              ))}
              <div className="text-accent-400 py-0.5">
                <span className="text-brand-500 mr-2 select-none">$</span>
                <span className="animate-pulse">_</span>
              </div>
            </div>

            <p className="text-xs text-brand-400 mt-4 text-center">
              This may take a few minutes for large case folders
            </p>
          </>
        )}
      </div>
    </div>
  )
}
