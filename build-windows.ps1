# Локальная сборка установщика Pearl Vault для Windows 10/11 (x64)
$ErrorActionPreference = "Stop"

Write-Host "1. Установка зависимостей..."
npm ci

Write-Host "2. Сборка веб-интерфейса (Vite)..."
npm run build

Write-Host "3. Установка Electron и electron-builder (если отсутствуют)..."
npm install --no-save electron@33.2.0 electron-builder@25.1.8

Write-Host "4. Компиляция Electron (main/preload/updater)..."
npx tsc -p tsconfig.electron.json
node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }))"

Write-Host "5. Сборка установщика Windows (.exe NSIS, Portable и ZIP)..."
npx electron-builder --win nsis portable zip --x64 --publish never

Write-Host "6. Генерация SHA-256 контрольных сумм..."
Get-FileHash release-dist\* -Algorithm SHA256 | Format-Table -AutoSize
Write-Host "Готово! Установщик находится в папке release-dist\"
