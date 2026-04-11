# Multi-Board Flash Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-board flash wizard with a multi-board system where users pick their board from a list and get the correct firmware.

**Architecture:** A `boards.json` registry replaces `manifest.json`. The flash wizard gains a board-picker step between "connected" and "flashing". Each board has its own pre-built firmware binary under `data/firmware/<board-id>/`. The server serves `boards.json` via a new API endpoint. OTA is unchanged — it already works per-model.

**Tech Stack:** Nuxt 4 (server routes + Vue components), NuxtUI v4, esptool-js, ESP-IDF build system.

**Spec:** `docs/specs/2026-04-11-multi-board-flash-wizard.md`

---

### Task 1: Create boards.json and API endpoint

**Files:**
- Create: `espie/data/firmware/boards.json`
- Create: `espie/server/api/firmware/boards.get.ts`
- Modify: `espie/server/api/firmware/manifest.get.ts` (redirect to boards)

- [ ] **Step 1: Create `boards.json`**

Replace the current `manifest.json` with the board registry. The file goes in `espie/data/firmware/boards.json`:

```json
{
  "shared": {
    "bootloader": { "path": "bootloader.bin", "offset": "0x0000" },
    "partitionTable": { "path": "partition-table.bin", "offset": "0x8000" },
    "otaData": { "path": "ota-data.bin", "offset": "0xD000" },
    "nvsOffset": "0x9000"
  },
  "boards": [
    {
      "id": "espie-spotpear",
      "name": "Spotpear ESP32-S3 1.54\" MUMA",
      "description": "All-in-one with ES8311 codec, touch, battery",
      "chipFamily": "ESP32-S3",
      "image": "images/espie-spotpear.jpg",
      "firmware": "espie-spotpear/1.0.0.bin",
      "version": "1.0.0"
    },
    {
      "id": "espie-devkit",
      "name": "ESP32-S3 DevKit + 1.54\" TFT Expansion",
      "description": "Generic N16R8 devkit with MAX98357A speaker, INMP441 mic",
      "chipFamily": "ESP32-S3",
      "image": "images/espie-devkit.jpg",
      "firmware": "espie-devkit/1.0.0.bin",
      "version": "1.0.0"
    }
  ]
}
```

- [ ] **Step 2: Rename the existing firmware binary**

```bash
cd espie/data/firmware
mv espie-spotpear/1.0.0.20260330230942.bin espie-spotpear/1.0.0.bin
```

- [ ] **Step 3: Create `espie/server/api/firmware/boards.get.ts`**

```typescript
import fs from 'fs'
import path from 'path'

export default defineEventHandler(async () => {
  const firmwareDir = process.env.FIRMWARE_DIR || './data/firmware'
  const boardsPath = path.join(firmwareDir, 'boards.json')

  if (!fs.existsSync(boardsPath)) {
    throw createError({ statusCode: 404, statusMessage: 'No boards.json found' })
  }

  return JSON.parse(fs.readFileSync(boardsPath, 'utf-8'))
})
```

- [ ] **Step 4: Update `manifest.get.ts` to redirect**

Replace the contents of `espie/server/api/firmware/manifest.get.ts` so old clients still work:

```typescript
export default defineEventHandler(async (event) => {
  return sendRedirect(event, '/api/firmware/boards', 301)
})
```

- [ ] **Step 5: Delete `manifest.json`**

```bash
rm espie/data/firmware/manifest.json
```

- [ ] **Step 6: Verify endpoint works**

Start the dev server and test:

```bash
curl -s http://localhost:8000/api/firmware/boards | jq '.boards | length'
# Expected: 2
curl -s http://localhost:8000/api/firmware/boards | jq '.boards[].id'
# Expected: "espie-spotpear" and "espie-devkit"
```

- [ ] **Step 7: Commit**

```bash
git add espie/data/firmware/boards.json espie/server/api/firmware/boards.get.ts espie/server/api/firmware/manifest.get.ts
git rm espie/data/firmware/manifest.json
git add espie/data/firmware/espie-spotpear/1.0.0.bin
git commit -m "feat: replace manifest.json with boards.json registry"
```

---

### Task 2: Update useFlashWizard composable

**Files:**
- Modify: `espie/app/composables/useFlashWizard.ts`

The composable needs to: fetch boards.json, expose a board list filtered by chip, accept a board selection, and flash the selected board's firmware (not a hardcoded manifest).

- [ ] **Step 1: Update types**

