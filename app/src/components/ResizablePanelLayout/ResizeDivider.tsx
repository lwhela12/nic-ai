import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizeDividerProps {
  position: 'left' | 'right'
  onDrag: (delta: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDoubleClick: () => void
  onToggleCollapse: () => void
  isCollapsed: boolean
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

export default function ResizeDivider({
  position,
  onDrag,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onToggleCollapse,
  isCollapsed,
}: ResizeDividerProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const lastX = useRef(0)

  // Store callbacks in refs to avoid stale closures
  const onDragRef = useRef(onDrag)
  const onDragStartRef = useRef(onDragStart)
  const onDragEndRef = useRef(onDragEnd)

  useEffect(() => {
    onDragRef.current = onDrag
    onDragStartRef.current = onDragStart
    onDragEndRef.current = onDragEnd
  }, [onDrag, onDragStart, onDragEnd])

  // Handle mouse events at document level when dragging
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - lastX.current
      lastX.current = e.clientX

      // For left divider: positive mouse delta = expand left panel
      // For right divider: positive mouse delta = shrink right panel (so negate)
      const adjustedDelta = position === 'left' ? delta : -delta
      onDragRef.current(adjustedDelta)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      onDragEndRef.current()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, position])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    lastX.current = e.clientX
    setIsDragging(true)
    onDragStartRef.current()
  }, [])

  // Determine which chevron to show based on position and collapsed state
  const getCollapseIcon = () => {
    if (position === 'left') {
      return isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />
    } else {
      return isCollapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />
    }
  }

  return (
    <div
      className="relative flex-shrink-0 group touch-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Draggable area */}
      <div
        className={`relative w-2 h-full cursor-col-resize transition-colors ${
          isDragging ? 'bg-accent-100' : 'bg-transparent hover:bg-surface-100'
        }`}
        onMouseDown={handleMouseDown}
        onDoubleClick={onDoubleClick}
      >
        <div
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px ${
            isDragging ? 'bg-accent-500' : 'bg-surface-300 group-hover:bg-accent-400'
          }`}
        />
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-11 rounded-full ${
            isDragging ? 'bg-accent-400/40' : 'bg-surface-200/80 group-hover:bg-surface-300'
          }`}
        />
      </div>

      {/* Collapse button - appears on hover */}
      <button
        onClick={onToggleCollapse}
        className={`
          absolute top-2.5 -translate-x-1/2 left-1/2
          w-6 h-6 rounded-full
          bg-white/95 border border-surface-300 shadow-sm
          flex items-center justify-center
          text-brand-500 hover:text-brand-700 hover:border-surface-400
          transition-all duration-150 focus-visible:opacity-100
          ${isHovered && !isDragging ? 'opacity-100 scale-100' : 'opacity-70 scale-95'}
        `}
        title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {getCollapseIcon()}
      </button>
    </div>
  )
}
