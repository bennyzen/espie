#!/usr/bin/env bash
# Build the ESP32 firmware.
# Works on both macOS and Linux.
set -euo pipefail
cd "$(dirname "$0")"

# --- Source ESP-IDF environment ---
IDF_EXPORT="${IDF_PATH:-$HOME/esp-idf}/export.sh"
if [ ! -f "$IDF_EXPORT" ]; then
  echo "Error: ESP-IDF not found at $IDF_EXPORT"
  echo "Set IDF_PATH to your esp-idf directory, or install it at ~/esp-idf"
  exit 1
fi
# shellcheck source=/dev/null
. "$IDF_EXPORT"

# --- Build ---
echo ""
echo "=== Building firmware ==="
idf.py build "$@"
