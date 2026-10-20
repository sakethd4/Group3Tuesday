# Hardware Library

A Hardware as a Service portal built from the AppDevProjectTemplate. Users register, sign in, browse individual hardware resources, check out available hardware, view their checkouts, and return hardware. Administrators can add, edit, and remove resources and see each current borrower.

The application keeps the template's `client/` and `server/` structure. The frontend uses React/TypeScript components, the API uses Python/Flask, persistence uses MongoDB through PyMongo, and authentication uses signed JWTs through PyJWT. Vite builds the React app. React Testing Library runs with Vitest/jsdom; API tests use PyTest and a real MongoDB instance.

## Run locally

Prerequisites: Python 3.12+, Node.js 22.12+ (or a compatible newer release), npm, and a running MongoDB instance. MongoDB may run locally or at a reachable MongoDB URI. No application data is stored in browser storage or an in-memory database.

From the repository root, prepare the backend:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
```

Edit `server/.env`: set `MONGODB_URI` if needed, keep the new `HardwareLibrary` database name, and replace the empty `JWT_SECRET` with your own random value. Generate one with:

```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

Load the configuration and initialize the library:

```bash
set -a
source .env
set +a
python -m flask --app app init-db --seed
python -m flask --app app create-admin
python -m flask --app app run --port 5001
```

`create-admin` prompts for the administrator's name, email, and password. It does not install a default password or promote existing accounts. Public registration creates regular users only. Passwords require 8–128 characters, including uppercase, lowercase, and a number. JWTs expire after one hour.

`init-db --seed` adds Hardware 1 through Hardware 6 as available resources with IDs `HW-001` through `HW-006`. Running it again preserves existing descriptions and checkouts. Omit `--seed` to start with an empty catalog. MongoDB's indexes are also initialized lazily by the API.

In a second terminal, from the repository root:

```bash
cd client
npm ci
npm run dev
```

Open **http://localhost:5173**. Create a regular account, or sign in using the administrator account you created. Vite proxies `/api` to Flask at `127.0.0.1:5001`. Port 5001 avoids the port 5000 conflict with macOS Control Center. If you choose another port, change Flask's port and the proxy target in `client/vite.config.ts` together.

The catalog refreshes every five seconds while visible, when the tab regains focus, and after mutations. A failed refresh preserves the last known data and displays a warning with a retry button. The database rechecks every checkout atomically, even if a browser's display is stale.

## Configuration

| Variable | Location | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Backend | MongoDB connection string; defaults to `mongodb://127.0.0.1:27017`. |
| `MONGODB_DATABASE` | Backend | Defaults to `HardwareLibrary`; separate from the previous hospital database. |
| `JWT_SECRET` | Backend | Required random signing secret, at least 32 bytes. Use the same value across API instances. |
| `CLIENT_ORIGIN` | Backend | Exact allowed frontend origin, default `http://localhost:5173`; comma-separated origins are supported. |
| `VITE_API_BASE_URL` | Frontend, at build time | Deployed API origin, e.g. `https://your-api.example.com`; no `/api` suffix. Leave empty for local development. |
| `TEST_MONGODB_URI` | API tests | Test MongoDB server; defaults to `mongodb://127.0.0.1:27017`. |

The frontend retains its JWT in `sessionStorage` for the current tab. Sign out removes it locally; issued tokens expire after one hour. The API reads the user's current role from MongoDB on each request. Borrower names and emails are visible only to administrators. Checkout and return never accept a user ID from the client.

Existing hospital accounts and project records are not migrated. Use the new database and create new accounts. The obsolete project database stub has been removed.

## Verify

From the repository root, with MongoDB running:

```bash
server/.venv/bin/python -m pytest server/tests -q
npm --prefix client test
npm --prefix client run build
```

For MongoDB on a different port:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 server/.venv/bin/python -m pytest server/tests -q
```

API tests create uniquely named `haas_test_*` databases and remove only those databases afterward. They fail explicitly if MongoDB cannot be reached. The tests cover registration, password hashing, login, expired/forged JWTs, role restrictions, catalog visibility, checkout, 12 simultaneous checkout attempts, returns, borrower privacy, administrator CRUD, validation, database failure handling, and setup commands.

React Testing Library exercises login/registration forms, session restoration and expiration, availability displays, checkout/return buttons, duplicate submission prevention, automatic refresh, conflict messages, retries, and administrator add/edit/remove flows. API calls are mocked in component tests; database behavior is tested separately against MongoDB.

To demonstrate the complete workflow, register two users in separate browser sessions. Check out Hardware 1 as the first user. The second user's catalog will mark it unavailable on refresh, and any stale checkout attempt will receive a conflict. Return it as the first user, then check it out as the second. Sign in as the administrator to inspect the borrower and manage resources. Checked-out hardware must be returned before removal.

## Deploy on Vercel / AWS

Deployment configuration is included; hosting credentials, a production MongoDB URI, and environment variables must be supplied by the project owner. No live deployment is created by this repository alone.

### Vercel frontend and Flask backend

1. Import this repository into Vercel twice, with separate project root directories: `server` for the Flask API and `client` for the React frontend.
2. For the API, use the Flask framework preset and Python 3.12. `server/app.py` exports `app`; `server/requirements.txt` contains its dependencies. Set `MONGODB_URI`, `MONGODB_DATABASE`, `JWT_SECRET`, and `CLIENT_ORIGIN` in the API project's environment. Ensure the database is reachable from the deployment.
3. For the frontend, use the Vite preset, `npm run build`, and output directory `dist`. Set `VITE_API_BASE_URL` to the deployed API origin. The included `client/vercel.json` rewrites `/login` and `/register` to the React entry point.
4. Set the backend's `CLIENT_ORIGIN` to the exact HTTPS frontend origin and redeploy the API after changing it. Configure any intended preview origins explicitly too. The API must be reachable by the frontend without a hosting-provider login challenge.
5. Run `flask --app app init-db --seed` and `flask --app app create-admin` from a trusted environment using the production database configuration. Keep secrets out of Git and use HTTPS for both deployments.
6. Check the deployed API's `/api/health` endpoint and perform the demonstration above against the deployed frontend.

Vercel's supported Flask entry point is documented in [Flask on Vercel](https://vercel.com/docs/frameworks/backend/flask).

### AWS alternative for the Flask backend

The frontend can remain on Vercel while the Flask API runs on AWS Elastic Beanstalk's Python platform. Package the **contents of `server/`** as the deployment root, excluding `.venv`, `.env`, caches, and tests. `application.py` exports the WSGI `application`, and `.ebextensions/python.config` selects it. Configure the same backend environment variables, provide access to MongoDB, and use an HTTPS endpoint. Set the Vercel frontend's `VITE_API_BASE_URL` to that endpoint. The AWS platform supplies its production WSGI server; do not deploy Flask's development server as the production process. See [AWS's Flask deployment guide](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create-deploy-python-flask.html).

## Project layout

```text
client/src/
  App.tsx                    Session and page navigation
  api.ts                     Authenticated API requests and error handling
  components/                Brand, auth layout, hardware card, hardware form
  hooks/useHardware.ts       Availability refresh and request cancellation
  pages/                     Registration, login, and hardware library
  test/                      React Testing Library tests
server/
  app.py                     Flask routes, JWT validation, roles, CLI commands
  usersDatabase.py           User persistence and password verification
  hardwareDatabase.py        Hardware CRUD and atomic checkout/return
  tests/                     PyTest integration tests using MongoDB
```

See [DesignDoc.md](DesignDoc.md) for the data model, API contract, and acceptance criteria.
