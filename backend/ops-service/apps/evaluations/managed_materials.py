"""Compatibility import for the shared evaluation contract."""

import sys

from govbiz_evaluation_contracts import managed_materials as _contract

sys.modules[__name__] = _contract
