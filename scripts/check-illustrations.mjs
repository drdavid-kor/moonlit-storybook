import assert from 'node:assert/strict';
import { imageRequest, decodeImage, illustratePage, imageKey } from '../cloud/illustration.js';
import { validate } from '../cloud/story.js';

const bilingual = zh => ({ zh, en: zh });
const page = { title: bilingual('A bridge'), text: bilingual('小熊和狐狸一起把木板架在溪流两岸。'), scene: { setting: 'forest', hero: 'bear', prop: 'bridge', mood: 'joy', description: bilingual('小熊扶住木板，狐狸在溪流另一侧拉着绳子。') }, interaction: null };
const record = { id: 'a'.repeat(24), params: { kind: 'book' }, result: { title: bilingual('Bridge'), pages: Array.from({ length: 6 }, () => structuredClone(page)) } };
const payload = imageRequest(record, 2, undefined, ['data:image/jpeg;base64,example']);
assert(payload.prompt.includes(page.text.zh));
assert(payload.prompt.includes(page.scene.description.zh));
assert(payload.prompt.includes('ONLY current_page'));
assert.equal(payload.input_references.length, 1);
assert.equal(payload.aspect_ratio, '16:9');
assert.equal(payload.provider.allow_fallbacks, false);
const futureBook = structuredClone(record);
futureBook.result.pages[5].text.zh = 'FUTURE_EVENT_NOT_TO_PAINT';
assert(!imageRequest(futureBook, 0).prompt.includes('FUTURE_EVENT_NOT_TO_PAINT'), 'Future pages must not leak into earlier illustrations.');

const bytes = new Uint8Array(120);bytes.set([255, 216, 255]);
const receipt = { data: [{ media_type: 'image/jpeg', b64_json: Buffer.from(bytes).toString('base64') }], usage: { cost: .018 } };
assert.equal(decodeImage(receipt).bytes.length, 120);
assert.throws(() => decodeImage({ data: [{ media_type: 'image/svg+xml', b64_json: 'PHN2Zz4=' }] }));
assert.throws(() => decodeImage({ data: [{ media_type: 'image/png', b64_json: receipt.data[0].b64_json }] }));
assert.throws(() => decodeImage({ data: [{ media_type: 'image/jpeg', b64_json: '%%%invalid' }] }));
const withImage = { ...page, illustration: { url: `/api/illustrations/${record.id}/0`, status: 'completed' } };
assert.throws(() => validate({ kind: 'turn', request_id: 'illustration-test', concept: '合作', age: '6–8', input: '我们一起修桥', history: [withImage] }), /disabled/);

function environment(started = null, saved = false) {
  const row = { status: 'pending', started_at: started }, objects = new Map();
  const key = imageKey(record.id, 0);
  if (saved) objects.set(key, { bytes, httpMetadata: { contentType: 'image/jpeg' } });
  return { row, objects, OPENROUTER_API_KEY: 'test-fixture', DB: { prepare(sql) {
    return { bind(...args) {
      return {
        async first() { return { ...row }; },
        async run() {
          if (sql.includes('SET started_at')) { if (row.started_at !== null || row.status !== 'pending') return { meta: { changes: 0 } };row.started_at = args[0]; }
          else if (sql.includes("status = 'completed'")) row.status = 'completed';
          else if (sql.includes("status = 'failed'")) row.status = 'failed';
          else if (sql.includes('SET status = ?')) row.status = args[0];
          return { meta: { changes: 1 } };
        }
      };
    } };
  } }, ART: {
    async head(k) { return objects.get(k) || null; },
    async get(k) { const object = objects.get(k);return object ? { ...object, arrayBuffer: async () => object.bytes.buffer } : null; },
    async put(k, value, options) { objects.set(k, { bytes: value, ...options }); }
  } };
}

const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (url, options) => { assert.equal(url, 'https://openrouter.ai/api/v1/images');assert(JSON.parse(options.body).prompt.includes(page.text.zh));calls++;return Response.json(receipt); };
  const normal = environment();
  assert.equal((await illustratePage(normal, record, 0)).status, 'completed');
  assert.equal((await illustratePage(normal, record, 0)).status, 'completed');
  assert.equal(calls, 1, 'A completed page must never generate twice.');
  assert.equal((await illustratePage(environment(123, true), record, 0)).status, 'completed');
  assert.equal((await illustratePage(environment(123), record, 0)).status, 'failed');
  assert.equal(calls, 1, 'Uncertain calls must not be repeated.');
  globalThis.fetch = async () => { calls++;throw new Error('Simulated timeout'); };
  const timeout = environment();
  assert.equal((await illustratePage(timeout, record, 0)).status, 'failed');
  assert.equal((await illustratePage(timeout, record, 0)).status, 'failed');
  assert.equal(calls, 2, 'A failed paid call must not retry automatically.');
} finally { globalThis.fetch = originalFetch; }
console.log('Illustration checks passed: story prompts, reference validation, raster validation, idempotency and uncertain-call recovery.');
