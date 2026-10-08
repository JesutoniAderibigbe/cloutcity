"""Self-test of the Blender pipeline, run inside the pinned Blender:

    PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1 blender -b --factory-startup -noaudio \
        --python-exit-code 1 -P scripts/blender/selftest.py -- --id brooklyn-bridge

1. Two builds of the same landmark in one process write byte-identical GLBs (same sha256).
2. A PIN naming another Blender stops the build with exit code 3.

Outputs go to the gitignored .cache/blender/selftest. Exits 1 if a check fails.
"""

import os
import sys

# Blender's Python ignores PYTHONDONTWRITEBYTECODE unless --python-use-system-env is given.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build  # noqa: E402
from cclib import env  # noqa: E402


def main():
    env.require_pinned_version()
    rest = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    landmark_id = rest[rest.index("--id") + 1] if "--id" in rest else "brooklyn-bridge"
    root = env.repo_path(".cache", "blender", "selftest")
    failures = []

    first = build.run(landmark_id, os.path.join(root, "1"))
    second = build.run(landmark_id, os.path.join(root, "2"))
    for a, b in zip(first["levels"], second["levels"]):
        if a["glb"]["sha256"] != b["glb"]["sha256"]:
            failures.append("L%d differs between two builds" % a["level"])

    try:
        env.require_pinned_version(pin=("0.0.0", "000000000000"))
        failures.append("a wrong PIN did not stop the build")
    except SystemExit as stop:
        if stop.code != env.EXIT_WRONG_VERSION:
            failures.append("a wrong PIN exited %r, not %d" % (stop.code, env.EXIT_WRONG_VERSION))

    for failure in failures:
        sys.stderr.write("selftest: %s\n" % failure)
    sys.stdout.write("selftest: %s\n" % ("FAILED" if failures else "ok (double build identical, wrong PIN exits 3)"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
