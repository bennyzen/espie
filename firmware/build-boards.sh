#!/usr/bin/env bash
# Build firmware for all boards in boards.json, grouped by chip family.
#
# Usage:
#   ./build-boards.sh                    # build all boards
#   ./build-boards.sh espie-devkit       # build one board
#   ./build-boards.sh --chip esp32s3     # build all boards for one chip family
#   ./build-boards.sh --list             # list all boards and their chip families
#
# Requires: ESP-IDF v5.5.2+ (source ~/esp-idf/export.sh)

set -euo pipefail
cd "$(dirname "$0")"

FIRMWARE_DIR="../espie/data/firmware"
BOARDS_JSON="$FIRMWARE_DIR/boards.json"
CMAKELISTS="CMakeLists.txt"
DEFAULTS_DIR="sdkconfig.boards"

if [[ ! -f "$BOARDS_JSON" ]]; then
    echo "ERROR: $BOARDS_JSON not found"
    exit 1
fi

# Read version from CMakeLists.txt
VERSION=$(grep -oP 'PROJECT_VER "\K[^"]+' "$CMAKELISTS")

# --- Save and restore original files on exit ---
ORIGINAL_SDKCONFIG=""
ORIGINAL_DEFAULTS_BOARD=""

if [[ -f sdkconfig ]]; then
    ORIGINAL_SDKCONFIG=$(mktemp)
    cp sdkconfig "$ORIGINAL_SDKCONFIG"
fi
if [[ -f sdkconfig.defaults.board ]]; then
    ORIGINAL_DEFAULTS_BOARD=$(mktemp)
    cp sdkconfig.defaults.board "$ORIGINAL_DEFAULTS_BOARD"
fi

cleanup() {
    if [[ -n "$ORIGINAL_SDKCONFIG" && -f "$ORIGINAL_SDKCONFIG" ]]; then
        cp "$ORIGINAL_SDKCONFIG" sdkconfig
        rm -f "$ORIGINAL_SDKCONFIG"
    fi
    if [[ -n "$ORIGINAL_DEFAULTS_BOARD" && -f "$ORIGINAL_DEFAULTS_BOARD" ]]; then
        cp "$ORIGINAL_DEFAULTS_BOARD" sdkconfig.defaults.board
        rm -f "$ORIGINAL_DEFAULTS_BOARD"
    else
        rm -f sdkconfig.defaults.board
    fi
}
trap cleanup EXIT

# --- Chip family to IDF target mapping ---
chip_family_to_target() {
    case "$1" in
        ESP32)    echo "esp32" ;;
        ESP32-S3) echo "esp32s3" ;;
        ESP32-C3) echo "esp32c3" ;;
        ESP32-C5) echo "esp32c5" ;;
        ESP32-C6) echo "esp32c6" ;;
        ESP32-P4) echo "esp32p4" ;;
        *)
            echo "ERROR: Unknown chip family: $1" >&2
            return 1
            ;;
    esac
}

# --- Parse arguments ---
FILTER_BOARD=""
FILTER_CHIP=""
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --list)
            LIST_ONLY=true
            shift
            ;;
        --chip)
            FILTER_CHIP="${2:-}"
            if [[ -z "$FILTER_CHIP" ]]; then
                echo "ERROR: --chip requires an argument (e.g., --chip esp32s3)"
                exit 1
            fi
            shift 2
            ;;
        -*)
            echo "ERROR: Unknown option: $1"
            echo "Usage: $0 [--list] [--chip TARGET] [BOARD_ID]"
            exit 1
            ;;
        *)
            FILTER_BOARD="$1"
            shift
            ;;
    esac
done

# --- List mode ---
if $LIST_ONLY; then
    python3 -c "
import json
data = json.load(open('$BOARDS_JSON'))
print(f'{'ID':<25} {'Chip Family':<12} {'Name'}')
print(f'{'-'*25} {'-'*12} {'-'*40}')
for b in data['boards']:
    print(f'{b[\"id\"]:<25} {b[\"chipFamily\"]:<12} {b[\"name\"]}')
