import tasks
from tasks import bundle_script_for_target


def test_linux_arm64_target_uses_tauri_arm_package_script():
    assert bundle_script_for_target("linux-arm64") == "package:tauri:linux_arm"


def test_coarse_linux_target_uses_native_machine_arch():
    assert bundle_script_for_target("linux", system="Linux", machine="aarch64") == "package:tauri:linux_arm"
    assert bundle_script_for_target("linux", system="Linux", machine="x86_64") == "package:tauri:linux_x86"


def test_platform_targets_use_tauri_package_scripts():
    assert bundle_script_for_target("macos") == "package:tauri:mac_arm"
    assert bundle_script_for_target("windows-x64") == "package:tauri:win_x64"
    assert bundle_script_for_target("windows-arm") == "package:tauri:win_arm"


def test_coarse_windows_target_uses_native_machine_arch():
    assert bundle_script_for_target("windows", system="Windows", machine="ARM64") == "package:tauri:win_arm"
    assert bundle_script_for_target("windows", system="Windows", machine="AMD64") == "package:tauri:win_x64"


def test_local_build_boxes_load_from_dotenv_files_with_local_override(tmp_path):
    tmp_path.joinpath(".env").write_text(
        "\n".join(
            [
                "BUILD_WIN_BOX=base-win",
                "BUILD_MAC_BOX=base-mac",
                "UNRELATED_SECRET=do-not-return",
            ]
        ),
        encoding="utf-8",
    )
    tmp_path.joinpath(".env.development.local").write_text(
        "\n".join(
            [
                'BUILD_WIN_BOX="dev-win"',
                "BUILD_MAC_BOX='dev mac'",
                "BUILD_LIN_BOX=dev-linux",
            ]
        ),
        encoding="utf-8",
    )

    boxes = tasks.load_local_build_boxes(tmp_path, environ={}, environment="development")

    assert boxes == {
        "win": "dev-win",
        "mac": "dev mac",
        "linux": "dev-linux",
    }


def test_local_build_boxes_follow_vite_environment_source_order(tmp_path):
    tmp_path.joinpath(".env").write_text(
        "\n".join(
            [
                "BUILD_WIN_BOX=base-win",
                "BUILD_MAC_BOX=base-mac",
                "BUILD_LIN_BOX=base-linux",
            ]
        ),
        encoding="utf-8",
    )
    tmp_path.joinpath(".env.local").write_text("BUILD_WIN_BOX=local-win\n", encoding="utf-8")
    tmp_path.joinpath(".env.development.local").write_text("BUILD_WIN_BOX=dev-win\n", encoding="utf-8")
    tmp_path.joinpath(".env.production").write_text("BUILD_WIN_BOX=prod-win\n", encoding="utf-8")
    tmp_path.joinpath(".env.production.local").write_text("BUILD_MAC_BOX=prod-local-mac\n", encoding="utf-8")

    boxes = tasks.load_local_build_boxes(tmp_path, environ={}, environment="production")

    assert boxes == {
        "win": "prod-win",
        "mac": "prod-local-mac",
        "linux": "base-linux",
    }


def test_remote_bundle_resolution_uses_matching_box_for_cross_os_local_build(tmp_path):
    tmp_path.joinpath(".env.development.local").write_text("BUILD_WIN_BOX=builder-win\n", encoding="utf-8")

    plan = tasks.resolve_remote_bundle(
        "package:tauri:win_x64", env={}, system="Linux", project_root=tmp_path, environment="development"
    )

    assert plan == {
        "platform": "win",
        "box": "builder-win",
        "script": "package:tauri:win_x64",
        "root": tasks.REMOTE_BUILD_ROOT,
    }


def test_remote_bundle_resolution_uses_configured_box_path(tmp_path):
    tmp_path.joinpath(".env.development.local").write_text(
        "\n".join(
            [
                "BUILD_WIN_BOX=builder-win",
                "BUILD_WIN_BOX_PATH=D:/builds/container-desktop",
            ]
        ),
        encoding="utf-8",
    )

    plan = tasks.resolve_remote_bundle(
        "package:tauri:win_x64", env={}, system="Linux", project_root=tmp_path, environment="development"
    )

    assert plan["root"] == "D:/builds/container-desktop"


def test_empty_remote_bundle_path_uses_default_root(tmp_path):
    tmp_path.joinpath(".env.development.local").write_text(
        "\n".join(
            [
                "BUILD_WIN_BOX=builder-win",
                "BUILD_WIN_BOX_PATH=",
            ]
        ),
        encoding="utf-8",
    )

    plan = tasks.resolve_remote_bundle(
        "package:tauri:win_x64", env={}, system="Linux", project_root=tmp_path, environment="development"
    )

    assert plan["root"] == tasks.REMOTE_BUILD_ROOT


def test_remote_bundle_resolution_is_disabled_in_ci(tmp_path):
    tmp_path.joinpath(".env.development.local").write_text("BUILD_WIN_BOX=builder-win\n", encoding="utf-8")

    plan = tasks.resolve_remote_bundle(
        "package:tauri:win_x64",
        env={"CI": "true"},
        system="Linux",
        project_root=tmp_path,
        environment="development",
    )

    assert plan is None


def test_remote_bundle_resolution_keeps_native_host_builds_local(tmp_path):
    tmp_path.joinpath(".env.development.local").write_text("BUILD_WIN_BOX=builder-win\n", encoding="utf-8")

    plan = tasks.resolve_remote_bundle(
        "package:tauri:win_x64", env={}, system="Windows", project_root=tmp_path, environment="development"
    )

    assert plan is None


def test_bundle_dispatches_to_remote_builder_when_resolved(monkeypatch, tmp_path):
    class DummyContext:
        def __init__(self):
            self.cwd = str(tmp_path)

        def cd(self, path):
            class _Cd:
                def __enter__(_self):
                    return None

                def __exit__(_self, exc_type, exc, traceback):
                    return False

            return _Cd()

    calls = []
    plan = {"platform": "win", "box": "builder-win", "script": "package:tauri:win_x64"}
    monkeypatch.setattr(tasks, "PROJECT_HOME", str(tmp_path))
    monkeypatch.setattr(tasks, "resolve_remote_bundle", lambda script, env=None: plan)
    monkeypatch.setattr(tasks, "run_remote_bundle", lambda ctx, remote_plan, env=None: calls.append((remote_plan, env)))
    monkeypatch.setattr(
        tasks,
        "run_env",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("bundle should use the remote builder")),
    )

    tasks.bundle.body(DummyContext(), env={"PACKAGE_SCRIPT": "package:tauri:win_x64"})

    assert calls == [(plan, {"PACKAGE_SCRIPT": "package:tauri:win_x64"})]


def test_windows_remote_scripts_do_not_fail_after_optional_cleanup():
    prepare_script = tasks._windows_prepare_script()
    build_script = tasks._windows_build_script("package:tauri:win_x64")

    assert "$ProgressPreference = 'SilentlyContinue'" in prepare_script
    assert "$ProgressPreference = 'SilentlyContinue'" in build_script
    assert prepare_script.rstrip().endswith("exit 0")


def test_remote_build_scripts_fallback_to_corepack_yarn():
    windows_script = tasks._windows_build_script("package:tauri:win_x64")
    posix_script = tasks._posix_build_script("package:tauri:linux_x86")

    assert "function Invoke-Yarn" in windows_script
    assert "corepack yarn @Arguments" in windows_script
    assert "remote_yarn() {" in posix_script
    assert 'corepack yarn "$@"' in posix_script
