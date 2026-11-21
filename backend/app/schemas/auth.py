import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import UserRole


def normalize_phone_number(value: str) -> str:
    phone = re.sub(r"[\s()-]", "", value)
    if phone.startswith("00"):
        phone = f"+{phone[2:]}"
    elif phone.startswith("+"):
        pass
    elif phone.startswith("90") and len(phone) > 10:
        phone = f"+{phone}"
    elif phone.startswith("0"):
        phone = f"+90{phone[1:]}"
    else:
        phone = f"+90{phone}"

    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise ValueError("Geçerli bir GSM numarası girin.")
    return phone


class PhoneRequest(BaseModel):
    phone_number: str = Field(examples=["+905551234567"])

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str) -> str:
        return normalize_phone_number(value)


class OtpVerifyRequest(PhoneRequest):
    otp_code: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class OtpIssuedResponse(BaseModel):
    message: str
    simulated_otp: Literal["1234"] = "1234"
    expires_in_seconds: int


class ProfileTokenResponse(BaseModel):
    requires_profile_completion: Literal[True] = True
    profile_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class CompleteProfileRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    email: str | None = Field(default=None, max_length=255)


class UserResponse(BaseModel):
    id: int
    phone_number: str
    first_name: str
    last_name: str
    email: str | None
    role: UserRole

    model_config = ConfigDict(from_attributes=True)


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserResponse


class RefreshRequest(BaseModel):
    refresh_token: str


class RoleUpdateRequest(BaseModel):
    role: UserRole
