from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import RefreshSession, User, UserRole

bearer_scheme = HTTPBearer()


def create_token(
    subject: str,
    token_type: str,
    expires_at: datetime,
    **claims: str | int,
) -> tuple[str, str]:
    token_id = uuid4().hex
    payload: dict[str, str | int | datetime] = {
        "sub": subject,
        "type": token_type,
        "jti": token_id,
        "iat": datetime.now(UTC),
        "exp": expires_at,
        **claims,
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, token_id


def create_token_pair(user: User, db: Session) -> dict[str, object]:
    now = datetime.now(UTC)
    access_expires_at = now + timedelta(minutes=settings.access_token_minutes)
    refresh_expires_at = now + timedelta(days=settings.refresh_token_days)
    access_token, _ = create_token(
        str(user.id), "access", access_expires_at
    )
    refresh_token, refresh_id = create_token(
        str(user.id), "refresh", refresh_expires_at
    )
    db.add(
        RefreshSession(
            jti=refresh_id,
            user_id=user.id,
            expires_at=refresh_expires_at,
        )
    )
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_minutes * 60,
        "user": user,
    }


def decode_token(token: str, expected_type: str) -> dict[str, object]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token geçersiz veya süresi dolmuş.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bu işlem için uygun token türü değil.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials, "access")
    try:
        user_id = int(str(payload["sub"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token kullanıcı bilgisi içermiyor.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kullanıcı bulunamadı.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_roles(*roles: UserRole) -> Callable:
    def role_dependency(
        user: User = Depends(get_current_user),
    ) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu işlem için yetkiniz yok.",
            )
        return user

    return role_dependency


def active_refresh_session(
    payload: dict[str, object], db: Session
) -> RefreshSession:
    token_id = payload.get("jti")
    if not isinstance(token_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token geçersiz.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    refresh_session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.jti == token_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > datetime.now(UTC),
        )
    )
    if refresh_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token kullanılmış veya geçersiz.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return refresh_session
