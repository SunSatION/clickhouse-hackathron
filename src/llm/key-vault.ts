import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

import { logger } from "../lib/logger";

const log = logger("src/llm/key-vault.ts");

const VAULT_PATH = join(import.meta.dirname, "..", "..", "data", "byok-vault.json");

interface VaultEntry {
  provider: string;
  apiKey: string;
  model?: string;
  updatedAt: string;
}

interface Vault {
  users: Record<string, VaultEntry>;
}

let cache: Vault | null = null;

function deriveKey(): Buffer {
  const secret = process.env.BYOK_VAULT_SECRET || process.env.TRIGGER_SECRET_KEY || "hackathron-default-secret";
  return scryptSync(secret, "wayfarer-salt", 32);
}

function encrypt(plain: string): string {
  const iv = randomUUID().replace(/-/g, "").slice(0, 16);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv}.${enc.toString("hex")}.${tag.toString("hex")}`;
}

function decrypt(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("malformed vault entry");
  const [iv, enc, tag] = parts;
  if (!iv || !enc || !tag) throw new Error("malformed vault entry");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(enc, "hex")), decipher.final()]);
  return dec.toString("utf8");
}

function loadVault(): Vault {
  if (cache) return cache;
  if (!existsSync(VAULT_PATH)) {
    cache = { users: {} };
    return cache;
  }
  try {
    const raw = readFileSync(VAULT_PATH, "utf8");
    cache = JSON.parse(raw) as Vault;
    if (!cache.users) cache.users = {};
    return cache;
  } catch (err) {
    log.warn("Failed to read vault; starting empty", { error: (err as Error).message });
    cache = { users: {} };
    return cache;
  }
}

function persist(): void {
  if (!cache) return;
  mkdirSync(join(VAULT_PATH, ".."), { recursive: true });
  writeFileSync(VAULT_PATH, JSON.stringify(cache, null, 2));
  try {
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(VAULT_PATH, 0o600);
  } catch { /* best effort */ }
}

export function setUserKey(userId: string, entry: { provider: string; apiKey: string; model?: string }): void {
  const vault = loadVault();
  vault.users[userId] = {
    provider: entry.provider,
    apiKey: encrypt(entry.apiKey),
    model: entry.model,
    updatedAt: new Date().toISOString(),
  };
  persist();
  log.info("BYOK key stored", { userId, provider: entry.provider });
}

export function getUserKey(userId: string): VaultEntry | null {
  const vault = loadVault();
  const entry = vault.users[userId];
  if (!entry) return null;
  try {
    return { ...entry, apiKey: decrypt(entry.apiKey) };
  } catch (err) {
    log.warn("Failed to decrypt vault entry", { userId, error: (err as Error).message });
    return null;
  }
}

export function deleteUserKey(userId: string): boolean {
  const vault = loadVault();
  if (!vault.users[userId]) return false;
  delete vault.users[userId];
  persist();
  return true;
}

export function resolveCredentials(userId?: string): { provider: string; apiKey: string; model?: string; source: "byok" | "env" | "none" } {
  if (userId) {
    log.warn("BYOK is disabled — ignoring stored key for user", { userId });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) return { provider: "openai", apiKey: openaiKey, model: process.env.OPENAI_MODEL, source: "env" };
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL, source: "env" };
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) return { provider: "openrouter", apiKey: openrouterKey, model: process.env.OPENROUTER_MODEL, source: "env" };
  const minimaxKey = process.env.MINIMAX_API_KEY;
  if (minimaxKey) return { provider: "minimax", apiKey: minimaxKey, model: process.env.MINIMAX_MODEL || "MiniMax-Text-01", source: "env" };
  return { provider: "openai", apiKey: "", source: "none" };
}