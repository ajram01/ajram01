// Builds stats.svg from public GitHub activity over the last 12 months.
// Run by .github/workflows/stats.yml, or locally: GH_TOKEN=... node scripts/stats.mjs
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOGIN = process.env.GH_LOGIN || "ajram01";
const TOKEN = process.env.GH_TOKEN;

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount } }
      }
      commitContributionsByRepository(maxRepositories: 100) {
        repository {
          nameWithOwner
          isPrivate
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      pullRequestContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
      }
    }
  }
}`;

export function summarize(user) {
  const c = user.contributionsCollection;
  const weeks = c.contributionCalendar.weeks.map((w) =>
    w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0)
  );
  const commitRepos = c.commitContributionsByRepository
    .map((x) => x.repository)
    .filter((r) => !r.isPrivate);
  const prRepos = c.pullRequestContributionsByRepository
    .map((x) => x.repository)
    .filter((r) => !r.isPrivate);
  const repoNames = new Set([...commitRepos, ...prRepos].map((r) => r.nameWithOwner));

  const seen = new Set();
  const bytes = new Map();
  for (const r of commitRepos) {
    if (seen.has(r.nameWithOwner)) continue;
    seen.add(r.nameWithOwner);
    for (const e of r.languages.edges) {
      const cur = bytes.get(e.node.name) || { size: 0, color: e.node.color };
      cur.size += e.size;
      bytes.set(e.node.name, cur);
    }
  }
  const totalBytes = [...bytes.values()].reduce((s, l) => s + l.size, 0);
  const langs = [...bytes.entries()]
    .map(([name, v]) => ({
      name,
      color: v.color || "#8b949e",
      pct: totalBytes ? (v.size / totalBytes) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct);

  return {
    total: c.contributionCalendar.totalContributions,
    weeks,
    prs: c.totalPullRequestContributions,
    repos: repoNames.size,
    langs,
  };
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function render(s, date = new Date().toISOString().slice(0, 10)) {
  const blue = "#2f81f7";
  const muted = "#768390";
  const line = "#8b949e";

  // Weekly activity bars
  const x0 = 290, x1 = 806, baseY = 100, maxH = 60;
  const n = Math.max(1, s.weeks.length);
  const step = (x1 - x0) / n;
  const barW = Math.max(2, step - 3);
  const max = Math.max(1, ...s.weeks);
  const bars = s.weeks
    .map((v, i) => {
      const h = v === 0 ? 1.5 : Math.max(3, (v / max) * maxH);
      return `<rect x="${(x0 + i * step).toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${blue}" fill-opacity="${v === 0 ? 0.25 : 0.9}"/>`;
    })
    .join("");

  // Language bar: top three plus everything else
  const top = s.langs.slice(0, 3);
  const rest = 100 - top.reduce((a, l) => a + l.pct, 0);
  const segs = [...top, ...(rest > 1 ? [{ name: "Other", color: line, pct: rest }] : [])];
  const bx = 360, bw = 446;
  let cx = bx;
  const segRects = segs
    .map((l) => {
      const w = (bw * l.pct) / 100;
      const r = `<rect x="${cx.toFixed(1)}" y="132" width="${w.toFixed(1)}" height="8" fill="${esc(l.color)}"/>`;
      cx += w;
      return r;
    })
    .join("");
  const legend = top
    .map(
      (l, i) =>
        `<tspan fill="${esc(l.color)}"${i ? ' dx="16"' : ""}>\u25CF</tspan><tspan dx="4">${esc(l.name)} ${Math.round(l.pct)}%</tspan>`
    )
    .join("");

  const summary = `${s.total} contributions in the last year, ${s.prs} pull requests opened, ${s.repos} repos contributed to. Languages: ${top.map((l) => `${l.name} ${Math.round(l.pct)}%`).join(", ")}.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 830 190" width="830" height="190" role="img" aria-labelledby="t d">
  <title id="t">GitHub activity over the last 12 months</title>
  <desc id="d">${esc(summary)}</desc>
  <defs><clipPath id="lb"><rect x="${bx}" y="132" width="${bw}" height="8" rx="4"/></clipPath></defs>
  <g font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">
    <line x1="24" y1="14" x2="806" y2="14" stroke="${line}" stroke-opacity="0.45"/>
    <line x1="24" y1="178" x2="806" y2="178" stroke="${line}" stroke-opacity="0.45"/>

    <text x="24" y="68" font-size="44" font-weight="700" fill="${blue}">${s.total}</text>
    <text x="24" y="90" font-size="13" fill="${muted}">contributions in the last year</text>
    <text x="806" y="32" font-size="10" fill="${muted}" text-anchor="end">weekly activity, updated ${esc(date)}</text>
    ${bars}

    <text x="24" y="152" font-size="30" font-weight="700" fill="${blue}">${s.prs}</text>
    <text x="24" y="170" font-size="12" fill="${muted}">pull requests opened</text>
    <text x="190" y="152" font-size="30" font-weight="700" fill="${blue}">${s.repos}</text>
    <text x="190" y="170" font-size="12" fill="${muted}">repos contributed to</text>

    <text x="${bx}" y="124" font-size="11" fill="${muted}">languages in those repositories</text>
    <g clip-path="url(#lb)">${segRects}</g>
    <text x="${bx}" y="160" font-size="12" fill="${muted}">${legend}</text>
  </g>
</svg>
`;
}

async function main() {
  if (!TOKEN) throw new Error("GH_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  writeFileSync("stats.svg", render(summarize(json.data.user)));
  console.log("stats.svg written");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
