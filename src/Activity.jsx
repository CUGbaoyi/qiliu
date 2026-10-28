import { useEffect, useState } from 'react';
import { api, bytes, numeric, relativeLabel } from './data';
export function Activity({ profile, demo, qbConfigured, onConnect }) {
  const [live, setLive] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    setLive(null);
    setError('');
    if (demo || !qbConfigured) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const v = await api('/qb/status');
        if (active) {
          setLive(v);
          setError('');
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        busy = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [demo, qbConfigured]);
  const v = profile || {},
    speed = error ? null : live?.uploadSpeed;
  return (
    <section className="activity-panel" aria-label="上传与魔力收益">
      <div className="activity-head">
        <h2>上传与魔力收益</h2>
        <span>{demo ? '演示数据' : qbConfigured ? '下载器每 5 秒更新' : '站点每 60 秒更新'}</span>
      </div>
      <div className="activity-grid">
        <div>
          <label>实时上传速度</label>
          <strong>
            {speed == null ? '—' : bytes(speed).join(' ')}
            {speed != null && <small>/s</small>}
          </strong>
          <p>{demo ? '连接下载器后显示' : qbConfigured ? '来自 qBittorrent' : '连接 qBittorrent 后可用'}</p>
        </div>
        <div>
          <label>在线做种 / 下载</label>
          <strong>
            {numeric(v.onlineSeeders)}
            <small>/ {numeric(v.onlineLeechers)}</small>
          </strong>
          <p>Tracker 最近上报状态</p>
        </div>
        <div>
          <label>每小时魔力</label>
          <strong>
            {numeric(v.bonusPerHour)}
            <small>点 / 时</small>
          </strong>
          <p>站点当前收益速率</p>
        </div>
        <div>
          <label>预计每日魔力</label>
          <strong>
            {numeric(v.bonusPerDay)}
            <small>点</small>
          </strong>
          <p>按当前速率 × 24，非保证收益</p>
        </div>
      </div>
      {error && (
        <div className="inline-warning" role="alert">
          {error} 上次数据不代表当前速度。
        </div>
      )}
      {live && (
        <p className="activity-note">
          下载 {bytes(live.downloadSpeed).join(' ')} /s · 本次运行上传 {bytes(live.sessionUpload).join(' ')} · 更新于{' '}
          {relativeLabel(live.syncedAt)}
          {error ? ' · 已过期' : ''}
        </p>
      )}
      {!demo && live?.torrents?.length > 0 && (
        <div className="upload-list">
          {live.torrents.slice(0, 5).map((t, i) => (
            <div className="upload-item" key={i}>
              <span title={t.name}>{t.name}</span>
              <strong>{bytes(t.upSpeed).join(' ')} /s</strong>
            </div>
          ))}
        </div>
      )}
      <div className="activity-actions">
        <button className="text-button" onClick={onConnect}>
          {qbConfigured ? '管理下载器连接' : '连接 qBittorrent'}
        </button>
        {v.accountUploadDelta != null && (
          <span className="activity-note">
            最近 {Math.round(v.sampleSeconds / 60)} 分钟站点记账 +{bytes(v.accountUploadDelta).join(' ')}
          </span>
        )}
      </div>
      <p className="activity-note">
        上传速度来自下载器；站点累计流量受 Tracker 上报和优惠倍率影响。退出应用或切到后台后暂停刷新。
      </p>
    </section>
  );
}
