import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export const number = (value) =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function shareRatio(uploaded, downloaded, supplied) {
  if (number(supplied) !== null && number(supplied) >= 0) return number(supplied);
  if (uploaded === null || downloaded === null) return null;
  if (downloaded === 0) return uploaded > 0 ? '∞' : null;
  return uploaded / downloaded;
}
export function normalizeProfile(data, peers = null) {
  if (!data || !data.username || !data.memberCount) throw new Error('账号接口格式不兼容，未保存此连接。');
  const count = data.memberCount;
  const uploaded = number(count.uploaded),
    downloaded = number(count.downloaded);
  const roles = {
    1: 'User',
    2: 'Power User',
    3: 'Elite User',
    4: 'Crazy User',
    5: 'Insane User',
    6: 'Veteran User',
    7: 'Extreme User',
    8: 'Ultimate User',
    9: 'mTorrent Master',
    10: 'VIP',
  };
  return {
    username: String(data.username),
    role: String(data.roleName || roles[data.role] || (data.role ? `等级 ${data.role}` : '等级暂不可用')),
    uploaded,
    downloaded,
    ratio: shareRatio(uploaded, downloaded, count.shareRate),
    bonus: number(count.bonus),
    seeding: number(peers?.seederCount),
    seedingSize: number(peers?.seederSize),
    assessment: null,
    leeching: number(peers?.leecherCount),
    uploads: number(peers?.uploadCount),
    invites: number(data.invites),
    warned: typeof data.memberStatus?.warned === 'boolean' ? data.memberStatus.warned : null,
    vipUntil: data.memberStatus?.vip ? data.memberStatus.vipUntil : null,
    joined: data.createdDate || null,
    lastSeen: data.memberStatus?.lastBrowse || data.memberStatus?.lastLogin || null,
    syncedAt: new Date().toISOString(),
    demo: false,
  };
}
export function safeLink(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export const plain = (value) =>
  String(typeof value === 'object' ? (value?.['#text'] ?? '') : (value ?? ''))
    .replace(/<br\s*\/?\s*>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .slice(0, 3000);
export function normalizeTorrent(row) {
  const title = plain(row.smallDescr || row.name);
  const discount = row.status?.promotionRule?.discount ?? row.status?.discount ?? '';
  const standards = { 1: '1080p', 2: '1080i', 3: '720p', 5: 'SD', 6: '4K', 7: '8K' };
  return {
    id: `mt-${row.id}`,
    title,
    filename: plain(row.name),
    source: 'M-Team',
    category: String(row.category || ''),
    resolution: standards[row.standard] || (/2160|4k/i.test(row.name) ? '4K' : /1080p/i.test(row.name) ? '1080p' : '—'),
    size: number(row.size),
    seeders: number(row.status?.seeders),
    leechers: number(row.status?.leechers),
    free: /(?:^|_)FREE$/.test(discount) || !!row.status?.mallSingleFree,
    discount: String(discount || '')
      .toUpperCase()
      .replace(/^_+/, ''),
    completed: number(row.status?.timesCompleted) ?? number(row.status?.completed) ?? number(row.status?.downloadCount),
    image: safeLink(row.imageList?.[0]),
    description: plain(row.smallDescr),
    date: row.createdDate || null,
    url: /^\d+$/.test(String(row.id)) ? `https://kp.m-team.cc/detail/${row.id}` : null,
    demo: false,
  };
}
export function parseFeed(xml, feed) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('订阅内容不是有效的安全 XML。');
  // DTD/custom entities are rejected above; decode standard XML entities in RSS HTML descriptions.
  const doc = new XMLParser({ ignoreAttributes: false, processEntities: true, parseTagValue: false }).parse(xml);
  const channel = doc.rss?.channel || doc.feed;
  if (!channel) throw new Error('仅支持 RSS 2.0 或 Atom 订阅。');
  const rows = channel.item || channel.entry || [];
  return (Array.isArray(rows) ? rows : [rows]).slice(0, 200).map((row, i) => {
    const links = Array.isArray(row.link) ? row.link : [row.link];
    const link = links.find((x) => typeof x === 'string' || !x?.['@_rel'] || x?.['@_rel'] === 'alternate');
    const url = safeLink(typeof link === 'string' ? link : link?.['@_href']);
    const identity = plain(row.guid || row.id) || url || `${plain(row.title)}-${i}`;
    const html = String(row.description || row.summary || '');
    const imageMatch = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    const categories = plain(Array.isArray(row.category) ? row.category[0] : row.category);
    const category = /紀錄|纪录|documentary/i.test(categories)
      ? '404'
      : /影劇|剧|綜藝|TV/i.test(categories)
        ? '402'
        : /電影|电影|movie/i.test(categories)
          ? '419'
          : /動畫|动漫|anime/i.test(categories)
            ? '405'
            : /Music|音|演唱/i.test(categories)
              ? '434'
              : 'rss';
    const enclosure = (Array.isArray(row.enclosure) ? row.enclosure : [row.enclosure]).find((x) => x?.['@_url']);
    const downloadUrl =
      safeLink(enclosure?.['@_url']) ||
      (url && /(?:\.torrent(?:\?|$)|\/api\/rss\/dl|download\.php)/i.test(url) ? url : null);
    const mtId = url && /^https:\/\/[^/]+\.m-team\.(?:cc|io)\/detail\/(\d+)$/.exec(url)?.[1];
    return {
      id: mtId ? `mt-${mtId}` : `rss-${feed.id}-${bytesToHex(sha256(identity)).slice(0, 20)}`,
      title: plain(row.title) || '未命名资源',
      filename: plain(row.title),
      source: feed.name,
      feedId: feed.id,
      category,
      resolution: /2160|4k/i.test(plain(row.title)) ? '4K' : /1080p/i.test(plain(row.title)) ? '1080p' : '—',
      size: number(row.enclosure?.['@_length']),
      seeders: null,
      leechers: null,
      free: false,
      image: safeLink(imageMatch?.[1]?.replace(/&amp;/g, '&')),
      description: plain(row.description || row.summary || row.content),
      date: plain(row.pubDate || row.updated || row.published) || null,
      url,
      downloadUrl,
      downloadable: !!downloadUrl,
      demo: false,
    };
  });
}

export function mergeResources(items) {
  const map = new Map();
  for (const item of items) {
    const old = map.get(item.id);
    if (!old) map.set(item.id, item);
    else
      map.set(item.id, {
        ...old,
        image: old.image || item.image,
        description: item.description?.length > (old.description?.length || 0) ? item.description : old.description,
        feedId: old.feedId || item.feedId,
        downloadUrl: old.downloadUrl || item.downloadUrl,
        downloadable: old.downloadable || item.downloadable,
      });
  }
  return [...map.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export function publicResource(item) {
  const { downloadUrl, ...safe } = item;
  void downloadUrl;
  return safe;
}
