import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';

const original = {
  mteam: { base: 'https://api.m-team.cc/api', key: 'secret-mteam-token' },
  tjupt: { username: 'alice', password: 'secret-tjupt', passkey: 'd'.repeat(32) },
  feeds: [{ id: 'f1', name: '订阅', url: 'https://example.org/feed?sign=secret' }],
  favorites: [{ id: 'mt-1', title: '资源' }],
  qb: { url: 'http://192.168.1.2:8080', username: 'admin', password: 'secret-qb' },
};

test('backup export and import roundtrip through the HTTP API', async () => {
  let state = structuredClone(original);
  const app = createApp({
    vault: {
      read: () => state,
      write: (value) => {
        state = structuredClone(value);
      },
    },
    isLocalRequest: () => true,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Qiliu': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const exported = await request('/api/backup/export', 'POST', { password: 'my strong pass' });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.backup.format, 'qiliu-backup');
    const serialized = JSON.stringify(exported.data.backup);
    for (const secret of ['secret-mteam-token', 'secret-tjupt', 'secret-qb', 'my strong pass'])
      assert.ok(!serialized.includes(secret), secret);

    assert.equal((await request('/api/backup/export', 'POST', { password: 'short' })).status, 400);
    const wrong = await request('/api/backup/import', 'POST', {
      password: 'wrong password',
      backup: exported.data.backup,
    });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /口令不正确|损坏/);

    state = { mteam: null, feeds: [], favorites: [] };
    const imported = await request('/api/backup/import', 'POST', {
      password: 'my strong pass',
      backup: exported.data.backup,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.configured, true);
    assert.equal(imported.data.tjuptConfigured, true);
    assert.equal(state.mteam.key, 'secret-mteam-token');
    assert.equal(state.tjupt.password, 'secret-tjupt');
    assert.equal(state.qb.password, 'secret-qb');
    assert.equal((await request('/api/state')).data.feeds.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('backup endpoints require local privileges', async () => {
  let local = true;
  const app = createApp({
    vault: { read: () => structuredClone(original), write: () => {} },
    isLocalRequest: () => local,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    local = false;
    const response = await fetch(base + '/api/backup/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Qiliu': '1' },
      body: JSON.stringify({ password: 'my strong pass' }),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
