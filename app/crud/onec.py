"""The 1C export: a period's confirmed sales, returns and payments as an EnterpriseData file, which the
accountant loads in 1C:Бухгалтерия (Администрирование → Синхронизация данных → Загрузка данных
EnterpriseData). Element names and order copy 1C's own export of the same documents (reference files
kept outside the repo: they are 1C's demo data). Clients, products, contracts and the warehouse travel
inside each document, as 1C writes them; 1C finds what it already has by `Ссылка`, then by name (or
number and date, for documents), so every record gets a GUID computed from what it is: the same on
every export, nothing stored. Loaded into the training 1C (БП 3.0.111), the documents arrive unposted
and post; the organisation is found by its name only, so `tenant.onec_name` holds 1C's spelling.

shortcut: a sale, return or payment cancelled after it was exported stays in 1C; the accountant
deletes it there. Send deletions when a firm asks (1C's format has a deletion object).
"""

import uuid
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import clock
from app.core.errors import InvalidField
from app.models import (
    Customer,
    OrderLine,
    Payment,
    Product,
    SalesOrder,
    SalesReturn,
    Tenant,
    Warehouse,
)

# what the Uzbek copies read: a real «Бухгалтерия для Узбекистана» 3.0 takes only 1.2-1.4. 1.4 and
# 1.5 are the same for our documents (checked against 1C's own export); 1.8 nests classifier codes
VERSIONS = ("1.4", "1.5", "1.8")
NS = uuid.UUID("5b1f0e0a-6f2b-4c5e-9a51-0e1c0a7d1c01")  # our own: GUIDs are uuid5 of it

# ISO 4217 numeric codes and the short names 1C shows
CURRENCIES = {
    "UZS": ("860", "сум"),
    "USD": ("840", "USD"),
    "EUR": ("978", "EUR"),
    "RUB": ("643", "руб."),
    "KZT": ("398", "KZT"),
    "CNY": ("156", "CNY"),
    "KGS": ("417", "KGS"),
    "TRY": ("949", "TRY"),
    "GBP": ("826", "GBP"),
}
# our units as ОКЕИ codes, which 1C matches units by
UNITS = {
    "pcs": ("796", "шт"),
    "kg": ("166", "кг"),
    "g": ("163", "г"),
    "t": ("168", "т"),
    "l": ("112", "л"),
    "m": ("006", "м"),
    "m2": ("055", "м2"),
    "m3": ("113", "м3"),
    "box": ("812", "ящ"),
    # shortcut: ОКЕИ has no bag; sent as a package, until a customer's 1C shows what it uses
    "bag": ("778", "упак"),
    "pack": ("778", "упак"),
    "set": ("839", "компл"),
    "roll": ("736", "рул"),
}
UZBEKISTAN = ("860", "УЗБЕКИСТАН")


def guid(*parts) -> str:
    return str(uuid.uuid5(NS, "/".join(str(p) for p in parts)))


# the rates the format can name, the same in 1.4, 1.5 and 1.8 (Russian ones only: no 12%)
FORMAT_RATES = {Decimal(r) for r in ("0", "2", "4", "10", "18", "20")}


def vat_name(rate: Decimal) -> str | None:
    """НДС20 or БезНДС; None for a rate the format lacks (Uzbekistan's 12%). Such a line goes
    without a rate, and 1C leaves «% НДС» empty and required, so the accountant picks it before
    posting (tested: 1C doesn't take it from the product card)."""
    if not rate:
        return "БезНДС"
    return f"НДС{rate.normalize():f}" if rate in FORMAT_RATES else None


def num(v: Decimal) -> str:
    return f"{v.normalize():f}"


def stamp(d: date) -> str:
    return f"{d.isoformat()}T00:00:00"


