# Endpoint authorization matrix

| Scope | Endpoints | Server rule |
|---|---|---|
| Anonymous | `GET /health`, `GET /api/movies`, `GET /api/catalog/{id}`, `GET /api/settings/homepage`, public leaderboards/comments, `POST /api/auth/login`, `POST /api/auth/register` | No session; public data only |
| User | `POST /api/movies/{id}/view`, `GET /api/movies/{id}/stats`, `POST /api/movies/{id}/like`, `GET /api/user/me/favorites`, own comments, `POST /api/track`, `POST /api/chat`, `DELETE /api/chat/history` | Valid HttpOnly session; identity comes from session; state-changing requests require CSRF |
| Admin | `GET /api/auth/users`, catalog create/update/delete/sync, homepage update, admin stats, scheduler configuration/status/stop, crawler, auto-update | Valid session with `role=admin`; CSRF on writes |

The backend still checks every protected endpoint when the frontend route guard is bypassed. Firestore Rules deny direct browser access because the backend Admin SDK is the single catalog writer.
