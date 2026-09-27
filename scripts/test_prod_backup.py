import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from prod_backup import backup


class BackupGuards(unittest.TestCase):
    def run_backup(self, fail_dump=False):
        real_run = subprocess.run
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / "gnupg"
            home.mkdir(mode=0o700)
            env = {"RUNNER_TEMP": folder, "GNUPGHOME": str(home),
                   "DB_URL": "postgresql://postgres:test@db.mhjxjxteorjwkvqbznfl.supabase.co:5432/postgres",
                   "BACKUP_PASSPHRASE": "test-only-backup-passphrase-12345"}

            def fake_database(command, **kwargs):
                if command[0] == "psql":
                    return subprocess.CompletedProcess(command, 0, "170001\n", "")
                if command[0] == "docker":
                    if "pg_dump" in command:
                        kwargs["stdout"].write(b"Test fixture: no production data\n")
                        return subprocess.CompletedProcess(command, 1 if fail_dump else 0, b"", b"")
                    return subprocess.CompletedProcess(command, 0, b"TABLE DATA supabase_migrations schema_migrations", b"")
                return real_run(command, **kwargs)

            with patch.dict(os.environ, env), patch("prod_backup.subprocess.run", side_effect=fake_database):
                if fail_dump:
                    with self.assertRaises(SystemExit):
                        backup()
                else:
                    backup()  # Real GPG encryption, decryption and SHA comparison.
            self.assertFalse((Path(folder) / "prod-backup/production.dump").exists())
            self.assertEqual((Path(folder) / "prod-backup/production.dump.gpg").exists(), not fail_dump)

    def test_encrypt_round_trip_and_remove_plaintext(self):
        self.run_backup()

    def test_dump_failure_stops_and_removes_plaintext(self):
        self.run_backup(fail_dump=True)


if __name__ == "__main__":
    unittest.main()
