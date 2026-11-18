// The loopback listener. hyper serves each connection (HTTP/1.1 only). A request that passes the rules (rules.rs) is
// forwarded to whoever answers it, the webview in the app, and the answer that comes back through `mcp_reply` becomes
// the response: 200 with JSON, or 202 with no body when there is nothing to say (a notification). Stopping ends the
// accept loop and every open connection, so a stopped server answers nothing, keep-alive connections included.

use std::convert::Infallible;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::{Body, Bytes, Incoming};
use hyper::header::{HeaderValue, ALLOW, CONTENT_TYPE, WWW_AUTHENTICATE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use super::pending::PendingReplies;
use super::rules::{check_request, Rejection, MAX_BODY_BYTES};
use super::token::Token;

/// Hands a request body to whoever answers it. An Err means it could not be delivered.
pub trait Forwarder: Send + Sync + 'static {
    fn forward(&self, id: u64, body: String) -> Result<(), String>;
}

pub struct ServerConfig {
    pub token: Token,
    pub pending: Arc<PendingReplies>,
    pub forwarder: Arc<dyn Forwarder>,
    pub reply_timeout: Duration,
}

pub struct RunningServer {
    pub port: u16,
    stop: watch::Sender<bool>,
    accept_loop: JoinHandle<()>,
}

impl RunningServer {
    /// Stop answering. The port is free again once this returns.
    pub async fn stop(self) {
        let _ = self.stop.send(true);
        let _ = self.accept_loop.await;
    }
}

/// Listen on 127.0.0.1:`port` (0 picks a free one). A port already taken comes back as an Err for the user to see.
pub async fn start(port: u16, config: ServerConfig) -> Result<RunningServer, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| format!("The MCP server could not listen on 127.0.0.1:{port}: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (stop, stopped) = watch::channel(false);
    let accept_loop = tokio::spawn(accept_loop(listener, Arc::new(config), stopped));
    Ok(RunningServer { port, stop, accept_loop })
}

/// Resolves once the server is told to stop, or is gone.
async fn stop_signal(stopped: &mut watch::Receiver<bool>) {
    let _ = stopped.wait_for(|stop| *stop).await;
}

async fn accept_loop(listener: TcpListener, config: Arc<ServerConfig>, mut stopped: watch::Receiver<bool>) {
    let for_connections = stopped.clone();
    loop {
        tokio::select! {
            _ = stop_signal(&mut stopped) => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    tokio::spawn(serve_connection(stream, Arc::clone(&config), for_connections.clone()));
                }
                // Out of descriptors and the like: back off rather than spin.
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            },
        }
    }
}

async fn serve_connection(stream: TcpStream, config: Arc<ServerConfig>, mut stopped: watch::Receiver<bool>) {
    let service = service_fn(move |request| {
        let config = Arc::clone(&config);
        async move { Ok::<_, Infallible>(respond(request, &config).await) }
    });
    let connection = http1::Builder::new().serve_connection(TokioIo::new(stream), service);
    tokio::select! {
        _ = connection => {}
        _ = stop_signal(&mut stopped) => {}
    }
}

async fn respond(request: Request<Incoming>, config: &ServerConfig) -> Response<Full<Bytes>> {
    let (parts, body) = request.into_parts();
    if let Err(rejection) = check_request(&parts.method, parts.uri.path(), &parts.headers, &config.token) {
        return rejected(rejection);
    }
    let body = match read_body(body).await {
        Ok(body) => body,
        Err(rejection) => return rejected(rejection),
    };
    let pending = config.pending.register();
    if config.forwarder.forward(pending.id, body).is_err() {
        return text(StatusCode::SERVICE_UNAVAILABLE, "Container Desktop could not hand the request to its window");
    }
    match pending.wait(config.reply_timeout).await {
        None => text(StatusCode::GATEWAY_TIMEOUT, "Container Desktop did not answer in time"),
        Some(reply) if reply.is_empty() => response(StatusCode::ACCEPTED, None, Bytes::new()),
        Some(reply) => response(StatusCode::OK, Some("application/json"), Bytes::from(reply)),
    }
}

