//! The server binary.
//!
//! **Foreground, with structured logging. Daemonization is the platform's job** — systemd, launchd, a
//! Windows service, a container runtime — and a process that forks itself is a process whose logs,
//! signals and exit status all become somebody's afternoon. So: run in the foreground, log to stderr,
//! exit non-zero when it cannot start, and stop cleanly on a signal.
//!
//! **Wiring only.** Every decision this reads lives in the library, where a test can ask about it: the
//! command line in [`cdc_server::cli`], the posture in [`cdc_server::listen`], the platform in
//! [`cdc_server::host`], the lifecycle in [`cdc_server::listen::endpoint`]. That is why there is no
//! `tests/main.rs` — and why this file is the one place the coverage gate is told to skip, since a
//! binary's `main` cannot be entered from an integration test at all.

use std::process::ExitCode;

use cdc_server::cli::Options;
use cdc_server::host;
use cdc_server::listen::Admitted;
use cdc_server::listen::endpoint::Serving;
use cdc_server::listen::session::Shared;
use clap::Parser;
use tokio_util::sync::CancellationToken;

fn main() -> ExitCode {
    let options = Options::parse();
    logging(&options);
    let listen = match options.admitted() {
        Ok(listen) => listen,
        // Before the runtime, and without a panic: a refusal here is an operator's typo, and a
        // backtrace would bury the one line that says which.
        Err(error) => return refused(&error),
    };
    match runtime().block_on(serve(listen)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => refused(error.as_ref()),
    }
}

fn refused(error: &dyn std::error::Error) -> ExitCode {
    tracing::error!(%error, "refusing to start");
    ExitCode::FAILURE
}

/// Structured logging to stderr. `RUST_LOG` overrides `--log`, which is what anyone debugging expects.
fn logging(options: &Options) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&options.log));
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr);
    if options.log_json {
        builder.json().init();
    } else {
        builder.init();
    }
}

/// A multi-threaded runtime, because clients, stream pumps and connects run at the same time.
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a tokio runtime")
}

async fn serve(listen: Admitted) -> Result<(), Box<dyn std::error::Error>> {
    let shutdown = CancellationToken::new();
    let shared = Shared::new(host::native_server(&host::app_version()), shutdown.clone());
    let serving = Serving::bind(shared, &listen).await?;

    if let Some(path) = listen.local() {
        tracing::info!(socket = %path.display(), "listening locally");
    }
    if let Some(address) = serving.remote_address() {
        // **The one line an operator most needs**, and it says the quiet part: a listener on anything but
        // loopback grants full container-engine control to whoever can reach it. Logged at every start
        // rather than left in a manual — and it says which of the two arrangements this is, because
        // "there is a remote listener" and "the token crosses in the clear" are different facts and only
        // one of them is now unavoidable.
        let off_host = listen.is_reachable_off_host();
        match listen.remote().and_then(|remote| remote.tls.as_ref()) {
            Some(tls) => tracing::info!(
                %address,
                off_host,
                chain_depth = tls.chain_depth(),
                "listening for network clients over TLS: a token is required"
            ),
            // Split from the plaintext-on-loopback case deliberately. Behind a tunnel or a reverse
            // proxy, plaintext on loopback is correct and a warning about it is noise an operator learns
            // to skip — which is how the line that MATTERS gets skipped with it.
            None if off_host => tracing::error!(
                %address,
                "listening for network clients off this host with NO encryption: the bearer token is readable and replayable by anything on the path. Bind loopback behind a tunnel, or give --tls-cert and --tls-key"
            ),
            None => tracing::warn!(
                %address,
                "listening for network clients: a token is required, and the transport is NOT encrypted"
            ),
        }
    }

    tokio::spawn(signals(shutdown));
    serving.run().await;
    Ok(())
}

/// Stop on the signals a supervisor actually sends.
///
/// `SIGTERM` is what systemd, docker and a `kill` send; `ctrl_c`/`SIGINT` is what a terminal sends. Both
/// mean the same thing here, and the SECOND one is deliberately not special-cased into a hard exit: what
/// makes shutdown quick is that it has nothing slow to do, not that it can be interrupted.
async fn signals(shutdown: CancellationToken) {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = term.recv() => tracing::info!("SIGTERM"),
                    _ = tokio::signal::ctrl_c() => tracing::info!("interrupted"),
                }
            }
            Err(error) => {
                tracing::warn!(%error, "SIGTERM cannot be handled; interrupt still works");
                let _ = tokio::signal::ctrl_c().await;
                tracing::info!("interrupted");
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("interrupted");
    }
    shutdown.cancel();
}
