// `container-desktop --mcp-stdio`, for MCP clients that only spawn stdio servers. Each stdin line is one JSON-RPC
// message, POSTed to the running app's loopback endpoint with the token from the OS keychain; each answer goes to
// stdout as one line, and a 202 writes nothing. When the app is not there to answer, a request gets a JSON-RPC error
// that says so and the relay keeps reading. Messages are relayed concurrently, so a slow call never holds up a ping.
// stdout carries protocol lines only; nothing else is ever written to it.

use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};

use super::rules::{MCP_PATH, PROTOCOL_VERSION_HEADER};
use super::settings::{configured_port, DEFAULT_MCP_PORT};
use super::token::TOKEN_ACCOUNT;

// JSON-RPC's range for errors a server defines.
const RELAY_ERROR: i64 = -32000;

/// What the relay must know about a message to answer for an absent app: its id when it is a request, and whether it
/// is the handshake, whose answer names the protocol version later requests carry.
#[derive(Debug, PartialEq)]
pub struct Incoming {
    pub id: Option<Value>,
    pub initialize: bool,
}

pub fn incoming(line: &str) -> Incoming {
    let message: Value = serde_json::from_str(line).unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str);
    let id = message.get("id").filter(|id| method.is_some() && (id.is_string() || id.is_number()));
    Incoming {
        id: id.cloned(),
        initialize: method == Some("initialize"),
    }
}

/// Where the app listens and the token it expects. No Debug: it holds the token.
#[derive(Clone)]
pub struct Endpoint {
    pub port: u16,
    pub token: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Answered(u16, String),
    Unreachable,
    NoToken,
}

impl Outcome {
    // Worth reading the port and token again: the app may have moved, or replaced its token.
    fn calls_for_a_fresh_endpoint(&self) -> bool {
        matches!(self, Outcome::Answered(401, _) | Outcome::Unreachable | Outcome::NoToken)
    }
}

pub fn error_line(id: &Value, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": RELAY_ERROR, "message": message } }).to_string()
}

/// A JSON body as one line: raw newlines can only sit between JSON tokens, never inside a string.
pub fn one_line(body: &str) -> Option<String> {
    let body = body.trim();
    (!body.is_empty()).then(|| body.replace(['\r', '\n'], " "))
}

fn not_running(port: u16) -> String {
    format!(
        "Container Desktop is not answering on 127.0.0.1:{port}. It must be running with its MCP server turned on \
         (Settings, MCP server)."
    )
}

const NO_TOKEN: &str = "Container Desktop's MCP token is not in the OS keychain yet. Turn on the MCP server in \
                        Container Desktop's settings, which creates it.";

/// The line to write for a message's outcome, if any. Notifications never get one.
pub fn output_line(incoming: &Incoming, outcome: &Outcome, port: u16) -> Option<String> {
    let refusal = match outcome {
        Outcome::Answered(status, body) if (200..300).contains(status) => return one_line(body),
        Outcome::Answered(status, body) => {
            format!("Container Desktop refused the request (HTTP {status}): {}", body.trim())
        }
        Outcome::Unreachable => not_running(port),
        Outcome::NoToken => NO_TOKEN.to_string(),
    };
    incoming.id.as_ref().map(|id| error_line(id, &refusal))
}

pub fn negotiated_version(body: &str) -> Option<String> {
    let answer: Value = serde_json::from_str(body).ok()?;
    answer.pointer("/result/protocolVersion")?.as_str().map(String::from)
}

type EndpointSource = Arc<dyn Fn() -> Endpoint + Send + Sync>;

pub struct Relay {
    client: reqwest::Client,
    source: EndpointSource,
    endpoint: Mutex<Option<Endpoint>>,
    protocol_version: Mutex<Option<String>>,
}

impl Relay {
    pub fn new(source: EndpointSource) -> Result<Self, String> {
        // Straight to loopback: a proxy from the environment must never see the token.
        let client = reqwest::Client::builder().no_proxy().build().map_err(|e| e.to_string())?;
        Ok(Relay {
            client,
            source,
            endpoint: Mutex::new(None),
            protocol_version: Mutex::new(None),
        })
    }

