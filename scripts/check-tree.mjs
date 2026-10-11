import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { NODE_IDS, EDGES, compileTree, validateTree, routeTo } from '../public/tree.js';
import { storyResult, completionRequest } from '../cloud/story.js';
import { imageRequest } from '../cloud/illustration.js';
import { buildOfflineHTML } from '../public/export.js';

const bi = zh => ({ zh, en: zh });
const raw = { title: bi('Tree'), hero_name: bi('Bear'), pages: NODE_IDS.map(id => ({ id, title: bi(id), text: bi('EVENT_' + id), scene: { setting: 'lake', hero: 'bear', prop: 'boat', mood: 'calm', description: bi('VISUAL_' + id) }, interaction: EDGES[id].length === 2 ? { prompt: bi('Choose'), choices: [{ label: bi('Main') }, { label: bi('Branch') }] } : null, ending: EDGES[id].length ? null : bi('A complete ending') })), reveal: { concept: bi('Cooperation'), child_explanation: bi('Together'), parent_note: bi('Simplification'), boundary: bi('Limits'), everyday_example: bi('Example'), mappings: Array.from({ length: 3 }, () => ({ story: bi('Story'), meaning: bi('Meaning') })) } };
const params = { kind: 'book', concept: '合作', age: '6–8', world: 'lake' };
raw.forks = [raw.pages[1].interaction, raw.pages[3].interaction];raw.endings = [raw.pages[5].ending, raw.pages[7].ending, raw.pages[9].ending];raw.pages = raw.pages.map(({id,interaction,ending,...page}) => page);
const book = storyResult({ choices: [{ message: { content: JSON.stringify(raw) } }] }, params);
const paths = validateTree(book);
assert.deepEqual(paths.map(path => path.length).sort(), [4, 6, 6]);
assert.equal(paths.length, 3);
assert.deepEqual(routeTo(book, 'a2'), ['m1', 'm2', 'a1', 'a2']);
assert.deepEqual(routeTo(book, 'b2'), ['m1', 'm2', 'm3', 'm4', 'b1', 'b2']);
for (const mutation of [
  b => { b.pages[7].next = 'm1';b.pages[7].ending = null; },
  b => { b.pages[0].next = 'missing'; },
  b => { b.pages[1].interaction.choices[1].target = 'm3'; },
  b => { b.pages[7].ending = null; },
  b => { b.pages[0].next = 'm3'; },
  b => { b.pages[0].id = 'm2'; }
]) { const invalid = structuredClone(book);mutation(invalid);assert.throws(() => validateTree(invalid)); }
const missing = structuredClone(raw);missing.endings.pop();assert.throws(() => compileTree(missing));
assert.throws(() => completionRequest({ kind: 'turn' }, 'model'), /disabled/);

const record = { params, result: book };
const branchA = imageRequest(record, 7).prompt, branchB = imageRequest(record, 9).prompt;
assert(branchA.includes('EVENT_m2') && branchA.includes('EVENT_a1') && branchA.includes('EVENT_a2'));
assert(!branchA.includes('EVENT_m3') && !branchA.includes('EVENT_b1'));
assert(branchB.includes('EVENT_m4') && branchB.includes('EVENT_b1'));
assert(!branchB.includes('EVENT_m5') && !branchB.includes('EVENT_a1'));
assert(branchA.includes('safe area'));

const exportBook = structuredClone(book);
exportBook.pages[0].text = bi('</script><script>window.INJECTED=true</script>');
exportBook.pages.forEach(p => { p.illustration = { url: '/api/illustrations/' + 'a'.repeat(24) + '/0', status: 'completed' }; });
const sceneCode = fs.readFileSync(new URL('../public/scene.js', import.meta.url), 'utf8');
const atmosphere = sceneCode.slice(sceneCode.indexOf('function atmosphereArt'), sceneCode.indexOf('function drawScene')).trim();
const images = Array.from({ length: 10 }, (_, i) => 'data:image/jpeg;base64,' + Buffer.from('image' + i).toString('base64'));
const html = buildOfflineHTML(exportBook, images, 'body{color:white}', atmosphere);
assert(!html.includes('/api/') && !html.includes('fetch(') && !html.includes('OPENROUTER'));
assert(html.includes("connect-src 'none'"));
assert.equal((html.match(/<script>/g) || []).length, 1);
for (const image of images) assert(html.includes(image));
assert(html.includes('\\u003c/script\\u003e'));
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
new vm.Script(script);
assert.throws(() => buildOfflineHTML(book, images.slice(0, 9), '', atmosphere));
assert.throws(() => buildOfflineHTML(book, images.map(() => 'https://example.org/image.jpg'), '', atmosphere));

