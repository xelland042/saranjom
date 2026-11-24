from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Login infrastructure, read before the company is known, so these two tables have no
# row-level security. They hold no business data.


class AuthSession(Base):
    # only a SHA-256 of the cookie value is stored, so a leaked table can't log anyone in
    token_hash: Mapped[str] = mapped_column(unique=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenant.id", ondelete="CASCADE")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LoginFailure(Base):
    login: Mapped[str] = mapped_column(index=True)
    ip: Mapped[str] = mapped_column(index=True)
