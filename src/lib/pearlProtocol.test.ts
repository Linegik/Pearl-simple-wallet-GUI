import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePearlAddress,
  generateMnemonic24,
  validateMnemonic24,
  validatePearlAddress,
  validateTxDraft,
} from './pearlProtocol';
import {
  createEncryptedWallet,
  decryptWalletKeystore,
  signPearlTransaction,
  verifyPearlTransactionSignature,
} from './cryptoVault';

test('Bech32m Pearl addresses enforce Mainnet (prl1p) vs Testnet (tprl1p) prefixes', () => {
  const hash = new Uint8Array(32).fill(7);
  const mainnetAddr = encodePearlAddress('mainnet', hash);
  const testnetAddr = encodePearlAddress('testnet', hash);
  const regtestAddr = encodePearlAddress('regtest', hash);

  assert.ok(mainnetAddr.startsWith('prl1p'));
  assert.ok(testnetAddr.startsWith('tprl1p'));
  assert.ok(regtestAddr.startsWith('rprl1p'));

  assert.equal(validatePearlAddress(mainnetAddr, 'mainnet').valid, true);
  assert.equal(validatePearlAddress(testnetAddr, 'testnet').valid, true);
  assert.equal(validatePearlAddress(testnetAddr, 'mainnet').valid, false);
  assert.equal(validatePearlAddress(mainnetAddr, 'testnet').valid, false);

  // Tampering one character invalidates Bech32m checksum
  const corrupted = mainnetAddr.slice(0, -1) + (mainnetAddr.endsWith('q') ? 'p' : 'q');
  assert.equal(validatePearlAddress(corrupted, 'mainnet').valid, false);
});

test('24-word mnemonic passes checksum validation and rejects altered words', async () => {
  const words = await generateMnemonic24();
  assert.equal(words.length, 24);
  assert.equal(await validateMnemonic24(words), true);

  const altered = [...words];
  altered[0] = altered[0] === 'anchor' ? 'arctic' : 'anchor';
  assert.equal(await validateMnemonic24(altered), false);
});

test('Encrypted keystore encrypts with AES-256-GCM + PBKDF2 and signs/verifies transactions', async () => {
  const { wallet, secret } = await createEncryptedWallet({
    label: 'Testnet Vault',
    network: 'testnet',
    password: 'StrongPassword#2026',
    initialBalance: 100,
  });

  assert.equal(wallet.network, 'testnet');
  assert.ok(wallet.address.startsWith('tprl1p'));
  assert.equal(wallet.keystore.kdf.iterations, 600_000);
  assert.ok(wallet.keystore.cipher?.ciphertextBase64);

  await assert.rejects(
    () => decryptWalletKeystore(wallet.keystore, 'WrongPassword'),
    /Неверный мастер-пароль/,
  );

  const decrypted = await decryptWalletKeystore(wallet.keystore, 'StrongPassword#2026');
  assert.deepEqual(decrypted.mnemonic, secret.mnemonic);

  const recipient = encodePearlAddress('testnet', new Uint8Array(32).fill(99));
  const draftCheck = validateTxDraft({
    network: 'testnet',
    fromAddress: wallet.address,
    toAddress: recipient,
    amount: 25,
    fee: 0.001,
    availableBalance: wallet.balance,
  });
  assert.equal(draftCheck.ok, true);

  const unsigned = {
    version: 'PRL-PSBT-1' as const,
    txId: 'tx-001',
    network: 'testnet' as const,
    fromAddress: wallet.address,
    toAddress: recipient,
    amount: 25,
    fee: 0.001,
    nonce: 0,
    createdAt: '2026-11-21T18:00:00.000Z',
    xmssLeafIndex: 0,
  };

  const signed = await signPearlTransaction(
    unsigned,
    decrypted.privateKeyJwk,
    wallet.keystore.publicKeyJwk,
  );
  assert.equal(await verifyPearlTransactionSignature(signed), true);

  // Tampering amount after signing invalidates signature
  const tampered = {
    ...signed,
    unsigned: { ...signed.unsigned, amount: 999 },
  };
  assert.equal(await verifyPearlTransactionSignature(tampered), false);
});
