// M-Team 登录提醒：未封存账号连续 40 天未登录会被删除（部分高等级/封存账号豁免，以站内规则为准）。
export const MT_LOGIN_RULE_DAYS = 40;
export const MT_LOGIN_WARNING_DAYS = 7;
export const MT_LOGIN_URGENT_DAYS = 3;
const DAY = 86400000;

export function loginCountdown(lastSeen, now = Date.now()) {
  const time = Date.parse(String(lastSeen ?? ''));
  if (!Number.isFinite(time)) return null;
  const deadline = time + MT_LOGIN_RULE_DAYS * DAY;
  const daysLeft = Math.ceil((deadline - now) / DAY);
  const level =
    daysLeft <= 0
      ? 'expired'
      : daysLeft <= MT_LOGIN_URGENT_DAYS
        ? 'urgent'
        : daysLeft <= MT_LOGIN_WARNING_DAYS
          ? 'warning'
          : 'ok';
  return {
    lastSeen: new Date(time).toISOString(),
    deadline: new Date(deadline).toISOString(),
    daysLeft,
    level,
  };
}
