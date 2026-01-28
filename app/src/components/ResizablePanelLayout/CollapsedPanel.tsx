interface CollapsedPanelProps {
  position: 'left' | 'right'
  label: string
  onExpand: () => void
}

// Chevron icons
const ChevronLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

export default function CollapsedPanel({ position, label, onExpand }: CollapsedPanelProps) {
  return (
    <div
      className={`
        w-10 h-full flex flex-col items-center
        bg-surface-100 border-surface-200
        ${position === 'left' ? 'border-r' : 'border-l'}
      `}
    >
      {/* Expand button at top */}
      <button
        onClick={onExpand}
        className="mt-3 w-7 h-7 rounded-lg bg-white border border-surface-300
                   flex items-center justify-center
                   text-brand-500 hover:text-brand-700 hover:border-surface-400
                   hover:bg-surface-50 transition-colors shadow-sm"
        title={`Expand ${label}`}
      >
        {position === 'left' ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </button>

      {/* Rotated label */}
      <div className="flex-1 flex items-center justify-center">
        <span
          className={`
            text-xs font-medium text-brand-400 tracking-wide uppercase
            whitespace-nowrap
            ${position === 'left' ? '-rotate-90' : 'rotate-90'}
          `}
        >
          {label}
        </span>
      </div>
    </div>
  )
}
