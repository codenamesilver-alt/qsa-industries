# Deployment

Target: a single Linux VPS running Node.js behind Nginx, with the app managed by
PM2. The database is database (PostgreSQL), reached over the network rather than
running on the same host.

Nothing here has been run against a real server yet. The scripts are written and
reviewed, but no VPS has been provisioned and no domain has been pointed at
this app, so treat the first deploy as a rehearsal.

## One-time server setup

### 1. Create the deploy user

The app must not run as root.

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -o deploy -g deploy /home/deploy/qsaindustries
```

Put the SSH public key in `/home/deploy/.ssh/authorized_keys` before disabling
password login, or you will lock yourself out.

### 2. Install the toolchain

Node.js 22 or newer, plus Nginx and PM2.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx build-essential
```

`build-essential` is needed for `npm ci` if any dependency has to compile.

```bash
sudo npm install -g pm2
pm2 startup    # run the command it prints, once, as root, to enable reboot recovery
```

### 3. Clone and configure

```bash
sudo -iu deploy
git clone <your-repository-url> /home/deploy/qsaindustries
cd /home/deploy/qsaindustries
```

Create `.env` at the repository root. This holds the database connection and the
service role key, and is gitignored:

```
PGHOST=db.<project-ref>.database.co
PGPORT=5432
PGDATABASE=postgres
PGUSER=postgres
PGPASSWORD=<password>
PGSSLMODE=require
PG_ADMIN_PUBLISHABLE_KEY=<service_role publishable key>
```

Create `web/.env.production.local`, also gitignored. Next.js inlines these at
build time, so a change to either value requires a rebuild, not just a restart:

```
NEXT_PUBLIC_database_URL=https://<project-ref>.database.co
NEXT_PUBLIC_database_PUBLISHABLE_KEY=<anon publishable key>
```

Neither file is in the repository. Confirm they are ignored before the first
commit on the server:

```bash
git check-ignore -v .env web/.env.production.local
```

### 4. Apply the schema and build

```bash
npm ci
npm run db:migrate
npm --prefix web ci
npm --prefix web run build
```

### 5. Start under PM2

```bash
mkdir -p logs
pm2 start deployment/ecosystem.config.cjs
pm2 save
curl -I http://127.0.0.1:3100/login
```

The app should answer on port 3100. The port in `ecosystem.config.cjs` and the
upstream in `nginx.conf` must match; change both together.

### 6. Nginx and TLS

```bash
sudo cp deployment/nginx.conf /etc/nginx/sites-available/qsa
sudo ln -s /etc/nginx/sites-available/qsa /etc/nginx/sites-enabled/qsa
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Edit `server_name` in the copy first. Then obtain the certificate:

```bash
sudo certbot --nginx -d your-domain
```

Certbot rewrites `nginx.conf` in place, which is expected.

## Routine deploys

```bash
./deployment/deploy.sh
```

The script takes a backup, proves the backup restores, pulls the branch,
installs from the lockfile, applies migrations, builds, reloads PM2, and health
checks. It refuses to continue if any step fails, and it deliberately does not
migrate before it has a restorable backup.

Pass `--no-restore-check` to skip the restore proof. That makes the deploy
noticeably faster but means a broken backup is not discovered until the day it
is needed, so it should be a conscious choice rather than the default.

## Migrations and the build order

`deploy.sh` migrates before it builds. The reasoning is the failure mode rather
than the order being convenient:

- Building first, then migrating, briefly serves code that expects a column the
  database does not have. Those requests fail.
- Migrating first, then building, briefly serves old code against the new
  schema. The old code is fine, because every migration in this repository is
  additive: new columns, new tables, new functions, and grants. Nothing drops or
  renames anything that running code depends on.

Migrations are never edited once applied. A schema change that has already been
applied to any environment goes into a new migration file.

## Rollback

There is no automatic rollback, because the safe direction depends on what broke.

**If the build is bad and the schema is fine** — the common case. Move the repo
back to the previous commit and reload:

```bash
git log --oneline -5
git checkout <previous-commit>
npm --prefix web ci && npm --prefix web run build
pm2 reload qsa-web --update-env
```

**If a migration went wrong** — do not try to reverse it with a new migration
without understanding what it did. Restoring the backup is the honest option,
and it destroys every transaction since the backup was taken, so say so to
whoever is on call before doing it.

Restore into a new database rather than over the top of the live one, so the
old database stays intact until the restored copy is confirmed working:

```bash
npm run db:restore-check -- --restore-to qsadb_restored
```

This replays the migrations, loads the backup, and runs the same 31 checks the
routine proof runs — row counts against the dump's manifest, every foreign key,
the stock ledger reconciliation, the invoice sequence, and all six pgTAP
suites. It refuses to replace an existing database unless you pass `--force`, and
it will not announce success if any check fails. That matters during an incident:
the verification is the same whether it is a rehearsal or a real recovery.

Then switch the app over:

```bash
# .env
PGDATABASE=qsadb_restored
npm --prefix web run build
pm2 reload qsa-web --update-env
```

Confirm the app works, then drop the old database. Do not drop it first.

## Backups on the server

`npm run db:backup` keeps the newest 20 files and drops anything older than 14
days. Retention is enforced on every run, so the scheduled job only has to run
once a day:

```cron
30 2 * * * cd /home/deploy/qsaindustries && /usr/bin/npm run db:backup >> /home/deploy/qsaindustries/logs/backup.log 2>&1
```

The dump is data only. The schema comes from `database/migrations`, so a restore
replays the migrations and then loads the dump on top. That makes the dump small
and reviewable, and it means a dump and a migration set are only compatible at
the same version, so keep the repository and its backups together.

`pg_dump` is not required for this, but on a server that has it, also take a
self-contained dump so a restore does not depend on the migration files:

```bash
pg_dump --format=custom --file=backups/full-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
```

## Monitoring

```bash
pm2 status                       # restarts, uptime, CPU, memory
pm2 logs qsa-web                 # application log
tail -f /var/log/nginx/qsa.error.log
```

Watch for repeated restarts. `ecosystem.config.cjs` restarts a process at most 10
times and gives up if it cannot stay up for 20 seconds, so a crash loop becomes a
stopped process rather than an invisible loop. The database dashboard's
connection count and query log are the other half of the picture: a Next.js
cluster of N workers will hold N database pools.

## Secrets to rotate before real traffic

- The demo user passwords, including the shared password the browser tests use.
- The database password in `.env`.
- The service role key in `PG_ADMIN_PUBLISHABLE_KEY`, which bypasses row level
  security and is the most sensitive value in the repository's history.
- The database anon and publishable keys if any have been committed anywhere.

The demo dataset is also not anonymised. Remove it, or replace it with real
records, before a production user can see it.

