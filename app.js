'use strict';
const DB_NAME = 'lecture-ai-ipad-v1';
const STORE = 'lectures';
const $ = id => document.getElementById(id);
const state = {lectures:[],currentId:null,playerUrl:null,sessionMedia:new Map(),query:'',filter:'',activeTab:'transcript',transcribing:false};
const stopWords = new Set('это тот тому чтобы который которая которые когда тогда также еще уже было были будет есть или как для при под над между нас вас мы вы они она оно его ее их здесь там если потом после перед очень просто можно нужно надо такой такие того этом этой этим всё все весь через только именно примерно потому поэтому либо где куда откуда что чем про между однако например вопрос ответ вчера сегодня завтра лекция преподаватель тема мне тебе себя свою свои ваших ваших этот этого эту этих хотя тоже даже сейчас сюда туда были бы нет да же из со во к не на в и а но у о с по от до за об без от их он она они мы вы я ты к'.split(/\s+/));
const synonymSets = [['отопление','батареи','тепло','радиаторы','обогрев'],['стоимость','цена','деньги','расходы'],['торговля','экспорт','импорт','рынок'],['налоги','налог','налогообложение'],['договор','контракт','соглашение']];
function escapeHtml(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtDate(t){try{return new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});}catch{return ''}}
function timeLabel(n){n=Math.max(0,Math.floor(n || 0));return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor((n%3600)/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function toast(msg){const e=$('toast'); e.textContent=msg;e.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.add('hidden'),4600)}
function normalize(s){return String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim()}
function tokens(s){return normalize(s).split(' ').filter(w=>w.length>=3&&!stopWords.has(w))}
function wordRoot(w){return w.length>6?w.slice(0,Math.max(4,w.length-2)):w;}
function similarity(a,b){const A=new Set(tokens(a).map(wordRoot));const B=new Set(tokens(b).map(wordRoot));let n=0;for(const x of A){for(const y of B){if(x===y || (x.length>4 && y.length>4 && (x.startsWith(y)||y.startsWith(x)))){n+=1;break}}}let bonus=0;const an=normalize(a),bn=normalize(b);for(const set of synonymSets){if(set.some(w=>an.includes(wordRoot(w))) && set.some(w=>bn.includes(wordRoot(w)))) bonus+=1;}return n+bonus;}
function parseSeconds(raw){const m=raw.replace(',','.').trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?/);if(!m)return null;const hours=Number(m[1]||0),mins=Number(m[2]),secs=Number(m[3]),ms=Number('0.'+(m[4]||'0'));return hours*3600+mins*60+secs+ms;}
function parseTranscript(filename,text){const src=String(text||'').replace(/\r\n?/g,'\n').replace(/^\ufeff/,'');const ext=(filename||'').toLowerCase().split('.').pop();if(ext==='srt'||ext==='vtt'||src.includes('-->')){const lines=src.replace(/^WEBVTT[^\n]*\n/,'').split('\n');let cues=[];let cur=null;function flush(){if(cur&&cur.text.trim()){cur.text=cur.text.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();if(cur.text)cues.push(cur);}cur=null;}for(const line of lines){if(line.includes('-->')){flush();const pieces=line.split('-->');const at=parseSeconds(pieces[0]),end=parseSeconds(pieces[1]);if(at!==null)cur={start:at,end:end??at,text:''};}else if(cur&&line.trim()){cur.text+=(cur.text?' ':'')+line.trim();}else if(cur&&!line.trim())flush();}flush();if(cues.length){return {transcript:cues.map(c=>c.text).join('\n'),cues,srt:src};}}
return {transcript:src.trim(),cues:[],srt:''};}
function sourceSentences(item){if(item.cues&&item.cues.length){let out=[],buf='',start=0;for(const c of item.cues){if(!buf)start=c.start;buf+=(buf?' ':'')+c.text;if(/[.!?…]$/.test(c.text)||buf.length>210){out.push({text:buf.trim(),time:start});buf='';}}if(buf)out.push({text:buf.trim(),time:start});return out.filter(x=>x.text.length>8);}return String(item.transcript||'').split(/(?<=[.!?…])\s+|\n+/).map(x=>x.trim()).filter(x=>x.length>8).map(text=>({text,time:null}));}
function generateQuotes(item){const sentences=sourceSentences(item);if(!sentences.length)return [];const freq=new Map();for(const s of sentences){for(const w of tokens(s.text).map(wordRoot)){freq.set(w,(freq.get(w)||0)+1);}}
const sorted=sentences.map((s,i)=>{const ws=tokens(s.text).map(wordRoot);let score=0;for(const w of new Set(ws)){score+=Math.min(3,freq.get(w)||0)}score=score/(Math.sqrt(Math.max(4,ws.length)));if(s.text.length<30)score*=.7;if(s.text.length>430)score*=.75;return {...s,i,score};}).sort((a,b)=>b.score-a.score).slice(0,Math.min(7,Math.max(3,Math.ceil(sentences.length*.23))));return sorted.sort((a,b)=>a.i-b.i).map(({text,time})=>({text,time}));}
// Version 0.3: extractive notes grouped by chronological topics, never fabricate facts.
// The generative beta mode is opt-in and implemented separately.
const noteTopicRules=[
  [/пирамид|сфинкс|зодч|каменн.*стро|гробниц/,'Пирамиды и строительство'],
  [/клеопат|цезар|август|римск|римом|римлян/,'Египет и Рим'],
  [/фараон|царств|двойн.*корон|верхн.*египт|нижн.*египт/,'Власть фараонов и объединение Египта'],
  [/ниль|река|берег|орошен|поселен|деревн/,'Река и первые поселения'],
  [/импорт|экспорт|внешн.*торгов|международн.*торгов/,'Международная торговля'],
  [/пошлин|таможн|тариф|квот/,'Таможенное регулирование'],
  [/валют|курс.*рубл|обменн.*курс/,'Валютные курсы'],
  [/спрос|предложен|равновес|конкуренц/,'Спрос, предложение и рынок'],
  [/налог|акциз|ндс/,'Налоги'],
  [/войн|сражен|армия|битв/,'Военные события'],
  [/договор|соглашен|переговор/,'Договорённости и соглашения'],
  [/климат|температур|погод|эколог/,'Климат и окружающая среда'],
  [/научн|исследован|эксперимент|гипотез/,'Исследования и открытия'],
  [/государств|правител|закон|политик/,'Государство и управление'],
  [/цивилизац|культур|традиц|общество/,'Общество и культура'],
  [/экономик|производств|ресурс|доход|прибыл/,'Экономика и производство']
];
function splitCleanSentences(text){
  const raw=String(text||'').replace(/\s+/g,' ').trim();
  if(!raw)return [];
  const parts=raw.match(/[^.!?…]+(?:[.!?…]+|$)/g)||[raw];
  return parts.map(x=>x.trim().replace(/^[,;:\s–—-]+/,'')).filter(x=>x.length>=32);
}
function topicTitle(text,index){
  const norm=normalize(text), results=[];
  for(const [rx,label] of noteTopicRules){const m=norm.match(new RegExp(rx.source,'giu'));if(m&&m.length)results.push({label,score:m.length});}
  results.sort((a,b)=>b.score-a.score);
  if(results[0]&&results[0].score>=2)return results[0].label;
  const freq=new Map(), original=new Map();
  for(const w of String(text).match(/[А-Яа-яЁёA-Za-z]{5,}/g)||[]){const k=wordRoot(normalize(w));if(stopWords.has(normalize(w))||stopWords.has(k)||k.length<4)continue;freq.set(k,(freq.get(k)||0)+1);if(!original.has(k))original.set(k,w.toLocaleLowerCase('ru-RU'));}
  const terms=[...freq].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([key])=>original.get(key));
  return terms.length?'Темы: '+terms.join(' · '):'Основные положения';
}
function noteCandidates(entries){
  const all=[];
  for(const entry of entries){
    const pieces=splitCleanSentences(entry.text);
    if(!pieces.length&&entry.text.trim().length>=18)pieces.push(entry.text.trim());
    for(const text of pieces){
      if(text.length>310){
        for(const m of text.match(/.{1,230}(?:\s|$)/g)||[text]){
          const part=m.trim();if(part.length>40)all.push({text:part,time:entry.time});
        }
      }else all.push({text,time:entry.time});
    }
  }
  return all;
}
function choosePoints(entries,limit=4){
  const candidates=noteCandidates(entries);
  if(!candidates.length)return [];
  const freq=new Map();
  for(const c of candidates){for(const w of new Set(tokens(c.text).map(wordRoot)))freq.set(w,(freq.get(w)||0)+1);}
  const scored=candidates.map((c,i)=>{
    const words=[...new Set(tokens(c.text).map(wordRoot))];
    let score=words.reduce((sum,w)=>sum+Math.min(4,freq.get(w)||0),0)/Math.sqrt(Math.max(3,words.length));
    if(/\b(?:потому что|означает|называется|привело|в результате|поэтому|сначала|впоследствии|впервые|происходило)\b/i.test(c.text))score+=1.4;
    if(c.text.length<45)score*=.55;
    if(c.text.length>260)score*=.75;
    if(/^(?:ну|так|да|вот|а ещё|и вот|слушайте|кстати|это самое)\b/i.test(c.text))score*=.80;
    return {...c,score,i};
  });
  // Diversify positions, keep the selected statements in original chronological order.
  const selected=[];
  for(const c of scored.sort((a,b)=>b.score-a.score)){
    if(selected.some(v=>similarity(v.text,c.text)>Math.min(5,Math.ceil(tokens(c.text).length*.65))))continue;
    if(selected.some(v=>Math.abs(v.i-c.i)<=1)&&selected.length>=2)continue;
    selected.push(c);if(selected.length===limit)break;
  }
  return selected.sort((a,b)=>a.i-b.i).map(({text,time})=>({text,time}));
}
function generateStudyNotes(item){
  const source=(item.cues?.length?item.cues.map(c=>({text:c.text,time:c.start})):sourceSentences(item));
  if(!source.length)return {version:3,overview:[],sections:[],numbers:[]};
  const total=source.length;
  const numberOfSections=total<=4?1:Math.min(8,Math.max(2,Math.ceil(total/7)));
  const sections=[];
  for(let s=0;s<numberOfSections;s++){
    const start=Math.floor(s*total/numberOfSections),end=Math.floor((s+1)*total/numberOfSections);
    const entries=source.slice(start,end), text=entries.map(e=>e.text).join(' ');
    const points=choosePoints(entries, Math.min(4,Math.max(2,Math.ceil(entries.length*.5))));
    if(!points.length)continue;
    const title=topicTitle(text,s);
    const prev=sections[sections.length-1];
    if(prev&&prev.title===title){prev.entries.push(...entries);prev.points=choosePoints(prev.entries,4);}
    else sections.push({title,time:entries[0].time??null,points,entries:[...entries]});
  }
  // Do not persist internal source entries; keep only finished notes.
  for(const section of sections)delete section.entries;
  const overview=sections.map(s=>s.title).filter((v,i,a)=>a.indexOf(v)===i).slice(0,7);
  const numbers=[];
  for(const c of source){
    const matches=splitCleanSentences(c.text).filter(x=>/\b\d{2,4}\b|\b\d+\s*(?:года?|лет|век|тысяч|миллион)/iu.test(x));
    for(const text of matches){if(text.length>260||text.length<30)continue;if(!numbers.some(x=>normalize(x.text)===normalize(text)))numbers.push({text,time:c.time??null});if(numbers.length>=5)break;}
    if(numbers.length>=5)break;
  }
  return {version:3,overview,sections,numbers};
}
function studyNotesText(item){
  const notes=item.studyNotes?.version===3?item.studyNotes:generateStudyNotes(item);
  const lines=['О ЧЁМ ЛЕКЦИЯ',...notes.overview.map(v=>'• '+v),''];
  for(const section of notes.sections){lines.push(section.title);for(const p of section.points)lines.push('• '+(p.time==null?'':'['+timeLabel(p.time)+'] ')+p.text);lines.push('');}
  if(notes.numbers.length){lines.push('ЧИСЛА И ДАТЫ (ПРОВЕРИТЬ ПО ВИДЕО)');for(const p of notes.numbers)lines.push('• '+(p.time==null?'':'['+timeLabel(p.time)+'] ')+p.text);}
  if(item.aiSummary)lines.unshift('СВЯЗНЫЙ ИИ-ПЕРЕСКАЗ (ПРОВЕРЬ ПО РАСШИФРОВКЕ)\n'+item.aiSummary+'\n');
  return lines.join('\n');
}
function addTimeButton(container,time){if(time===null||time===undefined)return;const b=document.createElement('button');b.className='time-link';b.textContent=timeLabel(time);b.title='Перейти к моменту видео';b.onclick=()=>seekTo(time);container.append(b);}
function locateAnswer(item,q){const src=sourceSentences(item);const matches=src.map(x=>({...x,score:similarity(q,x.text)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);return matches;}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
let db=null;
async function storeItem(item){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Недостаточно памяти'));});}
async function deleteItem(id){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function loadItems(){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
function setView(which){$('libraryView').classList.toggle('hidden',which!=='library');$('detailView').classList.toggle('hidden',which!=='detail');$('navLibrary').classList.toggle('active',which==='library');window.scrollTo({top:0,behavior:'instant'});}
function getCurrent(){return state.lectures.find(r=>r.id===state.currentId);}
function renderLibrary(){const list=state.lectures.slice().sort((a,b)=>b.createdAt-a.createdAt);const subs=[...new Set(list.map(l=>(l.subject||'Без предмета').trim()))].sort((a,b)=>a.localeCompare(b,'ru'));const filter=$('filterSubject');const prev=state.filter;filter.replaceChildren(new Option('Все предметы',''));subs.forEach(s=>filter.add(new Option(s,s)));filter.value=prev;let found=list.filter(l=>{if(state.filter&&(l.subject||'Без предмета')!==state.filter)return false;if(!state.query)return true;return normalize([l.title,l.subject,l.transcript,l.summary?.map(x=>x.text).join(' '),l.aiSummary,l.studyNotes?.sections?.map(s=>s.title+' '+s.points.map(p=>p.text).join(' ')).join(' ')].join(' ')).includes(normalize(state.query));});$('countLectures').textContent=String(list.length);$('countText').textContent=String(list.filter(x=>x.transcript).length);$('navCount').textContent=String(list.length);$('resultCount').textContent=found.length?`${found.length} записей`:'';$('emptyState').classList.toggle('hidden',list.length!==0||state.query!==''||state.filter!=='');const target=$('lectureList');target.replaceChildren();for(const l of found){const card=document.createElement('button');card.type='button';card.className='lecture-card';card.innerHTML=`<div class="thumb ${l.demo?'demo':l.mediaType?.startsWith('audio')?'has-audio':''}">${l.mediaType?.startsWith('audio')?'♫':'▶'}</div><div class="card-content"><span class="card-subject">${escapeHtml(l.subject||'Без предмета')}</span><h3>${escapeHtml(l.title)}</h3><div class="card-foot"><span>${escapeHtml(fmtDate(l.createdAt))}</span><span>${l.transcript?'▤ Есть текст':'○ Без текста'}</span></div></div>`;card.addEventListener('click',()=>openLecture(l.id));target.append(card);}if(!found.length&&list.length&&!(state.query===''&&state.filter==='')){const div=document.createElement('p');div.className='hint';div.textContent='По этому запросу ничего не найдено.';target.append(div);}}
function releasePlayer(){if(state.playerUrl){URL.revokeObjectURL(state.playerUrl);state.playerUrl=null;}}
function renderMedia(item){releasePlayer();const frame=$('playerFrame');frame.replaceChildren();const media=item.media||state.sessionMedia.get(item.id);if(!media){const div=document.createElement('div');div.className='no-media';div.innerHTML='<span>▶</span><p>Видеофайл не сохранён. Прикрепите его, чтобы воспроизвести.</p>';frame.append(div);return;}const video=document.createElement(media.type.startsWith('audio/')?'audio':'video');video.controls=true;video.playsInline=true;video.preload='metadata';state.playerUrl=URL.createObjectURL(media);video.src=state.playerUrl;video.id='lecturePlayer';video.setAttribute('aria-label','Запись лекции');frame.append(video);}
function seekTo(time){const v=$('lecturePlayer');if(!v){toast('У записи пока нет видеофайла');return;}v.currentTime=Math.max(0,time);v.play().catch(()=>{});v.scrollIntoView({block:'center',behavior:'smooth'});}
function renderTranscript(item){const pane=$('transcriptBody');pane.replaceChildren();if(!item.transcript){const p=document.createElement('p');p.className='hint';p.textContent='Здесь появится текст. Нажми «Расшифровать видео» выше или добавь готовый TXT, SRT либо VTT.';pane.append(p);return;}if(item.cues?.length){for(const cue of item.cues.slice(0,2500)){const box=document.createElement('div');box.className='cue';const b=document.createElement('button');b.textContent=timeLabel(cue.start);b.title='Перейти к моменту записи';b.addEventListener('click',()=>seekTo(cue.start));const p=document.createElement('p');p.textContent=cue.text;box.append(b,p);pane.append(box);}}else{const p=document.createElement('div');p.className='plain-transcript';p.textContent=item.transcript;pane.append(p);}}
function renderSummary(item){
  const pane=$('summaryBody');pane.replaceChildren();
  if(!item.transcript){pane.textContent='Сначала распознай речь или прикрепи текст лекции.';return;}
  const notes=item.studyNotes?.version===3?item.studyNotes:generateStudyNotes(item);
  if(item.aiSummary){
    const wrap=document.createElement('section');wrap.className='ai-summary';
    const h=document.createElement('h4');h.textContent='Связный ИИ-конспект · эксперимент';
    const p=document.createElement('div');p.className='ai-summary-text';p.textContent=item.aiSummary;
    const note=document.createElement('p');note.className='hint';note.textContent='Сгенерировано небольшой локальной моделью. Возможны ошибки и неверные имена — сверяй с расшифровкой ниже.';
    wrap.append(h,p,note);pane.append(wrap);
  }
  const intro=document.createElement('section');intro.className='notes-overview';
  const h=document.createElement('h4');h.textContent='О чём занятие';intro.append(h);
  const p=document.createElement('p');p.textContent=notes.overview.length?notes.overview.join(' · '):'Ключевые темы не определены';intro.append(p);pane.append(intro);
  for(let i=0;i<notes.sections.length;i++){
    const sec=notes.sections[i],section=document.createElement('section');section.className='study-section';
    const heading=document.createElement('div');heading.className='study-section-head';
    const title=document.createElement('h4');title.textContent=`${i+1}. ${sec.title}`;heading.append(title);addTimeButton(heading,sec.time);section.append(heading);
    const list=document.createElement('ul');list.className='study-points';
    for(const point of sec.points){const li=document.createElement('li');li.append(document.createTextNode(point.text));addTimeButton(li,point.time);list.append(li);}
    section.append(list);pane.append(section);
  }
  if(notes.numbers?.length){
    const section=document.createElement('section');section.className='study-section';const h=document.createElement('h4');h.textContent='Числа и даты из записи';section.append(h);
    const list=document.createElement('ul');list.className='study-points';for(const point of notes.numbers){const li=document.createElement('li');li.append(document.createTextNode(point.text));addTimeButton(li,point.time);list.append(li);}section.append(list);pane.append(section);
  }
}
function setTab(tab){state.activeTab=tab;for(const b of document.querySelectorAll('.tab'))b.classList.toggle('active',b.dataset.tab===tab);for(const n of ['transcript','summary','ask'])$(n+'Pane').classList.toggle('hidden',n!==tab);}
function openLecture(id){const item=state.lectures.find(x=>x.id===id);if(!item)return;state.currentId=id;if(!state.transcribing){$('asrStatus').textContent='Модель скачивается бесплатно при первом запуске. Для первого теста рекомендуем 1–2 минуты.';$('asrProgress').classList.add('hidden');}$('detailTitle').textContent=item.title;$('detailDate').textContent=`${fmtDate(item.createdAt)} · ${item.subject||'Без предмета'}`;$('editTitle').value=item.title;$('editSubject').value=item.subject||'';$('statusMedia').textContent=item.media?'Видео сохранено':state.sessionMedia.has(id)?'Видео доступно до закрытия':'Нет сохранённого видео';$('statusTranscript').textContent=item.transcript?'Текст занятия загружен':'Нет расшифровки';$('answerBody').replaceChildren();renderMedia(item);renderTranscript(item);renderSummary(item);setTab('transcript');setView('detail');}
async function updateCurrent(patch){const item=getCurrent();if(!item)return;const updated={...item,...patch};try{await storeItem(updated);state.lectures=state.lectures.map(x=>x.id===item.id?updated:x);renderLibrary();openLecture(updated.id);return true;}catch(e){console.error(e);toast('Не удалось сохранить изменения. Проверь свободную память.');return false;}}
function openImport(){const dlg=$('importDialog');$('importError').textContent='';$('importForm').reset();dlg.showModal();}
async function importLecture(evt){evt.preventDefault();const name=$('newTitle').value.trim();const subject=$('newSubject').value.trim();if(!name){$('importError').textContent='Введи название занятия';return;}const file=$('newMedia').files[0]||null;const textFile=$('newText').files[0]||null;let parsed={transcript:'',cues:[],srt:''};if(textFile){try{if(textFile.size>10*1024*1024){$('importError').textContent='Текст слишком большой (максимум 10 МБ).';return;}parsed=parseTranscript(textFile.name,await textFile.text());}catch{$('importError').textContent='Не удалось прочитать текстовый файл.';return;}}
const item={id:crypto.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.floor(Math.random()*10000),title:name,subject,createdAt:Date.now(),media:file,mediaType:file?.type||'',mediaName:file?.name||'',transcript:parsed.transcript,cues:parsed.cues,srt:parsed.srt,summary:[],demo:false};$('submitImport').disabled=true;try{let stored=true;try{await storeItem(item)}catch(err){if(file){state.sessionMedia.set(item.id,file);item.media=null;stored=false;await storeItem(item);}else throw err;}state.lectures.unshift(item);$('importDialog').close();renderLibrary();openLecture(item.id);toast(stored?'Лекция добавлена на это устройство':'Лекция добавлена. Видео слишком большое для хранения: оно доступно только до закрытия страницы.');}catch(err){$('importError').textContent='Не удалось сохранить лекцию: '+(err?.message||'ошибка браузера');}finally{$('submitImport').disabled=false;}}
async function attachTranscript(evt){const f=evt.target.files?.[0];if(!f)return;const t=await f.text();const p=parseTranscript(f.name,t);await updateCurrent({...p,summary:[],studyNotes:null,aiSummary:''});toast('Расшифровка добавлена');evt.target.value='';}
async function attachMedia(evt){const f=evt.target.files?.[0];if(!f)return;const item=getCurrent();if(!item)return;const saved=await updateCurrent({media:f,mediaType:f.type,mediaName:f.name});if(!saved){state.sessionMedia.set(item.id,f);openLecture(item.id);}evt.target.value='';toast(saved?'Видео прикреплено':'Видео доступно только на время сеанса');}
function exportText(){const item=getCurrent();if(!item)return;const title=item.title||'Lecture AI';const lines=[title,`Предмет: ${item.subject||'Без предмета'}`,`Дата: ${fmtDate(item.createdAt)}`,'','КОНСПЕКТ',studyNotesText(item),'','РАСШИФРОВКА',item.transcript||'Расшифровка не добавлена'];const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=title.replace(/[\\/:*?"<>|]/g,'_').slice(0,70)+'.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function sampleLecture(){return {id:'demo-'+Date.now(),title:'Демо: международная торговля',subject:'МЭО',createdAt:Date.now(),media:null,mediaType:'',mediaName:'',transcript:'Международная торговля позволяет странам специализироваться на производстве товаров и услуг. Экспорт — это продажа товаров и услуг за рубеж. Импорт — это приобретение товаров и услуг из других стран. На объём торговли влияют транспортные расходы, валютные курсы, пошлины и спрос. Если мировая цена выше внутренней равновесной цены, производители могут увеличить предложение на экспорт. Если мировая цена ниже внутренней, потребители могут увеличить закупки импорта. Эти утверждения относятся к упрощённой модели конкурентного рынка.',cues:[],srt:'',summary:[],demo:true};}
function asrProgress(message,percent=null){$('asrStatus').textContent=message;const el=$('asrProgress');if(percent===null){el.classList.add('hidden');}else{el.classList.remove('hidden');el.value=Math.max(0,Math.min(100,percent));}}
async function transcribeCurrentVideo(){
  if(state.transcribing)return;
  const lecture=getCurrent();if(!lecture)return;
  const media=lecture.media||state.sessionMedia.get(lecture.id);
  if(!media){toast('Сначала прикрепи видео или аудио к лекции');return;}
  const button=$('transcribeLocal');state.transcribing=true;button.disabled=true;
  const originalId=lecture.id;
  try{
    asrProgress('Подключаем локальное распознавание…',0);
    const {transcribeFileLocally}=await import('./localTranscribe.mjs');
    const result=await transcribeFileLocally({file:media,language:$('asrLanguage').value,onProgress:(msg,pct)=>{asrProgress(msg,pct);}});
    if(!result.cues.length||!result.text.trim())throw new Error('Речь не распознана. Проверь, есть ли звук в видео.');
    const updated={...lecture,transcript:result.text,cues:result.cues,srt:'',summary:[],studyNotes:null,aiSummary:''};
    updated.studyNotes=generateStudyNotes(updated);
    try{await storeItem(updated)}catch(e){
      // A large embedded video may make the DB transaction fail. Keep the text even when media cannot be persisted.
      const lightweight={...updated,media:null};await storeItem(lightweight);
      state.sessionMedia.set(lecture.id,media);updated.media=null;
    }
    state.lectures=state.lectures.map(x=>x.id===originalId?updated:x);
    renderLibrary();
    if(state.currentId===originalId){renderTranscript(updated);renderSummary(updated);$('statusTranscript').textContent='Текст распознан на этом устройстве';setTab('transcript');}
    asrProgress('Готово! Текст и конспект сохранены в библиотеке.',100);
    toast('Расшифровка и тематический конспект созданы');
  }catch(e){console.error('Local ASR error:',e);asrProgress('Не получилось распознать: '+(e?.message||String(e)),null);toast('Локальная расшифровка не удалась. Исходное видео осталось на месте.');}
  finally{state.transcribing=false;button.disabled=false;}
}
async function makeAiSummary(){
  const item=getCurrent();if(!item?.transcript)return toast('Сначала нужна расшифровка');
  if(state.transcribing)return toast('Сначала дождись окончания распознавания');
  const b=$('makeAiSummary'),stat=$('aiSummaryStatus');b.disabled=true;
  stat.textContent='Проверяем поддержку локальной языковой модели…';
  try{
    const mod=await import('./localSummarize.mjs?v=032');
    const text=await mod.createCoherentNotes({item,onProgress:msg=>{stat.textContent=msg;}});
    if(!text||text.length<100)throw new Error('Модель вернула слишком короткий ответ.');
    await updateCurrent({aiSummary:text});setTab('summary');stat.textContent='Готово. Связный конспект сохранён на этом iPad.';
    toast('ИИ-конспект создан — проверь неточности по записи');
  }catch(e){console.error('Local AI notes:',e);stat.textContent='Связный ИИ-конспект недоступен: '+(e?.message||String(e))+'. Тематический конспект и запись сохранены.';toast('Не удалось запустить локальную языковую модель');}
  finally{b.disabled=false;}
}
function bind(){ $('transcribeLocal').onclick=transcribeCurrentVideo; $('navLibrary').onclick=$('backLibrary').onclick=()=>{releasePlayer();setView('library');};$('navImport').onclick=$('addLecture').onclick=$('emptyAdd').onclick=openImport;$('closeImport').onclick=$('cancelImport').onclick=()=>$('importDialog').close();$('importForm').addEventListener('submit',importLecture);$('search').addEventListener('input',e=>{state.query=e.target.value;renderLibrary()});$('filterSubject').addEventListener('change',e=>{state.filter=e.target.value;renderLibrary()});$('createDemo').onclick=async()=>{const item=sampleLecture();await storeItem(item);state.lectures.push(item);renderLibrary();openLecture(item.id);toast('Создана демонстрационная лекция');};document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>setTab(btn.dataset.tab)));$('saveDetails').onclick=()=>{const title=$('editTitle').value.trim();if(!title)return toast('Укажи название лекции');updateCurrent({title,subject:$('editSubject').value.trim()}).then(()=>toast('Название и предмет сохранены'));};$('deleteLecture').onclick=async()=>{const item=getCurrent();if(!item||!confirm('Удалить эту лекцию и её текст с устройства?'))return;await deleteItem(item.id);state.lectures=state.lectures.filter(x=>x.id!==item.id);state.sessionMedia.delete(item.id);releasePlayer();setView('library');renderLibrary();toast('Лекция удалена');};$('attachTranscript').onchange=attachTranscript;$('attachMedia').onchange=attachMedia;$('attachMore').onclick=()=>$('attachMedia').click();$('exportTxt').onclick=exportText;$('makeSummary').onclick=async()=>{const item=getCurrent();if(!item||!item.transcript)return toast('Нужен текст лекции');const studyNotes=generateStudyNotes(item);await updateCurrent({studyNotes});setTab('summary');toast('Тематический конспект создан');};$('makeAiSummary').onclick=makeAiSummary;$('askButton').onclick=()=>{const item=getCurrent(),q=$('question').value.trim(),box=$('answerBody');box.replaceChildren();if(!item||!item.transcript){box.textContent='Сначала добавь текст лекции.';return;}if(!q){box.textContent='Напиши вопрос.';return;}const hits=locateAnswer(item,q);const label=document.createElement('p');label.className='answer-intro';label.textContent=hits.length?'Найдены фрагменты текста, связанные с вопросом:':'В расшифровке не нашлось текстовых совпадений. Попробуй другие слова.';box.append(label);for(const x of hits){const div=document.createElement('div');div.className='evidence';if(x.time!==null&&x.time!==undefined){const b=document.createElement('button');b.textContent=timeLabel(x.time);b.addEventListener('click',()=>seekTo(x.time));div.append(b);}div.append(document.createTextNode(x.text));box.append(div);}};$('question').addEventListener('keydown',e=>{if(e.key==='Enter')$('askButton').click()});}
async function init(){bind();try{db=await openDB();state.lectures=await loadItems();renderLibrary();if(navigator.storage?.persisted){navigator.storage.persisted().then(p=>{if(!p)console.info('Storage may be cleared by browser under pressure')}).catch(()=>{});}if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(err=>console.info('SW not registered',err));}catch(err){console.error(err);$('emptyState').querySelector('p').textContent='Браузер заблокировал локальное хранилище. Открой сайт в обычном Safari (не приватный режим) и попробуй снова.';toast('Локальное хранилище недоступно.');}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
