import express from 'express';
import { createQB } from './qb.mjs';
import { normalizeQB, qbPublicConfig, qbTasks, qbOptions } from './qb-client.mjs';
import { createDownloads } from './downloads.mjs';
import { enrichProfile } from './metrics.mjs';
import { randomBytes, randomInt, timingSafeEqual, scryptSync } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { MT_BASES, mtRequest, publicRequest, tjuptRequest, validateURL } from './network.mjs';
import { createTjuptClient, downloadURL as tjuptDownloadURL } from './tjupt.mjs';
import { exportBackup, importBackup } from './backup.mjs';
import { normalizeProfile, normalizeTorrent, parseFeed, mergeResources, publicResource } from './model.mjs';
import { FARMING_MODES, rankCandidates } from './farming.mjs';

export function createApp({
  vault,
  requestMT = mtRequest,
  requestFeed = publicRequest,
  requestTorrent = (url) => publicRequest(url, { binary: true }),
  requestTjupt = tjuptRequest,
  queryQB = createQB(),
  port = 4173,
  isLocalRequest,
  deployment = 'local',
  adminPassword = '',
  publicOrigin = '',
  additionalOrigins = [],
}) {
  const nas = deployment === 'nas';
  if (nas && adminPassword.length < 16) throw new Error('NAS 管理密码至少 16 个字符。');
  const adminHash = nas ? scryptSync(adminPassword, 'qiliu-admin-v1', 32) : null;
  const adminSessions = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '96kb' }));
  let config = vault.read();
  const qb = queryQB;
  const tjupt = createTjuptClient(requestTjupt);
  const clearTjuptCache = () => {
    for (const key of caches.keys())
      if (key.startsWith('tjupt:') || key.startsWith('farming:tjupt:')) caches.delete(key);
  };
  const downloads = createDownloads({
    query: qb,
    fetchTorrent: requestTorrent,
    resolveSource: async (input) => {
      if (/^mt-\d+$/.test(input.id) && config.mteam) {
        const url = await mt('download', config.mteam, '/torrent/genDlToken', { id: input.id.slice(3) });
        if (typeof url !== 'string') throw new Error('站点没有返回种子下载链接。');
        validateURL(url);
        return url;
      }
      if (/^tjupt-\d+$/.test(input.id) && config.tjupt) {
        const url = tjuptDownloadURL(config.tjupt, input.id.slice(6));
        validateURL(url);
        return url;
      }
      const feed = config.feeds.find((f) => f.id === input.feedId);
      if (!feed) throw new Error('请连接 M-Team，或保留此资源的 RSS 订阅。');
      const items = parseFeed(await requestFeed(feed.url), feed);
      const item = items.find((i) => i.id === input.id);
      if (!item?.downloadUrl) throw new Error('RSS 中未找到种子下载链接；请刷新订阅后重试。');
      validateURL(item.downloadUrl);
      return item.downloadUrl;
    },
  });
  let profileCache = null;
  const caches = new Map(),
    sessions = new Map(),
    attempts = new Map(),
    buckets = new Map();
  let pairing = null;
  const tjuptAttempts = [];
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]', ...addresses]);
  const configuredOrigins = new Set(
    [publicOrigin, ...additionalOrigins].filter(Boolean).map((value) => {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error('访问地址必须为 HTTP(S) origin。');
      hosts.add(url.hostname);
      return url.origin;
    }),
  );
  const admin = (req) => {
    const token = /(?:^|; )qiliu=([a-f0-9]+)/.exec(req.get('Cookie') || '')?.[1];
    return token && (adminSessions.get(token) || 0) > Date.now();
  };
  const local = nas
    ? (req) => !!admin(req)
    : isLocalRequest || ((req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress));
  const save = () => vault.write(config);
  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const localOnly = (req, res, next) =>
    local(req) ? next() : res.status(403).json({ error: '请在 Mac 本机管理连接密钥。' });
  const rate = (bucket = 'browse') => {
    const now = Date.now();
    const list = (buckets.get(bucket) || []).filter((t) => now - t < 60000);
    const limits = { profile: 15, browse: 25, connect: 5, download: 10 };
    if (list.length >= (limits[bucket] || 25)) throw new Error('请求较频繁，请一分钟后重试。');
    list.push(now);
    buckets.set(bucket, list);
    if (buckets.size > 8)
      for (const [key, stamps] of buckets) if (!stamps.some((t) => now - t < 60000)) buckets.delete(key);
  };
  const mt = (bucket, ...args) => {
    rate(bucket);
    return requestMT(...args);
  };
  async function cached(key, ttl, loader) {
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
    } catch (error) {
      if (old) caches.set(key, { value: old.value, time: old.time });
      else caches.delete(key);
      throw error;
    }
  }
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').set('Referrer-Policy', 'no-referrer');
    if (!hosts.has(req.hostname)) return res.status(403).json({ error: '不允许的访问地址。' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (
        req.get('X-Qiliu') !== '1' ||
        (req.get('Origin') &&
          !configuredOrigins.has(req.get('Origin')) &&
          req.get('Origin') !== `http://${req.get('host')}` &&
          req.get('Origin') !== `https://${req.get('host')}`)
      )
        return res.status(403).json({ error: '请求来源不匹配。' });
    }
    next();
  });
  function authorized(req) {
    if (nas) return !!admin(req);
    if (local(req)) return true;
    const token = /(?:^|; )qiliu=([a-f0-9]+)/.exec(req.get('Cookie') || '')?.[1];
    return token && (sessions.get(token) || 0) > Date.now();
  }
  app.get('/api/auth', (req, res) => res.json({ authorized: !!authorized(req), local: local(req), deployment }));
  app.post('/api/login', (req, res) => {
    if (!nas) return res.status(404).json({ error: '仅 NAS 模式需要登录。' });
    const ip = req.socket.remoteAddress;
    const previous = attempts.get(ip);
    const attempt = previous && Date.now() - previous.time < 900000 ? previous : { count: 0, time: Date.now() };
    attempt.count++;
    attempts.set(ip, attempt);
    if (attempts.size > 1000) {
      for (const [k, v] of attempts) if (Date.now() - v.time > 900000) attempts.delete(k);
    }
    if (attempt.count > 5) return res.status(429).json({ error: '尝试过多，请 15 分钟后重试。' });
    const password = String(req.body.password || '');
    if (password.length > 1024 || !timingSafeEqual(scryptSync(password, 'qiliu-admin-v1', 32), adminHash))
      return res.status(401).json({ error: '管理密码不正确。' });
    const token = randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + 86400000);
    attempts.delete(ip);
    res.cookie('qiliu', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 86400000,
      secure:
        req.secure ||
        [...configuredOrigins].some(
          (origin) => origin.startsWith('https:') && new URL(origin).host === req.get('host'),
        ),
    });
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    const token = /(?:^|; )qiliu=([a-f0-9]+)/.exec(req.get('Cookie') || '')?.[1];
    adminSessions.delete(token);
    sessions.delete(token);
    res.clearCookie('qiliu');
    res.json({ ok: true });
  });
  app.post('/api/pair', (req, res) => {
    if (nas) return res.status(403).json({ error: 'NAS 请使用管理密码登录。' });
    const ip = req.socket.remoteAddress,
      old = attempts.get(ip) || { count: 0, time: Date.now() };
    const item = Date.now() - old.time > 15 * 60000 ? { count: 0, time: Date.now() } : old;
    item.count++;
    attempts.set(ip, item);
    if (item.count > 5) return res.status(429).json({ error: '配对尝试过多，请 15 分钟后重试。' });
    const code = String(req.body.code || '');
    if (
      !pairing ||
      pairing.expires < Date.now() ||
      code.length !== 6 ||
      !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code))
    )
      return res.status(401).json({ error: '配对码不正确或已过期，请查看 Mac 设置页。' });
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 86400000);
    pairing = null;
    res.cookie('qiliu', token, { httpOnly: true, sameSite: 'strict', maxAge: 86400000, secure: req.secure });
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) =>
    authorized(req) ? next() : res.status(401).json({ error: '请先用 Mac 上的配对码连接。' }),
  );
  app.get('/api/state', (req, res) =>
    res.json({
      deployment,
      configured: !!config.mteam,
      base: config.mteam?.base || MT_BASES[0],
      local: local(req),
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
      qb: local(req) ? qbPublicConfig(config.qb) : null,
    }),
  );
  app.post(
    '/api/sites/tjupt/connect',
    localOnly,
    asyncRoute(async (req, res) => {
      const username = String(req.body.username || '').trim(),
        passkey = String(req.body.passkey || '').trim(),
        cookie = String(req.body.cookie || '').trim();
      if (cookie && (cookie.length > 8192 || /[\r\n]/.test(cookie)))
        return res.status(400).json({ error: 'TJUPT Cookie 格式无效。' });
      let password = String(req.body.password || '');
      const keep = !!req.body.keepPassword && config.tjupt && config.tjupt.username === username && !password;
      if (keep) password = config.tjupt.password || '';
      const nextPasskey = passkey || (keep ? config.tjupt.passkey || '' : '');
      if (!cookie && (!username || username.length > 120 || !password || password.length > 256))
        return res.status(400).json({ error: '请填写 TJUPT 用户名和密码，或粘贴登录 Cookie。' });
      if (nextPasskey && !/^[a-f0-9]{32}$/i.test(nextPasskey))
        return res.status(400).json({ error: 'TJUPT passkey 应为 32 位十六进制。' });
      if (cookie) {
        const candidate = { username: username || '', password: '', passkey: nextPasskey, cookie };
        const info = await tjupt.validate(candidate);
        config.tjupt = candidate;
        clearTjuptCache();
        save();
        return res.json({ ok: true, username: info.username, hasPasskey: !!nextPasskey, hasCookie: true });
      }
      const now = Date.now();
      while (tjuptAttempts.length && now - tjuptAttempts[0] > 600000) tjuptAttempts.shift();
      if (tjuptAttempts.length >= 3)
        return res.status(429).json({ error: 'TJUPT 登录尝试过多，请 10 分钟后再试，避免账号 IP 被锁定。' });
      tjuptAttempts.push(now);
      const candidate = { username, password, passkey: nextPasskey };
      const profile = await tjupt.profile(candidate);
      config.tjupt = candidate;
      clearTjuptCache();
      save();
      res.json({ ok: true, username: profile.username || username, hasPasskey: !!nextPasskey, hasCookie: false });
    }),
  );
  app.delete('/api/sites/tjupt/connect', localOnly, (_req, res) => {
    config.tjupt = null;
    tjupt.reset();
    clearTjuptCache();
    save();
    res.json({ ok: true });
  });
  app.post(
    '/api/backup/export',
    localOnly,
    asyncRoute(async (req, res) => {
      const password = String(req.body.password || '');
      if (password.length < 8 || password.length > 256)
        return res.status(400).json({ error: '备份口令至少 8 个字符。' });
      res.json({ backup: await exportBackup(config, password) });
    }),
  );
  app.post(
    '/api/backup/import',
    localOnly,
    asyncRoute(async (req, res) => {
      const next = await importBackup(req.body.backup, String(req.body.password || ''));
      config = next;
      profileCache = null;
      tjupt.reset();
      clearTjuptCache();
      caches.clear();
      save();
      res.json({ ok: true, configured: !!config.mteam, tjuptConfigured: !!config.tjupt, feeds: config.feeds.length });
    }),
  );
  app.post('/api/pairing', localOnly, (req, res) => {
    if (nas) return res.status(403).json({ error: 'NAS 独立登录，无需配对。' });
    pairing = { code: String(randomInt(100000, 1000000)), expires: Date.now() + 600000 };
    res.json({ ...pairing, addresses: addresses.map((ip) => `http://${ip}:${port}`) });
  });
  app.post('/api/revoke', localOnly, (req, res) => {
    sessions.clear();
    pairing = null;
    res.json({ ok: true });
  });
  app.post(
    '/api/connect',
    localOnly,
    asyncRoute(async (req, res) => {
      const base = req.body.base,
        key = String(req.body.key || '').trim();
      if (!MT_BASES.includes(base) || key.length < 8 || key.length > 512 || /[\r\n]/.test(key))
        return res.status(400).json({ error: '请选择有效 API 地址并填写有效的 Access Token。' });
      const candidate = { base, key };
      const profile = normalizeProfile(await mt('connect', candidate, '/member/profile'));
      config.mteam = candidate;
      profileCache = { profile, time: 0 };
      caches.clear();
      save();
      res.json({ ok: true, username: profile.username });
    }),
  );
  app.delete('/api/connect', localOnly, (req, res) => {
    config.mteam = null;
    profileCache = null;
    caches.clear();
    save();
    res.json({ ok: true });
  });
  app.get(
    '/api/profile',
    asyncRoute(async (req, res) => {
      if (String(req.query.site) === 'tjupt') {
        if (!config.tjupt) return res.status(409).json({ error: '尚未连接 TJUPT，请在站点页填写账号。' });
        const profile = await cached('tjupt:profile', 600000, () => tjupt.profile(config.tjupt));
        return res.json({
          ...profile,
          onlineSeeders: profile.seeding ?? null,
          onlineLeechers: profile.leeching ?? null,
          bonusPerDay: profile.bonusPerHour == null ? null : Math.round(profile.bonusPerHour * 24 * 100) / 100,
        });
      }
      if (!config.mteam) return res.status(409).json({ error: '尚未连接 M-Team，请在站点页填写 Token。' });
      if (profileCache && Date.now() - profileCache.time < 60000) return res.json(profileCache.profile);
      try {
        const data = await mt('profile', config.mteam, '/member/profile');
        let peers = null,
          warning = null;
        try {
          peers = await mt('profile', config.mteam, '/tracker/myPeerStatistics');
        } catch {
          warning = '账号资料已更新；做种统计暂不可用。';
        }
        let status = null,
          bonus = null;
        try {
          status = await mt('profile', config.mteam, '/tracker/myPeerStatus');
        } catch {
          warning = '在线做种状态暂不可用。';
        }
        try {
          bonus = await mt('profile', config.mteam, '/tracker/mybonus');
        } catch {
          warning = '每小时魔力收益暂不可用。';
        }
        const profile = {
          ...enrichProfile(normalizeProfile(data, peers), status, bonus, profileCache?.profile),
          warning,
        };
        profileCache = { profile, time: Date.now() };
        res.json(profile);
      } catch (error) {
        if (profileCache)
          return res.json({ ...profileCache.profile, stale: true, warning: `${error.message} 当前显示上次成功数据。` });
        throw error;
      }
    }),
  );
  app.get(
    '/api/resources',
    asyncRoute(async (req, res) => {
      const query = String(req.query.q || '').slice(0, 120),
        page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
      if (String(req.query.site) === 'tjupt') {
        if (!config.tjupt) return res.status(409).json({ error: '尚未连接 TJUPT，请在站点页填写账号。' });
        try {
          const data = await cached('tjupt:search:' + page + ':' + query, 120000, () =>
            tjupt.search(config.tjupt, { keyword: query, page }),
          );
          return res.json({
            items: data.items.map(publicResource),
            warnings: [],
            total: data.items.length,
            hasMore: data.items.length >= 50,
            page,
          });
        } catch (error) {
          return res.json({ items: [], warnings: [error.message], total: 0, hasMore: false, page });
        }
      }
      const source = String(req.query.source || 'all');
      const warnings = [];
      let items = [],
        total = 0;
      if (config.mteam && ['all', 'mteam'].includes(source)) {
        try {
          const data = await cached(`mt:${page}:${query}`, 120000, () =>
            mt('browse', config.mteam, '/torrent/search', {
              mode: 'normal',
              keyword: query,
              pageNumber: page,
              pageSize: 50,
            }),
          );
          if (!Array.isArray(data?.data)) throw new Error('资源接口格式不兼容。');
          items = data.data.map(normalizeTorrent);
          total = Number(data.total) || items.length;
        } catch (error) {
          warnings.push(error.message);
        }
      }
      const feeds =
        source === 'mteam' || (source === 'all' && page > 1)
          ? []
          : config.feeds.filter((f) => source === 'all' || source === 'rss' || f.id === source);
      const results = await Promise.allSettled(
        feeds.map((feed) =>
          cached(`feed:${feed.id}`, 600000, async () => parseFeed(await requestFeed(feed.url), feed)),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled')
          items.push(
            ...result.value.filter((row) =>
              `${row.title} ${row.description}`.toLowerCase().includes(query.toLowerCase()),
            ),
          );
        else warnings.push(`${feeds[index].name}：订阅读取失败，请检查地址或权限。`);
      });
      res.json({ items: mergeResources(items).map(publicResource), warnings, total, hasMore: total > page * 50, page });
    }),
  );
  app.get(
    '/api/farming/candidates',
    asyncRoute(async (req, res) => {
      if (String(req.query.site) === 'tjupt') {
        if (!config.tjupt) return res.status(409).json({ error: '刷流助手需要先连接 TJUPT。' });
        const mode = FARMING_MODES.includes(String(req.query.mode)) ? String(req.query.mode) : 'upload';
        const page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
        const prefs = {
          freeOnly: req.query.freeOnly !== '0',
          hours: Math.max(1, Math.min(168, Number(req.query.hours) || 24)),
          minLeechers: Math.max(0, Math.min(1000, Number(req.query.minLeechers) || 0)),
          maxSizeGB: Math.max(0, Math.min(2048, Number(req.query.maxSizeGB) || 0)),
        };
        const result = await cached(
          'farming:tjupt:' + mode + ':' + JSON.stringify(prefs) + ':' + page,
          60000,
          async () => {
            const data = await tjupt.search(config.tjupt, { keyword: '', page });
            return {
              items: rankCandidates(data.items, { mode, prefs, now: Date.now() }),
              total: data.items.length,
              scanned: data.items.length,
              page,
            };
          },
        );
        return res.json({
          ...result,
          site: 'tjupt',
          mode,
          prefs,
          hasMore: result.scanned >= 50,
          syncedAt: new Date().toISOString(),
        });
      }
      if (!config.mteam) return res.status(409).json({ error: '刷流助手需要先连接 M-Team。' });
      const mode = FARMING_MODES.includes(String(req.query.mode)) ? String(req.query.mode) : 'upload';
      const page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
      const prefs = {
        freeOnly: req.query.freeOnly !== '0',
        hours: Math.max(1, Math.min(168, Number(req.query.hours) || 24)),
        minLeechers: Math.max(0, Math.min(1000, Number(req.query.minLeechers) || 0)),
        maxSizeGB: Math.max(0, Math.min(2048, Number(req.query.maxSizeGB) || 0)),
      };
      const result = await cached(`farming:${mode}:${JSON.stringify(prefs)}:${page}`, 60000, async () => {
        const data = await mt('browse', config.mteam, '/torrent/search', {
          mode: 'normal',
          pageNumber: page,
          pageSize: 50,
          sortField: 'CREATED_DATE',
          sortType: 'DESC',
        });
        if (!Array.isArray(data?.data)) throw new Error('刷流候选接口格式不兼容。');
        return {
          items: rankCandidates(data.data.map(normalizeTorrent), { mode, prefs, now: Date.now() }),
          total: Number(data.total) || 0,
          scanned: data.data.length,
          page,
        };
      });
      res.json({ ...result, mode, prefs, hasMore: result.total > page * 50, syncedAt: new Date().toISOString() });
    }),
  );
  app.post(
    '/api/feeds',
    localOnly,
    asyncRoute(async (req, res) => {
      const name = String(req.body.name || '')
          .trim()
          .slice(0, 40),
        url = String(req.body.url || '').trim();
      if (!name || config.feeds.length >= 15)
        return res.status(400).json({ error: '请填写订阅名称，最多添加 15 个订阅。' });
      validateURL(url);
      if (config.feeds.some((f) => f.url === url)) return res.status(409).json({ error: '这个订阅已存在。' });
      const feed = { id: randomBytes(8).toString('hex'), name, url };
      const items = parseFeed(await requestFeed(url), feed);
      config.feeds.push(feed);
      save();
      caches.set(`feed:${feed.id}`, { time: Date.now(), value: items });
      res.json({ id: feed.id, name, count: items.length });
    }),
  );
  app.delete('/api/feeds/:id', localOnly, (req, res) => {
    config.feeds = config.feeds.filter((f) => f.id !== req.params.id);
    caches.delete(`feed:${req.params.id}`);
    save();
    res.json({ ok: true });
  });
  app.put('/api/favorites', (req, res) => {
    const item = req.body.item;
    if (!item || typeof item.id !== 'string' || item.id.length > 200 || typeof item.title !== 'string')
      return res.status(400).json({ error: '无效资源。' });
    if (req.body.saved && config.favorites.length >= 500)
      return res.status(400).json({ error: '最多收藏 500 条资源。' });
    config.favorites = config.favorites.filter((f) => f.id !== item.id);
    if (req.body.saved) config.favorites.unshift(item);
    save();
    res.json({ favorites: config.favorites });
  });
  app.post(
    '/api/qb/connect',
    localOnly,
    asyncRoute(async (req, res) => {
      const candidate = normalizeQB(req.body);
      if (
        req.body.keepPassword &&
        config.qb &&
        candidate.url === config.qb.url &&
        candidate.username === config.qb.username
      )
        candidate.password = config.qb.password;
      await qb(candidate, '/api/v2/transfer/info');
      config.qb = candidate;
      caches.delete('qb');
      save();
      res.json({ ok: true });
    }),
  );
  app.delete('/api/qb/connect', localOnly, (_req, res) => {
    config.qb = null;
    caches.delete('qb');
    save();
    res.json({ ok: true });
  });
  app.get(
    '/api/qb/status',
    asyncRoute(async (_req, res) => {
      if (!config.qb) throw new Error('请先连接 qBittorrent。');
      res.json(
        await cached('qb', 3000, async () => {
          const info = await qb(config.qb, '/api/v2/transfer/info');
          const torrents = await qb(
            config.qb,
            '/api/v2/torrents/info?filter=active&sort=upspeed&reverse=true&limit=20',
          );
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
        }),
      );
    }),
  );
  app.get(
    '/api/qb/options',
    localOnly,
    asyncRoute(async (_req, res) => res.json(await qbOptions(qb, config.qb))),
  );
  app.get(
    '/api/qb/tasks',
    asyncRoute(async (req, res) => res.json(await qbTasks(qb, config.qb, new URLSearchParams(req.query)))),
  );
  app.post(
    '/api/qb/add',
    localOnly,
    asyncRoute(async (req, res) => {
      const result = await downloads(config.qb, req.body);
      caches.delete('qb');
      res.json(result);
    }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: '未找到此操作。' }));
  app.use((error, _req, res, _next) =>
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ error: error.type ? '请求格式无效或内容过大。' : error.message || '请求失败。' }),
  );
  return app;
}
