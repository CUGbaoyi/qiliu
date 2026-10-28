import { api, savePreference } from './data';
import { Icon } from './ui';
import { ArrowRightIcon, DatabaseIcon } from '@phosphor-icons/react';

export function SettingsPage({
  compact,
  setCompact,
  demo,
  changeMode,
  navigate,
  state,
  backupPass,
  setBackupPass,
  backupBusy,
  backupOut,
  backupIn,
  setBackupIn,
  backupError,
  createBackup,
  applyBackup,
  copyBackupText,
  setProfile,
  setItems,
  initialize,
}) {
  return (
    <div className="settings-content">
      <section className="settings-panel">
        <h2>界面与数据</h2>
        <div className="preference-row">
          <div>
            <h3>紧凑列表</h3>
            <p>在电脑屏幕中显示更多资源</p>
          </div>
          <button
            role="switch"
            aria-checked={compact}
            aria-label="紧凑列表"
            className={`toggle ${compact ? 'on' : ''}`}
            onClick={() => {
              setCompact(!compact);
              savePreference('qiliu-compact', String(!compact));
            }}>
            <span />
          </button>
        </div>
        <div className="preference-row">
          <div>
            <h3>演示模式</h3>
            <p>演示数据与真实收藏分开显示</p>
          </div>
          <button
            role="switch"
            aria-checked={demo}
            aria-label="演示模式"
            className={`toggle ${demo ? 'on' : ''}`}
            onClick={() => changeMode(demo ? 'live' : 'demo')}>
            <span />
          </button>
        </div>
        <div className="preference-row">
          <div>
            <h3>站点与设备</h3>
            <p>管理 M-Team、TJUPT、RSS 和 qBittorrent</p>
          </div>
          <button className="secondary-button" onClick={() => navigate('sites')}>
            管理连接
            <Icon as={ArrowRightIcon} size={17} />
          </button>
        </div>
        <div className="preference-row mobile-only">
          <div>
            <h3>RSS 订阅</h3>
            <p>查看订阅更新与添加订阅</p>
          </div>
          <button className="secondary-button" onClick={() => navigate('subscriptions')}>
            打开订阅
          </button>
        </div>
        <div className="preference-row mobile-only">
          <div>
            <h3>我的收藏</h3>
            <p>查看所有保存的资源</p>
          </div>
          <button className="secondary-button" onClick={() => navigate('favorites')}>
            打开收藏
          </button>
        </div>
      </section>
      {state.local && (
        <section className="settings-panel">
          <div className="section-head">
            <h2>
              <Icon as={DatabaseIcon} />
              备份与迁移
            </h2>
            <span className="muted">口令加密</span>
          </div>
          <p className="muted">
            备份包含站点 Token、TJUPT 账号、订阅地址、收藏和下载器密码，已用口令加密；口令不会保存，忘记无法恢复。
          </p>
          <label className="field-label" htmlFor="backup-pass">
            备份口令（至少 8 位）
          </label>
          <input
            id="backup-pass"
            type="password"
            autoComplete="new-password"
            value={backupPass}
            onChange={(e) => setBackupPass(e.target.value)}
            placeholder="用于加密和解密备份"
          />
          <div className="backup-actions">
            <button className="secondary-button" disabled={backupBusy || backupPass.length < 8} onClick={createBackup}>
              {backupBusy ? '处理中…' : '生成备份'}
            </button>
            <button className="text-button" disabled={!backupOut} onClick={copyBackupText}>
              复制备份
            </button>
          </div>
          {backupOut && (
            <textarea
              className="backup-box"
              readOnly
              value={backupOut}
              aria-label="备份内容"
              onFocus={(e) => e.target.select()}
            />
          )}
          <label className="field-label" htmlFor="backup-in">
            导入备份
          </label>
          <textarea
            id="backup-in"
            className="backup-box"
            value={backupIn}
            onChange={(e) => setBackupIn(e.target.value)}
            placeholder="粘贴备份 JSON"
          />
          <div className="backup-actions">
            <button
              className="primary-button"
              disabled={backupBusy || !backupIn.trim() || backupPass.length < 8}
              onClick={applyBackup}>
              导入并覆盖本机配置
            </button>
          </div>
          {backupError && (
            <p className="form-error" role="alert">
              {backupError}
            </p>
          )}
          <p className="muted">导入会覆盖当前设备的站点连接、订阅、收藏和下载器设置；不会自动重试或合并旧配置。</p>
        </section>
      )}
      {state.deployment === 'nas' && (
        <button
          className="secondary-button"
          onClick={async () => {
            await api('/logout', { method: 'POST', body: '{}' });
            setProfile(null);
            setItems([]);
            await initialize();
          }}>
          退出登录
        </button>
      )}
      <section className="settings-panel about">
        <img src="/icon.png" alt="栖流图标" />
        <div>
          <h2>
            栖流 <span>QILIU</span>
          </h2>
          <p>你的站点，你的空间。版本 0.4.0</p>
          <p>
            {state.native
              ? '凭据加密保存在此设备。Android 与 Mac 均可独立联网使用。'
              : 'Web 预览仍由本机服务提供；安装原生客户端后可独立运行。'}
          </p>
          <p>实时数据需要设备能访问站点及下载器。各设备收藏独立保存。</p>
        </div>
      </section>
    </div>
  );
}
