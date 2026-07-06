// The Rust side of Platform.getSSHConfig — parses ~/.ssh/config into the renderer's SSHHost[] so the SSH
// controller-scope picker lists the user's configured hosts. A faithful port of the subset src/platform/node/node.ts
// consumes from the `ssh-config` npm parser (which can't bundle into the webview — it pulls node:child_process /
// node:os), so it lives here in the native I/O layer alongside FS/Command/proxy.
//
// Fidelity to node.ts getSSHConfig (do not "improve"):
//   - only `Host` blocks are read; HostName / Port / User / IdentityFile via a case-insensitive FIRST match.
//   - one SSHHost per CONCRETE host pattern — `*`, `!neg`, and any token containing `?`/`*` are dropped
//     (concreteHostPatterns); a `Host *` block yields nothing.
//   - Port defaults to 22 when absent or non-numeric; HostName defaults to the alias.
//   - ConfigHost is always the alias, which is why the SSH argv builder later drops -i/-p (ssh trusts the
//     config entry). Connected/Usable start false (the transport fills them in).

use serde::Serialize;
use std::path::Path;

// Mirror of env/Types.ts SSHHost (PascalCase wire keys) with Type = ControllerScopeType.SSHConnection.
#[derive(Serialize, Debug, PartialEq)]
pub struct SshHost {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Host")]
    host: String,
    #[serde(rename = "Port")]
    port: u32,
    #[serde(rename = "HostName")]
    host_name: String,
    #[serde(rename = "User")]
    user: String,
    #[serde(rename = "Type")]
    scope_type: String,
    #[serde(rename = "IdentityFile")]
    identity_file: String,
    #[serde(rename = "ConfigHost")]
    config_host: String,
    #[serde(rename = "Connected")]
    connected: bool,
    #[serde(rename = "Usable")]
    usable: bool,
}

// The mutable accumulator for the Host block currently being read (first value wins, like configValue's find).
#[derive(Default)]
struct HostBlock {
    patterns: String,
    host_name: Option<String>,
    port: Option<String>,
    user: Option<String>,
    identity_file: Option<String>,
}

/// concreteHostPatterns(value): split on whitespace, drop empty, `*`, `!negations`, and glob tokens (`?`/`*`).
fn concrete_host_patterns(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty() && *item != "*" && !item.starts_with('!') && !item.contains(['?', '*']))
        .map(|item| item.to_string())
        .collect()
}

// Split a directive line into (keyword, argument). OpenSSH allows `Key Value`, `Key=Value`, and `Key = Value`;
// a surrounding pair of double quotes on the value is stripped. Returns None for a keyword-only line.
fn split_directive(line: &str) -> Option<(String, String)> {
    let separator = line.find([' ', '\t', '=']);
    let (key, rest) = match separator {
        Some(index) => (&line[..index], &line[index..]),
        None => (line, ""),
    };
    if key.is_empty() {
        return None;
    }
    let mut value = rest.trim_start();
    if let Some(stripped) = value.strip_prefix('=') {
        value = stripped.trim_start();
    }
    let value = value.trim();
    let value = value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value);
    Some((key.to_string(), value.to_string()))
}

fn flush_block(block: HostBlock, hosts: &mut Vec<SshHost>) {
    // The whole `Host *` block contributes nothing (matches node's `item.value !== "*"` guard; concrete
    // filtering would drop it anyway).
    if block.patterns.trim() == "*" {
        return;
    }
    let host_name = block.host_name.unwrap_or_default().trim().to_string();
    let user = block.user.unwrap_or_default().trim().to_string();
    let identity_file = block.identity_file.unwrap_or_default().trim().to_string();
    let port = {
        let raw = block.port.unwrap_or_default();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            22
        } else {
            trimmed.parse::<u32>().unwrap_or(22)
        }
    };
    for alias in concrete_host_patterns(&block.patterns) {
        hosts.push(SshHost {
            name: alias.clone(),
            host: alias.clone(),
            port,
            host_name: if host_name.is_empty() { alias.clone() } else { host_name.clone() },
            user: user.clone(),
            scope_type: "SSHConnection".into(),
            identity_file: identity_file.clone(),
            config_host: alias.clone(),
            connected: false,
            usable: false,
        });
    }
}

