import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from io import BytesIO

import qrcode

from app.core.config import settings
from app.models import Order, Shop, User
from app.schemas.orders import QRCodePayload


def _signing_key() -> bytes:
    secret = settings.jwt_secret_key.get_secret_value().encode("utf-8")
    return hmac.new(secret, b"kahvecell-order-qr-v1", hashlib.sha256).digest()


def _canonical_json(data: dict[str, str]) -> bytes:
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _format_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _unsigned_payload(order: Order, user: User, shop: Shop) -> dict[str, str]:
    return {
        "order_id": order.qr_code,
        "user_id": user.public_id,
        "shop_id": shop.public_id,
        "created_at": _format_timestamp(order.created_at),
    }


def create_qr_payload(order: Order, user: User, shop: Shop) -> QRCodePayload:
    data = _unsigned_payload(order, user, shop)
    signature = hmac.new(_signing_key(), _canonical_json(data), hashlib.sha256)
    return QRCodePayload(**data, signature=signature.hexdigest())


def verify_qr_signature(payload: QRCodePayload) -> bool:
    data = {
        "order_id": str(payload.order_id),
        "user_id": str(payload.user_id),
        "shop_id": str(payload.shop_id),
        "created_at": payload.created_at,
    }
    expected = hmac.new(_signing_key(), _canonical_json(data), hashlib.sha256)
    return hmac.compare_digest(expected.hexdigest(), payload.signature)


def create_qr_image(payload: QRCodePayload) -> str:
    content = json.dumps(
        payload.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    image = qrcode.make(content)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
