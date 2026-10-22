//! Masterclasses: videos kept to learn from -- a technique, a course, a
//! knit-along -- watched in the browser, in a window of their own, or on a
//! project's page. A YouTube link is kept as its video: its title and
//! channel asked of YouTube, and its picture kept in the library, since the
//! app shows no pictures from the web. Any other link is kept as it is.

use std::path::PathBuf;

use tauri::State;

use crate::db;
use crate::models::{AppError, Masterclass, MasterclassInput, MasterclassPart};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// The YouTube video a link is to: youtube.com/watch?v=ID, youtu.be/ID,
/// /shorts/ID, /live/ID or /embed/ID, on www., m. or music.; None for
/// anything else.
pub fn youtube_id(url: &reqwest::Url) -> Option<String> {
    let host = url.host_str()?.trim_start_matches("www.").trim_start_matches("m.").trim_start_matches("music.");
    let id = match host {
        "youtu.be" => url.path_segments()?.next()?.to_string(),
        "youtube.com" | "youtube-nocookie.com" => {
            let mut segs = url.path_segments()?;
            match segs.next()? {
                "watch" => url.query_pairs().find(|(k, _)| k == "v")?.1.to_string(),
                "shorts" | "live" | "embed" => segs.next()?.to_string(),
                _ => return None,
            }
        }
        _ => return None,
    };
    (id.len() >= 6 && id.len() <= 20 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(id)
}

/// A link as typed, made whole: `https://` when it has no scheme, and only
/// a web page.
pub fn address(typed: &str) -> Result<reqwest::Url, AppError> {
    let t = typed.trim();
    if t.is_empty() {
        return Err(AppError::Message("Video link needed (a YouTube address).".into()));
    }
    let whole = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let url = reqwest::Url::parse(&whole).map_err(|_| AppError::Message("That is not a web address.".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AppError::Message("A masterclass needs an address starting with http:// or https://.".into()));
    }
    Ok(url)
}

/// Where a video's picture is kept, by the video's id.
fn thumb_path(state: &AppState, id: &str) -> PathBuf {
    state.library_dir.join("masterclasses").join(format!("{id}.jpg"))
}

#[tauri::command]
pub fn list_masterclasses(state: State<'_, AppState>) -> CmdResult<Vec<Masterclass>> {
    db::list_masterclasses(&state.db())
}

/// A video, as kept: a YouTube one asked of YouTube for its title and
/// channel, its picture kept under the part's id; one that cannot be reached
/// is kept all the same, named by what was typed or its address.
async fn video(state: &AppState, typed: &str, title: &str) -> Result<MasterclassPart, AppError> {
    let url = address(typed)?;
    let id = uuid::Uuid::new_v4().to_string();
    let v = youtube_id(&url);
    let mut part = MasterclassPart {
        id: id.clone(),
        url: v.as_ref().map(|v| format!("https://www.youtube.com/watch?v={v}")).unwrap_or_else(|| url.to_string()),
        video_id: v.clone().unwrap_or_default(),
        title: title.trim().chars().take(200).collect(),
        ..Default::default()
    };
    if let Some(v) = &v {
        let asked = format!("https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{v}&format=json");
        if let Ok(said) = crate::link_preview::fetch_json(&asked).await {
            let text = |k: &str| said.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            if part.title.is_empty() {
                part.title = text("title").chars().take(200).collect();
            }
            part.channel = text("author_name").chars().take(120).collect();
        }
        if let Ok(bytes) = crate::link_preview::fetch_image(&format!("https://i.ytimg.com/vi/{v}/hqdefault.jpg")).await {
            let path = thumb_path(state, &id);
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(&path, bytes)?;
            part.has_thumb = true;
        }
    } else if part.title.is_empty() {
        if let Ok(page) = crate::link_preview::fetch(url.as_str()).await {
            part.title = page.title.chars().take(200).collect();
        }
    }
    if part.title.is_empty() {
        part.title = url.host_str().map(|h| h.trim_start_matches("www.").to_string()).unwrap_or_else(|| "A video".into());
    }
    Ok(part)
}

/// Keeps a video as a masterclass of its own, named as the video is unless named here.
#[tauri::command]
pub async fn add_masterclass(state: State<'_, AppState>, input: MasterclassInput) -> CmdResult<Masterclass> {
    let first = video(&state, &input.url, &input.title).await?;
    let title: String = input.title.trim().chars().take(200).collect();
    let conn = state.db();
    let class = Masterclass {
        id: uuid::Uuid::new_v4().to_string(),
        title: if title.is_empty() { first.title.clone() } else { title },
        notes: input.notes.trim().chars().take(4000).collect(),
        pattern_id: pattern(&conn, &input.pattern_id)?,
        ..Default::default()
    };
    db::insert_masterclass(&conn, &class, &first)
}

/// Another video for a masterclass, after its others.
#[tauri::command]
pub async fn add_masterclass_part(state: State<'_, AppState>, masterclass_id: String, input: MasterclassInput) -> CmdResult<Masterclass> {
    db::get_masterclass(&state.db(), &masterclass_id)?;
    let part = video(&state, &input.url, &input.title).await?;
    let conn = state.db();
    db::insert_part(&conn, &masterclass_id, &part)?;
    db::get_masterclass(&conn, &masterclass_id)
}

/// A pattern it goes with: one in the library, or none.
fn pattern(conn: &rusqlite::Connection, id: &str) -> Result<String, AppError> {
    let id = id.trim();
    if !id.is_empty() {
        db::get_pattern(conn, id)?;
    }
    Ok(id.to_string())
}

/// Its title, notes and pattern; the rest stays.
#[tauri::command]
pub fn update_masterclass(state: State<'_, AppState>, masterclass: Masterclass) -> CmdResult<Masterclass> {
    let conn = state.db();
    let mut kept = db::get_masterclass(&conn, &masterclass.id)?;
    let title = masterclass.title.trim();
    if !title.is_empty() {
        kept.title = title.chars().take(200).collect();
    }
    kept.notes = masterclass.notes.trim().chars().take(4000).collect();
    kept.pattern_id = pattern(&conn, &masterclass.pattern_id)?;
    db::update_masterclass(&conn, &kept)?;
    db::get_masterclass(&conn, &kept.id)
}

/// A video's name, and whether it is watched; the rest stays.
#[tauri::command]
pub fn update_masterclass_part(state: State<'_, AppState>, part: MasterclassPart) -> CmdResult<Masterclass> {
    let conn = state.db();
    let mut kept = db::get_masterclass_part(&conn, &part.id)?;
    let title = part.title.trim();
    if !title.is_empty() {
        kept.title = title.chars().take(200).collect();
    }
    kept.watched = part.watched;
    db::update_masterclass_part(&conn, &kept)?;
    db::get_masterclass(&conn, &kept.masterclass_id)
}

/// Moves a video to a place among its masterclass's, counted from 0.
#[tauri::command]
pub fn move_masterclass_part(state: State<'_, AppState>, id: String, position: i64) -> CmdResult<Masterclass> {
    db::move_masterclass_part(&state.db(), &id, position)
}

/// Takes a video out of its masterclass, and its picture with it.
#[tauri::command]
pub fn remove_masterclass_part(state: State<'_, AppState>, id: String) -> CmdResult<Masterclass> {
    let m = db::delete_masterclass_part(&state.db(), &id)?;
    let _ = std::fs::remove_file(thumb_path(&state, &id));
    Ok(m)
}

/// A video taken out of its masterclass to be one of its own.
#[tauri::command]
pub fn split_masterclass_part(state: State<'_, AppState>, id: String) -> CmdResult<Masterclass> {
    db::split_masterclass_part(&state.db(), &id, &uuid::Uuid::new_v4().to_string())
}

/// Masterclasses made one, in the order given, named as given.
#[tauri::command]
pub fn bundle_masterclasses(state: State<'_, AppState>, ids: Vec<String>, title: String) -> CmdResult<Masterclass> {
    if ids.len() < 2 {
        return Err(AppError::Message("Choose at least one other masterclass to bundle it with.".into()));
    }
    db::bundle_masterclasses(&state.db(), &ids, &title)
}

/// Removes it, its videos' pictures with it; the projects it was for keep going without it.
#[tauri::command]
pub fn delete_masterclass(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let conn = state.db();
    let parts = db::get_masterclass(&conn, &id)?.parts;
    db::delete_masterclass(&conn, &id)?;
    for p in parts {
        let _ = std::fs::remove_file(thumb_path(&state, &p.id));
    }
    Ok(())
}

/// A video's picture, as a raw payload, by the video's id.
#[tauri::command]
pub fn get_masterclass_thumb(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let bytes = std::fs::read(thumb_path(&state, &id)).map_err(|_| AppError::NotFound("That video has no picture.".into()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(link: &str) -> Option<String> {
        youtube_id(&address(link).unwrap())
    }

    #[test]
    fn a_youtube_link_is_known_by_its_video() {
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
            "youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        ] {
            assert_eq!(id(link).as_deref(), Some("dQw4w9WgXcQ"), "{link}");
        }
        assert_eq!(id("https://www.youtube.com/@VeryPink"), None, "a channel is not a video");
        assert_eq!(id("https://vimeo.com/76979871"), None);
        assert_eq!(id("https://www.youtube.com/watch?v=<script>"), None);
    }

    #[test]
    fn a_link_is_made_whole_or_refused() {
        assert_eq!(address("  youtu.be/dQw4w9WgXcQ ").unwrap().as_str(), "https://youtu.be/dQw4w9WgXcQ");
        assert!(address("").is_err());
        assert!(address("javascript:alert(1)").is_err());
        assert!(address("ftp://example.com/video").is_err());
    }
}
