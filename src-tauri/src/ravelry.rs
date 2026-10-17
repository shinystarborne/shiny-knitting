//! Ravelry, through its API. Ravelry will not be shown inside another app,
//! but its API answers with data -- a pattern's name, designer, photos,
//! yarn and price -- which the app shows as its own. Buying and downloading
//! stay on Ravelry's site, opened in the browser.
//!
//! The API is used with a personal key the knitter makes on Ravelry's
//! developer page: an access key and a personal key, sent as HTTP basic
//! authentication. It is kept in the library's settings, never in the app,
//! which is published. Ravelry's answers are read loosely: a field missing
//! or named otherwise leaves that detail empty rather than failing.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db;
use crate::models::AppError;

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

const API: &str = "https://api.ravelry.com";
const KEYS: &str = "ravelry_keys";

/// The personal key, as Ravelry gives it, and whose account it is.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct Keys {
    access: String,
    personal: String,
    username: String,
}

/// Whether the API can be used, and as whom; the key itself stays here.
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RavelryAccount {
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

fn keys(state: &AppState) -> Result<Keys, AppError> {
    let k: Keys = db::get_setting(&state.db(), KEYS)?;
    if k.access.is_empty() || k.personal.is_empty() {
        return Err(AppError::Message("Connect your Ravelry account first: paste your personal API key in the Ravelry tab.".into()));
    }
    Ok(k)
}

/// Asks Ravelry, with the key; its refusals said in words.
async fn get(url: &str, k: &Keys) -> Result<Value, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::Message(format!("Could not start a connection: {e}")))?;
    let response = client
        .get(url)
        .basic_auth(&k.access, Some(&k.personal))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| AppError::Message(if e.is_timeout() { "Ravelry took too long to answer.".into() } else { "Ravelry could not be reached. Check that you are online.".into() }))?;
    match response.status().as_u16() {
        200..=299 => response.json::<Value>().await.map_err(|_| AppError::Message("Ravelry's answer could not be read.".into())),
        401 | 403 => Err(AppError::Message("Ravelry didn't accept the key. Check it, and paste it again in the Ravelry tab.".into())),
        404 => Err(AppError::Message("Ravelry has no such pattern.".into())),
        429 => Err(AppError::Message("Ravelry asks to slow down: try again in a minute.".into())),
        code => Err(AppError::Message(format!("Ravelry answered {code}."))),
    }
}

#[tauri::command]
pub fn ravelry_account(state: State<'_, AppState>) -> CmdResult<RavelryAccount> {
    let k: Keys = db::get_setting(&state.db(), KEYS)?;
    Ok(RavelryAccount { connected: !k.access.is_empty() && !k.personal.is_empty(), username: k.username })
}

/// Keeps a personal key, once Ravelry has said whose it is.
#[tauri::command]
pub async fn connect_ravelry(state: State<'_, AppState>, access: String, personal: String) -> CmdResult<RavelryAccount> {
    let mut k = Keys { access: access.trim().to_string(), personal: personal.trim().to_string(), username: String::new() };
    if k.access.is_empty() || k.personal.is_empty() {
        return Err(AppError::Message("Paste both parts of the key: the access key and the personal key.".into()));
    }
    let me = get(&format!("{API}/current_user.json"), &k).await?;
    k.username = text(&me, &["user", "username"]);
    db::set_setting(&state.db(), KEYS, &k)?;
    Ok(RavelryAccount { connected: true, username: k.username })
}

/// Forgets the key.
#[tauri::command]
pub fn disconnect_ravelry(state: State<'_, AppState>) -> CmdResult<()> {
    db::set_setting(&state.db(), KEYS, &Keys::default())
}

#[tauri::command]
pub async fn search_ravelry(state: State<'_, AppState>, query: RavelryQuery) -> CmdResult<RavelrySearch> {
    let k = keys(&state)?;
    Ok(search_answer(&get(&search_address(&query), &k).await?))
}

#[tauri::command]
pub async fn ravelry_pattern(state: State<'_, AppState>, id: i64) -> CmdResult<RavelryPatternDetail> {
    let k = keys(&state)?;
    Ok(detail_answer(&get(&format!("{API}/patterns/{id}.json"), &k).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
