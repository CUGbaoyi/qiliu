// 刷流候选排序：纯函数，Web/NAS 服务端与原生客户端共用。
// 只做“排序建议”，不自动加种、不修改任何分享率或做种限制。
export const GB = 1024 ** 3;
export const FARMING_MODES = ['upload', 'bonus'];
export const FARMING_MODE_LABELS = { upload: '上传量', bonus: '魔力值' };
export const FARMING_DEFAULT_PREFS = Object.freeze({ freeOnly: true, hours: 24, minLeechers: 0, maxSizeGB: 0 });

const WEIGHTS = {
  upload: { freshness: 0.3, supply: 0.3, free: 0.2, heat: 0.1, size: 0.1 },
  bonus: { freshness: 0.15, supply: 0.1, free: 0.2, heat: 0.05, size: 0.5 },
};
const LABELS = { freshness: '新鲜度', supply: '供需', free: '优惠', heat: '热度', size: '体积' };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export function ageHours(date, now = Date.now()) {
  const time = Date.parse(date);
  if (Number.isNaN(time)) return null;
  return Math.max(0, (now - time) / 3600000);
}

export function discountInfo(torrent) {
  const raw = String(torrent?.discount || '').toUpperCase();
  if (raw.includes('FREE'))
    return raw.includes('2X')
      ? { score: 100, label: '2X 免费', free: true, double: true }
      : { score: 100, label: '免费', free: true, double: false };
  if (raw.includes('2X')) return { score: 90, label: '2X 上传', free: false, double: true };
  if (raw.includes('50')) return { score: 55, label: '50% 下载', free: false, double: false };
  if (torrent?.free) return { score: 100, label: '免费', free: true, double: false };
  return { score: 0, label: '无优惠', free: false, double: false };
}

export function freshnessScore(hours) {
  if (hours === null) return 0;
  return Math.round(clamp(100 * Math.exp(-hours / 24), 0, 100));
}

export function supplyScore(seeders, leechers) {
  const s = Math.max(0, finite(seeders) ?? 0),
    l = Math.max(0, finite(leechers) ?? 0);
  const demand = clamp((Math.log10(1 + l) / 2) * 100, 0, 100);
  const ratio = l / (s + 1);
  const balance = (100 * ratio) / (ratio + 1.5);
  return Math.round(clamp(demand * 0.4 + balance * 0.6, 0, 100));
}

export function heatScore(completed) {
  const count = Math.max(0, finite(completed) ?? 0);
  return Math.round(clamp((Math.log10(1 + count) / 2) * 100, 0, 100));
}

export function sizeScore(size, mode = 'upload') {
  const bytes = finite(size);
  if (bytes === null || bytes <= 0) return 40;
  const gb = bytes / GB;
  if (mode === 'bonus') {
    if (gb <= 0.5) return 100;
    if (gb <= 2) return 95;
    if (gb <= 5) return 85;
    if (gb <= 10) return 70;
    if (gb <= 20) return 50;
    if (gb <= 50) return 30;
    return 15;
  }
  if (gb <= 1) return 40;
  if (gb <= 3) return 60;
  if (gb <= 8) return 80;
  if (gb <= 25) return 100;
  if (gb <= 60) return 80;
  if (gb <= 120) return 55;
  return 30;
}

function reasonFor(torrent, parts, mode) {
  const reasons = [];
  const discount = discountInfo(torrent);
  if (discount.free) reasons.push(discount.label);
  if (parts.freshness >= 70) reasons.push(`新种 ${ageHours(torrent.date)?.toFixed(0) ?? '?'} 小时内`);
  const ratio = (finite(torrent.leechers) ?? 0) / ((finite(torrent.seeders) ?? 0) + 1);
  if (ratio >= 1.5) reasons.push(`下载人数是做种的 ${ratio.toFixed(1)} 倍`);
  if (parts.heat >= 60) reasons.push(`已有 ${finite(torrent.completed) ?? 0} 次完成`);
  if (mode === 'upload' && parts.size >= 80 && !reasons.includes('体积适中')) reasons.push('体积适中，适合快速出种');
  if (mode === 'bonus' && parts.size >= 85) reasons.push('小体积，魔力效率高');
  return reasons.slice(0, 3).join(' · ') || '常规候选，可按需选择';
}

export function scoreCandidate(torrent, { mode = 'upload', now = Date.now() } = {}) {
  const activeMode = FARMING_MODES.includes(mode) ? mode : 'upload';
  const weights = WEIGHTS[activeMode];
  const hours = ageHours(torrent?.date, now);
  const parts = {
    freshness: freshnessScore(hours),
    supply: supplyScore(torrent?.seeders, torrent?.leechers),
    free: discountInfo(torrent).score,
    heat: heatScore(torrent?.completed),
    size: sizeScore(torrent?.size, activeMode),
  };
  const breakdown = Object.keys(weights).map((key) => ({
    key,
    label: LABELS[key],
    value: parts[key],
    weight: weights[key],
    points: Math.round(parts[key] * weights[key] * 10) / 10,
  }));
  const score = Math.round(breakdown.reduce((total, row) => total + row.points, 0));
  return {
    ...torrent,
    score,
    grade: score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D',
    reason: reasonFor(torrent, parts, activeMode),
    breakdown,
    mode: activeMode,
    ageHours: hours === null ? null : Math.round(hours * 10) / 10,
  };
}

export function matchesFilters(torrent, prefs = {}) {
  const { freeOnly = true, hours = 24, minLeechers = 0, maxSizeGB = 0, excludeCategories = [] } = prefs;
  if (excludeCategories.map(String).includes(String(torrent?.category))) return false;
  if (freeOnly && !discountInfo(torrent).free) return false;
  const age = ageHours(torrent?.date);
  if (age === null) return false;
  if (age > hours) return false;
  const leechers = finite(torrent?.leechers);
  if (leechers !== null && leechers < minLeechers) return false;
  if (minLeechers > 0 && leechers === null) return false;
  const size = finite(torrent?.size);
  if (maxSizeGB > 0 && size !== null && size > maxSizeGB * GB) return false;
  return true;
}

export function rankCandidates(items, { mode = 'upload', prefs = {}, now = Date.now() } = {}) {
  const merged = { ...FARMING_DEFAULT_PREFS, ...prefs };
  return (Array.isArray(items) ? items : [])
    .filter((item) => matchesFilters(item, merged))
    .map((item) => scoreCandidate(item, { mode, now }))
    .sort((a, b) => b.score - a.score || Date.parse(b.date) - Date.parse(a.date));
}
