import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCheck,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  buildOneLineInstallCommand,
  createSignedReleaseManifest,
  DesktopTargetPlatform,
  GitHubRelease,
  isSafeHttpsUrl,
  isUpdateAvailable,
  isValidGithubRepoSlug,
  normalizeAssetDigest,
  parseChecksumsTxt,
  selectReleaseAssetForPlatform,
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
  activeRepo: string;
  repoError: string | null;
  isChecking: boolean;
  onCheckReleases: (force?: boolean, repo?: string) => Promise<void>;
}

const PLATFORM_OPTIONS: Array<{ id: DesktopTargetPlatform; label: string }> = [
  { id: 'windows', label: 'Windows (x64)' },
  { id: 'ubuntu', label: 'Ubuntu (.deb)' },
  { id: 'linux', label: 'Linux (AppImage / tar.gz)' },
];

export function UpdaterView({
  settings,
  onUpdateSettings,
  releases,
  releaseSource,
  activeRepo,
  repoError,
  isChecking,
  onCheckReleases,
}: UpdaterViewProps) {
  const [targetPlatform, setTargetPlatform] = useState<DesktopTargetPlatform>('windows');
  const [repoInput, setRepoInput] = useState(activeRepo);
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
  const [copiedCmd, setCopiedCmd] = useState(false);

  const customLinks = settings.customInstallerLinks ?? {
    windowsUrl: '',
    ubuntuUrl: '',
    linuxUrl: '',
  };

  const [winUrlInput, setWinUrlInput] = useState(customLinks.windowsUrl);
  const [ubuntuUrlInput, setUbuntuUrlInput] = useState(customLinks.ubuntuUrl);
  const [linuxUrlInput, setLinuxUrlInput] = useState(customLinks.linuxUrl);
  const [linksSavedMsg, setLinksSavedMsg] = useState<string | null>(null);

  const filteredReleases = releases.filter((r) => settings.includePrerelease || !r.prerelease);
  const latestRelease = filteredReleases[0] ?? null;
  const activeRelease =
    filteredReleases.find((r) => r.tag_name === selectedTag) ?? latestRelease ?? null;

  const targetAsset = selectReleaseAssetForPlatform(activeRelease, targetPlatform);

  const customUrlForPlatform =
    targetPlatform === 'windows'
      ? customLinks.windowsUrl
      : targetPlatform === 'ubuntu'
        ? customLinks.ubuntuUrl
        : customLinks.linuxUrl;

  const effectiveDownloadUrl = isSafeHttpsUrl(customUrlForPlatform)
    ? customUrlForPlatform.trim()
    : targetAsset?.browser_download_url ?? '';

  const effectiveFilename = isSafeHttpsUrl(customUrlForPlatform)
    ? customUrlForPlatform.trim().split('/').pop()?.split('?')[0]
    : targetAsset?.name;

  const oneLineCommand = effectiveDownloadUrl
    ? buildOneLineInstallCommand(targetPlatform, effectiveDownloadUrl, effectiveFilename)
    : '';

  const hasUpdate = latestRelease
    ? isUpdateAvailable(settings.installedVersion, latestRelease.tag_name)
    : false;

  useEffect(() => {
    if (activeRelease && !selectedTag) {
      setSelectedTag(activeRelease.tag_name);
    }
  }, [activeRelease, selectedTag]);

  const handleRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidGithubRepoSlug(repoInput)) return;
    setSelectedTag('');
    setSigReport(null);
    setChecksumMatched(null);
    void onCheckReleases(true, repoInput.trim());
  };

  const handleSaveCustomLinks = (e: React.FormEvent) => {
    e.preventDefault();
    setLinksSavedMsg(null);
    onUpdateSettings({
      ...settings,
      customInstallerLinks: {
        windowsUrl: isSafeHttpsUrl(winUrlInput) ? winUrlInput.trim() : '',
        ubuntuUrl: isSafeHttpsUrl(ubuntuUrlInput) ? ubuntuUrlInput.trim() : '',
        linuxUrl: isSafeHttpsUrl(linuxUrlInput) ? linuxUrlInput.trim() : '',
      },
    });
    setLinksSavedMsg('Ссылки на установщики сохранены в списке релизов.');
    setTimeout(() => setLinksSavedMsg(null), 3000);
  };

  const handleCopyCommand = async () => {
    if (!oneLineCommand) return;
    try {
      await navigator.clipboard.writeText(oneLineCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2500);
    } catch {
      // Ignore clipboard failure in headless mode
    }
  };

  const runSignatureAndChecksumVerification = async (tamperMode: boolean) => {
    if (!activeRelease || !targetAsset) return;
    setIsVerifying(true);
    try {
      const res = await fetch(
        `/api/releases/checksums?tag=${encodeURIComponent(activeRelease.tag_name)}&repo=${encodeURIComponent(activeRepo)}`,
      );
      if (!res.ok) {
        throw new Error('Не удалось загрузить checksums.txt для релиза.');
      }
      const data = (await res.json()) as { raw: string };
      setChecksumRaw(data.raw);
      const entries = parseChecksumsTxt(data.raw);
      const assetCheck = verifyAssetAgainstChecksums(targetAsset, entries);
      setChecksumMatched(assetCheck.matched);

      const expectedSha =
        assetCheck.checksumSha256 ?? normalizeAssetDigest(targetAsset.digest) ?? '';

      const { manifest } = await createSignedReleaseManifest({
        tag: activeRelease.tag_name,
        filename: targetAsset.name,
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

  const handleLocalFileVerify = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetAsset) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const computed = await sha256Hex(buf);
    const official = normalizeAssetDigest(targetAsset.digest);
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
            Релизы и автообновление (Windows / Ubuntu / Linux)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Репозиторий{' '}
            <a
              href={`https://github.com/${activeRepo}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              {activeRepo}
            </a>{' '}
            · Скачивание установщиков, запуск в 1 команду и проверка подписи.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1">
            {PLATFORM_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setTargetPlatform(opt.id);
                  setSigReport(null);
                  setChecksumMatched(null);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  targetPlatform === opt.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={isChecking}
            onClick={() => onCheckReleases(true, activeRepo)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isChecking ? 'Проверка GitHub...' : 'Проверить обновления'}</span>
          </button>
        </div>
      </div>

      {/* Auto-Update Policy & Repo Switcher */}
      <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-6">
          <div className="text-xs font-medium text-slate-500">
            Состояние клиента (
            {targetPlatform === 'windows'
              ? 'Windows x64'
              : targetPlatform === 'ubuntu'
                ? 'Ubuntu / Debian (.deb)'
                : 'Linux (AppImage / tar.gz)'}
            )
          </div>
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
          <form onSubmit={handleRepoSubmit} className="flex flex-wrap items-center gap-2">
            <label htmlFor="github-repo-input" className="text-xs font-medium text-slate-700">
              Репозиторий GitHub:
            </label>
            <input
              id="github-repo-input"
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repo"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-2.5 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              Подключить
            </button>
          </form>

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
              <span>Автопроверка при запуске</span>
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
              <span>Требовать цифровую подпись</span>
            </label>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="sim-installed-ver" className="text-slate-600">
                Версия:
              </label>
              <select
                id="sim-installed-ver"
                value={settings.installedVersion}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, installedVersion: e.target.value })
                }
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
              >
                <option value="v1.5.5">v1.5.5</option>
                <option value="v1.5.7">v1.5.7</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Custom Download Links for Ubuntu / Linux / Windows */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Link2 className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <span>Добавить прямые ссылки на установщики в релизы (Ubuntu / Linux / Windows)</span>
          </div>
          {linksSavedMsg ? (
            <span className="text-xs font-medium text-emerald-700">{linksSavedMsg}</span>
          ) : null}
        </div>
        <form
          onSubmit={handleSaveCustomLinks}
          className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12"
        >
          <div className="md:col-span-3">
            <label htmlFor="custom-ubuntu-url" className="mb-1 block text-xs font-medium text-slate-700">
              Ubuntu (.deb) HTTPS URL
            </label>
            <input
              id="custom-ubuntu-url"
              type="url"
              value={ubuntuUrlInput}
              onChange={(e) => setUbuntuUrlInput(e.target.value)}
              placeholder="https://github.com/.../pearl-vault.deb"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div className="md:col-span-4">
            <label htmlFor="custom-linux-url" className="mb-1 block text-xs font-medium text-slate-700">
              Linux (.AppImage / .tar.gz) HTTPS URL
            </label>
            <input
              id="custom-linux-url"
              type="url"
              value={linuxUrlInput}
              onChange={(e) => setLinuxUrlInput(e.target.value)}
              placeholder="https://github.com/.../Pearl-Vault.AppImage"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div className="md:col-span-3">
            <label htmlFor="custom-win-url" className="mb-1 block text-xs font-medium text-slate-700">
              Windows (.exe / .zip) HTTPS URL
            </label>
            <input
              id="custom-win-url"
              type="url"
              value={winUrlInput}
              onChange={(e) => setWinUrlInput(e.target.value)}
              placeholder="https://github.com/.../Pearl-Vault-Setup.exe"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              Сохранить ссылки
            </button>
          </div>
        </form>
      </section>

      {repoError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {repoError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Official GitHub Releases Table */}
        <section className="rounded-xl border border-slate-200 bg-white xl:col-span-6">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Релизы для{' '}
              {targetPlatform === 'windows'
                ? 'Windows (x64)'
                : targetPlatform === 'ubuntu'
                  ? 'Ubuntu (.deb)'
                  : 'Linux (AppImage / tar.gz)'}
            </h2>
            <a
              href={`https://github.com/${activeRepo}/releases`}
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
              const asset = selectReleaseAssetForPlatform(rel, targetPlatform);
              const isSelected = activeRelease?.tag_name === rel.tag_name;
              const downloadHref =
                isSelected && isSafeHttpsUrl(customUrlForPlatform)
                  ? customUrlForPlatform.trim()
                  : asset?.browser_download_url;
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
                    {asset ? (
                      <div className="mt-1 truncate font-mono text-xs text-slate-600 tabular-nums">
                        {asset.name} · {(asset.size / (1024 * 1024)).toFixed(1)} МБ
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-400">
                        Пакет для выбранной ОС не найден
                      </div>
                    )}
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
                      {isSelected ? 'Выбран' : 'Выбрать'}
                    </button>
                    {downloadHref ? (
                      <a
                        href={downloadHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Скачать</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: One-Line Launch + Digital Signature & SHA-256 Verifier */}
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 xl:col-span-6">
          {/* One-Command Launch Box */}
          {oneLineCommand ? (
            <div className="border-b border-slate-200 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Terminal className="h-4 w-4 text-blue-700" aria-hidden="true" />
                  <span>
                    Запуск в 1 команду (
                    {targetPlatform === 'windows'
                      ? 'Windows PowerShell'
                      : targetPlatform === 'ubuntu'
                        ? 'Ubuntu / Debian'
                        : 'Linux'}
                    )
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={effectiveDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Скачать</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {copiedCmd ? (
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
                </div>
              </div>
              <pre className="mt-2.5 whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100">
                <code>{oneLineCommand}</code>
              </pre>
            </div>
          ) : null}

          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Криптографическая проверка подписи релиза
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Сверка контрольных сумм <code className="font-mono">checksums.txt</code> с дайджестом
              GitHub API и проверка цифровой подписи ECDSA-P256-SHA256.
            </p>

            {activeRelease && targetAsset ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs">
                  <div className="text-slate-500">Пакет: {targetAsset.name}</div>
                  <div className="mt-1 break-all text-slate-900">
                    GitHub API SHA-256: {normalizeAssetDigest(targetAsset.digest) ?? 'не указан'}
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

                <div className="border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Локальная проверка скачанного файла (.exe / .deb / .AppImage / .zip)
                      </div>
                      <p className="text-xs text-slate-600">
                        Хэш вычисляется локально на вашем ПК без загрузки файла в сеть.
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                      <FileCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Выбрать пакет</span>
                      <input type="file" onChange={handleLocalFileVerify} className="sr-only" />
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
              <div className="mt-4 text-sm text-slate-500">
                Пакет для выбранной платформы отсутствует в этом релизе — укажите свою прямую
                ссылку выше или выберите другой релиз.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
