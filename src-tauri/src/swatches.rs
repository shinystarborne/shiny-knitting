//! Gauge swatches: what each was knitted in and on, and its stitches and rows
//! over 10 cm, before and after blocking.
//!
//! Counts are kept per 10 cm whatever the screen shows, so the calculators
//! read one thing. `clean` keeps a swatch consistent: a stash yarn is linked
//! rather than typed, a needle from Needles & hooks gives its own size, and a
//! count no swatch has (300 stitches in 10 cm, a count over the whole swatch)
//! is refused rather than stored.

use tauri::State;

use crate::db;
use crate::models::{AppError, Swatch, SwatchInput};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// More stitches or rows in 10 cm than the finest lace has: a count made over
/// more than 10 cm.
const MAX_PER_10CM: f64 = 150.0;
/// The largest needle accepted, as for Needles & hooks.
const MAX_NEEDLE_MM: f64 = 50.0;

/// One count, rounded to a tenth; 0 for not counted.
fn count(value: f64, what: &str) -> Result<f64, AppError> {
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::Message(format!("The {what} have to be a number.")));
    }
    if value > MAX_PER_10CM {
        return Err(AppError::Message(format!(
            "{value} {what} in 10 cm is more than any swatch has — count over 10 cm only."
        )));
    }
    Ok((value * 10.0).round() / 10.0)
}

/// An id that may be blank, which is none.
fn link(id: Option<String>) -> Option<String> {
    id.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Makes a swatch ready to store. `tool_size` gives a needle's size, so one
/// from Needles & hooks is always recorded at its own size.
pub fn clean(input: SwatchInput, tool_size: impl Fn(&str) -> Option<f64>) -> Result<SwatchInput, AppError> {
    let yarn_id = link(input.yarn_id);
    let tool_id = link(input.tool_id);
    let needle = match tool_id.as_deref().and_then(&tool_size) {
        Some(size) if size > 0.0 => size,
        _ => input.needle_mm,
    };
    if !needle.is_finite() || needle < 0.0 || needle > MAX_NEEDLE_MM {
        return Err(AppError::Message("Give the needle size in millimetres, e.g. 4 or 3.75.".to_string()));
    }
    Ok(SwatchInput {
        // A stash yarn is the yarn; typed text is only for one not in the stash.
        yarn_text: if yarn_id.is_some() { String::new() } else { input.yarn_text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect() },
        yarn_id,
        tool_id,
        needle_mm: (needle * 100.0).round() / 100.0,
        stitch: input.stitch.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect(),
        sts: count(input.sts, "stitches")?,
        rows: count(input.rows, "rows")?,
        sts_blocked: count(input.sts_blocked, "stitches")?,
        rows_blocked: count(input.rows_blocked, "rows")?,
        project_id: link(input.project_id),
        notes: input.notes.trim().chars().take(4000).collect(),
        made_at: input.made_at.filter(|t| *t > 0),
    })
}

fn cleaned(state: &AppState, input: SwatchInput) -> Result<SwatchInput, AppError> {
    let conn = state.db();
    clean(input, |id| db::tool_size(&conn, id).ok().flatten())
}

#[tauri::command]
pub fn list_swatches(state: State<'_, AppState>) -> CmdResult<Vec<Swatch>> {
    db::list_swatches(&state.db())
}

#[tauri::command]
pub fn add_swatch(state: State<'_, AppState>, input: SwatchInput) -> CmdResult<Swatch> {
    let input = cleaned(&state, input)?;
    db::insert_swatch(&state.db(), &uuid::Uuid::new_v4().to_string(), &input)
}

#[tauri::command]
pub fn update_swatch(state: State<'_, AppState>, id: String, input: SwatchInput) -> CmdResult<Swatch> {
    let input = cleaned(&state, input)?;
    db::update_swatch(&state.db(), &id, &input)
}

#[tauri::command]
pub fn delete_swatch(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let photo = db::delete_swatch(&state.db(), &id)?;
    crate::covers::delete_swatch_photo_file(&state, &photo);
    Ok(())
}

/// Stores a photo for a swatch, downscaled already by the form.
#[tauri::command]
pub fn set_swatch_photo(state: State<'_, AppState>, id: String, bytes: Vec<u8>) -> CmdResult<()> {
    crate::covers::set_swatch_photo(&state, &id, bytes)
}

/// The photo's bytes, as a raw payload, like a yarn's photo.
#[tauri::command]
pub fn get_swatch_photo(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_swatch_photo(&state, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_swatch_photo(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    crate::covers::remove_swatch_photo(&state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> SwatchInput {
        SwatchInput { sts: 22.04, rows: 30.0, needle_mm: 4.0, ..Default::default() }
    }

    #[test]
    fn counts_are_kept_to_a_tenth_and_must_be_sensible() {
        let s = clean(input(), |_| None).unwrap();
        assert_eq!((s.sts, s.rows, s.sts_blocked), (22.0, 30.0, 0.0));
        assert!(clean(SwatchInput { sts: 220.0, ..input() }, |_| None).is_err(), "counted over the whole swatch");
        assert!(clean(SwatchInput { rows: -1.0, ..input() }, |_| None).is_err());
        assert!(clean(SwatchInput { sts_blocked: f64::NAN, ..input() }, |_| None).is_err());
        assert!(clean(SwatchInput { needle_mm: 80.0, ..input() }, |_| None).is_err());
    }

    #[test]
    fn a_stash_yarn_is_linked_not_typed() {
        let s = clean(SwatchInput { yarn_id: Some(" y1 ".into()), yarn_text: "Drops Air".into(), ..input() }, |_| None).unwrap();
        assert_eq!((s.yarn_id.as_deref(), s.yarn_text.as_str()), (Some("y1"), ""));
        let typed = clean(SwatchInput { yarn_id: Some(" ".into()), yarn_text: "  Friend's   merino ".into(), ..input() }, |_| None).unwrap();
        assert_eq!((typed.yarn_id, typed.yarn_text.as_str()), (None, "Friend's merino"));
    }

    #[test]
    fn a_needle_from_the_box_gives_its_own_size() {
        let s = clean(SwatchInput { tool_id: Some("t1".into()), needle_mm: 5.0, ..input() }, |_| Some(3.75)).unwrap();
        assert_eq!(s.needle_mm, 3.75);
        let size_only = clean(SwatchInput { needle_mm: 4.5, ..input() }, |_| Some(3.75)).unwrap();
        assert_eq!(size_only.needle_mm, 4.5);
    }
}
