#!/usr/bin/env bash
#
# Deploy the QSA ERP app to a server.
#
#   ./deployment/deploy.sh
#
# Intended to run as the unprivileged deploy user, not root. It takes a backup
# before touching the database, because a migration is the only step here that
# can destroy data, and a backup taken after the migration is worthless.
#
# The order is not arbitrary:
#
#   backup -> verify backup -> install -> migrate -> build -> reload -> health
#
# Verifying the backup is the part people skip, and it is the reason this script
# takes noticeably longer than a plain `git pull && npm ci`. `db:restore-check`
# restores into a scratch database and drops it again, so it needs permission to
# create databases. If the deploy user does not have that, pass --no-restore-check
# to skip that step and rely on the nightly backup instead.
#
# The build happens after the migration so the running app is never serving code
# that expects a column the database does not have yet. The window is the other
# way round: code that is older than the schema. Migrations here are additive, so
# old code tolerates the new schema, which is what makes this order safe.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/qsaindustries}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-qsa-web}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/login}"

SKIP_RESTORE_CHECK=0
for arg in "$@"; do
    case "$arg" in
        --no-restore-check) SKIP_RESTORE_CHECK=1 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

BACKUP_FILE=""

log() { printf '\n=== %s\n' "$1"; }
fail() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

cd "$APP_DIR"

# ---------------------------------------------------------------- preflight --
log "Preflight"

if [ "$(id -u)" -eq 0 ]; then
    fail "Run as the deploy user, not root. The app must not run as root."
fi

for tool in git node npm pm2; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed or not on PATH"
done

[ -f .env ] || fail ".env is missing. See README for the required variables."
[ -f web/.env.production.local ] || \
    fail "web/.env.production.local is missing. It holds NEXT_PUBLIC_SUPABASE_* values."

if [ -n "$(git status --porcelain)" ]; then
    printf 'WARNING: the working tree has uncommitted changes.\n'
    git status --short
    printf 'Deploying the committed code anyway; local edits are ignored.\n\n'
fi

git fetch --quiet origin
# Local-only commits are a problem; being merely behind is not, and is the
# normal case. `git diff HEAD origin/$BRANCH` cannot tell the two apart.
if [ -n "$(git log --oneline "origin/$BRANCH..HEAD")" ]; then
    fail "Local commits are not on origin/$BRANCH. Resolve before deploying."
fi
git checkout --quiet "$BRANCH"
git pull --ff-only --quiet origin "$BRANCH"
echo "on $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

# ------------------------------------------------------------------ backup --
log "Taking a backup before any migration runs"

# The backup script prints "wrote <name>" on its own line, so the name is read
# back from there. `ls | head` would be the shorter way to find the newest file,
# but head closing the pipe makes ls exit non-zero, which is fatal under
# pipefail.
BACKUP_NAME="$(npm run --silent db:backup | sed -n 's/^wrote \(qsa-[^ ]*\.sql\)$/\1/p')"
[ -n "$BACKUP_NAME" ] || fail "could not read the backup filename from the backup script"
echo "backup: backups/$BACKUP_NAME"

if [ "$SKIP_RESTORE_CHECK" -eq 0 ]; then
    log "Proving the backup restores"
    # A backup that has never been restored is a hypothesis. This rebuilds the
    # database from it in a scratch database, runs the test suites against the
    # result, and drops it again.
    npm run --silent db:restore-check -- --file "$BACKUP_NAME" \
        || fail "the backup did not restore cleanly. Fix this before deploying anything."
else
    echo "skipped (--no-restore-check)"
fi

# ----------------------------------------------------------------- install --
log "Installing dependencies"

# ci, not install: it installs exactly what the lockfile pins, so a build on the
# server matches the build that was tested locally.
npm ci --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund

# ----------------------------------------------------------------- migrate --
log "Applying database migrations"

npm run --silent db:migrate

# ------------------------------------------------------------------- build --
log "Building the web app"

# NEXT_PUBLIC_* values are inlined at build time, so the build is where a
# changed Supabase URL or key actually takes effect.
npm --prefix web run --silent build

# ------------------------------------------------------------------ reload --
log "Reloading the app"

mkdir -p logs
pm2 reload "$PM2_APP" --update-env
pm2 save

# ------------------------------------------------------------------ health --
log "Health check"

# Give a clustered app a moment: the first worker after a reload compiles
# nothing, but the router takes a moment to come up.
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --output /dev/null "$HEALTH_URL"; then
        echo "healthy after ${attempt}s: $HEALTH_URL"
        pm2 list
        printf '\nDeployed. Verify in a browser that login works, then watch the logs:\n'
        printf '  pm2 logs %s\n' "$PM2_APP"
        exit 0
    fi
    sleep 1
done

fail "the app did not become healthy. Logs:
  pm2 logs $PM2_APP
The previous release is still on disk; see the rollback note in deployment/README.md."
