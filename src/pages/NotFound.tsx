import { Link, useLocation } from 'react-router-dom'
import { Compass, ArrowLeft } from 'lucide-react'

export function NotFound() {
  const location = useLocation()

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-5">
      <div className="text-center max-w-sm animate-[fadeInUp_0.35s_ease-out]">
        <div className="w-14 h-14 rounded-card bg-accent/20 flex items-center justify-center mx-auto mb-4">
          <Compass size={24} className="text-accent-foreground" />
        </div>
        <p className="text-2xl font-semibold text-gray-800 mb-1">Page not found</p>
        <p className="text-sm text-gray-400 mb-1">There's nothing at</p>
        <p className="text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 inline-block mb-5 text-gray-500 break-all">
          {location.pathname}
        </p>
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-accent text-accent-foreground text-sm rounded-full hover:brightness-95 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
