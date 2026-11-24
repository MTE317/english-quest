#!/usr/bin/env python3
"""Extract canonical English Quest basic v1.0 learning CSVs from the user's ZIP.

Usage: python scripts/import_learning_v1.py path/to/english_quest_learning_v1_0_basic_package.zip
Only the seven canonical/reference files are imported. Incremental 552-word CSVs and
review spreadsheets are not merged into the masters (they are already included).
"""
from __future__ import annotations

import csv
import io
import pathlib
import sys
import zipfile

FILES = {
    '01_': ('words.csv', 'word_id', 1600),
    '04_': ('phrases.csv', 'phrase_id', 1183),
    '05_': ('chunks.csv', 'chunk_id', 215),
    '07_': ('categories.csv', 'subcategory_id', 60),
    '13_': ('word_categories.csv', None, 2647),
    '14_': ('phrase_categories.csv', None, 1302),
    '10_': ('distractor_review.csv', None, 74),
}


def import_zip(zip_path: pathlib.Path, destination: pathlib.Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for prefix, (filename, key, expected) in FILES.items():
            candidates = [name for name in archive.namelist()
                          if name.split('/')[-1].startswith(prefix) and name.endswith('.csv')]
            if len(candidates) != 1:
                raise ValueError(f'{prefix} CSVは1個必要です：{candidates}')
            data = archive.read(candidates[0]).decode('utf-8-sig')
            rows = list(csv.DictReader(io.StringIO(data)))
            if len(rows) != expected:
                raise ValueError(f'{filename}：{expected}行のはずが{len(rows)}行')
            if key:
                ids = [row[key] for row in rows]
                if len(set(ids)) != len(ids) or not all(ids):
                    raise ValueError(f'{filename}：IDの欠損か重複があります')
            content = data.replace('\r\n', '\n').rstrip('\n') + '\n'
            destination.mkdir(parents=True, exist_ok=True)
            (destination / filename).write_text(content, encoding='utf-8')
            print(f'{filename}: {len(rows)} rows')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: python scripts/import_learning_v1.py <basic_v1.zip>')
    root = pathlib.Path(__file__).resolve().parents[1]
    import_zip(pathlib.Path(sys.argv[1]), root / 'data' / 'learning' / 'v1')
