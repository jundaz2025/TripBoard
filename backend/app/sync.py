"""Redis is a notification channel. PostgreSQL versions/events remain authoritative."""

import asyncio, json, logging
from redis.asyncio import Redis
from .core import REDIS_URL

log = logging.getLogger(__name__)
redis = (
    Redis.from_url(
        REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
    )
    if REDIS_URL
    else None
)


async def publish(board_id):
    """Send a best-effort wake-up signal; committed database versions remain the source of truth."""
    if redis:
        try:
            await redis.publish("tripboard:" + board_id, "changed")
        except Exception:
            log.warning(
                "Redis unavailable; clients will recover through periodic version checks."
            )
