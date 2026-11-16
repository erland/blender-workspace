import pg from 'pg';
const { Pool } = pg;
import { applyMigrations } from './migrations.js';
const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for migrations');
const pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000});
try { console.log('Verified migrations:',(await applyMigrations(pool)).join(', ')); }
finally { await pool.end(); }
