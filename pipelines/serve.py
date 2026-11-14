"""Ops가 사용하는 Prefect 평가 Deployment를 등록하고 실행 요청을 기다린다.

저장소 루트에서: uv run --project pipelines --locked python -m pipelines.serve
"""

from prefect.types.entrypoint import EntrypointType

from pipelines.evaluation.flows import evaluate_saved_capture


def main():
    evaluate_saved_capture.serve(name="saved-capture", limit=1, entrypoint_type=EntrypointType.MODULE_PATH)


if __name__ == "__main__":
    main()
