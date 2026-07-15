-- Djibouti forwarder workflow: container arrives -> unloaded into the
-- forwarder's (Ali's) Djibouti warehouse -> dispatched to your own
-- warehouses in partial truckloads, each with its own waybill and a
-- request/dispatch/confirm-receipt reconciliation (Ali may send a
-- different quantity than requested, and what arrives may differ again).

-- ── warehouses: mark forwarder-held locations ───────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses') THEN
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_forwarder boolean NOT NULL DEFAULT false;
  END IF;
END $$;

INSERT INTO warehouses (name, code, city, is_forwarder, is_active)
VALUES ('Ali - Djibouti', 'DJB-ALI', 'Djibouti', true, true)
ON CONFLICT (name) DO NOTHING;

-- ── shipments: separate "unloaded at Djibouti" from "fully warehoused" ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS djibouti_received_at timestamptz;
  END IF;
END $$;

-- ── warehouse_transfers: extend for the request -> dispatch -> receive flow ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouse_transfers') THEN
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS requested_quantity numeric(12,3);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS received_quantity numeric(12,3);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS waybill_number text;
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS weight_kg numeric(12,3);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS trucking_rate_per_kg numeric(12,2);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS trucking_cost_etb numeric(12,2);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS linked_shipment_id uuid REFERENCES shipments(id);
    ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS shipment_expense_id uuid;

    -- Widen the status check to add REQUESTED as the initial stage.
    ALTER TABLE warehouse_transfers DROP CONSTRAINT IF EXISTS warehouse_transfers_status_check;
    ALTER TABLE warehouse_transfers ADD CONSTRAINT warehouse_transfers_status_check
      CHECK (status IN ('REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_linked_shipment
  ON warehouse_transfers(linked_shipment_id);
