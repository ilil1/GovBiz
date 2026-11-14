"""Compatibility import for the shared AI runtime implementation."""

import sys
from importlib import import_module

# Preserve module globals and class identity for existing consumers and patches.
sys.modules[__name__] = import_module("govbiz_ai_runtime.support_program_evidence.service")
