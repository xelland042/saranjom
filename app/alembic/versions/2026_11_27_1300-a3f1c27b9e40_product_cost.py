"""a cost typed on the product

Revision ID: a3f1c27b9e40
Revises: d678e7175b57
Create Date: 2026-11-27 13:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a3f1c27b9e40"
down_revision: Union[str, Sequence[str], None] = "d678e7175b57"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "product",
        sa.Column("cost", sa.Numeric(precision=18, scale=2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("product", "cost")
