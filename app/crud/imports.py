"""Importing a firm's customers and products from Excel, so it starts with its own data.

Three steps: /read turns the file into rows and guesses which column is which; the browser shows
that and the person fixes the guess; the import itself runs twice, first as a dry run (everything
done inside a savepoint, counted, then rolled back) and then for real, so the preview is exactly
what gets saved. Rows with mistakes are skipped and listed; the rest save together or not at all.

Matching, so a second import of the same file changes nothing: customers by ИНН, else by name;
products by article, else barcode, else name. A matched record gets the file's non-empty cells;
empty cells never clear anything. Opening debts are set (replaced), and stock is brought to the
file's quantity by a receipt or write-off of the difference, never added on top.
"""

import re
import zipfile
from collections import defaultdict
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from io import BytesIO

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import InvalidField
from app.core.text import name_key, search_key
from app.core.xlsx import HEADERS
from app.crud.activity import ActivityLog, changes, snapshot
from app.crud.customers import CustomerManager
from app.crud.debts import DebtManager, today
from app.crud.products import ProductManager
from app.crud.stock import StockManager
from app.models import (
    Customer,
    OpeningBalance,
    PriceList,
    Product,
    ProductCategory,
    Tenant,
)
from app.schemas.customer import CustomerIn, CustomerPatch
from app.schemas.imports import (
    MAX_ROWS,
    CustomerImportIn,
    ImportResult,
    ProductImportIn,
    RowError,
    Sheet,
    SheetRow,
    StockDoc,
)
from app.schemas.payment import OpeningIn
from app.schemas.product import CategoryIn, ProductIn, ProductPatch

MAX_BYTES = 5 * 1024 * 1024
# unpacked, an .xlsx is XML many times its size; a small file that unpacks huge is a zip bomb
MAX_UNPACKED = 100 * 1024 * 1024

# our field -> its header key in app/core/xlsx.py (the template's headers, in three languages)
FIELDS = {
    "customers": {
        "name": "name",
        "inn": "inn",
        "phone": "phone",
        "address": "address",
        "payment_days": "payment_days",
        "debt": "balance",
    },
    "products": {
        "name": "name",
        "sku": "sku",
        "barcode": "barcode",
        "unit": "unit",
        "category": "category",
        "mxik": "mxik",
        "price": "price",
        "cost": "cost",
        "quantity": "stock",
    },
}

# other headers each field goes by, in 1C's lists and firms' own sheets, in any script (compared
# after search_key). Order matters: earlier fields and words win a column.
SYNONYMS = {
    "customers": {
        "name": ["Наименование", "Название", "Клиент", "Контрагент", "Покупатель",
                 "Mijoz", "Name", "Customer", "Полное наименование"],
        "inn": ["ИНН", "STIR", "INN", "ПИНФЛ", "ИНН/ПИНФЛ", "STIR/JSHSHIR", "TIN"],
        "phone": ["Телефон", "Тел", "Phone", "Mobile", "Контактный телефон"],
        "address": ["Адрес", "Address", "Юридический адрес", "Фактический адрес"],
        "payment_days": ["Отсрочка", "Отсрочка платежа", "Отсрочка дней",
                         "Payment days"],
        "debt": ["Долг", "Задолженность", "Сальдо", "Debt", "Balance",
                 "Конечное сальдо", "Сальдо на конец периода"],
    },
    "products": {
        "name": ["Наименование", "Название", "Товар", "Номенклатура", "Mahsulot",
                 "Tovar", "Name", "Product", "Полное наименование"],
        "mxik": ["МХИК", "MXIK", "ИКПУ", "IKPU", "Код МХИК", "Код ИКПУ", "MXIK kodi"],
        "barcode": ["Штрихкод", "Штрих-код", "Shtrix-kod", "Barcode", "EAN"],
        "sku": ["Артикул", "Artikul", "SKU", "Article", "Код"],
        "unit": ["Единица измерения", "Ед. изм.", "Ед.", "Единица", "Birlik",
                 "O'lchov birligi", "Unit"],
        "category": ["Категория", "Группа", "Kategoriya", "Guruh", "Category", "Group"],
        # before the price: "Закупочная цена, сум" holds the word "цена" too
        "cost": ["Закупочная цена", "Цена закупки", "Цена поступления", "Kirim narxi",
                 "Cost", "Cost price"],
        "price": ["Цена", "Narx", "Price", "Цена продажи", "Оптовая цена"],
        "quantity": ["Остаток", "Количество", "Кол-во", "Qoldiq", "Miqdor",
                     "Quantity", "Stock", "Конечный остаток"],
    },
}  # fmt: skip

