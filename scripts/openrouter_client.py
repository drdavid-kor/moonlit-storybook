"""Portable OpenRouter client using only Python's standard library.

Compatible with the small client interface used by server.py. The optional
installed skill helper can also supply this interface via OPENROUTER_HELPER.
"""
import json
import os
import re
import urllib.error
import urllib.request


def api_key(required=True):
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if required and not key:
        raise RuntimeError('Set OPENROUTER_API_KEY in the server environment.')
    return key


def redact(text, key=''):
    text = str(text)
    if key:
        text = text.replace(key, '[redacted]')
    return re.sub(r'sk-or-[A-Za-z0-9_-]+', '[redacted]', text)


def request(path, body=None, timeout=115):
    if path not in ('/chat/completions', '/audio/transcriptions', '/images'):
        raise ValueError('Unsupported OpenRouter endpoint.')
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1' + path,
        data=json.dumps(body).encode('utf-8') if body is not None else None,
        headers={
            'Authorization': 'Bearer ' + api_key(),
            'Content-Type': 'application/json',
            'X-Title': 'Moonlit Stories',
        },
    )
    # Do not retry: an interrupted paid call may have completed upstream.
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise RuntimeError(f'OpenRouter HTTP {status}.') from None
