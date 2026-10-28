import {
  ArrowUpIcon,
  ArrowDownIcon,
  ShareNetworkIcon,
  StarIcon,
  DatabaseIcon,
  ChartPieSliceIcon,
  CalendarBlankIcon,
  WarningCircleIcon,
  ShieldCheckIcon,
  LinkIcon,
  StackIcon,
  CaretDownIcon,
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import { Icon, Amount } from './ui';
import { dateLabel, numeric, ratio, relativeLabel } from './data';
import { loginCountdown } from '../server/login-reminder.mjs';

export function Account({ data, demo, refreshing, onRefresh, onSites, onDetails, configured, error, siteName }) {
  const v = data || {};
  const stats = [
    [ArrowUpIcon, '累计上传', <Amount value={v.uploaded} />],
    [
      ArrowDownIcon,
      '累计下载',
      v.downloaded == null ? <span title="站点未提供该数值">—</span> : <Amount value={v.downloaded} />,
    ],
    [ShareNetworkIcon, '分享率', v.ratio == null ? <span title="站点未提供该数值">—</span> : ratio(v.ratio)],
  ];
  const login = siteName === 'M-Team' ? loginCountdown(v.lastSeen) : null;
  const loginTitle = login
    ? `M-Team 规则：未封存账号连续 40 天未登录会被删除（部分高等级/封存账号豁免，以站内规则为准）。最近访问：${dateLabel(v.lastSeen)}；截止：${dateLabel(login.deadline)}。`
    : '站点未返回最近访问时间';
  const secondary = [
    [StarIcon, '魔力值', numeric(v.bonus)],
    [DatabaseIcon, '做种汇总', numeric(v.seeding)],
    [
      ChartPieSliceIcon,
      '汇总体积',
      v.seedingSize > 0 ? (
        <Amount value={v.seedingSize} />
      ) : (
        <span className="muted" title="站点接口没有返回做种体积，这里不再显示 0 B 作为估算">
          —
        </span>
      ),
    ],
    [
      CalendarBlankIcon,
      '登录剩余',
      login ? (
        <span className={`login-countdown ${login.level}`} title={loginTitle}>
          {login.daysLeft <= 0 ? '已逾期' : `${login.daysLeft} 天`}
        </span>
      ) : (
        <span className="muted" title={siteName === 'M-Team' ? loginTitle : 'TJUPT 未提供登录有效期'}>
          —
        </span>
      ),
    ],
  ];
  return (
    <section className="account-panel" aria-label={`${siteName} 账号概览`}>
      <div className="account-heading">
        <h2>
          {siteName} <span>账号概览</span>
        </h2>
        <button className="site-picker" onClick={onSites}>
          <Icon as={StackIcon} size={19} />
          {siteName}
          <Icon as={CaretDownIcon} size={13} />
        </button>
      </div>
      <div className="identity">
        <div className="avatar">{(v.username || 'M').slice(0, 1).toUpperCase()}</div>
        <div className="identity-copy">
          <strong>
            {v.username || (configured ? '正在读取账号…' : '连接你的 ' + siteName)}
            <span className="role">{demo ? ' · 演示账号' : v.role ? ` · ${v.role}` : ''}</span>
          </strong>
          <span className={`status-pill ${demo || v.stale ? 'amber' : ''}`}>
            <Icon
              as={demo ? StarIcon : v.stale ? WarningCircleIcon : configured ? ShieldCheckIcon : LinkIcon}
              size={13}
            />
            {demo
              ? '演示数据 · 未连接真实账号'
              : v.stale
                ? '上次成功数据 · 更新失败'
                : v.username
                  ? '已连接真实账号'
                  : siteName === 'TJUPT'
                    ? '通过账号密码连接'
                    : '通过 Access Token 连接'}
          </span>
        </div>
      </div>
      <div className="primary-stats">
        {stats.map(([C, label, content]) => (
          <div className="primary-stat" key={label}>
            <Icon as={C} size={35} />
            <div>
              <span>{label}</span>
              <strong>{content}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="secondary-stats">
        {secondary.map(([C, label, content]) => (
          <div className="secondary-stat" key={label}>
            <Icon as={C} size={22} />
            <div>
              <span>{label}</span>
              <strong>{content}</strong>
            </div>
          </div>
        ))}
      </div>
      {v.warning && (
        <div className="inline-warning">
          <Icon as={WarningCircleIcon} size={16} />
          {v.warning}
        </div>
      )}
      {error && (
        <div className="inline-warning" role="alert">
          <Icon as={WarningCircleIcon} size={16} />
          {error}
        </div>
      )}
      <div className="sync-line">
        <span>最近同步：{relativeLabel(v.syncedAt)}</span>
        <div>
          <button className="text-button account-more" onClick={onDetails}>
            账号详情
            <Icon as={ArrowUpRightIcon} size={14} />
          </button>
          <button className="text-button" disabled={refreshing} onClick={onRefresh}>
            <Icon as={ArrowsClockwiseIcon} size={18} className={refreshing ? 'spin' : ''} />
            {refreshing ? '同步中' : '刷新'}
          </button>
        </div>
      </div>
    </section>
  );
}
