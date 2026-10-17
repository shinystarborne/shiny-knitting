fn main() {
    // Ravelry's sign-in: the app as registered with Ravelry, its client id
    // and secret built in from a file kept out of the repository. Without
    // it, the app builds all the same and says it cannot sign in.
    println!("cargo:rerun-if-changed=.env.ravelry");
    if let Ok(text) = std::fs::read_to_string(".env.ravelry") {
        for line in text.lines() {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                if key == "RAVELRY_CLIENT_ID" || key == "RAVELRY_CLIENT_SECRET" {
                    println!("cargo:rustc-env={key}={}", value.trim());
                }
            }
        }
    }
    tauri_build::build()
}
