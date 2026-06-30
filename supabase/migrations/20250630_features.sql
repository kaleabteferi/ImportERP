-- Run in Supabase SQL editor to enable document uploads and assembly types

-- Product assembly classification (FULL / SKD / CKD / IMPORTED)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS assembly_type text
    CHECK (assembly_type IN ('FULL', 'SKD', 'CKD', 'IMPORTED'))
    DEFAULT 'IMPORTED';

-- Track when shipment stock was received into warehouse
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS inventory_received_at timestamptz;

-- Scanned document metadata (files live in storage bucket shipment-documents)
CREATE TABLE IF NOT EXISTS shipment_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  file_path    text NOT NULL,
  mime_type    text NOT NULL,
  file_size    integer,
  doc_type     text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_attachments_shipment
  ON shipment_attachments(shipment_id);

-- Storage bucket (create in Dashboard → Storage if this fails)
INSERT INTO storage.buckets (id, name, public)
VALUES ('shipment-documents', 'shipment-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies (adjust for your auth setup)
ALTER TABLE shipment_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all shipment_attachments" ON shipment_attachments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow storage upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'shipment-documents');

CREATE POLICY "Allow storage read" ON storage.objects
  FOR SELECT USING (bucket_id = 'shipment-documents');

CREATE POLICY "Allow storage delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'shipment-documents');
