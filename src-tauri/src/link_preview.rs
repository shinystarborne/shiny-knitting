//! Reading a shop's page for what is on it: its name, price and picture, so a
//! link pasted into the wishlist fills the item in.
//!
//! Shops say this in two ways, both for search engines and for link previews
//! in chat apps: product data as JSON-LD (`"@type": "Product"`, with its
//! offers), and sharing tags (`og:title`, `og:image`, `product:price:amount`).
//! The product data is the more exact, so it is read first, then the tags,
//! then the page's own title. No HTML library: only tags and attributes are
//! read, by a small scanner, and the page is never run.
//!
//! Some shops refuse anything that is not a browser (Cloudflare's "Just a
//! moment…" page, a 403). Then nothing is found, and the form says so; the
//! details are typed in as before.

use std::time::Duration;

use reqwest::Url;
use serde_json::Value;

use crate::models::{AppError, LinkPreview};

/// A page larger than this is read only this far: what is wanted is in its
/// head, or in product data near the top.
const MAX_PAGE: usize = 4 * 1024 * 1024;
/// A picture larger than this is not a product photo.
const MAX_IMAGE: usize = 15 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
/// Said to be a browser: many shops answer anything else with an error page.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(USER_AGENT)
        // Redirects only to web pages, and not forever.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 8 || !matches!(attempt.url().scheme(), "http" | "https") {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| AppError::Message(format!("Could not start a connection: {e}")))
}

fn unreachable(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::Message("The page took too long to answer.".into())
    } else {
        AppError::Message("The page could not be reached. Check the link, and that you are online.".into())
    }
}

/// What a refusal means, in words.
fn refused(status: reqwest::StatusCode) -> AppError {
    let code = status.as_u16();
    let why = match code {
        401 | 403 | 429 | 503 => " The shop may not let apps read its pages; fill the details in yourself.",
        404 | 410 => " The page may have moved, or the item is gone.",
        _ => "",
    };
    AppError::Message(format!("The page answered {code}.{why}"))
}

/// Reads a response's body up to `max` bytes. A page is cut there; anything
/// else that long is refused.
async fn body(mut response: reqwest::Response, max: usize, cut: bool) -> Result<Vec<u8>, AppError> {
    let too_big = || AppError::Message("That is too large to be a picture of something to buy.".into());
    if !cut && response.content_length().is_some_and(|n| n as usize > max) {
        return Err(too_big());
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(unreachable)? {
        out.extend_from_slice(&chunk);
        if out.len() > max {
            if cut {
                out.truncate(max);
                break;
            }
            return Err(too_big());
        }
    }
    Ok(out)
}

/// Fetches a page and reads what it says about the thing on it.
pub async fn fetch(url: &str) -> Result<LinkPreview, AppError> {
    let response = client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-GB,en;q=0.9,de;q=0.8")
        .send()
        .await
        .map_err(unreachable)?;
    if !response.status().is_success() {
        return Err(refused(response.status()));
    }
    let base = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    // A link straight to a picture is the picture.
    if content_type.starts_with("image/") {
        return Ok(LinkPreview { url: base.to_string(), image_url: base.to_string(), ..Default::default() });
    }
    if !content_type.is_empty() && !content_type.contains("html") && !content_type.contains("xml") {
        return Err(AppError::Message("That link is not a web page.".into()));
    }
    let bytes = body(response, MAX_PAGE, true).await?;
    let html = decode(&bytes, &content_type);
    Ok(parse_page(&html, &base))
}

/// Fetches a picture's bytes, refusing anything that is not a picture.
pub async fn fetch_image(url: &str) -> Result<Vec<u8>, AppError> {
    let response = client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8")
        .send()
        .await
        .map_err(unreachable)?;
    if !response.status().is_success() {
        return Err(refused(response.status()));
    }
    let typed_image = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| t.to_ascii_lowercase().starts_with("image/"));
    let bytes = body(response, MAX_IMAGE, false).await?;
    if bytes.is_empty() || !(typed_image || crate::covers::sniff_extension(&bytes).is_some()) {
        return Err(AppError::Message("The page's picture could not be read as a picture.".into()));
    }
    Ok(bytes)
}

