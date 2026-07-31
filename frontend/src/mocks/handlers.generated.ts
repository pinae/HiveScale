// AUTO-GENERATED from openapi.json by scripts/generate-mocks.mjs.
// Do not edit by hand — run `yarn mocks:generate` to refresh.
import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("/api/challenge/", () =>
    HttpResponse.json({})),
  http.get("/api/challenge/next/", () =>
    HttpResponse.json({})),
  http.post("/api/content/scales/", () =>
    HttpResponse.json({})),
  http.post("/api/content/things/", () =>
    HttpResponse.json({})),
  http.get("/api/daily-wave/", () =>
    HttpResponse.json({})),
  http.post("/api/daily-wave/guess/", () =>
    HttpResponse.json({})),
  http.get("/api/health/", () =>
    HttpResponse.json({})),
  http.get("/api/me/", () =>
    HttpResponse.json({})),
  http.get("/api/me/stats/", () =>
    HttpResponse.json({})),
  http.post("/api/round/guess/", () =>
    HttpResponse.json({
      "source": "human",
      "counted": true,
      "score": {
        "total": 712,
        "means_match": 0.74,
        "belief_match": 0.68,
        "good_match": true
      },
      "crowd": {
        "histogram": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0.2,
          0.3,
          0.3,
          0.2,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ],
        "belief_histogram": [
          0.01,
          0.01,
          0.01,
          0.01,
          0.01,
          0.01,
          0.01,
          0.01,
          0.14,
          0.18,
          0.18,
          0.14,
          0.02,
          0.02,
          0.02,
          0.02,
          0.02,
          0.02,
          0.02,
          0.02
        ],
        "median": 52.5,
        "q25": 41.1,
        "q75": 63.8,
        "n": 23
      },
      "percentile": 83,
      "bimodal": false,
      "streak": {
        "hot": 3
      },
      "player": {
        "xp": 4212,
        "level": 2
      }
    })),
  http.get("/api/round/next/", () =>
    HttpResponse.json({
      "round_token": "eyJwIjoxLi4ufQ:signed",
      "pairing_id": 1,
      "thing": {
        "text": "Robotic lawnmower"
      },
      "scale": {
        "left": "sophisticated",
        "right": "overly complicated"
      }
    })),
  http.get("/api/scale-request/", () =>
    HttpResponse.json({})),
  http.post("/api/scale-request/submit/", () =>
    HttpResponse.json({})),
  http.post("/api/session/", () =>
    HttpResponse.json({})),
  http.post("/api/session/claim/confirm/", () =>
    HttpResponse.json({})),
  http.post("/api/session/claim/request/", () =>
    HttpResponse.json({})),
  http.post("/api/vote/", () =>
    HttpResponse.json({})),
  http.get("/api/vote/next/", () =>
    HttpResponse.json({})),
];
