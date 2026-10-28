const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifad-deployment-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'rifad.sqlite');
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'test-only-session-secret-that-is-long-enough';
process.env.SERVE_CLIENT = 'false';

const app = require('./index');
const db = require('./db');

test('production API-only deployment does not require the Vite dist directory', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/session`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 404);
});
