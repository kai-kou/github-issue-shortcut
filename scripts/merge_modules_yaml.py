#!/usr/bin/env python3
"""merge_modules_yaml.py — 派生リポジトリの modules.yaml enabled:false 設定を
ベース更新後の新しい modules.yaml へ引き継ぐ（apply-to-repo.sh から呼ばれる）。

apply-to-repo.sh は再適用のたびに modules.yaml をベースの最新版で無条件上書きするため、
派生側で enabled: false にしたモジュールが復活してしまう（Issue #196）。
YAML 全体を再ダンプするとコメントが失われるため、enabled 行だけをテキスト置換する。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml", "--quiet"])
    import yaml


def disabled_modules(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {
        name
        for name, mod in (data.get("modules") or {}).items()
        if isinstance(mod, dict) and mod.get("enabled", True) is False
    }


def main(old_path: str, new_path: str) -> None:
    old = Path(old_path)
    new = Path(new_path)
    names = disabled_modules(old)
    if not names:
        return

    new_data = yaml.safe_load(new.read_text(encoding="utf-8")) or {}
    modules = new_data.get("modules") or {}
    text = new.read_text(encoding="utf-8")
    patched = []
    for name in sorted(names):
        mod = modules.get(name)
        if mod is None:
            continue  # ベース側で廃止済みのモジュール
        if mod.get("required"):
            continue  # required は無効化不可（prune_modules.py と同一ポリシー）
        block_re = re.compile(
            rf"(^  {re.escape(name)}:\n(?:^ {{4}}.*\n)*?^ {{4}}enabled: )true(\n)",
            re.MULTILINE,
        )
        new_text, count = block_re.subn(r"\1false\2", text, count=1)
        if count:
            text = new_text
            patched.append(name)

    if patched:
        new.write_text(text, encoding="utf-8")
        print(f"[merge_modules_yaml] 派生側の enabled:false を引き継ぎました: {', '.join(patched)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: merge_modules_yaml.py <old_modules.yaml> <new_modules.yaml>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
