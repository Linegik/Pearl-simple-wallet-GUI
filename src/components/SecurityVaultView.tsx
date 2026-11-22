import { useState } from 'react';
import {
  Download,
  Eye,
  KeyRound,
  Lock,
  ShieldCheck,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  decryptWalletKeystore,
  EncryptedKeystoreV2,
  SecretWalletPayload,
  WalletRecord,
} from '../lib/cryptoVault';
import { PEARL_NETWORKS } from '../lib/pearlProtocol';

interface SecurityVaultViewProps {
  wallets: WalletRecord[];
  unlockedSecrets: Record<string, SecretWalletPayload>;
  onUnlockWallet: (walletId: string, secret: SecretWalletPayload) => void;
  onLockWallet: (walletId: string) => void;
  onImportKeystore: (keystore: EncryptedKeystoreV2) => void;
}

export function SecurityVaultView({
  wallets,
  unlockedSecrets,
  onUnlockWallet,
  onLockWallet,
  onImportKeystore,
}: SecurityVaultViewProps) {
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [revealedMnemonicFor, setRevealedMnemonicFor] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUnlock = async (wallet: WalletRecord) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const pwd = passwords[wallet.id] ?? '';
    if (!pwd) {
      setErrorMsg('Введите мастер-пароль.');
      return;
    }
    try {
      const secret = await decryptWalletKeystore(wallet.keystore, pwd);
      onUnlockWallet(wallet.id, secret);
      setPasswords((prev) => ({ ...prev, [wallet.id]: '' }));
      setStatusMsg(`Хранилище «${wallet.label}» расшифровано в памяти.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка расшифровки.');
    }
  };

  const handleDownloadKeystore = (wallet: WalletRecord) => {
    const blob = new Blob([JSON.stringify(wallet.keystore, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wallet.id}-${wallet.network}.pearlkey.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EncryptedKeystoreV2;
      if (parsed.format !== 'pearl-keystore-v2' || !parsed.address) {
        throw new Error('Неподдерживаемый формат файла ключей. Ожидается pearl-keystore-v2.');
      }
      onImportKeystore(parsed);
      setStatusMsg(`Импортирован зашифрованный кошелек ${parsed.label} (${parsed.address}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка импорта файла ключей.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Локальное хранение ключей и безопасность Windows
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Приватные ключи шифруются PBKDF2-HMAC-SHA256 (600 000 итераций) + AES-256-GCM и
            никогда не покидают компьютер пользователя.
          </p>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap shrink-0">
          <Upload className="h-4 w-4" aria-hidden="true" />
          <span>Импорт .pearlkey.json</span>
          <input
            type="file"
            accept=".json,.pearlkey,.pearlkey.json"
            onChange={handleFileImport}
            className="sr-only"
          />
        </label>
      </div>

      {statusMsg ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          {statusMsg}
        </div>
      ) : null}

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {errorMsg}
        </div>
      ) : null}

      {/* Cryptographic Architecture Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Формирование ключа (KDF)</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
            PBKDF2 · 600,000 iters
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Уникальная 16-байтная случайная соль на каждый локальный файл ключей.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Аутентифицированное шифрование</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
            AES-256-GCM + DPAPI
          </div>
          <p className="mt-1 text-xs text-slate-600">
            В Windows-клиенте дополнительно защищено системным API DPAPI (safeStorage).
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Постквантовая готовность</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
            Taproot + XMSS-SHA2
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Отслеживание одноразовых XMSS-индексов для предотвращения повторного использования.
          </p>
        </div>
      </div>

      {/* Wallets Keystore List */}
      <div className="space-y-4">
        {wallets.map((w) => {
          const unlocked = unlockedSecrets[w.id];
          const isWatchOnly = w.mode === 'cold-watch';
          return (
            <section key={w.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{PEARL_NETWORKS[w.network].label}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{w.keystore.format}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {isWatchOnly
                        ? 'Приватный ключ отсутствует на диске'
                        : unlocked
                          ? 'Расшифрован в памяти'
                          : 'Зашифрован на диске'}
                    </span>
                  </div>
                  <h2 className="mt-1 font-display text-base font-semibold text-slate-900">
                    {w.label}
                  </h2>
                  <p className="mt-1 font-mono text-xs break-all text-slate-600">{w.address}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadKeystore(w)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Экспорт .pearlkey</span>
                  </button>

                  {!isWatchOnly && unlocked ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedMnemonicFor((prev) => (prev === w.id ? null : w.id))
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{revealedMnemonicFor === w.id ? 'Скрыть сид-фразу' : 'Показать сид-фразу'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onLockWallet(w.id);
                          if (revealedMnemonicFor === w.id) setRevealedMnemonicFor(null);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Заблокировать</span>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {!isWatchOnly && !unlocked ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <label htmlFor={`unlock-${w.id}`} className="sr-only">
                    Пароль для {w.label}
                  </label>
                  <input
                    id={`unlock-${w.id}`}
                    type="password"
                    value={passwords[w.id] ?? ''}
                    onChange={(e) =>
                      setPasswords((prev) => ({ ...prev, [w.id]: e.target.value }))
                    }
                    placeholder="Мастер-пароль для расшифровки..."
                    className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleUnlock(w)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Расшифровать ключ</span>
                  </button>
                </div>
              ) : null}

              {unlocked && revealedMnemonicFor === w.id ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Мнемоническая фраза восстановления (24 слова)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {unlocked.mnemonic.map((word, idx) => (
                      <div
                        key={`${word}-${idx}`}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-900"
                      >
                        <span className="text-slate-400 tabular-nums">{idx + 1}.</span> {word}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {isWatchOnly ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
                  <span>
                    Режим Watch-Only: в файле отсутствует зашифрованный приватный ключ, взлом ПК не
                    раскроет средства.
                  </span>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
