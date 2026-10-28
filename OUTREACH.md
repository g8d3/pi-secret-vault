# Outreach: pi-web creator (jmfederico)

Goal: let the pi-web maintainer know this package exists as the separable,
auditable way to handle secrets (vs today's built-in host tools).

## Suggested issue on jmfederico/pi-web

Title: `Secret handling as a separable Pi package (extension + web plugin)`

Body:

> Hi — I built `pi-secret-vault` (repo link) because secret handling today
> is baked into the session host instead of shippable separately.
>
> It is a Pi package with two halves, the way your plugin docs recommend
> ("extension for agent behavior, web plugin for web UI, shipped together"):
>
> - Pi extension: 9 tools (`vault_drop/list/show/forget/exec/export/import/rename/audit`), local `0600` storage + append-only audit log, passphrase-encrypted (scrypt + AES-256-GCM) export bundles for machine-to-machine moves. stdlib + typebox only, no network.
> - (Roadmap) PI WEB plugin: transcript-private drop/reveal dialog + server entry on the same vault format.
>
> Two questions:
>
> 1. Is there interest in a supported host capability for "private value entry" (secret typed into a dialog, stored server-side, never entering the model transcript), so the extension half doesn't have to route values through chat?
> 2. Any objection to the `vault_*` tool naming, or preference to align with the built-in `secret_*` names?
>
> Happy to adapt the package to whatever contract you prefer. Test: `npm install && node test/smoke.mjs`.

Post with (needs nothing but `gh` auth, already present):

```bash
gh issue create --repo jmfederico/pi-web \
  --title "Secret handling as a separable Pi package (extension + web plugin)" \
  --body-file OUTREACH.md
```

Note: post from the user's own call — opening an issue in someone else's repo
is a public act under their name, so confirm before running.
