import datetime as dt
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.order import OrderRow
from app.schemas.payment import Debt, DebtTotal
from app.schemas.task import TaskOut


class Sales(BaseModel):
    today: Decimal
    month: Decimal  # from the 1st to today
    prev_month: Decimal  # the same days of last month
    orders_today: int
    drafts: int


class Received(BaseModel):
    today: Decimal
    month: Decimal


class Day(BaseModel):
    date: dt.date
    total: Decimal


class Debts(BaseModel):
    totals: list[DebtTotal]
    top: list[Debt]
    overdue_customers: int


class Tasks(BaseModel):
    overdue: int
    today: int
    items: list[TaskOut]  # late and today's, the most urgent first


class StockAlert(BaseModel):
    product_id: int
    name: str
    unit: str
    stock: Decimal
    min_stock: Decimal | None


class Stock(BaseModel):
    negative: int
    low: int
    items: list[StockAlert]


class DashboardOut(BaseModel):
    """Sales and money received are in the company's currency, others at their saved rate."""

    currency: str
    sales: Sales
    received: Received
    daily: list[Day]  # the last 30 days' sales
    debts: Debts
    tasks: Tasks
    stock: Stock
    recent: list[OrderRow]
