from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Tenant(Base):
    # one company using Saranjom
    name: Mapped[str] = mapped_column()
    # its main currency (ISO 4217): reports and debts total in it
    currency: Mapped[str] = mapped_column(String(3), server_default="UZS")
    # ИНН (9 digits; a ПИНФЛ, 14, for a sole trader): 1C finds the company by it on import
    inn: Mapped[str | None] = mapped_column(String(14))
    # the account bank payments arrive in; 1C's bank receipts must name one
    bank_account: Mapped[str | None] = mapped_column(String(34))
    # the company's name exactly as in its 1C: 1C finds the organisation by name, not by ИНН
    onec_name: Mapped[str | None] = mapped_column(String(200))