/// The page as text: UTF-8 when it is, else in the character set it names.
fn decode(bytes: &[u8], content_type: &str) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).to_ascii_lowercase();
    let label = charset_in(content_type).or_else(|| charset_in(&head)).unwrap_or_else(|| "windows-1252".into());
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::WINDOWS_1252);
    encoding.decode(bytes).0.into_owned()
}

/// The `charset=` named in a content type or a page's head.
fn charset_in(text: &str) -> Option<String> {
    let at = text.find("charset=")? + "charset=".len();
    let rest = text[at..].trim_start_matches(['"', '\'']);
    let label: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || "-_:.".contains(*c)).collect();
    (!label.is_empty()).then_some(label)
}

// ---------- reading the page ----------

/// What the scanner collects from a page.
#[derive(Default)]
struct Scanned {
    /// `<meta>` tags, by their property, name or itemprop, lower case.
    metas: Vec<(String, String)>,
    /// Other elements' `itemprop` with a `content`, as microdata gives a price.
    itemprops: Vec<(String, String)>,
    title: String,
    /// The text of each `application/ld+json` script.
    json_ld: Vec<String>,
    image_src: String,
}

/// Reads what a page says about the thing on it. `base` is the page's own
/// address, against which a relative picture address is made absolute.
pub fn parse_page(html: &str, base: &Url) -> LinkPreview {
    let page = scan(html);
    let meta = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|k| page.metas.iter().find(|(name, c)| name == k && !c.trim().is_empty()))
            .map(|(_, c)| tidy(c))
            .unwrap_or_default()
    };
    let itemprop = |key: &str| -> String {
        page.itemprops.iter().find(|(k, c)| k == key && !c.trim().is_empty()).map(|(_, c)| tidy(c)).unwrap_or_default()
    };
    let product = page
        .json_ld
        .iter()
        .filter_map(|text| parse_json_ld(text))
        .find_map(|value| find_product(&value).cloned());

    let site_name = meta(&["og:site_name", "application-name"]);
    let title = [
        product.as_ref().map(|p| text_of(p.get("name"))).unwrap_or_default(),
        meta(&["og:title", "twitter:title"]),
        tidy(&page.title),
    ]
    .into_iter()
    .find(|t| !t.is_empty())
    .unwrap_or_default();
    let brand = [
        product.as_ref().map(|p| brand_of(p.get("brand"))).unwrap_or_default(),
        meta(&["product:brand", "og:brand"]),
        itemprop("brand"),
    ]
    .into_iter()
    .find(|b| !b.is_empty())
    .unwrap_or_default();
    // Microdata may give the price on an element and its currency on a meta
    // tag, or the other way round.
    let tag_currency = || {
        let c = meta(&["product:price:currency", "og:price:currency", "pricecurrency"]);
        if c.is_empty() { itemprop("pricecurrency") } else { c }
    };
    let (amount, currency) = product
        .as_ref()
        .and_then(price_of_product)
        .or_else(|| {
            let amount = meta(&["product:price:amount", "og:price:amount", "price"]);
            let amount = if amount.is_empty() { itemprop("price") } else { amount };
            (!amount.is_empty()).then(|| (amount, tag_currency()))
        })
        .unwrap_or_default();
    let image = [
        product.as_ref().map(|p| image_of(p.get("image"))).unwrap_or_default(),
        meta(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]),
        itemprop("image"),
        page.image_src.clone(),
    ]
    .into_iter()
    .find(|i| !i.is_empty())
    .unwrap_or_default();

    let shop_name = shop_name(&[tidy(&page.title), meta(&["og:title"])], &site_name, base.host_str().unwrap_or(""));
    LinkPreview {
        url: base.to_string(),
        title: tidy_title(&title, &site_name),
        brand,
        price: format_price(&amount, &currency),
        image_url: absolute(&image, base),
        site_name,
        shop_name,
    }
}

