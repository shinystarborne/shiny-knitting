//! Ravelry, through its API. Ravelry will not be shown inside another app,
//! but its API answers with data -- a pattern's name, designer, photos,
//! yarn and price -- which the app shows as its own. Buying and downloading
//! stay on Ravelry's site, opened in the browser.
//!
//! The knitter signs in with Ravelry (OAuth 2.0): the app is registered with
//! Ravelry once, its client id and secret built into the installers from a
//! file kept out of the repository (`src-tauri/.env.ravelry`, read by
//! build.rs). Signing in opens Ravelry in the browser; approved there,
//! Ravelry sends the browser, with a code, to a page of the app's on GitHub
//! Pages (Ravelry takes only https addresses back), which passes it at once
//! to a port the app listens on, for that moment only, on this computer.
//! The app exchanges the code for tokens.
//! Those are kept in the settings encrypted for this Windows account
//! (DPAPI), as the model's key is, and renewed as they run out.
//!
//! Ravelry's answers are read loosely: a field missing or named otherwise
//! leaves that detail empty rather than failing.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db;
use crate::models::AppError;

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

const API: &str = "https://api.ravelry.com";
const AUTHORIZE: &str = "https://www.ravelry.com/oauth2/auth";
const TOKEN: &str = "https://www.ravelry.com/oauth2/token";
/// The page Ravelry sends the browser back to, as registered with Ravelry:
/// static, on GitHub Pages (docs/ravelry/), passing the answer to PORT.
const RETURN: &str = "https://shinystarborne.github.io/shiny-knitting/ravelry/";
/// The port on this computer the page passes the answer to.
const PORT: u16 = 47851;
const SIGNED_IN: &str = "ravelry_oauth";

/// The app as registered with Ravelry, built in; absent from a build without the file.
const CLIENT_ID: Option<&str> = option_env!("RAVELRY_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("RAVELRY_CLIENT_SECRET");

fn redirect() -> String {
    RETURN.to_string()
}

fn client() -> Option<(&'static str, &'static str)> {
    match (CLIENT_ID, CLIENT_SECRET) {
        (Some(id), Some(secret)) if !id.trim().is_empty() && !secret.trim().is_empty() => Some((id.trim(), secret.trim())),
        _ => None,
    }
}

/// A signing-in as kept: the tokens encrypted, when the access one runs out, whose it is.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct SignedIn {
    access: String,
    refresh: String,
    /// Milliseconds since 1970.
    expires_at: i64,
    username: String,
}

/// Whether Ravelry can be searched, and as whom; the tokens themselves stay here.
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RavelryAccount {
    /// Whether this copy of the app can sign in with Ravelry at all.
    pub available: bool,
    pub connected: bool,
    pub username: String,
}

/// A pattern as a search lists it.
#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RavelryPattern {
    pub id: i64,
    pub name: String,
    pub designer: String,
    /// Its page on Ravelry, to buy or read it there.
    pub url: String,
    /// A photo, small, for its card; "" when it has none.
    pub photo: String,
    pub free: bool,
}

/// A page of a search, and how many pages there are.
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RavelrySearch {
    pub patterns: Vec<RavelryPattern>,
    pub page: i64,
    pub pages: i64,
    pub results: i64,
}

/// One pattern, as much as is said of it.
#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RavelryPatternDetail {
    pub id: i64,
    pub name: String,
    pub designer: String,
    pub url: String,
    pub photos: Vec<String>,
    pub free: bool,
    /// "6.00 EUR", or "" when free or not said.
    pub price: String,
    pub craft: String,
    pub yarn_weight: String,
    /// "1200–1500 yards", or "".
    pub yardage: String,
    pub needles: String,
    pub gauge: String,
    pub categories: Vec<String>,
    /// Its notes, as text.
    pub notes: String,
}

/// The search's choices: words, craft, free only, and the order.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RavelryQuery {
    pub query: String,
    /// "knitting", "crochet", or "" for any.
    pub craft: String,
    pub free: bool,
    /// "", "popular" or "date".
    pub sort: String,
    pub page: i64,
}

