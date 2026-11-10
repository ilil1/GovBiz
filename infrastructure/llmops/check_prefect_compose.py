"""Verify default and LAN Prefect Compose settings without starting services."""

import json
import os
import subprocess
import tempfile
from pathlib import Path


DIRECTORY = Path(__file__).resolve().parent
REQUIRED_VALUES = {
    name: "compose-check-only"
    for name in (
        "POSTGRES_PASSWORD",
        "CLICKHOUSE_PASSWORD",
        "REDIS_PASSWORD",
        "MINIO_PASSWORD",
        "LANGFUSE_SALT",
        "LANGFUSE_ENCRYPTION_KEY",
        "LANGFUSE_NEXTAUTH_SECRET",
        "LANGFUSE_ADMIN_PASSWORD",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "OPS_DB_PASSWORD",
        "OPS_DB_ROOT_PASSWORD",
        "OPS_DJANGO_SECRET_KEY",
    )
}


def render(env_file, overrides):
    environment = {
        name: os.environ[name]
        for name in ("PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP")
        if name in os.environ
    }
    environment.update(REQUIRED_VALUES)
    environment.update(overrides)
    result = subprocess.run(
        [
            "docker", "compose", "--env-file", str(env_file),
            "-f", str(DIRECTORY / "compose.yaml"),
            "-f", str(DIRECTORY / "compose.ops.yaml"),
            "--profile", "evaluation", "config", "--format", "json",
        ],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("Docker Compose configuration rendering failed")
    return json.loads(result.stdout)["services"]


def check(services, host, ui_url):
    prefect = services["prefect"]
    assert len(prefect["ports"]) == 1, "Expected one Prefect published port"
    port = prefect["ports"][0]
    assert port["host_ip"] == host and str(port["published"]) == "14200"
    assert port["target"] == 4200
    assert prefect["environment"]["PREFECT_UI_API_URL"] == f"{ui_url}/api"
    assert services["ops-service"]["environment"]["PREFECT_UI_URL"] == ui_url
    for name in ("ops-service", "evaluation-runner"):
        assert services[name]["environment"]["PREFECT_API_URL"] == "http://prefect:4200/api"


def main():
    with tempfile.TemporaryDirectory() as directory:
        env_file = Path(directory) / "empty.env"
        env_file.write_text("", encoding="utf-8")
        check(render(env_file, {}), "127.0.0.1", "http://localhost:14200")
        host = "192.0.2.34"
        ui_url = f"http://{host}:14200"
        check(render(env_file, {
            "PREFECT_BIND_ADDRESS": host,
            "PREFECT_UI_API_URL": f"{ui_url}/api",
            "PREFECT_UI_URL": ui_url,
        }), host, ui_url)
    print("PASS: default and LAN Prefect Compose configuration")


if __name__ == "__main__":
    main()
