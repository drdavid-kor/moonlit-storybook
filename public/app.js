'use strict';
import { isBookReady, selectShelf, createArtworkCache } from './readiness.js';
import { routeTo, validateTree } from './tree.js';
import { installSubtitles } from './subtitles.js';
import { downloadBook } from './export.js';
import { playSceneMotion } from './playback.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stored=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const clone=v=>JSON.parse(JSON.stringify(v));
const defaultPoints=[
 '机会成本：时间有限，选择一个活动，意味着放弃另一个可行活动；机会成本是被放弃的最佳替代选择的价值。',
 '分工与合作：角色擅长不同的事，协调各自的行动，一起实现共同目标。',
 '概率：可能性有大有小，但更可能发生不代表下一次一定发生。'
];
const legacyChoices=stored('moonlit-learning-choices',[]);
const legacyPoints=(Array.isArray(legacyChoices)?legacyChoices:[]).map(w=>w?.concept).filter(p=>typeof p==='string'&&p.trim()).slice(0,3);
let state={view:'home',knowledge:stored('moonlit-knowledge-settings',{points:legacyPoints.length?legacyPoints:defaultPoints,age:stored('moonlit-age','6–8')}),world:stored('moonlit-world','lake'),books:[],shelf:[],preparation:stored('moonlit-story-preparation',null),book:null,page:0,path:[0],branch:false,version:0,pending:null,english:stored('moonlit-bilingual',false),motion:stored('moonlit-motion',!matchMedia('(prefers-reduced-motion: reduce)').matches),speech:false};
if(!Array.isArray(state.knowledge?.points)||!state.knowledge.points.length)state.knowledge={points:defaultPoints,age:'6–8'};
if(!['4–5','6–8','9–12'].includes(state.knowledge.age))state.knowledge.age='6–8';
if(!WORLDS[state.world])state.world='lake';
if(state.preparation&&(!Array.isArray(state.preparation.points)||!Array.isArray(state.preparation.completed)||!Number.isInteger(state.preparation.index)||!state.preparation.id))state.preparation=null;
let pollTimer,bubbleTimer,micSession=null;
const parentArtPending=new Map();
const artwork=createArtworkCache(async path=>{
 const response=await fetch(path,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Illustration unavailable.');
 const blob=await response.blob(),source=URL.createObjectURL(blob);
 try{
  if(!path.startsWith('/api/motion/')){const image=new Image();image.src=source;await image.decode();}
  return {source,blob};
 }catch(error){URL.revokeObjectURL(source);throw error;}
});
function notice(message){$('notice-text').textContent=message;$('notice').hidden=false;}
function closeDialogs(){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();}
function openDialog(id){closeDialogs();$(id).showModal();}
function renderLandscape(scene,home=false,illustration=null,motion=null){
 $('landscape').querySelector('video')?.pause();
 $('landscape').setAttribute('role','img');$('landscape').setAttribute('aria-label',scene.description?.zh||WORLDS[scene.setting]?.zh||'月光下的小世界');$('landscape').innerHTML=drawScene(scene,home,illustration,artwork.source(illustration?.url),motion,artwork.source(motion?.url));
 playSceneMotion($('landscape'),state.motion);
 const illustrated=!!$('landscape').querySelector('.story-illustration');$('experience').classList.toggle('has-illustration',illustrated);
 $('artwork-status').hidden=home||illustrated;
 if(!home&&!illustrated)$('artwork-status').textContent=illustration?.status==='failed'?'这一幕的插画未完成，文字故事仍可阅读。 · The illustration is unavailable.':'正在为故事绘制插画… · Painting this story…';
 $('landscape').querySelector('.story-illustration')?.addEventListener('error',()=>{if(state.view==='reader'){$('artwork-status').textContent='这一幕的插画暂时打不开，文字故事仍可阅读。 · The illustration could not load.';$('artwork-status').hidden=false;}},{once:true});
 const picture=$('landscape').querySelector('.story-illustration');
 if(picture&&!picture.complete){$('artwork-status').textContent='正在打开这一幕… · Opening this illustration…';$('artwork-status').hidden=false;picture.addEventListener('load',()=>{if($('landscape').contains(picture))$('artwork-status').hidden=true;},{once:true});}
 $('landscape').classList.remove('entering');void $('landscape').offsetWidth;$('landscape').classList.add('entering');
}

// Existing text-only stories can be illustrated explicitly from the parent's library.
async function prepareSavedIllustrations(record){
 if(parentArtPending.has(record.id)||state.pending)return;
 parentArtPending.set(record.id,record);renderLibrary();renderPreparation();
 try{
  const response=await fetch('/api/illustrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:record.id})});
  if(!response.ok)throw Error();refreshParentIllustrations(record.id);
 }catch{parentArtPending.delete(record.id);renderLibrary();renderPreparation();notice('暂时无法准备插画，请稍后再试。 · Could not start illustration preparation.');}
}
async function refreshParentIllustrations(id){
 try{
  const response=await fetch('/api/jobs/'+id);if(!response.ok)throw Error();const record=await response.json();
  parentArtPending.set(id,record);renderLibrary();
  if(record.metadata?.illustration_status==='pending'||record.metadata?.motion_status==='pending'||(!record.metadata?.motion_status&&record.metadata?.illustration_status!=='failed')){setTimeout(()=>refreshParentIllustrations(id),3000);return;}
  parentArtPending.delete(id);await loadLibrary();renderPreparation();
  notice(isBookReady(record)?'绘本已准备好，角色也会动了。 · The illustrated, animated book is ready.':'绘本画面或角色动画未全部完成，请在家长设置中准备新的故事。 · Some book media could not be prepared.');
 }catch{setTimeout(()=>refreshParentIllustrations(id),5000);}
}
function persistPreparation(){save('moonlit-story-preparation',state.preparation);}
function renderPreparation(){
 const preparing=state.preparation?.status==='running';
 let resume=false;try{resume=canResumePreparation(parseKnowledge($('knowledge-points').value),$('age').value);}catch{}
 $('prepare-submit').innerHTML=resume?'继续准备余下的故事 <span>Finish preparing stories ↗</span>':'保存并准备三个故事 <span>Prepare three stories ↗</span>';
 $('prepare-submit').disabled=preparing||!!state.pending||!!parentArtPending.size;
 $('knowledge-points').disabled=preparing;
 $('age').disabled=preparing;
 $('parent-mic').disabled=preparing;
 $('preparation-note').textContent=preparing?`正在准备第 ${Math.min(state.preparation.index+1,3)} / 3 个故事，完成后一起展示。 · Preparing three complete stories…`:state.preparation?.status==='failed'?`已准备 ${state.preparation.completed.filter(Boolean).length} / 3 个故事；保持相同设置可以继续，已完成的不会重复生成。 · Finished stories are kept when you continue.`:'一个知识点可以有不同故事；一组知识点会轮流成为故事核心。 · One point can inspire different stories; a group is used in turn.';
}
function stopSpeech(){if('speechSynthesis'in window)speechSynthesis.cancel();state.speech=false;$('sound-button').setAttribute('aria-pressed','false');}
function cancelMicrophone(){if(micSession){micSession.cancelled=true;if(micSession.recorder?.state==='recording')micSession.recorder.stop();micSession.stream?.getTracks().forEach(t=>t.stop());}}
function showHome(){state.version++;stopSpeech();cancelMicrophone();state.view='home';$('experience').classList.remove('reading');$('home-view').hidden=false;$('reader-view').hidden=true;$('home-mark').hidden=false;$('back-home').hidden=true;$('reader-heading').hidden=true;$('sound-button').hidden=true;$('motion-button').hidden=true;$('world-button').hidden=false;$('scene-bubble').hidden=true;renderLandscape({setting:state.world,hero:state.world==='forest'?'fox':state.world==='space'?'rabbit':'bear',prop:state.world==='forest'?'lantern':state.world==='space'?'star':'boat'},true);$('world-label').textContent=WORLDS[state.world].zh;$('world-label-en').textContent=WORLDS[state.world].en;}
function renderCards(){
 const grid=$('story-choices');grid.replaceChildren();
 $('empty-shelf').hidden=!!state.shelf.length;
 for(const [i,record] of state.shelf.entries()){
  const button=document.createElement('button');
  button.className='story-choice story-card';button.setAttribute('aria-label',record.result.title.zh+' · '+record.result.title.en);
  const image=record.result.pages[0].illustration;
  const cover=`<img src="${artwork.source(image.url)}" alt="">`;
  button.innerHTML=`<div class="cover-image">${cover}</div><div class="story-number"><span>STORY 0${i+1}</span><span>↗</span></div><strong>${esc(record.result.title.zh)}</strong><small>${esc(record.result.title.en)}</small>`;
  button.addEventListener('click',()=>openBook(record));grid.append(button);
 }
 renderPreparation();
}
function openParentSettings(){
 $('knowledge-points').value=state.knowledge.points.join('\n');$('age').value=state.knowledge.age;
 renderPreparation();openDialog('settings-dialog');
}
async function loadLibrary(){
 try{
  const r=await fetch('/api/library');if(!r.ok)throw Error();state.books=(await r.json()).books;renderLibrary();
  const storedIds=stored('moonlit-ready-shelf',[]),shelf=selectShelf(state.books,Array.isArray(storedIds)?storedIds:[]);
  if(shelf.length)$('story-choices').innerHTML='<div class="empty-shelf"><span aria-hidden="true">☾</span><p>正在打开今晚的故事…</p><small>Opening tonight’s stories…</small></div>';
  await Promise.all(shelf.map(book=>artwork.preload(book)));state.shelf=shelf;
  if(shelf.length)save('moonlit-ready-shelf',shelf.map(book=>book.id));renderCards();return true;
 }
 catch{notice('暂时没有读到保存的故事。 · Saved stories are temporarily unavailable.');return false;}
}
function renderLibrary(){
 $('saved-books').replaceChildren();

 for(const record of state.books){
  const current=parentArtPending.get(record.id)||record,ready=isBookReady(current),painting=parentArtPending.has(record.id)||(current.metadata?.illustration_status==='pending'||current.metadata?.motion_status==='pending');
  const button=document.createElement('button');button.className='saved-book';
  button.innerHTML=esc(record.result.title.zh)+`<small>${esc(record.result.title.en)}</small>`+(ready&&!current.metadata?.motion_status?'<small>让角色动起来 · Prepare character animation</small>':!ready?`<small>${painting?`${current.metadata?.motion_status?`角色动画 ${current.metadata.motion_completed||0}`:`插画 ${current.metadata?.illustration_completed||0}`} / ${current.result.pages.length} · Preparing the book…`:current.metadata?.motion_status==='failed'?'角色动画未完成 · Animation incomplete':current.metadata?.illustration_status==='failed'?'插画未完成 · Illustrations incomplete':'准备画面与角色动画 · Prepare book media'}</small>`:'');
  button.disabled=painting||current.metadata?.illustration_status==='failed'||current.metadata?.motion_status==='failed';
  button.addEventListener('click',()=>ready&&!current.metadata?.motion_status?prepareSavedIllustrations(current):ready?openBook(current):prepareSavedIllustrations(current));$('saved-books').append(button);
 }
 if(!state.books.length)$('saved-books').textContent='还没有保存的故事。 · No saved stories yet.';
}
function parseKnowledge(value){
 const points=value.split(/\r?\n/).map(p=>p.replace(/^\s*(?:[-•]|\d+[.、])\s*/,'').trim()).filter(Boolean);
 if(!points.length||points.length>3||points.some(p=>p.length>320))throw Error('请输入 1–3 个知识点，一行一个，每个最多 320 字。 · Enter 1–3 points, one per line.');
 return points;
}
function canResumePreparation(points,age){
 const prep=state.preparation;
 return prep?.status==='failed'&&prep.completed.some(Boolean)&&prep.age===age&&prep.world===state.world&&JSON.stringify(prep.points)===JSON.stringify(points);
}
function prepareStories(){
 if(state.pending||state.preparation?.status==='running'||parentArtPending.size){notice('故事还在准备中，稍等片刻。 · Stories are still being prepared.');return;}
 let points;try{points=parseKnowledge($('knowledge-points').value);}catch(e){notice(e.message);return;}
 state.knowledge={points,age:$('age').value};save('moonlit-knowledge-settings',state.knowledge);save('moonlit-age',state.knowledge.age);
 if(canResumePreparation(points,state.knowledge.age)){state.preparation.status='running';state.preparation.index=[0,1,2].find(i=>!state.preparation.completed[i])??3;}
 else state.preparation={id:crypto.randomUUID(),points,age:state.knowledge.age,world:state.world,index:0,completed:[],status:'running'};
 persistPreparation();
 closeDialogs();showHome();renderPreparation();startPreparedBook();
}
function startPreparedBook(){
 const prep=state.preparation;if(!prep||prep.status!=='running'||state.pending)return;
 if(prep.index>=3){publishShelf();return;}
 startJob({kind:'book',concept:prep.points[prep.index%prep.points.length],knowledge_points:prep.points,age:prep.age,world:prep.world,preparation_id:prep.id,story_index:prep.index},'prepare');
}
async function publishShelf(){
 const prep=state.preparation;if(!prep||prep.completed.filter(Boolean).length!==3)return;
 if(!prep.completed.every(isBookReady)){failPreparation('插画还未全部完成，故事卡片暂不展示。 · Covers appear only when every illustration is ready.');return;}
 $('generation-title').textContent='插画已画好，正在准备阅读…';$('generation-detail').textContent='Loading every scene before the covers appear.';
 try{await Promise.all(prep.completed.map(book=>artwork.preload(book)));}catch{failPreparation('插画暂时无法载入，准备好的故事已保存。 · Saved illustrations could not load.');return;}
 prep.status='completed';persistPreparation();state.shelf=prep.completed;save('moonlit-ready-shelf',state.shelf.map(b=>b.id));
 await loadLibrary();renderCards();busy(false);
 $('generation-status').hidden=true;
 notice('三个绘本、全部插画和角色动画准备好了，点开就可以读。 · All stories and illustrations are ready.');
}
function failPreparation(message){
 state.pending=null;save('moonlit-immersive-pending',null);
 if(state.preparation?.status==='running'){state.preparation.status='failed';persistPreparation();}
 $('generation-status').hidden=true;busy(false);renderPreparation();notice(message);
}
async function openBook(record,page=0){
 if(!isBookReady(record)){notice('请先由家长准备好全部插画。 · A parent needs to finish preparing the illustrations.');return;}
 try{if(record.result.tree)validateTree(record.result);await artwork.preload(record);}catch{notice('暂时无法载入已保存的完整绘本。 · Could not load the complete book.');return;}
 closeDialogs();stopSpeech();cancelMicrophone();state.version++;state.book=clone(record);state.page=page;state.path=record.result.tree?routeTo(record.result,record.result.pages[page].id).map(id=>record.result.pages.findIndex(p=>p.id===id)):Array.from({length:page+1},(_,i)=>i);state.view='reader';$('experience').classList.add('reading');$('home-view').hidden=true;$('reader-view').hidden=false;$('home-mark').hidden=true;$('back-home').hidden=false;$('reader-heading').hidden=false;$('sound-button').hidden=false;renderPage();
}
function busy(){renderPreparation();}
function goNode(id){const book=state.book.result,index=book.pages.findIndex(page=>page.id===id);if(index<0)return;state.page=index;state.path=routeTo(book,id).map(node=>book.pages.findIndex(page=>page.id===node));renderPage();}
function previousPage(){if(state.path.length>1){state.path.pop();state.page=state.path[state.path.length-1];renderPage();}}
function renderPage(){
 if(!state.book)return;state.version++;stopSpeech();$('scene-bubble').hidden=true;
 const book=state.book.result,page=book.pages[state.page],tree=book.tree,last=tree?!!page.ending:state.page===book.pages.length-1;
 $('book-title').textContent=book.title.zh;$('chapter-label').textContent=last?'故事结束 · THE END':`SCENE ${String(state.path.length).padStart(2,'0')} · ${tree&&!tree.main_path.includes(page.id)?'SIDE PATH':'MAIN STORY'}`;
 $('page-title').textContent=page.title.zh;$('subtitle').textContent=page.text.zh;$('subtitle-en').textContent=page.text.en;$('subtitle-en').hidden=!state.english;
 $('subtitle-panel').classList.remove('expanded');$('text-expand').setAttribute('aria-expanded','false');renderLandscape(page.scene,false,page.illustration,page.motion);
 $('motion-button').hidden=!page.motion;$('motion-button').setAttribute('aria-pressed',String(state.motion));$('motion-button').setAttribute('aria-label',state.motion?'暂停角色动画 Pause animation':'播放角色动画 Play animation');$('motion-button').textContent=state.motion?'Ⅱ':'▷';
 $('hero-hotspot').setAttribute('aria-label',`发现${book.hero_name.zh} Discover ${book.hero_name.en}`);
 $('suggestions').replaceChildren();$('choice-prompt').textContent=tree&&page.interaction?page.interaction.prompt.zh:last?'今晚的冒险到这里，故事有了自己的结局。 · The end of this little adventure.':'';
 if(tree&&page.interaction){for(const choice of page.interaction.choices){const button=document.createElement('button');button.className='suggestion';button.textContent=choice.label.zh;button.dataset.target=choice.target;button.addEventListener('click',()=>goNode(choice.target));$('suggestions').append(button);}}
 $('next-page').innerHTML=last?'<span>结局的小发现</span> ✦':tree&&page.interaction?'<span>选择一条小路</span> ✦':'<span>下一幕</span> →';$('next-page').disabled=!!(tree&&page.interaction);$('previous-page').disabled=state.path.length<2;
 $('page-dots').replaceChildren();state.path.forEach((index,i)=>{const button=document.createElement('button');button.className='page-dot'+(index===state.page?' active':'');button.setAttribute('aria-label',`回到第 ${i+1} 幕 Back to scene ${i+1}`);if(index===state.page)button.setAttribute('aria-current','page');button.addEventListener('click',()=>{state.page=index;state.path=state.path.slice(0,i+1);renderPage();});$('page-dots').append(button);});
 $('branch-note').hidden=true;subtitlePosition.refresh();
}
function nextPage(){if(!state.book)return;const book=state.book.result,page=book.pages[state.page];if(book.tree){if(page.ending)showReveal();else if(!page.interaction)goNode(page.next);}else if(state.page<book.pages.length-1){state.page++;state.path.push(state.page);renderPage();}else showReveal();}
function showReveal(){const r=state.book.result.reveal,ending=state.book.result.pages[state.page].ending;$('reveal-title').textContent=r.concept.zh;$('reveal-content').innerHTML=(ending?`<p class="ending-discovery">${esc(ending.zh)}</p>${state.english?`<p>${esc(ending.en)}</p>`:''}`:'')+`<p>${esc(r.child_explanation.zh)}</p>${state.english?`<p>${esc(r.child_explanation.en)}</p>`:''}<p>${esc(r.everyday_example.zh)}</p><details><summary>给家长的小纸条 · For grown-ups</summary><p>${esc(r.parent_note.zh)}</p>${r.mappings.map(m=>`<p>${esc(m.story.zh)} → ${esc(m.meaning.zh)}</p>`).join('')}<p>${esc(r.boundary.zh)}</p></details>`;openDialog('reveal-dialog');}
function showTree(){
 const book=state.book.result;const tree=book.tree;$('tree-summary').textContent=tree?'六幕主线 · 两条支线 · 三个结局，最长六幕。每一条小路都已准备好。 / Six main scenes, two branches, three endings. Every path is ready.':'这本较早的绘本是一条完整主线。 / This earlier book follows one complete path.';$('tree-map').replaceChildren();
 const groups=tree?[{title:'主线 · Main story',ids:tree.main_path},{title:'从第二幕出发 · Branch A',ids:['a1','a2']},{title:'从第四幕出发 · Branch B',ids:['b1','b2']}]:[{title:'完整故事 · Complete story',ids:book.pages.map((_,i)=>i)}];
 for(const group of groups){const column=document.createElement('div');column.className='tree-column';const heading=document.createElement('h3');heading.textContent=group.title;column.append(heading);for(const id of group.ids){const index=tree?book.pages.findIndex(p=>p.id===id):id,page=book.pages[index],button=document.createElement('button');button.className='tree-node'+(page.ending?' tree-ending':'')+(index===state.page?' current':'');button.dataset.nodeId=String(id);button.innerHTML=`<small>${page.ending?'✦ 结局 · The end':tree&&['a1','b1'].includes(id)?'↳ 支线 · Branch':'↓'}</small><span>${esc(page.title.zh)}</span><small>${esc(page.title.en)}</small>`;button.addEventListener('click',()=>{closeDialogs();if(tree)goNode(id);else{state.page=index;state.path=Array.from({length:index+1},(_,i)=>i);renderPage();}});column.append(button);}$('tree-map').append(column);}
 openDialog('tree-dialog');
}
async function startJob(params,purpose='prepare'){
 if(params.kind!=='book')return;
 if(state.pending){$('generation-status').hidden=false;return;}
 cancelMicrophone();params.request_id=crypto.randomUUID();state.pending={params,purpose,version:state.version,id:null};save('moonlit-immersive-pending',state.pending);busy();
 const preparing=purpose==='prepare';
 $('generation-title').textContent=preparing?`正在准备故事 ${params.story_index+1} / 3…`:'记住你的想法，翻开新的一幕…';
 $('generation-detail').textContent=preparing?'Preparing the whole story, illustrations and character animation before your child chooses.':'The next scene will follow your idea.';$('generation-status').hidden=false;
 try{
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});const job=await r.json();
  if(!r.ok)throw Error(job.error||'Could not start.');state.pending.id=job.id;save('moonlit-immersive-pending',state.pending);pollJob();
 }catch(error){failPreparation(error instanceof TypeError?'连接中断，生成是否开始尚不确定，没有自动重试。 · Connection lost; no automatic retry.':error.message);}
}
async function pollJob(){
 clearTimeout(pollTimer);const pending=state.pending;if(!pending?.id)return;
 try{
  const r=await fetch('/api/jobs/'+pending.id);const job=await r.json();
  if(r.status===404){failPreparation(job.error||'这次生成已不可用。 · Generation unavailable.');return;}
  if(!r.ok)throw Error();if(job.status==='pending'){if(job.phase==='animating'){$('generation-title').textContent=`正在让故事 ${pending.params.story_index+1} / 3 的角色动起来…`;$('generation-detail').textContent=`角色动画 ${job.motion_completed} / ${job.motion_total} · Preparing character animation…`;}else if(job.phase==='illustrating'){$('generation-title').textContent=pending.purpose==='prepare'?`正在绘制故事 ${pending.params.story_index+1} / 3 的插画…`:'正在画出接下来的这一幕…';$('generation-detail').textContent=`插画 ${job.illustration_completed} / ${job.illustration_total} · Painting the story…`;}pollTimer=setTimeout(pollJob,1700);return;}
  if(job.status!=='completed'){failPreparation(job.error||'这次没有得到可用的结果。 · No usable result.');return;}
  if(pending.purpose==='prepare'&&state.preparation?.id===pending.params.preparation_id){
   if(!isBookReady(job)){failPreparation('这本故事的画面或角色动画未全部完成；本组封面暂不展示。 · This book is not fully prepared yet.');await loadLibrary();return;}
   const prep=state.preparation;prep.completed[pending.params.story_index]=job;prep.index=[0,1,2].find(i=>!prep.completed[i])??3;persistPreparation();
   state.pending=null;save('moonlit-immersive-pending',null);busy();
   if(prep.index===3)await publishShelf();else startPreparedBook();
   return;
  }
  state.pending=null;save('moonlit-immersive-pending',null);$('generation-status').hidden=true;busy();await loadLibrary();notice('故事已准备好，可以从封面或故事库打开。 · Your story is ready to read.');
 }catch{pollTimer=setTimeout(pollJob,4000);}
}

