// TJUPT（北洋园 PT，NexusPHP）接入：登录 cookie 抓取账号与搜索，passkey 下载。
// 站点无开放 API；解析保留“主选择器 + 全文正则”双路，解析失败返回 null 而不是 0。
// 本模块不依赖 Node API，Web/NAS 服务端与原生客户端共用；网络请求由调用方注入。
import { TJUPT_BASE, TJUPT_HOSTS } from './sites.mjs';

export { TJUPT_BASE, TJUPT_HOSTS };
export const TJUPT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 };

export function parseSize(text) {
  const match = /([\d][\d,]*\.?\d*)\s*([EPTGMK]?i?B)/i.exec(String(text || ''));
  if (!match) return null;
  const value = Number(match[1].replaceAll(',', ''));
  const unit = match[2].toUpperCase().replace('IB', 'B');
  return Number.isFinite(value) && UNITS[unit] ? Math.round(value * UNITS[unit]) : null;
}

const textOf = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const pick = (html, patterns) => {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1] ?? match[0];
  }
  return null;
};
const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(
    String(value)
      .replaceAll(',', '')
      .replace(/[^\d.]/g, ''),
  );
  return Number.isFinite(parsed) ? parsed : null;
};
const cookieMap = (list) => {
  const map = new Map();
  for (const header of (Array.isArray(list) ? list : [list]).filter(Boolean)) {
    for (const part of String(header).split(',')) {
      const item = part.split(';')[0].trim();
      if (!item.includes('=') || /^expires=/i.test(item)) continue;
      const name = item.slice(0, item.indexOf('=')).trim();
      if (name) map.set(name, item);
    }
  }
  return map;
};
export function parseCookies(list) {
  return [...cookieMap(list).values()].join('; ');
}
export function mergeCookies(...lists) {
  const map = new Map();
  for (const list of lists) for (const [name, pair] of cookieMap(list)) map.set(name, pair);
  return [...map.values()].join('; ');
}

export function isLoggedIn(html) {
  const source = String(html || '');
  if (/name="loginform"|takelogin\.php/i.test(source)) return false;
  return /logout\.php|usercp\.php\?action=logout/i.test(source);
}

export function parseIndexInfo(html) {
  const source = String(html || '');
  const uid = pick(source, [/userdetails\.php\?id=(\d+)/]);
  const titleName = pick(source, [/用户详情\s*-\s*([^-<]{1,40})\s*-/]);
  const welcomeName = pick(source, [/欢迎,\s*[\s\S]{0,300}?<b><span[^>]*>([^<]{1,40})<\/span>/]);
  return {
    uid: uid ? Number(uid) : null,
    username: titleName ? textOf(titleName) : welcomeName ? textOf(welcomeName) : null,
  };
}

export function parseProfile(html) {
  const source = String(html || '');
  const uploaded = parseSize(
    pick(source, [
      /color_uploaded[^>]*>\s*上[传傳]量[:：]?\s*<\/span>\s*([\d.,]+\s*[EPTGMK]?i?B)/i,
      /color_uploaded[^>]*>[^<]*<\/span>\s*([\d.,]+\s*[EPTGMK]?i?B)/i,
      /上[传傳]量[^0-9]{0,40}([\d.,]+\s*[EPTGMK]?i?B)/i,
    ]),
  );
  const downloaded = parseSize(
    pick(source, [
      /color_downloaded[^>]*>\s*下[载載]量[:：]?\s*<\/span>\s*([\d.,]+\s*[EPTGMK]?i?B)/i,
      /color_downloaded[^>]*>[^<]*<\/span>\s*([\d.,]+\s*[EPTGMK]?i?B)/i,
      /下[载載]量[^0-9]{0,40}([\d.,]+\s*[EPTGMK]?i?B)/i,
    ]),
  );
  const ratioText = pick(source, [
    /color_ratio[^>]*>\s*分享率[:：]?\s*<\/span>\s*([\d.,]+|∞|Inf)/i,
    /分享率[^0-9∞]{0,40}([\d.,]+|∞|Inf)/i,
  ]);
  const bonus = number(
    pick(source, [
      /魔力值\s*<\/span>\s*\[[^\]]*\]\s*:\s*<a[^>]*>([\d,]+(?:\.\d+)?)<\/a>/i,
      /(?:魔力值|冰晶)[^0-9]{0,40}([\d,]+(?:\.\d+)?)/i,
    ]),
  );
  const role =
    textOf(
      pick(source, [
        /等级[:：]?\s*<\/span>\s*\[\s*<a[^>]*>[\s\S]{0,160}?<span[^>]*>([^<]+)<\/span>/i,
        /(?:等级|等級|Class)[\s\S]{0,80}?<img[^>]*title="([^"]+)"/i,
      ]) || '',
    ) || null;
  const seeding = number(pick(source, [/title="当前做种数"[^>]*\/?>\s*(\d+)/i]));
  const leeching = number(pick(source, [/title="当前下载数"[^>]*\/?>\s*(\d+)/i]));
  const invites = number(pick(source, [/color_invite[^>]*>\s*邀请[:：]?\s*<\/span>\s*<a[^>]*>(\d+)<\/a>/i]));
  const joined = textOf(pick(source, [/加入日期[^<]*<\/td>\s*<td[^>]*>\s*([\d-]+ [\d:]+)/i]) || '') || null;
  const ratio = ratioText === '∞' || ratioText === 'Inf' ? '∞' : number(ratioText);
  return {
    uploaded,
    downloaded,
    ratio: ratio ?? (uploaded !== null && downloaded ? uploaded / downloaded : null),
    bonus,
    role,
    joined,
    seeding,
    leeching,
    invites,
  };
}