class OneCExport:
    def __init__(self, session: AsyncSession, tenant: Tenant, version: str):
        self.session = session
        self.tenant = tenant
        self.v18 = version == "1.8"
        self.version = version

    async def build(self, date_from: date, date_to: date) -> bytes:
        if not self.tenant.inn:
            raise InvalidField("inn", "The company's ИНН is needed: 1C finds it by ИНН")
        orders = list(
            await self.session.scalars(
                select(SalesOrder)
                .where(
                    SalesOrder.status == "confirmed",
                    SalesOrder.date.between(date_from, date_to),
                )
                .options(selectinload(SalesOrder.lines))
                .order_by(SalesOrder.date, SalesOrder.number)
            )
        )
        returns = list(
            await self.session.scalars(
                select(SalesReturn)
                .where(
                    SalesReturn.cancelled_at.is_(None),
                    SalesReturn.date.between(date_from, date_to),
                )
                .options(selectinload(SalesReturn.lines))
                .order_by(SalesReturn.date, SalesReturn.number)
            )
        )
        # each return names its sale, which may be from an earlier period
        self.orders = await self._by_id(SalesOrder, {r.order_id for r in returns})
        payments = list(
            await self.session.scalars(
                select(Payment)
                .where(
                    Payment.cancelled_at.is_(None),
                    Payment.date.between(date_from, date_to),
                )
                .order_by(Payment.date, Payment.number)
            )
        )
        if not self.tenant.bank_account and any(p.method != "cash" for p in payments):
            raise InvalidField(
                "bank_account", "The company's bank account is needed for bank payments"
            )
        self.customers = await self._by_id(
            Customer,
            {o.customer_id for o in orders}
            | {r.customer_id for r in returns}
            | {p.customer_id for p in payments},
        )
        self.products = await self._by_id(
            Product,
            {ln.product_id for o in orders for ln in o.lines}
            | {ln.product_id for r in returns for ln in r.lines},
        )
        self.order_lines = await self._by_id(
            OrderLine, {ln.order_line_id for r in returns for ln in r.lines}
        )
        self.warehouses = await self._by_id(
            Warehouse,
            {o.warehouse_id for o in orders} | {r.warehouse_id for r in returns},
        )

        root = ET.Element(
            "Message",
            {
                "xmlns:msg": "http://www.1c.ru/SSL/Exchange/Message",
                "xmlns:xs": "http://www.w3.org/2001/XMLSchema",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            },
        )
        header = ET.SubElement(root, "msg:Header")
        url = f"http://v8.1c.ru/edi/edi_stnd/EnterpriseData/{self.version}"
        self._add(header, "msg:Format", url)
        self._add(
            header,
            "msg:CreationDate",
            clock.now().replace(tzinfo=None).isoformat(timespec="seconds"),
        )
        self._add(header, "msg:AvailableVersion", self.version)
        body = ET.SubElement(root, "Body", {"xmlns": url})
        for o in orders:
            self._sale(body, o)
        for r in returns:
            self._return(body, r)
        for p in payments:
            self._payment(body, p)
        ET.indent(root, "\t")
        return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
            root, encoding="utf-8"
        )

    async def _by_id(self, model, ids: set[int]) -> dict:
        if not ids:
            return {}
        rows = await self.session.scalars(select(model).where(model.id.in_(ids)))
        return {r.id: r for r in rows}

    @staticmethod
    def _add(parent, name: str, text=None) -> ET.Element:
        el = ET.SubElement(parent, name)
        if text is not None:
            el.text = str(text)
        return el

    # ---- references, written inline the way 1C does ----

    def _classifier(self, parent, name: str, ref: str, code: str, title: str) -> None:
        el = self._add(parent, name)
        self._add(el, "Ссылка", ref)
        inner = self._add(el, "ДанныеКлассификатора") if self.v18 else el
        self._add(inner, "Код", code)
        self._add(inner, "Наименование", title)

    def _currency(self, parent, name: str, iso: str) -> None:
        if iso not in CURRENCIES:
            raise InvalidField("currency", f"No 1C code for currency {iso}")
        code, title = CURRENCIES[iso]
        self._classifier(parent, name, guid("currency", iso), code, title)

    def _company(self, parent, name: str = "Организация") -> None:
        t = self.tenant
        el = self._add(parent, name)
        self._add(el, "Ссылка", guid(t.id, "company"))
        # 1C finds the organisation by this name (tested: not by ИНН), so it must be 1C's spelling
        name = t.onec_name or t.name
        self._add(el, "Наименование", name)
        self._add(el, "НаименованиеСокращенное", name)
        self._add(el, "НаименованиеПолное", name)
        self._inn(el, t.inn)
        self._add(el, "ЮридическоеФизическоеЛицо", self._legal(t.inn))

    def _inn(self, el, inn: str | None) -> None:
        # the format's ИНН holds 12 characters at most: a 14-digit ПИНФЛ would fail the whole
        # file, so it's left out and 1C finds the record by its ID, then its name
        if inn and len(inn) <= 12:
            self._add(el, "ИНН", inn)

    @staticmethod
    def _legal(inn: str | None) -> str:
        # a 14-digit ПИНФЛ belongs to a person (ИП), a 9-digit ИНН to a firm
        return "ФизическоеЛицо" if inn and len(inn) == 14 else "ЮридическоеЛицо"

    def _customer(self, parent, customer_id: int) -> None:
        c = self.customers[customer_id]
        el = self._add(parent, "Контрагент")
        self._add(el, "Ссылка", guid(self.tenant.id, "customer", c.id))
        self._add(el, "Наименование", c.name)
        self._add(el, "НаименованиеПолное", c.name)
        self._inn(el, c.inn)
        self._add(el, "ЮридическоеФизическоеЛицо", self._legal(c.inn))
        self._classifier(el, "СтранаРегистрации", guid("country", "UZ"), *UZBEKISTAN)

    def _settlement(self, parent, customer_id: int, currency: str) -> ET.Element:
        """ДанныеВзаиморасчетов: one contract per customer and currency, as 1C keeps them."""
        el = self._add(parent, "ДанныеВзаиморасчетов")
        contract = self._add(el, "Договор")
        self._add(
            contract, "Ссылка", guid(self.tenant.id, "contract", customer_id, currency)
        )
        self._add(contract, "ВидДоговора", "СПокупателем")
        self._company(contract)
        self._customer(contract, customer_id)
        self._currency(contract, "ВалютаВзаиморасчетов", currency)
        self._add(contract, "РасчетыВУсловныхЕдиницах", "false")
        self._add(contract, "Наименование", f"Основной договор ({currency})")
        self._currency(el, "ВалютаВзаиморасчетов", currency)
        return el

    def _rate(self, currency: str, rate: Decimal | None) -> str:
        # 1C's rate is in the company's main currency; a document in it has 1
        return "1" if currency == self.tenant.currency or not rate else num(rate)

    def _keys(self, parent, kind: str, doc_id: int, d: date, number: int) -> None:
        keys = self._add(parent, "КлючевыеСвойства")
        self._add(keys, "Ссылка", guid(self.tenant.id, kind, doc_id))
        self._add(keys, "Дата", stamp(d))
        self._add(keys, "Номер", number)
        self._company(keys)

    # ---- documents ----

    def _sale(self, body, o: SalesOrder) -> None:
        doc = self._add(body, "Документ.РеализацияТоваровУслуг")
        self._keys(doc, "order", o.id, o.date, o.number)
        self._add(doc, "ВидОперации", "РеализацияКлиенту")
        self._currency(doc, "Валюта", o.currency)
        self._add(doc, "Сумма", o.total)
        self._add(doc, "СуммаВключаетНДС", "true")
        self._store(doc, o.warehouse_id)
        self._customer(doc, o.customer_id)
        self._settled(doc, o.customer_id, o.currency, o.exchange_rate)
        taxed = any(ln.vat_amount for ln in o.lines)
        self._add(
            doc,
            "Налогообложение",
            "ПродажаОблагаетсяНДС" if taxed else "ПродажаНеОблагаетсяНДС",
        )
        goods = self._add(doc, "Товары")
        for ln in o.lines:
            self._goods(
                goods, ln.product_id, ln.quantity, ln.amount, ln.vat_rate, ln.vat_amount
            )
        self._add(doc, "СпособПогашенияЗадолженности", "Автоматически")

    def _return(self, body, r: SalesReturn) -> None:
        """ВозвратТоваровОтПокупателя, linked to its sale (by the sale's GUID, date and number)."""
        doc = self._add(body, "Документ.ВозвратТоваровОтПокупателя")
        self._keys(doc, "return", r.id, r.date, r.number)
        self._add(doc, "ВидОперации", "ВозвратОтКлиента")
        self._currency(doc, "Валюта", r.currency)
        self._add(doc, "Сумма", r.total)
        self._add(doc, "СуммаВключаетНДС", "true")
        self._store(doc, r.warehouse_id)
        self._customer(doc, r.customer_id)
        self._settled(doc, r.customer_id, r.currency, r.exchange_rate)
        o = self.orders[r.order_id]
        sale = self._add(
            self._add(doc, "ДокументРеализации"), "РеализацияТоваровУслугСсылка"
        )
        self._add(sale, "Ссылка", guid(self.tenant.id, "order", o.id))
        self._add(sale, "Дата", stamp(o.date))
        self._add(sale, "Номер", o.number)
        self._company(sale)
        goods = self._add(doc, "Товары")
        for ln in r.lines:
            vat_rate = self.order_lines[ln.order_line_id].vat_rate
            self._goods(
                goods,
                ln.product_id,
                ln.quantity,
                ln.amount,
                vat_rate,
                ln.vat_amount,
                back=True,
            )

    def _store(self, doc, warehouse_id: int) -> None:
        w = self.warehouses[warehouse_id]
        store = self._add(doc, "Склад")
        self._add(store, "Ссылка", guid(self.tenant.id, "warehouse", w.id))
        self._add(store, "Наименование", w.name)
        self._add(store, "ТипСклада", "Оптовый")

    def _settled(self, doc, customer_id: int, currency: str, rate) -> None:
        s = self._settlement(doc, customer_id, currency)
        self._add(s, "КурсВзаиморасчетов", self._rate(currency, rate))
        self._add(s, "КратностьВзаиморасчетов", "1")
        self._add(s, "РасчетыВУсловныхЕдиницах", "false")

    def _goods(
        self, goods, product_id, quantity, amount, vat_rate, vat_amount, back=False
    ) -> None:
        """One Товары/Строка, as 1C writes it in sales and returns alike."""
        p = self.products[product_id]
        row = self._add(goods, "Строка")
        item = self._add(self._add(row, "ДанныеНоменклатуры"), "Номенклатура")
        self._add(item, "Ссылка", guid(self.tenant.id, "product", p.id))
        self._add(item, "НаименованиеПолное", p.name)
        self._add(item, "Наименование", p.name)
        code, title = UNITS[p.unit]
        self._classifier(row, "ЕдиницаИзмерения", guid("unit", p.unit), code, title)
        self._add(row, "Количество", num(quantity))
        self._add(row, "Сумма", amount)
        # the price after the line's discount, so quantity × price gives the sum, as in 1C
        self._add(row, "Цена", (amount / quantity).quantize(Decimal("0.01")))
        # no rate, no amount: 1C computes the amount once the accountant picks the rate
        if rate := vat_name(vat_rate):
            self._add(row, "СтавкаНДС", rate)
            if vat_amount:
                self._add(row, "СуммаНДС", vat_amount)
        self._add(row, "ТипЗапасов", "СобственныеТовары")
        if back and self.v18:
            # 1.8 asks which activity a returned line belongs to: the sale's, taxed or not
            activity = "ОблагаетсяНДС" if vat_rate else "НеОблагаетсяНДС"
            self._add(row, "ВозвратПодДеятельность", activity)

    def _payment(self, body, p: Payment) -> None:
        # cash comes in through the till (ПКО); a transfer, card or online payment through the bank
        cash = p.method == "cash"
        kind = (
            "Документ.ПКОРасчетыСКонтрагентами"
            if cash
            else "Документ.ПБДСРасчетыСКонтрагентами"
        )
        doc = self._add(body, kind)
        self._keys(doc, "payment", p.id, p.date, p.number)
        common = self._add(doc, "ОбщиеДанные")
        if not cash:
            self._add(common, "ДатаВыписки", p.date.isoformat())
        self._currency(common, "Валюта", p.currency)
        self._add(common, "Сумма", p.amount)
        name = self.customers[p.customer_id].name
        if cash:
            self._add(common, "ПринятоОт", name)
            self._customer(doc, p.customer_id)
            self._add(doc, "ВидРасчетов", "СПокупателем")
        else:
            # the schema needs the account the money arrived in; the bank itself is optional (and
            # wants a Russian БИК, where Uzbek banks have an МФО)
            account = self._add(common, "БанковскийСчетОрганизации")
            self._add(account, "Ссылка", guid(self.tenant.id, "bank-account"))
            self._add(account, "НомерСчета", self.tenant.bank_account)
            self._company(self._add(account, "Владелец"), "ОрганизацииСсылка")
            self._add(common, "НазначениеПлатежа", p.note or f"Оплата от {name}")
            self._add(doc, "ВидРасчетов", "СПокупателем")
            self._customer(doc, p.customer_id)
        row = self._add(self._add(doc, "РасшифровкаПлатежа"), "Строка")
        self._add(row, "Сумма", p.amount)
        self._add(row, "СуммаВзаиморасчетов", p.amount)
        self._add(row, "СтавкаНДС", "БезНДС")
        s = self._settlement(row, p.customer_id, p.currency)
        self._add(s, "КурсВзаиморасчетов", self._rate(p.currency, p.exchange_rate))
        self._add(s, "КратностьВзаиморасчетов", "1")
        self._add(row, "СпособПогашенияЗадолженности", "Автоматически")