At the top of `useFlashWizard.ts`, replace the `FirmwareManifest` interface and add board types:

```typescript
export type WizardStep = 'idle' | 'connecting' | 'connected' | 'board-select' | 'flashing' | 'complete' | 'error'

export interface BoardEntry {
  id: string
  name: string
  description: string
  chipFamily: string
  image: string
  firmware: string
  version: string
}

interface BoardsManifest {
  shared: {
    bootloader: { path: string; offset: string }
    partitionTable: { path: string; offset: string }
    otaData: { path: string; offset: string }
    nvsOffset: string
  }
  boards: BoardEntry[]
}
```

Remove the old `FirmwareManifest` interface.

- [ ] **Step 2: Update state refs**

Replace the `manifest` ref with boards state:

```typescript
const boards = ref<BoardEntry[]>([])
const selectedBoard = ref<BoardEntry | null>(null)
const sharedParts = ref<BoardsManifest['shared'] | null>(null)
```

- [ ] **Step 3: Replace `loadManifest` with `loadBoards`**

```typescript
async function loadBoards(chipFamily: string) {
  try {
    const data = await $fetch<BoardsManifest>('/api/firmware/boards')
    sharedParts.value = data.shared
    boards.value = data.boards.filter(b => b.chipFamily === chipFamily)
    if (boards.value.length === 1) {
      selectedBoard.value = boards.value[0]
    }
  } catch {
    boards.value = []
    log('warn', 'Could not load board registry')
  }
}
```

- [ ] **Step 4: Update `connect` function**

After chip detection succeeds, call `loadBoards` with the detected chip family and transition to `board-select` instead of `connected`:

Replace this section inside the `try` block (after `chipInfo.value = { ... }`):

```typescript
      log('success', `Chip: ${desc}`)
      log('info', `MAC: ${mac}`)
      log('info', `Features: ${features.join(', ')}`)

      await loadConfig()
      await loadBoards(chip)  // chip is the chip family string from esptool

      step.value = 'board-select'
```

Remove the old `await Promise.all([loadConfig(), loadManifest()])` and `step.value = 'connected'`.

- [ ] **Step 5: Add `selectBoard` function**

```typescript
function selectBoard(board: BoardEntry) {
  selectedBoard.value = board
  log('info', `Selected board: ${board.name}`)
  step.value = 'connected'
}
```

- [ ] **Step 6: Update `flash` function**

Replace the manifest-based firmware download with board-based download. The key change is in the `else if (manifest.value)` branch — replace it with:

```typescript
    } else if (selectedBoard.value && sharedParts.value) {
      const board = selectedBoard.value
      const shared = sharedParts.value

      // Download shared parts
      const sharedFiles = [
        { name: 'bootloader', ...shared.bootloader },
        { name: 'partition-table', ...shared.partitionTable },
        { name: 'ota-data', ...shared.otaData },
      ]

      for (const part of sharedFiles) {
        log('info', `Downloading ${part.name}...`)
        const response = await fetch(`/api/firmware/download/${part.path}`)
        if (!response.ok) throw new Error(`Failed to download ${part.name}: ${response.statusText}`)
        const data = new Uint8Array(await response.arrayBuffer())
        fileArray.push({ data, address: parseInt(part.offset, 16) })
        partNames.push(part.name)
        log('success', `${part.name}: ${(data.length / 1024).toFixed(0)} KB`)
      }

      // Download board-specific firmware
      log('info', `Downloading ${board.id} firmware...`)
      const fwResponse = await fetch(`/api/firmware/download/${board.firmware}`)
      if (!fwResponse.ok) throw new Error(`Failed to download firmware: ${fwResponse.statusText}`)
      const fwData = new Uint8Array(await fwResponse.arrayBuffer())
      fileArray.push({ data: fwData, address: 0x20000 })
      partNames.push('application')
      log('success', `application: ${(fwData.length / 1024).toFixed(0)} KB`)

      // Generate NVS
      log('info', 'Generating NVS partition with WiFi config...')
      const nvsResponse = await fetch('/api/firmware/nvs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid: wifiSsid.value,
          password: wifiPassword.value,
          otaUrl: `${serverUrl.value}/xiaozhi/ota/`,
        }),
      })
      if (!nvsResponse.ok) throw new Error('Failed to generate NVS partition')
      const nvsData = new Uint8Array(await nvsResponse.arrayBuffer())
      fileArray.push({ data: nvsData, address: parseInt(shared.nvsOffset, 16) })
      partNames.push('nvs')
      log('success', `NVS partition: ${(nvsData.length / 1024).toFixed(0)} KB (WiFi: ${wifiSsid.value})`)
```

