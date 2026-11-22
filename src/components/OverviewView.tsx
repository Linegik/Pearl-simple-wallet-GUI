import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Coins,
  Copy,
  HardDrive,
  Lock,
  Plus,
  QrCode,
  Send,
  Unlock,
} from 'lucide-react';
import {
  decryptWalletKeystore,
  SecretWalletPayload,
  signPearlTransaction,
  WalletRecord,
  WalletTransaction,
} from '../lib/cryptoVault';
import {
  PEARL_NETWORKS,
  PearlNetworkId,
  UnsignedPearlTx,
  validateTxDraft,
} from '../lib/pearlProtocol';
import { QrCodeBox } from './QrCodeBox';

interface OverviewViewProps {
  activeNetwork: PearlNetworkId;
  wallets: WalletRecord[];
  activeWallet: WalletRecord | null;
  onSelectWallet: (walletId: string) => void;
  unlockedSecrets: Record<string, SecretWalletPayload>;
  onUnlockWallet: (walletId: string, secret: SecretWalletPayload) => void;
  transactions: WalletTransaction[];
  onOpenCreateModal: (presetNetwork?: PearlNetworkId) => void;
  onFaucetClaim: (walletId: string) => void;
  onSendConfirmed: (tx: WalletTransaction, newBalance: number, newNonce: number) => void;
  onNavigateColdStorage: () => void;
}

