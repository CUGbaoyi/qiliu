import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from '@noble/hashes/utils';
import { normalizeTask } from './qb-client.mjs';

export const MAX_TORRENT_BYTES = 4 * 1024 * 1024;
export const fromBase64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
// Hash the exact bencoded info bytes, never a decode/re-encode approximation.
export function torrentHash(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_TORRENT_BYTES)
    throw new Error('种子文件为空或超过 4 MB。');
  let pos = 0,
    info = null,
    pieces = false;
  const bad = () => {
    throw new Error('下载内容不是有效的 v1 / hybrid 种子文件。');
  };
  const str = () => {
    const start = pos;
    while (bytes[pos] >= 48 && bytes[pos] <= 57) pos++;
    if (pos === start || pos - start > 8 || bytes[pos] !== 58) bad();
    const size = Number(new TextDecoder().decode(bytes.subarray(start, pos++)));
    if (!Number.isSafeInteger(size) || pos + size > bytes.length) bad();
    const value = bytes.subarray(pos, pos + size);
    pos += size;
    return value;
  };
  const value = (depth = 0, inInfo = false) => {
    if (depth > 64 || pos >= bytes.length) bad();
    const kind = bytes[pos];
    if (kind === 100 || kind === 108) {
      pos++;
      const keys = new Set();
      while (pos < bytes.length && bytes[pos] !== 101) {
        let key = '';
        if (kind === 100) {
          key = new TextDecoder().decode(str());
          if (keys.has(key)) bad();
          keys.add(key);
        }
        const start = pos;
        value(depth + 1, depth === 0 && key === 'info');
        if (depth === 0 && key === 'info') {
          if (bytes[start] !== 100) bad();
          info = bytes.subarray(start, pos);
        }
        if (inInfo && key === 'pieces') {
          if (bytes[start] < 48 || bytes[start] > 57) bad();
          pieces = true;
        }
      }
      if (bytes[pos++] !== 101) bad();
    } else if (kind === 105) {
      const start = ++pos;
      while (pos < bytes.length && bytes[pos] !== 101) pos++;
      if (bytes[pos] !== 101 || !/^-?(?:0|[1-9]\d*)$/.test(new TextDecoder().decode(bytes.subarray(start, pos)))) bad();
      pos++;
    } else str();
  };
  if (bytes[0] !== 100) bad();
  value();
  if (pos !== bytes.length || !info || !pieces) bad();
  return bytesToHex(sha1(info));
}
export function torrentMultipart(bytes, options = {}) {
  const boundary = '----Qiliu' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const fields = { paused: String(!!options.paused), stopped: String(!!options.paused), skip_checking: 'false' };
  for (const [key, val] of [
    ['savepath', options.savePath],
    ['category', options.category],
  ]) {
    if (val !== undefined && typeof val !== 'string') throw new Error('下载选项格式无效。');
    if (val?.trim()) {
      if (val.length > 1024 || /[\r\n\0]/.test(val)) throw new Error('下载目录或分类格式无效。');
      fields[key] = val.trim();
    }
  }
  if (fields.savepath) fields.autoTMM = 'false';
  const encoder = new TextEncoder();
  const parts = Object.entries(fields).map(([k, v]) =>
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="qiliu.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n`,
    ),
    bytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  );
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    bodyBase64: toBase64(result),
    text: true,
  };
}
export function createDownloads({ query, resolveSource, fetchTorrent }) {
  const locks = new Map();
  return async (config, input) => {
    if (!config) throw new Error('请先连接 qBittorrent。');
    if (input?.demo || typeof input?.id !== 'string' || input.id.length > 200) throw new Error('请选择真实资源。');
    const bytes = await fetchTorrent(await resolveSource(input));
    const hash = torrentHash(bytes),
      key = config.url + ':' + hash;
    if (locks.has(key)) return locks.get(key);
    const job = (async () => {
      const find = async () => {
        const rows = await query(config, '/api/v2/torrents/info?hashes=' + hash);
        if (!Array.isArray(rows)) throw new Error('任务查询失败。');
        return rows.find((t) => t.hash?.toLowerCase() === hash);
      };
      const findWithRetry = async (attempts = 3) => {
        for (let index = 0; index < attempts; index++) {
          try {
            const found = await find();
            if (found) return found;
          } catch {
            /* 任务列表短暂不可用时继续重试 */
          }
          if (index < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
      };
      const existing = await find();
      if (existing) return { status: 'existing', hash, task: normalizeTask(existing) };
      const request = torrentMultipart(bytes, input);
      let answer;
      try {
        answer = await query(config, '/api/v2/torrents/add', request);
      } catch {
        throw new Error('提交结果未确认，请先刷新下载任务；重新发送前会按种子哈希检查重复。');
      }
      // qBittorrent 不同版本对 /torrents/add 的响应不一致（Ok. / Ok / 空 body / JSON 统计）。
      // 只有明确失败才报错；其余一律以「任务哈希是否出现」为准，避免 accepted 但误报拒绝。
      const answerText = String(answer ?? '').trim();
      if (/^(?:fails?\b|error\b)/i.test(answerText))
        throw new Error('qBittorrent 拒绝了种子，请检查下载目录、磁盘空间或种子有效性。');
      const task = await findWithRetry();
      return { status: task ? 'added' : 'pending', hash, task: task ? normalizeTask(task) : null };
    })();
    locks.set(key, job);
    try {
      return await job;
    } finally {
      locks.delete(key);
    }
  };
}
export function downloadCompleted(previous, next) {
  if (!previous || !next) return false;
  const before = Number(previous.progress),
    after = Number(next.progress);
  return Number.isFinite(before) && Number.isFinite(after) && before < 1 && after >= 1;
}
