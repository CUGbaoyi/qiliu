import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createQBClient } from '../server/qb-client.mjs';
import { qbHTTP } from '../server/qb.mjs';
import { createDownloads } from '../server/downloads.mjs';
const config = { url: 'http://localhost:8080', username: 'fixture', password: 'fixture-secret' };

test('204 login keeps the port-named cookie and reauthenticates once after 401', async () => {
  let logins = 0,
    reads = 0;
  const query = createQBClient(async (url, options) => {
    if (url.endsWith('/login')) {
      logins++;
      return { status: 204, body: '', cookie: 'QBT_SID_8080=fixture; HttpOnly; SameSite=Strict' };
    }
    assert.equal(options.headers.Cookie, 'QBT_SID_8080=fixture');
    if (++reads === 1) return { status: 401, body: 'Unauthorized' };
    return { status: 200, body: '{"up_info_speed":42}' };
  });
  assert.equal((await query(config, '/api/v2/transfer/info')).up_info_speed, 42);
  assert.equal(logins, 2);
  await query(config, '/api/v2/transfer/info');
  assert.equal(logins, 2);
});

test('login failures remain failures and never expose secrets', async () => {
  for (const [status, body, pattern] of [
    [200, 'Fails.', /拒绝了登录/],
    [401, 'Unauthorized', /拒绝了登录/],
    [403, 'Forbidden', /访问限制/],
    [404, 'missing', /HTTP 404/],
    [200, '<html>proxy</html>', /响应不兼容/],
  ]) {
    let requests = 0;
    const query = createQBClient(async () => {
      requests++;
      return { status, body };
    });
    await assert.rejects(
      query(config, '/api/v2/transfer/info'),
      (e) => pattern.test(e.message) && !e.message.includes(config.password),
    );
    assert.equal(requests, 1);
  }
});

test('HTTP transport uses the exact UTF-8/binary content length, never chunked', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: Buffer.concat(parts) });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v2/auth/login`;
    const body = '用户名=fixture',
      binary = Buffer.from([0, 128, 255, 13, 10]);
    await qbHTTP(url, { method: 'POST', body });
    await qbHTTP(url, { method: 'POST', bodyBase64: binary.toString('base64') });
    assert.deepEqual(
      seen.map((r) => r.body),
      [Buffer.from(body), binary],
    );
    for (const r of seen) {
      assert.equal(Number(r.headers['content-length']), r.body.length);
      assert.equal(r.headers['transfer-encoding'], undefined);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('204 add response verifies task presence, does not claim download started', async () => {
  const bytes = Buffer.from('d4:infod6:lengthi0e4:name7:fixture12:piece lengthi16384e6:pieces0:ee');
  const query = createQBClient(async (url) =>
    url.endsWith('/login')
      ? { status: 204, body: '', cookie: 'QBT_SID_8080=x' }
      : url.endsWith('/add')
        ? { status: 204, body: '' }
        : { status: 200, body: '[]' },
  );
  const send = createDownloads({ query, resolveSource: async () => '', fetchTorrent: async () => bytes });
  assert.equal((await send(config, { id: 'mt-123' })).status, 'pending');
});
