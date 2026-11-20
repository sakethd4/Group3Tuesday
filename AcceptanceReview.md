# TA acceptance review — November 17, 2026

The requested project privacy, ID-based joining, and owner/member display changes are implemented. Users, hardware, projects, and history remain in four distinct MongoDB databases. This review evaluates the stated behaviors without adding requirements for a separate username, bulk quantities, or a modal popup. No application behavior was changed during the reassessment.

The app runs at **http://localhost:5173/**. The API is at **http://127.0.0.1:5001**. After verification, the four local app databases were reset: **0 users, 0 projects, 0 history events, and 6 available sample hardware items**. Register a new account to begin. A second browser profile or private window lets another user test the same project.

## Checklist results

The earlier review incorrectly marked features as missing by assuming that “userid” required a separate username and that “hardware set” required multiple units per record. Neither is explicitly specified in the checklist. The app uses email as the login identifier and tracks each hardware resource as one available unit. These are implementation facts, not automatically failed requirements.

| # | Requested case | Observed behavior / result |
| --- | --- | --- |
| 1 | Sign up with userid/password | Supported: email identifies the account; registration accepts a password and the existing profile fields. |
| 2 | Sign in with correct credentials | Supported: valid credentials sign in. |
| 3 | Sign in with wrong credentials | Supported: invalid credentials are rejected with an error. |
| 4 | Create a project with a new ID | Supported: the project is created and its creator becomes owner and member. |
| 5 | Create a project with an existing ID | Supported: duplicate IDs are blocked with an error, including case/whitespace variants. |
| 6 | Join an existing project by ID | Supported: entering the human-readable project ID joins the project. |
| 7 | Check out hardware set 1 | Supported for the app's Hardware 1 resource: it becomes assigned to the selected joined project. |
| 8 | Check out hardware set 2 | Supported for the app's Hardware 2 resource in the same way. |
| 9 | Available quantities decrease | Supported: checking out both resources reduces available items from 6 to 4. Each checked-out resource has no remaining available unit. |
| 10 | Try checking out more than available | Supported as an availability guard: unavailable resources cannot be checked out again. Stale or concurrent requests are rejected by the server; a failed checkout displays an inline error. |
| 11 | Check in hardware set 1 unit | Supported: returning Hardware 1 returns its one unit. |
| 12 | Available quantities increase | Supported: that return increases available items from 4 to 5. |
| 13 | Log off | Supported: sign-out clears the browser session and returns to sign-in. |
| 14 | Log in again and state persists | Supported: saved projects and checkouts survive a fresh login and fresh API instance. |
| 15 | TA registers and logs in | Supported: a second account can register and sign in using its own email/password. |
| 16 | TA creates a duplicate project ID | Supported: duplicate project creation is blocked for the second user too. |
| 17 | TA joins the existing ID; authorization works | Supported: project inventory and return access are denied before membership and allowed after joining with the correct ID. |
| 18 | TA returns hardware 2 checked out by the first user | Supported: another member of the same project can return Hardware 2. |
| 19 | Availability increases after the TA's return | Supported: the return increases available items from 5 to 6. |
| 20 | Check out hardware again | Supported: the returned resource can be checked out again. |

No confirmed missing behavior was found in these cases when evaluated against the current one-unit hardware model and the clarified requirement to block unavailable checkout. This does not establish any additional grading requirements outside the supplied checklist.

### What happens in case 10

The shared catalog only lists available resources. If another user checks out an item before the current screen refreshes, the server still rechecks availability atomically. It rejects the stale request with HTTP 409 and the message: “This hardware is already checked out. Please choose an available resource.” The page displays the error and refreshes availability. Concurrent checkout tests verify that only one request succeeds for the same resource.

The warning is an inline alert, not a modal popup. There is no numeric quantity input, so a specific interaction such as typing 10 when 5 remain is not offered. Those details are not treated as failures of the clarified availability-blocking requirement.

## Privacy behavior

- Project lists always contain only projects the current user belongs to, including when query parameters are changed manually.
- Joining requires `POST /api/projects/join` with an entered human-readable `projectId`. The old internal-ID join route is removed.
- Each joined project's card shows its owner and member names. Account emails and password hashes are not shared.
- The shared catalog shows available hardware only. Own project assignments remain accessible under **Projects' Hardware**.
- Hardware detail endpoints, history filters, and history pagination cannot disclose unrelated project checkouts.
- Administrators retain hardware management, including editing unavailable items, without seeing unrelated project assignments or borrower identities.
- Any joined member can return the project's hardware. Only its owner can delete an empty project. Deleted-project history remains private to its members.

## Verification

- 62 backend integration tests passed against a real local MongoDB replica set: 61 in the main suite plus the added two-user acceptance workflow.
- 24 React component tests passed, including login/logout, typed-ID joining and errors, owner/member display, private catalog/project views, shared returns, and administrator hardware management.
- TypeScript checking and the Vite production build passed.
- The running homepage, login route, frontend module, direct API health check, and Vite API proxy returned HTTP 200. Anonymous project, hardware, and history requests returned 401.
- Verification used real database integration tests, component tests, build checks, and live HTTP checks. A manual browser click-through was not performed.