# the words units are written with (compared after search_key), our codes included
UNIT_WORDS = {
    "pcs": "шт штук штука штуки dona pcs pc ед",
    "kg": "кг килограмм kg kilogramm",
    "g": "г гр грамм g gramm",
    "t": "т тн тонна tonna t",
    "l": "л литр litr l",
    "m": "м метр metr m",
    "m2": "м2 квм кв.м m2",
    "m3": "м3 кубм куб.м m3",
    "box": "коробка кор ящ ящик quti box",
    "pack": "пачка упак упаковка уп pachka pack",
    "bag": "мешок меш qop bag",
    "set": "комплект компл к-т komplekt set",
    "roll": "рулон рул rulon roll",
}


def _key(text: str) -> str:
    """A header or unit as one comparable word: any script, no punctuation or spaces."""
    return search_key(text.replace("²", "2").replace("³", "3")).replace(" ", "")


UNITS = {_key(w): code for code, words in UNIT_WORDS.items() for w in words.split()}


# ---------- reading the file ----------


def _text(v) -> str | None:
    """A cell as text, the way a person reads it: 301234567, not 301234567.0."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == time() else v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return str(int(v))
    s = str(v).strip()
    return s or None


def _wordy(cell: str | None) -> bool:
    return cell is not None and not re.fullmatch(r"[\d\s.,+\-:/%]+", cell)


def read_sheet(data: bytes, kind: str) -> Sheet:
    """The first sheet's rows, below its header row, and a guess of which column is which."""
    try:
        unpacked = sum(i.file_size for i in zipfile.ZipFile(BytesIO(data)).infolist())
    except zipfile.BadZipFile:  # an old .xls, a CSV, anything else
        raise InvalidField("file", "Not an .xlsx file") from None
    if unpacked > MAX_UNPACKED:
        raise InvalidField("file", "The file is too big")
    try:
        wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
    except Exception:  # a broken or encrypted workbook
        raise InvalidField("file", "Not an .xlsx file") from None
    ws = wb.worksheets[0]
    ws.reset_dimensions()  # 1C and others write wrong sizes; read what's there
    rows: list[tuple[int, list[str | None]]] = []
    for n, values in enumerate(ws.iter_rows(values_only=True), start=1):
        cells = [_text(v) for v in values]
        while cells and cells[-1] is None:
            cells.pop()
        if cells:
            rows.append((n, cells))
        if len(rows) > MAX_ROWS + 20:
            raise InvalidField("file", f"More than {MAX_ROWS} rows")
    wb.close()
    if not rows:
        raise InvalidField("file", "The sheet is empty")
    # the header is the first row with the most words (not numbers): reports put a title and a
    # period above it, and data rows hold numbers
    head = max(range(min(20, len(rows))), key=lambda i: sum(map(_wordy, rows[i][1])))
    width = max(len(cells) for _, cells in rows)
    header = rows[head][1] + [None] * (width - len(rows[head][1]))
    columns = [h or get_column_letter(i + 1) for i, h in enumerate(header)]
    return Sheet(
        columns=columns,
        rows=[
            SheetRow(row=n, cells=cells + [None] * (width - len(cells)))
            for n, cells in rows[head + 1 :]
        ],
        guess=guess(columns, kind),
    )


def guess(columns: list[str], kind: str) -> dict[str, int]:
    """Our field -> the column whose header names it: exact names first, then a header that
    contains one ("Цена продажи, сум")."""
    names = {
        field: list(HEADERS[header]) + SYNONYMS[kind][field]
        for field, header in FIELDS[kind].items()
    }
    keys = [_key(c) for c in columns]
    words = [f" {search_key(c)} " for c in columns]
    found: dict[str, int] = {}
    for exact in (True, False):
        for field in SYNONYMS[kind]:  # the order that decides who wins a column
            if field in found:
                continue
            for name in names[field]:
                for i in range(len(columns)):
                    if i in found.values():
                        continue
                    hit = (
                        keys[i] == _key(name)
                        if exact
                        else f" {search_key(name)} " in words[i]
                    )
                    if hit:
                        found[field] = i
                        break
                if field in found:
                    break
    return found


# ---------- checking a row ----------


class RowFailed(Exception):
    def __init__(self, field: str, code: str, other: int | None = None):
        self.error = (field, code, other)


def _number(text: str, field: str) -> Decimal:
    """12 500,50 / 12,500.50 / 12500.5 -> 12500.50; spaces and either separator."""
    s = re.sub(r"[\s '’]", "", text)
    if "," in s and "." in s:
        # the last one is the decimal point
        if s.rfind(".") > s.rfind(","):
            s = s.replace(",", "")
        else:
            s = s.replace(".", "").replace(",", ".")
    elif s.count(",") == 1:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        d = Decimal(s)
    except InvalidOperation:
        raise RowFailed(field, "invalid") from None
    if not d.is_finite():
        raise RowFailed(field, "invalid")
    return d


