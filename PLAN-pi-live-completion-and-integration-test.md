# PLAN: pi live completion investigation and integration test hardening

## Goal

Resolve two related gaps in Kanban's first-class `pi` support:

1. **Investigate and fix why a live pi-backed task did not transition to Review** during end-to-end dogfooding.
2. **Add tighter automated coverage for pi completion semantics** so future regressions are caught before manual QA.

This plan is intentionally investigation-first. It does **not** assume the final fix is already known.

---

## Scope

### In scope

- tracing the live `pi` task lifecycle from task start → pi launch → hook emission → runtime ingest → session summary update → board/review UI
- identifying whether the failure is in:
  - pi launch/prompt delivery
  - pi extension event wiring
  - Kanban hook subprocess invocation
  - hook HTTP ingestion
  - task summary persistence/state transitions
  - frontend websocket/session-state rendering
- implementing the minimal reliable fix once root cause is confirmed
- adding automated tests for pi completion/review semantics
- adding telemetry/debugging so future pi hook failures are diagnosable

### Out of scope

- changing `pi` to a native SDK/runtime integration
- redesigning the board/task-detail UI beyond what is needed to surface pi completion correctly
- broad refactors outside the pi task lifecycle path
- solving all home-sidebar pi behavior unless the same root cause directly affects it

---

## Evidence from investigation

### Proven observations

#### 1) Live Kanban dogfood successfully launched a real pi task session

Observed during the dogfood run:

- runtime logs showed:
  - `pi_extension_generated`
  - `pi_task_session_started`
  - `pi_launch_prepared`
- the browser task detail showed a **terminal-backed session**
- screenshots were captured under:
  - `dogfood-output/pi-e2e-20260327/screenshots/07-task-opened.png`
  - `dogfood-output/pi-e2e-20260327/screenshots/08-task-started.png`
  - `dogfood-output/pi-e2e-20260327/screenshots/09-terminal-visible.png`

#### 2) The live Kanban dogfood task did **not** visibly transition to Review within 45 seconds

Evidence:

- `dogfood-output/pi-e2e-20260327/report.md`
- persisted runtime session record in:
  - `~/.cline/kanban/workspaces/kanban/sessions.json`

Relevant session snapshot for task `eabf9`:

- `state: "running"`
- `reviewReason: null`
- `lastHookAt: null`
- `latestHookActivity: null`

This is the strongest signal that Kanban never persisted any pi hook activity for the task.

#### 3) Direct pi execution can complete the same style of task quickly outside Kanban

Direct repro command used during investigation:

```bash
cd /home/shuv/repos/kanban && \
  timeout 45s pi -e /home/shuv/.cline/kanban/hooks/pi/kanban-extension.ts \
  --session-dir /tmp/kanban-pi-investigate-$$ \
  'Create a tiny markdown file named DOGFOOD_PI_DIRECT.md in the repo root with one line saying pi direct ok'
```

Observed result:

- file **was created**:
  - `/home/shuv/repos/kanban/DOGFOOD_PI_DIRECT.md`
- contents:

```text
pi direct ok
```

This proves the following are at least capable of working together:

- `pi`
- prompt-as-positional-arg launch semantics
- the generated extension file loading via `-e`
- task-like execution with `--session-dir`

#### 4) The original dogfood task output file was not found in the task worktree

Checked in:

- main repo root: `/home/shuv/repos/kanban`
- task worktree: `/home/shuv/.cline/worktrees/eabf9/kanban`

Expected file was absent:

- `DOGFOOD_PI_CHECK.md`

So the live Kanban task did **not** leave the expected task artifact behind.

#### 5) The generated hook command path is not obviously broken by worktree cwd

The runtime process was launched as:

```bash
node dist/cli.js --port 3486 --no-open
```

`buildKanbanCommandParts()` therefore resolves commands like:

```bash
node dist/cli.js hooks notify ...
```

This initially looked risky because `dist/cli.js` is relative, but the task worktree contains:

- `/home/shuv/.cline/worktrees/eabf9/kanban/dist -> /home/shuv/repos/kanban/dist`

So the relative CLI path is **not currently disproven as the root cause**.

#### 6) pi hook notifications are still the most suspicious missing link

The persisted task session data shows:

