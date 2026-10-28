import test from 'node:test';
import { detailsHtml, seedingHtml, listHtml } from './fixtures/tjupt.mjs';
import assert from 'node:assert/strict';
import {
  TJUPT_BASE,
  downloadURL,
  parseSize,
  parseProfile,
  parseSeeding,
  parseBonus,
  parseTorrentList,
  parseCookies,
  mergeCookies,
  isLoggedIn,
  parseIndexInfo,
  createTjuptClient,
} from '../server/tjupt.mjs';

test('size parsing understands NexusPHP units and thousands separators', () => {
  assert.equal(parseSize('1.50 TB'), Math.round(1.5 * 1024 ** 4));
  assert.equal(parseSize('614.40 GB'), Math.round(614.4 * 1024 ** 3));
  assert.equal(parseSize('1,024 MB'), 1024 * 1024 ** 2);
  assert.equal(parseSize('n/a'), null);
});

test('cookie parse and merge cover multiple Set-Cookie headers', () => {
  assert.equal(parseCookies(['a=1; path=/', 'b=2; path=/']), 'a=1; b=2');
  assert.equal(mergeCookies('a=1; b=2', ['b=3; path=/']), 'a=1; b=3');
  assert.equal(parseCookies([]), '');
});

test('profile parsing reads upload, download, ratio, bonus, role and join date', () => {
  const profile = parseProfile(detailsHtml);
  assert.equal(profile.uploaded, Math.round(1.5 * 1024 ** 4));
  assert.equal(profile.downloaded, Math.round(614.4 * 1024 ** 3));
  assert.equal(profile.ratio, 2.5);
  assert.equal(profile.bonus, 12345.6);
  assert.equal(profile.role, '持剑下山');
  assert.equal(profile.joined, '2022-04-02 00:09:03');
  assert.deepEqual(parseIndexInfo(detailsHtml), { uid: 42, username: 'alice' });
});

test('profile parsing falls back to plain labels and preserves unknown values', () => {
  const html =
    '<td><strong>上传量</strong>: 2.00 GB</td><td><strong>下载量</strong>: 1.00 GB</td><td>分享率: 2</td><td>魔力值: 100</td>';
  const profile = parseProfile(html);
  assert.equal(profile.uploaded, 2 * 1024 ** 3);
  assert.equal(profile.downloaded, 1024 ** 3);
  assert.equal(profile.ratio, 2);
  assert.equal(profile.bonus, 100);
  assert.equal(parseProfile('<html>nothing</html>').uploaded, null);
  assert.equal(parseProfile('<html>nothing</html>').ratio, null);
});

test('seeding count and size come from the site seeding list', () => {
  assert.deepEqual(parseSeeding(seedingHtml), {
    seeding: 2,
    seedingSize: Math.round(4.6 * 1024 ** 3),
  });
  assert.deepEqual(parseSeeding('<table></table>'), { seeding: 0, seedingSize: null });
});

test('hourly bonus parsing supports the mybonus sentence', () => {
  assert.equal(parseBonus('你当前每小时能获取 12.34 个魔力值'), 12.34);
  assert.equal(parseBonus('其他内容'), null);
});

test('search rows map seeders, leechers, size, discount and dates', () => {
  const items = parseTorrentList(listHtml);
  assert.equal(items.length, 2);
  const [first, free2x] = items;
  assert.equal(first.id, 'tjupt-1001');
  assert.equal(first.title, 'Sintel 2010 1080p');
  assert.equal(first.size, Math.round(1.2 * 1024 ** 3));
  assert.equal(first.seeders, 12);
  assert.equal(first.leechers, 3);
  assert.equal(first.completed, 7);
  assert.equal(first.discount, 'NORMAL');
  assert.equal(first.free, false);
  assert.equal(first.url, 'https://tjupt.org/details.php?id=1001');
  assert.equal(free2x.id, 'tjupt-1002');
  assert.equal(free2x.discount, '2X_FREE');
  assert.equal(free2x.free, true);
  assert.equal(free2x.completed, 2);
  assert.equal(free2x.date, '2026-10-28 08:00:00');
});

test('login page is not mistaken for an authenticated session', () => {
  assert.equal(isLoggedIn('<a href="logout.php">退出</a>'), true);
  assert.equal(isLoggedIn('<form name="loginform" action="takelogin.php"></form>'), false);
  assert.equal(isLoggedIn(''), false);
});

test('passkey download URL is built without cookies', () => {
  assert.equal(
    downloadURL({ passkey: 'a'.repeat(32) }, 123),
    `${TJUPT_BASE}/download.php?id=123&passkey=${'a'.repeat(32)}`,
  );
  assert.throws(() => downloadURL({}, 1), /passkey/);
  assert.throws(() => downloadURL({ passkey: 'x' }, '1x'), /编号/);
});

