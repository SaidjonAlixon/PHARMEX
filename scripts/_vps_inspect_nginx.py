#!/usr/bin/env python3
import sys, time, traceback
import paramiko

HOST, USER = "138.249.7.30", "root"
PW = "zmOe3xQUWu2t&N" + chr(36) + "b"


def run(client, cmd, timeout=120):
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


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=45, allow_agent=False, look_for_keys=False)
    try:
        run(c, "hostname -I; ip -4 addr show | sed -n 's/.*inet //p'")
        run(c, "ls -la /etc/nginx/sites-enabled/; echo '===='; cat /etc/nginx/sites-available/pharmxs 2>/dev/null | head -200")
        run(c, "ufw status numbered 2>/dev/null | head -40 || iptables -L INPUT -n | head -30")
        run(c, "ss -tlnp | grep -E ':80|:443|:8080|:8443|:9090' || netstat -tlnp | grep -E ':80|:443|:8080'")
        return 0
    finally:
        c.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
