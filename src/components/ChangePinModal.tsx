import { useState, useEffect } from 'react'
import { KeyRound, X } from 'lucide-react'
import { setPin as apiSetPin, verifyPin as apiVerifyPin } from '../api/pin'
import { Dots, Keypad } from './PinKeypad'

type Step = 'current' | 'new' | 'confirm' | 'done'

export function ChangePinModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('current')
  const [entry, setEntry] = useState('')
  const [firstNew, setFirstNew] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function handleBackspace() { setEntry(e => e.slice(0, -1)); setError(null) }

  // Physical keyboard as an alternative to the on-screen keypad.
  useEffect(() => {
    if (step === 'done') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        handleDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        handleBackspace()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, entry, busy, firstNew])

  async function handleDigit(d: string) {
    if (busy || entry.length >= 4) return
    const next = entry + d
    setEntry(next)
    setError(null)
    if (next.length !== 4) return

    if (step === 'current') {
      setBusy(true)
      try {
        const ok = await apiVerifyPin(next)
        if (ok) { setStep('new'); setEntry('') }
        else { setError('Incorrect PIN.'); setEntry('') }
      } catch (e: any) {
        setError(e?.message ?? 'Could not verify PIN.'); setEntry('')
      } finally { setBusy(false) }
    } else if (step === 'new') {
      setFirstNew(next)
      setEntry('')
      setStep('confirm')
    } else if (step === 'confirm') {
      if (next !== firstNew) {
        setError("PINs didn't match — start over.")
        setEntry(''); setFirstNew(''); setStep('new')
        return
      }
      setBusy(true)
      try {
        await apiSetPin(next)
        setStep('done')
      } catch (e: any) {
        setError(e?.message ?? 'Could not save PIN.'); setEntry('')
      } finally { setBusy(false) }
    }
  }

  const title = step === 'current' ? 'Enter your current PIN' : step === 'new' ? 'Choose a new PIN' : step === 'confirm' ? 'Confirm your new PIN' : 'PIN updated'

  return (
    <div className="fixed inset-0 bg-black/40 z-[110] flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-xl px-5 py-6">
        <div className="flex items-center justify-between mb-4">
          <span className="flex items-center gap-1.5 text-sm font-medium"><KeyRound size={15} className="text-blue-600" /> Change PIN</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-500 text-center">{title}</p>
        {error && <p className="text-xs text-red-600 text-center mt-1">{error}</p>}
        {step === 'done' ? (
          <button onClick={onClose} className="w-full mt-6 py-2.5 text-sm rounded-xl bg-blue-600 text-white font-medium">Done</button>
        ) : (
          <>
            <Dots length={4} filled={entry.length} />
            <Keypad onDigit={handleDigit} onBackspace={handleBackspace} disabled={busy} />
          </>
        )}
      </div>
    </div>
  )
}
