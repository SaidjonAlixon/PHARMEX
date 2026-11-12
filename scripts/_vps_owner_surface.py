#!/usr/bin/env python3
"""Split public domain vs platform-owner IP:9080 surfaces in nginx + env."""
import sys, time, traceback
import paramiko

HOST, USER = "138.249.7.30", "root"
PW = "zmOe3xQUWu2t&N" + chr(36) + "b"
OWNER_PORT = "9080"
OWNER_URL = f"http://{HOST}:{OWNER_PORT}"


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
    rest = stdout.read().decode(errors="replace")
    if rest:
        sys.stdout.write(rest)
    err = stderr.read().decode(errors="replace")
    if err.strip():
        sys.stdout.write(err)
    code = stdout.channel.recv_exit_status()
    print(f"<<< {code}", flush=True)
    return code


def upsert_env_cmd(key: str, value: str) -> str:
    return (
        f"if grep -q '^{key}=' /opt/pharmxs/.env; then "
        f"sed -i 's|^{key}=.*|{key}={value}|' /opt/pharmxs/.env; "
        f"else echo '{key}={value}' >> /opt/pharmxs/.env; fi"
    )


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=45, allow_agent=False, look_for_keys=False)
    try:
        nginx = f"""
# Public company site — owner paths blocked
server {{
    server_name pharmxs.uz www.pharmxs.uz;
    client_max_body_size 200m;

    location ~ ^/(owner|admin|platform)(/|$) {{
        return 404;
    }}
    location ^~ /api/platform/ {{
        return 404;
    }}

    location / {{
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Pharmxs-Surface public;
        proxy_read_timeout 300s;
    }}

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/pharmxs.uz/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/pharmxs.uz/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}}

server {{
    if ($host = www.pharmxs.uz) {{
        return 301 https://$host$request_uri;
    }} # managed by Certbot

    if ($host = pharmxs.uz) {{
        return 301 https://$host$request_uri;
    }} # managed by Certbot

    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pharmxs.uz www.pharmxs.uz;
    return 404; # managed by Certbot
}}

# Platform owner console — IP only, dedicated port
server {{
    listen {HOST}:{OWNER_PORT};
    server_name {HOST};
    client_max_body_size 200m;

    location / {{
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Pharmxs-Surface owner;
        proxy_read_timeout 300s;
    }}
}}
"""
        cmd = f"""set -e
cat > /etc/nginx/sites-available/pharmxs <<'NGINX'
{nginx}
NGINX
ln -sfn /etc/nginx/sites-available/pharmxs /etc/nginx/sites-enabled/pharmxs
nginx -t
systemctl reload nginx
ufw allow {OWNER_PORT}/tcp comment 'PHARMXS owner panel' || true
ufw delete allow 8080/tcp || true
ufw status numbered | head -20
{upsert_env_cmd('LISTEN_HOST', '127.0.0.1')}
{upsert_env_cmd('OWNER_HOSTS', HOST)}
{upsert_env_cmd('OWNER_PUBLIC_URL', OWNER_URL)}
{upsert_env_cmd('PUBLIC_APP_URL', 'https://pharmxs.uz')}
grep -E '^(LISTEN_HOST|OWNER_|PUBLIC_APP_URL)=' /opt/pharmxs/.env
"""
        code = run(c, cmd, 120)
        if code != 0:
            return code
        run(
            c,
            "cd /opt/pharmxs && git fetch origin && git reset --hard origin/main && "
            "export CI=true && pnpm --filter @workspace/api-server build && "
            "pnpm --filter dorixona-moliya build && pm2 restart pharmxs --update-env",
            600,
        )
        time.sleep(4)
        run(
            c,
            "curl -s -o /dev/null -w 'domain_home=%{http_code}\\n' https://pharmxs.uz/; "
            "curl -s -o /dev/null -w 'domain_owner=%{http_code}\\n' https://pharmxs.uz/owner; "
            "curl -s -o /dev/null -w 'domain_admin=%{http_code}\\n' https://pharmxs.uz/admin; "
            f"curl -s -o /dev/null -w 'owner_panel=%{{http_code}}\\n' {OWNER_URL}/owner/kirish; "
            "ss -tlnp | grep -E ':8080|:9080|:443' || true",
        )
        print("\n=== OWNER PANEL ===", flush=True)
        print(f"URL:   {OWNER_URL}/owner/kirish", flush=True)
        print("Domain company login: https://pharmxs.uz/sign-in", flush=True)
        return 0
    finally:
        c.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
