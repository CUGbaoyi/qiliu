#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  for qiliu_bin in "$HOME"/.nvm/versions/node/*/bin(N/); do
    export PATH="$qiliu_bin:$PATH"
  done
fi
if ! command -v node >/dev/null; then
  print '请先从 nodejs.org 安装 Node.js 22 或更高版本。'
  read '?按回车关闭…'
  exit 1
fi
if curl -fsS --max-time 2 http://127.0.0.1:4173/api/auth >/dev/null 2>&1; then
  open http://localhost:4173
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci --registry=https://registry.npmjs.org
fi
if [[ ! -f dist/client/index.html ]]; then
  npm run build
fi
print '栖流即将打开。请保持此终端窗口运行；关闭窗口将停止服务。'
(sleep 2; open http://localhost:4173) &
exec node server/index.mjs --host 0.0.0.0 --port 4173
