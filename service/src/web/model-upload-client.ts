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
 if(!file){status.textContent='Välj en BLEND-, GLB-, PNG- eller JPEG-fil först.';return;}
 if(!/\.(?:blend|glb|png|jpe?g)$/i.test(file.name)){
   status.textContent='Filen måste ha ändelsen .blend, .glb, .png, .jpg eller .jpeg.';return;
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
  if(!response.ok){
   let code='invalid_model';
   try{const body=await response.json();code=body.error||code;}catch{}
   const messages={
    invalid_blend_format:'BLEND-filen känns inte igen. Komprimerade BLEND-filer från Blender stöds.',
    invalid_filename:'Filnamnet måste sluta på .blend, .glb, .png, .jpg eller .jpeg och får inte innehålla sökvägar.',
    invalid_size:'Filen måste vara mellan 20 byte och 32 MiB.',
    library_full:'Ditt filbibliotek är fullt (max 50 filer eller 512 MiB).',
    invalid_texture:'Bildtexturen är ogiltig. Använd en PNG eller JPEG med högst 8192 pixlar per sida.',
    invalid_model:'Filen kunde inte valideras. Kontrollera att det är en riktig BLEND-, GLB-, PNG- eller JPEG-fil.',
    forbidden:'Inloggningen behöver förnyas. Ladda om sidan och försök igen.',
    unauthorized:'Du behöver logga in på nytt.',
    uploads_unavailable:'Uppladdningstjänsten är inte tillgänglig just nu.'
   };
   throw new Error(messages[code]||
     (response.status===413?'Filen är för stor (max 32 MiB).':
     'Uppladdningen misslyckades. Försök igen.'));
  }
  const result=await response.json();
  if(!result.uploadId)throw new Error('Ogiltigt svar från servern.');
  window.location.assign('/models/import');
 }catch(error){status.textContent=error.message||'Uppladdningen misslyckades.';
  submit.disabled=false;}
 });
}
`;
