use std::error::Error;
use std::io;

#[cfg(windows)]
async fn windows_main() -> io::Result<()> {
    use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions};

    // const PIPE_NAME: &str = r"\\.\pipe\podman-desktop-companion-docker-Ubuntu-20.041";
    let listen_address = std::env::args().nth(1).expect("Pipe name must be provided");

    // const SOCK_NAME: &str = r"\\wsl$\Ubuntu-20.04\run\docker.sock";
    let socket_path = std::env::args()
        .nth(2)
        .expect("Unix socket WSL path must be provided");

    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(listen_address)?;

    println!("Waiting for connections at {}", listen_address);

    let server = tokio::spawn(async move {
        server.connect().await?;
        let mut server = BufReader::new(server);
        let mut buf = String::new();
        server.read_line(&mut buf).await?;
        println!("Relaying message to socket: {}", buf);
        // server.write_all(b"pong\n").await?;
        Ok::<_, io::Error>(())
    });

    server.await??;
    Ok(())
}

#[cfg(not(windows))]
async fn unix_main() -> io::Result<()> {
    use std::io::{self, Write};
    use std::process::{Command, Stdio};
    use tokio::net::UnixListener;
    let listen_address = std::env::args().nth(1).expect("Pipe name must be provided");
    println!("Waiting for connections at {}", listen_address);
    // See https://stackoverflow.com/questions/49218599/write-to-child-process-stdin-in-rust
    let mut child = Command::new("./relay")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    let listener = UnixListener::bind(listen_address).unwrap();
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                println!("new client!");
            }
            Err(e) => { /* connection failed */ }
        }
    }
}

#[tokio::main]
async fn main() -> io::Result<()> {
    let relay_path = std::env::args()
        .nth(1)
        .expect("Relay path must be provided");
    println!("{}", relay_path);

    #[cfg(windows)]
    {
        windows_main().await?;
    }

    #[cfg(not(windows))]
    {
        unix_main().await?;
    }

    Ok(())
}