- `lastHookAt: null`
- `latestHookActivity: null`

If `pi` hook notifications had been successfully ingested, we would expect at least one of:

- `lastHookAt` to be non-null
- `latestHookActivity.source === "pi"`
- state transition to `awaiting_review`

The absence of all three strongly suggests one of:

- the extension events never fired
- the extension fired but `notify(...)` never reached Kanban
- hook ingest reached Kanban but was rejected/no-op'd unexpectedly

---

## Working hypotheses

These are ordered by current confidence.

### Hypothesis A - most likely

**pi extension events are not successfully reaching `kanban hooks notify`, so Kanban never receives `activity` / `to_review` signals.**

Why this fits the evidence:

- launch succeeds
- no persisted hook timestamps/activity exist
- no review transition occurred
- current pi extension swallows errors in `notify(...)`
- `hooks notify` is intentionally best-effort and also suppresses thrown failures
- current telemetry only logs `pi_hook_notify_failed` inside the hook subprocess, which is easy to lose during PTY runs

**Specific sub-cause to investigate - implicit `KANBAN_RUNTIME_PORT` propagation:**

The generated pi extension calls `execFile(parts[0]!, [...parts.slice(1)], { env: process.env })` - it inherits the pi process's env. The spawned `hooks notify` subprocess reads `process.env.KANBAN_RUNTIME_PORT` (via `buildKanbanRuntimeUrl`) to find the runtime server. However, `createHookRuntimeEnv()` in `hook-runtime-context.ts` only sets `KANBAN_HOOK_TASK_ID` and `KANBAN_HOOK_WORKSPACE_ID` - **not** `KANBAN_RUNTIME_PORT`. The port *does* propagate implicitly because `setKanbanRuntimePort()` writes to `process.env` and `buildTerminalEnvironment()` spreads `process.env` into the PTY child - but this is a fragile implicit dependency. If the pi PTY process's env does not contain the correct `KANBAN_RUNTIME_PORT`, the hook subprocess will connect to the default port (3484) instead of the actual runtime port, causing silent delivery failure.

Files involved:

- `src/terminal/agent-session-adapters.ts`
- `src/commands/hooks.ts`
- `src/trpc/hooks-api.ts`
- `src/telemetry/runtime-log.ts`
- `src/terminal/hook-runtime-context.ts` - only passes 2 env vars, not the port
- `src/core/runtime-endpoint.ts` - implicit port propagation via `process.env`

### Hypothesis B - also plausible

**The pi event choice is too weak for Kanban's task semantics.**

Current generated extension maps:

- `agent_start` → `to_in_progress`
- `tool_execution_start` / `tool_execution_end` → `activity`
- `agent_end` → `to_review`

Potential issue:

- even though docs say `agent_end` fires once per user prompt, Kanban may need richer/per-turn semantics such as `turn_end` and/or final assistant message extraction to reliably drive review UI in interactive sessions.

**Important caveat:** The plan references `turn_end` as a candidate event, but its availability in pi's actual extension API has not been verified. Before committing to any fix that depends on `turn_end`, Phase 2 must confirm which events pi actually emits by reading `docs/extensions.md` and testing against a live pi instance.

Files involved:

- `src/terminal/agent-session-adapters.ts`
- pi docs:
  - `docs/extensions.md`
  - `docs/json.md`
  - `docs/rpc.md`

### Hypothesis C - lower confidence but important to rule out

**The prompt executed in the direct repro but not in the Kanban-launched worktree session because of launch environment or runtime differences in the task path.**

Possible contributors:

- worktree environment divergence
- provider/session/auth state divergence in spawned PTY sessions
- task prompt formatting edge cases
- pi remaining interactive after initial startup without actually beginning tool execution

Files involved:

- `src/trpc/runtime-api.ts`
- `src/terminal/session-manager.ts`
- `src/terminal/agent-session-adapters.ts`
- `src/workspace/task-worktree.ts`

---

## Architectural direction

### Keep the current product architecture

Do **not** switch pi to a native runtime path as part of this fix.

The plan should preserve:

- PTY-backed pi task sessions
- extension-based hook notifications
- task worktree isolation
- resume-from-trash via `--continue`
- terminal-backed detail view

### Strengthen observability before changing behavior

