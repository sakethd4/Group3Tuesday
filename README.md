# Hardware Library

A Hardware as a Service portal built from the AppDevProjectTemplate. Users register, sign in, create projects, join multiple projects, and check out hardware to a joined project. Everyone can browse project inventory, see available and checked-out hardware, and review checkout/return history. Any project member can return its hardware. Only a project's creator can delete it, after its hardware has been returned. Administrators retain hardware add/edit/remove permissions and visibility of the user who recorded each checkout.

The application keeps the template's `client/` and `server/` structure. The frontend uses React/TypeScript components, the API uses Python/Flask, persistence uses MongoDB through PyMongo, and authentication uses signed JWTs through PyJWT. Vite builds the React app. React Testing Library runs with Vitest/jsdom; API tests use PyTest and a real MongoDB instance.

## Run locally

For an existing installation, use **Upgrade an existing hardware library** below and keep your current `.env` and JWT secret.

Prerequisites: Python 3.12+, Node.js 22.12+ (or a compatible newer release), npm, and MongoDB configured as a replica set (including MongoDB Atlas). Assignment, project inventory count, and history are committed in one transaction across separate databases. A standalone MongoDB server cannot perform these transactions. No application data is stored in browser storage or an in-memory database.

For a new local development database, start a single-node replica set from the repository root and leave it running:

```bash
mkdir -p .mongodb
mongod --dbpath .mongodb --replSet hardware-library --bind_ip 127.0.0.1 --port 27017
```

In another terminal, initialize it once:

```bash
mongosh 'mongodb://127.0.0.1:27017' --eval 'rs.initiate({_id:"hardware-library",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

For an existing local database, stop its MongoDB process cleanly and restart it with the same data directory plus `--replSet hardware-library`, then initialize the replica set once. Do not start a second process on its data directory or port. Production deployments should use their existing replica set configuration. See [MongoDB transaction requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

From the repository root, prepare the backend:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
```

Edit `server/.env`: set `MONGODB_URI` to your replica set or Atlas URI, keep `HardwareLibrary` as the database prefix, and replace the empty `JWT_SECRET` with your own random value. Generate one with:

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

`init-db --seed` adds Hardware 1 through Hardware 6 as available resources with IDs `HW-001` through `HW-006`. Running it again preserves existing descriptions and checkouts. Omit `--seed` to start with an empty catalog. MongoDB's indexes are also initialized lazily by the API. If upgrading an existing library, run the migration below **before seeding or creating accounts**.

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
| `MONGODB_DATABASE` | Backend | Database prefix and legacy migration source; defaults to `HardwareLibrary`. |
| `MONGODB_USERS_DATABASE` | Backend | Defaults to `<MONGODB_DATABASE>_users`; contains user accounts. |
| `MONGODB_HARDWARE_DATABASE` | Backend | Defaults to `<MONGODB_DATABASE>_hardware`; contains hardware and current assignments. |
| `MONGODB_PROJECTS_DATABASE` | Backend | Defaults to `<MONGODB_DATABASE>_projects`; contains project membership and inventory counts. |
| `MONGODB_HISTORY_DATABASE` | Backend | Defaults to `<MONGODB_DATABASE>_history`; contains immutable checkout/return events. |
| `JWT_SECRET` | Backend | Required random signing secret, at least 32 bytes. Use the same value across API instances. |
| `CLIENT_ORIGIN` | Backend | Exact allowed frontend origin, default `http://localhost:5173`; comma-separated origins are supported. |
| `VITE_API_BASE_URL` | Frontend, at build time | Deployed API origin, e.g. `https://your-api.example.com`; no `/api` suffix. Leave empty for local development. |
| `TEST_MONGODB_URI` | API tests | Test MongoDB server; defaults to `mongodb://127.0.0.1:27017`. |

All four databases must have different names and live on the same MongoDB deployment. The database account must have read/write and index-creation permissions on each. `MONGODB_DATABASE` is now a naming prefix and the default legacy migration source.

