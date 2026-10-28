import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeClient } from '../src/native.js';
import { enrichProfile } from '../server/metrics.mjs';
import { createQB } from '../server/qb.mjs';
const profile = { username: 'fixture', role: '1', memberCount: { uploaded: '1000', downloaded: '100', bonus: '25' } };
test('official hourly bonus, online status and absent fields remain distinct', () => {
  const p = { username: 'x', uploaded: 1000, syncedAt: '2026-10-28T00:02:00Z' };
  const v = enrichProfile(
    p,
    { seeder: '524', leecher: '9' },
    { formulaParams: { finalBs: '52.341' } },
    { username: 'x', uploaded: 500, syncedAt: '2026-10-28T00:00:00Z' },
  );
  assert.equal(v.bonusPerHour, 52.341);
  assert.equal(v.bonusPerDay, 1256.184);
  assert.equal(v.onlineSeeders, 524);
  assert.equal(v.accountUploadDelta, 500);
  assert.equal(v.sampleSeconds, 120);
  assert.equal(enrichProfile(p, null, null, null).bonusPerHour, null);
  assert.equal(
    enrichProfile(p, null, null, { username: 'other', uploaded: 0, syncedAt: '2026-10-28T00:00:00Z' })
      .accountUploadDelta,
    null,
  );
});
test('native client validates, persists in secure bridge, hides secrets, caches profiles, restores on independent device', async () => {
  let saved = '',
    requests = 0;
  const call = async (action, args = {}) => {
    if (action === 'read') return saved;
    if (action === 'write') {
      saved = args.value;
      return true;
    }
    requests++;
    const endpoint = new URL(args.url).pathname;
    let data;
    if (endpoint.endsWith('/profile')) {
      if (args.headers['x-api-key'] === 'bad-token') return { status: 403, body: '' };
      data = profile;
    } else if (endpoint.endsWith('myPeerStatistics')) data = { seederCount: '0' };
    else if (endpoint.endsWith('myPeerStatus')) data = { seeder: '4', leecher: '2' };
    else if (endpoint.endsWith('mybonus')) data = { formulaParams: { finalBs: '12.5' } };
    else if (endpoint.endsWith('/search')) data = { data: [], total: 0 };
    else
      return {
        status: 200,
        body: '<rss><channel><item><title>Feed fixture</title><link>https://example.org/a</link></item></channel></rss>',
      };
    return { status: 200, body: JSON.stringify({ code: '0', data }) };
  };
  const api = createNativeClient(call);
  assert.equal((await api('/auth')).native, true);
  assert.equal((await api('/state')).configured, false);
  await api('/connect', {
    method: 'POST',
    body: JSON.stringify({ base: 'https://api.m-team.cc/api', key: 'fixture-secret' }),
  });
  assert.ok(saved.includes('fixture-secret'));
  assert.ok(!JSON.stringify(await api('/state')).includes('fixture-secret'));
  const first = await api('/profile');
  assert.equal(first.bonusPerHour, 12.5);
  assert.equal(first.seeding, 4);
  assert.equal(first.onlineSeeders, 4);
  const count = requests;
  await api('/profile');
  assert.equal(requests, count);
  await assert.rejects(
    api('/connect', { method: 'POST', body: JSON.stringify({ base: 'https://api.m-team.cc/api', key: 'bad-token' }) }),
  );
  assert.ok(saved.includes('fixture-secret'));
  await api('/feeds', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fixture', url: 'https://example.org/feed?sign=secret-sign' }),
  });
  assert.ok(!JSON.stringify(await api('/state')).includes('secret-sign'));
  assert.equal((await api('/resources?source=rss')).items.length, 1);
  await api('/favorites', { method: 'PUT', body: JSON.stringify({ item: { id: 'one', title: 'test' }, saved: true }) });
  const next = createNativeClient(call);
  assert.equal((await next('/state')).favorites.length, 1);
  assert.equal((await next('/state')).configured, true);
  await next('/connect', { method: 'DELETE' });
  assert.equal((await next('/state')).configured, false);
  assert.equal((await next('/state')).feeds.length, 1);
});
test('qBittorrent expired login retries once and never sends mutation commands', async () => {
  const paths = [];
  let gets = 0;
  const query = createQB(async (url, opts) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/login')) {
      assert.ok(opts.body.includes('password=secret'));
      return { status: 200, body: 'Ok.', cookie: 'SID=fixture; HttpOnly' };
    }
    assert.equal(opts.headers.Cookie, 'SID=fixture');
    return ++gets === 1 ? { status: 403, body: '' } : { status: 200, body: '{"up_info_speed":1234}' };
  });
  const data = await query(
    { url: 'http://192.168.1.2:8080', username: 'user', password: 'secret' },
    '/api/v2/transfer/info',
  );
  assert.equal(data.up_info_speed, 1234);
  assert.deepEqual(paths, [
    '/api/v2/auth/login',
    '/api/v2/transfer/info',
    '/api/v2/auth/login',
    '/api/v2/transfer/info',
  ]);
});
test('native storage failure is visible instead of silently losing credentials', async () => {
  const api = createNativeClient(async (action) => {
    if (action === 'read') throw new Error('locked storage');
  });
  await assert.rejects(api('/state'), /locked storage/);
});

test('NAS requires password even on loopback, supports authenticated credential management and logout', async () => {
  const { createApp } = await import('../server/app.mjs');
  let state = { mteam: null, feeds: [], favorites: [] };
  const app = createApp({
    deployment: 'nas',
    adminPassword: 'fixture-long-password',
    publicOrigin: 'http://[fd00::1234]:4173',
    vault: {
      read: () => state,
      write: (v) => {
        state = v;
      },
    },
    requestMT: async () => profile,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Qiliu': '1' };
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const auth = await (await fetch(base + '/api/auth')).json();
    assert.equal(auth.deployment, 'nas');
    assert.equal(auth.authorized, false);
    assert.equal(
      (await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ password: 'wrong' }) }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(base + '/api/login', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.example' },
          body: JSON.stringify({ password: 'fixture-long-password' }),
        })
      ).status,
      403,
    );
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'fixture-long-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const h = { ...headers, Cookie: cookie };
    assert.equal((await fetch(base + '/api/state', { headers: h })).status, 200);
    assert.equal(
      (
        await fetch(base + '/api/connect', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ base: 'https://api.m-team.cc/api', key: 'fixture-native-secret' }),
        })
      ).status,
      200,
    );
    assert.equal((await fetch(base + '/api/pairing', { method: 'POST', headers: h, body: '{}' })).status, 403);
    await fetch(base + '/api/logout', { method: 'POST', headers: h, body: '{}' });
    assert.equal((await fetch(base + '/api/state', { headers: h })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('qBittorrent HTTP transport accepts bracketed IPv6', async () => {
  const { createServer } = await import('node:http');
  const { qbHTTP } = await import('../server/qb.mjs');
  const server = createServer((_req, res) => {
    res.end('{"up_info_speed":42}');
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '::1', resolve);
  });
  try {
    const r = await qbHTTP(`http://[::1]:${server.address().port}/api/v2/transfer/info`);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).up_info_speed, 42);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