export function OverviewView({
  activeNetwork,
  wallets,
  activeWallet,
  onSelectWallet,
  unlockedSecrets,
  onUnlockWallet,
  transactions,
  onOpenCreateModal,
  onFaucetClaim,
  onSendConfirmed,
  onNavigateColdStorage,
}: OverviewViewProps) {
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [feeStr, setFeeStr] = useState('0.001');
  const [memo, setMemo] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const networkCfg = PEARL_NETWORKS[activeNetwork];
  const networkWallets = wallets.filter((w) => w.network === activeNetwork);
  const walletTxs = activeWallet
    ? transactions.filter((t) => t.walletId === activeWallet.id)
    : [];

  const isUnlocked = activeWallet ? Boolean(unlockedSecrets[activeWallet.id]) : false;

  const handleCopyAddress = async () => {
    if (!activeWallet) return;
    try {
      await navigator.clipboard.writeText(activeWallet.address);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 3000);
    } catch {
      // Fallback ignored in headless environments without clipboard permission
    }
  };

  const handleUnlockInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWallet) return;
    setFormError(null);
    try {
      const secret = await decryptWalletKeystore(activeWallet.keystore, unlockPass);
      onUnlockWallet(activeWallet.id, secret);
      setUnlockPass('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка расшифровки.');
    }
  };

  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWallet) return;
    setFormError(null);
    setFormSuccess(null);

    if (activeWallet.mode === 'cold-watch') {
      setFormError(
        'Этот кошелек работает в режиме холодного просмотра. Используйте раздел «Холодное хранение» для формирования неподписанной транзакции.',
      );
      return;
    }

    const secret = unlockedSecrets[activeWallet.id];
    if (!secret) {
      setFormError('Сначала разблокируйте хранилище ключей мастер-паролем.');
      return;
    }

    const amount = Number.parseFloat(amountStr);
    const fee = Number.parseFloat(feeStr);
    const check = validateTxDraft({
      network: activeWallet.network,
      fromAddress: activeWallet.address,
      toAddress: recipient,
      amount,
      fee,
      availableBalance: activeWallet.balance,
    });

    if (!check.ok) {
      setFormError(check.error ?? 'Проверьте параметры перевода.');
      return;
    }

    setIsSending(true);
    try {
      const unsigned: UnsignedPearlTx = {
        version: 'PRL-PSBT-1',
        txId: `tx-${globalThis.crypto.randomUUID().slice(0, 8)}`,
        network: activeWallet.network,
        fromAddress: activeWallet.address,
        toAddress: recipient.trim().toLowerCase(),
        amount,
        fee,
        nonce: activeWallet.nonce,
        createdAt: new Date().toISOString(),
        xmssLeafIndex: activeWallet.xmssNextLeaf,
        memo: memo.trim() || undefined,
      };

      const signed = await signPearlTransaction(
        unsigned,
        secret.privateKeyJwk,
        activeWallet.keystore.publicKeyJwk,
      );

      const newTx: WalletTransaction = {
        id: unsigned.txId,
        walletId: activeWallet.id,
        network: activeWallet.network,
        direction: 'out',
        counterparty: unsigned.toAddress,
        amount,
        fee,
        timestamp: signed.signedAt,
        status: 'confirmed',
        signingMethod: 'hot-local',
        signatureHex: signed.signatureBase64.slice(0, 24),
      };

      onSendConfirmed(
        newTx,
        Number((activeWallet.balance - amount - fee).toFixed(8)),
        activeWallet.nonce + 1,
      );
      setRecipient('');
      setAmountStr('');
      setMemo('');
      setFormSuccess(`Транзакция ${unsigned.txId} подписана локально и отправлена в сеть.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка подписи транзакции.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {networkCfg.label}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{networkCfg.description}</p>
        </div>

        <button
          type="button"
          onClick={() => onOpenCreateModal(activeNetwork)}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Новый кошелек</span>
        </button>
      </div>

      {/* Wallet Switcher Strip */}
      {networkWallets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
          {networkWallets.map((w) => {
            const selected = activeWallet?.id === w.id;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => onSelectWallet(w.id)}
                className={`rounded-lg border px-3.5 py-2 text-left transition-colors ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
                  <span>{w.label}</span>
                  <span className={selected ? 'text-slate-300' : 'text-slate-400'}>·</span>
                  <span className="font-mono tabular-nums">
                    {w.balance.toFixed(2)} {networkCfg.ticker}
                  </span>
                </div>
                <div
                  className={`mt-0.5 font-mono text-[11px] ${
                    selected ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {w.mode === 'cold-watch' ? 'Холодный просмотр' : 'AES-256-GCM'} ·{' '}
                  {w.address.slice(0, 12)}…{w.address.slice(-6)}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {!activeWallet || activeWallet.network !== activeNetwork ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            В сети {networkCfg.shortLabel} еще нет кошельков
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Создайте зашифрованный кошелек для {networkCfg.label} с локальным хранением ключей на
            компьютере или подключите адрес холодного хранения.
          </p>
          <button
            type="button"
            onClick={() => onOpenCreateModal(activeNetwork)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Создать кошелек в {networkCfg.shortLabel}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left Column: Balance, Address, History */}
          <div className="space-y-6 xl:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>{activeWallet.label}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {activeWallet.mode === 'cold-watch'
                        ? 'Холодное хранение (Watch-Only)'
                        : 'Локальное хранилище AES-256-GCM'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Nonce {activeWallet.nonce}</span>
                  </div>
                  <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {activeWallet.balance.toLocaleString('ru-RU', {
                      minimumFractionDigits: 4,
                      maximumFractionDigits: 4,
                    })}{' '}
                    <span className="text-lg font-medium text-slate-500">{networkCfg.ticker}</span>
                  </div>
                </div>

                {networkCfg.faucetEnabled ? (
                  <button
                    type="button"
                    onClick={() => onFaucetClaim(activeWallet.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-100 whitespace-nowrap shrink-0"
                  >
                    <Coins className="h-4 w-4 text-blue-700" aria-hidden="true" />
                    <span>Получить +250 {networkCfg.ticker}</span>
                  </button>
                ) : null}
              </div>

              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-slate-500">
                      Адрес получения (Bech32m Taproot)
                    </span>
                    <p className="mt-1 font-mono text-xs break-all text-slate-900 select-all">
                      {activeWallet.address}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedAddr ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                          <span>Скопировано</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Копировать</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQr((v) => !v)}
                      aria-expanded={showQr}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{showQr ? 'Скрыть QR' : 'QR-код'}</span>
                    </button>
                  </div>
                </div>

                {showQr ? (
                  <div className="mt-4 flex flex-col items-start gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
                    <QrCodeBox
                      value={`pearl:${activeWallet.address}`}
                      size={140}
                      label={`QR-код адреса ${activeWallet.address}`}
                    />
                    <div className="text-xs text-slate-600">
                      <p className="font-semibold text-slate-900">Прием средств в {networkCfg.shortLabel}</p>
                      <p className="mt-1">
                        Декодер Pearl автоматически отклонит перевод, если отправитель укажет адрес
                        другой сети (защита от смешивания {networkCfg.hrp}1 и иных префиксов).
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Transaction History Table */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Журнал транзакций
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  Записей: {walletTxs.length}
                </span>
              </div>

              {walletTxs.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  Транзакций пока нет.{' '}
                  {networkCfg.faucetEnabled
                    ? 'Запросите тестовые монеты кнопкой «Получить +250 tPRL».'
                    : 'Используйте адрес выше для пополнения.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="px-4 py-2.5 font-semibold">Операция</th>
                        <th className="px-4 py-2.5 font-semibold">Контрагент / Источник</th>
                        <th className="px-4 py-2.5 font-semibold">Подпись</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {walletTxs.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                              {tx.direction === 'in' ? (
                                <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                              ) : (
                                <ArrowUpRight className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />
                              )}
                              <span>{tx.direction === 'in' ? 'Входящий' : 'Отправка'}</span>
                            </span>
                            <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                              {new Date(tx.timestamp).toLocaleString('ru-RU')}
                            </div>
                          </td>
                          <td className="max-w-[170px] truncate px-4 py-2.5 font-mono text-slate-700">
                            {tx.counterparty}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                            {tx.signingMethod === 'cold-airgap'
                              ? 'Холодная (Air-Gap)'
                              : tx.signingMethod === 'faucet'
                                ? 'Testnet Faucet'
                                : 'Локальный ключ'}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap tabular-nums ${
                              tx.direction === 'in' ? 'text-emerald-700' : 'text-slate-900'
                            }`}
                          >
                            {tx.direction === 'in' ? '+' : '-'}
                            {tx.amount.toFixed(4)} {networkCfg.ticker}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Send or Cold Storage Action */}
          <div className="xl:col-span-4">
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Отправка транзакции ({networkCfg.shortLabel})
              </h2>

              {activeWallet.mode === 'cold-watch' ? (
                <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                  <div className="text-sm text-slate-700">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <HardDrive className="h-4 w-4 text-blue-700" aria-hidden="true" />
                      <span>Активен режим холодного хранения</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      На этом онлайн-компьютере хранится только публичный адрес. Чтобы отправить
                      средства, сформируйте неподписанный файл транзакции и подпишите его на
                      автономном устройстве без интернета.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onNavigateColdStorage}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    <HardDrive className="h-4 w-4" aria-hidden="true" />
                    <span>Перейти к холодной подписи</span>
                  </button>
                </div>
              ) : !isUnlocked ? (
                <form onSubmit={handleUnlockInline} className="mt-4 space-y-4">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                    <div className="flex items-center gap-2 font-semibold">
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      <span>Приватный ключ зашифрован (AES-256-GCM)</span>
                    </div>
                    <p className="mt-1">
                      Введите мастер-пароль для расшифровки ключа в оперативной памяти на время
                      сессии.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="inline-unlock-password"
                      className="mb-1.5 block text-xs font-medium text-slate-700"
                    >
                      Мастер-пароль от «{activeWallet.label}»
                    </label>
                    <input
                      id="inline-unlock-password"
                      type="password"
                      required
                      value={unlockPass}
                      onChange={(e) => setUnlockPass(e.target.value)}
                      placeholder="Введите пароль..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  {formError ? (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      {formError}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    <Unlock className="h-4 w-4" aria-hidden="true" />
                    <span>Разблокировать кошелек</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSendSubmit} className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="send-recipient" className="mb-1.5 block text-xs font-medium text-slate-700">
                      Адрес получателя ({networkCfg.samplePrefix}…)
                    </label>
                    <input
                      id="send-recipient"
                      type="text"
                      required
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder={`${networkCfg.samplePrefix}...`}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="send-amount" className="mb-1.5 block text-xs font-medium text-slate-700">
                        Сумма ({networkCfg.ticker})
                      </label>
                      <input
                        id="send-amount"
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        required
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        placeholder="0.0000"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="send-fee" className="mb-1.5 block text-xs font-medium text-slate-700">
                        Комиссия ({networkCfg.ticker})
                      </label>
                      <input
                        id="send-fee"
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        required
                        value={feeStr}
                        onChange={(e) => setFeeStr(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="send-memo" className="mb-1.5 block text-xs font-medium text-slate-700">
                      Примечание (необязательно)
                    </label>
                    <input
                      id="send-memo"
                      type="text"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="Комментарий к переводу"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  {formError ? (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      {formError}
                    </div>
                  ) : null}

                  {formSuccess ? (
                    <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      {formSuccess}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isSending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>{isSending ? 'Подпись ECDSA...' : 'Подписать и отправить'}</span>
                  </button>
                </form>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