Because the current failure is invisible once it happens, the first implementation step should be **instrumentation**.

Without that, any fix risks being guesswork.

---

## Relevant files

### Backend runtime and adapter code

- `src/terminal/agent-session-adapters.ts`
- `src/terminal/session-manager.ts`
- `src/terminal/session-state-machine.ts`
- `src/terminal/hook-runtime-context.ts`
- `src/terminal/pi-session-paths.ts`
- `src/trpc/runtime-api.ts`
- `src/trpc/hooks-api.ts`
- `src/commands/hooks.ts`
- `src/core/api-contract.ts`
- `src/core/kanban-command.ts`
- `src/core/runtime-endpoint.ts`
- `src/telemetry/runtime-log.ts`

### Frontend/runtime state consumers

- `web-ui/src/runtime/use-runtime-state-stream.ts`
- `web-ui/src/components/board-card.tsx`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `web-ui/src/hooks/use-board-interactions.ts`
- `web-ui/src/hooks/use-review-ready-notifications.ts`

### Existing tests

- `test/runtime/terminal/agent-session-adapters.test.ts`
- `test/runtime/trpc/hooks-api.test.ts`
- `test/runtime/trpc/runtime-api.test.ts`
- `test/runtime/hooks-pi-metadata.test.ts`
- `test/runtime/terminal/session-manager.test.ts`
- `test/integration/runtime-state-stream.integration.test.ts`

### Dogfood artifacts

- `dogfood-output/pi-e2e-20260327/report.md`
- `dogfood-output/pi-e2e-20260327/screenshots/*.png`

---

## Implementation plan

## Phase 1 - Add observability to the pi hook path (mandatory first step)

### Objective

Make it impossible for pi hook delivery failures to disappear silently.

### Tasks

- [x] Add explicit telemetry for **every pi hook delivery attempt** in the generated extension path.
- [x] Add telemetry for **hook subprocess result classification**:
  - attempted
  - succeeded
  - failed before spawn
  - failed with non-zero exit
  - failed because hook runtime env was missing
  - failed because Kanban hook ingest returned an error
- [x] Include stable correlation fields on pi hook telemetry:
  - `workspaceId`
  - `taskId`
  - `hookEvent`
  - `hookEventName`
  - `toolName`
  - `toolInputSummary`
  - `sessionDir`
  - `cwd`
  - `commandParts`
  - `durationMs`
  - `exitCode`
  - `errorClass`
  - `errorMessage`
- [x] Add one debug artifact path for local investigation, gated behind an env flag if needed, e.g. per-task JSONL under:
  - `~/.cline/kanban/hooks/pi/logs/<workspace>/<task>.jsonl`
  - **This JSONL file is the primary observable telemetry sink for hook delivery.** The current `writeStructuredRuntimeLog()` in `src/telemetry/runtime-log.ts` is just `process.stderr.write()` - but stderr belongs to the short-lived `hooks notify` subprocess, which is not captured or persisted anywhere. Without a file-based sink, Phase 2 will have no observable failure signal from the extension side.
- [x] Update the generated pi extension's `notify()` catch block to **write structured failure records to the JSONL log path** instead of swallowing silently. The extension runs inside the pi process (long-lived), so it has access to write the JSONL file directly. This is the only reliable place to capture extension-side failures.
- [x] Ensure `hooks notify` / `hooks ingest` can emit a structured success/failure signal consumable by the caller, even if `notify` remains best-effort from a product perspective.
- [x] Verify `KANBAN_RUNTIME_PORT` is present in the pi PTY process environment. If it is missing or incorrect, the hook subprocess connects to the default port (3484) instead of the actual runtime. Consider making `createHookRuntimeEnv()` explicitly include the port alongside `KANBAN_HOOK_TASK_ID` and `KANBAN_HOOK_WORKSPACE_ID`.

### Rationale

Right now both layers are best-effort **and both failure paths are unobservable**:

- the extension swallows `execFile` failures (stderr goes nowhere)
- `hooks notify` swallows ingest failures (subprocess stderr is not captured)
- `writeStructuredRuntimeLog()` writes to stderr of the hooks subprocess, which is discarded

That makes root cause invisible. The JSONL log file is the fix - it gives both the extension and the hook subprocess a durable, inspectable sink.