fn text(v: &Value, path: &[&str]) -> String {
    let mut at = v;
    for key in path {
        at = match at.get(*key) {
            Some(next) => next,
            None => return String::new(),
        };
    }
    match at {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// A pattern's designer: its author, else its designer, as Ravelry names them.
fn designer(p: &Value) -> String {
    let author = text(p, &["pattern_author", "name"]);
    if author.is_empty() { text(p, &["designer", "name"]) } else { author }
}

fn page_url(p: &Value) -> String {
    let permalink = text(p, &["permalink"]);
    if permalink.is_empty() { String::new() } else { format!("https://www.ravelry.com/patterns/library/{permalink}") }
}

/// A pattern as a search lists it, from Ravelry's answer.
pub fn listed(p: &Value) -> RavelryPattern {
    let photo = ["small2_url", "small_url", "medium_url", "square_url"]
        .iter()
        .map(|k| text(p, &["first_photo", k]))
        .find(|u| !u.is_empty())
        .unwrap_or_default();
    RavelryPattern {
        id: p.get("id").and_then(Value::as_i64).unwrap_or(0),
        name: text(p, &["name"]),
        designer: designer(p),
        url: page_url(p),
        photo,
        free: p.get("free").and_then(Value::as_bool).unwrap_or(false),
    }
}

/// A search's answer: its patterns, and where in it this page is.
pub fn search_answer(v: &Value) -> RavelrySearch {
    let patterns = v.get("patterns").and_then(Value::as_array).map(|a| a.iter().map(listed).collect()).unwrap_or_default();
    let n = |k: &str| v.get("paginator").and_then(|p| p.get(k)).and_then(Value::as_i64).unwrap_or(0);
    RavelrySearch { patterns, page: n("page").max(1), pages: n("page_count").max(1), results: n("results") }
}

/// One pattern's answer, as the details shown.
pub fn detail_answer(v: &Value) -> RavelryPatternDetail {
    let p = v.get("pattern").unwrap_or(v);
    let free = p.get("free").and_then(Value::as_bool).unwrap_or(false);
    let price = {
        // A number with its cents, as a price is written; else as said.
        let amount = p.get("price").and_then(Value::as_f64).filter(|n| *n > 0.0).map(|n| format!("{n:.2}")).unwrap_or_else(|| text(p, &["price"]));
        let currency = text(p, &["currency"]);
        if free || amount.is_empty() { String::new() } else { format!("{amount} {currency}").trim().to_string() }
    };
    let yardage = {
        let (lo, hi) = (text(p, &["yardage"]), text(p, &["yardage_max"]));
        match (lo.is_empty(), hi.is_empty() || hi == lo) {
            (true, _) => String::new(),
            (false, true) => format!("{lo} yards"),
            (false, false) => format!("{lo}–{hi} yards"),
        }
    };
    let needles = p
        .get("pattern_needle_sizes")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|n| text(n, &["name"])).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    let photos = p
        .get("photos")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|ph| ["medium2_url", "medium_url", "small2_url", "small_url"].iter().map(|k| text(ph, &[k])).find(|u| !u.is_empty())).collect())
        .unwrap_or_default();
    let categories = p
        .get("pattern_categories")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|c| text(c, &["name"])).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    RavelryPatternDetail {
        id: p.get("id").and_then(Value::as_i64).unwrap_or(0),
        name: text(p, &["name"]),
        designer: designer(p),
        url: page_url(p),
        photos,
        free,
        price,
        craft: text(p, &["craft", "name"]),
        yarn_weight: text(p, &["yarn_weight", "name"]),
        yardage,
        needles,
        gauge: text(p, &["gauge_description"]),
        categories,
        notes: text(p, &["notes"]),
    }
}

