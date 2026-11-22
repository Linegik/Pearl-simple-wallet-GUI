import { useCallback, useEffect, useState } from 'react';
import { EncryptedKeystoreV2, SecretWalletPayload, WalletRecord, WalletTransaction } from './lib/cryptoVault';
import { PEARL_NETWORKS, PearlNetworkId } from './lib/pearlProtocol';
import { GitHubRelease, isUpdateAvailable } from './lib/releaseVerifier';
import {
  loadVaultFromStorage,
  saveUpdaterSettings,
  saveVaultToStorage,
  UpdaterSettings,
} from './lib/vaultStorage';
import { ColdStorageView } from './components/ColdStorageView';
import { CreateWalletModal } from './components/CreateWalletModal';
import { OverviewView } from './components/OverviewView';
import { SecurityVaultView } from './components/SecurityVaultView';
import { SidebarNav, WorkspaceTab } from './components/SidebarNav';
import { UpdaterView } from './components/UpdaterView';
import { WindowsSourceView } from './components/WindowsSourceView';

export default function App() {
  const [initial] = useState(() => loadVaultFromStorage());
  const [wallets, setWallets] = useState<WalletRecord[]>(initial.wallets);
  const [transactions, setTransactions] = useState<WalletTransaction[]>(initial.transactions);
  const [settings, setSettings] = useState<UpdaterSettings>(initial.settings);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [activeNetwork, setActiveNetwork] = useState<PearlNetworkId>('testnet');
  const [activeWalletId, setActiveWalletId] = useState<string>(() => {
    const testW = initial.wallets.find((w) => w.network === 'testnet');
    return testW?.id ?? initial.wallets[0]?.id ?? '';
  });

  // Decrypted keys live ONLY in RAM and are never persisted in plaintext
  const [unlockedSecrets, setUnlockedSecrets] = useState<Record<string, SecretWalletPayload>>({});

  // Create Wallet Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPresetNet, setCreatePresetNet] = useState<PearlNetworkId>('testnet');

  // GitHub Releases Auto-Update State
  const [activeRepo, setActiveRepo] = useState('pearl-research-labs/pearl');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [releaseSource, setReleaseSource] = useState<'github_live' | 'cached_snapshot' | 'idle'>(
    'idle',
  );
  const [isCheckingReleases, setIsCheckingReleases] = useState(false);

  const checkReleases = useCallback(async (force = false, targetRepo?: string) => {
    const repoToUse = targetRepo ?? activeRepo;
    setIsCheckingReleases(true);
    setRepoError(null);
    try {
      const res = await fetch(
        `/api/releases?repo=${encodeURIComponent(repoToUse)}${force ? '&refresh=1' : ''}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          repo: string;
          source: 'github_live' | 'cached_snapshot';
          fetchedAt: string;
          releases: GitHubRelease[];
        };
        setActiveRepo(data.repo);
        setReleases(data.releases);
        setReleaseSource(data.source);
        setSettings((prev) => {
          const next = { ...prev, lastCheckedAt: data.fetchedAt };
          saveUpdaterSettings(next);
          return next;
        });
      } else {
        const errData = (await res.json()) as { error?: string };
        setRepoError(errData.error ?? 'Ошибка получения релизов из GitHub API.');
      }
    } catch {
      setRepoError('Не удалось подключиться к GitHub API.');
    } finally {
      setIsCheckingReleases(false);
    }
  }, [activeRepo]);

  useEffect(() => {
    if (settings.autoCheckEnabled) {
      checkReleases(false);
    }
  }, [settings.autoCheckEnabled, checkReleases]);

  const handleSelectNetwork = (net: PearlNetworkId) => {
    setActiveNetwork(net);
    const firstInNet = wallets.find((w) => w.network === net);
    if (firstInNet) {
      setActiveWalletId(firstInNet.id);
    }
  };

  const handleOpenCreateModal = (preset?: PearlNetworkId) => {
    setCreatePresetNet(preset ?? activeNetwork);
    setIsCreateOpen(true);
  };

  const handleWalletCreated = (wallet: WalletRecord, secret?: SecretWalletPayload) => {
    const nextWallets = [wallet, ...wallets];
    setWallets(nextWallets);
    saveVaultToStorage(nextWallets, transactions);

    if (secret) {
      setUnlockedSecrets((prev) => ({ ...prev, [wallet.id]: secret }));
    }
    setActiveNetwork(wallet.network);
    setActiveWalletId(wallet.id);
  };

  const handleFaucetClaim = (walletId: string) => {
    const target = wallets.find((w) => w.id === walletId);
    if (!target || !PEARL_NETWORKS[target.network].faucetEnabled) return;

    const faucetTx: WalletTransaction = {
      id: `faucet-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      walletId: target.id,
      network: target.network,
      direction: 'in',
      counterparty: `Faucet (${PEARL_NETWORKS[target.network].shortLabel} :${PEARL_NETWORKS[target.network].nodePort})`,
      amount: 250,
      fee: 0,
      timestamp: new Date().toISOString(),
      status: 'confirmed',
      signingMethod: 'faucet',
    };

    const nextWallets = wallets.map((w) =>
      w.id === walletId ? { ...w, balance: Number((w.balance + 250).toFixed(8)) } : w,
    );
    const nextTxs = [faucetTx, ...transactions];
    setWallets(nextWallets);
    setTransactions(nextTxs);
    saveVaultToStorage(nextWallets, nextTxs);
  };

  const handleTxConfirmed = (tx: WalletTransaction, newBalance: number, newNonce: number) => {
    const nextWallets = wallets.map((w) =>
      w.id === tx.walletId
        ? { ...w, balance: newBalance, nonce: newNonce, xmssNextLeaf: w.xmssNextLeaf + 1 }
        : w,
    );
    const nextTxs = [tx, ...transactions];
    setWallets(nextWallets);
    setTransactions(nextTxs);
    saveVaultToStorage(nextWallets, nextTxs);
  };

  const handleImportKeystore = (keystore: EncryptedKeystoreV2) => {
    const exists = wallets.some((w) => w.address.toLowerCase() === keystore.address.toLowerCase());
    if (exists) return;
    const imported: WalletRecord = {
      id: keystore.walletId || `imp-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      label: keystore.label || 'Импортированный кошелек',
      network: keystore.network,
      mode: keystore.mode,
      address: keystore.address,
      balance: keystore.network === 'testnet' ? 100 : 0,
      nonce: 0,
      xmssNextLeaf: 0,
      createdAt: keystore.createdAt,
      keystore,
    };
    const nextWallets = [imported, ...wallets];
    setWallets(nextWallets);
    saveVaultToStorage(nextWallets, transactions);
    setActiveNetwork(imported.network);
    setActiveWalletId(imported.id);
  };

  const activeWallet =
    wallets.find((w) => w.id === activeWalletId && w.network === activeNetwork) ??
    wallets.find((w) => w.network === activeNetwork) ??
    null;

  const latestStable = releases.find((r) => settings.includePrerelease || !r.prerelease);
  const updateAvailableTag =
    latestStable && isUpdateAvailable(settings.installedVersion, latestStable.tag_name)
      ? latestStable.tag_name
      : null;

  const totalEncryptedCount = wallets.filter((w) => w.mode === 'standard').length;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 lg:flex-row">
      <SidebarNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeNetwork={activeNetwork}
        onSelectNetwork={handleSelectNetwork}
        unlockedCount={Object.keys(unlockedSecrets).length}
        totalEncryptedCount={totalEncryptedCount}
        onLockAll={() => setUnlockedSecrets({})}
        updateAvailableTag={updateAvailableTag}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3.5">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">Pearl Vault</span>
            <span aria-hidden="true">/</span>
            <span>{PEARL_NETWORKS[activeNetwork].shortLabel}</span>
            <span aria-hidden="true">/</span>
            <span className="font-mono tabular-nums">
              {activeWallet ? `${activeWallet.address.slice(0, 14)}…` : 'Нет активного кошелька'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {updateAvailableTag ? (
              <button
                type="button"
                onClick={() => setActiveTab('updater')}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                Обновление {updateAvailableTag}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => handleOpenCreateModal('testnet')}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Создать тестовый кошелек
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          {activeTab === 'overview' ? (
            <OverviewView
              activeNetwork={activeNetwork}
              wallets={wallets}
              activeWallet={activeWallet}
              onSelectWallet={setActiveWalletId}
              unlockedSecrets={unlockedSecrets}
              onUnlockWallet={(id, secret) =>
                setUnlockedSecrets((prev) => ({ ...prev, [id]: secret }))
              }
              transactions={transactions}
              onOpenCreateModal={handleOpenCreateModal}
              onFaucetClaim={handleFaucetClaim}
              onSendConfirmed={handleTxConfirmed}
              onNavigateColdStorage={() => setActiveTab('cold-storage')}
            />
          ) : null}

          {activeTab === 'cold-storage' ? (
            <ColdStorageView
              activeNetwork={activeNetwork}
              wallets={wallets}
              activeWallet={activeWallet}
              unlockedSecrets={unlockedSecrets}
              onUnlockWallet={(id, secret) =>
                setUnlockedSecrets((prev) => ({ ...prev, [id]: secret }))
              }
              onColdBroadcastConfirmed={handleTxConfirmed}
            />
          ) : null}

          {activeTab === 'security' ? (
            <SecurityVaultView
              wallets={wallets}
              unlockedSecrets={unlockedSecrets}
              onUnlockWallet={(id, secret) =>
                setUnlockedSecrets((prev) => ({ ...prev, [id]: secret }))
              }
              onLockWallet={(id) =>
                setUnlockedSecrets((prev) => {
                  const next = { ...prev };
                  delete next[id];
                  return next;
                })
              }
              onImportKeystore={handleImportKeystore}
            />
          ) : null}

          {activeTab === 'updater' ? (
            <UpdaterView
              settings={settings}
              onUpdateSettings={(next) => {
                setSettings(next);
                saveUpdaterSettings(next);
              }}
              releases={releases}
              releaseSource={releaseSource}
              activeRepo={activeRepo}
              repoError={repoError}
              isChecking={isCheckingReleases}
              onCheckReleases={checkReleases}
            />
          ) : null}

          {activeTab === 'source' ? <WindowsSourceView /> : null}
        </main>
      </div>

      {isCreateOpen ? (
        <CreateWalletModal
          isOpen={isCreateOpen}
          defaultNetwork={createPresetNet}
          onClose={() => setIsCreateOpen(false)}
          onWalletCreated={handleWalletCreated}
        />
      ) : null}
    </div>
  );
}
