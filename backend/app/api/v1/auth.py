from datetime import UTC, datetime, timedelta
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    active_refresh_session,
    bearer_scheme,
    create_token,
    create_token_pair,
    decode_token,
    get_current_user,
)
from app.db.session import get_db
from app.models import (
    OtpChallenge,
    User,
    UserRole,
)
from app.schemas.auth import (
    AuthTokenResponse,
    CompleteProfileRequest,
    OtpIssuedResponse,
    OtpVerifyRequest,
    PhoneRequest,
    ProfileTokenResponse,
    RefreshRequest,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["Kimlik doğrulama"])
SIMULATED_OTP = "1234"
MAX_OTP_ATTEMPTS = 5


class OtpPurpose(str, Enum):
    REGISTER = "REGISTER"
    LOGIN = "LOGIN"


def issue_otp(
    phone_number: str,
    purpose: OtpPurpose,
    db: Session,
) -> OtpIssuedResponse:
    now = datetime.now(UTC)
    pending_challenges = db.scalars(
        select(OtpChallenge).where(
            OtpChallenge.phone_number == phone_number,
            OtpChallenge.verified_at.is_(None),
            OtpChallenge.expires_at > now,
        )
    )
    for challenge in pending_challenges:
        challenge.expires_at = now

    db.add(
        OtpChallenge(
            phone_number=phone_number,
            purpose=purpose.value,
            expires_at=now + timedelta(minutes=settings.otp_expiry_minutes),
        )
    )
    db.commit()
    return OtpIssuedResponse(
        message="Simülasyon OTP kodu gönderildi. Test kodu: 1234.",
        expires_in_seconds=settings.otp_expiry_minutes * 60,
    )


@router.post("/register", response_model=OtpIssuedResponse)
def register(
    request: PhoneRequest,
    db: Session = Depends(get_db),
) -> OtpIssuedResponse:
    existing_user = db.scalar(
        select(User).where(User.phone_number == request.phone_number)
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bu numara kayıtlı. Giriş için /auth/login kullanın.",
        )
    return issue_otp(request.phone_number, OtpPurpose.REGISTER, db)


@router.post("/login", response_model=OtpIssuedResponse)
def login(
    request: PhoneRequest,
    db: Session = Depends(get_db),
) -> OtpIssuedResponse:
    user = db.scalar(select(User).where(User.phone_number == request.phone_number))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu numarayla kayıtlı kullanıcı bulunamadı.",
        )
    return issue_otp(request.phone_number, OtpPurpose.LOGIN, db)


@router.post(
    "/verify-otp",
    response_model=AuthTokenResponse | ProfileTokenResponse,
)
def verify_otp(
    request: OtpVerifyRequest,
    db: Session = Depends(get_db),
) -> AuthTokenResponse | ProfileTokenResponse:
    now = datetime.now(UTC)
    challenge = db.scalar(
        select(OtpChallenge)
        .where(
            OtpChallenge.phone_number == request.phone_number,
            OtpChallenge.verified_at.is_(None),
            OtpChallenge.expires_at > now,
        )
        .order_by(OtpChallenge.created_at.desc())
    )
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aktif OTP isteği bulunamadı veya kodun süresi doldu.",
        )

    if challenge.attempts >= MAX_OTP_ATTEMPTS:
        challenge.expires_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok fazla hatalı deneme. Yeni OTP isteyin.",
        )

    if request.otp_code != SIMULATED_OTP:
        challenge.attempts += 1
        if challenge.attempts >= MAX_OTP_ATTEMPTS:
            challenge.expires_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP kodu hatalı.",
        )

    challenge.verified_at = now
    if challenge.purpose == OtpPurpose.REGISTER.value:
        db.commit()
        profile_token, _ = create_token(
            challenge.phone_number,
            "profile",
            now + timedelta(minutes=settings.profile_token_minutes),
            challenge_id=challenge.id,
        )
        return ProfileTokenResponse(
            profile_token=profile_token,
            expires_in=settings.profile_token_minutes * 60,
        )

    user = db.scalar(select(User).where(User.phone_number == challenge.phone_number))
    if user is None:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kullanıcı bulunamadı. Önce kayıt olun.",
        )
    tokens = create_token_pair(user, db)
    db.commit()
    return tokens


@router.post("/complete-profile", response_model=AuthTokenResponse)
def complete_profile(
    request: CompleteProfileRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    payload = decode_token(credentials.credentials, "profile")
    try:
        phone_number = str(payload["sub"])
        challenge_id = int(str(payload["challenge_id"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profil tamamlama token'ı geçersiz.",
        ) from exc

    challenge = db.get(OtpChallenge, challenge_id)
    if (
        challenge is None
        or challenge.phone_number != phone_number
        or challenge.verified_at is None
        or challenge.profile_completed_at is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bu profil tamamlama isteği geçersiz veya daha önce kullanılmış.",
        )
    if db.scalar(select(User).where(User.phone_number == phone_number)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bu numarayla kullanıcı zaten kayıtlı.",
        )
    if request.email and db.scalar(
        select(User).where(User.email == request.email)
    ) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bu e-posta başka bir kullanıcıda kayıtlı.",
        )

    user = User(
        phone_number=phone_number,
        first_name=request.first_name.strip(),
        last_name=request.last_name.strip(),
        email=request.email,
        role=UserRole.CUSTOMER,
    )
    if not user.first_name or not user.last_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ad ve soyad boş bırakılamaz.",
        )

    challenge.profile_completed_at = datetime.now(UTC)
    db.add(user)
    db.flush()
    tokens = create_token_pair(user, db)
    db.commit()
    return tokens


@router.post("/refresh", response_model=AuthTokenResponse)
def refresh_tokens(
    request: RefreshRequest,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    payload = decode_token(request.refresh_token, "refresh")
    refresh_session = active_refresh_session(payload, db)
    try:
        user_id = int(str(payload["sub"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token kullanıcı bilgisi içermiyor.",
        ) from exc

    if refresh_session.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token kullanıcı bilgisi uyuşmuyor.",
        )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kullanıcı bulunamadı.",
        )

    refresh_session.revoked_at = datetime.now(UTC)
    tokens = create_token_pair(user, db)
    db.commit()
    return tokens


@router.get("/me", response_model=UserResponse)
def read_current_user(
    user: User = Depends(get_current_user),
) -> User:
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: RefreshRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> None:
    access_payload = decode_token(credentials.credentials, "access")
    refresh_payload = decode_token(request.refresh_token, "refresh")
    refresh_session = active_refresh_session(refresh_payload, db)
    if access_payload.get("sub") != refresh_payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu oturumu kapatma yetkiniz yok.",
        )
    refresh_session.revoked_at = datetime.now(UTC)
    db.commit()
