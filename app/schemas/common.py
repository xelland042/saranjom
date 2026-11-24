"""Field types shared by the business schemas: trimmed text where an empty box means "not set"."""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints


def blank_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


def required(v):
    # a patch may leave the name out, but not clear it
    if v is None:
        raise ValueError("Field required")
    return v


Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


def text(max_length: int):
    return Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=max_length)
    ]


# optional fields: an empty box means "not set"
Text = Annotated[text(500) | None, BeforeValidator(blank_to_none)]
Note = Annotated[text(2000) | None, BeforeValidator(blank_to_none)]


class Paging(BaseModel):
    """limit and offset, for lists whose filters are a query model: FastAPI reads a model only
    when it's a route's sole query parameter, so these join it by inheritance."""

    limit: Annotated[int, Field(ge=1, le=200)] = 50
    offset: Annotated[int, Field(ge=0)] = 0


class InLang(BaseModel):
    """The language of an Excel file's headers."""

    lang: Literal["uz", "uz-Cyrl", "ru"] = "uz"
