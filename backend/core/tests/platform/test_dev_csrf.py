"""Regression: the anonymous game API must not enforce Django-session CSRF.

A browser that is also logged into the Django admin sends its ``sessionid`` on
same-site API calls. DRF's default ``SessionAuthentication`` would then run
Django's CSRF origin check and reject the dev frontend origin
(``http://localhost:5173``) with::

    {"detail": "CSRF Failed: Origin checking failed - ... does not match ..."}

The game API authenticates via its own signed ``bg_player`` cookie (WP-04) and
never relies on Django-session auth, so it must not depend on it here either.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

DEV_ORIGIN = "http://localhost:5173"


def test_frontend_origin_reaches_the_api_for_an_anonymous_visitor():
    # enforce_csrf_checks=True mirrors the real dev server (the default test
    # client bypasses CSRF via _dont_enforce_csrf_checks).
    client = APIClient(enforce_csrf_checks=True)
    res = client.post("/api/session/", HTTP_ORIGIN=DEV_ORIGIN)
    assert res.status_code == status.HTTP_200_OK


def test_frontend_origin_reaches_the_api_even_with_a_django_session():
    # A logged-in admin's sessionid rides along on the same-site API call, which
    # would otherwise make DRF's SessionAuthentication run the CSRF origin check.
    user = get_user_model().objects.create_user(username="staff", password="pw")
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    res = client.post("/api/session/", HTTP_ORIGIN=DEV_ORIGIN)
    assert res.status_code == status.HTTP_200_OK


def test_cors_headers_allow_the_dev_origin_with_credentials():
    # Supports pointing the SPA straight at the backend (no Vite proxy).
    client = APIClient()
    res = client.get("/api/health/", HTTP_ORIGIN=DEV_ORIGIN)
    assert res["Access-Control-Allow-Origin"] == DEV_ORIGIN
    assert res["Access-Control-Allow-Credentials"] == "true"


def test_cors_preflight_is_answered():
    client = APIClient()
    res = client.options(
        "/api/round/guess/",
        HTTP_ORIGIN=DEV_ORIGIN,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type",
    )
    assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
    assert res["Access-Control-Allow-Origin"] == DEV_ORIGIN