// The declared length is checked with the other rules; this catches a chunked body that runs past the cap.
async fn read_body<B>(body: B) -> Result<String, Rejection>
where
    B: Body,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    let collected = Limited::new(body, MAX_BODY_BYTES).collect().await.map_err(|error| {
        if error.downcast_ref::<LengthLimitError>().is_some() {
            Rejection::too_large()
        } else {
            Rejection::new(StatusCode::BAD_REQUEST, "Bad request: the body could not be read")
        }
    })?;
    String::from_utf8(collected.to_bytes().to_vec())
        .map_err(|_| Rejection::new(StatusCode::BAD_REQUEST, "Bad request: the body must be UTF-8 JSON"))
}

fn response(status: StatusCode, content_type: Option<&'static str>, body: Bytes) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(body));
    *response.status_mut() = status;
    if let Some(content_type) = content_type {
        response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    }
    response
}

fn text(status: StatusCode, message: impl Into<String>) -> Response<Full<Bytes>> {
    response(status, Some("text/plain; charset=utf-8"), Bytes::from(message.into()))
}

fn rejected(rejection: Rejection) -> Response<Full<Bytes>> {
    let mut response = text(rejection.status, rejection.message);
    match rejection.status {
        StatusCode::UNAUTHORIZED => {
            response.headers_mut().insert(WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        }
        StatusCode::METHOD_NOT_ALLOWED => {
            response.headers_mut().insert(ALLOW, HeaderValue::from_static("POST"));
        }
        _ => {}
    }
    response
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const PING: &str = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    const PONG: &str = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;

    /// Answers every forwarded request with `reply` (or never, when None) and keeps the bodies it saw.
    pub struct FakeWebview {
        pending: Arc<PendingReplies>,
        reply: Option<String>,
        pub seen: Mutex<Vec<String>>,
    }

    impl Forwarder for FakeWebview {
        fn forward(&self, id: u64, body: String) -> Result<(), String> {
            self.seen.lock().unwrap().push(body);
            if let Some(reply) = &self.reply {
                self.pending.resolve(id, reply.clone());
            }
            Ok(())
        }
    }

    fn fake_config(reply: Option<&str>, reply_timeout: Duration) -> (ServerConfig, Arc<FakeWebview>) {
        let pending = Arc::new(PendingReplies::default());
        let webview = Arc::new(FakeWebview {
            pending: Arc::clone(&pending),
            reply: reply.map(String::from),
            seen: Mutex::default(),
        });
        let config = ServerConfig {
            token: Token::parse(TOKEN).unwrap(),
            pending,
            forwarder: Arc::clone(&webview) as Arc<dyn Forwarder>,
            reply_timeout,
        };
        (config, webview)
    }

    /// A server on a free port whose webview answers every request with `reply`.
    pub async fn serve_fake(reply: Option<&str>, reply_timeout: Duration) -> (RunningServer, Arc<FakeWebview>) {
        let (config, webview) = fake_config(reply, reply_timeout);
        (start(0, config).await.unwrap(), webview)
    }

    // No pooling: every request gets its own connection, so a rejected one cannot leave a closed one behind.
    fn client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().pool_max_idle_per_host(0).build().unwrap()
    }

    fn post(client: &reqwest::Client, port: u16, body: &str) -> reqwest::RequestBuilder {
        client
            .post(format!("http://127.0.0.1:{port}/mcp"))
            .bearer_auth(TOKEN)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
    }

    #[tokio::test]
    async fn mcp_server_returns_the_webview_answer_as_json() {
        let (server, webview) = serve_fake(Some(PONG), Duration::from_secs(5)).await;
        let response = post(&client(), server.port, PING).send().await.unwrap();
        assert_eq!(response.status().as_u16(), 200);
        assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
        assert_eq!(response.text().await.unwrap(), PONG);
        assert_eq!(*webview.seen.lock().unwrap(), vec![PING.to_string()]);
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_server_answers_202_without_a_body_when_the_webview_has_nothing_to_say() {
        let (server, _) = serve_fake(Some(""), Duration::from_secs(5)).await;
        let notification = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        let response = post(&client(), server.port, notification).send().await.unwrap();
        assert_eq!(response.status().as_u16(), 202);
        assert_eq!(response.text().await.unwrap(), "");
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_server_rejects_without_reaching_the_webview() {
        let (server, webview) = serve_fake(Some(PONG), Duration::from_secs(5)).await;
        let (client, port) = (client(), server.port);
        let url = format!("http://127.0.0.1:{port}/mcp");

        let unauthorized = client.post(&url).bearer_auth("f".repeat(64)).body(PING).send().await.unwrap();
        assert_eq!(unauthorized.status().as_u16(), 401);
        assert_eq!(unauthorized.headers()[WWW_AUTHENTICATE], "Bearer");

        let get = client.get(&url).bearer_auth(TOKEN).send().await.unwrap();
        assert_eq!(get.status().as_u16(), 405);
        assert_eq!(get.headers()[ALLOW], "POST");

        let evil = post(&client, port, PING).header("origin", "http://evil.example").send().await.unwrap();
        assert_eq!(evil.status().as_u16(), 403);

        let rebound = post(&client, port, PING).header("host", "evil.example").send().await.unwrap();
        assert_eq!(rebound.status().as_u16(), 403);

        let newer = post(&client, port, PING).header("mcp-protocol-version", "2026-07-28").send().await.unwrap();
        assert_eq!(newer.status().as_u16(), 400);
        assert!(newer.headers()[CONTENT_TYPE].to_str().unwrap().starts_with("text/plain"));

        assert!(webview.seen.lock().unwrap().is_empty());
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_server_caps_a_body_that_runs_past_the_limit() {
        let over = read_body(Full::new(Bytes::from(vec![b'x'; MAX_BODY_BYTES + 1]))).await.unwrap_err();
        assert_eq!(over.status, StatusCode::PAYLOAD_TOO_LARGE);
        let at = read_body(Full::new(Bytes::from(vec![b'x'; MAX_BODY_BYTES]))).await.unwrap();
        assert_eq!(at.len(), MAX_BODY_BYTES);
        let binary = read_body(Full::new(Bytes::from_static(&[0xff, 0xfe]))).await.unwrap_err();
        assert_eq!(binary.status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn mcp_server_answers_504_when_no_answer_comes_in_time() {
        let (server, _) = serve_fake(None, Duration::from_millis(50)).await;
        let response = post(&client(), server.port, PING).send().await.unwrap();
        assert_eq!(response.status().as_u16(), 504);
        server.stop().await;
    }

    #[tokio::test]
    async fn mcp_server_stop_closes_open_connections_and_frees_the_port() {
        let (server, _) = serve_fake(Some(PONG), Duration::from_secs(5)).await;
        let port = server.port;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let length = PING.len();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\n\
             Content-Length: {length}\r\n\r\n{PING}"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut answer = Vec::new();
        let mut buffer = [0u8; 1024];
        while !String::from_utf8_lossy(&answer).ends_with(PONG) {
            let read = stream.read(&mut buffer).await.unwrap();
            assert!(read > 0, "the server closed before answering");
            answer.extend_from_slice(&buffer[..read]);
        }
        assert!(answer.starts_with(b"HTTP/1.1 200"));

        server.stop().await;
        let after = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)).await;
        assert_eq!(after.expect("a kept-alive connection closes on stop").unwrap_or(0), 0);

        let (config, _) = fake_config(None, Duration::from_secs(1));
        let again = start(port, config).await.expect("the port is free again right after stop");
        again.stop().await;
    }

    #[tokio::test]
    async fn mcp_server_reports_a_port_that_is_taken() {
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = taken.local_addr().unwrap().port();
        let (config, _) = fake_config(None, Duration::from_secs(1));
        let error = start(port, config).await.err().expect("a taken port is an error, not a panic");
        assert!(error.contains(&port.to_string()), "{error}");
    }
}

