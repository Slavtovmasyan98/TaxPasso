// Explicit read-only catalog check. Missing configuration is a failure, never a skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('025: five enabled AFTER DELETE row triggers call the audit function', () => {
  const url = process.env.STAGING_DB_URL || process.env.LOCAL_DB_URL;
  assert.ok(url, 'STAGING_DB_URL (or LOCAL_DB_URL in CI) is required');
  const sql = fileURLToPath(new URL('../scripts/verify_delete_audit.sql', import.meta.url));
  const result = spawnSync('psql', ['--dbname', url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sql], {
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
    encoding: 'utf8', timeout: 30000,
  });
  // Never print connection diagnostics: they may contain credentials or endpoint details.
  assert.equal(result.status, 0, 'Delete-audit catalog check failed; check psql availability, connection and trigger definitions');
  console.log(result.stdout);
});
