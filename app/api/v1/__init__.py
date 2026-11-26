from fastapi import APIRouter, Depends

from app.api.deps import authorize
from app.core.config import settings
from .activity import router as activity_router
from .auth import router as auth_router
from .customers import router as customers_router
from .dashboard import router as dashboard_router
from .imports import router as imports_router
from .onec import router as onec_router
from .orders import router as orders_router
from .money import router as money_router
from .payments import router as payments_router
from .products import router as products_router
from .rates import router as rates_router
from .returns import router as returns_router
from .staff import roles_router, router as staff_router
from .stock import router as stock_router
from .suppliers import router as suppliers_router
from .tasks import router as tasks_router

router = APIRouter(
    prefix=settings.api.v1.prefix,
)
# login, sign-up, logout and "who am I" come before any permission
router.include_router(auth_router)
# everything else needs the permission its route is mapped to (app/core/permissions.py)
for r in (
    customers_router,
    products_router,
    rates_router,
    stock_router,
    suppliers_router,
    orders_router,
    returns_router,
    payments_router,
    money_router,
    tasks_router,
    activity_router,
    dashboard_router,
    staff_router,
    roles_router,
    onec_router,
    imports_router,
):
    router.include_router(r, dependencies=[Depends(authorize)])
