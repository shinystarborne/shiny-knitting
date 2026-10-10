//! Cheatsheets: what is kept to look things up in while knitting. A page
//! online, shown in a frame where the site allows it and in a window of its
//! own where it does not; pages of a PDF in the library, read from the file
//! itself; or an EPUB's chapter, kept as a copy, since a reflowing book has
//! no pages to point at.
//!
//! What is worth a module is the web address: an embed code pasted whole, a
//! YouTube link that only plays embedded, an address typed without its
//! scheme; and whether a site lets itself be framed, which it says in its
//! headers.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::db;
use crate::models::{AppError, Cheatsheet, CheatsheetInput};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// The page a cheatsheet is for, from what was typed or pasted: an address,
/// with or without `https://`, or an `<iframe>` embed code, whose `src` is the
/// page. A YouTube video's own page refuses to be framed, so its embed page
/// is kept instead.
pub fn web_address(input: &str) -> Result<String, AppError> {
    let text = input.trim();
    let raw = if text.to_ascii_lowercase().starts_with("<iframe") {
        iframe_src(text).ok_or_else(|| AppError::Message("That embed code has no address in it.".into()))?
    } else {
        text.to_string()
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(AppError::Message("Give the page's address.".into()));
    }
    let with_scheme = if raw.starts_with("//") {
        format!("https:{raw}")
    } else if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = reqwest::Url::parse(&with_scheme).map_err(|_| AppError::Message("That is not a web address.".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AppError::Message("A cheatsheet is a web page: an address starting http:// or https://.".into()));
    }
    Ok(youtube_embed(&url).unwrap_or_else(|| url.to_string()))
}

/// The `src` of an `<iframe …>`, quoted either way.
fn iframe_src(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let at = lower.find("src=")? + 4;
    let rest = &html[at..];
    let quote = rest.chars().next()?;
    let value = if quote == '"' || quote == '\'' {
        let inner = &rest[1..];
        &inner[..inner.find(quote)?]
    } else {
        rest.split(|c: char| c.is_whitespace() || c == '>').next()?
    };
    Some(value.replace("&amp;", "&"))
}

/// youtube.com/watch?v=ID, youtu.be/ID and youtube.com/shorts/ID, as the
/// embed page that can be framed. Anything else is left alone.
fn youtube_embed(url: &reqwest::Url) -> Option<String> {
    let host = url.host_str()?.trim_start_matches("www.").trim_start_matches("m.");
    let id = match host {
        "youtu.be" => url.path_segments()?.next()?.to_string(),
        "youtube.com" => {
            let mut segs = url.path_segments()?;
            match segs.next()? {
                "watch" => url.query_pairs().find(|(k, _)| k == "v")?.1.to_string(),
                "shorts" | "live" => segs.next()?.to_string(),
                _ => return None,
            }
        }
        _ => return None,
    };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    Some(format!("https://www.youtube.com/embed/{id}"))
}

/// Whether a page lets another site show it in a frame, by its headers:
/// `X-Frame-Options` (DENY or SAMEORIGIN refuse; the old ALLOW-FROM names
/// some other site), and a Content-Security-Policy's `frame-ancestors`, which
/// allows it only with `*`.
pub fn frame_allowed(x_frame_options: Option<&str>, csp: Option<&str>) -> bool {
    if let Some(x) = x_frame_options {
        let x = x.trim().to_ascii_lowercase();
        if x.starts_with("deny") || x.starts_with("sameorigin") || x.starts_with("allow-from") {
            return false;
        }
    }
    if let Some(policy) = csp {
        for directive in policy.split(';') {
            let mut words = directive.split_whitespace();
            if words.next().is_some_and(|w| w.eq_ignore_ascii_case("frame-ancestors")) {
                return words.any(|w| w == "*");
            }
        }
    }
    true
}

/// Where an EPUB chapter's copy is kept.
fn copy_path(state: &AppState, id: &str) -> PathBuf {
    state.library_dir.join("cheatsheets").join(format!("{id}.html"))
}

#[tauri::command]
pub fn list_cheatsheets(state: State<'_, AppState>) -> CmdResult<Vec<Cheatsheet>> {
    db::list_cheatsheets(&state.db())
}

/// Adds a cheatsheet. A web page is looked at first, for whether it may be
/// framed and, when no title is given, what it calls itself; a page that
/// cannot be reached is still kept, to be shown in a frame and tried there.
#[tauri::command]
pub async fn add_cheatsheet(state: State<'_, AppState>, input: CheatsheetInput) -> CmdResult<Cheatsheet> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut sheet = Cheatsheet {
        id: id.clone(),
        title: input.title.trim().chars().take(200).collect(),
        kind: input.kind.clone(),
        notes: input.notes.trim().chars().take(4000).collect(),
        framable: true,
        ..Default::default()
    };
    match input.kind.as_str() {
        "web" => {
            sheet.url = web_address(&input.url)?;
            if let Ok(look) = crate::link_preview::look_for_frame(&sheet.url).await {
                sheet.framable = look.framable;
                if sheet.title.is_empty() {
                    sheet.title = look.title;
                }
            }
            if sheet.title.is_empty() {
                sheet.title = reqwest::Url::parse(&sheet.url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default();
            }
        }
        "pages" | "chapter" => {
            let pattern = db::get_pattern(&state.db(), &input.pattern_id)?;
            let from = input.page_from.max(1);
            sheet.pattern_id = pattern.id.clone();
            sheet.page_from = from;
            sheet.page_to = input.page_to.max(from);
            if sheet.title.is_empty() {
                let word = if input.kind == "chapter" { "chapter" } else { "p." };
                let span = if sheet.page_to > from { format!("{from}–{}", sheet.page_to) } else { from.to_string() };
                sheet.title = format!("{}, {word} {span}", pattern.title);
            }
            if input.kind == "chapter" {
                let html = input.html.as_deref().filter(|h| !h.trim().is_empty()).ok_or_else(|| AppError::Message("The chapter could not be read.".into()))?;
                let path = copy_path(&state, &id);
                std::fs::create_dir_all(path.parent().unwrap())?;
                std::fs::write(&path, html)?;
            }
        }
        _ => return Err(AppError::Message("A cheatsheet is a web page, pages of a PDF, or a chapter.".into())),
    }
    db::insert_cheatsheet(&state.db(), &sheet)
}

