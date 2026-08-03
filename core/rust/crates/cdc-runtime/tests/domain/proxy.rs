//! `proxy.ts` + `resolveConnectionProxy` — the effective proxy for a connection, as an environment.
//!
//! Every case is asserted in BOTH directions where there is a comparison, because the whole module is
//! predicates over a shape a user typed: a rule checked one way round is a rule that does not
//! distinguish. What no test here can prove is what an engine DOES with the variables — that is
//! `podman`'s and `docker`'s reading of `HTTP_PROXY`, verified by a live drive.

use cdc_runtime::domain::proxy;
use cdc_runtime::domain::types::network::{
    ConnectionProxyMode, ConnectionProxySettings, ProxyConfig, ProxyMode, ProxyProtocol,
};

/// A manual proxy with everything filled in, which every case below varies from.
fn manual() -> ProxyConfig {
    ProxyConfig {
        mode: ProxyMode::Manual,
        protocol: ProxyProtocol::Http,
        host: "proxy.corp".to_string(),
        port: 3128,
        username: String::new(),
        password: String::new(),
        bypass: Vec::new(),
    }
}

fn value(env: &[(String, String)], name: &str) -> Option<String> {
    env.iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

#[test]
fn an_absent_proxy_is_disabled_and_still_bypasses_this_machine() {
    // The defaults are not cosmetic: a NO_PROXY that forgot them sends an engine's own loopback
    // traffic through a corporate proxy, which is how a working connection stops working.
    let config = proxy::normalize(None);

    assert_eq!(config.mode, ProxyMode::Disabled);
    assert_eq!(config.host, "");
    assert_eq!(config.port, 0);
    assert_eq!(config.bypass, ["localhost", "127.0.0.1", "::1"]);
}

#[test]
fn a_disabled_proxy_keeps_nothing_the_user_typed() {
    // `normalizeProxyConfig` rebuilds a disabled proxy from scratch rather than carrying the host and
    // the credentials of a proxy that is off — so a password cannot reach an environment through a
    // setting that says the proxy is not in use.
    let config = proxy::normalize(Some(&ProxyConfig {
        mode: ProxyMode::Disabled,
        username: "someone".to_string(),
        password: "secret".to_string(),
        ..manual()
    }));

    assert_eq!(config.host, "");
    assert_eq!(config.username, "");
    assert_eq!(config.password, "");
}

#[test]
fn the_defaults_lead_the_bypass_list_and_nothing_repeats() {
    let config = proxy::normalize(Some(&ProxyConfig {
        bypass: vec![
            "example.com".to_string(),
            "  ".to_string(),
            "127.0.0.1".to_string(),
            "example.com".to_string(),
        ],
        ..manual()
    }));

    assert_eq!(
        config.bypass,
        ["localhost", "127.0.0.1", "::1", "example.com"],
        "the defaults first, the user's next, each of them once"
    );
}

#[test]
fn a_proxy_is_active_only_when_it_is_manual_with_a_host_and_a_port() {
    assert!(proxy::is_active(&manual()));
    assert!(
        !proxy::is_active(&ProxyConfig {
            mode: ProxyMode::Disabled,
            ..manual()
        }),
        "off is off however complete the rest of it is"
    );
    assert!(
        !proxy::is_active(&ProxyConfig {
            host: String::new(),
            ..manual()
        }),
        "a port with nothing to connect to"
    );
    assert!(
        !proxy::is_active(&ProxyConfig {
            port: 0,
            ..manual()
        }),
        "and a host with no port"
    );
}

#[test]
fn the_url_carries_the_credentials_percent_encoded() {
    // The engines that read these variables are Go programs parsing a URL, so a password holding `@`
    // or `/` unencoded is a proxy URL that parses to the wrong host — or to nothing.
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            username: "user name".to_string(),
            password: "p@ss/w:rd".to_string(),
            ..manual()
        }),
        "http://user%20name:p%40ss%2Fw%3Ard@proxy.corp:3128"
    );
}

#[test]
fn a_credential_outside_ascii_survives_as_bytes_rather_than_as_a_question_mark() {
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            username: "gaë".to_string(),
            ..manual()
        }),
        "http://ga%C3%AB@proxy.corp:3128"
    );
}

#[test]
fn a_password_with_no_username_still_names_itself() {
    // `new URL()`'s own shape, and the one a token-as-password takes.
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            password: "secret".to_string(),
            ..manual()
        }),
        "http://:secret@proxy.corp:3128"
    );
}

#[test]
fn a_proxy_with_no_credentials_carries_no_empty_userinfo() {
    assert_eq!(proxy::to_url(&manual()), "http://proxy.corp:3128");
}

