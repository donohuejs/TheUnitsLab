import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", ".temp", "coverage", "node_modules"]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
  /(?:THE_ODDS_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET)\s*=\s*(?!["']?(?:$|your_|replace_|placeholder|test_))/i,
];

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await filesIn(path.join(directory, entry.name))));
      }
    } else if (!entry.name.startsWith(".env.") || entry.name === ".env.local") {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

const findings = [];
for (const file of await filesIn(root)) {
  if (path.basename(file) === ".env.example" || file.endsWith("package-lock.json")) continue;
  const content = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      findings.push(path.relative(root, file));
      break;
    }
  }
}

if (findings.length) {
  console.error(`Potential secret material found in: ${findings.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(
    "Secret scan passed: no private-key, JWT-like, or populated server-secret assignments found.",
  );
}