export function parseSeeding(html) {
  const source = String(html || '');
  const header = /<b>(\d+)<\/b>\s*条记录\s*-\s*总大小\s*([\d.,]+\s*[EPTGMK]?i?B)/i.exec(source);
  if (header) return { seeding: Number(header[1]), seedingSize: parseSize(header[2]) };
  const rows = source
    .split(/<tr[^>]*>/i)
    .slice(1)
    .filter((row) => /details\.php\?id=\d+/i.test(row));
  let size = 0,
    counted = 0;
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => textOf(match[1]));
    const value = cells.map(parseSize).find((item) => item !== null && item > 0);
    if (value) {
      size += value;
      counted++;
    }
  }
  return { seeding: rows.length, seedingSize: counted ? size : null };
}

export function parseBonus(html) {
  return number(
    pick(String(html || ''), [
      /你当前每小时能获取\s*([\d.,]+)\s*个魔力值/i,
      /你当前每小时能获取[^0-9]{0,40}([\d.,]+)/i,
      /每小时[^0-9]{0,40}([\d.,]+)/i,
    ]),
  );
}

export function discountFrom(row) {
  const source = String(row || '');
  if (/pro_free2up|free2up|twoupfree|2xfree|2X免费/i.test(source)) return '2X_FREE';
  if (/pro_free|free_bg|alt="免费"|title="免费"/i.test(source)) return 'FREE';
  if (/pro_2up|twoup_bg|alt="2X"|title="2X"/i.test(source)) return '2X';
  if (/pro_50pctdown|halfdown|50pct/i.test(source)) return '50%';
  if (/pro_30pctdown|thirtypercent|30pct/i.test(source)) return '30%';
  return 'NORMAL';
}

export function parseTorrentList(html) {
  const items = [];
  const rowPattern =
    /<td class="rowfollow nowrap"[^>]*>([\s\S]*?)<\/td>\s*<td class="rowfollow"[^>]*>\s*<table class="torrentname"[^>]*>([\s\S]*?)<\/table>([\s\S]*?)<\/tr>/gi;
  for (const match of String(html || '').matchAll(rowPattern)) {
    const [, categoryCell, inner, tail] = match;
    const link = /<a[^>]*href="details\.php\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    if (!link) continue;
    const id = link[1];
    const titled = /<a[^>]*title="([^"]+)"[^>]*href="details\.php\?id=\d+/i.exec(inner);
    const title = textOf(titled?.[1] || link[2] || '');
    const cells = [...tail.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]));
    const sizeIndex = cells.findIndex((cell) => parseSize(cell) !== null);
    const size = sizeIndex >= 0 ? parseSize(cells[sizeIndex]) : null;
    const numeric = cells.slice(sizeIndex + 1, sizeIndex + 4).map(number);
    const dateMatch = /(\d{4}-\d{2}-\d{2})\s*<br\s*\/?>\s*(\d{2}:\d{2}:\d{2})/i.exec(tail);
    const date = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}` : pick(tail, [/<span[^>]*title="([^"]+)"/i]);
    const category = pick(categoryCell, [/cat=(\d+)/i]) || '';
    const discount = discountFrom(categoryCell + inner + tail);
    items.push({
      id: `tjupt-${id}`,
      title: title || `TJUPT 资源 ${id}`,
      filename: title || `TJUPT 资源 ${id}`,
      source: 'TJUPT',
      category,
      resolution: /2160|4k/i.test(title) ? '4K' : /1080p/i.test(title) ? '1080p' : /720p/i.test(title) ? '720p' : '—',
      size,
      seeders: numeric[0],
      leechers: numeric[1],
      completed: numeric[2],
      free: discount === 'FREE' || discount === '2X_FREE',
      discount,
      image: null,
      description: '',
      date: date || null,
      url: `https://tjupt.org/details.php?id=${id}`,
      downloadable: true,
      demo: false,
    });
  }
  return items;
}

export function downloadURL(config, id) {
  if (!config?.passkey) throw new Error('TJUPT 需要 passkey 才能下载种子。');
  if (!/^\d+$/.test(String(id))) throw new Error('TJUPT 种子编号无效。');
  return `${TJUPT_BASE}/download.php?id=${id}&passkey=${encodeURIComponent(config.passkey)}`;
}

