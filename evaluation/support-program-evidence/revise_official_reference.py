"""기존 공식 공고·과거 답변을 보존하며 H01의 AI 참조 조건만 새 자료 버전으로 보완한다."""

import argparse
import json
from pathlib import Path

from govbiz_evaluation.official_snapshot import digest, encoded, require, validate_fixture, validate_projection, registered_capture

from govbiz_evaluation_contracts.resources import evidence_root

HERE = evidence_root()
PREVIOUS_ID = "official-answer-20260907-v2"
DATASET_ID = "official-answer-20260907-v3"
SOURCE = HERE / "runs" / PREVIOUS_ID
OUTPUT = HERE / "runs" / DATASET_ID
PREVIOUS_FIXTURE = "a88dc262cbe99acfc8dfa62168c702d8eae9b0c741150c3d482904df75b275df"
PREVIOUS_CAPTURE = "1ca19a920508f05edfec2c493781a3170bc3fa4f044027b0b3452a1a2c73e1e4"
SOURCE_QUOTE = "☞ 중소ㆍ중견 제조기업의 자발적인 스마트공장 구축 및 고도화를 유도하기 위해 스마트화 수준진단을 지원"


def build(source=None):
    source = SOURCE if source is None else Path(source)
    fixture_raw, capture_raw = ((source / name).read_bytes() for name in ("fixture.json", "capture.json"))
    require(digest(fixture_raw) == PREVIOUS_FIXTURE, "previous official fixture differs")
    require(digest(capture_raw) == PREVIOUS_CAPTURE, "previous historical capture differs")
    fixture, capture = json.loads(fixture_raw), json.loads(capture_raw)
    validate_fixture(fixture)
    validate_projection(fixture, capture)
    case = next(item for item in fixture["cases"] if item["id"] == "H01")
    document = next(item for item in fixture["documents"] if item["id"] == case["documentId"])
    require(SOURCE_QUOTE in document["source"]["content"], "reference correction source is missing")
    case["referenceFacts"].insert(0, "지원 대상의 기업 규모·업종 범위는 중소·중견 제조기업")
    case["forbiddenClaims"].append("대기업을 포함한 모든 규모의 기업이 신청 가능")
    fixture["referenceRevision"] = {
        "previousDatasetId": PREVIOUS_ID,
        "previousFixtureSha256": PREVIOUS_FIXTURE,
        "previousCaptureSha256": PREVIOUS_CAPTURE,
        "changedCaseIds": ["H01"],
        "reason": "H01 참조 조건에 누락된 중소·중견 제조기업 범위를 보완했습니다. 사람 검토가 필요합니다.",
        "sourceQuote": SOURCE_QUOTE,
    }
    # Questions, supplied chunks, recorded answers, model and usage remain historical.
    # Only the association with the new reference fixture and transformation provenance change.
    capture["fixtureSha256"] = digest(encoded(fixture))
    capture["runnerSha256"] = digest(Path(__file__).read_bytes())
    capture["provenance"]["previousProjectionSha256"] = PREVIOUS_CAPTURE
    return fixture, capture


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="새 자료 v3만 생성; 기존 v2와 검토 기록은 유지")
    parser.add_argument("--repository", type=Path, required=True)
    args = parser.parse_args(argv)
    evidence = evidence_root(args.repository.resolve())
    output = evidence / "runs" / DATASET_ID
    fixture, capture = build(evidence / "runs" / PREVIOUS_ID)
    if args.write:
        output.mkdir(parents=True, exist_ok=True)
        (output / "fixture.json").write_bytes(encoded(fixture))
        (output / "capture.json").write_bytes(encoded(capture))
    else:
        require((output / "fixture.json").read_bytes() == encoded(fixture), "revised official projection differs")
        capture = registered_capture(output / "capture.json", capture, args.repository)
    from govbiz_evaluation.evaluate import load_fixture, report
    report_raw = encoded(report(*load_fixture(output / "fixture.json"), capture))
    if args.write:
        (output / "report.json").write_bytes(report_raw)
    else:
        require((output / "report.json").read_bytes() == report_raw, "revised report differs")
    print("Official reference v3: H01 corrected; 6 historical answers preserved; new calls 0; human review required")


if __name__ == "__main__":
    main()
