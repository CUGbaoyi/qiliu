import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeProfile,
  normalizeTorrent,
  shareRatio,
  parseFeed,
  mergeResources,
  safeLink,
} from '../server/model.mjs';
import { isPublicIP, validateURL, mtRequest } from '../server/network.mjs';
import { createVault } from '../server/vault.mjs';
import { createApp } from '../server/app.mjs';
import { enrichProfile } from '../server/metrics.mjs';

const profile = {
  username: 'fixture-user',
  role: '2',
  memberCount: { uploaded: '10240', downloaded: '2048', shareRate: '5.12', bonus: '103.5' },
  memberStatus: { warned: false },
  invites: '1',
};
const feed = { id: 'test', name: '测试订阅' };
const xml =
  '<rss version="2.0"><channel><title>Test</title><item><guid>123</guid><title>Sample 2160p</title><link>https://kp.m-team.cc/detail/123</link><category>Movie</category><description><![CDATA[<p>Safe text<br/>next</p><img src="https://images.example.com/cover.jpg"/><script>alert(1)</script>]]></description><enclosure length="2048" url="https://example.com/download"/><pubDate>Wed, 28 Oct 2026 01:00:00 GMT</pubDate></item></channel></rss>';
test('profile maps real schema, preserves site ratio and missing values', () => {
  const p = normalizeProfile(profile, { seederCount: '0', seederSize: '0' });
  assert.equal(p.uploaded, 10240);
  assert.equal(p.ratio, 5.12);
  assert.equal(p.seeding, 0);
  assert.equal(p.assessment, null);
  assert.equal(p.role, 'Power User');
  assert.equal(p.warned, false);
  assert.equal(p.invites, 1);
  assert.equal(normalizeProfile(profile).seeding, null);
});
test('seeding count prefers tracker status when peer statistics return zero', () => {
  const p = enrichProfile(
    { seeding: 0, seedingSize: 0 },
    { seeder: '525', leecher: '8' },
    { formulaParams: { finalBs: '12.5' } },
    null,
  );
  assert.equal(p.seeding, 525);
  assert.equal(p.onlineLeechers, 8);
  assert.equal(p.bonusPerHour, 12.5);
});
test('ratio handles zero, absent fields, infinity and site supplied values', () => {
  assert.equal(shareRatio(10, 0), '∞');
  assert.equal(shareRatio(0, 0), null);
  assert.equal(shareRatio(null, 0), null);
  assert.equal(shareRatio(8, 2), 4);
  assert.equal(shareRatio(8, 2, '0'), 0);
  assert.equal(shareRatio(8, 2, 'NaN'), 4);
});
test('incompatible account payload fails rather than inventing data', () =>
  assert.throws(() => normalizeProfile({ username: 'x' })));