/// A word reduced to its letters and digits, umlauts written out, so "Wolle
/// Rödel" and `wolle-roedel` are the same.
fn fold(text: &str) -> String {
    let mut out = String::new();
    for c in text.to_lowercase().chars() {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            'å' => out.push_str("aa"),
            'æ' => out.push_str("ae"),
            'ø' => out.push_str("oe"),
            c if c.is_alphanumeric() => out.extend(c.to_string().chars().filter(|c| c.is_ascii_alphanumeric())),
            _ => {}
        }
    }
    out
}

/// What a shop calls itself, from its page. A page's title is usually the
/// shop's name and a slogan ("Wolle online kaufen | Wollplatz"), and the part
/// that matches the site's address is the name. The page's own site name comes
/// next: it is not always this shop's (Wollplatz.de calls itself Wolplein.nl,
/// its Dutch parent). A title with no slogan to cut is the name as it is.
/// Empty when nothing reads as a name; the caller names the shop after its
/// address then.
pub fn shop_name(titles: &[String], site_name: &str, host: &str) -> String {
    let host = host.trim_start_matches("www.");
    // The address without its ending, in parts: "shop.handgemacht-wolle.de"
    // is "shop" and "handgemachtwolle".
    let labels: Vec<String> = {
        let parts: Vec<&str> = host.split('.').collect();
        let keep = if parts.len() > 1 { &parts[..parts.len() - 1] } else { &parts[..] };
        // Words any shop's address may have, which name no shop.
        const GENERIC: &[&str] = &["shop", "store", "online", "www", "web", "my"];
        keep.iter().map(|p| fold(p)).filter(|p| p.len() >= 3 && !GENERIC.contains(&p.as_str())).collect()
    };
    let matches = |candidate: &str| {
        let f = fold(candidate);
        f.len() >= 3 && labels.iter().any(|l| l == &f || (f.len() >= 4 && l.contains(&f)) || (l.len() >= 4 && f.contains(l.as_str())))
    };
    // The titles' parts, then the site name's: on a tie the site name wins,
    // as it is usually the better spelled ("Knotten Wolle", not "KNOTTENWOLLE").
    let segments: Vec<String> = titles
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(site_name))
        .flat_map(|t| {
            tidy(t)
                .split(['|', '–', '—', '·', ':', '▷', '•', '»', '›', '~'])
                .flat_map(|s| s.split(" - ").map(|p| p.trim().to_string()).collect::<Vec<_>>())
                .collect::<Vec<_>>()
        })
        .filter(|s| !s.is_empty() && s.chars().count() <= 60)
        .collect();
    // The closest match wins: the whole address, else the most of it.
    let score = |s: &String| {
        let f = fold(s);
        if labels.contains(&f) { usize::MAX } else { f.len() }
    };
    if let Some(found) = segments.iter().filter(|s| matches(s)).max_by_key(|s| score(s)) {
        return found.clone();
    }
    let site = tidy(site_name);
    if !site.is_empty() && site.chars().count() <= 60 {
        return site;
    }
    // A page called "Home" says nothing about whose home it is.
    const NOT_NAMES: &[&str] = &["home", "startseite", "willkommen", "welcome", "shop", "index", "start", "homepage", "onlineshop"];
    match titles.iter().map(|t| tidy(t)).find(|t| !t.is_empty()) {
        Some(t) if t.chars().count() <= 30 && !t.contains(['|', '–', '—']) && !NOT_NAMES.contains(&fold(&t).as_str()) => t,
        _ => String::new(),
    }
}

