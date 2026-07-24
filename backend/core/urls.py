from django.urls import path
from drf_spectacular.views import SpectacularAPIView

from core import round_api, views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("session/", views.session, name="session"),
    path("me/", views.me, name="me"),
    path("session/claim/request/", views.claim_request, name="claim-request"),
    path("session/claim/confirm/", views.claim_confirm, name="claim-confirm"),
    path("round/next/", round_api.next_round, name="round-next"),
    path("round/guess/", round_api.submit_guess, name="round-guess"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
]
