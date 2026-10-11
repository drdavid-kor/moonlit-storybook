#!/usr/bin/env python3
"""Local dynamic-storybook prototype. Credentials stay in the server process."""
import argparse
import base64
import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from scripts.illustration import STYLE, image_request, decode_image
from scripts.story_tree import compile_tree
from scripts.motion import STYLE as MOTION_STYLE, motion_request

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
INSTALLED_HELPER = Path.home() / '.codex/skills/openrouter/scripts/openrouter.py'
DEFAULT_HELPER = INSTALLED_HELPER if INSTALLED_HELPER.is_file() else ROOT / 'scripts/openrouter_client.py'
HELPER = Path(os.environ.get('OPENROUTER_HELPER', DEFAULT_HELPER))
spec = importlib.util.spec_from_file_location('openrouter_helper', HELPER)
openrouter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(openrouter)
MODEL = os.environ.get('STORYBOOK_MODEL', 'google/gemini-3.8-flash')
ASR_MODEL = 'qwen/qwen3-asr-0.6b'
IMAGE_MODEL = os.environ.get('IMAGE_MODEL', STYLE['model'])
MOTION_MODEL = os.environ.get('MOTION_MODEL', MOTION_STYLE['model'])
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)
LOCK = threading.Lock()
JOBS = {}
LOCAL_ART = set()

def art_state(job_id):
    path = DATA / (job_id + '.art.json')
    return json.loads(path.read_text()) if path.is_file() else {}

def art_reference(path):
    match = re.fullmatch(r'/api/illustrations/([a-f0-9]{24})/([0-9])', path)
    if not match:
        return None
    job_id, index = match.groups()
    info = art_state(job_id).get(index, {})
    file = DATA / 'images' / f'{job_id}-{index}'
    if info.get('status') != 'completed' or not file.is_file():
        return None
    return f"data:{info['mime']};base64," + base64.b64encode(file.read_bytes()).decode()

def paint_record(record):
    job_id = record['id']
    pages = [record['result']['page']] if record['params']['kind'] == 'turn' else record['result']['pages']
    state = art_state(job_id)
    images = DATA / 'images'
    images.mkdir(exist_ok=True)

    def save_progress():
        completed = sum(info['status'] == 'completed' for info in state.values())
        for index, page in enumerate(pages):
            info = state.get(str(index), {'status': 'pending'})
            page['illustration'] = {'status': info['status'], 'model': IMAGE_MODEL}
            if info['status'] == 'completed':
                page['illustration']['url'] = f'/api/illustrations/{job_id}/{index}'
        record['metadata'].update(illustration_status='pending' if any(info['status'] == 'pending' for info in state.values()) else 'completed' if completed == len(pages) else 'failed', illustration_completed=completed, illustration_total=len(pages))
        write_json(DATA / (job_id + '.art.json'), state)

    with LOCK:
        for index in range(len(pages)):
            state.setdefault(str(index), {'status': 'pending'})
        save_progress()

    def paint(index, paths):
        with LOCK:
            info = state[str(index)]
            if info['status'] != 'pending':
                return
            if info.get('started_at'):
                info['status'] = 'failed'  # Do not repeat a call after interruption.
                save_progress()
                return
            info['started_at'] = time.time()
            save_progress()
        try:
            refs = [ref for path in paths if (ref := art_reference(path))]
            raw, _ = openrouter.request('/images', image_request(record, index, IMAGE_MODEL, refs), timeout=170)
            receipt = json.loads(raw)
            image, mime = decode_image(receipt)
            (images / f'{job_id}-{index}').write_bytes(image)
            with LOCK:
                info.update(status='completed', mime=mime, usage=receipt.get('usage', {}), references=len(refs))
                save_progress()
        except Exception:
            with LOCK:
                info['status'] = 'failed'
                save_progress()

    paint(0, record['params'].get('reference_illustrations', []))
    anchor = f'/api/illustrations/{job_id}/0'
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as painters:
        list(painters.map(lambda index: paint(index, [anchor]), range(1, len(pages))))
    return record

