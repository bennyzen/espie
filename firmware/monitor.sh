#!/usr/bin/env bash
# ESP32 monitor with filtered console output and full log capture.
#
# Usage:
#   ./monitor.sh              # default: /dev/ttyACM0
#   ./monitor.sh /dev/ttyUSB0 # custom port
#
# Console shows only application-relevant logs.
# Full unfiltered output is always written to: firmware/monitor.log
# Press Ctrl+] to quit (standard idf.py monitor exit).

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-/dev/ttyACM0}"
LOGFILE="monitor.log"

# Source ESP-IDF
source ~/esp-idf/export.sh 2>/dev/null

# Ensure port is accessible
sudo chmod 666 "$PORT" 2>/dev/null || true

# Print filter: show ERRORS/WARNINGS from everything (*:W),
# plus INFO+ from our application tags.
FILTER="*:W"
FILTER+=";Application:I"
FILTER+=";ChatScreen:I"
FILTER+=";ClockScreen:I"
FILTER+=";ScreenMgr:I"
FILTER+=";NowPlayingScreen:I"
FILTER+=";SettingsScreen:I"
FILTER+=";LcdDisplay:I"
FILTER+=";Display:I"
FILTER+=";AudioService:I"
FILTER+=";Board:I"
FILTER+=";Spotpear_esp32_s3_lcd_1_54:I"
FILTER+=";Button:I"
FILTER+=";OTA:I"
FILTER+=";Ota:I"
FILTER+=";Mqtt:I"
FILTER+=";Websocket:I"
FILTER+=";WebSocket:I"
FILTER+=";Protocol:I"

echo "╔══════════════════════════════════════════════╗"
echo "║  Monitor: $PORT"
echo "║  Log file: $LOGFILE"
echo "║  Filter: errors/warnings + app tags"
echo "║  Press Ctrl+] to quit"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Run monitor: pipe through tee for the log file.
# --print-filter only affects console display; tee captures the raw stream.
# --no-reset avoids rebooting the device on connect.
idf.py -p "$PORT" monitor --no-reset --print-filter="$FILTER" 2>&1 | tee "$LOGFILE"
