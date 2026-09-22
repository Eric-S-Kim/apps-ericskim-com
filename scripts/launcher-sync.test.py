"""Behavioural test of the launcher's remote tile sync against a mocked config service (python scripts/launcher-sync.test.py)."""
import sys, json, subprocess, time, socket
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

ROOT = str(Path(__file__).resolve().parent.parent)
with socket.socket() as s:
    s.bind(('127.0.0.1', 0)); PORT = s.getsockname()[1]
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1', '-d', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{PORT}/'
SVC = 'https://config.test'
KEY = 'k' * 48

EXISTING = [
    {"id": "A", "name": "Cupcake", "url": "https://cup.example/", "icon": "", "kind": "link"},
    {"id": "B", "name": "Pantry", "url": "https://pantry.example/", "icon": "", "kind": "link"},
    {"id": "C", "name": "Manual thing", "url": "https://manual.example/", "icon": "", "kind": "link"},
]
ORDER = ["priv:C", "priv:B", "priv:A"]
REMOTE = {"version": 1, "tiles": [
    {"rid": "cupcake", "name": "Cupcake Tracker", "sub": "pup", "url": "https://cup.example", "icon": "https://cup.example/i.png"},
    {"rid": "pantry", "name": "Pantry", "sub": "", "url": "https://pantry.example/", "icon": ""},
    {"rid": "newapp", "name": "New App", "sub": "", "url": "https://new.example/", "icon": ""},
    {"rid": "BAD ID", "name": "x", "url": "https://bad.example/"},
    {"rid": "evil", "name": "x", "url": "javascript:alert(1)"},
]}

results = {}
def scenario(name, *, key=True, remote=REMOTE, status=200, dismissed=None, existing=EXISTING):
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page()
        hits = []
        def handle(route):
            hits.append(route.request.headers.get('authorization', ''))
            route.fulfill(status=status, content_type='application/json', body=json.dumps(remote),
                          headers={'Access-Control-Allow-Origin': '*'})
        pg.route(SVC + '/**', handle)
        pg.goto(BASE)
        pg.evaluate("""([ex, order, key, svc, dism]) => {
            localStorage.clear();
            localStorage.setItem('eric-apps-private-v1', JSON.stringify(ex));
            localStorage.setItem('eric-apps-order-v1', JSON.stringify(order));
            if (key) localStorage.setItem('ericsapps-remote-config-v1', JSON.stringify({url: svc, key}));
            if (dism) localStorage.setItem('eric-apps-dismissed-v1', JSON.stringify(dism));
        }""", [existing, ORDER, KEY if key else None, SVC, dismissed])
        pg.reload(); pg.wait_for_timeout(1500)
        out = pg.evaluate("""() => ({
            tiles: JSON.parse(localStorage.getItem('eric-apps-private-v1')).map(t => [t.id.length > 3 ? 'NEW' : t.id, t.rid || null, t.name, t.url]),
            labels: [...document.querySelectorAll('#apps .card-app .label')].map(x => x.textContent),
        })""")
        out['calls'] = len(hits); out['auth_ok'] = all(h == 'Bearer ' + KEY for h in hits)
        b.close()
        results[name] = out
        return out

try:
    r = scenario('sync')
    assert r['calls'] == 1 and r['auth_ok'], r
    assert r['tiles'][0] == ['A', 'cupcake', 'Cupcake Tracker', 'https://cup.example/'], r['tiles']   # url-normalised match, id kept, renamed
    assert r['tiles'][1] == ['B', 'pantry', 'Pantry', 'https://pantry.example/'], r['tiles']
    assert r['tiles'][2] == ['C', None, 'Manual thing', 'https://manual.example/'], r['tiles']          # unlisted tile untouched
    assert r['tiles'][3][:3] == ['NEW', 'newapp', 'New App'] and len(r['tiles']) == 4, r['tiles']       # bad rid + javascript: dropped
    assert r['labels'][:3] == ['Manual thing', 'Pantry', 'Cupcake Tracker'], r['labels']              # order survives
    r = scenario('nokey', key=False)
    assert r['calls'] == 0 and r['tiles'][0][2] == 'Cupcake', r
    r = scenario('server401', status=401)
    assert r['tiles'][0][2] == 'Cupcake' and len(r['tiles']) == 3, r
    r = scenario('dismissed', dismissed=['newapp'])
    assert len(r['tiles']) == 3, r
    # second sync after rid stamped: url change (token rotation) follows the rid, no duplicate
    rot = json.loads(json.dumps(REMOTE)); rot['tiles'][0]['url'] = 'https://cup.example/?t=new'
    stamped = [dict(EXISTING[0], rid='cupcake'), EXISTING[1], EXISTING[2]]
    r = scenario('rotation', remote=rot, existing=stamped)
    assert r['tiles'][0] == ['A', 'cupcake', 'Cupcake Tracker', 'https://cup.example/?t=new'], r['tiles']
    assert sum(1 for t in r['tiles'] if t[1] == 'cupcake') == 1, r['tiles']
    print('ALL LAUNCHER SCENARIOS PASS:', ', '.join(results))
finally:
    srv.terminate()
