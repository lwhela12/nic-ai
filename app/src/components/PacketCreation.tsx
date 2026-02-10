import { useState, useRef, useCallback, useEffect } from 'react'
import type { PacketDocument, PacketFrontMatter, PacketPiiResult, PacketState } from '../types/packet'

interface Props {
  packetState: PacketState
  onUpdateState: (updater: (prev: PacketState) => PacketState) => void
  caseFolder: string
  apiUrl: string
  firmRoot?: string
  onShowFile: (filePath: string) => void
  onExit: () => void
  onGenerated: (outputPath: string) => void
  onPreviewReady: (blobUrl: string) => void
}

type Tab = 'documents' | 'frontmatter' | 'pii'

// Icons
const GripIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
  </svg>
)

const PinIcon = ({ active }: { active: boolean }) => (
  <svg className={`w-3.5 h-3.5 ${active ? 'text-accent-600' : 'text-brand-400'}`} fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75V16.5L12 14.25 7.5 16.5V3.75" />
  </svg>
)

const XIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const WarningBadge = ({ reason }: { reason?: string }) => (
  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700" title={reason}>
    {reason || 'Warning'}
  </span>
)

export default function PacketCreation({
  packetState,
  onUpdateState,
  caseFolder,
  apiUrl,
  firmRoot,
  onShowFile,
  onExit,
  onGenerated,
  onPreviewReady,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('documents')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  // Drag state
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const { documents, frontMatter, piiResults = [], piiScanned } = packetState

  // Backfill firm block lines from firm config if still empty on mount
  const firmBlockCheckedRef = useRef(false)
  useEffect(() => {
    if (firmBlockCheckedRef.current) return
    const hasLines = frontMatter.firmBlockLines.some(l => l?.trim())
    if (hasLines || !firmRoot) {
      firmBlockCheckedRef.current = true
      return
    }
    firmBlockCheckedRef.current = true
    ;(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/knowledge/firm-config?root=${encodeURIComponent(firmRoot)}`)
        if (!res.ok) return
        const config = await res.json()
        if (Array.isArray(config?.firmBlockLines) && config.firmBlockLines.some((l: string) => l?.trim())) {
          onUpdateState(prev => ({ ...prev, frontMatter: { ...prev.frontMatter, firmBlockLines: config.firmBlockLines } }))
          return
        }
        const lines: string[] = []
        if (config?.attorneyName) lines.push(config.attorneyName)
        if (config?.nevadaBarNo) lines.push(`NV Bar No. ${config.nevadaBarNo}`)
        if (config?.firmName) lines.push(config.firmName)
        if (config?.address) lines.push(config.address)
        if (config?.cityStateZip) lines.push(config.cityStateZip)
        if (config?.phone) lines.push(`Phone: ${config.phone}`)
        if (config?.email) lines.push(config.email)
        if (lines.length > 0) {
          onUpdateState(prev => ({ ...prev, frontMatter: { ...prev.frontMatter, firmBlockLines: lines } }))
        }
      } catch { /* ignore */ }
    })()
  }, [apiUrl, firmRoot, frontMatter.firmBlockLines, onUpdateState])

  // --- Documents Tab ---
  const handleDragStart = (index: number) => {
    dragIndexRef.current = index
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (targetIndex: number) => {
    const sourceIndex = dragIndexRef.current
    if (sourceIndex === null || sourceIndex === targetIndex) {
      dragIndexRef.current = null
      setDragOverIndex(null)
      return
    }
    onUpdateState(prev => {
      const docs = [...prev.documents]
      const [moved] = docs.splice(sourceIndex, 1)
      docs.splice(targetIndex, 0, moved)
      return { ...prev, documents: docs.map((d, i) => ({ ...d, order: i })) }
    })
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  const handleTogglePin = (index: number) => {
    onUpdateState(prev => {
      const docs = [...prev.documents]
      docs[index] = { ...docs[index], pinned: !docs[index].pinned }
      return { ...prev, documents: docs }
    })
  }

  const handleRemoveDoc = (index: number) => {
    onUpdateState(prev => {
      const docs = prev.documents.filter((_, i) => i !== index).map((d, i) => ({ ...d, order: i }))
      return { ...prev, documents: docs }
    })
  }

  const handleSortUnpinned = () => {
    onUpdateState(prev => {
      const pinned: Array<{ doc: PacketDocument; origIndex: number }> = []
      const unpinned: PacketDocument[] = []
      prev.documents.forEach((d, i) => {
        if (d.pinned) pinned.push({ doc: d, origIndex: i })
        else unpinned.push(d)
      })
      // Sort unpinned by date ascending
      unpinned.sort((a, b) => {
        if (!a.date && !b.date) return 0
        if (!a.date) return 1
        if (!b.date) return -1
        return new Date(a.date).getTime() - new Date(b.date).getTime()
      })
      // Reconstruct: insert pinned at their original positions
      const result: PacketDocument[] = []
      let unpinnedIdx = 0
      for (let i = 0; i < prev.documents.length; i++) {
        const pinnedEntry = pinned.find(p => p.origIndex === i)
        if (pinnedEntry) {
          result.push(pinnedEntry.doc)
        } else if (unpinnedIdx < unpinned.length) {
          result.push(unpinned[unpinnedIdx++])
        }
      }
      return { ...prev, documents: result.map((d, i) => ({ ...d, order: i })) }
    })
  }

  // --- Front Matter ---
  const updateFrontMatter = (field: keyof PacketFrontMatter, value: unknown) => {
    onUpdateState(prev => ({
      ...prev,
      frontMatter: { ...prev.frontMatter, [field]: value },
    }))
  }

  const addRecipient = () => {
    onUpdateState(prev => ({
      ...prev,
      frontMatter: { ...prev.frontMatter, recipients: [...prev.frontMatter.recipients, ''] },
    }))
  }

  const updateRecipient = (index: number, value: string) => {
    onUpdateState(prev => {
      const recipients = [...prev.frontMatter.recipients]
      recipients[index] = value
      return { ...prev, frontMatter: { ...prev.frontMatter, recipients } }
    })
  }

  const removeRecipient = (index: number) => {
    onUpdateState(prev => ({
      ...prev,
      frontMatter: { ...prev.frontMatter, recipients: prev.frontMatter.recipients.filter((_, i) => i !== index) },
    }))
  }

  const updateFirmBlockLine = (index: number, value: string) => {
    onUpdateState(prev => {
      const lines = [...prev.frontMatter.firmBlockLines]
      lines[index] = value
      return { ...prev, frontMatter: { ...prev.frontMatter, firmBlockLines: lines } }
    })
  }

  const handlePreviewFrontMatter = async () => {
    setIsPreviewing(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/preview-front-matter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          frontMatter,
          documents: documents.map(d => ({ title: d.title, date: d.date })),
          firmRoot: firmRoot || undefined,
        }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        onPreviewReady(url)
      }
    } catch { /* ignore */ }
    setIsPreviewing(false)
  }

  // --- PII Scan ---
  const handleRunPiiScan = async () => {
    if (documents.length === 0) return
    setIsScanning(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/batch-scan-pii`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          paths: documents.map(d => d.path),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const results: PacketPiiResult[] = (data.results || []).map((r: PacketPiiResult) => ({
          ...r,
          approved: r.findings.length === 0, // Auto-approve clean docs
        }))
        onUpdateState(prev => ({ ...prev, piiResults: results, piiScanned: true }))
      }
    } catch { /* ignore */ }
    setIsScanning(false)
  }

  const handleApprovePiiDoc = (path: string) => {
    onUpdateState(prev => ({
      ...prev,
      piiResults: prev.piiResults.map(r =>
        r.path === path ? { ...r, approved: !r.approved } : r
      ),
    }))
  }

  const handleApproveAllPii = () => {
    onUpdateState(prev => ({
      ...prev,
      piiResults: prev.piiResults.map(r => ({ ...r, approved: true })),
    }))
  }

  // --- Save Draft ---
  const handleSaveDraft = async () => {
    setIsSaving(true)
    try {
      // Auto-generate a draft name on first save if not already set
      let stateToSave = packetState
      if (!packetState.draftName) {
        const now = new Date()
        const datePart = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
        const name = frontMatter.claimantName.trim()
          ? `${frontMatter.claimantName.trim()} - ${datePart}`
          : `Evidence Packet Draft - ${datePart}`
        stateToSave = { ...packetState, draftName: name }
      }
      const res = await fetch(`${apiUrl}/api/docs/packet-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseFolder, state: stateToSave }),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdateState(prev => ({
          ...prev,
          draftId: data.draftId,
          draftName: stateToSave.draftName,
        }))
      }
    } catch { /* ignore */ }
    setIsSaving(false)
  }

  // --- Generate Packet ---
  const validateForGeneration = (): string | null => {
    if (documents.length === 0) return 'Select at least one document'
    if (!frontMatter.claimantName.trim()) return 'Claimant name is required'
    return null
  }

  const handleGeneratePacket = async () => {
    const error = validateForGeneration()
    if (error) {
      setGenerateError(error)
      return
    }
    setGenerateError(null)
    setIsGenerating(true)
    try {
      const res = await fetch(`${apiUrl}/api/docs/generate-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseFolder,
          documents: documents.map(d => ({
            path: d.path,
            title: d.title,
            date: d.date,
            docType: d.type,
            include: true,
          })),
          frontMatter,
          redactionMode: 'best_effort',
          firmRoot: firmRoot || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onUpdateState(prev => ({
          ...prev,
          generatedAt: new Date().toISOString(),
          outputPath: data.outputPath,
        }))
        if (data.outputPath) {
          onGenerated(data.outputPath)
        }
      } else {
        const data = await res.json().catch(() => ({ error: 'Generation failed' }))
        setGenerateError(data.error || 'Generation failed')
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generation failed')
    }
    setIsGenerating(false)
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'documents', label: 'Documents', count: documents.length },
    { id: 'frontmatter', label: 'Front Matter' },
    { id: 'pii', label: 'PII Scan', count: piiResults.reduce((sum, r) => sum + r.findings.length, 0) || undefined },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-surface-200 px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-brand-500 hover:text-brand-700 hover:border-surface-300'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full ${
                activeTab === tab.id ? 'bg-accent-100 text-accent-700' : 'bg-surface-100 text-brand-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'documents' && (
          <DocumentsTab
            documents={documents}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            dragOverIndex={dragOverIndex}
            onTogglePin={handleTogglePin}
            onRemove={handleRemoveDoc}
            onSortUnpinned={handleSortUnpinned}
            onShowFile={onShowFile}
          />
        )}
        {activeTab === 'frontmatter' && (
          <FrontMatterTab
            frontMatter={frontMatter}
            onUpdate={updateFrontMatter}
            onAddRecipient={addRecipient}
            onUpdateRecipient={updateRecipient}
            onRemoveRecipient={removeRecipient}
            onUpdateFirmBlockLine={updateFirmBlockLine}
            onPreview={handlePreviewFrontMatter}
            isPreviewing={isPreviewing}
          />
        )}
        {activeTab === 'pii' && (
          <PiiScanTab
            documents={documents}
            piiResults={piiResults}
            piiScanned={piiScanned}
            isScanning={isScanning}
            onRunScan={handleRunPiiScan}
            onApproveDoc={handleApprovePiiDoc}
            onApproveAll={handleApproveAllPii}
            onShowFile={onShowFile}
          />
        )}
      </div>

      {/* Footer bar */}
      <div className="border-t border-surface-200 px-4 py-3 bg-surface-50 flex items-center gap-3">
        {generateError && (
          <p className="text-xs text-red-600 flex-1">{generateError}</p>
        )}
        {packetState.generatedAt && !generateError && (
          <p className="text-xs text-emerald-600 flex-1">
            Packet generated {packetState.outputPath ? `at ${packetState.outputPath}` : ''}
          </p>
        )}
        {!generateError && !packetState.generatedAt && <div className="flex-1" />}
        <button
          onClick={handleSaveDraft}
          disabled={isSaving}
          className="px-4 py-2 text-sm text-brand-600 hover:text-brand-800 hover:bg-surface-100
                     rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : packetState.draftId ? 'Update Draft' : 'Save Draft'}
        </button>
        <button
          onClick={handleGeneratePacket}
          disabled={isGenerating || documents.length === 0}
          className="px-5 py-2 text-sm font-medium bg-brand-900 text-white rounded-lg
                     hover:bg-brand-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-2"
        >
          {isGenerating ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            'Generate Packet'
          )}
        </button>
        <button
          onClick={onExit}
          className="px-4 py-2 text-sm text-brand-500 hover:text-brand-700 hover:bg-surface-100
                     rounded-lg transition-colors"
        >
          Exit
        </button>
      </div>
    </div>
  )
}

