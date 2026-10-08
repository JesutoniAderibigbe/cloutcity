"""Levels of detail: four levels, three per quality tier, each at most half the one above.

Tier -> levels (finest first): high [L0, L1, L2], mid [L1, L2, L3], low [L2, L3]. A tier's cap
(perf.json landmarkTrianglesMax, or an over-cap pilot variant) bounds its finest level, and
every level is at most `ratio` (perf.json landmarkLodRatioMax) of the level above it.
"""

TIER_LEVELS = {"high": [0, 1, 2], "mid": [1, 2, 3], "low": [2, 3]}
LEVELS = (0, 1, 2, 3)

#: Densities tried, finest first: the first that fits the budget wins.
DENSITIES = tuple(round(2.0 * (0.92 ** i), 4) for i in range(40))


def finest_tier_cap(level, caps):
    """The cap a level must meet as the finest level of a tier (None if no tier starts with it)."""
    limits = [caps[tier] for tier, levels in TIER_LEVELS.items() if levels[0] == level]
    return min(limits) if limits else None


def budget(level, caps, ratio, above_triangles):
    """The triangle budget of `level` given the triangles of the level above."""
    limits = []
    cap = finest_tier_cap(level, caps)
    if cap is not None:
        limits.append(cap)
    if above_triangles is not None:
        limits.append(int(above_triangles * ratio))
    if not limits:
        raise ValueError("level %d has no budget" % level)
    return min(limits)


def fit(build, budget_triangles):
    """Build at the finest density whose triangle count fits; returns (builder, density)."""
    last = None
    for density in DENSITIES:
        builder = build(density)
        last = builder
        if builder.triangles() <= budget_triangles:
            return builder, density
    raise ValueError(
        "no density fits %d triangles (coarsest built %d)" % (budget_triangles, last.triangles())
    )


def check(triangles, caps, ratio):
    """Assert the built levels against the caps and the step ratio; returns problems."""
    problems = []
    for tier, levels in TIER_LEVELS.items():
        if triangles[levels[0]] > caps[tier]:
            problems.append("%s tier: L%d has %d > %d" % (tier, levels[0], triangles[levels[0]], caps[tier]))
    for level in LEVELS[1:]:
        if triangles[level] > ratio * triangles[level - 1]:
            problems.append(
                "L%d has %d > %.2f x L%d (%d)" % (level, triangles[level], ratio, level - 1, triangles[level - 1])
            )
    return problems