def _model[M: BaseModel](model: type[M], fields: dict) -> M:
    try:
        return model.model_validate(fields)
    except ValidationError as e:
        err = e.errors()[0]
        field = str(err["loc"][0]) if err["loc"] else "name"
        raise RowFailed(
            field, "missing" if err["type"] == "missing" else "invalid"
        ) from None


def _cells(row: BaseModel, fields) -> dict[str, str]:
    """The row's non-empty cells: an empty one never changes anything."""
    out = {}
    for f in fields:
        v = getattr(row, f)
        if v is not None and v.strip():
            out[f] = v.strip()
    return out


class Importer:
    def __init__(self, session: AsyncSession, tenant: Tenant, user_id: int):
        self.session = session
        self.tenant = tenant
        self.log = ActivityLog(session, tenant.id, user_id)
        self.user_id = user_id

    async def run(self, data, do) -> ImportResult:
        """`do` inside a savepoint, kept only when it isn't a dry run."""
        result = ImportResult()
        async with self.session.begin_nested() as savepoint:
            await do(data, result)
            await self.session.flush()
            if data.dry_run:
                await savepoint.rollback()
        return result

    # ---------- customers ----------

    async def customers(self, data: CustomerImportIn, result: ImportResult) -> None:
        m = CustomerManager(self.session, self.tenant.id)
        debts = DebtManager(self.session, self.tenant, self.user_id)
        currency = data.currency or self.tenant.currency
        day = data.date or today()
        everyone = list(await self.session.scalars(select(Customer)))
        by_inn = {c.inn: c for c in everyone if c.inn}
        by_name: dict[str, list[Customer]] = defaultdict(list)
        for c in everyone:
            by_name[c.name_key].append(c)
        openings = {
            o.customer_id: (o.amount, o.date)
            for o in await self.session.scalars(
                select(OpeningBalance).where(OpeningBalance.currency == currency)
            )
        }
        seen: dict[str, int] = {}  # ИНН or name -> the file row that had it
        for row in data.rows:
            cells = _cells(row, FIELDS["customers"])
            if not cells:
                continue
            try:
                debt_text = cells.pop("debt", None)
                debt = _number(debt_text, "debt") if debt_text else None
                if debt is not None and (
                    debt.as_tuple().exponent < -2 or abs(debt) >= 10**16
                ):
                    raise RowFailed("debt", "invalid")
                customer = _model(CustomerIn, cells)
                key = customer.inn or name_key(customer.name)
                if key in seen:
                    raise RowFailed(
                        "inn" if customer.inn else "name", "repeats", seen[key]
                    )
                seen[key] = row.row
                target = by_inn.get(customer.inn) if customer.inn else None
                if target is None:
                    same = [
                        c
                        for c in by_name[name_key(customer.name)]
                        if customer.inn is None or c.inn is None
                    ]
                    if len(same) > 1:
                        raise RowFailed("name", "ambiguous")
                    target = same[0] if same else None
            except RowFailed as e:
                result.errors.append(_error(row.row, *e.error))
                continue

            if target is None:
                target = await m.create(customer)
                self.log.add("customer", target.id, "created", target.id)
                by_name[target.name_key].append(target)
                result.created += 1
                result.new_rows.append(row.row)
            else:
                patch = CustomerPatch(**customer.model_dump(include=set(cells)))
                before = snapshot(target, list(cells))
                await m.update(target, patch)
                if diff := changes(before, target):
                    self.log.add(
                        "customer", target.id, "updated", target.id, changes=diff
                    )
                    result.updated += 1
                else:
                    result.unchanged += 1
            if target.inn:
                by_inn[target.inn] = target

            if debt and openings.get(target.id) != (debt, day):
                await debts.set_opening(
                    target, currency, OpeningIn(amount=debt, date=day)
                )
                self.log.add(
                    "customer",
                    target.id,
                    "opening_set",
                    target.id,
                    amount=debt,
                    currency=currency,
                    date=day,
                )
                result.debts += 1

    # ---------- products ----------

    async def products(self, data: ProductImportIn, result: ImportResult) -> None:
        m = ProductManager(self.session, self.tenant.id)
        stock = StockManager(self.session, self.tenant.id, self.user_id)
        if data.warehouse_id is not None:
            await stock.check_warehouse("warehouse_id", data.warehouse_id)
        price_list = await self.session.scalar(
            select(PriceList).where(PriceList.is_default)
        )
        everything = list(
            await self.session.scalars(
                select(Product).options(selectinload(Product.prices))
            )
        )
        by_code = {
            f: {getattr(p, f): p for p in everything if getattr(p, f)}
            for f in ("sku", "barcode")
        }
        by_name: dict[str, list[Product]] = defaultdict(list)
        for p in everything:
            by_name[p.name_key].append(p)
        categories = {
            c.name.casefold(): c
            for c in await self.session.scalars(select(ProductCategory))
        }
        seen: dict[tuple[str, str], int] = {}
        wanted: dict[int, Decimal] = {}  # product id -> the stock the file says

        for row in data.rows:
            cells = _cells(row, FIELDS["products"])
            if not cells:
                continue
            try:
                price = cells.pop("price", None)
                quantity = cells.pop("quantity", None)
                category = cells.pop("category", None)
                if category is not None and len(category) > 200:
                    raise RowFailed("category", "invalid")
                if "unit" in cells:
                    unit = UNITS.get(_key(cells["unit"]))
                    if unit is None:
                        raise RowFailed("unit", "unit")
                    cells["unit"] = unit
                if "cost" in cells:
                    cells["cost"] = _number(cells["cost"], "cost")
                if quantity is not None:
                    if data.warehouse_id is None:
                        raise InvalidField("warehouse_id", "Choose a warehouse")
                    qty = _number(quantity, "quantity")
                    if qty < 0 or qty.as_tuple().exponent < -3:
                        raise RowFailed("quantity", "invalid")
                prices = (
                    [
                        {
                            "price_list_id": price_list.id,
                            "amount": _number(price, "price"),
                        }
                    ]
                    if price is not None
                    else []
                )
                product = _model(ProductIn, {**cells, "prices": prices})
                for f in ("sku", "barcode"):
                    v = getattr(product, f)
                    if v and (f, v) in seen:
                        raise RowFailed(f, "repeats", seen[f, v])
                key = name_key(product.name)
                if not product.sku and not product.barcode and ("name", key) in seen:
                    raise RowFailed("name", "repeats", seen["name", key])

                target = (product.sku and by_code["sku"].get(product.sku)) or (
                    product.barcode and by_code["barcode"].get(product.barcode)
                )
                if not target:
                    same = [
                        p
                        for p in by_name[key]
                        if not (product.sku and p.sku)
                        and not (product.barcode and p.barcode)
                    ]
                    if len(same) > 1:
                        raise RowFailed("name", "ambiguous")
                    target = same[0] if same else None
                # an archived product takes no stock: restore it first
                if quantity is not None and target and target.archived:
                    raise RowFailed("quantity", "archived")
                # the other code must not belong to another product
                for f in ("sku", "barcode"):
                    owner = getattr(product, f) and by_code[f].get(getattr(product, f))
                    if owner and owner is not target:
                        raise RowFailed(f, "taken")
            except RowFailed as e:
                result.errors.append(_error(row.row, *e.error))
                continue
            for f in ("sku", "barcode"):
                if getattr(product, f):
                    seen[f, getattr(product, f)] = row.row
            seen["name", key] = row.row

            if category is not None:
                found = categories.get(category.casefold())
                if found is None:
                    found = await m.create_category(CategoryIn(name=category))
                    categories[category.casefold()] = found
                product.category_id = found.id
                cells["category_id"] = found.id

            if target is None:
                target = await m.create(product)
                self.log.add("product", target.id, "created", name=target.name)
                by_name[key].append(target)
                result.created += 1
                result.new_rows.append(row.row)
            else:
                fields = list(cells)
                patch = ProductPatch(
                    **product.model_dump(include=set(fields)), prices=product.prices
                )
                before = snapshot(target, fields)
                old_prices = {p.price_list_id: p.amount for p in target.prices}
                await m.update(target, patch)
                diff = changes(before, target)
                new_prices = {p.price_list_id: p.amount for p in target.prices}
                if new_prices != old_prices:
                    diff["prices"] = [
                        {str(k): v for k, v in old_prices.items()},
                        {str(k): v for k, v in new_prices.items()},
                    ]
                if diff:
                    self.log.add("product", target.id, "updated", changes=diff)
                    result.updated += 1
                else:
                    result.unchanged += 1
            for f in ("sku", "barcode"):
                if getattr(target, f):
                    by_code[f][getattr(target, f)] = target
            if quantity is not None:
                wanted[target.id] = qty

        if wanted:
            await self._set_stock(stock, data, wanted, result)

    async def _set_stock(
        self,
        stock: StockManager,
        data: ProductImportIn,
        wanted: dict[int, Decimal],
        result: ImportResult,
    ) -> None:
        """The warehouse is brought to what the file says however many times it's imported."""
        for doc in await stock.set_stock(
            data.warehouse_id, wanted, data.date, data.note
        ):
            self.log.add(
                "stock_document", doc.id, "created", kind=doc.kind, number=doc.number
            )
            result.stock.append(StockDoc(id=doc.id, kind=doc.kind, number=doc.number))


def _error(row: int, field: str, code: str, other: int | None) -> RowError:
    return RowError(row=row, field=field, code=code, other=other)
