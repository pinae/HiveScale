"""Celery application (plan §3.1).

Async work — Gemini cold-start estimates and snapshot recomputation — runs on
workers, never in request threads. Broker/result settings come from the
``CELERY_*`` Django settings via the ``CELERY`` namespace.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("hivescale")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
