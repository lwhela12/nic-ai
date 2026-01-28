import type { ReactNode } from 'react'
import { usePanelState } from './usePanelState'
import ResizeDivider from './ResizeDivider'
import CollapsedPanel from './CollapsedPanel'

interface ResizablePanelLayoutProps {
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
  leftLabel?: string
  rightLabel?: string
}

export default function ResizablePanelLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  leftLabel = 'Files',
  rightLabel = 'Preview',
}: ResizablePanelLayoutProps) {
  const {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    isDragging,
    setIsDragging,
    adjustLeftWidth,
    adjustRightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    resetLeftWidth,
    resetRightWidth,
  } = usePanelState()

  // Transition class for smooth animations (disabled while dragging)
  const transitionClass = isDragging ? '' : 'panel-transition'

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Panel */}
      {leftCollapsed ? (
        <CollapsedPanel
          position="left"
          label={leftLabel}
          onExpand={toggleLeftCollapsed}
        />
      ) : (
        <>
          <div
            className={`flex flex-col bg-white border-r border-surface-200 overflow-hidden ${transitionClass}`}
            style={{ width: leftWidth }}
          >
            {leftPanel}
          </div>
          <ResizeDivider
            position="left"
            onDrag={(delta) => adjustLeftWidth(delta)}
            onDragStart={() => setIsDragging('left')}
            onDragEnd={() => setIsDragging(null)}
            onDoubleClick={resetLeftWidth}
            onToggleCollapse={toggleLeftCollapsed}
            isCollapsed={false}
          />
        </>
      )}

      {/* Center Panel - fills remaining space */}
      <div className="flex-1 flex flex-col bg-surface-50 min-w-0">
        {centerPanel}
      </div>

      {/* Right Panel */}
      {rightCollapsed ? (
        <CollapsedPanel
          position="right"
          label={rightLabel}
          onExpand={toggleRightCollapsed}
        />
      ) : (
        <>
          <ResizeDivider
            position="right"
            onDrag={(delta) => adjustRightWidth(delta)}
            onDragStart={() => setIsDragging('right')}
            onDragEnd={() => setIsDragging(null)}
            onDoubleClick={resetRightWidth}
            onToggleCollapse={toggleRightCollapsed}
            isCollapsed={false}
          />
          <div
            className={`flex flex-col bg-white border-l border-surface-200 overflow-hidden ${transitionClass}`}
            style={{ width: rightWidth }}
          >
            {rightPanel}
          </div>
        </>
      )}
    </div>
  )
}
