use clap::{Parser};
use axum::{
  body::Body,
  http::{Request, StatusCode}
};
use http_body_util::BodyExt;
use hyper_util::rt::TokioIo;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
  method: Option<String>,
  uri: Option<String>,
  relay: Option<String>,
}

#[cfg(not(windows))]
pub async fn client(method: String, uri: String, relay: String) -> Result<(), Box<dyn std::error::Error>> {
  use tokio::net::UnixStream;
  use std::path::PathBuf;
  let path = PathBuf::from(relay);
  let stream = UnixStream::connect(path).await.unwrap();
  let io = TokioIo::new(stream);
  let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await.unwrap();
  tokio::task::spawn(async move {
      if let Err(err) = conn.await {
          println!("Connection failed: {:?}", err);
      }
  });
  let request = Request::builder()
      .method(method.as_str())
      .uri(uri.as_str())
      .header("Host", "d")
      .body(Body::empty())
      .unwrap();

  let response = sender.send_request(request).await.unwrap();
  assert_eq!(response.status(), StatusCode::OK);
  let body = response.collect().await.unwrap().to_bytes();
  let body = String::from_utf8(body.to_vec()).unwrap();
  println!("{}", body);
  Ok(())
}

#[cfg(windows)]
pub async fn client(method: String, uri: String, relay: String) -> Result<(), Box<dyn std::error::Error>> {
  use tokio::net::TcpStream;
  let stream = TcpStream::connect(relay).await.unwrap();
  let io = TokioIo::new(stream);
  let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await.unwrap();
  tokio::task::spawn(async move {
      if let Err(err) = conn.await {
          println!("Connection failed: {:?}", err);
      }
  });
  let request = Request::builder()
      .method(method.as_str())
      .uri(uri.as_str())
      .header("Host", "d")
      .body(Body::empty())
      .unwrap();

  let response = sender.send_request(request).await.unwrap();
  assert_eq!(response.status(), StatusCode::OK);
  let body = response.collect().await.unwrap().to_bytes();
  let body = String::from_utf8(body.to_vec()).unwrap();
  println!("{}", body);
  Ok(())
}

#[tokio::main]
async fn main() {
  let cli = Cli::parse();
  dbg!(cli);
  // client(cli.method.unwrap().s, cli.socket_path.unwrap()).await;
}