pub fn parse_ssh_config(contents: &str) -> Vec<SshHost> {
    let mut hosts: Vec<SshHost> = Vec::new();
    let mut current: Option<HostBlock> = None;
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = split_directive(line) else {
            continue;
        };
        match key.to_lowercase().as_str() {
            "host" => {
                if let Some(block) = current.take() {
                    flush_block(block, &mut hosts);
                }
                current = Some(HostBlock { patterns: value, ..Default::default() });
            }
            // A Match block is not a Host — stop attributing directives to the previous Host.
            "match" => {
                if let Some(block) = current.take() {
                    flush_block(block, &mut hosts);
                }
            }
            "hostname" => {
                if let Some(block) = current.as_mut() {
                    block.host_name.get_or_insert(value);
                }
            }
            "port" => {
                if let Some(block) = current.as_mut() {
                    block.port.get_or_insert(value);
                }
            }
            "user" => {
                if let Some(block) = current.as_mut() {
                    block.user.get_or_insert(value);
                }
            }
            "identityfile" => {
                if let Some(block) = current.as_mut() {
                    block.identity_file.get_or_insert(value);
                }
            }
            _ => {}
        }
    }
    if let Some(block) = current.take() {
        flush_block(block, &mut hosts);
    }
    hosts
}

/// Read + parse ~/.ssh/config. Infallible: a missing/unreadable file yields [] (mirrors the consumer's
/// getAvailableSSHConnections try/catch → []), so the SSH picker just shows no hosts rather than erroring.
#[tauri::command]
pub fn get_ssh_config() -> Vec<SshHost> {
    let home = crate::host::get_home_dir();
    if home.is_empty() {
        return Vec::new();
    }
    let path = Path::new(&home).join(".ssh").join("config");
    match std::fs::read_to_string(&path) {
        Ok(contents) => parse_ssh_config(&contents),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_basic_host_block() {
        let hosts = parse_ssh_config(
            "Host prod\n  HostName 10.0.0.1\n  Port 2222\n  User deploy\n  IdentityFile ~/.ssh/id_ed25519\n",
        );
        assert_eq!(hosts.len(), 1);
        let host = &hosts[0];
        assert_eq!(host.name, "prod");
        assert_eq!(host.host, "prod");
        assert_eq!(host.config_host, "prod");
        assert_eq!(host.host_name, "10.0.0.1");
        assert_eq!(host.port, 2222);
        assert_eq!(host.user, "deploy");
        assert_eq!(host.identity_file, "~/.ssh/id_ed25519");
        assert_eq!(host.scope_type, "SSHConnection");
        assert!(!host.connected);
        assert!(!host.usable);
    }

    #[test]
    fn defaults_port_to_22_and_hostname_to_alias() {
        let hosts = parse_ssh_config("Host box\n  User me\n");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].port, 22);
        assert_eq!(hosts[0].host_name, "box"); // HostName falls back to the alias
        assert_eq!(hosts[0].identity_file, "");
    }

    #[test]
    fn non_numeric_port_falls_back_to_22() {
        let hosts = parse_ssh_config("Host x\n  Port not-a-number\n");
        assert_eq!(hosts[0].port, 22);
    }

    #[test]
    fn emits_one_host_per_concrete_pattern_dropping_globs() {
        let hosts = parse_ssh_config("Host foo bar *.example !nope\n  HostName shared\n  Port 42\n");
        let names: Vec<&str> = hosts.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, vec!["foo", "bar"]); // *.example (glob) and !nope (negation) dropped
        // both concrete aliases share the block's settings
        assert!(hosts.iter().all(|h| h.host_name == "shared" && h.port == 42));
    }

    #[test]
    fn skips_wildcard_only_host_block() {
        let hosts = parse_ssh_config("Host *\n  User global\nHost real\n  HostName r\n");
        let names: Vec<&str> = hosts.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
    }

    #[test]
    fn handles_case_insensitive_keys_equals_separator_and_comments() {
        let hosts = parse_ssh_config(
            "# a comment\n\nHOST gw\n  hostname=192.168.1.1\n  PORT = 2200\n  user=admin\n  # trailing comment\n",
        );
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host_name, "192.168.1.1");
        assert_eq!(hosts[0].port, 2200);
        assert_eq!(hosts[0].user, "admin");
    }

    #[test]
    fn first_value_wins_and_quotes_are_stripped() {
        let hosts = parse_ssh_config("Host q\n  IdentityFile \"~/.ssh/key one\"\n  HostName a\n  HostName b\n");
        assert_eq!(hosts[0].identity_file, "~/.ssh/key one");
        assert_eq!(hosts[0].host_name, "a"); // first HostName wins
    }

    #[test]
    fn directives_under_match_are_not_attributed_to_prior_host() {
        let hosts = parse_ssh_config("Host h\n  HostName real\nMatch host *\n  User should-be-ignored\n");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host_name, "real");
        assert_eq!(hosts[0].user, ""); // the Match block's User is not h's
    }

    #[test]
    fn empty_or_missing_config_yields_no_hosts() {
        assert!(parse_ssh_config("").is_empty());
        assert!(parse_ssh_config("# only comments\n\n").is_empty());
    }
}
