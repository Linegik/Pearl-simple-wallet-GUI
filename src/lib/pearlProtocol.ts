export type PearlNetworkId = 'mainnet' | 'testnet' | 'regtest';

export interface PearlNetworkConfig {
  id: PearlNetworkId;
  label: string;
  shortLabel: string;
  ticker: string;
  hrp: 'prl' | 'tprl' | 'rprl';
  samplePrefix: string;
  nodePort: number;
  oysterPort: number;
  faucetEnabled: boolean;
  description: string;
}

export const PEARL_NETWORKS: Record<PearlNetworkId, PearlNetworkConfig> = {
  mainnet: {
    id: 'mainnet',
    label: 'Основная сеть (Mainnet)',
    shortLabel: 'Mainnet',
    ticker: 'PRL',
    hrp: 'prl',
    samplePrefix: 'prl1p',
    nodePort: 44107,
    oysterPort: 44207,
    faucetEnabled: false,
    description: 'Рабочая сеть Pearl L1 с префиксом prl1p (Taproot + XMSS).',
  },
  testnet: {
    id: 'testnet',
    label: 'Тестовая сеть (Testnet)',
    shortLabel: 'Testnet',
    ticker: 'tPRL',
    hrp: 'tprl',
    samplePrefix: 'tprl1p',
    nodePort: 44110,
    oysterPort: 44210,
    faucetEnabled: true,
    description: 'Песочница с тестовыми монетами tPRL и строгой защитой от смешивания с Mainnet.',
  },
  regtest: {
    id: 'regtest',
    label: 'Локальная сеть (Regtest)',
    shortLabel: 'Regtest',
    ticker: 'rPRL',
    hrp: 'rprl',
    samplePrefix: 'rprl1p',
    nodePort: 44112,
    oysterPort: 44212,
    faucetEnabled: true,
    description: 'Локальная отладочная сеть для автономного узла pearld и разработки.',
  },
};

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

export function encodePearlAddress(network: PearlNetworkId, pubkeyHash32: Uint8Array): string {
  const hrp = PEARL_NETWORKS[network].hrp;
  const program = pubkeyHash32.slice(0, 32);
  // Witness version 1 (Taproot 'p') + 32-byte key hash
  const data = [1, ...convertBits(program, 8, 5, true)];
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ BECH32M_CONST;
  const checksum: number[] = [];
  for (let p = 0; p < 6; p++) {
    checksum.push((mod >> (5 * (5 - p))) & 31);
  }
  const combined = [...data, ...checksum];
  return `${hrp}1${combined.map((c) => BECH32_CHARSET[c]).join('')}`;
}

export interface AddressValidationResult {
  valid: boolean;
  network?: PearlNetworkId;
  reason?: string;
}

export function validatePearlAddress(
  address: string,
  expectedNetwork?: PearlNetworkId,
): AddressValidationResult {
  const normalized = address.trim().toLowerCase();
  if (!normalized || normalized.length < 20) {
    return { valid: false, reason: 'Адрес слишком короткий.' };
  }

  const sepIdx = normalized.lastIndexOf('1');
  if (sepIdx < 1 || sepIdx + 7 > normalized.length) {
    return { valid: false, reason: 'Отсутствует разделитель Bech32m (1).' };
  }

  const hrp = normalized.slice(0, sepIdx);
  const dataPart = normalized.slice(sepIdx + 1);

  const matchedNetwork = (Object.keys(PEARL_NETWORKS) as PearlNetworkId[]).find(
    (id) => PEARL_NETWORKS[id].hrp === hrp,
  );

  if (!matchedNetwork) {
    return {
      valid: false,
      reason: `Неизвестный префикс сети "${hrp}". Ожидается prl, tprl или rprl.`,
    };
  }

  const decoded: number[] = [];
  for (const ch of dataPart) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx === -1) {
      return { valid: false, reason: `Недопустимый символ "${ch}" в адресе Bech32m.` };
    }
    decoded.push(idx);
  }

  if (bech32Polymod([...bech32HrpExpand(hrp), ...decoded]) !== BECH32M_CONST) {
    return { valid: false, reason: 'Контрольная сумма Bech32m не совпадает.' };
  }

  if (decoded[0] !== 1) {
    return { valid: false, reason: 'Поддерживается только формат Taproot (версия 1, префикс 1p).' };
  }

  if (expectedNetwork && matchedNetwork !== expectedNetwork) {
    return {
      valid: false,
      network: matchedNetwork,
      reason: `Несовпадение сети: адрес принадлежит ${PEARL_NETWORKS[matchedNetwork].shortLabel}, а активна сеть ${PEARL_NETWORKS[expectedNetwork].shortLabel}.`,
    };
  }

  return { valid: true, network: matchedNetwork };
}

