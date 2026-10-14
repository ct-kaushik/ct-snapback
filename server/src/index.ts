import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { migrate } from './db/index.js';
import { registerApi } from './http/api.js';
import { initScheduler } from './jobs/scheduler.js';
import { log } from './util/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');

async function main() {
  migrate();

  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // up to 2 GB backup zips

  registerApi(app);

  // In production, serve the built SPA and fall back to index.html for client routes.
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.code(200).type('text/html').send('<h1>Coalition Snapback API</h1><p>Run the Vite dev server (npm run dev) and open http://localhost:5173</p>');
    });
  }

  initScheduler();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info(`Server listening on http://localhost:${config.port}`);
  if (!fs.existsSync(webDist)) {
    log.info('Dev mode: open the UI at http://localhost:5173 (Vite proxies /api to this server).');
  }
}

main().catch((err) => {
  log.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
