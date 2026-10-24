# @ghostloop/db

Client for the GhostLoop SpacetimeDB module (`spacetimedb/`). The dashboard and the optimizer worker both
connect through it. Browser-safe: nothing in `src/` uses Node APIs, so it runs in a browser bundle or in Node.
The token is passed in, never read from disk.

## Connect and subscribe

```ts
import { connect, DEFAULT_URI, DEFAULT_DATABASE } from "@ghostloop/db";

const { conn, identity, token } = await connect({
  uri: DEFAULT_URI,           // "ws://127.0.0.1:3000"
  database: DEFAULT_DATABASE, // "ghostloop"
  // token: savedToken,       // reuse an identity; omit for a fresh one
  // subscribe: ["SELECT * FROM experiment", "SELECT * FROM command"], // default: every table
  // timeoutMs: 5000,
});
```

`connect` resolves once the subscription is applied, so `conn.db.<table>` is already populated. It rejects with
`CONNECT_FAILED: ...` if the server is unreachable, the database does not exist, or nothing happens within
`timeoutMs`. In a browser, keep `token` in `localStorage` if you want the same identity across reloads.

The SDK does not reconnect on its own. If the connection is lost after `connect` resolved (server restart,
network drop), `onDisconnect` is called once with the reason; a deliberate `conn.disconnect()` does not call it.
After a loss the cache stops updating and reducer calls never settle, so stop using `conn` and connect again (or
exit):

```ts
const { conn } = await connect({
  onDisconnect: (err) => showBanner(`disconnected: ${err.message}`),
});
```

Watch changes with the generated table handles:

```ts
conn.db.experiment.onInsert((_ctx, row) => render(row));
conn.db.experiment.onUpdate((_ctx, _old, row) => render(row));
conn.db.command.onUpdate((_ctx, _old, row) => showCommand(row));
```

Table accessors are camelCase (`designVersion`, `agentRun`, `agentAction`); the SQL names are snake_case
(`design_version`, `agent_run`, `agent_action`).

## Read rows

Record bodies live in each row's `json` column; parse them with the contracts schemas:

```ts
import { parseRow, RowValidationError } from "@ghostloop/db";
import { Experiment } from "@ghostloop/contracts";

const row = conn.db.experiment.id.find("exp_123");
const exp = row && parseRow(Experiment, "experiment", row.id, row.json);
```

`parseRow` throws `RowValidationError` (`experiment exp_123: <issues>`) on bad JSON or a schema mismatch. Row
types are exported with a `Row` suffix (`ExperimentRow`, `CommandRow`, ...) so they do not clash with the
contracts types.

## Submit designer commands

Only the worker writes domain tables. Designer actions go through the `command` table:

```ts
import { submitCommand } from "@ghostloop/db";

const result = await submitCommand(conn, "approvePatches", {
  experimentId, sourceVersionId, round, patchIds, approvedBy: "designer",
});
if (!result.ok) showError(result.code, result.message);
```

`kind` is a contracts `CommandKind`; the payload is the matching schema in `packages/contracts/src/commands.ts`.
The promise resolves with the `CommandResult` once the worker completes the row (default timeout 30 s, then
`COMMAND_TIMEOUT: ...`). `conn` must be subscribed to `command`. A refused submission rejects with the reducer
error; `reducerErrorCode(err)` returns its code (e.g. `UNKNOWN_COMMAND`, `TOO_LARGE`). Commands submitted while no
worker is running stay `pending` until one starts.

## Regenerating bindings

`src/bindings/` is generated and committed so consumers do not need the `spacetime` CLI. After any change to
`spacetimedb/src/`, run `npm run stdb:generate` at the repo root and commit the result.

## Tests

`npm test -w @ghostloop/db` runs the offline tests. With a local server (`npm run stdb:start`), run
`GHOSTLOOP_STDB_TEST=1 npm test -w @ghostloop/db` for the live module tests; each live test file publishes its own
database with `publishTestDb` from `@ghostloop/db/test-support` (Node-only).
