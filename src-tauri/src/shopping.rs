//! Shops and the wishlist: where you buy, and what you want to get.
//!
//! Both are mostly words as you typed them. What is worth a module is the web
//! address, which both have: one typed as `drops.com` or copied with a stray
//! space is tidied into a link that opens, and anything that is not a web
//! address is refused here, so every stored link is one `open_link` will open.

use tauri::State;

use crate::db;
use crate::models::{AppError, LinkPreview, Shop, ShopInput, Wish, WishInput, WISH_KINDS};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// Longer than any shop's product page, short of a pasted paragraph.
const MAX_URL: usize = 2000;

/// A web address made to open: `https://` added when none was typed, and
/// anything other than http or https refused. Empty stays empty.
pub fn web_address(value: &str) -> Result<String, AppError> {
    let typed = value.trim();
    if typed.is_empty() {
        return Ok(String::new());
    }
    let refuse = || AppError::Message(format!("“{}” is not a web address. Give one like https://www.drops.com, or drops.com.", short(typed)));
    if typed.chars().any(|c| c.is_whitespace() || c.is_control()) || typed.len() > MAX_URL {
        return Err(refuse());
    }
    let lower = typed.to_ascii_lowercase();
    let url = if lower.starts_with("https://") || lower.starts_with("http://") {
        let split = typed.find("://").unwrap_or(0);
        format!("{}{}", typed[..split].to_ascii_lowercase(), &typed[split..])
    } else if typed.contains("://") || has_scheme(typed) {
        // ftp://, file://, javascript:, mailto: — none of them a shop's page.
        return Err(refuse());
    } else {
        format!("https://{}", typed.trim_start_matches('/'))
    };
    // A host with a dot in it: "drops" on its own is a name typed in the
    // wrong box, not an address.
    if !host(&url).contains('.') {
        return Err(refuse());
    }
    Ok(url)
}

/// Whether the text starts with a scheme like `mailto:` or `javascript:`, as
/// opposed to a host with a port like `shop.com:8080`.
fn has_scheme(text: &str) -> bool {
    match text.split_once(':') {
        Some((before, _)) => {
            !before.is_empty()
                && before.chars().all(|c| c.is_ascii_alphanumeric() || "+-".contains(c))
                && before.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && !before.contains('.')
        }
        None => false,
    }
}

/// The host of an http or https address, lower case, without a port or a
/// login: `https://www.Drops.com:443/x` is `www.drops.com`.
pub fn host(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = authority.split(':').next().unwrap_or("");
    host.to_ascii_lowercase()
}

/// The start of something long, for a message about it.
fn short(text: &str) -> String {
    let cut: String = text.chars().take(60).collect();
    if cut.len() < text.len() { format!("{cut}…") } else { cut }
}

/// Words on one line, with runs of spaces made one, cut at `max` characters.
fn line(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// An id that may be blank, which is none.
fn link(id: Option<String>) -> Option<String> {
    id.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// A shop's tags: each on one line, without a leading `#`, and the same tag
/// only once whatever its case, the first spelling kept.
pub fn tidy_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = line(tag.trim().trim_start_matches('#'), 40);
        if !tag.is_empty() && !out.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) {
            out.push(tag);
        }
    }
    out.truncate(30);
    out
}

/// Makes a shop ready to store. A shop given only its address is named after
/// it, `www.drops.com` as `drops.com`.
pub fn clean_shop(input: ShopInput) -> Result<ShopInput, AppError> {
    let url = web_address(&input.url)?;
    let mut name = line(&input.name, 120);
    if name.is_empty() {
        let h = host(&url);
        name = h.strip_prefix("www.").unwrap_or(&h).to_string();
    }
    if name.is_empty() {
        return Err(AppError::Message("Give the shop a name, or its web address.".to_string()));
    }
    Ok(ShopInput {
        name,
        url,
        comment: input.comment.trim().chars().take(4000).collect(),
        tags: tidy_tags(&input.tags),
    })
}

