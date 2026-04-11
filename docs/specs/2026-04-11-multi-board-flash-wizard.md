# Multi-Board Flash Wizard

**Date:** 2026-04-11
**Status:** Approved

## Problem

Espie is an open-source replacement for the xiaozhi.me Chinese cloud platform. Users bring their own ESP32 hardware — the project must support multiple boards without requiring users to install ESP-IDF or understand GPIO pin assignments. The current flash wizard supports a single hardcoded board. Adding a second board (the generic ESP32-S3 DevKit with 1.54" TFT expansion) exposed the need for multi-board support.

## Goals

- Users connect an ESP32, pick their board from a list, and flash — no toolchain required
- Adding a new supported board is a data-driven contribution (sdkconfig + registry entry)
- Pre-built firmware binaries, one per board, served by the Espie server
- OTA continues to work per-board-model without changes
- Start with committed binaries (phase A), migrate to GitHub release assets later (phase B)

## Non-Goals

- Runtime board auto-detection in firmware (boards with identical I2C fingerprints make this unreliable across the ESP32 ecosystem)
- On-demand firmware compilation on the server
- Supporting non-ESP32-S3 chips initially (ESP32, ESP32-C3 can be added later following the same pattern)

## Design

### Board Registry

A `boards.json` file in `data/firmware/` replaces the current single-board `manifest.json`. It is the source of truth for which boards the flash wizard offers.

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
      "description": "All-in-one with ES8311 codec, CST816D touch, battery. AliExpress: \"ESP32-S3 DeepSeek AI Chat Box 1.54 inch LCD N16R8\"",
      "chipFamily": "ESP32-S3",
      "image": "images/espie-spotpear.jpg",
      "upstream": "sp-esp32-s3-1.54-muma",
      "firmware": "espie-spotpear/1.0.0.bin",
      "version": "1.0.0"
    },
    {
      "id": "espie-devkit",
      "name": "ESP32-S3 DevKit + 1.54\" TFT Expansion Board",
      "description": "Generic N16R8 devkit with MAX98357A speaker, INMP441 mic, no touch. AliExpress: \"ESP32 S3 N16R8 Development Board with Speaker 1.54 Inch TFT Display Expansion Adapter Kit\"",
      "chipFamily": "ESP32-S3",
      "image": "images/espie-devkit.jpg",
      "upstream": "espie-devkit",
      "firmware": "espie-devkit/1.0.0.bin",
      "version": "1.0.0"
    }
  ]
}
```

**Fields:**
- `id` — Unique identifier. Matches the sdkconfig filename (`sdkconfig.<id>`) and the `BOARD_TYPE` reported by the firmware for OTA.
- `name` — Human-readable name shown in the wizard.
- `description` — Shown below the name. Should include the AliExpress search terms so users can identify their board.
- `chipFamily` — Used to filter boards after chip detection. Values: `ESP32`, `ESP32-S3`, `ESP32-C3`, etc.
- `image` — Path to a board photo, relative to `data/firmware/`. Shown in the wizard card.
- `upstream` — The upstream xiaozhi board directory name. Used by the build script to locate the board source code.
- `firmware` — Path to the firmware binary, relative to `data/firmware/`.
- `version` — Firmware version string.

### Directory Structure

```
data/firmware/
  boards.json
  bootloader.bin
  partition-table.bin
  ota-data.bin
  images/
    espie-spotpear.jpg
    espie-devkit.jpg
  espie-spotpear/
    1.0.0.bin
  espie-devkit/
    1.0.0.bin
```

Bootloader, partition table, and OTA data are shared across all ESP32-S3 boards (same chip, same flash layout, same partition scheme). If a future board requires a different partition layout (e.g. different flash size), the `shared` section can be overridden per-board by adding `bootloader`, `partitionTable`, or `otaData` fields to the board entry.

### Flash Wizard Flow

```
[Connect Device] -> detect chip family -> fetch boards.json
     -> filter boards by chip family -> show board picker (card grid)
     -> user selects board -> download firmware + shared parts
     -> generate NVS (WiFi + OTA URL) -> flash all parts -> reboot