### Validation

- [x] Starting a pi task emits a visible hook-attempt telemetry event.
- [x] A successful hook updates `lastHookAt`.
- [x] A forced failure (e.g. missing env or invalid port in a targeted test) emits structured failure telemetry.

---

## Phase 2 - Reproduce the failing lifecycle in a controlled way

### Objective

Prove exactly where the pi path breaks.

### Tasks

- [ ] Re-run a live pi task after Phase 1 instrumentation and collect:
  - launch telemetry
  - hook-attempt telemetry
  - hook-result telemetry
  - persisted session summary diff
- [ ] Confirm whether the first `agent_start` / `tool_execution_start` / `turn_end` / `agent_end` events fire at all.
- [ ] Confirm whether `kanban hooks notify` is invoked with the expected env:
  - `KANBAN_HOOK_TASK_ID`
  - `KANBAN_HOOK_WORKSPACE_ID`
  - `KANBAN_RUNTIME_PORT` - verify the actual value matches the runtime's listening port, not the default 3484
  - `KANBAN_RUNTIME_HOST` - if set
- [ ] Confirm whether hook ingest resolves the intended workspace/task summary.
- [ ] Compare the task worktree run versus a direct repo-root run with the same prompt and extension.
- [ ] **Verify which pi extension events are actually available and their firing semantics.** Read pi's `docs/extensions.md` and test against a live pi instance to confirm whether `turn_end`, `message_end`, and other candidate events exist. This determines whether Candidate Fix A is viable.

### Decision gate

At the end of this phase, classify the failure into one of these buckets:

1. **extension never fires events**
2. **extension fires but notify subprocess fails**
3. **notify succeeds but hook ingest rejects or no-ops**
4. **summary updates happen but frontend does not reflect them**
5. **prompt execution differs between Kanban task path and direct pi run**

Do **not** implement the semantic fix until this bucket is known.

### Validation

- [ ] Produce one concrete failing trace for a single task ID showing launch → missing state change.
- [ ] Produce one concrete successful direct trace for comparison.

---

## Phase 3 - Fix the pi completion/review semantics

### Objective

Once the failing bucket is confirmed, make the pi task lifecycle reliably produce Kanban review transitions.

### Preferred fix direction

Prefer **event-model strengthening** over UI workarounds.

#### Candidate fix A - make pi completion hooks turn-based instead of only agent-end-based

Current mapping relies on `agent_end` for `to_review`.

If investigation shows `agent_end` is not reliable enough for Kanban's long-lived PTY sessions, update the generated extension to use a stronger combination such as:

- `agent_start` → `to_in_progress`
- `tool_execution_start` / `tool_execution_end` → `activity`
- `turn_end` → `to_review` with final-message metadata
- optionally `message_end` / `agent_end` for final-message enrichment

**Prerequisite:** Phase 2 must confirm that `turn_end` (or equivalent) actually exists in pi's extension API before committing to this fix.

Why this is a strong option (if the event exists):

- `turn_end` is conceptually closer to "one completed unit of work inside a still-running session"
- it aligns better with Kanban's review model than raw process exit
- it naturally supports comment/retry loops within the same session

#### Candidate fix B - keep `agent_end`, but fix missing delivery/ingest

If instrumentation proves `agent_end` fires correctly and the problem is transport-only, keep the current semantic mapping and repair only the failing pipe.

That may involve:

- command path fixups
- env propagation fixups
- hook notify return-code handling
- task/workspace resolution fixes

#### Candidate fix C - add a fallback transition path when pi clearly completes but no hook arrives

Only do this if A/B are insufficient.

Possible fallback:

- detect a pi-specific completion signature from output or process state
- synthesize `to_review` as a safety net

This should be a last resort because it is less principled than proper hook delivery.

### Tasks

- [ ] Implement the smallest confirmed fix from Phase 2 findings.
- [ ] Ensure the final summary includes usable pi metadata for UI:
  - `lastHookAt`
  - `latestHookActivity.source === "pi"`
  - `latestHookActivity.hookEventName`
  - `latestHookActivity.finalMessage` when available