/// Its title, notes, pages, or whether it is shown in a frame; the rest stays.
#[tauri::command]
pub fn update_cheatsheet(state: State<'_, AppState>, sheet: Cheatsheet) -> CmdResult<Cheatsheet> {
    let conn = state.db();
    let mut kept = db::get_cheatsheet(&conn, &sheet.id)?;
    let title = sheet.title.trim();
    if !title.is_empty() {
        kept.title = title.chars().take(200).collect();
    }
    kept.notes = sheet.notes.trim().chars().take(4000).collect();
    kept.framable = sheet.framable;
    if kept.kind == "pages" && sheet.page_from >= 1 {
        kept.page_from = sheet.page_from;
        kept.page_to = sheet.page_to.max(sheet.page_from);
    }
    db::update_cheatsheet(&conn, &kept)?;
    Ok(kept)
}

#[tauri::command]
pub fn delete_cheatsheet(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_cheatsheet(&state.db(), &id)?;
    let _ = std::fs::remove_file(copy_path(&state, &id));
    Ok(())
}

/// Moves a cheatsheet to a place in the list, counted from 0.
#[tauri::command]
pub fn move_cheatsheet(state: State<'_, AppState>, id: String, position: i64) -> CmdResult<Vec<Cheatsheet>> {
    let conn = state.db();
    db::move_cheatsheet(&conn, &id, position)?;
    db::list_cheatsheets(&conn)
}

/// An EPUB chapter's copy, as it was kept.
#[tauri::command]
pub fn read_cheatsheet_copy(state: State<'_, AppState>, id: String) -> CmdResult<String> {
    std::fs::read_to_string(copy_path(&state, &id)).map_err(|_| AppError::NotFound("The copy of that chapter is not there any more.".into()))
}

/// A page that will not be framed, in a window of its own: a browser window
/// in the app, which can do nothing to it. Async, as making a window from a
/// command must be on Windows; one already open for it comes to the front.
#[tauri::command]
pub async fn open_cheatsheet_window(app: AppHandle, id: String, url: String, title: String) -> CmdResult<()> {
    let address = web_address(&url)?;
    let label = format!("sheet-{}", id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>());
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    let parsed = address.parse().map_err(|_| AppError::Message("That is not a web address.".into()))?;
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(parsed))
        .title(if title.trim().is_empty() { "Cheatsheet" } else { title.trim() })
        .inner_size(900.0, 1000.0)
        .build()
        .map_err(|e| AppError::Message(format!("The window could not be opened: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_address_is_tidied_and_an_embed_code_unwrapped() {
        assert_eq!(web_address("knitty.com/ISSUEff24/FEATtips.php").unwrap(), "https://knitty.com/ISSUEff24/FEATtips.php");
        assert_eq!(web_address("  http://example.com/a?b=1 ").unwrap(), "http://example.com/a?b=1");
        assert_eq!(
            web_address(r#"<iframe width="560" src="https://player.vimeo.com/video/76979871?h=8272103f6e&amp;t=1" frameborder="0"></iframe>"#).unwrap(),
            "https://player.vimeo.com/video/76979871?h=8272103f6e&t=1"
        );
        assert_eq!(web_address("<iframe src='//example.com/x'></iframe>").unwrap(), "https://example.com/x");
        assert!(web_address("").is_err());
        assert!(web_address("<iframe></iframe>").is_err());
        assert!(web_address("ftp://example.com/file").is_err());
        assert!(web_address("javascript:alert(1)").is_err());
    }

    #[test]
    fn a_youtube_video_is_kept_as_its_embed_page() {
        for link in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "https://youtu.be/dQw4w9WgXcQ", "youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"] {
            assert_eq!(web_address(link).unwrap(), "https://www.youtube.com/embed/dQw4w9WgXcQ", "{link}");
        }
        assert_eq!(web_address("https://www.youtube.com/@channel").unwrap(), "https://www.youtube.com/@channel");
    }

    #[test]
    fn a_site_says_in_its_headers_whether_it_may_be_framed() {
        assert!(frame_allowed(None, None));
        assert!(!frame_allowed(Some("DENY"), None));
        assert!(!frame_allowed(Some("sameorigin"), None));
        assert!(!frame_allowed(None, Some("default-src 'self'; frame-ancestors 'self' https://partner.example")));
        assert!(frame_allowed(None, Some("frame-ancestors *; img-src *")));
        assert!(frame_allowed(None, Some("default-src 'self'")));
        assert!(frame_allowed(Some(""), None));
    }
}
