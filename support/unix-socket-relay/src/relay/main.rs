use std::io;
use std::io::prelude::*;
use std::os::unix::net::UnixStream;

fn main() -> std::io::Result<()> {
    let socket_path = std::env::args()
        .nth(1)
        .expect("Unix socket path must be provided");
    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer)?;
    let mut stream = UnixStream::connect(socket_path)?;
    stream.write_all(buffer.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    print!("{}", response);
    Ok(())
}