/// Walks the page's tags once, collecting what `parse_page` reads.
fn scan(html: &str) -> Scanned {
    let mut out = Scanned::default();
    // Lower case keeps every byte where it was, so positions found in it are
    // positions in the page.
    let lower = html.to_ascii_lowercase();
    let mut i = 0;
    while let Some(off) = lower[i..].find('<') {
        let start = i + off;
        if lower[start..].starts_with("<!--") {
            i = lower[start..].find("-->").map_or(html.len(), |e| start + e + 3);
            continue;
        }
        let Some((name, attrs, after)) = parse_tag(html, start) else {
            i = start + 1;
            continue;
        };
        let attr = |key: &str| attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str());
        match name.as_str() {
            "meta" => {
                let key = attr("property").or(attr("name")).or(attr("itemprop"));
                if let (Some(key), Some(content)) = (key, attr("content")) {
                    out.metas.push((key.to_ascii_lowercase(), decode_entities(content)));
                }
            }
            "title" | "script" | "style" => {
                // Their text is not markup; jump to where they close.
                let end = lower[after..].find(&format!("</{name}")).map_or(html.len(), |e| after + e);
                if name == "title" && out.title.is_empty() {
                    out.title = decode_entities(&html[after..end]);
                }
                if name == "script" && attr("type").is_some_and(|t| t.to_ascii_lowercase().contains("ld+json")) {
                    out.json_ld.push(html[after..end].to_string());
                }
                i = end.max(after);
                continue;
            }
            "link" => {
                if attr("rel").is_some_and(|r| r.eq_ignore_ascii_case("image_src")) {
                    if let Some(href) = attr("href") {
                        out.image_src = decode_entities(href);
                    }
                }
            }
            _ => {}
        }
        if name != "meta" {
            if let (Some(key), Some(content)) = (attr("itemprop"), attr("content").or(attr("src"))) {
                out.itemprops.push((key.to_ascii_lowercase(), decode_entities(content)));
            }
        }
        i = after;
    }
    out
}

/// Reads one opening tag starting at `start` (a `<`): its name in lower case,
/// its attributes (names in lower case, values as written), and where it ends.
/// None when what is there is not a tag.
fn parse_tag(html: &str, start: usize) -> Option<(String, Vec<(String, String)>, usize)> {
    let bytes = html.as_bytes();
    let mut i = start + 1;
    if !bytes.get(i)?.is_ascii_alphabetic() {
        return None;
    }
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-' || bytes[i] == b':') {
        i += 1;
    }
    let name = html[start + 1..i].to_ascii_lowercase();
    let mut attrs = Vec::new();
    loop {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        match bytes.get(i) {
            None => return Some((name, attrs, bytes.len())),
            Some(b'>') => return Some((name, attrs, i + 1)),
            _ => {}
        }
        let key_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && !b"=>/".contains(&bytes[i]) {
            i += 1;
        }
        let key = html[key_start..i].to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if bytes.get(i) == Some(&b'=') {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            match bytes.get(i) {
                Some(&q) if q == b'"' || q == b'\'' => {
                    let end = html[i + 1..].find(q as char).map_or(bytes.len(), |e| i + 1 + e);
                    value = html[i + 1..end].to_string();
                    i = (end + 1).min(bytes.len());
                }
                _ => {
                    let v_start = i;
                    while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                        i += 1;
                    }
                    value = html[v_start..i].to_string();
                }
            }
        }
        if key.is_empty() {
            // Something that is neither a name nor the end: step over it.
            i += 1;
        } else {
            attrs.push((key, value));
        }
    }
}

