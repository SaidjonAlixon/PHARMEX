-- PHARMXS multi-tenant migration (safe additive). Run against Railway Postgres.

CREATE TABLE IF NOT EXISTS pharmacy_organizations (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  owner_user_id integer,
  plan_code text NOT NULL DEFAULT 'starter',
  subscription_status text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  plan_expires_at timestamptz,
  branch_limit integer,
  telegram_chat_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_organizations_slug_idx ON pharmacy_organizations (slug);
CREATE INDEX IF NOT EXISTS pharmacy_organizations_status_idx ON pharmacy_organizations (subscription_status);

CREATE TABLE IF NOT EXISTS pharmacy_payments (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL,
  plan_code text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'UZS',
  status text NOT NULL DEFAULT 'pending',
  merchant_trans_id text NOT NULL,
  prepare_id integer,
  click_trans_id text,
  click_paydoc_id text,
  error_note text NOT NULL DEFAULT '',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_payments_merchant_trans_idx ON pharmacy_payments (merchant_trans_id);
CREATE INDEX IF NOT EXISTS pharmacy_payments_org_idx ON pharmacy_payments (organization_id);
CREATE INDEX IF NOT EXISTS pharmacy_payments_click_trans_idx ON pharmacy_payments (click_trans_id);

ALTER TABLE pharmacy_app_users ADD COLUMN IF NOT EXISTS organization_id integer;
ALTER TABLE pharmacy_app_users ADD COLUMN IF NOT EXISTS company_name text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS pharmacy_app_users_org_idx ON pharmacy_app_users (organization_id);
CREATE INDEX IF NOT EXISTS pharmacy_app_users_status_idx ON pharmacy_app_users (status);

ALTER TABLE pharmacy_branches ADD COLUMN IF NOT EXISTS organization_id integer;
CREATE INDEX IF NOT EXISTS pharmacy_branches_org_idx ON pharmacy_branches (organization_id);

ALTER TABLE pharmacy_products ADD COLUMN IF NOT EXISTS organization_id integer;
CREATE INDEX IF NOT EXISTS pharmacy_products_org_idx ON pharmacy_products (organization_id);

ALTER TABLE pharmacy_counterparties ADD COLUMN IF NOT EXISTS organization_id integer;
CREATE INDEX IF NOT EXISTS pharmacy_counterparties_org_idx ON pharmacy_counterparties (organization_id);

-- Promote seed/bootstrap admin to platform_admin (run once; adjust email if needed):
-- UPDATE pharmacy_app_users SET role = 'platform_admin', organization_id = NULL
-- WHERE lower(email) = lower(current_setting('app.platform_admin_email', true));
