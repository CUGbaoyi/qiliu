import { DownloadForm, Downloads } from './Downloads';
import { Activity } from './Activity';
import { Farming } from './Farming';
import { useEffect, useState } from 'react';
import {
  HouseIcon,
  MagnifyingGlassIcon,
  RssIcon,
  BookmarkSimpleIcon,
  StackIcon,
  GearSixIcon,
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  ArrowUpRightIcon,
  XIcon,
  PlusIcon,
  CheckIcon,
  InfoIcon,
  ShieldCheckIcon,
  UsersIcon,
  WarningCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  LockKeyIcon,
  CheckCircleIcon,
  TrendUpIcon,
} from '@phosphor-icons/react';
import {
  api,
  bytes,
  numeric,
  categoryName,
  demoProfile,
  demoItems,
  readPreference,
  savePreference,
  dateLabel,
} from './data';
import { Icon, Modal, Art } from './ui';
import { Account } from './Account';
import { SitesPage } from './SitesPage';
import { SettingsPage } from './SettingsPage';
const nav = [
  ['overview', '总览', HouseIcon],
  ['farming', '刷流', TrendUpIcon],
  ['discover', '发现', MagnifyingGlassIcon],
  ['subscriptions', '订阅', RssIcon],
  ['downloads', '下载', ArrowDownIcon],
  ['favorites', '收藏', BookmarkSimpleIcon],
  ['sites', '站点', StackIcon],
];
const titles = {
  downloads: ['下载与做种', '发送到 NAS，随时查看进度与上传状态'],
  farming: ['刷流助手', '按上传潜力筛选新种，人工确认后发送'],
  overview: ['栖流 · 聚合工作台', '账号、做种与魔力收益一览'],
  discover: ['发现资源', '跨越站点，找到值得收藏的内容'],
  subscriptions: ['订阅更新', '来自你的 RSS，所有更新在这里相遇'],
  favorites: ['我的收藏', '留住每一次发现，随时回来继续探索'],
  sites: ['站点与连接', '一次连接，在你的设备上轻松访问'],
  settings: ['偏好设置', '让栖流更适合你的日常'],
};
export function App() {
  const [downloadItem, setDownloadItem] = useState(null);
  const [qbURL, setQbURL] = useState(''),
    [qbUser, setQbUser] = useState(''),
    [qbPass, setQbPass] = useState('');
  const [auth, setAuth] = useState(null),
    [state, setState] = useState({ configured: false, feeds: [], favorites: [], local: true });
  const [view, setView] = useState(() => {
      const q = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('view');
      return [
        'overview',
        'discover',
        'subscriptions',
        'downloads',
        'farming',
        'favorites',
        'sites',
        'settings',
      ].includes(q || '')
        ? q
        : 'overview';
    }),
    [mode, setMode] = useState('live'),
    [profile, setProfile] = useState(null),
    [items, setItems] = useState([]),
    [loading, setLoading] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState(''),
    [search, setSearch] = useState(''),
    [source, setSource] = useState('all'),
    [category, setCategory] = useState('all'),
    [free, setFree] = useState(false),
    [quality, setQuality] = useState('all'),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [revision, setRevision] = useState(0),
    [sort, setSort] = useState('newest'),
    [resourceWarning, setResourceWarning] = useState(''),
    [resourceStale, setResourceStale] = useState(false),
    [profileError, setProfileError] = useState(''),
    [connectionError, setConnectionError] = useState('');
  const [selected, setSelected] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(''),
    [saving, setSaving] = useState(false),
    [pairCode, setPairCode] = useState(''),
    [pairInfo, setPairInfo] = useState(null),
    [formError, setFormError] = useState('');
  const [site, setSite] = useState(() => (readPreference('qiliu-site', 'mteam') === 'tjupt' ? 'tjupt' : 'mteam')),
    [backupPass, setBackupPass] = useState(''),
    [backupOut, setBackupOut] = useState(''),
    [backupIn, setBackupIn] = useState(''),
    [backupError, setBackupError] = useState(''),
    [backupBusy, setBackupBusy] = useState(false),
    [tjuptUser, setTjuptUser] = useState(''),
    [tjuptPass, setTjuptPass] = useState(''),
    [tjuptPasskey, setTjuptPasskey] = useState(''),
    [tjuptCookie, setTjuptCookie] = useState(''),
    [key, setKey] = useState(''),
    [base, setBase] = useState('https://api.m-team.cc/api'),
    [showKey, setShowKey] = useState(false),
    [feedName, setFeedName] = useState(''),
    [feedURL, setFeedURL] = useState(''),
    [compact, setCompact] = useState(readPreference('qiliu-compact', 'false') === 'true');
  const demo = mode === 'demo',
    notify = (message) => setToast(message),
    openModal = (name) => {
      setFormError('');
      setModal(name);
    };
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3800);
    return () => clearTimeout(id);
  }, [toast]);
  async function initialize() {
    try {
      const access = await api('/auth');
      setAuth(access);
      if (!access.authorized) return;
      const result = await api('/state');
      setState(result);
      setBase(result.base);
      setQbURL(result.qb?.url || '');
      setQbUser(result.qb?.username || '');
      setMode(
        result.configured || result.tjuptConfigured || result.feeds.length
          ? 'live'
          : readPreference('qiliu-mode', 'demo'),
      );
      if (readPreference('qiliu-site', 'mteam') === 'tjupt' && !result.tjuptConfigured && result.configured)
        setSite('mteam');
      setConnectionError('');
    } catch (e) {
      setConnectionError(e.message);
      setAuth({ authorized: true, local: true });
      setMode('demo');
    }
  }
  useEffect(() => {
    initialize();
  }, []);
  async function syncProfile() {
    if (demo) {
      notify('演示模式使用示例数据；连接站点后可同步真实账号。');
      return;
    }
    if (site === 'tjupt' ? !state.tjuptConfigured : !state.configured) {
      setView('sites');
      return;
    }
    setSyncing(true);
    try {
      setProfile(await api('/profile?site=' + site));
      setProfileError('');
    } catch (e) {
      setProfileError(e.message);
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    if (!auth?.authorized || demo || (site === 'tjupt' ? !state.tjuptConfigured : !state.configured)) {
      setProfile(null);
      setSyncing(false);
      return;
    }
    const c = new AbortController();
    setSyncing(true);
    api('/profile?site=' + site, { signal: c.signal })
      .then((p) => {
        setProfile(p);
        setProfileError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setProfileError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setSyncing(false);
      });
    return () => c.abort();
  }, [auth?.authorized, state.configured, state.tjuptConfigured, mode, site]);
  useEffect(() => {
    const siteReady = view === 'discover' ? (site === 'tjupt' ? state.tjuptConfigured : state.configured) : true;
    if (!auth?.authorized || demo || !['discover', 'subscriptions'].includes(view) || !siteReady) {
      setLoading(false);
      return;
    }
    const c = new AbortController();
    setLoading(true);
    setResourceWarning('');
    const actualSource = view === 'subscriptions' && source === 'all' ? 'rss' : source;
    api(
      `/resources?q=${encodeURIComponent(search)}&source=${encodeURIComponent(actualSource)}&page=${page}&site=${view === 'discover' ? site : 'mteam'}`,
      { signal: c.signal },
    )
      .then((r) => {
        setItems(r.items);
        setHasMore(r.hasMore);
        setResourceWarning(r.warnings.join(' '));
        setResourceStale(false);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setResourceWarning(e.message);
          setResourceStale(true);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [auth?.authorized, demo, search, source, page, revision, view, site, state.configured, state.tjuptConfigured]);
  useEffect(() => {
    if (!auth?.authorized || demo || (site === 'tjupt' ? !state.tjuptConfigured : !state.configured)) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const p = await api('/profile?site=' + site);
        if (active) {
          setProfile(p);
          setProfileError('');
        }
      } catch (e) {
        if (active) setProfileError(e.message);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [auth?.authorized, demo, state.configured, state.tjuptConfigured, site]);
  const navigate = (next) => {
    window.scrollTo({ top: 0 });
    setView(next);
    setPage(1);
    setSource('all');
    setCategory('all');
    setQuality('all');
    setFree(false);
    setQ('');
    setSearch('');
    setResourceWarning('');
    setResourceStale(false);
    setProfileError('');
    setSort('newest');
  };
  function changeMode(next) {
    setLoading(false);
    setSyncing(false);
    setMode(next);
    savePreference('qiliu-mode', next);
    setItems([]);
    if (next !== mode) setProfile(null);
    setQ('');
    setSearch('');
    setPage(1);
    setResourceWarning('');
    setProfileError('');
    setSort('newest');
  }
  async function favorite(item) {
    if (saving) return;
    setSaving(true);
    const saved = state.favorites.some((f) => f.id === item.id);
    try {
      const r = await api('/favorites', { method: 'PUT', body: JSON.stringify({ item, saved: !saved }) });
      setState((old) => ({ ...old, favorites: r.favorites }));
      notify(saved ? '已取消收藏' : '已收藏到当前设备');
    } catch (e) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function connect(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api('/connect', { method: 'POST', body: JSON.stringify({ key, base }) });
      setKey('');
      setShowKey(false);
      setModal(null);
      await initialize();
      changeMode('live');
      setSite('mteam');
      savePreference('qiliu-site', 'mteam');
      setProfile(await api('/profile?site=mteam'));
      setRevision((x) => x + 1);
      notify('M-Team 已连接，正在同步真实数据');
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function addFeed(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api('/feeds', { method: 'POST', body: JSON.stringify({ name: feedName, url: feedURL }) });
      setFeedURL('');
      setFeedName('');
      setModal(null);
      setState(await api('/state'));
      changeMode('live');
      setRevision((x) => x + 1);
      notify('订阅已添加，已读取最新内容');
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function disconnect() {
    setSaving(true);
    try {
      await api('/connect', { method: 'DELETE' });
      setState(await api('/state'));
      setProfile(null);
      setItems([]);
      setRevision((x) => x + 1);
      setModal(null);
      notify('已移除 M-Team 连接');
    } catch (e) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function switchSite(next) {
    if (next === site) return;
    setSite(next);
    savePreference('qiliu-site', next);
    setProfile(null);
    setItems([]);
    setPage(1);
    setRevision((v) => v + 1);
    const ready = next === 'tjupt' ? state.tjuptConfigured : state.configured;
    if (!ready) {
      notify(next === 'tjupt' ? '先连接 TJUPT，再查看站点数据' : '先连接 M-Team，再查看站点数据');
      navigate('sites');
    }
  }
  async function connectTjupt(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        username: tjuptUser.trim(),
        password: tjuptPass,
        passkey: tjuptPasskey.trim(),
        cookie: tjuptCookie.trim(),
      };
      if (!payload.cookie && state.tjuptConfigured && !payload.password && payload.username === state.tjupt?.username)
        payload.keepPassword = true;
      const result = await api('/sites/tjupt/connect', { method: 'POST', body: JSON.stringify(payload) });
      setTjuptPass('');
      setTjuptCookie('');
      setModal(null);
      setState(await api('/state'));
      setSite('tjupt');
      savePreference('qiliu-site', 'tjupt');
      setMode('live');
      savePreference('qiliu-mode', 'live');
      setRevision((v) => v + 1);
      notify('TJUPT 已连接' + (result.hasPasskey ? '' : '，未设置 passkey，暂不能下载种子'));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }
  async function disconnectTjupt() {
    setSaving(true);
    try {
      await api('/sites/tjupt/connect', { method: 'DELETE' });
      setState(await api('/state'));
      setProfile(null);
      setItems([]);
      if (site === 'tjupt') {
        setSite('mteam');
        savePreference('qiliu-site', 'mteam');
      }
      setModal(null);
      notify('已断开 TJUPT');
    } catch (e) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function createBackup() {
    setBackupBusy(true);
    setBackupError('');
    try {
      const r = await api('/backup/export', { method: 'POST', body: JSON.stringify({ password: backupPass }) });
      setBackupOut(JSON.stringify(r.backup, null, 2));
      notify('备份已生成');
    } catch (e) {
      setBackupError(e.message);
    } finally {
      setBackupBusy(false);
    }
  }
  async function applyBackup() {
    setBackupBusy(true);
    setBackupError('');
    try {
      const parsed = JSON.parse(backupIn);
      const r = await api('/backup/import', {
        method: 'POST',
        body: JSON.stringify({ password: backupPass, backup: parsed }),
      });
      setBackupIn('');
      setBackupOut('');
      setProfile(null);
      setItems([]);
      await initialize();
      notify('配置已导入' + (r.tjuptConfigured ? ' · TJUPT 已恢复' : r.configured ? ' · M-Team 已恢复' : ''));
    } catch (e) {
      setBackupError(e.message || '备份内容格式无效。');
    } finally {
      setBackupBusy(false);
    }
  }
  async function copyBackupText() {
    try {
      await navigator.clipboard.writeText(backupOut);
      notify('备份已复制到剪贴板');
    } catch {
      notify('复制失败，请手动选择文本框内容');
    }
  }
  async function removeFeed(feed) {
    try {
      await api(`/feeds/${feed.id}`, { method: 'DELETE' });
      setState(await api('/state'));
      setRevision((x) => x + 1);
      setModal(null);
      notify('已移除订阅');
    } catch (e) {
      notify(e.message);
    }
  }
  const list = (view === 'favorites' ? state.favorites.filter((i) => !!i.demo === demo) : demo ? demoItems : items)
    .filter((i) => {
      const keyword = demo || view === 'favorites' ? q : '';
      return (
        `${i.title} ${i.filename}`.toLowerCase().includes(keyword.toLowerCase()) &&
        (!free || i.free) &&
        (quality === 'all' || quality === i.resolution) &&
        (category === 'all' || categoryName(i.category) === category) &&
        (site === 'tjupt' ||
          source === 'all' ||
          (source === 'mteam'
            ? i.source === 'M-Team'
            : source === 'rss'
              ? !!i.feedId || i.source === 'RSS'
              : i.feedId === source)) &&
        (view !== 'subscriptions' || i.feedId || i.source === 'RSS')
      );
    })
    .sort((a, b) =>
      sort === 'size'
        ? (b.size || 0) - (a.size || 0)
        : sort === 'seeders'
          ? (b.seeders || 0) - (a.seeders || 0)
          : sort === 'oldest'
            ? (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)
            : (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0),
    );
  if (!auth)
    return (
      <div className="launch">
        <img src="/icon.png" alt="" />
        <h1>栖流</h1>
        <span>正在连接你的工作台…</span>
      </div>
    );
  if (!auth.authorized && auth.deployment === 'nas')
    return (
      <main className="pair-screen">
        <img src="/icon.png" alt="栖流" />
        <h1>你的 NAS，独立运行。</h1>
        <p>登录栖流，查看账号、订阅和实时上传。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setFormError('');
            try {
              await api('/login', { method: 'POST', body: JSON.stringify({ password: pairCode }) });
              setPairCode('');
              await initialize();
            } catch (err) {
              setFormError(err.message);
            } finally {
              setSaving(false);
            }
          }}>
          <label htmlFor="nas-password">管理密码</label>
          <input
            id="nas-password"
            type="password"
            autoComplete="current-password"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value)}
            required
          />
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
          <button className="primary-button" disabled={saving}>
            {saving ? '登录中…' : '登录栖流'}
          </button>
        </form>
        <span className="muted">密码由部署时的 Docker secret 设置</span>
      </main>
    );
  if (!auth.authorized)
    return (
      <main className="pair-screen">
        <img src="/icon.png" alt="栖流" />
        <h1>把你的站点，带到手机上。</h1>
        <p>在 Mac 的「站点与连接」中生成配对码，然后在这里输入。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setFormError('');
            try {
              await api('/pair', { method: 'POST', body: JSON.stringify({ code: pairCode }) });
              await initialize();
            } catch (err) {
              setFormError(err.message);
            } finally {
              setSaving(false);
            }
          }}>
          <label htmlFor="pair-code">6 位配对码</label>
          <input
            id="pair-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value)}
            required
            placeholder="000000"
          />
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
          <button className="primary-button" disabled={saving}>
            {saving ? '正在连接…' : '连接我的栖流'}
            <Icon as={ArrowRightIcon} size={18} />
          </button>
        </form>
        <span className="muted">仅在你信任的局域网中配对 · 有效期 24 小时</span>
      </main>
    );
  return (
    <div className={`app-shell ${compact ? 'compact' : ''}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('overview')} aria-label="栖流首页">
          <strong>栖流</strong>
          <span>Q I L I U</span>
        </button>
        <nav aria-label="主导航">
          {nav.map(([id, text, C]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
              aria-current={view === id ? 'page' : undefined}>
              <Icon as={C} size={25} />
              <span>{text}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <Icon as={ShieldCheckIcon} size={17} />
            <span>你的站点 · 你的空间</span>
          </div>
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
            <Icon as={GearSixIcon} size={25} />
            <span>设置</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="page-header">
          <div>
            <h1>
              <span className="desktop-title">{titles[view][0]}</span>
              <span className="mobile-title">{view === 'overview' ? '栖流' : titles[view][0]}</span>
            </h1>
            <p>{titles[view][1]}</p>
          </div>
          <div className="header-tools">
            {demo && view === 'overview' && (
              <button className="text-button exit-demo" onClick={() => changeMode('live')}>
                返回真实数据
              </button>
            )}
            <span className="today">
              {new Date().toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                weekday: 'short',
              })}
            </span>
            <label className="site-switch">
              <Icon as={StackIcon} size={16} />
              <select aria-label="切换站点" value={site} onChange={(e) => switchSite(e.target.value)}>
                <option value="mteam">M-Team</option>
                <option value="tjupt">TJUPT</option>
              </select>
            </label>
          </div>
        </header>
        {connectionError && (
          <div className="notice" role="alert">
            <Icon as={WarningCircleIcon} />
            {connectionError}
            <button onClick={initialize}>重新连接</button>
          </div>
        )}
        {demo && view !== 'overview' && (
          <div className="demo-notice">
            <Icon as={InfoIcon} size={16} />
            <span>当前为演示模式，数据仅用于体验界面。</span>
            <button onClick={() => (state.configured || state.feeds.length ? changeMode('live') : navigate('sites'))}>
              {state.configured || state.feeds.length ? '返回真实数据' : '连接我的站点'}
              <Icon as={ArrowRightIcon} size={15} />
            </button>
          </div>
        )}
        {view === 'overview' && (
          <Account
            data={demo ? demoProfile : profile}
            demo={demo}
            siteName={site === 'tjupt' ? 'TJUPT' : 'M-Team'}
            configured={site === 'tjupt' ? state.tjuptConfigured : state.configured}
            refreshing={syncing}
            onRefresh={syncProfile}
            onSites={() => navigate('sites')}
            onDetails={() => openModal('account')}
            error={profileError}
          />
        )}
        {view === 'downloads' && (
          <Downloads configured={state.qbConfigured} demo={demo} onConnect={() => openModal('qb')} onNotify={notify} />
        )}
        {view === 'farming' && (
          <Farming
            demo={demo}
            site={site}
            configured={site === 'tjupt' ? state.tjuptConfigured : state.configured}
            qbConfigured={state.qbConfigured}
            onConnect={() => navigate('sites')}
            onQbConnect={() => {
              setQbPass('');
              openModal('qb');
            }}
            onDownload={setDownloadItem}
            notify={notify}
          />
        )}
        {view === 'overview' && (
          <Activity
            profile={demo ? demoProfile : profile}
            demo={demo}
            qbConfigured={state.qbConfigured}
            onConnect={() => {
              setQbPass('');
              openModal('qb');
            }}
          />
        )}
        {['discover', 'subscriptions', 'favorites'].includes(view) && (
          <section className="resources" aria-label="资源列表">
            <div className="section-head">
              <div>
                <h2>
                  {view === 'subscriptions' ? '订阅内容' : view === 'favorites' ? '已收藏资源' : '所有资源'}
                  <span className="count-label">{list.length}</span>
                </h2>
                {view === 'subscriptions' && <p className="muted">每个订阅缓存 10 分钟，减少对站点的请求。</p>}
              </div>
              <div className="section-actions">
                {view === 'subscriptions' && (
                  <button className="text-button" onClick={() => openModal('rss')} disabled={!state.local}>
                    <Icon as={PlusIcon} size={18} />
                    添加订阅
                  </button>
                )}
                <form
                  className="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setSearch(q);
                    setRevision((x) => x + 1);
                  }}>
                  <button aria-label="搜索资源">
                    <Icon as={MagnifyingGlassIcon} size={19} />
                  </button>
                  <input
                    aria-label="搜索标题或关键词"
                    placeholder="搜索标题、关键词…"
                    enterKeyHint="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {q && (
                    <button
                      type="button"
                      aria-label="清除搜索"
                      onClick={() => {
                        setQ('');
                        setSearch('');
                      }}>
                      <Icon as={XIcon} size={16} />
                    </button>
                  )}
                </form>
                <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">最新发布</option>
                  <option value="oldest">最早发布</option>
                  <option value="size">体积优先</option>
                  <option value="seeders">做种优先</option>
                </select>
                <select aria-label="分类筛选" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="all">全部分类</option>
                  {['电影', '剧集', '纪录片', '动漫', '音乐', 'RSS', '其他'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <button
                  aria-pressed={free}
                  className={`filter-button ${free ? 'selected' : ''}`}
                  onClick={() => setFree(!free)}>
                  {free && <Icon as={CheckIcon} size={14} />}免费
                  <Icon as={CaretDownIcon} size={12} />
                </button>
              </div>
            </div>
            <div className="extra-filters">
              {site === 'mteam' && (
                <label>
                  来源
                  <select
                    aria-label="来源筛选"
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                      setPage(1);
                    }}>
                    <option value="all">全部来源</option>
                    {view !== 'subscriptions' && <option value="mteam">M-Team API</option>}
                    <option value="rss">全部 RSS</option>
                    {state.feeds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                规格
                <select aria-label="规格筛选" value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="all">全部规格</option>
                  <option>4K</option>
                  <option>1080p</option>
                  <option>720p</option>
                </select>
              </label>
              <span>分类、规格与免费筛选作用于当前结果</span>
            </div>
            {resourceWarning && (
              <div className="notice" role="alert">
                <Icon as={WarningCircleIcon} size={18} />
                <span>{resourceWarning}</span>
                <button onClick={() => setRevision((x) => x + 1)}>重试</button>
              </div>
            )}
            <div className="resource-table" aria-busy={loading}>
              <div className="table-heading">
                <span>#</span>
                <span>资源信息</span>
                <span>来源</span>
                <span>规格</span>
                <span>大小</span>
                <span>做种</span>
                <span>收藏</span>
              </div>
              {loading && !demo && view !== 'favorites' && !list.length ? (
                <div className="empty-state">
                  <Icon as={ArrowsClockwiseIcon} size={30} className="spin" />
                  <h3>正在读取资源</h3>
                  <p>首次连接可能需要几秒钟。</p>
                </div>
              ) : list.length ? (
                list.map((item, i) => (
                  <div className="resource-row" key={item.id}>
                    <span className="row-index">{(page - 1) * 50 + i + 1}</span>
                    <button
                      className="resource-main"
                      onClick={() => setSelected(item)}
                      aria-label={`查看 ${item.title}`}>
                      <Art item={item} />
                      <span className="resource-copy">
                        <strong>
                          {item.title}
                          {item.free && <b className="badge mobile-free">FREE</b>}
                        </strong>
                        <span className="filename">{item.filename}</span>
                        <span className="mobile-meta">
                          {item.feedId ? 'RSS' : item.source}
                          <i>·</i>
                          {item.resolution}
                          <i>·</i>
                          {bytes(item.size).join(' ')}
                          <span>
                            <Icon as={UsersIcon} size={12} />
                            {numeric(item.seeders)}
                          </span>
                        </span>
                      </span>
                    </button>
                    <span className="source-cell">{item.source}</span>
                    <span>
                      <span className={`quality-badge ${item.resolution === '4K' ? 'uhd' : ''}`}>
                        {item.resolution}
                      </span>
                    </span>
                    <span className="size-cell">{bytes(item.size).join(' ')}</span>
                    <span className="seeder-cell">
                      <Icon as={UsersIcon} size={17} />
                      {numeric(item.seeders)}
                      {item.free && <b className="badge">FREE</b>}
                    </span>
                    <button
                      disabled={saving}
                      className={`icon-button bookmark ${state.favorites.some((f) => f.id === item.id) ? 'saved' : ''}`}
                      onClick={() => favorite(item)}
                      aria-label={`${state.favorites.some((f) => f.id === item.id) ? '取消收藏' : '收藏'} ${item.title}`}
                      aria-pressed={state.favorites.some((f) => f.id === item.id)}>
                      <BookmarkSimpleIcon
                        size={21}
                        weight={state.favorites.some((f) => f.id === item.id) ? 'fill' : 'light'}
                      />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <Icon as={view === 'favorites' ? BookmarkSimpleIcon : MagnifyingGlassIcon} size={36} />
                  <h3>
                    {view === 'favorites'
                      ? '喜欢的内容，留在这里'
                      : !state.configured && !state.feeds.length && !demo
                        ? '从连接第一个站点开始'
                        : '暂时没有匹配的资源'}
                  </h3>
                  <p>
                    {view === 'favorites'
                      ? '点击资源旁的书签，即可保存到收藏。'
                      : '试试调整筛选条件，或检查订阅和连接状态。'}
                  </p>
                  {view !== 'favorites' && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setQ('');
                        setSearch('');
                        setCategory('all');
                        setFree(false);
                        setQuality('all');
                        if (!state.configured && !state.feeds.length && !demo) navigate('sites');
                      }}>
                      重置筛选 / 检查连接
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="table-footer">
              <span>
                {demo
                  ? '演示资源 · 不代表站点实际内容'
                  : `${view === 'favorites' ? '收藏保存在本机连接服务' : '来自站点 API 与 RSS'} · 共 ${list.length} 条当前结果${resourceStale ? ' · 显示上次结果' : ''}`}
              </span>
              {!demo && view !== 'favorites' && (page > 1 || hasMore) && (
                <div className="pagination">
                  <button aria-label="上一页" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    <Icon as={ArrowLeftIcon} size={16} />
                  </button>
                  <span>{page}</span>
                  <button aria-label="下一页" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
                    <Icon as={ArrowRightIcon} size={16} />
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
        {view === 'sites' && (
          <SitesPage
            state={state}
            openModal={openModal}
            navigate={navigate}
            notify={notify}
            setState={setState}
            setQbPass={setQbPass}
            pairInfo={pairInfo}
            setPairInfo={setPairInfo}
            disconnectTjupt={disconnectTjupt}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            compact={compact}
            setCompact={setCompact}
            demo={demo}
            changeMode={changeMode}
            navigate={navigate}
            state={state}
            backupPass={backupPass}
            setBackupPass={setBackupPass}
            backupBusy={backupBusy}
            backupOut={backupOut}
            backupIn={backupIn}
            setBackupIn={setBackupIn}
            backupError={backupError}
            createBackup={createBackup}
            applyBackup={applyBackup}
            copyBackupText={copyBackupText}
            setProfile={setProfile}
            setItems={setItems}
            initialize={initialize}
          />
        )}
        <footer className="page-footer">
          <span>栖流 QILIU</span>
          <span>让好内容，自然汇聚。</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="手机导航">
        {[
          ['overview', '总览', HouseIcon],
          ['farming', '刷流', TrendUpIcon],
          ['discover', '发现', MagnifyingGlassIcon],
          ['downloads', '下载', ArrowDownIcon],
          ['settings', '我的', StackIcon],
        ].map(([id, text, C]) => (
          <button
            key={id}
            className={
              view === id || (id === 'settings' && ['sites', 'favorites', 'subscriptions'].includes(view))
                ? 'active'
                : ''
            }
            onClick={() => navigate(id)}
            aria-current={view === id ? 'page' : undefined}>
            <C size={23} weight={view === id ? 'fill' : 'light'} />
            <span>{text}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Icon as={CheckCircleIcon} size={19} />
          {toast}
        </div>
      )}
      {selected && (
        <Modal title="资源详情" onClose={() => setSelected(null)} wide>
          <div className="detail-layout">
            <Art item={selected} large />
            <div className="detail-content">
              <span className="eyebrow">
                {selected.source} {selected.demo ? '· 演示资源' : '· 资源信息'}
              </span>
              <h2>{selected.title}</h2>
              <p>{selected.description || '此资源暂无简介。'}</p>
              <dl className="detail-stats">
                {[
                  ['规格', selected.resolution],
                  ['大小', bytes(selected.size).join(' ')],
                  ['做种', numeric(selected.seeders)],
                  ['发布时间', dateLabel(selected.date)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt>{l}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="detail-filename">{selected.filename}</p>
              <div className="detail-actions">
                {!selected.demo && !demo && (selected.downloadable || /^mt-\d+$/.test(selected.id)) && (
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!state.qbConfigured) {
                        setSelected(null);
                        openModal('qb');
                        notify('先连接下载器，再返回资源发送种子');
                      } else {
                        setDownloadItem(selected);
                        setSelected(null);
                      }
                    }}>
                    <Icon as={ArrowDownIcon} size={18} />
                    发送到 qBittorrent
                  </button>
                )}
                {selected.url && /^https:\/\//.test(selected.url) ? (
                  <a className="secondary-button" href={selected.url} target="_blank" rel="noopener noreferrer">
                    打开原始链接
                    <Icon as={ArrowUpRightIcon} size={18} />
                  </a>
                ) : (
                  <span className="muted">{selected.demo ? '演示资源没有真实站点链接' : '订阅未提供可用链接'}</span>
                )}
                <button className="secondary-button" disabled={saving} onClick={() => favorite(selected)}>
                  <Icon as={BookmarkSimpleIcon} size={18} />
                  {state.favorites.some((f) => f.id === selected.id) ? '取消收藏' : '收藏资源'}
                </button>
              </div>
              <small className="muted">RSS 原始链接可能直接下载种子，以来源站点为准。</small>
            </div>
          </div>
        </Modal>
      )}
      {downloadItem && (
        <Modal title="发送到 qBittorrent" onClose={() => setDownloadItem(null)}>
          <DownloadForm
            item={downloadItem}
            onClose={() => setDownloadItem(null)}
            onTasks={() => {
              setDownloadItem(null);
              navigate('downloads');
            }}
          />
        </Modal>
      )}
      {modal === 'account' && (
        <Modal title="我的账号详情" onClose={() => setModal(null)}>
          <p className="muted">{demo ? '演示模式' : profile?.username || '尚未连接'} · 未返回的字段显示为 —</p>
          <dl className="detail-stats">
            {[
              ['用户等级', (demo ? demoProfile : profile)?.role],
              ['正在下载', numeric(profile?.leeching)],
              ['已发种数', numeric(profile?.uploads)],
              ['可用邀请', numeric(profile?.invites)],
              ['加入时间', dateLabel(profile?.joined)],
              ['最近访问', dateLabel(profile?.lastSeen)],
              ['账号警告', profile?.warned === true ? '有警告' : profile?.warned === false ? '无' : '—'],
              ['VIP 到期', dateLabel(profile?.vipUntil)],
            ].map(([l, v]) => (
              <div key={l}>
                <dt>{l}</dt>
                <dd>{demo && l !== '用户等级' ? '—' : v || '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">分享率优先采用站点值。考核规则未接入，不根据分享率猜测账号是否安全。</p>
        </Modal>
      )}
      {modal === 'qb' && (
        <Modal
          title="连接 qBittorrent"
          onClose={() => {
            setModal(null);
            setQbPass('');
          }}>
          <form
            className="connection-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              setFormError('');
              try {
                await api('/qb/connect', {
                  method: 'POST',
                  body: JSON.stringify({ url: qbURL, username: qbUser, password: qbPass, keepPassword: !qbPass }),
                });
                setQbPass('');
                setState(await api('/state'));
                setModal(null);
                notify('下载器已连接');
              } catch (e) {
                setFormError(e.message);
              } finally {
                setSaving(false);
              }
            }}>
            <p>在 qBittorrent 设置中开启 Web UI，然后填写手机或 Mac 能直接访问的地址。无需关闭 Web UI 的身份验证。</p>
            <label htmlFor="qb-url">Web UI 地址</label>
            <input
              id="qb-url"
              type="url"
              required
              placeholder="http://[IPv6地址]:18080"
              value={qbURL}
              onChange={(e) => setQbURL(e.target.value)}
            />
            <label htmlFor="qb-user">用户名</label>
            <input id="qb-user" autoComplete="off" value={qbUser} onChange={(e) => setQbUser(e.target.value)} />
            <label htmlFor="qb-pass">密码</label>
            <input
              id="qb-pass"
              type="password"
              autoComplete="off"
              placeholder={state.qbConfigured ? '地址和用户名不变时，可留空保留密码' : 'qBittorrent Web UI 密码'}
              value={qbPass}
              onChange={(e) => setQbPass(e.target.value)}
            />
            <p>
              支持 IPv4、IPv6 和域名，IPv6 请使用方括号，例如 http://[IPv6地址]:18080。手机需能访问 NAS；无需 Mac 开机。
            </p>
            {qbURL.trim().startsWith('http://') && (
              <p className="inline-warning">HTTP 不加密密码和种子数据；确认是自己的下载器地址后即可连接。</p>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary-button" disabled={saving}>
              {saving ? '正在验证…' : '验证并连接'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'connect' && (
        <Modal
          title={state.configured ? '更新 M-Team 连接' : '连接 M-Team'}
          onClose={() => {
            setModal(null);
            setKey('');
          }}>
          <form onSubmit={connect} className="connection-form">
            <p>使用 M-Team「控制台 → 实验室 → 存取令牌」中的 API Access Token。</p>
            <label htmlFor="api-base">API 地址</label>
            <select id="api-base" value={base} onChange={(e) => setBase(e.target.value)}>
              <option>https://api.m-team.cc/api</option>
              <option>https://api.m-team.io/api</option>
            </select>
            <label htmlFor="api-key">Access Token</label>
            <div className="secret-field">
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck="false"
                required
                minLength={8}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="粘贴你的 API Key"
              />
              <button
                type="button"
                aria-label={showKey ? '隐藏 Token' : '显示 Token'}
                onClick={() => setShowKey(!showKey)}>
                <Icon as={showKey ? EyeSlashIcon : EyeIcon} size={20} />
              </button>
            </div>
            <p className="secure-note">
              <Icon as={LockKeyIcon} size={17} />
              仅向 M-Team 发送，并加密保存在本机。
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary-button" disabled={saving}>
              {saving ? '正在验证连接…' : '验证并保存连接'}
              <Icon as={ArrowRightIcon} size={18} />
            </button>
          </form>
        </Modal>
      )}
      {modal === 'tjupt' && (
        <Modal
          title={state.tjuptConfigured ? '更新 TJUPT 连接' : '连接 TJUPT'}
          onClose={() => {
            setModal(null);
            setTjuptPass('');
            setTjuptCookie('');
          }}>
          <form onSubmit={connectTjupt} className="connection-form">
            <p>TJUPT 使用账号密码登录后读取账号与搜索结果；passkey 用于 RSS 与种子下载。凭据只保存在本机加密存储。</p>
            <p className="muted">
              账号开启两步验证时，密码登录会停在验证码页。这类账号请用下面的登录 Cookie 连接：浏览器登录 TJUPT
              后，在开发者工具 Network 里复制任意请求的 Cookie 请求头粘贴进来。
            </p>
            <label htmlFor="tjupt-user">用户名</label>
            <input
              id="tjupt-user"
              autoComplete="username"
              required
              value={tjuptUser}
              onChange={(e) => setTjuptUser(e.target.value)}
              placeholder="TJUPT 用户名"
            />
            <label htmlFor="tjupt-pass">密码（两步验证账号可留空）</label>
            <input
              id="tjupt-pass"
              type="password"
              autoComplete="current-password"
              required={!tjuptCookie.trim() && (!state.tjuptConfigured || tjuptUser !== state.tjupt?.username)}
              value={tjuptPass}
              onChange={(e) => setTjuptPass(e.target.value)}
              placeholder={state.tjuptConfigured ? '留空保留已保存密码' : 'TJUPT 密码'}
            />
            <label htmlFor="tjupt-cookie">登录 Cookie（两步验证账号必填）</label>
            <textarea
              id="tjupt-cookie"
              className="backup-box"
              value={tjuptCookie}
              onChange={(e) => setTjuptCookie(e.target.value)}
              placeholder="粘贴浏览器里的 Cookie 请求头；只保存在本机加密存储"
            />
            <label htmlFor="tjupt-passkey">Passkey（可选，32 位）</label>
            <input
              id="tjupt-passkey"
              autoComplete="off"
              spellCheck="false"
              pattern="[a-fA-F0-9]{32}"
              value={tjuptPasskey}
              onChange={(e) => setTjuptPasskey(e.target.value)}
              placeholder={state.tjupt?.hasPasskey ? '已保存，可留空' : '用于 RSS 和种子下载'}
            />
            <p>
              连续登录失败 10 次会锁定 IP；栖流不会自动重试失败登录。使用 Cookie 连接时不会再提交密码；Cookie
              失效后需要重新复制。
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary-button" disabled={saving}>
              {saving ? '正在登录 TJUPT…' : state.tjuptConfigured ? '保存连接' : '连接 TJUPT'}
              <Icon as={ArrowUpRightIcon} size={16} />
            </button>
          </form>
        </Modal>
      )}
      {modal === 'rss' && (
        <Modal
          title="添加 RSS 订阅"
          onClose={() => {
            setModal(null);
            setFeedURL('');
          }}>
          <form className="connection-form" onSubmit={addFeed}>
            <p>支持 M-Team 和其他站点的 RSS / Atom。签名链接不会在列表中显示。</p>
            <label htmlFor="feed-name">订阅名称</label>
            <input
              id="feed-name"
              maxLength={40}
              required
              placeholder="例如：M-Team 综合订阅"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
            />
            <label htmlFor="feed-url">订阅链接</label>
            <input
              id="feed-url"
              type="password"
              required
              autoComplete="off"
              placeholder="https://…"
              value={feedURL}
              onChange={(e) => setFeedURL(e.target.value)}
            />
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary-button" disabled={saving}>
              {saving ? '正在读取订阅…' : '读取并添加订阅'}
              <Icon as={PlusIcon} size={18} />
            </button>
          </form>
        </Modal>
      )}
      {modal === 'disconnect' && (
        <Modal title="断开 M-Team 连接？" onClose={() => setModal(null)}>
          <p className="modal-description">这会删除本机保存的 API Token。RSS 订阅和收藏仍然保留。</p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              保留连接
            </button>
            <button className="primary-button destructive" disabled={saving} onClick={disconnect}>
              断开连接
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === 'delete-feed' && (
        <Modal title="移除这个订阅？" onClose={() => setModal(null)}>
          <p className="modal-description">移除「{modal.feed.name}」后，不再获取它的更新。已收藏资源仍然保留。</p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              取消
            </button>
            <button className="primary-button destructive" onClick={() => removeFeed(modal.feed)}>
              移除订阅
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
