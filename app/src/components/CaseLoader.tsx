import { useState, useEffect, useRef, useCallback } from 'react'
import type { DocumentIndex } from '../App'

interface Props {
  caseFolder: string
  apiUrl: string
  onComplete: (index: DocumentIndex) => void
}

// Icons
const ScaleIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
  </svg>
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
            <ScaleIcon />
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
                <div key={i} className="text-emerald-400 py-0.5">
                  <span className="text-brand-500 mr-2 select-none">$</span>
                  {line}
                </div>
              ))}
              <div className="text-emerald-400 py-0.5">
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
