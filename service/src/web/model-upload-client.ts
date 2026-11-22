/** Same-origin upload; session cookie is handled by the browser. */
export const modelUploadScript=String.raw`
const form=document.getElementById('upload-model-form');
if(form){
 const picker=document.getElementById('model-file');
 const status=document.getElementById('model-upload-result');
 picker.addEventListener('change',()=>{
  const file=picker.files&&picker.files[0];
  status.textContent=file?'Vald fil: '+file.name:'Ingen fil vald.';
 });
 form.addEventListener('submit',async event=>{
 event.preventDefault();
 const file=document.getElementById('model-file').files[0];
 const status=document.getElementById('model-upload-result');
 if(!file){status.textContent='Välj en BLEND- eller GLB-fil först.';return;}
 if(!/\.(?:blend|glb)$/i.test(file.name)){
   status.textContent='Filen måste ha ändelsen .blend eller .glb.';return;
 }
 if(file.size<20||file.size>32*1024*1024){
   status.textContent='Välj en fil mellan 20 byte och 32 MiB.';return;
 }
 const submit=form.querySelector('button');submit.disabled=true;
 status.textContent='Laddar upp och kontrollerar filen…';
 try{
  const response=await fetch('/models/uploads',{method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/vnd.blender-workspace.model',
    'x-model-filename':encodeURIComponent(file.name),
    'x-csrf-token':form.querySelector('input[name=csrf]').value},body:file});
  if(!response.ok)throw new Error('Filen kunde inte sparas. Kontrollera formatet och försök igen.');
  const result=await response.json();
  if(!result.uploadId)throw new Error('Ogiltigt svar från servern.');
  window.location.assign('/models/import');
 }catch(error){status.textContent=error.message||'Uppladdningen misslyckades.';
  submit.disabled=false;}
 });
}
`;
