interface FirmTodo {
  id: string
  text: string
  caseRef?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'completed'
  createdAt: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  todos: FirmTodo[]
  onToggleTodo: (id: string) => void
  onClearCompleted: () => void
  onGenerateTasks?: () => void
  isGenerating?: boolean
  hasAttemptedGenerate?: boolean
}

// Icons
const XMarkIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
)

const ClipboardListIcon = () => (
  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
)

const SparklesIcon = () => (
  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const getPriorityBadge = (priority: 'high' | 'medium' | 'low') => {
  const config = {
    high: 'bg-red-100 text-red-700 ring-1 ring-red-200',
    medium: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
    low: 'bg-surface-100 text-brand-500 ring-1 ring-surface-200',
  }
  const labels = { high: 'HIGH', medium: 'MED', low: 'LOW' }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded ${config[priority]}`}>
      {labels[priority]}
    </span>
  )
}

export default function TodoDrawer({
  isOpen, onClose, todos, onToggleTodo, onClearCompleted,
  onGenerateTasks, isGenerating, hasAttemptedGenerate
}: Props) {
  const pendingCount = todos.filter(t => t.status === 'pending').length
  const hasCompleted = todos.some(t => t.status === 'completed')
  const groupedTodos = (() => {
    const groups = new Map<string, FirmTodo[]>()
    for (const todo of todos) {
      const label = todo.caseRef?.trim() || 'General'
      if (!groups.has(label)) {
        groups.set(label, [])
      }
      groups.get(label)!.push(todo)
    }
    return Array.from(groups.entries())
  })()

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-brand-900/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-white shadow-elevated z-50 flex flex-col
                    transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-brand-900">Tasks</h2>
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold
                             bg-accent-100 text-accent-700 rounded-full">
                {pendingCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-brand-400 hover:text-brand-600 hover:bg-surface-100 rounded-lg transition-colors"
          >
            <XMarkIcon />
          </button>
        </div>

        {/* Todo list */}
        <div className="flex-1 overflow-y-auto">
          {todos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              {isGenerating ? (
                // Generating state
                <>
                  <div className="w-20 h-20 rounded-full bg-accent-50 flex items-center justify-center mb-4 text-accent-500">
                    <SparklesIcon />
                  </div>
                  <p className="text-brand-600 font-medium">Generating tasks...</p>
                  <p className="text-sm text-brand-400 mt-1">
                    Analyzing your case portfolio
                  </p>
                  <div className="mt-4 flex gap-1.5">
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                  </div>
                </>
              ) : hasAttemptedGenerate ? (
                // All caught up state (after generation attempted)
                <>
                  <div className="w-20 h-20 rounded-full bg-accent-50 flex items-center justify-center mb-4 text-accent-500">
                    <CheckCircleIcon />
                  </div>
                  <p className="text-accent-600 font-medium">All Caught Up!</p>
                  <p className="text-sm text-brand-400 mt-1">
                    No pending tasks for your portfolio
                  </p>
                  {onGenerateTasks && (
                    <button
                      onClick={onGenerateTasks}
                      className="mt-4 px-4 py-2 text-sm font-medium text-brand-600
                                 border border-surface-200 rounded-lg hover:bg-surface-100 transition-colors"
                    >
                      Check Again
                    </button>
                  )}
                </>
              ) : (
                // Initial empty state - show generate button
                <>
                  <div className="w-20 h-20 rounded-full bg-surface-100 flex items-center justify-center mb-4 text-brand-300">
                    <ClipboardListIcon />
                  </div>
                  <p className="text-brand-600 font-medium">No tasks yet</p>
                  <p className="text-sm text-brand-400 mt-1">
                    Generate tasks from your case portfolio
                  </p>
                  {onGenerateTasks && (
                    <button
                      onClick={onGenerateTasks}
                      className="mt-4 px-5 py-2.5 text-sm font-medium text-white
                                 bg-accent-600 rounded-lg hover:bg-accent-700 transition-colors
                                 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      Generate Tasks
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="divide-y divide-surface-100">
              {groupedTodos.map(([groupLabel, groupItems]) => (
                <div key={groupLabel}>
                  <div className="px-6 py-2 bg-surface-50 border-b border-surface-100">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-500">
                      {groupLabel}
                    </p>
                  </div>
                  {groupItems.map((todo) => (
                    <div
                      key={todo.id}
                      className={`px-6 py-4 hover:bg-surface-50 transition-colors ${
                        todo.status === 'completed' ? 'bg-surface-50/50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <button
                          onClick={() => onToggleTodo(todo.id)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center
                                      transition-colors ${
                            todo.status === 'completed'
                              ? 'bg-accent-600 border-accent-600 text-white'
                              : 'border-surface-300 hover:border-accent-500'
                          }`}
                        >
                          {todo.status === 'completed' && <CheckIcon />}
                        </button>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getPriorityBadge(todo.priority)}
                          </div>
                          <p
                            className={`text-sm leading-snug ${
                              todo.status === 'completed'
                                ? 'text-brand-400 line-through'
                                : 'text-brand-800'
                            }`}
                          >
                            {todo.text}
                          </p>
                          {todo.caseRef && (
                            <p className="text-xs text-accent-600 mt-1.5 flex items-center gap-1">
                              <span className="text-brand-400">↳</span>
                              {todo.caseRef}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasCompleted && (
          <div className="px-6 py-4 border-t border-surface-200 bg-surface-50">
            <button
              onClick={onClearCompleted}
              className="w-full px-4 py-2.5 text-sm font-medium text-brand-600 bg-white
                         border border-surface-200 rounded-lg hover:bg-surface-100 transition-colors"
            >
              Clear Completed
            </button>
          </div>
        )}
      </div>
    </>
  )
}
