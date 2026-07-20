import { resolveCredentials } from "/Users/dorian/unemployed/hackathron/src/llm/key-vault.ts";
import { config } from "dotenv";
config({ path: "/Users/dorian/unemployed/hackathron/.env" });

const c = resolveCredentials();
console.log("provider:", c.provider);
console.log("source:", c.source);
console.log("model:", c.model);
console.log("key prefix:", c.apiKey.slice(0, 10) + "...");
console.log("env MINIMAX_API_KEY set:", process.env.MINIMAX_API_KEY ? "yes" : "no");
console.log("env OPENAI_API_KEY set:", process.env.OPENAI_API_KEY ? "yes" : "no");

console.log("All env keys containing KEY or SECRET:");
for (const k of Object.keys(process.env)) {
  if (k.includes("KEY") || k.includes("SECRET") || k.includes("MINIMAX")) {
    console.log(`  ${k}=${process.env[k]?.slice(0, 20)}...`);
  }
}
