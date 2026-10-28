import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDownloads, torrentHash, torrentMultipart, fromBase64, toBase64 } from '../server/downloads.mjs';
import { normalizeQB, createQBClient, qbTasks } from '../server/qb-client.mjs';
import { parseFeed, publicResource } from '../server/model.mjs';
import { downloadCompleted } from '../server/downloads.mjs';
import { createNativeClient } from '../src/native.js';
import { createApp } from '../server/app.mjs';
const info = Buffer.from('d6:lengthi0e4:name7:fixture12:piece lengthi16384e6:pieces0:e');
const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
const hash = createHash('sha1').update(info).digest('hex');
const qb = { url: 'http://[2001:db8::1234]:18080', username: 'fixture-user', password: 'fixture-password' };
const task = {
  hash,
  name: 'fixture',
  state: 'downloading',
  progress: 0.25,
  save_path: '/downloads',
  size: 4096,
  upspeed: 10,
  dlspeed: 20,
};

test('public IPv6 HTTP configuration is allowed; credentials/query/invalid URLs rejected', () => {
  assert.equal(normalizeQB({ ...qb, url: '  http://[2001:db8::1234]:18080/  ' }).url, qb.url);
  for (const url of [
    'ftp://example.com',
    'http://user:secret@example.com',
    'http://2001:db8::1234:18080',
    'http://example.com?password=secret',
  ])
    assert.throws(() => normalizeQB({ url }));
});
test('exact torrent info bytes are hashed, malformed HTML and pure v2 are rejected', () => {
  assert.equal(torrentHash(torrent), hash);
  for (const value of [
    '<html>login</html>',
    'd4:infoi3ee',
    'd4:infod4:name1:xee',
    'd4:infole',
    'd4:infod6:pieces0:e4:infod6:pieces0:ee',
  ])
    assert.throws(() => torrentHash(Buffer.from(value)));
  assert.throws(() => torrentHash(new Uint8Array(4 * 1024 * 1024 + 1)));
});
test('multipart preserves binary bytes and never skips checking or changes seeding limits', () => {
  const bytes = Buffer.concat([torrent, Buffer.from([0, 128, 255])]);
  const request = torrentMultipart(bytes, { savePath: '/downloads/中文', category: '电影', paused: true });
  const encoded = Buffer.from(fromBase64(request.bodyBase64));
  assert.ok(encoded.includes(bytes));
  assert.ok(encoded.includes(Buffer.from('/downloads/中文')));
  assert.match(encoded.toString(), /name="paused"\r\n\r\ntrue/);
  assert.match(encoded.toString(), /name="stopped"\r\n\r\ntrue/);
  assert.match(encoded.toString(), /name="skip_checking"\r\n\r\nfalse/);
  assert.doesNotMatch(encoded.toString(), /ratioLimit|seedingTimeLimit/);
  assert.throws(() => torrentMultipart(torrent, { savePath: '/downloads\r\ninject' }));
});
test('adding verifies hash and result, suppresses concurrent and existing duplicates', async () => {
  let added = false,
    adds = 0;
  const send = createDownloads({
    resolveSource: async () => 'https://example.org/fixture',
    fetchTorrent: async () => torrent,
    query: async (_config, path, opts) => {
      if (path.includes('/info?')) return added ? [task] : [];
      assert.equal(path, '/api/v2/torrents/add');
      assert.equal(opts.method, 'POST');
      adds++;
      added = true;
      return 'Ok.';
    },
  });
  const input = { id: 'mt-123', savePath: '/downloads' };
  const [a, b] = await Promise.all([send(qb, input), send(qb, input)]);
  assert.equal(a.status, 'added');
  assert.equal(b.status, 'added');
  assert.equal(adds, 1);
  const c = await send(qb, input);
  assert.equal(c.status, 'existing');
  assert.equal(c.task.state, 'downloading');
  assert.equal(adds, 1);
  await assert.rejects(send(qb, { ...input, demo: true }), /真实资源/);
});
test('uncertain and rejected submissions never report started', async () => {
  for (const response of ['Ok.', 'Fails.']) {
    const send = createDownloads({
      resolveSource: async () => '',
      fetchTorrent: async () => torrent,
      query: async (_c, p) => (p.includes('/info?') ? [] : response),
    });
    if (response === 'Ok.') assert.equal((await send(qb, { id: 'mt-123' })).status, 'pending');
    else await assert.rejects(send(qb, { id: 'mt-123' }), /拒绝/);
  }
  const send = createDownloads({
    resolveSource: async () => '',
    fetchTorrent: async () => torrent,
    query: async (_c, p) => {
      if (p.includes('/info?')) return [];
      throw new Error('timeout');
    },
  });
  await assert.rejects(send(qb, { id: 'mt-123' }), /提交结果未确认/);
});
test('login shared; expired session retries POST without losing binary payload', async () => {
  let logins = 0,
    posts = 0;
  const request = torrentMultipart(torrent);
  const client = createQBClient(async (url, opts) => {
    if (url.endsWith('/login')) {
      logins++;
      await new Promise((r) => setTimeout(r, 5));
      return { status: 200, body: 'Ok.', cookie: 'SID=x' };
    }
    if (url.endsWith('/add')) {
      assert.equal(opts.bodyBase64, request.bodyBase64);
      assert.equal(opts.method, 'POST');
      return { status: ++posts === 1 ? 403 : 200, body: 'Ok.' };
    }
    return { status: 200, body: '{}' };
  });
  await Promise.all([client(qb, '/api/v2/transfer/info'), client(qb, '/api/v2/transfer/info')]);
  assert.equal(logins, 1);
  assert.equal(await client(qb, '/api/v2/torrents/add', request), 'Ok.');
  assert.equal(logins, 2);
  assert.equal(posts, 2);
});
test('RSS enclosure is resolved internally and excluded from public resources', () => {
  const xml =
    '<rss><channel><item><guid>id1</guid><title>Fixture</title><link>https://kp.m-team.cc/detail/123</link><enclosure url="https://rss.m-team.cc/api/rss/dlv2?sign=fixture-secret" type="application/x-bittorrent"/></item></channel></rss>';
  const row = parseFeed(xml, { id: 'feed', name: 'RSS' })[0];
  assert.equal(row.id, 'mt-123');
  assert.equal(row.downloadable, true);
  assert.match(row.downloadUrl, /fixture-secret/);
  assert.ok(!JSON.stringify(publicResource(row)).includes('fixture-secret'));
});
test('native: IPv6 login, token form, binary download, add, persist and hide password', async () => {
  let saved = JSON.stringify({
      mteam: { base: 'https://api.m-team.cc/api', key: 'fixture-token' },
      feeds: [],
      favorites: [],
      qb: null,
    }),
    added = false;
  const api = createNativeClient(async (action, args) => {
    if (action === 'read') return saved;
    if (action === 'write') {
      saved = args.value;
      return true;
    }
    const path = new URL(args.url).pathname;
    if (path.endsWith('/login')) {
      assert.ok(args.url.startsWith(qb.url));
      return { status: 200, body: 'Ok.', cookie: 'SID=fixture' };
    }
    if (path.endsWith('/genDlToken')) {
      assert.equal(args.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.equal(args.body, 'id=123');
      return { status: 200, body: JSON.stringify({ code: '0', data: 'https://example.org/fixture.torrent' }) };
    }
    if (args.kind === 'torrent') return { status: 200, bodyBase64: toBase64(torrent) };
    if (path.endsWith('/add')) {
      assert.ok(args.bodyBase64);
      added = true;
      return { status: 200, body: 'Ok.' };
    }
    if (path.endsWith('/torrents/info')) return { status: 200, body: JSON.stringify(added ? [task] : []) };
    return { status: 200, body: '{}' };
  });
  await api('/qb/connect', { method: 'POST', body: JSON.stringify(qb) });
  const state = await api('/state');
  assert.equal(state.qb.url, qb.url);
  assert.ok(!JSON.stringify(state).includes('fixture-password'));
  await api('/qb/connect', { method: 'POST', body: JSON.stringify({ ...qb, password: '', keepPassword: true }) });
  assert.equal(JSON.parse(saved).qb.password, 'fixture-password');
  const result = await api('/qb/add', { method: 'POST', body: JSON.stringify({ id: 'mt-123' }) });
  assert.equal(result.status, 'added');
  assert.equal(result.hash, hash);
  assert.equal((await api('/qb/tasks')).items[0].progress, 0.25);
});
test('browser download endpoint requires privileges and resolves source server-side', async () => {
  let state = { mteam: { base: 'https://api.m-team.cc/api', key: 'fixture-token' }, feeds: [], favorites: [], qb };
  let added = false;
  const app = createApp({
    vault: {
      read: () => state,
      write: (v) => {
        state = v;
      },
    },
    isLocalRequest: (r) => r.get('x-test-local') === 'yes',
    requestMT: async (_c, path, data) => {
      assert.equal(path, '/torrent/genDlToken');
      assert.equal(data.id, '123');
      return 'https://example.org/fixture.torrent';
    },
    requestTorrent: async (url) => {
      assert.equal(url, 'https://example.org/fixture.torrent');
      return torrent;
    },
    queryQB: async (_c, path) => {
      if (path.includes('/info?')) return added ? [task] : [];
      assert.equal(path, '/api/v2/torrents/add');
      added = true;
      return 'Ok.';
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Qiliu': '1', 'x-test-local': 'yes' };
  try {
    const denied = await fetch(base + '/api/qb/add', {
      method: 'POST',
      headers: { ...headers, 'x-test-local': 'no' },
      body: '{"id":"mt-123"}',
    });
    assert.equal(denied.status, 401);
    const res = await fetch(base + '/api/qb/add', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'mt-123', url: 'http://evil.invalid' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'added');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('task list uses bounded pagination and returns normalized fields', async () => {
  const result = await qbTasks(
    async (_c, path) => {
      assert.match(path, /limit=51&offset=50/);
      return Array.from({ length: 51 }, () => ({ ...task, magnet_uri: 'secret' }));
    },
    qb,
    new URLSearchParams('page=2&filter=seeding'),
  );
  assert.equal(result.items.length, 50);
  assert.equal(result.hasMore, true);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('download completion is detected once per task', () => {
  assert.equal(downloadCompleted({ progress: 0.42, state: 'downloading' }, { progress: 1, state: 'uploading' }), true);
  assert.equal(downloadCompleted({ progress: 1, state: 'uploading' }, { progress: 1, state: 'uploading' }), false);
  assert.equal(downloadCompleted(undefined, { progress: 1, state: 'uploading' }), false);
  assert.equal(downloadCompleted({ progress: 0.99 }, { progress: 0.995 }), false);
});

test('non-standard accepted responses are confirmed by task hash instead of body text', async () => {
  for (const response of ['Ok', '{"success_count":1,"failure_count":0}', 'ok']) {
    let added = false;
    const send = createDownloads({
      resolveSource: async () => '',
      fetchTorrent: async () => torrent,
      query: async (_c, p) => {
        if (p.includes('/info?')) return added ? [task] : [];
        added = true;
        return response;
      },
    });
    const result = await send(qb, { id: 'mt-123' });
    assert.equal(result.status, 'added', response);
    assert.equal(result.task.state, 'downloading');
  }
  const pending = createDownloads({
    resolveSource: async () => '',
    fetchTorrent: async () => torrent,
    query: async (_c, p) => (p.includes('/info?') ? [] : 'Submitted'),
  });
  assert.equal((await pending(qb, { id: 'mt-123' })).status, 'pending');
});
test('add waits briefly for the task list before reporting pending', async () => {
  let polls = 0;
  const send = createDownloads({
    resolveSource: async () => '',
    fetchTorrent: async () => torrent,
    query: async (_c, p) => {
      if (p.includes('/info?')) return ++polls >= 2 ? [task] : [];
      return 'Ok.';
    },
  });
  const result = await send(qb, { id: 'mt-123' });
  assert.equal(result.status, 'added');
  assert.equal(polls, 2);
});
