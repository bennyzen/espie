# Espie Firmware

Custom fork of [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) firmware, patched for the [Espie](../README.md) private voice assistant. Connects to the Espie TypeScript server instead of the Chinese xiaozhi.me cloud.

## Hardware

**Currently targeting:** Spotpear ESP32-S3-1.54-MUMA

| Spec | Detail |
|------|--------|
| Chip | ESP32-S3 N16R8 (16MB flash, 8MB PSRAM) |
| Display | 1.54" ST7789 240x240 |
| Audio | ES8311 codec (mic + speaker) |
| Touch | CST816D capacitive (I2C 0x15) |
| USB | Built-in CDC ACM (shows as `/dev/ttyACM0`) |
| Buttons | BOOT (GPIO 0) + Power |

The upstream firmware supports 70+ boards. Other boards should work by selecting the right `CONFIG_BOARD_TYPE_*` in sdkconfig, but only the Spotpear board is tested with Espie.

## Custom Patches (vs upstream)

This fork diverges from upstream in several areas:

**Display system:**
- Multi-screen UI with `ScreenManager` — Chat, Clock, NowPlaying, Settings screens
- `Screen` base class with `Create()`, `OnEnter()`, `OnTap()` lifecycle
- Chat bubbles (green=user, gray=assistant, blue=scheduled, centered=system)
- Global top bar on `lv_layer_top()` — WiFi, server connection, mute, battery icons persist across all screens
- Server connection icon: green cloud (connected), blinking amber cloud (connecting), red cloud-slash (disconnected)
- Alert icons (cloud-slash) above error messages on the chat screen
- `SetEmotion()` hides emoji whenever chat messages exist
- System messages update in place (never delete LVGL objects from non-LVGL tasks — causes crash in `lv_event_mark_deleted`)

**Protocol:**
- Persistent WebSocket with keepalive and auto-reconnect
- `ConnectionState` enum exposed for UI (server connection icon)
- Handles server-pushed TTS messages while idle (for scheduled conversations)

**OTA:**
- OTA URL points to Espie server (`http://SERVER_IP:8000/xiaozhi/ota/`)
- Retry backoff: 10s → 30s → 60s cap (upstream doubles aggressively and can crash)
- User-friendly error messages ("Can't reach server" instead of "Check for new version failed")

**Other:**
- English only (`CONFIG_LANGUAGE_EN_US=y`)
- Weather fetch gated on server connection (avoids crashes when server is down)
- CST816D touch uses hardware gesture register for tap detection

## Build & Flash

Requires [ESP-IDF v5.5.2+](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/).

```bash
. ~/esp-idf/export.sh
cd firmware/

idf.py build
sudo chmod 666 /dev/ttyACM0
idf.py -p /dev/ttyACM0 flash
```

Key sdkconfig settings (already configured):
- `CONFIG_BOARD_TYPE_SPOTPEAR_ESP32_S3_1_54_MUMA=y`
- `CONFIG_OTA_URL="http://YOUR_SERVER_IP:8000/xiaozhi/ota/"`
- `CONFIG_LANGUAGE_EN_US=y`
- `CONFIG_USE_WECHAT_MESSAGE_STYLE=y`

**Flashing notes:**
- Device must be **powered on** (press power button) before flashing
- No need to hold BOOT — auto-download circuit handles it
- If your server IP changes, you must rebuild and reflash (OTA URL is compile-time)

## OTA Dev Workflow

After the first USB flash, iterate wirelessly:

```bash
./dev-ota.sh              # build + copy binary + reboot device over WiFi
./dev-ota.sh --no-reboot  # build + copy only
./dev-ota.sh --flash      # USB flash (first time or recovery)
```

The script temporarily bumps `PROJECT_VER` to a timestamped dev version (e.g. `1.0.0.20260330183045`), builds, copies the binary to `espie/data/bin/`, and reboots the device via WebSocket. The device checks OTA, sees the dev version is newer, downloads, and restarts. Each build gets a unique timestamp so the device never re-downloads the same binary.

If the Espie server runs on a remote machine (e.g. a Pi), rsync the binary after building:
```bash
rsync espie/data/bin/*.bin pi:~/xiaozhi/espie/data/bin/
```

The dashboard Devices page (`/devices`) also has a Reboot button.

## Monitoring

```bash
./monitor.sh              # default: /dev/ttyACM0
./monitor.sh /dev/ttyUSB0 # custom port
```

- Console shows warnings/errors + INFO from application tags (Application, Display, OTA, WebSocket, etc.)
- Full unfiltered output is written to `monitor.log` (gitignored)
- Press `Ctrl+]` to quit
- Decode crash backtraces: `xtensa-esp32s3-elf-addr2line -fe build/xiaozhi.elf 0x<addr>`

## Project Structure

```
firmware/
  main/
    application.cc/h          # Main event loop, state machine, OTA
    display/
      screen.h                # Base class for all screens
      screen_manager.cc/h     # Multi-screen navigation
      chat_screen.cc/h        # Chat bubbles, alert icons
      clock_screen.cc/h       # Idle home screen with time/date
      now_playing_screen.cc/h # Audio playback info
      settings_screen.cc/h    # Volume, brightness, device info
      lvgl_display/
        lvgl_display.cc/h     # LVGL driver, status bar, notifications
        lvgl_theme.cc/h       # Theme colors, fonts, spacing
    audio/
      audio_service.cc/h      # I2S + Opus encode/decode pipeline
      codecs/                 # ES8311, ES8388, etc.
    protocols/
      websocket_protocol.cc/h # WebSocket with keepalive
    boards/
      sp-esp32-s3-1.54-muma/  # Board-specific init, screen setup
  dev-ota.sh                  # Wireless OTA dev script
  monitor.sh                  # Filtered serial monitor
```

## Known Issues

- **Never delete LVGL objects from non-LVGL tasks.** `lv_obj_del()` and `lv_obj_clean()` crash in `lv_event_mark_deleted` due to stale global event chain pointers — even with `lvgl_port_lock` held. Always update objects in place (`lv_label_set_text`, `lv_obj_add_flag(LV_OBJ_FLAG_HIDDEN)`) and find existing objects by `lv_obj_get_user_data()` tag.
- **LVGL fonts have no fallback.** Setting a FontAwesome codepoint on a label with a text font (or vice versa) crashes. Use `icon_font`/`large_icon_font` from the theme for icons, text font for text. Never mix in a single label.
- **`lv_layer_top()` must be used after screen init.** Creating the global top bar before `lv_screen_load()` crashes. The board's `InitializeScreens()` calls `CreateGlobalTopBar()` after loading the first screen.

## Credits

Forked from [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) (MIT license).