- [ ] **Step 7: Update the no-firmware error**

Change the else branch at the end of the firmware selection:

```typescript
    } else {
      errorMessage.value = 'No board selected. Go back and select your board.'
      step.value = 'error'
      return
    }
```

- [ ] **Step 8: Update return object**

Replace the old `manifest` export with the new refs and functions:

```typescript
  return {
    step: readonly(step),
    logs: readonly(logs),
    progress: readonly(progress),
    chipInfo: readonly(chipInfo),
    errorMessage: readonly(errorMessage),
    boards: readonly(boards),
    selectedBoard: readonly(selectedBoard),
    isWebSerialSupported: readonly(isWebSerialSupported),
    isLinux: readonly(isLinux),
    wifiSsid,
    wifiPassword,
    serverUrl,
    customFirmware,
    connect,
    selectBoard,
    flash,
    reset,
    retry,
  }
```

- [ ] **Step 9: Commit**

```bash
git add espie/app/composables/useFlashWizard.ts
git commit -m "feat: update flash wizard composable for multi-board"
```

---

### Task 3: Update FlashWizard.vue with board picker

**Files:**
- Modify: `espie/app/components/FlashWizard.vue`

Add a board selection step between connecting and WiFi config.

- [ ] **Step 1: Update script setup**

Replace the destructured imports from `useFlashWizard()`:

```typescript
const {
  step,
  logs,
  progress,
  chipInfo,
  errorMessage,
  boards,
  selectedBoard,
  isWebSerialSupported,
  isLinux,
  wifiSsid,
  wifiPassword,
  serverUrl,
  customFirmware,
  connect,
  selectBoard,
  flash,
  reset,
  retry,
} = useFlashWizard()
```

- [ ] **Step 2: Update step indicators**

Replace the steps array and stepIndex computed:

```typescript
const steps = ['Connect', 'Board', 'WiFi', 'Flash', 'Done']
const stepIndex = computed(() => {
  switch (step.value) {
    case 'idle': return 0
    case 'connecting': return 0
    case 'board-select': return 1
    case 'connected': return 2
    case 'flashing': return 3
    case 'complete': return 4
    case 'error': return -1
    default: return 0
  }
})
```

- [ ] **Step 3: Add board picker template**

Insert this block after the idle/connect `<div>` and before the connected (WiFi) `<div>`:

```html
    <!-- Step: Board Selection -->
    <div v-else-if="step === 'board-select'">
      <div class="flex items-center gap-2 mb-4">
        <UBadge color="success" variant="subtle">
          {{ chipInfo?.description || chipInfo?.chipName || 'Connected' }}
        </UBadge>
        <span class="text-xs text-neutral-500 font-mono">{{ chipInfo?.mac }}</span>
      </div>

      <p class="text-sm text-neutral-400 mb-4">Select your board:</p>

      <div v-if="boards.length === 0" class="text-sm text-neutral-500">
        No supported boards found for this chip. Upload a custom firmware instead.
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          v-for="board in boards"
          :key="board.id"
          class="text-left rounded-lg border p-4 transition-colors"
          :class="selectedBoard?.id === board.id
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-neutral-700 hover:border-neutral-500 bg-neutral-900'"
          @click="selectBoard(board)"
        >
          <div class="font-medium text-sm">{{ board.name }}</div>
          <div class="text-xs text-neutral-400 mt-1">{{ board.description }}</div>
          <div class="text-xs text-neutral-500 mt-2">v{{ board.version }}</div>
        </button>
      </div>
    </div>
```

- [ ] **Step 4: Update the connected step firmware info**

In the connected (WiFi config) step, replace the `manifest` references. Change:

```html
        <span v-if="manifest" class="text-sm text-neutral-400">
          {{ manifest.model }} v{{ manifest.version }}
        </span>
```

To:

```html
        <span v-if="selectedBoard" class="text-sm text-neutral-400">
          {{ selectedBoard.name }} v{{ selectedBoard.version }}
        </span>
```

And replace the no-firmware alert condition `v-else-if="!customFirmware"` — change `v-else` at the end to:

```html
        <UAlert
          v-else-if="!customFirmware"
          color="warning"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          title="No firmware available"
          description="Run build-boards.sh to prepare firmware files, or upload a custom binary."
          class="flex-1"
        />
```

