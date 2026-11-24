from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.deps import CurrentUser
from app.core.config import settings
from app.core.database import SessionDep
from app.core.errors import InvalidField
from app.crud.auth import AuthManager, LoginFailed, TooManyAttempts
from app.schemas.auth import LoginIn, MeOut, PasswordIn, SignupIn

router = APIRouter(prefix="/auth", tags=["Auth"])


def _set_cookie(response: Response, token: str) -> None:
    # HttpOnly: scripts can't read it. SameSite=Lax: other sites can't send it with a
    # POST, which is our protection against cross-site request forgery.
    response.set_cookie(
        settings.auth.cookie_name,
        token,
        max_age=settings.auth.session_days * 86400,
        httponly=True,
        secure=settings.auth.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(data: SignupIn, response: Response, session: SessionDep):
    try:
        token = await AuthManager(session).signup(data)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    _set_cookie(response, token)
    return {}


@router.post("/login")
async def login(
    data: LoginIn, request: Request, response: Response, session: SessionDep
):
    try:
        token = await AuthManager(session).login(
            data.login, data.password, _ip(request)
        )
    except TooManyAttempts:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try again later"
        ) from None
    except LoginFailed:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Wrong login or password"
        ) from None
    _set_cookie(response, token)
    return {}


@router.post("/logout")
async def logout(request: Request, response: Response, session: SessionDep):
    token = request.cookies.get(settings.auth.cookie_name)
    if token:
        await AuthManager(session).logout(token)
    response.delete_cookie(settings.auth.cookie_name, path="/")
    return {}


def _ip(request: Request) -> str:
    # behind the web server this is the visitor's address, not the server's: uvicorn reads it
    # from X-Forwarded-For (--proxy-headers in the Dockerfile). Without that, every visitor
    # would share one address and one login limit
    return request.client.host if request.client else "unknown"


@router.post("/password")
async def change_password(
    data: PasswordIn, request: Request, session: SessionDep, current: CurrentUser
):
    """Any logged-in person, for themselves; the owner resets others' on the staff page."""
    token = request.cookies[settings.auth.cookie_name]  # CurrentUser checked it's there
    try:
        await AuthManager(session).change_password(
            current[0], token, data.current, data.new, _ip(request)
        )
    except TooManyAttempts:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try again later"
        ) from None
    except LoginFailed:
        raise InvalidField("current", "Wrong password") from None
    return {}


@router.get("/me", response_model=MeOut)
async def me(current: CurrentUser):
    user, tenant = current
    return MeOut(
        id=user.id,
        name=user.name,
        phone=user.phone,
        email=user.email,
        username=user.username,
        role=user.role.name,
        owner=user.role.is_owner,
        permissions=sorted(user.role.granted),
        company_id=tenant.id,
        company_name=tenant.name,
        company_inn=tenant.inn,
        company_bank_account=tenant.bank_account,
        company_onec_name=tenant.onec_name,
    )
