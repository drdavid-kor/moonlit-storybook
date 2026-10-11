import { validateTree, targets, routeTo } from './tree.js';
import { installSubtitles } from './subtitles.js';
import { playSceneMotion } from './playback.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scriptJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// Only public story content and embedded raster assets enter the portable file.
export function offlineBook(result, images, clips = []) {
  if (result.tree) validateTree(result);
  if (images.length !== result.pages.length || images.some(source => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))) throw Error('Missing export image.');
  if (clips.some(source => source !== null && !/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) || (clips.length && clips.length !== result.pages.length) || result.pages.some((page, i) => page.motion?.status === 'completed' && !clips[i])) throw Error('Missing export animation.');
  return { title: result.title, hero_name: result.hero_name, tree: result.tree || null, reveal: result.reveal, pages: result.pages.map((page, i) => ({ id: page.id || String(i), title: page.title, text: page.text, scene: page.scene, next: page.next ?? null, interaction: result.tree ? page.interaction : null, ending: page.ending || null, image: images[i], clip: clips[i] || null })) };
}

function offlinePlayer(book) {
  const $ = id => document.getElementById(id), esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let index = 0, history = [0];
  function go(target) {
    const next = book.pages.findIndex(page => page.id === target);
    if (next < 0) return;
    const route = routeTo(book, target);
    history = route.map(id => book.pages.findIndex(page => page.id === id));index = next;render();
  }
  function reveal() {
    const discovery = book.pages[index].ending, r = book.reveal;
    $('reveal-content').innerHTML = (discovery ? `<p>${esc(discovery.zh)}</p><p>${esc(discovery.en)}</p>` : '') + `<h2>${esc(r.concept.zh)}</h2><p>${esc(r.child_explanation.zh)}</p><p>${esc(r.child_explanation.en)}</p><p>${esc(r.everyday_example.zh)}</p><details><summary>给家长的小纸条 · For grown-ups</summary><p>${esc(r.parent_note.zh)}</p>${r.mappings.map(m => `<p>${esc(m.story.zh)} → ${esc(m.meaning.zh)}</p>`).join('')}<p>${esc(r.boundary.zh)}</p></details>`;
    $('reveal-dialog').showModal();
  }
  function render() {
    const page = book.pages[index];
    $('book-title').textContent = book.title.zh;$('chapter-label').textContent = page.ending ? '故事结束 · THE END' : `SCENE ${history.length} · ${book.tree?.main_path.includes(page.id) ? 'MAIN STORY' : 'STORY PATH'}`;
    $('landscape').querySelector('video')?.pause();
    $('landscape').innerHTML = `<img class="illustration-backdrop" src="${page.image}" alt="" aria-hidden="true"><div class="illustration-frame"><div class="illustration-artwork${page.clip ? ' has-character-motion' : ''}"><img class="story-illustration" src="${page.image}" alt="${esc(page.scene.description.zh)}">${page.clip ? `<video class="story-motion" src="${page.clip}" poster="${page.image}" muted loop playsinline preload="auto" aria-hidden="true"></video>` : ''}${atmosphereArt(page.scene)}</div></div>`;
    playSceneMotion($('landscape'), $('motion').checked);
    $('page-title').textContent = page.title.zh;$('subtitle').textContent = page.text.zh;$('subtitle-en').textContent = page.text.en;$('subtitle-en').hidden = !$('bilingual').checked;
    $('suggestions').replaceChildren();$('choice-prompt').textContent = page.interaction?.prompt.zh || (page.ending ? '今晚的冒险到这里，故事有了自己的结局。' : '');
    for (const choice of page.interaction?.choices || []) { const button = document.createElement('button');button.className = 'suggestion';button.textContent = choice.label.zh;button.onclick = () => go(choice.target);$('suggestions').append(button); }
    $('previous-page').disabled = history.length < 2;$('page-dots').textContent = `${history.length} / ${book.tree ? routeTo(book, page.id).length + remaining(page) : book.pages.length}`;
    $('next-page').textContent = page.interaction ? '选择一条路 · Choose a path' : (page.ending || index === book.pages.length - 1) ? '结局的小发现 ✦' : '下一幕 →';$('next-page').disabled = Boolean(page.interaction);
  }
  function remaining(page) { return page.next ? 1 + remaining(book.pages.find(p => p.id === page.next)) : 0; }
  $('next-page').onclick = () => { const page = book.pages[index];if (page.ending || (!book.tree && index === book.pages.length - 1)) reveal();else if (book.tree) go(page.next);else { index++;history.push(index);render(); } };
  $('previous-page').onclick = () => { if (history.length > 1) { history.pop();index = history[history.length - 1];render(); } };
  $('restart-book').onclick = () => { index = 0;history = [0];render(); };
  $('tree-button').onclick = () => $('tree-dialog').showModal();
  for (const [i, page] of book.pages.entries()) { const button = document.createElement('button');button.className = 'tree-node' + (page.ending ? ' tree-ending' : '');button.textContent = `${page.ending ? '✦ 结局' : book.tree?.main_path.includes(page.id) ? '主线' : book.tree ? '支线' : '场景'} · ${page.title.zh}`;button.onclick = () => { $('tree-dialog').close();if (book.tree) go(page.id);else { index = i;history = Array.from({ length: i + 1 }, (_, n) => n);render(); } };$('tree-list').append(button); }
  for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
  $('motion').onchange = () => { document.body.classList.toggle('motion-paused', !$('motion').checked);playSceneMotion($('landscape'), $('motion').checked); };
  $('bilingual').onchange = render;
  $('text-expand').onclick = () => { $('subtitle-panel').classList.toggle('expanded');$('text-expand').setAttribute('aria-expanded', String($('subtitle-panel').classList.contains('expanded'))); };
  installSubtitles($('subtitle-panel'), $('subtitle-drag'), $('subtitle-reset'));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { $('motion').checked = false;document.body.classList.add('motion-paused'); }
  render();
}

