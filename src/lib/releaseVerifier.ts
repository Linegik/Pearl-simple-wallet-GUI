export interface GitHubReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest: string | null;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  body: string;
  assets: GitHubReleaseAsset[];
}

export interface ChecksumEntry {
  sha256: string;
  filename: string;
}

export interface SignatureVerificationReport {
  valid: boolean;
  checksumMatch: boolean;
  signatureVerified: boolean;
  tag: string;
  filename: string;
  expectedSha256: string | null;
  computedSha256: string | null;
  signerKeyFingerprint: string;
  reason: string;
}

export function parseSemver(tag: string): [number, number, number] {
  const cleaned = tag.trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function isUpdateAvailable(currentVersion: string, latestTag: string): boolean {
  return compareSemver(latestTag, currentVersion) > 0;
}

export function parseChecksumsTxt(raw: string): ChecksumEntry[] {
  const entries: ChecksumEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed);
    if (match) {
      entries.push({
        sha256: match[1].toLowerCase(),
        filename: match[2].trim(),
      });
    }
  }
  return entries;
}

export function normalizeAssetDigest(digest: string | null): string | null {
  if (!digest) return null;
  const cleaned = digest.trim().toLowerCase();
  if (cleaned.startsWith('sha256:')) {
    return cleaned.slice('sha256:'.length);
  }
  return /^[a-f0-9]{64}$/.test(cleaned) ? cleaned : null;
}

export type DesktopTargetPlatform = 'windows' | 'linux';

const GITHUB_REPO_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/;

export function isValidGithubRepoSlug(slug: string): boolean {
  return GITHUB_REPO_REGEX.test(slug.trim());
}

export function selectReleaseAssetForPlatform(
  release: GitHubRelease | null,
  platform: DesktopTargetPlatform,
): GitHubReleaseAsset | null {
  if (!release) return null;
  if (platform === 'windows') {
    return (
      release.assets.find(
        (a) => a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe'),
      ) ??
      release.assets.find((a) => a.name.endsWith('.exe')) ??
      release.assets.find(
        (a) => a.name.toLowerCase().includes('win') && a.name.endsWith('.zip'),
      ) ??
      null
    );
  }
  return (
    release.assets.find((a) => a.name.endsWith('.AppImage')) ??
    release.assets.find((a) => a.name.endsWith('.deb')) ??
    release.assets.find(
      (a) => a.name.toLowerCase().includes('linux') && a.name.includes('amd64') && a.name.endsWith('.tar.gz'),
    ) ??
    release.assets.find(
      (a) => a.name.toLowerCase().includes('linux') && a.name.endsWith('.tar.gz'),
    ) ??
    null
  );
}

export function verifyAssetAgainstChecksums(
  asset: GitHubReleaseAsset,
  entries: ChecksumEntry[],
): { matched: boolean; checksumSha256: string | null; apiDigestSha256: string | null } {
  const apiDigest = normalizeAssetDigest(asset.digest);
  const entry = entries.find((e) => e.filename === asset.name);
  const checksumSha256 = entry ? entry.sha256 : null;

  if (!checksumSha256 || !apiDigest) {
    return { matched: false, checksumSha256, apiDigestSha256: apiDigest };
  }
  return {
    matched: checksumSha256 === apiDigest,
    checksumSha256,
    apiDigestSha256: apiDigest,
  };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SignedReleaseManifest {
  repo: 'pearl-research-labs/pearl';
  tag: string;
  filename: string;
  sha256: string;
  signedAt: string;
  publicKeyJwk: JsonWebKey;
  signatureBase64: string;
}

export function canonicalReleaseManifestString(
  repo: string,
  tag: string,
  filename: string,
  sha256: string,
  signedAt: string,
): string {
  return `${repo}|${tag}|${filename}|${sha256.toLowerCase()}|${signedAt}`;
}

export async function createSignedReleaseManifest(params: {
  tag: string;
  filename: string;
  sha256: string;
}): Promise<{ manifest: SignedReleaseManifest; fingerprint: string }> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const signedAt = new Date().toISOString();
  const payload = canonicalReleaseManifestString(
    'pearl-research-labs/pearl',
    params.tag,
    params.filename,
    params.sha256,
    signedAt,
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(payload),
  );
  const fingerprint = (
    await sha256Hex(new TextEncoder().encode(`${publicKeyJwk.x}:${publicKeyJwk.y}`))
  ).slice(0, 16);

  return {
    manifest: {
      repo: 'pearl-research-labs/pearl',
      tag: params.tag,
      filename: params.filename,
      sha256: params.sha256.toLowerCase(),
      signedAt,
      publicKeyJwk,
      signatureBase64: bytesToBase64(new Uint8Array(sigBuf)),
    },
    fingerprint,
  };
}

export async function verifyReleaseManifestSignature(params: {
  manifest: SignedReleaseManifest;
  expectedSha256: string;
  tamperedFileSha256?: string;
}): Promise<SignatureVerificationReport> {
  const { manifest, expectedSha256, tamperedFileSha256 } = params;
  const fingerprint = (
    await sha256Hex(
      new TextEncoder().encode(`${manifest.publicKeyJwk.x}:${manifest.publicKeyJwk.y}`),
    )
  ).slice(0, 16);

  const actualSha = (tamperedFileSha256 ?? expectedSha256).toLowerCase();
  const checksumMatch = actualSha === manifest.sha256.toLowerCase();

  let signatureVerified = false;
  try {
    const pubKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      manifest.publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const canonical = canonicalReleaseManifestString(
      manifest.repo,
      manifest.tag,
      manifest.filename,
      manifest.sha256,
      manifest.signedAt,
    );
    const sigBytes = base64ToBytes(manifest.signatureBase64);
    const sigBuf = sigBytes.buffer.slice(
      sigBytes.byteOffset,
      sigBytes.byteOffset + sigBytes.byteLength,
    ) as ArrayBuffer;
    signatureVerified = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBuf,
      new TextEncoder().encode(canonical),
    );
  } catch {
    signatureVerified = false;
  }

  const valid = checksumMatch && signatureVerified;
  let reason = 'Цифровая подпись и контрольная сумма SHA-256 успешно подтверждены.';
  if (!signatureVerified) {
    reason = 'Цифровая подпись релиза недействительна — обновление заблокировано.';
  } else if (!checksumMatch) {
    reason =
      'Хэш SHA-256 скачанного файла не совпадает с подписанным манифестом — возможна подмена файла.';
  }

  return {
    valid,
    checksumMatch,
    signatureVerified,
    tag: manifest.tag,
    filename: manifest.filename,
    expectedSha256: manifest.sha256,
    computedSha256: actualSha,
    signerKeyFingerprint: fingerprint,
    reason,
  };
}
