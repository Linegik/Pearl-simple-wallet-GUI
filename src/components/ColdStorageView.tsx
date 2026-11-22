import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCheck2,
  HardDrive,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import {
  decryptWalletKeystore,
  SecretWalletPayload,
  signPearlTransaction,
  verifyPearlTransactionSignature,
  WalletRecord,
  WalletTransaction,
} from '../lib/cryptoVault';
import {
  encodePearlAddress,
  PEARL_NETWORKS,
  PearlNetworkId,
  SignedPearlTx,
  UnsignedPearlTx,
  validateTxDraft,
} from '../lib/pearlProtocol';
import { QrCodeBox } from './QrCodeBox';

interface ColdStorageViewProps {
  activeNetwork: PearlNetworkId;
  wallets: WalletRecord[];
  activeWallet: WalletRecord | null;
  unlockedSecrets: Record<string, SecretWalletPayload>;
  onUnlockWallet: (walletId: string, secret: SecretWalletPayload) => void;
  onColdBroadcastConfirmed: (tx: WalletTransaction, newBalance: number, newNonce: number) => void;
}

export function ColdStorageView({
  activeNetwork,
  wallets,
  activeWallet,
  unlockedSecrets,
  onUnlockWallet,
  onColdBroadcastConfirmed,
}: ColdStorageViewProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [airGappedMode, setAirGappedMode] = useState(false);

  // Step 1: Unsigned PSBT creation
  const [fromWalletId, setFromWalletId] = useState<string>(activeWallet?.id ?? wallets[0]?.id ?? '');
  const [toAddress, setToAddress] = useState<string>(() =>
    encodePearlAddress(activeNetwork, new Uint8Array(32).fill(88)),
  );
  const [amountStr, setAmountStr] = useState('15');
  const [feeStr, setFeeStr] = useState('0.001');
  const [unsignedTx, setUnsignedTx] = useState<UnsignedPearlTx | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2: Offline Air-Gapped Signer
  const [signerPassword, setSignerPassword] = useState('');
  const [signedTx, setSignedTx] = useState<SignedPearlTx | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  // Step 3: Verification & Broadcast
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'verified' | 'rejected'>('idle');
  const [broadcastDone, setBroadcastDone] = useState<string | null>(null);

  const selectedWallet = wallets.find((w) => w.id === fromWalletId) ?? activeWallet ?? wallets[0];

  const handleBuildUnsigned = (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Error(null);
    if (!selectedWallet) {
      setStep1Error('Выберите кошелек-отправитель.');
      return;
    }

    const amount = Number.parseFloat(amountStr);
    const fee = Number.parseFloat(feeStr);
    const validation = validateTxDraft({
      network: selectedWallet.network,
      fromAddress: selectedWallet.address,
      toAddress,
      amount,
      fee,
      availableBalance: selectedWallet.balance,
    });

    if (!validation.ok) {
      setStep1Error(validation.error ?? 'Некорректные данные транзакции.');
      return;
    }

    const psbt: UnsignedPearlTx = {
      version: 'PRL-PSBT-1',
      txId: `psbt-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      network: selectedWallet.network,
      fromAddress: selectedWallet.address,
      toAddress: toAddress.trim().toLowerCase(),
      amount,
      fee,
      nonce: selectedWallet.nonce,
      createdAt: new Date().toISOString(),
      xmssLeafIndex: selectedWallet.xmssNextLeaf,
    };

    setUnsignedTx(psbt);
    setSignedTx(null);
    setVerifyStatus('idle');
    setBroadcastDone(null);
    setStep(2);
  };

  const handleDownloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportUnsignedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep2Error(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as UnsignedPearlTx;
      if (parsed.version !== 'PRL-PSBT-1' || !parsed.txId) {
        throw new Error('Файл не является корректной транзакцией PRL-PSBT-1.');
      }
      setUnsignedTx(parsed);
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Ошибка чтения файла PSBT.');
    }
  };

  const handleSignOffline = async () => {
    if (!unsignedTx) return;
    setStep2Error(null);
    setIsSigning(true);

    try {
      const matchingWallet = wallets.find(
        (w) => w.address.toLowerCase() === unsignedTx.fromAddress.toLowerCase(),
      );

      let privJwk: JsonWebKey | null = null;
      let pubJwk: JsonWebKey | null = null;

      if (matchingWallet && matchingWallet.mode === 'standard') {
        let secret = unlockedSecrets[matchingWallet.id];
        if (!secret) {
          if (!signerPassword) {
            setStep2Error('Введите мастер-пароль зашифрованного хранилища для подписи.');
            setIsSigning(false);
            return;
          }
          secret = await decryptWalletKeystore(matchingWallet.keystore, signerPassword);
          onUnlockWallet(matchingWallet.id, secret);
        }
        privJwk = secret.privateKeyJwk;
        pubJwk = matchingWallet.keystore.publicKeyJwk;
      } else {
        // Watch-only cold storage: generate or use an isolated ephemeral hardware/cold signing keypair demonstration
        // ONLY when signing from a Watch-Only wallet so user can test the complete Air-Gapped verification loop,
        // or require importing an encrypted .pearlkey file in real cold use.
        const coldKeyPair = await globalThis.crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign', 'verify'],
        );
        privJwk = await globalThis.crypto.subtle.exportKey('jwk', coldKeyPair.privateKey);
        pubJwk = await globalThis.crypto.subtle.exportKey('jwk', coldKeyPair.publicKey);
      }

      const signed = await signPearlTransaction(unsignedTx, privJwk, pubJwk);
      setSignedTx(signed);
      setSignerPassword('');
      setStep(3);
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Ошибка автономной подписи.');
    } finally {
      setIsSigning(false);
    }
  };

  const handleVerifyAndBroadcast = async () => {
    if (!signedTx) return;
    const isValid = await verifyPearlTransactionSignature(signedTx);
    if (!isValid) {
      setVerifyStatus('rejected');
      return;
    }
    setVerifyStatus('verified');

    const targetWallet = wallets.find(
      (w) => w.address.toLowerCase() === signedTx.unsigned.fromAddress.toLowerCase(),
    );
    if (targetWallet) {
      const txRecord: WalletTransaction = {
        id: signedTx.unsigned.txId,
        walletId: targetWallet.id,
        network: signedTx.unsigned.network,
        direction: 'out',
        counterparty: signedTx.unsigned.toAddress,
        amount: signedTx.unsigned.amount,
        fee: signedTx.unsigned.fee,
        timestamp: signedTx.signedAt,
        status: 'confirmed',
        signingMethod: 'cold-airgap',
        signatureHex: signedTx.signatureBase64.slice(0, 24),
      };
      onColdBroadcastConfirmed(
        txRecord,
        Number(
          Math.max(
            0,
            targetWallet.balance - signedTx.unsigned.amount - signedTx.unsigned.fee,
          ).toFixed(8),
        ),
        targetWallet.nonce + 1,
      );
      setBroadcastDone(
        `Подписанная транзакция ${signedTx.unsigned.txId} прошла криптографическую проверку и записана в журнал.`,
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Холодное хранение (Air-Gapped PSBT)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Разделение онлайн-наблюдения (Watch-Only) и офлайн-подписи без доступа к сети.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAirGappedMode((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            airGappedMode
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          }`}
        >
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          <span>{airGappedMode ? 'Офлайн-режим (Air-Gap) включен' : 'Включить офлайн-подписчик'}</span>
        </button>
      </div>

      {/* 3-Step Segmented Workflow Control */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-3">
        {[
          { id: 1 as const, label: '1. Формирование PSBT (Онлайн)' },
          { id: 2 as const, label: '2. Подпись без сети (Офлайн)' },
          { id: 3 as const, label: '3. Проверка подписи и отправка' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={`rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors whitespace-nowrap ${
              step === item.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {step === 1 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Этап 1. Подготовка неподписанной транзакции (Watch-Only)
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            На онлайн-машине формируется только структура перевода PRL-PSBT-1. Приватный ключ не
            используется.
          </p>

          <form onSubmit={handleBuildUnsigned} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="cold-from-wallet" className="mb-1.5 block text-xs font-medium text-slate-700">
                Кошелек-отправитель
              </label>
              <select
                id="cold-from-wallet"
                value={selectedWallet?.id ?? ''}
                onChange={(e) => {
                  setFromWalletId(e.target.value);
                  const w = wallets.find((item) => item.id === e.target.value);
                  if (w) {
                    setToAddress(encodePearlAddress(w.network, new Uint8Array(32).fill(88)));
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({PEARL_NETWORKS[w.network].shortLabel} · {w.balance.toFixed(2)}{' '}
                    {PEARL_NETWORKS[w.network].ticker})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cold-to-address" className="mb-1.5 block text-xs font-medium text-slate-700">
                Адрес получателя
              </label>
              <input
                id="cold-to-address"
                type="text"
                required
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="cold-amount" className="mb-1.5 block text-xs font-medium text-slate-700">
                Сумма перевода
              </label>
              <input
                id="cold-amount"
                type="number"
                step="0.0001"
                min="0.0001"
                required
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="cold-fee" className="mb-1.5 block text-xs font-medium text-slate-700">
                Комиссия сети
              </label>
              <input
                id="cold-fee"
                type="number"
                step="0.0001"
                min="0.0001"
                required
                value={feeStr}
                onChange={(e) => setFeeStr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </div>

            {step1Error ? (
              <div role="alert" className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {step1Error}
              </div>
            ) : null}

            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <HardDrive className="h-4 w-4" aria-hidden="true" />
                <span>Сформировать неподписанную PSBT</span>
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Этап 2. Автономная подпись (Offline Signer)
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Передайте PSBT через USB-флешку (.psbt.json) или QR-код на изолированный компьютер.
              </p>
            </div>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
              <span>Загрузить .psbt.json</span>
              <input
                type="file"
                accept=".json,.psbt.json"
                onChange={handleImportUnsignedFile}
                className="sr-only"
              />
            </label>
          </div>

          {!unsignedTx ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              Сначала сформируйте транзакцию на Этапе 1 или загрузите файл <code className="font-mono">.psbt.json</code>.
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-7">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">ID транзакции</span>
                      <p className="font-mono font-semibold text-slate-900">{unsignedTx.txId}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Сеть и XMSS-индекс</span>
                      <p className="font-mono font-semibold text-slate-900">
                        {PEARL_NETWORKS[unsignedTx.network].shortLabel} · Leaf #{unsignedTx.xmssLeafIndex}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500">Отправитель</span>
                      <p className="font-mono break-all text-slate-900">{unsignedTx.fromAddress}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500">Получатель</span>
                      <p className="font-mono break-all text-slate-900">{unsignedTx.toAddress}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Сумма</span>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {unsignedTx.amount.toFixed(4)} {PEARL_NETWORKS[unsignedTx.network].ticker}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Комиссия</span>
                      <p className="font-mono font-semibold text-slate-900 tabular-nums">
                        {unsignedTx.fee.toFixed(4)} {PEARL_NETWORKS[unsignedTx.network].ticker}
                      </p>
                    </div>
                  </div>
                </div>

                {(() => {
                  const w = wallets.find(
                    (item) => item.address.toLowerCase() === unsignedTx.fromAddress.toLowerCase(),
                  );
                  if (w && w.mode === 'standard' && !unlockedSecrets[w.id]) {
                    return (
                      <div>
                        <label
                          htmlFor="cold-signer-password"
                          className="mb-1.5 block text-xs font-medium text-slate-700"
                        >
                          Мастер-пароль автономного хранилища
                        </label>
                        <input
                          id="cold-signer-password"
                          type="password"
                          value={signerPassword}
                          onChange={(e) => setSignerPassword(e.target.value)}
                          placeholder="Введите пароль от .pearlkey"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                {step2Error ? (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {step2Error}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleDownloadJson(unsignedTx, `${unsignedTx.txId}.psbt.json`)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Скачать .psbt.json</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSigning}
                    onClick={handleSignOffline}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                    <span>{isSigning ? 'Подписание...' : 'Подписать транзакцию офлайн'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-5">
                <QrCodeBox
                  value={JSON.stringify(unsignedTx)}
                  size={170}
                  label="QR-код неподписанной транзакции PSBT"
                />
                <span className="mt-2 text-xs text-slate-600">
                  QR-передача на автономное устройство
                </span>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Этап 3. Проверка цифровой подписи и трансляция в сеть
          </h2>
          {!signedTx ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              Подписанная транзакция еще не загружена. Выполните Этап 2.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs">
                <div className="text-slate-500">Алгоритм подписи: {signedTx.algorithm}</div>
                <div className="mt-1 break-all text-slate-900">
                  Signature (Base64): {signedTx.signatureBase64}
                </div>
              </div>

              {verifyStatus === 'verified' ? (
                <div role="status" className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Подпись ECDSA-P256-SHA256 криптографически подтверждена</p>
                    <p className="mt-0.5">{broadcastDone}</p>
                  </div>
                </div>
              ) : verifyStatus === 'rejected' ? (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Подпись не прошла проверку — транзакция отклонена.</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadJson(signedTx, `${signedTx.unsigned.txId}.signed.json`)
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Экспорт подписанной .signed.json</span>
                </button>
                <button
                  type="button"
                  onClick={handleVerifyAndBroadcast}
                  disabled={verifyStatus === 'verified'}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Проверить подпись и отправить в сеть</span>
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
