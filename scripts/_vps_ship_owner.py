#!/usr/bin/env python3
import sys, time
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "138.249.7.30",
    username="root",
    password="zmOe3xQUWu2t&N" + chr(36) + "b",
    timeout=45,
    allow_agent=False,
    look_for_keys=False,
)

def run(cmd, timeout=900):
    print(">>>", cmd[:160], flush=True)
    _, out, err = c.exec_command(cmd, timeout=timeout, get_pty=True)
    while True:
        if out.channel.recv_ready():
            sys.stdout.write(out.channel.recv(65536).decode(errors="replace"))
            sys.stdout.flush()
        if out.channel.exit_status_ready() and not out.channel.recv_ready():
            break
        time.sleep(0.05)
    sys.stdout.write(out.read().decode(errors="replace"))
    e = err.read().decode(errors="replace")
    if e.strip():
        sys.stdout.write(e)
    print("<<<", out.channel.recv_exit_status(), flush=True)

run("cd /opt/pharmxs && git fetch origin && git reset --hard origin/main")
run(
    "cd /opt/pharmxs && export CI=true && "
    "pnpm --filter @workspace/api-server build && "
    "pnpm --filter dorixona-moliya build && "
    "pm2 restart pharmxs --update-env"
)
time.sleep(5)
run(
    "curl -s -o /dev/null -w 'home=%{http_code}\\n' https://pharmxs.uz/; "
    "curl -s -o /dev/null -w 'owner=%{http_code}\\n' https://pharmxs.uz/owner/kirish; "
    "pm2 list | head -6"
)
c.close()
