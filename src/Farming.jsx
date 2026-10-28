import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  FireIcon,
  GaugeIcon,
  InfoIcon,
  ProhibitIcon,
  TrendUpIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { api, bytes, numeric, dateLabel, demoFarming, readPreference, savePreference } from './data';
import { rankCandidates } from '../server/farming.mjs';

const MODES = [
  { id: 'upload', label: '上传量', hint: '优先新种、免费、下载人数明显多于做种' },
  { id: 'bonus', label: '魔力值', hint: '优先小体积、免费，适合长期挂种累积魔力' },
];
const WINDOWS = [
  [6, '6 小时内'],
  [12, '12 小时内'],
  [24, '24 小时内'],
  [48, '48 小时内'],
  [72, '3 天内'],
];
const LEECHERS = [
  [0, '不限'],
  [3, '≥ 3'],
  [10, '≥ 10'],
  [30, '≥ 30'],
];
const SIZES = [
  [0, '不限'],
  [5, '≤ 5 GB'],
  [20, '≤ 20 GB'],
  [50, '≤ 50 GB'],
  [100, '≤ 100 GB'],
];
const IGNORED_KEY = 'qiliu-farming-ignored';

function readIgnored() {
  try {
    const parsed = JSON.parse(readPreference(IGNORED_KEY, '[]'));
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string').slice(0, 200) : [];
  } catch {
    return [];
  }
}

function Grade({ item }) {
  return (
    <span className={`farming-grade grade-${item.grade}`} title={`推荐分 ${item.score}/100`}>
      <strong>{item.score}</strong>
      <small>{item.grade}</small>
    </span>
  );
}

