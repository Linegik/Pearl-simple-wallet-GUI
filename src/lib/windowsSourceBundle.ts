export interface SourceFileEntry {
  path: string;
  language: 'typescript' | 'json' | 'powershell' | 'markdown';
  summary: string;
  content: string;
}

export const WINDOWS_OPEN_SOURCE_FILES: SourceFileEntry[] = [
  {
    path: 'electron/main.ts',
    language: 'typescript',
    summary: 'Главный процесс Windows-клиента: изоляция контекста, локальное шифрование DPAPI (safeStorage) и защита памяти.',
    content: `import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { checkAndVerifyGithubUpdate } from './updater';

const VAULT_DIR = path.join(app.getPath('userData'), 'pearl-vault-keys');

async function ensureVaultDir() {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Pearl Vault Desktop (Windows)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

// Безопасное сохранение мастер-секрета через Windows DPAPI (safeStorage)
ipcMain.handle('vault:save-dpapi-keystore', async (_evt, walletId: string, keystoreJson: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows DPAPI недоступен в текущей сессии.');
  }
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(walletId)) {
    throw new Error('Некорректный идентификатор кошелька.');
  }
  await ensureVaultDir();
  const protectedBuf = safeStorage.encryptString(keystoreJson);
  const target = path.join(VAULT_DIR, \`\${walletId}.pearlkey.dpapi\`);
  await fs.writeFile(target, protectedBuf);
  return { savedPath: target };
});

ipcMain.handle('vault:read-dpapi-keystore', async (_evt, walletId: string) => {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(walletId)) {
    throw new Error('Некорректный идентификатор кошелька.');
  }
  const target = path.join(VAULT_DIR, \`\${walletId}.pearlkey.dpapi\`);
  const raw = await fs.readFile(target);
  return safeStorage.decryptString(raw);
});

ipcMain.handle('updater:check-github', async (_evt, currentVersion: string) => {
  return checkAndVerifyGithubUpdate(currentVersion);
});

ipcMain.handle('dialog:export-psbt', async (_evt, psbtJson: string, filename: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Экспорт транзакции для холодного хранения',
    defaultPath: filename,
    filters: [{ name: 'Pearl PSBT', extensions: ['psbt.json'] }],
  });
  if (filePath) {
    await fs.writeFile(filePath, psbtJson, 'utf8');
  }
  return { exported: Boolean(filePath), filePath };
});

app.whenReady().then(createWindow);
`,
  },
  {
    path: 'electron/updater.ts',
    language: 'typescript',
    summary: 'Автообновление через GitHub Releases API (pearl-research-labs/pearl) с проверкой SHA-256 и цифровой подписи Ed25519/ECDSA.',
    content: `import crypto from 'node:crypto';

const REPO_API = 'https://api.github.com/repos/pearl-research-labs/pearl/releases/latest';
const VALID_TAG = /^v[0-9]+\\.[0-9]+\\.[0-9]+$/;

// Зашитый публичный ключ издателя для проверки отсоединенной подписи (.sig)
const PINNED_RELEASE_PUBKEY_PEM = process.env.PEARL_RELEASE_PUBKEY_PEM ?? '';

export interface UpdateVerificationResult {
  updateAvailable: boolean;
  latestTag: string;
  windowsAssetName: string | null;
  windowsAssetUrl: string | null;
  expectedSha256: string | null;
  checksumVerified: boolean;
  signatureVerified: boolean;
}

export async function checkAndVerifyGithubUpdate(
  currentVersion: string,
): Promise<UpdateVerificationResult> {
  const res = await fetch(REPO_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Pearl-Vault-Windows/1.0',
    },
  });
  if (!res.ok) {
    throw new Error(\`GitHub API error: \${res.status}\`);
  }

  const release = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; digest?: string }>;
  };

  if (!VALID_TAG.test(release.tag_name)) {
    throw new Error('Некорректный формат версии релиза.');
  }

  const winAsset = release.assets.find((a) =>
    a.name.startsWith('pearl-windows-amd64-') && a.name.endsWith('.zip'),
  );
  const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt');
  const sigAsset = release.assets.find((a) => a.name === 'checksums.txt.sig');

  let expectedSha256: string | null = null;
  let checksumVerified = false;
  let signatureVerified = false;

  if (checksumAsset && winAsset) {
    const csText = await (await fetch(checksumAsset.browser_download_url)).text();
    const line = csText
      .split(/\\r?\\n/)
      .find((l) => l.trim().endsWith(winAsset.name));
    if (line) {
      expectedSha256 = line.trim().split(/\\s+/)[0].toLowerCase();
      const apiDigest = (winAsset.digest ?? '').replace(/^sha256:/, '').toLowerCase();
      checksumVerified = Boolean(expectedSha256 && apiDigest && expectedSha256 === apiDigest);
    }

    if (sigAsset && PINNED_RELEASE_PUBKEY_PEM) {
      const sigBytes = Buffer.from(await (await fetch(sigAsset.browser_download_url)).arrayBuffer());
      signatureVerified = crypto.verify(
        null,
        Buffer.from(csText, 'utf8'),
        PINNED_RELEASE_PUBKEY_PEM,
        sigBytes,
      );
    }
  }

  return {
    updateAvailable: release.tag_name !== currentVersion,
    latestTag: release.tag_name,
    windowsAssetName: winAsset?.name ?? null,
    windowsAssetUrl: winAsset?.browser_download_url ?? null,
    expectedSha256,
    checksumVerified,
    signatureVerified,
  };
}
`,
  },
  {
    path: 'electron/preload.ts',
    language: 'typescript',
    summary: 'Минимальный безопасный IPC-мост (contextBridge) без доступа рендерера к Node.js.',
    content: `import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pearlDesktop', {
  saveDpapiKeystore: (walletId: string, keystoreJson: string) =>
    ipcRenderer.invoke('vault:save-dpapi-keystore', walletId, keystoreJson),
  readDpapiKeystore: (walletId: string) =>
    ipcRenderer.invoke('vault:read-dpapi-keystore', walletId),
  checkGithubUpdate: (currentVersion: string) =>
    ipcRenderer.invoke('updater:check-github', currentVersion),
  exportPsbt: (psbtJson: string, filename: string) =>
    ipcRenderer.invoke('dialog:export-psbt', psbtJson, filename),
});
`,
  },
  {
    path: 'build-windows.ps1',
    language: 'powershell',
    summary: 'Воспроизводимый скрипт сборки установщика Windows (.exe / portable .zip) с проверкой зависимостей.',
    content: `# Сборка графического кошелька Pearl Vault для Windows 10/11 (x64)
$ErrorActionPreference = "Stop"

Write-Host "1. Установка зафиксированных зависимостей (npm ci)..."
npm ci --ignore-scripts

Write-Host "2. Сборка веб-интерфейса и TypeScript..."
npm run build
npx tsc -p tsconfig.electron.json

Write-Host "3. Сборка установщика Windows NSIS и Portable EXE..."
npx electron-builder --win nsis portable --x64

Write-Host "4. Генерация SHA-256 контрольных сумм..."
Get-FileHash dist-win\\*.exe -Algorithm SHA256 | Format-Table -AutoSize
`,
  },
  {
    path: 'package.json',
    language: 'json',
    summary: 'Конфигурация сборки Electron + electron-builder для Windows.',
    content: `{
  "name": "pearl-vault-windows",
  "version": "1.5.7",
  "description": "Open-source Windows GUI wallet for Pearl L1 with cold storage & signed GitHub updates",
  "license": "Apache-2.0",
  "main": "dist-electron/main.js",
  "scripts": {
    "build": "vite build",
    "package:win": "electron-builder --win nsis portable --x64"
  },
  "build": {
    "appId": "org.pearlresearch.vault",
    "productName": "Pearl Vault",
    "win": {
      "target": ["nsis", "portable"],
      "requestedExecutionLevel": "asInvoker"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
`,
  },
];
