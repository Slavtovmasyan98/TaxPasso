"""Guards for the one-time 001–015 production rollout. No database writes here."""
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

LEGACY = "20260924234059 20260924234142 20260924234152 20260924234214 20260925050905 20260925053603 20260926000827 20260926011259 20260926013300 20260926015111".split()
BASE = [f"{i:03}" for i in range(1, 11)]
NEW = [f"{i:03}" for i in range(11, 16)]


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def validate_connection(raw):
    try:
        u = urlsplit(raw)
        ref = "mhjxjxteorjwkvqbznfl"
        direct = u.hostname == f"db.{ref}.supabase.co" and unquote(u.username or "") == "postgres"
        pooler = bool(re.fullmatch(r"aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com", u.hostname or "")) and unquote(u.username or "") == f"postgres.{ref}"
        valid = u.scheme in ("postgres", "postgresql") and u.path == "/postgres" and u.port in (None, 5432) and not u.query and not u.fragment and (direct or pooler) and bool(u.password)
    except ValueError:
        valid = False
    require(valid, "Use the production direct or Session pooler URL on port 5432; connection rejected.")


def classify(versions):
    require(len(versions) == len(set(versions)), "Duplicate migration versions: stop.")
    if set(versions) == set(LEGACY):
        return "legacy"
    # Allow a previously applied prefix, including resuming after a failed migration.
    for count in range(6):
        if set(versions) == set(BASE + NEW[:count]):
            return "normalized"
    raise SystemExit("Unexpected or partially repaired migration history: stop and reconcile the journal.")


def read_versions():
    result = subprocess.run([
        "psql", os.environ["DB_URL"], "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
        "select version from supabase_migrations.schema_migrations order by version;"
    ], capture_output=True, text=True)
    require(result.returncode == 0, "Cannot read production migration history; no changes permitted.")
    return result.stdout.split()


def main():
    validate_connection(os.environ.get("DB_URL", ""))
    mode = sys.argv[1]
    if mode == "source":
        require(os.environ.get("REF_NAME") == "main", "Dispatch only from main.")
        require(bool(re.fullmatch(r"[0-9a-f]{40}", os.environ.get("RELEASE_SHA", ""))), "Use a full immutable release commit SHA.")
        dry = os.environ.get("DRY_RUN_ONLY") == "true"
        repair = os.environ.get("REPAIR_HISTORY") == "true"
        expected = "REPAIR" if repair else "CHECK" if dry else "APPLY"
        require(os.environ.get("CONFIRM") == expected, f"Confirmation must be {expected}.")
        require(not repair or dry, "Repair history in a separate dry-run-only dispatch first.")
        source = Path("migration-source/supabase/migrations")
        files = sorted(source.glob("*.sql"))
        require([f.name.split("_", 1)[0] for f in files] == BASE + NEW, "Release must contain exactly migrations 001–015.")
        for f in files[:10]:
            baseline = Path("supabase/migrations") / f.name
            require(baseline.exists() and baseline.read_bytes() == f.read_bytes(), f"Baseline migration differs: {f.name}")
        print("Source and production connection guards passed.")
        return
    versions = read_versions()
    state = classify(versions)
    if mode == "before":
        print("Migration history:", ", ".join(versions))
        if state == "legacy":
            require(os.environ.get("REPAIR_HISTORY") == "true", "Legacy history detected. Run dry_run_only=true, repair_history=true, confirm=REPAIR first.")
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"needs_repair={'true' if state == 'legacy' else 'false'}\n")
        return
    require(state == "normalized", "Migration history has not been normalized.")
    pending = [v for v in NEW if v not in versions]
    if mode == "after":
        require(not pending, "Not all migrations 011–015 were applied.")
    print("Pending migration versions:", ", ".join(pending) or "none")


if __name__ == "__main__":
    main()
