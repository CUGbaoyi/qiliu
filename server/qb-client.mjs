// Shared by the native bridge and NAS HTTP transport.
export function normalizeQB(config) {
  let url;
  try {
    url = new URL(String(config?.url || '').trim());
  } catch {
    throw new Error('Web UI 地址无效；IPv6 请使用 http://[IPv6地址]:端口。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search)
    throw new Error('请填写不含账号、密码和查询参数的 HTTP(S) Web UI 地址。');
  return {
    url: url.href.replace(/\/+$/, ''),
    username: String(config.username || ''),
    password: String(config.password || ''),
  };
}
export function qbPublicConfig(config) {
  return config ? { url: config.url, username: config.username } : null;
}
export function createQBClient(request) {
  let session = null;
  return async function query(config, path, options = {}) {
    if (!config) throw new Error('请先连接 qBittorrent。');
    // Also accepts the old retry=true argument used by the first release.
    if (typeof options === 'boolean') options = {};
    const candidate = normalizeQB(config),
      id = JSON.stringify(candidate);
    if (!session || session.id !== id) session = { id, cookie: '', login: null };
    const current = session,
      origin = new URL(candidate.url).origin;
    async function login() {
      current.login ??= (async () => {
        const r = await request(candidate.url + '/api/v2/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: origin,
            Referer: candidate.url + '/',
          },
          body: new URLSearchParams({ username: candidate.username, password: candidate.password }).toString(),
        });
        // qBittorrent 5.2 returns 204 with an empty body; older versions return 200 / Ok.
        const ok = r.status === 204 || (r.status === 200 && r.body.trim() === 'Ok.');
        if (!ok) {
          if (r.status === 401 || (r.status === 200 && r.body.trim() === 'Fails.'))
            throw new Error('qBittorrent 拒绝了登录，请检查用户名和密码。');
          if (r.status === 403)
            throw new Error('qBittorrent 拒绝访问（HTTP 403），请检查 Web UI 访问限制或 IP 临时封禁。');
          throw new Error(`qBittorrent 登录响应不兼容（HTTP ${r.status}），请确认地址指向 Web UI。`);
        }
        current.cookie = (r.cookie || '').split(';')[0];
      })().finally(() => {
        current.login = null;
      });
      await current.login;
    }
    if (!current.cookie) await login();
    const send = () =>
      request(candidate.url + path, {
        ...options,
        headers: { ...options.headers, Cookie: current.cookie, Origin: origin, Referer: candidate.url + '/' },
      });
    let r = await send();
    if (r.status === 401 || r.status === 403) {
      current.cookie = '';
      await login();
      r = await send();
    }
    if (r.status === 204 && options.text) return '';
    if (r.status !== 200) throw new Error(`qBittorrent 返回 HTTP ${r.status}。`);
    if (options.text) return r.body;
    try {
      return JSON.parse(r.body);
    } catch {
      throw new Error('qBittorrent 响应格式不兼容。');
    }
  };
}
export function normalizeTask(t) {
  return {
    hash: t.hash,
    name: String(t.name || ''),
    state: t.state,
    progress: Number(t.progress),
    size: Number(t.size),
    upSpeed: Number(t.upspeed),
    downSpeed: Number(t.dlspeed),
    ratio: Number(t.ratio),
    savePath: t.save_path,
    category: t.category,
    added: t.added_on,
  };
}
export async function qbTasks(query, config, params) {
  const filter = ['all', 'downloading', 'seeding', 'paused', 'stopped'].includes(params.get('filter'))
    ? params.get('filter')
    : 'all';
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
  const rows = await query(
    config,
    `/api/v2/torrents/info?filter=${filter}&sort=added_on&reverse=true&limit=51&offset=${(page - 1) * 50}`,
  );
  if (!Array.isArray(rows)) throw new Error('qBittorrent 任务列表格式不兼容。');
  return {
    items: rows.slice(0, 50).map(normalizeTask),
    hasMore: rows.length > 50,
    page,
    syncedAt: new Date().toISOString(),
  };
}
export async function qbOptions(query, config) {
  const [path, categories] = await Promise.allSettled([
    query(config, '/api/v2/app/defaultSavePath', { text: true }),
    query(config, '/api/v2/torrents/categories'),
  ]);
  return {
    savePath: path.status === 'fulfilled' ? path.value : '',
    categories: categories.status === 'fulfilled' ? Object.keys(categories.value) : [],
    warning:
      path.status === 'rejected' || categories.status === 'rejected'
        ? '部分下载选项未能读取；留空将使用 qBittorrent 默认设置。'
        : '',
  };
}
