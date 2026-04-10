#!/usr/bin/env bash
# Build firmware and push it via OTA.
#
# Usage:
#   ./dev-ota.sh              # build + copy + reboot device
#   ./dev-ota.sh --no-reboot  # build + copy only (reboot manually)
#   ./dev-ota.sh --flash      # USB-flash instead of OTA (first time)
#
# Builds with a timestamped dev version (e.g. 1.0.0.20260330183045)
# that is always higher than the release version in CMakeLists.txt.
# The device reboots, checks OTA, downloads the new binary, and restarts.
#
# Requires: espie server running (npm run dev or docker)

set -euo pipefail
cd "$(dirname "$0")"

MODEL="sp-esp32-s3-1.54-muma"
BIN_DIR="../espie/data/bin"
SERVER="${ESPIE_SERVER:-http://localhost:8000}"
PORT="${DEV_PORT:-/dev/ttyACM0}"

# Read release version and generate dev version with timestamp
CMAKELISTS="CMakeLists.txt"
RELEASE_VER=$(grep -oP 'PROJECT_VER "\K[^"]+' "$CMAKELISTS")
DEV_VER="${RELEASE_VER}.$(date +%Y%m%d%H%M%S)"

# Read WiFi credentials from espie config
CONFIG_FILE="../espie/data/.config.yaml"
if [[ -f "$CONFIG_FILE" ]]; then
    WIFI_SSID=$(python3 -c "
import re
with open('$CONFIG_FILE') as f: content = f.read()
m = re.search(r'wifi:\s*\n\s+ssid:\s*(.+)', content)
print(m.group(1).strip() if m else '')
" 2>/dev/null || true)
    WIFI_PASS=$(python3 -c "
import re
with open('$CONFIG_FILE') as f: content = f.read()
m = re.search(r'wifi:\s*\n(?:\s+\S+.*\n)*?\s+password:\s*(.+)', content)
print(m.group(1).strip() if m else '')
" 2>/dev/null || true)
fi

# Source ESP-IDF
source ~/esp-idf/export.sh 2>/dev/null

# Inject WiFi credentials into sdkconfig if available
if [[ -n "${WIFI_SSID:-}" ]]; then
    # Remove existing entries and append new ones
    sed -i '/^CONFIG_DEFAULT_WIFI_SSID=/d;/^CONFIG_DEFAULT_WIFI_PASSWORD=/d' sdkconfig 2>/dev/null || true
    echo "CONFIG_DEFAULT_WIFI_SSID=\"$WIFI_SSID\"" >> sdkconfig
    echo "CONFIG_DEFAULT_WIFI_PASSWORD=\"${WIFI_PASS:-}\"" >> sdkconfig
    echo "WiFi: $WIFI_SSID"
fi

# Temporarily set PROJECT_VER for the build, restore on exit
sed -i "s/PROJECT_VER \"$RELEASE_VER\"/PROJECT_VER \"$DEV_VER\"/" "$CMAKELISTS"
trap 'sed -i "s/PROJECT_VER \"$DEV_VER\"/PROJECT_VER \"$RELEASE_VER\"/" "$CMAKELISTS"' EXIT

echo "Building firmware v${DEV_VER}..."
idf.py build

# Remove any previous dev binaries, then copy the new one
mkdir -p "$BIN_DIR"
rm -f "$BIN_DIR/${MODEL}_"*.bin
DEST="$BIN_DIR/${MODEL}_${DEV_VER}.bin"
cp build/xiaozhi.bin "$DEST"
SIZE=$(du -h build/xiaozhi.bin | cut -f1)

# Copy bootloader + partition table + app to firmware dir for browser flashing
FIRMWARE_DIR="../espie/data/firmware"
MODEL_DIR="$FIRMWARE_DIR/$MODEL"
mkdir -p "$MODEL_DIR"

cp build/bootloader/bootloader.bin "$FIRMWARE_DIR/bootloader.bin"
cp build/partition_table/partition-table.bin "$FIRMWARE_DIR/partition-table.bin"
cp build/ota_data_initial.bin "$FIRMWARE_DIR/ota-data.bin"
cp build/xiaozhi.bin "$MODEL_DIR/${DEV_VER}.bin"

# Remove old app binaries for this model (keep only latest)
find "$MODEL_DIR" -name '*.bin' ! -name "${DEV_VER}.bin" -delete 2>/dev/null || true

# Generate manifest.json
cat > "$FIRMWARE_DIR/manifest.json" << MANIFEST_EOF
{
  "model": "$MODEL",
  "chipFamily": "ESP32-S3",
  "parts": [
    { "name": "bootloader", "path": "bootloader.bin", "offset": "0x0000" },
    { "name": "partition-table", "path": "partition-table.bin", "offset": "0x8000" },
    { "name": "ota-data", "path": "ota-data.bin", "offset": "0xD000" },
    { "name": "application", "path": "$MODEL/${DEV_VER}.bin", "offset": "0x20000" }
  ],
  "nvsOffset": "0x9000",
  "version": "$DEV_VER"
}
MANIFEST_EOF

echo "Firmware manifest written to $FIRMWARE_DIR/manifest.json"

echo ""
echo "══════════════════════════════════════════"
echo "  OTA ready: v${DEV_VER} ($SIZE)"
echo "══════════════════════════════════════════"

if [[ "${1:-}" == "--flash" ]]; then
    echo "USB flashing to $PORT..."
    sudo chmod 666 "$PORT" 2>/dev/null || true
    idf.py -p "$PORT" flash
elif [[ "${1:-}" != "--no-reboot" ]]; then
    # Find connected device and send reboot command
    DEVICE_ID=$(curl -sf "$SERVER/api/devices" | python3 -c "
import sys, json
data = json.load(sys.stdin)
devices = data.get('devices', [])
if devices:
    print(devices[0]['deviceId'])
" 2>/dev/null || true)

    if [[ -n "$DEVICE_ID" ]]; then
        echo "Rebooting device $DEVICE_ID..."
        curl -sf -X POST "$SERVER/api/devices/reboot" \
            -H 'Content-Type: application/json' \
            -d "{\"deviceId\": \"$DEVICE_ID\"}" > /dev/null
        echo "Device will reboot → download v${DEV_VER} → restart."
    else
        echo "No device connected. Reboot manually to trigger OTA."
    fi
fi
