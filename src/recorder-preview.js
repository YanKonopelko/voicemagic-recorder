'use strict';
// Video is a self-contained illustration of the REQUESTED recipe, not an ASR
// result or captured gameplay. It never contains sound or accesses the microphone.
const spellPreview=(()=>{
 const elements=['Ign','Una','Num','Vae'],forms=['Shu','Rem','Dum','Vir'],features=['None','Twi','Tik','Bom'];
 const video=$('spell-preview-video'),panel=$('spell-preview');let currentKey='',url=null,resumeAfterCapture=false,serial=0;
 function recipeFor(tokens){
  if(!tokens||![3,4].includes(tokens.length)||tokens.at(-1)!=='Ka'||!elements.includes(tokens[0])||!forms.includes(tokens[1]))return null;
  const feature=tokens.length===4?tokens[2]:'None';if(!features.includes(feature))return null;
  return {key:[tokens[0],tokens[1],feature].join('-'),element:elements.indexOf(tokens[0]),form:forms.indexOf(tokens[1]),feature:features.indexOf(feature)};
 }
 function play(){if(!matchMedia('(prefers-reduced-motion: reduce)').matches)video.play().catch(()=>{});}
 function update(prompt,visible,busy){
  const recipe=recipeFor(prompt?.tokens);panel.hidden=!visible||!recipe;
  if(panel.hidden){video.pause();resumeAfterCapture=false;return;}
  const names=messages[locale];$('spell-preview-title').textContent=t('previewTitle');
  $('spell-preview-description').textContent=[names.previewElements[recipe.element],names.previewForms[recipe.form],names.previewFeatures[recipe.feature]].filter(Boolean).join(' · ');
  $('spell-preview-note').textContent=t('previewNote');video.setAttribute('aria-label',$('spell-preview-description').textContent);
  if(recipe.key!==currentKey){
   video.pause();if(url)URL.revokeObjectURL(url);url=null;currentKey=recipe.key;const version=++serial;
   const bytes=Uint8Array.from(atob(spellPreviewVideos[currentKey]),c=>c.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
   video.src=url;video.muted=true;video.onloadeddata=()=>{if(version===serial&&!panel.hidden&&!active&&!starting&&!finishing)play();};resumeAfterCapture=false;
  }
  if(busy){resumeAfterCapture=resumeAfterCapture||!video.paused;video.pause();}
  else if(resumeAfterCapture){resumeAfterCapture=false;play();}
 }
 video.addEventListener('volumechange',()=>{if(!video.muted)video.muted=true;});
 video.addEventListener('play',()=>{if(active||starting||finishing||panel.hidden)video.pause();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();resumeAfterCapture=false;}});
 return {recipeFor,update};
})();