The frontend retains its JWT in `sessionStorage` for the current tab. Sign out removes it locally; issued tokens expire after one hour. The API reads the user's current role from MongoDB on each request. Names and emails of other users remain visible only to administrators. Checkout requires a joined project's immutable `id` as `projectId` in the JSON body; it never accepts a borrower user ID. Project labels are normalized to uppercase and protected by a unique database index.

## Upgrade an existing hardware library

Stop the old API so that no checkouts change while copying. Load the updated configuration, use the same JWT secret, and run this from `server/` **before `init-db --seed`**:

```bash
python -m flask --app app migrate-db --source HardwareLibrary
```

Replace `HardwareLibrary` with the previous database name if different. The command preserves account IDs, password hashes, roles, hardware IDs, descriptions, and availability. It copies into the separate databases without deleting or overwriting source records. Active user-based checkouts are assigned to an automatically created `MIGRATED-<USER-ID>` project owned by that user. These projects appear in the normal UI; users can return hardware and check it out to another project. Imported events are labeled **Imported checkout** and timestamped at import because the old schema did not record checkout times or past activity.

The migration can be rerun safely: existing destination identities are skipped, so returned hardware is not checked out again. Conflicting IDs/emails or missing borrower accounts stop migration without deleting source data; fix the conflict and rerun. Start the updated API once migration succeeds. Historical checkouts that were never stored by the old app cannot be reconstructed. Hospital records are outside this migration's scope.

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

API tests require a replica set, create uniquely named `haas_test_*` databases, and remove only those databases afterward. They fail explicitly if MongoDB cannot be reached. Tests cover authentication, administrator CRUD, multiple memberships, unique project IDs, project-only checkout, shared returns, creator-only deletion, 12 simultaneous checkout attempts, checkout/deletion races, transaction rollback, history pagination/privacy, separate databases, and repeatable migration.

React Testing Library exercises authentication, project creation/join/deletion, required checkout destinations, project inventory and availability filters, checkout/return buttons, history pagination and retries, duplicate submission prevention, automatic refresh, and administrator flows. API calls are mocked in component tests; database behavior is tested separately against MongoDB.

To demonstrate the workflow, register two users in separate browser sessions. Create a project as the first user, join it as the second, and also create or join a second project. Under **All hardware**, select a joined project in **Check out to project**, then check out Hardware 1. The **Availability** filter shows available hardware, checked-out hardware, or all statuses. Open **Projects' Hardware** and select the project in **Hardware assigned to**, or use **Projects → View hardware**, to see only that project's checked-out hardware; another member can return it. Use **History** to see both events. A stale checkout receives a conflict. Only the project creator can delete the empty project; history remains after deletion. Hardware management remains administrator-only.

## Deploy on Vercel / AWS

Deployment configuration is included; hosting credentials, a production MongoDB URI, and environment variables must be supplied by the project owner. No live deployment is created by this repository alone.

### Vercel frontend and Flask backend

1. Import this repository into Vercel twice, with separate project root directories: `server` for the Flask API and `client` for the React frontend.
2. For the API, use the Flask framework preset and Python 3.12. `server/app.py` exports `app`; `server/requirements.txt` contains its dependencies. Set `MONGODB_URI`, `MONGODB_DATABASE`, `JWT_SECRET`, and `CLIENT_ORIGIN` in the API project's environment, plus any database-name overrides. Ensure the MongoDB replica set is reachable and the account can access all four databases.
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
  components/                Brand, auth layout, hardware forms, projects, history
  hooks/useHardware.ts       Hardware/project refresh and request cancellation
  pages/                     Registration, login, and hardware library
  test/                      React Testing Library tests
server/
  app.py                     Flask routes, JWT validation, roles, CLI commands
  usersDatabase.py           User persistence and password verification
  hardwareDatabase.py        Hardware CRUD and atomic checkout/return
  projectsDatabase.py        Projects, unique IDs, and membership
  historyDatabase.py         Persistent checkout/return snapshots
  database.py                Separate database handles and transactions
  migration.py               Repeatable import of the previous hardware library
  tests/                     PyTest integration tests using MongoDB
```

See [DesignDoc.md](DesignDoc.md) for the data model, API contract, and acceptance criteria.
