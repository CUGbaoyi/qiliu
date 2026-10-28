import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTorrent } from '../server/model.mjs';
import {
  GB,
  discountInfo,
  ageHours,
  matchesFilters,
  rankCandidates,
  scoreCandidate,
  sizeScore,
} from '../server/farming.mjs';

const now = Date.parse('2026-10-28T12:00:00Z');
const base = {
  id: 'mt-1',
  title: 'Sample 2160p',
  filename: 'Sample.2160p.mkv',
  source: 'M-Team',
  category: '419',
  resolution: '4K',
  size: 10 * GB,
  seeders: 10,
  leechers: 10,
  free: true,
  discount: 'FREE',
  completed: 20,
  date: '2026-10-28T10:00:00Z',
  demo: false,
};
const candidate = (extra) => ({ ...base, ...extra });

test('score is bounded, weighted breakdown adds up and grade follows score', () => {
  const scored = scoreCandidate(candidate(), { mode: 'upload', now });
  assert.ok(scored.score >= 0 && scored.score <= 100);
  const sum = scored.breakdown.reduce((total, row) => total + row.points, 0);
  assert.ok(Math.abs(scored.score - sum) <= 1);
  assert.deepEqual(
    scored.breakdown.map((row) => row.key),
    ['freshness', 'supply', 'free', 'heat', 'size'],
  );
  assert.equal(scored.mode, 'upload');
  assert.equal(scored.grade, scored.score >= 75 ? 'A' : scored.score >= 55 ? 'B' : scored.score >= 35 ? 'C' : 'D');
  assert.equal(scoreCandidate(candidate({ size: 0, seeders: null, leechers: null }), { now }).score >= 0, true);
});

test('fresh free demand outranks stale normal upload', () => {
  const rows = rankCandidates(
    [
      candidate({ id: 'old', free: false, discount: 'NORMAL', date: '2026-10-20T12:00:00Z', leechers: 2, seeders: 80 }),
      candidate({ id: 'fresh', date: '2026-10-28T11:00:00Z', leechers: 40, seeders: 5 }),
    ],
    { mode: 'upload', prefs: { freeOnly: false, hours: 720 }, now },
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['fresh', 'old'],
  );
  assert.ok(rows[0].score > rows[1].score);
});

test('upload mode prefers medium sizes while bonus mode prefers small ones', () => {
  assert.ok(sizeScore(12 * GB, 'upload') > sizeScore(200 * GB, 'upload'));
  assert.ok(sizeScore(1 * GB, 'bonus') > sizeScore(30 * GB, 'bonus'));
  assert.ok(sizeScore(12 * GB, 'upload') > sizeScore(1 * GB, 'upload'));
});

test('mode changes weights rather than just filters', () => {
  const small = candidate({ size: 1 * GB, leechers: 2, completed: 2 });
  assert.ok(scoreCandidate(small, { mode: 'bonus', now }).score > scoreCandidate(small, { mode: 'upload', now }).score);
});

test('filters honour free-only, age window, leechers and size cap', () => {
  const prefs = { freeOnly: true, hours: 24, minLeechers: 5, maxSizeGB: 50 };
  assert.equal(matchesFilters(candidate(), prefs), true);
  assert.equal(matchesFilters(candidate({ discount: '2X_FREE' }), prefs), true);
  assert.equal(matchesFilters(candidate({ discount: '2X' }), prefs), false);
  assert.equal(matchesFilters(candidate({ discount: 'NORMAL', free: false }), prefs), false);
  assert.equal(matchesFilters(candidate({ leechers: 2 }), prefs), false);
  assert.equal(matchesFilters(candidate({ size: 80 * GB }), prefs), false);
  assert.equal(matchesFilters(candidate({ date: '2026-10-25T12:00:00Z' }), prefs), false);
  assert.equal(matchesFilters(candidate({ date: 'not-a-date' }), prefs), false);
  assert.equal(matchesFilters(candidate({ free: false, discount: 'NORMAL' }), { ...prefs, freeOnly: false }), true);
});

test('discount labels cover free, double upload and half download', () => {
  assert.deepEqual(discountInfo({ discount: 'FREE' }), { score: 100, label: '免费', free: true, double: false });
  assert.deepEqual(discountInfo({ discount: '2X_FREE' }), { score: 100, label: '2X 免费', free: true, double: true });
  assert.equal(discountInfo({ discount: '2X' }).label, '2X 上传');
  assert.equal(discountInfo({ discount: '50%' }).score, 55);
  assert.equal(discountInfo({ discount: 'NORMAL' }).score, 0);
  assert.equal(discountInfo({ free: true }).free, true);
});

test('torrent normalization exposes discount and completion for ranking', () => {
  const row = normalizeTorrent({
    id: '9',
    name: 'a 2160p',
    size: '2048',
    status: { seeders: 1, leechers: 3, timesCompleted: 12, promotionRule: { discount: '_2X_FREE' } },
  });
  assert.equal(row.discount, '2X_FREE');
  assert.equal(row.completed, 12);
  assert.equal(row.free, true);
  assert.ok(ageHours(row.date) === null);
});
