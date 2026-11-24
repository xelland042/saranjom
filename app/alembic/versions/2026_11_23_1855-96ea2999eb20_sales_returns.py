"""sales returns

Revision ID: 96ea2999eb20
Revises: 4c799ccee176
Create Date: 2026-11-23 18:55:25.952966

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.rls import enable_rls

# revision identifiers, used by Alembic.
revision: str = "96ea2999eb20"
down_revision: Union[str, Sequence[str], None] = "4c799ccee176"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # return lines point at (order line, company), so that pair must be unique first
    op.create_unique_constraint(
        op.f("uq_order_line_id_tenant_id"), "order_line", ["id", "tenant_id"]
    )
    op.create_table(
        "sales_return",
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("total", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column(
            "vat_total",
            sa.Numeric(precision=18, scale=2),
            server_default="0",
            nullable=False,
        ),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["app_user.id"],
            name=op.f("fk_sales_return_created_by_app_user"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["customer_id", "tenant_id"],
            ["customer.id", "customer.tenant_id"],
            name=op.f("fk_sales_return_customer_id_customer"),
        ),
        sa.ForeignKeyConstraint(
            ["order_id", "tenant_id"],
            ["sales_order.id", "sales_order.tenant_id"],
            name=op.f("fk_sales_return_order_id_sales_order"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_sales_return_tenant_id_tenant"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["warehouse_id", "tenant_id"],
            ["warehouse.id", "warehouse.tenant_id"],
            name=op.f("fk_sales_return_warehouse_id_warehouse"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sales_return")),
        sa.UniqueConstraint(
            "id", "tenant_id", name=op.f("uq_sales_return_id_tenant_id")
        ),
        sa.UniqueConstraint(
            "tenant_id", "number", name=op.f("uq_sales_return_tenant_id_number")
        ),
    )
    op.create_index(
        op.f("ix_sales_return_customer_id"),
        "sales_return",
        ["customer_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_sales_return_order_id"), "sales_return", ["order_id"], unique=False
    )
    op.create_index(
        "ix_sales_return_tenant_date",
        "sales_return",
        ["tenant_id", "date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_sales_return_tenant_id"), "sales_return", ["tenant_id"], unique=False
    )
    op.create_table(
        "return_line",
        sa.Column("return_id", sa.BigInteger(), nullable=False),
        sa.Column("order_line_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column(
            "vat_amount",
            sa.Numeric(precision=18, scale=2),
            server_default="0",
            nullable=False,
        ),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "quantity > 0", name=op.f("ck_return_line_quantity_positive")
        ),
        sa.ForeignKeyConstraint(
            ["order_line_id", "tenant_id"],
            ["order_line.id", "order_line.tenant_id"],
            name=op.f("fk_return_line_order_line_id_order_line"),
        ),
        sa.ForeignKeyConstraint(
            ["product_id", "tenant_id"],
            ["product.id", "product.tenant_id"],
            name=op.f("fk_return_line_product_id_product"),
        ),
        sa.ForeignKeyConstraint(
            ["return_id", "tenant_id"],
            ["sales_return.id", "sales_return.tenant_id"],
            name=op.f("fk_return_line_return_id_sales_return"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_return_line_tenant_id_tenant"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_return_line")),
    )
    op.create_index(
        op.f("ix_return_line_order_line_id"),
        "return_line",
        ["order_line_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_return_line_product_id"), "return_line", ["product_id"], unique=False
    )
    op.create_index(
        op.f("ix_return_line_return_id"), "return_line", ["return_id"], unique=False
    )
    op.create_index(
        op.f("ix_return_line_tenant_id"), "return_line", ["tenant_id"], unique=False
    )
    for table in ("sales_return", "return_line"):
        enable_rls(op, table)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_return_line_tenant_id"), table_name="return_line")
    op.drop_index(op.f("ix_return_line_return_id"), table_name="return_line")
    op.drop_index(op.f("ix_return_line_product_id"), table_name="return_line")
    op.drop_index(op.f("ix_return_line_order_line_id"), table_name="return_line")
    op.drop_table("return_line")
    op.drop_index(op.f("ix_sales_return_tenant_id"), table_name="sales_return")
    op.drop_index("ix_sales_return_tenant_date", table_name="sales_return")
    op.drop_index(op.f("ix_sales_return_order_id"), table_name="sales_return")
    op.drop_index(op.f("ix_sales_return_customer_id"), table_name="sales_return")
    op.drop_table("sales_return")
    op.drop_constraint(op.f("uq_order_line_id_tenant_id"), "order_line", type_="unique")
