import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  Link2,
  Package,
  Terminal,
} from 'lucide-react';
import {
  buildOneLineInstallCommand,
  buildReleaseNotesMarkdown,
  isSafeHttpsUrl,
  isValidGithubRepoSlug,
} from '../lib/releaseVerifier';
import { buildGitPublishCommands, buildReleaseKitFiles } from '../lib/windowsSourceBundle';

export function WindowsSourceView() {
  const [repoSlug, setRepoSlug] = useState('your-org/pearl-vault');
  const [releaseTag, setReleaseTag] = useState('v1.0.0');
  const [ubuntuUrl, setUbuntuUrl] = useState('');
  const [linuxUrl, setLinuxUrl] = useState('');
  const [windowsUrl, setWindowsUrl] = useState('');
  const [selectedPath, setSelectedPath] = useState('.github/workflows/release.yml');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedGit, setCopiedGit] = useState(false);
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [copiedOsCmd, setCopiedOsCmd] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const safeRepo = isValidGithubRepoSlug(repoSlug)
    ? repoSlug.trim()
    : 'your-org/pearl-vault';
  const safeTag = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(releaseTag.trim())
    ? releaseTag.trim()
    : 'v1.0.0';
  const versionClean = safeTag.replace(/^v/i, '');

  const resolvedUbuntuUrl = isSafeHttpsUrl(ubuntuUrl)
    ? ubuntuUrl.trim()
    : `https://github.com/${safeRepo}/releases/download/${safeTag}/Pearl-Vault-${versionClean}-linux-x64.deb`;
  const resolvedLinuxUrl = isSafeHttpsUrl(linuxUrl)
    ? linuxUrl.trim()
    : `https://github.com/${safeRepo}/releases/download/${safeTag}/Pearl-Vault-${versionClean}-linux-x64.AppImage`;
  const resolvedWindowsUrl = isSafeHttpsUrl(windowsUrl)
    ? windowsUrl.trim()
    : `https://github.com/${safeRepo}/releases/download/${safeTag}/Pearl-Vault-${versionClean}-win-x64.exe`;

  const files = useMemo(
    () => buildReleaseKitFiles(repoSlug, releaseTag),
    [repoSlug, releaseTag],
  );
  const gitCommands = useMemo(
    () => buildGitPublishCommands(repoSlug, releaseTag),
    [repoSlug, releaseTag],
  );
  const releaseNotesMd = useMemo(
    () =>
      buildReleaseNotesMarkdown({
        repoSlug,
        tag: releaseTag,
        windowsUrl: resolvedWindowsUrl,
        ubuntuUrl: resolvedUbuntuUrl,
        linuxUrl: resolvedLinuxUrl,
      }),
    [repoSlug, releaseTag, resolvedWindowsUrl, resolvedUbuntuUrl, resolvedLinuxUrl],
  );

  const oneLineCommands = useMemo(
    () => [
      {
        id: 'ubuntu',
        title: 'Ubuntu / Debian (.deb) — запуск в 1 команду',
        cmd: buildOneLineInstallCommand('ubuntu', resolvedUbuntuUrl),
        href: resolvedUbuntuUrl,
      },
      {
        id: 'linux',
        title: 'Linux (.AppImage) — запуск в 1 команду',
        cmd: buildOneLineInstallCommand('linux', resolvedLinuxUrl),
        href: resolvedLinuxUrl,
      },
      {
        id: 'windows',
        title: 'Windows (PowerShell .exe) — запуск в 1 команду',
        cmd: buildOneLineInstallCommand('windows', resolvedWindowsUrl),
        href: resolvedWindowsUrl,
      },
    ],
    [resolvedUbuntuUrl, resolvedLinuxUrl, resolvedWindowsUrl],
  );

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];
  const repoValid = isValidGithubRepoSlug(repoSlug);

  const copyText = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onDone();
    } catch {
      // Ignore clipboard failure in headless mode
    }
  };

  const handleDownloadReleaseKitZip = async () => {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.path, file.content);
      }
      zip.file('RELEASE_NOTES.md', releaseNotesMd);
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pearl-vault-github-win-linux-${safeTag}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Выгрузка на GitHub и первый релиз (Windows, Ubuntu, Linux)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            CI/CD конвейер, прямые ссылки для скачивания установщиков и команды запуска в 1 строку.
          </p>
        </div>

        <button
          type="button"
          disabled={downloadingZip}
          onClick={handleDownloadReleaseKitZip}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 md:self-auto whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>
            {downloadingZip ? 'Упаковка .zip...' : 'Скачать комплект GitHub (.zip)'}
          </span>
        </button>
      </div>

      {/* GitHub Repo & First Release Configurator */}
      <section className="grid grid-cols-1 gap-6 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <GitBranch className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <span>1. Параметры вашего GitHub-репозитория</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="kit-repo-slug" className="mb-1 block text-xs font-medium text-slate-700">
                Репозиторий (owner/repo)
              </label>
              <input
                id="kit-repo-slug"
                type="text"
                value={repoSlug}
                onChange={(e) => setRepoSlug(e.target.value)}
                placeholder="your-org/pearl-vault"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="kit-release-tag" className="mb-1 block text-xs font-medium text-slate-700">
                Тег первого релиза
              </label>
              <input
                id="kit-release-tag"
                type="text"
                value={releaseTag}
                onChange={(e) => setReleaseTag(e.target.value)}
                placeholder="v1.0.0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {!repoValid ? (
            <p className="text-xs text-red-700">
              Введите имя репозитория в формате <code className="font-mono">owner/repo</code>.
            </p>
          ) : null}

          <div className="space-y-2 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Link2 className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <span>Свои ссылки на установщики (необязательно — иначе берутся из GitHub Releases):</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label htmlFor="kit-ubuntu-url" className="mb-1 block text-[11px] font-medium text-slate-600">
                  Ubuntu (.deb) URL
                </label>
                <input
                  id="kit-ubuntu-url"
                  type="url"
                  value={ubuntuUrl}
                  onChange={(e) => setUbuntuUrl(e.target.value)}
                  placeholder="https://.../pearl.deb"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="kit-linux-url" className="mb-1 block text-[11px] font-medium text-slate-600">
                  Linux (.AppImage) URL
                </label>
                <input
                  id="kit-linux-url"
                  type="url"
                  value={linuxUrl}
                  onChange={(e) => setLinuxUrl(e.target.value)}
                  placeholder="https://.../Pearl.AppImage"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="kit-win-url" className="mb-1 block text-[11px] font-medium text-slate-600">
                  Windows (.exe) URL
                </label>
                <input
                  id="kit-win-url"
                  type="url"
                  value={windowsUrl}
                  onChange={(e) => setWindowsUrl(e.target.value)}
                  placeholder="https://.../Pearl.exe"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Package className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <span>Что соберет GitHub Actions после push тега {safeTag}:</span>
            </div>
            <div className="grid grid-cols-1 gap-2 font-mono text-xs text-slate-700 sm:grid-cols-2">
              <div>
                <div className="font-sans font-semibold text-slate-900">Windows (x64)</div>
                <div>· Pearl-Vault-{versionClean}-win-x64.exe</div>
                <div>· Portable .exe + .zip</div>
              </div>
              <div>
                <div className="font-sans font-semibold text-slate-900">Ubuntu & Linux (x64)</div>
                <div>· Pearl-Vault-{versionClean}-linux-x64.deb</div>
                <div>· Pearl-Vault-{versionClean}-linux-x64.AppImage</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between border-t border-slate-200 pt-4 lg:col-span-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              2. Команды публикации первого релиза
            </span>
            <button
              type="button"
              onClick={() =>
                copyText(gitCommands, () => {
                  setCopiedGit(true);
                  setTimeout(() => setCopiedGit(false), 2500);
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              {copiedGit ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Копировать команды</span>
                </>
              )}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
            <code>{gitCommands}</code>
          </pre>

          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Описание релиза (Markdown с прямыми ссылками для Ubuntu/Linux/Windows)
              </span>
              <button
                type="button"
                onClick={() =>
                  copyText(releaseNotesMd, () => {
                    setCopiedNotes(true);
                    setTimeout(() => setCopiedNotes(false), 2500);
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
              >
                {copiedNotes ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                    <span>Markdown скопирован</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Копировать Markdown</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* One-Command Launch Instructions for Ubuntu, Linux, Windows */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Terminal className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <span>3. Легкая инструкция запуска в одну команду (Ubuntu, Linux, Windows)</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {oneLineCommands.map((item) => (
            <div key={item.id} className="flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">{item.title}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Ссылка
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(item.cmd, () => {
                        setCopiedOsCmd(item.id);
                        setTimeout(() => setCopiedOsCmd(null), 2500);
                      })
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                  >
                    {copiedOsCmd === item.id ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                <code>{item.cmd}</code>
              </pre>
            </div>
          ))}
        </div>
      </section>

      {/* File Browser */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-4">
          {files.map((file) => {
            const active = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                  <FileCode2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{file.path}</span>
                </div>
                <p
                  className={`mt-1 text-xs ${
                    active ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  {file.summary}
                </p>
              </button>
            );
          })}
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <span className="font-mono text-xs font-semibold text-slate-900">
              {activeFile.path}
            </span>
            <button
              type="button"
              onClick={() =>
                copyText(activeFile.content, () => {
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2500);
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              {copiedCode ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Копировать код</span>
                </>
              )}
            </button>
          </div>
          <pre className="max-h-[540px] overflow-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
            <code>{activeFile.content}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
