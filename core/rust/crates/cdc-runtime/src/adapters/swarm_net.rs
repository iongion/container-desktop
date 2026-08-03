//! `adapters/swarm-net.ts` — `ip -o -4 addr show scope global` into advertise-address candidates.
//!
//! The init drawer offers a NIC to advertise on, which is the fix for the multi-NIC "could not choose an
//! IP address to advertise" 400. Pure, so it is the same answer over every transport.

use std::collections::BTreeSet;

use crate::domain::types::swarm::HostAddress;

/// Each `ip -o` row is one line:
/// `3: enp4s0    inet 192.168.0.29/24 brd 192.168.0.255 scope global dynamic ...`
///
/// Loopback is dropped and repeats are collapsed. An unreadable line is skipped rather than fatal —
/// what arrives here is another machine's stdout.
///
/// **Hand-parsed rather than a regex**, and it accepts exactly what the original's pattern accepts:
/// four groups of one to three digits, with a prefix length after the slash. Neither validates the
/// octet range, so `999.1.1.1` is a candidate in both trees — the engine is the thing that refuses it.
pub fn parse_host_addresses(output: &str) -> Vec<HostAddress> {
    let mut found = Vec::new();
    let mut seen = BTreeSet::new();
    for line in output.lines() {
        let Some((iface, address)) = interface_address(line) else {
            continue;
        };
        if address.starts_with("127.") {
            continue;
        }
        if seen.insert((iface.to_string(), address.to_string())) {
            found.push(HostAddress {
                iface: iface.to_string(),
                address: address.to_string(),
            });
        }
    }
    found
}

/// `<index>: <iface> inet <a.b.c.d>/<prefix>`, or nothing.
fn interface_address(line: &str) -> Option<(&str, &str)> {
    let mut fields = line.split_whitespace();
    let index = fields.next()?.strip_suffix(':')?;
    if index.is_empty() || !index.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let iface = fields.next()?;
    if fields.next()? != "inet" {
        return None;
    }
    let (address, prefix) = fields.next()?.split_once('/')?;
    if prefix.is_empty() || !prefix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    is_dotted_quad(address).then_some((iface, address))
}

/// Four groups of one to three digits, separated by dots — the original's `\d{1,3}(?:\.\d{1,3}){3}`.
fn is_dotted_quad(address: &str) -> bool {
    let mut groups = 0;
    for group in address.split('.') {
        if group.is_empty() || group.len() > 3 || !group.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
        groups += 1;
    }
    groups == 4
}
