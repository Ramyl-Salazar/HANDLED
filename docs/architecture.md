# How HANDLED works

HANDLED turns a two-week staffing plan into a reviewable draft. The head nurse remains responsible for approving and publishing the schedule.

```mermaid
flowchart LR
  A[Head nurse: roster and coverage rules] --> D[Two-week schedule builder]
  B[Staff: signed request link] --> C[Period requests]
  E[Head nurse: manual entry or workbook import] --> C
  C --> D
  D --> F[Draft assignments]
  F --> G[Validation and request outcomes]
  G --> H{Head nurse review}
  H -->|Edit assignments or rules| D
  H -->|Approve| I[Published schedule]
  I --> J[Excel export and reports]
```

## Data flow

1. An authenticated head nurse selects a Nurses or Orderlies workspace and maintains its roster and daily shift coverage rules.
2. Staff submit requests through a period-scoped, revocable link after matching their Employee ID and surname. The head nurse can also enter requests or import a workbook.
3. The browser builds a 14-day draft using the roster, requests, coverage minimums, work-hour limits, rest and recovery rules, and request fairness history.
4. Validation surfaces unfilled shifts, unsatisfied requests, and rule conflicts. The head nurse may edit cells, adjust rules, and assign supported overtime coverage.
5. The approved schedule can be published, exported to Excel, and summarized in reports. Workspace state is saved through authenticated API routes in Neon Postgres.

## Application boundaries

```mermaid
flowchart TB
  U[Head nurse browser] -->|Secure session cookie| API[Vercel API routes]
  S[Staff browser] -->|Signed request token| API
  API --> AUTH[Server-side authentication and validation]
  AUTH --> DB[(Neon Postgres: isolated workspaces)]
  U --> ENGINE[Client-side schedule builder and workbook parser]
  ENGINE --> API
  ENGINE --> XLSX[Excel export]
```

The demo uses synthetic staff data. The fixed-account authentication model and staff link verification are pilot controls; see the [README](../README.md#pilot-boundaries) before considering real hospital use.
