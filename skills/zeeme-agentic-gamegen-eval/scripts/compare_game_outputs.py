#!/usr/bin/env python3
"""Compare two generated game outputs and flag likely template reuse."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def load_text(path: Path) -> str:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"file not found: {path}")
    return path.read_text(encoding="utf-8", errors="ignore")


def tokenize(value: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z_][a-zA-Z0-9_]{2,}", value.lower()))


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: compare_game_outputs.py <file-a> <file-b>")
        return 1

    file_a = Path(sys.argv[1]).resolve()
    file_b = Path(sys.argv[2]).resolve()

    text_a = load_text(file_a)
    text_b = load_text(file_b)

    tokens_a = tokenize(text_a)
    tokens_b = tokenize(text_b)

    overlap = jaccard(tokens_a, tokens_b)

    print("Game Output Comparison")
    print("======================")
    print(f"A: {file_a}")
    print(f"B: {file_b}")
    print(f"token_count_a: {len(tokens_a)}")
    print(f"token_count_b: {len(tokens_b)}")
    print(f"jaccard_overlap: {overlap:.4f}")

    if overlap > 0.85:
        print("result: HIGH_OVERLAP (likely template collapse)")
        return 2
    if overlap > 0.70:
        print("result: MEDIUM_OVERLAP (manual mechanic review required)")
        return 0

    print("result: HEALTHY_VARIATION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
