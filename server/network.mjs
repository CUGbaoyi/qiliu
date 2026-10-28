import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { MT_BASES, TJUPT_HOSTS } from './sites.mjs';

export { MT_BASES, TJUPT_HOSTS };

export function isPublicIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Public global unicast only. Reject mapped IPv4, link-local and transition ranges.
  return isIP(ip) === 6 && /^[23]/i.test(ip) && !/^2001:(?:0:|db8:|10:)/i.test(ip) && !/^2002:/i.test(ip);
}
export function validateURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请输入完整的 HTTPS 地址。');
  }
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash ||
    raw.length > 4096
  )
    throw new Error('仅支持不含用户密码的标准 HTTPS 地址。');
  if (
    isIP(url.hostname.replaceAll('[', '').replaceAll(']', '')) &&
    !isPublicIP(url.hostname.replaceAll('[', '').replaceAll(']', ''))
  )
    throw new Error('不能连接本地或内网地址。');
  return url;
}
export async function publicRequest(
  raw,
  { method = 'GET', headers = {}, body, maxBytes = 4 * 1024 * 1024, binary = false, redirects = 0 } = {},
) {
  const url = validateURL(raw);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
    throw new Error('站点地址不能解析到内网或保留地址。');
  const selected = addresses.find((a) => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { 'User-Agent': 'Qiliu/0.1', 'Accept-Encoding': 'identity', ...headers },
        lookup: (_host, options, callback) =>
          options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      },
      (res) => {
        if (binary && [301, 302, 303, 307, 308].includes(res.statusCode) && redirects < 3 && res.headers.location) {
          res.resume();
          resolve(
            publicRequest(new URL(res.headers.location, url).href, {
              binary: true,
              redirects: redirects + 1,
              maxBytes,
            }),
          );
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(
            new Error(
              res.statusCode === 401 || res.statusCode === 403
                ? '站点拒绝访问，请检查 Token、权限或网络。'
                : res.statusCode === 429
                  ? '站点请求过于频繁，请稍后重试。'
                  : `站点返回 HTTP ${res.statusCode}；若为跳转，请填写最终 HTTPS 地址。`,
            ),
          );
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error('站点响应超过大小限制。'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
        res.on('error', () => reject(new Error('读取站点响应失败。')));
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('连接超时，请检查站点或网络。')), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) =>
      reject(
        new Error(
          err.message.includes('限制') || err.message.includes('超时')
            ? err.message
            : '无法连接站点，请检查网络或地址。',
        ),
      ),
    );
    if (body) req.write(body);
    req.end();
  });
}
// NexusPHP 页面请求：只允许 TJUPT 官方 HTTPS 地址，返回 Set-Cookie/Location 由调用方处理。
export async function tjuptRequest(raw, { method = 'GET', headers = {}, body = '', maxBytes = 2 * 1024 * 1024 } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TJUPT 地址无效。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !TJUPT_HOSTS.includes(url.hostname))
    throw new Error('仅允许访问 TJUPT 官方 HTTPS 地址。');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicIP(item.address)))
    throw new Error('TJUPT 地址不能解析到内网或保留地址。');
  const selected = addresses.find((item) => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Encoding': 'identity',
          ...headers,
        },
        lookup: (_host, options, callback) =>
          options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error('TJUPT 响应超过大小限制。'));
          else chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: {
              'set-cookie': res.headers['set-cookie'] || [],
              location: res.headers.location || '',
              'content-type': res.headers['content-type'] || '',
            },
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', () => reject(new Error('读取 TJUPT 响应失败。')));
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('连接 TJUPT 超时，请检查网络。')), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (error) =>
      reject(
        new Error(
          error.message.includes('超时') || error.message.includes('限制')
            ? error.message
            : '无法连接 TJUPT，请检查网络或站点状态。',
        ),
      ),
    );
    if (body) req.write(body);
    req.end();
  });
}
export async function mtRequest(config, endpoint, data = {}) {
  if (!MT_BASES.includes(config.base)) throw new Error('不支持此 M-Team API 地址。');
  const form = endpoint === '/torrent/genDlToken';
  const response = await publicRequest(`${config.base}${endpoint}`, {
    method: 'POST',
    headers: {
      'x-api-key': config.key,
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: form ? new URLSearchParams(data).toString() : JSON.stringify(data),
  });
  let json;
  try {
    json = JSON.parse(response);
  } catch {
    throw new Error('站点返回了非 JSON 内容，可能需要验证访问权限。');
  }
  if (String(json.code) !== '0')
    throw new Error(
      `M-Team 请求未成功（状态码 ${String(json.code)
        .replace(/[^\w-]/g, '')
        .slice(0, 20)}），请检查 Token 权限。`,
    );
  return json.data;
}
