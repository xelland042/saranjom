"""Excel files of the lists, built with real numbers and dates (not text), so an accountant can sum
and sort them. A CSV would break in Excel set to Russian, which expects ";" and its own encoding.
"""

from decimal import Decimal
from io import BytesIO
from typing import Literal
from urllib.parse import quote

from fastapi import Response
from openpyxl import Workbook

from app.core import clock
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

Lang = Literal["uz", "uz-Cyrl", "ru"]
Kind = Literal["text", "int", "money", "qty", "date"]
LANGS = ("uz", "uz-Cyrl", "ru")
# shortcut: one file holds at most this many rows; page through the API for more
MAX_ROWS = 10_000

FORMATS = {"int": "0", "money": "#,##0.00", "qty": "#,##0.###", "date": "DD.MM.YYYY"}
WIDTHS = {"text": 32, "int": 8, "money": 16, "qty": 12, "date": 12}

# column headers in the three languages: (uz, uz-Cyrl, ru)
HEADERS: dict[str, tuple[str, str, str]] = {
    "number": ("№", "№", "№"),
    "date": ("Sana", "Сана", "Дата"),
    "customer": ("Mijoz", "Мижоз", "Клиент"),
    "status": ("Holat", "Ҳолат", "Статус"),
    "currency": ("Valyuta", "Валюта", "Валюта"),
    "total": ("Jami", "Жами", "Сумма"),
    "unpaid": ("Toʻlanmagan", "Тўланмаган", "Не оплачено"),
    "due": ("Toʻlov muddati", "Тўлов муддати", "Срок оплаты"),
    "amount": ("Summa", "Сумма", "Сумма"),
    "method": ("Usul", "Усул", "Способ"),
    "note": ("Izoh", "Изоҳ", "Примечание"),
    "balance": ("Qarz", "Қарз", "Долг"),
    "overdue": ("Muddati oʻtgan", "Муддати ўтган", "Просрочено"),
    "late_since": ("Kechikish boshlangan", "Кечикиш бошланган", "Просрочка с"),
    "last_payment": ("Oxirgi toʻlov", "Охирги тўлов", "Последняя оплата"),
    "name": ("Nomi", "Номи", "Название"),
    "inn": ("STIR", "СТИР", "ИНН"),
    "phone": ("Telefon", "Телефон", "Телефон"),
    "address": ("Manzil", "Манзил", "Адрес"),
    "last_order": ("Oxirgi buyurtma", "Охирги буюртма", "Последний заказ"),
    "sku": ("Artikul", "Артикул", "Артикул"),
    "barcode": ("Shtrix-kod", "Штрих-код", "Штрих-код"),
    "unit": ("Birlik", "Бирлик", "Ед."),
    "category": ("Kategoriya", "Категория", "Категория"),
    "stock": ("Qoldiq", "Қолдиқ", "Остаток"),
    "min_stock": ("Minimal qoldiq", "Минимал қолдиқ", "Мин. остаток"),
    "product": ("Mahsulot", "Маҳсулот", "Товар"),
    "payment_days": ("Toʻlov muddati (kun)", "Тўлов муддати (кун)", "Отсрочка (дней)"),
    "price": ("Narx", "Нарх", "Цена"),
    "mxik": ("MXIK kodi", "МХИК коди", "Код МХИК (ИКПУ)"),
}
STATUS = {
    "draft": ("Qoralama", "Қоралама", "Черновик"),
    "confirmed": ("Tasdiqlangan", "Тасдиқланган", "Подтверждён"),
    "cancelled": ("Bekor qilingan", "Бекор қилинган", "Отменён"),
}
METHOD = {
    "cash": ("Naqd", "Нақд", "Наличные"),
    "transfer": ("Pul oʻtkazmasi", "Пул ўтказмаси", "Перечисление"),
    "card": ("Karta", "Карта", "Карта"),
    "online": ("Click / Payme", "Click / Payme", "Click / Payme"),
}


def word(table: dict[str, tuple[str, str, str]], key: str, lang: Lang) -> str:
    return table[key][LANGS.index(lang)] if key in table else key


def xlsx(
    filename: str,
    lang: Lang,
    columns: list[tuple[str, Kind] | tuple[str, Kind, str]],
    rows: list[list],
) -> Response:
    """columns: (header key, kind) or (header key, kind, header text as is)."""
    wb = Workbook()
    ws = wb.active
    ws.title = filename[:31]
    headers = [c[2] if len(c) > 2 else word(HEADERS, c[0], lang) for c in columns]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in rows[:MAX_ROWS]:
        ws.append([float(v) if isinstance(v, Decimal) else v for v in row])
    for i, (_, kind, *_rest) in enumerate(columns, start=1):
        letter = get_column_letter(i)
        # wide enough for its header too (bold, hence the extra room)
        ws.column_dimensions[letter].width = max(WIDTHS[kind], len(headers[i - 1]) + 3)
        if kind in FORMATS:
            for cell in ws[letter][1:]:
                cell.number_format = FORMATS[kind]
    ws.freeze_panes = "A2"
    out = BytesIO()
    wb.save(out)
    name = f"{filename}-{clock.today().isoformat()}.xlsx"
    return Response(
        out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )
