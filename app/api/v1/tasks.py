from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.crud.activity import ActivityLog
from app.crud.tasks import TaskManager
from app.models import TaskStage
from app.schemas.task import (
    Due,
    Priority,
    StageIn,
    StageOut,
    StagePatch,
    TaskIn,
    TaskOut,
    TaskPage,
    TaskPatch,
    TaskSummary,
    View,
)

router = APIRouter(tags=["Tasks"])


def _manager(session, current) -> TaskManager:
    user, tenant = current
    return TaskManager(session, tenant.id, user.id)


def _log(session, current, task: dict, action: str, **extra) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "task",
        task["id"],
        action,
        task["customer_id"],
        title=task["title"],
        due_date=task["due_date"],
        **extra,
    )


def _found(task: dict | None) -> dict:
    if task is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


@router.get("/tasks", response_model=TaskPage)
async def list_tasks(
    session: SessionDep,
    current: CurrentUser,
    view: View = "open",
    customer_id: int | None = None,
    order_id: int | None = None,
    priority: Priority | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
    due: Due | None = None,
    mine: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    items, total = await _manager(session, current).page(
        view, customer_id, order_id, limit, offset, priority, q, due, mine
    )
    return TaskPage(items=items, total=total)


@router.get("/tasks/summary", response_model=TaskSummary)
async def task_summary(session: SessionDep, current: CurrentUser, mine: bool = False):
    """The dock's count is `mine`: what's late or due today for the person looking."""
    return await _manager(session, current).summary(mine)


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskIn, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    task = await m.get(await m.create(data))
    _log(session, current, task, "created")
    return task


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, session: SessionDep, current: CurrentUser):
    return _found(await _manager(session, current).get(task_id))


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: int, data: TaskPatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    before = await m.get(task_id)
    if before is None or not await m.update(task_id, data):
        _found(None)
    task = await m.get(task_id)
    if before["stage_id"] != task["stage_id"]:
        # the column's name as it was then, since columns get renamed
        stage = (await session.get(TaskStage, task["stage_id"])).name
        was_done, done = before["done_at"] is not None, task["done_at"] is not None
        action = "moved" if was_done == done else "done" if done else "reopened"
        _log(session, current, task, action, stage=stage)
    # a drag within a column (position only) or between columns isn't an edit
    if data.model_dump(exclude_unset=True, exclude={"done", "stage_id", "position"}):
        _log(session, current, task, "updated")
    return task


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    task = _found(await m.get(task_id))
    await m.delete(task_id)
    _log(session, current, task, "deleted")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- board columns ----------


async def _column(session, stage_id: int) -> TaskStage:
    stage = await session.get(TaskStage, stage_id)
    if stage is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Column not found")
    return stage


@router.get("/task-stages", response_model=list[StageOut])
async def list_stages(session: SessionDep, current: CurrentUser):
    return await _manager(session, current).stages()


@router.post("/task-stages", response_model=StageOut, status_code=201)
async def add_stage(data: StageIn, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    stage_id = await m.add_stage(data)
    return next(x for x in await m.stages() if x["id"] == stage_id)


@router.patch("/task-stages/{stage_id}", response_model=StageOut)
async def update_stage(
    stage_id: int, data: StagePatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    await m.update_stage(await _column(session, stage_id), data)
    return next(x for x in await m.stages() if x["id"] == stage_id)


@router.delete("/task-stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stage(
    stage_id: int,
    session: SessionDep,
    current: CurrentUser,
    move_to: int | None = None,
):
    """A column with cards needs `move_to`, the column they go to."""
    m = _manager(session, current)
    await m.delete_stage(await _column(session, stage_id), move_to)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