export function buildOfflineHTML(result, images, css, atmosphereSource, clips = []) {
  const book = offlineBook(result, images, clips);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(book.title.zh)} · Moonlit Stories</title><style>${css}</style></head><body>
<main id="experience" class="experience reading has-illustration"><div id="landscape" class="landscape"></div><div class="grain" aria-hidden="true"></div><div class="vignette" aria-hidden="true"></div>
<header class="floating-header"><button id="restart-book" class="round-button" aria-label="从头阅读 Restart book">↺</button><div class="reader-heading"><span id="book-title"></span><small id="chapter-label"></small></div><nav class="offline-tools"><label><input id="bilingual" type="checkbox" checked> 双语</label><label><input id="motion" type="checkbox" checked> 动效</label></nav></header>
<section class="reader-view"><div id="subtitle-panel" class="subtitle-panel floating-subtitles"><div class="subtitle-meta"><span id="page-title"></span><div class="subtitle-tools"><button id="subtitle-drag" aria-label="拖动字幕 Move subtitles">⠿ 拖动</button><button id="subtitle-reset" aria-label="复位字幕 Reset subtitles">↺</button><button id="text-expand" aria-label="展开完整字幕 Expand subtitles" aria-expanded="false">⌃</button></div></div><p id="subtitle"></p><p id="subtitle-en" class="english-subtitle"></p></div>
<div class="reading-dock"><p id="choice-prompt" class="choice-prompt"></p><div id="suggestions" class="suggestions"></div><div class="page-controls"><button id="previous-page" class="quiet-button">← 上一幕</button><span id="page-dots"></span><button id="next-page" class="quiet-button">下一幕 →</button></div><div class="book-actions"><button id="tree-button">故事树 · Story tree</button><span>离线绘本 · Offline book</span></div></div></section></main>
<dialog id="tree-dialog" class="sheet"><button class="close-dialog" data-close="tree-dialog" aria-label="关闭 Close">×</button><p class="overline">EVERY PATH HAS AN ENDING</p><h2>整本故事 · Story tree</h2><p>全部 ${book.pages.length} 幕已包含在这个文件中，选择任意一幕阅读。<br>Every scene and illustration is embedded. Choose a scene to explore.</p><div id="tree-list" class="tree-list"></div></dialog>
<dialog id="reveal-dialog" class="sheet"><button class="close-dialog" data-close="reveal-dialog" aria-label="关闭 Close">×</button><p class="overline">THE END · A LITTLE DISCOVERY</p><div id="reveal-content"></div></dialog>
<script>const atmosphereArt=${atmosphereSource};const targets=${targets.toString()};const routeTo=${routeTo.toString()};const installSubtitles=${installSubtitles.toString()};const playSceneMotion=${playSceneMotion.toString()};(${offlinePlayer.toString()})(${scriptJSON(book)});</script></body></html>`;
}

export async function downloadBook(record, artwork, atmosphereSource) {
  await artwork.preload(record, { motion: true });
  const images = await Promise.all(record.result.pages.map(async page => {
    let blob = artwork.blob(page.illustration.url);
    if (!blob) { const response = await fetch(page.illustration.url);if (!response.ok) throw Error('Could not read illustration.');blob = await response.blob(); }
    return new Promise((resolve, reject) => { const reader = new FileReader();reader.onload = () => resolve(reader.result);reader.onerror = reject;reader.readAsDataURL(blob); });
  }));
  const clips = await Promise.all(record.result.pages.map(async page => {
    if (page.motion?.status !== 'completed') return null;
    const blob = artwork.blob(page.motion.url);
    if (!blob) throw Error('Missing prepared animation.');
    return new Promise((resolve, reject) => { const reader = new FileReader();reader.onload = () => resolve(reader.result);reader.onerror = reject;reader.readAsDataURL(blob); });
  }));
  const response = await fetch('/styles.css');if (!response.ok) throw Error('Could not prepare export.');
  const html = buildOfflineHTML(record.result, images, await response.text(), atmosphereSource, clips);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), link = document.createElement('a');
  link.href = url;link.download = record.result.title.zh.replace(/[\\/:*?"<>|]/g, '') + '·完整绘本.html';document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url), 60000);
}