    /// Relay one message; the line to write back, if any.
    pub async fn relay(&self, line: &str) -> Option<String> {
        let incoming = incoming(line);
        let mut endpoint = self.endpoint(false).await;
        let mut outcome = self.post(&endpoint, line).await;
        if outcome.calls_for_a_fresh_endpoint() {
            endpoint = self.endpoint(true).await;
            outcome = self.post(&endpoint, line).await;
        }
        if let (true, Outcome::Answered(200, body)) = (incoming.initialize, &outcome) {
            *self.protocol_version.lock().unwrap() = negotiated_version(body);
        }
        output_line(&incoming, &outcome, endpoint.port)
    }

    async fn endpoint(&self, fresh: bool) -> Endpoint {
        let cached = self.endpoint.lock().unwrap().clone();
        if let (false, Some(endpoint)) = (fresh, cached) {
            return endpoint;
        }
        // Reading the keychain blocks (a D-Bus round trip on Linux), so it runs off the relay's thread.
        let source = Arc::clone(&self.source);
        let endpoint = tokio::task::spawn_blocking(move || source()).await.unwrap_or(Endpoint {
            port: DEFAULT_MCP_PORT,
            token: None,
        });
        *self.endpoint.lock().unwrap() = Some(endpoint.clone());
        endpoint
    }

    async fn post(&self, endpoint: &Endpoint, line: &str) -> Outcome {
        let Some(token) = &endpoint.token else {
            return Outcome::NoToken;
        };
        let version = self.protocol_version.lock().unwrap().clone();
        let mut request = self
            .client
            .post(format!("http://127.0.0.1:{}{MCP_PATH}", endpoint.port))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .bearer_auth(token)
            .body(line.to_owned());
        if let Some(version) = version {
            request = request.header(PROTOCOL_VERSION_HEADER, version);
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                Outcome::Answered(status, response.text().await.unwrap_or_default())
            }
            Err(_) => Outcome::Unreachable,
        }
    }

    #[cfg(test)]
    fn protocol_version(&self) -> Option<String> {
        self.protocol_version.lock().unwrap().clone()
    }
}

fn configured_endpoint() -> Endpoint {
    Endpoint {
        port: configured_port(),
        token: crate::keychain::keychain_get(TOKEN_ACCOUNT),
    }
}

