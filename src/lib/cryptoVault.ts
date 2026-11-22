import {
  encodePearlAddress,
  generateMnemonic24,
  PearlNetworkId,
  SignedPearlTx,
  UnsignedPearlTx,
  canonicalTxMessage,
} from './pearlProtocol';

export interface EncryptedKeystoreV2 {
  format: 'pearl-keystore-v2';
  walletId: string;
  label: string;
  network: PearlNetworkId;
  mode: 'standard' | 'cold-watch';
  address: string;
  xmssScheme: 'XMSS-SHA2_16_256';
  publicKeyJwk: JsonWebKey;
  createdAt: string;
  kdf: {
    name: 'PBKDF2-HMAC-SHA256';
    iterations: number;
    saltBase64: string;
  };
  cipher: {
    name: 'AES-256-GCM';
    ivBase64: string;
    ciphertextBase64: string;
  } | null; // null only for watch-only cold storage (contains no private key)
}

export interface SecretWalletPayload {
  privateKeyJwk: JsonWebKey;
  mnemonic: string[];
  xmssNextLeaf: number;
}

export interface WalletRecord {
  id: string;
  label: string;
  network: PearlNetworkId;
  mode: 'standard' | 'cold-watch';
  address: string;
  balance: number;
  nonce: number;
  xmssNextLeaf: number;
  createdAt: string;
  keystore: EncryptedKeystoreV2;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  network: PearlNetworkId;
  direction: 'in' | 'out';
  counterparty: string;
  amount: number;
  fee: number;
  timestamp: string;
  status: 'confirmed' | 'pending';
  signingMethod: 'hot-local' | 'cold-airgap' | 'faucet';
  signatureHex?: string;
}

const PBKDF2_ITERATIONS = 600_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generatePearlKeyPair(network: PearlNetworkId): Promise<{
  address: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  mnemonic: string[];
}> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const pubBytes = new TextEncoder().encode(
    `${publicKeyJwk.kty}:${publicKeyJwk.crv}:${publicKeyJwk.x}:${publicKeyJwk.y}`,
  );
  const pubHash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', pubBytes));
  const address = encodePearlAddress(network, pubHash);
  const mnemonic = await generateMnemonic24();

  return { address, publicKeyJwk, privateKeyJwk, mnemonic };
}

export async function createEncryptedWallet(params: {
  label: string;
  network: PearlNetworkId;
  password: string;
  initialBalance?: number;
}): Promise<{ wallet: WalletRecord; secret: SecretWalletPayload }> {
  const { label, network, password, initialBalance = 0 } = params;
  const walletId = `prl-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  const { address, publicKeyJwk, privateKeyJwk, mnemonic } = await generatePearlKeyPair(network);
  const secret: SecretWalletPayload = {
    privateKeyJwk,
    mnemonic,
    xmssNextLeaf: 0,
  };

  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const aesKey = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const encodedSecret = new TextEncoder().encode(JSON.stringify(secret));
  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    encodedSecret,
  );

  const keystore: EncryptedKeystoreV2 = {
    format: 'pearl-keystore-v2',
    walletId,
    label,
    network,
    mode: 'standard',
    address,
    xmssScheme: 'XMSS-SHA2_16_256',
    publicKeyJwk,
    createdAt,
    kdf: {
      name: 'PBKDF2-HMAC-SHA256',
      iterations: PBKDF2_ITERATIONS,
      saltBase64: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-256-GCM',
      ivBase64: bytesToBase64(iv),
      ciphertextBase64: bytesToBase64(new Uint8Array(encryptedBuf)),
    },
  };

  return {
    wallet: {
      id: walletId,
      label,
      network,
      mode: 'standard',
      address,
      balance: initialBalance,
      nonce: 0,
      xmssNextLeaf: 0,
      createdAt,
      keystore,
    },
    secret,
  };
}

export function createWatchOnlyColdWallet(params: {
  label: string;
  network: PearlNetworkId;
  address: string;
  publicKeyJwk: JsonWebKey;
  initialBalance?: number;
}): WalletRecord {
  const walletId = `cold-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  return {
    id: walletId,
    label: params.label,
    network: params.network,
    mode: 'cold-watch',
    address: params.address,
    balance: params.initialBalance ?? 0,
    nonce: 0,
    xmssNextLeaf: 0,
    createdAt,
    keystore: {
      format: 'pearl-keystore-v2',
      walletId,
      label: params.label,
      network: params.network,
      mode: 'cold-watch',
      address: params.address,
      xmssScheme: 'XMSS-SHA2_16_256',
      publicKeyJwk: params.publicKeyJwk,
      createdAt,
      kdf: {
        name: 'PBKDF2-HMAC-SHA256',
        iterations: PBKDF2_ITERATIONS,
        saltBase64: '',
      },
      cipher: null,
    },
  };
}

export async function decryptWalletKeystore(
  keystore: EncryptedKeystoreV2,
  password: string,
): Promise<SecretWalletPayload> {
  if (keystore.mode === 'cold-watch' || !keystore.cipher) {
    throw new Error('Кошелек работает в режиме «Только просмотр» и не содержит приватного ключа.');
  }

  const salt = base64ToBytes(keystore.kdf.saltBase64);
  const iv = base64ToBytes(keystore.cipher.ivBase64);
  const ciphertext = base64ToBytes(keystore.cipher.ciphertextBase64);
  const aesKey = await deriveAesKey(password, salt, keystore.kdf.iterations);

  try {
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as SecretWalletPayload;
    if (!parsed.privateKeyJwk || !Array.isArray(parsed.mnemonic)) {
      throw new Error('Поврежденная структура хранилища');
    }
    return parsed;
  } catch {
    throw new Error('Неверный мастер-пароль или файл ключей поврежден.');
  }
}

export async function signPearlTransaction(
  unsigned: UnsignedPearlTx,
  privateKeyJwk: JsonWebKey,
  signerPublicKeyJwk: JsonWebKey,
): Promise<SignedPearlTx> {
  const key = await globalThis.crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const msgBytes = new TextEncoder().encode(canonicalTxMessage(unsigned));
  const sigBuf = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    msgBytes,
  );

  return {
    unsigned,
    signerPublicKeyJwk,
    signatureBase64: bytesToBase64(new Uint8Array(sigBuf)),
    algorithm: 'ECDSA-P256-SHA256',
    signedAt: new Date().toISOString(),
  };
}

export async function verifyPearlTransactionSignature(signed: SignedPearlTx): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'jwk',
      signed.signerPublicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const msgBytes = new TextEncoder().encode(canonicalTxMessage(signed.unsigned));
    const sigBytes = base64ToBytes(signed.signatureBase64);
    return await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      toArrayBuffer(sigBytes),
      msgBytes,
    );
  } catch {
    return false;
  }
}