def animate_record(record, preparing=False):
    record['metadata']['motion_required'] = True
    if record['metadata'].get('illustration_status') != 'completed':
        return record
    job_id = record['id']
    state_file = DATA / (job_id + '.motion.json')
    state = json.loads(state_file.read_text()) if state_file.is_file() else {}
    clips = DATA / 'motion'
    clips.mkdir(exist_ok=True)

    def save_progress():
        completed = sum(info['status'] == 'completed' for info in state.values())
        for index, page in enumerate(record['result']['pages']):
            info = state[str(index)]
            page['motion'] = {'status': info['status']}
            if info['status'] == 'completed':
                page['motion']['url'] = f'/api/motion/{job_id}/{index}'
        record['metadata'].update(motion_status='pending' if any(info['status'] == 'pending' for info in state.values()) else 'completed' if completed == len(state) else 'failed', motion_completed=completed, motion_total=len(state))
        write_json(state_file, state)
        JOBS[job_id] = {'id': job_id, 'status': 'pending', 'phase': 'animating', 'motion_completed': completed, 'motion_total': len(state)} if preparing else record
        if not preparing:
            write_json(DATA / (job_id + '.json'), record)

    with LOCK:
        for index in range(len(record['result']['pages'])):
            state.setdefault(str(index), {'status': 'pending'})
        save_progress()

    def animate(index):
        with LOCK:
            info = state[str(index)]
            if info['status'] != 'pending':
                return
            if info.get('started_at') and not info.get('provider_id'):
                info['status'] = 'failed'
                save_progress()
                return
            info['started_at'] = time.time()
            save_progress()
        try:
            if not info.get('provider_id'):
                source = art_reference(f'/api/illustrations/{job_id}/{index}')
                raw, _ = openrouter.request('/videos', motion_request(record, index, source, MOTION_MODEL), timeout=90)
                receipt = json.loads(raw)
                provider_id = receipt.get('id', '')
                if not re.fullmatch('[a-zA-Z0-9_-]{1,200}', provider_id):
                    raise ValueError('Invalid animation identifier.')
                with LOCK:
                    info['provider_id'] = provider_id
                    save_progress()
            for _ in range(90):
                raw, _ = openrouter.request('/videos/' + info['provider_id'], timeout=90)
                receipt = json.loads(raw)
                if receipt['status'] == 'completed':
                    video, _ = openrouter.request('/videos/' + info['provider_id'] + '/content', timeout=90)
                    if not 100 < len(video) < 24000000 or video[4:8] != b'ftyp':
                        raise ValueError('Invalid animation content.')
                    (clips / f'{job_id}-{index}.mp4').write_bytes(video)
                    with LOCK:
                        info.update(status='completed', usage=receipt.get('usage', {}))
                        save_progress()
                    return
                if receipt['status'] in ('failed', 'cancelled'):
                    raise ValueError('Animation failed.')
                time.sleep(10)
            raise ValueError('Animation wait expired.')
        except Exception:
            with LOCK:
                info['status'] = 'failed'
                save_progress()

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as animators:
        list(animators.map(animate, range(len(record['result']['pages']))))
    return record

def upgrade_book(record):
    try:
        record = paint_record(record)
        record = animate_record(record)
        write_json(DATA / (record['id'] + '.json'), record)
        with LOCK:
            JOBS[record['id']] = record
    finally:
        with LOCK:
            LOCAL_ART.discard(record['id'])

BOOK_SCHEMA = json.loads((ROOT / 'cloud/book-schema.json').read_text())
BILINGUAL = BOOK_SCHEMA['properties']['title']
PROMPTS = json.loads((ROOT / 'cloud/story-prompts.json').read_text())
SYSTEM = PROMPTS['system']

