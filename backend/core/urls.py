from django.urls import path

from core import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("session/", views.session, name="session"),
    path("me/", views.me, name="me"),
    path("session/claim/request/", views.claim_request, name="claim-request"),
    path("session/claim/confirm/", views.claim_confirm, name="claim-confirm"),
]
