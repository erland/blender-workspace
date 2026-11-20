/** Browser-only same-origin archive upload; no credentials embedded. */
export const importClientScript = String.raw`
const form=document.getElementById('import-project-form');
if(form){
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const file=document.getElementById('archive-file').files[0];
    const status=document.getElementById('archive-result');
    if(!file)return;
    if(file.size>128*1024*1024){
      status.textContent='Arkivet får inte vara större än 128 MiB.';return;
    }
    const button=form.querySelector('button');
    button.disabled=true;
    status.textContent='Kontrollerar och importerar arkivet…';
    try{
      const csrf=form.querySelector('input[name=csrf]').value;
      const response=await fetch('/projects/import',{
        method:'POST',credentials:'same-origin',headers:{
          'content-type':'application/vnd.blender-workspace.project+zip',
          'x-csrf-token':csrf
        },body:file
      });
      if(!response.ok)throw new Error('Kunde inte importera arkivet. Kontrollera att filen är en giltig projekt-export.');
      const result=await response.json();
      if(!/^[0-9a-f-]{36}$/i.test(result.projectId))throw new Error('Importens svar var ogiltigt.');
      window.location.assign('/projects/'+result.projectId);
    }catch(error){
      status.textContent=error.message||'Importen misslyckades.';
      button.disabled=false;
    }
  });
}
`;
