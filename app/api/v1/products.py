from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.crud.activity import ActivityLog, changes, snapshot
from app.core.xlsx import MAX_ROWS, xlsx
from app.crud.products import ProductManager
from app.crud.stock import StockManager
from app.models import PriceList, Product, ProductCategory
from app.schemas.product import (
    CategoryIn,
    CategoryOut,
    PriceListIn,
    PriceListOut,
    PriceListPatch,
    Movement,
    ProductExport,
    ProductIn,
    ProductOut,
    ProductPage,
    ProductQuery,
    ProductPatch,
)

router = APIRouter(tags=["Products"])


def _manager(session, current) -> ProductManager:
    return ProductManager(session, current[1].id)


def _found[T](row: T | None, what: str) -> T:
    if row is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return row


# ---------- products ----------


@router.get("/products", response_model=ProductPage)
async def list_products(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[ProductQuery, Query()],
):
    return ProductPage(**await _list(session, current, f, f.limit, f.offset))


async def _list(session, current, f, limit: int, offset: int) -> dict:
    rows, total = await _manager(session, current).page(
        f.q, f.category_id, f.archived, limit, offset, f.sort
    )
    items = [
        {
            **ProductOut.model_validate(p).model_dump(),
            "stock": stock,
            "low": p.min_stock is not None and stock < p.min_stock,
        }
        for p, stock in rows
    ]
    return {"items": items, "total": total}


@router.get("/products/export")
async def export_products(
    session: SessionDep, current: CurrentUser, f: Annotated[ProductExport, Query()]
):
    page = await _list(session, current, f, MAX_ROWS, 0)
    lists = await _manager(session, current).price_lists()
    names = {c.id: c.name for c, _ in await _manager(session, current).categories()}
    return xlsx(
        "products",
        f.lang,
        [
            ("name", "text"),
            ("sku", "text"),
            ("barcode", "text"),
            ("unit", "text"),
            ("category", "text"),
            ("stock", "qty"),
            ("min_stock", "qty"),
            *[("price", "money", f"{pl.name}, {pl.currency}") for pl in lists],
        ],
        [
            [
                p["name"],
                p["sku"],
                p["barcode"],
                p["unit"],
                names.get(p["category_id"]),
                p["stock"],
                p["min_stock"],
                *[
                    next(
                        (
                            x["amount"]
                            for x in p["prices"]
                            if x["price_list_id"] == pl.id
                        ),
                        None,
                    )
                    for pl in lists
                ],
            ]
            for p in page["items"]
        ],
    )


@router.get("/products/{product_id}/movements", response_model=list[Movement])
async def product_movements(
    product_id: int,
    session: SessionDep,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Its receipts, write-offs, transfers and sales, newest first."""
    _found(await _manager(session, current).get(product_id), "Product")
    stock = StockManager(session, current[1].id)
    return await stock.product_movements(product_id, limit)


@router.post(
    "/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED
)
async def create_product(data: ProductIn, session: SessionDep, current: CurrentUser):
    product = await _manager(session, current).create(data)
    ActivityLog(session, current[1].id, current[0].id).add(
        "product", product.id, "created", name=product.name
    )
    return product


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: int, session: SessionDep, current: CurrentUser):
    return _found(await _manager(session, current).get(product_id), "Product")


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int, data: ProductPatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    product: Product = _found(await m.get(product_id), "Product")
    fields = data.model_dump(exclude_unset=True)
    was_archived = product.archived
    before = snapshot(product, [f for f in fields if f not in ("archived", "prices")])
    old_prices = {p.price_list_id: p.amount for p in product.prices}
    product = await m.update(product, data)
    log = ActivityLog(session, current[1].id, current[0].id)
    diff = changes(before, product)
    new_prices = {p.price_list_id: p.amount for p in product.prices}
    if new_prices != old_prices:
        diff["prices"] = [
            {str(k): v for k, v in old_prices.items()},
            {str(k): v for k, v in new_prices.items()},
        ]
    if diff:
        log.add("product", product.id, "updated", changes=diff)
    if product.archived != was_archived:
        log.add("product", product.id, "archived" if product.archived else "restored")
    return product


# ---------- categories ----------


@router.get("/product-categories", response_model=list[CategoryOut])
async def list_categories(session: SessionDep, current: CurrentUser):
    rows = await _manager(session, current).categories()
    return [CategoryOut(id=c.id, name=c.name, products=n) for c, n in rows]


@router.post(
    "/product-categories",
    response_model=CategoryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(data: CategoryIn, session: SessionDep, current: CurrentUser):
    return await _manager(session, current).create_category(data)


@router.patch("/product-categories/{category_id}", response_model=CategoryOut)
async def rename_category(
    category_id: int, data: CategoryIn, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    category: ProductCategory = _found(await m.get_category(category_id), "Category")
    return await m.rename_category(category, data)


@router.delete(
    "/product-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_category(category_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    await m.delete_category(_found(await m.get_category(category_id), "Category"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- price lists ----------


@router.get("/price-lists", response_model=list[PriceListOut])
async def list_price_lists(session: SessionDep, current: CurrentUser):
    return await _manager(session, current).price_lists()


@router.post(
    "/price-lists", response_model=PriceListOut, status_code=status.HTTP_201_CREATED
)
async def create_price_list(
    data: PriceListIn, session: SessionDep, current: CurrentUser
):
    return await _manager(session, current).create_price_list(data)


@router.patch("/price-lists/{price_list_id}", response_model=PriceListOut)
async def update_price_list(
    price_list_id: int, data: PriceListPatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    price_list: PriceList = _found(await m.get_price_list(price_list_id), "Price list")
    return await m.update_price_list(price_list, data)
