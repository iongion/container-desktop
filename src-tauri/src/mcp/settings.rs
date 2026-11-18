// The one MCP setting the native side reads itself: the port, for `--mcp-stdio`, which runs without the webview.
// Same default and rules as normalizeMcpSettings (src/packages/container-client/src/mcpSettings.ts).

use std::path::PathBuf;

use serde_json::Value;

/// Keep in step with DEFAULT_MCP_PORT in src/packages/container-client/src/mcpSettings.ts.
pub const DEFAULT_MCP_PORT: u16 = 17627;
pub const MIN_MCP_PORT: u16 = 1024;

fn whole_number(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_f64().filter(|n| n.fract() == 0.0 && (0.0..=65535.0).contains(n)).map(|n| n as u64)),
        Value::String(text) => {
            let text = text.trim();
            let digits = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
            digits.then(|| text.parse::<u64>().ok()).flatten()
        }
        _ => None,
    }
}

fn normalize_port(value: Option<&Value>) -> u16 {
    value
        .and_then(whole_number)
        .filter(|port| (u64::from(MIN_MCP_PORT)..=u64::from(u16::MAX)).contains(port))
        .map_or(DEFAULT_MCP_PORT, |port| port as u16)
}

/// The port from the text of user-settings.json.
pub fn port_from_settings(contents: &str) -> u16 {
    let settings: Value = serde_json::from_str(contents).unwrap_or(Value::Null);
    normalize_port(settings.get("mcp").and_then(|mcp| mcp.get("port")))
}

/// The port in `<user data>/user-settings.json`, or the default when the file or the value is missing.
pub fn configured_port() -> u16 {
    let path = PathBuf::from(crate::host::platform::get_user_data_path()).join("user-settings.json");
    std::fs::read_to_string(path).map_or(DEFAULT_MCP_PORT, |contents| port_from_settings(&contents))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_settings_port_defaults_when_nothing_is_stored() {
        for contents in ["", "{}", "not json", r#"{"mcp":null}"#, r#"{"mcp":{}}"#, r#"{"mcp":"on"}"#] {
            assert_eq!(port_from_settings(contents), DEFAULT_MCP_PORT, "{contents}");
        }
    }

    #[test]
    fn mcp_settings_port_reads_a_stored_port() {
        assert_eq!(port_from_settings(r#"{"theme":"bp6-dark","mcp":{"enabled":true,"port":18080}}"#), 18080);
        assert_eq!(port_from_settings(r#"{"mcp":{"port":"18080"}}"#), 18080);
        assert_eq!(port_from_settings(r#"{"mcp":{"port":" 18080 "}}"#), 18080);
        assert_eq!(port_from_settings(r#"{"mcp":{"port":18080.0}}"#), 18080);
        assert_eq!(port_from_settings(r#"{"mcp":{"port":1024}}"#), 1024);
        assert_eq!(port_from_settings(r#"{"mcp":{"port":65535}}"#), 65535);
    }

    #[test]
    fn mcp_settings_port_defaults_when_out_of_range_or_not_whole() {
        for port in ["0", "80", "1023", "65536", "-1", "18080.5", r#""""#, r#""18080x""#, r#""+18080""#, "true", "{}"] {
            let contents = format!(r#"{{"mcp":{{"port":{port}}}}}"#);
            assert_eq!(port_from_settings(&contents), DEFAULT_MCP_PORT, "{contents}");
        }
    }
}
