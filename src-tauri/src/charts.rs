//! Colourwork charts: a grid where one square is one stitch, its named
//! colours, and for a round yoke (a lopapeysa) the rounds where each repeat
//! loses or gains stitches.
//!
//! The page does the drawing and keeps a chart consistent as it is edited;
//! `clean` checks what arrives before it is stored, so a chart that could not
//! be drawn (squares that do not match its size, a colour not in its legend, a
//! yoke whose shaping does not add up) is refused rather than saved.
//!
//! Exports are drawn by the page too, and handed over as finished PNG or PDF
//! bytes for `save_file` to write where the user chooses.

use std::collections::BTreeSet;

use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::db;
use crate::models::{AppError, Chart, ChartInput};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// The most squares a side can have: a blanket's worth of stitches.
pub const MAX_SIDE: i64 = 400;
/// Colours a chart can have, one hex digit each.
pub const MAX_COLOURS: usize = 16;
/// The most repeats around a yoke: a fine-gauge yoke of 2-stitch repeats.
const MAX_REPEATS: i64 = 300;
/// The most stitches or rows in 10 cm, as for swatches.
const MAX_PER_10CM: f64 = 150.0;

/// Words on one line, with runs of spaces made one, cut at `max` characters.
fn line(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn refuse<T>(why: &str) -> Result<T, AppError> {
    Err(AppError::Message(why.to_string()))
}

/// "#rrggbb", in lower case, or None.
fn hex_colour(value: &str) -> Option<String> {
    let v = value.trim();
    let digits = v.strip_prefix('#')?;
    (digits.len() == 6 && digits.chars().all(|c| c.is_ascii_hexdigit())).then(|| v.to_ascii_lowercase())
}

/// A gauge count, rounded to a tenth; 0 for none.
fn gauge(value: f64) -> Result<f64, AppError> {
    if !value.is_finite() || value < 0.0 || value > MAX_PER_10CM {
        return refuse("The chart's gauge is stitches and rows in 10 cm.");
    }
    Ok((value * 10.0).round() / 10.0)
}

/// Makes a chart ready to store.
pub fn clean(input: ChartInput) -> Result<ChartInput, AppError> {
    let mut d = input.data;
    let name = line(&input.name, 120);
    let name = if name.is_empty() { "Untitled chart".to_string() } else { name };

    let yoke = match d.kind.as_str() {
        "standard" => false,
        "yoke" => true,
        _ => return refuse("A chart is a standard one or a round yoke."),
    };
    if !(1..=MAX_SIDE).contains(&d.width) || !(1..=MAX_SIDE).contains(&d.height) {
        return refuse(&format!("A chart is 1 to {MAX_SIDE} squares each way."));
    }

    if d.colours.is_empty() || d.colours.len() > MAX_COLOURS {
        return refuse(&format!("A chart has 1 to {MAX_COLOURS} colours."));
    }
    for (i, c) in d.colours.iter_mut().enumerate() {
        c.hex = hex_colour(&c.hex).ok_or_else(|| AppError::Message(format!("“{}” is not a colour.", c.hex)))?;
        c.name = line(&c.name, 40);
        if c.name.is_empty() {
            c.name = format!("Colour {}", i + 1);
        }
    }

    let squares = (d.width * d.height) as usize;
    if d.cells.len() != squares {
        return refuse("The chart's squares do not match its size.");
    }
    let colours = d.colours.len() as u32;
    if !d.cells.chars().all(|c| c.to_digit(16).is_some_and(|i| i < colours)) {
        return refuse("A square is in a colour the chart does not have.");
    }

    if yoke {
        if !(1..=MAX_REPEATS).contains(&d.repeats) {
            return refuse(&format!("A yoke goes round 1 to {MAX_REPEATS} times."));
        }
        d.flat = false;
        if d.sections.is_empty() {
            d.sections = vec![crate::models::ChartSection { row: 0, sts: d.width, cols: vec![] }];
        }
        check_shaping(&d)?;
    } else {
        d.repeats = 1;
        d.top_down = false;
        d.sections.clear();
    }

    d.gauge.sts = gauge(d.gauge.sts)?;
    d.gauge.rows = gauge(d.gauge.rows)?;
    if d.float_limit < 0 {
        return refuse("The float warning is a number of stitches.");
    }
    d.float_limit = d.float_limit.min(99);
    d.notes = d.notes.trim().chars().take(4000).collect();

    Ok(ChartInput { name, data: d })
}

/// That a yoke's sections add up: they start at the first round, one after
/// another; each repeat narrows towards the neck, and is the whole chart at
/// its widest; and each narrowing drops that many columns the wider part had.
fn check_shaping(d: &crate::models::ChartData) -> Result<(), AppError> {
    let s = &d.sections;
    if s[0].row != 0 {
        return refuse("A yoke's shaping starts at its first round.");
    }
    if s.windows(2).any(|w| w[1].row <= w[0].row) || s.iter().any(|x| x.row >= d.height) {
        return refuse("A yoke's shaping rounds have to be in order, within the chart.");
    }
    if s.iter().any(|x| !(1..=d.width).contains(&x.sts)) {
        return refuse("A yoke's repeat cannot have more stitches than the chart is wide.");
    }
    // From the widest part to the neck: bottom-up the rounds go that way,
    // top-down the other.
    let order: Vec<&crate::models::ChartSection> = if d.top_down { s.iter().rev().collect() } else { s.iter().collect() };
    if order[0].sts != d.width || !order[0].cols.is_empty() {
        return refuse("A yoke's repeat is the whole chart at its widest.");
    }
    let mut present: BTreeSet<i64> = (0..d.width).collect();
    for pair in order.windows(2) {
        let (wide, narrow) = (pair[0], pair[1]);
        if narrow.sts >= wide.sts {
            return refuse(if d.top_down {
                "Knitted from the neck down, a yoke's repeat grows at each shaping round."
            } else {
                "Knitted from the hem up, a yoke's repeat gets smaller at each shaping round."
            });
        }
        let cols: BTreeSet<i64> = narrow.cols.iter().copied().collect();
        if cols.len() != narrow.cols.len() || cols.len() as i64 != wide.sts - narrow.sts || !cols.iter().all(|c| present.contains(c)) {
            return refuse("A shaping round's columns do not match its stitches.");
        }
        present.retain(|c| !cols.contains(c));
    }
    Ok(())
}

#[tauri::command]
pub fn list_charts(state: State<'_, AppState>) -> CmdResult<Vec<Chart>> {
    db::list_charts(&state.db())
}

#[tauri::command]
pub fn get_chart(state: State<'_, AppState>, id: String) -> CmdResult<Chart> {
    db::get_chart(&state.db(), &id)
}

#[tauri::command]
pub fn add_chart(state: State<'_, AppState>, input: ChartInput) -> CmdResult<Chart> {
    let input = clean(input)?;
    db::insert_chart(&state.db(), &uuid::Uuid::new_v4().to_string(), &input)
}

#[tauri::command]
pub fn update_chart(state: State<'_, AppState>, id: String, input: ChartInput) -> CmdResult<Chart> {
    let input = clean(input)?;
    db::update_chart(&state.db(), &id, &input)
}

#[tauri::command]
pub fn delete_chart(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_chart(&state.db(), &id)
}

/// Undoes a header's percent-encoding (the page sends `encodeURIComponent`,
/// since a header carries ASCII only).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file name Windows accepts, from a chart's name, with the extension.
fn file_name(name: &str, ext: &str) -> String {
    let base: String = name
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let base = line(&base, 80);
    let base = base.trim_end_matches('.').trim();
    format!("{}.{ext}", if base.is_empty() { "Chart" } else { base })
}

/// Asks where to save an exported file (a chart, or a pattern's pages), and
/// writes it there. The bytes come raw, with the kind (`pdf` or `png`) and the
/// name to suggest in headers.
/// Resolves the path written, or None when the dialog was cancelled.
///
/// Async, so the dialog waits on a worker thread: a blocking dialog on the
/// main thread would wait for the main thread forever.
#[tauri::command]
pub async fn save_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<Option<String>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return refuse("The file arrived in the wrong form.");
    };
    let header = |key: &str| request.headers().get(key).and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    let (label, ext, magic): (&str, &str, &[u8]) = match header("x-kind").as_str() {
        "pdf" => ("PDF", "pdf", b"%PDF-"),
        "png" => ("PNG picture", "png", b"\x89PNG"),
        _ => return refuse("Only a PDF or a PNG picture is saved this way."),
    };
    if !bytes.starts_with(magic) {
        return refuse(&format!("That is not a {label}."));
    }
    let picked = app
        .dialog()
        .file()
        .set_title("Save as")
        .set_file_name(file_name(&header("x-name"), ext))
        .add_filter(label, &[ext])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| AppError::Message(format!("That place cannot be saved to: {e}")))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ChartColour, ChartData, ChartSection};

    fn colours(n: usize) -> Vec<ChartColour> {
        (0..n).map(|i| ChartColour { name: format!("C{i}"), hex: "#AABBCC".into() }).collect()
    }

    fn standard(w: i64, h: i64) -> ChartInput {
        ChartInput {
            name: "  Snow   flakes ".into(),
            data: ChartData { kind: "standard".into(), width: w, height: h, cells: "0".repeat((w * h) as usize), colours: colours(2), repeats: 1, ..Default::default() },
        }
    }

    /// A 12-stitch yoke repeat, 10 rounds: 12, then 9 from round 4, then 6 from round 8.
    fn yoke(top_down: bool) -> ChartInput {
        let mut sections = vec![
            ChartSection { row: 0, sts: 12, cols: vec![] },
            ChartSection { row: 3, sts: 9, cols: vec![1, 5, 9] },
            ChartSection { row: 7, sts: 6, cols: vec![0, 4, 8] },
        ];
        if top_down {
            // The same yoke the other way up: the neck first.
            sections = vec![
                ChartSection { row: 0, sts: 6, cols: vec![0, 4, 8] },
                ChartSection { row: 3, sts: 9, cols: vec![1, 5, 9] },
                ChartSection { row: 7, sts: 12, cols: vec![] },
            ];
        }
        ChartInput {
            name: "Lopi".into(),
            data: ChartData {
                kind: "yoke".into(),
                width: 12,
                height: 10,
                cells: "01".repeat(60),
                colours: colours(2),
                repeats: 18,
                top_down,
                sections,
                ..Default::default()
            },
        }
    }

    #[test]
    fn a_chart_is_tidied_as_it_is_stored() {
        let c = clean(standard(4, 3)).unwrap();
        assert_eq!(c.name, "Snow flakes");
        assert_eq!(c.data.colours[0].hex, "#aabbcc");
        let unnamed = clean(ChartInput { name: "  ".into(), ..standard(4, 3) }).unwrap();
        assert_eq!(unnamed.name, "Untitled chart");
        let mut blank = standard(2, 2);
        blank.data.colours[1].name = "   ".into();
        assert_eq!(clean(blank).unwrap().data.colours[1].name, "Colour 2");
    }

    #[test]
    fn squares_must_match_the_size_and_the_colours() {
        let mut short = standard(4, 3);
        short.data.cells.pop();
        assert!(clean(short).is_err());
        let mut stray = standard(2, 2);
        stray.data.cells = "0102".into();
        assert!(clean(stray).is_err(), "colour 2 of 2 colours (0 and 1)");
        let mut odd = standard(2, 2);
        odd.data.cells = "0x01".into();
        assert!(clean(odd).is_err());
        assert!(clean(standard(0, 3)).is_err());
        assert!(clean(standard(401, 1)).is_err());
        let mut many = standard(2, 2);
        many.data.colours = colours(17);
        assert!(clean(many).is_err());
        let mut not_colour = standard(2, 2);
        not_colour.data.colours[0].hex = "red".into();
        assert!(clean(not_colour).is_err());
    }

    #[test]
    fn a_standard_chart_has_no_yoke_shaping() {
        let mut s = standard(4, 3);
        s.data.sections = vec![ChartSection { row: 0, sts: 4, cols: vec![] }];
        s.data.repeats = 9;
        s.data.top_down = true;
        let c = clean(s).unwrap();
        assert!(c.data.sections.is_empty());
        assert_eq!((c.data.repeats, c.data.top_down), (1, false));
    }

    #[test]
    fn a_yokes_shaping_must_add_up() {
        assert!(clean(yoke(false)).is_ok());
        assert!(clean(yoke(true)).is_ok());
        let mut none = yoke(false);
        none.data.sections.clear();
        assert_eq!(clean(none).unwrap().data.sections, vec![ChartSection { row: 0, sts: 12, cols: vec![] }]);

        let mut growing = yoke(false);
        growing.data.top_down = true;
        assert!(clean(growing).is_err(), "bottom-up sections read top-down grow the wrong way");
        let mut gone_twice = yoke(false);
        gone_twice.data.sections[2].cols = vec![1, 4, 8];
        assert!(clean(gone_twice).is_err(), "column 1 went already");
        let mut too_few = yoke(false);
        too_few.data.sections[1].cols = vec![1, 5];
        assert!(clean(too_few).is_err());
        let mut late_start = yoke(false);
        late_start.data.sections[0].row = 1;
        assert!(clean(late_start).is_err());
        let mut narrow = yoke(false);
        narrow.data.sections[0].sts = 11;
        assert!(clean(narrow).is_err(), "the widest part is the whole chart");
        let mut past = yoke(false);
        past.data.sections[2].row = 10;
        assert!(clean(past).is_err());
        let mut no_repeats = yoke(false);
        no_repeats.data.repeats = 0;
        assert!(clean(no_repeats).is_err());
    }

    #[test]
    fn gauge_and_floats_are_sensible() {
        let mut g = standard(2, 2);
        g.data.gauge.sts = 22.04;
        g.data.float_limit = 500;
        let c = clean(g).unwrap();
        assert_eq!((c.data.gauge.sts, c.data.float_limit), (22.0, 99));
        let mut wild = standard(2, 2);
        wild.data.gauge.rows = 220.0;
        assert!(clean(wild).is_err());
    }

    #[test]
    fn headers_and_file_names() {
        assert_eq!(percent_decode("Rj%C3%BApa%20yoke"), "Rjúpa yoke");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(file_name("Snow: \"flakes\"?", "pdf"), "Snow flakes.pdf");
        assert_eq!(file_name(" ... ", "png"), "Chart.png");
    }
}
