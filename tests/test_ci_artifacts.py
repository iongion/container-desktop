from support.ci_artifacts import (
    parse_appx_version,
    parse_windows_store_package_version,
    select_windows_artifact,
    windows_artifact_name,
)


def _artifact(artifact_id, name="container-desktop-windows-x64", expired=False, run_id=None):
    return {
        "id": artifact_id,
        "name": name,
        "expired": expired,
        "workflow_run": {"id": run_id if run_id is not None else artifact_id * 10},
    }


class TestSelectWindowsArtifact:
    def test_resolves_explicit_windows_artifact_names(self):
        assert windows_artifact_name("x64") == "container-desktop-windows-x64"
        assert windows_artifact_name("arm64") == "container-desktop-windows-arm"

    def test_picks_newest_non_expired_windows_artifact(self):
        artifacts = [_artifact(1, run_id=100), _artifact(3, run_id=300), _artifact(2, run_id=200)]
        # Highest id wins regardless of list order, so we never depend on API ordering.
        assert select_windows_artifact(artifacts)["workflow_run"]["id"] == 300

    def test_picks_requested_windows_arm_artifact(self):
        artifacts = [
            _artifact(1, name="container-desktop-windows-x64", run_id=100),
            _artifact(2, name="container-desktop-windows-arm", run_id=200),
        ]
        assert select_windows_artifact(artifacts, arch="arm64")["workflow_run"]["id"] == 200

    def test_skips_expired_artifacts(self):
        artifacts = [_artifact(5, expired=True, run_id=500), _artifact(2, run_id=200)]
        assert select_windows_artifact(artifacts)["workflow_run"]["id"] == 200

    def test_ignores_other_platform_artifacts(self):
        artifacts = [_artifact(9, name="container-desktop-linux", run_id=900), _artifact(4, run_id=400)]
        assert select_windows_artifact(artifacts)["workflow_run"]["id"] == 400

    def test_returns_none_when_no_artifacts(self):
        assert select_windows_artifact([]) is None

    def test_returns_none_when_all_expired(self):
        assert select_windows_artifact([_artifact(1, expired=True), _artifact(2, expired=True)]) is None


class TestParseAppxVersion:
    def test_parses_x64_filename(self):
        assert parse_appx_version("container-desktop-x64-5.3.11.appx") == "5.3.11"

    def test_parses_from_full_path(self):
        assert parse_appx_version("/tmp/dl/container-desktop-x64-5.3.13.appx") == "5.3.13"  # noqa: S108

    def test_parses_arm64_filename(self):
        assert parse_appx_version("container-desktop-arm64-5.3.13.appx") == "5.3.13"

    def test_parses_prerelease_version(self):
        assert parse_appx_version("container-desktop-x64-5.3.13-beta.1.appx") == "5.3.13-beta.1"

    def test_returns_none_for_non_appx(self):
        assert parse_appx_version("container-desktop-x64-5.3.11.exe") is None


class TestParseWindowsStorePackageVersion:
    def test_parses_appx_package(self):
        assert parse_windows_store_package_version("container-desktop-x64-5.3.11.appx") == "5.3.11"

    def test_parses_msix_package(self):
        assert parse_windows_store_package_version("container-desktop-x64-5.3.11.msix") == "5.3.11"

    def test_returns_none_for_non_store_package(self):
        assert parse_windows_store_package_version("container-desktop-x64-5.3.11.exe") is None
