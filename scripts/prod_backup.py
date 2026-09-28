"""Create an encrypted logical DB backup before any production mutation.

Includes database schemas/data and migration history. Does not back up Storage
object bytes, cluster roles or platform configuration. Restore must be rehearsed.
"""
import hashlib
import os
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

from prod_migrations import require, validate_connection


def backup():
    raw_url = os.environ.get("DB_URL", "")
    validate_connection(raw_url)
    passphrase = os.environ.get("PROD_BACKUP_PASSPHRASE", "")
    require(
        len(passphrase) >= 24
        and "\n" not in passphrase
        and "\r" not in passphrase
        and passphrase == passphrase.strip(),
        "Set PROD_BACKUP_PASSPHRASE to at least 24 characters, without CR/LF or surrounding whitespace; keep an offline copy.",
    )
    url = urlsplit(raw_url)
    env = os.environ.copy()
    env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432),
               PGUSER=unquote(url.username), PGPASSWORD=unquote(url.password),
               PGDATABASE="postgres", PGSSLMODE="require", PGCONNECT_TIMEOUT="15")
    # Credentials travel via environment, never as command-line arguments or logs.
    # Use the same validated URL path that already read migration history. Rebuilding
    # libpq fields is still needed below to pass credentials into the dump container.
    result = subprocess.run(["psql", raw_url, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", "show server_version_num"], capture_output=True, text=True)
    require(result.returncode == 0, f"Cannot connect to determine PostgreSQL version (psql exit {result.returncode}); backup stopped.")
    require(result.stdout.strip().isdigit(), "PostgreSQL returned an unexpected server version; backup stopped.")
    major = int(result.stdout.strip()) // 10000
    require(major in (14, 15, 16, 17, 18), "Unsupported PostgreSQL major version; review backup tooling.")
    docker = ["docker", "run", "--rm", "-i"]
    for key in ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGCONNECT_TIMEOUT"):
        docker += ["--env", key]
    docker += [f"postgres:{major}"]
    folder = Path(os.environ["RUNNER_TEMP"]) / "prod-backup"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    dump = folder / "production.dump"
    encrypted = folder / "production.dump.gpg"
    try:
        with dump.open("wb") as stream:
            os.chmod(dump, 0o600)
            result = subprocess.run(docker + ["pg_dump", "--format=custom", "--no-owner", "--no-acl"], env=env, stdout=stream, stderr=subprocess.PIPE)
        require(result.returncode == 0 and dump.stat().st_size > 0, "Full database dump failed; no migration is permitted.")
        with dump.open("rb") as stream:
            result = subprocess.run(docker + ["pg_restore", "--list"], env=env, stdin=stream, capture_output=True)
        require(result.returncode == 0 and b"TABLE DATA" in result.stdout and b"schema_migrations" in result.stdout,
                "Dump archive must contain table data and migration history; backup rejected.")
        result = subprocess.run([
            "gpg", "--batch", "--yes", "--no-symkey-cache", "--s2k-count", "65011712", "--pinentry-mode", "loopback", "--passphrase-fd", "0",
            "--symmetric", "--cipher-algo", "AES256", "--output", str(encrypted), str(dump)
        ], input=passphrase.encode(), capture_output=True)
        require(result.returncode == 0 and encrypted.exists() and encrypted.stat().st_size > 0, "Backup encryption failed; no migration is permitted.")
        # Check decryption without writing a second plaintext archive.
        process = subprocess.Popen([
            "gpg", "--batch", "--no-symkey-cache", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--decrypt", str(encrypted)
        ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        process.stdin.write(passphrase.encode())
        process.stdin.close()
        decrypted_hash = hashlib.sha256()
        for chunk in iter(lambda: process.stdout.read(1024 * 1024), b""):
            decrypted_hash.update(chunk)
        process.stdout.close()
        require(process.wait() == 0, "Encrypted backup cannot be read back.")
        with dump.open("rb") as stream:
            original_hash = hashlib.file_digest(stream, "sha256").digest()
        require(decrypted_hash.digest() == original_hash, "Encrypted backup verification failed.")
        print("Encrypted logical backup verified. Plaintext archive removed. Restore rehearsal still required.")
    except BaseException:
        encrypted.unlink(missing_ok=True)
        raise
    finally:
        dump.unlink(missing_ok=True)


if __name__ == "__main__":
    backup()
