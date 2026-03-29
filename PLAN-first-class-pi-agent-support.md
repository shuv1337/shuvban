# PLAN: First-class pi-agent support

## Goal

Add **first-class support for pi-agent (`pi`)** as a Kanban task agent and home-sidebar agent option, with behavior that feels equivalent in product quality to the existing PTY-backed agents.

For this codebase, **first-class** means all of the following:

- `pi` is a selectable runtime agent in Settings and onboarding
- Kanban can detect whether `pi` is installed from the current inherited `PATH`
- task cards can start `pi` sessions in isolated worktrees
- Kanban receives task lifecycle + activity updates from `pi` so board cards and review transitions work
- trashed-task resume works via `pi` session continuation semantics
- the home sidebar can use `pi` as its board-management agent
- docs, tests, and validation cover the new agent path
- telemetry/logging covers agent selection and runtime lifecycle paths involving `pi`

## Recommendation

**Recommended implementation:** ship `pi` initially as a **PTY-backed CLI agent** using a Kanban-provided pi extension loaded via `-e` / `--extension`, with:

- `--session-dir` for **task sessions only**
- `--no-session` for **home sidebar sessions**
- a generated pi extension that emits Kanban lifecycle hooks via **argv-based** `kanban hooks notify` calls

### Why this is the right first version

This matches the repo's existing architecture:

- `docs/architecture.md` explicitly distinguishes **PTY-backed CLI agents** from **native Cline chat**
- `src/terminal/session-manager.ts` and `src/terminal/agent-session-adapters.ts` already provide the extension point for CLI agents
- `pi` already supports:
  - `--append-system-prompt`
  - `-e` / `--extension`
  - `--session-dir`
  - `-c` / `--continue`
  - `--no-session`
  - extension lifecycle events for agent, message, turn, and tool execution
- `pi` also has richer integration surfaces (RPC mode and SDK), but using them now would create a second "native runtime" track before the current Cline cleanup is finished

### Explicit non-goals for v1

These can come later if they become worth the complexity:

- a Cline-style **native chat** UI path for pi
- a dedicated RPC or SDK runtime path for pi
- full pi package / skill / theme management inside Kanban's UI
- pi-specific MCP management inside Kanban
- richer assistant-preview extraction from pi message events beyond board lifecycle + tool activity

## Architecture decision

### Chosen path: PTY-backed `pi` with Kanban extension injection

When Kanban starts a **task** pi session, it should:

1. launch `pi` in the task worktree via the existing PTY runtime
2. pass a **Kanban-managed extension file** with `-e <path>`
3. pass `--session-dir <task-specific-dir>` so each task gets isolated pi session history
4. pass the user prompt as a **positional argument** (`pi "prompt text"`)
5. use `--continue` for `resumeFromTrash`
6. map pi lifecycle events back into Kanban via `kanban hooks notify`

When Kanban starts a **home sidebar** pi session, it should:

1. launch `pi` in the workspace root via the existing PTY runtime
2. pass the same Kanban-managed extension file with `-e <path>`
3. pass `--append-system-prompt <kanban-sidebar-prompt>`
4. pass `--no-session`
5. **not** pass `--session-dir`
6. **not** pass `--continue`

### Prompt delivery semantics

This is a key behavioral difference and must not be confused:

