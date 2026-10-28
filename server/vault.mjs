import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function createVault(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const keyPath = path.join(directory, 'local.key'),
    file = path.join(directory, 'vault.enc');
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(keyPath, 0o600);
  const key = fs.readFileSync(keyPath);
  return {
    read() {
      if (!fs.existsSync(file)) return { mteam: null, feeds: [], favorites: [] };
      const bytes = fs.readFileSync(file);
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
    },
    write(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      fs.writeFileSync(`${file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), payload]), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
  };
}
