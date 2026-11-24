from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.crud.rates import RatesManager
from app.schemas.product import Currency, RateIn, RatesOut

router = APIRouter(prefix="/exchange-rates", tags=["Exchange rates"])


@router.get("", response_model=RatesOut)
async def get_rates(session: SessionDep, current: CurrentUser):
    tenant = current[1]
    return RatesOut(
        base=tenant.currency, rates=await RatesManager(session, tenant).current()
    )


def _foreign(currency: str, tenant) -> str:
    code = currency.strip().upper()
    if len(code) != 3 or not code.isalpha() or code == tenant.currency:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Not a foreign currency"
        )
    return code


@router.put("/{currency}", status_code=status.HTTP_204_NO_CONTENT)
async def set_own_rate(
    currency: Currency, data: RateIn, session: SessionDep, current: CurrentUser
):
    tenant = current[1]
    await RatesManager(session, tenant).set_own(_foreign(currency, tenant), data.rate)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{currency}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_own_rate(currency: str, session: SessionDep, current: CurrentUser):
    tenant = current[1]
    await RatesManager(session, tenant).remove_own(_foreign(currency, tenant))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
