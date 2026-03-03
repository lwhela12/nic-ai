import { useState } from 'react'
import TemplateManager from './TemplateManager'

interface Props {
  firmRoot: string
  apiUrl: string
}

const BookOpenIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
)

const DocumentDuplicateIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
  </svg>
)

export default function KnowledgeTab({ firmRoot, apiUrl }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<'practice' | 'templates'>('templates')

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-surface-200 px-4">
        <button
          onClick={() => setActiveSubTab('practice')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeSubTab === 'practice'
              ? 'text-brand-900 border-brand-900'
              : 'text-brand-500 border-transparent hover:text-brand-700'
          }`}
        >
          <BookOpenIcon />
          Knowledge Base
        </button>
        <button
          onClick={() => setActiveSubTab('templates')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeSubTab === 'templates'
              ? 'text-brand-900 border-brand-900'
              : 'text-brand-500 border-transparent hover:text-brand-700'
          }`}
        >
          <DocumentDuplicateIcon />
          Document Templates
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeSubTab === 'practice' ? (
          <div className="p-6">
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4 text-brand-400">
                <BookOpenIcon />
              </div>
              <p className="text-lg font-medium text-brand-700">Knowledge Base</p>
              <p className="text-sm text-brand-400 mt-1 max-w-sm mx-auto">
                Manage notes, references, and reusable guidance for personal, family, and business workflows.
              </p>
            </div>
          </div>
        ) : (
          <TemplateManager firmRoot={firmRoot} apiUrl={apiUrl} />
        )}
      </div>
    </div>
  )
}
