//! Needles and hooks: what is in the box, and what is on which project.
//!
//! The data is simple; the part worth a module is `clean`, which is where a
//! tool is made consistent before it is stored. Which measurements a tool has
//! depends on its kind -- a cable has a length and a connector but no size, a
//! hook has a size and a length but no cable -- and a form that switches kind
//! halfway can send leftovers from the kind it was. Clearing them here means
//! a stored tool only ever carries the measurements it actually has.

use tauri::State;

use crate::db;
use crate::models::{AppError, Tool, ToolInput, CABLE_SIZES, TOOL_KINDS, TOOL_MATERIALS};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// The largest size accepted, in millimetres. Jumbo needles stop well short
/// of this; anything bigger is a size typed in the wrong unit.
const MAX_SIZE_MM: f64 = 50.0;
/// The longest a needle, tip or hook is accepted as, in centimetres.
const MAX_LENGTH_CM: f64 = 200.0;
/// The longest a circular needle or cable is accepted as, in centimetres.
const MAX_CABLE_CM: f64 = 500.0;

fn has_size(kind: &str) -> bool {
    kind != "cable"
}
fn has_length(kind: &str) -> bool {
    matches!(kind, "straight" | "dpn" | "tips" | "hook")
}
fn has_cable(kind: &str) -> bool {
    matches!(kind, "circular" | "cable")
}
fn has_connector(kind: &str) -> bool {
    matches!(kind, "tips" | "cable")
}

/// A measurement, rounded to `places`, refused when it is not a number or
/// below zero, and when it is over `max`.
fn measurement(value: f64, places: i32, max: f64, what: &str, unit: &str) -> Result<f64, AppError> {
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::Message(format!("The {what} has to be a number of {unit}.")));
    }
    if value > max {
        return Err(AppError::Message(format!(
            "{value} {unit} is more than any {what} — is it in the right unit?"
        )));
    }
    let scale = 10f64.powi(places);
    Ok((value * scale).round() / scale)
}

/// One word from a fixed list, compared without case. Empty is allowed.
fn one_of(value: &str, allowed: &[&str], what: &str) -> Result<String, AppError> {
    let v = value.trim().to_lowercase();
    if v.is_empty() || allowed.contains(&v.as_str()) {
        Ok(v)
    } else {
        Err(AppError::Message(format!(
            "“{}” is not a {what} this knows. Choose one of: {}.",
            value.trim(),
            allowed.join(", ")
        )))
    }
}

/// A material: a known one by its key, whatever its case ("Bamboo" is
/// `bamboo`, and the American "aluminum" is `aluminium`), anything else as
/// typed, tidied. Empty when not known.
fn material(value: &str) -> String {
    let typed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = typed.to_lowercase();
    let lower = match lower.as_str() {
        "aluminum" => "aluminium".to_string(),
        "stainless steel" => "steel".to_string(),
        "carbon fibre" | "carbon fiber" => "carbon".to_string(),
        _ => lower,
    };
    if TOOL_MATERIALS.contains(&lower.as_str()) {
        lower
    } else {
        typed.chars().take(40).collect()
    }
}

/// Makes a tool consistent before it is stored. See the module comment.
pub fn clean(input: ToolInput) -> Result<ToolInput, AppError> {
    let kind = input.kind.trim().to_lowercase();
    if !TOOL_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Message(
            "Choose what kind of needle or hook this is.".to_string(),
        ));
    }

    let size_mm = if has_size(&kind) {
        let size = measurement(input.size_mm, 2, MAX_SIZE_MM, "size", "mm")?;
        if size <= 0.0 {
            return Err(AppError::Message(
                "Give the size in millimetres, e.g. 4 or 3.75.".to_string(),
            ));
        }
        size
    } else {
        0.0
    };
    let length_cm = if has_length(&kind) {
        measurement(input.length_cm, 1, MAX_LENGTH_CM, "length", "cm")?
    } else {
        0.0
    };
    let cable_cm = if has_cable(&kind) {
        measurement(input.cable_cm, 1, MAX_CABLE_CM, "cable length", "cm")?
    } else {
        0.0
    };
    let cable_size = if has_connector(&kind) {
        one_of(&input.cable_size, CABLE_SIZES, "cable size")?
    } else {
        String::new()
    };
    let material = material(&input.material);

    let project_id = input
        .project_id
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    Ok(ToolInput {
        kind,
        size_mm,
        length_cm,
        cable_cm,
        cable_size,
        brand: input.brand.trim().chars().take(80).collect(),
        material,
        project_id,
        notes: input.notes,
    })
}

