// Lecture AI 0.3 / experimental browser-only note synthesis.
// This module is loaded only after a user explicitly clicks the beta button.
// Only library/model files are downloaded; lecture text is passed to a local WebGPU model.
let cachedEngine = null;
const MODEL_GPU = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const MODEL_CPU = 'onnx-community/Qwen2.5-0.5B-Instruct';
// WebLLM's prebuilt model asks for 32768 bytes of workgroup storage.
// Some Safari/iPad GPUs only provide 16384; do NOT request an unsupported GPU device.
const GPU_WORKGROUP_REQUIRED = 32768;
const status = (callback,text) => { if (typeof callback === 'function') callback(text); };

async function getEngine(onProgress) {
  if (cachedEngine) return cachedEngine;
  let adapter = null;
  try { adapter = await navigator.gpu?.requestAdapter() || null; } catch {}
  const available = adapter?.limits?.maxComputeWorkgroupStorageSize || 0;
  if (available >= GPU_WORKGROUP_REQUIRED) {
    try {
      status(onProgress,'GPU совместим. Подключаем WebLLM…');
      const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.83');
      if (!webllm.prebuiltAppConfig?.model_list?.some(x => x.model_id === MODEL_GPU)) {
        throw new Error('GPU-модель не найдена в каталоге WebLLM');
      }
      const engine = await webllm.CreateMLCEngine(MODEL_GPU, {
        initProgressCallback: x => status(onProgress,'Подготовка GPU-модели: '+(x?.text || Math.round((x?.progress||0)*100)+'%')),
      });
      cachedEngine = {mode:'gpu',engine};
      return cachedEngine;
    } catch (e) {
      console.warn('WebLLM model initialization failed; trying WASM CPU:',e);
      status(onProgress,'GPU-модель не запустилась. Пробуем CPU-режим без WebGPU…');
    }
  } else {
    status(onProgress,`GPU предоставляет ${available || 0} Б/группу вместо необходимых 32768 Б. Пробуем CPU-режим…`);
  }
  // CPU fallback uses ONNX WebAssembly; no WebGPU and no paid server.
  // Unlike WebLLM, the library supports 4-bit ONNX models on the CPU.
  status(onProgress,'Загружаем бесплатную CPU-модель Qwen (первая загрузка — сотни МБ)…');
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
  env.allowLocalModels=false;
  env.useBrowserCache=true;
  if(env.backends?.onnx?.wasm)env.backends.onnx.wasm.numThreads=1;
  const pipe=await pipeline('text-generation',MODEL_CPU,{
    device:'wasm',dtype:'q4',
    progress_callback:x=>{
      if(x?.status==='progress' && typeof x.progress==='number'){
        status(onProgress,'CPU-модель: загрузка '+Math.round(x.progress)+'% — '+(x.file||''));
      }
    },
  });
  cachedEngine={mode:'cpu',pipe};
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
  if(engine.mode==='cpu'){
    // Short single-threaded WASM proof-of-concept on iPad; larger outputs can stall Safari.
    const response=await engine.pipe(messages,{
      max_new_tokens:Math.min(max_tokens,150),
      do_sample:false,return_full_text:false,
    });
    const generated=response?.[0]?.generated_text;
    if(typeof generated==='string')return generated.trim();
    if(Array.isArray(generated))return String(generated[generated.length-1]?.content||'').trim();
    return String(generated?.content||response?.[0]?.text||'').trim();
  }
  const result=await engine.engine.chat.completions.create({messages,temperature:0.1,top_p:0.85,max_tokens,stream:false});
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
  if(!pieces.length)throw new Error('Расшифровка пуста.');
  const engine=await getEngine(onProgress);
  // On CPU, do not silently present incomplete processing as a full-lecture summary.
  // First establish that ONNX/Qwen can run on this specific iPad before scaling up.
  const cpuTest = engine.mode==='cpu';
  const toProcess=cpuTest?pieces.slice(0,2):pieces;
  const outputs=[];
  const system='Ты редактор учебного конспекта. Пиши по-русски. Используй только приведённый текст. Не добавляй внешние сведения и даты. Исправляй только очевидные ошибки речи без выдумок. Дай краткие связные мысли, не цитаты.';
  for(let i=0;i<toProcess.length;i++) {
    status(onProgress,`${cpuTest?'CPU-тест — ':''}Связываем мысли: фрагмент ${i+1} из ${toProcess.length}…`);
    const prompt='Составь 2–3 коротких связных тезиса по этому отрывку на русском языке. Не придумывай имена, даты и факты.\n\nТекст:\n'+toProcess[i];
    const text=await generate(engine,[{role:'system',content:system},{role:'user',content:prompt}],200);
    if(text.length>20)outputs.push(text);
    // Release the event loop between chunks to keep Safari UI responsive.
    await new Promise(r=>setTimeout(r,0));
  }
  if(!outputs.length)throw new Error('Модель не смогла создать связные тезисы.');
  if(cpuTest){
    const partial=rejectUnsupportedNumbers(outputs.join('\n\n'),toProcess.join('\n'));
    if(partial.length<60)throw new Error('CPU-модель вернула недостаточно текста.');
    return `ПРОБНЫЙ ЧАСТИЧНЫЙ КОНСПЕКТ (CPU): обработаны первые ${toProcess.length} из ${pieces.length} фрагментов расшифровки. Это ещё НЕ полный конспект занятия.\n\n${partial}`;
  }
  const notes=outputs.join('\n\n').slice(0,11500);
  status(onProgress,'Объединяем тезисы в единый учебный конспект…');
  const combined=await generate(engine,[
    {role:'system',content:system},
    {role:'user',content:'Составь из этих тезисов краткий конспект с 3–6 смысловыми разделами. Убери повторы. Не добавляй фактов.\n\n'+notes}
  ],780);
  const checked=rejectUnsupportedNumbers(combined,item.transcript||'');
  if(checked.length<120)throw new Error('Не удалось получить достаточно надёжный связный текст.');
  return checked;
}
