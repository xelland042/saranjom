import datetime as dt
from typing import Annotated, Any

from pydantic import BaseModel, StringConstraints


class ActivityOut(BaseModel):
    id: int
    entity: str
    entity_id: int
    action: str
    customer_id: int | None
    user_id: int | None
    user_name: str | None
    text: str | None
    data: dict[str, Any]
    created_at: dt.datetime
    mine: bool  # written by the person asking: a note of theirs can be deleted


class NoteIn(BaseModel):
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]
