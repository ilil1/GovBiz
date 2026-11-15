"""이전 import 및 CLI 경로 호환; 구현은 pipelines.flows.evaluation.clients."""

import sys
from importlib import import_module

if __name__ == "__main__":
    from runpy import run_module

    run_module("pipelines.flows.evaluation.clients", run_name="__main__")
else:
    sys.modules[__name__] = import_module("pipelines.flows.evaluation.clients")
