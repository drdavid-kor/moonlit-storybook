#!/usr/bin/env python3
"""Anonymous production API smoke check; no generation or credentials needed."""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = os.environ.get('STORYBOOK_URL', 'https://storybook.david-widgets.com').rstrip('/')
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(path, data=None, origin=ORIGIN):
    headers = {'Content-Type': 'application/json', 'Origin': origin} if data is not None else {}
    headers['User-Agent'] = 'Mozilla/5.0 MoonlitVerification/1.0'
    request = urllib.request.Request(ORIGIN + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()

code, headers, body = call('/')
assert code == 200 and '今晚，想听哪个故事？'.encode() in body
assert 'noindex' in headers['X-Robots-Tag']
assert all(v in headers['Set-Cookie'] for v in ['HttpOnly', 'Secure', 'SameSite=Strict'])
assert json.loads(call('/api/status')[2])['configured'] is True
assert json.loads(call('/api/library')[2])['books'] == []
for path in ['/app.js', '/styles.css', '/scene.js']:
    assert call(path)[0] == 200
for path in ['/server.py', '/data/362fa6cd7705dd38165d6aab.json', '/cloud/worker.js', '/.env.local', '/api/jobs/' + 'a' * 24]:
    assert call(path)[0] == 404
assert call('/api/generate', {'kind': 'book'}, 'https://example.org')[0] == 403
assert call('/api/generate', {'kind': 'book'})[0] == 400
checks = {'public_url': ORIGIN, 'anonymous_https': True, 'ai_configured': True, 'fresh_visitor_library_empty': True, 'cookie_protected': True, 'private_paths_404': True, 'cross_origin_rejected': True, 'invalid_input_rejected': True, 'unlisted_noindex': True, 'homepage_sha256': hashlib.sha256(body).hexdigest()}
(ROOT / 'verification').mkdir(exist_ok=True)
(ROOT / 'verification/public-api-checks.json').write_text(json.dumps(checks, indent=2))
print(json.dumps(checks, indent=2))
