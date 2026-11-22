import { useState } from 'react';
import JSZip from 'jszip';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import { WINDOWS_OPEN_SOURCE_FILES } from '../lib/windowsSourceBundle';

export function WindowsSourceView() {
  const [selectedPath, setSelectedPath] = useState(WINDOWS_OPEN_SOURCE_FILES[0].path);
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const activeFile =
    WINDOWS_OPEN_SOURCE_FILES.find((f) => f.path === selectedPath) ?? WINDOWS_OPEN_SOURCE_FILES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard failure in headless mode
    }
  };

  const handleDownloadSourceZip = async () => {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      for (const file of WINDOWS_OPEN_SOURCE_FILES) {
        zip.file(file.path, file.content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pearl-vault-windows-opensource.zip';
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
            Открытый исходный код для Windows (Apache-2.0)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Проверяемый код десктопного клиента Windows (Electron + DPAPI safeStorage +
            подписанный автообновлятор GitHub).
          </p>
        </div>

        <button
          type="button"
          disabled={downloadingZip}
          onClick={handleDownloadSourceZip}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 md:self-auto whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>{downloadingZip ? 'Упаковка .zip...' : 'Скачать исходный код (.zip)'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-4">
          {WINDOWS_OPEN_SOURCE_FILES.map((file) => {
            const active = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                  <FileCode2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{file.path}</span>
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
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              {copied ? (
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
