# Hardware as a Service Portal

## Purpose and scope

Organizations share a limited collection of physical hardware. This portal lets users create an account, sign in, view hardware and its availability, check out an available resource, view their own checkouts, and return hardware. Each resource belongs to at most one borrower at a time. Administrators can inspect all resources and current borrowers and add, update, or remove hardware.

The initial sample catalog contains Hardware 1 through Hardware 6. The only resource states are **Available** and **Checked Out**. The previous hospital, patient, project, quantity, reservation, and maintenance workflows are outside this project's scope.

## Team and cadence

Saketh Devarkaonda, Tomi Alaofin, Aalim Momin, Yasir Hassan, and Sujan Goruganti.

One-week sprints with an event-based cadence, Zoom standups, and a Jira board. Collaboration uses Google Drive, GitHub, Zoom, Figma, Messages, and lab sections. Work is developed on GitHub feature branches and reviewed through pull requests. Sprint demonstrations review acceptance criteria; feedback and bugs go into Jira.

## Architecture

```text
React.js / TypeScript components
        |
        | JSON over HTTPS, Authorization: Bearer <JWT>
        v
Python / Flask API
        |
        | PyMongo; atomic single-document writes
        v
MongoDB: users, hardware
```

Frontend builds with the template's Vite toolchain. Password hashing uses Werkzeug, included with Flask. JWT signing and validation use PyJWT. Tests use React Testing Library (Vitest/jsdom runner) and PyTest. Hosting targets are Vercel and/or AWS. No additional application framework or database is required.

## MongoDB model

### `users`

| Property | Type | Rule |
| --- | --- | --- |
| `_id` | ObjectId | Generated user identity. |
| `firstName`, `lastName` | String | Required, trimmed, 1–80 characters each. |
| `email` | String | Required, normalized to lowercase, valid format, maximum 254 characters; unique index. |
| `passwordHash` | String | Werkzeug scrypt password hash; never returned by the API. |
| `role` | String | `user` or `admin`; registration only allows `user`. |
| `createdAt` | UTC datetime | Set when the account is created. |

Administrators are provisioned with the server-only `create-admin` command. Existing email addresses are rejected; the command does not silently promote users.

### `hardware`

| Property | Type | Rule |
| --- | --- | --- |
| `_id` | ObjectId | Immutable API resource identity, exposed as `id`. |
| `hardwareId` | String | Unique human-readable ID, 1–64 characters, normalized uppercase; letters, numbers, hyphens, underscores; starts with a letter or number. |
| `name` | String | Required, trimmed, 1–120 characters. |
| `description` | String | Required, trimmed, 1–2000 characters. |
| `status` | String | `available` or `checked_out`. |
| `checkedOutBy` | ObjectId or null | Current user's `_id`, or null when available; indexed for personal checkouts. |
| `createdAt` | UTC datetime | Set on creation. |

Every entry represents one resource. A unique index prevents duplicate hardware IDs. Hardware starts available, without a borrower. Ordinary metadata edits cannot change `status` or `checkedOutBy`.

Checkout is one `find_one_and_update` filtered by `_id`, `status: available`, and `checkedOutBy: null`. It sets the borrower and status together. Return is one conditional update filtered by `_id`, `status: checked_out`, and the authenticated borrower's identity. Deletion filters on availability so that checkout cannot race a removal and lose an active assignment. These operations use [MongoDB's single-document atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

## Authentication and permissions

Public routes are registration, login, and the database health check. Other routes require a valid HS256 JWT with issuer, audience, issued-at, expiry, and user subject claims. Tokens last one hour. The server secret is required and must be at least 32 bytes. The user and current role are loaded from MongoDB on every authenticated request. Missing/deleted accounts and invalid tokens return `401`; missing administrator permission returns `403`.

Users can browse every resource, but can return only their own checkouts. Administrator permission permits hardware management and borrower visibility, while checkout and return still follow the same ownership rules. Only administrators receive current borrowers' names and emails. Every API response disables caching. Cross-origin requests are allowed only for configured frontend origins.

## API contract

All request and response bodies use JSON except successful deletion (`204`, empty body). Errors have the form `{"success": false, "message": "Explanation"}`. Common status codes: `400` invalid input, `401` missing/invalid authentication, `403` permission denied, `404` unknown resource, `409` conflicting checkout/ID/email or removal of checked-out hardware, `503` unavailable database.

