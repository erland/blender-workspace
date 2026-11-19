import type {PoolConfig} from 'pg';

/**
 * Prefer discrete PostgreSQL settings supplied as Coolify environment variables.
 * DATABASE_URL remains accepted for existing installations, never together with
 * PG* connection variables. Never include credentials in error messages.
 */
export function databasePoolConfig(
  env:NodeJS.ProcessEnv=process.env,
  options:{max?:number}={}
):PoolConfig|undefined{
  const names=['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'];
  const provided=names.filter(name=>env[name]!==undefined);
  const hasUrl=Boolean(env.DATABASE_URL);
  if(hasUrl&&provided.length)throw new Error('Use DATABASE_URL or discrete PostgreSQL settings, not both');
  if(hasUrl)return {connectionString:env.DATABASE_URL,max:options.max??5,connectionTimeoutMillis:5000};
  if(!provided.length)return undefined;
  if(names.some(name=>!env[name]?.trim()))
    throw new Error('PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE are all required');
  const port=Number(env.PGPORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw new Error('Invalid PGPORT');
  return {
    host:env.PGHOST!,port,user:env.PGUSER!,password:env.PGPASSWORD!,
    database:env.PGDATABASE!,max:options.max??5,connectionTimeoutMillis:5000
  };
}