#[tauri::command]
pub fn list_tools(state: State<'_, AppState>) -> CmdResult<Vec<Tool>> {
    db::list_tools(&state.db())
}

#[tauri::command]
pub fn add_tool(state: State<'_, AppState>, input: ToolInput) -> CmdResult<Tool> {
    let input = clean(input)?;
    let id = uuid::Uuid::new_v4().to_string();
    db::insert_tool(&state.db(), &id, &input)
}

#[tauri::command]
pub fn update_tool(state: State<'_, AppState>, id: String, input: ToolInput) -> CmdResult<Tool> {
    let input = clean(input)?;
    db::update_tool(&state.db(), &id, &input)
}

/// Puts a tool on an active project, moving it off any other, or frees it
/// with no project.
#[tauri::command]
pub fn set_tool_project(
    state: State<'_, AppState>,
    id: String,
    project_id: Option<String>,
) -> CmdResult<Tool> {
    let project_id = project_id.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    db::set_tool_project(&state.db(), &id, project_id.as_deref())
}

#[tauri::command]
pub fn delete_tool(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_tool(&state.db(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: &str) -> ToolInput {
        ToolInput {
            kind: kind.to_string(),
            size_mm: 4.0,
            length_cm: 20.0,
            cable_cm: 80.0,
            cable_size: "Small".to_string(),
            brand: "  ChiaoGoo ".to_string(),
            material: "Metal".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn each_kind_keeps_only_its_own_measurements() {
        let hook = clean(input("hook")).unwrap();
        assert_eq!((hook.size_mm, hook.length_cm, hook.cable_cm), (4.0, 20.0, 0.0));
        assert_eq!(hook.cable_size, "", "a hook has no connector");

        let circular = clean(input("circular")).unwrap();
        assert_eq!((circular.size_mm, circular.length_cm, circular.cable_cm), (4.0, 0.0, 80.0));
        assert_eq!(circular.cable_size, "", "a fixed circular has no connector");

        let tips = clean(input("tips")).unwrap();
        assert_eq!((tips.length_cm, tips.cable_cm), (20.0, 0.0));
        assert_eq!(tips.cable_size, "small");

        let cable = clean(input("cable")).unwrap();
        assert_eq!((cable.size_mm, cable.length_cm, cable.cable_cm), (0.0, 0.0, 80.0));
        assert_eq!(cable.cable_size, "small");
    }

    #[test]
    fn words_are_tidied_and_checked() {
        let t = clean(input("straight")).unwrap();
        assert_eq!(t.brand, "ChiaoGoo");
        assert_eq!(t.material, "metal");
        assert_eq!(clean(ToolInput { material: "  Casein   resin ".into(), ..input("straight") }).unwrap().material, "Casein resin", "any material can be typed");
        assert_eq!(clean(ToolInput { material: "Carbon".into(), ..input("straight") }).unwrap().material, "carbon", "a known one is stored by its key");
        assert_eq!(clean(ToolInput { material: "aluminum".into(), ..input("straight") }).unwrap().material, "aluminium");
        assert!(clean(ToolInput { cable_size: "huge".into(), ..input("tips") }).is_err());
        assert!(clean(ToolInput { material: "".into(), ..input("straight") }).is_ok(), "material may be unknown");
        assert!(clean(input("spindle")).is_err());
    }

    #[test]
    fn a_size_is_required_except_for_a_cable_and_must_be_sensible() {
        assert!(clean(ToolInput { size_mm: 0.0, ..input("dpn") }).is_err());
        assert!(clean(ToolInput { size_mm: 0.0, ..input("cable") }).is_ok());
        assert!(clean(ToolInput { size_mm: -2.0, ..input("hook") }).is_err());
        assert!(clean(ToolInput { size_mm: 80.0, ..input("hook") }).is_err(), "80 mm is a typo for 8");
        assert!(clean(ToolInput { size_mm: f64::NAN, ..input("hook") }).is_err());
        assert_eq!(clean(ToolInput { size_mm: 3.749_999, ..input("hook") }).unwrap().size_mm, 3.75);
    }

    #[test]
    fn a_blank_project_is_no_project() {
        let on = clean(ToolInput { project_id: Some(" pr1 ".into()), ..input("hook") }).unwrap();
        assert_eq!(on.project_id.as_deref(), Some("pr1"));
        let blank = clean(ToolInput { project_id: Some("  ".into()), ..input("hook") }).unwrap();
        assert_eq!(blank.project_id, None);
    }
}
