-- Per-company FOM isolation: stamp sync history by organization
ALTER TABLE pharmacy_integration_imports
  ADD COLUMN IF NOT EXISTS organization_id integer;

CREATE INDEX IF NOT EXISTS pharmacy_integration_imports_org_idx
  ON pharmacy_integration_imports (organization_id);
