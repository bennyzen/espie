#!/usr/bin/env python3
"""
Scan upstream board configurations and generate the Espie flash wizard boards registry.

Outputs:
  - ../espie/data/firmware/boards.json — board registry for the flash wizard
  - sdkconfig.boards/{board-id}.defaults — per-board sdkconfig files with Espie overrides

Run from the firmware/ directory:
  python3 generate-boards.py
"""

import csv
import io
import json
import os
import re
from pathlib import Path

# Ensure we're running from the firmware/ directory
os.chdir(Path(__file__).resolve().parent)

BOARDS_DIR = Path("main/boards")
CMAKE_FILE = Path("main/CMakeLists.txt")
SDKCONFIG_BASE = Path("sdkconfig.defaults")
OUTPUT_JSON = Path("../espie/data/firmware/boards.json")
OUTPUT_SDKCONFIG_DIR = Path("sdkconfig.boards")
SKIP_DIRS = {"common", "espie", "espie-devkit", "sp-esp32-s3-1.54-muma"}

# Bootloader offsets per chip family (from ESP-IDF defaults)
BOOTLOADER_OFFSETS = {
    "esp32": "0x1000",
    "esp32s3": "0x0000",
    "esp32c3": "0x0000",
    "esp32c5": "0x0000",
    "esp32c6": "0x0000",
    "esp32p4": "0x2000",
}

# Display names for chip families
CHIP_DISPLAY = {
    "esp32": "ESP32",
    "esp32s3": "ESP32-S3",
    "esp32c3": "ESP32-C3",
    "esp32c5": "ESP32-C5",
    "esp32c6": "ESP32-C6",
    "esp32p4": "ESP32-P4",
}

# Hardcoded Espie boards (always at the top of the list)
ESPIE_BOARDS = [
    {
        "id": "espie-spotpear",
        "name": 'Spotpear ESP32-S3 1.54" MUMA',
        "description": "All-in-one with ES8311 codec, touch, battery",
        "chipFamily": "ESP32-S3",
        "bootloader": {"offset": "0x0000"},
        "partitionTable": {"offset": "0x8000"},
        "otaData": {"offset": "0xD000"},
        "app": {"offset": "0x20000"},
        "version": None,
    },
    {
        "id": "espie-devkit",
        "name": 'ESP32-S3 DevKit + 1.54" TFT Expansion',
        "description": "Generic N16R8 devkit with MAX98357A speaker, INMP441 mic",
        "chipFamily": "ESP32-S3",
        "bootloader": {"offset": "0x0000"},
        "partitionTable": {"offset": "0x8000"},
        "otaData": {"offset": "0xD000"},
        "app": {"offset": "0x20000"},
        "version": None,
    },
]


def parse_cmake_board_types() -> tuple[dict[str, str], set[str]]:
    """Parse CMakeLists.txt to build maps of board types and config symbols.

    Walks the if/elseif chain looking for:
        if(CONFIG_BOARD_TYPE_XXX)
            set(BOARD_TYPE "some-board-name")

    Returns:
        - board_map: {"some-board-name": "XXX", ...} (BOARD_TYPE -> CONFIG symbol)
          Note: when multiple CONFIG symbols map to the same BOARD_TYPE, the last one wins.
        - all_symbols: set of all CONFIG_BOARD_TYPE_XXX symbol names (without prefix)
    """
    text = CMAKE_FILE.read_text()
    lines = text.splitlines()

    board_map: dict[str, str] = {}
    all_symbols: set[str] = set()
    current_config = None

    for line in lines:
        stripped = line.strip()

        # Match: if(CONFIG_BOARD_TYPE_XXX) or elseif(CONFIG_BOARD_TYPE_XXX)
        m = re.match(r"(?:else)?if\(CONFIG_BOARD_TYPE_(\w+)\)", stripped)
        if m:
            current_config = m.group(1)
            all_symbols.add(current_config)
            continue

        # Match: set(BOARD_TYPE "board-name")
        if current_config:
            m = re.match(r'set\(BOARD_TYPE\s+"([^"]+)"\)', stripped)
            if m:
                board_name = m.group(1)
                board_map[board_name] = current_config
                continue

            # If we hit another if/elseif, the previous block ended
            if re.match(r"(?:else)?if\(", stripped) or stripped.startswith("endif"):
                current_config = None

    return board_map, all_symbols


