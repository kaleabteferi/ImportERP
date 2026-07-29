// src/components/ui/SwipeToDelete.tsx
//
// Wraps a list row so dragging/swiping it to the right reveals a delete
// action underneath, mirroring native mobile list conventions. Built on
// plain pointer events (no gesture library is installed) so it works with
// touch AND mouse drag identically -- useful since this app is primarily
// used on desktop.
//
// A partial swipe (past REVEAL_FRACTION of the row's width) snaps open and
// waits for a tap on the revealed Delete button (safer than deleting on a
// stray swipe); a fast/full swipe (past CONFIRM_FRACTION) deletes
// immediately, same as iOS Mail's full-swipe-to-delete. Calls whatever
// delete handler the page already used before this existed -- it only
// changes how that handler gets triggered, not what it does or whether it
// confirms.
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Trash2, Loader2 } from 'lucide-react'

const REVEAL_FRACTION = 0.35
const CONFIRM_FRACTION = 0.7
const DRAG_START_THRESHOLD_PX = 8

interface Props {
  onDelete: () => void | Promise<void>
  disabled?: boolean
  children: ReactNode
}

export function SwipeToDelete({ onDelete, disabled, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const drag = useRef<{ startX: number; baseX: number; width: number; moved: boolean } | null>(null)

  function reset() {
    setDragX(0)
    setRevealed(false)
  }

  async function runDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      reset()
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (disabled || deleting) return
    // Stops a mouse drag from starting native text selection on the row,
    // which otherwise fights this custom drag on desktop.
    e.preventDefault()
    drag.current = { startX: e.clientX, baseX: dragX, width: containerRef.current?.offsetWidth ?? 1, moved: false }
  }

  function onPointerMove(e: PointerEvent) {
    const state = drag.current
    if (!state || disabled || deleting) return
    const delta = e.clientX - state.startX
    if (!state.moved) {
      if (Math.abs(delta) < DRAG_START_THRESHOLD_PX) return
      state.moved = true
      setIsDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    setDragX(Math.max(0, Math.min(state.baseX + delta, state.width)))
  }

  function onPointerUp() {
    const state = drag.current
    drag.current = null
    if (!state || !state.moved) return
    setIsDragging(false)
    const fraction = dragX / state.width
    if (fraction >= CONFIRM_FRACTION) {
      setDragX(state.width)
      runDelete()
    } else if (fraction >= REVEAL_FRACTION) {
      setDragX(state.width * REVEAL_FRACTION)
      setRevealed(true)
    } else {
      reset()
    }
  }

  // A revealed row's first tap just closes it again rather than
  // triggering the row's own click handler (e.g. expand/collapse) --
  // capture phase so it runs before any handler the row content has.
  function onContentClickCapture(e: React.MouseEvent) {
    if (revealed) {
      e.preventDefault()
      e.stopPropagation()
      reset()
    }
  }

  return (
    <div ref={containerRef} className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: dragX }}>
        <button
          onClick={runDelete}
          disabled={deleting}
          className="h-full w-full min-w-[80px] bg-red-600 text-white flex items-center justify-center gap-1.5 text-xs font-medium disabled:opacity-70"
          style={revealed ? { animation: 'slideReveal 0.15s ease-out' } : undefined}
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {!deleting && 'Delete'}
        </button>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onContentClickCapture}
        className="relative bg-inherit select-none"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 0.25s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}