// --- Documents Tab ---
function DocumentsTab({
  documents,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragOverIndex,
  onTogglePin,
  onRemove,
  onSortUnpinned,
  onShowFile,
}: {
  documents: PacketDocument[]
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
  dragOverIndex: number | null
  onTogglePin: (index: number) => void
  onRemove: (index: number) => void
  onSortUnpinned: () => void
  onShowFile: (path: string) => void
}) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-brand-700">No documents selected</p>
        <p className="text-xs text-brand-500 mt-1">Use the checkboxes in the file panel to select documents</p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-900">{documents.length} Document{documents.length !== 1 ? 's' : ''}</h3>
        <button
          onClick={onSortUnpinned}
          className="text-xs text-accent-600 hover:text-accent-800 font-medium transition-colors"
        >
          Sort Unpinned by Date
        </button>
      </div>
      <div className="space-y-1">
        {documents.map((doc, index) => (
          <div
            key={doc.path}
            draggable
            onDragStart={() => onDragStart(index)}
            onDragOver={(e) => onDragOver(e, index)}
            onDrop={() => onDrop(index)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-move ${
              dragOverIndex === index
                ? 'border-accent-400 bg-accent-50'
                : doc.hasWarning
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-surface-200 bg-white hover:bg-surface-50'
            }`}
          >
            <span className="text-brand-300 cursor-grab"><GripIcon /></span>
            <button
              onClick={() => onShowFile(doc.path)}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-sm text-brand-800 truncate">{doc.title || doc.fileName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {doc.date ? (
                  <span className="text-[11px] text-brand-500">{doc.date}</span>
                ) : (
                  <span className="text-[11px] text-amber-600 font-medium">No Date</span>
                )}
                {doc.type && (
                  <span className="text-[11px] text-brand-400">{doc.type}</span>
                )}
                {doc.hasWarning && <WarningBadge reason={doc.warningReason} />}
              </div>
            </button>
            <button
              onClick={() => onTogglePin(index)}
              className="p-1 rounded hover:bg-surface-100 transition-colors"
              title={doc.pinned ? 'Unpin' : 'Pin (keeps position during sort)'}
            >
              <PinIcon active={doc.pinned} />
            </button>
            <button
              onClick={() => onRemove(index)}
              className="p-1 rounded text-brand-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Remove"
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Front Matter Tab ---
function FrontMatterTab({
  frontMatter,
  onUpdate,
  onAddRecipient,
  onUpdateRecipient,
  onRemoveRecipient,
  onUpdateFirmBlockLine,
  onPreview,
  isPreviewing,
}: {
  frontMatter: PacketFrontMatter
  onUpdate: (field: keyof PacketFrontMatter, value: unknown) => void
  onAddRecipient: () => void
  onUpdateRecipient: (index: number, value: string) => void
  onRemoveRecipient: (index: number) => void
  onUpdateFirmBlockLine: (index: number, value: string) => void
  onPreview: () => void
  isPreviewing: boolean
}) {
  const inputClass = "w-full text-sm border border-surface-200 rounded-lg px-3 py-2 bg-white text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500"
  const labelClass = "block text-xs font-medium text-brand-700 mb-1"

  // Ensure 7 firm block lines
  const firmLines = [...frontMatter.firmBlockLines]
  while (firmLines.length < 7) firmLines.push('')

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Claimant Name *</label>
          <input
            className={inputClass}
            value={frontMatter.claimantName}
            onChange={e => onUpdate('claimantName', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Claim Number</label>
          <input
            className={inputClass}
            value={frontMatter.claimNumber}
            onChange={e => onUpdate('claimNumber', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Hearing Number</label>
          <input
            className={inputClass}
            value={frontMatter.hearingNumber}
            onChange={e => onUpdate('hearingNumber', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Hearing Date/Time</label>
          <input
            className={inputClass}
            value={frontMatter.hearingDateTime}
            onChange={e => onUpdate('hearingDateTime', e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Appearance</label>
          <input
            className={inputClass}
            value={frontMatter.appearance}
            onChange={e => onUpdate('appearance', e.target.value)}
            placeholder="Telephonic"
          />
        </div>
        <div>
          <label className={labelClass}>Service Date</label>
          <input
            className={inputClass}
            value={frontMatter.serviceDate}
            onChange={e => onUpdate('serviceDate', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Introductory Counsel Line</label>
        <input
          className={inputClass}
          value={frontMatter.introductoryCounselLine}
          onChange={e => onUpdate('introductoryCounselLine', e.target.value)}
          placeholder="COMES NOW, [name], by and through counsel..."
        />
      </div>

      <div>
        <label className={labelClass}>Service Method</label>
        <select
          className={inputClass}
          value={frontMatter.serviceMethod}
          onChange={e => onUpdate('serviceMethod', e.target.value)}
        >
          <option value="Via E-File">Via E-File</option>
          <option value="Via U.S. Mail">Via U.S. Mail</option>
          <option value="Via Email">Via Email</option>
          <option value="Via Fax">Via Fax</option>
          <option value="Via Hand Delivery">Via Hand Delivery</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelClass}>Recipients</label>
          <button onClick={onAddRecipient} className="text-xs text-accent-600 hover:text-accent-800 font-medium">
            + Add
          </button>
        </div>
        <div className="space-y-2">
          {frontMatter.recipients.map((recipient, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass}
                value={recipient}
                onChange={e => onUpdateRecipient(i, e.target.value)}
                placeholder="Recipient name and address"
              />
              <button
                onClick={() => onRemoveRecipient(i)}
                className="p-2 text-brand-400 hover:text-red-500 transition-colors"
              >
                <XIcon />
              </button>
            </div>
          ))}
          {frontMatter.recipients.length === 0 && (
            <p className="text-xs text-brand-400 italic">No recipients added</p>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>Firm Block (7 lines)</label>
        <div className="space-y-1">
          {firmLines.slice(0, 7).map((line, i) => (
            <input
              key={i}
              className={`${inputClass} text-xs`}
              value={line}
              onChange={e => onUpdateFirmBlockLine(i, e.target.value)}
              placeholder={i === 0 ? 'Attorney Name, Esq.' : i === 1 ? 'NV Bar No. XXXXX' : ''}
            />
          ))}
        </div>
      </div>

      <button
        onClick={onPreview}
        disabled={isPreviewing}
        className="px-4 py-2 text-sm font-medium bg-surface-100 text-brand-700 rounded-lg
                   hover:bg-surface-200 transition-colors disabled:opacity-50"
      >
        {isPreviewing ? 'Generating Preview...' : 'Preview Front Matter'}
      </button>
    </div>
  )
}

// --- PII Scan Tab ---
function PiiScanTab({
  documents,
  piiResults,
  piiScanned,
  isScanning,
  onRunScan,
  onApproveDoc,
  onApproveAll,
  onShowFile,
}: {
  documents: PacketDocument[]
  piiResults: PacketPiiResult[]
  piiScanned: boolean
  isScanning: boolean
  onRunScan: () => void
  onApproveDoc: (path: string) => void
  onApproveAll: () => void
  onShowFile: (path: string) => void
}) {
  const totalFindings = piiResults.reduce((sum, r) => sum + r.findings.length, 0)
  const ssnCount = piiResults.reduce((sum, r) => sum + r.findings.filter(f => f.kind === 'ssn').length, 0)
  const dobCount = piiResults.reduce((sum, r) => sum + r.findings.filter(f => f.kind === 'dob').length, 0)
  const allApproved = piiResults.length > 0 && piiResults.every(r => r.approved)

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-brand-900">PII Detection</h3>
          <p className="text-xs text-brand-500 mt-0.5">
            Scan selected documents for SSN and DOB. Detected items are auto-redacted during generation.
          </p>
        </div>
        <button
          onClick={onRunScan}
          disabled={isScanning || documents.length === 0}
          className="px-4 py-2 text-sm font-medium bg-brand-900 text-white rounded-lg
                     hover:bg-brand-800 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isScanning ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Scanning...
            </>
          ) : (
            piiScanned ? 'Re-scan' : 'Run PII Scan'
          )}
        </button>
      </div>

      {isScanning && (
        <div className="mb-4 p-4 bg-surface-50 rounded-lg border border-surface-200">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-brand-600">Scanning {documents.length} document{documents.length !== 1 ? 's' : ''} for sensitive data...</p>
          </div>
        </div>
      )}

      {piiScanned && !isScanning && (
        <>
          {/* Summary */}
          <div className="mb-4 p-3 rounded-lg border bg-surface-50 border-surface-200">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className={`text-lg font-semibold ${totalFindings > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {totalFindings}
                </p>
                <p className="text-[10px] text-brand-500 uppercase">Findings</p>
              </div>
              {totalFindings > 0 && (
                <>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-brand-700">{ssnCount}</p>
                    <p className="text-[10px] text-brand-500 uppercase">SSN</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-brand-700">{dobCount}</p>
                    <p className="text-[10px] text-brand-500 uppercase">DOB</p>
                  </div>
                </>
              )}
              <div className="flex-1" />
              {totalFindings > 0 && !allApproved && (
                <button
                  onClick={onApproveAll}
                  className="px-3 py-1.5 text-xs font-medium bg-accent-600 text-white rounded-lg
                             hover:bg-accent-700 transition-colors"
                >
                  Approve All
                </button>
              )}
              {allApproved && (
                <span className="px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-lg">
                  All Approved
                </span>
              )}
            </div>
          </div>

          {/* Per-doc results */}
          <div className="space-y-1">
            {piiResults.map(result => {
              const doc = documents.find(d => d.path === result.path)
              return (
                <div
                  key={result.path}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                    result.findings.length > 0 && !result.approved
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-surface-200 bg-white'
                  }`}
                >
                  <button
                    onClick={() => onShowFile(result.path)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm text-brand-700 truncate">{doc?.title || result.path.split('/').pop()}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {result.findings.length === 0 ? (
                        <span className="text-[11px] text-emerald-600">No PII detected</span>
                      ) : (
                        <>
                          <span className="text-[11px] text-amber-600 font-medium">
                            {result.findings.length} finding{result.findings.length !== 1 ? 's' : ''}
                          </span>
                          {result.findings.filter(f => f.kind === 'ssn').length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              {result.findings.filter(f => f.kind === 'ssn').length} SSN
                            </span>
                          )}
                          {result.findings.filter(f => f.kind === 'dob').length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                              {result.findings.filter(f => f.kind === 'dob').length} DOB
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => onApproveDoc(result.path)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      result.approved
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-surface-100 text-brand-600 hover:bg-surface-200'
                    }`}
                  >
                    {result.approved ? 'Approved' : 'Approve'}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {!piiScanned && !isScanning && (
        <div className="text-center py-12">
          <p className="text-sm text-brand-500">Run a PII scan to check for sensitive data in selected documents</p>
          <p className="text-xs text-brand-400 mt-1">SSN and DOB will be auto-redacted during packet generation</p>
        </div>
      )}
    </div>
  )
}
