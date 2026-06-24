# AI CLI Token-Usage Parsers — Implementation Spec

Reference for building one parser per AI coding CLI. Each parser reads local
session/log files and emits a normalized `UsageRecord[]`. Goal: input / cached /
output tokens + model, per chat/session, per day.

**Ground truth for paths & field names:** `ccusage` (ccusage.com/guide),
`tokscale` (github.com/junhoyeo/tokscale), `codeburn`
(github.com/getagentseal/codeburn), and `cass`
(github.com/Dicklesworthstone/coding_agent_session_search). When a field name
is marked `VERIFY`, sample one real file and dump keys before trusting it —
schemas drift.

---

## 0. Status legend

| Mark | Meaning |
|---|---|
| ✅ DONE | Already implemented in your repo — only re-check field names on schema drift. |
| 🟢 HIGH | Field names confirmed from source/docs. Implement directly. |
| 🟡 VERIFY | Path confirmed, token field names not pinned. Sample a file first. |
| 🔴 LOW | No reliable structured token usage. Best-effort regex or model-only. |
| ⛔ NONE | No local session file with tokens. Skip or document why. |

---

## 1. Normalized output schema (target for every parser)

```ts
// parser-helpers.ts
export interface UsageRecord {
  source: string;              // 'claude' | 'codex' | 'gemini' | ...
  sessionId: string;
  project?: string;            // repo / cwd if derivable
  timestamp: string;           // ISO-8601 of the turn
  model: string;               // RAW model id (normalize later for pricing)
  inputTokens: number;         // UNCACHED input only — see §2 warning
  cacheReadTokens: number;     // cache hit (read)
  cacheCreationTokens: number; // cache write / creation
  outputTokens: number;        // includes reasoning unless reasoningTokens set
  reasoningTokens?: number;    // if reported separately
  costUsd?: number;            // only if the source stores it reliably
  dedupeKey: string;           // see each parser's dedup rule
}
```

Aggregation (`index.ts`): dedupe by `dedupeKey`, group by `(source, model, day)`,
sum the four token fields.

---

## 2. ⚠️ The one bug that will wreck your numbers: input semantics differ

Two incompatible conventions for what `input` means:

- **Claude / OpenClaw / Pi / Kimi / Hermes / OpenCode** — `input_tokens`
  **EXCLUDES** cache. Total prompt = `input + cache_read + cache_creation`.
- **OpenAI Codex / Gemini / Qwen** — reported `input`/`prompt` tokens **INCLUDE**
  cached. You **must subtract** cached before storing `inputTokens`, or you
  double-count (and mis-price, since cache read is ~10% the rate).

Normalize every source to *uncached input* in `UsageRecord.inputTokens`. Put the
cache portion in `cacheReadTokens`. This is the #1 cause of inflated reports.

Other universal gotchas:
- **Dedup is mandatory.** Fork/resume/branch writes duplicate messages (Claude
  by `uuid`, Codex by cumulative cross-check). No dedup → inflated totals.
- **Cumulative vs per-turn.** Codex (and Mistral Vibe) report running totals;
  diff consecutive events. Most others are per-message; sum directly.
- **Reasoning tokens are billed as output** for OpenAI-family models. Track
  separately only for display; fold into output for cost.

---

## 3. Discovery (`discovery.ts`)

Env var → default path → format. Each env var may be a comma-separated list of
roots (current + archives); split and scan all.