| Method | Path | Permission | Request | Success |
| --- | --- | --- | --- | --- |
| POST | `/api/register` | Public | `firstName`, `lastName`, `email`, `password`, `confirmPassword` | `201 {success, token, user}` |
| POST | `/api/login` | Public | `email`, `password` | `200 {success, token, user}` |
| GET | `/api/me` | User | None | `200 {user}` |
| GET | `/api/hardware` | User | Optional `?mine=true` | `200 {hardware: [...]}` |
| GET | `/api/hardware/:id` | User | None | `200 {hardware}` |
| POST | `/api/hardware/:id/checkout` | User | None | `200 {hardware, message}` |
| POST | `/api/hardware/:id/return` | Borrower | None | `200 {hardware, message}` |
| POST | `/api/hardware` | Admin | `hardwareId`, `name`, `description` | `201 {hardware, message}` |
| PUT | `/api/hardware/:id` | Admin | All three metadata fields | `200 {hardware, message}` |
| DELETE | `/api/hardware/:id` | Admin | None; resource must be available | `204` |
| GET | `/api/health` | Public | None | `200 {status: "ok"}` if MongoDB is reachable |

`:id` is the MongoDB identity exposed by the API, not the editable `hardwareId` label. The registration password must have 8–128 characters, uppercase, lowercase, and a number. Login errors do not distinguish incorrect passwords from nonexistent accounts. Hardware writes reject unrecognized fields, including caller-supplied availability or ownership.

Public user shape:

```json
{
  "id": "MongoDB ObjectId as a string",
  "firstName": "Alex",
  "lastName": "User",
  "email": "alex@example.com",
  "role": "user"
}
```

Hardware shape:

```json
{
  "id": "MongoDB ObjectId as a string",
  "hardwareId": "HW-001",
  "name": "Hardware 1",
  "description": "Shared hardware resource 1.",
  "status": "available",
  "isCheckedOutByMe": false
}
```

For administrators, the hardware object additionally includes `checkedOutBy`, which is null when available or the public user object for the current borrower. Regular users receive only `isCheckedOutByMe`, not another borrower's identifying information.

## React components and behavior

- `App`: session restoration, expiry handling, sign out, and navigation.
- `RegistrationPage` and `LoginPage`: accessible forms, validation, submission state, server error messages.
- `HardwarePage`: catalog, personal checkouts, administrator view, mutation feedback.
- `HardwareCard`: hardware details, availability badge, checkout or return button, and administrator edit/remove actions.
- `HardwareForm`: add/edit metadata with validation and retained input after errors.
- `useHardware`: refreshes the catalog every five seconds while visible, on focus, and after mutations; cancels stale reads and preserves last-known data if the API is unavailable.

The catalog disables checkout for checked-out resources. A stale browser can still receive `409`; the UI displays the conflict and reloads availability. Pending mutations disable repeated actions. Removal requires an explicit confirmation, and checked-out hardware cannot be removed until returned. Forms and cards adapt to narrow screens.

## User stories and acceptance criteria

| Story | Acceptance criteria |
| --- | --- |
| Create a secure account | Valid input creates a regular user with a hashed password and returns a JWT. Duplicate emails and invalid input are rejected. Users cannot select administrator permissions. |
| Sign in | Correct credentials return a JWT and user; incorrect credentials return `401`. Expired and forged JWTs cannot read or mutate protected data. |
| View all hardware and availability | Authenticated users see each resource's ID, name, description, and Available/Checked Out state. Availability refreshes automatically and errors are visible. |
| Check out hardware | Available hardware is assigned to the authenticated user. The UI confirms success and shows it among personal checkouts. |
| Prevent duplicate checkout | Concurrent requests for one resource have exactly one successful winner; all other requests receive `409`. |
| View my hardware | The personal view includes only resources assigned to the current user. |
| Return hardware | Only the current borrower can return the resource; ownership clears and status becomes Available. Another user can then check it out. |
| Administrator sign-in and visibility | An administrator uses the same login flow and can see all resources and each current borrower's identity. |
| Add hardware | An administrator can add a unique hardware ID with name and description. It starts Available. Regular users receive `403`. |
| Update hardware | An administrator can edit metadata, including ID; ownership is preserved. Duplicate IDs and attempted ownership changes are rejected. |
| Remove hardware | An administrator confirms removal of available hardware. A checked-out resource returns `409` until returned. |

## Integration and demonstration

PyTest verifies API behavior using a real MongoDB, including a 12-request checkout race. React Testing Library exercises the user-facing forms and actions. Each test run uses isolated database names. Build/type checks verify the TypeScript frontend. A demonstration uses two user sessions and an administrator to show checkout, conflict prevention, return/reuse, and hardware management. Setup, configuration, verification commands, and Vercel/AWS deployment instructions are in [README.md](README.md).
