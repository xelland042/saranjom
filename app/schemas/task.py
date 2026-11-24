import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, model_validator

from app.models import PRIORITIES, STAGE_COLORS
from app.schemas.common import Note

Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
# open: not done, the most urgent first; done: latest first; board: every column, in card order
# (done ones from the last 30 days)
View = Literal["open", "done", "board"]
Color = Literal[STAGE_COLORS]  # type: ignore[valid-type]
Priority = Literal[PRIORITIES]  # type: ignore[valid-type]
Due = Literal["overdue", "today", "week"]


def _time_needs_date(m):
    if m.due_time is not None and m.due_date is None:
        raise ValueError("due_time needs due_date")
    return m


class TaskIn(BaseModel):
    title: Title
    note: Note = None
    due_date: dt.date | None = None
    due_time: dt.time | None = None
    customer_id: int | None = None
    order_id: int | None = None
    # the column it's added to; the first open one when left out
    stage_id: int | None = None
    assignee_id: int | None = None  # who does it; the creator when left out
    priority: Priority = "normal"

    _check = model_validator(mode="after")(_time_needs_date)


class TaskPatch(BaseModel):
    """Only the fields sent change; `done` ticks it off or back."""

    title: Title | None = None
    note: Note = None
    due_date: dt.date | None = None
    due_time: dt.time | None = None
    customer_id: int | None = None
    order_id: int | None = None
    # ticks it off (to the first done column) or back (to the first open one)
    done: bool | None = None
    stage_id: int | None = None
    assignee_id: int | None = None  # null: nobody yet
    priority: Priority | None = None
    # where it was dropped in its column; left out with a new column: the top of it
    position: float | None = None


class TaskOut(BaseModel):
    id: int
    title: str
    note: str | None
    due_date: dt.date | None
    due_time: dt.time | None
    customer_id: int | None
    customer_name: str | None
    order_id: int | None
    order_number: int | None
    assignee_id: int | None
    assignee_name: str | None
    stage_id: int
    priority: str
    position: float
    done_at: dt.datetime | None
    created_at: dt.datetime


class TaskPage(BaseModel):
    items: list[TaskOut]
    total: int


class TaskSummary(BaseModel):
    """Open tasks that need attention: for the dock's count."""

    overdue: int
    today: int


StageName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]


class StageIn(BaseModel):
    name: StageName
    color: Color = "gray"
    done: bool = False  # cards in it are finished tasks


class StagePatch(BaseModel):
    name: StageName | None = None
    color: Color | None = None
    done: bool | None = None
    position: float | None = None  # its place among the columns


class StageOut(BaseModel):
    id: int
    name: str
    color: str
    done: bool
    position: float
    tasks: int  # cards in it now (done ones of any age)
