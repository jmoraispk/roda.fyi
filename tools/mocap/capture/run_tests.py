# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
"""Run all pure-module asserts: `uv run tools/mocap/capture/run_tests.py`."""
import sys, os, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # import sibling modules

_TESTS = []


def register(fn):
    _TESTS.append(fn)
    return fn


def main():
    # Importing a module runs its `@register`-decorated test defs.
    import geom, segment, align, fuse, retarget  # noqa: F401
    passed = failed = 0
    for fn in _TESTS:
        try:
            fn()
            print(f"  ok    {fn.__module__}.{fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__module__}.{fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
