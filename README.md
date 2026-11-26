# paper-worlds

A skill for building **walkable paper dioramas of real places** — printed on a fold-up page, from
real map data. An agent (or a person) gives it a place; it gives back a world you can walk.

Built on [xikhar/papercraft](https://github.com/xikhar/papercraft) (MIT) — the paper look, hinges,
light and lens are theirs. This skill adds the real-geography layer: the OSM/open-data pipeline,
the location contract, the walkable map engine, the QA and deploy flow.

## Proven by two worlds

| world | repo | register |
|---|---|---|
| Paper West Lake · 纸上西湖 | `paper-worlds-demo/westlake` | classical Chinese garden, water-centred, 1:4 |
| Paper Central Park | `paper-worlds-demo/nyc` | modern city grid, buildings and skyline, 1:2 |

Both are live: `paper-westlake.eicp.io` · `paper-nyc.eicp.io`

## Layout

| path | what |
|---|---|
| `SKILL.md` | the skill: the pipeline, the gates, the contracts |
| `engine/` | the location-agnostic kit: `harness.js`, `papercraft/lib`, vendored three.js |
| `scripts/` | the data and art pipeline (download, extract, key, sample) |
| `templates/` | the new-world starter: entry page, scene assembly, world modules |
| `references/` | `FRAMEWORK.md` (the contracts), `WORKFLOW.md` (the full pipeline) |

## Use

Install as a Claude Code skill (symlink or copy into `~/.claude/skills/`), then ask for a place:

> build a paper world of Central Park
> paper 西湖

or use the pipeline directly — read `SKILL.md` and follow the phases.

## Credits

Built on the shoulders of:

- [**xikhar/papercraft**](https://github.com/xikhar/papercraft) (MIT) — the engine: the paper
  look, the print/hinge system, the light and the lens. `engine/` is theirs, kept as shipped.
- [**three.js**](https://threejs.org) (MIT) — the WebGL renderer (`engine/vendor/`).
- **papertrails** (part of xikhar/papercraft, © Shikhar, MIT) — the calico cat of the default
  player: its pose frames ship as `templates/assets/cat-*.png`.
- [**OpenStreetMap contributors**](https://www.openstreetmap.org/copyright) (ODbL) — the geography:
  roads, water, bridges, coastlines and sites of every world.
- **NYC Open Data** (Building Footprints, `5zhs-2jue`) — the Central Park skyline's heights.
- The demo worlds — `paper-worlds-demo/` — which the skill is extracted from and proven by.

## Licence

- `engine/` — [xikhar/papercraft](https://github.com/xikhar/papercraft) (MIT) and three.js (MIT)
- `scripts/`, `templates/`, `references/`, `SKILL.md` — MIT, with attribution appreciated
- The demo worlds are separate repositories; map data © OpenStreetMap contributors (ODbL) and the
  cities' open-data portals, as credited on their pages
