import test from 'node:test';
import { detailsHtml, seedingHtml, listHtml } from './fixtures/tjupt.mjs';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';

const goodFetch = async (url) => {
  if (url.endsWith('/login.php'))
    return {
      status: 200,
      headers: { 'set-cookie': ['c_secure_uid=1; path=/', 'c_secure_pass=2; path=/'] },
      body: '<form name="loginform"></form>',
    };
  if (url.endsWith('/takelogin.php'))
    return {
      status: 302,
      headers: { location: 'https://tjupt.org/usercp.php', 'set-cookie': ['c_secure_login=1; path=/'] },
      body: '',
    };
  if (url.endsWith('/usercp.php') || url.includes('/userdetails.php'))
    return { status: 200, headers: {}, body: detailsHtml };
  if (url.includes('getusertorrentlistajax')) return { status: 200, headers: {}, body: seedingHtml };
  if (url.includes('/mybonus.php') || url.includes('/bonus.php?show=description'))
    return { status: 200, headers: {}, body: '你当前每小时能获取 9.5 个魔力值' };
  if (url.includes('/torrents.php')) return { status: 200, headers: {}, body: listHtml };
  return { status: 200, headers: {}, body: '' };
};

async function withApp(run, { requestTjupt = goodFetch } = {}) {
  let state = { mteam: null, feeds: [], favorites: [] };
  const app = createApp({
    vault: {
      read: () => state,
      write: (value) => {
        state = structuredClone(value);
      },
    },
    isLocalRequest: () => true,
    requestTjupt,
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
    await run({ request, getState: () => state });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('TJUPT connect, profile, search, farming and disconnect through the HTTP API', async () => {
  await withApp(async ({ request, getState }) => {
    const connected = await request('/api/sites/tjupt/connect', 'POST', {
      username: 'alice',
      password: 'secret-password',
      passkey: 'b'.repeat(32),
    });
    assert.equal(connected.status, 200);
    assert.equal(connected.data.hasPasskey, true);
    assert.equal(getState().tjupt.username, 'alice');
    assert.ok(!JSON.stringify(connected.data).includes('secret-password'));
    const state = await request('/api/state');
    assert.equal(state.data.tjuptConfigured, true);
    assert.ok(!JSON.stringify(state.data).includes('secret-password'));
    assert.ok(!JSON.stringify(state.data).includes('b'.repeat(32)));
    assert.equal(state.data.sites.find((site) => site.id === 'tjupt').connected, true);

    const profile = await request('/api/profile?site=tjupt');
    assert.equal(profile.status, 200);
    assert.equal(profile.data.username, 'alice');
    assert.equal(profile.data.uploaded, Math.round(1.5 * 1024 ** 4));
    assert.equal(profile.data.seeding, 2);
    assert.equal(profile.data.seedingSize, Math.round(4.6 * 1024 ** 3));
    assert.equal(profile.data.bonusPerHour, 9.5);
    assert.equal(profile.data.bonusPerDay, 228);

    const resources = await request('/api/resources?site=tjupt&q=sintel');
    assert.equal(resources.status, 200);
    assert.equal(resources.data.items.length, 2);
    assert.equal(resources.data.items[0].source, 'TJUPT');
    assert.equal(resources.data.items[0].downloadable, true);

    const farming = await request('/api/farming/candidates?site=tjupt&freeOnly=0&hours=720&minLeechers=0');
    assert.equal(farming.status, 200);
    assert.equal(farming.data.items.length, 2);
    assert.ok(farming.data.items[0].score >= farming.data.items[1].score);
    assert.ok(farming.data.items[0].breakdown.length === 5);
    assert.equal(farming.data.site, 'tjupt');

    const kept = await request('/api/sites/tjupt/connect', 'POST', {
      username: 'alice',
      passkey: '',
      keepPassword: true,
    });
    assert.equal(kept.status, 200);
    assert.equal(getState().tjupt.password, 'secret-password');

    const disconnected = await request('/api/sites/tjupt/connect', 'DELETE');
    assert.equal(disconnected.status, 200);
    assert.equal((await request('/api/profile?site=tjupt')).status, 409);
  });
});

test('TJUPT login failures are fused instead of retried', async () => {
  const failing = async (url) => {
    if (url.endsWith('/login.php')) return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
    if (url.endsWith('/takelogin.php'))
      return { status: 302, headers: { location: 'https://tjupt.org/login.php' }, body: '' };
    return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
  };
  await withApp(
    async ({ request, getState }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request('/api/sites/tjupt/connect', 'POST', {
          username: 'carol',
          password: 'wrong-password',
        });
        assert.equal(response.status, 400);
      }
      assert.equal(getState().tjupt, undefined);
      const fused = await request('/api/sites/tjupt/connect', 'POST', {
        username: 'carol',
        password: 'wrong-password',
      });
      assert.equal(fused.status, 429);
      assert.match(fused.data.error, /10 分钟/);
    },
    { requestTjupt: failing },
  );
});

test('TJUPT can connect with a browser cookie when two-step verification is on', async () => {
  const calls = [];
  const cookieFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/usercp.php') || url.includes('/userdetails.php'))
      return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('getusertorrentlistajax')) return { status: 200, headers: {}, body: seedingHtml };
    if (url.includes('/mybonus.php') || url.includes('/bonus.php?show=description'))
      return { status: 200, headers: {}, body: '每小时 1 个' };
    return { status: 200, headers: {}, body: '' };
  };
  await withApp(
    async ({ request, getState }) => {
      const connected = await request('/api/sites/tjupt/connect', 'POST', {
        username: 'alice',
        cookie: 'c_secure_uid=1; c_secure_pass=token',
        passkey: 'f'.repeat(32),
      });
      assert.equal(connected.status, 200);
      assert.equal(connected.data.hasCookie, true);
      assert.equal(getState().tjupt.cookie, 'c_secure_uid=1; c_secure_pass=token');
      const state = await request('/api/state');
      assert.equal(state.data.tjupt.hasCookie, true);
      assert.equal(state.data.sites.find((site) => site.id === 'tjupt').hasCookie, true);
      const profile = await request('/api/profile?site=tjupt');
      assert.equal(profile.status, 200);
      assert.equal(profile.data.username, 'alice');
      assert.ok(!calls.some((url) => url.endsWith('/takelogin.php')));
      await request('/api/sites/tjupt/connect', 'DELETE');
    },
    { requestTjupt: cookieFetch },
  );
});
