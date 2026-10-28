import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createQBClient } from './qb-client.mjs';
export async function qbHTTP(raw, { method = 'GET', headers = {}, body = '', bodyBase64 } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请输入有效的 Web UI 地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('下载器地址无效。');
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length) throw new Error('地址无法解析。');
  const payload = bodyBase64 ? Buffer.from(bodyBase64, 'base64') : Buffer.from(body);
  // qBittorrent's HTTP parser requires a known body length (not chunked encoding).
  headers = { ...headers };
  if (payload.length || method === 'POST') headers['Content-Length'] = payload.length;
  const selected = addresses.find((a) => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const r = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method,
        headers,
        lookup: (_h, o, cb) => (o?.all ? cb(null, [selected]) : cb(null, selected.address, selected.family)),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 4194304) r.destroy();
          else chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
            cookie: res.headers['set-cookie']?.[0] || '',
          }),
        );
        res.on('error', () => reject(new Error('下载器响应失败。')));
      },
    );
    r.setTimeout(15000, () => r.destroy());
    r.on('error', () => reject(new Error('无法连接下载器，请检查网络、地址或证书。')));
    r.end(payload);
  });
}
export const createQB = (request = qbHTTP) => createQBClient(request);
