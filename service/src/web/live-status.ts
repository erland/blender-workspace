/** Same-origin, no-token polling of server-rendered status fragments.
 * Only replace bounded job/render containers; no navigation, reload or form reset.
 * This is intentionally separate from the GLB viewer's own render polling.
 */
export const liveStatusScript = String.raw`'use strict';
(() => {
  const url=location.pathname+location.search;
  const jobsPage=location.pathname==='/jobs';
  const regions=jobsPage
    ? ['live-job-sections','live-job-completed']
    : location.search.includes('view=history')
      ? ['live-project-model-jobs']
      : location.search.includes('view=images')
        ? ['live-project-render-jobs'] : [];
  if(!regions.length)return;
  const notice=document.getElementById('live-update-message');
  let busy=false, lastError=false;
  const archive=document.getElementById('live-job-archive');
  async function refresh(){
    if(busy||document.hidden)return;
    busy=true;
    try{
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'follow'});
      if(!response.ok||new URL(response.url).pathname!==location.pathname)
        throw new Error('Could not refresh job status');
      const page=new DOMParser().parseFromString(await response.text(),'text/html');
      for(const id of regions){
        const current=document.getElementById(id),incoming=page.getElementById(id);
        if(!current||!incoming)throw new Error('Status view is unavailable');
        // Skip identical HTML and the currently focused section. The latter
        // avoids stealing keyboard focus during an automatic status update.
        if(current.innerHTML!==incoming.innerHTML&&!current.contains(document.activeElement)){
          current.replaceChildren(...Array.from(incoming.childNodes).map(n=>document.importNode(n,true)));
        }
      }
      if(archive){
        const fresh=page.getElementById('live-job-archive');
        if(!fresh)throw new Error('Job archive is unavailable');
        const currentLabel=archive.querySelector('summary');
        const freshLabel=fresh.querySelector('summary');
        if(currentLabel&&freshLabel)currentLabel.textContent=freshLabel.textContent;
        // Archive open/closed state stays exactly as the user left it.
      }
      if(notice&&(lastError||notice.textContent==='Kunde inte uppdatera status. Försöker igen.'))
        notice.textContent='Jobbstatus uppdateras automatiskt utan att sidan laddas om.';
      lastError=false;
    }catch{
      lastError=true;
      if(notice)notice.textContent='Kunde inte uppdatera status. Försöker igen.';
    }finally{busy=false;}
  }
  const timer=setInterval(()=>{void refresh();},10000);
  const visible=()=>{if(!document.hidden)void refresh();};
  document.addEventListener('visibilitychange',visible);
  window.addEventListener('pagehide',()=>{
    clearInterval(timer);
    document.removeEventListener('visibilitychange',visible);
  },{once:true});
})();`;
