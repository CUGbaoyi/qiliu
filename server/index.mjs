import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.mjs';
import { createVault } from './vault.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(option('--port', process.env.PORT || 4173));
const host = option('--host', process.env.HOST || '127.0.0.1');
const deployment = process.env.QILIU_DEPLOYMENT || 'local';
const adminPassword = process.env.QILIU_ADMIN_PASSWORD_FILE
  ? fs.readFileSync(process.env.QILIU_ADMIN_PASSWORD_FILE, 'utf8').trim()
  : process.env.QILIU_ADMIN_PASSWORD || '';
const app = createApp({
  deployment,
  adminPassword,
  publicOrigin: process.env.QILIU_PUBLIC_ORIGIN || '',
  additionalOrigins: (process.env.QILIU_ADDITIONAL_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  vault: createVault(process.env.QILIU_DATA_DIR || path.join(root, '.data')),
  port,
});
app.use((req, res, next) => {
  let target;
  try {
    target = decodeURIComponent(req.path);
  } catch {
    return res.sendStatus(400);
  }
  if (/\/(?:\.data|\.git|\.openai|\.env)(?:\/|\.|$)/.test(target)) return res.sendStatus(404);
  next();
});
app.use((_req, res, next) => {
  res
    .set('Referrer-Policy', 'no-referrer')
    .set('X-Content-Type-Options', 'nosniff')
    .set('X-Frame-Options', 'DENY')
    .set('Cross-Origin-Opener-Policy', 'same-origin')
    .set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
if (args.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use((_req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.static(path.join(root, 'dist/client')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/client/index.html')));
}
const server = app.listen(port, host, () =>
  console.log(
    `栖流已启动 http://localhost:${port} · ${deployment === 'nas' ? 'NAS 模式：使用管理密码登录' : host === '127.0.0.1' ? '本机访问' : '局域网模式：其他设备需要配对'}`,
  ),
);
server.on('error', (error) => {
  console.error(`启动失败：${error.code}`);
  process.exit(1);
});
