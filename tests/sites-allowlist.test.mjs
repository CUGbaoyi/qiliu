import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MTEAM_PATHS, MT_BASES, TJUPT_BASE, TJUPT_HOSTS, TJUPT_PATHS } from '../server/sites.mjs';
import { downloadURL } from '../server/tjupt.mjs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const shells = [
  ['macOS', 'native/macos/Qiliu.swift'],
  ['Android', 'native/android/src/cc/qiliu/app/MainActivity.java'],
  ['Windows/Linux', 'native/desktop-core/src/allowlist.rs'],
];

test('native allowlists stay in sync with the shared site lists', () => {
  for (const [label, file] of shells) {
    const text = read(file);
    for (const path of [...MTEAM_PATHS, ...TJUPT_PATHS])
      assert.ok(text.includes(`"${path}"`), `${label} 缺少路径 ${path}`);
    for (const host of ['api.m-team.cc', 'api.m-team.io', ...TJUPT_HOSTS]) {
      assert.ok(text.includes(`"${host}"`), `${label} 缺少主机 ${host}`);
    }
    for (const base of MT_BASES) assert.ok(text.includes(new URL(base).hostname), `${label} 缺少 M-Team 主机 ${base}`);
  }
});

test('TJUPT download URL only targets the allowlisted host', () => {
  const url = new URL(downloadURL({ passkey: 'a'.repeat(32) }, 42));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, new URL(TJUPT_BASE).hostname);
  assert.ok(TJUPT_HOSTS.includes(url.hostname));
});
