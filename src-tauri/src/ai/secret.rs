//! Wraps the OpenRouter API key with Windows DPAPI.
//!
//! The key is stored in the local database, which is a plain file in the app
//! data folder. DPAPI (`CryptProtectData` with no machine flag) means the
//! ciphertext can only be decrypted by the same Windows user account on the
//! same machine, so another program running as that user still cannot read it
//! out of the file.
//!
//! If DPAPI is unavailable the key is not stored at all. Losing the setting is
//! an annoyance; writing a secret in the clear is a real exposure, so it is
//! the better failure.

use base64::Engine;
use windows::Win32::Foundation::{GetLastError, LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
};

/// Marks a stored value as having been encrypted, so a future version can tell
/// an encrypted key from a plaintext one left by an older build.
const PREFIX: &str = "dpapi:";

fn to_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    }
}

/// Takes ownership of a buffer DPAPI allocated and frees it.
///
/// CryptProtectData allocates with LocalAlloc, so the copy has to be released
/// or it leaks on every call.
unsafe fn take_buffer(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let slice = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize);
    let owned = slice.to_vec();
    let _ = LocalFree(Some(HLOCAL(blob.pbData as *mut _)));
    owned
}

/// Encrypts a secret for storage.
pub fn encrypt(plaintext: &str) -> Result<String, String> {
    unsafe {
        let input = to_blob(plaintext.as_bytes());
        let mut output = CRYPT_INTEGER_BLOB::default();
        // CRYPTPROTECT_UI_FORBIDDEN, and no CRYPTPROTECT_LOCAL_MACHINE, so the
        // scope is the current user.
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| {
            // WIN32_ERROR is a newtype over a u32 and does not implement
            // Display, so its code is formatted by hand.
            let code = GetLastError().0;
            format!("Windows could not protect the API key (error {code}).")
        })?;

        let bytes = take_buffer(output);
        Ok(format!(
            "{PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }
}

/// Decrypts a stored secret. Returns the plaintext, or an empty string when
/// there is nothing stored or it cannot be read.
pub fn decrypt(stored: &str) -> Result<String, String> {
    let encoded = match stored.strip_prefix(PREFIX) {
        Some(rest) => rest,
        // Not one of ours; treat as absent rather than guessing.
        None => return Ok(String::new()),
    };
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("the stored API key is not readable ({e})."))?;

    unsafe {
        let input = to_blob(&raw);
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| {
            "Windows could not unlock the API key. It was saved under a different \
             Windows account, so it needs entering again."
                .to_string()
        })?;
        let bytes = take_buffer(output);
        String::from_utf8(bytes).map_err(|_| "the stored API key is not valid text.".to_string())
    }
}

/// True when a stored value looks like a DPAPI blob.
pub fn is_encrypted(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The round trip is the whole point; without it the key is just noise.
    #[test]
    fn round_trips_a_secret() {
        let secret = "sk-or-v1-abc123-XYZ";
        let stored = encrypt(secret).expect("encrypt");
        assert!(is_encrypted(&stored));
        // The plaintext must not be sitting in the stored value.
        assert!(!stored.contains(secret));
        assert_eq!(decrypt(&stored).expect("decrypt"), secret);
    }

    #[test]
    fn round_trips_an_empty_string() {
        let stored = encrypt("").expect("encrypt");
        assert_eq!(decrypt(&stored).expect("decrypt"), "");
    }

    #[test]
    fn round_trips_unicode() {
        let secret = "clé-secrète- knitting-patterns";
        let stored = encrypt(secret).expect("encrypt");
        assert_eq!(decrypt(&stored).expect("decrypt"), secret);
    }

    #[test]
    fn a_long_secret_survives() {
        let secret = "x".repeat(2000);
        let stored = encrypt(&secret).expect("encrypt");
        assert_eq!(decrypt(&stored).expect("decrypt").len(), 2000);
    }

    /// Repeated calls must not corrupt the allocator, since each one takes
    /// ownership of a DPAPI buffer.
    #[test]
    fn repeated_round_trips_are_stable() {
        for i in 0..200 {
            let secret = format!("secret-{i}");
            let stored = encrypt(&secret).expect("encrypt");
            assert_eq!(decrypt(&stored).expect("decrypt"), secret);
        }
    }

    #[test]
    fn a_plaintext_value_decrypts_to_nothing() {
        // An unrecognised value is treated as absent, not as a key.
        assert_eq!(decrypt("sk-plaintext").expect("decrypt"), "");
        assert_eq!(decrypt("").expect("decrypt"), "");
    }

    #[test]
    fn corrupt_ciphertext_is_an_error_not_a_panic() {
        assert!(decrypt("dpapi:not-valid-base64!!").is_err());
    }
}
