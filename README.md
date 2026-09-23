# WEB_PHIM

## Local setup

1. Copy `.env.example` to `.env` and set `FIREBASE_PROJECT_ID`. Keep the Firebase Admin service-account JSON outside the repository and point `GOOGLE_APPLICATION_CREDENTIALS` to it. Set `GEMINI_API_KEY` and `CLICKHOUSE_PASSWORD` only in the process environment when those services are enabled.
2. Run `python -m backend.cli migrate` once. To create the first administrator, run `python -m backend.cli create-admin`; the command prompts for the password and never stores a default password in source control.
3. Start the API with `uvicorn backend.main:app --reload --env-file .env`, then start Vite with `npm run dev`.

The backend owns authentication, movie/catalog writes, homepage settings, comments, likes, views, crawler jobs, chat history, and telemetry identity. The browser stores only an optional read cache; it never uses that cache to report a successful cloud write. Firestore Rules intentionally deny direct browser access because the backend uses the Admin SDK and enforces admin authorization itself.

## Migration and recovery

`backend.cli migrate` is idempotent. Before upgrading an existing SQLite file it creates a timestamped `.pre-v1-*.bak` beside the database, marks the old seeded SHA-256 accounts for password reset, upgrades legacy username references to immutable user IDs, and does not delete movie or interaction rows. Restore by stopping the API, copying the backup over the configured `SQLITE_PATH`, and rerunning the migration only if needed.

## Tests

`python -B -m pytest backend/tests -q -p no:cacheprovider` runs isolated SQLite/Firestore mocks with network access blocked. `npm run lint` and `npm run build` validate the frontend. Firestore Rules have not been deployed from this workspace; deploy them only after reviewing the environment project and running the Firebase emulator.

The old Gemini values found in the tracked `.env` and Compose configuration must be revoked and replaced outside Git. Removing them from the working tree does not revoke a key that was already exposed.
