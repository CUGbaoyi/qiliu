import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.mjs';
test('NAS LAN and named HTTPS proxy both authenticate without trusting arbitrary hosts', async () => {
  const app = createApp({
    deployment: 'nas',
    adminPassword: 'fixture-password-long',
    publicOrigin: 'http://192.168.1.10:4173',
    additionalOrigins: ['https://remote-access-4173.zconnect.cn'],
    vault: { read: () => ({ feeds: [], favorites: [] }), write: () => {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const request = (host, origin) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path: '/api/login',
          method: 'POST',
          headers: { Host: host, Origin: origin, 'X-Qiliu': '1', 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0] || '' }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ password: 'fixture-password-long' }));
    });
  try {
    const lan = await request('192.168.1.10:4173', 'http://192.168.1.10:4173');
    assert.equal(lan.status, 200);
    assert.ok(!lan.cookie.includes('Secure'));
    const proxy = await request('remote-access-4173.zconnect.cn', 'https://remote-access-4173.zconnect.cn');
    assert.equal(proxy.status, 200);
    assert.ok(proxy.cookie.includes('Secure'));
    assert.equal((await request('evil.example', 'https://evil.example')).status, 403);
    assert.equal((await request('remote-access-4173.zconnect.cn', 'https://evil.example')).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
