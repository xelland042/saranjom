from fastapi import APIRouter

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.crud.dashboard import Dashboard
from app.schemas.dashboard import DashboardOut

router = APIRouter(tags=["Dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(session: SessionDep, current: CurrentUser):
    user, tenant = current
    # the overview's tasks only for those who see tasks
    return await Dashboard(session, tenant, user.id).build(allowed(current, "tasks"))