- [ ] **Step 5: Update the complete step**

Replace the firmware line in the completion summary:

```html
        <div v-if="selectedBoard" class="flex justify-between">
          <span class="text-green-400">Firmware</span>
          <span>{{ selectedBoard.name }} v{{ selectedBoard.version }}</span>
        </div>
```

- [ ] **Step 6: Test in browser**

Open `http://localhost:8000/devices` in Chrome. Without a device connected, verify:
1. The "Connect Device" button appears
2. No console errors

If you have a device, connect it and verify:
1. Chip is detected
2. Board picker shows two boards
3. Clicking a board moves to WiFi config
4. Board name and version shown next to Flash button

- [ ] **Step 7: Commit**

```bash
git add espie/app/components/FlashWizard.vue
git commit -m "feat: add board picker step to flash wizard"
```

---

### Task 4: Build devkit firmware and add to data/firmware

**Files:**
- Create: `espie/data/firmware/espie-devkit/1.0.0.bin`

This task builds the devkit firmware and places it alongside the existing Spotpear binary so the flash wizard can serve both.

- [ ] **Step 1: Build devkit firmware**

```bash
cd firmware
cp sdkconfig.devkit sdkconfig
source ~/esp-idf/export.sh
idf.py fullclean && idf.py build
```

- [ ] **Step 2: Copy binary to data/firmware**

```bash
mkdir -p ../espie/data/firmware/espie-devkit
cp build/xiaozhi.bin ../espie/data/firmware/espie-devkit/1.0.0.bin
```

- [ ] **Step 3: Restore default sdkconfig**

```bash
cp sdkconfig.spotpear sdkconfig
```

- [ ] **Step 4: Verify both boards exist**

```bash
ls -la ../espie/data/firmware/espie-spotpear/*.bin
ls -la ../espie/data/firmware/espie-devkit/*.bin
# Both should show a ~2.5MB .bin file
```

- [ ] **Step 5: Commit**

```bash
git add -f espie/data/firmware/espie-devkit/1.0.0.bin
git commit -m "feat: add espie-devkit pre-built firmware binary"
```

---

### Task 5: Create build-boards.sh script

**Files:**
- Create: `firmware/build-boards.sh`

A script that builds firmware for all boards in the registry, placing binaries in `data/firmware/`.

- [ ] **Step 1: Create the script**

Create `firmware/build-boards.sh`:

```bash
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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x firmware/build-boards.sh
```

- [ ] **Step 3: Commit**

```bash
git add firmware/build-boards.sh
git commit -m "feat: add build-boards.sh for multi-board firmware builds"
```

---

### Task 6: Clean up old files and rename sdkconfigs

**Files:**
- Rename: `firmware/sdkconfig.spotpear` -> `firmware/sdkconfig.espie-spotpear`
- Rename: `firmware/sdkconfig.devkit` -> `firmware/sdkconfig.espie-devkit`
- Delete: `firmware/sdkconfig.espie-devkit` (the old name from earlier commit)
- Delete: `espie/data/firmware/manifest.json` (if not already removed)

- [ ] **Step 1: Rename sdkconfigs to match board IDs**

The convention is `sdkconfig.<board-id>`. The board IDs are `espie-spotpear` and `espie-devkit`.

```bash
cd firmware
mv sdkconfig.spotpear sdkconfig.espie-spotpear
mv sdkconfig.devkit sdkconfig.espie-devkit
```

- [ ] **Step 2: Remove stale files**

```bash
rm -f ../espie/data/firmware/manifest.json
```

- [ ] **Step 3: Verify naming consistency**

```bash
# Board IDs in boards.json
cat ../espie/data/firmware/boards.json | python3 -c "import json,sys; [print(b['id']) for b in json.load(sys.stdin)['boards']]"
# Expected: espie-spotpear, espie-devkit

# Sdkconfig files
ls sdkconfig.espie-*
# Expected: sdkconfig.espie-spotpear, sdkconfig.espie-devkit

# Firmware directories
ls ../espie/data/firmware/espie-*/
# Expected: espie-spotpear/1.0.0.bin, espie-devkit/1.0.0.bin
```

- [ ] **Step 4: Commit**

```bash
git add -A firmware/sdkconfig.* espie/data/firmware/
git commit -m "chore: align sdkconfig names with board IDs, remove manifest.json"
```

- [ ] **Step 5: Push**

```bash
git push
```