/// A value for a URL, as the web writes it: letters, digits and -._~ as
/// they are, the rest as %XX.
fn escaped(v: &str) -> String {
    v.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// PKCE's challenge for a verifier: its SHA-256, base64url without padding.
pub fn challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()))
}

/// Where the browser is sent to sign in: Ravelry's page, asking for a code
/// back here, the renewal kept ("offline").
pub fn authorize_address(client_id: &str, state: &str, verifier: &str) -> String {
    format!(
        "{AUTHORIZE}?response_type=code&client_id={}&redirect_uri={}&scope=offline&state={}&code_challenge={}&code_challenge_method=S256",
        escaped(client_id),
        escaped(&redirect()),
        escaped(state),
        challenge(verifier)
    )
}

/// What came back to the app's port: the code, if it is the answer to this
/// signing-in; else why not. None for another request (a favicon).
pub fn callback(request_line: &str, state: &str) -> Option<Result<String, AppError>> {
    let target = request_line.split_whitespace().nth(1)?;
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != "/ravelry" {
        return None;
    }
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.to_string());
    if let Some(error) = get("error") {
        return Some(Err(AppError::Message(if error == "access_denied" { "Access to Ravelry was denied; not signed in.".into() } else { format!("Ravelry refused: {error}.") })));
    }
    if get("state").as_deref() != Some(state) {
        return Some(Err(AppError::Message("That response doesn't match this sign-in. Try again.".into())));
    }
    Some(get("code").filter(|c| !c.is_empty()).ok_or_else(|| AppError::Message("No code received from Ravelry. Try again.".into())))
}

/// The search's address, its choices as Ravelry takes them.
pub fn search_address(q: &RavelryQuery) -> String {
    let mut url = reqwest::Url::parse(&format!("{API}/patterns/search.json")).expect("a fixed address");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("query", q.query.trim());
        pairs.append_pair("page", &q.page.max(1).to_string());
        pairs.append_pair("page_size", "24");
        if matches!(q.craft.as_str(), "knitting" | "crochet") {
            pairs.append_pair("craft", &q.craft);
        }
        if q.free {
            pairs.append_pair("availability", "free");
        }
        if matches!(q.sort.as_str(), "popular" | "date") {
            pairs.append_pair("sort", &q.sort);
        }
    }
    url.to_string()
}

fn http() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::Message(format!("Could not start a connection: {e}")))
}

