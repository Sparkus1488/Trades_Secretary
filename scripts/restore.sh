#!/bin/sh
set -eu

ARCHIVE="${1:-}"
DATA_DIR="${SITEPIX_DATA_DIR:-./data}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Usage: SITEPIX_DATA_DIR=/path/to/data ./scripts/restore.sh /path/to/sitepix-data-YYYYMMDDTHHMMSSZ.tar.gz" >&2
  exit 2
fi
if [ -e "$DATA_DIR" ] && [ "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Refusing to overwrite non-empty data directory: $DATA_DIR" >&2
  echo "Stop the app and move the current data directory aside before restoring." >&2
  exit 1
fi
PARENT=$(dirname "$DATA_DIR")
mkdir -p "$PARENT"
# The archive contains the original data directory basename; extract into its parent.
tar -tzf "$ARCHIVE" | grep -Eq '(^|/)\.\./|^/' && { echo "Unsafe archive path detected." >&2; exit 1; }
tar -xzf "$ARCHIVE" -C "$PARENT"
echo "Archive extracted under $PARENT. Verify the restored directory path and permissions before restarting the app."
