// Lecture AI iPad 0.2 - experimental, local-browser transcription.
// No audio or video is transmitted to a service. The JS library and multilingual model are fetched publicly on first run.
let engine=null;
const RATE=16000;
const MAX_SECONDS=25*60;
const CHUNK_SECONDS=24;
function setStatus(cb,msg,pct=null){if(typeof cb==='function')cb(msg,pct);}
async function initEngine(onProgress){
  if(engine)return engine;
  setStatus(onProgress,'Загружаем библиотеку распознавания…',1);
  const mod=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
  const {pipeline,env}=mod;
  env.allowLocalModels=false;
  env.useBrowserCache=true;
  if(env.backends?.onnx?.wasm){env.backends.onnx.wasm.numThreads=1;}
  setStatus(onProgress,'Первый запуск: скачиваем Whisper Tiny (может занять несколько минут)…',2);
  engine=await pipeline('automatic-speech-recognition','onnx-community/whisper-tiny',{
    device:'wasm',dtype:'q8',
    progress_callback: evt=>{
      if(evt?.status==='progress'&&typeof evt.progress==='number'){
        setStatus(onProgress,'Загрузка модели: '+Math.round(evt.progress)+'% ('+(evt.file||'')+')',Math.max(2,Math.min(18,2+evt.progress*0.16)));
      }
    }
  });
  return engine;
}
async function audioFromVideo(file,onProgress){
  if(!file || !file.size)throw new Error('Видео не найдено.');
  // On Safari HTMLMediaElement may play a MOV whose codec cannot be decoded by WebAudio.
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)throw new Error('Этот браузер не поддерживает AudioContext.');
  setStatus(onProgress,'Читаем звук из видео…',20);
  const ctx=new Ctx();
  let audio;
  try{
    const buffer=await file.arrayBuffer();
    audio=await ctx.decodeAudioData(buffer);
  }catch(e){throw new Error('Не удалось извлечь звук из файла. Попробуй запись в формате MP4 или аудио M4A/MP3.');}
  finally{try{await ctx.close()}catch{}}
  if(audio.duration>MAX_SECONDS)throw new Error('Для тестовой версии максимум 25 минут.');
  if(audio.duration<1)throw new Error('Видео слишком короткое.');
  setStatus(onProgress,'Готовим звуковую дорожку для Whisper…',23);
  // Downmix and resample in chunks without creating a second full-rate decoded audio buffer.
  const oldRate=audio.sampleRate;
  const len=Math.floor(audio.duration*RATE);
  const output=new Float32Array(len);
  const chs=[];for(let c=0;c<audio.numberOfChannels;c++)chs.push(audio.getChannelData(c));
  for(let i=0;i<len;i++){
    const sourcePosition=i*oldRate/RATE;
    const left=Math.floor(sourcePosition),right=Math.min(left+1,chs[0].length-1),frac=sourcePosition-left;
    let v=0;
    for(const c of chs)v+=(c[left]*(1-frac)+c[right]*frac);
    output[i]=v/chs.length;
  }
  return output;
}
function cleanText(text){return String(text||'').replace(/\[(?:BLANK_AUDIO|FOREIGN|MUSIC|NO_SPEECH)\]/ig,'').replace(/\s+/g,' ').trim();}
export async function transcribeFileLocally({file,language='russian',onProgress}){
  const audio=await audioFromVideo(file,onProgress);
  const asr=await initEngine(onProgress);
  const chunkSize=RATE*CHUNK_SECONDS,total=Math.ceil(audio.length/chunkSize);
  const cues=[];
  for(let i=0;i<total;i++){
    const start=i*chunkSize,end=Math.min(audio.length,(i+1)*chunkSize);
    const seconds=Math.floor(start/RATE);
    setStatus(onProgress,`Распознаём фрагмент ${i+1} из ${total} (${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')})…`,20+Math.round(i/total*79));
    const options={task:'transcribe',return_timestamps:false};
    if(language!=='auto')options.language=language;
    const response=await asr(audio.subarray(start,end),options);
    const cleaned=cleanText(response?.text||'');
    if(cleaned)cues.push({start:start/RATE,end:end/RATE,text:cleaned});
    // Allow Safari to process paints and user gestures between chunks.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  setStatus(onProgress,'Формируем расшифровку и конспект…',99);
  return {text:cues.map(c=>c.text).join('\n'),cues};
}