fn unreachable(e: reqwest::Error) -> AppError {
    AppError::Message(if e.is_timeout() { "Ravelry took too long to answer.".into() } else { "Ravelry could not be reached. Check that you are online.".into() })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn signed_in(state: &AppState) -> Result<SignedIn, AppError> {
    let s: SignedIn = db::get_setting(&state.db(), SIGNED_IN)?;
    if s.access.is_empty() {
        return Err(AppError::Message("Sign in with Ravelry first, in the Ravelry tab.".into()));
    }
    Ok(s)
}

/// Kept encrypted for this Windows account; not kept at all if that fails.
fn keep(state: &AppState, access: &str, refresh: &str, expires_in: i64, username: &str) -> Result<(), AppError> {
    let seal = |v: &str| if v.is_empty() { Ok(String::new()) } else { crate::ai::secret::encrypt(v).map_err(|e| AppError::Message(format!("The sign-in could not be stored securely: {e}"))) };
    let kept = SignedIn { access: seal(access)?, refresh: seal(refresh)?, expires_at: now_ms() + expires_in.max(60) * 1000, username: username.to_string() };
    db::set_setting(&state.db(), SIGNED_IN, &kept)
}

fn unseal(v: &str) -> Result<String, AppError> {
    crate::ai::secret::decrypt(v).map_err(|_| AppError::Message("The Ravelry sign-in could not be read: sign in again.".into()))
}

/// Asks Ravelry's token address, as the registered app: tokens for a code, or renewed ones.
async fn tokens(form: &[(&str, &str)]) -> Result<(String, String, i64), AppError> {
    let (id, secret) = client().ok_or_else(|| AppError::Message("This build has no Ravelry sign-in.".into()))?;
    let response = http()?.post(TOKEN).basic_auth(id, Some(secret)).form(form).send().await.map_err(unreachable)?;
    if !response.status().is_success() {
        return Err(AppError::Message(format!("Ravelry sign-in failed ({}). Try again.", response.status().as_u16())));
    }
    let v: Value = response.json().await.map_err(|_| AppError::Message("Ravelry's response could not be read.".into()))?;
    let access = text(&v, &["access_token"]);
    if access.is_empty() {
        return Err(AppError::Message("No token received from Ravelry. Try again.".into()));
    }
    let expires = v.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    Ok((access, text(&v, &["refresh_token"]), expires))
}

/// The access token, renewed first when it has run out, or is about to.
async fn access(state: &AppState, force: bool) -> Result<String, AppError> {
    let s = signed_in(state)?;
    if !force && s.expires_at > now_ms() + 60_000 {
        return unseal(&s.access);
    }
    let refresh = if s.refresh.is_empty() { String::new() } else { unseal(&s.refresh)? };
    if refresh.is_empty() {
        return Err(AppError::Message("The Ravelry sign-in has expired. Sign in again.".into()));
    }
    let (access, renewed, expires) = tokens(&[("grant_type", "refresh_token"), ("refresh_token", &refresh)])
        .await
        .map_err(|_| AppError::Message("The Ravelry sign-in has expired. Sign in again.".into()))?;
    // Ravelry may keep the same refresh token, or give a new one.
    keep(state, &access, if renewed.is_empty() { &refresh } else { &renewed }, expires, &s.username)?;
    Ok(access)
}

/// Asks Ravelry's API as the knitter signed in; a refusal tried once more
/// with a renewed token, then said in words.
async fn get(state: &AppState, url: &str) -> Result<Value, AppError> {
    let mut token = access(state, false).await?;
    for again in [false, true] {
        let response = http()?.get(url).bearer_auth(&token).header(reqwest::header::ACCEPT, "application/json").send().await.map_err(unreachable)?;
        match response.status().as_u16() {
            200..=299 => return response.json::<Value>().await.map_err(|_| AppError::Message("Ravelry's response could not be read.".into())),
            401 if !again => token = access(state, true).await?,
            401 | 403 => return Err(AppError::Message("Ravelry refused access. Sign in again in the Ravelry tab.".into())),
            404 => return Err(AppError::Message("Ravelry has no such pattern.".into())),
            429 => return Err(AppError::Message("Ravelry asked to slow down. Try again in a minute.".into())),
            code => return Err(AppError::Message(format!("Ravelry returned {code}."))),
        }
    }
    unreachable!("the second try returns")
}

#[tauri::command]
pub fn ravelry_account(state: State<'_, AppState>) -> CmdResult<RavelryAccount> {
    let s: SignedIn = db::get_setting(&state.db(), SIGNED_IN)?;
    Ok(RavelryAccount { available: client().is_some(), connected: !s.access.is_empty(), username: s.username })
}

/// Waits on the app's port for Ravelry's answer, five minutes at most, and
/// says in the browser that it is done.
fn wait_for_code(listener: std::net::TcpListener, state: &str) -> Result<String, AppError> {
    use std::io::{Read, Write};
    listener.set_nonblocking(true)?;
    let until = std::time::Instant::now() + Duration::from_secs(300);
    while std::time::Instant::now() < until {
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let line = request.lines().next().unwrap_or("");
        let Some(answer) = callback(line, state) else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        };
        let words = if answer.is_ok() { "Signed in with Ravelry. You can close this tab and go back to Shiny Knitting." } else { "Not signed in. Go back to Shiny Knitting to try again." };
        let page = format!("<!doctype html><meta charset=\"utf-8\"><title>Shiny Knitting</title><body style=\"font:16px system-ui;padding:40px;background:#1c1b1f;color:#eee\"><p>{words}</p></body>");
        let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
        return answer;
    }
    Err(AppError::Message("No answer from Ravelry within five minutes. Try again.".into()))
}

