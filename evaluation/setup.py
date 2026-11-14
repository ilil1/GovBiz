"""평가 모듈만 wheel에 포함한다. 데이터·과거 기록은 별도 승인 목록으로 묶는다."""
from setuptools import setup
from setuptools.command.build_py import build_py


class EvaluationBuild(build_py):
    def find_package_modules(self, package, package_dir):
        return [
            module for module in super().find_package_modules(package, package_dir)
            if not module[1].startswith("test_") and module[1] != "conftest"
        ]


setup(cmdclass={"build_py": EvaluationBuild})
