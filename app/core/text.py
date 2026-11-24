"""Search keys: one spelling for Uzbek Latin, Uzbek Cyrillic and Russian, so "Oʻzbek", "O'zbek",
"Ozbek" and "Ўзбек" all find each other. Stored in a column next to the text it came from.
"""

import re

_CYR = dict(
    zip(
        "абвгдезийклмнопрстуфхыэўқғҳ",
        "abvgdeziyklmnoprstufxieoqgh",
        strict=True,  # a letter added to one side only fails at start, not in a search
    )
)
_CYR.update(
    {
        "ё": "yo",
        "ж": "j",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sh",
        "ю": "yu",
        "я": "ya",
    }
)
# the apostrophe of oʻ, gʻ and the Uzbek ъ, in all the ways people type it, is dropped
for c in "ъьʻʼ'`’‘":
    _CYR[c] = ""
_TABLE = str.maketrans(_CYR)
_NOT_WORD = re.compile(r"[^0-9a-z]+")

# legal forms, so "MChJ Gʻalla Savdo" and "ООО «Галла Савдо»" count as the same name
_LEGAL_FORMS = set(
    "mchj xk chp yatt ok aj oaj yoaj qk ooo oao zao pao ao ip chk llc ltd jsc inc".split()
)


def search_key(*parts: str | None) -> str:
    """Lowercase Latin words separated by single spaces."""
    text = " ".join(p for p in parts if p).lower().translate(_TABLE)
    return _NOT_WORD.sub(" ", text).strip()


def name_key(name: str) -> str:
    """The search key without legal forms, for spotting the same company typed twice."""
    return " ".join(w for w in search_key(name).split() if w not in _LEGAL_FORMS)