def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def check_schema(value, schema, path='result'):
    if 'anyOf' in schema:
        for variant in schema['anyOf']:
            try:
                check_schema(value, variant, path)
                return
            except ValueError:
                pass
        raise ValueError(f'{path}: invalid variant')
    kind = schema['type']
    if kind == 'null':
        if value is not None:
            raise ValueError(f'{path}: expected null')
    elif kind == 'string':
        if not isinstance(value, str) or not value.strip() or len(value) > 3000:
            raise ValueError(f'{path}: expected bounded nonempty string')
        if 'enum' in schema and value not in schema['enum']:
            raise ValueError(f'{path}: unsupported value')
    elif kind == 'object':
        if not isinstance(value, dict) or set(value) != set(schema['properties']):
            raise ValueError(f'{path}: incorrect fields')
        for field, child in schema['properties'].items():
            check_schema(value[field], child, path + '.' + field)
    elif kind == 'array':
        if not isinstance(value, list) or len(value) != schema['minItems']:
            raise ValueError(f'{path}: incorrect number of items')
        for index, child in enumerate(value):
            check_schema(child, schema['items'], f'{path}[{index}]')

def generate(job_id, params):
    started = time.monotonic()
    schema = BOOK_SCHEMA
    instruction = PROMPTS['instruction']
    system = SYSTEM
    request = {
        'model': MODEL,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': instruction + '\n任务数据：' + json.dumps(params, ensure_ascii=False)}],
        'temperature': 0.7,
        'max_tokens': 10500,
        'reasoning': {'effort': 'low'},
        'provider': {'require_parameters': True},
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'storybook_tree', 'strict': True, 'schema': schema}},
    }
    try:
        raw, _ = openrouter.request('/chat/completions', request, timeout=115)
        receipt = json.loads(raw)
        write_json(DATA / (job_id + '.receipt.json'), receipt)
        if receipt.get('error'):
            raise ValueError('The provider returned an error.')
        message = receipt['choices'][0]['message'].get('content')
        if not isinstance(message, str) or not message.strip():
            raise ValueError('The provider returned no usable story content.')
        result = json.loads(message)
        check_schema(result, schema)
        result = compile_tree(result)
        if len({p['scene']['hero'] for p in result['pages']}) != 1:
            raise ValueError('The hero changed between nodes.')
        metadata = {'provider': 'OpenRouter', 'model': receipt.get('model', MODEL), 'generation_id': receipt.get('id'), 'usage': receipt.get('usage', {}), 'seconds': round(time.monotonic() - started, 2), 'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'kind': params['kind']}
        record = {'status': 'completed', 'id': job_id, 'result': result, 'metadata': metadata, 'params': params}
        if params['kind'] in ('book', 'turn'):
            record = paint_record(record)
            record = animate_record(record, preparing=True)
        write_json(DATA / (job_id + '.json'), record)
        with LOCK:
            JOBS[job_id] = record
    except Exception as error:
        # Do not leak the credential or upstream response details to the browser.
        safe_detail = openrouter.redact(str(error), openrouter.api_key(required=False))
        write_json(DATA / (job_id + '.error.json'), {'error': safe_detail, 'kind': params['kind'], 'elapsed_seconds': round(time.monotonic() - started, 2)})
        failed = {'status': 'failed', 'id': job_id, 'error': '这次没有得到可用的故事。请求没有自动重试；已保留的故事仍可阅读。 / No usable story was returned. This request was not automatically retried.'}
        write_json(DATA / (job_id + '.json'), failed)
        with LOCK:
            JOBS[job_id] = failed

class Handler(BaseHTTPRequestHandler):
    def send_json(self, value, code=200):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/status':
            return self.send_json({'configured': bool(openrouter.api_key(required=False)), 'model': MODEL, 'image_model': IMAGE_MODEL})
        image = re.fullmatch(r'/api/illustrations/([a-f0-9]{24})/([0-9])', path)
        if image:
            job_id, index = image.groups()
            info = art_state(job_id).get(index, {})
            file = DATA / 'images' / f'{job_id}-{index}'
            if info.get('status') != 'completed' or not file.is_file():
                return self.send_json({'error': 'Illustration unavailable.'}, 404)
            data = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', info['mime'])
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            return self.wfile.write(data)
        motion = re.fullmatch(r'/api/motion/([a-f0-9]{24})/([0-9])', path)
        if motion:
            job_id, index = motion.groups()
            state_file = DATA / (job_id + '.motion.json')
            info = json.loads(state_file.read_text()).get(index, {}) if state_file.is_file() else {}
            file = DATA / 'motion' / f'{job_id}-{index}.mp4'
            if info.get('status') != 'completed' or not file.is_file():
                return self.send_json({'error': 'Animation unavailable.'}, 404)
            data = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            return self.wfile.write(data)
        if path == '/api/library':
            books = []
            for file in DATA.glob('*.json'):
                if '.error.' in file.name or '.receipt.' in file.name or '.art.' in file.name or '.motion.' in file.name:
                    continue
                record = json.loads(file.read_text())
                if record.get('status') == 'completed' and record.get('metadata', {}).get('kind') == 'book':
                    books.append(record)
            books.sort(key=lambda b: b['metadata']['generated_at'], reverse=True)
            return self.send_json({'books': books[:30]})
        if path.startswith('/api/jobs/'):
            job_id = path.rsplit('/', 1)[-1]
            if not re.fullmatch('[a-f0-9]{24}', job_id):
                return self.send_json({'error': 'Unknown request.'}, 404)
            with LOCK:
                record = JOBS.get(job_id)
            if record is None and (DATA / (job_id + '.json')).exists():
                record = json.loads((DATA / (job_id + '.json')).read_text())
                if record.get('status') == 'pending':
                    record = {'id': job_id, 'status': 'failed', 'error': '服务在生成期间重启，请求结果未知；没有自动重复生成。 / The server restarted; generation outcome is unknown.'}
            return self.send_json(record or {'error': 'Unknown request.'}, 200 if record else 404)
        files = {'/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js', '/scene.js': 'scene.js', '/readiness.js': 'readiness.js', '/tree.js': 'tree.js', '/export.js': 'export.js', '/subtitles.js': 'subtitles.js', '/playback.js': 'playback.js'}
        if path not in files:
            return self.send_json({'error': 'Not found.'}, 404)
        file = PUBLIC / files[path]
        data = file.read_bytes()
        types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'}
        self.send_response(200)
        self.send_header('Content-Type', types[file.suffix] + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ('/api/generate', '/api/transcribe', '/api/illustrate'):
            return self.send_json({'error': 'Not found.'}, 404)
        expected = {'http://' + self.headers.get('Host', '')}
        if self.headers.get('Origin') and self.headers['Origin'] not in expected:
            return self.send_json({'error': 'Local requests only.'}, 403)
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_json({'error': 'JSON request required.'}, 415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < (2000000 if path == '/api/transcribe' else 80000):
                raise ValueError('Request too large.')
            data = json.loads(self.rfile.read(length))
            if path == '/api/transcribe':
                return self.transcribe(data)
            if path == '/api/illustrate':
                job_id = data.get('id')
                if not isinstance(job_id, str) or not re.fullmatch('[a-f0-9]{24}', job_id):
                    raise ValueError('Invalid story identifier.')
                file = DATA / (job_id + '.json')
                record = JOBS.get(job_id) or (json.loads(file.read_text()) if file.is_file() else None)
                if not record or record.get('status') != 'completed' or record.get('params', {}).get('kind') not in ('book', 'turn'):
                    return self.send_json({'error': 'Story unavailable.'}, 404)
                if not openrouter.api_key(required=False):
                    return self.send_json({'error': 'Configure the local OpenRouter credential.'}, 503)
                with LOCK:
                    if not record.get('metadata', {}).get('motion_status') and record.get('metadata', {}).get('illustration_status') != 'failed' and job_id not in LOCAL_ART:
                        LOCAL_ART.add(job_id)
                        JOBS[job_id] = record
                        POOL.submit(upgrade_book, record)
                return self.send_json({'id': job_id}, 202)
            kind = data.get('kind')
            if kind == 'turn':
                return self.send_json({'error': '实时续写已关闭。 / Live continuation is disabled.'}, 410)
            concept = data.get('concept', '')
            age = data.get('age')
            request_id = data.get('request_id', '')
            if kind != 'book' or not isinstance(concept, str) or not 1 <= len(concept.strip()) <= 320 or age not in ('4–5', '6–8', '9–12'):
                raise ValueError('请选择年龄并填写学习愿望。 / Choose an age and a learning goal.')
            if not isinstance(request_id, str) or not re.fullmatch('[a-zA-Z0-9-]{8,80}', request_id):
                raise ValueError('Invalid request identifier.')
            params = {'kind': kind, 'concept': concept.strip(), 'age': age}
            world = data.get('world', 'lake')
            if world not in ('forest', 'lake', 'village', 'space'):
                raise ValueError('Invalid world.')
            params['world'] = world
            if data.get('preparation_id') is not None:
                preparation_id, story_index = data['preparation_id'], data.get('story_index')
                points = data.get('knowledge_points')
                if not isinstance(preparation_id, str) or not re.fullmatch('[a-zA-Z0-9-]{8,80}', preparation_id) or type(story_index) is not int or not 0 <= story_index <= 2:
                    raise ValueError('Invalid story preparation.')
                if not isinstance(points, list) or not 1 <= len(points) <= 3 or any(not isinstance(p, str) or not 1 <= len(p.strip()) <= 320 for p in points):
                    raise ValueError('Enter 1–3 knowledge points.')
                if params['concept'] != points[story_index % len(points)].strip():
                    raise ValueError('Story concept does not match the parent settings.')
                params.update(preparation_id=preparation_id, story_index=story_index, knowledge_points=[p.strip() for p in points])
            if not openrouter.api_key(required=False):
                return self.send_json({'error': '需要在本机配置 OpenRouter 凭据。 / Configure the local OpenRouter credential.'}, 503)
            digest = hashlib.sha256((request_id + json.dumps(params, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()[:24]
            with LOCK:
                if digest not in JOBS and (DATA / (digest + '.json')).exists():
                    JOBS[digest] = json.loads((DATA / (digest + '.json')).read_text())
                if digest not in JOBS:
                    JOBS[digest] = {'status': 'pending', 'id': digest}
                    write_json(DATA / (digest + '.json'), JOBS[digest])
                    POOL.submit(generate, digest, params)
            return self.send_json({'id': digest}, 202)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            return self.send_json({'error': str(error)}, 400)

    def transcribe(self, data):
        encoded = data.get('audio')
        fmt = data.get('format')
        if not isinstance(encoded, str) or fmt not in ('webm', 'mp4', 'wav', 'ogg'):
            raise ValueError('Invalid audio.')
        audio = base64.b64decode(encoded, validate=True)
        if not 100 < len(audio) < 1400000:
            raise ValueError('Audio too large or empty.')
        try:
            raw, _ = openrouter.request('/audio/transcriptions', {'model': ASR_MODEL, 'input_audio': {'data': encoded, 'format': fmt}, 'language': 'zh'}, timeout=60)
            result = json.loads(raw)
            transcript = result.get('text')
            if not isinstance(transcript, str) or not transcript.strip():
                raise ValueError('No transcript returned.')
            return self.send_json({'text': transcript[:320]})
        except Exception:
            return self.send_json({'error': '这次没有听清，可以再说一次或输入文字。 / Try again or type your idea.'}, 502)

    def log_message(self, format, *args):
        # Never log prompts, headers or credentials.
        if '/api/jobs/' not in self.path:
            super().log_message(format, *args)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    print(f'Moonlit storybook ready: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
