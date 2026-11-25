'use strict';
// A short participant journey over the existing local capture/review engine.
// Keep the full grammar in recorder.js; sample seven distinct legal spells.
function wizardPlan(speaker) {
  const key='wizard-plan-v1:'+speaker;
  try {
    const saved=JSON.parse(preference(key));
    if(Array.isArray(saved)&&saved.length===7&&new Set(saved).size===7&&saved.every(n=>Number.isInteger(n)&&n>=0&&n<64))return saved;
  } catch {}
  const pool=Array.from({length:64},(_,i)=>i);
  // Rejection sampling avoids modulo bias and does not use evaluation data.
  function randomBelow(n){const bound=Math.floor(4294967296/n)*n,buffer=new Uint32Array(1);do{crypto.getRandomValues(buffer);}while(buffer[0]>=bound);return buffer[0]%n;}
  for(let i=pool.length-1;i>0;i--){const j=randomBelow(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  const result=pool.slice(0,7);preference(key,JSON.stringify(result));return result;
}
function wizardSequence(speaker) {
  const singles=ids.map((id,i)=>({key:'wizard-v1-word-'+id,tokens:[id],kind:'command',text:words[i]}));
  const all=[];for(let e=0;e<4;e++)for(let f=4;f<8;f++)for(const feature of [-1,8,9,10]){const tokens=[ids[e],ids[f],...(feature<0?[]:[ids[feature]]),'Ka'];all.push({key:'wizard-v1-spell-'+tokens.join('-'),tokens,kind:'command',text:canonical(tokens)});}
  return [...singles,...wizardPlan(speaker).map(i=>all[i])];
}
let wizardScreen='identity',wizardSpeaker='';
function wizardTake(p=prompts[index]) { return takes.findLast(take=>take.metadata.speaker===wizardSpeaker&&take.metadata.promptKey===p?.key); }
function wizardReviewed(p) { const take=wizardTake(p);return take?.metadata.review==='verified'&&!take.metadata.interruption; }
function wizardGate() {
  const busy=active||starting||finishing;
  $('next').disabled=busy||!prompts[index]||!wizardReviewed(prompts[index]);
  for(const id of ['wizard-back','wizard-back-intro','wizard-start','wizard-continue','wizard-back-recordings','backup'])$(id).disabled=busy;
  $('backup').disabled=busy||!takes.length;
  const current=wizardTake();
  $('review').hidden=!current||current.metadata.review==='excluded';
  $('replay').disabled=busy||!current||current.metadata.review==='excluded';
  $('verify').disabled=busy||!current||!current.listened||Boolean(current.metadata.interruption)||current.metadata.review==='excluded';
  $('exclude').disabled=busy||!current||current.metadata.review==='excluded';
  spellPreview.update(prompts[index],wizardScreen==='recording',busy);
}
function wizardShow(screen) {
  if(active||starting||finishing)return;
  wizardScreen=screen;
  for(const name of ['identity','intro','recording','thanks'])$('screen-'+name).hidden=name!==screen;
  $('wizard-step').textContent=t('wizardStep',{step:{identity:1,intro:2,recording:3,thanks:4}[screen]});
  $('error').textContent='';$('playback').pause();
  spellPreview.update(prompts[index],screen==='recording',false);
  window.scrollTo?.({top:0,behavior:'instant'});
}
async function initializeWizard() {
  await ready;
  const originalRender=renderPrompt,originalLock=lock,originalLocale=applyLocale,originalVerify=verify;
  renderPrompt=function(){
    originalRender();if(!prompts.length)return;
    $('counter').textContent=t('wizardCounter',{index:index+1,total:prompts.length,part:index<ids.length?t('wizardWords'):t('wizardSpells'),partIndex:index<ids.length?index+1:index-ids.length+1,partTotal:index<ids.length?ids.length:7});
    $('hint').textContent=t(index<ids.length?'wordHint':'joinedHint');
    $('next').textContent=t(index===prompts.length-1?'wizardFinish':'next');
    preference('wizard-index-v2:'+wizardSpeaker,String(index));wizardGate();
  };
  lock=function(value){originalLock(value);wizardGate();};
  const originalEnded=$('playback').onended;
  $('playback').onended=()=>{originalEnded();wizardGate();};
  $('replay').onclick=async()=>{const take=wizardTake();if(!take||active||starting||finishing)return;if(last!==take)selectTake(take.id);$('playback').currentTime=0;try{await $('playback').play();}catch(e){$('error').textContent=e.message;}};
  verify=async function(){
    const take=wizardTake();if(!take||!take.listened||active||starting||finishing)return;
    if(last!==take)selectTake(take.id);
    // This button explicitly confirms the shown words after listening. A prompt
    // alone is still never a label. Mistakes must be rejected and re-recorded.
    $('kind').value='command';$('transcript').value=canonical(prompts[index].tokens);
    await originalVerify();
    if(take.metadata.review==='verified'){take.metadata.labelMethod='listened-exact-prompt-confirmation';await persist(take);}
    wizardGate();
  };
  $('verify').onclick=verify;
  $('exclude').onclick=async()=>{const take=wizardTake();if(!take||active||starting||finishing)return;take.metadata.review='excluded';await persist(take);$('playback').pause();summary();status('excludedStatus');wizardGate();};
  applyLocale=function(){originalLocale();$('wizard-step').textContent=t('wizardStep',{step:{identity:1,intro:2,recording:3,thanks:4}[wizardScreen]});};
  function loadParticipant(){
    wizardSpeaker=$('speaker').value.trim();prompts=wizardSequence(wizardSpeaker);
    if(preference('wizard-index-v2:'+wizardSpeaker)===null){const old=Number(preference('wizard-index-v1:'+wizardSpeaker))||0;preference('wizard-index-v2:'+wizardSpeaker,String(old>12?old-1:old));}
    index=Math.max(0,Math.min(prompts.length-1,Number(preference('wizard-index-v2:'+wizardSpeaker))||0));renderPrompt();
  }
  $('wizard-continue').onclick=()=>{
    if(!/^[\p{L}\p{N}_-]{1,80}$/u.test($('speaker').value.trim())){error('invalidSpeaker');return;}
    loadParticipant();rememberProfile();wizardShow('intro');
  };
  $('wizard-start').onclick=()=>{
    if(!$('language').value.trim()){error('languageRequired');return;}
    if(!$('consent').checked){error('consentRequired');return;}
    rememberProfile();wizardShow('recording');renderPrompt();
  };
  $('wizard-back').onclick=()=>wizardShow('identity');$('wizard-back-intro').onclick=()=>wizardShow('intro');
  $('previous').onclick=()=>{if(index>0){index--;const take=wizardTake();selectTake(take?.id);renderPrompt();}else wizardShow('intro');};
  $('next').onclick=()=>{
    if(active||starting||finishing||!wizardReviewed(prompts[index]))return;
    if(index<prompts.length-1){index++;const take=wizardTake();selectTake(take?.id);renderPrompt();status('idle');}
    else if(prompts.every(wizardReviewed))wizardShow('thanks');
    else{index=prompts.findIndex(p=>!wizardReviewed(p));renderPrompt();}
  };
  $('wizard-back-recordings').onclick=()=>wizardShow('recording');$('backup').onclick=download;
  loadParticipant();applyLocale();lock(false);wizardShow('identity');
}
const wizardReady=initializeWizard();
