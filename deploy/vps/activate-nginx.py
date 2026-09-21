#!/usr/bin/env python3
"""Run with sudo only after the loopback app is tested. Adds /ideas routes only."""
import datetime, hashlib, os, pathlib, shutil, subprocess, time, urllib.request, urllib.error

CONFIG = pathlib.Path('/etc/nginx/sites-available/nasserdiary.conf')
INCLUDE = pathlib.Path('/etc/nginx/snippets/idea-stream.conf')
MARKER = '    include /etc/nginx/snippets/idea-stream.conf;\n'
BLOCK = '''# Idea Stream only. Other applications keep their existing locations.
location = /ideas { return 308 /ideas/; }
location ^~ /ideas/ {
    proxy_pass http://127.0.0.1:5185/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    client_max_body_size 50m;
    proxy_request_buffering off;
}
'''

def run(*args): subprocess.run(args, check=True)
def open_url(url):
    # Fresh connections to avoid reusing an old worker during a graceful reload.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(urllib.request.Request(url, headers={
        'Cache-Control': 'no-cache', 'Connection': 'close',
    }), timeout=5)

def password_gate_status(url):
    try:
        with open_url(url) as response:
            return response.status, response.headers.get('WWW-Authenticate', '')
    except urllib.error.HTTPError as error:
        status = error.code, error.headers.get('WWW-Authenticate', '')
        error.close()
        return status

def wait_for_password_gate(url, timeout=30):
    deadline = time.monotonic() + timeout
    last = 'no response'
    while True:
        try:
            status, realm = password_gate_status(url)
            if status == 401 and 'Basic realm="Idea Stream"' in realm:
                return
            last = f'HTTP {status}, authentication header {realm!r}'
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = str(error)
        if time.monotonic() >= deadline:
            raise RuntimeError(f'Idea Stream route did not become ready within {timeout}s: {last}')
        time.sleep(0.5)

def root_hash():
    with open_url('https://nasserdiary.com/') as response:
        return hashlib.sha256(response.read()).hexdigest()

def main():
    if os.geteuid() != 0: raise SystemExit('Run with sudo; the existing main-app code and services will not be changed.')
    wait_for_password_gate('http://127.0.0.1:5185/api/healthz', timeout=5)
    original = CONFIG.read_text()
    if MARKER in original:
        if INCLUDE.read_text() != BLOCK: raise SystemExit('Existing Idea Stream configuration differs. Review it before changing.')
        baseline = root_hash()
        run('nginx','-t')
        run('systemctl','reload','nginx')
        wait_for_password_gate('https://nasserdiary.com/ideas/api/healthz')
        if root_hash() != baseline: raise RuntimeError('Main homepage changed unexpectedly')
        print('Idea Stream routes are installed and verified.')
        return
    if '/ideas' in original: raise SystemExit('An existing /ideas route needs manual review. Nothing changed.')
    if INCLUDE.exists(): raise SystemExit('An unexpected Idea Stream snippet exists. Nothing changed.')
    anchor = '    server_name nasserdiary.com www.nasserdiary.com;\n'
    if anchor not in original: raise SystemExit('Expected domain configuration was not found. Nothing changed.')
    baseline = root_hash()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_dir = pathlib.Path('/etc/nginx/idea-stream-backups')
    backup_dir.mkdir(mode=0o700, exist_ok=True)
    backup = backup_dir / ('nasserdiary.conf.' + stamp)
    shutil.copy2(CONFIG, backup)
    try:
        INCLUDE.write_text(BLOCK)
        os.chmod(INCLUDE,0o644)
        CONFIG.write_text(original.replace(anchor,anchor+MARKER,1))
        run('nginx','-t')
        run('systemctl','reload','nginx')
        wait_for_password_gate('https://nasserdiary.com/ideas/api/healthz')
        if root_hash() != baseline: raise RuntimeError('Main homepage changed unexpectedly')
    except Exception:
        shutil.copy2(backup,CONFIG)
        INCLUDE.unlink(missing_ok=True)
        run('nginx','-t')
        run('systemctl','reload','nginx')
        print('Activation check failed; the original Nginx configuration was restored.')
        raise
    print('Activated https://nasserdiary.com/ideas/ with its password gate.')
    print('Main homepage verified unchanged. Configuration backup: ' + str(backup))

if __name__ == '__main__':
    main()