| source | env override | default path | format |
|---|---|---|---|
| claude | `CLAUDE_CONFIG_DIR` | `~/.claude/` (also `~/.config/claude/`) | JSONL |
| codex | `CODEX_HOME` | `~/.codex/` | JSONL |
| gemini | `GEMINI_DATA_DIR` | `~/.gemini/tmp/` | JSONL |
| qwen | `QWEN_DATA_DIR` | `~/.qwen/` | JSON (Gemini fork) |
| opencode | `OPENCODE_DATA_DIR` | `~/.local/share/opencode/` | JSON |
| kilo | `KILO_DATA_DIR` | `~/.local/share/kilo/` | JSON (OpenCode fork) |
| copilot | `COPILOT_OTEL_FILE_EXPORTER_PATH` | `~/.copilot/session-state/` (+ `~/.copilot/otel/`) | JSONL |
| amp | `AMP_DATA_DIR` | `~/.local/share/amp/` | JSONL (VERIFY) |
| droid | `DROID_SESSIONS_DIR` | `~/.factory/sessions/` | JSONL |
| codebuff | `CODEBUFF_DATA_DIR` | `~/.config/manicode/` | JSON per chat |
| pi-agent | `PI_AGENT_DIR` / `PI_CODING_AGENT_DIR` | `~/.pi/agent/sessions/` | JSONL |
| kimi | `KIMI_DATA_DIR` | `~/.kimi/` | JSONL (`wire.jsonl`) |
| openclaw | `OPENCLAW_DIR` | `~/.openclaw/` (+ `~/.clawdbot`, `~/.moltbot`, `~/.moldbot`) | JSONL |
| hermes | `HERMES_HOME` | `~/.hermes/state.db` | SQLite |
| goose | `GOOSE_PATH_ROOT` | `~/.local/share/goose/sessions/sessions.db` | SQLite (≥1.10) |
| crush | — | `<project>/.crush/` (run `crush dirs data`) | SQLite |
| cursor | — | VS Code `state.vscdb` (workspace + global storage) | SQLite |
| aider | — | `<repo>/.aider.chat.history.md` | Markdown |
| specstory | — | `<repo>/.specstory/history/*.md` | Markdown |
| grok | — | (unreliable — see §9) | — |

Windows: `~` → `%USERPROFILE%`; XDG dirs → `%APPDATA%`/`%LOCALAPPDATA%`.

---

## 4. JSONL — per-assistant `usage` family

### claude.ts ✅ DONE
- **Path:** `~/.claude/projects/<url-encoded-abs-cwd>/<session-uuid>.jsonl`
- **Lines:** one JSON/line. Use `type === "assistant"`.
- **Model:** `message.model`
- **Tokens:** `message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}` — `input_tokens` already excludes cache.
- **Dedup:** by `uuid`.
- **Note:** also recognize non-Anthropic models here (GLM/Zai, Kimi, Qwen-Max, MiniMax, kat-coder) when run through Claude Code via custom base URL — same schema, different `model` string. See §10.

