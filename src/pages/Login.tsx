import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { Lock, Loader2 } from 'lucide-react'

export function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signedUp, setSignedUp] = useState(false)

  async function submit() {
    if (!email || !password) { setError('Enter your email and password.'); return }
    if (mode === 'signup' && !fullName.trim()) { setError('Enter your full name.'); return }
    setLoading(true); setError(null)
    try {
      const result = mode === 'signin'
        ? await signIn(email, password)
        : await signUp(email, password, fullName)
      if (result.error) { setError(result.error); return }
      if (mode === 'signup') setSignedUp(true)
    } finally {
      setLoading(false)
    }
  }

  if (signedUp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
        <div className="max-w-sm w-full bg-white rounded-card shadow-[var(--shadow-card-xl)] p-6 text-center">
          <div className="w-12 h-12 rounded-card bg-panel-dark flex items-center justify-center mx-auto mb-3">
            <Lock size={20} className="text-accent" />
          </div>
          <p className="text-sm font-medium mb-1">Account created</p>
          <p className="text-xs text-gray-500">
            An admin needs to assign your role before you can access the system. Check back once they've done so.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      <div className="max-w-sm w-full bg-white rounded-card shadow-[var(--shadow-card-xl)] p-6 space-y-3">
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-card bg-panel-dark flex items-center justify-center mx-auto mb-3">
            <Lock size={20} className="text-accent" />
          </div>
          <h1 className="text-base font-medium">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        </div>
        {error && <p className="text-xs text-red-600 text-center">{error}</p>}
        {mode === 'signup' && (
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" />
        )}
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password"
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" />
        <button onClick={submit} disabled={loading}
          className="w-full px-3 py-2.5 text-sm rounded-full bg-accent text-accent-foreground font-medium disabled:opacity-50 flex items-center justify-center gap-2 hover:brightness-95 transition">
          {loading && <Loader2 size={14} className="animate-spin" />}
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
          className="w-full text-xs text-gray-400 hover:text-gray-600">
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}