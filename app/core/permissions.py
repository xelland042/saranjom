"""Who may do what: each company's roles (the `role` table) are sets of these permissions, and every
API route is mapped to the one permission it needs. Checked on the server for every request
(`authorize` in app/api/deps.py); the frontend only hides what a role can't use. A route missing
from ROUTES is refused, and a test fails, so a new endpoint can't slip through unguarded.
"""

# read and write per area; "money" is payments, debts, balances and statements
PERMISSIONS = (
    "customers.read",
    "customers.write",
    "orders.read",
    "orders.write",
    "money.read",
    "money.write",
    "products.read",
    "products.write",
    "stock.read",
    "stock.write",
    "tasks",  # see and work on tasks
    "tasks.columns",  # change the board's columns
    "dashboard",  # the owner's overview: sales, money, debts
    "settings",  # VAT rates
    "staff",  # people and their roles; only the owner role has it
)

# what an editable role may hold: "staff" would let its holder make themselves an owner
GRANTABLE = tuple(p for p in PERMISSIONS if p != "staff")
# a permission that needs another one to be any use: changing needs seeing
IMPLIES = {p: p.replace(".write", ".read") for p in PERMISSIONS if p.endswith(".write")}
IMPLIES["tasks.columns"] = "tasks"

# the roles a new company starts with, named in the sign-up language; the owner role always has
# every permission, so new ones reach it without a migration
DEFAULT_ROLES: dict[str, dict[str, str]] = {
    "owner": {"uz": "Egasi", "uz-Cyrl": "Эгаси", "ru": "Владелец"},
    "manager": {"uz": "Menejer", "uz-Cyrl": "Менежер", "ru": "Менеджер"},
    "storekeeper": {"uz": "Omborchi", "uz-Cyrl": "Омборчи", "ru": "Кладовщик"},
    "accountant": {"uz": "Buxgalter", "uz-Cyrl": "Бухгалтер", "ru": "Бухгалтер"},
}

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset(PERMISSIONS),
    # sells: customers, orders, taking payments; sees stock and prices, can't change them
    "manager": frozenset(
        {
            "customers.read",
            "customers.write",
            "orders.read",
            "orders.write",
            "money.read",
            "money.write",
            "products.read",
            "stock.read",
            "tasks",
            "tasks.columns",
            "dashboard",
        }
    ),
    # goods in and out; sees what's ordered, never money
    "storekeeper": frozenset(
        {
            "customers.read",
            "orders.read",
            "products.read",
            "stock.read",
            "stock.write",
            "tasks",
        }
    ),
    # money in and out, debts, statements, VAT; reads the rest
    "accountant": frozenset(
        {
            "customers.read",
            "orders.read",
            "money.read",
            "money.write",
            "products.read",
            "stock.read",
            "tasks",
            "dashboard",
            "settings",
        }
    ),
}

ANY = None  # any logged-in person