test('client logs in once, persists cookies and reads profile and search', async () => {
  const calls = [];
  let loggedIn = false;
  const fetchPage = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/login.php'))
      return {
        status: 200,
        headers: { 'set-cookie': ['c_secure_uid=abc; path=/', 'c_secure_pass=def; path=/'] },
        body: '<form name="loginform"></form>',
      };
    if (url.endsWith('/takelogin.php')) {
      loggedIn = true;
      return {
        status: 302,
        headers: { location: 'https://tjupt.org/index.php', 'set-cookie': ['c_secure_login=1; path=/'] },
        body: '',
      };
    }
    if (!loggedIn) return { status: 302, headers: { location: 'https://tjupt.org/login.php' }, body: '' };
    if (url.endsWith('/index.php') || url.includes('/usercp.php'))
      return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('/userdetails.php')) return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('getusertorrentlistajax')) return { status: 200, headers: {}, body: seedingHtml };
    if (url.includes('/mybonus.php') || url.includes('/bonus.php?show=description'))
      return { status: 200, headers: {}, body: '你当前每小时能获取 12.34 个魔力值' };
    if (url.includes('/torrents.php')) return { status: 200, headers: {}, body: listHtml };
    return { status: 200, headers: {}, body: '' };
  };
  const client = createTjuptClient(fetchPage);
  const config = { username: 'alice', password: 'secret', passkey: 'b'.repeat(32) };
  const profile = await client.profile(config);
  assert.equal(profile.username, 'alice');
  assert.equal(profile.uid, 42);
  assert.equal(profile.uploaded, Math.round(1.5 * 1024 ** 4));
  assert.equal(profile.seeding, 2);
  assert.equal(profile.bonusPerHour, 12.34);
  const loginCalls = calls.filter((call) => call.url.endsWith('/takelogin.php'));
  assert.equal(loginCalls.length, 1);
  assert.ok(loginCalls[0].options.body.includes('username=alice'));
  assert.ok(loginCalls[0].options.body.includes('logout=90'));
  const detail = calls.find((call) => call.url.includes('/userdetails.php'));
  assert.ok(detail.options.headers.Cookie.includes('c_secure_uid=abc'));
  const search = await client.search(config, { keyword: 'sintel', page: 2 });
  assert.equal(search.items.length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith('/takelogin.php')).length, 1);
  assert.ok(calls.at(-1).url.includes('search=sintel'));
  assert.ok(calls.at(-1).url.includes('page=2'));
});

test('expired session logs in again before retrying the page', async () => {
  let logins = 0,
    pageHits = 0;
  const fetchPage = async (url) => {
    if (url.endsWith('/login.php')) return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
    if (url.endsWith('/takelogin.php')) {
      logins++;
      return {
        status: 302,
        headers: { location: 'https://tjupt.org/usercp.php', 'set-cookie': ['c_secure_uid=x; path=/'] },
        body: '',
      };
    }
    if (url.endsWith('/usercp.php')) return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('/userdetails.php')) {
      pageHits++;
      return pageHits === 1
        ? { status: 302, headers: { location: 'https://tjupt.org/login.php' }, body: '' }
        : { status: 200, headers: {}, body: detailsHtml };
    }
    if (url.includes('getusertorrentlistajax')) return { status: 200, headers: {}, body: seedingHtml };
    if (url.includes('/mybonus.php') || url.includes('/bonus.php?show=description'))
      return { status: 200, headers: {}, body: '每小时 1 个' };
    return { status: 200, headers: {}, body: '' };
  };
  const client = createTjuptClient(fetchPage);
  const profile = await client.profile({ username: 'bob', password: 'pw' });
  assert.equal(profile.seeding, 2);
  assert.equal(logins, 2);
});

test('failed login is reported without automatic retry', async () => {
  let posts = 0;
  const fetchPage = async (url) => {
    if (url.endsWith('/login.php')) return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
    if (url.endsWith('/takelogin.php')) {
      posts++;
      return { status: 302, headers: { location: 'https://tjupt.org/login.php?returnto=...' }, body: '' };
    }
    return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
  };
  const client = createTjuptClient(fetchPage);
  await assert.rejects(() => client.profile({ username: 'carol', password: 'bad' }), /不会自动重试/);
  assert.equal(posts, 1);
});

test('two-step verification is reported without retrying the login', async () => {
  let posts = 0;
  const fetchPage = async (url) => {
    if (url.endsWith('/login.php')) return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
    if (url.endsWith('/takelogin.php')) {
      posts++;
      return {
        status: 200,
        headers: {},
        body: '<html><title>两步验证</title><input name="verify_code" maxlength="6"/></html>',
      };
    }
    return { status: 200, headers: {}, body: '' };
  };
  const client = createTjuptClient(fetchPage);
  await assert.rejects(() => client.profile({ username: 'alice', password: 'pw' }), /两步验证/);
  assert.equal(posts, 1);
});

test('cookie session skips password login and validates the site session', async () => {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    if (url.endsWith('/login.php') || url.endsWith('/takelogin.php')) throw new Error('should not login');
    if (url.endsWith('/usercp.php')) return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('/userdetails.php')) return { status: 200, headers: {}, body: detailsHtml };
    if (url.includes('getusertorrentlistajax')) return { status: 200, headers: {}, body: seedingHtml };
    if (url.includes('/mybonus.php') || url.includes('/bonus.php?show=description'))
      return { status: 200, headers: {}, body: '每小时 3 个' };
    return { status: 200, headers: {}, body: '' };
  };
  const client = createTjuptClient(fetchPage);
  const config = { cookie: 'c_secure_uid=42; c_secure_pass=token', passkey: 'e'.repeat(32) };
  const profile = await client.profile(config);
  assert.equal(profile.username, 'alice');
  assert.equal(profile.uid, 42);
  assert.equal(profile.seeding, 2);
  const info = await client.validate(config);
  assert.deepEqual(info, { username: 'alice', uid: 42, hasCookie: true });
  assert.ok(!calls.some((url) => url.endsWith('/takelogin.php')));
});

test('expired cookie is reported instead of retrying the password', async () => {
  const fetchPage = async (url) => {
    if (url.endsWith('/usercp.php')) return { status: 200, headers: {}, body: '<form name="loginform"></form>' };
    return { status: 200, headers: {}, body: '' };
  };
  const client = createTjuptClient(fetchPage);
  await assert.rejects(() => client.profile({ cookie: 'c_secure_uid=1' }), /Cookie 已失效/);
});
