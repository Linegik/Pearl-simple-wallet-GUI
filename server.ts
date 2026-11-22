import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REPO = 'pearl-research-labs/pearl';
const VALID_REPO_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/;
const VALID_TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;

function resolveSafeRepo(rawRepo: unknown): string {
  if (typeof rawRepo === 'string') {
    const trimmed = rawRepo.trim();
    if (VALID_REPO_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_REPO;
}

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest: string | null;
  content_type: string;
}

interface NormalizedRelease {
  id: number;
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  body: string;
  assets: ReleaseAsset[];
}

const FALLBACK_RELEASES: NormalizedRelease[] = [
  {
    id: 200157,
    tag_name: 'v1.5.7',
    name: 'Release v1.5.7',
    prerelease: false,
    published_at: '2026-11-12T17:28:09Z',
    html_url: 'https://github.com/pearl-research-labs/pearl/releases/tag/v1.5.7',
    body: '## What\'s Changed\n* feat(node): add Prometheus metrics endpoint to pearld\n* fix(chaincfg): reschedule testnet rank-penalty fork above the rank-64 blocks\n* security: harden P2P decoding, peer replies, SigCache and adjusted time',
    assets: [
      {
        name: 'checksums.txt',
        size: 491,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.7/checksums.txt',
        digest: 'sha256:945d40572eb99649aeb7ccefa12d1ef7f75400fb7b30ab541f020a34017447d1',
        content_type: 'text/plain; charset=utf-8',
      },
      {
        name: 'pearl-windows-amd64-v1.5.7.zip',
        size: 46447652,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.7/pearl-windows-amd64-v1.5.7.zip',
        digest: 'sha256:05dcf3a6d96f14409b0b4f5a5c6764ca60ef7b373b2f3e4b6827b4ec6a12a13e',
        content_type: 'application/zip',
      },
      {
        name: 'pearl-linux-amd64-v1.5.7.tar.gz',
        size: 51879536,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.7/pearl-linux-amd64-v1.5.7.tar.gz',
        digest: 'sha256:4adb61e6ccf561d57b11da304325922f08e757605ccc7fe9fdc67cd7e2dcab0d',
        content_type: 'application/gzip',
      },
    ],
  },
  {
    id: 200155,
    tag_name: 'v1.5.5',
    name: 'Release v1.5.5',
    prerelease: false,
    published_at: '2026-10-28T17:18:01Z',
    html_url: 'https://github.com/pearl-research-labs/pearl/releases/tag/v1.5.5',
    body: '## What\'s Changed\n* security: XMSS verification bounds and SPV compact filter hardening\n* feat(wallet): Oyster testnet address validation improvements',
    assets: [
      {
        name: 'checksums.txt',
        size: 491,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.5/checksums.txt',
        digest: 'sha256:11e2468115b07db51bf4ee856f1f9fb16aa804fc752ff20485701e597be965e8',
        content_type: 'text/plain; charset=utf-8',
      },
      {
        name: 'pearl-windows-amd64-v1.5.5.zip',
        size: 44797938,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.5/pearl-windows-amd64-v1.5.5.zip',
        digest: 'sha256:9b13e1ff60a55d70d53f73104f0b81bdf84170104a01746b56b6b7590f657aa7',
        content_type: 'application/zip',
      },
      {
        name: 'pearl-linux-amd64-v1.5.5.tar.gz',
        size: 50374488,
        browser_download_url:
          'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.5/pearl-linux-amd64-v1.5.5.tar.gz',
        digest: 'sha256:dfc545ec64b4109a86748ebd924469c2a744184a8e783673c9f862671769bd19',
        content_type: 'application/gzip',
      },
    ],
  },
];

const FALLBACK_CHECKSUMS: Record<string, string> = {
  'v1.5.7': [
    '82b590dcdd8798e0e3298a1e78d21504cca10ccb3d21f74509171073c7893153  pearl-darwin-amd64-v1.5.7.tar.gz',
    '73f7ecec43546d6c187544c0ab3ee720ed3777fa802aa48a6820d04dc27b9f94  pearl-darwin-arm64-v1.5.7.tar.gz',
    '4adb61e6ccf561d57b11da304325922f08e757605ccc7fe9fdc67cd7e2dcab0d  pearl-linux-amd64-v1.5.7.tar.gz',
    '5aa2689d5dd2a515992451aee5b2512664ef9defffb29700704c380610fd8b30  pearl-linux-arm64-v1.5.7.tar.gz',
    '05dcf3a6d96f14409b0b4f5a5c6764ca60ef7b373b2f3e4b6827b4ec6a12a13e  pearl-windows-amd64-v1.5.7.zip',
  ].join('\n'),
  'v1.5.5': [
    'dfc545ec64b4109a86748ebd924469c2a744184a8e783673c9f862671769bd19  pearl-linux-amd64-v1.5.5.tar.gz',
    '9b13e1ff60a55d70d53f73104f0b81bdf84170104a01746b56b6b7590f657aa7  pearl-windows-amd64-v1.5.5.zip',
  ].join('\n'),
};

const releaseCache = new Map<
  string,
  { fetchedAt: number; source: string; releases: NormalizedRelease[] }
>();
const CACHE_TTL_MS = 60_000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', repo: DEFAULT_REPO });
  });

  app.get('/api/releases', async (req, res) => {
    const repo = resolveSafeRepo(req.query.repo);
    const forceRefresh = req.query.refresh === '1';
    const now = Date.now();
    const cached = releaseCache.get(repo);

    if (!forceRefresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      res.json({
        repo,
        source: cached.source,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        releases: cached.releases,
      });
      return;
    }

    const githubUrl = `https://api.github.com/repos/${repo}/releases?per_page=8`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(githubUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Pearl-Vault-Desktop-Updater/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`GitHub API HTTP ${response.status}`);
      }

      const raw = (await response.json()) as Array<Record<string, unknown>>;
      const releases: NormalizedRelease[] = raw.map((r) => ({
        id: Number(r.id ?? 0),
        tag_name: String(r.tag_name ?? ''),
        name: String(r.name ?? r.tag_name ?? ''),
        prerelease: Boolean(r.prerelease),
        published_at: String(r.published_at ?? ''),
        html_url: String(r.html_url ?? `https://github.com/${repo}/releases`),
        body: String(r.body ?? ''),
        assets: Array.isArray(r.assets)
          ? (r.assets as Array<Record<string, unknown>>).map((a) => ({
              name: String(a.name ?? ''),
              size: Number(a.size ?? 0),
              browser_download_url: String(a.browser_download_url ?? ''),
              digest: typeof a.digest === 'string' ? a.digest : null,
              content_type: String(a.content_type ?? 'application/octet-stream'),
            }))
          : [],
      }));

      releaseCache.set(repo, { fetchedAt: now, source: 'github_live', releases });
      res.json({
        repo,
        source: 'github_live',
        fetchedAt: new Date(now).toISOString(),
        releases,
      });
    } catch {
      if (repo === DEFAULT_REPO) {
        res.json({
          repo,
          source: 'cached_snapshot',
          fetchedAt: new Date(now).toISOString(),
          releases: FALLBACK_RELEASES,
        });
      } else {
        res.status(404).json({
          error: `Не удалось получить релизы для ${repo}. Проверьте, что репозиторий публичный и опубликован хотя бы 1 релиз.`,
        });
      }
    }
  });

  app.get('/api/releases/checksums', async (req, res) => {
    const repo = resolveSafeRepo(req.query.repo);
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
    if (!VALID_TAG_REGEX.test(tag)) {
      res.status(400).json({ error: 'Invalid release tag format' });
      return;
    }

    const targetUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/checksums.txt`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Pearl-Vault-Desktop-Updater/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const rawText = await response.text();
      res.json({
        repo,
        tag,
        source: 'github_live',
        url: targetUrl,
        raw: rawText,
      });
    } catch {
      const fallback = repo === DEFAULT_REPO ? FALLBACK_CHECKSUMS[tag] : undefined;
      if (fallback) {
        res.json({
          repo,
          tag,
          source: 'cached_snapshot',
          url: targetUrl,
          raw: fallback,
        });
      } else {
        res.status(404).json({ error: 'checksums.txt not found for tag' });
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pearl Vault server listening on http://localhost:${PORT}`);
  });
}

startServer();
