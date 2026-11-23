# HANDLED: pilot-ready build plan

## Current implementation status

The database-backed pilot is deployed at `https://ace-er-scheduling.vercel.app/`. After a head-nurse workflow interview, HANDLED now imports structured requests, generates a constrained two-week draft using the confirmed `6`, `2`, `N`, `REST`, and leave codes, supports direct edits and safe forced-overtime coverage, publishes, and exports.

The next phase is supervised validation with synthetic or hospital-approved data. Do not claim hospital use, time savings, or compliance until those are supported by a measured pilot and formal review.

## Milestone 1 — Validate the scheduling model

- Confirm the implemented 14-day model with the head nurse using representative synthetic schedules.
- Validate edge cases involving mandatory leave, conflicting staff preferences, small rosters, and more than seven desired REST assignments on one date.
- Test the Google Forms template with anonymized or synthetic responses that match the real workflow.
- Define hospital policy for sick leave, emergency call-outs, swaps, and last-minute redeployment.

Exit criterion: a scheduling owner confirms that HANDLED represents the two-week decision process accurately across ordinary and difficult periods.

## Milestone 2 — Build the real scheduling service

- Replace fixed accounts with managed identities, MFA, password recovery, and hospital/unit boundaries.
- Normalize the current JSONB workspace into relational roster, request, schedule-version, incident, and audit tables as concurrency needs grow.
- Store manual-override reasons and immutable published schedule versions.
- Implement constraint solving with explicit infeasibility reasons and deterministic tests.
- Add audit history so every manual override shows who changed what and why.

Exit criterion: access is independently security-tested, concurrent edits are safe, and published schedules have a complete audit history.

## Milestone 3 — Handle real operational disruptions

- Add approved sick-leave and emergency call-out workflows without storing medical detail.
- Re-run only the affected coverage window and preserve unaffected assignments.
- Rank replacement candidates with rest, workload, skills, fairness, and availability checks.
- Add approval, acknowledgement, and notification flows for changed schedules.
- Record unresolved shortages visibly instead of treating them as successful schedules.

Exit criterion: a head nurse can respond to a call-out without rebuilding the two-week schedule in Excel.

## Milestone 4 — Pilot and deployment

- Complete privacy, security, accessibility, and data-retention reviews for the selected deployment context.
- Add automated unit, integration, authorization, and end-to-end tests in CI.
- Deploy a demo environment containing synthetic data only.
- Run a supervised pilot using approved data and measure schedule preparation time, manual corrections, uncovered shifts, and user feedback.
- Turn validated outcomes into a portfolio case study with screenshots, architecture, tradeoffs, and measured results.

Exit criterion: a recruiter can use the safe demo, and a scheduling owner can assess the pilot results without unsupported claims.

## Portfolio acceptance checklist

- Live deployment with synthetic demo data
- Clear ER head-nurse problem statement
- Constraint and recommendation logic documented
- Responsive, keyboard-accessible critical flow
- Passing tests and CI
- Architecture and data-flow diagram
- Security, privacy, and data-retention notes
- Real-user validation clearly separated from assumptions
