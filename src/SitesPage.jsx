import { api } from './data';
import { Icon } from './ui';
import {
  StackIcon,
  GlobeHemisphereWestIcon,
  ShieldCheckIcon,
  ArrowUpRightIcon,
  RssIcon,
  PlusIcon,
  TrashIcon,
  DatabaseIcon,
  DeviceMobileIcon,
  LinkIcon,
  CheckCircleIcon,
} from '@phosphor-icons/react';

export function SitesPage({
  state,
  openModal,
  navigate,
  notify,
  setState,
  setQbPass,
  pairInfo,
  setPairInfo,
  disconnectTjupt,
}) {
  return (
    <div className="settings-content">
      <section className="settings-panel">
        <div className="section-head">
          <h2>
            <Icon as={StackIcon} />
            我的站点
          </h2>
          <span className="muted">API 连接</span>
        </div>
        <div className="connection-row">
          <span className="connection-icon">
            <Icon as={GlobeHemisphereWestIcon} size={29} />
          </span>
          <div>
            <h3>
              M-Team{' '}
              <span className={`small-status ${state.configured ? 'connected' : ''}`}>
                {state.configured ? '已配置' : '待连接'}
              </span>
            </h3>
            <p>账号信息、分享率、做种统计与资源搜索</p>
          </div>
          <button className="primary-button" disabled={!state.local} onClick={() => openModal('connect')}>
            {state.configured ? '更新连接' : '连接站点'}
            <Icon as={ArrowUpRightIcon} size={16} />
          </button>
        </div>
        {state.configured && (
          <div className="settings-foot">
            <span>
              <Icon as={ShieldCheckIcon} size={16} />
              Token 已加密保存在当前设备
            </span>
            <button className="text-button danger" disabled={!state.local} onClick={() => openModal('disconnect')}>
              断开连接
            </button>
          </div>
        )}
        {!state.local && <p className="muted">连接凭据仅可在 Mac 本机管理。</p>}
      </section>
      <section className="settings-panel">
        <div className="section-head">
          <h2>
            <Icon as={GlobeHemisphereWestIcon} />
            TJUPT
          </h2>
          <span className="muted">NexusPHP 账号</span>
        </div>
        <div className="connection-row">
          <span className="connection-icon">
            <Icon as={GlobeHemisphereWestIcon} size={29} />
          </span>
          <div>
            <h3>
              TJUPT{' '}
              <span className={`small-status ${state.tjuptConfigured ? 'connected' : ''}`}>
                {state.tjuptConfigured ? '已配置' : '待连接'}
              </span>
            </h3>
            <p>账号统计、容量与「发现」搜索；RSS 与种子下载使用 passkey</p>
          </div>
          <button className="primary-button" disabled={!state.local} onClick={() => openModal('tjupt')}>
            {state.tjuptConfigured ? '更新连接' : '连接 TJUPT'}
            <Icon as={ArrowUpRightIcon} size={16} />
          </button>
        </div>
        {state.tjuptConfigured && (
          <div className="settings-foot">
            <span>
              <Icon as={ShieldCheckIcon} size={16} />
              账号密码与 Cookie 只保存在当前设备
            </span>
            <button className="text-button danger" disabled={!state.local} onClick={disconnectTjupt}>
              断开连接
            </button>
          </div>
        )}
        {!state.local && <p className="muted">连接凭据仅可在 Mac 本机管理。</p>}
        <p className="muted">
          TJUPT 没有开放 API；账号信息与搜索结果来自登录后的页面解析，解析失败会显示「—」而不是 0。
        </p>
      </section>
      <section className="settings-panel">
        <div className="section-head">
          <h2>
            <Icon as={RssIcon} />
            RSS 订阅
          </h2>
          <button className="text-button" disabled={!state.local} onClick={() => openModal('rss')}>
            <Icon as={PlusIcon} size={18} />
            添加订阅
          </button>
        </div>
        {state.feeds.length ? (
          state.feeds.map((f) => (
            <div className="feed-row" key={f.id}>
              <Icon as={RssIcon} size={25} />
              <div>
                <h3>{f.name}</h3>
                <p>私密地址已保存 · 每 10 分钟按需刷新</p>
              </div>
              <button
                className="icon-button"
                disabled={!state.local}
                aria-label={`删除订阅 ${f.name}`}
                onClick={() => openModal({ type: 'delete-feed', feed: f })}>
                <Icon as={TrashIcon} size={18} />
              </button>
            </div>
          ))
        ) : (
          <p className="settings-empty">添加站点提供的 RSS 链接，将不同站点的更新汇聚到一起。</p>
        )}
      </section>
      <section className="settings-panel">
        <div className="section-head">
          <h2>
            <Icon as={DatabaseIcon} />
            qBittorrent
          </h2>
          <span className="small-status">{state.qbConfigured ? '已配置' : '待连接'}</span>
        </div>
        <p className="muted">
          读取实时上传、下载速度及活跃任务，每 5 秒更新。在资源详情发送种子，在下载页查看进度与做种状态。
        </p>
        <button
          className="secondary-button"
          onClick={() => {
            setQbPass('');
            openModal('qb');
          }}>
          {state.qbConfigured ? '更新下载器连接' : '连接下载器'}
        </button>
        {state.qbConfigured && (
          <button className="text-button" onClick={() => navigate('downloads')}>
            查看下载任务
          </button>
        )}
        {state.qbConfigured && (
          <button
            className="text-button danger"
            onClick={async () => {
              await api('/qb/connect', { method: 'DELETE' });
              setState(await api('/state'));
              notify('已断开下载器');
            }}>
            断开连接
          </button>
        )}
      </section>
      {state.native || state.deployment === 'nas' ? (
        <section className="settings-panel">
          <h2>
            <Icon as={DeviceMobileIcon} />
            独立运行
          </h2>
          <p className="native-info">
            {state.native
              ? '本设备直接连接 M-Team、RSS 和你的下载器，无需 Mac 中转。凭据和收藏保存在本设备。'
              : 'NAS 容器直接连接站点与下载器，无需 Mac 运行。浏览器共享 NAS 中保存的收藏。'}
          </p>
        </section>
      ) : (
        <>
          <section className="settings-panel">
            <div className="section-head">
              <h2>
                <Icon as={DeviceMobileIcon} />
                在手机上使用
              </h2>
              <span className="small-status">局域网配对</span>
            </div>
            <p className="muted">让小米手机与 Mac 连接同一个 Wi-Fi，打开下方地址并输入配对码。Mac 需要保持运行。</p>
            <p className="muted">当前版本仅用于本机和可信局域网，暂不提供公网访问。</p>
            {state.local ? (
              <>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      setPairInfo(await api('/pairing', { method: 'POST', body: '{}' }));
                    } catch (e) {
                      notify(e.message);
                    }
                  }}>
                  <Icon as={LinkIcon} size={17} />
                  生成手机配对码
                </button>
                {pairInfo && (
                  <div className="pair-details">
                    <strong>{pairInfo.code}</strong>
                    <span>10 分钟内有效，使用一次后失效</span>
                    {pairInfo.addresses.map((a) => (
                      <code key={a}>{a}</code>
                    ))}
                    <small>若无法打开，请以局域网模式启动，并检查 Mac 防火墙。</small>
                  </div>
                )}
                <button
                  className="text-button revoke"
                  onClick={async () => {
                    try {
                      await api('/revoke', { method: 'POST', body: '{}' });
                      setPairInfo(null);
                      notify('已撤销所有手机连接');
                    } catch (e) {
                      notify(e.message);
                    }
                  }}>
                  撤销已配对设备
                </button>
              </>
            ) : (
              <p className="connected">
                <Icon as={CheckCircleIcon} size={18} />
                本设备已配对
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