```

**Step by step:**

1. User clicks "Flash Device" on the `/devices` page.
2. Browser requests Web Serial port, filtered to Espressif VID (0x303A).
3. esptool-js connects, reads chip family (ESP32-S3, etc.).
4. Wizard fetches `/api/firmware/boards` (serves `boards.json`).
5. Filters boards where `chipFamily` matches the detected chip.
6. Displays a card grid: board image, name, description. User picks one.
7. Wizard downloads: shared bootloader + partition table + OTA data + the selected board's firmware binary.
8. Wizard generates NVS via `POST /api/firmware/nvs` (WiFi SSID, password, OTA URL).
9. Flashes all parts to the device.
10. Device reboots, connects to WiFi, appears in the device list.

If only one board matches the chip family, it is pre-selected (skip the picker).

### Server API Changes

**New endpoint:** `GET /api/firmware/boards`
Returns the `boards.json` content. The flash wizard uses this instead of the current `/api/firmware/manifest`.

**Modified endpoint:** `GET /api/firmware/download/:path`
Already supports arbitrary paths under `data/firmware/`. No changes needed — the wizard will request paths like `espie-spotpear/1.0.0.bin`.

**Removed:** `GET /api/firmware/manifest`
Replaced by `/api/firmware/boards`. The composable `useFlashWizard.ts` is updated to use the new endpoint.

### OTA

No changes. Each board's firmware reports its model via the `BOARD_TYPE` string (e.g. `espie-spotpear`). The OTA endpoint matches `data/bin/<model>_<version>.bin`. This already works per-model.

### Build Pipeline

**`firmware/build-boards.sh`** — Builds firmware for all boards in the registry.

```
For each board in boards.json:
  1. Copy sdkconfig.<board.id> to sdkconfig
  2. idf.py fullclean && idf.py build
  3. Copy build/xiaozhi.bin to data/firmware/<board.id>/<version>.bin
  4. Copy shared binaries (bootloader, partition-table, ota-data) — once
Restore original sdkconfig on exit.
```

**`firmware/dev-ota.sh`** — Unchanged. Continues to work for single-board development using the active sdkconfig.

**Sdkconfig files:**
- `firmware/sdkconfig` — Active build config (gitignored or set to a default).
- `firmware/sdkconfig.espie-spotpear` — Spotpear board config.
- `firmware/sdkconfig.espie-devkit` — DevKit board config.
- Pattern: `firmware/sdkconfig.<board-id>` for each supported board.

### Flash Wizard UI Changes

The `FlashWizard.vue` component gains a board selection step between "connected" and "flashing":

**Steps:** `idle` -> `connecting` -> `connected` -> `board-select` -> `flashing` -> `complete`

The `board-select` step shows a responsive card grid. Each card has:
- Board photo (or a generic placeholder if no image)
- Board name
- Short description

Clicking a card selects the board and enables the "Flash" button.

### Adding a New Board (contributor workflow)

1. Identify the upstream xiaozhi board directory (or create a new one under `firmware/main/boards/`).
2. Create `firmware/sdkconfig.<board-id>` with the right `CONFIG_BOARD_TYPE_*=y` and `CONFIG_LANGUAGE_EN_US=y`.
3. Build and verify the firmware works on the hardware.
4. Add an entry to `data/firmware/boards.json`.
5. Optionally add a board photo to `data/firmware/images/`.
6. Submit a PR. CI (or a maintainer) builds the binary and adds it to the firmware directory.

### Migration from Current State

1. Replace `manifest.json` with `boards.json`.
2. Rename `data/firmware/espie-spotpear/1.0.0.20260330230942.bin` to `data/firmware/espie-spotpear/1.0.0.bin`.
3. Add `data/firmware/espie-devkit/1.0.0.bin`.
4. Update `useFlashWizard.ts` to fetch `boards.json`, add the board picker step.
5. Update `FlashWizard.vue` with the board selection UI.
6. Add the `GET /api/firmware/boards` endpoint.
7. Rename sdkconfig files to match new board IDs.

### Future: GitHub Release Assets (Phase B)

When the board count grows beyond what's practical to commit:
1. CI builds all board firmwares on git tag.
2. Binaries are published as GitHub release assets.
3. The flash wizard fetches `boards.json` from the release (or from the server, which proxies it).
4. Firmware binaries are downloaded on-demand from GitHub during flashing.
5. The server can optionally cache downloaded binaries locally for offline use after first download.

This is out of scope for the initial implementation.
