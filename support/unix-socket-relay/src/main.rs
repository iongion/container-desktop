use std::io;
use std::io::prelude::*;
use std::os::unix::net::UnixStream;

// static HTTP_PING: &str= "GET /_ping HTTP/1.1\r\nAccept: application/json\r\nContent-Type: application/json\r\nUser-Agent: axios/0.25.0\r\nHost: localhost\r\nConnection: close\r\n\r\n";

fn main() -> std::io::Result<()> {
  let socket_path = std::env::args().nth(1).expect("no pattern given");
  let mut buffer = String::new();
  io::stdin().read_to_string(&mut buffer)?;
  let mut stream = UnixStream::connect(socket_path)?;
  stream.write_all(buffer.as_bytes())?;
  // stream.write_all(HTTP_PING.as_bytes())?;
  let mut response = String::new();
  stream.read_to_string(&mut response)?;
  println!("{}", response);
  Ok(())
}