fn stdin_lines() -> tokio::sync::mpsc::UnboundedReceiver<String> {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

fn write_line(line: &str) {
    let mut stdout = std::io::stdout().lock();
    // A client that has gone away also closes stdin, which ends the relay.
    let _ = writeln!(stdout, "{line}").and_then(|()| stdout.flush());
}

async fn relay_lines(relay: Arc<Relay>) {
    let mut lines = stdin_lines();
    let mut answers = tokio::task::JoinSet::new();
    while let Some(line) = lines.recv().await {
        if line.trim().is_empty() {
            continue;
        }
        let relay = Arc::clone(&relay);
        answers.spawn(async move {
            if let Some(answer) = relay.relay(line.trim()).await {
                write_line(&answer);
            }
        });
        while answers.try_join_next().is_some() {}
    }
    // stdin closed: let the answers already on their way arrive.
    while answers.join_next().await.is_some() {}
}

/// Relay until stdin closes. Returns the process exit code.
pub fn run() -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("container-desktop --mcp-stdio: {error}");
            return 1;
        }
    };
    match Relay::new(Arc::new(configured_endpoint)) {
        Ok(relay) => {
            runtime.block_on(relay_lines(Arc::new(relay)));
            0
        }
        Err(error) => {
            eprintln!("container-desktop --mcp-stdio: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::server::tests::{serve_fake, TOKEN};
    use std::time::Duration;

    const INITIALIZE: &str =
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;
    const INITIALIZED: &str = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;

    fn fixed(port: u16, token: Option<&str>) -> EndpointSource {
        let endpoint = Endpoint {
            port,
            token: token.map(String::from),
        };
        Arc::new(move || endpoint.clone())
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    #[test]
    fn mcp_stdio_knows_a_request_by_its_id() {
        assert_eq!(incoming(INITIALIZE), Incoming { id: Some(json!(1)), initialize: true });
        let named = incoming(r#"{"jsonrpc":"2.0","id":"a","method":"tools/list"}"#);
        assert_eq!(named, Incoming { id: Some(json!("a")), initialize: false });
        assert_eq!(incoming(INITIALIZED).id, None);
        assert_eq!(incoming(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#).id, None, "a response is not a request");
        assert_eq!(incoming(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#).id, None);
        assert_eq!(incoming("not json").id, None);
    }

    #[test]
    fn mcp_stdio_writes_each_answer_as_one_line() {
        let body = "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\r\n  \"result\": {\"text\": \"a\\nb\"}\n}\n";
        let line = one_line(body).unwrap();
        assert!(!line.contains('\n') && !line.contains('\r'));
        assert_eq!(serde_json::from_str::<Value>(&line).unwrap(), serde_json::from_str::<Value>(body).unwrap());
        assert_eq!(one_line("  \n"), None);
    }

    #[test]
    fn mcp_stdio_answers_for_an_absent_app_only_when_a_request_waits() {
        let request = incoming(r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#);
        let line = output_line(&request, &Outcome::Unreachable, 17627).unwrap();
        let error: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(error["id"], 7);
        assert_eq!(error["error"]["code"], RELAY_ERROR);
        let message = error["error"]["message"].as_str().unwrap();
        assert!(message.contains("must be running") && message.contains("17627"), "{message}");

        let no_token: Value = serde_json::from_str(&output_line(&request, &Outcome::NoToken, 1).unwrap()).unwrap();
        assert!(no_token["error"]["message"].as_str().unwrap().contains("keychain"));

        let refused = output_line(&request, &Outcome::Answered(401, "Unauthorized: …".into()), 1).unwrap();
        assert!(refused.contains("HTTP 401"), "{refused}");

        let notification = incoming(INITIALIZED);
        assert_eq!(output_line(&notification, &Outcome::Unreachable, 1), None);
        assert_eq!(output_line(&notification, &Outcome::Answered(202, String::new()), 1), None);
    }

    #[test]
    fn mcp_stdio_reads_the_negotiated_protocol_version() {
        let answer = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}"#;
        assert_eq!(negotiated_version(answer).as_deref(), Some("2025-06-18"));
        assert_eq!(negotiated_version(r#"{"jsonrpc":"2.0","id":1,"error":{}}"#), None);
    }

    #[tokio::test]
    async fn mcp_stdio_relays_to_the_running_app_and_remembers_the_version() {
        let answer = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}"#;
        let (server, webview) = serve_fake(Some(answer), Duration::from_secs(5)).await;
        let relay = Relay::new(fixed(server.port, Some(TOKEN))).unwrap();
        assert_eq!(relay.relay(INITIALIZE).await.as_deref(), Some(answer));
        assert_eq!(relay.protocol_version().as_deref(), Some("2025-06-18"));
        // The next message carries the negotiated version, which the server accepts.
        assert_eq!(relay.relay(INITIALIZE).await.as_deref(), Some(answer));
        assert_eq!(webview.seen.lock().unwrap().len(), 2);
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_stdio_writes_nothing_for_a_202() {
        let (server, _) = serve_fake(Some(""), Duration::from_secs(5)).await;
        let relay = Relay::new(fixed(server.port, Some(TOKEN))).unwrap();
        assert_eq!(relay.relay(INITIALIZED).await, None);
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_stdio_says_the_app_must_be_running_when_nothing_listens() {
        let port = free_port();
        let relay = Relay::new(fixed(port, Some(TOKEN))).unwrap();
        let line = relay.relay(r#"{"jsonrpc":"2.0","id":"x","method":"ping"}"#).await.unwrap();
        let error: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(error["id"], "x");
        assert!(error["error"]["message"].as_str().unwrap().contains(&port.to_string()));
    }

    #[tokio::test]
    async fn mcp_stdio_reports_a_wrong_token_as_an_error_for_the_request() {
        let (server, webview) = serve_fake(Some("{}"), Duration::from_secs(5)).await;
        let relay = Relay::new(fixed(server.port, Some(&"f".repeat(64)))).unwrap();
        let line = relay.relay(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#).await.unwrap();
        assert!(line.contains("HTTP 401"), "{line}");
        assert!(webview.seen.lock().unwrap().is_empty());
        server.stop().await;
    }
}
