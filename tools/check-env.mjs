// Runs before install. Refuses package managers other than pnpm and Node versions the
// Copilot SDK cannot load, with instructions instead of a cryptic failure later.
const ua = process.env.npm_config_user_agent ?? "";
const [major, minor] = process.versions.node.split(".").map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
const problems = [];
if (!ua.startsWith("pnpm/")) {
  problems.push(
    `This repo must be installed with pnpm 10 (detected: ${ua || "unknown"}). npm and yarn ignore pnpm-lock.yaml and cannot resolve workspace:* links.` +
      "\n  Fix:  npm install -g pnpm@10.34.5   then   pnpm install --frozen-lockfile",
  );
}
if (!nodeOk) {
  problems.push(`Node ${process.versions.node} is too old for @github/copilot-sdk (needs 20.19+ or 22.12+; 24 is what this repo is developed on).`);
}
if (problems.length) {
  console.error("\n[tandem] install refused:\n- " + problems.join("\n- ") + '\n\nSee README.md, section "If the install or build fails".\n');
  process.exit(1);
}