print(f'\n{len(data[\"boards\"])} board(s) total')
"
    exit 0
fi

# --- Get build plan: boards grouped by chip family ---
BUILD_PLAN=$(python3 -c "
import json, sys

data = json.load(open('$BOARDS_JSON'))
boards = data['boards']
filter_board = '$FILTER_BOARD'
filter_chip = '$FILTER_CHIP'

# Chip family to IDF target mapping
target_map = {
    'ESP32': 'esp32',
    'ESP32-S3': 'esp32s3',
    'ESP32-C3': 'esp32c3',
    'ESP32-C5': 'esp32c5',
    'ESP32-C6': 'esp32c6',
    'ESP32-P4': 'esp32p4',
}

# Filter boards
if filter_board:
    ids = [b['id'] for b in boards]
    if filter_board not in ids:
        print(f'ERROR: board \"{filter_board}\" not in boards.json (available: {ids})', file=sys.stderr)
        sys.exit(1)
    boards = [b for b in boards if b['id'] == filter_board]
elif filter_chip:
    # Match by IDF target name
    boards = [b for b in boards if target_map.get(b['chipFamily'], '') == filter_chip]
    if not boards:
        print(f'ERROR: no boards found for chip target \"{filter_chip}\"', file=sys.stderr)
        sys.exit(1)

# Group by chip family, preserving order
from collections import OrderedDict
groups = OrderedDict()
for b in boards:
    family = b['chipFamily']
    target = target_map.get(family)
    if not target:
        print(f'WARNING: unknown chip family \"{family}\" for board \"{b[\"id\"]}\", skipping', file=sys.stderr)
        continue
    if target not in groups:
        groups[target] = []
    groups[target].append(b['id'])

# Output: target:board1,board2|target:board3,...
parts = []
for target, board_ids in groups.items():
    parts.append(f'{target}:{','.join(board_ids)}')
print('|'.join(parts))
")

if [[ -z "$BUILD_PLAN" ]]; then
    echo "ERROR: No boards to build"
    exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Espie Firmware Builder — v$VERSION"
echo "═══════════════════════════════════════════════════"
echo ""

# --- Build loop ---
TOTAL_START=$(date +%s)
BUILT=0
SKIPPED=0
BOARD_RESULTS=()

IFS='|' read -ra GROUPS <<< "$BUILD_PLAN"
for GROUP in "${GROUPS[@]}"; do
    IFS=':' read -r TARGET BOARD_LIST <<< "$GROUP"
    IFS=',' read -ra BOARD_IDS <<< "$BOARD_LIST"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Target: $TARGET (${#BOARD_IDS[@]} board(s))"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    echo "  Running: idf.py set-target $TARGET"
    idf.py set-target "$TARGET"
    echo ""

    for BOARD_ID in "${BOARD_IDS[@]}"; do
        DEFAULTS_FILE="$DEFAULTS_DIR/${BOARD_ID}.defaults"

        if [[ ! -f "$DEFAULTS_FILE" ]]; then
            echo "  SKIP: $BOARD_ID — $DEFAULTS_FILE not found"
            SKIPPED=$((SKIPPED + 1))
            continue
        fi

        BOARD_START=$(date +%s)

        echo "  ──────────────────────────────────────────────"
        echo "  Building: $BOARD_ID (v$VERSION)"
        echo "  ──────────────────────────────────────────────"

        # Copy board defaults and reconfigure
        cp "$DEFAULTS_FILE" sdkconfig.defaults.board
        rm -f sdkconfig
        idf.py reconfigure
        idf.py build

        # Copy outputs to per-board directory
        BOARD_DIR="$FIRMWARE_DIR/$BOARD_ID"
        mkdir -p "$BOARD_DIR"
        cp build/bootloader/bootloader.bin "$BOARD_DIR/bootloader.bin"
        cp build/partition_table/partition-table.bin "$BOARD_DIR/partition-table.bin"
        cp build/ota_data_initial.bin "$BOARD_DIR/ota-data.bin"
        cp build/xiaozhi.bin "$BOARD_DIR/${VERSION}.bin"

        BOARD_END=$(date +%s)
        ELAPSED=$((BOARD_END - BOARD_START))
        SIZE=$(du -h "build/xiaozhi.bin" | cut -f1)

        echo ""
        echo "  -> $BOARD_DIR/${VERSION}.bin ($SIZE, ${ELAPSED}s)"
        BOARD_RESULTS+=("$BOARD_ID|$TARGET|$SIZE|${ELAPSED}s")
        BUILT=$((BUILT + 1))
    done
done

# --- Update boards.json ---
BUILT_IDS=$(printf '%s\n' "${BOARD_RESULTS[@]}" | cut -d'|' -f1 | tr '\n' ',' | sed 's/,$//')

python3 -c "
import json

data = json.load(open('$BOARDS_JSON'))
built_ids = set('$BUILT_IDS'.split(',')) if '$BUILT_IDS' else set()
version = '$VERSION'

for b in data['boards']:
    if b['id'] not in built_ids:
        continue
    bid = b['id']

    # Preserve existing offsets if present, otherwise use defaults
    def get_offset(field, default):
        existing = b.get(field)
        if isinstance(existing, dict) and 'offset' in existing:
            return existing['offset']
        # Fall back to shared section if it exists
        shared = data.get('shared', {})
        if field in shared and isinstance(shared[field], dict):
            return shared[field].get('offset', default)
        return default

    b['version'] = version
    b['firmware'] = f'{bid}/{version}.bin'
    b['bootloader'] = {'path': f'{bid}/bootloader.bin', 'offset': get_offset('bootloader', '0x0000')}
    b['partitionTable'] = {'path': f'{bid}/partition-table.bin', 'offset': get_offset('partitionTable', '0x8000')}
    b['otaData'] = {'path': f'{bid}/ota-data.bin', 'offset': get_offset('otaData', '0xD000')}
    b['app'] = {'path': f'{bid}/{version}.bin', 'offset': get_offset('app', '0x20000')}

# Preserve nvsOffset at top level (move from shared if needed)
if 'nvsOffset' not in data and 'shared' in data:
    data['nvsOffset'] = data['shared'].get('nvsOffset', '0x9000')

# Remove legacy shared section if all boards have been migrated
all_migrated = all('bootloader' in b and isinstance(b.get('bootloader'), dict) for b in data['boards'])
if all_migrated and 'shared' in data:
    # Ensure nvsOffset is preserved at top level
    if 'nvsOffset' not in data:
        data['nvsOffset'] = data['shared'].get('nvsOffset', '0x9000')
    del data['shared']

json.dump(data, open('$BOARDS_JSON', 'w'), indent=2)
# Add trailing newline
with open('$BOARDS_JSON', 'a') as f:
    f.write('\n')
"

# --- Summary ---
TOTAL_END=$(date +%s)
TOTAL_ELAPSED=$((TOTAL_END - TOTAL_START))

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Build Summary"
echo "═══════════════════════════════════════════════════"
echo ""

if [[ ${#BOARD_RESULTS[@]} -gt 0 ]]; then
    printf "  %-25s %-12s %-8s %s\n" "Board" "Chip" "Size" "Time"
    printf "  %-25s %-12s %-8s %s\n" "-------------------------" "------------" "--------" "------"
    for RESULT in "${BOARD_RESULTS[@]}"; do
        IFS='|' read -r B_ID B_TARGET B_SIZE B_TIME <<< "$RESULT"
        printf "  %-25s %-12s %-8s %s\n" "$B_ID" "$B_TARGET" "$B_SIZE" "$B_TIME"
    done
fi

echo ""
echo "  Built: $BUILT    Skipped: $SKIPPED    Total: ${TOTAL_ELAPSED}s"
echo "  boards.json updated with v$VERSION"
echo ""