#[test]
fn an_ipv6_proxy_host_is_bracketed_and_a_bracketed_one_is_left_alone() {
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            host: "::1".to_string(),
            ..manual()
        }),
        "http://[::1]:3128"
    );
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            host: "[fe80::1]".to_string(),
            ..manual()
        }),
        "http://[fe80::1]:3128",
        "a host the user already bracketed is not bracketed twice"
    );
}

#[test]
fn a_socks_proxy_is_asked_to_resolve_the_name_itself() {
    // `socks5h` is not a typo and it is the difference between a name resolved HERE, where the DNS
    // may not answer for the network the proxy is on, and one resolved at the proxy.
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            protocol: ProxyProtocol::Socks5,
            ..manual()
        }),
        "socks5h://proxy.corp:3128"
    );
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            protocol: ProxyProtocol::Https,
            ..manual()
        }),
        "https://proxy.corp:3128",
        "and nothing else is rewritten"
    );
}

#[test]
fn a_proxy_that_is_off_has_no_url_rather_than_a_url_to_nowhere() {
    // `proxyToUrl` answers "" for an inactive proxy, and the alternative is worse than useless:
    // `http://:0` is a well-formed string that every consumer would try.
    assert_eq!(
        proxy::to_url(&ProxyConfig {
            mode: ProxyMode::Disabled,
            ..manual()
        }),
        ""
    );
}

#[test]
fn an_inactive_proxy_gives_a_process_no_variables_at_all() {
    // Not "the variables, empty" — an empty `HTTP_PROXY` is a setting, and it is one that some
    // clients read as "use no proxy" and others as a malformed URL.
    assert!(proxy::to_env(&proxy::normalize(None)).is_empty());
}

#[test]
fn the_environment_is_every_name_an_engine_might_read() {
    // Both cases of all four, because a Go engine reads the lower-case ones and its libraries the
    // upper-case ones, and there is no agreement between them worth relying on.
    let env = proxy::to_env(&ProxyConfig {
        bypass: vec!["example.com".to_string()],
        ..manual()
    });

    assert_eq!(
        env.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
        [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        ]
    );
    assert_eq!(
        value(&env, "HTTP_PROXY").as_deref(),
        Some("http://proxy.corp:3128")
    );
    assert_eq!(
        value(&env, "http_proxy"),
        value(&env, "HTTP_PROXY"),
        "one URL, whichever name a program looks under"
    );
    assert_eq!(
        value(&env, "NO_PROXY").as_deref(),
        Some("localhost,127.0.0.1,::1,example.com"),
        "commas here, where the bypass list is semicolons for a browser"
    );
}

#[test]
fn a_connection_that_says_nothing_inherits_the_global_proxy() {
    let global = manual();

    assert_eq!(
        proxy::resolve_connection(Some(&global), None),
        proxy::normalize(Some(&global)),
        "the global one, and normalized — a resolution is what a caller may act on"
    );
}

#[test]
fn a_connection_that_inherits_follows_the_global_one_wherever_it_goes() {
    let global = manual();
    let per = ConnectionProxySettings {
        mode: ConnectionProxyMode::Inherit,
        config: Some(ProxyConfig {
            host: "ignored.corp".to_string(),
            ..manual()
        }),
    };

    assert_eq!(
        proxy::resolve_connection(Some(&global), Some(&per)).host,
        "proxy.corp",
        "a config left behind by a previous `override` is not what `inherit` means"
    );
}

#[test]
fn a_connection_that_overrides_uses_its_own() {
    let per = ConnectionProxySettings {
        mode: ConnectionProxyMode::Override,
        config: Some(ProxyConfig {
            host: "connection.corp".to_string(),
            ..manual()
        }),
    };

    assert_eq!(
        proxy::resolve_connection(Some(&manual()), Some(&per)).host,
        "connection.corp"
    );
}

#[test]
fn a_connection_that_overrides_with_nothing_has_no_proxy_rather_than_the_global_one() {
    let per = ConnectionProxySettings {
        mode: ConnectionProxyMode::Override,
        config: None,
    };

    assert!(
        !proxy::is_active(&proxy::resolve_connection(Some(&manual()), Some(&per))),
        "an override that names no proxy overrides"
    );
}

#[test]
fn a_connection_that_turns_it_off_gets_no_proxy_at_all() {
    let per = ConnectionProxySettings {
        mode: ConnectionProxyMode::Off,
        config: Some(manual()),
    };

    let config = proxy::resolve_connection(Some(&manual()), Some(&per));

    assert!(!proxy::is_active(&config));
    assert!(
        proxy::to_env(&config).is_empty(),
        "and the commands it runs are given nothing"
    );
}
