#!/usr/bin/env bash
# install-tools.sh — tools the backup jobs need on an ubuntu-24.04 runner.
#
#   bash ops/backups/install-tools.sh            # age + PostgreSQL 17 client
#   bash ops/backups/install-tools.sh --age-only # storage job
#
# pg_dump must be at least the server's major version (Supabase: 17), and
# Ubuntu 24.04 ships 16, so the client comes from the PostgreSQL project's
# own apt repository. aws-cli (used for R2 and Supabase Storage) is already
# on GitHub's ubuntu runners.
set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq age
if [ "${1:-}" != "--age-only" ]; then
  sudo apt-get install -y -qq postgresql-common
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  sudo apt-get install -y -qq postgresql-client-17
  echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"
fi
age --version
aws --version
