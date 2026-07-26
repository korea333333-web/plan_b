import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target =
  process.env.VERCEL === "1" || process.env.BUILD_TARGET === "vercel"
    ? "next"
    : "vinext";
const cli =
  target === "next"
    ? "../node_modules/next/dist/bin/next"
    : "../node_modules/vinext/dist/cli.js";
const executable = fileURLToPath(
  new URL(cli, import.meta.url),
);
const result = spawnSync(process.execPath, [executable, "build"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
