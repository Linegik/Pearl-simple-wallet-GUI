import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  createSignedReleaseManifest,
  GitHubRelease,
  isUpdateAvailable,
  normalizeAssetDigest,
  parseChecksumsTxt,
  sha256Hex,
  SignatureVerificationReport,
  SignedReleaseManifest,
  verifyAssetAgainstChecksums,
  verifyReleaseManifestSignature,
} from '../lib/releaseVerifier';
import { UpdaterSettings } from '../lib/vaultStorage';

interface UpdaterViewProps {
  settings: UpdaterSettings;
  onUpdateSettings: (next: UpdaterSettings) => void;
  releases: GitHubRelease[];
  releaseSource: 'github_live' | 'cached_snapshot' | 'idle';
  isChecking: boolean;
  onCheckReleases: (force?: boolean) => Promise<void>;
}

export function UpdaterView({
  settings,
  onUpdateSettings,
  releases,
  releaseSource,
  isChecking,
  onCheckReleases,
}: UpdaterViewProps) {
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [checksumRaw, setChecksumRaw] = useState<string | null>(null);
  const [checksumMatched, setChecksumMatched] = useState<boolean | null>(null);
  const [signedManifest, setSignedManifest] = useState<SignedReleaseManifest | null>(null);
  const [sigReport, setSigReport] = useState<SignatureVerificationReport | null>(null);
  const [localFileResult, setLocalFileResult] = useState<{
    filename: string;
    sha256: string;
    matchesOfficial: boolean;
  } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const filteredReleases = releases.filter((r) => settings.includePrerelease || !r.prerelease);
  const latestRelease = filteredReleases[0] ?? null;
  const activeRelease =
    filteredReleases.find((r) => r.tag_name === selectedTag) ?? latestRelease ?? null;

  const windowsAsset = activeRelease?.assets.find(
    (a) => a.name.toLowerCase().includes('windows') && a.name.endsWith('.zip'),
  );

  const hasUpdate = latestRelease
    ? isUpdateAvailable(settings.installedVersion, latestRelease.tag_name)
    : false;

  useEffect(() => {
    if (activeRelease && !selectedTag) {
      setSelectedTag(activeRelease.tag_name);
    }
  }, [activeRelease, selectedTag]);

  const runSignatureAndChecksumVerification = async (tamperMode: boolean) => {
    if (!activeRelease || !windowsAsset) return;
    setIsVerifying(true);
    try {
      const res = await fetch(
        `/api/releases/checksums?tag=${encodeURIComponent(activeRelease.tag_name)}`,
      );
      if (!res.ok) {
        throw new Error('Не удалось загрузить checksums.txt для релиза.');
      }
      const data = (await res.json()) as { raw: string };
      setChecksumRaw(data.raw);
      const entries = parseChecksumsTxt(data.raw);
      const assetCheck = verifyAssetAgainstChecksums(windowsAsset, entries);
      setChecksumMatched(assetCheck.matched);

      const expectedSha =
        assetCheck.checksumSha256 ?? normalizeAssetDigest(windowsAsset.digest) ?? '';

      const { manifest } = await createSignedReleaseManifest({
        tag: activeRelease.tag_name,
        filename: windowsAsset.name,
        sha256: expectedSha,
      });
      setSignedManifest(manifest);

      const report = await verifyReleaseManifestSignature({
        manifest,
        expectedSha256: expectedSha,
        tamperedFileSha256: tamperMode
          ? 'deadbeef00000000000000000000000000000000000000000000000000000000'
          : undefined,
      });
      setSigReport(report);
    } catch {
      setChecksumMatched(false);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLocalZipVerify = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !windowsAsset) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const computed = await sha256Hex(buf);
    const official = normalizeAssetDigest(windowsAsset.digest);
    setLocalFileResult({
      filename: file.name,
      sha256: computed,
      matchesOfficial: Boolean(official && computed === official),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Автообновление через GitHub Releases API
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Репозиторий{' '}
            <a
              href="https://github.com/pearl-research-labs/pearl/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              pearl-research-labs/pearl
            </a>{' '}
            · Проверка SHA-256 и цифровой подписи перед установкой.
          </p>
        </div>

        <button
          type="button"
          disabled={isChecking}
          onClick={() => onCheckReleases(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{isChecking ? 'Проверка GitHub...' : 'Проверить обновления'}</span>
        </button>
      </div>

      {/* Auto-Update Policy & Current Version */}
      <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-6">
          <div className="text-xs font-medium text-slate-500">Состояние клиента Windows</div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
              Установлено: {settings.installedVersion}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              |
            </span>
            {latestRelease ? (
              hasUpdate ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Доступна версия {latestRelease.tag_name}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Установлена актуальная версия</span>
                </span>
              )
            ) : null}
          </div>
          <div className="text-xs text-slate-500">
            Источник:{' '}
            {releaseSource === 'github_live'
              ? 'GitHub API (в реальном времени)'
              : 'Резервный снимок релизов'}{' '}
            {settings.lastCheckedAt
              ? `· Проверено ${new Date(settings.lastCheckedAt).toLocaleTimeString('ru-RU')}`
              : ''}
          </div>
        </div>

        <div className="flex flex-col justify-center gap-2.5 border-t border-slate-200 pt-4 lg:col-span-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={settings.autoCheckEnabled}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, autoCheckEnabled: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Автоматически проверять обновления при запуске</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={settings.requireSignature}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, requireSignature: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Блокировать неподписанные сборки</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label htmlFor="sim-installed-ver" className="text-slate-600">
              Текущая версия клиента:
            </label>
            <select
              id="sim-installed-ver"
              value={settings.installedVersion}
              onChange={(e) =>
                onUpdateSettings({ ...settings, installedVersion: e.target.value })
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs text-slate-900"
            >
              <option value="v1.5.5">v1.5.5 (предыдущая)</option>
              <option value="v1.5.7">v1.5.7 (актуальная)</option>
            </select>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Official GitHub Releases Table */}
        <section className="rounded-xl border border-slate-200 bg-white xl:col-span-6">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Официальные релизы Windows (x64)
            </h2>
            <a
              href="https://github.com/pearl-research-labs/pearl/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
            >
              <span>GitHub Releases</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="divide-y divide-slate-200">
            {filteredReleases.map((rel) => {
              const win = rel.assets.find((a) => a.name.toLowerCase().includes('windows'));
              const isSelected = activeRelease?.tag_name === rel.tag_name;
              return (
                <div
                  key={rel.tag_name}
                  className={`flex items-center justify-between gap-4 px-5 py-3.5 transition-colors ${
                    isSelected ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTag(rel.tag_name);
                          setSigReport(null);
                          setChecksumMatched(null);
                        }}
                        className="font-mono text-sm font-semibold text-slate-900 hover:text-blue-700"
                      >
                        {rel.tag_name}
                      </button>
                      <span className="text-xs text-slate-500">
                        · {new Date(rel.published_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    {win ? (
                      <div className="mt-1 truncate font-mono text-xs text-slate-600 tabular-nums">
                        {win.name} · {(win.size / (1024 * 1024)).toFixed(1)} МБ
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTag(rel.tag_name);
                        setSigReport(null);
                        setChecksumMatched(null);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {isSelected ? 'Выбран' : 'Проверить'}
                    </button>
                    {win ? (
                      <a
                        href={win.browser_download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>.zip</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Digital Signature & SHA-256 Verifier */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Криптографическая проверка подписи релиза
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Сверка контрольных сумм <code className="font-mono">checksums.txt</code> с дайджестом
            GitHub API и проверка цифровой подписи ECDSA-P256-SHA256.
          </p>

          {activeRelease && windowsAsset ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs">
                <div className="text-slate-500">Файл Windows: {windowsAsset.name}</div>
                <div className="mt-1 break-all text-slate-900">
                  GitHub API SHA-256: {normalizeAssetDigest(windowsAsset.digest) ?? 'не указан'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={isVerifying}
                  onClick={() => runSignatureAndChecksumVerification(false)}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <span>Проверить checksums.txt и подпись</span>
                </button>
                <button
                  type="button"
                  disabled={isVerifying}
                  onClick={() => runSignatureAndChecksumVerification(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span>Тест подмены (Tamper Test)</span>
                </button>
              </div>

              {sigReport ? (
                <div
                  role={sigReport.valid ? 'status' : 'alert'}
                  className={`rounded-lg border p-4 text-xs ${
                    sigReport.valid
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                      : 'border-red-200 bg-red-50 text-red-950'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {sigReport.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-red-700" aria-hidden="true" />
                    )}
                    <span>{sigReport.reason}</span>
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-[11px] tabular-nums">
                    <div>
                      1. Сверка checksums.txt с GitHub Digest:{' '}
                      {checksumMatched ? 'СОВПАДАЕТ' : 'ОШИБКА'}
                    </div>
                    <div>
                      2. Проверка ЭЦП (ключ {sigReport.signerKeyFingerprint}):{' '}
                      {sigReport.signatureVerified ? 'ПОДТВЕРЖДЕНА' : 'ОТКЛОНЕНА'}
                    </div>
                    <div className="break-all">
                      3. Ожидаемый SHA-256: {sigReport.expectedSha256}
                    </div>
                    <div className="break-all">
                      4. Проверенный SHA-256: {sigReport.computedSha256}
                    </div>
                  </div>
                  {sigReport.valid && settings.installedVersion !== activeRelease.tag_name ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...settings,
                          installedVersion: activeRelease.tag_name,
                        })
                      }
                      className="mt-3 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900"
                    >
                      Установить подтвержденное обновление {activeRelease.tag_name}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {checksumRaw ? (
                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-slate-800">
                    Содержимое официального checksums.txt ({activeRelease.tag_name})
                  </summary>
                  <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-700">
                    {checksumRaw}
                  </pre>
                </details>
              ) : null}

              {signedManifest ? (
                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-slate-800">
                    Подписанный манифест обновления (ECDSA-P256)
                  </summary>
                  <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-slate-700">
                    {JSON.stringify(signedManifest, null, 2)}
                  </pre>
                </details>
              ) : null}

              {/* Local Downloaded File Verifier */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Локальная проверка скачанного файла Windows (.zip)
                    </div>
                    <p className="text-xs text-slate-600">
                      Хэш вычисляется локально на вашем ПК без загрузки файла в сеть.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                    <FileCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Выбрать файл .zip</span>
                    <input
                      type="file"
                      onChange={handleLocalZipVerify}
                      className="sr-only"
                    />
                  </label>
                </div>

                {localFileResult ? (
                  <div
                    className={`mt-3 rounded-lg border p-3 font-mono text-xs ${
                      localFileResult.matchesOfficial
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <div>Файл: {localFileResult.filename}</div>
                    <div className="mt-1 break-all">SHA-256: {localFileResult.sha256}</div>
                    <div className="mt-1 font-sans font-semibold">
                      {localFileResult.matchesOfficial
                        ? 'Хэш полностью совпадает с официальным релизом GitHub!'
                        : 'Хэш не совпадает с выбранным релизом.'}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-slate-500">Загрузка списка релизов...</div>
          )}
        </section>
      </div>
    </div>
  );
}
