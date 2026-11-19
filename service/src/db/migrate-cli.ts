import pg from 'pg';
const { Pool } = pg;
import { applyMigrations } from './migrations.js';
import {databasePoolConfig} from './pool-config.js';
const connection=databasePoolConfig(process.env,{max:2});
if(!connection)throw new Error('PostgreSQL connection required for migrations');
const pool=new Pool(connection);
try { console.log('Verified migrations:',(await applyMigrations(pool)).join(', ')); }
finally { await pool.end(); }
