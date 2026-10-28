import test from 'node:test';
import { detailsHtml, seedingHtml, listHtml } from './fixtures/tjupt.mjs';
import assert from 'node:assert/strict';
import { createNativeClient } from '../src/native.js';

test('native client connects TJUPT, exposes state and serves profile/search/farming', async () => {
  let saved = '';
  const calls = [];
  const call = async (action, args = {}) => {
    if (action === 'read') return saved;
    if (action === 'write') {
      saved = args.value;
      return true;
    }
    calls.push(args);
    if (args.kind === 'tjupt') {
      const path = new URL(args.url).pathname;
      if (path === '/login.php')
        return { status: 200, body: '<form name="loginform"></form>', cookie: 'c_secure_uid=1; path=/' };
      if (path === '/takelogin.php') {
        assert.equal(args.method, 'POST');
        assert.ok(args.body.includes('username=alice'));
        assert.ok(args.body.includes('logout=90'));
        return { status: 302, body: '', cookie: 'c_secure_login=1; path=/', location: 'https://tjupt.org/usercp.php' };
      }
      if (path === '/usercp.php') return { status: 200, body: detailsHtml, cookie: '' };
      if (path === '/userdetails.php') return { status: 200, body: detailsHtml, cookie: '' };
      if (path === '/getusertorrentlistajax.php') return { status: 200, body: seedingHtml, cookie: '' };
      if (path === '/mybonus.php' || path === '/bonus.php')
        return { status: 200, body: '你当前每小时能获取 9.5 个魔力值', cookie: '' };
      if (path === '/torrents.php') return { status: 200, body: listHtml, cookie: '' };
    }
    return { status: 200, body: '{}', cookie: '' };
  };
  const api = createNativeClient(call);
  await api('/auth');
  assert.equal((await api('/state')).tjuptConfigured, false);
  const connected = await api('/sites/tjupt/connect', {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'secret-password', passkey: 'c'.repeat(32) }),
  });
  assert.equal(connected.ok, true);
  assert.equal(connected.hasPasskey, true);
  assert.ok(saved.includes('alice'));
  assert.ok(!JSON.stringify(await api('/state')).includes('secret-password'));
  const state = await api('/state');
  assert.equal(state.tjuptConfigured, true);
  assert.ok(!JSON.stringify(state).includes('c'.repeat(32)));
  const profile = await api('/profile?site=tjupt');
  assert.equal(profile.username, 'alice');
  assert.equal(profile.seeding, 2);
  assert.equal(profile.bonusPerHour, 9.5);
  assert.equal(profile.bonusPerDay, 228);
  const resources = await api('/resources?site=tjupt');
  assert.equal(resources.items.length, 2);
  assert.equal(resources.items[0].source, 'TJUPT');
  assert.equal(resources.items[0].id, 'tjupt-1001');
  const farming = await api('/farming/candidates?site=tjupt&freeOnly=0&hours=720');
  assert.equal(farming.site, 'tjupt');
  assert.equal(farming.items.length, 2);
  assert.ok(farming.items[0].score > 0);
  assert.equal((await api('/sites/tjupt/connect', { method: 'DELETE' })).ok, true);
  assert.equal((await api('/state')).tjuptConfigured, false);
  assert.ok(calls.some((item) => item.kind === 'tjupt' && item.url.includes('/userdetails.php')));
});
