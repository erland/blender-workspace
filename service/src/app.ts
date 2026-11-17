import Fastify from 'fastify';
import {McpServer} from '@modelcontextprotocol/server';
import {GoogleOAuthServer} from './auth/google-server.js';
import {NodeStreamableHTTPServerTransport} from '@modelcontextprotocol/node';
import {authorized,type ServiceConfig} from './config.js';
import {registerProjectTools,type ProjectServices} from './mcp/project-tools.js';
import {bearerChallenge,protectedResourceMetadata,remoteJwks,verifyOAuthAccessToken,
 READ_SCOPE,WRITE_SCOPE,type Principal,type Jwks} from './auth/oauth.js';

export function createApp(config:ServiceConfig,
 services?: {ownerKey?:string;projects:ProjectServices['projects'];jobs:ProjectServices['jobs']},
 options?: {keys?:Jwks;google?:GoogleOAuthServer}) {
 if(config.authMode!=='internal'&&!services)throw new Error('OAuth requires project services');
 if(config.authMode==='internal'&&services&&(!config.ownerKey||services.ownerKey!==config.ownerKey))
   throw new Error('Internal owner identity mismatch');
 const app=Fastify({logger:{level:'info'},bodyLimit:256*1024,trustProxy:false});
 const principals=new WeakMap<object,Principal>();
 const keys=config.oauth?(options?.keys??options?.google?.verifierKeys??remoteJwks(config.oauth)):undefined;
 if(config.google&&!options?.google)throw new Error('Google OAuth mode requires an authorization server');

 if(config.oauth) app.get('/.well-known/oauth-protected-resource',
   async()=>protectedResourceMetadata(config.oauth!));
 if(options?.google){
   app.addContentTypeParser('application/x-www-form-urlencoded',
     {parseAs:'string'},(_request,body,done)=>done(null,body));
   const google=options.google;
   app.get('/.well-known/oauth-authorization-server',async()=>google.metadata());
   app.get('/jwks',async(_request,reply)=>{
     reply.header('cache-control','public, max-age=300');return google.jwks;
   });
   app.post('/register',{bodyLimit:16*1024},async(request,reply)=>{
     const answer=await google.register(request.body);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.get('/authorize',async(request,reply)=>{
     const answer=await google.authorize(request.query as Record<string,unknown>);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.get('/auth/google/callback',async(request,reply)=>{
     const answer=await google.callbackLogin(request.query as Record<string,unknown>,request.headers.cookie);
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
   app.post('/token',{bodyLimit:8*1024},async(request,reply)=>{
     if(!(request.headers['content-type']??'').startsWith('application/x-www-form-urlencoded'))
       return reply.code(415).send({error:'invalid_request'});
     const form=new URLSearchParams(typeof request.body==='string'?request.body:'');
     const answer=await google.token(Object.fromEntries(form));
     for(const [key,value] of Object.entries(answer.headers))reply.header(key,value);
     reply.code(answer.status);return answer.body;
   });
 }
 app.get('/health/live',async()=>({status:'alive',service:'blender-workspace'}));
 app.get('/health/ready',async()=>({status:'ready',service:'blender-workspace',
   integrations:services?'project_metadata':'not_configured'}));

 app.addHook('onRequest',async(request,reply)=>{
   if(request.url.split('?')[0]!=='/mcp')return;
   if(request.headers.origin&&request.headers.origin!==config.publicOrigin) {
     reply.code(403).send({error:'origin_not_allowed'});return;
   }
   if(config.oauth) {
     const token=request.headers.authorization?.startsWith('Bearer ')
       ?request.headers.authorization.slice(7):'';
     try {
       if(!token)throw new Error('Missing token');
       principals.set(request,await verifyOAuthAccessToken(token,config.oauth,keys!));
     }catch {
       reply.header('WWW-Authenticate',bearerChallenge(config.oauth))
         .code(401).send({error:'unauthorized'});return;
     }
   }else {
     if(!authorized(request.headers.authorization,config.accessToken)){
       reply.header('WWW-Authenticate','Bearer realm="blender-workspace"')
         .code(401).send({error:'unauthorized'});return;
     }
     if(config.ownerKey)principals.set(request,{ownerKey:config.ownerKey,
       scopes:new Set([READ_SCOPE,WRITE_SCOPE])});
   }
 });

 app.post('/mcp',async(request,reply)=>{
   const server=new McpServer({name:'blender-workspace',version:'0.8.0'});
   server.registerTool('workspace_status',{
     title:'Blender Workspace status',
     description:'Read service capabilities; Modal jobs run in a separate worker.',
     inputSchema:{},
     ...(config.oauth?{_meta:{securitySchemes:[{type:'oauth2' as const,scopes:[READ_SCOPE]}]}}:{})
   },async()=>({content:[{type:'text' as const,text:JSON.stringify({
     service:'blender-workspace',stage:'DEV-008',
     project_tools_available:Boolean(services),blender_jobs_available:false})}]}));
   if(services){
     const principal=principals.get(request);
     if(!principal){reply.code(401).send({error:'unauthorized'});return;}
     registerProjectTools(server,{ownerKey:principal.ownerKey,
       projects:services.projects,jobs:services.jobs},principal.scopes,Boolean(config.oauth),config.oauth?.resource);
   }
   const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined});
   let closed=false;
   const close=()=>{if(closed)return;closed=true;void transport.close();void server.close();};
   reply.hijack();
   reply.raw.once('close',close);
   try {
     await server.connect(transport);
     await transport.handleRequest(request.raw,reply.raw,request.body);
   }catch(error){
     request.log.error({error},'MCP request failure');
     if(!reply.raw.headersSent){
       reply.raw.statusCode=500;reply.raw.setHeader('content-type','application/json');
       reply.raw.end(JSON.stringify({error:'mcp_internal_error'}));
     }else reply.raw.end();
     close();
   }
 });
 for(const method of ['GET','DELETE'] as const){
   app.route({method,url:'/mcp',handler:async(_request,reply)=>{
     reply.code(405).header('Allow','POST').send({error:'method_not_allowed'});
   }});
 }
 return app;
}
