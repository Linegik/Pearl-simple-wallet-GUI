import crypto from 'node:crypto';

const DEFAULT_REPO = 'pearl-research-labs/pearl';
const VALID_REPO = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/;
const VALID_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;
const PINNED_RELEASE_PUBKEY_PEM = process.env.PEARL_RELEASE_PUBKEY_PEM ?? '';

export interface DesktopUpdateResult {
  repo: string;
  platform: NodeJS.Platform;
  updateAvailable: boolean;
  latestTag: string;
  assetName: string | null;
  assetUrl: string | null;
  expectedSha256: string | null;
  checksumVerified: boolean;
  signatureVerified: boolean;
}

function selectPlatformAsset(
  assets: Array<{ name: string; browser_download_url: string; digest?: string }>,
  platform: NodeJS.Platform,
) {
  if (platform === 'win32') {
    return (
      assets.find((a) => a.name.endsWith('.exe') && a.name.toLowerCase().includes('setup')) ??
      assets.find((a) => a.name.toLowerCase().includes('win') && a.name.endsWith('.zip')) ??
      assets.find((a) => a.name.endsWith('.exe')) ??
      null
    );
  }
  if (platform === 'linux') {
    return (
      assets.find((a) => a.name.endsWith('.AppImage')) ??
      assets.find((a) => a.name.endsWith('.deb')) ??
      assets.find((a) => a.name.toLowerCase().includes('linux') && a.name.endsWith('.tar.gz')) ??
      null
    );
  }
  return null;
}

export async function checkAndVerifyGithubUpdate(
  currentVersion: string,
  repoSlug: string = DEFAULT_REPO,
): Promise<DesktopUpdateResult> {
  const safeRepo = VALID_REPO.test(repoSlug) ? repoSlug : DEFAULT_REPO;
  const apiUrl = `https://api.github.com/repos/${safeRepo}/releases/latest`;

  const res = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Pearl-Vault-Desktop/1.0',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: HTTP ${res.status}`);
  }

  const release = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; digest?: string }>;
  };

  if (!VALID_TAG.test(release.tag_name)) {
    throw new Error('Некорректный формат тега релиза.');
  }

  const targetAsset = selectPlatformAsset(release.assets, process.platform);
  const checksumAsset = release.assets.find((a) => a.name === 'checksums.txt');
  const sigAsset = release.assets.find((a) => a.name === 'checksums.txt.sig');

  let expectedSha256: string | null = null;
  let checksumVerified = false;
  let signatureVerified = false;

  if (checksumAsset && targetAsset) {
    const csText = await (await fetch(checksumAsset.browser_download_url)).text();
    const line = csText
      .split(/\r?\n/)
      .find((l) => l.trim().endsWith(targetAsset.name));
    if (line) {
      expectedSha256 = line.trim().split(/\s+/)[0].toLowerCase();
      const apiDigest = (targetAsset.digest ?? '').replace(/^sha256:/, '').toLowerCase();
      checksumVerified = Boolean(expectedSha256 && (!apiDigest || expectedSha256 === apiDigest));
    }

    if (sigAsset && PINNED_RELEASE_PUBKEY_PEM) {
      const sigBytes = Buffer.from(
        await (await fetch(sigAsset.browser_download_url)).arrayBuffer(),
      );
      signatureVerified = crypto.verify(
        null,
        Buffer.from(csText, 'utf8'),
        PINNED_RELEASE_PUBKEY_PEM,
        sigBytes,
      );
    }
  }

  return {
    repo: safeRepo,
    platform: process.platform,
    updateAvailable: release.tag_name !== currentVersion,
    latestTag: release.tag_name,
    assetName: targetAsset?.name ?? null,
    assetUrl: targetAsset?.browser_download_url ?? null,
    expectedSha256,
    checksumVerified,
    signatureVerified,
  };
}
