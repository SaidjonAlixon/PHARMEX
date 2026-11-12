-- PHARMXS multi-tenant hardening (safe / additive).
-- Application-layer tenant filters are the primary control.
-- This migration adds indexes + cash_accounts.organization_id backfill.

BEGIN;

ALTER TABLE pharmacy_cash_accounts
  ADD COLUMN IF NOT EXISTS organization_id integer;

UPDATE pharmacy_cash_accounts ca
SET organization_id = b.organization_id
FROM pharmacy_branches b
WHERE ca.branch_id = b.id
  AND ca.organization_id IS NULL
  AND b.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pharmacy_cash_accounts_org_idx
  ON pharmacy_cash_accounts (organization_id);

CREATE INDEX IF NOT EXISTS pharmacy_sales_branch_idx ON pharmacy_sales (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_purchases_branch_idx ON pharmacy_purchases (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_debts_branch_idx ON pharmacy_debts (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_stock_documents_branch_idx ON pharmacy_stock_documents (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_inventory_movements_branch_idx ON pharmacy_inventory_movements (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_expenses_branch_idx ON pharmacy_expenses (branch_id);
CREATE INDEX IF NOT EXISTS pharmacy_money_tx_account_idx ON pharmacy_money_transactions (account_id);
CREATE INDEX IF NOT EXISTS pharmacy_branches_org_id_idx ON pharmacy_branches (organization_id);
CREATE INDEX IF NOT EXISTS pharmacy_products_org_id_idx ON pharmacy_products (organization_id);
CREATE INDEX IF NOT EXISTS pharmacy_counterparties_org_id_idx ON pharmacy_counterparties (organization_id);

COMMIT;
