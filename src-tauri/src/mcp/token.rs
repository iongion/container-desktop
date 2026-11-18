// The MCP bearer token: 32 random bytes as hex, kept in the OS keychain (keychain.rs) under its own account. Its
// Debug is redacted so it never reaches a log, and a presented token is compared in constant time.

use std::fmt;

use subtle::ConstantTimeEq;

/// The keychain account, in keychain.rs's service, that holds the token.
pub const TOKEN_ACCOUNT: &str = "mcp-token";
const TOKEN_BYTES: usize = 32;

#[derive(Clone)]
pub struct Token(String);

impl Token {
    pub fn generate() -> Result<Self, String> {
        let mut bytes = [0u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(|e| format!("No randomness for the MCP token: {e}"))?;
        Ok(Token(bytes.iter().map(|byte| format!("{byte:02x}")).collect()))
    }

    /// A stored value counts only in the generated shape; anything else is replaced by a new token.
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        let shaped = value.len() == TOKEN_BYTES * 2 && value.bytes().all(|b| b.is_ascii_hexdigit());
        shaped.then(|| Token(value.to_ascii_lowercase()))
    }

    pub fn matches(&self, presented: &str) -> bool {
        self.0.as_bytes().ct_eq(presented.as_bytes()).into()
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

/// Where the token is kept: the OS keychain in the app, a fake in the tests.
pub trait TokenStore {
    fn load(&self) -> Option<String>;
    fn save(&self, token: &str) -> Result<(), String>;
}

/// The stored token, or a new one, saved before it is used: a token the store does not hold could never be read
/// back by `--mcp-stdio` or shown in the settings.
pub fn ensure_token(store: &dyn TokenStore) -> Result<Token, String> {
    match store.load().as_deref().and_then(Token::parse) {
        Some(token) => Ok(token),
        None => replace_token(store),
    }
}

pub fn replace_token(store: &dyn TokenStore) -> Result<Token, String> {
    let token = Token::generate()?;
    store.save(token.expose())?;
    Ok(token)
}

/// The OS keychain. Storing while the OS vault is unreachable needs the same explicit opt-in as any other secret
/// (`allow_degraded`); reading also finds a token kept in the degraded store.
pub struct KeychainTokenStore {
    pub allow_degraded: bool,
}

impl TokenStore for KeychainTokenStore {
    fn load(&self) -> Option<String> {
        crate::keychain::keychain_get(TOKEN_ACCOUNT)
    }

    fn save(&self, token: &str) -> Result<(), String> {
        crate::keychain::store_secret(TOKEN_ACCOUNT, token, self.allow_degraded).map_err(|error| {
            let backend = crate::keychain::keychain_backend_name().unwrap_or_else(|| "OS keychain".into());
            format!(
                "The MCP token could not be stored in the {backend} ({error}), so the MCP server stays off. Storing it \
                 outside the OS keychain needs your explicit consent."
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeStore {
        held: RefCell<Option<String>>,
        refuse: bool,
        saves: RefCell<usize>,
    }

    impl TokenStore for FakeStore {
        fn load(&self) -> Option<String> {
            self.held.borrow().clone()
        }
        fn save(&self, token: &str) -> Result<(), String> {
            if self.refuse {
                return Err("vault unavailable".into());
            }
            *self.saves.borrow_mut() += 1;
            *self.held.borrow_mut() = Some(token.to_string());
            Ok(())
        }
    }

    #[test]
    fn mcp_token_is_32_random_bytes_in_hex() {
        let first = Token::generate().unwrap();
        let second = Token::generate().unwrap();
        assert_eq!(first.expose().len(), 64);
        assert!(first.expose().bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_ne!(first.expose(), second.expose());
    }

    #[test]
    fn mcp_token_debug_never_shows_the_secret() {
        let token = Token::generate().unwrap();
        let printed = format!("{token:?}");
        assert!(!printed.contains(token.expose()));
        assert_eq!(printed, "Token(<redacted>)");
    }

    #[test]
    fn mcp_token_matches_only_itself() {
        let token = Token::generate().unwrap();
        assert!(token.matches(token.expose()));
        assert!(!token.matches(&token.expose()[..63]));
        assert!(!token.matches(""));
        assert!(!token.matches(&"0".repeat(64)));
    }

    #[test]
    fn mcp_token_parse_takes_only_the_generated_shape() {
        let upper = "AB".repeat(32);
        assert_eq!(Token::parse(&upper).unwrap().expose(), "ab".repeat(32));
        assert!(Token::parse("short").is_none());
        assert!(Token::parse(&"g".repeat(64)).is_none());
        assert!(Token::parse("").is_none());
    }

    #[test]
    fn mcp_ensure_token_creates_and_saves_one_when_none_is_stored() {
        let store = FakeStore::default();
        let token = ensure_token(&store).unwrap();
        assert_eq!(store.held.borrow().as_deref(), Some(token.expose()));
        assert_eq!(*store.saves.borrow(), 1);
    }

    #[test]
    fn mcp_ensure_token_reuses_the_stored_token() {
        let stored = "c".repeat(64);
        let store = FakeStore {
            held: RefCell::new(Some(stored.clone())),
            ..FakeStore::default()
        };
        assert_eq!(ensure_token(&store).unwrap().expose(), stored);
        assert_eq!(*store.saves.borrow(), 0);
    }

    #[test]
    fn mcp_ensure_token_replaces_a_malformed_stored_value() {
        let store = FakeStore {
            held: RefCell::new(Some("not-a-token".into())),
            ..FakeStore::default()
        };
        let token = ensure_token(&store).unwrap();
        assert_ne!(token.expose(), "not-a-token");
        assert_eq!(store.held.borrow().as_deref(), Some(token.expose()));
    }

    #[test]
    fn mcp_ensure_token_fails_when_the_token_cannot_be_stored() {
        let store = FakeStore {
            refuse: true,
            ..FakeStore::default()
        };
        assert_eq!(ensure_token(&store).unwrap_err(), "vault unavailable");
    }

    #[test]
    fn mcp_replace_token_always_stores_a_new_one() {
        let store = FakeStore::default();
        let first = ensure_token(&store).unwrap();
        let second = replace_token(&store).unwrap();
        assert_ne!(first.expose(), second.expose());
        assert_eq!(store.held.borrow().as_deref(), Some(second.expose()));
    }
}