def find_config_symbol(
    board_name: str,
    sdkconfig_append: list[str],
    cmake_map: dict[str, str],
    all_symbols: set[str],
    primary_symbol: str | None = None,
    board_dir_name: str | None = None,
) -> str | None:
    """Find the CONFIG_BOARD_TYPE symbol for a build variant.

    Resolution order:
    1. CONFIG_BOARD_TYPE_XXX=y in sdkconfig_append (some boards embed it)
    2. Direct lookup of build name in CMakeLists.txt BOARD_TYPE map
    3. Direct lookup of board directory name in CMakeLists.txt BOARD_TYPE map
    4. Inherit from the primary build variant (first build in the same config.json)
    """
    # Check sdkconfig_append first — some boards embed their CONFIG_BOARD_TYPE
    for line in sdkconfig_append:
        m = re.match(r"CONFIG_BOARD_TYPE_(\w+)=y", line)
        if m:
            return m.group(1)

    # Direct lookup of build name in CMakeLists.txt map
    symbol = cmake_map.get(board_name)
    if symbol:
        return symbol

    # Try the board directory name (for boards where build name differs from dir name)
    if board_dir_name and board_dir_name != board_name:
        symbol = cmake_map.get(board_dir_name)
        if symbol:
            return symbol

    # Inherit from the primary (first) build variant in the same config.json
    if primary_symbol:
        return primary_symbol

    return None


def resolve_partition_csv(sdkconfig_append: list[str], target: str) -> str:
    """Determine the partition CSV file path for a board.

    Resolution order:
    1. CONFIG_PARTITION_TABLE_CUSTOM_FILENAME in sdkconfig_append
    2. CONFIG_PARTITION_TABLE_CUSTOM_FILENAME in chip-specific defaults
    3. CONFIG_PARTITION_TABLE_CUSTOM_FILENAME in base sdkconfig.defaults
    """
    # Check sdkconfig_append
    for line in sdkconfig_append:
        m = re.match(r'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"', line)
        if m:
            return m.group(1)

    # Check chip-specific defaults
    chip_defaults = Path(f"sdkconfig.defaults.{target}")
    if chip_defaults.exists():
        for line in chip_defaults.read_text().splitlines():
            m = re.match(r'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"', line)
            if m:
                return m.group(1)

    # Fall back to base defaults
    for line in SDKCONFIG_BASE.read_text().splitlines():
        m = re.match(r'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"', line)
        if m:
            return m.group(1)

    # Ultimate fallback
    return "partitions/v2/16m.csv"


def parse_partition_csv(csv_path: str) -> dict:
    """Parse a partition CSV to extract NVS, otadata, and app (ota_0 or factory) offsets.

    Returns {"nvs": offset, "otadata": offset, "app": offset} or partial dict.
    """
    result = {}
    path = Path(csv_path)
    if not path.exists():
        return result

    text = path.read_text()
    reader = csv.reader(io.StringIO(text))

    for row in reader:
        # Skip comments and empty lines
        if not row or row[0].strip().startswith("#"):
            continue

        # Fields: Name, Type, SubType, Offset, Size [, Flags]
        if len(row) < 5:
            continue

        name = row[0].strip()
        offset = row[3].strip()

        if name == "nvs" and offset:
            result["nvs"] = offset
        elif name == "otadata" and offset:
            result["otadata"] = offset
        elif name == "ota_0" and offset:
            result["app"] = offset
        elif name == "factory" and offset and "app" not in result:
            result["app"] = offset

    return result


def read_board_description(board_dir: Path) -> str:
    """Read the first non-empty, non-header line from README.md as a description."""
    readme = board_dir / "README.md"
    if not readme.exists():
        return ""

    for line in readme.read_text().splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        # Skip markdown formatting and non-prose lines
        if stripped.startswith(("![", "<div", "</div", "<a ", "```", "**", "|", ">")):
            continue
        # Skip command lines and code-like content
        if re.match(r"^(idf\.py|python|pip|cd |git |npm |make |cmake )", stripped):
            continue
        # Truncate to 120 chars
        if len(stripped) > 120:
            stripped = stripped[:117] + "..."
        return stripped

    return ""


