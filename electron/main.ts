import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
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

// Локальное шифрование через Windows DPAPI или Linux libsecret/kwallet
ipcMain.handle('vault:save-os-keystore', async (_evt, walletId: string, keystoreJson: string) => {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(walletId)) {
    throw new Error('Некорректный идентификатор кошелька.');
  }
  await ensureVaultDir();
  const target = path.join(VAULT_DIR, `${walletId}.pearlkey`);
  if (safeStorage.isEncryptionAvailable()) {
    const protectedBuf = safeStorage.encryptString(keystoreJson);
    await fs.writeFile(`${target}.sealed`, protectedBuf);
    return { savedPath: `${target}.sealed`, osProtected: true };
  }
  // Файл уже зашифрован AES-256-GCM + PBKDF2 на уровне приложения
  await fs.writeFile(`${target}.json`, keystoreJson, 'utf8');
  return { savedPath: `${target}.json`, osProtected: false };
});

ipcMain.handle('vault:read-os-keystore', async (_evt, walletId: string) => {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(walletId)) {
    throw new Error('Некорректный идентификатор кошелька.');
  }
  const sealedPath = path.join(VAULT_DIR, `${walletId}.pearlkey.sealed`);
  try {
    const raw = await fs.readFile(sealedPath);
    return safeStorage.decryptString(raw);
  } catch {
    const jsonPath = path.join(VAULT_DIR, `${walletId}.pearlkey.json`);
    return fs.readFile(jsonPath, 'utf8');
  }
});

ipcMain.handle('updater:check-github', async (_evt, currentVersion: string, repoSlug?: string) => {
  if (IS_AIRGAP_CLI) {
    throw new Error('Приложение запущено в автономном офлайн-режиме (--airgap).');
  }
  return checkAndVerifyGithubUpdate(currentVersion, repoSlug);
});

ipcMain.handle('dialog:export-psbt', async (_evt, psbtJson: string, filename: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Экспорт транзакции для холодного хранения',
    defaultPath: filename,
    filters: [{ name: 'Pearl PSBT', extensions: ['psbt.json', 'json'] }],
  });
  if (filePath) {
    await fs.writeFile(filePath, psbtJson, 'utf8');
  }
  return { exported: Boolean(filePath), filePath };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
