# Admin plan override fix

## Fixed

- Instance admin plan overrides now work end to end. Assigning an override previously failed with a 500 because the generated subscription row carried an empty `workspace_id` that violated the Postgres foreign key; the model now stores a NULL workspace, and the override grants plan entitlements exactly like a paid Paddle subscription across billing status, entitlement checks, setup state, and public profiles.
- Removing an override from the plan dialog previously returned 422 because the empty `plan_id` was rejected by request validation; empty `plan_id` now reaches the removal path as documented.
