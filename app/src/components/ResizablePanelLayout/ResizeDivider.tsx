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
      className="relative flex-shrink-0 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Draggable area */}
      <div
        className={`w-1 h-full cursor-col-resize transition-colors ${
          isDragging ? 'bg-accent-500' : 'bg-surface-200 hover:bg-accent-400'
        }`}
        onMouseDown={handleMouseDown}
        onDoubleClick={onDoubleClick}
      />

      {/* Collapse button - appears on hover */}
      <button
        onClick={onToggleCollapse}
        className={`
          absolute top-3 -translate-x-1/2 left-1/2
          w-6 h-6 rounded-full
          bg-white border border-surface-300 shadow-sm
          flex items-center justify-center
          text-brand-500 hover:text-brand-700 hover:border-surface-400
          transition-all duration-150
          ${isHovered && !isDragging ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
        `}
        title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {getCollapseIcon()}
      </button>
    </div>
  )
}
