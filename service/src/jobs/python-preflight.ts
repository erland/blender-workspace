import {spawn} from 'node:child_process';
import {parsePythonScript} from './python-script.js';

/**
 * Compile untrusted Python without executing it. The process receives source
 * only on stdin; Python -I does not use user site packages or PYTHONPATH.
 * Do not import bpy or evaluate/exec the user program on the service host.
 */
const CHECKER = `
import json, sys
try:
    source = sys.stdin.buffer.read(65537)
    if len(source) > 65536:
        raise ValueError("Python source exceeds 65536 bytes")
    text = source.decode("utf-8", errors="strict")
    compile(text, "<blender-script>", "exec", dont_inherit=True)
except (SyntaxError, IndentationError, TabError) as error:
    print(json.dumps({"valid": False, "line": error.lineno, "column": error.offset,
                      "message": error.msg}))
    sys.exit(2)
except (UnicodeError, ValueError) as error:
    print(json.dumps({"valid": False, "line": None, "column": None,
                      "message": str(error)}))
    sys.exit(2)
print(json.dumps({"valid": True}))
`;

export class PythonSyntaxError extends Error {
  constructor(
    message:string,
    public readonly line:number|null,
    public readonly column:number|null
  ){
    super(message);
    this.name='PythonSyntaxError';
  }
}

export async function preflightPython(source:string,python='python3'):Promise<void>{
  // Validate content and byte length before spawning a process.
  parsePythonScript({kind:'python_script',code:source});
  return new Promise<void>((resolve,reject)=>{
    let child;
    try {
      child=spawn(python,['-I','-c',CHECKER],{
        stdio:['pipe','pipe','pipe'],
        env:{PATH:process.env.PATH??'/usr/bin:/bin',PYTHONIOENCODING:'utf-8'},
        windowsHide:true
      });
    }catch{
      reject(new Error('Python syntax preflight is unavailable'));
      return;
    }
    let settled=false,output='',stderr='';
    const finish=(error?:Error)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error)reject(error);else resolve();
    };
    const timer=setTimeout(()=>{
      child.kill('SIGKILL');
      finish(new Error('Python syntax preflight timed out'));
    },2000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      output+=chunk;
      if(output.length>4096){
        child.kill('SIGKILL');
        finish(new Error('Invalid Python syntax preflight output'));
      }
    });
    child.stderr.on('data',(chunk:string)=>{
      stderr+=chunk;
      if(stderr.length>4096){
        child.kill('SIGKILL');
        finish(new Error('Python syntax preflight failed'));
      }
    });
    child.on('error',()=>finish(new Error('Python syntax preflight is unavailable')));
    child.on('close',code=>{
      if(settled)return;
      try{
        const verdict=JSON.parse(output);
        if(code===0 && verdict.valid===true){
          finish();
        }else if(code===2 && verdict.valid===false &&
                 typeof verdict.message==='string'){
          const line=Number.isInteger(verdict.line)&&verdict.line>0?verdict.line:null;
          const col=Number.isInteger(verdict.column)&&verdict.column>0?verdict.column:null;
          // No original source or tokens in user-facing diagnostics.
          const short=verdict.message.slice(0,200);
          finish(new PythonSyntaxError(
            `Python syntax error${line!==null?` at line ${line}${col!==null?`, column ${col}`:''}`:''}: ${short}`,
            line,col));
        }else{
          finish(new Error('Python syntax preflight failed'));
        }
      }catch{
        finish(new Error('Python syntax preflight failed'));
      }
    });
    child.stdin.on('error',()=>{}); // Process-exit races are handled by close/error.
    child.stdin.end(source,'utf8');
  });
}
