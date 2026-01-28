import { useState } from 'react'

interface LoginProps {
  apiUrl: string
  onLoginSuccess: (email: string, subscriptionStatus: string) => void
}

// Icon components
const ScaleIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
  </svg>
)

const SpinnerIcon = () => (
  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
)

export default function Login({ apiUrl, onLoginSuccess }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email || !password) {
      setError('Please enter email and password')
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsLoading(true)

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup'
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Authentication failed')
        return
      }

      onLoginSuccess(data.email, data.subscriptionStatus)
    } catch {
      setError('Could not connect to server. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="bg-white rounded-2xl shadow-elevated p-10 max-w-md w-full border border-surface-200">
        {/* Logo/Brand */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-brand-900 flex items-center justify-center text-white">
            <ScaleIcon />
          </div>
          <h1 className="font-serif text-3xl text-brand-900">Claude PI</h1>
        </div>
        <p className="text-brand-500 mb-8">Personal Injury Case Management</p>

        {/* Tab selector */}
        <div className="flex border-b border-surface-200 mb-6">
          <button
            onClick={() => { setMode('login'); setError('') }}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'login'
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-brand-400 hover:text-brand-600'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setMode('signup'); setError('') }}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'signup'
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-brand-400 hover:text-brand-600'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-brand-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-surface-300 rounded-lg focus:outline-none
                         focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="you@lawfirm.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-brand-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-surface-300 rounded-lg focus:outline-none
                         focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-brand-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 border border-surface-300 rounded-lg focus:outline-none
                           focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand-900 text-white py-3 px-4 rounded-lg font-medium
                       hover:bg-brand-800 transition-colors disabled:opacity-50
                       disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <SpinnerIcon />
                {mode === 'login' ? 'Signing in...' : 'Creating account...'}
              </>
            ) : (
              mode === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="text-xs text-brand-400 text-center mt-6">
            Free 14-day trial. No credit card required.
          </p>
        )}

        {mode === 'login' && (
          <p className="text-xs text-brand-400 text-center mt-6">
            <a href="#" className="text-accent-600 hover:underline">
              Forgot password?
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
