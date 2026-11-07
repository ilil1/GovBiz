from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from openai import APITimeoutError, OpenAIError

from app.gov_agent.agent import GovAgentSupervisor
from app.gov_agent.models import GovAgentDecision, GovAgentRequest

router = APIRouter(prefix="/internal/v1/gov-agent", tags=["internal"])


def get_supervisor(request: Request) -> GovAgentSupervisor:
    return request.app.state.container.gov_agent_supervisor


@router.post("/decide", response_model=GovAgentDecision)
async def decide(
    payload: GovAgentRequest, supervisor: Annotated[GovAgentSupervisor, Depends(get_supervisor)],
) -> GovAgentDecision:
    try:
        return await supervisor.decide(payload)
    except (APITimeoutError, TimeoutError) as error:
        raise HTTPException(status_code=504, detail="Gov agent decision timed out.") from error
    except (OpenAIError, ValueError) as error:
        raise HTTPException(status_code=503, detail="Gov agent decision is unavailable.") from error
