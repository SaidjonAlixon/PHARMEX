#!/usr/bin/env python3
"""Create or reset platform_admin credentials and print them once."""
import secrets
import string
import sys
import time
import paramiko

HOST, USER = "138.249.7.30", "root"
PW = "zmOe3xQUWu2t&N" + chr(36) + "b"

alphabet = string.ascii_letters + string.digits
# Readable password without ambiguous chars
pwd_chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
password = "Pxs" + "".join(secrets.choice(pwd_chars) for _ in range(9)) + str(secrets.randbelow(10))
username = "admin"


def run(client, cmd, timeout=120):
    print(f">>> {cmd[:160]}", flush=True)
    _, out, err = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while True:
        if out.channel.recv_ready():
            sys.stdout.write(out.channel.recv(65536).decode(errors="replace"))
            sys.stdout.flush()
        if out.channel.exit_status_ready() and not out.channel.recv_ready():
            break
        time.sleep(0.05)
    rest = out.read().decode(errors="replace")
    if rest:
        sys.stdout.write(rest)
    e = err.read().decode(errors="replace")
    if e.strip():
        sys.stdout.write(e)
    code = out.channel.recv_exit_status()
    print(f"<<< {code}", flush=True)
    return code


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=45, allow_agent=False, look_for_keys=False)
    # Escape for JS string
    user_js = username.replace("\\", "\\\\").replace("'", "\\'")
    pass_js = password.replace("\\", "\\\\").replace("'", "\\'")
    script = f"""
set -e
cd /opt/pharmxs/lib/db
node --input-type=module <<'NODE'
import {{ readFileSync }} from 'fs';
import {{ randomBytes, scrypt as scryptCb }} from 'crypto';
import {{ promisify }} from 'util';
import pg from 'pg';
const scrypt = promisify(scryptCb);
const env = Object.fromEntries(
  readFileSync('../../.env','utf8').split(/\\r?\\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {{ const i = l.indexOf('='); return [l.slice(0,i), l.slice(i+1)]; }})
);
const username = '{user_js}';
const password = '{pass_js}';
async function hashPassword(pw) {{
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${{salt.toString('base64')}}$${{key.toString('base64')}}`;
}}
const client = new pg.Client({{ connectionString: env.DATABASE_URL, ssl: {{ rejectUnauthorized: false }} }});
await client.connect();
const hash = await hashPassword(password);
const existing = await client.query(
  `SELECT id, username, role FROM pharmacy_app_users WHERE username = $1 OR role = 'platform_admin' ORDER BY id LIMIT 5`,
  [username]
);
let id;
const byUser = existing.rows.find(r => r.username === username);
const byRole = existing.rows.find(r => r.role === 'platform_admin');
if (byUser) {{
  id = byUser.id;
  await client.query(
    `UPDATE pharmacy_app_users SET password_hash=$1, role='platform_admin', organization_id=NULL, status='active', display_name='Platforma admin', updated_at=now() WHERE id=$2`,
    [hash, id]
  );
}} else if (byRole) {{
  id = byRole.id;
  await client.query(
    `UPDATE pharmacy_app_users SET username=$1, password_hash=$2, role='platform_admin', organization_id=NULL, status='active', display_name='Platforma admin', updated_at=now() WHERE id=$3`,
    [username, hash, id]
  );
}} else {{
  const r = await client.query(
    `INSERT INTO pharmacy_app_users (clerk_user_id, username, password_hash, display_name, email, role, status, signup_method, organization_id)
     VALUES ($1,$2,$3,'Platforma admin','', 'platform_admin', 'active', 'admin', NULL) RETURNING id`,
    ['local:' + username, username, hash]
  );
  id = r.rows[0].id;
}}
const check = await client.query(`SELECT id, username, role, status, organization_id FROM pharmacy_app_users WHERE id=$1`, [id]);
console.log('ADMIN_OK', JSON.stringify({{ user: check.rows[0], login: username, password }}));
await client.end();
NODE
"""
    run(c, script)
    c.close()
    print("\n=== PLATFORM ADMIN CREDENTIALS ===", flush=True)
    print(f"URL:      https://pharmxs.uz/owner/kirish", flush=True)
    print(f"Login:    {username}", flush=True)
    print(f"Parol:    {password}", flush=True)
    print(f"Panel:    https://pharmxs.uz/owner", flush=True)


if __name__ == "__main__":
    main()
