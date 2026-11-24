from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidField
from app.crud.debts import today
from app.models import DEFAULT_STAGES, Customer, SalesOrder, Task, TaskStage, User
from app.schemas.task import Due, StageIn, StagePatch, TaskIn, TaskPatch, View

STEP = 1024.0  # room between neighbouring cards
# a card dropped onto the board's Done column stays shown this long
DONE_SHOWN = timedelta(days=30)


class TaskManager:
    """Tasks of the company. Row-level security limits every query to the company set on the
    session, so nothing here filters by tenant_id."""

    def __init__(self, session: AsyncSession, tenant_id: int, user_id: int | None):
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id

    def _query(self):
        return (
            select(Task, Customer.name, SalesOrder.number, User.name)
            .outerjoin(Customer, Customer.id == Task.customer_id)
            .outerjoin(SalesOrder, SalesOrder.id == Task.order_id)
            .outerjoin(User, User.id == Task.assignee_id)
        )

    @staticmethod
    def _row(
        task: Task, customer: str | None, order: int | None, who: str | None
    ) -> dict:
        return {
            **{c.key: getattr(task, c.key) for c in Task.__table__.columns},
            "customer_name": customer,
            "order_number": order,
            "assignee_name": who,
        }

    async def page(
        self,
        view: View,
        customer_id: int | None,
        order_id: int | None,
        limit: int,
        offset: int,
        priority: str | None = None,
        q: str = "",
        due: Due | None = None,
        mine: bool = False,
    ) -> tuple[list[dict], int]:
        if view == "board":
            since = datetime.now(UTC) - DONE_SHOWN
            query = self._query().where(
                or_(Task.done_at.is_(None), Task.done_at >= since)
            )
        else:
            query = self._query().where(
                Task.done_at.is_(None) if view == "open" else Task.done_at.is_not(None)
            )
        if priority:
            query = query.where(Task.priority == priority)
        if q.strip():
            query = query.where(Task.title.icontains(q.strip(), autoescape=True))
        if due:
            day = today()
            query = query.where(
                Task.due_date < day
                if due == "overdue"
                else (
                    Task.due_date == day
                    if due == "today"
                    else Task.due_date.between(day, day + timedelta(days=6))
                )
            )
        if mine:
            query = query.where(Task.assignee_id == self.user_id)
        if customer_id:
            query = query.where(Task.customer_id == customer_id)
        if order_id:
            query = query.where(Task.order_id == order_id)
        count = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        # open: the most urgent first, undated last; done: the latest first
        order = {
            "open": (
                Task.due_date.asc().nulls_last(),
                Task.due_time.asc().nulls_first(),
                Task.id,
            ),
            "done": (Task.done_at.desc(), Task.id.desc()),
            "board": (Task.position, Task.id),
        }[view]
        rows = await self.session.execute(
            query.order_by(*order).limit(limit).offset(offset)
        )
        return [self._row(*r) for r in rows], count or 0

    async def summary(self, mine: bool = False) -> dict:
        """Open tasks late and due today: the company's, or (`mine`) those assigned to me."""
        day = today()
        overdue, due_today = (
            await self.session.execute(
                select(
                    func.count(case((Task.due_date < day, 1))),
                    func.count(case((Task.due_date == day, 1))),
                ).where(
                    Task.done_at.is_(None),
                    Task.assignee_id == self.user_id if mine else True,
                )
            )
        ).one()
        return {"overdue": overdue, "today": due_today}

    async def get(self, task_id: int) -> dict | None:
        row = (
            await self.session.execute(self._query().where(Task.id == task_id))
        ).first()
        return self._row(*row) if row else None

    async def _top(self, stage_id: int) -> float:
        """A position above every card in the column."""
        lowest = await self.session.scalar(
            select(func.min(Task.position)).where(Task.stage_id == stage_id)
        )
        return (lowest if lowest is not None else STEP) - STEP

    async def _stage(self, stage_id: int | None, done: bool = False) -> TaskStage:
        """The column asked for, or the first open (or done) one."""
        if stage_id is not None:
            stage = await self.session.get(TaskStage, stage_id)
            if stage is None:
                raise InvalidField("stage_id", "No such column")
            return stage
        return await self.session.scalar(
            select(TaskStage)
            .where(TaskStage.done == done)
            .order_by(TaskStage.position, TaskStage.id)
            .limit(1)
        )

    async def create(self, data: TaskIn) -> int:
        await self._check_links(data.customer_id, data.order_id)
        stage = await self._stage(data.stage_id)
        await self._check_person(data.assignee_id)
        task = Task(
            tenant_id=self.tenant_id,
            created_by=self.user_id,
            position=await self._top(stage.id),
            done_at=datetime.now(UTC) if stage.done else None,
            **data.model_dump(exclude={"stage_id", "assignee_id"}),
            assignee_id=data.assignee_id or self.user_id,
            stage_id=stage.id,
        )
        self.session.add(task)
        await self.session.flush()
        return task.id

    async def update(self, task_id: int, data: TaskPatch) -> bool:
        task = await self.session.get(Task, task_id)
        if task is None:
            return False
        fields = data.model_dump(exclude_unset=True)
        if "title" in fields and fields["title"] is None:
            raise InvalidField("title", "Field required")
        await self._check_links(fields.get("customer_id"), fields.get("order_id"))
        await self._check_person(fields.get("assignee_id"))
        done = fields.pop("done", None)
        stage_id = fields.pop("stage_id", None)
        if stage_id is None and done is not None and done != (task.done_at is not None):
            stage_id = (await self._stage(None, done)).id
        if stage_id is not None and stage_id != task.stage_id:
            stage = await self._stage(stage_id)
            # a new column: the top of it, unless the card was dropped somewhere in it
            if fields.get("position") is None:
                fields["position"] = await self._top(stage.id)
            self._mark(task, stage.done)
            task.stage_id = stage.id
        if fields.get("position", 0) is None:
            fields.pop("position")
        for field, value in fields.items():
            setattr(task, field, value)
        if task.due_time is not None and task.due_date is None:
            raise InvalidField("due_time", "due_time needs due_date")
        await self.session.flush()
        return True

    @staticmethod
    def _mark(task: Task, done: bool) -> None:
        """done_at follows the column: set on arriving in a done one, cleared on leaving it."""
        if done != (task.done_at is not None):
            task.done_at = datetime.now(UTC) if done else None

    # ---------- board columns ----------

    async def stages(self) -> list[dict]:
        counts = (
            select(Task.stage_id, func.count().label("n"))
            .group_by(Task.stage_id)
            .subquery()
        )
        rows = await self.session.execute(
            select(TaskStage, func.coalesce(counts.c.n, 0))
            .outerjoin(counts, counts.c.stage_id == TaskStage.id)
            .order_by(TaskStage.position, TaskStage.id)
        )
        return [
            {
                "id": st.id,
                "name": st.name,
                "color": st.color,
                "done": st.done,
                "position": st.position,
                "tasks": n,
            }
            for st, n in rows
        ]

    async def create_default_stages(self, lang: str) -> None:
        """Called once, at sign-up: To do, In progress, Done in the sign-up language."""
        for i, (names, color, done) in enumerate(DEFAULT_STAGES):
            self.session.add(
                TaskStage(
                    tenant_id=self.tenant_id,
                    name=names.get(lang, names["uz"]),
                    color=color,
                    done=done,
                    position=i * STEP,
                )
            )
        await self.session.flush()

    async def add_stage(self, data: StageIn) -> int:
        last = await self.session.scalar(select(func.max(TaskStage.position)))
        stage = TaskStage(
            tenant_id=self.tenant_id,
            position=(last if last is not None else -STEP) + STEP,
            **data.model_dump(),
        )
        self.session.add(stage)
        await self.session.flush()  # a taken name: 409
        return stage.id

    async def update_stage(self, stage: TaskStage, data: StagePatch) -> None:
        fields = data.model_dump(exclude_unset=True)
        for key in ("name", "color", "done", "position"):
            if key in fields and fields[key] is None:
                fields.pop(key)
        if "done" in fields and fields["done"] != stage.done:
            await self._keep_one_of_each(stage)
            # its cards become finished (or open again) with it
            for task in await self.session.scalars(
                select(Task).where(Task.stage_id == stage.id)
            ):
                self._mark(task, fields["done"])
        for key, value in fields.items():
            setattr(stage, key, value)
        await self.session.flush()  # a taken name: 409

    async def delete_stage(self, stage: TaskStage, move_to: int | None) -> None:
        """Its cards go to `move_to` first; without one, only an empty column can go."""
        await self._keep_one_of_each(stage)
        tasks = list(
            await self.session.scalars(select(Task).where(Task.stage_id == stage.id))
        )
        if tasks:
            if move_to is None or move_to == stage.id:
                raise InvalidField("move_to", "Choose where its tasks go")
            target = await self._stage(move_to)
            top = await self._top(target.id)
            for i, task in enumerate(tasks):
                task.stage_id = target.id
                task.position = top - (len(tasks) - i) * STEP
                self._mark(task, target.done)
        await self.session.flush()
        await self.session.delete(stage)
        await self.session.flush()

    async def _keep_one_of_each(self, stage: TaskStage) -> None:
        """Refuses to leave the board without an open column or without a done one."""
        same = await self.session.scalar(
            select(func.count()).where(
                TaskStage.done == stage.done, TaskStage.id != stage.id
            )
        )
        if not same:
            raise InvalidField("done", "The board needs an open and a done column")

    async def delete(self, task_id: int) -> bool:
        task = await self.session.get(Task, task_id)
        if task is None:
            return False
        await self.session.delete(task)
        await self.session.flush()
        return True

    async def _check_person(self, user_id: int | None) -> None:
        # someone active in this company (row-level security hides the others)
        if user_id and not await self.session.scalar(
            select(User.id).where(User.id == user_id, User.is_active)
        ):
            raise InvalidField("assignee_id", "No such person")

    async def _check_links(self, customer_id: int | None, order_id: int | None) -> None:
        # the foreign keys would also refuse another company's rows, but as a 500
        if customer_id and await self.session.get(Customer, customer_id) is None:
            raise InvalidField("customer_id", "No such customer")
        if order_id and await self.session.get(SalesOrder, order_id) is None:
            raise InvalidField("order_id", "No such order")