/// HTML's character references, the ones a shop's title and price use.
fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        // A reference is short; a `;` further on belongs to something else.
        let Some(semi) = rest.as_bytes().iter().take(12).position(|&b| b == b';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..semi];
        let ch = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "euro" => Some('€'),
            "pound" => Some('£'),
            "yen" => Some('¥'),
            "ndash" => Some('–'),
            "mdash" => Some('—'),
            "auml" => Some('ä'),
            "ouml" => Some('ö'),
            "uuml" => Some('ü'),
            "Auml" => Some('Ä'),
            "Ouml" => Some('Ö'),
            "Uuml" => Some('Ü'),
            "szlig" => Some('ß'),
            "eacute" => Some('é'),
            "egrave" => Some('è'),
            "aring" => Some('å'),
            "oslash" => Some('ø'),
            "aelig" => Some('æ'),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// One line, with runs of spaces made one.
fn tidy(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A title without the shop's name on the end ("Drops Alpaca | Wolle Rödel"),
/// cut to a length that fits the wishlist.
fn tidy_title(title: &str, site_name: &str) -> String {
    let mut title = tidy(title);
    let site = site_name.trim().to_lowercase();
    if !site.is_empty() {
        for sep in [" | ", " – ", " — ", " - ", " :: ", " · "] {
            if let Some(at) = title.rfind(sep) {
                let tail = title[at + sep.len()..].to_lowercase();
                if tail.contains(&site) || site.contains(&tail) {
                    title.truncate(at);
                    break;
                }
            }
        }
    }
    title.chars().take(200).collect()
}

/// A picture's address made absolute against the page's; empty when it is not
/// a web address.
fn absolute(href: &str, base: &Url) -> String {
    let href = href.trim();
    if href.is_empty() {
        return String::new();
    }
    match base.join(href) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url.to_string(),
        _ => String::new(),
    }
}

/// A price with its currency, as a shopper writes it: "€4.95", "CHF 12.90".
/// An amount that is not a plain number is kept as the page wrote it.
pub fn format_price(amount: &str, currency: &str) -> String {
    let amount = amount.trim();
    if amount.is_empty() {
        return String::new();
    }
    let currency = currency.trim().to_uppercase();
    let plain = if amount.contains('.') { amount.replace(',', "") } else { amount.replace(',', ".") };
    let Ok(value) = plain.parse::<f64>() else {
        return amount.to_string();
    };
    // A free pattern is offered at 0.
    if value == 0.0 {
        return "Free".to_string();
    }
    let number = format!("{value:.2}");
    match currency.as_str() {
        "EUR" | "€" => format!("€{number}"),
        "USD" | "$" => format!("${number}"),
        "GBP" | "£" => format!("£{number}"),
        "JPY" | "¥" => format!("¥{value:.0}"),
        "" => number,
        other => format!("{other} {number}"),
    }
}

// ---------- product data ----------

/// Parses a JSON-LD script, forgiving the wrappers and stray line breaks some
/// shops leave in it.
fn parse_json_ld(text: &str) -> Option<Value> {
    let text = text
        .trim()
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim()
        .trim_start_matches("/*<![CDATA[*/")
        .trim_end_matches("/*]]>*/")
        .trim();
    serde_json::from_str(text)
        .ok()
        .or_else(|| serde_json::from_str(&text.replace(['\n', '\r', '\t'], " ")).ok())
}

/// Whether a `@type` is, or includes, one of the names.
fn is_type(value: Option<&Value>, names: &[&str]) -> bool {
    let matches = |t: &str| {
        let t = t.rsplit('/').next().unwrap_or(t);
        names.iter().any(|n| t.eq_ignore_ascii_case(n))
    };
    match value {
        Some(Value::String(t)) => matches(t),
        Some(Value::Array(list)) => list.iter().any(|v| v.as_str().is_some_and(matches)),
        _ => false,
    }
}

/// The first product described anywhere in the data: at the top, in a list,
/// in an `@graph`, or as a page's main entity.
fn find_product(value: &Value) -> Option<&Value> {
    match value {
        Value::Array(list) => list.iter().find_map(find_product),
        Value::Object(obj) => {
            if is_type(obj.get("@type"), &["Product", "ProductGroup", "IndividualProduct", "ProductModel"]) {
                return Some(value);
            }
            ["@graph", "mainEntity", "itemOffered"].iter().find_map(|k| obj.get(*k).and_then(find_product))
        }
        _ => None,
    }
}

/// A string, or the first of a list of them; numbers as written.
fn text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => tidy(&decode_entities(s)),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(list)) => text_of(list.first()),
        _ => String::new(),
    }
}

fn brand_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::Object(obj)) => text_of(obj.get("name")),
        Some(Value::Array(list)) => brand_of(list.first()),
        other => text_of(other),
    }
}

fn image_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(list)) => list.iter().map(|v| image_of(Some(v))).find(|s| !s.is_empty()).unwrap_or_default(),
        Some(Value::Object(obj)) => image_of(obj.get("url").or(obj.get("contentUrl"))),
        _ => String::new(),
    }
}

/// The price and currency a product is offered at: its offer's, or the
/// lowest of a range, or its first variant's.
fn price_of_product(product: &Value) -> Option<(String, String)> {
    price_of_offers(product.get("offers")).or_else(|| match product.get("hasVariant") {
        Some(Value::Array(list)) => list.iter().find_map(|v| price_of_offers(v.get("offers"))),
        Some(v) => price_of_offers(v.get("offers")),
        None => None,
    })
}

