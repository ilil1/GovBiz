"""Compatibility entry point; implementation: govbiz_evaluation.reports.reporting."""

import sys
from importlib import import_module

if __name__ == "__main__":
    from pathlib import Path
    from runpy import run_path

    run_path(str(Path(__file__).resolve().parent / "reports" / "reporting.py"), run_name="__main__")
else:
    sys.modules[__name__] = import_module("govbiz_evaluation.reports.reporting")