/// Makes a wishlist item ready to store.
pub fn clean_wish(input: WishInput) -> Result<WishInput, AppError> {
    let kind = input.kind.trim().to_lowercase();
    if !WISH_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Message("Choose what kind of thing this is.".to_string()));
    }
    let name = line(&input.name, 200);
    if name.is_empty() {
        return Err(AppError::Message("Say what it is you want to get.".to_string()));
    }
    Ok(WishInput {
        kind,
        name,
        brand: line(&input.brand, 80),
        amount: line(&input.amount, 80),
        price: line(&input.price, 80),
        url: web_address(&input.url)?,
        shop_id: link(input.shop_id),
        project_id: link(input.project_id),
        notes: input.notes.trim().chars().take(4000).collect(),
    })
}

#[tauri::command]
pub fn list_shops(state: State<'_, AppState>) -> CmdResult<Vec<Shop>> {
    db::list_shops(&state.db())
}

#[tauri::command]
pub fn add_shop(state: State<'_, AppState>, input: ShopInput) -> CmdResult<Shop> {
    let input = clean_shop(input)?;
    db::insert_shop(&state.db(), &uuid::Uuid::new_v4().to_string(), &input)
}

#[tauri::command]
pub fn update_shop(state: State<'_, AppState>, id: String, input: ShopInput) -> CmdResult<Shop> {
    let input = clean_shop(input)?;
    db::update_shop(&state.db(), &id, &input)
}

#[tauri::command]
pub fn delete_shop(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_shop(&state.db(), &id)
}

#[tauri::command]
pub fn list_wishes(state: State<'_, AppState>) -> CmdResult<Vec<Wish>> {
    db::list_wishes(&state.db())
}

#[tauri::command]
pub fn add_wish(state: State<'_, AppState>, input: WishInput) -> CmdResult<Wish> {
    let input = clean_wish(input)?;
    db::insert_wish(&state.db(), &uuid::Uuid::new_v4().to_string(), &input)
}

#[tauri::command]
pub fn update_wish(state: State<'_, AppState>, id: String, input: WishInput) -> CmdResult<Wish> {
    let input = clean_wish(input)?;
    db::update_wish(&state.db(), &id, &input)
}

/// Ticks an item as got, or puts it back as still wanted.
#[tauri::command]
pub fn set_wish_got(state: State<'_, AppState>, id: String, got: bool) -> CmdResult<Wish> {
    db::set_wish_got(&state.db(), &id, got)
}

/// Records that an item went into the stash or Needles & hooks, which makes
/// it got as well.
#[tauri::command]
pub fn set_wish_stashed(state: State<'_, AppState>, id: String) -> CmdResult<Wish> {
    db::set_wish_stashed(&state.db(), &id)
}

#[tauri::command]
pub fn delete_wish(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let photo = db::delete_wish(&state.db(), &id)?;
    crate::covers::delete_wish_photo_file(&state, &photo);
    Ok(())
}

/// Stores a picture for an item, downscaled already by the form.
#[tauri::command]
pub fn set_wish_photo(state: State<'_, AppState>, id: String, bytes: Vec<u8>) -> CmdResult<()> {
    crate::covers::set_wish_photo(&state, &id, bytes)
}

