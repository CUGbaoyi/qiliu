import { isNative, nativeAPI } from './native';
export const demoProfile = {
  username: 'DemoUser',
  role: '演示账号',
  uploaded: 12.8 * 1024 ** 4,
  downloaded: 2.4 * 1024 ** 4,
  ratio: 5.33,
  bonus: 128640,
  onlineSeeders: 128,
  onlineLeechers: 3,
  bonusPerHour: 52.341,
  bonusPerDay: 1256.184,
  seeding: 128,
  seedingSize: 3.2 * 1024 ** 4,
  assessment: null,
  lastSeen: new Date(Date.now() - 34 * 864e5).toISOString(),
  syncedAt: null,
  demo: true,
};
/** @type {Array<[string, string, string, string, string, number, number, boolean]>} */
const rows = [
  ['mountains', '山海之间', 'Shanhai.Zhijian.2026.2160p.WEB-DL.H265.DDP5.1.mkv', 'M-Team', '4K', 15.2, 342, false],
  ['ocean', '潮汐之间', 'Chaoxi.Zhijian.2025.1080p.BluRay.x264.DTS.mkv', 'RSS', '1080p', 8.36, 186, true],
  ['polar', '极地来信', 'Jidi.Laixin.2026.2160p.WEB-DL.H265.mkv', 'M-Team', '4K', 12.68, 278, false],
  ['city', '静谧城市', 'Jingmi.Chengshi.2025.1080p.WEB-DL.H264.AAC.mkv', 'RSS', '1080p', 4.21, 96, true],
  ['forest', '林间回声', 'Linjian.Huisheng.2026.2160p.BluRay.H265.TrueHD.mkv', 'M-Team', '4K', 20.11, 412, false],
];
export const demoItems = rows.map(([art, title, filename, source, resolution, gb, seeders, free], i) => ({
  id: `demo-${i}`,
  title,
  filename,
  source,
  resolution,
  size: gb * 1024 ** 3,
  seeders,
  free,
  description: '循着自然与人文的脉络，发现值得收藏的故事。',
  image: `/art/${art}.webp`,
  category: '404',
  date: '2026-10-28',
  demo: true,
  url: null,
}));
export function demoFarming() {
  const now = Date.now();
  /** @type {Array<[string, string, string, string, number, number, number, string, number, number]>} */
  const rows = [
    [
      'mountains',
      '山海之间',
      'Shanhai.Zhijian.2026.2160p.WEB-DL.H265.DDP5.1.mkv',
      '4K',
      15.2,
      86,
      9,
      '2X_FREE',
      14,
      1.5,
    ],
    ['ocean', '潮汐之间', 'Chaoxi.Zhijian.2025.1080p.BluRay.x264.DTS.mkv', '1080p', 8.36, 54, 21, 'FREE', 32, 4],
    ['polar', '极地来信', 'Jidi.Laixin.2026.2160p.WEB-DL.H265.mkv', '4K', 2.4, 120, 6, '2X_FREE', 8, 7],
    ['city', '静谧城市', 'Jingmi.Chengshi.2025.1080p.WEB-DL.H264.AAC.mkv', '1080p', 1.1, 66, 18, 'FREE', 51, 11],
    ['forest', '林间回声', 'Linjian.Huisheng.2026.2160p.BluRay.H265.TrueHD.mkv', '4K', 42.8, 310, 12, '2X', 74, 19],
    ['desert', '沙海孤行', 'Shahai.Guxing.2026.2160p.WEB-DL.H265.mkv', '4K', 6.8, 38, 27, 'FREE', 12, 27],
    ['river', '河流入海', 'Heliu.Ruhai.2025.1080p.WEB-DL.H264.mkv', '1080p', 0.62, 44, 5, 'FREE', 9, 3],
    ['aurora', '极光之下', 'Jiguang.Zhixia.2026.2160p.BluRay.H265.mkv', '4K', 28.4, 205, 16, '2X_FREE', 61, 40],
  ];
  return rows.map(([art, title, filename, resolution, gb, seeders, leechers, discount, completed, hours], i) => ({
    id: `demo-farm-${i}`,
    title,
    filename,
    source: 'M-Team',
    category: '419',
    resolution,
    size: gb * 1024 ** 3,
    seeders,
    leechers,
    free: discount.includes('FREE'),
    discount,
    completed,
    image: `/art/${art}.webp`,
    date: new Date(now - hours * 3600e3).toISOString(),
    demo: true,
    url: null,
  }));
}
export function bytes(v) {
  if (v == null || !Number.isFinite(Number(v))) return ['—', ''];
  const n = Number(v),
    i = n > 0 ? Math.min(4, Math.floor(Math.log(n) / Math.log(1024))) : 0;
  return [(n / 1024 ** i).toFixed(i ? 2 : 0), ['B', 'KB', 'MB', 'GB', 'TB'][i]];
}
export const numeric = (v) => (v == null ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
export const ratio = (v) => (v == null ? '—' : v === '∞' ? '∞' : Number(v).toFixed(2));
export function relativeLabel(v) {
  if (!v) return '—';
  const t = Date.parse(v);
  if (Number.isNaN(t)) return String(v);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return dateLabel(v);
}
export const dateLabel = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
};
export function categoryName(v) {
  if (['401', '419', '420', '421', '439'].includes(v)) return '电影';
  if (['403', '402', '438', '435'].includes(v)) return '剧集';
  if (v === '404') return '纪录片';
  if (v === '405') return '动漫';
  if (['434', '406', '442'].includes(v)) return '音乐';
  return v === 'rss' ? 'RSS' : '其他';
}
export async function api(path, options = {}) {
  if (isNative()) return nativeAPI(path, options);
  const r = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Qiliu': '1', ...options.headers },
  });
  let result;
  try {
    result = await r.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('连接服务未运行，请重新启动栖流。');
  }
  if (!r.ok) throw Object.assign(new Error(result.error || '操作失败，请重试。'), { status: r.status });
  return result;
}
export function readPreference(k, f) {
  try {
    return localStorage.getItem(k) || f;
  } catch {
    return f;
  }
}
export function savePreference(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}