- [ ] Ensure successful completion transitions task state from `running` → `awaiting_review` with `reviewReason: "hook"`.
- [ ] Ensure resume/comment flows can return `awaiting_review` → `running` → `awaiting_review` repeatedly.
- [ ] Preserve existing PTY behavior and no special-case changes in `session-manager` unless investigation proves they are required.

### Validation

- [ ] A live pi task that completes a trivial file-write task reaches `awaiting_review`.
- [ ] The task worktree contains the expected file after completion.
- [ ] `latestHookActivity` contains pi-derived metadata rather than remaining null.

---

## Phase 4 - Add tighter automated tests

### Objective

Catch pi completion regressions automatically, without depending exclusively on manual dogfooding.

### Test strategy

Use **two layers** of coverage.

### Layer A - hermetic integration tests (required in normal CI)

These should not depend on a real user-authenticated pi environment.

#### Approach

Create a pi-like test harness that exercises Kanban's real pi hook lifecycle contract while remaining deterministic.

**Implementation note:** The existing `test/runtime/trpc/hooks-api.test.ts` already mocks `TerminalSessionManager` and tests `canTransitionTaskForHookEvent` transitions (3 test cases). New hermetic pi tests should **extend this existing suite and its mock fixtures** rather than creating a parallel harness. The 5 new test cases below are a natural superset of the existing coverage.

Possible implementations:

1. **Generated extension + shim process**
   - start a runtime server on a test port
   - start a fake/pi-shim task process that mimics pi event emission by invoking the same hook commands Kanban expects
   - assert state transitions and persisted summaries

2. **Direct hook-ingest integration**
   - test the runtime end-to-end from `hooks notify/ingest` into `TerminalSessionManager`
   - assert `lastHookAt`, `latestHookActivity`, and `awaiting_review`

3. **Adapter-generated artifact assertions**
   - verify the generated pi extension contains `turn_end` / `agent_end` / metadata wiring that matches the chosen fix

#### Required hermetic test cases

- [x] **pi hook activity updates session metadata**
  - start running session
  - inject pi activity hook
  - assert `lastHookAt` and `latestHookActivity.source === "pi"`

- [x] **pi completion moves task to awaiting_review**
  - start running session
  - inject the chosen completion event path
  - assert:
    - `state === "awaiting_review"`
    - `reviewReason === "hook"`
    - review broadcast occurs

- [x] **pi resumed task returns to running on follow-up input and then back to review on completion**

- [x] **pi hook failures are surfaced in telemetry**
  - invalid env / invalid runtime endpoint / command failure
  - assert structured failure log is emitted

- [x] **pi final-message metadata is preserved when available**

### Layer B - real pi smoke/integration test (opt-in, not default CI)

Because a true live `pi` task depends on local auth/models and external execution, keep this test **opt-in**.

#### Proposed contract

- gated by env var, e.g.:
  - `KANBAN_REAL_PI_E2E=1`
- skipped by default in CI
- runs only when:
  - `pi` is installed
  - runtime/auth prerequisites are available

#### Suggested behavior

