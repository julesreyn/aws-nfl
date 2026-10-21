#!/usr/bin/env bash
# Sert l'application web (web/) en local.
set -euo pipefail
cd "$(dirname "$0")/web"
PORT="${PORT:-8080}"
echo "Sideline → http://localhost:${PORT}"
exec python3 -m http.server "${PORT}"
