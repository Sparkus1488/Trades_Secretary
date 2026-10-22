#!/bin/sh
set -eu

DATA_DIR="${SITEPIX_DATA_DIR:-./data}"
DEST_DIR="${1:-./backups}"
if [ ! -d "$DATA_DIR" ]; then
  echo "Data directory not found: $DATA_DIR" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"
DATA_REAL=$(cd "$DATA_DIR" && pwd -P)
DEST_REAL=$(cd "$DEST_DIR" && pwd -P)
case "$DEST_REAL/" in
  "$DATA_REAL/"|"$DATA_REAL/"*) echo "Backup destination must be outside the live data directory. Use a separate mounted/offsite destination." >&2; exit 1 ;;
esac
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST_REAL/sitepix-data-$STAMP.tar.gz"
tar -czf "$OUT" -C "$(dirname "$DATA_REAL")" "$(basename "$DATA_REAL")"
chmod 600 "$OUT"
echo "Created backup: $OUT"
echo "Copy this backup to a separate encrypted/offsite destination and test restoration regularly."
