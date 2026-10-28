// 配置备份：口令加密的可移植导出/导入。纯 JS（noble），Web/NAS 与原生端共用。
import { gcm } from '@noble/ciphers/aes';
import { scrypt } from '@noble/hashes/scrypt';
import { randomBytes } from '@noble/hashes/utils';
import { MT_BASES } from './sites.mjs';

export const BACKUP_FORMAT = 'qiliu-backup';
export const BACKUP_VERSION = 1;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const utf8 = (value) => new TextEncoder().encode(String(value));
const b64encode = (bytes) => {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index],
      b = bytes[index + 1],
      c = bytes[index + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) {
      out += '==';
      break;
    }
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) {
      out += '=';
      break;
    }
    out += B64[c & 63];
  }
  return out;
};
const b64decode = (value) => {
  const clean = String(value || '').replace(/[^A-Za-z0-9+/]/g, '');
  if (!clean.length) return new Uint8Array();
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let position = 0,
    buffer = 0,
    bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[position++] = (buffer >> bits) & 255;
    }
  }
  return bytes.slice(0, position);
};
const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value) => {
  const text = String(value || '');
  if (!/^[a-f0-9]*$/i.test(text) || text.length % 2) throw new Error('备份字段格式无效。');
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

const isString = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max;
const httpsURL = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('备份内容不是有效的栖流配置。');
  const out = { mteam: null, tjupt: null, feeds: [], favorites: [], qb: null };
  if (raw.mteam !== null && raw.mteam !== undefined) {
    const { base, key } = raw.mteam;
    if (!MT_BASES.includes(base) || !isString(key, 8, 512) || /[\r\n]/.test(key))
      throw new Error('备份中的 M-Team 连接无效。');
    out.mteam = { base, key };
  }
  if (raw.tjupt !== null && raw.tjupt !== undefined) {
    const { username, password, passkey, cookie } = raw.tjupt;
    const hasCookie = isString(cookie, 1, 8192) && !/[\r\n]/.test(cookie);
    if (!hasCookie && (!isString(username, 1, 120) || !isString(password, 1, 256)))
      throw new Error('备份中的 TJUPT 账号无效。');
    if (passkey && !/^[a-f0-9]{32}$/i.test(passkey)) throw new Error('备份中的 TJUPT passkey 无效。');
    out.tjupt = {
      username: username || '',
      password: password || '',
      passkey: passkey || '',
      ...(hasCookie ? { cookie } : {}),
    };
  }
  if (raw.feeds !== undefined) {
    if (!Array.isArray(raw.feeds) || raw.feeds.length > 15) throw new Error('备份中的订阅数量无效。');
    out.feeds = raw.feeds.map((feed) => {
      if (
        !feed ||
        !isString(feed.id, 1, 40) ||
        !isString(feed.name, 1, 40) ||
        !isString(feed.url, 8, 4096) ||
        !httpsURL(feed.url)
      )
        throw new Error('备份中的订阅地址无效。');
      return { id: feed.id, name: feed.name, url: feed.url };
    });
  }
  if (raw.favorites !== undefined) {
    if (!Array.isArray(raw.favorites) || raw.favorites.length > 500) throw new Error('备份中的收藏数量无效。');
    out.favorites = raw.favorites.map((item) => {
      if (!item || !isString(item.id, 1, 200) || !isString(item.title, 1, 300))
        throw new Error('备份中的收藏条目无效。');
      return { ...item, id: item.id, title: item.title };
    });
  }
  if (raw.qb !== null && raw.qb !== undefined) {
    const { url, username, password } = raw.qb;
    if (
      !isString(url, 8, 2048) ||
      !/^https?:\/\//i.test(url) ||
      !isString(username, 1, 128) ||
      !isString(password, 0, 256)
    )
      throw new Error('备份中的下载器连接无效。');
    out.qb = { url, username, password };
  }
  return out;
}

async function deriveKey(password, salt) {
  if (!isString(password, 8, 256)) throw new Error('备份口令至少 8 个字符。');
  return scrypt(utf8(password), salt, { N: 16384, r: 8, p: 1, dkLen: 32 });
}

export async function exportBackup(config, password) {
  const plaintext = JSON.stringify(sanitizeConfig(config));
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = gcm(key, iv, utf8(`${BACKUP_FORMAT}:${BACKUP_VERSION}`));
  const data = cipher.encrypt(utf8(plaintext));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    salt: hex(salt),
    iv: hex(iv),
    data: b64encode(data),
    createdAt: new Date().toISOString(),
  };
}

export async function importBackup(payload, password) {
  if (!payload || payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION)
    throw new Error('这不是栖流 0.4 的备份文件。');
  if (payload.salt?.length !== 32 || payload.iv?.length !== 24 || !payload.data)
    throw new Error('备份文件缺少必要字段。');
  const key = await deriveKey(password, unhex(payload.salt));
  try {
    const cipher = gcm(key, unhex(payload.iv), utf8(`${BACKUP_FORMAT}:${BACKUP_VERSION}`));
    const plaintext = new TextDecoder().decode(cipher.decrypt(b64decode(payload.data)));
    return sanitizeConfig(JSON.parse(plaintext));
  } catch {
    throw new Error('备份口令不正确，或备份文件已损坏。');
  }
}
