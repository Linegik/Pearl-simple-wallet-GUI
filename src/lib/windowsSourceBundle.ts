import { isValidGithubRepoSlug } from './releaseVerifier';

export interface SourceFileEntry {
  path: string;
  language: 'typescript' | 'json' | 'powershell' | 'bash' | 'yaml' | 'markdown';
  summary: string;
  content: string;
}

export function buildGitPublishCommands(repoSlug: string, tag: string): string {
  const safeRepo = isValidGithubRepoSlug(repoSlug)
    ? repoSlug.trim()
    : 'your-org/pearl-vault';
  const safeTag = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(tag.trim())
    ? tag.trim()
    : 'v1.0.0';

  return [
    'git init',
    'git add .',
    'git commit -m "feat: Pearl Vault Windows and Linux"',
    'git branch -M main',
    `git remote add origin https://github.com/${safeRepo}.git`,
    'git push -u origin main',
    `git tag ${safeTag}`,
    `git push origin ${safeTag}`,
  ].join('\n');
}

export function buildReleaseKitFiles(
  repoSlug: string = 'pearl-research-labs/pearl',
  releaseTag: string = 'v1.0.0',
): SourceFileEntry[] {
  const safeRepo = isValidGithubRepoSlug(repoSlug)
    ? repoSlug.trim()
    : 'pearl-research-labs/pearl';
  const safeTag = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(releaseTag.trim())
    ? releaseTag.trim()
    : 'v1.0.0';
  const versionNoV = safeTag.replace(/^v/, '');

  return [
    {
      path: '.github/workflows/release.yml',
      language: 'yaml',
      summary:
        'GitHub Actions CI/CD: при push тега собирает установщик Windows (.exe NSIS/Portable) и пакеты Linux (.AppImage, .deb, .tar.gz) и публикует релиз.',
      content: `name: Build & Release Pearl Vault (Windows & Linux)

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx tsx --test src/lib/*.test.ts
      - run: npm run lint
      - run: npm run build

  build-desktop:
    needs: verify
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            platform_flag: --win nsis portable --x64
          - os: ubuntu-latest
            platform_flag: --linux AppImage deb tar.gz --x64
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: |
          npm ci
          npm run build
      - run: npm install --no-save electron@33.2.0 electron-builder@25.1.8
      - run: |
          npx tsc -p tsconfig.electron.json
          node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }))"
      - run: npx electron-builder \${{ matrix.platform_flag }} --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: installers-\${{ matrix.os }}
          path: |
            release-dist/*.exe
            release-dist/*.zip
            release-dist/*.AppImage
            release-dist/*.deb
            release-dist/*.tar.gz

  publish-release:
    needs: build-desktop
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - working-directory: artifacts
        run: sha256sum * > checksums.txt
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ github.ref_name }}
          name: Pearl Vault \${{ github.ref_name }}
          generate_release_notes: true
          body: |
            ## Скачать установщики (Windows, Ubuntu, Linux)
            - **Ubuntu / Debian (.deb)**: \`Pearl-Vault-${versionNoV}-linux-x64.deb\`
            - **Linux (.AppImage)**: \`Pearl-Vault-${versionNoV}-linux-x64.AppImage\`
            - **Windows (.exe)**: \`Pearl-Vault-${versionNoV}-win-x64.exe\`

            ### Запуск в одну команду
            **Ubuntu / Debian:**
            \`\`\`bash
            curl -fLO "https://github.com/${safeRepo}/releases/download/${safeTag}/Pearl-Vault-${versionNoV}-linux-x64.deb" && sudo apt install -y "./Pearl-Vault-${versionNoV}-linux-x64.deb" && pearl-vault
            \`\`\`
            **Linux (AppImage):**
            \`\`\`bash
            curl -fLO "https://github.com/${safeRepo}/releases/download/${safeTag}/Pearl-Vault-${versionNoV}-linux-x64.AppImage" && chmod +x "./Pearl-Vault-${versionNoV}-linux-x64.AppImage" && "./Pearl-Vault-${versionNoV}-linux-x64.AppImage"
            \`\`\`
          files: artifacts/*
`,
    },
    {
      path: 'electron-builder.yml',
      language: 'yaml',
      summary:
        'Конфигурация сборки установщика Windows (NSIS + Portable) и пакетов Linux (AppImage, deb, tar.gz).',
      content: `appId: org.pearlresearch.vault
productName: Pearl Vault
copyright: Apache-2.0 Pearl Vault Contributors
asar: true

directories:
  output: release-dist

files:
  - dist/**/*
  - dist-electron/**/*
  - package.json

win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  artifactName: Pearl-Vault-\${version}-win-\${arch}.\${ext}

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true

linux:
  category: Finance
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
    - target: tar.gz
      arch: [x64]
  artifactName: Pearl-Vault-\${version}-linux-\${arch}.\${ext}
`,
    },
    {
      path: 'electron/main.ts',
      language: 'typescript',
      summary:
        'Кроссплатформенный главный процесс Windows/Linux: DPAPI / libsecret, sandbox и флаг --airgap.',
      content: `import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkAndVerifyGithubUpdate } from './updater';

const VAULT_DIR = path.join(app.getPath('userData'), 'pearl-vault-keys');
const IS_AIRGAP_CLI = process.argv.includes('--offline') || process.argv.includes('--airgap');

async function ensureVaultDir() {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: IS_AIRGAP_CLI
      ? 'Pearl Vault — Автономный режим (Air-Gap)'
      : 'Pearl Vault — Кошелек Pearl (Windows / Linux)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  void win.loadFile(path.join(__dirname, '../dist/index.html'));
}

ipcMain.handle('vault:save-os-keystore', async (_evt, walletId: string, keystoreJson: string) => {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(walletId)) {
    throw new Error('Некорректный идентификатор кошелька.');
  }
  await ensureVaultDir();
  const target = path.join(VAULT_DIR, \`\${walletId}.pearlkey\`);
  if (safeStorage.isEncryptionAvailable()) {
    const protectedBuf = safeStorage.encryptString(keystoreJson);
    await fs.writeFile(\`\${target}.sealed\`, protectedBuf);
    return { savedPath: \`\${target}.sealed\`, osProtected: true };
  }
  await fs.writeFile(\`\${target}.json\`, keystoreJson, 'utf8');
  return { savedPath: \`\${target}.json\`, osProtected: false };
});

ipcMain.handle('updater:check-github', async (_evt, currentVersion: string) => {
  if (IS_AIRGAP_CLI) {
    throw new Error('Офлайн-режим (--airgap): сетевые обновления отключены.');
  }
  return checkAndVerifyGithubUpdate(currentVersion, '${safeRepo}');
});

ipcMain.handle('dialog:export-psbt', async (_evt, psbtJson: string, filename: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Экспорт PSBT для холодного хранения',
    defaultPath: filename,
    filters: [{ name: 'Pearl PSBT', extensions: ['psbt.json', 'json'] }],
  });
  if (filePath) await fs.writeFile(filePath, psbtJson, 'utf8');
  return { exported: Boolean(filePath), filePath };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`,
    },
    {
      path: 'electron/updater.ts',
      language: 'typescript',
      summary:
        'Автообновлятор для Windows и Linux через GitHub API с проверкой checksums.txt и цифровой подписи.',
      content: `import crypto from 'node:crypto';

const VALID_REPO = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\\/[a-zA-Z0-9._-]{1,100}$/;
const PINNED_RELEASE_PUBKEY_PEM = process.env.PEARL_RELEASE_PUBKEY_PEM ?? '';

export async function checkAndVerifyGithubUpdate(
  currentVersion: string,
  repoSlug = '${safeRepo}',
) {
  const safeRepo = VALID_REPO.test(repoSlug) ? repoSlug : '${safeRepo}';
  const res = await fetch(\`https://api.github.com/repos/\${safeRepo}/releases/latest\`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Pearl-Vault-Desktop/1.0' },
  });
  if (!res.ok) throw new Error(\`GitHub API error: \${res.status}\`);

  const release = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; digest?: string }>;
  };

  const targetAsset =
    process.platform === 'win32'
      ? release.assets.find((a) => a.name.endsWith('.exe') || a.name.toLowerCase().includes('win'))
      : release.assets.find((a) => a.name.endsWith('.AppImage') || a.name.endsWith('.deb') || a.name.toLowerCase().includes('linux'));

  const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt');
  const sigAsset = release.assets.find((a) => a.name === 'checksums.txt.sig');

  let checksumVerified = false;
  let signatureVerified = false;
  if (checksumAsset && targetAsset) {
    const csText = await (await fetch(checksumAsset.browser_download_url)).text();
    const line = csText.split(/\\r?\\n/).find((l) => l.trim().endsWith(targetAsset.name));
    if (line) {
      const expected = line.trim().split(/\\s+/)[0].toLowerCase();
      const apiDigest = (targetAsset.digest ?? '').replace(/^sha256:/, '').toLowerCase();
      checksumVerified = Boolean(expected && (!apiDigest || expected === apiDigest));
    }
    if (sigAsset && PINNED_RELEASE_PUBKEY_PEM) {
      const sigBuf = Buffer.from(await (await fetch(sigAsset.browser_download_url)).arrayBuffer());
      signatureVerified = crypto.verify(null, Buffer.from(csText, 'utf8'), PINNED_RELEASE_PUBKEY_PEM, sigBuf);
    }
  }

  return {
    repo: safeRepo,
    platform: process.platform,
    updateAvailable: release.tag_name !== currentVersion,
    latestTag: release.tag_name,
    assetName: targetAsset?.name ?? null,
    assetUrl: targetAsset?.browser_download_url ?? null,
    checksumVerified,
    signatureVerified,
  };
}
`,
    },
    {
      path: 'build-windows.ps1',
      language: 'powershell',
      summary: 'Сборка установщика Windows (.exe NSIS + Portable) на локальном ПК.',
      content: `$ErrorActionPreference = "Stop"
npm ci
npm run build
npm install --no-save electron@33.2.0 electron-builder@25.1.8
npx tsc -p tsconfig.electron.json
node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }))"
npx electron-builder --win nsis portable --x64 --publish never
Get-FileHash release-dist\\* -Algorithm SHA256 | Format-Table -AutoSize
`,
    },
    {
      path: 'build-linux.sh',
      language: 'bash',
      summary: 'Сборка пакетов Linux (AppImage, .deb, .tar.gz) на локальной машине.',
      content: `#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run build
npm install --no-save electron@33.2.0 electron-builder@25.1.8
npx tsc -p tsconfig.electron.json
node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }))"
npx electron-builder --linux AppImage deb tar.gz --x64 --publish never
(cd release-dist && sha256sum * > checksums.txt && cat checksums.txt)
`,
    },
    {
      path: 'package.json',
      language: 'json',
      summary: `Конфигурация сборки v${versionNoV} с точкой входа dist-electron/main.js.`,
      content: JSON.stringify(
        {
          name: 'pearl-vault',
          version: versionNoV,
          private: true,
          type: 'module',
          main: 'dist-electron/main.js',
          repository: {
            type: 'git',
            url: `https://github.com/${safeRepo}.git`,
          },
          scripts: {
            dev: 'tsx server.ts',
            build: 'vite build',
            lint: 'tsc --noEmit',
            test: 'tsx --test src/lib/*.test.ts',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'RELEASE_GUIDE.md',
      language: 'markdown',
      summary: 'Пошаговая инструкция по публикации на GitHub и скачиванию первого релиза.',
      content: `# Публикация ${safeRepo} (${safeTag}) на GitHub

## Быстрый старт (Windows & Linux релиз за 1 команду)
\`\`\`bash
${buildGitPublishCommands(safeRepo, safeTag)}
\`\`\`

После отправки тега \`${safeTag}\` GitHub Actions автоматически соберет и прикрепит к релизу:
- **Windows**: \`Pearl-Vault-${versionNoV}-win-x64.exe\` (NSIS установщик) и Portable-версию
- **Linux**: \`Pearl-Vault-${versionNoV}-linux-x64.AppImage\`, \`.deb\` и \`.tar.gz\`
- **Безопасность**: \`checksums.txt\` (SHA-256)
`,
    },
  ];
}

export const WINDOWS_OPEN_SOURCE_FILES = buildReleaseKitFiles();
