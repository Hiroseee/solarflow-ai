import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("./runner.mjs", import.meta.url), "utf8");
const patched = src.replace(
  'await run(["start","--runtime","native","--ignore-health-check"]);',
  'await run(["start","--runtime","native","--preparation","on-demand","--exclude","realtime,functions,studio,mail,analytics,pooler"]);'
);
writeFileSync(new URL("./runner_patched.mjs", import.meta.url), patched);
await import("./runner_patched.mjs");
