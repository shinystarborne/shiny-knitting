//! A ball band read from a photo by the model set in Settings, to fill the
//! yarn form: brand, yarn, colourway, dye lot, weight, metres and grams per
//! ball, fibres, gauge, needles and care symbols. What comes back is only a
//! suggestion: the form shows it to be checked before anything is saved.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ai::CompletionRequest;
use crate::models::{AppError, Fibre, CARE_SYMBOLS};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// What a ball band says, as read. Empty strings and zeros are what it did
/// not say, or the model could not read.
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BallBand {
    pub brand: String,
    pub name: String,
    pub colourway: String,
    pub dye_lot: String,
    pub weight: String,
    pub metres_per_ball: i64,
    pub grams_per_ball: i64,
    pub fibres: Vec<Fibre>,
    pub superwash: bool,
    /// Per 10 cm.
    pub gauge_sts: f64,
    pub gauge_rows: f64,
    /// In mm.
    pub needle_from: f64,
    pub needle_to: f64,
    /// Ids from `CARE_SYMBOLS`.
    pub care: Vec<String>,
}

/// What each care symbol is, for the model to choose from.
const CARE_WORDS: &[(&str, &str)] = &[
    ("wash-30", "machine wash 30 °C (tub with 30)"),
    ("wash-30-gentle", "machine wash 30 °C gentle (tub with 30, one bar under)"),
    ("wash-30-wool", "machine wash 30 °C wool cycle (tub with 30, two bars under)"),
    ("wash-40", "machine wash 40 °C"),
    ("wash-40-gentle", "machine wash 40 °C gentle (one bar under)"),
    ("wash-60", "machine wash 60 °C"),
    ("hand-wash", "hand wash only (tub with a hand)"),
    ("no-wash", "do not wash (tub crossed out)"),
    ("no-bleach", "do not bleach (triangle crossed out)"),
    ("tumble-low", "tumble dry low (square with a circle, one dot)"),
    ("no-tumble", "do not tumble dry (square with a circle, crossed out)"),
    ("dry-flat", "dry flat (square with a horizontal line)"),
    ("iron-low", "iron low, 110 °C (iron with one dot)"),
    ("iron-medium", "iron medium, 150 °C (iron with two dots)"),
    ("no-iron", "do not iron (iron crossed out)"),
    ("dry-clean", "dry clean (circle, with a letter)"),
    ("no-dry-clean", "do not dry clean (circle crossed out)"),
];

fn system_prompt() -> String {
    let care = CARE_WORDS.iter().map(|(id, what)| format!("  {id}: {what}")).collect::<Vec<_>>().join("\n");
    format!(
        r#"You read the ball band (label) of a ball, skein or cone of yarn from a photo.

Reply with a single JSON object and nothing else. No prose, no markdown fences.

Schema:
{{
  "brand": string,          // the maker, e.g. "Drops", "Rowan"
  "name": string,           // the yarn's name, without the brand, e.g. "Air"
  "colourway": string,      // the colour's name and/or number as printed, e.g. "01 Off white"
  "dyeLot": string,         // the dye lot (lot, Partie, bain), as printed
  "weight": string,         // the weight as printed: "DK", "Aran", "4 ply", or a cone's count such as "2/28"; empty if not printed
  "metresPerBall": number,  // metres in one ball; 0 if not printed
  "gramsPerBall": number,   // grams in one ball; 0 if not printed
  "fibres": [{{"name": string, "percent": number}}], // e.g. [{{"name": "wool", "percent": 75}}, {{"name": "polyamide", "percent": 25}}]
  "superwash": boolean,     // true only if it says superwash or machine washable wool
  "gaugeSts": number,       // stitches per 10 cm in the tension square; 0 if none
  "gaugeRows": number,      // rows per 10 cm; 0 if none
  "needleFrom": number,     // needle size in mm; the smaller of a range; 0 if none
  "needleTo": number,       // the larger of a range in mm, or 0 for one size
  "care": string[]          // the care symbols shown, by these ids only:
}}

Care symbol ids:
{care}

Rules:
- Use only what the label shows. Never guess a figure that is not printed.
- Yards only: convert to metres (× 0.9144) and round. Ounces only: convert to grams (× 28.35) and round.
- A tension square of 10 × 10 cm gives the stitches across and the rows up.
- Fibre names in English, lowercase; percentages as numbers.
- A label in another language: read it the same, answer in English."#
    )
}