// 256 deterministic cryptographic mnemonic words (1 word = 8 bits entropy)
const WORDLIST_256 = [
  'anchor', 'arctic', 'armor', 'aspect', 'atlas', 'atom', 'aurora', 'axiom',
  'badge', 'balcony', 'bamboo', 'banner', 'basalt', 'beacon', 'breeze', 'bridge',
  'bronze', 'bucket', 'canyon', 'carbon', 'cascade', 'castle', 'cedar', 'celestial',
  'cipher', 'circuit', 'citadel', 'clarity', 'cliff', 'cobalt', 'comet', 'compass',
  'copper', 'coral', 'cosmos', 'crater', 'crest', 'crimson', 'crystal', 'current',
  'cypress', 'dagger', 'dawn', 'delta', 'desert', 'diamond', 'digit', 'domain',
  'dragon', 'drift', 'dune', 'dynamo', 'eagle', 'echo', 'eclipse', 'elder',
  'ember', 'emerald', 'empire', 'enigma', 'epoch', 'equinox', 'ether', 'falcon',
  'fathom', 'ferry', 'fiber', 'field', 'fjord', 'flame', 'flint', 'flora',
  'focus', 'forge', 'fortress', 'fossil', 'fountain', 'frost', 'fusion', 'galaxy',
  'garden', 'garnet', 'gateway', 'geyser', 'glacier', 'glider', 'granite', 'gravity',
  'grid', 'griffin', 'grove', 'guardian', 'harbor', 'harvest', 'haven', 'hawk',
  'hearth', 'helium', 'horizon', 'hunter', 'hybrid', 'iceberg', 'ignite', 'impulse',
  'index', 'indigo', 'inertia', 'inlet', 'insight', 'ion', 'iron', 'island',
  'ivory', 'jade', 'jaguar', 'jasper', 'javelin', 'jet', 'journal', 'jupiter',
  'keel', 'kernel', 'key', 'kinetic', 'knight', 'krypton', 'lagoon', 'lantern',
  'laser', 'lattice', 'launch', 'laurel', 'lava', 'ledger', 'legacy', 'legend',
  'lens', 'liberty', 'beacon2', 'linen', 'link', 'lion', 'lithium', 'lock',
  'lodge', 'logic', 'lotus', 'lumen', 'lunar', 'lynx', 'magnet', 'mammoth',
  'mantle', 'maple', 'marble', 'marine', 'matrix', 'meadow', 'mercury', 'meridian',
  'meteor', 'method', 'mirror', 'mist', 'module', 'monarch', 'monolith', 'monsoon',
  'moon', 'mosaic', 'motion', 'mount', 'nebula', 'nectar', 'needle', 'neptune',
  'nexus', 'nickel', 'nimbus', 'nitrogen', 'node', 'nomad', 'north', 'nova',
  'nucleus', 'oak', 'oasis', 'obelisk', 'obsidian', 'ocean', 'octave', 'omega',
  'onyx', 'opal', 'optics', 'oracle', 'orbit', 'orchid', 'origin', 'osprey',
  'otter', 'outpost', 'oxygen', 'oyster', 'pacific', 'paddle', 'palace', 'palm',
  'panther', 'paradox', 'parcel', 'parity', 'pearl', 'pebble', 'pendulum', 'penguin',
  'pepper', 'phantom', 'phoenix', 'photon', 'pioneer', 'pixel', 'planet', 'plasma',
  'plateau', 'platinum', 'plaza', 'pledge', 'polar', 'polygon', 'portal', 'prism',
  'probe', 'profile', 'proton', 'pulse', 'pyramid', 'quantum', 'quartz', 'quasar',
  'quest', 'quill', 'radar', 'radium', 'radius', 'rain', 'ranger', 'rapid',
  'raven', 'reactor', 'realm', 'reef', 'relay', 'relic', 'ridge', 'ripple',
];

export async function generateMnemonic24(): Promise<string[]> {
  const entropy = new Uint8Array(23);
  globalThis.crypto.getRandomValues(entropy);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', entropy));
  const full = new Uint8Array(24);
  full.set(entropy, 0);
  full[23] = digest[0];
  return Array.from(full, (b) => WORDLIST_256[b]);
}

export async function validateMnemonic24(words: string[]): Promise<boolean> {
  if (words.length !== 24) return false;
  const indices = words.map((w) => WORDLIST_256.indexOf(w.trim().toLowerCase()));
  if (indices.some((i) => i < 0)) return false;
  const entropy = new Uint8Array(indices.slice(0, 23));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', entropy));
  return digest[0] === indices[23];
}

export interface UnsignedPearlTx {
  version: 'PRL-PSBT-1';
  txId: string;
  network: PearlNetworkId;
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number;
  nonce: number;
  createdAt: string;
  xmssLeafIndex: number;
  memo?: string;
}

export interface SignedPearlTx {
  unsigned: UnsignedPearlTx;
  signerPublicKeyJwk: JsonWebKey;
  signatureBase64: string;
  algorithm: 'ECDSA-P256-SHA256';
  signedAt: string;
}

export function canonicalTxMessage(tx: UnsignedPearlTx): string {
  return [
    tx.version,
    tx.txId,
    tx.network,
    tx.fromAddress.toLowerCase(),
    tx.toAddress.toLowerCase(),
    tx.amount.toFixed(8),
    tx.fee.toFixed(8),
    String(tx.nonce),
    tx.createdAt,
    String(tx.xmssLeafIndex),
    tx.memo ?? '',
  ].join('|');
}

export function validateTxDraft(params: {
  network: PearlNetworkId;
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number;
  availableBalance: number;
}): { ok: boolean; error?: string } {
  const { network, fromAddress, toAddress, amount, fee, availableBalance } = params;
  const fromCheck = validatePearlAddress(fromAddress, network);
  if (!fromCheck.valid) {
    return { ok: false, error: `Адрес отправителя некорректен: ${fromCheck.reason}` };
  }
  const toCheck = validatePearlAddress(toAddress, network);
  if (!toCheck.valid) {
    return { ok: false, error: toCheck.reason ?? 'Некорректный адрес получателя.' };
  }
  if (fromAddress.trim().toLowerCase() === toAddress.trim().toLowerCase()) {
    return { ok: false, error: 'Адрес получателя совпадает с адресом отправителя.' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Сумма перевода должна быть больше 0.' };
  }
  if (!Number.isFinite(fee) || fee < 0.0001) {
    return { ok: false, error: 'Минимальная комиссия сети — 0.0001 PRL.' };
  }
  if (amount + fee > availableBalance) {
    return {
      ok: false,
      error: `Недостаточно средств: требуется ${(amount + fee).toFixed(4)}, доступно ${availableBalance.toFixed(4)}.`,
    };
  }
  return { ok: true };
}
