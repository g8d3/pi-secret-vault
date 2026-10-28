# pi-secret-vault

Local secret vault as a Pi extension. One plain sentence: your agent stores, uses, and moves secrets without ever pasting them into chats, with every touch audit-logged.

## What it is

A Pi extension (`extension/vault.js`, stdlib + `typebox` only) that registers 11 agent tools. Storage is one JSON file (mode `0600`) under `$PI_SECRET_VAULT_DIR` or `~/.pi-secret-vault/`, plus an append-only `audit.jsonl`. No network, no keys, no framework.

## Tools

| Tool | What it does |
|---|---|
| `vault_drop` | Store (or overwrite) a secret under an env-style NAME |
| `vault_list` | List NAMES + metadata (created/updated/uses). Never values |
| `vault_show` | Reveal one value. Audit-logged — prefer `vault_exec` when the value only needs to be *used* |
| `vault_drop_many` | Store many secrets in one call (all-or-nothing validation) |
| `vault_show_many` | Reveal many values in one call (audit-logged) |
| `vault_forget` | Permanently delete a secret |
| `vault_exec` | Run a command with the secret as an env var; stdout/stderr come back scrubbed (`***`), value never in the result |
| `vault_export` | Export ALL secrets to a passphrase-encrypted bundle (scrypt + AES-256-GCM). Returns the path, never values |
| `vault_import` | Import a bundle. Existing names kept unless `overwrite: true` |
| `vault_rename` | Rename, keeping value + metadata |
| `vault_audit` | Recent audit entries (drops, reveals, execs, imports/exports). Never values |

## Install

Copy `extension/vault.js` (and `package.json` for `typebox`) into your Pi extensions dir, or load directly:

```bash
pi --extension ./extension/vault.js
```

## Privacy model

Tools run in-process with your OS permissions. `vault_list`/`vault_audit` never return values; `vault_exec` scrubs them from output. But a value passed to `vault_show` (or `vault_drop`) travels through the model transcript — same as typing it in chat. The truly transcript-private path (type the secret into a host dialog, never into chat) needs host UI support: tracked as the PI WEB plugin half of this package (see Roadmap). Until then, rule of thumb: **use, don't show** — `vault_exec` over `vault_show`.

## Roadmap

- PI WEB plugin (browser dialog + server entry): private drop/reveal UI that never touches the transcript, talking to this same vault format.
- `vault_expire`: TTL per secret with automatic purge.
- `vault_check`: prove a name exists (for scripts) without revealing or logging a reveal.

## Test (repeatable, three levels)

```bash
npm install
node test/smoke.mjs  # all 9 tools, happy path
node test/leak.mjs    # exit 1 on any secret in list/audit/exec results, wrong-passphrase rejection
./test/e2e.sh         # real pi agent loop (spends model credits, default MODEL=opencode-go/muse-spark-1.3-contributor)
```

`e2e.sh` asserts: drop/list/exec/export/forget/import/rename/show/audit through the agent, `0600` files, encrypted bundle round-trip, wrong-passphrase rejection, and — with a fresh random secret per run — that the value never appears in the no-reveal transcript (phase 1) while `vault_show`'s tool result does carry it (phase 2, `--mode json`).

Known model behavior: Muse Spark refuses to *print* a revealed value into chat even when asked (safety refusal) — `vault_show` works at the tool layer, the model just won't quote it. Prefer `vault_exec` (use, don't show).