/// Signs in with Ravelry: its page in the browser, the answer caught on the
/// app's port, the code exchanged for tokens, kept; whose they are asked.
#[tauri::command]
pub async fn sign_in_ravelry(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<RavelryAccount> {
    let (id, _) = client().ok_or_else(|| AppError::Message("This build has no Ravelry sign-in.".into()))?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", PORT))
        .map_err(|_| AppError::Message(format!("Can't receive Ravelry's response: port {PORT} is in use. Close the program using it, or try again.")))?;
    let state_word = uuid::Uuid::new_v4().simple().to_string();
    let verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    crate::external::open_link(authorize_address(id, &state_word, &verifier))?;
    let expected = state_word.clone();
    let code = tokio::task::spawn_blocking(move || wait_for_code(listener, &expected))
        .await
        .map_err(|e| AppError::Message(format!("Signing in stopped: {e}")))??;
    let redirect = redirect();
    let (access, refresh, expires) = tokens(&[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier)]).await?;
    keep(&state, &access, &refresh, expires, "")?;
    // Whose it is; the sign-in stands without it.
    let username = get(&state, &format!("{API}/current_user.json")).await.map(|me| text(&me, &["user", "username"])).unwrap_or_default();
    if !username.is_empty() {
        keep(&state, &access, &refresh, expires, &username)?;
    }
    if let Some(window) = tauri::Manager::get_webview_window(&app, "main") {
        let _ = window.set_focus();
    }
    Ok(RavelryAccount { available: true, connected: true, username })
}

/// Forgets the sign-in.
#[tauri::command]
pub fn disconnect_ravelry(state: State<'_, AppState>) -> CmdResult<()> {
    db::set_setting(&state.db(), SIGNED_IN, &SignedIn::default())
}

#[tauri::command]
pub async fn search_ravelry(state: State<'_, AppState>, query: RavelryQuery) -> CmdResult<RavelrySearch> {
    Ok(search_answer(&get(&state, &search_address(&query)).await?))
}

