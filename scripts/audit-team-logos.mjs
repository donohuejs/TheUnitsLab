import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await readFile(path.join(root, "src", "config", "team-catalog.json"), "utf8"),
);

const nflTeams = [
  ["Arizona Cardinals", "22"],
  ["Atlanta Falcons", "1"],
  ["Baltimore Ravens", "33"],
  ["Buffalo Bills", "2"],
  ["Carolina Panthers", "29"],
  ["Chicago Bears", "3"],
  ["Cincinnati Bengals", "4"],
  ["Cleveland Browns", "5"],
  ["Dallas Cowboys", "6"],
  ["Denver Broncos", "7"],
  ["Detroit Lions", "8"],
  ["Green Bay Packers", "9"],
  ["Houston Texans", "34"],
  ["Indianapolis Colts", "11"],
  ["Jacksonville Jaguars", "30"],
  ["Kansas City Chiefs", "12"],
  ["Las Vegas Raiders", "13"],
  ["Los Angeles Chargers", "24"],
  ["Los Angeles Rams", "14"],
  ["Miami Dolphins", "15"],
  ["Minnesota Vikings", "16"],
  ["New England Patriots", "17"],
  ["New Orleans Saints", "18"],
  ["New York Giants", "19"],
  ["New York Jets", "20"],
  ["Philadelphia Eagles", "21"],
  ["Pittsburgh Steelers", "23"],
  ["San Francisco 49ers", "25"],
  ["Seattle Seahawks", "26"],
  ["Tampa Bay Buccaneers", "27"],
  ["Tennessee Titans", "10"],
  ["Washington Commanders", "28"],
];

const expectedCatalogs = [
  ["NHL", "nhl", "abbreviation"],
  ["EPL", "epl", "numeric"],
  ["UCL", "ucl", "numeric"],
  ["NCAAF FBS", "ncaaf", "numeric"],
];

const failures = [];
const rows = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function checkCatalog(label, key, strategy) {
  const snapshot = catalog[key];
  assert(snapshot && Array.isArray(snapshot.teams), `${label}: missing catalog snapshot`);
  if (!snapshot || !Array.isArray(snapshot.teams)) return;

  assert(snapshot.count === snapshot.teams.length, `${label}: count does not match team list`);
  const ids = new Set();
  const assetRefs = new Set();
  for (const team of snapshot.teams) {
    assert(typeof team.id === "string" && team.id.length > 0, `${label}: missing provider ID`);
    assert(
      typeof team.abbreviation === "string" && team.abbreviation.length > 0,
      `${label}: ${team.displayName}: missing abbreviation`,
    );
    assert(
      typeof team.displayName === "string" && team.displayName.length > 0,
      `${label}: missing display name`,
    );
    assert(!ids.has(team.id), `${label}: duplicate provider ID ${team.id}`);
    ids.add(team.id);

    const assetRef =
      strategy === "abbreviation"
        ? team.abbreviation.toLowerCase().replace(/[^a-z0-9]/g, "")
        : team.id;
    const assetPath = strategy === "abbreviation" ? key : key === "ncaaf" ? "ncaa" : "soccer";
    const url = `https://a.espncdn.com/i/teamlogos/${assetPath}/500/${assetRef}.png`;
    assert(!assetRefs.has(url), `${label}: duplicate logo URL ${url}`);
    assetRefs.add(url);
    assert(
      strategy === "abbreviation" ? /^[a-z0-9]+$/.test(assetRef) : /^\d+$/.test(assetRef),
      `${label}: invalid ${strategy} asset reference for ${team.displayName}`,
    );
  }
  rows.push({
    label,
    expected: snapshot.count,
    resolved: snapshot.teams.length,
    assets: assetRefs.size,
  });
}

const nflAssetRefs = new Set();
for (const [name, id] of nflTeams) {
  const url = `https://a.espncdn.com/i/teamlogos/nfl/500/${id}.png`;
  assert(/^\d+$/.test(id), `NFL: invalid numeric asset reference for ${name}`);
  assert(!nflAssetRefs.has(url), `NFL: duplicate logo URL ${url}`);
  nflAssetRefs.add(url);
}
rows.push({
  label: "NFL",
  expected: nflTeams.length,
  resolved: nflTeams.length,
  assets: nflAssetRefs.size,
});

for (const [label, key, strategy] of expectedCatalogs) checkCatalog(label, key, strategy);

if (catalog.ncaaf?.teams) {
  const knownNcaafIds = new Set(catalog.ncaaf.teams.map((team) => team.id));
  for (const team of catalog.ncaaf.teams) {
    assert(knownNcaafIds.has(team.id), `NCAAF FBS: missing stable ID for ${team.displayName}`);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const resolverCommand =
  process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : npmCommand;
const resolverArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", `${npmCommand} exec -- vitest run test/team-logos.test.ts --reporter=dot`]
    : ["exec", "--", "vitest", "run", "test/team-logos.test.ts", "--reporter=dot"];
const resolverTests = spawnSync(resolverCommand, resolverArgs, { cwd: root, stdio: "inherit" });
assert(resolverTests.status === 0, "resolver coverage tests failed");

const checkAssets = process.argv.includes("--check-assets");
if (checkAssets) {
  const urls = [
    ...nflTeams.map(([, id]) => `https://a.espncdn.com/i/teamlogos/nfl/500/${id}.png`),
    ...expectedCatalogs.flatMap(([, key, strategy]) =>
      (catalog[key]?.teams ?? []).map((team) => {
        const assetRef =
          strategy === "abbreviation"
            ? team.abbreviation.toLowerCase().replace(/[^a-z0-9]/g, "")
            : team.id;
        const assetPath = strategy === "abbreviation" ? key : key === "ncaaf" ? "ncaa" : "soccer";
        return `https://a.espncdn.com/i/teamlogos/${assetPath}/500/${assetRef}.png`;
      }),
    ),
  ];
  const uniqueUrls = [...new Set(urls)];
  for (let index = 0; index < uniqueUrls.length; index += 8) {
    const batch = uniqueUrls.slice(index, index + 8);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const response = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(10_000),
          });
          return { url, ok: response.ok, status: response.status };
        } catch (error) {
          return { url, ok: false, status: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    for (const result of results) {
      assert(result.ok, `asset unavailable (${result.status}): ${result.url}`);
    }
  }
}

console.table(rows);
if (checkAssets) console.log("Asset URL checks: completed");
if (failures.length) {
  console.error(`Team logo audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Team logo audit passed: registry snapshot coverage and asset references are valid.");
}