def generate_display_name(board_id: str, manufacturer: str | None) -> str:
    """Generate a human-readable name from the board ID.

    Replaces hyphens with spaces, title-cases, prepends manufacturer if present.
    """
    name = board_id.replace("-", " ").replace("_", " ")
    # Title case but preserve known uppercase tokens
    words = name.split()
    result = []
    for w in words:
        # Keep version-like tokens (v1, v2, etc.) and sizes (4b, 4.3c) lowercase-ish
        upper = w.upper()
        # Known chip identifiers
        if upper in ("ESP32", "ESP32S3", "S3", "C3", "C5", "C6", "P4"):
            result.append(upper)
        else:
            result.append(w.title())

    display = " ".join(result)
    if manufacturer:
        mfg_display = manufacturer.replace("-", " ").title()
        # Don't duplicate if manufacturer is already in the name
        if mfg_display.lower() not in display.lower():
            display = f"{mfg_display} {display}"
    return display


def collect_boards() -> list[dict]:
    """Walk board directories and collect all build variants."""
    cmake_map, all_symbols = parse_cmake_board_types()
    boards = []
    warnings = []

    # Find all config.json files
    config_files = []
    for p in sorted(BOARDS_DIR.rglob("config.json")):
        # Determine the board directory (parent of config.json)
        board_dir = p.parent
        rel = board_dir.relative_to(BOARDS_DIR)
        parts = rel.parts

        # Skip common and espie directories
        if parts[0] in SKIP_DIRS:
            continue

        config_files.append(p)

    for config_path in config_files:
        board_dir = config_path.parent

        try:
            config = json.loads(config_path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            warnings.append(f"WARNING: Failed to read {config_path}: {e}")
            continue

        target = config.get("target", "esp32s3")
        manufacturer = config.get("manufacturer")
        builds = config.get("builds", [])

        # The board directory name is the leaf of the path (for manufacturer boards,
        # this is the sub-directory, e.g. "esp32-p4-nano" under "waveshare/")
        board_dir_name = board_dir.name

        # Resolve the primary (first) build's CONFIG symbol so variants can inherit it
        primary_symbol = None
        if builds:
            first = builds[0]
            primary_symbol = find_config_symbol(
                first.get("name", ""), first.get("sdkconfig_append", []),
                cmake_map, all_symbols, board_dir_name=board_dir_name,
            )

        for build in builds:
            board_id = build.get("name", "")
            sdkconfig_append = build.get("sdkconfig_append", [])

            # Find the CONFIG_BOARD_TYPE symbol
            config_symbol = find_config_symbol(
                board_id, sdkconfig_append, cmake_map, all_symbols,
                primary_symbol, board_dir_name,
            )
            if not config_symbol:
                warnings.append(f"WARNING: No CONFIG_BOARD_TYPE symbol found for '{board_id}' — skipping")
                continue

            # Resolve partition table
            csv_path = resolve_partition_csv(sdkconfig_append, target)
            partitions = parse_partition_csv(csv_path)

            # Determine offsets
            bootloader_offset = BOOTLOADER_OFFSETS.get(target, "0x0000")
            partition_table_offset = "0x8000"  # Always 0x8000 in ESP-IDF
            ota_data_offset = partitions.get("otadata", "0xD000")
            app_offset = partitions.get("app", "0x20000")

            # Uppercase hex for consistency
            ota_data_offset = ota_data_offset.upper().replace("0X", "0x")
            app_offset = app_offset.upper().replace("0X", "0x")

            # Read description from README
            description = read_board_description(board_dir)

            # Generate display name
            name = generate_display_name(board_id, manufacturer)

            chip_family = CHIP_DISPLAY.get(target, target.upper())

            board_entry = {
                "id": board_id,
                "name": name,
                "description": description,
                "chipFamily": chip_family,
                "bootloader": {"offset": bootloader_offset},
                "partitionTable": {"offset": partition_table_offset},
                "otaData": {"offset": ota_data_offset},
                "app": {"offset": app_offset},
                "version": None,
            }

            boards.append((board_id, board_entry, target, config_symbol, sdkconfig_append))

    # Print warnings
    for w in warnings:
        print(w)

    return boards


def write_boards_json(boards: list[tuple]) -> None:
    """Write the boards.json registry."""
    # Sort upstream boards alphabetically by ID
    sorted_boards = sorted(boards, key=lambda b: b[0])

    all_boards = list(ESPIE_BOARDS)
    for board_id, entry, *_ in sorted_boards:
        all_boards.append(entry)

    # Detect existing firmware binaries and fill in version/paths
    firmware_dir = OUTPUT_JSON.parent
    for board in all_boards:
        board_dir = firmware_dir / board["id"]
        if not board_dir.is_dir():
            continue
        # Find the latest version .bin file (e.g. 1.0.0.bin, not bootloader.bin)
        version_re = re.compile(r"^\d+\.\d+\.\d+")
        bins = [f for f in board_dir.glob("*.bin") if version_re.match(f.stem)]
        if not bins:
            continue
        latest = sorted(bins, reverse=True)[0]
        version = latest.stem  # e.g. "1.0.0"
        board["version"] = version
        board["bootloader"]["path"] = f"{board['id']}/bootloader.bin"
        board["partitionTable"]["path"] = f"{board['id']}/partition-table.bin"
        board["otaData"]["path"] = f"{board['id']}/ota-data.bin"
        board["app"]["path"] = f"{board['id']}/{version}.bin"

    output = {
        "nvsOffset": "0x9000",
        "boards": all_boards,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUTPUT_JSON} ({len(all_boards)} boards)")


def write_sdkconfig_files(boards: list[tuple]) -> None:
    """Write per-board sdkconfig.defaults files."""
    OUTPUT_SDKCONFIG_DIR.mkdir(parents=True, exist_ok=True)
    count = 0

    for board_id, entry, target, config_symbol, sdkconfig_append in boards:
        lines = [
            f"# Auto-generated by generate-boards.py — do not edit",
            f"# Board: {board_id} ({target})",
            "",
            "# Espie overrides",
            "CONFIG_LANGUAGE_EN_US=y",
            "CONFIG_USE_WECHAT_MESSAGE_STYLE=y",
            'CONFIG_OTA_URL="http://espie.local:8000/xiaozhi/ota/"',
            "",
            "# Board type",
            f"CONFIG_BOARD_TYPE_{config_symbol}=y",
        ]

        # Filter sdkconfig_append: remove any CONFIG_BOARD_TYPE line (we set it above)
        # and any CONFIG_USE_WECHAT_MESSAGE_STYLE line (we override it)
        filtered = []
        for line in sdkconfig_append:
            if line.startswith("CONFIG_BOARD_TYPE_"):
                continue
            if line.startswith("CONFIG_USE_WECHAT_MESSAGE_STYLE="):
                continue
            filtered.append(line)

        if filtered:
            lines.append("")
            lines.append("# Board-specific overrides from config.json")
            lines.extend(filtered)

        lines.append("")  # trailing newline

        outpath = OUTPUT_SDKCONFIG_DIR / f"{board_id}.defaults"
        outpath.write_text("\n".join(lines))
        count += 1

    print(f"Wrote {count} sdkconfig files to {OUTPUT_SDKCONFIG_DIR}/")


def print_summary(boards: list[tuple]) -> None:
    """Print a summary of boards found."""
    chip_counts: dict[str, int] = {}
    for _, entry, *_ in boards:
        family = entry["chipFamily"]
        chip_counts[family] = chip_counts.get(family, 0) + 1

    total = len(boards) + len(ESPIE_BOARDS)
    print(f"\nSummary: {total} boards total ({len(ESPIE_BOARDS)} espie + {len(boards)} upstream)")
    for family in sorted(chip_counts.keys()):
        print(f"  {family}: {chip_counts[family]}")


def main() -> None:
    boards = collect_boards()
    write_boards_json(boards)
    write_sdkconfig_files(boards)
    print_summary(boards)


if __name__ == "__main__":
    main()
