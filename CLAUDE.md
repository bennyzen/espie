# Espie — Private Voice Assistant

## Project Overview
Self-hosted private voice assistant — an ESP32-based device (XiaoZhi hardware) with a TypeScript backend, replacing the default Chinese cloud platform (xiaozhi.me) for full privacy. Built on [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) firmware with a modern Nuxt 4 full-stack server.

**English only.** The firmware, voice pipeline, ASR, TTS, embedding model, and all prompts are configured for English. Chinese is not supported.

## Architecture
- **espie/** — TypeScript backend + web dashboard (Nuxt 4, NuxtUI v4). The active server.
- **firmware/** — ESP32 firmware (C++, ESP-IDF). Fork of [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32)

## Current Deployment
- **Server**: Raspberry Pi 4 (4GB RAM, aarch64) — or any platform with Node.js 20+ (Linux, macOS, Windows, ARM or x86)
- **Device**: Spotpear ESP32-S3-1.54-MUMA (see Firmware section)

## Service Stack
| Component | Provider | Location |
|-----------|----------|----------|
| ASR | Groq Whisper (`whisper-large-v3-turbo`) | Cloud API |
| LLM | Any pi-ai provider (23+) — Anthropic, OpenAI, Google, Groq, etc. | Cloud API |
| TTS | EdgeTTS (free, no API key) | Cloud (Microsoft) |
| VAD | SileroVAD (ONNX via avr-vad) | Local |
| Embeddings | FastEmbed (BAAI/bge-small-en-v1.5, 384 dims) | Local |
| Smart Home | Home Assistant REST API | Local |
| Server | Espie (Nuxt 4, TypeScript, Docker) | Local |
| Database | SQLite (better-sqlite3 + sqlite-vec) | Local |

## Espie Server (`espie/`)

### Key Directories
```
espie/
  app/                    # Nuxt 4 frontend (Vue 3, NuxtUI v4)
    pages/                # Dashboard pages: chat, sessions, memory, devices, tasks, config, logs
    composables/          # useDevices, useLogs (SSE-based), useFlashWizard
    plugins/              # crypto-polyfill.client.ts (HTTP secure context fix)
  server/
    agent/                # AgentSession — transport-agnostic pi-agent-core wrapper
    providers/            # LLM (any pi-ai provider), ASR (Groq/OpenAI), TTS (Edge/OpenAI), VAD, embeddings
    routes/
      api/chat.ts         # WebSocket: browser text chat
      xiaozhi/v1.ts       # WebSocket: ESP32 voice protocol
      xiaozhi/ota/        # OTA firmware update endpoint
    api/                  # REST endpoints: config, providers, sessions, memory, devices, firmware, oauth
    tools/                # Agent tools: builtin (HA), memory, ytmusic
    utils/                # config, db, voice-pipeline, scheduler, ota, nvs-generator, memory, device-registry
  data/                   # Runtime data (SQLite DB, config YAML). Gitignored except data/firmware/.
  data/firmware/          # Pre-built firmware binaries for browser flash wizard. Committed.
  docker-compose.dev.yml  # Dev mode: bind mount + host networking + hot reload
  Dockerfile              # Production multi-stage build
```

### Technology Stack
| Technology | Purpose |
|------------|---------|
| Nuxt 4.4 + Nitro | Full-stack framework, SSR, API routes, WebSocket |
| NuxtUI v4 | Dashboard components, Tailwind CSS 4, dark mode |
| pi-agent-core + pi-ai | Agent loop, tool calling, 23+ LLM providers |
| better-sqlite3 + sqlite-vec | Database + vector search for memory |
| fastembed | Local ONNX embeddings (bge-small-en-v1.5, 384 dims, English only) |
| @discordjs/opus / opusscript | Opus codec (native with WASM fallback) |
| avr-vad | Silero VAD v5 via ONNX |
| groq-sdk | Groq Whisper ASR |
| edge-tts-universal | Microsoft Edge TTS (free) |
| esptool-js | Browser-based ESP32 flashing via Web Serial API |

### LLM Provider Configuration
The config page (`/config`) dynamically lists all 23+ pi-ai providers with model dropdowns. Supports:
- **API key auth**: Stored in `data/.config.yaml` under `api_keys` section
- **OAuth auth**: Anthropic, GitHub Copilot, Google Gemini CLI, OpenAI Codex — login via `/api/oauth/[provider]/login`
- **Env var fallback**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, etc.

API key resolution order (in `createApiKeyResolver()`): config YAML → OAuth credentials (with auto-refresh) → environment variables.

### Dev Workflow
**All development happens locally.** Never SSH into the Pi or run remote commands — the Pi is a deployment target only. The user deploys manually when ready.
```bash
cd espie/
npm install
NUXT_PORT=8000 npx nuxt dev --host 0.0.0.0
```
Logs are local (`npx nuxt dev` stdout). Tests: `npx vitest run` from `espie/`.

### Production Deployment
```bash
docker compose build && docker compose up -d
```

## Firmware (ESP32)

### Supported Boards
The firmware auto-detects the board variant at boot by probing I2C for the ES8311 codec.

**Spotpear** (`espie-spotpear`) — full-featured
- **AliExpress listing**: "ESP32-S3 DeepSeek AI Chat Box 1.54 inch LCD N16R8"
- **Chip**: ESP32-S3 N16R8 (16MB flash, 8MB PSRAM)
- **Display**: 1.54" ST7789 240x240
- **Audio codec**: ES8311
- **Touch**: CST816D — tap toggles chat state, swipe navigates screens
- **Buttons**: BOOT (GPIO 0) + Power button
- **USB**: Built-in ESP32-S3 USB JTAG/serial (CDC ACM, NOT CH340) — shows as `/dev/ttyACM0`

**DevKit** (`espie-devkit`) — limited I/O, push-to-talk only
- Generic ESP32-S3 1.54" TFT expansion adapter kit
- **Audio**: MAX98357A (I2S output) + INMP441 (I2S input) — no hardware codec
- **Touch**: None — no swipe gestures, no screen navigation
- **Buttons**: BOOT (GPIO 0) acts as push-to-talk toggle, Vol Up (GPIO 39), Vol Down (GPIO 38)
- **Wake word**: Not supported (removed — too unreliable)
- **Interaction model**: Press BOOT to start/stop listening. No hands-free trigger.
- **Missing vs Spotpear**: No touch, no swipe screens, no wake word, no charge detection, no LED

### Build & Flash
Requires ESP-IDF v5.5.2+.
```bash
. $IDF_PATH/export.sh  # or ~/esp-idf/export.sh
cd firmware/

# Key sdkconfig settings:
#   CONFIG_BOARD_TYPE_SPOTPEAR_ESP32_S3_1_54_MUMA=y
#   CONFIG_OTA_URL="http://YOUR_SERVER_IP:8000/xiaozhi/ota/"
#   CONFIG_LANGUAGE_EN_US=y
#   CONFIG_USE_WECHAT_MESSAGE_STYLE=y

idf.py build
sudo chmod 666 /dev/ttyACM0
idf.py -p /dev/ttyACM0 flash
```

### Browser Flash Wizard (no ESP-IDF required)
The Devices page (`/devices`) has a built-in flash wizard that provisions ESP32 devices directly from the browser — no toolchain installation needed. Uses the Web Serial API and esptool-js.

**How it works:**
1. Open `/devices` in Chrome (requires HTTPS or localhost for Web Serial)
2. Click "Connect Device" — browser shows port picker, auto-filters for Espressif USB devices
3. Wizard detects chip, pre-fills WiFi credentials from server config
4. Click "Flash" — flashes bootloader, partition table, OTA data, NVS (WiFi + server URL), and application
5. Device reboots, connects to WiFi, appears in the device list

**Pre-built firmware** is committed in `espie/data/firmware/` so users can flash without building. `dev-ota.sh` updates these files on new builds.

**Firmware files** (`espie/data/firmware/`):
- `bootloader.bin` — ESP32-S3 bootloader (from `build/bootloader/`)
- `partition-table.bin` — Flash partition layout (from `build/partition_table/`)
- `ota-data.bin` — OTA data partition pointing to ota_0 (from `build/ota_data_initial.bin`)
- `manifest.json` — Describes parts and flash offsets, generated by `dev-ota.sh`
- `sp-esp32-s3-1.54-muma/{version}.bin` — Application binary

**NVS generation**: The server generates a 16KB NVS partition binary on-the-fly (`POST /api/firmware/nvs`) containing WiFi SSID, password, and OTA URL. Written to flash at offset 0x9000 alongside the firmware.

**Limitations**: Web Serial requires a Chromium browser (Chrome, Edge, Brave) and HTTPS or localhost. Firefox and Safari are not supported. The ESP32-S3 native USB requires a software reset after flashing (hardware RTS reset doesn't work).

### OTA Dev Workflow
`firmware/dev-ota.sh` builds firmware locally and pushes it to the device wirelessly — no USB needed after the first flash.
```bash
cd firmware/
./dev-ota.sh              # build + copy binary + reboot device over WiFi
./dev-ota.sh --no-reboot  # build + copy only (reboot manually)
./dev-ota.sh --flash      # USB flash (first time or recovery)
```
**How it works:** Temporarily sets `PROJECT_VER` to a timestamped dev version (e.g. `1.0.0.20260330183045`), builds, copies the binary to `espie/data/bin/`, and reboots the device via `/api/devices/reboot`. The device checks OTA, sees the dev version is newer, downloads, and restarts. The timestamp ensures each build is unique and always higher than the release version. `CMakeLists.txt` is restored to the release version on exit.

**Remote server (Pi):** The firmware is always compiled locally (cross-compilation is fast on x86, impractical on the Pi). To push to the Pi-hosted server, rsync the binary after building:
```bash
rsync espie/data/bin/*.bin your-server:~/xiaozhi/espie/data/bin/
```

**Dashboard reboot button:** The Devices page (`/devices`) has a Reboot button per device. Sends `{ "type": "system", "command": "reboot" }` via the device's live WebSocket transport.

### Flashing Notes (USB)
- Device must be **powered on** (press power button) before flashing
- No need to hold BOOT for normal flashing (auto-download circuit)
- USB shows as Espressif CDC ACM device, not CH340/CP2102
- mDNS does NOT work from ESP32 — use the server's actual IP address

### Monitoring & Debugging
`firmware/monitor.sh` wraps `idf.py monitor` with filtered output and log capture.
```bash
cd firmware/
./monitor.sh              # default: /dev/ttyACM0
./monitor.sh /dev/ttyUSB0 # custom port
```
- **Console** shows only warnings/errors from all tags, plus INFO+ from application tags (Application, Display, OTA, WebSocket, etc.)
- **Full unfiltered output** is always written to `firmware/monitor.log` (gitignored)
- Read `monitor.log` to debug crashes, decode backtraces, or inspect device behavior
- Press `Ctrl+]` to quit
- Uses `--no-reset` so the device is not rebooted on connect
- To decode crash backtraces: `xtensa-esp32s3-elf-addr2line -fe build/xiaozhi.elf 0x<addr>`

### Display & Touch
- **UI style**: Chat bubbles (green=user, gray=assistant) via `CONFIG_USE_WECHAT_MESSAGE_STYLE=y`
- **Custom patch**: `lcd_display.cc` `SetEmotion()` — emoji hidden whenever chat messages exist
- **Touch**: CST816D (I2C addr 0x15). Short tap toggles chat state, long press ignored.
- **Untapped**: CST816D gesture register (`0x01`) supports swipe gestures — not yet used.

## Secrets & Configuration
- **`espie/.env`** — GROQ_API_KEY, HA_BASE_URL, HA_TOKEN, etc. Gitignored.
- **`espie/data/.config.yaml`** — Provider selection, API keys, personality, schedules. Gitignored. Managed via `/config` UI.
- **`espie/data/db/espie.db`** — SQLite database (sessions, messages, memory). Auto-created.

## Key Constraints
- Firmware OTA URL is baked in at compile time — if the server IP changes, firmware must be rebuilt and reflashed
- Dashboard is served over HTTP — `crypto-polyfill.client.ts` needed for `crypto.randomUUID()`

## Known Issues

### Native Node modules and Nuxt HMR
Native `.node` bindings (onnxruntime-node, @discordjs/opus) can only register once per process. All native module references are cached on `globalThis` (e.g. `__ort_native`, `__opus_native`, `__fastembed_model`) so they survive HMR re-evaluation. If adding a new native dependency, follow this pattern — see `vad.ts`, `opus.ts`, `embeddings.ts`.

### CrossWS delivers text WebSocket messages as Buffer
Nitro's CrossWS layer delivers ALL WebSocket messages (text and binary) as `Buffer`, not `string`. The v1.ts handler checks `bytes[0] === 0x7b` (`{`) to distinguish JSON text from binary Opus audio. Do not use `typeof raw === 'string'` for text detection — it will always be false.

### @discordjs/opus CJS-to-ESM import
`@discordjs/opus` is a CJS module. When dynamically imported in ESM context (`await import()`), the `OpusEncoder` class is at `module.default.OpusEncoder`, not `module.OpusEncoder`. The opus.ts utility handles this with `const ns = mod.default || mod`.

### VAD: Direct ONNX, not avr-vad
The VAD provider (`server/providers/vad.ts`) runs Silero VAD v5 ONNX model directly via onnxruntime-node, matching the Python server's exact approach: 512-sample chunks, dual thresholds (0.5/0.2), sliding window, context state. The `avr-vad` npm package is still a dependency (used only for its bundled Silero ONNX model file), but its `RealTimeVAD` class is NOT used — it produced zero speech events because it uses 1536-sample frames with different internal logic that doesn't match the ESP32's audio characteristics.

### LVGL fonts and codepoint matching
LVGL fonts only contain specific Unicode ranges. If you `lv_label_set_text` with a codepoint the label's font doesn't include (e.g. FontAwesome icon bytes with a text font), LVGL will look up an invalid glyph descriptor and crash — there is no fallback font mechanism. Always set the label's font to match the codepoints you're rendering. Use `icon_font` or `large_icon_font` from the theme for FontAwesome glyphs, and the text font for regular characters. You cannot mix both in a single label.

## Language
- **English only** — firmware, ASR, TTS, embedding model (bge-small-en), and all prompts are English. Chinese is not supported.
- Upstream firmware code/comments are mostly Chinese — translate when explaining
- Device wake words and prompts are configured for English

## Custom Firmware Patches (not upstream)
- **`firmware/main/display/lcd_display.cc`** — `SetEmotion()` hides emoji whenever chat messages exist
- **`firmware/sdkconfig`** — `CONFIG_USE_WECHAT_MESSAGE_STYLE=y`, OTA URL pointing to server
