import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, exportBackup, importBackup, sanitizeConfig } from '../server/backup.mjs';

const config = {
  mteam: { base: 'https://api.m-team.cc/api', key: 'secret-mteam-token' },
  tjupt: { username: 'alice', password: 'secret-tjupt-password', passkey: 'a'.repeat(32) },
  feeds: [{ id: 'f1', name: '订阅', url: 'https://example.org/rss?sign=private' }],
  favorites: [{ id: 'mt-1', title: '示例资源' }],
  qb: { url: 'http://192.168.1.2:8080', username: 'admin', password: 'secret-qb' },
  extra: 'dropped',
};

test('backup roundtrip keeps credentials encrypted and drops unknown keys', async () => {
  const backup = await exportBackup(config, 'correct horse battery');
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, 1);
  const serialized = JSON.stringify(backup);
  for (const secret of ['secret-mteam-token', 'secret-tjupt-password', 'secret-qb', 'private', 'correct horse'])
    assert.ok(!serialized.includes(secret), secret);
  const restored = await importBackup(backup, 'correct horse battery');
  assert.deepEqual(restored, sanitizeConfig(config));
  assert.equal(restored.extra, undefined);
  assert.equal(restored.mteam.key, 'secret-mteam-token');
  assert.equal(restored.tjupt.passkey, 'a'.repeat(32));
});

test('wrong backup password and tampered payload are rejected', async () => {
  const backup = await exportBackup(config, 'correct horse battery');
  await assert.rejects(() => importBackup(backup, 'wrong password'), /口令不正确|损坏/);
  const tampered = { ...backup, data: backup.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => importBackup(tampered, 'correct horse battery'), /口令不正确|损坏/);
  await assert.rejects(() => importBackup({ format: 'other', version: 1 }, 'correct horse battery'), /0.4 的备份/);
  await assert.rejects(
    () => importBackup({ format: BACKUP_FORMAT, version: 99 }, 'correct horse battery'),
    /0.4 的备份/,
  );
});

test('backup password must be at least eight characters', async () => {
  await assert.rejects(() => exportBackup(config, 'short'), /至少 8 个字符/);
});

test('sanitize rejects unsafe or malformed configurations', () => {
  assert.throws(() => sanitizeConfig(null), /不是有效/);
  assert.throws(() => sanitizeConfig({ mteam: { base: 'https://evil.example/api', key: 'x'.repeat(8) } }), /M-Team/);
  assert.throws(() => sanitizeConfig({ tjupt: { username: 'a', password: '' } }), /TJUPT/);
  assert.throws(() => sanitizeConfig({ tjupt: { username: 'a', password: 'p', passkey: 'zzz' } }), /passkey/);
  assert.throws(() => sanitizeConfig({ feeds: [{ id: 'f', name: 'n', url: 'http://insecure.example/feed' }] }), /订阅/);
  assert.throws(
    () => sanitizeConfig({ feeds: new Array(16).fill({ id: 'f', name: 'n', url: 'https://example.org/f' }) }),
    /订阅/,
  );
  assert.equal(
    sanitizeConfig({ feeds: [{ id: 'f', name: 'n', url: 'https://example.org/f', extra: 'x' }] }).feeds[0].extra,
    undefined,
  );
  assert.throws(() => sanitizeConfig({ favorites: [{ id: '', title: 'x' }] }), /收藏/);
  const empty = sanitizeConfig({});
  assert.deepEqual(empty, { mteam: null, tjupt: null, feeds: [], favorites: [], qb: null });
});

test('cookie-based TJUPT connections survive backup and are encrypted', async () => {
  const cookieConfig = {
    tjupt: {
      username: 'alice',
      password: '',
      passkey: 'f'.repeat(32),
      cookie: 'c_secure_uid=1; c_secure_pass=secret-cookie',
    },
  };
  const backup = await exportBackup(cookieConfig, 'cookie pass phrase');
  assert.ok(!JSON.stringify(backup).includes('secret-cookie'));
  const restored = await importBackup(backup, 'cookie pass phrase');
  assert.deepEqual(restored, sanitizeConfig(cookieConfig));
  assert.equal(restored.tjupt.cookie, 'c_secure_uid=1; c_secure_pass=secret-cookie');
  assert.throws(() => sanitizeConfig({ tjupt: { username: 'alice', password: '', passkey: '' } }), /TJUPT/);
});
