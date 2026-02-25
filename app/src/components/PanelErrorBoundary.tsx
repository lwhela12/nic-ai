import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  panelName: string
  resetKey?: string | number | null
  onReset?: () => void
}

interface State {
  hasError: boolean
  errorMessage: string | null
}

export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: null,
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : 'Unexpected panel error'
    return {
      hasError: true,
      errorMessage: message,
    }
  }

  componentDidCatch(error: unknown): void {
    console.error(`[${this.props.panelName}] panel error:`, error)
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({
        hasError: false,
        errorMessage: null,
      })
    }
  }

  private handleReset = (): void => {
    this.setState({
      hasError: false,
      errorMessage: null,
    })
    this.props.onReset?.()
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="h-full w-full flex items-center justify-center bg-surface-50 p-6">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-5">
          <p className="text-sm font-semibold text-red-700">
            {this.props.panelName} crashed
          </p>
          <p className="mt-2 text-xs text-brand-600">
            {this.state.errorMessage || 'Unexpected panel error'}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-4 px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-brand-700 hover:bg-surface-100 transition-colors"
          >
            Reset Panel
          </button>
        </div>
      </div>
    )
  }
}
