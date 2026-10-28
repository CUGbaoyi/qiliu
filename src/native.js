import { createQBClient, normalizeQB, qbPublicConfig, qbOptions, qbTasks } from '../server/qb-client.mjs';
import { createDownloads, fromBase64 } from '../server/downloads.mjs';
import { normalizeProfile, normalizeTorrent, parseFeed, mergeResources, publicResource } from '../server/model.mjs';
import { FARMING_MODES, rankCandidates } from '../server/farming.mjs';
import { createTjuptClient, downloadURL as tjuptDownloadURL } from '../server/tjupt.mjs';
import { exportBackup, importBackup } from '../server/backup.mjs';
import { enrichProfile } from '../server/metrics.mjs';
import { MT_BASES } from '../server/sites.mjs';
export const isNative = () => !!(window.QiliuAndroid || window.webkit?.messageHandlers?.qiliu);
const pending = new Map();
let sequence = 0;
if (typeof window !== 'undefined')
  window.__qiliuReply = (id, result) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    result.error ? p.reject(new Error(result.error)) : p.resolve(result.value);
  };
export function nativeCall(action, args = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('设备请求超时，请检查网络。'));
    }, 45000);
    pending.set(id, { resolve, reject, timer });
    const payload = JSON.stringify({ id, action, ...args });
    try {
      if (window.QiliuAndroid) window.QiliuAndroid.postMessage(payload);
      else window.webkit.messageHandlers.qiliu.postMessage(payload);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}