/// The reply read into a ball band, every figure checked: out of range is not said.
pub fn parse_ball_band(value: &serde_json::Value) -> BallBand {
    let text = |k: &str| value.get(k).and_then(|v| v.as_str()).map(|s| s.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default().chars().take(120).collect::<String>();
    let num = |k: &str| value.get(k).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().replace(',', ".").parse().ok()))).filter(|n| n.is_finite() && *n > 0.0).unwrap_or(0.0);
    let within = |n: f64, max: f64| if n <= max { n } else { 0.0 };
    let fibres = value
        .get("fibres")
        .and_then(|f| f.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|f| {
                    let name = f.get("name")?.as_str()?.trim().to_lowercase();
                    let percent = f.get("percent").and_then(|p| p.as_f64()).filter(|p| (0.0..=100.0).contains(p)).unwrap_or(0.0);
                    (!name.is_empty()).then_some(Fibre { name: name.chars().take(60).collect(), percent: percent.round() })
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default();
    let said: Vec<String> = value
        .get("care")
        .and_then(|c| c.as_array())
        .map(|list| list.iter().filter_map(|c| c.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    // In the order a label is read, each once, only the ones the app knows.
    let care = CARE_SYMBOLS.iter().filter(|c| said.iter().any(|s| s == *c)).map(|c| c.to_string()).collect();
    let (mut from, mut to) = (within(num("needleFrom"), 50.0), within(num("needleTo"), 50.0));
    if from == 0.0 || (to != 0.0 && to < from) {
        std::mem::swap(&mut from, &mut to);
    }
    if to == from {
        to = 0.0;
    }
    BallBand {
        brand: text("brand"),
        name: text("name"),
        colourway: text("colourway"),
        dye_lot: text("dyeLot"),
        weight: text("weight"),
        metres_per_ball: within(num("metresPerBall"), 100_000.0).round() as i64,
        grams_per_ball: within(num("gramsPerBall"), 10_000.0).round() as i64,
        fibres,
        superwash: value.get("superwash").and_then(|s| s.as_bool()).unwrap_or(false),
        gauge_sts: (within(num("gaugeSts"), 100.0) * 10.0).round() / 10.0,
        gauge_rows: (within(num("gaugeRows"), 150.0) * 10.0).round() / 10.0,
        needle_from: from,
        needle_to: to,
        care,
    }
}

/// Reads a ball band from a photo (a `data:image/…` URL) with the model set
/// in Settings.
#[tauri::command]
pub async fn read_ball_band(state: State<'_, AppState>, image: String) -> CmdResult<BallBand> {
    let settings = crate::commands::unlocked_ai_settings(&state)?;
    if !settings.enabled {
        return Err(AppError::Message("Reading with a model is switched off in Settings.".into()));
    }
    if settings.base_url.trim().is_empty() {
        return Err(AppError::Message("No model server is set up. Open Settings to enter its address.".into()));
    }
    if !image.starts_with("data:image/") {
        return Err(AppError::Message("This file is not a picture.".into()));
    }
    let request = CompletionRequest {
        system: system_prompt(),
        user: "Read this ball band.".into(),
        images: vec![image],
        shorter: None,
    };
    let reply = crate::ai::complete(&settings, &request).await.map_err(|e| {
        AppError::Message(format!(
            "{e}\n\nA ball band is read from its photo, which needs a model that accepts images. If this one does not, choose one that can see in Settings."
        ))
    })?;
    let value = crate::ai::extract_json_object(&reply).ok_or_else(|| AppError::Message("The model did not answer in the form asked for. Try again, or with a clearer photo.".into()))?;
    let band = parse_ball_band(&value);
    if band == BallBand::default() {
        return Err(AppError::Message("Nothing could be read from that photo. A sharp, close photo of the label, flat and well lit, reads best.".into()));
    }
    Ok(band)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ball_band_read_is_checked() {
        let v = serde_json::json!({
            "brand": " Drops ", "name": "Air", "colourway": "01 off white", "dyeLot": "4521",
            "weight": "Aran", "metresPerBall": 150, "gramsPerBall": "50",
            "fibres": [{"name": "Alpaca", "percent": 65}, {"name": "polyamide", "percent": 28}, {"name": "wool", "percent": 7}, {"name": "", "percent": 3}],
            "superwash": false, "gaugeSts": 17, "gaugeRows": 22, "needleFrom": 5.5, "needleTo": 5,
            "care": ["dry-flat", "hand-wash", "tumble-hot", "no-bleach"]
        });
        let b = parse_ball_band(&v);
        assert_eq!((b.brand.as_str(), b.name.as_str(), b.dye_lot.as_str()), ("Drops", "Air", "4521"));
        assert_eq!((b.metres_per_ball, b.grams_per_ball), (150, 50), "a figure given as text read too");
        assert_eq!(b.fibres.iter().map(|f| (f.name.as_str(), f.percent)).collect::<Vec<_>>(), vec![("alpaca", 65.0), ("polyamide", 28.0), ("wool", 7.0)]);
        assert_eq!((b.needle_from, b.needle_to), (5.0, 5.5), "a range the right way round");
        assert_eq!(b.care, vec!["hand-wash", "no-bleach", "dry-flat"], "known ones only, in label order");
        // Nonsense is not said.
        let odd = parse_ball_band(&serde_json::json!({"gaugeSts": 900, "needleFrom": -4, "metresPerBall": "lots"}));
        assert_eq!((odd.gauge_sts, odd.needle_from, odd.metres_per_ball), (0.0, 0.0, 0));
        assert_eq!(parse_ball_band(&serde_json::json!({})), BallBand::default());
    }

    #[test]
    fn the_prompt_names_every_care_symbol() {
        let p = system_prompt();
        assert!(CARE_SYMBOLS.iter().all(|c| p.contains(&format!("  {c}: "))));
    }
}
