#!/usr/bin/env bash
# Build firmware for all boards in boards.json.
#
# Usage:
#   ./build-boards.sh              # build all boards
#   ./build-boards.sh espie-devkit # build one board
#
# Requires: ESP-IDF v5.5.2+ (source ~/esp-idf/export.sh)

set -euo pipefail
cd "$(dirname "$0")"

FIRMWARE_DIR="../espie/data/firmware"
BOARDS_JSON="$FIRMWARE_DIR/boards.json"
CMAKELISTS="CMakeLists.txt"

if [[ ! -f "$BOARDS_JSON" ]]; then
    echo "ERROR: $BOARDS_JSON not found"
    exit 1
fi

# Read version from CMakeLists.txt
VERSION=$(grep -oP 'PROJECT_VER "\K[^"]+' "$CMAKELISTS")

# Get board IDs — optionally filter to a single board
FILTER="${1:-}"
BOARD_IDS=$(python3 -c "
import json, sys
data = json.load(open('$BOARDS_JSON'))
ids = [b['id'] for b in data['boards']]
f = '$FILTER'
if f:
    if f not in ids:
        print(f'ERROR: board \"{f}\" not in boards.json (available: {ids})', file=sys.stderr)
        sys.exit(1)
    ids = [f]
for i in ids:
    print(i)
")

# Save original sdkconfig
ORIGINAL_SDK=""
if [[ -f sdkconfig ]]; then
    ORIGINAL_SDK=$(mktemp)
    cp sdkconfig "$ORIGINAL_SDK"
fi
trap '[[ -n "$ORIGINAL_SDK" && -f "$ORIGINAL_SDK" ]] && cp "$ORIGINAL_SDK" sdkconfig && rm -f "$ORIGINAL_SDK"' EXIT

BUILT=0
for BOARD_ID in $BOARD_IDS; do
    SDKCONFIG="sdkconfig.${BOARD_ID}"
    if [[ ! -f "$SDKCONFIG" ]]; then
        echo "SKIP: $SDKCONFIG not found"
        continue
    fi

    echo ""
    echo "══════════════════════════════════════════"
    echo "  Building: $BOARD_ID (v$VERSION)"
    echo "══════════════════════════════════════════"

    cp "$SDKCONFIG" sdkconfig
    idf.py fullclean > /dev/null 2>&1
    idf.py build

    # Copy outputs
    BOARD_DIR="$FIRMWARE_DIR/$BOARD_ID"
    mkdir -p "$BOARD_DIR"
    cp build/xiaozhi.bin "$BOARD_DIR/${VERSION}.bin"

    # Copy shared parts (once, from first build)
    if [[ $BUILT -eq 0 ]]; then
        cp build/bootloader/bootloader.bin "$FIRMWARE_DIR/bootloader.bin"
        cp build/partition_table/partition-table.bin "$FIRMWARE_DIR/partition-table.bin"
        cp build/ota_data_initial.bin "$FIRMWARE_DIR/ota-data.bin"
    fi

    BUILT=$((BUILT + 1))
    SIZE=$(du -h "build/xiaozhi.bin" | cut -f1)
    echo "  -> $BOARD_DIR/${VERSION}.bin ($SIZE)"
done

# Update versions in boards.json
python3 -c "
import json
data = json.load(open('$BOARDS_JSON'))
for b in data['boards']:
    b['firmware'] = f\"{b['id']}/$VERSION.bin\"
    b['version'] = '$VERSION'
json.dump(data, open('$BOARDS_JSON', 'w'), indent=2)
print()
print(f'Updated boards.json with version $VERSION')
"

echo ""
echo "Built $BUILT board(s)."
