import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSemver,
  createSignedReleaseManifest,
  isUpdateAvailable,
  parseChecksumsTxt,
  verifyAssetAgainstChecksums,
  verifyReleaseManifestSignature,
} from './releaseVerifier';

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
