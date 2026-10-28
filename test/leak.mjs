// Leak regression test: exit 0 iff the secret never appears in any tool result
// and scrub markers do. Run: node test/leak.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_SECRET_VAULT_DIR = mkdtempSync(join(tmpdir(), "vault-leak-"));

const { default: factory } = await import("../extension/vault.js");
const tools = {};
factory({ registerTool: (t) => (tools[t.name] = t) });

let failures = 0;
const assert = (cond, label) => {
  console.log(cond ? "PASS" : "FAIL", "-", label);
  if (!cond) failures++;
};
const textOf = (r) => r.content.map((c) => c.text).join("");

const SECRET = `leakcheck-${Date.now()}-zz9`;
await tools.vault_store.execute("t", { name: "L", value: SECRET });

const exec = await tools.vault_exec.execute("t", {
  name: "L",
  command: ["sh", "-c", "echo out-$L; echo err-$L >&2"],
});
const execText = textOf(exec);
assert(!execText.includes(SECRET), "exec result contains no secret (stdout+stderr)");
assert(execText.includes("***"), "exec result carries scrub markers");

const list = textOf(await tools.vault_list.execute("t", {}));
assert(!list.includes(SECRET), "list contains no secret");
assert(list.includes("L"), "list names the secret");

const audit = textOf(await tools.vault_audit.execute("t", { limit: 10 }));
assert(!audit.includes(SECRET), "audit contains no secret");

const bundle = join(process.env.PI_SECRET_VAULT_DIR, "b.json");
await tools.vault_export.execute("t", { file: bundle, passphrase: "pw" });
const bad = await tools.vault_import.execute("t", { file: bundle, passphrase: "wrong" });
assert(bad.isError === true, "wrong passphrase rejected");

console.log(failures ? `LEAK-TEST FAILED (${failures})` : "LEAK-TEST OK");
process.exit(failures ? 1 : 0);
