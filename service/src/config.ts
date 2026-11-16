import { timingSafeEqual } from 'node:crypto';

export interface ServiceConfig {
  host: string;
  port: number;
  accessToken: string;
  publicOrigin: string;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const accessToken = env.MCP_ACCESS_TOKEN ?? '';
  if (accessToken.length < 32) throw new Error('MCP_ACCESS_TOKEN must contain at least 32 characters');
  const publicOrigin = env.PUBLIC_ORIGIN ?? '';
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN required (for example https://blender.example.org)');
  const url = new URL(publicOrigin);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin, or localhost HTTP for tests');
  }
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { host: env.HOST ?? '0.0.0.0', port, accessToken, publicOrigin: url.origin };
}
export function authorized(header: string | undefined, token: string): boolean {
  const value = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(value), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a,b);
}
