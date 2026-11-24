__all__ = [
    "v1_router",
    "router",
]
from app.api.v1 import router as v1_router
from fastapi import APIRouter
from app.core.config import settings

router = APIRouter(
    prefix=settings.api.prefix,
)
router.include_router(v1_router)
