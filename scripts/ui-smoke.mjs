#!/usr/bin/env node
// 无依赖 UI 冒烟：启动本地服务 + 无头 Chrome，检查关键页面与移动端无横向溢出。
// 用法：npm run test:ui（可用 QILIU_CHROME 指定浏览器路径）
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4300 + Math.floor(Math.random() * 200);
const debugPort = 9400 + Math.floor(Math.random() * 200);
const dataDir = mkdtempSync(path.join(tmpdir(), 'qiliu-ui-'));
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = [
  process.env.QILIU_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));
const problems = [];
let server, browser, socket;

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw new Error(`等待超时：${lastError?.message || '未就绪'}`);
}
const fetchJSON = async (url) => (await fetch(url)).json();

class Devtools {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message);
    };
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || '页面脚本异常');
    return response.result?.result?.value;
  }
}

try {
  if (!chrome) throw new Error('未找到 Chrome/Chromium；可用 QILIU_CHROME 指定路径。');
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...process.env, QILIU_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`${base}/api/auth`)).ok);

  browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--hide-scrollbars',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(dataDir, 'chrome')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const target = await waitFor(async () =>
    (await fetchJSON(`http://127.0.0.1:${debugPort}/json/list`)).find((item) => item.type === 'page'),
  );
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const devtools = new Devtools(socket);
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  const pageErrors = [];
  devtools.on('Runtime.exceptionThrown', (event) => pageErrors.push(event.params.exceptionDetails?.text || '脚本异常'));
  devtools.on('Runtime.consoleAPICalled', (event) => {
    if (event.params.type === 'error')
      pageErrors.push(event.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  });

  async function open(route, width = 1320, height = 1000) {
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
    await devtools.send('Page.navigate', { url: base + route });
    await sleep(1400);
  }
  const check = (name, passed, detail = '') => {
    console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
    if (!passed) problems.push(name);
  };

  const pages = [
    [
      '总览',
      '/?view=overview',
      `!!document.querySelector('.account-panel') && !document.body.innerText.includes('最新资源')`,
    ],
    [
      '刷流',
      '/?view=farming',
      `!!document.querySelector('.farming-panel') && document.querySelectorAll('.farming-card').length > 0`,
    ],
    ['发现', '/?view=discover', `document.body.innerText.includes('发现资源')`],
    ['站点', '/?view=sites', `document.body.innerText.includes('TJUPT') && document.body.innerText.includes('M-Team')`],
    ['设置', '/?view=settings', `document.body.innerText.includes('备份与迁移')`],
  ];
  for (const [name, route, expression] of pages) {
    await open(route);
    check(`桌面 · ${name}`, await devtools.evaluate(expression));
  }

  for (const [name, route] of [
    ['总览', '/?view=overview'],
    ['刷流', '/?view=farming'],
    ['站点', '/?view=sites'],
  ]) {
    await open(route, 390, 844);
    const result = await devtools.evaluate(
      `JSON.stringify({scroll:document.documentElement.scrollWidth,inner:innerWidth})`,
    );
    const metrics = JSON.parse(result);
    check(
      `移动端 · ${name} 无横向溢出`,
      metrics.scroll <= metrics.inner + 1,
      `scrollWidth=${metrics.scroll} viewport=${metrics.inner}`,
    );
  }

  const nav = await devtools.evaluate(
    `(async()=>{const buttons=[...document.querySelectorAll('.sidebar .nav-item')];const before=document.querySelector('.page-header h1')?.innerText;buttons[1]?.click();await new Promise(r=>setTimeout(r,500));const after=document.querySelector('.page-header h1')?.innerText;return before!==after;})()`,
  );
  check('侧栏导航切换页面', nav === true);
  check('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (error) {
  problems.push(error.message);
  console.error(`FAIL ${error.message}`);
} finally {
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  try {
    browser?.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  try {
    server?.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  await sleep(200);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (problems.length) {
  console.error(`\nUI 冒烟失败 ${problems.length} 项：${problems.join('；')}`);
  process.exit(1);
}
console.log('\nUI 冒烟通过');