fn price_of_offers(offers: Option<&Value>) -> Option<(String, String)> {
    match offers? {
        Value::Array(list) => list.iter().find_map(|o| price_of_offers(Some(o))),
        Value::Object(obj) => {
            let amount = ["price", "lowPrice", "highPrice"].iter().map(|k| text_of(obj.get(*k))).find(|a| !a.is_empty());
            let currency = text_of(obj.get("priceCurrency"));
            match amount {
                Some(amount) => Some((amount, currency)),
                None => price_of_offers(obj.get("priceSpecification")).or_else(|| price_of_offers(obj.get("offers"))),
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://www.example-shop.com/yarn/drops-alpaca?colour=0501").unwrap()
    }

    #[test]
    fn product_data_comes_first() {
        let html = r#"<!doctype html><html><head>
            <title>Something else | Example Shop</title>
            <meta property="og:title" content="Not this one">
            <meta property="og:image" content="https://cdn.example.com/og.jpg">
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","name":"DROPS Alpaca &amp; more",
             "brand":{"@type":"Brand","name":"DROPS"},
             "image":["/img/alpaca-0501.jpg","/img/other.jpg"],
             "offers":[{"@type":"Offer","price":"3.95","priceCurrency":"EUR"}]}
            </script></head><body></body></html>"#;
        let p = parse_page(html, &base());
        assert_eq!(p.title, "DROPS Alpaca & more");
        assert_eq!(p.brand, "DROPS");
        assert_eq!(p.price, "€3.95");
        assert_eq!(p.image_url, "https://www.example-shop.com/img/alpaca-0501.jpg", "made absolute");
    }

    #[test]
    fn sharing_tags_when_there_is_no_product_data() {
        let html = r#"<head>
            <meta property='og:site_name' content='Wolle R&ouml;del'>
            <meta property="og:title" content="Drops Air – Off white | Wolle Rödel">
            <meta property="og:image" content="//cdn.example.com/air.webp">
            <meta property="product:price:amount" content="5,95">
            <meta property="product:price:currency" content="eur">
        </head>"#;
        let p = parse_page(html, &base());
        assert_eq!(p.title, "Drops Air – Off white", "the shop's name is taken off the end");
        assert_eq!(p.site_name, "Wolle Rödel");
        assert_eq!(p.price, "€5.95", "a decimal comma is read");
        assert_eq!(p.image_url, "https://cdn.example.com/air.webp");
    }

    #[test]
    fn the_page_title_and_microdata_as_a_last_resort() {
        let html = r#"<html><head><TITLE>
              Merino &#8211; Teal
            </TITLE></head><body>
            <!-- <meta property="og:title" content="commented out"> -->
            <span itemprop="price" content="12.5"></span><meta itemprop="priceCurrency" content="CHF">
            <script>var t = "<meta property='og:title' content='in a script'>";</script>
            </body></html>"#;
        let p = parse_page(html, &base());
        assert_eq!(p.title, "Merino – Teal");
        assert_eq!(p.price, "CHF 12.50");
        assert_eq!(p.image_url, "");
    }

    #[test]
    fn a_product_inside_a_graph_or_a_group_is_found() {
        let html = r#"<script type="application/ld+json">{"@graph":[
            {"@type":"WebPage","name":"Page"},
            {"@type":["ProductGroup"],"name":"Sock yarn","image":{"url":"https://x.example.com/a.png"},
             "hasVariant":[{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":7,"priceCurrency":"GBP"}}]}
        ]}</script>"#;
        let p = parse_page(html, &base());
        assert_eq!((p.title.as_str(), p.price.as_str(), p.image_url.as_str()), ("Sock yarn", "£7.00", "https://x.example.com/a.png"));
    }

    #[test]
    fn broken_product_data_falls_back_to_the_tags() {
        let html = r#"<script type="application/ld+json">{"@type":"Product", "name": </script>
            <meta name="twitter:title" content="From the tags">"#;
        assert_eq!(parse_page(html, &base()).title, "From the tags");
    }

    #[test]
    fn a_page_that_says_nothing_gives_nothing() {
        let p = parse_page("<html><body>Just a page</body></html>", &base());
        assert_eq!((p.title.as_str(), p.price.as_str(), p.image_url.as_str()), ("", "", ""));
        assert_eq!(parse_page("<meta property=\"og:image\" content=\"javascript:alert(1)\">", &base()).image_url, "", "only web pictures");
    }

    #[test]
    fn a_shop_is_named_by_the_part_of_its_title_that_is_its_address() {
        let name = |titles: &[&str], site: &str, host: &str| {
            shop_name(&titles.iter().map(|t| t.to_string()).collect::<Vec<_>>(), site, host)
        };
        assert_eq!(name(&["Wolle online kaufen | Wollplatz.de"], "Wolplein.nl", "www.wollplatz.de"), "Wollplatz.de", "the title's match beats a parent company's site name");
        assert_eq!(name(&["Wolle Rödel – Ihr Wollgeschäft"], "", "www.wolle-roedel.com"), "Wolle Rödel", "umlauts match their spelled-out address");
        assert_eq!(name(&["LindeHobby - Wolle & Garn online kaufen"], "", "lindehobby.de"), "LindeHobby");
        assert_eq!(name(&["Shop | Handgemacht Wolle"], "", "shop.handgemacht-wolle.de"), "Handgemacht Wolle", "shop. names no shop");
        assert_eq!(name(&["Willkommen"], "Lieblingsgarn", "lieblingsgarn.de"), "Lieblingsgarn", "the site name when the title is no help");
        assert_eq!(name(&["Wolle | Wolle Rödel"], "", "wolle-roedel.com"), "Wolle Rödel", "the closest match wins");
        assert_eq!(name(&["Yarnstore"], "", "yarnstore.de"), "Yarnstore");
        assert_eq!(name(&["Onlineshop von Lieblingsgarn ▷ Stricken • Häkeln"], "Lieblingsgarn", "lieblingsgarn.de"), "Lieblingsgarn", "other separators, and the site name's exact match");
        assert_eq!(name(&["KNOTTENWOLLE"], "Knotten Wolle", "knottenwolle.de"), "Knotten Wolle", "on a tie, the site name's spelling");
        assert_eq!(name(&["GRÜNDL WOLLE"], "Gründl", "gruendl.com"), "Gründl", "the whole address beats more than it");
        assert_eq!(name(&["Startseite"], "Wollke - für ein gutes Gefühl", "wollke.shop"), "Wollke", "the site name without its slogan");
        assert_eq!(name(&["Home"], "", "knottenwolle.de"), "", "a page called Home names nothing");
        assert_eq!(name(&["Knit Happy"], "", "example.com"), "Knit Happy", "a short title with nothing else to go on");
        assert_eq!(name(&["Hochwertige Wolle und Garne online bestellen | Versandkostenfrei ab 39 €"], "", "lanae-tricot.com"), "", "nothing reads as a name");
    }

    #[test]
    fn prices_read_as_a_shopper_writes_them() {
        assert_eq!(format_price("3.95", "EUR"), "€3.95");
        assert_eq!(format_price("4", "usd"), "$4.00");
        assert_eq!(format_price("1,299.00", "USD"), "$1299.00");
        assert_eq!(format_price("129", "SEK"), "SEK 129.00");
        assert_eq!(format_price("ab 3,95 €", "EUR"), "ab 3,95 €", "kept as written");
        assert_eq!(format_price("", "EUR"), "");
        assert_eq!(format_price("0.00", "USD"), "Free");
    }

    /// Reads a real page, to see what a shop gives:
    /// `LINK_PREVIEW_URL=https://... cargo test live_page -- --ignored --nocapture`
    #[test]
    #[ignore = "fetches from the web"]
    fn live_page() {
        let url = std::env::var("LINK_PREVIEW_URL").expect("set LINK_PREVIEW_URL");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        println!("{:#?}", rt.block_on(fetch(&url)));
    }

    #[test]
    fn a_page_in_an_older_character_set_is_read() {
        let latin1 = b"<title>Wolle R\xf6del</title><meta charset=\"iso-8859-1\">";
        assert_eq!(decode(latin1, "text/html"), "<title>Wolle Rödel</title><meta charset=\"iso-8859-1\">");
    }
}
