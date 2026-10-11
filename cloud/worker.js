import { WorkflowEntrypoint } from 'cloudflare:workers';
import { validate, completionRequest, storyResult } from './story.js';
import { DEFAULT_IMAGE_MODEL, imageRoute, imageKey, initializeIllustrations, attachIllustrations, illustrateRecord } from './illustration.js';
import { DEFAULT_MOTION_MODEL, motionRoute, motionKey, attachMotion, animateRecord, startMotion, pollMotion } from './motion.js';

const FAILED = '这次没有得到可用的故事。请求没有自动重试；已保存的故事仍可阅读。 / No usable story was returned. No automatic retry.';
const UNKNOWN = '这次生成的结果尚不确定，没有自动重复生成。可以先阅读已保存的故事。 / Generation outcome is unknown; no automatic retry.';
const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class ClientError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

async function identity(request) {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-moonlit' : 'moonlit_local';
  const existing = request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
  const valid = /^[a-f0-9]{64}$/.test(existing || '');
  const token = valid ? existing : randomToken();
  return { owner: await digest(token), cookie: valid ? null : `${name}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}` };
}

async function readJson(request, maxBytes) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new ClientError('JSON request required.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ClientError('Empty request.');
  let length = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new ClientError('Request too large.', 413); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new ClientError('Invalid JSON.'); }
}

async function insertJob(env, identity, request, id, requestId, kind, params) {
  const now = Date.now();
  // Hash the address with a server secret; no plain IP or request audio is stored.
  const ip = await digest(env.OPENROUTER_API_KEY + ':' + (request.headers.get('CF-Connecting-IP') || 'local'));
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const units = kind === 'book' ? 10 : kind === 'turn' ? 3 : 2;
  try {
    return await env.DB.prepare(`INSERT INTO jobs(id, owner, ip_hash, request_id, kind, units, day, created_at, params)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE owner = ? AND request_id = ?)`)
      .bind(id, identity.owner, ip, requestId, kind, units, day, now, JSON.stringify(params), identity.owner, requestId).run();
  } catch (error) {
    if (/rate_limit|busy_limit/.test(String(error))) throw new ClientError('故事还在慢慢长出来，请稍等片刻。 / Please wait a little before starting another story.', 429);
    throw error;
  }
}

