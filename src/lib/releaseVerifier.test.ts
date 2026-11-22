import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOneLineInstallCommand,
  buildReleaseNotesMarkdown,
  compareSemver,
  createSignedReleaseManifest,
  GitHubRelease,
  isSafeHttpsUrl,
  isUpdateAvailable,
  isValidGithubRepoSlug,
  parseChecksumsTxt,
  selectReleaseAssetForPlatform,
  verifyAssetAgainstChecksums,
  verifyReleaseManifestSignature,
} from './releaseVerifier';
import { buildGitPublishCommands, buildReleaseKitFiles } from './windowsSourceBundle';

test('Semver comparison detects newer Pearl GitHub releases accurately', () => {
  assert.equal(compareSemver('v1.5.7', 'v1.5.5'), 1);
  assert.equal(compareSemver('v1.5.5', 'v1.5.7'), -1);
  assert.equal(compareSemver('v1.5.7', '1.5.7'), 0);
  assert.equal(isUpdateAvailable('v1.5.5', 'v1.5.7'), true);
  assert.equal(isUpdateAvailable('v1.5.7', 'v1.5.7'), false);
});

test('checksums.txt parser cross-verifies GitHub release asset digest', () => {
  const raw = [
    '82b590dcdd8798e0e3298a1e78d21504cca10ccb3d21f74509171073c7893153  pearl-darwin-amd64-v1.5.7.tar.gz',
    '05dcf3a6d96f14409b0b4f5a5c6764ca60ef7b373b2f3e4b6827b4ec6a12a13e  pearl-windows-amd64-v1.5.7.zip',
  ].join('\n');

  const entries = parseChecksumsTxt(raw);
  assert.equal(entries.length, 2);

  const matchResult = verifyAssetAgainstChecksums(
    {
      name: 'pearl-windows-amd64-v1.5.7.zip',
      size: 46447652,
      browser_download_url: 'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.7/pearl-windows-amd64-v1.5.7.zip',
      digest: 'sha256:05dcf3a6d96f14409b0b4f5a5c6764ca60ef7b373b2f3e4b6827b4ec6a12a13e',
      content_type: 'application/zip',
    },
    entries,
  );
  assert.equal(matchResult.matched, true);

  const mismatchResult = verifyAssetAgainstChecksums(
    {
      name: 'pearl-windows-amd64-v1.5.7.zip',
      size: 46447652,
      browser_download_url: 'https://github.com/pearl-research-labs/pearl/releases/download/v1.5.7/pearl-windows-amd64-v1.5.7.zip',
      digest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      content_type: 'application/zip',
    },
    entries,
  );
  assert.equal(mismatchResult.matched, false);
});

test('Release digital signature verifier accepts valid signed manifest and rejects tampered hashes or signatures', async () => {
  const expectedSha = '05dcf3a6d96f14409b0b4f5a5c6764ca60ef7b373b2f3e4b6827b4ec6a12a13e';
  const { manifest } = await createSignedReleaseManifest({
    tag: 'v1.5.7',
    filename: 'pearl-windows-amd64-v1.5.7.zip',
    sha256: expectedSha,
  });

  const validReport = await verifyReleaseManifestSignature({
    manifest,
    expectedSha256: expectedSha,
  });
  assert.equal(validReport.valid, true);
  assert.equal(validReport.signatureVerified, true);
  assert.equal(validReport.checksumMatch, true);

  // Tampered file hash fails
  const tamperedFileReport = await verifyReleaseManifestSignature({
    manifest,
    expectedSha256: expectedSha,
    tamperedFileSha256: '1111111111111111111111111111111111111111111111111111111111111111',
  });
  assert.equal(tamperedFileReport.valid, false);
  assert.equal(tamperedFileReport.checksumMatch, false);

  // Tampered signature fails
  const tamperedSigManifest = {
    ...manifest,
    signatureBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  };
  const tamperedSigReport = await verifyReleaseManifestSignature({
    manifest: tamperedSigManifest,
    expectedSha256: expectedSha,
  });
  assert.equal(tamperedSigReport.valid, false);
  assert.equal(tamperedSigReport.signatureVerified, false);
});

test('Platform asset selector, one-line commands, and release notes support Windows, Ubuntu, and Linux', () => {
  const sampleRelease: GitHubRelease = {
    id: 1,
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    prerelease: false,
    published_at: '2026-11-21T00:00:00Z',
    html_url: 'https://github.com/acme/pearl-vault/releases/tag/v1.0.0',
    body: '',
    assets: [
      {
        name: 'Pearl-Vault-1.0.0-win-x64.exe',
        size: 50_000_000,
        browser_download_url: 'https://example.com/win.exe',
        digest: null,
        content_type: 'application/octet-stream',
      },
      {
        name: 'Pearl-Vault-1.0.0-linux-x64.deb',
        size: 48_000_000,
        browser_download_url: 'https://example.com/ubuntu.deb',
        digest: null,
        content_type: 'application/vnd.debian.binary-package',
      },
      {
        name: 'Pearl-Vault-1.0.0-linux-x64.AppImage',
        size: 52_000_000,
        browser_download_url: 'https://example.com/linux.AppImage',
        digest: null,
        content_type: 'application/octet-stream',
      },
    ],
  };

  assert.equal(
    selectReleaseAssetForPlatform(sampleRelease, 'windows')?.name,
    'Pearl-Vault-1.0.0-win-x64.exe',
  );
  assert.equal(
    selectReleaseAssetForPlatform(sampleRelease, 'ubuntu')?.name,
    'Pearl-Vault-1.0.0-linux-x64.deb',
  );
  assert.equal(
    selectReleaseAssetForPlatform(sampleRelease, 'linux')?.name,
    'Pearl-Vault-1.0.0-linux-x64.AppImage',
  );

  assert.equal(isSafeHttpsUrl('https://github.com/acme/pearl/releases'), true);
  assert.equal(isSafeHttpsUrl('javascript:alert(1)'), false);

  const ubuntuCmd = buildOneLineInstallCommand(
    'ubuntu',
    'https://github.com/acme/pearl/releases/download/v1.0.0/Pearl-Vault-1.0.0-linux-x64.deb',
  );
  assert.match(ubuntuCmd, /sudo apt install -y/);

  const linuxCmd = buildOneLineInstallCommand(
    'linux',
    'https://github.com/acme/pearl/releases/download/v1.0.0/Pearl-Vault-1.0.0-linux-x64.AppImage',
  );
  assert.match(linuxCmd, /chmod \+x/);

  const md = buildReleaseNotesMarkdown({ repoSlug: 'acme/pearl-vault', tag: 'v1.0.0' });
  assert.match(md, /Ubuntu \/ Debian/);
  assert.match(md, /AppImage/);

  assert.equal(isValidGithubRepoSlug('acme/pearl-vault'), true);
  assert.equal(isValidGithubRepoSlug('https://evil.com/foo'), false);

  const commands = buildGitPublishCommands('acme/pearl-vault', 'v1.0.0');
  assert.match(commands, /github\.com\/acme\/pearl-vault\.git/);
  assert.match(commands, /git tag v1\.0\.0/);

  const files = buildReleaseKitFiles('acme/pearl-vault', 'v1.0.0');
  const workflow = files.find((f) => f.path === '.github/workflows/release.yml');
  assert.ok(workflow);
  assert.match(workflow.content, /--win nsis portable/);
  assert.match(workflow.content, /--linux AppImage deb tar\.gz/);
});
