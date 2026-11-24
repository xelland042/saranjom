import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.common import Note
from app.schemas.product import Currency

# at most this many rows per file: a small firm's whole customer or product list
MAX_ROWS = 5000

# a cell as the browser read it from our /read answer; checked per row on the server
Cell = Annotated[str | None, Field(max_length=2000)]


class SheetRow(BaseModel):
    row: int  # its row number in Excel, for error messages
    cells: list[str | None]


class Sheet(BaseModel):
    columns: list[str]
    rows: list[SheetRow]
    # our field -> the column (index) whose header looks like it
    guess: dict[str, int]


class CustomerRowIn(BaseModel):
    row: int
    name: Cell = None
    inn: Cell = None
    phone: Cell = None
    address: Cell = None
    payment_days: Cell = None
    debt: Cell = None


class ProductRowIn(BaseModel):
    row: int
    name: Cell = None
    sku: Cell = None
    barcode: Cell = None
    unit: Cell = None
    category: Cell = None
    mxik: Cell = None
    price: Cell = None
    quantity: Cell = None


class ImportOptions(BaseModel):
    dry_run: bool = True  # check and count, save nothing
    date: dt.date | None = None  # of the opening debts or stock; today when left out


class CustomerImportIn(ImportOptions):
    rows: list[CustomerRowIn] = Field(max_length=MAX_ROWS)
    currency: Currency | None = None  # of the debt column; the company's when left out


class ProductImportIn(ImportOptions):
    rows: list[ProductRowIn] = Field(max_length=MAX_ROWS)
    warehouse_id: int | None = None  # where the stock column is; needed with it
    note: Note = None  # on the stock documents it makes


class RowError(BaseModel):
    row: int
    field: str
    # missing, invalid, unit (unknown unit), repeats (as row `other` of the file),
    # taken (by another record), ambiguous (several records have this name), archived (an
    # archived product given stock)
    code: Literal[
        "missing", "invalid", "unit", "repeats", "taken", "ambiguous", "archived"
    ]
    other: int | None = None


class StockDoc(BaseModel):
    id: int
    kind: str
    number: int


class ImportResult(BaseModel):
    created: int = 0
    # the file rows that would make new records, for a person to spot 1C's folder rows
    new_rows: list[int] = []
    updated: int = 0
    unchanged: int = 0
    errors: list[RowError] = []
    debts: int = 0  # opening debts set or changed
    stock: list[StockDoc] = []  # receipts and write-offs that bring stock to the file's
