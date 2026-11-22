#!/usr/bin/env bash
set -euo pipefail

echo "1. Установка зависимостей..."
npm ci

echo "2. Сборка веб-интерфейса (Vite)..."
npm run build

echo "3. Установка Electron и electron-builder..."
npm install --no-save electron@33.2.0 electron-builder@25.1.8

echo "4. Компиляция Electron (main/preload/updater)..."
npx tsc -p tsconfig.electron.json
node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }))"

echo "5. Сборка пакетов Linux (AppImage, .deb, .tar.gz)..."
npx electron-builder --linux AppImage deb tar.gz --x64 --publish never

echo "6. Генерация SHA-256 контрольных сумм..."
(cd release-dist && sha256sum * > checksums.txt && cat checksums.txt)
echo "Готово! Пакеты Linux находятся в папке release-dist/"
