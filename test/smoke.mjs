// Smoke test: load the extension with a stub ExtensionAPI and exercise every tool.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_SECRET_VAULT_DIR = mkdtempSync(join(tmpdir(), "vault-smoke-"));

const { default: factory } = await import("../extension/vault.js");
const tools = {};
const pi = { registerTool: (t) => (tools[t.name] = t) };
factory(pi);

const names = Object.keys(tools).sort();
console.log("registered:", names.join(","));

const call = async (name, params) => {
  const r = await tools[name].execute("test", params || {});
  const text = r.content.map((c) => c.text).join("");
  console.log(`--- ${name}:`, r.isError ? "ERROR" : "ok", "|", text.slice(0, 120).replace(/\n/g, "\\n"));
  return r;
};

await call("vault_store", { name: "API_KEY", value: "s3cr3t-value-123" });
await call("vault_store", { name: "OTHER", value: "xyz" });
await call("vault_list");
await call("vault_show", { name: "API_KEY" });
await call("vault_exec", { name: "API_KEY", command: ["sh", "-c", "echo token=$API_KEY"] });
await call("vault_rename", { from: "OTHER", to: "SECOND" });
const bundle = join(process.env.PI_SECRET_VAULT_DIR, "backup.json");
await call("vault_export", { file: bundle, passphrase: "correct horse" });
await call("vault_forget", { name: "API_KEY" });
await call("vault_list");
await call("vault_import", { file: bundle, passphrase: "correct horse" });
await call("vault_list");
await call("vault_import", { file: bundle, passphrase: "wrong pass" });
await call("vault_audit", { limit: 30 });
console.log("SMOKE-DONE");
