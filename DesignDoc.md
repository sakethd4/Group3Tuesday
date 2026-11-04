# Hardware as a Service Portal

## Purpose and scope

Organizations share individual physical hardware resources. Users create accounts, sign in, create projects, join any number of projects, and check out available hardware to a project they have joined. Each resource belongs to at most one project at a time. Project members can view their shared inventory and return hardware, regardless of which member checked it out. All authenticated users can browse projects, resource availability, and checkout/return history.

Project creation is open to every authenticated user. Only the creator may delete a project, and all assigned hardware must first be returned. Administrators retain hardware add/edit/remove permissions and visibility of checkout actors. The initial sample catalog remains Hardware 1 through Hardware 6; resource states remain **Available** and **Checked out**. Authentication, branding, and the existing catalog design are preserved.

## Team and cadence

Saketh Devarkaonda, Tomi Alaofin, Aalim Momin, Yasir Hassan, and Sujan Goruganti.

One-week sprints with an event-based cadence, Zoom standups, and a Jira board. Collaboration uses Google Drive, GitHub, Zoom, Figma, Messages, and lab sections. Work is developed on GitHub feature branches and reviewed through pull requests. Sprint demonstrations review acceptance criteria; feedback and bugs go into Jira.

## Architecture and persistence

```text
React / TypeScript (Vite)
        | JSON over HTTPS, Authorization: Bearer <JWT>
Flask / PyMongo / PyJWT
        | one MongoDB replica set; cross-database transactions
        +-- HardwareLibrary_users.users
        +-- HardwareLibrary_hardware.hardware
        +-- HardwareLibrary_projects.projects
        +-- HardwareLibrary_history.history
```

`MONGODB_DATABASE` defaults to `HardwareLibrary` and supplies the prefix. Each database name can be overridden independently; the application rejects duplicate database names. All databases must share the same MongoDB deployment. Indexes are created by `init-db` or lazily on the first database request. Transactions require a replica set, including Atlas or a single-node replica set for local development. A standalone server returns a setup error when a transaction is attempted.

### Users

`_id`, `firstName`, `lastName`, `email`, `passwordHash`, `role`, `createdAt`. Existing validation and authentication are unchanged: unique normalized email, Werkzeug password hashing, 8–128 character passwords with uppercase/lowercase/number, regular-user public registration, and server-only administrator provisioning.

### Projects

| Field | Rule |
| --- | --- |
| `_id` | Immutable MongoDB identity, exposed as `id`. Used in relationships and route parameters. |
| `projectId` | Unique human-readable label, 1–64 characters, uppercase, letters/numbers/hyphens/underscores; starts with a letter or number. Protected by a unique index. |
| `name` | Required, trimmed, 1–120 characters. |
| `description` | Optional, up to 2000 characters. |
| `createdBy` | Creator's user ObjectId, taken from authentication. Cannot be supplied by the client. |
| `memberIds` | Array of user ObjectIds; creator is automatically included. Indexed for membership queries. |
| `hardwareCount` | Number of resources assigned to the project; updated transactionally with checkout/return. |
| `createdAt` | UTC creation timestamp. |

Joining uses `$addToSet`, making repeated joins idempotent. There is no one-project-per-user restriction. Public project objects include `creatorId`, `isCreator`, `isMember`, `memberCount`, and `hardwareCount` without exposing the membership list or other users' account details.

### Hardware

Each document represents one physical resource. Existing metadata fields (`_id`, unique `hardwareId`, `name`, `description`, `createdAt`) remain. Metadata edits cannot change assignment or availability.

| Assignment field | Rule |
| --- | --- |
| `status` | `available` or `checked_out`. |
| `checkedOutTo` | Project ObjectId, or null when available; indexed. This is the resource owner. |
| `checkedOutBy` | Authenticated actor who performed checkout, retained for audit/admin visibility. This does not grant return rights. |
| `checkedOutAt` | UTC checkout timestamp, or null when available or importing an unknown original timestamp. |

The public response contains `project` (`id`, `projectId`, `name`) or null, `isCheckedOutByMyProjects`, `canReturn`, and `checkedOutAt`. Administrators also receive the current checkout actor as `checkedOutBy`. Regular users never receive another user's account details.

### History

Each event stores `_id`, `action` (`checkout`, `return`, or `migrated_checkout`), `createdAt`, `actorId`, and hardware/project snapshots containing their immutable identities, human-readable IDs, and names. Events are not edited or deleted by the API. Snapshots preserve the meaning of old entries after metadata changes or hardware/project deletion. The history database is separate from all entity databases.

History is available to authenticated users and sorted by event time, newest first, with ObjectId as the tie-breaker. Requests return at most 50 entries and a `nextCursor` for older events. Optional project and hardware filters use immutable identities, so reused display labels cannot merge separate records' history. Regular users receive `isByMe`; administrators additionally receive the actor's public user object. The UI displays local time from stored UTC timestamps.

## Consistency and authorization

Checkout requires exactly `{ "projectId": "<project's immutable id>" }`. A user ID, missing project, nonmembership, nonexistent project, or unavailable resource is rejected by the server.

