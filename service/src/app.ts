import Fastify from 'fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { authorized, type ServiceConfig } from './config.js';
import { registerProjectTools, type ProjectServices } from './mcp/project-tools.js';

export function createApp(config: ServiceConfig, services?: ProjectServices) {
  if (services && (!config.ownerKey || services.ownerKey !== config.ownerKey)) {
    throw new Error('Configured owner identity must match database service scope');
  }
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 256 * 1024, trustProxy: false });

  app.get('/health/live', async () => ({ status: 'alive', service: 'blender-workspace' }));
  app.get('/health/ready', async () => ({ status: 'ready', service: 'blender-workspace', integrations: services ? 'project_metadata' : 'not_configured' }));

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
    const server = new McpServer({ name: 'blender-workspace', version: '0.7.0' });
    server.registerTool('workspace_status', {
      title: 'Blender Workspace status',
      description: 'Read Blender Workspace service and capabilities. The Modal worker is separate.',
      inputSchema: {}
    }, async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ service: 'blender-workspace', stage: 'DEV-007', project_tools_available: !!services, blender_jobs_available: false }) }]
    }));
    if (services) registerProjectTools(server, services);
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
