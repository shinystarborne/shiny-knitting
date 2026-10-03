//! The people knitted for, and their measurements.
//!
//! Measurements are kept in centimetres, whatever the screen shows, so the
//! calculators read one unit. What is worth a module is `clean_set`: only a
//! measurement the person has is kept, a blank one is no entry at all, and a
//! figure no body has (a chest of 900, typed in millimetres) is refused rather
//! than stored.

use std::collections::BTreeMap;

use tauri::State;

use crate::db;
use crate::models::{AppError, MeasureUnit, MeasurementSetInput, Person, PersonInput, Project, MEASUREMENTS};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// Longer than any person's measurement, in centimetres: a tall person is
/// about 200 cm, so 300 is a figure in the wrong unit.
const MAX_CM: f64 = 300.0;

/// Words on one line, with runs of spaces made one, cut at `max` characters.
fn line(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// Makes a person ready to store. Their own measurements are kept once each,
/// whatever the case, and none may be called as a standard one is.
pub fn clean_person(input: PersonInput) -> Result<PersonInput, AppError> {
    let name = line(&input.name, 120);
    if name.is_empty() {
        return Err(AppError::Message("Give them a name.".to_string()));
    }
    let mut extra: Vec<String> = Vec::new();
    for raw in &input.extra {
        let e = line(raw, 40);
        if !e.is_empty() && !extra.iter().any(|x| x.to_lowercase() == e.to_lowercase()) {
            extra.push(e);
        }
    }
    extra.truncate(30);
    Ok(PersonInput { name, notes: input.notes.trim().chars().take(4000).collect(), extra })
}

/// Makes a set ready to store, for a person with these measurements of their
/// own. A value of 0 is a measurement not taken, and is left out.
pub fn clean_set(input: MeasurementSetInput, extra: &[String]) -> Result<MeasurementSetInput, AppError> {
    let mut values = BTreeMap::new();
    for (key, value) in input.values {
        let known = MEASUREMENTS.contains(&key.as_str()) || key.strip_prefix("x:").is_some_and(|name| extra.iter().any(|e| e == name));
        if !known {
            return Err(AppError::Message(format!("“{key}” is not one of their measurements.")));
        }
        if !value.is_finite() || value < 0.0 {
            return Err(AppError::Message("A measurement has to be a number of centimetres.".to_string()));
        }
        if value > MAX_CM {
            return Err(AppError::Message(format!("{value} cm is more than anyone measures — is it in the right unit?")));
        }
        if value > 0.0 {
            values.insert(key, (value * 100.0).round() / 100.0);
        }
    }
    if input.measured_at <= 0 {
        return Err(AppError::Message("Give the date they were measured.".to_string()));
    }
    Ok(MeasurementSetInput { measured_at: input.measured_at, values, shoe_size: line(&input.shoe_size, 20) })
}

#[tauri::command]
pub fn list_people(state: State<'_, AppState>) -> CmdResult<Vec<Person>> {
    db::list_people(&state.db())
}

#[tauri::command]
pub fn get_person(state: State<'_, AppState>, id: String) -> CmdResult<Person> {
    db::get_person(&state.db(), &id)
}

#[tauri::command]
pub fn add_person(state: State<'_, AppState>, input: PersonInput) -> CmdResult<Person> {
    let input = clean_person(input)?;
    db::insert_person(&state.db(), &uuid::Uuid::new_v4().to_string(), &input)
}

#[tauri::command]
pub fn update_person(state: State<'_, AppState>, id: String, input: PersonInput) -> CmdResult<Person> {
    let input = clean_person(input)?;
    db::update_person(&state.db(), &id, &input)
}

#[tauri::command]
pub fn delete_person(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_person(&state.db(), &id)
}

/// Adds a set of measurements to a person, and returns them with it.
#[tauri::command]
pub fn add_measurement_set(state: State<'_, AppState>, person_id: String, input: MeasurementSetInput) -> CmdResult<Person> {
    let conn = state.db();
    let person = db::get_person(&conn, &person_id)?;
    let input = clean_set(input, &person.extra)?;
    db::insert_measurement_set(&conn, &uuid::Uuid::new_v4().to_string(), &person_id, &input)
}

#[tauri::command]
pub fn update_measurement_set(state: State<'_, AppState>, id: String, input: MeasurementSetInput) -> CmdResult<Person> {
    let conn = state.db();
    let person = db::get_person(&conn, &db::set_owner(&conn, &id)?)?;
    let input = clean_set(input, &person.extra)?;
    db::update_measurement_set(&conn, &id, &input)
}

#[tauri::command]
pub fn delete_measurement_set(state: State<'_, AppState>, id: String) -> CmdResult<Person> {
    db::delete_measurement_set(&state.db(), &id)
}

/// Says who a project is for, or no one with None.
#[tauri::command]
pub fn set_project_person(state: State<'_, AppState>, project_id: String, person_id: Option<String>) -> CmdResult<Project> {
    let person_id = person_id.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    db::set_project_person(&state.db(), &project_id, person_id.as_deref())
}

/// Whether lengths are shown in centimetres or inches.
#[tauri::command]
pub fn get_measure_unit(state: State<'_, AppState>) -> CmdResult<MeasureUnit> {
    db::get_setting(&state.db(), "measure_unit")
}

#[tauri::command]
pub fn save_measure_unit(state: State<'_, AppState>, unit: MeasureUnit) -> CmdResult<MeasureUnit> {
    db::set_setting(&state.db(), "measure_unit", &unit)?;
    Ok(unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(values: &[(&str, f64)]) -> MeasurementSetInput {
        MeasurementSetInput {
            measured_at: 1,
            values: values.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            shoe_size: "  EU   39 ".into(),
        }
    }

    #[test]
    fn a_person_needs_a_name_and_their_own_measurements_are_kept_once() {
        assert!(clean_person(PersonInput::default()).is_err());
        let p = clean_person(PersonInput {
            name: "  Mo  ".into(),
            notes: " Likes green \n".into(),
            extra: vec!["Thumb  length".into(), "thumb length".into(), " ".into(), "Calf".into()],
        })
        .unwrap();
        assert_eq!((p.name.as_str(), p.notes.as_str()), ("Mo", "Likes green"));
        assert_eq!(p.extra, vec!["Thumb length", "Calf"]);
    }

    #[test]
    fn a_set_keeps_only_real_measurements_rounded() {
        let extra = vec!["Calf".to_string()];
        let s = clean_set(set(&[("chest", 91.444), ("waist", 0.0), ("x:Calf", 34.0)]), &extra).unwrap();
        assert_eq!(s.values.get("chest"), Some(&91.44));
        assert!(!s.values.contains_key("waist"), "0 is not taken");
        assert_eq!(s.values.get("x:Calf"), Some(&34.0));
        assert_eq!(s.shoe_size, "EU 39");
    }

    #[test]
    fn what_no_body_measures_is_refused() {
        assert!(clean_set(set(&[("chest", 900.0)]), &[]).is_err(), "millimetres, not centimetres");
        assert!(clean_set(set(&[("chest", -1.0)]), &[]).is_err());
        assert!(clean_set(set(&[("chest", f64::NAN)]), &[]).is_err());
        assert!(clean_set(set(&[("tail", 30.0)]), &[]).is_err(), "not a measurement");
        assert!(clean_set(set(&[("x:Calf", 30.0)]), &[]).is_err(), "not one of theirs");
        assert!(clean_set(MeasurementSetInput { measured_at: 0, ..set(&[]) }, &[]).is_err(), "a set has a date");
    }
}
