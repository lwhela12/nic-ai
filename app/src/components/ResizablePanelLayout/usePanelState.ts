import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'claude-pi-panel-layout'

// Panel constraints - min only, max is calculated dynamically based on viewport
export const PANEL_CONSTRAINTS = {
  left: { default: 288, min: 150, collapsed: 40 },
  right: { default: 420, min: 150, collapsed: 40 },
  centerMin: 300, // Minimum center panel width
}

interface PanelState {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

const DEFAULT_STATE: PanelState = {
  leftWidth: PANEL_CONSTRAINTS.left.default,
  rightWidth: PANEL_CONSTRAINTS.right.default,
  leftCollapsed: false,
  rightCollapsed: false,
}

function loadFromStorage(): PanelState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        leftWidth: parsed.leftWidth ?? DEFAULT_STATE.leftWidth,
        rightWidth: parsed.rightWidth ?? DEFAULT_STATE.rightWidth,
        leftCollapsed: parsed.leftCollapsed ?? DEFAULT_STATE.leftCollapsed,
        rightCollapsed: parsed.rightCollapsed ?? DEFAULT_STATE.rightCollapsed,
      }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_STATE
}

function saveToStorage(state: PanelState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

export function usePanelState() {
  const [state, setState] = useState<PanelState>(loadFromStorage)
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null)

  // Persist state changes to localStorage
  useEffect(() => {
    saveToStorage(state)
  }, [state])

  // Use delta-based updates to avoid stale closure issues during drag
  const adjustLeftWidth = useCallback((delta: number) => {
    setState(prev => {
      const { min } = PANEL_CONSTRAINTS.left
      const maxLeft = window.innerWidth - prev.rightWidth - PANEL_CONSTRAINTS.centerMin - 10
      const newWidth = Math.max(min, Math.min(maxLeft, prev.leftWidth + delta))
      return { ...prev, leftWidth: newWidth }
    })
  }, [])

  const adjustRightWidth = useCallback((delta: number) => {
    setState(prev => {
      const { min } = PANEL_CONSTRAINTS.right
      const maxRight = window.innerWidth - prev.leftWidth - PANEL_CONSTRAINTS.centerMin - 10
      const newWidth = Math.max(min, Math.min(maxRight, prev.rightWidth + delta))
      return { ...prev, rightWidth: newWidth }
    })
  }, [])

  const toggleLeftCollapsed = useCallback(() => {
    setState(prev => ({ ...prev, leftCollapsed: !prev.leftCollapsed }))
  }, [])

  const toggleRightCollapsed = useCallback(() => {
    setState(prev => ({ ...prev, rightCollapsed: !prev.rightCollapsed }))
  }, [])

  const resetLeftWidth = useCallback(() => {
    setState(prev => ({ ...prev, leftWidth: PANEL_CONSTRAINTS.left.default }))
  }, [])

  const resetRightWidth = useCallback(() => {
    setState(prev => ({ ...prev, rightWidth: PANEL_CONSTRAINTS.right.default }))
  }, [])

  return {
    ...state,
    isDragging,
    setIsDragging,
    adjustLeftWidth,
    adjustRightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    resetLeftWidth,
    resetRightWidth,
  }
}
