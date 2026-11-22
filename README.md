# Pearl Vault - Публикация на GitHub и первый релиз (Windows & Linux)

## 1. Инициализация и выгрузка на GitHub
```bash
git init
git add .
git commit -m "feat: Pearl Vault desktop wallet for Windows and Linux"
git branch -M main
git remote add origin https://github.com/<ВАШ_ЛОГИН>/pearl-vault.git
git push -u origin main
```

## 2. Создание первого релиза (автоматическая сборка .exe, .AppImage, .deb)
```bash
git tag v1.0.0
git push origin v1.0.0
```

После отправки тега `v1.0.0` GitHub Actions (`.github/workflows/release.yml`) автоматически:
1. Прогонит модульные тесты и проверку типов (`npm run lint`).
2. Соберет установщик **Windows**: `Pearl-Vault-1.0.0-win-x64.exe` (NSIS), portable `.exe` и `.zip`.
3. Соберет пакеты **Linux**: `Pearl-Vault-1.0.0-linux-x64.AppImage`, `.deb` и `.tar.gz`.
4. Создаст `checksums.txt` (SHA-256) и (при наличии секрета `RELEASE_SIGNING_PRIVATE_KEY`) цифровую подпись `checksums.txt.sig`.
5. Опубликует готовые файлы в разделе **Releases** вашего репозитория GitHub.

## 3. Локальная сборка без GitHub Actions
- **Windows (PowerShell)**: `./build-windows.ps1`
- **Linux (Bash)**: `chmod +x build-linux.sh && ./build-linux.sh`
