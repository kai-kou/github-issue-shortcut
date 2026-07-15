#!/usr/bin/env python3
"""PWA アイコン（192/512・512 maskable）を stdlib のみで生成する（外部画像ライブラリ非依存）。

デザイン: 背景色（テーマカラー）+ 中央に白い "+" （起票 = 追加のメタファー）。
maskable 版は safe zone（中心 80% 直径円）に収まるよう "+" を縮小して配置する。
"""
import struct
import zlib
from pathlib import Path

BG = (13, 17, 23)  # GitHub Dark 系の背景色（#0d1117）
FG = (255, 255, 255)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"


def make_icon(size: int, plus_ratio: float) -> bytes:
    """size x size の正方形 PNG（RGB）を返す。plus_ratio は "+" の一辺が画像幅に占める割合。"""
    arm = max(2, round(size * plus_ratio * 0.34))
    half_len = round(size * plus_ratio / 2)
    cx = cy = size // 2
    bg_bytes = bytes(BG)
    fg_bytes = bytes(FG)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            in_h_arm = abs(y - cy) <= arm // 2 and abs(x - cx) <= half_len
            in_v_arm = abs(x - cx) <= arm // 2 and abs(y - cy) <= half_len
            row.extend(fg_bytes if (in_h_arm or in_v_arm) else bg_bytes)
        rows.append(b"\x00" + bytes(row))  # フィルタタイプ 0（None）

    raw = b"".join(rows)
    compressed = zlib.compress(raw, level=9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # bit depth 8, color type 2 (RGB)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    return png


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "icon-192.png").write_bytes(make_icon(192, plus_ratio=0.5))
    (OUT_DIR / "icon-512.png").write_bytes(make_icon(512, plus_ratio=0.5))
    # maskable: OS のマスク（円形等）でトリミングされても "+" が欠けないよう safe zone（中心 80%）に収める
    (OUT_DIR / "icon-512-maskable.png").write_bytes(make_icon(512, plus_ratio=0.34))
    print(f"generated: {[p.name for p in OUT_DIR.glob('*.png')]}")


if __name__ == "__main__":
    main()