# "METHOD path" (the route's template, without the /api/v1 prefix) -> the permission it needs
ROUTES: dict[str, str | None] = {
    "GET /customers": "customers.read",
    "GET /customers/export": "customers.read",
    "GET /customers/similar": "customers.read",
    "POST /customers": "customers.write",
    "GET /customers/{customer_id}": "customers.read",
    "PATCH /customers/{customer_id}": "customers.write",
    "POST /customers/{customer_id}/contacts": "customers.write",
    "PATCH /customers/{customer_id}/contacts/{contact_id}": "customers.write",
    "DELETE /customers/{customer_id}/contacts/{contact_id}": "customers.write",
    "POST /customers/{customer_id}/notes": "customers.write",
    "GET /activity": "customers.read",  # each entry is also filtered by what it shows
    "DELETE /activity/{activity_id}": "customers.write",
    "GET /products": "products.read",
    "GET /products/export": "products.read",
    "GET /products/{product_id}/movements": "stock.read",
    "POST /products": "products.write",
    "GET /products/{product_id}": "products.read",
    "PATCH /products/{product_id}": "products.write",
    "GET /product-categories": "products.read",
    "POST /product-categories": "products.write",
    "PATCH /product-categories/{category_id}": "products.write",
    "DELETE /product-categories/{category_id}": "products.write",
    "GET /price-lists": "products.read",
    "POST /price-lists": "products.write",
    "PATCH /price-lists/{price_list_id}": "products.write",
    "GET /exchange-rates": "products.read",
    "PUT /exchange-rates/{currency}": "products.write",
    "DELETE /exchange-rates/{currency}": "products.write",
    "GET /warehouses": "stock.read",
    "POST /warehouses": "stock.write",
    "PATCH /warehouses/{warehouse_id}": "stock.write",
    "GET /stock": "stock.read",
    "GET /stock/export": "stock.read",
    "GET /stock/balances": "stock.read",
    "GET /stock-documents": "stock.read",
    "POST /stock-documents": "stock.write",
    "GET /stock-documents/{document_id}": "stock.read",
    "POST /stock-documents/{document_id}/cancel": "stock.write",
    # suppliers belong to goods coming in; what we owe and pay them is money
    "GET /suppliers": "stock.read",
    "POST /suppliers": "stock.write",
    "GET /suppliers/{supplier_id}": "stock.read",
    "PATCH /suppliers/{supplier_id}": "stock.write",
    "GET /supplier-payments": "money.read",
    "GET /supplier-payments/export": "money.read",
    "POST /supplier-payments": "money.write",
    "GET /supplier-payments/{payment_id}": "money.read",
    "POST /supplier-payments/{payment_id}/cancel": "money.write",
    "GET /vat-rates": "orders.read",
    "POST /vat-rates": "settings",
    "DELETE /vat-rates/{rate_id}": "settings",
    "GET /orders": "orders.read",
    "GET /orders/export": "orders.read",
    "POST /orders": "orders.write",
    "GET /orders/{order_id}": "orders.read",
    "PUT /orders/{order_id}": "orders.write",
    "POST /orders/{order_id}/confirm": "orders.write",
    "POST /orders/{order_id}/cancel": "orders.write",
    "POST /orders/{order_id}/returns": "orders.write",
    "GET /returns/{return_id}": "orders.read",
    "POST /returns/{return_id}/cancel": "orders.write",
    "GET /payments": "money.read",
    "GET /payments/export": "money.read",
    "POST /payments": "money.write",
    "GET /payments/{payment_id}": "money.read",
    "POST /payments/{payment_id}/cancel": "money.write",
    "GET /debts": "money.read",
    "GET /debts/export": "money.read",
    "GET /customers/{customer_id}/balances": "money.read",
    "GET /customers/{customer_id}/statement": "money.read",
    "PUT /customers/{customer_id}/opening-balances/{currency}": "money.write",
    "DELETE /customers/{customer_id}/opening-balances/{currency}": "money.write",
    "GET /tasks": "tasks",
    "GET /tasks/summary": "tasks",
    "POST /tasks": "tasks",
    "GET /tasks/{task_id}": "tasks",
    "PATCH /tasks/{task_id}": "tasks",
    "DELETE /tasks/{task_id}": "tasks",
    "GET /task-stages": "tasks",
    "POST /task-stages": "tasks.columns",
    "PATCH /task-stages/{stage_id}": "tasks.columns",
    "DELETE /task-stages/{stage_id}": "tasks.columns",
    "GET /dashboard": "dashboard",
    "GET /onec/export": "money.read",  # the route also needs orders.read
    "PATCH /company": "settings",
    # the import routes also need money.write for debts and stock.write for stock
    "POST /import/customers/read": "customers.write",
    "GET /import/customers/template": "customers.write",
    "POST /import/customers": "customers.write",
    "POST /import/products/read": "products.write",
    "GET /import/products/template": "products.write",
    "POST /import/products": "products.write",
    "GET /roles": "staff",
    "POST /roles": "staff",
    "PATCH /roles/{role_id}": "staff",
    "DELETE /roles/{role_id}": "staff",
    "GET /staff": ANY,  # names for the task assignee picker; details stay with "staff"
    "POST /staff": "staff",
    "PATCH /staff/{user_id}": "staff",
}


def with_implied(permissions: set[str]) -> set[str]:
    return permissions | {IMPLIES[p] for p in permissions if p in IMPLIES}


def can(permissions: frozenset[str] | set[str], permission: str | None) -> bool:
    return permission is None or permission in permissions
