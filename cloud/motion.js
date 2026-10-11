import motionStyle from './motion-style.json' with { type: 'json' };
import { imageKey } from './illustration.js';

export const DEFAULT_MOTION_MODEL = motionStyle.model;
export const motionRoute = /^\/api\/motion\/([a-f0-9]{24})\/([0-9])$/;
export const motionPath = (id, index) => `/api/motion/${id}/${index}`;
export const motionKey = (id, index) => `motion/${id}/${index}.mp4`;

export function motionRequest(record, index, image, model = DEFAULT_MOTION_MODEL) {
  const page = record.result.pages[index];
  return {
    model, duration: motionStyle.duration, resolution: motionStyle.resolution, aspect_ratio: motionStyle.aspect_ratio, generate_audio: motionStyle.generate_audio,
    frame_images: ['first_frame', 'last_frame'].map(frame_type => ({ type: 'image_url', image_url: { url: image }, frame_type })),
    prompt: motionStyle.prompt + JSON.stringify({ title: page.title.zh, text: page.text.zh, visual: page.scene.description.zh })
  };
}

async function provider(env, path, body) {
  const response = await fetch('https://openrouter.ai/api/v1' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}), 'HTTP-Referer': 'https://storybook.david-widgets.com', 'X-Title': 'Moonlit Stories' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw Error('Motion provider HTTP ' + response.status);
  return response;
}

export async function attachMotion(env, record) {
  if (!record.result?.pages || record.params?.kind !== 'book') return record;
  const rows = await env.DB.prepare('SELECT page_index, status FROM motions WHERE job_id = ? ORDER BY page_index').bind(record.id).all();
  if (!rows.results.length) return record;
  const result = structuredClone(record.result);
  for (const row of rows.results) if (result.pages[row.page_index]) result.pages[row.page_index].motion = {
    status: row.status, ...(row.status === 'completed' ? { url: motionPath(record.id, row.page_index) } : {})
  };
  const completed = rows.results.filter(row => row.status === 'completed').length;
  const status = rows.results.some(row => row.status === 'pending') ? 'pending' : completed === result.pages.length ? 'completed' : 'failed';
  return { ...record, result, metadata: { ...record.metadata, motion_required: true, motion_status: status, motion_completed: completed, motion_total: result.pages.length } };
}

export async function startMotion(env, record, index) {
  const row = await env.DB.prepare('SELECT * FROM motions WHERE job_id = ? AND page_index = ?').bind(record.id, index).first();
  if (row.status !== 'pending' || row.provider_id) return row.provider_id;
  const claim = await env.DB.prepare("UPDATE motions SET started_at = ? WHERE job_id = ? AND page_index = ? AND status = 'pending' AND started_at IS NULL").bind(Date.now(), record.id, index).run();
  if (!claim.meta.changes) {
    // Never resubmit an uncertain paid request after a crash.
    const saved = await env.ART.head(motionKey(record.id, index));
    await env.DB.prepare('UPDATE motions SET status = ? WHERE job_id = ? AND page_index = ?').bind(saved ? 'completed' : 'failed', record.id, index).run();
    return null;
  }
  try {
    const source = await env.ART.get(imageKey(record.id, index));
    if (!source) throw Error('Missing first frame.');
    const bytes = new Uint8Array(await source.arrayBuffer());let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const image = `data:${source.httpMetadata.contentType};base64,${btoa(binary)}`;
    const receipt = await (await provider(env, '/videos', motionRequest(record, index, image, env.MOTION_MODEL || DEFAULT_MOTION_MODEL))).json();
    if (typeof receipt.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(receipt.id)) throw Error('Invalid motion identifier.');
    await env.DB.prepare('UPDATE motions SET provider_id = ? WHERE job_id = ? AND page_index = ?').bind(receipt.id, record.id, index).run();
    return receipt.id;
  } catch (error) {
    const reason = /^Motion provider HTTP [0-9]{3}$/.test(error.message) ? error.message : /subrequests/i.test(error.message) ? 'Subrequest limit' : error.name;
    console.warn('Motion submission failed', { id: record.id, index, reason });
    await env.DB.prepare("UPDATE motions SET status = 'failed', metadata = ? WHERE job_id = ? AND page_index = ?").bind(JSON.stringify({ failure: reason }), record.id, index).run();
    return null;
  }
}

export async function pollMotion(env, id, index, providerId) {
  const row = await env.DB.prepare('SELECT status FROM motions WHERE job_id = ? AND page_index = ?').bind(id, index).first();
  if (row.status !== 'pending') return row.status;
  const receipt = await (await provider(env, '/videos/' + providerId)).json();
  if (receipt.status === 'completed') {
    const response = await provider(env, '/videos/' + providerId + '/content');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 24000000 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') throw Error('Invalid motion content.');
    await env.ART.put(motionKey(id, index), bytes, { httpMetadata: { contentType: 'video/mp4' } });
    await env.DB.prepare("UPDATE motions SET status = 'completed', metadata = ? WHERE job_id = ? AND page_index = ?").bind(JSON.stringify({ usage: receipt.usage || {}, generated_at: new Date().toISOString() }), id, index).run();
    return 'completed';
  }
  if (['failed', 'cancelled'].includes(receipt.status)) {
    await env.DB.prepare("UPDATE motions SET status = 'failed' WHERE job_id = ? AND page_index = ?").bind(id, index).run();
    return 'failed';
  }
  return 'pending';
}

export async function animateRecord(env, step, record) {
  if (record.params?.kind !== 'book' || record.metadata?.illustration_status !== 'completed') return record;
  await step.do('prepare character animation slots', () => env.DB.batch(record.result.pages.map((_, i) => env.DB.prepare("INSERT OR IGNORE INTO motions(job_id, page_index, status, model) VALUES (?, ?, 'pending', ?)").bind(record.id, i, env.MOTION_MODEL || DEFAULT_MOTION_MODEL))));
  // Three clips in flight; durable sleeps do not hold a Worker open.
  for (let start = 0; start < record.result.pages.length; start += 3) {
    const indices = Array.from({ length: Math.min(3, record.result.pages.length - start) }, (_, i) => start + i);
    await Promise.all(indices.map(index => step.do(`dispatch scene animation ${index}`, async () => {
      const row = await env.DB.prepare('SELECT status FROM motions WHERE job_id = ? AND page_index = ?').bind(record.id, index).first();
      if (row.status !== 'pending') return;
      const id = `scene-${record.id}-${index}`;
      try { await env.SCENE_ANIMATIONS.create({ id, params: { id: record.id, index, page: record.result.pages[index] } }); }
      catch { if ((await (await env.SCENE_ANIMATIONS.get(id)).status()).status === 'unknown') throw Error('Scene task unavailable.'); }
    })));
    let pending = true;
    for (let round = 0; pending && round < 90; round++) {
      pending = await step.do(`check scene animation batch ${start} round ${round}`, async () => {
        const rows = await env.DB.prepare('SELECT page_index,status FROM motions WHERE job_id = ?').bind(record.id).all();
        return rows.results.some(row => indices.includes(row.page_index) && row.status === 'pending');
      });
      if (pending) await step.sleep(`wait for scene animation batch ${start} round ${round}`, '10 seconds');
    }
    if (pending) await step.do(`close timed-out animation batch ${start}`, () => env.DB.batch(indices.map(index => env.DB.prepare("UPDATE motions SET status = 'failed' WHERE job_id = ? AND page_index = ? AND status = 'pending'").bind(record.id, index))));
  }
  return attachMotion(env, record);
}
