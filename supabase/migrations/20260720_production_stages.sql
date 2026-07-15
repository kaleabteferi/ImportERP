-- Production orders should not be mandatory for daily logging — requiring a
-- pre-planned order before you can log "we assembled 30 today" is exactly
-- the friction that kills daily logging discipline on a factory floor.
-- This decouples production_daily_logs from needing an order, and adds a
-- "stage" to BOMs so sticker application (or other post-assembly steps)
-- shows as its own section, reusing the existing BOM/component-consumption
-- machinery — a sticker-application BOM just consumes [1 unit + 1 sticker]
-- and outputs 1 unit, net-zero on the product but decrementing sticker
-- stock and giving a distinct "units stickered today" count.

ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'ASSEMBLY';
ALTER TABLE bom_headers DROP CONSTRAINT IF EXISTS bom_headers_stage_check;
ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_stage_check
  CHECK (stage IN ('ASSEMBLY', 'STICKER', 'OTHER'));

-- Allow a daily log to stand alone (no pre-existing order): direct
-- product/warehouse/BOM reference instead of requiring production_order_id.
ALTER TABLE production_daily_logs ALTER COLUMN production_order_id DROP NOT NULL;
ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS bom_header_id uuid;

CREATE INDEX IF NOT EXISTS idx_production_daily_logs_product_warehouse
  ON production_daily_logs(product_id, warehouse_id, log_date);