function bubble(text){$('scene-bubble').textContent=text;$('scene-bubble').hidden=false;clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>$('scene-bubble').hidden=true,6500);}
async function toggleMic(targetId,buttonId){if(micSession){if(micSession.recorder?.state==='recording')micSession.recorder.stop();return;}if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){notice('这里暂时不能录音，可以输入文字。 · Voice capture is unavailable here.');return;}const version=state.version,button=$(buttonId);const session={version,targetId,buttonId,chunks:[],cancelled:false};micSession=session;try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});session.stream=stream;if(session.cancelled){stream.getTracks().forEach(t=>t.stop());micSession=null;return;}const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);session.recorder=recorder;button.classList.add('recording');button.setAttribute('aria-label','结束录音 Stop recording');notice('正在听，再点一次麦克风结束。 · Tap the microphone again to finish.');recorder.ondataavailable=e=>{if(e.data.size)session.chunks.push(e.data);};recorder.onstop=async()=>{clearTimeout(session.timer);stream.getTracks().forEach(t=>t.stop());button.classList.remove('recording');button.setAttribute('aria-label','语音输入 Voice input');micSession=null;if(session.cancelled||session.version!==state.version)return;const blob=new Blob(session.chunks,{type:recorder.mimeType});if(blob.size>1400000){notice('录音有点长，试着说一个短想法。 · Try a shorter idea.');return;}notice('正在把声音变成文字… · Turning your voice into words…');button.disabled=true;try{const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});const format=recorder.mimeType.includes('mp4')?'mp4':'webm';const r=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio,format})});const result=await r.json();if(!r.ok)throw Error(result.error);if(session.version!==state.version)return;$(targetId).value=result.text;$(targetId).focus();notice('听到的文字放在输入框了，可以改一改再发送。 · Edit the transcript before sending.');}catch(error){notice(error.message||'这次没有听清，可以输入文字。');}finally{button.disabled=false;}};recorder.start();session.timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},20000);}catch{button.classList.remove('recording');micSession=null;notice('没有打开麦克风，可以继续用文字。 · Type your idea instead.');}}
function readAloud(){if(!state.book)return;if(state.speech){stopSpeech();return;}if(!('speechSynthesis'in window)){notice('这里没有系统朗读，仍可阅读字幕。 · System narration unavailable.');return;}const utterance=new SpeechSynthesisUtterance(state.book.result.pages[state.page].text.zh);utterance.lang='zh-CN';utterance.rate=.85;state.speech=true;$('sound-button').setAttribute('aria-pressed','true');utterance.onend=()=>stopSpeech();utterance.onerror=()=>{stopSpeech();notice('系统朗读暂不可用。 · System narration unavailable.');};speechSynthesis.speak(utterance);}
$('make-own').addEventListener('click',openParentSettings);
$('settings-button').addEventListener('click',openParentSettings);
$('world-button').addEventListener('click',()=>openDialog('world-dialog'));
$('back-home').addEventListener('click',showHome);
$('finish-home').addEventListener('click',()=>{closeDialogs();showHome();});
$('notice-close').addEventListener('click',()=>$('notice').hidden=true);
$('hide-generation').addEventListener('click',()=>$('generation-status').hidden=true);
$('sound-button').addEventListener('click',readAloud);
$('motion-button').addEventListener('click',()=>{$('motion').checked=!state.motion;savePreferences();});
$('fullscreen-button').addEventListener('click',async()=>{if(!document.fullscreenEnabled){notice('场景已铺满窗口；这个浏览器暂不支持原生全屏。 · The world fills this window. Native full screen is unavailable here.');return;}try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notice('当前浏览器不支持原生全屏，场景已铺满窗口。 · The world fills this browser window.');}});
document.addEventListener('fullscreenchange',()=>{const active=!!document.fullscreenElement;$('fullscreen-button').setAttribute('aria-pressed',String(active));$('fullscreen-button').setAttribute('aria-label',active?'退出全屏 Exit full screen':'全屏 Full screen');});
$('library-button').addEventListener('click',()=>openDialog('library-dialog'));
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
for(const dialog of document.querySelectorAll('dialog')){dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();});dialog.addEventListener('close',cancelMicrophone);}
for(const button of document.querySelectorAll('[data-point]'))button.addEventListener('click',()=>{
 const current=$('knowledge-points').value.trim(),point=button.dataset.point;
 if(current.split('\n').includes(point))return;
 if(current.split('\n').filter(Boolean).length>=3){notice('这一组先准备最多三个知识点。 · Up to three points per set.');return;}
 $('knowledge-points').value=current?current+'\n'+point:point;$('knowledge-points').focus();
});
function savePreferences(){state.english=$('bilingual').checked;state.motion=$('motion').checked;save('moonlit-bilingual',state.english);save('moonlit-motion',state.motion);document.body.classList.toggle('motion-paused',!state.motion);if(state.view==='reader')renderPage();}
$('bilingual').addEventListener('change',savePreferences);$('motion').addEventListener('change',savePreferences);
$('settings-form').addEventListener('submit',event=>{event.preventDefault();prepareStories();});
$('knowledge-points').addEventListener('input',renderPreparation);$('age').addEventListener('change',renderPreparation);
$('parent-mic').addEventListener('click',()=>toggleMic('knowledge-points','parent-mic'));
$('previous-page').addEventListener('click',previousPage);
$('next-page').addEventListener('click',nextPage);
$('text-expand').addEventListener('click',()=>{const panel=document.querySelector('.subtitle-panel');panel.classList.toggle('expanded');$('text-expand').setAttribute('aria-expanded',String(panel.classList.contains('expanded')));});
$('hero-hotspot').addEventListener('click',()=>bubble(state.book.result.pages[state.page].scene.description.zh));
$('prop-hotspot').addEventListener('click',()=>bubble('看看这一幕里的物件，它们和角色的行动有什么关系？ · What do you notice in this scene?'));
$('tree-button').addEventListener('click',showTree);
$('restart-book').addEventListener('click',()=>{state.page=0;state.path=[0];renderPage();});
$('export-book').addEventListener('click',async()=>{const record=state.book;if(!record)return;$('export-book').disabled=true;$('export-book').textContent='正在打包… · Exporting…';try{await downloadBook(record,artwork,atmosphereArt.toString());notice('完整绘本已导出，所有分支、结局、插画和角色动画都在一个 HTML 文件里，离线可阅读。 · Your whole book is ready to read offline.');}catch(error){console.warn('Book export failed',error.name,error.message);notice('暂时无法导出，请稍后再试。 · Could not export this book.');}finally{$('export-book').disabled=false;$('export-book').innerHTML='导出绘本 <span>Export book ↓</span>';}});
const savedSubtitle=stored('moonlit-subtitle-position',null);
const subtitlePosition=installSubtitles($('subtitle-panel'),$('subtitle-drag'),$('subtitle-reset'),position=>save('moonlit-subtitle-position',position),savedSubtitle&&[savedSubtitle.x,savedSubtitle.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)?savedSubtitle:null);
document.addEventListener('keydown',event=>{if(state.view!=='reader'||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName))return;if(event.key==='ArrowRight'){event.preventDefault();nextPage();}if(event.key==='ArrowLeft'){event.preventDefault();previousPage();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSpeech();cancelMicrophone();}});
async function init(){
 $('knowledge-points').value=state.knowledge.points.join('\n');$('age').value=state.knowledge.age;$('bilingual').checked=state.english;$('motion').checked=state.motion;document.body.classList.toggle('motion-paused',!state.motion);
 for(const [key,world]of Object.entries(WORLDS)){
  const button=document.createElement('button');button.className='world-option'+(key===state.world?' selected':'');
  button.innerHTML=`${coverArt(key,key==='forest'?'fox':key==='space'?'rabbit':'bear',key==='forest'?'lantern':key==='space'?'star':'boat')}<span>${world.zh}</span><small>${world.en}</small>`;
  button.addEventListener('click',()=>{state.world=key;save('moonlit-world',key);for(const other of $('world-options').children)other.classList.remove('selected');button.classList.add('selected');closeDialogs();showHome();});$('world-options').append(button);
 }
 showHome();renderCards();await loadLibrary();
 let pending=stored('moonlit-immersive-pending',null);
 if(pending?.params.kind==='turn'){pending=null;save('moonlit-immersive-pending',null);}
 if(pending?.id){state.pending={...pending,version:-1};busy();$('generation-status').hidden=false;$('generation-title').textContent=pending.purpose==='prepare'?`继续准备故事 ${pending.params.story_index+1} / 3…`:'继续等候刚才的故事…';$('generation-detail').textContent=pending.purpose==='prepare'?'Preparing the whole story, illustrations and character animation before your child chooses.':'The next scene will follow your idea.';pollJob();}
 else if(pending){failPreparation('上次连接中断，没有自动重复生成。可先查看已保存的故事。 · No automatic retry after a lost connection.');}
 else if(state.preparation?.status==='running'){startPreparedBook();}
}
init();
