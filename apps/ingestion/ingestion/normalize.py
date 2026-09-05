"""Street-address normalizer, byte-identical to the SQL used by the import
(packages/db/scripts/import-pentridge-workspace.sql, norm_street_addr):

    trim(regexp_replace(<abbreviation expansions over lower(strip [.,])>, '\\s+', ' ', 'g'))

Postgres \\m / \\M word boundaries and Python \\b agree for ASCII words.
"""

from __future__ import annotations

import re

_PUNCT = re.compile(r"[.,]")
_SPACES = re.compile(r"\s+")
_EXPANSIONS = [
    (re.compile(r"\bst\b"), "street"),
    (re.compile(r"\bave\b"), "avenue"),
    (re.compile(r"\brd\b"), "road"),
    (re.compile(r"\bdr\b"), "drive"),
    (re.compile(r"\bn\b"), "north"),
    (re.compile(r"\bs\b"), "south"),
    (re.compile(r"\be\b"), "east"),
    (re.compile(r"\bw\b"), "west"),
]


def norm_street_addr(address: str | None) -> str:
    text = _PUNCT.sub("", address or "").lower()
    for pattern, replacement in _EXPANSIONS:
        text = pattern.sub(replacement, text)
    return _SPACES.sub(" ", text).strip(" ")