// Execute the exported player without a network or browser session. This checks
// the separate export runtime, rather than assuming the online reader covers it.
class Element {
  constructor() { this.children = [];this.style = {};this.offsetWidth = 680;this.offsetHeight = 150;this.checked = true;this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; }
  querySelector() { return null; }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  addEventListener() {}
  setAttribute() {}
  getBoundingClientRect() { return { left: 60, top: 520 }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
const context = vm.createContext({ document: { getElementById: id => elements.get(id), createElement: () => new Element(), querySelectorAll: () => [], body: new Element() }, innerWidth: 805, innerHeight: 827, addEventListener() {}, ResizeObserver: class { observe() {} }, matchMedia: () => ({ matches: false }), fetch() { throw Error('Offline player attempted network access.'); } });
new vm.Script(script).runInContext(context);
const click = id => elements.get(id).onclick();
assert.equal(elements.get('page-title').textContent, 'm1');
click('next-page');assert.equal(elements.get('page-title').textContent, 'm2');
assert.equal(elements.get('next-page').disabled, true);
elements.get('suggestions').children[1].onclick();click('next-page');
assert.equal(elements.get('page-title').textContent, 'a2');
click('next-page');assert.equal(elements.get('reveal-dialog').open, true);
assert.equal(elements.get('chapter-label').textContent, '故事结束 · THE END');
click('next-page');assert.equal(elements.get('page-title').textContent, 'a2', 'An ending cannot continue generating.');
click('restart-book');click('next-page');elements.get('suggestions').children[0].onclick();click('next-page');
assert.equal(elements.get('page-title').textContent, 'm4');elements.get('suggestions').children[1].onclick();click('next-page');
assert.equal(elements.get('page-title').textContent, 'b2');
assert.equal(elements.get('tree-list').children.length, 10);
assert.equal(context.INJECTED, undefined);

const local = spawnSync('python3', ['-c', 'import sys,json;from scripts.story_tree import compile_tree;print(json.dumps(compile_tree(json.load(sys.stdin))))'], { input: JSON.stringify(raw), encoding: 'utf8' });
assert.equal(local.status, 0, local.stderr);assert.deepEqual(JSON.parse(local.stdout), book);
const migration = spawnSync('python3', ['-c', `import sqlite3,pathlib
db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY)')
db.execute("INSERT INTO jobs VALUES('old')")
db.executescript(pathlib.Path('cloud/migrations/0004_illustrations.sql').read_text())
db.execute("INSERT INTO illustrations(job_id,page_index,status,model) VALUES('old',5,'completed','model')")
db.executescript(pathlib.Path('cloud/migrations/0005_story_tree.sql').read_text())
assert db.execute('SELECT page_index,status FROM illustrations').fetchall()==[(5,'completed')]
db.execute("INSERT INTO illustrations(job_id,page_index,status,model) VALUES('old',9,'pending','model')")
try:
 db.execute("INSERT INTO illustrations(job_id,page_index,status,model) VALUES('old',10,'pending','model')")
 raise AssertionError('Unbounded index accepted')
except sqlite3.IntegrityError: pass
`], { encoding: 'utf8' });
assert.equal(migration.status, 0, migration.stderr);
console.log('Tree checks passed: three bounded routes, invalid graph rejection, branch-only image context, local/cloud parity, complete escaped offline export and image-preserving migration.');