#[tauri::command]
pub async fn ravelry_pattern(state: State<'_, AppState>, id: i64) -> CmdResult<RavelryPatternDetail> {
    Ok(detail_answer(&get(&state, &format!("{API}/patterns/{id}.json")).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn signing_in_asks_ravelry_and_knows_its_answer() {
        // PKCE's challenge, as Python's hashlib and base64 work it out.
        assert_eq!(challenge("shinyknittingverifier0123456789abcdefghijklmnopqrstuv"), "bPJyBI9_JeTzWv1Dop8RNkn7z1HPkNr20fDj29yAq7I");
        let url = authorize_address("my app", "s1", "shinyknittingverifier0123456789abcdefghijklmnopqrstuv");
        assert_eq!(
            url,
            "https://www.ravelry.com/oauth2/auth?response_type=code&client_id=my%20app&redirect_uri=https%3A%2F%2Fshinystarborne.github.io%2Fshiny-knitting%2Fravelry%2F&scope=offline&state=s1&code_challenge=bPJyBI9_JeTzWv1Dop8RNkn7z1HPkNr20fDj29yAq7I&code_challenge_method=S256"
        );
        assert_eq!(callback("GET /ravelry?code=abc&state=s1 HTTP/1.1", "s1").unwrap().unwrap(), "abc");
        assert!(callback("GET /favicon.ico HTTP/1.1", "s1").is_none(), "another request is not the answer");
        assert!(callback("GET /ravelry?code=abc&state=other HTTP/1.1", "s1").unwrap().unwrap_err().to_string().contains("doesn't match this sign-in"));
        assert!(callback("GET /ravelry?error=access_denied&state=s1 HTTP/1.1", "s1").unwrap().unwrap_err().to_string().contains("was denied"));
        assert!(callback("GET /ravelry?state=s1 HTTP/1.1", "s1").unwrap().is_err(), "no code");
    }

    #[test]
    fn a_search_is_asked_with_its_choices() {
        let url = search_address(&RavelryQuery { query: " lopapeysa yoke ".into(), craft: "knitting".into(), free: true, sort: "popular".into(), page: 2 });
        assert_eq!(url, "https://api.ravelry.com/patterns/search.json?query=lopapeysa+yoke&page=2&page_size=24&craft=knitting&availability=free&sort=popular");
        let plain = search_address(&RavelryQuery { query: "hat".into(), craft: "lego".into(), sort: "nonsense".into(), ..Default::default() });
        assert_eq!(plain, "https://api.ravelry.com/patterns/search.json?query=hat&page=1&page_size=24", "unknown choices are left out");
    }

    #[test]
    fn a_search_answer_is_read_loosely() {
        let v = json!({
            "patterns": [
                { "id": 1, "name": "Riddari", "permalink": "riddari", "free": false,
                  "pattern_author": { "name": "Védís Jónsdóttir" }, "first_photo": { "small_url": "https://images4-f.ravelrycache.com/a.jpg" } },
                { "id": 2, "name": "Hitchhiker", "permalink": "hitchhiker", "designer": { "name": "Martina Behm" } },
                { "name": "No id" }
            ],
            "paginator": { "page": 1, "page_count": 40, "results": 960 }
        });
        let s = search_answer(&v);
        assert_eq!((s.page, s.pages, s.results, s.patterns.len()), (1, 40, 960, 3));
        assert_eq!(s.patterns[0], RavelryPattern { id: 1, name: "Riddari".into(), designer: "Védís Jónsdóttir".into(), url: "https://www.ravelry.com/patterns/library/riddari".into(), photo: "https://images4-f.ravelrycache.com/a.jpg".into(), free: false });
        assert_eq!((s.patterns[1].designer.as_str(), s.patterns[1].photo.as_str()), ("Martina Behm", ""), "a designer where no author, no photo");
        assert_eq!(s.patterns[2].url, "", "no permalink, no page");
        assert_eq!(search_answer(&json!({})).patterns.len(), 0, "an answer with nothing in it is no patterns");
    }

    #[test]
    fn a_pattern_answer_is_read_loosely() {
        let v = json!({ "pattern": {
            "id": 7, "name": "Riddari", "permalink": "riddari", "free": false, "price": 6.0, "currency": "EUR",
            "craft": { "name": "Knitting" }, "yarn_weight": { "name": "Aran" }, "yardage": 1200, "yardage_max": 1500,
            "pattern_needle_sizes": [{ "name": "US 6 - 4.0 mm" }, { "name": "US 8 - 5.0 mm" }],
            "gauge_description": "18 sts and 24 rows = 10 cm", "pattern_categories": [{ "name": "Pullover" }],
            "photos": [{ "medium_url": "https://images4-f.ravelrycache.com/m.jpg" }, { "small_url": "https://images4-f.ravelrycache.com/s.jpg" }],
            "notes": "Knitted bottom up."
        }});
        let d = detail_answer(&v);
        assert_eq!((d.price.as_str(), d.yarn_weight.as_str(), d.yardage.as_str(), d.craft.as_str()), ("6.00 EUR", "Aran", "1200–1500 yards", "Knitting"));
        assert_eq!(d.needles, "US 6 - 4.0 mm, US 8 - 5.0 mm");
        assert_eq!(d.photos, vec!["https://images4-f.ravelrycache.com/m.jpg".to_string(), "https://images4-f.ravelrycache.com/s.jpg".to_string()]);
        assert_eq!((d.categories.len(), d.notes.as_str()), (1, "Knitted bottom up."));
        let free = detail_answer(&json!({ "pattern": { "name": "Free hat", "free": true, "price": 0 } }));
        assert_eq!((free.free, free.price.as_str(), free.yardage.as_str()), (true, "", ""), "a free one has no price");
    }
}