// fetchPage(url, {method, headers, body}) -> {status, headers:{'set-cookie','location','content-type'}, body}
export function createTjuptClient(fetchPage) {
  let session = null;
  const request = (url, options = {}) =>
    fetchPage(url.startsWith('http') ? url : `${TJUPT_BASE}${url}`, {
      ...options,
      headers: { 'User-Agent': TJUPT_UA, ...(options.headers || {}) },
    });
  const collect = (response) => parseCookies(response?.headers?.['set-cookie'] ?? response?.cookie ?? []);

  async function login(config) {
    if (!config?.username || !config?.password) throw new Error('TJUPT 需要用户名和密码。');
    const initial = await request('/login.php');
    let cookie = collect(initial);
    const response = await request('/takelogin.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
      body: new URLSearchParams({ username: config.username, password: config.password, logout: '90' }).toString(),
    });
    if (/verify_code|两步验证/.test(response.body))
      throw new Error('TJUPT 账号开启了两步验证（6 位验证码）：请改用浏览器登录后的 Cookie 连接。');
    cookie = mergeCookies(cookie, collect(response));
    const target = response?.headers?.location
      ? new URL(response.headers.location, TJUPT_BASE).href
      : `${TJUPT_BASE}/usercp.php`;
    const probe = await request(target, { headers: cookie ? { Cookie: cookie } : {} });
    cookie = mergeCookies(cookie, collect(probe));
    if (!isLoggedIn(probe.body))
      throw new Error('TJUPT 登录未成功；为避免账号被锁定，不会自动重试。请检查用户名、密码或账号状态。');
    session = { mode: 'password', username: config.username, cookie, uid: parseIndexInfo(probe.body).uid };
    return session;
  }
  async function cookieSession(config) {
    if (session && session.mode === 'cookie' && session.cookie === config.cookie) return session;
    const probe = await request('/usercp.php', { headers: { Cookie: config.cookie } });
    if (!isLoggedIn(probe.body)) throw new Error('TJUPT 登录 Cookie 已失效，请重新从浏览器复制。');
    const info = parseIndexInfo(probe.body);
    session = { mode: 'cookie', username: config.username || 'TJUPT', cookie: config.cookie, uid: info.uid };
    return session;
  }
  async function ensure(config) {
    if (config?.cookie) return cookieSession(config);
    if (session && session.username === config.username) return session;
    return login(config);
  }
  async function get(config, path) {
    const current = await ensure(config);
    let response = await request(path, { headers: current.cookie ? { Cookie: current.cookie } : {} });
    const expired = response.status >= 300 || /name="loginform"|takelogin\.php/i.test(response.body);
    if (expired) {
      session = null;
      if (config?.cookie) throw new Error('TJUPT 登录 Cookie 已失效，请重新从浏览器复制。');
      const retry = await ensure(config);
      response = await request(path, { headers: retry.cookie ? { Cookie: retry.cookie } : {} });
      if (response.status >= 300 || /name="loginform"|takelogin\.php/i.test(response.body))
        throw new Error('TJUPT 登录态失效，请重新连接站点。');
    }
    return response;
  }
  return {
    reset() {
      session = null;
    },
    async validate(config) {
      const current = await ensure(config);
      const probe = await get(config, `/userdetails.php?id=${current.uid || ''}`);
      const info = parseIndexInfo(probe.body);
      return {
        username: info.username || config.username || 'TJUPT',
        uid: current.uid || info.uid,
        hasCookie: !!config.cookie,
      };
    },
    async profile(config) {
      const current = await ensure(config);
      const details = await get(config, `/userdetails.php?id=${current.uid || ''}`);
      const parsed = parseProfile(details.body);
      const index = parseIndexInfo(details.body);
      let seeding = { seeding: null, seedingSize: null },
        bonusPerHour = null;
      try {
        seeding = parseSeeding(
          (await get(config, `/getusertorrentlistajax.php?userid=${current.uid || ''}&type=seeding`)).body,
        );
      } catch {
        seeding = { seeding: null, seedingSize: null };
      }
      try {
        bonusPerHour = parseBonus((await get(config, '/bonus.php?show=description')).body);
      } catch {
        bonusPerHour = null;
      }
      return {
        username: index.username || config.username || 'TJUPT',
        uid: current.uid || index.uid,
        role: parsed.role || 'TJUPT',
        uploaded: parsed.uploaded,
        downloaded: parsed.downloaded,
        ratio: parsed.ratio,
        bonus: parsed.bonus,
        seeding: seeding.seeding,
        seedingSize: seeding.seedingSize,
        bonusPerHour,
        joined: parsed.joined,
        syncedAt: new Date().toISOString(),
        demo: false,
        source: 'tjupt',
      };
    },
    async search(config, { keyword = '', page = 1 } = {}) {
      const params = new URLSearchParams({
        search: String(keyword || '').slice(0, 120),
        search_mode: '1',
        search_area: '0',
        incldead: '0',
        spstate: '0',
        sort: '4',
        type: 'desc',
      });
      if (page > 1) params.set('page', String(page));
      const response = await get(config, `/torrents.php?${params}`);
      return { items: parseTorrentList(response.body), page };
    },
  };
}