/// The picture's bytes, as a raw payload, like a yarn's photo.
#[tauri::command]
pub fn get_wish_photo(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_wish_photo(&state, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_wish_photo(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    crate::covers::remove_wish_photo(&state, &id)
}

/// Reads a shop's page for the name, price and picture of what is on it.
/// Only a web address is fetched, tidied as a stored link would be.
#[tauri::command]
pub async fn fetch_link_preview(url: String) -> CmdResult<LinkPreview> {
    let url = web_address(&url)?;
    if url.is_empty() {
        return Err(AppError::Message("Paste a link first.".into()));
    }
    crate::link_preview::fetch(&url).await
}

/// What a shop calls itself, read from its home page, whatever page of it the
/// address is. Empty when the page does not say; the shop is then named after
/// its address.
#[tauri::command]
pub async fn fetch_shop_name(url: String) -> CmdResult<String> {
    let url = web_address(&url)?;
    let home = reqwest::Url::parse(&url)
        .map(|u| format!("{}/", u.origin().ascii_serialization()))
        .map_err(|_| AppError::Message("Give the shop's web address first.".into()))?;
    Ok(crate::link_preview::fetch(&home).await?.shop_name)
}

/// A picture from the web, as raw bytes for the form to downscale.
#[tauri::command]
pub async fn fetch_link_image(url: String) -> CmdResult<tauri::ipc::Response> {
    let url = web_address(&url)?;
    if url.is_empty() {
        return Err(AppError::Message("There is no picture to fetch.".into()));
    }
    Ok(tauri::ipc::Response::new(crate::link_preview::fetch_image(&url).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_web_address_is_made_to_open() {
        assert_eq!(web_address("drops.com").unwrap(), "https://drops.com");
        assert_eq!(web_address("  www.wollknoll.de/sale ").unwrap(), "https://www.wollknoll.de/sale");
        assert_eq!(web_address("HTTPS://Example.com/Yarn").unwrap(), "https://Example.com/Yarn", "the path keeps its case");
        assert_eq!(web_address("http://shop.example.com").unwrap(), "http://shop.example.com");
        assert_eq!(web_address("shop.example.com:8080/x").unwrap(), "https://shop.example.com:8080/x", "a port is not a scheme");
        assert_eq!(web_address("").unwrap(), "");
        assert_eq!(web_address("   ").unwrap(), "");
    }

    #[test]
    fn what_is_not_a_web_address_is_refused() {
        for bad in [
            "javascript:alert(1)",
            "mailto:shop@example.com",
            "file:///C:/Windows/System32/calc.exe",
            "ftp://example.com",
            "drops",
            "drops .com",
            "https://example.com/\nmore",
        ] {
            assert!(web_address(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn the_host_is_found_without_port_or_login() {
        assert_eq!(host("https://www.Drops.com:443/x?y#z"), "www.drops.com");
        assert_eq!(host("https://me@shop.example.com/"), "shop.example.com");
    }

    #[test]
    fn a_shop_given_only_its_address_is_named_after_it() {
        let shop = clean_shop(ShopInput { url: "www.drops.com/en".into(), ..Default::default() }).unwrap();
        assert_eq!(shop.name, "drops.com");
        assert_eq!(shop.url, "https://www.drops.com/en");
        let named = clean_shop(ShopInput { name: "  Wolle   Rödel ".into(), url: "".into(), comment: " cheap Drops \n".into(), tags: vec![] }).unwrap();
        assert_eq!((named.name.as_str(), named.url.as_str(), named.comment.as_str()), ("Wolle Rödel", "", "cheap Drops"));
        assert!(clean_shop(ShopInput::default()).is_err(), "a shop needs a name or an address");
    }

    #[test]
    fn tags_are_tidied_and_kept_once() {
        let tags = |list: &[&str]| tidy_tags(&list.iter().map(|t| t.to_string()).collect::<Vec<_>>());
        assert_eq!(tags(&["Yarn", " #deadstock ", "yarn", "", "  sale   items "]), vec!["Yarn", "deadstock", "sale items"]);
        assert_eq!(tags(&(0..40).map(|_| "x").collect::<Vec<_>>()), vec!["x"]);
        let many: Vec<String> = (0..40).map(|i| format!("t{i}")).collect();
        assert_eq!(tidy_tags(&many).len(), 30);
    }

    #[test]
    fn a_wish_needs_a_kind_and_a_name() {
        let wish = |kind: &str, name: &str| WishInput { kind: kind.into(), name: name.into(), ..Default::default() };
        assert!(clean_wish(wish("yarn", "")).is_err());
        assert!(clean_wish(wish("spaceship", "A rocket")).is_err());
        let ok = clean_wish(WishInput {
            amount: " 5   balls ".into(),
            url: "drops.com/alpaca".into(),
            shop_id: Some("  ".into()),
            project_id: Some(" pr1 ".into()),
            ..wish("Yarn", "  Drops Alpaca ")
        })
        .unwrap();
        assert_eq!(ok.kind, "yarn");
        assert_eq!(ok.name, "Drops Alpaca");
        assert_eq!(ok.amount, "5 balls");
        assert_eq!(ok.url, "https://drops.com/alpaca");
        assert_eq!(ok.shop_id, None, "a blank shop is no shop");
        assert_eq!(ok.project_id.as_deref(), Some("pr1"));
    }
}
