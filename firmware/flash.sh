#!/usr/bin/env bash
# Build and flash the ESP32 firmware.
# Auto-detects the serial port on macOS and Linux.
# Usage:
#   ./flash.sh              # build + flash (auto-detect port)
#   ./flash.sh /dev/ttyXYZ  # build + flash to specific port
#   ./flash.sh --no-build   # flash only, skip build
set -euo pipefail
cd "$(dirname "$0")"

# --- Parse args ---
NO_BUILD=false
PORT=""
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    /dev/*)     PORT="$arg" ;;
    *)          EXTRA_ARGS+=("$arg") ;;
  esac
done

# --- Source ESP-IDF environment ---
IDF_EXPORT="${IDF_PATH:-$HOME/esp-idf}/export.sh"
if [ ! -f "$IDF_EXPORT" ]; then
  echo "Error: ESP-IDF not found at $IDF_EXPORT"
  echo "Set IDF_PATH to your esp-idf directory, or install it at ~/esp-idf"
  exit 1
fi
# shellcheck source=/dev/null
. "$IDF_EXPORT"

# --- Build (unless skipped) ---
if [ "$NO_BUILD" = false ]; then
  echo ""
  echo "=== Building firmware ==="
  idf.py build
fi

# --- Auto-detect serial port ---
detect_port() {
  local os
  os="$(uname -s)"
  case "$os" in
    Linux)
      # ESP32-S3 built-in USB shows as /dev/ttyACM*
      for p in /dev/ttyACM*; do
        [ -e "$p" ] && echo "$p" && return
      done
      # Fallback: CP2102/CH340 shows as /dev/ttyUSB*
      for p in /dev/ttyUSB*; do
        [ -e "$p" ] && echo "$p" && return
      done
      ;;
    Darwin)
      # ESP32-S3 built-in USB shows as /dev/cu.usbmodem*
      for p in /dev/cu.usbmodem*; do
        [ -e "$p" ] && echo "$p" && return
      done
      # Fallback: CP2102/CH340 shows as /dev/cu.usbserial* or /dev/cu.SLAB*
      for p in /dev/cu.usbserial* /dev/cu.SLAB*; do
        [ -e "$p" ] && echo "$p" && return
      done
      ;;
    *)
      echo "Unsupported OS: $os" >&2
      return 1
      ;;
  esac
  return 1
}

if [ -z "$PORT" ]; then
  PORT="$(detect_port)" || {
    echo "Error: No ESP32 device found."
    echo "Make sure the device is powered on and connected via USB."
    exit 1
  }
  echo ""
  echo "=== Detected port: $PORT ==="
fi

# --- Fix permissions on Linux ---
if [ "$(uname -s)" = "Linux" ] && [ ! -w "$PORT" ]; then
  echo "Fixing permissions on $PORT (requires sudo)..."
  sudo chmod 666 "$PORT"
fi

# --- Flash ---
echo ""
echo "=== Flashing firmware to $PORT ==="
idf.py -p "$PORT" flash "${EXTRA_ARGS[@]}"

echo ""
echo "Done! To monitor serial output, run: ./monitor.sh"
