import { number } from './model.mjs';
export function enrichProfile(profile, status, bonus, previous) {
  const hourly = number(bonus?.formulaParams?.finalBs);
  const elapsed = previous ? (Date.parse(profile.syncedAt) - Date.parse(previous.syncedAt)) / 1000 : 0;
  const delta =
    previous &&
    previous.username === profile.username &&
    number(previous.uploaded) !== null &&
    number(profile.uploaded) !== null
      ? profile.uploaded - previous.uploaded
      : null;
  const trackerSeeding = number(status?.seeder);
  return {
    ...profile,
    seeding: trackerSeeding !== null ? trackerSeeding : profile.seeding,
    onlineSeeders: number(status?.seeder),
    onlineLeechers: number(status?.leecher),
    bonusPerHour: hourly,
    bonusPerDay: hourly === null ? null : hourly * 24,
    accountUploadDelta: elapsed >= 60 && delta !== null && delta >= 0 ? delta : null,
    sampleSeconds: elapsed >= 60 ? elapsed : null,
  };
}