- **Task sessions:** the user prompt is passed as a **positional argument** (pi's default `pi "message"` syntax), matching how the user would invoke pi interactively.
- **Home sidebar sessions:** `--append-system-prompt` injects the Kanban board-management prompt.
- **`--append-system-prompt` must never be used for task session prompts.** It appends to the *system* prompt, not the user message.
- **Home sidebar sessions should use `--no-session`.** The current home-agent IDs are intentionally ephemeral and should not accumulate persistent pi history directories.

### Why not RPC or SDK first

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| PTY-backed CLI + extension | fits current architecture, preserves pi TUI, low blast radius, uses existing task-terminal surfaces | hook/event mapping must be built | **Do now** |
| RPC mode | structured events, easier message parsing than raw TUI | introduces a second non-Cline structured runtime path and larger runtime/UI redesign | Later if needed |
| SDK embedding | maximum control | biggest implementation cost; duplicates the cleanup pressure already visible around Cline | Not now |

## Relevant code and docs

### Kanban files

- `src/core/api-contract.ts`
  - `runtimeAgentIdSchema`: currently excludes `"pi"`
  - `runtimeTaskHookActivitySchema`: includes `activityText`, `toolName`, `toolInputSummary`, `finalMessage`, `hookEventName`, `notificationType`, `source`
- `src/core/agent-catalog.ts`
  - agent catalog entries
  - `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS`
- `src/config/runtime-config.ts`
  - `normalizeAgentId()` uses a **hardcoded string union**, not the Zod schema
  - `AUTO_SELECT_AGENT_PRIORITY`
- `src/terminal/command-discovery.ts`
  - `isBinaryAvailableOnPath()` uses direct inherited `PATH` scanning
- `src/terminal/agent-registry.ts`
  - `detectInstalledCommands()`
  - `buildRuntimeConfigResponse()`
  - `resolveAgentCommand()`
- `src/terminal/agent-session-adapters.ts`
  - `ADAPTERS` is typed `Record<RuntimeAgentId, AgentSessionAdapter>`
  - `getHookAgentDirectory()` returns `~/.cline/kanban/hooks/<agentId>`
  - `buildHookCommand()` currently builds shell strings for hook ingestion
  - `buildHooksCommand()` currently builds shell strings from argv
  - `ensureTextFile()` is available for generated config/plugin files
- `src/terminal/session-manager.ts`
  - PTY session lifecycle
  - existing agent-specific special-casing only for Codex and Claude/Codex workspace trust
- `src/terminal/hook-runtime-context.ts`
  - `KANBAN_HOOK_TASK_ID_ENV`, `KANBAN_HOOK_WORKSPACE_ID_ENV`
- `src/trpc/runtime-api.ts`
  - task session start/stop/input routing
- `src/trpc/hooks-api.ts`
  - hook ingestion and session-state transitions
- `src/commands/hooks.ts`
  - `notify` vs `ingest` semantics
  - hook metadata normalization
- `src/core/home-agent-session.ts`
  - home session IDs are synthetic and ephemeral: `__home_agent__:<workspaceId>:<agentId>:<nonce>`
- `src/core/task-id.ts`
  - task IDs are short and may eventually repeat after deletion
- `src/prompts/append-system-prompt.ts`
  - `APPEND_PROMPT_AGENT_IDS`
  - `resolveHomeAgentId()`
  - `renderLinearSetupGuidanceForAgent()`
- `src/commands/task.ts`
  - permanent delete flows that should clean up pi session dirs
- `web-ui/src/runtime/native-agent.ts`
  - `isNativeClineAgentSelected()` gates Cline-specific chat UI
  - `isTaskAgentSetupSatisfied()` checks launch-supported availability
- `web-ui/src/components/runtime-settings-dialog.tsx`
  - `SETTINGS_AGENT_ORDER`
  - current autonomy/bypass-permissions UX is agent-agnostic and misleading for pi
- `web-ui/src/components/task-start-agent-onboarding-carousel.tsx`
  - `ONBOARDING_AGENT_IDS`
  - install text/link label helpers
- `web-ui/src/components/card-detail-view.tsx`
  - pi should correctly fall through to terminal-backed detail view
- `web-ui/src/telemetry/events.ts`
  - `task_created` already includes `selected_agent_id`
- tests:
  - `test/runtime/config/runtime-config.test.ts`
  - `test/runtime/terminal/agent-registry.test.ts`
  - `test/runtime/terminal/agent-session-adapters.test.ts`
  - `test/runtime/append-system-prompt.test.ts`
  - `web-ui/src/runtime/native-agent.test.ts`

### Pi docs already verified

- `README.md`
  - `-e`, `--extension`
  - `--append-system-prompt`
  - `-c`, `--continue`
  - `--session-dir`
  - `--no-session`
  - `--mode rpc`
- `docs/extensions.md`
  - `agent_start` / `agent_end`
  - `turn_start` / `turn_end`
  - `message_start` / `message_update` / `message_end`
  - `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
  - `tool_call`
  - `before_agent_start`
  - `ctx.hasUI`
  - `pi.registerTool`, `pi.registerCommand`, `pi.sendUserMessage`
- `docs/rpc.md`
  - confirms RPC alternative exists but is not needed for v1
- `docs/sdk.md`
  - confirms SDK alternative exists but is not needed for v1

## Product behavior to preserve

The pi path must preserve the same Kanban product semantics already expected of other PTY agents:

- task starts from backlog into in-progress
- board shows live activity while the agent works
- when the agent finishes or needs attention, the task moves into review semantics via the same hook-driven state machine
- comment/retry loops still route through the same task session
- resume-from-trash continues prior work instead of starting cold
- auto-review actions (commit / PR / move to trash) still operate on worktree output, not agent internals
- home sidebar board-management agent remains separate from task implementation sessions

## Codebase constraints and design corrections

These are the non-obvious constraints the implementation must handle correctly.

### 1. `ADAPTERS` record requires all `RuntimeAgentId` keys (BLOCKING)

`src/terminal/agent-session-adapters.ts`:
```typescript
const ADAPTERS: Record<RuntimeAgentId, AgentSessionAdapter> = { ... };
```
Adding `"pi"` to `runtimeAgentIdSchema` will produce a TypeScript error until a `pi` key exists in `ADAPTERS`.

**Requirement:** schema change and adapter entry must land in the same change.

### 2. `normalizeAgentId()` uses a hardcoded string union (BLOCKING)

If `"pi"` is not added here, saving `selectedAgentId: "pi"` will silently round-trip back to `"cline"`.

**Requirement:** update this alongside the schema change.

**Preferred:** refactor to `runtimeAgentIdSchema.safeParse()` so future agents cannot drift from the schema.

### 3. Raw `taskId` is not safe to use directly in `--session-dir` (BLOCKING)

The plan must **not** use raw task IDs as path segments.

Reasons:

- home session IDs contain `:` via `__home_agent__:<workspaceId>:<agentId>:<nonce>` and are not valid Windows path segments
- normal task IDs are short and can eventually be reused after deletion
- stale pi session directories could make `--continue` resume the wrong historical session

**Requirement:** introduce a deterministic filesystem-safe helper such as:

```typescript
buildPiTaskSessionDir(workspaceId, taskId) =>
  ~/.cline/kanban/hooks/pi/sessions/<encodedWorkspaceId>/<encodedTaskId>/
```

Use URL-safe/base64url or similarly safe encoding for each path segment.

**Requirement:** add best-effort cleanup of pi task session directories when tasks are **permanently deleted**.

### 4. Home sidebar sessions need a different persistence strategy

Home sidebar IDs are intentionally ephemeral. Persisting them with `--session-dir` would create accumulating one-off pi session directories.

**Requirement:** home sidebar pi sessions use `--no-session`, not `--session-dir`.

### 5. No session-manager changes are expected for pi

`src/terminal/session-manager.ts` contains agent-specific behavior only for Codex and Claude/Codex workspace trust. None of that should apply to pi.

**Requirement:** explicitly verify pi does not need session-manager special-casing.

### 6. Pi has no built-in permission system or autonomous-mode flag

Pi has no `--dangerously-skip-permissions` equivalent.

**Requirement:**
- `autonomousArgs: []`
- do **not** wire `autonomousModeEnabled` to any pi CLI flag
- update the Settings UX so it does not imply the toggle changes pi launch behavior

### 7. Pi has no built-in plan mode

Pi has no dedicated plan-mode flag.

**Requirement:** when `startInPlanMode` is true, prepend a planning instruction to the user prompt text, e.g.:

```text
Please create a plan for this task before implementing. Do not make changes yet.
${trimmed}
```

### 8. Hook invocation must use argv arrays, not shell command strings

The previous plan mixed:

- `buildHookCommand()` / shell strings
- `kanban hooks notify`
- `execFile()`

That is not precise enough and is easy to implement incorrectly.

**Requirement:** generated pi extension should bake **command argv arrays** for each hook event and invoke them with `execFile(file, args, ...)` or equivalent.

**Requirement:** prefer `kanban hooks notify` over `kanban hooks ingest` from the pi extension because:
- notify is already best-effort
- extension failures must never break the pi session

### 9. `toolInputSummary` needs explicit hook metadata support

Current hook normalization does not automatically map raw `tool_input` objects into `toolInputSummary`.

**Requirement for v1:**
- extension emits `tool_name` and `tool_input_summary` strings, not raw `tool_input` objects
- `src/commands/hooks.ts` normalization is extended to read `tool_input_summary` into `RuntimeTaskHookActivity.toolInputSummary`
- board UX should continue to rely on `activityText` first, with `toolName` / `toolInputSummary` as structured enrichment

### 10. `pi` binary name may collide on some systems

`isBinaryAvailableOnPath("pi")` may detect a non-coding-agent binary.

**Decision for v1:** accept this risk and document it.

**Follow-up:** validate identity via `pi --version` or `pi --help` before marking installed.

## Implementation plan

### Phase 1 — Core wiring and adapter (atomic change)

The schema change, catalog entry, config normalization, and adapter **must land together** because `ADAPTERS` is typed `Record<RuntimeAgentId, AgentSessionAdapter>`.

#### Schema and catalog

- [x] Extend `runtimeAgentIdSchema` in `src/core/api-contract.ts` to include `"pi"`
- [x] Add a `pi` entry to `src/core/agent-catalog.ts`
  - `id: "pi"`
  - `label: "pi"`
  - `binary: "pi"`
  - `baseArgs: []`
  - `autonomousArgs: []`
  - `installUrl: "https://www.npmjs.com/package/@mariozechner/pi-coding-agent"`
- [x] Add `"pi"` to `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS`

#### Config normalization

- [x] Update `normalizeAgentId()` in `src/config/runtime-config.ts`
  - preferred: replace hardcoded union check with `runtimeAgentIdSchema.safeParse()`
- [x] Keep `AUTO_SELECT_AGENT_PRIORITY` unchanged as `[`"claude"`, `"codex"`]`
  - pi should require explicit user selection in v1

#### Agent registry

- [x] Verify `src/terminal/agent-registry.ts` auto-includes pi once it is in the launch-supported catalog
- [x] Verify pi is **not** treated like built-in Cline in `getCuratedDefinitions()`

#### New session-dir helper

- [x] Add a helper in `src/terminal/agent-session-adapters.ts` or a small shared utility:

```typescript
function encodePathSegment(value: string): string;
function buildPiTaskSessionDir(workspaceId: string, taskId: string): string;
```

Design requirements:
- deterministic across restarts
- cross-platform path-safe
- scoped by workspace ID and task ID
- does not use raw IDs as path segments

#### Pi launch adapter

- [x] Add `piAdapter` in `src/terminal/agent-session-adapters.ts`
- [x] Add `pi: piAdapter` to `ADAPTERS`
- [ ] Adapter behavior:

```typescript
piAdapter.prepare(input):
  1. Copy input.args into local args array
  2. Resolve hook context
  3. Generate/update pi extension file at ~/.cline/kanban/hooks/pi/kanban-extension.ts
  4. Add: -e <extensionPath>
  5. Inject KANBAN_HOOK_TASK_ID / KANBAN_HOOK_WORKSPACE_ID env vars when workspaceId exists
  6. Resolve home appended system prompt via resolveHomeAgentAppendSystemPrompt(input.taskId)
  7. If home session:
     a. add --append-system-prompt <prompt> if needed
     b. add --no-session if not already present
     c. do not add --session-dir
     d. do not add --continue
  8. Else task session:
     a. compute sessionDir = buildPiTaskSessionDir(input.workspaceId, input.taskId)
     b. add --session-dir <sessionDir>
     c. if input.resumeFromTrash: add --continue
  9. If input.startInPlanMode:
     prepend planning instruction to prompt text
 10. Pass prompt as positional argument
 11. Return { args, env }
```

#### Validation

- [x] `runtimeAgentIdSchema.parse("pi")` succeeds
- [x] `normalizeAgentId("pi")` returns `"pi"`
- [x] `buildRuntimeConfigResponse()` includes pi
- [x] installed detection marks pi as installed only when `isBinaryAvailableOnPath("pi")` succeeds
- [x] selecting pi round-trips through config save → load → normalize
- [x] `prepareAgentLaunch({ agentId: "pi" })` returns deterministic args/env
- [x] task sessions add `--session-dir` and positional prompt
- [x] task resume adds `--continue`
- [x] home sessions add `--append-system-prompt` and `--no-session`
- [x] home sessions do **not** add `--session-dir` or `--continue`
- [x] TypeScript compiles with no errors

### Phase 2 — Kanban pi extension for lifecycle bridging

This is what makes pi behave like a Kanban-integrated agent instead of a raw terminal command.

#### Extension generation strategy

Generate the extension dynamically at launch time, not as a checked-in static file. The Kanban CLI invocation path varies per installation and must be baked into the extension.

- [x] Add `buildPiExtensionContent(...)` in `src/terminal/agent-session-adapters.ts`
- [x] Add new helper(s) that produce **argv arrays**, not shell strings, for hook notifications
  - e.g. `buildHookNotifyCommandParts(event, metadata?)`
- [x] In `piAdapter.prepare()`, write:
  - `~/.cline/kanban/hooks/pi/kanban-extension.ts`

#### Exact notification mechanism

The generated extension should:

1. read `KANBAN_HOOK_TASK_ID` and `KANBAN_HOOK_WORKSPACE_ID` from `process.env`
2. bake precomputed **argv arrays** for:
   - `to_in_progress`
   - `activity`
   - `to_review`
3. invoke them via `execFile(binary, args, { env: process.env })` or equivalent
4. swallow all notification failures

**Do not** embed shell-quoted command strings.

#### Event mapping for v1

| Pi extension event | Kanban hook event | Metadata |
|---|---|---|
| `agent_start` | `to_in_progress` | `hook_event_name: "agent_start"`, `source: "pi"` |
| `tool_execution_start` | `activity` | `tool_name`, `tool_input_summary`, `hook_event_name: "tool_execution_start"`, `source: "pi"` |
| `tool_execution_end` | `activity` | `tool_name`, `tool_input_summary` if available, `hook_event_name: "tool_execution_end"`, `source: "pi"` |
| `agent_end` | `to_review` | `hook_event_name: "agent_end"`, `source: "pi"` |

Optional later:
- `message_update` / `message_end` for richer assistant preview text
- `turn_start` / `turn_end` if needed for finer-grained state

#### Metadata contract

Use `--metadata-base64` with a JSON payload.

Required metadata fields for v1:
- `source: "pi"`
- `hook_event_name`
- `tool_name` where applicable
- `tool_input_summary` as a **string** where applicable

#### Hook ingestion updates

- [x] Extend `src/commands/hooks.ts` normalization so `tool_input_summary` maps to `RuntimeTaskHookActivity.toolInputSummary`
- [x] Keep `activityText` as the primary board-facing summary text
- [x] Avoid shipping raw structured `tool_input` objects in v1

#### Constraints

- [x] Extension failures must be best-effort and must not break the pi session
- [x] No custom TUI behavior is required for v1
- [x] Keep extension implementation self-contained with minimal dependencies

#### Validation

- [ ] starting a pi task emits at least one `to_in_progress` hook
- [ ] pi tool use appears as Kanban activity on the board card
- [ ] pi agent completion moves task into review semantics
- [x] extension file generation is deterministic
- [x] `toolInputSummary` can flow through hook ingestion when emitted
- [x] extension file is covered by unit tests

### Phase 3 — Home sidebar support

The existing architecture should let pi piggyback on the non-Cline terminal path once the adapter exists.

- [x] Verify `useHomeSidebarAgentPanel()` works unchanged when `selectedAgentId === "pi"`
- [x] Verify `createHomeAgentSessionId("workspace-1", "pi")` produces `"__home_agent__:workspace-1:pi:<nonce>"`
- [x] Update `src/prompts/append-system-prompt.ts`
  - add `"pi"` to `APPEND_PROMPT_AGENT_IDS`
  - verify `resolveHomeAgentId()` parses pi from home session IDs
  - add:
    ```typescript
    case "pi":
      return "- If Linear MCP is not available in the current agent (pi), use the Kanban CLI, `gh`, and other installed tools directly unless your pi setup provides equivalent integrations. pi does not include built-in MCP support by default.";
    ```
- [x] Verify `card-detail-view.tsx` renders the terminal panel, not the Cline chat panel, for pi

#### Validation

- [x] selecting pi in the home sidebar launches a terminal-backed board-management session
- [x] home pi sessions include Kanban sidebar instructions
- [x] home pi sessions use `--no-session`
- [x] home pi sessions do not leak Cline-specific provider/setup UI
- [x] Linear guidance is pi-specific and does not mention `claude mcp add` / `codex mcp add`

### Phase 4 — Settings, onboarding, and install UX

#### Settings / onboarding

- [x] Update `web-ui/src/components/runtime-settings-dialog.tsx`
  - add `"pi"` to `SETTINGS_AGENT_ORDER`
  - pi appears with correct install state
  - pi is treated like other CLI agents, not like built-in Cline
- [x] Update `web-ui/src/components/task-start-agent-onboarding-carousel.tsx`
  - add `"pi"` to `ONBOARDING_AGENT_IDS`
  - add pi-specific install text
  - use `Learn more` link label for pi
- [x] Verify `isTaskAgentSetupSatisfied()` treats pi like other launch-supported CLI agents

#### Autonomy / permissions UX correction

Current Settings text says:
- "Enable bypass permissions flag"
- "Allows agents to use tools without stopping for permission"

That is misleading for pi.

**v1 requirement:** make this control agent-aware.

Recommended UX:
- rename the section label from **bypass permissions flag** to **Autonomous mode** or similar
- for pi, render an informational note instead of an actionable toggle:
  - `pi does not expose a permission-bypass/autonomy launch flag; Kanban launches pi without an additional autonomy switch.`
- for other agents, preserve existing behavior

#### Validation

- [x] pi appears in Settings with correct install state
- [x] onboarding can select pi without errors
- [x] Settings save with pi selected round-trips correctly
- [x] pi does not display misleading permission-bypass copy
- [x] no Cline provider UI appears when pi is selected

### Phase 5 — Resume, review, trash lifecycle, and cleanup

- [x] Verify task `resumeFromTrash` uses `--continue`
- [x] Verify per-task `--session-dir` makes continuation deterministic for the task lifecycle
- [x] Confirm `startTaskSession()` / `stopTaskSession()` in `src/trpc/runtime-api.ts` need no pi special-casing
- [x] Confirm review transitions triggered by pi hooks yield the same board semantics as other PTY agents
- [x] Confirm auto-review flows remain unchanged because they operate on git/worktree state

#### Pi session-dir cleanup

To prevent stale-history collisions from short task IDs:

- [x] add best-effort deletion of pi task session dirs during **permanent task deletion** flows
- [x] add best-effort deletion of pi task session dirs during **bulk permanent delete** flows
- [x] do **not** delete pi task session dirs when moving a task to trash, because trash restore must resume the session

#### Validation

- [ ] start task → trash → restore → resume works for pi
- [ ] completion still surfaces in Review
- [ ] auto-commit / PR flow can run after pi-generated changes exactly like other PTY agents
- [x] deleting a task cleans up its pi session dir best-effort
- [x] no session-manager code changes were needed

### Phase 6 — Telemetry and observability

Current frontend telemetry already captures `selected_agent_id` on `task_created`, but that is not enough for a new runtime path under this repo's telemetry-first standard.

#### v1 observability requirements

Add structured runtime logs for at least:

- [x] `pi_launch_prepared`
- [x] `pi_extension_generated`
- [ ] `pi_launch_failed`
- [ ] `pi_hook_notify_failed`
- [x] `pi_resume_requested`
- [x] `pi_home_session_started`
- [x] `pi_task_session_started`

Each log record should include as available:
- `agentId`
- `workspaceId`
- `taskId`
- `homeSession: boolean`
- `sessionDir` for task sessions
- `resumeFromTrash: boolean`
- `extensionPath`
- error class/message where relevant

#### Frontend telemetry

- [x] Verify `toTelemetrySelectedAgentId("pi")` returns `"pi"`
- [x] Verify `trackTaskCreated()` captures `selected_agent_id: "pi"`

#### Validation

- [x] structured logs exist for the key pi lifecycle events above
- [x] `task_created` telemetry includes `selected_agent_id: "pi"`
- [ ] extension generation and hook-delivery failures are visible in logs, not silently swallowed

### Phase 7 — Documentation

- [x] Update `README.md`
  - list pi among supported agents
  - note installation: `npm install -g @mariozechner/pi-coding-agent`
- [x] Update `docs/architecture.md`
  - mention pi explicitly in the PTY-backed task-terminal bucket
- [ ] Add a short developer note or code comment about:
  - generated extension location: `~/.cline/kanban/hooks/pi/kanban-extension.ts`
  - why task sessions use `--session-dir`
  - why home sessions use `--no-session`
  - why raw task IDs are not used directly as session-dir path segments
  - why pi is PTY-backed in v1
- [ ] If implementation touches unexpectedly non-obvious files, add a concise high-signal note to `AGENTS.md`

### Phase 8 — Testing

#### Unit / runtime tests

- [ ] `test/runtime/config/runtime-config.test.ts`
  - `normalizeAgentId("pi")` returns `"pi"`
  - pi is not auto-selected by `pickBestInstalledAgentIdFromDetected()`
- [ ] `test/runtime/terminal/agent-registry.test.ts`
  - pi appears in detected agent list when `pi` is on PATH
  - pi appears in `buildRuntimeConfigResponse()` agents array
  - curated agent order expectations are updated to include pi
- [ ] `test/runtime/terminal/agent-session-adapters.test.ts`
  - pi adapter generates:
    - `-e <extensionPath>` when workspace context exists
    - `--session-dir <dir>` for task sessions
    - `--continue` when `resumeFromTrash: true` for task sessions
    - `--append-system-prompt` for home sessions only
    - `--no-session` for home sessions only
    - positional prompt for task sessions
    - expected `KANBAN_HOOK_TASK_ID` / `KANBAN_HOOK_WORKSPACE_ID` env vars
    - extension file exists on disk after `prepare()`
  - pi adapter does **not** generate:
    - `--append-system-prompt` for task sessions
    - `--session-dir` for home sessions
    - `--continue` for home sessions
    - any autonomous-mode flags
  - pi session-dir helper encodes path segments safely
- [ ] `test/runtime/append-system-prompt.test.ts`
  - `resolveHomeAgentAppendSystemPrompt("__home_agent__:ws-1:pi:abc123")` returns non-null prompt containing Kanban sidebar guidance
  - pi guidance does not contain Claude/Codex MCP setup text
- [ ] add tests around hook metadata normalization for `tool_input_summary`

#### Frontend tests

- [x] update onboarding tests to include pi
- [x] update settings tests to include pi
- [x] verify `isNativeClineAgentSelected("pi") === false`
- [x] verify `isTaskAgentSetupSatisfied()` returns `true` when pi is installed and selected
- [x] verify the autonomy/permissions UI is agent-aware for pi

#### Optional integration test (strongly recommended)

- [ ] add a fake `pi` binary fixture that:
  - accepts `-e`, `--session-dir`, `--continue`, `--append-system-prompt`, `--no-session`, and positional prompt
  - validates the generated extension path exists
  - emits simple terminal output and exits
- [ ] use it to validate the adapter + session manager path in CI without depending on the real pi binary

## Implementation order

All of Phase 1 must land as a single atomic change:

1. **Phase 1: Core wiring + adapter** (atomic)
   - `api-contract.ts` — add `"pi"` to schema
   - `agent-catalog.ts` — add pi catalog entry + launch support
   - `runtime-config.ts` — fix `normalizeAgentId()`
   - `agent-session-adapters.ts` — add `piAdapter`, session-dir helper, and `ADAPTERS.pi`
   - `agent-registry.ts` — verify auto-inclusion
2. **Phase 2: Extension generation + hook event mapping + hook metadata support**
3. **Phase 3: Home sidebar prompt support**
4. **Phase 4: Settings / onboarding UX**
5. **Phase 5: Lifecycle validation + permanent-delete cleanup**
6. **Phase 6: Telemetry / observability**
7. **Phase 7: Docs**
8. **Phase 8: Tests** (written alongside each phase, not deferred)

Rationale:

- schema + adapter must be atomic to avoid TypeScript breakage
- extension + hook design is the technical spine
- home/session semantics need to be decided before UI copy is finalized
- cleanup and observability are part of correctness, not polish
- tests should be written alongside each phase

## Resolved design questions

### 1. Should pi participate in auto-select?

**No.** Keep explicit user selection required. `AUTO_SELECT_AGENT_PRIORITY` stays `[`"claude"`, `"codex"`]`.

### 2. Should the generated pi extension live under `.cline/kanban` or a more neutral path?

**Use `~/.cline/kanban/hooks/pi/`.** This matches the existing `getHookAgentDirectory()` convention used by other agents.

### 3. Should pi get an autonomous-mode flag?

**No.** Pi has no built-in permission system. Set `autonomousArgs: []` and make the UI agent-aware.

### 4. Should we add richer assistant-preview extraction from pi events in v1?

**No.** First ship reliable state transitions, tool activity, and deterministic resume.

### 5. Should pi eventually become a native runtime?

**Only after the current Cline architecture cleanup settles.** Do not create a second native-runtime branch now.

### 6. How should plan mode work?

**Prepend a planning instruction to the user prompt text.** Pi has no built-in plan-mode flag.

### 7. What about pi auto-discovering `.pi/` project directories?

This is **desirable** for task sessions. Pi should use project-local skills/extensions/prompts when running in the task worktree.

### 8. Is `--continue` deterministic for resume?

**Yes, for task sessions, provided that:**
- Kanban uses a deterministic per-task `--session-dir`
- task session dirs are cleaned up on permanent delete
- home sessions do not participate in this mechanism

### 9. How should the home sidebar handle persistence?

**Use `--no-session`.** Home sessions are intentionally ephemeral and should not accumulate persistent pi session dirs.

### 10. How should hooks be delivered from the pi extension?

**Use argv-based `kanban hooks notify` calls via `execFile(file, args, ...)`, not shell command strings.**

## Validation checklist for completion

- [x] TypeScript compiles with no errors after all changes
- [x] `pi` is selectable in Settings
- [x] `pi` is selectable in onboarding
- [x] `pi` is detected from inherited `PATH`
- [x] `normalizeAgentId("pi")` returns `"pi"`
- [x] task start launches pi in the task worktree with `-e`, `--session-dir`, and positional prompt
- [x] task session-dir path segments are filesystem-safe
- [ ] board shows activity from pi tool execution
- [ ] task transitions to review when pi finishes
- [x] restore-from-trash continues prior pi task session via `--continue`
- [x] home sidebar can run pi as board-management agent with `--append-system-prompt`
- [x] home sidebar pi sessions use `--no-session`
- [x] task sessions do **not** use `--append-system-prompt`
- [x] task sessions do **not** use raw task IDs directly in `--session-dir`
- [x] deleting a task cleans up its pi session dir best-effort
- [x] card detail view renders terminal panel, not Cline chat panel, for pi
- [x] logs cover pi launch / extension / hook / resume paths
- [x] frontend telemetry `task_created` includes `selected_agent_id: "pi"`
- [ ] tests cover schema, normalization, adapter args, prompt wiring, extension generation, hook metadata, and UI behavior
- [x] docs explain the architecture choice and persistence strategy
- [x] no Cline-specific UI leaks into the pi path

## Suggested follow-up after v1 ships

- [ ] dogfood pi on this repo and record UX gaps
- [ ] evaluate richer assistant-preview extraction from pi message events
- [ ] evaluate capability-based agent routing now that another non-Cline first-class agent exists
- [ ] add binary identity validation (`pi --version` / `pi --help`) to distinguish the coding agent from unrelated `pi` binaries
- [ ] if implementation touched unexpectedly broad surfaces, add a high-signal note to `AGENTS.md` explaining the pi adapter/session-dir/extension strategy
- [ ] evaluate refactoring any remaining hardcoded agent unions to derive from `runtimeAgentIdSchema`
