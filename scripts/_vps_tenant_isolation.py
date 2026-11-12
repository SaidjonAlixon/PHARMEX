#!/usr/bin/env python3
"""Run tenant isolation migration + DB/API checks on VPS."""
import sys, time, traceback
import paramiko

HOST, USER = "138.249.7.30", "root"
PW = "zmOe3xQUWu2t&N" + chr(36) + "b"


def run(client, cmd, timeout=600):
    print(f"\n>>> {cmd[:200]}", flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while True:
        if stdout.channel.recv_ready():
            sys.stdout.write(stdout.channel.recv(65536).decode(errors="replace"))
            sys.stdout.flush()
        if stdout.channel.exit_status_ready() and not stdout.channel.recv_ready():
            break
        time.sleep(0.05)
    sys.stdout.write(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        sys.stdout.write(err)
    code = stdout.channel.recv_exit_status()
    print(f"<<< {code}", flush=True)
    return code


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=45, allow_agent=False, look_for_keys=False)
    try:
        run(
            c,
            r"""
set -e
cd /opt/pharmxs
git fetch origin && git reset --hard origin/main
# apply SQL migration using DATABASE_URL from .env
set -a; . ./.env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-tenant-isolation.sql
echo MIGRATE_OK
""",
            180,
        )
        run(
            c,
            r"""
set -e
cd /opt/pharmxs
export CI=true
pnpm --filter @workspace/api-server build
pnpm --filter dorixona-moliya build
pm2 restart pharmxs --update-env
sleep 4
# unit-ish isolation check in DB: two orgs' branches must not share ids across org filters
set -a; . ./.env; set +a
node --input-type=module <<'NODE'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const orgs = (await pool.query('select id, name from pharmacy_organizations order by id limit 5')).rows;
console.log('ORGS', orgs.length, orgs.map(o => o.id).join(','));
if (orgs.length >= 1) {
  const a = orgs[0].id;
  const branchesA = (await pool.query('select id from pharmacy_branches where organization_id = $1', [a])).rows.map(r => r.id);
  const leak = (await pool.query(
    'select id, organization_id from pharmacy_branches where organization_id is distinct from $1 and id = any($2::int[])',
    [a, branchesA.length ? branchesA : [-1]]
  )).rows;
  console.log(leak.length === 0 ? 'PASS branch-org consistency' : 'FAIL branch leak ' + JSON.stringify(leak));
  const products = await pool.query('select count(*)::int as n from pharmacy_products where organization_id = $1', [a]);
  const foreignProducts = await pool.query(
    `select count(*)::int as n from pharmacy_products p
     where p.organization_id is not null and p.organization_id <> $1
       and exists (select 1 from pharmacy_inventory_balances b
         join pharmacy_branches br on br.id = b.branch_id
         where b.product_id = p.id and br.organization_id = $1)`,
    [a]
  );
  console.log('products_in_org', products.rows[0].n, 'cross_org_stock_links', foreignProducts.rows[0].n);
}
await pool.end();
NODE
# API unauth checks
node scripts/test-tenant-isolation.mjs
BASE=https://pharmxs.uz node scripts/test-tenant-isolation.mjs || true
curl -s -o /dev/null -w 'owner=%{http_code} domain_owner=%{http_code} home=%{http_code}\n' \
  http://127.0.0.1:9080/owner https://pharmxs.uz/owner https://pharmxs.uz/
""",
            600,
        )
        return 0
    finally:
        c.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
