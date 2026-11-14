"""Compatibility import for the shared evaluation contract."""

import sys

from govbiz_evaluation_contracts import artifact_files as _contract

sys.modules[__name__] = _contract
