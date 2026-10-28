const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { brotliCompressSync } = require('node:zlib');
const { createVercelApiProxy } = require('./vercel-proxy');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('Vercel API proxy forwards API requests, cookies, and streamed request bodies without caching', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousApiOrigin = process.env.RIFAD_API_ORIGIN;
  process.env.NODE_ENV = 'test';

  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.stringify({
      method: req.method,
      url: req.url,
      origin: req.headers.origin,
      csrf: req.headers['x-csrf-token'],
      body: Buffer.concat(chunks).toString()
    });
    const compressedBody = brotliCompressSync(body);
    res.setHeader('content-type', 'application/json');
    res.setHeader('content-encoding', 'br');
    res.setHeader('content-length', compressedBody.length);
    res.setHeader('set-cookie', ['rifad.sid=test-session; HttpOnly; SameSite=Strict']);
    res.end(compressedBody);
  });
  const backendAddress = await listen(backend);
  process.env.RIFAD_API_ORIGIN = `http://127.0.0.1:${backendAddress.port}`;

  const proxy = http.createServer(createVercelApiProxy());
  const proxyAddress = await listen(proxy);
  t.after(async () => {
    await close(proxy);
    await close(backend);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousApiOrigin === undefined) delete process.env.RIFAD_API_ORIGIN;
    else process.env.RIFAD_API_ORIGIN = previousApiOrigin;
  });

  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/import/tickets?source=csv`, {
    method: 'POST',
    headers: {
      'content-type': 'text/csv',
      cookie: 'rifad.sid=browser-session',
      origin: 'https://rifad.example',
      'x-csrf-token': 'test-csrf'
    },
    body: 'case_id,description\nR-1,test'
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-encoding'), null);
  assert.match(response.headers.get('set-cookie'), /rifad\.sid=test-session/);
  assert.deepEqual(await response.json(), {
    method: 'POST',
    url: '/api/import/tickets?source=csv',
    origin: 'https://rifad.example',
    csrf: 'test-csrf',
    body: 'case_id,description\nR-1,test'
  });
});

test('Vercel API proxy reports a missing backend configuration clearly', async (t) => {
  const previousApiOrigin = process.env.RIFAD_API_ORIGIN;
  delete process.env.RIFAD_API_ORIGIN;
  const proxy = http.createServer(createVercelApiProxy());
  const proxyAddress = await listen(proxy);
  t.after(async () => {
    await close(proxy);
    if (previousApiOrigin === undefined) delete process.env.RIFAD_API_ORIGIN;
    else process.env.RIFAD_API_ORIGIN = previousApiOrigin;
  });

  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/session`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /RIFAD_API_ORIGIN/);
});
