# Heroku deployment

The repository is prepared to serve React and Flask from one Heroku app. Deployment is pending Heroku account access and an Atlas database. Preparing these files does not provision a paid service.

## Accounts

1. Create a [Heroku account](https://signup.heroku.com/). Review the [current pricing](https://www.heroku.com/pricing/) before activating hosting. Eco is listed at $5/month and sleeps during inactivity; Basic is listed at $7/month and stays running.
2. Create a [MongoDB Atlas account](https://www.mongodb.com/cloud/atlas/register) and a **Free** cluster. Keep paid backup or other paid options disabled unless you want them.
3. Create a database user with read/write access to these four databases: `HardwareLibrary_users`, `HardwareLibrary_hardware`, `HardwareLibrary_projects`, and `HardwareLibrary_history`. Use a strong generated password and obtain the application's `mongodb+srv://` driver connection URI. Keep credentials in Heroku Config Vars, not source control or chat.
4. Configure Atlas network access for the deployment. Heroku Common Runtime outbound addresses are dynamic. Choose an access strategy before deployment; broad access such as `0.0.0.0/0` permits connections from any IP and should not be enabled without acknowledging that scope. A static outbound IP service can provide a narrower allowlist and may cost extra.

## App configuration

Deploy the repository root with classic buildpacks on **heroku-24**:

1. `heroku/nodejs`
2. `heroku/python`

The Node buildpack executes `heroku-postbuild`, installing the existing locked client dependencies and building `client/dist`. Python installs root `requirements.txt`. The Procfile starts Gunicorn using `wsgi:app` on Heroku's assigned `$PORT`. React `/`, `/login`, `/register`, assets, fonts, and `/api` share the same origin.

Set these Heroku Config Vars before the first release:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Atlas driver connection URI with the application's database user credentials. |
| `MONGODB_DATABASE` | `HardwareLibrary`, or a different prefix for a separate environment. |
| `JWT_SECRET` | A newly generated random value of at least 32 bytes. Keep it stable across releases. |
| `CLIENT_ORIGIN` | The exact HTTPS URL reported by Heroku for this app. |
| `VITE_API_BASE_URL` | Leave unset/empty so the frontend uses the same origin. |

For the existing Heroku app, configure the stack, buildpacks, and variables explicitly using the dashboard or CLI. The root `package.json`, `requirements.txt`, `.python-version`, and `Procfile` describe the build and startup commands. `wsgi.py` serves the built React app and the Flask API at one origin.

The release command initializes indexes and ensures the six sample hardware items. It never clears existing accounts, projects, history, or assignments. There is no default account or password. Use public registration after deployment; the existing `create-admin` command remains available to the operator when needed.

## Verification before sharing the URL

For the first deployment, follow this order:

1. In Heroku Settings, add the Config Vars from the table above. To generate `JWT_SECRET` locally, run `python3 -c 'import secrets; print(secrets.token_hex(32))'` and paste the result into the dashboard. Use the actual Web URL shown by Heroku for `CLIENT_ORIGIN`, without a trailing slash. Keep passwords and secrets out of chat and Git.
2. In Atlas, confirm that the database user can read/write all four application databases and configure network access as described above. Adding only your laptop's IP does not allow Heroku to connect.
3. On macOS with Homebrew, install and authenticate the CLI:

   ```sh
   brew install heroku/brew/heroku
   heroku login
   ```

4. From the repository root, connect to the existing app. Replace `YOUR_APP_NAME` with its name:

   ```sh
   heroku git:remote -a YOUR_APP_NAME
   heroku apps:info
   ```

5. Configure the classic stack and buildpacks (Node builds React first, Python runs Flask):

   ```sh
   heroku stack:set heroku-24
   heroku buildpacks:set heroku/nodejs
   heroku buildpacks:add heroku/python
   heroku buildpacks
   ```

6. Review all pending changes before committing the version you intend to deploy. The repository may also contain application changes from earlier work:

   ```sh
   git status --short
   git diff
   git add -A
   git diff --cached --stat
   git commit -m "Prepare application for Heroku deployment"
   ```

   Confirm the staged files are intended application/configuration changes, without secrets or local database files. A commit saves a local source snapshot; it does not deploy anything.

7. Deploy that committed snapshot:

   ```sh
   git push heroku HEAD:main
   ```

   Heroku installs dependencies, builds React, and runs the release command to initialize indexes and ensure sample hardware exists. If the release fails, fix the reported configuration/database issue before proceeding. Uploaded code does not copy your local MongoDB records to Atlas.

8. In the Heroku app's Resources tab, choose the desired paid dyno plan and enable one `web` dyno. This runs the Gunicorn server defined by `Procfile`.
9. Open the app and inspect logs if needed:

   ```sh
   heroku open
   heroku logs --tail
   ```

   Press Ctrl+C to stop watching logs; this does not stop the deployed app.
10. Complete the checks below. If you need an administrator, run `heroku run flask --app wsgi:app create-admin` and follow its interactive prompts. There is no default administrator password.

- Open the public homepage and reload `/login` and `/register` directly.
- Check `/api/health`; it must return `{"status":"ok"}`.
- Register and log in; create a project and check out hardware.
- Use a second browser session to verify unrelated projects are hidden, join by ID, and return the first user's checkout.
- Sign out and in again to confirm persistence.
- Run the TA checklist against the public URL. Local tests alone do not verify cloud networking or access.

Local development stays at `http://localhost:5173` with the Flask development API at port 5001. Production uses the separate `wsgi.py` entry point; existing local routes and database configuration are unchanged.

References: [Heroku buildpacks](https://devcenter.heroku.com/articles/managing-buildpacks), [Node build scripts](https://devcenter.heroku.com/articles/nodejs-classic-buildpack-builds), [Gunicorn on Heroku](https://devcenter.heroku.com/articles/python-gunicorn), [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
