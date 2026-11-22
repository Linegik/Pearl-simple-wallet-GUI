import { EncryptedKeystoreV2, WalletRecord, WalletTransaction } from './cryptoVault';
import { encodePearlAddress, PearlNetworkId } from './pearlProtocol';

const STORAGE_KEY_WALLETS = 'pearl_vault_wallets_v1';
const STORAGE_KEY_TXS = 'pearl_vault_transactions_v1';
const STORAGE_KEY_SETTINGS = 'pearl_vault_settings_v1';

export interface UpdaterSettings {
  autoCheckEnabled: boolean;
  includePrerelease: boolean;
  requireSignature: boolean;
  installedVersion: string;
  lastCheckedAt: string | null;
}

export const DEFAULT_UPDATER_SETTINGS: UpdaterSettings = {
  autoCheckEnabled: true,
  includePrerelease: false,
  requireSignature: true,
  installedVersion: 'v1.5.5',
  lastCheckedAt: null,
};

function makeSeededWallet(
  id: string,
  label: string,
  network: PearlNetworkId,
  seedByte: number,
  balance: number,
): WalletRecord {
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hash[i] = (seedByte * 31 + i * 17) & 0xff;
  }
  const address = encodePearlAddress(network, hash);
  const createdAt = '2026-11-10T10:15:00.000Z';
  const publicKeyJwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
    y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
    ext: true,
  };
  const keystore: EncryptedKeystoreV2 = {
    format: 'pearl-keystore-v2',
    walletId: id,
    label,
    network,
    mode: 'cold-watch',
    address,
    xmssScheme: 'XMSS-SHA2_16_256',
    publicKeyJwk,
    createdAt,
    kdf: {
      name: 'PBKDF2-HMAC-SHA256',
      iterations: 600_000,
      saltBase64: '',
    },
    cipher: null,
  };

  return {
    id,
    label,
    network,
    mode: 'cold-watch',
    address,
    balance,
    nonce: 2,
    xmssNextLeaf: 2,
    createdAt,
    keystore,
  };
}

export function getInitialSeedData(): {
  wallets: WalletRecord[];
  transactions: WalletTransaction[];
} {
  const mainnetCold = makeSeededWallet(
    'cold-main-01',
    'Холодное хранилище (Только просмотр)',
    'mainnet',
    19,
    1250.5,
  );
  const testnetWatch = makeSeededWallet(
    'cold-test-01',
    'Демо-счет Testnet (Только просмотр)',
    'testnet',
    73,
    420.0,
  );

  const transactions: WalletTransaction[] = [
    {
      id: 'tx-prl-91a8c4',
      walletId: mainnetCold.id,
      network: 'mainnet',
      direction: 'in',
      counterparty: encodePearlAddress('mainnet', new Uint8Array(32).fill(41)),
      amount: 1250.5,
      fee: 0.001,
      timestamp: '2026-11-18T14:22:10.000Z',
      status: 'confirmed',
      signingMethod: 'cold-airgap',
    },
    {
      id: 'tx-tprl-44f21b',
      walletId: testnetWatch.id,
      network: 'testnet',
      direction: 'in',
      counterparty: 'Testnet Faucet (pearld :44110)',
      amount: 500.0,
      fee: 0,
      timestamp: '2026-11-19T09:10:00.000Z',
      status: 'confirmed',
      signingMethod: 'faucet',
    },
    {
      id: 'tx-tprl-88c019',
      walletId: testnetWatch.id,
      network: 'testnet',
      direction: 'out',
      counterparty: encodePearlAddress('testnet', new Uint8Array(32).fill(55)),
      amount: 80.0,
      fee: 0.001,
      timestamp: '2026-11-20T16:40:00.000Z',
      status: 'confirmed',
      signingMethod: 'cold-airgap',
    },
  ];

  return { wallets: [mainnetCold, testnetWatch], transactions };
}

export function loadVaultFromStorage(): {
  wallets: WalletRecord[];
  transactions: WalletTransaction[];
  settings: UpdaterSettings;
} {
  try {
    const rawWallets = localStorage.getItem(STORAGE_KEY_WALLETS);
    const rawTxs = localStorage.getItem(STORAGE_KEY_TXS);
    const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);

    if (!rawWallets) {
      const seeded = getInitialSeedData();
      saveVaultToStorage(seeded.wallets, seeded.transactions);
      return {
        wallets: seeded.wallets,
        transactions: seeded.transactions,
        settings: rawSettings
          ? { ...DEFAULT_UPDATER_SETTINGS, ...JSON.parse(rawSettings) }
          : DEFAULT_UPDATER_SETTINGS,
      };
    }

    return {
      wallets: JSON.parse(rawWallets) as WalletRecord[],
      transactions: rawTxs ? (JSON.parse(rawTxs) as WalletTransaction[]) : [],
      settings: rawSettings
        ? { ...DEFAULT_UPDATER_SETTINGS, ...JSON.parse(rawSettings) }
        : DEFAULT_UPDATER_SETTINGS,
    };
  } catch {
    const seeded = getInitialSeedData();
    return {
      wallets: seeded.wallets,
      transactions: seeded.transactions,
      settings: DEFAULT_UPDATER_SETTINGS,
    };
  }
}

export function saveVaultToStorage(
  wallets: WalletRecord[],
  transactions: WalletTransaction[],
): void {
  try {
    localStorage.setItem(STORAGE_KEY_WALLETS, JSON.stringify(wallets));
    localStorage.setItem(STORAGE_KEY_TXS, JSON.stringify(transactions));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function saveUpdaterSettings(settings: UpdaterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors cleanly
  }
}
