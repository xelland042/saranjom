from typing import Literal

from pydantic import BaseModel, Field


class SignupIn(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    login: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    # the screen's language, for names the app creates (the default price list)
    lang: Literal["uz", "uz-Cyrl", "ru"] = "uz"


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=128)
    new: str = Field(min_length=8, max_length=128)


class MeOut(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    username: str | None
    role: str  # its name
    owner: bool
    # what the screens may offer; the server checks every request
    permissions: list[str]
    company_id: int
    company_name: str
    company_inn: str | None  # the 1C export needs it
    company_bank_account: str | None  # and this, for bank payments
    company_onec_name: str | None  # its name in 1C, if not company_name
