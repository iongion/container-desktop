//! Reading the distributions a machine offers, and the scope that follows from them.
//!
//! Split from the parent for the 620-line cap; the fixtures stay there and are reached with
//! `super::`.

use super::*;

#[tokio::test]

async fn the_distributions_are_read_through_powershell_because_wsl_answers_in_utf16() {
    // `wsl -l -v` writes UTF-16LE, which no pipe this port owns decodes. The original round-trips it
    // through PowerShell's own console encoding and hands back JSON, and that script IS the contract.
    let (host, log) = windows(ubuntu(), |_| {
        CommandExecutionResult::ok(
            r#"["  NAME      STATE     VERSION","* Ubuntu    Running   2","  Alpine    Stopped   2"]"#,
        )
    })
    .await;

    let scopes = WslTransport
        .list_scopes(&host, &wsl_settings("Ubuntu"))
        .await
        .expect("the distributions are listed");

    assert_eq!(
        scopes,
        vec![
            distribution("Ubuntu", "Running", true),
            distribution("Alpine", "Stopped", false),
        ],
        "the default is the one marked `*`, and only a Running distribution is usable"
    );
    let asked = log.lock().expect("asked");
    assert_eq!(asked.argv[0][0], "powershell.exe");
    assert_eq!(asked.argv[0][1], "-Command");
    assert!(
        asked.argv[0][2].contains(&format!("{WSL_LAUNCHER} -l -v")),
        "the configured controller is what is asked, never a bare `wsl` on the PATH"
    );
    assert!(
        asked.argv[0][2].contains("UnicodeEncoding"),
        "and the console is switched to UTF-16 first, or the output arrives as nulls"
    );
}

#[test]
fn a_distribution_listing_survives_everything_that_is_not_a_distribution() {
    // The header is dropped by POSITION, as the original drops it, because it is marked in no other
    // way. A line that names nothing is dropped too: the original keeps it and produces a
    // distribution whose every field is undefined, which reaches a picker as a blank row.
    assert_eq!(
        wsl_distributions("not json"),
        Vec::new(),
        "unparseable output is no distributions, exactly as the original's catch leaves it"
    );
    assert_eq!(wsl_distributions("[]"), Vec::new());
    assert_eq!(
        wsl_distributions(r#"["  NAME  STATE  VERSION"]"#),
        Vec::new(),
        "a header alone lists nothing"
    );
    assert_eq!(DISTRIBUTIONS_HEADER_LINES, 1);
    assert_eq!(
        wsl_distributions(r#"["header","","  Ubuntu    Running   2","*  "]"#)
            .iter()
            .map(|it| it.name.clone())
            .collect::<Vec<_>>(),
        vec!["Ubuntu".to_string()]
    );
    // A distribution whose state or version is missing is still a distribution — it just cannot be
    // used, and saying so is different from hiding it.
    let partial = wsl_distributions(r#"["header","  Ubuntu"]"#);
    assert_eq!(partial[0].name, "Ubuntu");
    assert_eq!(partial[0].state, "");
    assert_eq!(partial[0].version, "");
    assert_eq!(partial[0].usable, Some(false));
    assert!(
        !partial[0].default,
        "and it is not the default either — only the `*` says that"
    );
}

#[tokio::test]
async fn the_default_scope_is_the_first_distribution_offered() {
    let (host, _) = windows(ubuntu(), |_| {
        CommandExecutionResult::ok(r#"["header","  Alpine  Stopped  2","* Ubuntu  Running  2"]"#)
    })
    .await;

    assert_eq!(
        WslTransport
            .controller_default_scope(&host, &wsl_settings(""))
            .await
            .expect("answers"),
        Some(distribution("Alpine", "Stopped", false)),
        "the FIRST, not the default-marked one — which is what the original picks, and a picker \
         showing something else would disagree with the connection it creates"
    );

    let (empty, _) = windows(ubuntu(), |_| CommandExecutionResult::failed(1, "no wsl")).await;
    assert_eq!(
        WslTransport
            .controller_default_scope(&empty, &wsl_settings(""))
            .await
            .expect("answers"),
        None,
        "and a host that cannot be asked has no default to offer"
    );
}

#[tokio::test]
async fn nothing_is_listed_off_windows_without_asking_the_machine() {
    // WSL exists nowhere else, so the question is answered before a command is spawned — asking
    // `powershell` on Linux would fail slowly and be reported as "no distributions".
    let command = FakeCommand::agreeable();
    let log = command.log();
    let host = unit_host_controlled(
        "host.default.podman.wsl",
        Box::new(WslTransport),
        Box::new(PodmanDialect),
        Box::new(WslProfile::PODMAN),
        OperatingSystem::Linux,
        command,
        "wsl",
    );

    assert!(
        WslTransport
            .list_scopes(&host, &wsl_settings(""))
            .await
            .expect("answers")
            .is_empty()
    );
    assert!(log.lock().expect("asked").argv.is_empty());
}

#[tokio::test]
async fn a_distribution_that_will_not_start_has_nothing_a_preflight_could_add() {
    // The command that failed said why in its own output — there is no second source to consult, and
    // inventing one would be a guess. `None` is the honest answer, and the caller keeps
    // `SCOPE_NOT_USABLE`.
    let (host, _) = windows(ubuntu(), |_| {
        CommandExecutionResult::failed(1, "no distribution")
    })
    .await;

    assert!(
        WslTransport
            .diagnose_scope(&host, Some("podman"))
            .await
            .is_none()
    );
}
