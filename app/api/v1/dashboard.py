from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.crud.dashboard import Dashboard
from app.schemas.dashboard import DashboardOut

router = APIRouter(tags=["Dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(session: SessionDep, current: CurrentUser):
    user, tenant = current
    return await Dashboard(session, tenant, user.id).build()
