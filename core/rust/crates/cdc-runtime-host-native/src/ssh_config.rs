//! `~/.ssh/config` read as controller scopes.
//!
//! The grammar is `ssh2-config`'s, not this crate's. A hand-written line splitter is what the desktop
//! app's three backends each carry, and none of them knows `Include`, `Match`, quoting or pattern
//! semantics — reading a real `~/.ssh/config` is exactly the job to buy rather than transliterate.
//!
//! What is left here is the mapping, and it is the whole reason this lives in `cdc-runtime` rather than
//! in the kernel: reading a file needs the `Fs` capability, and the kernel only ever SELECTS a scope from a
//! list handed to it as data (`ConnectionContext.scopes`).
//!
//! Two departures from `node.ts:getSSHConfig`, both recorded:
//!
//! - **A multi-alias `Host` line yields one scope per alias.** The oracle string-coerces its parser's
//!   pattern records and produces aliases literally named `[object`, `Object],[object` and `Object]`.
//! - **`Connected` and `Usable` are absent, not `false`.** Nothing here tracks a live connection.

use std::io::BufReader;
use std::path::Path;

use cdc_runtime::capabilities::fs::{Fs, FsError};
use cdc_runtime::domain::ssh::args::DEFAULT_SSH_PORT;
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use ssh2_config::{ParseRule, SshConfig, SshParserError};

#[derive(Debug, thiserror::Error)]
pub enum SshConfigError {
    #[error(transparent)]
    Fs(#[from] FsError),
    #[error(transparent)]
    Parse(#[from] SshParserError),
}

/// The SSH scopes the user has configured, in the order the file declares them.
///
/// An absent file is no scopes; a file that cannot be read or parsed is an ERROR, where the app
/// substitutes an empty list. The two need different fixes, and "no SSH hosts configured" is the wrong
/// thing to show someone whose config has a typo in it.
pub fn list_scopes<F: Fs>(fs: &F, home: &Path) -> Result<Vec<SshHost>, SshConfigError> {
    let Some(contents) = fs.read_to_string(&home.join(".ssh").join("config"))? else {
        return Ok(Vec::new());
    };
    // The most permissive parse, deliberately: a real config is full of directives a scope picker has
    // no use for, and anything stricter turns one unrecognised keyword into an empty host list — which
    // reads to the user as "no SSH hosts configured". `all()` rather than the two flags OR'd together
    // because they are disjoint bits, so `|` and `^` are the same expression and one of them is a
    // mutation no test can ever catch.
    let config =
        SshConfig::default().parse(&mut BufReader::new(contents.as_bytes()), ParseRule::all())?;
    Ok(config
        .get_hosts()
        .iter()
        .flat_map(|host| {
            host.pattern
                .iter()
                // A pattern that MATCHES hosts does not NAME one, so it cannot be connected to: that
                // covers a negation, a glob, and the `*` block the parser also files pre-`Host`
                // directives under.
                .filter(|clause| !clause.negated && !clause.pattern.contains(['?', '*']))
                .map(|clause| scope(&clause.pattern, &host.params))
        })
        .collect())
}

fn scope(alias: &str, params: &ssh2_config::HostParams) -> SshHost {
    SshHost {
        name: alias.to_string(),
        host: alias.to_string(),
        host_name: params
            .host_name
            .clone()
            .unwrap_or_else(|| alias.to_string()),
        port: params.port.map_or(DEFAULT_SSH_PORT, i64::from),
        user: params.user.clone().unwrap_or_default(),
        // OpenSSH accumulates these and tries them in order; the schema carries one, so the first is
        // the primary. Already absolute — the parser expands `~` against the PROCESS home, not the
        // `home` this function was given, which is pinned by a test rather than left to be discovered.
        identity_file: params
            .identity_file
            .as_ref()
            .and_then(|files| files.first())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        // Always the alias: it is what makes the argv builder drop `-i` and `-p` and let `ssh` read the
        // entry this scope came from.
        config_host: Some(alias.to_string()),
        type_: SshHostType::SshConnection,
        // Unknown, not false: there is no connection tracker here.
        connected: None,
        usable: None,
    }
}