- start a temporary runtime server on an ephemeral port
- create a temporary workspace or task worktree
- start a real pi task with a trivial file-write prompt
- **timeout: 120 seconds** (pi cold-start + provider round-trip + extension load can easily exceed 45s; the original dogfood's 45s window was likely too short)
- **polling: check session state every 5 seconds** until `awaiting_review` or timeout
- assert one of the following success conditions:
  - file exists in task worktree **and** session reaches `awaiting_review`
  - or test fails with captured hook diagnostics if not

#### Required real-smoke assertions

- [ ] `pi` launch succeeds
- [ ] at least one pi hook arrives
- [ ] completion hook arrives
- [ ] session reaches `awaiting_review`
- [ ] artifact file exists in the worktree

### Recommended file targets

- `test/runtime/terminal/agent-session-adapters.test.ts`
- `test/runtime/trpc/hooks-api.test.ts`
- `test/runtime/terminal/session-manager.test.ts`
- `test/integration/runtime-state-stream.integration.test.ts`
- new opt-in real-smoke file, e.g.:
  - `test/integration/pi-live-completion.integration.test.ts`

---

## Phase 5 - UI verification after backend fix

### Objective

Confirm the frontend accurately reflects the corrected pi lifecycle.

### Tasks

- [ ] Verify board card status text updates away from indefinite running state.
- [ ] Verify task detail terminal panel shows `Ready for review` once the session transitions.
- [ ] Verify ready-for-review notification behavior for pi matches other PTY agents.
- [ ] Verify the state stream merges the pi session summary correctly after hook-driven transitions.

### Files to verify

- `web-ui/src/components/board-card.tsx`
- `web-ui/src/components/detail-panels/agent-terminal-panel.tsx`
- `web-ui/src/runtime/use-runtime-state-stream.ts`
- `web-ui/src/hooks/use-review-ready-notifications.ts`

---

## Telemetry requirements

Per repo policy, telemetry is part of definition-of-done.

### Minimum telemetry additions for this work

- [ ] structured log when pi hook delivery is attempted
- [ ] structured log when pi hook delivery succeeds
- [ ] structured log when pi hook delivery fails
- [ ] structured log when pi completion causes state transition to review
- [ ] stable correlation fields for workspace/task/hook event
- [ ] duration measurement around hook subprocess execution and ingest call

### Suggested event names

- [ ] `pi_hook_notify_attempted`
- [ ] `pi_hook_notify_succeeded`
- [ ] `pi_hook_notify_failed`
- [ ] `pi_review_transitioned`

If naming should stay minimal, at least extend the existing `pi_hook_notify_failed` path and add one success event.

---

## Risks and mitigations

### Risk: we fix the wrong layer

Mitigation:
- instrumentation-first rollout
- require one failing trace before semantic changes

### Risk: real pi behavior differs by provider/model/auth state

Mitigation:
- hermetic tests for contract correctness
- opt-in real smoke test for true runtime validation

### Risk: changing completion events breaks comment/retry loops

Mitigation:
- add resumed-task integration coverage before shipping
- validate repeated `awaiting_review → running → awaiting_review` transitions

### Risk: implicit env propagation breaks on non-default ports

Mitigation:
- Phase 1 should verify `KANBAN_RUNTIME_PORT` is present in the pi PTY env
- consider making `createHookRuntimeEnv()` explicitly include the port
- Phase 2 must compare the env of a direct pi run vs. a Kanban-launched pi run

### Risk: debug logging becomes too noisy

Mitigation:
- keep detailed per-hook logs behind env flag or test-only mode
- keep always-on structured logs concise

---

## Recommended implementation order

1. **Instrument pi hook delivery**
2. **Capture one failing trace from a live pi task**
3. **Classify the actual breakage bucket**
4. **Implement the smallest correct backend fix**
5. **Add hermetic integration tests**
6. **Add opt-in real pi smoke test**
7. **Re-dogfood manually**
8. **Update the existing pi support plan/checklists if needed**

---

## Validation checklist

### Backend correctness

- [ ] pi task summaries record hook timestamps/activity
- [ ] completed pi task reaches `awaiting_review`
- [ ] final pi completion metadata is visible in session summary
- [ ] resumed pi tasks can re-enter running and complete again

### Automated coverage

- [ ] hermetic test covers hook activity metadata
- [ ] hermetic test covers review transition
- [ ] hermetic test covers retry/resume loop
- [ ] hermetic test covers hook-failure telemetry
- [ ] opt-in real pi smoke test exists and passes locally when enabled

### Manual QA

- [ ] live task creates expected artifact inside task worktree
- [ ] board card moves/shows review-ready state
- [ ] task detail panel shows review-ready state
- [ ] no regression to existing PTY agents

---

## Deliverables

- [ ] backend instrumentation for pi hook delivery
- [ ] confirmed root-cause fix for pi review transition failure
- [ ] hermetic automated tests for pi completion semantics
- [ ] optional real-pi smoke integration test
- [ ] refreshed dogfood report or follow-up notes documenting the verified fix
- [ ] clean up investigation artifacts: remove `DOGFOOD_PI_DIRECT.md` from repo root (or add to `.gitignore`)

---

## Summary recommendation

The strongest current evidence is that **Kanban never receives or persists pi hook activity for the live task path**, even though **pi itself can complete equivalent work outside Kanban**.

So the best next move is:

1. instrument the pi hook delivery path,
2. prove exactly where it breaks,
3. then fix either the transport path or the completion event mapping,
4. and lock it in with both hermetic and opt-in real integration coverage.
