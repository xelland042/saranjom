from fastapi import FastAPI, Request
from fastapi.responses import ORJSONResponse
from sqlalchemy.exc import IntegrityError

UNIQUE_VIOLATION = "23505"


class InvalidField(Exception):
    """A value that passed the schema but not the data, e.g. a price list from another company.
    Answered as a 422 in FastAPI's own shape, so the frontend marks the field the same way.
    """

    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message


class Duplicate(Exception):
    """A unique value (ИНН, article, barcode) already used: 409 with the record that has it."""

    def __init__(self, field: str, existing_id: int):
        self.field = field
        self.existing_id = existing_id


async def invalid_field_handler(request: Request, exc: InvalidField):
    return ORJSONResponse(
        status_code=422,
        content={
            "detail": [
                {"loc": ["body", exc.field], "msg": exc.message, "type": "value_error"}
            ]
        },
    )


async def duplicate_handler(request: Request, exc: Duplicate):
    return ORJSONResponse(
        status_code=409,
        content={"detail": "Already exists", "field": exc.field, "id": exc.existing_id},
    )


async def integrity_error_handler(request: Request, exc: IntegrityError):
    # asyncpg's wrapped error carries the Postgres error code as sqlstate
    if getattr(exc.orig, "sqlstate", None) == UNIQUE_VIOLATION:
        return ORJSONResponse(status_code=409, content={"detail": "Already exists"})
    # other constraint failures aren't classified yet: re-raise so they're logged as a 500
    raise exc


def add_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(InvalidField, invalid_field_handler)
    app.add_exception_handler(Duplicate, duplicate_handler)
