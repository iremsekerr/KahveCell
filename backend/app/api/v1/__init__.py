from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.orders import router as orders_router
from app.api.v1.payments import router as payments_router
from app.api.v1.shops import router as shops_router
from app.api.v1.subscriptions import router as subscriptions_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(admin_router)
router.include_router(orders_router)
router.include_router(payments_router)
router.include_router(shops_router)
router.include_router(subscriptions_router)
