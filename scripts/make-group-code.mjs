#!/usr/bin/env node
import { webcrypto as crypto } from "node:crypto";

const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 Crockford-compatible symbols (5 bits each)

export function generateCode() {
  const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => A[b % 32]).join("");
  return [part(), part(), part(), part()].join("-"); // 80 bits (4 * 4 * 5 bits)
}

export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export async function pbkdf2(secret, saltB64) {
  const cleanSecret = String(secret || '');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cleanSecret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function createGroupCodeRecord(groupId) {
  const gid = String(groupId || '').trim().toLowerCase();
  const code = generateCode();
  const codeSalt = generateSalt();
  const codeHash = await pbkdf2(code, codeSalt);

  const kvData = {
    codeSalt,
    codeHash,
    codeVer: 1,
    staff: [],
    slots: []
  };

  return { gid, code, kvData };
}

const isCli = process.argv[1] && (
  process.argv[1].endsWith('make-group-code.mjs') ||
  process.argv[1].endsWith('make-group-code')
);

if (isCli) {
  const rawGroupId = process.argv[2];
  if (!rawGroupId) {
    console.error("Usage: node scripts/make-group-code.mjs <groupId>");
    process.exit(1);
  }

  const { gid, code, kvData } = await createGroupCodeRecord(rawGroupId);
  const jsonStr = JSON.stringify(kvData);

  console.log(`\n============================================================`);
  console.log(`  ГЕНЕРАТОР КОДА ГРУППЫ: ${gid}`);
  console.log(`============================================================\n`);
  console.log(`КОД (передать лично): ${code}\n`);
  console.log(`JSON для KV (ключ: g:${gid}):`);
  console.log(JSON.stringify(kvData, null, 2));
  console.log(`\nКоманда wrangler:`);
  console.log(`wrangler kv:key put --binding=APP_DATA "g:${gid}" '${jsonStr}'\n`);
}
