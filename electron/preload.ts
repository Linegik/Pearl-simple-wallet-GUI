import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pearlDesktop', {
  platform: process.platform,
  saveOsKeystore: (walletId: string, keystoreJson: string) =>
    ipcRenderer.invoke('vault:save-os-keystore', walletId, keystoreJson),
  readOsKeystore: (walletId: string) =>
    ipcRenderer.invoke('vault:read-os-keystore', walletId),
  checkGithubUpdate: (currentVersion: string, repoSlug?: string) =>
    ipcRenderer.invoke('updater:check-github', currentVersion, repoSlug),
  exportPsbt: (psbtJson: string, filename: string) =>
    ipcRenderer.invoke('dialog:export-psbt', psbtJson, filename),
});
