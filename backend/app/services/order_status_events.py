import asyncio
from dataclasses import dataclass
from threading import Lock
from typing import TypeAlias

StatusEvent: TypeAlias = dict[str, int | str]


@dataclass(eq=False)
class OrderEventSubscription:
    order_id: int
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[StatusEvent]


class OrderStatusEventHub:
    def __init__(self) -> None:
        self._subscriptions: dict[int, set[OrderEventSubscription]] = {}
        self._lock = Lock()

    def subscribe(self, order_id: int) -> OrderEventSubscription:
        subscription = OrderEventSubscription(
            order_id=order_id,
            loop=asyncio.get_running_loop(),
            queue=asyncio.Queue(),
        )
        with self._lock:
            self._subscriptions.setdefault(order_id, set()).add(subscription)
        return subscription

    def unsubscribe(self, subscription: OrderEventSubscription) -> None:
        with self._lock:
            subscribers = self._subscriptions.get(subscription.order_id)
            if subscribers is None:
                return
            subscribers.discard(subscription)
            if not subscribers:
                del self._subscriptions[subscription.order_id]

    def publish(self, order_id: int, event: StatusEvent) -> None:
        with self._lock:
            subscribers = tuple(self._subscriptions.get(order_id, ()))

        for subscription in subscribers:
            try:
                subscription.loop.call_soon_threadsafe(
                    subscription.queue.put_nowait,
                    dict(event),
                )
            except RuntimeError:
                self.unsubscribe(subscription)


order_status_events = OrderStatusEventHub()
