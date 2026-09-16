# Airth Mini Job Queue Dashboard

## Overview

A small full-stack job queue dashboard. The React frontend lets users create jobs, view them in reverse chronological order, filter by status, advance jobs through the supported lifecycle, and delete jobs. The NestJS API persists jobs in PostgreSQL through Prisma.

The main correctness rule is enforced by the backend and database, not only by the UI: a job can be claimed from `pending` to `running` once, even when two requests arrive at nearly the same time.

## Links

- Frontend: [https://frontend-ecru-one-95.vercel.app/](https://frontend-ecru-one-95.vercel.app/)
- Backend/API: [https://backend-silk-seven-62.vercel.app/](https://backend-silk-seven-62.vercel.app/)
- GitHub repository: [https://github.com/jainabhishek2004/airth-job-queue](https://github.com/jainabhishek2004/airth-job-queue)

## Features

- Create jobs with a title and type.
- List jobs ordered by creation time, newest first.
- Filter jobs by `pending`, `running`, `completed`, or `failed`.
- Advance jobs only through valid status transitions.
- Delete jobs.
- Show loading, empty, and API error states in the dashboard.
- Reject conflicting concurrent status updates at the database boundary.

## Tech Stack

- Frontend: React, Vite, TypeScript
- Backend: NestJS
- ORM: Prisma
- Database: PostgreSQL

## Architecture

```text
React + Vite frontend
        |
        | HTTP/JSON
        v
NestJS REST API
        |
        | Prisma Client
        v
PostgreSQL
```

The frontend reads the API origin from `VITE_API_BASE_URL`. The backend exposes the jobs controller, applies global request validation and CORS configuration, and uses Prisma for persistence.

### Request flow

1. The dashboard sends a JSON request to the NestJS API.
2. NestJS validates the body and route/query parameters.
3. The jobs service applies the state-machine rule.
4. Prisma reads or updates PostgreSQL.
5. The API returns the result or a meaningful HTTP error.
6. Successful mutations publish an SSE invalidation event so connected dashboards refetch their current view.

## API

All endpoints are relative to the backend/API URL.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/jobs` | Create a job. The request body contains `title` and `type`; new jobs start as `pending`. |
| `GET` | `/jobs?page=1&limit=10&status=pending` | Return a page of jobs, ordered by `createdAt` descending. `page` defaults to `1`, `limit` defaults to `10` and is capped at `100`, and `status` is optional. The response includes `data`, `page`, `limit`, `total`, `totalPages`, and status `counts`. |
| `GET` | `/jobs/events` | Open an SSE stream. Successful job mutations publish a `jobs-changed` event. |
| `PATCH` | `/jobs/:id/status` | Update a job to a valid next status. The request body contains `status`. |
| `DELETE` | `/jobs/:id` | Delete a job. Returns `204 No Content` on success. |

## Job State Machine

```text
pending -> running -> completed
                  \-> failed
```

Terminal states are `completed` and `failed`. No transition out of a terminal state is allowed.

## Validation and Error Handling

- Job titles are trimmed, required strings with a maximum length of 200 characters.
- Job types are trimmed, required strings with a maximum length of 100 characters.
- Status updates accept only the defined job status values.
- UUID route parameters are validated before service handling.
- The backend rejects non-whitelisted request properties.
- Malformed IDs return `400 Bad Request`; missing jobs return `404 Not Found`; invalid or conflicting transitions return `409 Conflict`.
- The frontend displays API error messages and disables controls while create, update, or delete requests are in progress.

## Concurrency and Atomic Updates

Each status transition uses a conditional database update equivalent to:

```sql
UPDATE "Job"
SET status = $newStatus
WHERE id = $id AND status = $expectedCurrentStatus;
```

The service performs this with Prisma `updateMany` and checks the affected-row count. Exactly one request can change a job from the expected state; a competing request receives a zero-row result and is classified as a conflict. This prevents two concurrent requests from both claiming the same transition based on a stale read.

This protection still applies when a caller bypasses React and calls the API directly. The frontend hides invalid actions for convenience, but the API and conditional database update are the authority.

## Assumptions and Trade-offs

- Jobs are stored as database records; there is no separate worker process or background execution system in this assignment.
- Status transitions are intentionally limited to the defined state machine. Jobs do not automatically advance without an API request.
- The dashboard listens for server-sent job-change events so updates from other browsers can refresh the current view without periodic polling.
- PostgreSQL is the source of truth for concurrency decisions. The follow-up read after a successful conditional update returns the updated record to the client.

## Bonus Production-Ready Improvements

### Strict API validation

Global NestJS validation transforms query values, rejects unknown properties, and works with DTO rules for required fields, allowed enum values, length limits, and UUID route parameters. This prevents malformed or unexpected input from reaching the persistence layer and gives clients consistent HTTP errors.

### Pagination

Pagination was implemented in both the backend and frontend. The backend uses Prisma `skip` and `take`, validates `page` and `limit`, supports a maximum page size, and returns total-page metadata. The frontend requests only the current page and provides Previous/Next controls, avoiding the need to load the entire job list into the browser.

### Server-sent events

As an additional improvement, the API exposes `GET /jobs/events` as an SSE stream. Successful create, status-update, and delete operations publish a `jobs-changed` event, and connected frontends refetch their current page. SSE is an in-memory notification mechanism in this assignment; PostgreSQL remains the source of truth, and a production multi-instance deployment would use a shared event broker for guaranteed fan-out.


## Local Setup

### Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

The backend listens on port `3000` by default.

### Frontend

In `frontend/.env`, set the local API origin:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Then run:

```bash
cd frontend
npm install
npm run dev
```

Set the backend CORS origin to the URL shown by Vite when it differs from the default:

```env
FRONTEND_URL=http://localhost:5173
```

## Environment Variables

Set these values in the relevant deployment or local environment. Do not commit secret values.

### Backend

```env
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
FRONTEND_URL=http://localhost:5173
PORT=3000
```

`DATABASE_URL` is required. `FRONTEND_URL` defaults to `http://localhost:5174` in the backend when omitted, and `PORT` defaults to `3000`.

### Frontend

```env
VITE_API_BASE_URL=http://localhost:3000
```

## Deployment

The frontend and backend are deployed separately and are available at the links above. The deployed backend must have access to a PostgreSQL database through `DATABASE_URL`, and its `FRONTEND_URL` value must allow the deployed frontend origin. The frontend deployment must set `VITE_API_BASE_URL` to the deployed backend URL.

Before submission, redeploy both applications from the current repository state and smoke-test `GET /jobs?page=1&limit=1` and `GET /jobs/events`. The live URLs above are reachable, but the deployed backend must expose the current paginated response and SSE endpoint to match this README.



## Tests and Verification

From `backend`:

```bash
npm run test       # unit tests
npm run test:e2e -- --testTimeout 15000  # HTTP/integration tests; requires reachable PostgreSQL
npm run lint
npm run build
```

The test suite covers job creation, listing, deletion, valid and invalid transitions, validation errors, missing jobs, and simulated concurrent update races. The e2e concurrency suite sends concurrent HTTP requests against PostgreSQL and verifies that one transition succeeds while the competing transition receives `409 Conflict`.

The live PostgreSQL e2e suite requires a reachable `DATABASE_URL`. The longer timeout is intentional because a hosted database may need more than Vitest's default 5 seconds during connection or cold-start work.

### Edge cases covered

- Blank, wrong-type, oversized, and extra create fields.
- Invalid status values and unsupported transitions.
- Malformed and non-existent UUIDs.
- Attempts to move terminal jobs back to `running`.
- Concurrent requests trying to perform the same transition.
- Empty result pages and status filters with no matching jobs.
- API loading and error states in the frontend.

From `frontend`:

```bash
npm run lint
npm run build
```

