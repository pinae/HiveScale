from django.urls import path
from drf_spectacular.views import SpectacularAPIView

from core import (
    challenge_api,
    content_api,
    daily_wave_api,
    pvp_api,
    round_api,
    scale_request_api,
    views,
    vote_api,
)

urlpatterns = [
    path("health/", views.health, name="health"),
    path("session/", views.session, name="session"),
    path("me/", views.me, name="me"),
    path("me/stats/", views.me_stats, name="me-stats"),
    path("session/claim/request/", views.claim_request, name="claim-request"),
    path("session/claim/confirm/", views.claim_confirm, name="claim-confirm"),
    path("round/next/", round_api.next_round, name="round-next"),
    path("round/guess/", round_api.submit_guess, name="round-guess"),
    path("daily-wave/", daily_wave_api.daily_wave, name="daily-wave"),
    path("daily-wave/guess/", daily_wave_api.daily_wave_guess, name="daily-wave-guess"),
    path("pvp/captcha/", pvp_api.pvp_captcha, name="pvp-captcha"),
    path("pvp/start/", pvp_api.pvp_start, name="pvp-start"),
    path("pvp/<str:join_code>/", pvp_api.pvp_match, name="pvp-match"),
    path("pvp/<str:join_code>/ready/", pvp_api.pvp_ready, name="pvp-ready"),
    path("pvp/<str:join_code>/guess/", pvp_api.pvp_guess, name="pvp-guess"),
    path("vote/next/", vote_api.next_vote, name="vote-next"),
    path("vote/", vote_api.cast_vote, name="vote-cast"),
    path("challenge/next/", challenge_api.next_challenge, name="challenge-next"),
    path("challenge/", challenge_api.submit_challenge, name="challenge-submit"),
    path("scale-request/", scale_request_api.scale_request, name="scale-request"),
    path(
        "scale-request/submit/",
        scale_request_api.submit_scale_request,
        name="scale-request-submit",
    ),
    path("content/things/", content_api.submit_thing, name="content-thing"),
    path("content/scales/", content_api.submit_scale, name="content-scale"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
]
