-- warehouse_transfers.product_id was never given a foreign key to
-- products, so PostgREST's embedded-resource syntax (e.g.
-- `.select('*, products(name, sku, ...)')`, used by the receiving/inventory
-- pages) failed with "Could not find a relationship between
-- 'warehouse_transfers' and 'products' in the schema cache" — that's not a
-- stale-cache issue, the relationship genuinely didn't exist.
alter table warehouse_transfers
  add constraint warehouse_transfers_product_id_fkey
  foreign key (product_id) references products(id);