export function createNativeClient(call) {
  let config,
    initializing,
    profileCache = null,
    calls = [];
  const caches = new Map();
  let writeQueue = Promise.resolve();
  const load = async () => {
    if (config) return;
    initializing ??= call('read').then((s) => {
      config = s ? JSON.parse(s) : { mteam: null, feeds: [], favorites: [], qb: null };
    });
    await initializing;
  };
  const save = () => {
    const value = JSON.stringify(config);
    const op = writeQueue.then(() => call('write', { value }));
    writeQueue = op.catch(() => {});
    return op;
  };
  const http = async (kind, url, options = {}) => {
    const r = await call('http', {
      kind,
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || '',
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`连接返回 HTTP ${r.status}，请检查地址或权限。`);
    return r;
  };
  const rawHttp = (kind, url, options = {}) =>
    call('http', {
      kind,
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || '',
    });
  const tjuptFetch = async (url, options = {}) => {
    const r = await rawHttp('tjupt', url, options);
    return {
      status: Number(r.status) || 0,
      headers: { 'set-cookie': r.cookie ? [r.cookie] : [], location: r.location || '', 'content-type': '' },
      body: r.body || '',
    };
  };
  const tjupt = createTjuptClient(tjuptFetch);
  const mt = async (endpoint, data = {}, connection = config.mteam) => {
    if (!connection) throw new Error('请先连接 M-Team。');
    calls = calls.filter((t) => Date.now() - t < 60000);
    if (calls.length >= 25) throw new Error('请求过于频繁，请稍后重试。');
    calls.push(Date.now());
    const form = endpoint === '/torrent/genDlToken';
    const r = await http('mteam', connection.base + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'x-api-key': connection.key,
      },
      body: form ? new URLSearchParams(data).toString() : JSON.stringify(data),
    });
    let j;
    try {
      j = JSON.parse(r.body);
    } catch {
      throw new Error('站点返回格式不兼容。');
    }
    if (String(j.code) !== '0') throw new Error('M-Team 请求未成功，请检查 Token 权限。');
    return j.data;
  };
  const cached = async (key, ttl, loader) => {
    const old = caches.get(key);
    if (old && Date.now() - old.time < ttl) return old.value;
    if (old?.pending) return old.pending;
    const pending = loader();
    caches.set(key, { ...old, pending });
    try {
      const value = await pending;
      caches.set(key, { value, time: Date.now() });
      if (caches.size > 100) caches.delete(caches.keys().next().value);
      return value;
    } catch (e) {
      caches.delete(key);
      throw e;
    }
  };
  const getProfile = async () => {
    if (profileCache && Date.now() - profileCache.time < 60000) return profileCache.value;
    try {
      const data = await mt('/member/profile');
      const results = await Promise.allSettled(
        ['/tracker/myPeerStatistics', '/tracker/myPeerStatus', '/tracker/mybonus'].map((e) => mt(e)),
      );
      const values = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
      const value = enrichProfile(normalizeProfile(data, values[0]), values[1], values[2], profileCache?.value);
      if (results.some((r) => r.status === 'rejected')) value.warning = '部分做种或收益信息暂不可用。';
      profileCache = { value, time: Date.now() };
      return value;
    } catch (e) {
      if (profileCache) return { ...profileCache.value, stale: true, warning: '更新失败，显示上次成功数据。' };
      throw e;
    }
  };
  const qbQuery = createQBClient((url, options = {}) =>
    call('http', {
      kind: 'qb',
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || '',
      bodyBase64: options.bodyBase64 || '',
    }),
  );
  const qbRequest = (path, candidate = config.qb, options = {}) => qbQuery(candidate, path, options);
  const fetchTorrent = async (url, redirects = 0) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('种子下载链接无效。');
    const r = await call('http', { kind: 'torrent', url: u.href, method: 'GET', headers: {}, body: '' });
    if ([301, 302, 303, 307, 308].includes(r.status) && r.location && redirects < 3)
      return fetchTorrent(new URL(r.location, u).href, redirects + 1);
    if (r.status !== 200) throw new Error(`种子下载返回 HTTP ${r.status}，请刷新资源或检查站点权限。`);
    return fromBase64(r.bodyBase64 || '');
  };
  const downloads = createDownloads({
    query: qbQuery,
    fetchTorrent,
    resolveSource: async (input) => {
      if (/^mt-\d+$/.test(input.id) && config.mteam) {
        const url = await mt('/torrent/genDlToken', { id: input.id.slice(3) });
        if (typeof url !== 'string') throw new Error('站点未返回种子链接。');
        return url;
      }
      if (/^tjupt-\d+$/.test(input.id) && config.tjupt) return tjuptDownloadURL(config.tjupt, input.id.slice(6));
      const feed = config.feeds.find((f) => f.id === input.feedId);
      if (!feed) throw new Error('请连接 M-Team 或保留资源的 RSS 订阅。');
      const items = parseFeed((await http('rss', feed.url)).body, feed),
        item = items.find((i) => i.id === input.id);
      if (!item?.downloadUrl) throw new Error('RSS 中未找到种子链接，请刷新订阅。');
      return item.downloadUrl;
    },
  });
  return async (path, options = {}) => {
    await load();
    const u = new URL(path, 'https://qiliu.local');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (u.pathname === '/auth') return { authorized: true, local: true, native: true };
    if (u.pathname === '/state')
      return {
        native: true,
        local: true,
        configured: !!config.mteam,
        base: config.mteam?.base || MT_BASES[0],
        tjuptConfigured: !!config.tjupt,
        tjupt: config.tjupt
          ? { username: config.tjupt.username, hasPasskey: !!config.tjupt.passkey, hasCookie: !!config.tjupt.cookie }
          : null,
        sites: [
          { id: 'mteam', name: 'M-Team', connected: !!config.mteam },
          {
            id: 'tjupt',
            name: 'TJUPT',
            connected: !!config.tjupt,
            username: config.tjupt?.username || null,
            hasCookie: !!config.tjupt?.cookie,
          },
        ],
        feeds: config.feeds.map(({ id, name }) => ({ id, name })),
        favorites: config.favorites,
        qbConfigured: !!config.qb,
        qb: qbPublicConfig(config.qb),
      };
    if (u.pathname === '/backup/export' && method === 'POST') {
      const password = String(body.password || '');
      if (password.length < 8 || password.length > 256) throw new Error('备份口令至少 8 个字符。');
      return { backup: await exportBackup(config, password) };
    }
    if (u.pathname === '/backup/import' && method === 'POST') {
      const next = await importBackup(body.backup, String(body.password || ''));
      config = next;
      profileCache = null;
      tjupt.reset();
      caches.clear();
      await save();
      return { ok: true, configured: !!config.mteam, tjuptConfigured: !!config.tjupt };
    }
    if (u.pathname === '/sites/tjupt/connect') {
      if (method === 'DELETE') {
        config.tjupt = null;
        tjupt.reset();
        caches.clear();
        await save();
        return { ok: true };
      }
      const username = String(body.username || '').trim(),
        passkey = String(body.passkey || '').trim(),
        cookie = String(body.cookie || '').trim();
      if (cookie && (cookie.length > 8192 || /[\r\n]/.test(cookie))) throw new Error('TJUPT Cookie 格式无效。');
      let password = String(body.password || '');
      const keep = !!body.keepPassword && config.tjupt && config.tjupt.username === username && !password;
      if (keep) password = config.tjupt.password || '';
      const nextPasskey = passkey || (keep ? config.tjupt.passkey || '' : '');
      if (!cookie && (!username || username.length > 120 || !password || password.length > 256))
        throw new Error('请填写 TJUPT 用户名和密码，或粘贴登录 Cookie。');
      if (nextPasskey && !/^[a-f0-9]{32}$/i.test(nextPasskey)) throw new Error('TJUPT passkey 应为 32 位十六进制。');
      if (cookie) {
        const candidate = { username: username || '', password: '', passkey: nextPasskey, cookie };
        const info = await tjupt.validate(candidate);
        config.tjupt = candidate;
        caches.clear();
        await save();
        return { ok: true, username: info.username, hasPasskey: !!nextPasskey, hasCookie: true };
      }
      const candidate = { username, password, passkey: nextPasskey };
      const profile = await tjupt.profile(candidate);
      config.tjupt = candidate;
      caches.clear();
      await save();
      return { ok: true, username: profile.username || username, hasPasskey: !!nextPasskey, hasCookie: false };
    }
    if (u.pathname === '/connect') {
      if (method === 'DELETE') {
        config.mteam = null;
        profileCache = null;
        caches.clear();
        await save();
        return { ok: true };
      }
      if (
        !MT_BASES.includes(body.base) ||
        typeof body.key !== 'string' ||
        body.key.length < 8 ||
        body.key.length > 512 ||
        /[\r\n]/.test(body.key)
      )
        throw new Error('请填写有效 Token。');
      const p = normalizeProfile(await mt('/member/profile', {}, body));
      config.mteam = { base: body.base, key: body.key.trim() };
      profileCache = null;
      caches.clear();
      await save();
      return { ok: true, username: p.username };
    }
    if (u.pathname === '/profile') {
      if (u.searchParams.get('site') === 'tjupt') {
        if (!config.tjupt) throw new Error('尚未连接 TJUPT，请在站点页填写账号。');
        const profile = await cached('tjupt:profile', 600000, () => tjupt.profile(config.tjupt));
        return {
          ...profile,
          onlineSeeders: profile.seeding ?? null,
          onlineLeechers: profile.leeching ?? null,
          bonusPerDay: profile.bonusPerHour == null ? null : Math.round(profile.bonusPerHour * 24 * 100) / 100,
        };
      }
      return getProfile();
    }
    if (u.pathname === '/resources') {
      const source = u.searchParams.get('source') || 'all',
        page = Math.max(1, Number(u.searchParams.get('page')) || 1),
        q = (u.searchParams.get('q') || '').slice(0, 120);
      if (u.searchParams.get('site') === 'tjupt') {
        if (!config.tjupt) throw new Error('尚未连接 TJUPT，请在站点页填写账号。');
        try {
          const data = await cached('tjupt:search:' + page + ':' + q, 120000, () =>
            tjupt.search(config.tjupt, { keyword: q, page }),
          );
          return {
            items: data.items.map(publicResource),
            warnings: [],
            total: data.items.length,
            hasMore: data.items.length >= 50,
            page,
          };
        } catch (error) {
          return { items: [], warnings: [error.message], total: 0, hasMore: false, page };
        }
      }
      let items = [],
        total = 0;
      const warnings = [];
      if (config.mteam && ['all', 'mteam'].includes(source)) {
        try {
          const d = await cached(`mt:${q}:${page}`, 120000, () =>
            mt('/torrent/search', { mode: 'normal', keyword: q, pageNumber: page, pageSize: 50 }),
          );
          items = d.data.map(normalizeTorrent);
          total = Number(d.total) || items.length;
        } catch (e) {
          warnings.push(e.message);
        }
      }
      const feeds =
        source === 'mteam' || (source === 'all' && page > 1)
          ? []
          : config.feeds.filter((f) => ['all', 'rss', f.id].includes(source));
      for (const feed of feeds) {
        try {
          items.push(
            ...(
              await cached('feed:' + feed.id, 600000, async () => parseFeed((await http('rss', feed.url)).body, feed))
            ).filter((i) => (i.title + ' ' + i.description).toLowerCase().includes(q.toLowerCase())),
          );
        } catch {
          warnings.push(feed.name + '：读取失败，请检查订阅地址。');
        }
      }
      return { items: mergeResources(items).map(publicResource), total, hasMore: total > page * 50, page, warnings };
    }
    if (u.pathname === '/farming/candidates') {
      if (u.searchParams.get('site') === 'tjupt') {
        if (!config.tjupt) throw new Error('刷流助手需要先连接 TJUPT。');
        const tmode = FARMING_MODES.includes(u.searchParams.get('mode')) ? u.searchParams.get('mode') : 'upload';
        const tpage = Math.max(1, Math.min(20, Number(u.searchParams.get('page')) || 1));
        const tprefs = {
          freeOnly: u.searchParams.get('freeOnly') !== '0',
          hours: Math.max(1, Math.min(168, Number(u.searchParams.get('hours')) || 24)),
          minLeechers: Math.max(0, Math.min(1000, Number(u.searchParams.get('minLeechers')) || 0)),
          maxSizeGB: Math.max(0, Math.min(2048, Number(u.searchParams.get('maxSizeGB')) || 0)),
        };
        const tresult = await cached(
          'farming:tjupt:' + tmode + ':' + JSON.stringify(tprefs) + ':' + tpage,
          60000,
          async () => {
            const data = await tjupt.search(config.tjupt, { keyword: '', page: tpage });
            return {
              items: rankCandidates(data.items, { mode: tmode, prefs: tprefs, now: Date.now() }),
              total: data.items.length,
              scanned: data.items.length,
              page: tpage,
            };
          },
        );
        return {
          ...tresult,
          site: 'tjupt',
          mode: tmode,
          prefs: tprefs,
          syncedAt: new Date().toISOString(),
          hasMore: tresult.scanned >= 50,
        };
      }
      if (!config.mteam) throw new Error('刷流助手需要先连接 M-Team。');
      const mode = FARMING_MODES.includes(u.searchParams.get('mode')) ? u.searchParams.get('mode') : 'upload';
      const page = Math.max(1, Math.min(20, Number(u.searchParams.get('page')) || 1));
      const prefs = {
        freeOnly: u.searchParams.get('freeOnly') !== '0',
        hours: Math.max(1, Math.min(168, Number(u.searchParams.get('hours')) || 24)),
        minLeechers: Math.max(0, Math.min(1000, Number(u.searchParams.get('minLeechers')) || 0)),
        maxSizeGB: Math.max(0, Math.min(2048, Number(u.searchParams.get('maxSizeGB')) || 0)),
      };
      const result = await cached('farming:' + mode + ':' + JSON.stringify(prefs) + ':' + page, 60000, async () => {
        const d = await mt('/torrent/search', {
          mode: 'normal',
          pageNumber: page,
          pageSize: 50,
          sortField: 'CREATED_DATE',
          sortType: 'DESC',
        });
        if (!Array.isArray(d?.data)) throw new Error('刷流候选接口格式不兼容。');
        return {
          items: rankCandidates(d.data.map(normalizeTorrent), { mode, prefs, now: Date.now() }),
          total: Number(d.total) || 0,
          scanned: d.data.length,
          page,
        };
      });
      return { ...result, mode, prefs, syncedAt: new Date().toISOString(), hasMore: result.total > page * 50 };
    }
    if (u.pathname === '/feeds' && method === 'POST') {
      if (!body.name?.trim() || config.feeds.length >= 15) throw new Error('请填写名称，最多 15 个订阅。');
      if (config.feeds.some((f) => f.url === body.url)) throw new Error('该订阅已存在。');
      const feed = { id: 'f' + Date.now().toString(36), name: body.name.trim().slice(0, 40), url: body.url.trim() };
      const items = parseFeed((await http('rss', feed.url)).body, feed);
      config.feeds.push(feed);
      await save();
      caches.set('feed:' + feed.id, { time: Date.now(), value: items });
      return { id: feed.id, name: feed.name, count: items.length };
    }
    if (u.pathname.startsWith('/feeds/') && method === 'DELETE') {
      config.feeds = config.feeds.filter((f) => f.id !== u.pathname.split('/').pop());
      await save();
      return { ok: true };
    }
    if (u.pathname === '/favorites') {
      if (!body.item?.id || !body.item?.title) throw new Error('无效资源。');
      if (body.saved && config.favorites.length >= 500) throw new Error('最多收藏 500 条。');
      config.favorites = config.favorites.filter((f) => f.id !== body.item.id);
      if (body.saved) config.favorites.unshift(body.item);
      await save();
      return { favorites: config.favorites };
    }
    if (u.pathname === '/qb/connect') {
      if (method === 'DELETE') {
        config.qb = null;
        caches.delete('qb');
        await save();
        return { ok: true };
      }
      const candidate = normalizeQB(body);
      if (
        body.keepPassword &&
        config.qb &&
        candidate.url === config.qb.url &&
        candidate.username === config.qb.username
      )
        candidate.password = config.qb.password;
      await qbRequest('/api/v2/transfer/info', candidate);
      config.qb = candidate;
      caches.delete('qb');
      await save();
      return { ok: true };
    }
    if (u.pathname === '/qb/status')
      return cached('qb', 3000, async () => {
        const info = await qbRequest('/api/v2/transfer/info');
        const torrents = await qbRequest('/api/v2/torrents/info?filter=active&sort=upspeed&reverse=true&limit=20');
        return {
          uploadSpeed: Number(info.up_info_speed),
          downloadSpeed: Number(info.dl_info_speed),
          sessionUpload: Number(info.up_info_data),
          connection: info.connection_status,
          torrents: torrents
            .map((t) => ({
              name: t.name,
              upSpeed: t.upspeed,
              downSpeed: t.dlspeed,
              state: t.state,
              progress: t.progress,
            }))
            .sort((a, b) => b.upSpeed - a.upSpeed)
            .slice(0, 20),
          syncedAt: new Date().toISOString(),
        };
      });
    if (u.pathname === '/qb/options') return qbOptions(qbQuery, config.qb);
    if (u.pathname === '/qb/tasks') return qbTasks(qbQuery, config.qb, u.searchParams);
    if (u.pathname === '/qb/add' && method === 'POST') {
      const result = await downloads(config.qb, body);
      caches.delete('qb');
      return result;
    }
    throw new Error('此操作不适用于独立客户端。');
  };
}
const nativeAPI = createNativeClient(nativeCall);
export { nativeAPI };
