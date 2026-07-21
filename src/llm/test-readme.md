# LLM test suite

This document covers the test suite for `src/llm/` (the Wayfare chat agent).
The LLM client is a thin wrapper around **OpenAI-compatible chat-completion APIs** —
it supports `openai`, `openrouter`, and `minimax`. Anthropic's native `/v1/messages`
endpoint was removed; any provider that does not speak the OpenAI chat-completions
shape is rejected by `runLlmAgent` with `unsupported LLM provider`.

## Files

| File | Purpose |
|------|---------|
| `src/llm/client.ts` | `runLlmAgent` + provider routing, tool loop, SSE parsing, retry policy |
| `src/llm/key-vault.ts` | BYOK vault + `resolveCredentials` env-var priority |
| `src/llm/client.test.ts` | 26 type/contract tests for `LlmStreamEvent`, `ChatMessage`, `LlmChatResponse`, event ordering |
| `src/llm/client.runtime.test.ts` | 28 runtime tests that exercise `runLlmAgent` with mocked `fetch` and a mocked tool registry |

Total: **54 tests** across 2 files.

## What is tested

### `client.test.ts` — contract / type validation
- All 8 `LlmStreamEvent` variants (`status`, `assistant_delta`, `tool_call`, `tool_result`, `assistant_message`, `run_triggered`, `error`, `done`).
- Status event supports every provider.
- `assistant_message` carries content + toolCalls.
- `tool_result` covers both success (`ok:true`) and error (`ok:false`) shapes.
- `run_triggered` carries `runId`, `task`, `crawlRunId`, `publicAccessToken`.
- `ChatMessage` covers system / user / assistant (with tool_calls) / tool roles.
- `LlmChatResponse` covers both `source:"env"` and `source:"none"` shapes.
- Event ordering for simple conversation, tool-call conversation, crawl trigger, error, multi-turn.

### `client.runtime.test.ts` — runtime behavior
- **Credentials:** missing `apiKey` → `error:"no_credentials"` event + `source:"none"`; happy path emits `status(thinking)`.
- **`maxIterations` clamp:** values <1 or >10 are clamped to [1,10].
- **Tool loop:** executes tool calls, emits `tool_call` + `tool_result` + final `assistant_message`; unknown tool marked failed; invalid arguments marked failed; handler exceptions captured; `run_triggered` emitted when tool result has `runId`; bad JSON args fall back to string.
- **Provider routing:** openrouter → `openrouter.ai/api/v1/chat/completions`, minimax → `api.minimax.io/v1/chat/completions`, openai → `api.openai.com/v1/chat/completions`; `anthropic` (and any other non-OpenAI-compat provider) rejected without making any HTTP request.
- **Retry policy:** transient HTTP 429 retries 3× then succeeds; non-transient 400 does NOT retry; transport errors retry 3× then return error.
- **SSE parsing:** `data:`-prefixed chunks accepted; empty body / no-choices returns upstream error.
- **Default model:** openai→`gpt-4o-mini`, openrouter→`openai/gpt-4o-mini`, minimax→`MiniMax-M3`; explicit `req.model` wins.
- **Request body:** system prompt injected, `tool_choice:"auto"`, `stream:false`, tools array present.
- **`key-vault resolveCredentials`:** priority OPENAI > OPENROUTER > MINIMAX, MINIMAX default model `MiniMax-M3`, `source:"none"` when none configured.

## Coverage

Run from repo root:

```bash
npx vitest run --coverage src/llm/
```

Latest measured coverage (`src/llm/` only):

```
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|------------------------
client.ts     |   93.95 |    78.89 |     100 |   94.81 | 265-269,363-368,391,412,415-417
key-vault.ts  |   19.71 |    28.12 |   11.11 |   18.03 | 25-105,110
```

`client.ts` is covered at ~95% lines / 100% functions. The few uncovered lines are:
- `runLlmAgent` success path tool-execution when a tool is unknown and the loop continues (the `parsed.data` reassignment of `message.tool_calls` for non-OpenAI tool_call shapes).
- The final `throw new Error("LLM returned no choices")` branch (rare empty-choices case).
- The retry loop's `fetch` exception path on Anthropic-style providers (no longer reachable).

`key-vault.ts` is intentionally under-covered by this suite because its core operations (`setUserKey`, `getUserKey`, `deleteUserKey`) encrypt/decrypt files on disk via `data/byok-vault.json` and require filesystem fixtures. The `resolveCredentials` env-priority logic (the only function used at runtime by `runLlmAgent`) is fully covered.

## How to run

From repo root:

```bash
# Run all tests
npm test

# Run only LLM tests
npx vitest run src/llm/

# Watch mode (re-runs on file change)
npx vitest src/llm/

# With coverage report (text + html + json in ./coverage/)
npm run test:coverage

# Coverage scoped to LLM only
npx vitest run --coverage src/llm/

# Typecheck
npm run typecheck
```

### Run a single file
```bash
npx vitest run src/llm/client.test.ts
npx vitest run src/llm/client.runtime.test.ts
```

### Run a single test by name
```bash
npx vitest run src/llm/ -t "rejects anthropic"
npx vitest run src/llm/ -t "retry policy"
npx vitest run src/llm/ -t "emits run_triggered"
```

## How the tests are structured

`client.runtime.test.ts` mocks two layers:

1. **`../trigger/tools/registry`** — supplies one fake tool (`echo_tool`) whose handler is a `vi.fn()` so tests can swap success/error/`runId` shapes per case.
2. **Global `fetch`** — `vi.stubGlobal("fetch", mock)` is set per test and cleared with `vi.unstubAllGlobals()`. The mock returns `Response` objects shaped like OpenAI chat-completions JSON (or SSE, or empty bodies, or 4xx/5xx) to drive the retry/parse branches.

`key-vault` tests mutate `process.env.*` in `beforeEach`/`afterEach` so they are order-independent and do not leak state between cases.

## Adding new tests

When you add a runtime branch to `runLlmAgent`, prefer extending `client.runtime.test.ts`:
1. If you add a new event type, add a `LlmStreamEvent` variant assertion in `client.test.ts`.
2. If you add a new provider, add a routing + default-model test, and ensure the unsupported-provider rejection in `runLlmAgent` allows it.
3. Keep using `vi.stubGlobal("fetch", ...)` for any new HTTP path; do NOT add real network calls to the suite.
