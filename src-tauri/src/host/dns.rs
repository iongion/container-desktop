// DNS resolution host capability.

/// Resolve a hostname to its IP addresses. A generic host DNS capability — the AI web-search SSRF guard
/// (adapters/webSearch.ts) consumes it to reject private/loopback targets, but nothing here is AI-specific.
#[tauri::command]
pub async fn dns_lookup(hostname: String) -> Result<Vec<String>, String> {
    // lookup_host wants a "host:port" target; port 0 is fine, we only use the resolved IPs.
    let addrs = tokio::net::lookup_host((hostname.as_str(), 0u16))
        .await
        .map_err(|e| e.to_string())?;
    let mut ips: Vec<String> = addrs.map(|addr| addr.ip().to_string()).collect();
    ips.sort();
    ips.dedup();
    Ok(ips)
}
