import test from 'node:test';
import assert from 'node:assert/strict';
import { MT_LOGIN_RULE_DAYS, loginCountdown } from '../server/login-reminder.mjs';
import { normalizeProfile } from '../server/model.mjs';

const DAY = 86400000;
const now = Date.parse('2026-10-28T12:00:00Z');
const seenDaysAgo = (days) => new Date(now - days * DAY).toISOString();

test('M-Team login countdown follows the 40-day rule', () => {
  assert.equal(MT_LOGIN_RULE_DAYS, 40);
  const fresh = loginCountdown(seenDaysAgo(10), now);
  assert.equal(fresh.daysLeft, 30);
  assert.equal(fresh.level, 'ok');
  assert.equal(Date.parse(fresh.deadline), now - 10 * DAY + 40 * DAY);
});

test('warning starts seven days before the deadline and becomes urgent at three', () => {
  assert.equal(loginCountdown(seenDaysAgo(34), now).level, 'warning');
  assert.equal(loginCountdown(seenDaysAgo(34), now).daysLeft, 6);
  assert.equal(loginCountdown(seenDaysAgo(33), now).daysLeft, 7);
  assert.equal(loginCountdown(seenDaysAgo(33), now).level, 'warning');
  assert.equal(loginCountdown(seenDaysAgo(37), now).level, 'urgent');
  assert.equal(loginCountdown(seenDaysAgo(37), now).daysLeft, 3);
});

test('overdue and unavailable timestamps are reported honestly', () => {
  assert.equal(loginCountdown(seenDaysAgo(40), now).daysLeft, 0);
  assert.equal(loginCountdown(seenDaysAgo(40), now).level, 'expired');
  assert.equal(loginCountdown(seenDaysAgo(41), now).level, 'expired');
  assert.equal(loginCountdown(null, now), null);
  assert.equal(loginCountdown('', now), null);
  assert.equal(loginCountdown('not-a-date', now), null);
});

test('profile lastSeen falls back to lastLogin when lastBrowse is absent', () => {
  const base = { username: 'fixture', memberCount: { uploaded: '1', downloaded: '1' }, memberStatus: {} };
  const withBrowse = normalizeProfile({
    ...base,
    memberStatus: { lastBrowse: '2026-10-01T00:00:00Z', lastLogin: '2026-09-01T00:00:00Z' },
  });
  assert.equal(withBrowse.lastSeen, '2026-10-01T00:00:00Z');
  const withLoginOnly = normalizeProfile({ ...base, memberStatus: { lastLogin: '2026-09-01T00:00:00Z' } });
  assert.equal(withLoginOnly.lastSeen, '2026-09-01T00:00:00Z');
  assert.equal(normalizeProfile(base).lastSeen, null);
});
