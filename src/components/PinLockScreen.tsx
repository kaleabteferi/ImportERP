import { useState, useEffect } from 'react'
import { Lock, ShieldCheck, LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { usePinLock } from '../lib/pinLock'
import { setPin as apiSetPin, verifyPin as apiVerifyPin } from '../api/pin'
import { Dots, Keypad } from './PinKeypad'

type Mode = 'verify' | 'setup-create' | 'setup-confirm' | 'forgot-password' | 'forgot-create' | 'forgot-confirm'

export function PinLockScreen() {
  const { profile, session, signIn, signOut } = useAuth()
  const { status, unlock, completeSetup } = usePinLock()
  const [mode, setMode] = useState<Mode>(status === 'needs-setup' ? 'setup-create' : 'verify')
  const [entry, setEntry] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  useEffect(() => { setMode(status === 'needs-setup' ? 'setup-create' : 'verify') }, [status])

  function fail(message: string) {
    setError(message)
    setShake(true)
    setEntry('')
    setTimeout(() => setShake(false), 400)
  }

  async function handleDigit(d: string) {
    if (busy || entry.length >= 4) return
    const next = entry + d
    setEntry(next)
    setError(null)
    if (next.length !== 4) return

    if (mode === 'verify') {
      setBusy(true)
      try {
        const ok = await apiVerifyPin(next)
        if (ok) { unlock(); setEntry('') }
        else fail('Incorrect PIN — try again.')
      } catch (e: any) {
        fail(e?.message ?? 'Could not verify PIN.')
      } finally { setBusy(false) }
    } else if (mode === 'setup-create') {
      setFirstPin(next)
      setEntry('')
      setMode('setup-confirm')
    } else if (mode === 'setup-confirm') {
      if (next !== firstPin) {
        fail("PINs didn't match — start over.")
        setFirstPin('')
        setMode('setup-create')
        return
      }
      setBusy(true)
      try {
        await apiSetPin(next)
        completeSetup(); setEntry(''); setFirstPin('')
      } catch (e: any) {
        fail(e?.message ?? 'Could not save PIN.')
      } finally { setBusy(false) }
    } else if (mode === 'forgot-create') {
      setFirstPin(next)
      setEntry('')
      setMode('forgot-confirm')
    } else if (mode === 'forgot-confirm') {
      if (next !== firstPin) {
        fail("PINs didn't match — start over.")
        setFirstPin('')
        setMode('forgot-create')
        return
      }
      setBusy(true)
      try {
        await apiSetPin(next)
        completeSetup(); setEntry(''); setFirstPin('')
      } catch (e: any) {
        fail(e?.message ?? 'Could not save PIN.')
      } finally { setBusy(false) }
    }
  }

  function handleBackspace() {
    setEntry(e => e.slice(0, -1))
    setError(null)
  }

  async function submitPassword() {
    if (!session?.user?.email || !password) return
    setBusy(true); setError(null)
    try {
      const { error: signInError } = await signIn(session.user.email, password)
      if (signInError) { setError('Incorrect password.'); setBusy(false); return }
      setPassword('')
      setMode('forgot-create')
    } catch {
      setError('Could not verify password.')
    } finally { setBusy(false) }
  }

  const title = mode === 'verify' ? `Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`
    : mode === 'setup-create' ? 'Create a PIN'
    : mode === 'setup-confirm' ? 'Confirm your PIN'
    : mode === 'forgot-password' ? 'Verify your password'
    : mode === 'forgot-create' ? 'Set a new PIN'
    : 'Confirm your new PIN'

  const subtitle = mode === 'verify' ? 'Enter your 4-digit PIN to continue'
    : mode === 'setup-create' ? 'Choose a 4-digit PIN to lock this app when it\'s reopened'
    : mode === 'setup-confirm' ? 'Enter it once more'
    : mode === 'forgot-password' ? 'Enter your account password to reset your PIN'
    : mode === 'forgot-create' ? 'Choose a new 4-digit PIN'
    : 'Enter it once more'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-900 p-4">
      <div className={`w-full max-w-sm bg-white border border-gray-100 rounded-3xl shadow-xl px-6 py-8 ${shake ? 'animate-[shake_0.4s]' : ''}`}
        style={shake ? { animation: 'shake 0.4s' } : undefined}>
        <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
          {mode === 'verify' ? <Lock size={20} className="text-white" /> : <ShieldCheck size={20} className="text-white" />}
        </div>
        <h1 className="text-base font-medium text-center">{title}</h1>
        <p className="text-xs text-gray-400 text-center mt-1">{subtitle}</p>

        {mode === 'forgot-password' ? (
          <div className="mt-6 space-y-3">
            {error && <p className="text-xs text-red-600 text-center">{error}</p>}
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitPassword()}
              placeholder="Account password"
              autoFocus
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button onClick={submitPassword} disabled={busy || !password}
              className="w-full py-2.5 text-sm rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50">
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button onClick={() => { setMode('verify'); setError(null); setPassword('') }}
              className="w-full text-xs text-gray-400 hover:text-gray-600">
              Back
            </button>
          </div>
        ) : (
          <>
            <Dots length={4} filled={entry.length} />
            {error && <p className="text-xs text-red-600 text-center -mt-3 mb-3">{error}</p>}
            <Keypad onDigit={handleDigit} onBackspace={handleBackspace} disabled={busy} />
            {mode === 'verify' && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
                <button onClick={() => { setMode('forgot-password'); setEntry(''); setError(null) }}
                  className="text-xs text-blue-600 hover:underline">
                  Forgot PIN?
                </button>
                <button onClick={signOut} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  <LogOut size={12} /> Sign out
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes shake { 10%,90%{transform:translateX(-1px)} 20%,80%{transform:translateX(2px)} 30%,50%,70%{transform:translateX(-4px)} 40%,60%{transform:translateX(4px)} }`}</style>
    </div>
  )
}
