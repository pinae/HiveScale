from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(request) -> Response:
    """Liveness probe used by docker-compose healthchecks, CI, and Playwright."""
    return Response({"status": "ok", "service": "baseline-guesser"})
