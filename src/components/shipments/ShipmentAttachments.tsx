import { useState, useEffect, useRef, type DragEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Upload, FileText, Image, Trash2, Loader2, Download, Eye, X } from 'lucide-react'

interface Attachment {
  id: string
  file_name: string
  file_path: string
  mime_type: string
  file_size: number | null
  doc_type: string | null
  uploaded_at: string
}

const BUCKET = 'shipment-documents'
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']

const DOC_TYPES = [
  'Commercial invoice', 'Packing list', 'Bill of lading', 'Customs declaration',
  'Receipt', 'Waybill', 'Insurance', 'Other',
]

export function ShipmentAttachments({ shipmentId }: { shipmentId: string }) {
  const [files, setFiles] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [dragActive, setDragActive] = useState(false)
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('shipment_attachments')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('uploaded_at', { ascending: false })

    if (err) {
      setError(err.message.includes('does not exist')
        ? 'Document storage not set up yet. Run the Supabase migration in supabase/migrations/.'
        : err.message)
      setFiles([])
    } else {
      setFiles(data ?? [])
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [shipmentId])

  async function upload(file: File) {
    if (!ALLOWED.includes(file.type)) {
      setError('Only PDF and image files (JPG, PNG, WebP) are allowed.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10 MB.')
      return
    }

    setUploading(true)
    setError(null)

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${shipmentId}/${Date.now()}_${safeName}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { error: dbErr } = await supabase.from('shipment_attachments').insert({
      shipment_id: shipmentId,
      file_name: file.name,
      file_path: path,
      mime_type: file.type,
      file_size: file.size,
      doc_type: docType,
    })

    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path])
      setError(dbErr.message)
    } else {
      await load()
    }
    setUploading(false)
  }

  async function handleFiles(fileList: FileList | File[]) {
    const picked = Array.from(fileList)
    if (picked.length === 0) return
    await upload(picked[0])
  }

  async function remove(att: Attachment) {
    await supabase.storage.from(BUCKET).remove([att.file_path])
    await supabase.from('shipment_attachments').delete().eq('id', att.id)
    await load()
  }

  async function download(att: Attachment) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(att.file_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openPreview(att: Attachment) {
    setPreviewLoading(true)
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(att.file_path, 120)
    setPreviewUrl(data?.signedUrl ?? null)
    setPreviewFile(att)
    setPreviewLoading(false)
  }

  function closePreview() {
    setPreviewFile(null)
    setPreviewUrl(null)
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Scanned documents</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Upload PDF invoices, customs papers, receipts, and photos (JPG/PNG)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={docType}
            onChange={e => setDocType(e.target.value)}
            className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white"
          >
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {uploading
              ? <><Loader2 size={12} className="animate-spin" /> Uploading…</>
              : <><Upload size={12} /> Upload</>
            }
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-xs">
          <Loader2 size={14} className="animate-spin" /> Loading documents…
        </div>
      ) : files.length === 0 ? (
        <div
          className={`bg-white border border-dashed rounded-xl p-8 text-center transition-colors ${dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
          onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
          onDragOver={e => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
          onDrop={async (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            setDragActive(false)
            if (e.dataTransfer.files?.length) await handleFiles(e.dataTransfer.files)
          }}
        >
          <FileText size={28} className="mx-auto text-gray-200 mb-2" />
          <p className="text-sm text-gray-500">No documents uploaded yet</p>
          <p className="text-xs text-gray-400 mt-1">Drag scans here or click Upload above</p>
        </div>
      ) : (
        <div
          className={`bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 ${dragActive ? 'ring-1 ring-blue-200' : ''}`}
          onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
          onDragOver={e => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
          onDrop={async (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            setDragActive(false)
            if (e.dataTransfer.files?.length) await handleFiles(e.dataTransfer.files)
          }}
        >
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              {f.mime_type.startsWith('image/')
                ? <Image size={16} className="text-blue-500 shrink-0" />
                : <FileText size={16} className="text-red-500 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.file_name}</p>
                <p className="text-xs text-gray-400">
                  {f.doc_type ?? 'Document'} · {formatSize(f.file_size)} ·{' '}
                  {new Date(f.uploaded_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => void openPreview(f)}
                className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                title="Preview"
              >
                <Eye size={14} />
              </button>
              <button
                onClick={() => void download(f)}
                className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                title="Download"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => void remove(f)}
                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closePreview}>
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{previewFile.file_name}</p>
                <p className="text-xs text-gray-400">{previewFile.doc_type ?? 'Document'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void download(previewFile)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  <Download size={12} /> Download
                </button>
                <button
                  onClick={closePreview}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="max-h-[75vh] overflow-auto bg-gray-50 p-3">
              {previewLoading ? (
                <div className="flex min-h-[300px] items-center justify-center text-gray-400 gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" /> Preparing preview…
                </div>
              ) : previewUrl && previewFile.mime_type.startsWith('image/') ? (
                <img src={previewUrl} alt={previewFile.file_name} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
              ) : previewUrl ? (
                <iframe src={previewUrl} title={previewFile.file_name} className="min-h-[70vh] w-full rounded-lg border-0" />
              ) : (
                <div className="flex min-h-[300px] items-center justify-center text-gray-500 text-sm">
                  Preview is not available for this document.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
