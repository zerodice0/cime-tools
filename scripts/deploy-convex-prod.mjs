import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function parseEnvFile(path) {
  const entries = {};
  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).replace(/\s+#.*$/, "");
    entries[key] = value;
  }

  return entries;
}

const localEnv = parseEnvFile(".env.local");
const prodDeployKey = localEnv.CONVEX_PROD_DEPLOY_KEY;

if (!prodDeployKey) {
  console.error("CONVEX_PROD_DEPLOY_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

const env = {
  ...process.env,
  CONVEX_DEPLOY_KEY: prodDeployKey,
};

delete env.CONVEX_DEPLOYMENT;
delete env.CONVEX_SELF_HOSTED_URL;

const result = spawnSync("npx", ["convex", "deploy", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
