# UI test (pi-web, manual, ~2 min, ~$0.01)

Proves the extension loads and runs inside a real pi-web session
(same resource loader as the CLI, but through the session daemon +
web transcript rendering).

## One-time setup

The extension is already installed at two levels in this checkout:

- `extension/vault.js` — source of truth.
- `.pi/extensions/vault.js` — identical copy, so any pi/pi-web session
  with this repo as its project/workspace loads it automatically.
  (Two copies by pi convention — project extensions must be bare files.
  After editing the source, copy it over: `cp extension/vault.js .pi/extensions/vault.js`.)
- Optional global install: copy `extension/vault.js` (+ `npm install`
  for `typebox`) to `~/.pi/agent/extensions/pi-secret-vault/index.js`
  to have `vault_*` in every session.

## Steps

1. Open pi-web, select project `pi-secret-vault`
   (register it first if needed: projects file or Add Project).
2. Start a new session (any model; the reference run used
   `opencode-go/muse-spark-1.3-contributor`).
3. Send:
   `You have vault_* tools. Do exactly this and report briefly without printing secret values: 1) vault_store name UITEST value ui-7741-web. 2) vault_list. 3) vault_exec name UITEST command ["sh","-c","echo hi-$UITEST-bye"].`
4. Expect: `Stored UITEST (new).`, list shows 1 secret,
   `vault_exec exit=0` with output rendered `hi-***-bye`.

## Reference result

2026-10-28: all three steps green in pi-web, model
`opencode-go/muse-spark-1.3-contributor`, cost $0.0011, vault files
created `0600` under `~/.pi-secret-vault/`.
