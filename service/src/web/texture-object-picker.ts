/** Owner-only scene mesh lookup. Never issues a modeling job. */
export const textureObjectPickerScript=String.raw`
(()=>{
 const form=document.getElementById('apply-texture-form');
 if(!form)return;
 const project=document.getElementById('texture-project');
 const object=document.getElementById('texture-object');
 const revision=document.getElementById('texture-source-revision');
 const status=document.getElementById('texture-object-status');
 const submit=form.querySelector('button[type=submit]');
 let generation=0;
 async function refresh(){
  const seq=++generation;
  object.replaceChildren(new Option('Hämtar objekt…',''));
  object.disabled=true;submit.disabled=true;revision.value='';
  status.textContent='Hämtar mesh-objekt från projektets senaste sparade revision…';
  try{
   const response=await fetch('/models/api/projects/'+encodeURIComponent(project.value)+'/mesh-objects',{
    credentials:'same-origin',headers:{accept:'application/json'}});
   if(seq!==generation)return;
   if(!response.ok)throw new Error(response.status===409?
    'Scenens objektlista går inte att läsa. Kontrollera att senaste revisionen har en scenrapport.':
    'Objekten kunde inte hämtas. Försök välja projektet igen.');
   const data=await response.json();
   if(!Number.isSafeInteger(data.revision)||data.revision<1||
       !Array.isArray(data.objects)||data.objects.length>10000)throw new Error('Ogiltig objektlista.');
   const names=data.objects.filter(name=>typeof name==='string'&&name.length<=200&&name.length>0);
   if(names.length!==data.objects.length)throw new Error('Ogiltig objektlista.');
   object.replaceChildren(new Option(names.length?'Välj mesh-objekt':'Inga mesh-objekt i revisionen',''));
   for(const name of names)object.add(new Option(name,name));
   revision.value=String(data.revision);
   object.disabled=names.length===0;
   status.textContent=names.length?
    names.length+' objekt hittades i revision '+data.revision+'. Välj objektet som ska få texturen.':
    'Revision '+data.revision+' innehåller inga mesh-objekt som kan få en bildtextur.';
   submit.disabled=names.length===0;
  }catch(error){
   if(seq!==generation)return;
   object.replaceChildren(new Option('Objektlistan kunde inte hämtas',''));
   status.textContent=error.message||'Objektlistan kunde inte hämtas.';
  }
 }
 project.addEventListener('change',refresh);
 form.addEventListener('submit',event=>{
  if(object.disabled||!object.value||!revision.value){
   event.preventDefault();status.textContent='Välj ett mesh-objekt innan du fortsätter.';
  }
 });
 refresh();
})();
`;
