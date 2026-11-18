// Lecture AI 0.3 / experimental browser-only note synthesis.
// This module is loaded only after a user explicitly clicks the beta button.
// Only library/model files are downloaded; lecture text is passed to a local WebGPU model.
let cachedEngine = null;
const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const status = (callback,text) => { if (typeof callback === 'function') callback(text); };

async function getEngine(onProgress) {
  if (cachedEngine) return cachedEngine;
  if (!navigator.gpu) throw new Error('На этом iPad недоступен WebGPU. Используй «Собрать по темам».');
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) throw new Error('iPad не смог запустить WebGPU. Тематический конспект остаётся доступен.');
  status(onProgress,'Загружаем библиотеку для связного конспекта…');
  // WebLLM provides a CDN-native ESM import. Version pinned for repeatability.
  const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.83');
  const record = webllm.prebuiltAppConfig?.model_list?.find(x => x.model_id === MODEL);
  if (!record) throw new Error('Выбранная компактная языковая модель отсутствует в этой версии WebLLM.');
  status(onProgress,'Загружаем локальную языковую модель. Понадобятся сотни МБ памяти и загрузки…');
  cachedEngine = await webllm.CreateMLCEngine(MODEL, {
    initProgressCallback: x => status(onProgress, 'Подготовка модели: '+(x?.text || Math.round((x?.progress || 0)*100)+'%')),
  });
  return cachedEngine;
}
function sourceParts(item) {
  const raw = (item.cues?.length ? item.cues.map(c=>c.text).join('\n') : item.transcript || '').trim();
  if (!raw) return [];
  // Chunk by paragraph; keep every portion below the small model's context limit.
  const phrases = raw.split(/\n+|(?<=[.!?])\s+/u).filter(Boolean);
  const parts = [];
  let current = '';
  for (const phrase of phrases) {
    const subs = phrase.length > 1750 ? phrase.match(/[\s\S]{1,1500}/g) || [] : [phrase];
    for (const sub of subs) {
      if (current && current.length + sub.length > 1700) { parts.push(current); current = ''; }
      current += (current?' ':'') + sub;
    }
  }
  if (current) parts.push(current);
  if (parts.length > 16) throw new Error('Слишком длинный текст для маленькой локальной модели. Используй тематический конспект или короткую запись.');
  return parts;
}
async function generate(engine,messages,max_tokens=270) {
  const result = await engine.chat.completions.create({messages,temperature:0.1,top_p:0.85,max_tokens,stream:false});
  return String(result?.choices?.[0]?.message?.content || '').trim();
}
function rejectUnsupportedNumbers(text,source) {
  // A simple conservative filter: remove sentences introducing numbers not in the transcript.
  const originalNumbers = new Set((source.match(/\b\d[\d.,]*\b/g) || []).map(s => s.replace(/[.,]/g,'')));
  return text.split('\n').filter(line => {
    const content=line.replace(/^\s*\d+[.)]\s*/,'');
    const nums = (content.match(/\b\d[\d.,]*\b/g) || []).map(s=>s.replace(/[.,]/g,''));
    return nums.every(n=>originalNumbers.has(n));
  }).join('\n').trim();
}
export async function createCoherentNotes({item,onProgress}) {
  const pieces=sourceParts(item);
  if(!pieces.length) throw new Error('Расшифровка пуста.');
  const engine=await getEngine(onProgress);
  const outputs=[];
  const system='Ты редактор учебного конспекта. Пиши на русском. Используй только сведения из предоставленной расшифровки. Не добавляй внешние сведения, даты, имена, формулы или выводы. Если фрагмент нечёткий, пропусти его. Пиши грамотные законченные фразы, без длинных дословных цитат.';
  for(let i=0;i<pieces.length;i++) {
    status(onProgress,`Связываем мысли: часть ${i+1} из ${pieces.length}…`);
    const prompt='На основе этого фрагмента лекции напиши до 3 коротких связных тезисов своими словами. Если тема меняется, отдели темы. Не выдумывай: каждый тезис должен быть подтверждён текстом.\n\nФрагмент:\n'+pieces[i];
    const text=await generate(engine,[{role:'system',content:system},{role:'user',content:prompt}],220);
    if(text.length>20)outputs.push(text);
  }
  if(!outputs.length)throw new Error('Модель не смогла составить тезисы.');
  // Consolidate a small collection of chunk summaries; avoid exceeding the 4K context window.
  const notes=outputs.join('\n\n').slice(0,11500);
  status(onProgress,'Объединяем тезисы в единый учебный конспект…');
  const combined = await generate(engine,[
    {role:'system',content:system},
    {role:'user',content:'Сделай из перечисленных тезисов единый удобный конспект: заголовок темы, затем 3–6 смысловых разделов с 2–4 законченными тезисами в каждом. Убери повторы, сохрани ход рассказа. Никаких придуманных фактов. Текст без длинных цитат.\n\nИсходные тезисы:\n'+notes}
  ],780);
  const checked=rejectUnsupportedNumbers(combined,item.transcript||'');
  if(checked.length<120)throw new Error('Не удалось получить достаточно надёжный связный текст. Тематический конспект доступен без ИИ.');
  return checked;
}
