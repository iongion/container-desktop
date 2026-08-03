//! `ip -o -4 addr show scope global` into advertise candidates.
//!
//! The rows are real output from this machine (iproute2, Linux) plus the shapes that broke the original:
//! a loopback row, a repeat, and noise.

use cdc_runtime::adapters::swarm_net::parse_host_addresses;

/// Real `ip -4 -o addr show scope global` on the machine this was written on.
const REAL: &str = "\
2: enp4s0    inet 192.168.0.28/24 brd 192.168.0.255 scope global dynamic noprefixroute enp4s0\\       valid_lft 84532sec preferred_lft 84532sec
3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever
";

#[tokio::test]
async fn every_global_ipv4_interface_is_a_candidate_in_the_order_it_was_listed() {
    let found = parse_host_addresses(REAL);

    let seen: Vec<(&str, &str)> = found
        .iter()
        .map(|it| (it.iface.as_str(), it.address.as_str()))
        .collect();
    assert_eq!(
        seen,
        vec![("enp4s0", "192.168.0.28"), ("docker0", "172.17.0.1")],
        "the order is the host's, because the first row is the one the drawer offers first"
    );
}

#[tokio::test]
async fn loopback_is_not_an_address_a_cluster_can_be_reached_on() {
    let found = parse_host_addresses("1: lo    inet 127.0.0.1/8 scope host lo\n");

    assert!(
        found.is_empty(),
        "advertising 127.0.0.1 makes a manager no other node can join: {found:?}"
    );
}

#[tokio::test]
async fn the_same_interface_and_address_twice_is_offered_once() {
    let twice = format!("{REAL}{REAL}");

    let found = parse_host_addresses(&twice);

    assert_eq!(found.len(), 2, "a repeat is collapsed, not offered twice");
}

#[tokio::test]
async fn a_second_address_on_one_interface_is_its_own_candidate() {
    let both = "2: enp4s0    inet 192.168.0.28/24 scope global enp4s0\n\
                2: enp4s0    inet 10.0.0.5/8 scope global enp4s0\n";

    let found = parse_host_addresses(both);

    assert_eq!(
        found.len(),
        2,
        "the pair is (interface, address), not either alone"
    );
}

#[tokio::test]
async fn a_row_this_cannot_read_is_skipped_rather_than_breaking_the_list() {
    // Between two readable rows, so what is asserted is that parsing CONTINUED.
    let noisy = "2: enp4s0    inet 192.168.0.28/24 scope global\n\
                 Cannot open netlink socket: Permission denied\n\
                 \n\
                 not: a row at all\n\
                 3: eth1    inet6 fe80::1/64 scope link\n\
                 4: eth2    inet 10.1.2.3/24 scope global\n";

    let found = parse_host_addresses(noisy);

    let seen: Vec<&str> = found.iter().map(|it| it.iface.as_str()).collect();
    assert_eq!(
        seen,
        vec!["enp4s0", "eth2"],
        "an IPv6 row, a permission error and a blank line are all just skipped"
    );
}

#[tokio::test]
async fn an_address_with_no_prefix_length_is_not_a_row() {
    // The original's pattern requires `/<digits>`; a row without one is not `ip -o` output.
    let found = parse_host_addresses("2: enp4s0    inet 192.168.0.28 scope global\n");

    assert!(found.is_empty(), "got {found:?}");
}

#[tokio::test]
async fn a_row_that_differs_from_a_good_one_in_exactly_one_field_is_still_refused() {
    // Each of these is `2: enp4s0 inet 192.168.0.28/24 scope global` with ONE field spoiled, so what
    // rejects it is the check for that field and nothing else. A row spoiled in two places would pass
    // against a parser that had stopped checking either one.
    for (why, row) in [
        (
            "a non-numeric index",
            "abc: enp4s0    inet 192.168.0.28/24 scope global",
        ),
        (
            "no index at all",
            ": enp4s0    inet 192.168.0.28/24 scope global",
        ),
        (
            "a non-numeric prefix",
            "2: enp4s0    inet 192.168.0.28/xx scope global",
        ),
        (
            "an empty prefix",
            "2: enp4s0    inet 192.168.0.28/ scope global",
        ),
        (
            "three groups",
            "2: enp4s0    inet 192.168.28/24 scope global",
        ),
        (
            "five groups",
            "2: enp4s0    inet 192.168.0.28.1/24 scope global",
        ),
        (
            "an empty group",
            "2: enp4s0    inet 192..0.28/24 scope global",
        ),
        (
            "a group of four digits",
            "2: enp4s0    inet 192.168.0.2801/24 scope global",
        ),
        (
            "a group that is not digits",
            "2: enp4s0    inet 192.168.0.xx/24 scope global",
        ),
    ] {
        let found = parse_host_addresses(&format!("{row}\n"));

        assert!(
            found.is_empty(),
            "{why} still produced a candidate: {found:?}"
        );
    }
}

#[tokio::test]
async fn the_row_those_are_each_one_field_away_from_is_accepted() {
    // The control. Without it every assertion above passes against a parser that accepts nothing.
    let found = parse_host_addresses("2: enp4s0    inet 192.168.0.28/24 scope global\n");

    assert_eq!(found.len(), 1, "got {found:?}");
    assert_eq!(found[0].address, "192.168.0.28");
}

#[tokio::test]
async fn nothing_at_all_is_no_candidates_rather_than_a_failure() {
    // What an `ip` that is not installed leaves behind: the adapter answers `[]` and the drawer
    // degrades to free text.
    assert!(parse_host_addresses("").is_empty());
}
