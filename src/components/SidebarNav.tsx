import {
  Code2,
  DownloadCloud,
  HardDrive,
  Lock,
  ShieldCheck,
  Unlock,
  Wallet,
} from 'lucide-react';
import { PEARL_NETWORKS, PearlNetworkId } from '../lib/pearlProtocol';

export type WorkspaceTab = 'overview' | 'cold-storage' | 'security' | 'updater' | 'source';

interface SidebarNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  activeNetwork: PearlNetworkId;
  onSelectNetwork: (net: PearlNetworkId) => void;
  unlockedCount: number;
  totalEncryptedCount: number;
  onLockAll: () => void;
  updateAvailableTag: string | null;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof Wallet;
}> = [
  { id: 'overview', label: 'Обзор и кошельки', icon: Wallet },
  { id: 'cold-storage', label: 'Холодное хранение', icon: HardDrive },
  { id: 'security', label: 'Ключи и безопасность', icon: ShieldCheck },
  { id: 'updater', label: 'Обновления GitHub', icon: DownloadCloud },
  { id: 'source', label: 'Релиз Win / Linux', icon: Code2 },
];

export function SidebarNav({
  activeTab,
  onSelectTab,
  activeNetwork,
  onSelectNetwork,
  unlockedCount,
  totalEncryptedCount,
  onLockAll,
  updateAvailableTag,
}: SidebarNavProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:min-h-screen lg:w-64 lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="28" height="28" rx="6" fill="#0F172A" />
            <circle cx="14" cy="14" r="6.5" stroke="#F8FAFC" strokeWidth="1.75" />
            <circle cx="14" cy="14" r="2.5" fill="#3B82F6" />
          </svg>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Pearl Vault
          </span>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums">win · linux</span>
      </div>

      <div className="border-b border-slate-200 px-4 py-3.5">
        <label
          htmlFor="network-selector"
          className="mb-1.5 block text-xs font-medium text-slate-600"
        >
          Активная сеть Pearl
        </label>
        <select
          id="network-selector"
          value={activeNetwork}
          onChange={(e) => onSelectNetwork(e.target.value as PearlNetworkId)}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 transition-colors focus:border-blue-600 focus:bg-white focus:outline-none"
        >
          {(Object.keys(PEARL_NETWORKS) as PearlNetworkId[]).map((netId) => (
            <option key={netId} value={netId}>
              {PEARL_NETWORKS[netId].label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 font-mono text-xs text-slate-500 tabular-nums">
          Префикс: {PEARL_NETWORKS[activeNetwork].samplePrefix}… · Порт :
          {PEARL_NETWORKS[activeNetwork].nodePort}
        </p>
      </div>

      <nav aria-label="Разделы кошелька" className="flex flex-1 flex-row gap-1 overflow-x-auto p-3 lg:flex-col">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </span>
              {item.id === 'updater' && updateAvailableTag ? (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive ? 'text-blue-300' : 'text-blue-700'
                  }`}
                >
                  {updateAvailableTag}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
            {unlockedCount > 0 ? (
              <>
                <Unlock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="text-amber-700">Открыто: {unlockedCount}</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="text-emerald-800">
                  {totalEncryptedCount > 0 ? 'Ключи зашифрованы' : 'Ключи изолированы'}
                </span>
              </>
            )}
          </span>
          {unlockedCount > 0 ? (
            <button
              type="button"
              onClick={onLockAll}
              className="font-medium text-slate-900 underline underline-offset-2 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              Заблокировать
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
