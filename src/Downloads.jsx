import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BellIcon,
  CheckCircleIcon,
  DatabaseIcon,
} from '@phosphor-icons/react';
import { downloadCompleted } from '../server/downloads.mjs';
import { api, bytes, relativeLabel } from './data';

export function taskState(state) {
  return (
    {
      uploading: '正在做种',
      stalledUP: '做种中 · 等待连接',
      queuedUP: '做种排队',
      forcedUP: '强制做种',
      downloading: '正在下载',
      stalledDL: '等待下载连接',
      queuedDL: '下载排队',
      forcedDL: '强制下载',
      metaDL: '获取元数据',
      forcedMetaDL: '获取元数据',
      pausedDL: '已暂停下载',
      stoppedDL: '已停止下载',
      pausedUP: '已暂停做种',
      stoppedUP: '已停止做种',
      checkingDL: '正在校验',
      checkingUP: '正在校验',
      checkingResumeData: '检查恢复数据',
      moving: '正在移动文件',
      missingFiles: '文件缺失',
      error: '任务错误',
      allocating: '分配磁盘空间',
    }[state] ||
    state ||
    '状态待更新'
  );
}
export function DownloadForm({ item, onClose, onTasks }) {
  const [options, setOptions] = useState(null),
    [path, setPath] = useState(''),
    [category, setCategory] = useState(''),
    [paused, setPaused] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    api('/qb/options')
      .then((v) => {
        if (active) setOptions(v);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setOptions({});
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      setResult(
        await api('/qb/add', {
          method: 'POST',
          body: JSON.stringify({
            id: item.id,
            feedId: item.feedId,
            demo: !!item.demo,
            savePath: path,
            category,
            paused,
          }),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  if (result)
    return (
      <div className="download-result">
        <CheckCircleIcon size={40} />
        <h3>
          {result.status === 'existing'
            ? 'qBittorrent 中已有此任务'
            : result.status === 'added'
              ? '已添加到 qBittorrent'
              : '已提交，等待任务确认'}
        </h3>
        <p>{item.title}</p>
        <p className="muted">
          {result.task ? taskState(result.task.state) : '请到下载任务中刷新查看，暂未确认已开始下载。'}
          {result.status === 'existing' ? '，已保留原任务的目录和状态。' : ''}
        </p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button" onClick={onTasks}>
            查看下载任务
          </button>
        </div>
      </div>
    );
  return (
    <form className="connection-form" onSubmit={submit}>
      <div className="download-summary">
        <DatabaseIcon size={26} />
        <div>
          <strong>{item.title}</strong>
          <span>
            {item.source} · {bytes(item.size).join(' ')}
          </span>
        </div>
      </div>
      <label htmlFor="download-path">保存目录</label>
      <input
        id="download-path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={options?.savePath ? `默认：${options.savePath}` : '留空使用 qBittorrent 默认目录'}
        maxLength={1024}
        disabled={busy}
      />
      <p>填写 qBittorrent 容器内的路径，例如 /downloads；文件保存到 NAS，不占手机空间。留空沿用下载器的目录规则。</p>
      <label htmlFor="download-category">分类</label>
      <select id="download-category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
        <option value="">使用默认分类</option>
        {options?.categories?.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <label className="download-check">
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} disabled={busy} />
        先添加为暂停任务
      </label>
      <p>下载完成后按 qBittorrent 的做种规则继续运行。若目录已有文件，会先校验；不会跳过校验或修改分享率限制。</p>
      {options?.warning && <p className="muted">{options.warning}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy || !options}>
        <ArrowDownIcon size={18} />
        {busy ? '正在检查并发送…' : paused ? '添加到 qBittorrent' : '发送并开始下载'}
      </button>
    </form>
  );
}
export function Downloads({ configured, demo, onConnect, onNotify }) {
  const [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const previousTasks = useRef(new Map());
  const [notifyReady, setNotifyReady] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  useEffect(() => {
    setData(null);
    setError('');
    if (!configured || demo) return;
    let active = true,
      busy = false;
    async function refresh() {
      if (document.hidden || busy) return;
      busy = true;
      setLoading(true);
      try {
        const v = await api(`/qb/tasks?filter=${filter}&page=${page}`);
        if (active) {
          const finished = (v.items || []).filter((task) =>
            downloadCompleted(previousTasks.current.get(task.hash), task),
          );
          previousTasks.current = new Map((v.items || []).map((task) => [task.hash, task]));
          finished.slice(0, 1).forEach((task) => {
            onNotify?.(`「${task.name}」已下载完成，开始做种`);
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                new Notification('栖流 · 下载完成', { body: task.name });
              } catch {}
            }
          });
          setData(v);
          setError('');
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [configured, demo, filter, page, revision]);
  if (demo || !configured)
    return (
      <section className="settings-panel empty-state">
        <DatabaseIcon size={36} />
        <h3>{demo ? '演示模式不连接真实下载器' : '把下载交给 NAS'}</h3>
        <p>
          {demo
            ? '关闭演示模式后，可查看真实下载与做种任务。'
            : '连接 qBittorrent 后，可从资源详情发送种子并在这里查看进度。'}
        </p>
        {!demo && (
          <button className="primary-button" onClick={onConnect}>
            连接 qBittorrent
          </button>
        )}
      </section>
    );
  return (
    <section className="settings-panel downloads-panel">
      <div className="section-head">
        <div>
          <h2>下载与做种</h2>
          <p className="muted">
            NAS 持续运行；关闭客户端不影响下载。栖流只读展示任务，暂停、删除和限速请在 qBittorrent 中操作。
          </p>
        </div>
        <div className="downloads-head-actions">
          {typeof Notification !== 'undefined' && (
            <button
              className="text-button"
              aria-pressed={notifyReady}
              onClick={async () => {
                if (Notification.permission === 'granted') {
                  setNotifyReady(true);
                  onNotify?.('完成提醒已开启');
                  return;
                }
                const result = await Notification.requestPermission();
                setNotifyReady(result === 'granted');
                onNotify?.(result === 'granted' ? '完成提醒已开启' : '未获得通知权限');
              }}>
              <BellIcon size={17} />
              {notifyReady ? '提醒已开启' : '开启完成提醒'}
            </button>
          )}
          <button className="text-button" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
            <ArrowsClockwiseIcon size={18} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>
      <div className="download-filters" aria-label="任务筛选">
        {[
          ['all', '全部任务'],
          ['downloading', '下载中'],
          ['seeding', '做种中'],
        ].map(([id, label]) => (
          <button
            className={`filter-button ${filter === id ? 'selected' : ''}`}
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setPage(1);
            }}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error} {data ? '以下为上次数据。' : ''}
        </p>
      )}
      <div aria-busy={loading}>
        {!data && !error ? (
          <p className="settings-empty">正在读取任务…</p>
        ) : data?.items.length === 0 ? (
          <p className="settings-empty">没有匹配的任务。在资源详情点击「发送到 qBittorrent」即可添加。</p>
        ) : (
          data?.items.map((t) => (
            <article className="download-task" key={t.hash}>
              <div className="download-task-heading">
                <strong>{t.name}</strong>
                <span className="small-status">{taskState(t.state)}</span>
              </div>
              <progress
                value={Number.isFinite(t.progress) ? t.progress : 0}
                max="1"
                aria-label={`${t.name} 下载进度`}
              />
              <div className="download-task-meta">
                <span>
                  {Number.isFinite(t.progress) ? (t.progress * 100).toFixed(1) + '%' : '—'} · {bytes(t.size).join(' ')}
                </span>
                <span>
                  <ArrowDownIcon size={15} />
                  {error ? '—' : bytes(t.downSpeed).join(' ')}/s
                </span>
                <span>
                  <ArrowUpIcon size={15} />
                  {error ? '—' : bytes(t.upSpeed).join(' ')}/s
                </span>
              </div>
              <p className="download-path">
                {t.savePath || '目录待更新'}
                {t.category ? ` · ${t.category}` : ''}
              </p>
            </article>
          ))
        )}
      </div>
      <div className="table-footer">
        <span>{data ? `更新于 ${relativeLabel(data.syncedAt)}${error ? ' · 已过期' : ''}` : '每 5 秒刷新'}</span>
        <div className="pagination">
          <button disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>{page}</span>
          <button disabled={!data?.hasMore || loading} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
