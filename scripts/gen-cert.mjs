/**
 * Generates a self-signed TLS certificate for local development.
 *
 * Usage:
 *   npm run gen-cert                  — writes to ./certs/
 *   npm run gen-cert -- --out <dir>   — writes to a custom directory
 *
 * Outputs:
 *   <outDir>/cert.pem  — TLS certificate (pass as MCP_TUNNEL_TLS_CERT)
 *   <outDir>/key.pem   — Private key    (pass as MCP_TUNNEL_TLS_KEY)
 *
 * The certificate covers: localhost, 127.0.0.1, ::1
 * Validity: 365 days  |  Key: RSA 2048-bit
 *
 * NOTE: Browsers will show an "untrusted certificate" warning on first visit.
 * Click "Advanced → Proceed". MCP clients (Claude, Inspector) do not care.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve, join, relative } from "path";
import { createRequire } from "module";

// selfsigned is a CJS module — use createRequire for a clean import from ESM.
const require = createRequire(import.meta.url);
const selfsigned = require("selfsigned");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = resolve(process.cwd(), outIdx !== -1 ? (args[outIdx + 1] ?? "certs") : "certs");

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

console.log();
console.log("🔐  Generating self-signed certificate for localhost…");

const pems = selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    {
        days: 365,
        keySize: 2048,
        extensions: [
            {
                name: "subjectAltName",
                altNames: [
                    { type: 2, value: "localhost" },
                    { type: 7, ip: "127.0.0.1" },
                    { type: 7, ip: "::1" },
                ],
            },
        ],
    },
);

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });

const certPath = join(outDir, "cert.pem");
const keyPath  = join(outDir, "key.pem");

writeFileSync(certPath, pems.cert,    "utf8");
writeFileSync(keyPath,  pems.private, "utf8");

// ---------------------------------------------------------------------------
// Auto-update .gitignore (default output dir only)
// ---------------------------------------------------------------------------

const gitignorePath = resolve(process.cwd(), ".gitignore");
const relOut = relative(process.cwd(), outDir).replace(/\\/g, "/");
const entry  = relOut.endsWith("/") ? relOut : relOut + "/";

if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf8");
    if (!content.split("\n").some((l) => l.trim() === entry || l.trim() === entry.slice(0, -1))) {
        const separator = content.endsWith("\n") ? "" : "\n";
        writeFileSync(gitignorePath, `${content}${separator}# Local TLS certificates\n${entry}\n`, "utf8");
        console.log(`   Added "${entry}" to .gitignore`);
    }
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

const hr = "─".repeat(64);

console.log(`✅  Certificate written:`);
console.log(`     cert  →  ${certPath}`);
console.log(`     key   →  ${keyPath}`);
console.log();
console.log(`   Start the tunnel with TLS (PowerShell):`);
console.log(hr);
console.log(`   $env:MCP_TUNNEL_TLS_CERT="${certPath}"`);
console.log(`   $env:MCP_TUNNEL_TLS_KEY="${keyPath}"`);
console.log(`   npm run server:start`);
console.log(hr);
console.log();
console.log(`⚠️   Browsers will warn "certificate not trusted" on first visit.`);
console.log(`    Click "Advanced → Proceed to localhost". MCP clients skip this check.`);
console.log();
