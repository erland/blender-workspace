import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function applyMigrations(pool: Pool, dir = path.join(process.cwd(), 'migrations')) {
  const files = (await readdir(dir)).filter(x => /^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort();
  if (!files.length) throw new Error('No SQL migrations found');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(712394,41004)');
    await client.query(`CREATE TABLE IF NOT EXISTS bw_schema_migrations(
      filename text PRIMARY KEY, checksum_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const filename of files) {
      const sql = await readFile(path.join(dir, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = await client.query<{ checksum_sha256:string }>(
        'SELECT checksum_sha256 FROM bw_schema_migrations WHERE filename=$1',[filename]);
      if (old.rowCount) {
        if (old.rows[0].checksum_sha256!==checksum) throw new Error(`Migration drift: ${filename}`);
      } else {
        await client.query(sql);
        await client.query('INSERT INTO bw_schema_migrations(filename,checksum_sha256) VALUES($1,$2)',[filename,checksum]);
      }
    }
    await client.query('COMMIT');
    return files;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
