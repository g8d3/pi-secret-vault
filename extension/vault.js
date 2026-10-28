// pi-secret-vault — local secret vault as a Pi extension.
//
// Storage: one JSON file (mode 0600) under:
//   $PI_SECRET_VAULT_DIR, or ~/.pi-secret-vault/
//   vault.json  { version: 1, secrets: { NAME: { value, createdAt, updatedAt, uses } } }
//   audit.jsonl append-only: { t, op, name }
//
// Export/import: passphrase-encrypted bundle (scrypt + AES-256-GCM, stdlib only).
//
// Privacy model: tools run in-process; a revealed value passes through the
// model transcript. vault_list never returns values. Prefer vault_exec over
// vault_show whenever the value only needs to be *used*, not seen.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function vaultDir() {
  return process.env.PI_SECRET_VAULT_DIR || join(homedir(), ".pi-secret-vault");
}
function vaultFile() {
  return join(vaultDir(), "vault.json");
}
function auditFile() {
  return join(vaultDir(), "audit.jsonl");
}
function ensureDir() {
  mkdirSync(vaultDir(), { recursive: true, mode: 0o700 });
  try {
    chmodSync(vaultDir(), 0o700);
  } catch {}
}
function load() {
  ensureDir();
  if (!existsSync(vaultFile())) return { version: 1, secrets: {} };
  return JSON.parse(readFileSync(vaultFile(), "utf8"));
}
function save(vault) {
  ensureDir();
  writeFileSync(vaultFile(), JSON.stringify(vault, null, 2), { mode: 0o600 });
  try {
    chmodSync(vaultFile(), 0o600);
  } catch {}
}
function audit(op, name, extra) {
  try {
    appendFileSync(auditFile(), JSON.stringify({ t: new Date().toISOString(), op, name, ...(extra || {}) }) + "\n");
  } catch {}
}
function checkName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(`Invalid secret name ${JSON.stringify(name)}: use env-style CAPS_OR_lowercase names.`);
  }
}
function ok(text, details) {
  return { content: [{ type: "text", text }], details };
}
function err(text) {
  return { content: [{ type: "text", text }], isError: true };
}
function meta(entry) {
  return { createdAt: entry.createdAt, updatedAt: entry.updatedAt, uses: entry.uses };
}