test('torrent normalization handles free promotion priority and zeros', () => {
  const row = normalizeTorrent({
    id: '123',
    name: 'movie 2160p',
    standard: '6',
    status: { seeders: '0', discount: 'FREE', promotionRule: { discount: 'NORMAL' } },
    size: '1024',
    imageList: ['javascript:bad'],
  });
  assert.equal(row.free, false);
  assert.equal(row.seeders, 0);
  assert.equal(row.image, null);
  assert.equal(row.resolution, '4K');
  assert.equal(row.url, 'https://kp.m-team.cc/detail/123');
  assert.equal(normalizeTorrent({ id: 2, status: { discount: '_2X_FREE' } }).free, true);
});
test('RSS supports pictures and public metadata without rendering HTML', () => {
  const rows = parseFeed(xml, feed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'mt-123');
  assert.equal(rows[0].size, 2048);
  assert.equal(rows[0].category, '419');
  assert.equal(rows[0].image, 'https://images.example.com/cover.jpg');
  assert.ok(!rows[0].description.includes('<script>'));
  assert.equal(rows[0].free, false);
  assert.equal(rows[0].seeders, null);
});
test('Atom and empty feeds supported', () => {
  const atom =
    '<feed><entry><id>x</id><title>Atom</title><link href="https://example.com/entry" rel="alternate"/><summary>hello</summary></entry></feed>';
  assert.equal(parseFeed(atom, feed)[0].url, 'https://example.com/entry');
  assert.equal(parseFeed('<rss><channel><title>Empty</title></channel></rss>', feed).length, 0);
});
test('encoded RSS HTML produces cover and plain text', () => {
  const xml =
    '<rss><channel><item><title>A &amp; B</title><description>&lt;p&gt;Summary&lt;/p&gt;&lt;img src=&quot;https://example.com/a.jpg&quot;/&gt;</description></item></channel></rss>';
  const item = parseFeed(xml, feed)[0];
  assert.equal(item.image, 'https://example.com/a.jpg');
  assert.equal(item.title, 'A & B');
  assert.equal(item.description.trim(), 'Summary');
});
test('reject DTD, malformed XML and nonfeeds', () => {
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "x">]><rss/>', feed));
  assert.throws(() => parseFeed('<rss>', feed));
  assert.throws(() => parseFeed('<html/>', feed));
});
test('merge duplicate resource IDs retains API stats and RSS description', () => {
  const mt = normalizeTorrent({ id: '123', name: 'name', status: { seeders: 55 } });
  const rows = mergeResources([mt, ...parseFeed(xml, feed)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seeders, 55);
  assert.equal(rows[0].feedId, 'test');
  assert.ok(rows[0].description.length > 10);
});
test('URL sanitizer refuses executable and credential-bearing links', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,foo', 'http://example.com', 'https://user:pass@example.com'])
    assert.equal(safeLink(u), null);
  assert.equal(safeLink('https://example.com/a'), 'https://example.com/a');
});
test('SSRF guard rejects local, private, mapped, link-local IPs', () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '172.16.3.4',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicIP(ip), false, ip);
  assert.equal(isPublicIP('8.8.8.8'), true);
  assert.equal(isPublicIP('2606:4700:4700::1111'), true);
});
test('URL validation blocks schemes, private literals, ports and userinfo', () => {
  for (const u of [
    'http://example.com',
    'file:///etc/passwd',
    'https://127.0.0.1',
    'https://[::1]',
    'https://example.com:444',
    'https://x:y@example.com',
  ])
    assert.throws(() => validateURL(u));
  assert.equal(validateURL('https://example.com/feed?a=b').hostname, 'example.com');
});
test('M-Team credentials can only be sent to allowlisted endpoints', async () => {
  await assert.rejects(() => mtRequest({ base: 'https://example.com', key: 'fixture-key' }, '/member/profile'));
});
test('vault encrypts credentials, restricts permissions and roundtrips', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qiliu-vault-'));
  try {
    const v = createVault(dir);
    v.write({ mteam: { key: 'secret-fixture' }, feeds: [], favorites: [] });
    assert.equal(v.read().mteam.key, 'secret-fixture');
    assert.ok(!readFileSync(path.join(dir, 'vault.enc')).includes('secret-fixture'));
    assert.equal(statSync(path.join(dir, 'local.key')).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP integration: secret redaction, atomic connect, caching, RSS, favorites, CSRF, pairing', async (t) => {
  let config = { mteam: null, feeds: [], favorites: [] },
    local = true,
    calls = 0,
    failProfile = false;
  const app = createApp({
    vault: {
      read: () => config,
      write: (v) => {
        config = structuredClone(v);
      },
    },
    isLocalRequest: () => local,
    requestFeed: async () => xml,
    requestMT: async (c, endpoint) => {
      calls++;
      if (c.key === 'invalid-fixture' || failProfile) throw new Error('fixture failure');
      if (endpoint === '/member/profile') return profile;
      if (endpoint === '/tracker/myPeerStatistics') return { seederCount: '7', seederSize: '3000' };
      return { data: [{ id: 123, name: 'Sample 2160p', size: '2048', status: { seeders: 4 } }], total: 1 };
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', (error) => {
      throw error;
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body, headers = {}) => {
    const r = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Qiliu': '1', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  try {
    await t.test('invalid credentials not saved', async () => {
      assert.equal(
        (await request('/api/connect', 'POST', { base: 'https://api.m-team.cc/api', key: 'invalid-fixture' })).status,
        400,
      );
      assert.equal(config.mteam, null);
    });
    await t.test('valid connect redacts key and private links from state', async () => {
      assert.equal(
        (await request('/api/connect', 'POST', { base: 'https://api.m-team.cc/api', key: 'secret-fixture' })).status,
        200,
      );
      const r = await request('/api/state');
      assert.equal(r.data.configured, true);
      assert.ok(!JSON.stringify(r.data).includes('secret-fixture'));
      assert.equal(r.headers.get('cache-control'), 'no-store');
    });
    await t.test('profile uses cache and actual peer statistics', async () => {
      const a = await request('/api/profile');
      const before = calls;
      const b = await request('/api/profile');
      assert.equal(a.data.seeding, 7);
      assert.equal(b.data.ratio, 5.12);
      assert.equal(calls, before);
    });
    await t.test('failed replacement keeps existing credentials', async () => {
      await request('/api/connect', 'POST', { base: 'https://api.m-team.cc/api', key: 'invalid-fixture' });
      assert.equal(config.mteam.key, 'secret-fixture');
    });
    await t.test('RSS addition validates and conceals signed URL', async () => {
      const r = await request('/api/feeds', 'POST', {
        name: 'fixture feed',
        url: 'https://example.com/rss?sign=fixture-private',
      });
      assert.equal(r.status, 200);
      const state = await request('/api/state');
      assert.equal(state.data.feeds.length, 1);
      assert.ok(!JSON.stringify(state.data).includes('fixture-private'));
    });
    await t.test('resources merge duplicates, with cached search', async () => {
      const a = await request('/api/resources');
      const before = calls;
      const b = await request('/api/resources');
      assert.equal(a.data.items.length, 1);
      assert.equal(a.data.items[0].seeders, 4);
      assert.equal(calls, before);
      assert.equal(b.data.warnings.length, 0);
    });
    await t.test('favorite add and remove persists', async () => {
      const item = { id: 'fixture-favorite', title: 'Test', url: null };
      await request('/api/favorites', 'PUT', { item, saved: true });
      assert.equal((await request('/api/state')).data.favorites.length, 1);
      await request('/api/favorites', 'PUT', { item, saved: false });
      assert.equal((await request('/api/state')).data.favorites.length, 0);
    });
    await t.test('foreign origin and missing header mutations are blocked', async () => {
      assert.equal((await request('/api/pairing', 'POST', {}, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await request('/api/pairing', 'POST', {}, { 'X-Qiliu': '' })).status, 403);
    });
    await t.test('bad host rejected even for a local request', async () => {
      const status = await new Promise((resolve, reject) => {
        const r = httpRequest(base + '/api/state', { headers: { Host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        r.on('error', reject);
        r.end();
      });
      assert.equal(status, 403);
    });
    await t.test('remote pairing grants read access but not credential management', async () => {
      const p = await request('/api/pairing', 'POST', {});
      local = false;
      assert.equal((await request('/api/state')).status, 401);
      assert.equal((await request('/api/pair', 'POST', { code: 'wrong' })).status, 401);
      const paired = await request('/api/pair', 'POST', { code: p.data.code });
      assert.equal(paired.status, 200);
      const cookie = paired.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/api/state', 'GET', null, { Cookie: cookie })).status, 200);
      assert.equal((await request('/api/connect', 'DELETE', {}, { Cookie: cookie })).status, 403);
      assert.equal((await request('/api/pair', 'POST', { code: p.data.code })).status, 401);
      local = true;
      await request('/api/revoke', 'POST', {});
      local = false;
      assert.equal((await request('/api/state', 'GET', null, { Cookie: cookie })).status, 401);
      local = true;
    });
    await t.test('disconnect removes only M-Team and retains RSS', async () => {
      await request('/api/connect', 'DELETE', {});
      const r = await request('/api/state');
      assert.equal(r.data.configured, false);
      assert.equal(r.data.feeds.length, 1);
      assert.equal((await request('/api/profile')).status, 409);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
