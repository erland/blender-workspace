import Fastify from 'fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { authorized, type ServiceConfig } from './config.js';

export function createApp(config: ServiceConfig) {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 256 * 1024, trustProxy: false });

  app.get('/health/live', async () => ({ status: 'alive', service: 'blender-workspace' }));
  app.get('/health/ready', async () => ({ status: 'ready', service: 'blender-workspace', integrations: 'not_configured' }));

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.split('?')[0].startsWith('/mcp')) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.publicOrigin) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }
    if (!authorized(request.headers.authorization, config.accessToken)) {
      reply.header('WWW-Authenticate','Bearer realm="blender-workspace"');
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
  });

  app.post('/mcp', async (request, reply) => {
    // One isolated, stateless MCP server and transport for each request.
    const server = new McpServer({ name: 'blender-workspace', version: '0.3.0' });
    server.registerTool('workspace_status', {
      title: 'Blender Workspace status',
      description: 'Read the MCP service status. This scaffold does not yet run Blender or access projects.',
      inputSchema: z.object({})
    }, async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ service: 'blender-workspace', stage: 'DEV-003', blender_jobs_available: false }) }]
    }));
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void transport.close();
      void server.close();
    };
    reply.hijack();
    reply.raw.once('close', close);
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ error }, 'MCP request failure');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type','application/json');
        reply.raw.end(JSON.stringify({ error: 'mcp_internal_error' }));
      } else {
        reply.raw.end();
      }
      close();
    }
  });
  for (const method of ['GET','DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_request, reply) => {
      reply.code(405).header('Allow', 'POST').send({ error:'method_not_allowed' });
    }});
  }
  return app;
}
