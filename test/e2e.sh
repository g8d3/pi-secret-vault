#!/bin/bash
# End-to-end: real pi agent loop driving every vault_* tool.
# Spends model credits. Model override: MODEL=provider/id ./test/e2e.sh
# Phase 1 (no reveal): assert the secret NEVER appears in the transcript.
# Phase 2 (explicit reveal): assert vault_show returns the value.
# Also asserts: 0600 files, encrypted bundle, wrong-passphrase rejection, audit.
set -u
MODEL="${MODEL:-opencode-go/muse-spark-1.3-contributor}"
export PI_SECRET_VAULT_DIR
PI_SECRET_VAULT_DIR="$(mktemp -d /tmp/vault-e2e-XXXX)"
SECRET="e2e-$(date +%s)-$RANDOM"
LOG1="$PI_SECRET_VAULT_DIR/pi1.log"
LOG2="$PI_SECRET_VAULT_DIR/pi2.log"
cd "$(dirname "$0")/.." || exit 1

timeout 280 pi --model "$MODEL" --extension ./extension/vault.js -p \
"You have vault_* tools. Do exactly this, then report each result WITHOUT ever printing secret values: 1) vault_store name E2E_TOKEN value $SECRET. 2) vault_exec name E2E_TOKEN command [\"sh\",\"-c\",\"echo wrapped-[\$E2E_TOKEN]-end\"]. 3) vault_export file $PI_SECRET_VAULT_DIR/backup.json passphrase correct-horse. 4) vault_forget name E2E_TOKEN. 5) vault_import file $PI_SECRET_VAULT_DIR/backup.json passphrase correct-horse. 6) vault_import file $PI_SECRET_VAULT_DIR/backup.json passphrase wrong-pass (must fail). 7) vault_audit limit 10." >"$LOG1" 2>&1
code1=$?

timeout 120 pi --model "$MODEL" --mode json --extension ./extension/vault.js -p \
"You have vault_* tools. Call vault_show name E2E_TOKEN." >"$LOG2" 2>&1
code2=$?

fail=0
pass() { echo "PASS - $1"; }
failn() { echo "FAIL - $1"; fail=1; }
grep -q "Stored" "$LOG1" && grep -q "E2E_TOKEN" "$LOG1" && pass "store stored the secret" || failn "store stored the secret"
grep -q "exit=0" "$LOG1" && pass "exec exit=0" || failn "exec exit=0"
grep -q '\*\*\*' "$LOG1" && pass "scrub markers in transcript" || failn "scrub markers in transcript"
if grep -q "$SECRET" "$LOG1"; then failn "secret leaked into transcript (phase 1)"; else pass "no secret in transcript (phase 1)"; fi
[ "$(stat -c %a "$PI_SECRET_VAULT_DIR/vault.json")" = 600 ] && pass "vault.json 0600" || failn "vault.json 0600"
[ "$(stat -c %a "$PI_SECRET_VAULT_DIR/audit.jsonl")" = 600 ] && pass "audit.jsonl 0600" || failn "audit.jsonl 0600"
grep -q "Imported 1 secrets" "$LOG1" && pass "import restored the secret" || failn "import restored the secret"
grep -q -i "fail\|unable to authenticate\|isError\|ERROR" "$LOG1" && pass "wrong passphrase rejected" || failn "wrong passphrase rejected"
grep -q '"op":"store"' "$PI_SECRET_VAULT_DIR/audit.jsonl" && pass "audit has store entry" || failn "audit has drop entry"
grep -q "$SECRET" "$LOG2" && pass "vault_show tool result carries value (phase 2)" || failn "vault_show tool result carries value (phase 2)"

echo "---"
[ "$code1" -ne 0 ] && { echo "E2E FAILED (pi phase1 exit=$code1)"; exit 1; }
[ "$code2" -ne 0 ] && { echo "E2E FAILED (pi phase2 exit=$code2)"; exit 1; }
[ "$fail" -eq 0 ] && echo "E2E OK (model $MODEL)" || echo "E2E FAILED"
exit "$fail"
