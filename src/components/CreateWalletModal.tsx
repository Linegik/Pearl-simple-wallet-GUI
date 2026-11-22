import { useState } from 'react';
import { Download, Eye, EyeOff, KeyRound, Shield, X } from 'lucide-react';
import {
  createEncryptedWallet,
  createWatchOnlyColdWallet,
  SecretWalletPayload,
  WalletRecord,
} from '../lib/cryptoVault';
import {
  PEARL_NETWORKS,
  PearlNetworkId,
  validatePearlAddress,
} from '../lib/pearlProtocol';

interface CreateWalletModalProps {
  isOpen: boolean;
  defaultNetwork: PearlNetworkId;
  onClose: () => void;
  onWalletCreated: (wallet: WalletRecord, secret?: SecretWalletPayload) => void;
}

export function CreateWalletModal({
  isOpen,
  defaultNetwork,
  onClose,
  onWalletCreated,
}: CreateWalletModalProps) {
  const [network, setNetwork] = useState<PearlNetworkId>(defaultNetwork);
  const [mode, setMode] = useState<'standard' | 'cold-watch'>('standard');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [watchAddress, setWatchAddress] = useState('');
  const [seedBackupConfirmed, setSeedBackupConfirmed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    wallet: WalletRecord;
    secret?: SecretWalletPayload;
  } | null>(null);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setWatchAddress('');
    setSeedBackupConfirmed(false);
    setCreatedResult(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedLabel =
      label.trim() ||
      (mode === 'cold-watch'
        ? `Холодный просмотр (${PEARL_NETWORKS[network].shortLabel})`
        : `Кошелек ${PEARL_NETWORKS[network].shortLabel}`);

    if (mode === 'cold-watch') {
      const check = validatePearlAddress(watchAddress, network);
      if (!check.valid) {
        setError(check.reason ?? 'Введите корректный адрес Pearl для выбранной сети.');
        return;
      }
      const wallet = createWatchOnlyColdWallet({
        label: trimmedLabel,
        network,
        address: watchAddress.trim().toLowerCase(),
        publicKeyJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
          y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
          ext: true,
        },
        initialBalance: network === 'testnet' || network === 'regtest' ? 100 : 0,
      });
      onWalletCreated(wallet);
      resetAndClose();
      return;
    }

    if (password.length < 8) {
      setError('Мастер-пароль должен содержать минимум 8 символов для стойкого шифрования PBKDF2.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }

    setIsCreating(true);
    try {
      const res = await createEncryptedWallet({
        label: trimmedLabel,
        network,
        password,
        initialBalance: network === 'testnet' || network === 'regtest' ? 250 : 0,
      });
      setCreatedResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации ключей.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDownloadKeystore = () => {
    if (!createdResult) return;
    const blob = new Blob([JSON.stringify(createdResult.wallet.keystore, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${createdResult.wallet.id}-${createdResult.wallet.network}.pearlkey.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFinishCreation = () => {
    if (!createdResult) return;
    onWalletCreated(createdResult.wallet, createdResult.secret);
    resetAndClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-wallet-title"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="create-wallet-title" className="font-display text-lg font-semibold text-slate-900">
              {createdResult ? 'Резервная копия сид-фразы и файла ключей' : 'Создать кошелек Pearl'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {createdResult
                ? 'Ключи сгенерированы локально в памяти и зашифрованы алгоритмом AES-256-GCM.'
                : 'Локальная генерация ключей с шифрованием PBKDF2-HMAC-SHA256 на вашем компьютере.'}
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Закрыть окно создания кошелька"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {createdResult && createdResult.secret ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Сеть: {PEARL_NETWORKS[createdResult.wallet.network].label}</span>
                <span>Схема: {createdResult.wallet.keystore.xmssScheme}</span>
              </div>
              <p className="mt-2 font-mono text-xs break-all text-slate-900">
                {createdResult.wallet.address}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">
                24-словная мнемоническая фраза (BIP39-совместимая с контрольной суммой)
              </p>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
                {createdResult.secret.mnemonic.map((word, idx) => (
                  <div
                    key={`${word}-${idx}`}
                    className="flex items-center gap-1.5 rounded bg-white px-2 py-1 font-mono text-xs text-slate-900 border border-slate-200"
                  >
                    <span className="text-slate-400 tabular-nums">{idx + 1}.</span>
                    <span>{word}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="text-xs text-slate-600">
                <p className="font-semibold text-slate-900">Зашифрованный файл ключей (.pearlkey.json)</p>
                <p>Сохраните резервную копию на внешний носитель Windows.</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadKeystore}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Скачать .pearlkey</span>
              </button>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={seedBackupConfirmed}
                onChange={(e) => setSeedBackupConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>
                Я записал сид-фразу из 24 слов и сохранил мастер-пароль. Приватные ключи не
                передаются на сторонние серверы.
              </span>
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                disabled={!seedBackupConfirmed}
                onClick={handleFinishCreation}
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
              >
                Открыть кошелек
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-800">
                Выберите сеть
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(['testnet', 'mainnet', 'regtest'] as PearlNetworkId[]).map((netId) => (
                  <button
                    key={netId}
                    type="button"
                    onClick={() => setNetwork(netId)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      network === netId
                        ? 'border-blue-600 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>{PEARL_NETWORKS[netId].shortLabel}</div>
                    <div className="mt-0.5 font-mono font-normal text-slate-500">
                      {PEARL_NETWORKS[netId].samplePrefix}…
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-600">{PEARL_NETWORKS[network].description}</p>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-800">
                Режим безопасности кошелька
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('standard')}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    mode === 'standard'
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-900" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Локальное хранилище ключей
                    </div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      Шифрование AES-256-GCM + PBKDF2 на этом ПК
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('cold-watch')}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    mode === 'cold-watch'
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Холодный (только просмотр)
                    </div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      Без приватных ключей на ПК; подпись офлайн
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="wallet-label-input" className="mb-1.5 block text-sm font-medium text-slate-800">
                Название кошелька
              </label>
              <input
                id="wallet-label-input"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  network === 'testnet'
                    ? 'Например: Тестовый кошелек Oyster'
                    : 'Например: Основной сейф Windows'
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            {mode === 'cold-watch' ? (
              <div>
                <label htmlFor="watch-address-input" className="mb-1.5 block text-sm font-medium text-slate-800">
                  Публичный адрес холодного кошелька ({PEARL_NETWORKS[network].samplePrefix}…)
                </label>
                <input
                  id="watch-address-input"
                  type="text"
                  required
                  value={watchAddress}
                  onChange={(e) => setWatchAddress(e.target.value)}
                  placeholder={`${PEARL_NETWORKS[network].samplePrefix}...`}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="wallet-password" className="mb-1.5 block text-sm font-medium text-slate-800">
                    Мастер-пароль (мин. 8 символов)
                  </label>
                  <div className="relative">
                    <input
                      id="wallet-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-9 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-800"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="wallet-password-confirm" className="mb-1.5 block text-sm font-medium text-slate-800">
                    Повторите пароль
                  </label>
                  <input
                    id="wallet-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {error ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={resetAndClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {isCreating
                  ? 'Генерация ключей...'
                  : mode === 'cold-watch'
                    ? 'Добавить Watch-Only'
                    : 'Зашифровать и создать'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
