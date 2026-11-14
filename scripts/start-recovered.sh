#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/lib/postgresql/12/bin:$PATH"
pgdata="$PWD/.local/recovery-20261114/pgdata"
if ! pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
  pg_ctl -D "$pgdata" -l "$PWD/.local/recovery-20261114/postgres.log" -w start
fi
node scripts/validate-recovered.cjs
node scripts/setup-superadmin.cjs
export BILLING_ENABLED=false
export BILLING_WEBHOOK_URL=
export BILLING_WEBHOOK_TOKEN=
exec node backend/src/server.js