export function Farming({
  demo,
  site = 'mteam',
  configured,
  qbConfigured,
  onConnect,
  onQbConnect,
  onDownload,
  notify,
}) {
  const [mode, setMode] = useState('upload');
  const [hours, setHours] = useState(24);
  const [minLeechers, setMinLeechers] = useState(0);
  const [maxSizeGB, setMaxSizeGB] = useState(0);
  const [freeOnly, setFreeOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ignored, setIgnored] = useState(readIgnored);

  const prefs = useMemo(() => ({ freeOnly, hours, minLeechers, maxSizeGB }), [freeOnly, hours, minLeechers, maxSizeGB]);
  const active = MODES.find((item) => item.id === mode) || MODES[0];

  useEffect(() => {
    setError('');
    setData(null);
    if (demo || !configured) return;
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    const params = new URLSearchParams({
      mode,
      hours: String(hours),
      minLeechers: String(minLeechers),
      maxSizeGB: String(maxSizeGB),
      freeOnly: freeOnly ? '1' : '0',
      page: String(page),
      site,
    });
    api(`/farming/candidates?${params}`, { signal: controller.signal })
      .then((result) => {
        if (live) setData(result);
      })
      .catch((err) => {
        if (live && err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [demo, site, configured, mode, hours, minLeechers, maxSizeGB, freeOnly, page, revision]);

  const demoItems = useMemo(
    () => (demo || !configured ? rankCandidates(demoFarming(), { mode, prefs, now: Date.now() }) : []),
    [demo, configured, mode, prefs],
  );
  const source =
    demo || !configured
      ? { items: demoItems, page: 1, hasMore: false, total: demoItems.length }
      : data || { items: [], page, hasMore: false, total: 0 };
  const items = (source.items || []).filter((item) => !ignored.includes(item.id));
  const waiting = loading && !items.length;

  function ignore(item) {
    const next = [item.id, ...ignored.filter((id) => id !== item.id)].slice(0, 200);
    setIgnored(next);
    savePreference(IGNORED_KEY, JSON.stringify(next));
  }

  function send(item) {
    if (item.demo) return notify('演示候选不能发送到下载器');
    if (!qbConfigured) {
      notify('先连接 qBittorrent，再发送候选种子');
      onQbConnect();
      return;
    }
    onDownload(item);
  }

  if (!demo && !configured) {
    return (
      <section className="settings-panel empty-state farming-empty">
        <TrendUpIcon size={40} />
        <h3>先连接{site === 'tjupt' ? ' TJUPT' : ' M-Team'}，开始刷流</h3>
        <p>刷流助手会按新鲜度、供需和优惠排序最新种子，由你确认后发送到下载器。</p>
        <button className="primary-button" onClick={onConnect}>
          去连接站点
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="farming-panel" aria-label="刷流候选">
        <div className="farming-toolbar">
          <div className="farming-modes" role="tablist" aria-label="刷流模式">
            {MODES.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={mode === item.id}
                className={`farming-mode ${mode === item.id ? 'selected' : ''}`}
                onClick={() => {
                  setMode(item.id);
                  setPage(1);
                }}>
                <TrendUpIcon size={17} />
                {item.label}
              </button>
            ))}
          </div>
          <button className="text-button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            <ArrowsClockwiseIcon size={17} className={loading ? 'spin' : ''} />
            {loading ? '读取中' : '刷新候选'}
          </button>
        </div>
        <div className="farming-filters" aria-label="候选筛选">
          <label>
            发布
            <select
              value={hours}
              onChange={(event) => {
                setHours(Number(event.target.value));
                setPage(1);
              }}>
              {WINDOWS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            下载人数
            <select
              value={minLeechers}
              onChange={(event) => {
                setMinLeechers(Number(event.target.value));
                setPage(1);
              }}>
              {LEECHERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            体积
            <select
              value={maxSizeGB}
              onChange={(event) => {
                setMaxSizeGB(Number(event.target.value));
                setPage(1);
              }}>
              {SIZES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={freeOnly}
            className={`filter-button ${freeOnly ? 'selected' : ''}`}
            onClick={() => {
              setFreeOnly((value) => !value);
              setPage(1);
            }}>
            {freeOnly && <CheckIcon size={14} />}仅免费
          </button>
        </div>
        <p className="farming-hint">
          <InfoIcon size={15} />
          {active.hint}；排序读取 {site === 'tjupt' ? 'TJUPT' : 'M-Team'} 最新资源，每 60 秒最多刷新一次。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {waiting ? (
          <div className="farming-loading">
            <ArrowsClockwiseIcon size={26} className="spin" />
            <span>正在读取候选…</span>
          </div>
        ) : items.length ? (
          <div className="farming-list">
            {items.map((item) => (
              <article className="farming-card" key={item.id}>
                <Grade item={item} />
                <div className="farming-body">
                  <div className="farming-title">
                    <strong>{item.title}</strong>
                    <div className="farming-tags">
                      {item.discount && item.discount !== 'NORMAL' && (
                        <b className="farming-promo">{item.discount.includes('FREE') ? 'FREE' : item.discount}</b>
                      )}
                      {item.discount?.includes('2X') && <b className="farming-promo double">2X</b>}
                      <span className="farming-quality">{item.resolution}</span>
                    </div>
                  </div>
                  <p className="farming-meta">
                    <span>{bytes(item.size).join(' ')}</span>
                    <span>
                      {item.ageHours == null ? '时间未知' : `${item.ageHours < 1 ? '刚刚' : `${item.ageHours} 小时前`}`}
                    </span>
                    <span>
                      做种 <b>{numeric(item.seeders)}</b>
                    </span>
                    <span>
                      下载 <b>{numeric(item.leechers)}</b>
                    </span>
                    <span>
                      完成 <b>{numeric(item.completed)}</b>
                    </span>
                  </p>
                  <p className="farming-reason">{item.reason}</p>
                  <div className="farming-breakdown" aria-label="评分构成">
                    {item.breakdown.map((row) => (
                      <span
                        key={row.key}
                        title={`${row.label} ${row.value}/100，权重 ${Math.round(row.weight * 100)}%`}>
                        {row.label}
                        <b>{row.value}</b>
                      </span>
                    ))}
                  </div>
                  <div className="farming-actions">
                    <button className="primary-button" onClick={() => send(item)}>
                      <ArrowDownIcon size={17} />
                      发送到 qBittorrent
                    </button>
                    <button className="secondary-button" onClick={() => ignore(item)}>
                      <ProhibitIcon size={16} />
                      忽略
                    </button>
                    {item.url && (
                      <a className="text-button" href={item.url} target="_blank" rel="noopener noreferrer">
                        查看原帖
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state farming-empty">
            <GaugeIcon size={38} />
            <h3>当前条件下没有候选</h3>
            <p>放宽发布时间、下载人数或体积上限，或者关闭「仅免费」再试。</p>
            <button
              className="secondary-button"
              onClick={() => {
                setFreeOnly(false);
                setHours(72);
                setMinLeechers(0);
                setMaxSizeGB(0);
                setPage(1);
              }}>
              放宽筛选条件
            </button>
          </div>
        )}
        <div className="farming-foot">
          <span>
            {demo
              ? '演示候选 · 排序与真实接口一致'
              : `更新于 ${dateLabel(data?.syncedAt) || '—'} · 本页 ${items.length} 个候选`}
          </span>
          <div className="farming-pager">
            <button
              className="text-button"
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </button>
            <span>{page}</span>
            <button
              className="text-button"
              disabled={loading || (!demo && !source.hasMore)}
              onClick={() => setPage((value) => value + 1)}>
              下一页
            </button>
          </div>
        </div>
      </section>
      <p className="farming-note">
        <FireIcon size={15} />
        刷流助手只做候选排序：不会自动加种、不会跳过校验，也不会修改分享率或做种时长限制。发送前可在弹窗里改目录、分类或先暂停。
      </p>
      {demo && (
        <p className="farming-note muted">
          <WarningCircleIcon size={15} />
          演示模式使用示例候选；连接 M-Team 后按真实最新资源排序。
        </p>
      )}
    </>
  );
}
