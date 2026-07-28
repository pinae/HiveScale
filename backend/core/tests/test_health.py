"""WP-01 red test: the API must expose a health endpoint.

Written before any view exists — this test MUST fail first (TDD red),
then the health view is implemented to turn it green.
"""

from rest_framework import status
from rest_framework.test import APIClient


def test_health_endpoint_returns_ok() -> None:
    client = APIClient()
    response = client.get("/api/health/")
    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"status": "ok", "service": "hivescale"}


def test_health_endpoint_rejects_post() -> None:
    client = APIClient()
    response = client.post("/api/health/", data={})
    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