### codex.ts ✅ DONE
- **Path:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/archived_sessions/` (active copy wins on collision).
- **Tokens:** events where `payload.type === "token_count"`; `info.total_token_usage.{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}` are **CUMULATIVE** → store delta vs previous event.
- **Input fix:** `cached_input_tokens ⊂ input_tokens` → `inputTokens = input_tokens - cached_input_tokens`, `cacheReadTokens = cached_input_tokens`.
- **Model:** latest `turn_context.model`. Skip turns with no `turn_context` (some Sep-2025 builds).
- **Dedup:** cumulative cross-check (the delta itself prevents double count); also dedupe fork branches.
- **Note:** only sessions after the 2025-09-06 build emit `token_count`.

### openclaw.ts 🟢 HIGH
- **Path:** `~/.openclaw/agents/*.jsonl` (+ legacy `.clawdbot`/`.moltbot`/`.moldbot`).
- **Tokens:** assistant message `usage` blocks (Anthropic-style: input/output/cache_read/cache_creation).
- **Model:** `modelId` or `message.model`.
- **Dedup:** message id.

### pi-agent.ts 🟢 HIGH
- **Path:** `~/.pi/agent/sessions/<sanitized-cwd>/*.jsonl` (OMP twin: `~/.omp/agent/sessions/...`).
- **Format:** typed events — `session_start`, `message`, `model_change`, `thinking_level_change`.
- **Tokens:** each assistant message → `{input, output, cacheRead, cacheWrite}`.
- **Model:** track via `model_change` events / message model.
- **Dedup:** by `responseId`.

### kimi.ts 🟢 HIGH
- **Path:** `~/.kimi/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` (+ subagents under `agents/agent-*/wire.jsonl`). `workDirKey = wd_<slug>_<sha256[:12]>`. (Official Moonshot build may use `~/.kimi-code/` via `KIMI_CODE_HOME` — check both.)
- **Tokens:** `StatusUpdate` messages with non-zero `token_usage`: map `input_other → inputTokens`, `input_cache_read → cacheReadTokens`, `input_cache_creation → cacheCreationTokens`, `output → outputTokens`.
- **Model:** from session state / StatusUpdate.
- **Dedup:** session + message id. Include subagents.

### copilot.ts 🟢 HIGH
- **Primary:** `~/.copilot/session-state/{sessionId}/events.jsonl` → per-model token metrics live in `session.shutdown` events.
- **Fallback (OTel):** `~/.copilot/otel/*.jsonl` — only exists if user set `COPILOT_OTEL_ENABLED=true`, `COPILOT_OTEL_EXPORTER_TYPE=file`, `COPILOT_OTEL_FILE_EXPORTER_PATH=...` **before** the session.
- **Model:** per-record; supports Claude + GPT families.
- **Note:** sessions run without either source produce nothing.

---

## 5. Gemini-fork family (input INCLUDES cached)

### gemini.ts 🟢 HIGH
- **Path:** `~/.gemini/tmp/<project_hash>/chats/*.jsonl` (auto-saved). Checkpoints: `~/.gemini/tmp/<project_hash>/checkpoints`; shadow git: `~/.gemini/history/<project_hash>`.
- **Tokens:** per-turn metadata `{input/prompt, output/candidate, cached, thought, tool, total}`.
- **Input fix:** input is inclusive of cached → `inputTokens = input - cached`, `cacheReadTokens = cached`.
- **Model:** per turn.
- **Dedup:** by session id.
- **Note:** `cached` only populated with **API-key auth**, not OAuth.

### qwen.ts 🟢 HIGH — same engine as Gemini
- **Path:** `~/.qwen/tmp/<project_hash>/chats/session-*.json` (single JSON per session, not JSONL).
- Everything else identical to `gemini.ts` (same fork). Reuse the Gemini token logic; just change loader (whole-file JSON, `chats/session-*.json`).

---

## 6. OpenCode family (`cost:0`, recompute from tokens)

### opencode.ts 🟢 HIGH
- **Path:** `~/.local/share/opencode/storage/message/{sessionID}/msg_{messageID}.json`; sessions: `.../storage/session/{projectHash}/{sessionID}.json`.
- **Tokens:** `tokens.{input, output, cache.read, cache.write, reasoning}`.
- **Model:** in message file.
- **Cost:** stored `cost: 0` always → ignore, recompute from tokens via pricing.
- **Dedup:** session + message id. Supports nested subagent sessions.

### kilo.ts 🟢 HIGH — OpenCode-format fork
- **Path:** `~/.local/share/kilo/` (`KILO_DATA_DIR`), same `storage/message|session` layout.
- Reuse `opencode.ts` logic verbatim; only the root differs.
- **Heads-up:** "KiloCode" the VS Code extension (Cline-family) is a *different*
  product storing `ui_messages.json` in VS Code globalStorage — NOT this. This
  parser targets the ccusage "kilo" / OpenCode-format CLI.

---

## 7. SQLite family (use `sqlite-helpers.ts`, open read-only, handle WAL)

### hermes.ts 🟢 HIGH — cleanest of the lot
- **Path:** `~/.hermes/state.db` (WAL).
- **Per-session totals** in `sessions` table — already aggregated:
  `model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd, started_at, source, title`.
- **Per-message** (if you want turn granularity): `messages.token_count`.
- **Dedup:** session `id` (totals are pre-summed; do NOT also sum messages).
- Ignore leftover legacy `~/.hermes/sessions/*.jsonl` (no longer written).

```sql
SELECT id, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens,
       estimated_cost_usd, started_at
FROM sessions WHERE model IS NOT NULL;
```

### goose.ts 🟢 HIGH
- **Path:** `~/.local/share/goose/sessions/sessions.db` (Win: `%APPDATA%\Block\goose\data\sessions\sessions.db`). Pre-1.10: per-session `.jsonl` under `~/.local/share/goose/sessions/` — keep a fallback loader.
- **Per-session:** model from `model_config_json`, provider from `provider_name`, accumulated input/output totals per session; reasoning if column populated.
- **Dedup:** session id.

### crush.ts 🟡 VERIFY
- **Path:** per-project `.crush/` directory holding a SQLite DB (run `crush dirs data` to resolve; default dir name `.crush`).
- **Format:** conversation history in SQLite; messages table carries token columns. **Sample the schema** (`.tables`, `PRAGMA table_info(messages)`) — column names not pinned here.
- **Dedup:** message id.

### cursor.ts 🟡 VERIFY
- **Path:** Cursor's `state.vscdb` (SQLite) under VS Code-style workspace storage + global storage.
- **Tokens:** read from the local SQLite DB. Schema **drifts often** — guard with try/catch and version checks.
- **Model:** "Auto" mode hides the real model → fall back to Sonnet-pricing estimate and label it `auto (sonnet est.)`.
- **Dedup:** conversation + timestamp.
- **Note:** no per-tool-call logging in Cursor.

---

## 8. Per-chat JSON

### codebuff.ts 🟢 HIGH (credits, not tokens)
- **Path:** `~/.config/manicode/projects/<project>/chats/<chatId>/chat-messages.json` (also scan `manicode-dev`, `manicode-staging`).
- **Tokens:** try `metadata.usage`, then `metadata.codebuff.usage`, then run-state fallback `...runState.sessionState.mainAgentState.messageHistory[*].providerOptions`. Walk history in **reverse** so partial newer entries don't shadow earlier ones that hold real counts.
- **Cost:** Codebuff bills in **credits** — when no token-level data, record `msg.credits` and approximate `$0.01/credit`.
- **Timestamp:** message ts → chat-id dir name → file mtime.
- **Dedup:** chat folder + message id.

### droid.ts 🟡 VERIFY (Factory)
- **Path:** `~/.factory/sessions/` — JSONL files organized by workspace slug.
- **Tokens/model:** assistant `usage` block per turn — **sample a file** for exact keys.
- **Dedup:** message id.

### amp.ts 🟡 VERIFY
- **Path:** `~/.local/share/amp/` (`AMP_DATA_DIR`).
- **Format/fields:** confirm against a real session before trusting. Detailed input/output/cache read-write tracking is reported supported.

---

## 9. Markdown / unreliable

### aider.ts 🔴 LOW
- **Files (in repo root / git root):** `.aider.chat.history.md` (markdown transcript), `.aider.input.history`, optional `.aider.llm.history` (raw LLM I/O, only if `--llm-history-file` set).
- **No structured tokens.** Aider prints lines like `Tokens: 12k sent, 1.8k received. Cost: $0.04` into `.aider.chat.history.md` → best-effort regex extraction. Model from `Model: <name>` header lines.
- Treat as low-confidence / opt-in. Don't let it pollute precise totals.

### specstory.ts 🔴 LOW
- **Path:** `<repo>/.specstory/history/*.md` — SpecStory exports Cursor/Cline/etc chats as markdown transcripts.
- **No reliable token counts.** Use for model detection (frontmatter/headers) and search only. Skip for cost unless you parse embedded usage lines, which are inconsistent.

### grok.ts 🔴 LOW
- ccusage explicitly **does not support** Grok CLI — local files lack reliable token usage. tokscale reads "Grok Build" via a different path. Treat as best-effort/skip; document the gap rather than emitting bad numbers.

---

## 10. ⛔ Ollama — no session file to parse

Ollama's CLI REPL does **not** persist conversations to disk. `~/.ollama/history`
stores only typed REPL input lines (prompt history), not messages or tokens.
Token counts (`prompt_eval_count` = input, `eval_count` = output) are returned
**in API responses at runtime only** (`/api/generate`, `/api/chat`), never logged
to a session file.

Implication: you cannot retroactively compute Ollama usage from local files. To
track it you must either (a) proxy/log the API responses yourself, or (b) read a
front-end's own store (e.g. Open WebUI's DB, ollama-ui's browser localStorage).
Document Ollama as unsupported-by-design; don't ship a fake parser.

---

## 11. Providers running *through* another CLI (no own parser)

Some "providers" aren't separate CLIs — they ride Claude Code (or OpenCode) via a
custom base URL and show up in that CLI's session files with a different `model`
string. Handle them in the host parser + pricing layer, not a new file:

- **z.ai / GLM** (`glm-4.6`, `glm-5`, `glm-5-turbo`), **Kimi (Moonshot)**,
  **Qwen-Max (DashScope)**, **MiniMax**, **kat-coder (Kwaipilot)** → appear in
  `~/.claude/projects/.../*.jsonl` when run with `ANTHROPIC_BASE_URL` pointed at
  that provider. `claude.ts` already captures them; just make sure pricing
  resolves these model names (see `better-ccusage` for the Zai/GLM price table).

---

## 12. Pricing (`index.ts` / pricing module)

- Resolve `model` → per-token rates via the **LiteLLM** pricing dataset (cache it
  ~1h on disk; OpenRouter fallback for new models). This is what ccusage/tokscale
  do.
- Cost = `input*in_rate + cache_read*cacheread_rate + cache_creation*cachewrite_rate + output*out_rate`. Don't approximate cache as 10% unless a rate is missing — use real per-token cache rates when present.
- Resolve aliases before lookup (e.g. `gemini-3-pro-high → gemini-3-pro-preview`, `grok-code → xai/grok-code-fast-1`). Trust source-stored `costUsd` only for Hermes (`estimated_cost_usd`); recompute everywhere else.

---

## 13. Shared helpers

**`parser-helpers.ts`**
- `readJsonl(path)` — streaming line reader, tolerant of a truncated last line.
- `Deduper` — `Set<string>` keyed by `dedupeKey`.
- `cumulativeDelta(prev, cur, fields)` — for Codex/Vibe.
- `normalizeInput(record)` — enforce §2 (subtract cached from input for OpenAI/Gemini-family).
- `normalizeModelName(model)` — alias resolution.
- `encodeProjectPath(cwd)` / `decode...` — Claude/Gemini URL-encoded dir ↔ cwd.

**`sqlite-helpers.ts`** (hermes, goose, crush, cursor)
- `openReadOnly(path)` — `mode=ro`, set `busy_timeout`, handle `-wal`/`-shm` present.
- `tableInfo(db, table)` — introspect columns (drift-proofing for crush/cursor).
- `safeQuery(db, sql)` — wrap in try/catch; return `[]` on schema mismatch.

---

## 14. Implementation order (highest signal first)

1. ✅ claude, codex (re-check only)
2. 🟢 gemini, qwen, opencode, kilo (two reusable engines cover four sources)
3. 🟢 pi-agent, openclaw, kimi, copilot
4. 🟢 hermes, goose, codebuff
5. 🟡 crush, cursor, droid, amp (sample a real file, pin schema, then code)
6. 🔴 aider, specstory, grok (best-effort, clearly flagged low-confidence)
7. ⛔ ollama — document as unsupported, no parser

---

## 15. Other CLIs you may want later (need new files)

Confirmed to log local token metadata but not in your current list:
- **Cline / Roo Code / KiloCode (VS Code ext)** — `ui_messages.json` per task dir
  (`globalStorage/saoudrizwan.claude-dev` + VS Code/Insiders/VSCodium roots);
  token counts in `type:"say", say:"api_req_started"` entries, model in
  `api_conversation_history.json`.
- **Mistral Vibe** — `~/.vibe/logs/session/<id>/meta.json` (cumulative totals) +
  `messages.jsonl`. Cumulative → one record per session.
- **Zed** (Agent Panel threads — SQLite + Zstd), **Antigravity** (RPC sync, not
  files), **Trae** (account API), **Kiro**, **Warp/Oz**, **Mux**, **Junie**,
  **Open Interpreter** (Codex-format rollouts), **Amazon Q CLI**.

These are documented in tokscale/cass/codeburn if/when you expand coverage.

---

### Sources to verify against
ccusage.com/guide · github.com/junhoyeo/tokscale · github.com/getagentseal/codeburn ·
github.com/Dicklesworthstone/coding_agent_session_search · per-tool docs (Hermes,
Kimi Code, Gemini CLI, OpenCode, Goose, Crush).
