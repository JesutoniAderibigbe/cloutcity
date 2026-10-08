# Blender landmark models (S07c)

NYC landmarks are modelled by committed, reproducible Blender Python scripts (DEC-25). The
models are ours: built from real measurements, never from photos, scans or downloaded models.

## Blender

**Blender 5.2.2 LTS, build hash `d13f752e3b9c`** (pinned in `PIN`). Any other build stops
with exit code 3. Install it from blender.org (or `brew install --cask blender`) and either
put `blender` on `PATH` or set `BLENDER=/path/to/Blender`.

Every run is headless and isolated from user settings:

```sh
PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1 blender -b --factory-startup -noaudio \
  --python-exit-code 1 -P scripts/blender/build.py -- --id <id> --out <dir>
```

`npm run landmarks:blender` does this for you.

## Commands

| Command                                                                                    | What it does                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run landmarks:blender`                                                                | Builds every landmark with a measurements file, packs its levels into `public/landmarks/<id>/lod<n>.glb`, writes `data/landmarks/blender/<id>.lock.json` and the measurements section of SOURCES.md |
| `npm run landmarks:blender -- --id <id>`                                                   | One landmark                                                                                                                                                                                        |
| `npm run landmarks:blender -- --preview`                                                   | Also renders review PNGs into `/previews/landmarks/<id>/` (gitignored)                                                                                                                              |
| `npm run landmarks:blender -- --variant <name> [--caps <low>/<mid>/<high>] [--true-scale]` | An exploratory build (other caps, or the real proportions) into `.cache/blender/<id>/<name>` only; `--preview` puts a `truescale` variant beside the shipped one                                    |
| `npm run landmarks:blender -- --verify`                                                    | Rebuilds and byte-compares with the shipped GLBs                                                                                                                                                    |
| `npm run landmarks:blender -- --selftest`                                                  | In Blender: two builds are byte-identical, and a wrong PIN exits 3                                                                                                                                  |
| `npm run landmarks:check`                                                                  | No Blender: every lock matches its inputs and shipped files, and SOURCES.md is current                                                                                                              |

## Layout

- `build.py`: builds one landmark's four levels of detail, exports and checks them.
- `preview.py`: renders review images from the exported GLBs (EEVEE game views in day and
  golden hour, close views, a far check at 4500 m, a Workbench LOD strip with triangle counts).
- `selftest.py`: the in-Blender reproducibility checks.
- `cclib/`: the shared library (standard library, `bpy` and `bmesh` only; no clock, no network,
  randomness seeded from sha256 of the landmark id):
  `env` (PIN, scene reset, seeded RNG), `inputs` (repository data), `prim` (primitives and the
  Builder), `ops`, `curves` (catenaries, deck profiles, pointed arches), `loft` (sweeps and
  tubes), `paint` (vertex colours, ±3 % value jitter), `shade` (`cc-body`, `cc-windows`), `lod`
  (levels and budgets), `camera_aware` (detail the game camera can see), `export`, `validate`.
- `archetypes/`: reusable model kinds (`suspension.py`).
- `landmarks/<id>.py`: one per landmark, turning its measurements into archetype parameters.
- `run.ts`, `inputs.ts`, `ship.ts`, `sources-md.ts`: the npm entry point, the input digest, the
  runtime packing of each level (one mesh, `_EMISSIVE` lamps, the S04h quantize + meshopt finish)
  and the SOURCES.md section.
- `avatar/<id>.py` (S16a, DEC-28): the avatar attachments (hair pieces, head coverings, facial
  hair, accessories). These belong to `npm run blender:build` (`build.ts`, `run.py`, `lock.json`,
  outputs in `out/`), not to the landmark build: the lock pins only `run.py` and the script, so
  each script carries its own copy of the shared helpers, and they never import `cclib`.
- `vehicles/<id>.py` (S04l): our own vehicles, built the same way by `npm run blender:build`
  (same runner, lock and `out/`, a copy of the avatar scripts' helpers): `bus-ambient`, the
  living city's generic city bus (no livery, logo, route number or transit-agency colours).

## Rules

- Measurements live in `data/landmarks/measurements/<id>.json`: CC0 or public-domain numbers
  only (Wikidata, HAER/HABS, NPS, public-domain texts). Anything else is marked `estimate` or
  `derived` with a note. Thin members record a readability scale (3-5x).
- Colour is vertex colour from the real-material roles in `data/config/theme.json`
  (`scene.landmarks`); at most two materials per level (`cc-body`, `cc-windows`).
- Four levels: tiers use high [L0, L1, L2], mid [L1, L2, L3], low [L2, L3]. Each tier's finest
  level fits its perf.json cap and each level is at most half the one above.
- Shipped levels use the S04h runtime format: one mesh and one primitive (POSITION, flat NORMAL,
  COLOR_0, `_EMISSIVE` for lamps), a placeholder material the runtime replaces with the shared
  model material (no new shader program), meshopt with the vertex codec three r182 decodes. No
  images, animations, cameras or lights.
- Game scale: a measurements file may give `gameScale` (heights and widths drawn larger than
  real so the model reads at the 3-4.5 km game camera; lengths along a bridge axis stay real).
  `--variant truescale --true-scale` builds the real proportions for comparison.
- Commit only the shipped GLBs and the locks. `.cache/blender/` and `/previews/` are ignored.