async function provider(env, path, body, timeout) {
  const response = await fetch('https://openrouter.ai/api/v1' + path, {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://storybook.david-widgets.com', 'X-Title': 'Moonlit Stories' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error('Provider HTTP ' + response.status);
  return response.json();
}

function pending(row) { return { id: row.id, status: 'pending' }; }
async function recordFor(env, row) {
  if (row.record) return attachMotion(env, await attachIllustrations(env, JSON.parse(row.record)));
  if (row.kind !== 'asr' && Date.now() - row.created_at > 180000) {
    // A terminal cloud failure must not leave the browser polling forever.
    try {
      const state = await (await env.STORIES.get(row.id)).status();
      if (['errored', 'terminated', 'complete', 'unknown'].includes(state.status)) {
        const record = { id: row.id, status: 'failed', error: UNKNOWN };
        await env.DB.prepare("UPDATE jobs SET status = 'failed', record = ? WHERE id = ? AND record IS NULL").bind(JSON.stringify(record), row.id).run();
        return record;
      }
    } catch { /* The durable task may still be running. */ }
  }
  const progress = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed FROM illustrations WHERE job_id = ?").bind(row.id).first();
  const motion = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed FROM motions WHERE job_id = ?").bind(row.id).first();
  if (motion.total) return { ...pending(row), phase: 'animating', motion_completed: motion.completed || 0, motion_total: motion.total };
  return { ...pending(row), ...(progress.total ? { phase: 'illustrating', illustration_completed: progress.completed || 0, illustration_total: progress.total } : {}) };
}

async function api(request, env, user, url) {
  const path = url.pathname;
  if (request.method === 'GET') {
    if (path === '/api/status') return json({ configured: !!env.OPENROUTER_API_KEY, model: env.STORYBOOK_MODEL, image_model: env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL, motion_model: env.MOTION_MODEL || DEFAULT_MOTION_MODEL });
    const motion = path.match(motionRoute);
    if (motion) {
      const permitted = await env.DB.prepare("SELECT m.status FROM motions m JOIN jobs j ON j.id = m.job_id WHERE m.job_id = ? AND m.page_index = ? AND j.owner = ? AND m.status = 'completed'").bind(motion[1], Number(motion[2]), user.owner).first();
      if (!permitted) return json({ error: 'Animation unavailable.' }, 404);
      const key = motionKey(motion[1], Number(motion[2]));
      const range = request.headers.get('Range');
      if (range) {
        const head = await env.ART.head(key), match = range.match(/^bytes=(\d*)-(\d*)$/);
        if (!head) return json({ error: 'Animation unavailable.' }, 404);
        let start, end;
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, head.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1;
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= head.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
        const object = await env.ART.get(key, { range: { offset: start, length: end - start + 1 } });
        if (!object) return json({ error: 'Animation unavailable.' }, 404);
        return new Response(object.body, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${head.size}`, 'Content-Length': String(end - start + 1) } });
      }
      const object = await env.ART.get(key);
      if (!object) return json({ error: 'Animation unavailable.' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(object.size), 'Cache-Control': 'no-store' } });
    }
    const image = path.match(imageRoute);
    if (image) {
      const permitted = await env.DB.prepare("SELECT i.status FROM illustrations i JOIN jobs j ON j.id = i.job_id WHERE i.job_id = ? AND i.page_index = ? AND j.owner = ? AND i.status = 'completed'").bind(image[1], Number(image[2]), user.owner).first();
      if (!permitted) return json({ error: 'Illustration unavailable.' }, 404);
      const object = await env.ART.get(imageKey(image[1], Number(image[2])));
      if (!object) return json({ error: 'Illustration unavailable.' }, 404);
      return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata.contentType, 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/library') {
      const rows = await env.DB.prepare("SELECT record FROM jobs WHERE owner = ? AND kind = 'book' AND status = 'completed' ORDER BY created_at DESC LIMIT 30").bind(user.owner).all();
      return json({ books: await Promise.all(rows.results.map(async r => attachMotion(env, await attachIllustrations(env, JSON.parse(r.record))))) });
    }
    const match = path.match(/^\/api\/jobs\/([a-f0-9]{24})$/);
    if (match) {
      const row = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND owner = ?').bind(match[1], user.owner).first();
      return row ? json(await recordFor(env, row)) : json({ error: '没有找到这次生成，可先回到小世界。 / This generation is unavailable in this browser.' }, 404);
    }
    return json({ error: 'Not found.' }, 404);
  }
  if (request.method !== 'POST' || !['/api/generate', '/api/transcribe', '/api/illustrate'].includes(path)) return json({ error: 'Not found.' }, 404);
  if (request.headers.get('Origin') !== url.origin) throw new ClientError('Same-origin requests required.', 403);
  if (!env.OPENROUTER_API_KEY) return json({ error: 'Story generation is temporarily unavailable.' }, 503);
  const data = await readJson(request, path === '/api/transcribe' ? 2000000 : 80000);
  if (path === '/api/illustrate') {
    if (!data || typeof data.id !== 'string' || !/^[a-f0-9]{24}$/.test(data.id)) throw new ClientError('Invalid story identifier.');
    const row = await env.DB.prepare("SELECT record FROM jobs WHERE id = ? AND owner = ? AND kind IN ('book', 'turn') AND status = 'completed'").bind(data.id, user.owner).first();
    if (!row) return json({ error: 'Story unavailable in this browser.' }, 404);
    const record = await attachMotion(env, await attachIllustrations(env, JSON.parse(row.record)));
    if (record.params.kind === 'book' && record.metadata.illustration_status === 'completed' && !record.metadata.motion_status) {
      try { await env.ANIMATOR.create({ id: 'motion-' + data.id, params: { id: data.id } }); }
      catch {
        const status = await (await env.ANIMATOR.get('motion-' + data.id)).status();
        if (status.status === 'unknown') throw Error('Animation task unavailable.');
      }
    }
    if (!record.metadata.illustration_status) {
      await initializeIllustrations(env, record);
      try { await env.ILLUSTRATOR.create({ id: 'art-' + data.id, params: { id: data.id } }); }
      catch {
        let exists = false;
        try { exists = (await (await env.ILLUSTRATOR.get('art-' + data.id)).status()).status !== 'unknown'; } catch { /* No confirmed task. */ }
        if (!exists) await env.DB.prepare("UPDATE illustrations SET status = 'failed' WHERE job_id = ? AND status = 'pending'").bind(data.id).run();
      }
    }
    return json({ id: data.id }, 202);
  }
  if (path === '/api/generate') {
    if (data?.kind === 'turn') throw new ClientError('实时续写已关闭。请由家长提前准备完整故事。 / Live continuation is disabled. Prepare a complete book first.', 410);
    let params;
    try { params = validate(data); } catch (e) { throw new ClientError(e.message); }
    for (const path of params.reference_illustrations || []) {
      const match = path.match(imageRoute);
      const owned = await env.DB.prepare("SELECT i.job_id FROM illustrations i JOIN jobs j ON j.id = i.job_id WHERE i.job_id = ? AND i.page_index = ? AND j.owner = ? AND i.status = 'completed'").bind(match[1], Number(match[2]), user.owner).first();
      if (!owned) throw new ClientError('Reference illustration unavailable in this browser.');
    }
    const id = (await digest(user.owner + ':' + data.request_id)).slice(0, 24);
    const previous = await env.DB.prepare('SELECT id, params FROM jobs WHERE id = ? AND owner = ?').bind(id, user.owner).first();
    if (previous) {
      if (previous.params !== JSON.stringify(params)) throw new ClientError('Request identifier already used for a different wish.', 409);
      return json({ id }, 202);
    }
    const inserted = await insertJob(env, user, request, id, data.request_id, params.kind, params);
    if (inserted.meta.changes > 0) {
      try { await env.STORIES.create({ id, params: { id } }); }
      catch {
        // An uncertain create must never trigger a second paid generation.
        let exists = false;
        try { const status = await (await env.STORIES.get(id)).status(); exists = status.status !== 'unknown'; } catch { /* No confirmed task. */ }
        if (!exists) {
          const record = { id, status: 'failed', error: UNKNOWN };
          await env.DB.prepare("UPDATE jobs SET status = 'failed', record = ? WHERE id = ? AND started_at IS NULL").bind(JSON.stringify(record), id).run();
        }
      }
    }
    return json({ id }, 202);
  }
  if (!data || typeof data.audio !== 'string' || !['webm', 'mp4', 'wav', 'ogg'].includes(data.format) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio)) throw new ClientError('Invalid audio.');
  let size;
  try { size = atob(data.audio).length; } catch { throw new ClientError('Invalid audio.'); }
  if (size <= 100 || size >= 1400000) throw new ClientError('Audio too large or empty.');
  const requestId = crypto.randomUUID(), id = (await digest(user.owner + ':' + requestId)).slice(0, 24);
  await insertJob(env, user, request, id, requestId, 'asr', {});
  try {
    const result = await provider(env, '/audio/transcriptions', { model: env.ASR_MODEL, input_audio: { data: data.audio, format: data.format }, language: 'zh' }, 60000);
    if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('Empty transcript.');
    await env.DB.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").bind(id).run();
    return json({ text: result.text.slice(0, 320) });
  } catch {
    await env.DB.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(id).run();
    return json({ error: '这次没有听清，可以再说一次或输入文字。 / Try again or type your idea.' }, 502);
  }
}

export class StoryGeneration extends WorkflowEntrypoint {
  async run(event, step) {
    const id = event.payload.id;
    let record = await step.do('generate story once', { retries: { limit: 0, delay: '1 second' }, timeout: '150 seconds' }, async () => {
      const row = await this.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
      if (!row) return { id, status: 'failed', error: UNKNOWN };
      if (row.record) return JSON.parse(row.record);
      // The persisted claim also protects against platform replay after a crash.
      const claim = await this.env.DB.prepare("UPDATE jobs SET started_at = ? WHERE id = ? AND started_at IS NULL AND status = 'pending'").bind(Date.now(), id).run();
      if (!claim.meta.changes) return { id, status: 'failed', error: UNKNOWN };
      const params = JSON.parse(row.params), started = Date.now();
      try {
        const receipt = await provider(this.env, '/chat/completions', completionRequest(params, this.env.STORYBOOK_MODEL), 115000);
        const result = storyResult(receipt, params);
        return { id, status: 'completed', result, params, metadata: { provider: 'OpenRouter', model: receipt.model || this.env.STORYBOOK_MODEL, generation_id: receipt.id, usage: receipt.usage || {}, seconds: (Date.now() - started) / 1000, generated_at: new Date().toISOString(), kind: params.kind } };
      } catch (error) {
        // Log only an error class, never upstream bodies, prompts or credentials.
        console.warn('Story generation failed', { id, category: error.name });
        return { id, status: 'failed', error: FAILED };
      }
    });
    if (record.status === 'completed') {
      record.metadata.motion_required = true;
      record = await illustrateRecord(this.env, step, record);
      record = await animateRecord(this.env, step, record);
    }
    // Retrying this storage step is safe; it does not repeat the model request.
    await step.do('save result', async () => {
      await this.env.DB.prepare('UPDATE jobs SET status = ?, record = ? WHERE id = ?').bind(record.status, JSON.stringify(record), id).run();
    });
    return { id, status: record.status };
  }
}

// Add illustrations to a saved book or turn without regenerating its text.
export class StoryIllustration extends WorkflowEntrypoint {
  async run(event, step) {
    const id = event.payload.id;
    const original = await step.do('load saved book', async () => {
      const row = await this.env.DB.prepare("SELECT record FROM jobs WHERE id = ? AND kind IN ('book', 'turn') AND status = 'completed'").bind(id).first();
      if (!row) throw new Error('Saved book unavailable.');
      return JSON.parse(row.record);
    });
    let record = await illustrateRecord(this.env, step, original);
    record = await animateRecord(this.env, step, record);
    await step.do('save illustrated book', () => this.env.DB.prepare('UPDATE jobs SET record = ? WHERE id = ?').bind(JSON.stringify(record), id).run());
    return { id, status: record.metadata.illustration_status };
  }
}

export class StoryAnimation extends WorkflowEntrypoint {
  async run(event, step) {
    const original = await step.do('load saved illustrated book', async () => {
      const row = await this.env.DB.prepare("SELECT record FROM jobs WHERE id = ? AND kind = 'book' AND status = 'completed'").bind(event.payload.id).first();
      if (!row) throw Error('Saved book unavailable.');
      return attachIllustrations(this.env, JSON.parse(row.record));
    });
    const record = await animateRecord(this.env, step, original);
    await step.do('save animated book', () => this.env.DB.prepare('UPDATE jobs SET record = ? WHERE id = ?').bind(JSON.stringify(record), record.id).run());
    return { id: record.id, status: record.metadata.motion_status };
  }
}

// Each scene has its own external-request budget, independent of book length.
export class SceneAnimation extends WorkflowEntrypoint {
  async run(event, step) {
    const { id, index, page } = event.payload;
    const record = { id, result: { pages: [] } };record.result.pages[index] = page;
    const providerId = await step.do('submit scene motion once', { retries: { limit: 0, delay: '1 second' }, timeout: '120 seconds' }, () => startMotion(this.env, record, index));
    if (!providerId) return { id, index };
    let status = 'pending';
    // Forty reads plus submission/download stay below the free plan's 50
    // external-request limit. GET failures consume a round, never a new job.
    for (let round = 0; status === 'pending' && round < 40; round++) {
      status = await step.do(`read scene motion ${round}`, { retries: { limit: 0, delay: '1 second' }, timeout: '120 seconds' }, async () => {
        try { return await pollMotion(this.env, id, index, providerId); }
        catch { return 'pending'; }
      });
      if (status === 'pending') await step.sleep(`wait for scene motion ${round}`, '15 seconds');
    }
    if (status === 'pending') await step.do('close unavailable scene motion', () => this.env.DB.prepare("UPDATE motions SET status = 'failed' WHERE job_id = ? AND page_index = ? AND status = 'pending'").bind(id, index).run());
    return { id, index, status };
  }
}

export default {
  async fetch(request, env) {
    const user = await identity(request), url = new URL(request.url);
    let response;
    try {
      if (url.pathname.startsWith('/api/')) response = await api(request, env, user, url);
      else if (['/', '/index.html', '/styles.css', '/app.js', '/scene.js', '/readiness.js', '/tree.js', '/export.js', '/subtitles.js', '/playback.js'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) response = await env.ASSETS.fetch(request);
      else response = json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof ClientError) response = json({ error: error.message }, error.status);
      else { console.error('Request failed', { category: error.name }); response = json({ error: '暂时无法连接小世界，请稍后再试。 / Temporarily unavailable.' }, 503); }
    }
    response = new Response(response.body, response);
    if (user.cookie) response.headers.append('Set-Cookie', user.cookie);
    response.headers.set('Content-Security-Policy', CSP);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Cache-Control', url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname === '/index.html' ? 'no-store' : 'no-cache');
    return response;
  },
  async scheduled(event, env, ctx) {
    // Delete private images before expiring their stories; no recordings persist.
    ctx.waitUntil((async () => {
      const cutoff = Date.now() - 30 * 86400000;
      const expired = await env.DB.prepare('SELECT i.job_id, i.page_index FROM illustrations i JOIN jobs j ON j.id = i.job_id WHERE j.created_at < ?').bind(cutoff).all();
      const keys = expired.results.map(row => imageKey(row.job_id, row.page_index));
      const clips = await env.DB.prepare('SELECT m.job_id, m.page_index FROM motions m JOIN jobs j ON j.id = m.job_id WHERE j.created_at < ?').bind(cutoff).all();
      keys.push(...clips.results.map(row => motionKey(row.job_id, row.page_index)));
      for (let start = 0; start < keys.length; start += 1000) await env.ART.delete(keys.slice(start, start + 1000));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM jobs WHERE created_at < ?').bind(cutoff),
        env.DB.prepare("DELETE FROM quota WHERE day < date('now', '-32 days')")
      ]);
    })());
  }
};