Checkout runs in one cross-database transaction:

1. Match the chosen project and authenticated membership, incrementing its hardware count.
2. Atomically change the hardware from available/unassigned to checked out to that project.
3. Insert the checkout history event.

Return similarly checks current project membership, decrements the project count, clears the resource's assignment, and inserts a return event in one transaction. Any failure rolls back all three changes. PyMongo retries transient transaction conflicts; concurrent checkout has one winner, and concurrent returns create one event.

Project deletion atomically matches creator identity and a zero hardware count. Since checkout writes that same project document, a checkout/deletion race either keeps the project with its assignment or deletes the project and rejects checkout. Administrator status does not override project deletion ownership or return membership. Available-hardware deletion remains a conditional atomic operation, preventing checkout/removal races.

JWTs require HS256, issuer, audience, issued-at, expiry, and a valid user subject. They expire after one hour; the current account and role are read from MongoDB for every authenticated request. Other users' names/emails are administrator-only. All responses disable caching; CORS remains restricted to configured frontend origins.

## API contract

Errors use `{ "success": false, "message": "Explanation" }`. Status codes: `400` invalid input, `401` missing/invalid authentication, `403` denied permission, `404` unknown identity, `409` duplicate ID/email or resource conflict, `503` database failure. Successful deletion returns `204` with an empty body.

| Method | Path | Permission / behavior |
| --- | --- | --- |
| POST | `/api/register` | Public; unchanged account fields, returns session (`201`). |
| POST | `/api/login` | Public; email/password, returns session. |
| GET | `/api/me` | Authenticated; current public user. |
| GET | `/api/projects` | Authenticated; all projects, or `?mine=true` for joined projects. |
| POST | `/api/projects` | Authenticated; `projectId`, `name`, optional `description`; creator auto-joins (`201`). |
| POST | `/api/projects/:id/join` | Authenticated; joins idempotently. |
| DELETE | `/api/projects/:id` | Creator only; no assigned hardware. |
| GET | `/api/hardware` | Authenticated; optionally `?mine=true` for joined-project inventory or `?project=<id>`. |
| GET | `/api/hardware/:id` | Authenticated; one resource with current project and return permission. |
| POST | `/api/hardware/:id/checkout` | Project member; requires `projectId` containing immutable project `id`. |
| POST | `/api/hardware/:id/return` | Member of the assigned project; no caller-supplied user ID. |
| POST | `/api/hardware` | Admin; `hardwareId`, `name`, `description` (`201`). |
| PUT | `/api/hardware/:id` | Admin; all three metadata fields, preserving current assignment. |
| DELETE | `/api/hardware/:id` | Admin; available hardware only. |
| GET | `/api/history` | Authenticated; optional `project`, `hardware`, `before` filters; `{history, nextCursor}`. |
| GET | `/api/health` | Public; database/index connectivity. |

All route `:id` values and relationship filters refer to immutable ObjectIds exposed as `id`, not display labels. In the checkout body, the `projectId` key contains this immutable `id`; in project creation it contains the unique human-readable label.

## Frontend behavior

The existing header, authentication forms, catalog rows, black-and-white styling, and hardware administration remain. Navigation adds **Projects** and **History**, and replaces personal checkouts with **My projects’ hardware**.

- **All hardware:** a required joined-project selector enables checkout. Availability and project filters expose current assignment status. Return is available to every member of the assigned project.
- **Projects:** any user can create a unique project and join multiple projects. Membership, hardware counts, a My projects only filter, and View hardware are available. Delete appears only for creators and requires explicit confirmation; assigned hardware disables deletion with an explanation.
- **Project inventory:** View hardware filters the existing catalog to the project's resources. Assign more hardware selects that project and shows available resources.
- **History:** project-filtered checkout/return events, retained after deletion; manual refresh, pagination, empty states, and retries.

Hardware and projects refresh every five seconds while visible, on focus, and after mutations. Failed refreshes retain the last complete catalog/project snapshot and show a retry warning. Stale checkout or deletion attempts are rechecked by the API. Pending mutations disable duplicate actions. Forms retain user input after errors. Layouts adapt to narrow screens; history tables scroll horizontally when needed.

## Migration and validation

`flask --app app migrate-db` copies the old hardware-library database into the separated databases while the old API is stopped. It preserves user identities, passwords, roles, and hardware metadata. Active user checkouts become assignments to automatically created projects owned by those users, with clearly labeled import events. Source records are untouched, and existing destination identities are skipped on reruns. Previously unrecorded history and original checkout times cannot be reconstructed. Full setup and migration steps are in [README.md](README.md).

PyTest covers account security, administrator permissions, unique IDs, multiple memberships, membership-based checkout/return, creator-only deletion, real MongoDB transaction rollback, concurrency races, durable history and pagination, database separation, and repeatable migration. React Testing Library covers the forms, project and hardware flows, selection requirements, filters, history, retries, and session lifecycle. TypeScript and Vite verify the production build.
