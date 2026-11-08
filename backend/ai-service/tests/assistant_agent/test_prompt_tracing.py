"""동시 도우미 호출의 지침 해시가 호출별로 분리되고 누출되지 않는다."""

import asyncio
from contextlib import contextmanager
from hashlib import sha256
from uuid import uuid4

import pytest

from app.assistant_agent.tracing import active_prompt_hash, traced_node
from app.assistant_agent.usage import AssistantModelUsage


class TraceCapture:
    def __init__(self):
        self.generations = []

    @contextmanager
    def observation(self, name, **kwargs):
        yield object()

    def start_generation(self, name, *, model, metadata):
        self.generations.append(metadata)
        return object()

    def update(self, observation, **kwargs):
        pass

    def end_generation(self, observation):
        pass


@pytest.mark.anyio
async def test_concurrent_node_calls_attach_only_their_fixed_prompt_hash():
    tracing = TraceCapture()
    callback = AssistantModelUsage(tracing)

    async def operation(state):
        await asyncio.sleep(0)
        await callback.on_chat_model_start({}, [], run_id=uuid4())
        return {}

    first = traced_node(tracing, "assistant.first", operation, prompt="fixed A")
    second = traced_node(tracing, "assistant.second", operation, prompt="fixed B")
    await asyncio.gather(first({}), second({}))
    await callback.on_chat_model_start({}, [], run_id=uuid4())

    assert [item.get("prompt_sha256") for item in tracing.generations] == [
        sha256(b"fixed A").hexdigest(), sha256(b"fixed B").hexdigest(), None,
    ]
    assert active_prompt_hash.get() is None


@pytest.mark.anyio
async def test_failed_node_resets_prompt_context():
    tracing = TraceCapture()

    async def fail(state):
        raise ValueError("failed")

    with pytest.raises(ValueError):
        await traced_node(tracing, "assistant.failed", fail, prompt="fixed")({})
    assert active_prompt_hash.get() is None
