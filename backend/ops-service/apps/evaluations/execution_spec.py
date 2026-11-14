"""Ops admission adapter for shared, versioned execution specifications."""

from govbiz_evaluation_contracts import execution_spec as _spec


def __getattr__(name):
    return getattr(_spec, name)


def read_release(dataset_id=None):
    from .catalog import contract_context

    with contract_context():
        return _spec.read_release(dataset_id)


if __name__ == "__main__":
    _spec.main()