// --- encrypted export bundle (v1) ---
function encryptBundle(secrets, passphrase) {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return {
    v: 1,
    algo: "scrypt+aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
function decryptBundle(bundle, passphrase) {
  if (!bundle || bundle.v !== 1) throw new Error("Unsupported bundle version.");
  const key = scryptSync(passphrase, Buffer.from(bundle.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(bundle.data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

const NameParam = (description) => Type.String({ description });

export default function secretVaultExtension(pi) {
  pi.registerTool({
    name: "vault_drop",
    label: "Vault store",
    description: "Store (or overwrite) a secret under an env-style NAME. Never values in promptSnippet.",
    parameters: Type.Object({
      name: NameParam("Env-style secret name, e.g. API_KEY"),
      value: Type.String({ description: "The secret value to store" }),
    }),
    async execute(_id, params) {
      try {
        checkName(params.name);
        const vault = load();
        const now = new Date().toISOString();
        const prev = vault.secrets[params.name];
        vault.secrets[params.name] = {
          value: params.value,
          createdAt: prev ? prev.createdAt : now,
          updatedAt: now,
          uses: prev ? prev.uses : 0,
        };
        save(vault);
        audit(prev ? "overwrite" : "drop", params.name);
        return ok(`Stored ${params.name} (${prev ? "overwritten" : "new"}).`, { name: params.name });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_list",
    label: "Vault list",
    description: "List secret NAMES with metadata (created/updated/uses). Never returns values.",
    parameters: Type.Object({}),
    async execute() {
      const vault = load();
      const names = Object.keys(vault.secrets).sort();
      if (!names.length) return ok("Vault is empty.", { count: 0 });
      const lines = names.map((n) => `- ${n} ${JSON.stringify(meta(vault.secrets[n]))}`);
      return ok(`Secrets (${names.length}):\n${lines.join("\n")}`, { count: names.length, names });
    },
  });

  pi.registerTool({
    name: "vault_show",
    label: "Vault reveal",
    description: "Reveal a secret VALUE. Audit-logged. Prefer vault_exec when the value only needs to be used, not seen.",
    parameters: Type.Object({ name: NameParam("Secret name to reveal") }),
    async execute(_id, params) {
      try {
        checkName(params.name);
        const vault = load();
        const entry = vault.secrets[params.name];
        if (!entry) return err(`No secret named ${params.name}.`);
        audit("show", params.name);
        return ok(entry.value, { name: params.name });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_forget",
    label: "Vault delete",
    description: "Permanently delete a secret.",
    parameters: Type.Object({ name: NameParam("Secret name to delete") }),
    async execute(_id, params) {
      try {
        checkName(params.name);
        const vault = load();
        if (!vault.secrets[params.name]) return err(`No secret named ${params.name}.`);
        delete vault.secrets[params.name];
        save(vault);
        audit("forget", params.name);
        return ok(`Deleted ${params.name}.`, { name: params.name });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_exec",
    label: "Vault exec",
    description: "Run a command with the secret injected as an env var. Stdout/stderr come back with the value scrubbed. The value never appears in the result.",
    parameters: Type.Object({
      name: NameParam("Secret name to inject"),
      var: Type.Optional(Type.String({ description: "Env var name (default: the secret name)" })),
      command: Type.Array(Type.String(), { description: "Command and args, e.g. [\"./publish.sh\"]" }),
      cwd: Type.Optional(Type.String({ description: "Working directory" })),
    }),
    async execute(_id, params) {
      try {
        checkName(params.name);
        const vault = load();
        const entry = vault.secrets[params.name];
        if (!entry) return err(`No secret named ${params.name}.`);
        if (!Array.isArray(params.command) || !params.command.length) return err("command must be a non-empty array.");
        const varName = params.var || params.name;
        const scrub = (s) => String(s).split(entry.value).join("***");
        let res, code;
        try {
          res = await execFileAsync(params.command[0], params.command.slice(1), {
            cwd: params.cwd,
            env: { ...process.env, [varName]: entry.value },
            maxBuffer: 4 * 1024 * 1024,
          });
          code = 0;
        } catch (e) {
          res = e;
          code = e.code ?? null;
        }
        entry.uses += 1;
        vault.secrets[params.name] = entry;
        save(vault);
        audit("exec", params.name, { cmd: params.command[0], code });
        const out = scrub((res.stdout || "") + (res.stderr ? "\n[stderr]\n" + res.stderr : ""));
        return ok(`exit=${code ?? "?"} ${varName}=***\n${out}`.slice(0, 20000), { name: params.name, code });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_export",
    label: "Vault export",
    description: "Export ALL secrets to a passphrase-encrypted bundle file. Returns the file path, never values.",
    parameters: Type.Object({
      file: Type.String({ description: "Destination bundle path" }),
      passphrase: Type.String({ description: "Passphrase protecting the bundle (not stored)" }),
    }),
    async execute(_id, params) {
      try {
        const vault = load();
        const bundle = encryptBundle(vault.secrets, params.passphrase);
        mkdirSync(dirname(params.file), { recursive: true });
        writeFileSync(params.file, JSON.stringify(bundle, null, 2), { mode: 0o600 });
        try {
          chmodSync(params.file, 0o600);
        } catch {}
        audit("export", "*", { file: params.file, count: Object.keys(vault.secrets).length });
        return ok(`Exported ${Object.keys(vault.secrets).length} secrets to ${params.file} (encrypted).`, {
          file: params.file,
          count: Object.keys(vault.secrets).length,
        });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_import",
    label: "Vault import",
    description: "Import secrets from a passphrase-encrypted bundle. Existing names are kept unless overwrite is true.",
    parameters: Type.Object({
      file: Type.String({ description: "Bundle path" }),
      passphrase: Type.String({ description: "Bundle passphrase (not stored)" }),
      overwrite: Type.Optional(Type.Boolean({ description: "Overwrite existing names (default false)" })),
    }),
    async execute(_id, params) {
      try {
        const bundle = JSON.parse(readFileSync(params.file, "utf8"));
        const incoming = decryptBundle(bundle, params.passphrase);
        const vault = load();
        let added = 0;
        let skipped = 0;
        for (const [name, entry] of Object.entries(incoming)) {
          try {
            checkName(name);
          } catch {
            skipped++;
            continue;
          }
          if (vault.secrets[name] && !params.overwrite) {
            skipped++;
            continue;
          }
          vault.secrets[name] = entry;
          added++;
        }
        save(vault);
        audit("import", "*", { file: params.file, added, skipped });
        return ok(`Imported ${added} secrets from ${params.file} (${skipped} skipped).`, { added, skipped });
      } catch (e) {
        return err(`Import failed: ${e.message}`);
      }
    },
  });

  pi.registerTool({
    name: "vault_rename",
    label: "Vault rename",
    description: "Rename a secret, keeping its value and metadata.",
    parameters: Type.Object({
      from: NameParam("Current name"),
      to: NameParam("New name"),
    }),
    async execute(_id, params) {
      try {
        checkName(params.from);
        checkName(params.to);
        const vault = load();
        if (!vault.secrets[params.from]) return err(`No secret named ${params.from}.`);
        if (vault.secrets[params.to]) return err(`${params.to} already exists.`);
        vault.secrets[params.to] = vault.secrets[params.from];
        vault.secrets[params.to].updatedAt = new Date().toISOString();
        delete vault.secrets[params.from];
        save(vault);
        audit("rename", `${params.from}->${params.to}`);
        return ok(`Renamed ${params.from} to ${params.to}.`, { from: params.from, to: params.to });
      } catch (e) {
        return err(e.message);
      }
    },
  });

  pi.registerTool({
    name: "vault_audit",
    label: "Vault audit",
    description: "Show recent vault audit entries (drops, reveals, execs, imports/exports). Never includes values.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max entries (default 20)" })),
    }),
    async execute(_id, params) {
      try {
        if (!existsSync(auditFile())) return ok("No audit entries yet.", { count: 0 });
        const lines = readFileSync(auditFile(), "utf8").trim().split("\n").filter(Boolean);
        const tail = lines.slice(-(params.limit || 20));
        return ok(tail.join("\n") || "No audit entries yet.", { count: tail.length });
      } catch (e) {
        return err(e.message);
      }
    },
  });
}
