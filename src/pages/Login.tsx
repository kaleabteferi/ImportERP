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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm w-full bg-white border border-gray-200 rounded-xl p-6 text-center">
          <Lock size={24} className="mx-auto text-blue-600 mb-3" />
          <p className="text-sm font-medium mb-1">Account created</p>
          <p className="text-xs text-gray-500">
            An admin needs to assign your role before you can access the system. Check back once they've done so.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-sm w-full bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <div className="text-center mb-2">
          <Lock size={20} className="mx-auto text-blue-600 mb-2" />
          <h1 className="text-base font-medium">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        </div>
        {error && <p className="text-xs text-red-600 text-center">{error}</p>}
        {mode === 'signup' && (
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        )}
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password"
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        <button onClick={submit} disabled={loading}
          className="w-full px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
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