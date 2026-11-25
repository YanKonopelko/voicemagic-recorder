'use strict';
// No CDN, telemetry, upload or speech service. See recorder-locales.js for text.
const $ = id => document.getElementById(id), encoder = new TextEncoder();
const words = ['Саку','Нами','Бума','Муна','Тана','Суми','Нуба','Маса','Бину','Таму','Насу','Ату','Стоп'];
const ids = ['Ign','Una','Num','Vae','Shu','Rem','Dum','Vir','Twi','Tik','Bom','Ka','Stop'];
const latin = ['Saku','Nami','Buma','Muna','Tana','Sumi','Nuba','Masa','Binu','Tamu','Nasu','Atu','Stop'];
// Broad phonemic hints, not a newly imposed stress convention for rune names.
const ipa = ['sa.ku','na.mi','bu.ma','mu.na','ta.na','su.mi','nu.ba','ma.sa','bi.nu','ta.mu','na.su','a.tu','stop'];
const readings = {
  en:['sah-koo','nah-mee','boo-mah','moo-nah','tah-nah','soo-mee','noo-bah','mah-sah','bee-noo','tah-moo','nah-soo','ah-too','stop'],
  ru:['са-ку','на-ми','бу-ма','му-на','та-на','су-ми','ну-ба','ма-са','би-ну','та-му','на-су','а-ту','стоп'],
  uk:['са-ку','на-мі','бу-ма','му-на','та-на','су-мі','ну-ба','ма-са','бі-ну','та-му','на-су','а-ту','стоп'],
  nb:['sa-ko','na-mi','bo-ma','mo-na','ta-na','so-mi','no-ba','ma-sa','bi-no','ta-mo','na-so','a-to','stopp']
};
function preference(key, value) { try { if(value === undefined) return localStorage.getItem('vm-recorder:'+key); localStorage.setItem('vm-recorder:'+key,value); } catch {} return null; }
function detectLocale(language) { const code=(language||'').toLowerCase().split(/[-_]/)[0]; return code==='no'||code==='nn'?'nb':messages[code]?code:'en'; }
let locale=detectLocale(preference('locale')||'en');
function t(key, values={}) { return messages[locale][key].replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??'')); }
let statusKey='idle',statusValues={};
function status(key,values={}) { statusKey=key;statusValues=values;$('status').textContent=t(key,values); }
function error(key,values={}) { $('error').textContent=key?t(key,values):''; }
function commandName(i) { return locale==='ru'?words[i]:locale==='uk'?words[i].replaceAll('и','і'):latin[i]; }
const lookup={};
for(let i=0;i<ids.length;i++)for(const alias of [words[i],latin[i],words[i].replaceAll('и','і')])lookup[alias.toLowerCase()]=ids[i];
function parseTranscript(text) { return text.trim()?text.trim().toLowerCase().split(/[\s,;→]+/).map(word=>{if(!lookup[word])throw Error(t('unknownRune',{word}));return lookup[word];}):[]; }
function canonical(tokens) { return tokens.map(id=>words[ids.indexOf(id)]).join(' '); }
function displayTokens(tokens) { return tokens.map(id=>(ids.includes(id)?commandName(ids.indexOf(id)):t('retiredCommand'))).join(' '); }
const session=new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,8);
let prompts=[],index=0,takes=[],last=null,active=false,starting=false,finishing=false,captureSerial=0,stream=null,context=null,node=null,source=null,mute=null,timer,blocks=[],sampleCount=0,startTime,reviewURL=null,capture=null,db=null,storageState='storageUnavailable',saving=Promise.resolve();
function storageMessage() { $('storage-status').textContent=t(storageState);$('storage-status').classList.toggle('warning',storageState!=='storageReady'); }
function transaction(action) { return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');action(tx.objectStore('takes'));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}); }
function persist(take, remove=false) { if(!db)return Promise.resolve(true);const snapshot=structuredClone(take);let success=true;saving=saving.then(()=>transaction(store=>remove?store.delete(snapshot.id):store.put(snapshot))).catch(()=>{success=false;storageState='storageFailed';storageMessage();});return saving.then(()=>success); }
async function openStorage() {
  try {
    db=await new Promise((resolve,reject)=>{const request=indexedDB.open('VoiceMagicRuneRecorder',1);request.onupgradeneeded=()=>request.result.createObjectStore('takes',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Storage blocked'));});
    takes=await new Promise((resolve,reject)=>{const request=db.transaction('takes').objectStore('takes').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    takes.sort((a,b)=>a.metadata.utc.localeCompare(b.metadata.utc));storageState='storageReady';
    db.onversionchange=()=>{db.close();db=null;storageState='storageUnavailable';storageMessage();};
    if(takes.length)status('restored',{count:takes.length});
  } catch { if(db)db.close();db=null; }
  storageMessage();summary();if(takes.length)selectTake(takes.at(-1).id);lock(false);
}
function rememberProfile() { for(const id of ['speaker','language','environment','group','pace','duration'])preference(id,$(id).value);preference('index',String(index)); }
function setPrompts(reset=true) {
  const group=$('group').value;prompts=[];if(reset)index=0;
  if(group==='words')prompts=ids.map((id,i)=>({key:'word-'+id,tokens:[id],kind:'command',text:words[i]}));
  if(group==='chains')for(let e=0;e<4;e++)for(let f=4;f<8;f++)for(const feature of [-1,8,9,10]){const ix=[e,f,...(feature<0?[]:[feature]),11],tokens=ix.map(i=>ids[i]);prompts.push({key:'chain-'+tokens.join('-')+'-'+$('pace').value,tokens,kind:'command',text:canonical(tokens)});}
  if(group==='speech'||group==='noise')prompts=messages.en[group+'Tasks'].map((_,i)=>({key:group+'-'+i,taskIndex:i,tokens:[],kind:group}));
  index=Math.max(0,Math.min(index,prompts.length-1));renderPrompt();rememberProfile();
}
function promptText(p, language=locale) { return p.kind==='command'?displayTokens(p.tokens):messages[language][p.kind+'Tasks'][p.taskIndex]; }
function renderPrompt() {
  if(!prompts.length)return;const p=prompts[index],done=new Set(takes.filter(take=>take.metadata.review==='verified'&&take.metadata.speaker===$('speaker').value.trim()).map(take=>take.metadata.promptKey));
  $('counter').textContent=t('counter',{index:index+1,total:prompts.length,done:prompts.filter(p=>done.has(p.key)).length});
  $('prompt').textContent=promptText(p);$('pronunciation').textContent=p.tokens.map(id=>readings[locale][ids.indexOf(id)]).join('  ·  ');$('ipa').textContent=p.tokens.map(id=>'/'+ipa[ids.indexOf(id)]+'/').join('  ');
  $('hint').textContent=t(p.kind!=='command'?'backgroundHint':$('group').value==='chains'?($('pace').value==='joined'?'joinedHint':'normalHint'):'wordHint',{limit:$('duration').value});
  $('pace-label').hidden=$('group').value!=='chains';$('duration-label').hidden=p.kind==='command';
}
function applyLocale() {
  document.documentElement.lang=locale;document.title='VoiceMagic · '+t('recordingsTitle').replace(/^3 · /,'');$('ui-language').value=locale;
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-placeholder]'))el.placeholder=t(el.dataset.placeholder);
  for(const el of document.querySelectorAll('[data-aria]'))el.setAttribute('aria-label',t(el.dataset.aria));
  for(const option of $('duration').children)option.textContent=t('durationOption',{seconds:option.value});
  $('rune-table').replaceChildren(...words.map((word,i)=>{const row=document.createElement('tr');for(const value of [word+' · '+latin[i],readings[locale][i],'/'+ipa[i]+'/']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));
  $('transcript-buttons').replaceChildren(...ids.map((id,i)=>{const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=commandName(i);button.onclick=()=>{if(active||starting||finishing)return;$('transcript').value=[$('transcript').value.trim(),commandName(i)].filter(Boolean).join(' ');annotationChanged();};return button;}));
  storageMessage();status(statusKey,statusValues);error('');renderPrompt();summary();renderTakeDetails();
}
function lock(value) {
  for(const id of ['ui-language','speaker','language','environment','consent','group','pace','duration','previous','next','record','take-list','kind','transcript','exclude','delete-take','clear'])$(id).disabled=value;
  for(const button of $('transcript-buttons').children)button.disabled=value;
  $('stop').disabled=!(active||starting);$('download').disabled=value||!takes.length;$('clear').disabled=value||!takes.length;$('take-list').disabled=value||!takes.length;$('verify').disabled=value||!last||!last.listened;$('playback').controls=!value;
}
async function digest(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
async function split(id) { const hex=await digest(encoder.encode('VoiceMagic-Neural-v1:'+id)),bucket=parseInt(hex.slice(0,8),16)%10;return bucket===0?'test':bucket===1?'dev':'train'; }
function wav(samples) {
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  function text(offset,value){for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));}
  text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);return new Uint8Array(buffer);
}
async function record() {
  if(active||starting||finishing)return;const serial=++captureSerial;error('');
  try {
    const speaker=$('speaker').value.trim();if(!/^[\p{L}\p{N}_-]{1,80}$/u.test(speaker))throw Error(t('invalidSpeaker'));
    if(!$('consent').checked)throw Error(t('consentRequired'));if(!$('language').value.trim())throw Error(t('languageRequired'));
    if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia||!globalThis.AudioContext||!globalThis.AudioWorkletNode)throw Error(t('unsupported'));
    rememberProfile();starting=true;lock(true);$('stop').disabled=false;status('requesting');$('playback').pause();
    const p=structuredClone(prompts[index]);capture={speaker,language:$('language').value.trim(),environment:$('environment').value,prompt:p,uiLocale:locale,promptText:promptText(p),pace:$('group').value==='chains'?$('pace').value:'',limit:p.kind==='command'?15:Number($('duration').value)};
    // Resume in the click gesture, before an asynchronous permission prompt.
    const requestedContext=new AudioContext({sampleRate:48000});context=requestedContext;await requestedContext.resume();
    if(!starting||serial!==captureSerial)return;
    const requestedStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    if(!starting||serial!==captureSerial){requestedStream.getTracks().forEach(track=>track.stop());return;}stream=requestedStream;
    const code=`class Capture extends AudioWorkletProcessor{constructor(){super();this.buffer=new Float32Array(2048);this.offset=0;this.port.onmessage=e=>{if(e.data==='flush'){if(this.offset)this.port.postMessage(this.buffer.slice(0,this.offset));this.offset=0;this.port.postMessage('flushed');}};}process(inputs){const channels=inputs[0];if(channels&&channels.length)for(let i=0;i<channels[0].length;i++){let sample=0;for(const channel of channels)sample+=channel[i]/channels.length;this.buffer[this.offset++]=sample;if(this.offset===this.buffer.length){this.port.postMessage(this.buffer.slice());this.offset=0;}}return true;}}registerProcessor('capture',Capture);`;
    if(!requestedContext.audioWorklet)throw Error(t('unsupported'));
    // A data module also works from file:// in Chromium, whose opaque file
    // origin rejects blob:null worklet modules. This contains only our code.
    await requestedContext.audioWorklet.addModule('data:text/javascript;charset=utf-8,'+encodeURIComponent(code),{credentials:'omit'});
    if(!starting||serial!==captureSerial)return;
    blocks=[];sampleCount=0;node=new AudioWorkletNode(context,'capture');node.port.onmessage=e=>{if((active||finishing)&&e.data instanceof Float32Array){blocks.push(e.data);sampleCount+=e.data.length;let square=0;for(const value of e.data)square+=value*value;$('level').value=Math.min(1,Math.sqrt(square/e.data.length)*4);}};
    source=context.createMediaStreamSource(stream);source.connect(node);mute=context.createGain();mute.gain.value=0;node.connect(mute).connect(context.destination);
    for(const track of stream.getAudioTracks())track.onended=()=>{if(active)stop('deviceInterruption');};
    active=true;starting=false;startTime=Date.now();context.onstatechange=()=>{if(active&&context.state!=='running')stop('deviceInterruption');};status('recording',{seconds:'0.0',limit:capture.limit});lock(true);
    timer=setInterval(()=>{status('recording',{seconds:((Date.now()-startTime)/1000).toFixed(1),limit:capture.limit});if(Date.now()-startTime>=capture.limit*1000)stop();},100);
  } catch(e) {
    if(serial!==captureSerial)return;starting=false;active=false;cleanup();lock(false);status('idle');
    const key={NotAllowedError:'permissionDenied',NotFoundError:'noMicrophone',NotReadableError:'microphoneBusy'}[e.name];$('error').textContent=key?t(key):e.message;
  }
}
function cleanup() {
  clearInterval(timer);if(node){node.port.onmessage=null;node.disconnect();node=null;}if(source){source.disconnect();source=null;}if(mute){mute.disconnect();mute=null;}
  if(stream){stream.getTracks().forEach(track=>{track.onended=null;track.stop();});stream=null;}
  if(context){context.onstatechange=null;if(context.state!=='closed')context.close().catch(()=>{});context=null;}$('level').value=0;
}
async function stop(interruption='') {
  if(starting){captureSerial++;starting=false;cleanup();lock(false);status('idle');return;}
  if(!active)return;active=false;finishing=true;clearInterval(timer);lock(true);status('finishing');
  const rate=context.sampleRate,device=stream.getAudioTracks()[0]?.label||'default',captured=capture;
  // Drain partial worklet blocks; interrupted/suspended contexts may not answer.
  if(!interruption&&context.state==='running')await new Promise(resolve=>{const handler=node.port.onmessage;let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timeout);resolve();};const timeout=setTimeout(finish,500);node.port.onmessage=e=>e.data==='flushed'?finish():handler(e);node.port.postMessage('flush');});
  cleanup();
  try {
    let audio=new Float32Array(sampleCount),offset=0;for(const block of blocks){audio.set(block,offset);offset+=block.length;}blocks=[];
    if(!audio.length)throw Error(t('noAudio'));
    // Timer scheduling and the final partial block must not exceed the dataset
    // limit (120 seconds). Keep the original beginning and discard excess tail.
    audio=audio.subarray(0,Math.round(captured.limit*rate));
    if(rate!==48000){const offline=new OfflineAudioContext(1,Math.ceil(audio.length*48000/rate),48000),buffer=offline.createBuffer(1,audio.length,rate);buffer.copyToChannel(audio,0);const resampler=offline.createBufferSource();resampler.buffer=buffer;resampler.connect(offline.destination);resampler.start();audio=(await offline.startRendering()).getChannelData(0).slice();}
    const bytes=wav(audio),id=crypto.randomUUID(),p=captured.prompt;
    const metadata={schema:1,vocabulary:'runes-atu-v1',speaker:captured.speaker,session,split:await split(captured.speaker),device,language:captured.language,environment:captured.environment,kind:p.kind,prompt:p.kind==='command'?canonical(p.tokens):captured.promptText,promptTokens:p.tokens,promptKey:p.key,uiLocale:captured.uiLocale,pace:captured.pace,transcript:'',source:'human',review:'pending',consent:true,tokens:[],spans:[],samples:audio.length,utc:new Date().toISOString(),sha256:await digest(bytes),interruption};
    // A task is not a trusted transcript. Only a listener enters actual words.
    last={id,bytes,metadata,listened:false};takes.push(last);await persist(last);summary();selectTake(id);status('saved');
  } catch(e) { $('error').textContent=e.message;status('idle'); }
  finally { finishing=false;lock(false); }
}
function summary() {
  const verified=takes.filter(take=>take.metadata.review==='verified').length,excluded=takes.filter(take=>take.metadata.review==='excluded').length;
  $('summary').textContent=t('summary',{total:takes.length,verified,excluded,pending:takes.length-verified-excluded});
  $('take-list').replaceChildren(...takes.map((take,i)=>{const option=document.createElement('option');option.value=take.id;const m=take.metadata,name=m.promptTokens?.length?displayTokens(m.promptTokens):t(m.kind+'Kind');option.textContent=t('takeOption',{index:i+1,name,seconds:(m.samples/48000).toFixed(1),review:t(m.review)});return option;}));
  if(last)$('take-list').value=last.id;$('take-list').disabled=active||starting||finishing||!takes.length;$('download').disabled=active||starting||finishing||!takes.length;$('clear').disabled=$('download').disabled;renderPrompt();
}
function renderTakeDetails() { if(!last)return;const m=last.metadata;$('take-details').textContent=t('detail',m)+(m.interruption?' · '+t('interruptedDetail'):''); }
function selectTake(id) {
  if(active||starting)return;last=takes.find(take=>take.id===id)||null;$('review').hidden=!last;if(!last){$('playback').pause();$('playback').removeAttribute('src');if(reviewURL)URL.revokeObjectURL(reviewURL);reviewURL=null;return;}
  $('playback').pause();if(reviewURL)URL.revokeObjectURL(reviewURL);reviewURL=URL.createObjectURL(new Blob([last.bytes],{type:'audio/wav'}));$('playback').src=reviewURL;
  $('take-list').value=last.id;$('kind').value=last.draftKind??last.metadata.kind;$('transcript').value=last.draftTranscript??displayTokens(last.metadata.tokens);$('verify').disabled=!last.listened;renderTakeDetails();
}
function annotationChanged() {
  if(!last||active||starting||finishing)return;
  // An edit invalidates previous confirmation, even if the text is now invalid.
  last.draftKind=$('kind').value;last.draftTranscript=$('transcript').value;
  if(last.metadata.review==='verified'){last.metadata.review='pending';summary();status('reviewChanged');}
  persist(last);
}
async function verify() {
  if(!last||active||starting||finishing)return;error('');
  try {
    if(!last.listened)throw Error(t('listenFirst'));
    const tokens=parseTranscript($('transcript').value),kind=$('kind').value;
    if((kind==='command')!==Boolean(tokens.length))throw Error(t('kindMismatch'));
    if(last.metadata.interruption||last.metadata.samples<4800)throw Error(t('invalidTake'));
    last.metadata={...last.metadata,kind,transcript:canonical(tokens),tokens,review:'verified',reviewedUtc:new Date().toISOString()};delete last.draftKind;delete last.draftTranscript;await persist(last);summary();status('verifiedStatus');
  } catch(e) { $('error').textContent=e.message; }
}
// ZIP STORE, UTF-8 names, CRC32. No external libraries.
function zip(files) {
  const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  function crc(bytes){let c=0xffffffff;for(const x of bytes)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  const local=[],central=[];let offset=0,size=0;
  for(const [name,data] of files){const nb=encoder.encode(name),c=crc(data),h=new Uint8Array(30+nb.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,c,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,nb.length,true);h.set(nb,30);local.push(h,data);const ch=new Uint8Array(46+nb.length),cv=new DataView(ch.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,c,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,nb.length,true);cv.setUint32(42,offset,true);ch.set(nb,46);central.push(ch);size+=ch.length;offset+=h.length+data.length;}
  const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});
}
function download() {
  if(active||starting||finishing||!takes.length)return;const files=[];for(const take of takes)files.push([take.id+'.wav',take.bytes],[take.id+'.take.json',encoder.encode(JSON.stringify(take.metadata,null,2))]);
  const url=URL.createObjectURL(zip(files)),a=document.createElement('a');a.href=url;a.download='VoiceMagic_'+session+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);const count=takes.filter(take=>take.metadata.review==='pending').length;status(count?'exportPending':'exportDone',{count});
}
$('record').onclick=record;$('stop').onclick=()=>stop();$('group').onchange=()=>setPrompts();$('pace').onchange=()=>setPrompts();$('duration').onchange=()=>{renderPrompt();rememberProfile();};
$('previous').onclick=()=>{index=(index+prompts.length-1)%prompts.length;renderPrompt();rememberProfile();};$('next').onclick=()=>{index=(index+1)%prompts.length;renderPrompt();rememberProfile();};
$('ui-language').onchange=()=>{locale=$('ui-language').value;preference('locale',locale);applyLocale();};$('take-list').onchange=()=>selectTake($('take-list').value);
// The browser's played ranges exclude skipped parts, including short takes.
$('playback').onended=()=>{const audio=$('playback'),played=audio.played;if(last&&Number.isFinite(audio.duration)&&played.length===1&&played.start(0)<0.03&&played.end(0)>=audio.duration-0.03){last.listened=true;persist(last);$('verify').disabled=false;}};
$('transcript').oninput=annotationChanged;$('kind').onchange=annotationChanged;$('verify').onclick=verify;
$('exclude').onclick=async()=>{if(!last||active||starting||finishing)return;last.metadata.review='excluded';await persist(last);summary();status('excludedStatus');error('');};
$('delete-take').onclick=async()=>{if(!last||active||starting||finishing||!confirm(t('confirmDelete')))return;finishing=true;lock(true);try{const take=last;if(!await persist(take,true))return;takes=takes.filter(item=>item!==take);last=null;summary();selectTake(takes.at(-1)?.id);status('deletedStatus');}finally{finishing=false;lock(false);}};
$('clear').onclick=async()=>{if(active||starting||finishing||!confirm(t('confirmClear')))return;finishing=true;lock(true);try{if(db){await saving;await transaction(store=>store.clear());}takes=[];last=null;summary();selectTake(null);status('clearedStatus');}catch{storageState='storageFailed';storageMessage();}finally{finishing=false;lock(false);}};
$('download').onclick=download;for(const id of ['speaker','language','environment'])$(id).onchange=()=>{rememberProfile();renderPrompt();};
window.addEventListener('beforeunload',event=>{if(active||starting||finishing||takes.length){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop('hiddenInterruption');});
for(const id of ['speaker','language','environment','group','pace','duration']){const value=preference(id);if(value!==null)$(id).value=value;}
if(!$('speaker').value)$('speaker').value='speaker-'+crypto.randomUUID().slice(0,12);if(!['words','chains','speech','noise'].includes($('group').value))$('group').value='words';
if(!['normal','joined'].includes($('pace').value))$('pace').value='normal';if(!['60','90','120'].includes($('duration').value))$('duration').value='60';
index=Number(preference('index'))||0;setPrompts(false);applyLocale();lock(true);
const ready=openStorage();
