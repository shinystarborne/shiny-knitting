//! Needle and hook sizes: working out which sizes a pattern's free-text
//! `needle_size` actually means, in one canonical system.
//!
//! A pattern states its needle size however the designer wrote it -- "3.5mm /
//! US 5", "4 mm", "US 6", "US H-8", "4 and 5". The text is kept as written
//! for display, and the canonical millimetre sizes are derived from it for
//! filtering, exactly as the yarn weight keeps its text and derives a family.
//! Millimetres are canonical because they are the one system that means the
//! same thing everywhere; the US labels below exist for display only.
//!
//! Two conversion tables are used:
//!
//! - `MM_TO_US`: the standard mm to US needle number pairs. 2.5 mm and
//!   3.0 mm are deliberately absent: they have no standard US number, and
//!   inventing one would be wrong rather than merely unusual.
//! - `HOOK_TO_MM`: the US hook letters, input only. Crochet hooks are written
//!   by letter far more often than by millimetres, and the mm figure printed
//!   beside a letter varies by brand, so the letter is the authority and the
//!   table is never used in reverse.
//!
//! `sizes_of` gathers four kinds of mention -- stated millimetres ("3.5mm",
//! "3,5 mm"), US hook letters ("US H-8", "US E"), US needle numbers ("US 6",
//! "US 10.5"), and, only when nothing else was found and the text mentions no
//! "cm", bare numbers in (0, 30]. Unit-less sizes in this library are metric
//! -- a US size is essentially always written with "US" -- so "4 and 5" is
//! 4 mm and 5 mm, while the "cm" guard keeps "needles 4.5, 60 cm" from
//! reading the cable length as a size.
//!
//! The mentions are then reconciled: a text can state the same needle in two
//! conventions that disagree slightly ("3.5mm / US 5", where US 5 is really
//! 3.75 mm; "5mm / US I", where I is really 5.5 mm). Two mentions within half
//! a millimetre of each other are read as the same needle, not two needles,
//! and the winner depends on where each came from: a hook letter beats a
//! stated mm (hooks are bought by letter, and the printed mm is the nominal
//! conversion), and a stated mm beats a US number. Anything unrecognised
//! yields an empty list rather than a guess, like `yarn::family_of`'s `""`.
//!
//! This mirrors `sizesOf` in `src/views/needle-size.ts`; the harness checks
//! the two against the same cases, so a change to the reading belongs in both.

/// The standard mm to US needle number pairs, mm ascending. 2.5 mm and
/// 3.0 mm are absent on purpose: they have no standard US number, so their
/// `us_label` is "".
const MM_TO_US: &[(f64, &str)] = &[
    (1.5, "000"),
    (1.75, "00"),
    (2.0, "0"),
    (2.25, "1"),
    (2.75, "2"),
    (3.25, "3"),
    (3.5, "4"),
    (3.75, "5"),
    (4.0, "6"),
    (4.5, "7"),
    (5.0, "8"),
    (5.5, "9"),
    (6.0, "10"),
    (6.5, "10.5"),
    (7.0, "10.75"),
    (8.0, "11"),
    (9.0, "13"),
    (10.0, "15"),
    (12.75, "17"),
    (16.0, "19"),
    (19.0, "35"),
    (25.0, "50"),
];

/// The US hook letters and their mm size. Input only: letters are read from
/// pattern text, but a mm size is never turned back into a letter. M and N
/// are both 9 mm, which is how the brands print them.
const HOOK_TO_MM: &[(u8, f64)] = &[
    (b'B', 2.25),
    (b'C', 2.75),
    (b'D', 3.25),
    (b'E', 3.5),
    (b'F', 3.75),
    (b'G', 4.0),
    (b'H', 5.0),
    (b'I', 5.5),
    (b'J', 6.0),
    (b'K', 6.5),
    (b'L', 8.0),
    (b'M', 9.0),
    (b'N', 9.0),
    (b'P', 10.0),
    (b'Q', 16.0),
    (b'S', 19.0),
];

/// The canonical mm keys a size as written means, smallest first, each once.
///
/// The canonical key is the number's shortest form ("4.0" is "4", "3.50" is
/// "3.5", "3.75" stays "3.75"), which is what `String` gives in the frontend
/// and `{}` gives here, since every value comes from the tables or from a
/// decimal as written. This is the value stored in `patterns.needle_sizes`
/// and is what the filter and the sidebar facet match on, so it has to be
/// cheap and total: anything unrecognised becomes an empty list.
pub fn sizes_of(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mm = mm_mentions(&lower);
    let (hooks, numbers) = us_mentions(&lower);

    // Bare numbers only stand in when the text has nothing else to say.
    // Not for UK sizes either: they run the other way (UK 10 is 3.25 mm), and
    // no reading is better than a wrong one.
    let mut bare = Vec::new();
    if mm.is_empty() && hooks.is_empty() && numbers.is_empty() && !lower.contains("cm") && !has_word(&lower, "uk") {
        bare = bare_mentions(&lower);
    }

    // Two mentions within half a millimetre of each other are the same needle
    // in two conventions, not two needles. A hook letter wins over a stated
    // mm; a stated mm wins over a US number.
    let kept_mm: Vec<f64> = mm
        .iter()
        .copied()
        .filter(|m| !hooks.iter().any(|h| *h != *m && (h - m).abs() <= 0.5))
        .collect();
    let kept_numbers: Vec<f64> = numbers
        .iter()
        .copied()
        .filter(|n| {
            !mm.iter().any(|m| (m - n).abs() <= 0.5) && !hooks.iter().any(|h| (h - n).abs() <= 0.5)
        })
        .collect();

    let mut seen: Vec<String> = Vec::new();
    let mut values: Vec<f64> = Vec::new();
    for v in kept_mm.into_iter().chain(hooks).chain(kept_numbers).chain(bare) {
        let key = format!("{v}");
        if !seen.contains(&key) {
            seen.push(key);
            values.push(v);
        }
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values.iter().map(|v| format!("{v}")).collect()
}

/// The US needle number for a canonical mm key, or "" when the size has no
/// standard one (3 mm, 2.5 mm, and anything outside the table).
pub fn us_label(mm_key: &str) -> &'static str {
    let value: f64 = match mm_key.parse() {
        Ok(v) => v,
        Err(_) => return "",
    };
    MM_TO_US
        .iter()
        .find(|(mm, _)| mm == &value)
        .map(|(_, us)| *us)
        .unwrap_or("")
}

/// The mm label for a canonical key: "4" becomes "4 mm".
pub fn mm_label(mm_key: &str) -> String {
    format!("{mm_key} mm")
}

/// The byte range of the number starting at `at`: digits, then at most one
/// decimal point or comma followed by more digits. Only called where a digit
/// is known to be.
fn number_at(s: &str, at: usize) -> (usize, usize) {
    let b = s.as_bytes();
    let mut end = at;
    while end < b.len() && b[end].is_ascii_digit() {
        end += 1;
    }
    if end + 1 < b.len() && (b[end] == b'.' || b[end] == b',') && b[end + 1].is_ascii_digit() {
        end += 1;
        while end < b.len() && b[end].is_ascii_digit() {
            end += 1;
        }
    }
    (at, end)
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// A word character, for the boundary the frontend's `\b` and `\w` express.
fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Whether `word` appears in `lower` on its own, not inside a longer word.
fn has_word(lower: &str, word: &str) -> bool {
    let b = lower.as_bytes();
    lower.match_indices(word).any(|(at, _)| {
        let end = at + word.len();
        (at == 0 || !is_word(b[at - 1])) && (end >= b.len() || !is_word(b[end]))
    })
}

/// A number as the US table spells it: "6.0" and "10.50" are "6" and "10.5".
fn table_form(written: &str) -> String {
    let t = written.replace(',', ".");
    if t.contains('.') {
        t.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        t
    }
}

/// The number a range starts from, when `before` (the text up to a "<n> mm"
/// mention) ends in one: "3.5–" or "3.5 to " before "4 mm" gives 3.5.
fn range_start(before: &str) -> Option<f64> {
    let t = before.trim_end();
    let t = ["-", "–", "—", "to"].iter().find_map(|dash| t.strip_suffix(dash))?.trim_end();
    let b = t.as_bytes();
    let mut start = t.len();
    while start > 0 && (b[start - 1].is_ascii_digit() || b[start - 1] == b'.' || b[start - 1] == b',') {
        start -= 1;
    }
    // The run must begin with a digit, and read as the whole number it is.
    while start < t.len() && !b[start].is_ascii_digit() {
        start += 1;
    }
    if start >= t.len() {
        return None;
    }
    let (from, end) = number_at(t, start);
    (end == t.len()).then(|| value_of(&t[from..end]))
}

/// A number as written, read as a value: "3,50" and "3.50" are both 3.5.
fn value_of(raw: &str) -> f64 {
    raw.replace(',', ".").parse().unwrap_or(f64::NAN)
}

/// Every "<number>mm" or "<number> mm" mention.
///
/// The unit anchors the match and there is no boundary on the number's left,
/// so the reading starts at each digit in turn: "100.5mm" is 100.5, and a
/// failed read moves on one byte, which is what lets "12.5.5mm" yield 5.5.
fn mm_mentions(lower: &str) -> Vec<f64> {
    let b = lower.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let (start, end) = number_at(lower, i);
        let j = skip_ws(b, end);
        if j + 1 < b.len() && b[j] == b'm' && b[j + 1] == b'm' {
            // A range shares one unit: "3.5–4 mm" is both sizes.
            if let Some(first) = range_start(&lower[..start]) {
                out.push(first);
            }
            out.push(value_of(&lower[start..end]));
            i = j + 2;
        } else {
            i += 1;
        }
    }
    out
}

/// Every "US" mention, as (hook letters, needle numbers), each converted
/// through its table.
///
/// The letters need a word boundary on their left, or "status 6" would count.
/// A number may sit right against them ("US6"); a hook letter may too, but it
/// must not be followed by a letter or digit, so "US H-8" and "US H/7" name
/// hook H while "US H8" is nothing. A letter needs a space, dot or dash after
/// the US, so the "us" of "use" is never hook E. A number may follow "US size",
/// and is looked up as the table spells it ("US 6.0" is US 6); one the table
/// does not have, like "US 60", is ignored.
fn us_mentions(lower: &str) -> (Vec<f64>, Vec<f64>) {
    let b = lower.as_bytes();
    let mut hooks = Vec::new();
    let mut numbers = Vec::new();
    let mut i = 0;
    while i + 1 < b.len() {
        if b[i] != b'u' || b[i + 1] != b's' || (i > 0 && is_word(b[i - 1])) {
            i += 1;
            continue;
        }
        // "US 8", "US8" and "US size 8" alike.
        let mut j = skip_ws(b, i + 2);
        if lower[j..].starts_with("size") {
            j = skip_ws(b, j + 4);
        }
        // A letter needs something between it and the US -- "US H", "US-H"
        // -- or the "us" of "use" would read as hook E.
        let mut letter_at = i + 2;
        while letter_at < b.len() && (b[letter_at].is_ascii_whitespace() || b[letter_at] == b'.' || b[letter_at] == b'-') {
            letter_at += 1;
        }
        let separated = letter_at > i + 2;
        i += 1;
        if j < b.len() && b[j].is_ascii_digit() {
            let (start, end) = number_at(lower, j);
            let written = table_form(&lower[start..end]);
            if let Some((mm, _)) = MM_TO_US.iter().find(|(_, us)| *us == written) {
                numbers.push(*mm);
            }
        } else if separated && letter_at < b.len() && b[letter_at].is_ascii_alphabetic() {
            let j = letter_at;
            let after = j + 1;
            if after >= b.len() || !is_word(b[after]) {
                let letter = b[j].to_ascii_uppercase();
                if let Some((_, mm)) = HOOK_TO_MM.iter().find(|(l, _)| l == &letter) {
                    hooks.push(*mm);
                }
            }
        }
    }
    (hooks, numbers)
}

/// Bare numbers in (0, 30] as mm, the fallback for a text with no unit at
/// all.
///
/// A number must stand alone: nothing word-like or numeric on either side, so
/// neither "size4" nor the ends of "4.5.6" count.
fn bare_mentions(lower: &str) -> Vec<f64> {
    let b = lower.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let preceded = i > 0 && (is_word(b[i - 1]) || b[i - 1] == b'.' || b[i - 1] == b',');
        if !b[i].is_ascii_digit() || preceded {
            i += 1;
            continue;
        }
        let (start, end) = number_at(lower, i);
        i = end;
        let followed = end < b.len() && (is_word(b[end]) || b[end] == b'.' || b[end] == b',');
        if followed {
            continue;
        }
        let value = value_of(&lower[start..end]);
        if value > 0.0 && value <= 30.0 {
            out.push(value);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact list the frontend mirrors, character for character.
    #[test]
    fn reads_the_sizes_a_pattern_states() {
        let cases: &[(&str, &[&str])] = &[
            ("3.5mm / US 5", &["3.5"]),
            ("3.5mm / US 4", &["3.5"]),
            ("US 6", &["4"]),
            ("3.75 mm / US 5 and 3.25 mm / US 3", &["3.25", "3.75"]),
            ("3.75mm / US 5 and 5mm / US 8", &["3.75", "5"]),
            ("3.5mm and 3mm circular needles", &["3", "3.5"]),
            ("3.5mm, 4mm, 4.5mm", &["3.5", "4", "4.5"]),
            ("4 and 5", &["4", "5"]),
            ("5 mm / US H-8", &["5"]),
            ("5mm / US I/9", &["5.5"]),
            ("5 mm / US H", &["5"]),
            ("3.5mm / US E", &["3.5"]),
            ("4.0mm", &["4"]),
            ("4 mm", &["4"]),
            ("4mm / 10mm", &["4", "10"]),
            ("4mm / US 6 and 5.5mm / US 9", &["4", "5.5"]),
            ("3mm, 3.25mm", &["3", "3.25"]),
            ("US 10.5", &["6.5"]),
            ("needles 4.5, 60 cm", &[]),
            ("Use 4mm needles", &["4"]),
            ("US size 8", &["5"]),
            ("US 6.0", &["4"]),
            ("3.5 – 4 mm", &["3.5", "4"]),
            ("UK 10", &[]),
            ("Hook: US G/6 (4 mm)", &["4"]),
            ("US 7 (4.5 mm) 80 cm circular", &["4.5"]),
            ("some wool", &[]),
            ("", &[]),
        ];
        for (text, expected) in cases {
            assert_eq!(
                sizes_of(text),
                expected.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                "for {text:?}"
            );
        }
    }

    #[test]
    fn the_decimal_comma_is_a_point() {
        assert_eq!(sizes_of("3,5 mm"), vec!["3.5".to_string()]);
        assert_eq!(sizes_of("3,50mm"), vec!["3.5".to_string()]);
    }

    #[test]
    fn a_close_us_number_is_the_same_needle_not_a_second_one() {
        // US 5 is really 3.75 mm and US 6 really 4 mm, but within half a
        // millimetre of a stated mm the two readings are one needle.
        assert_eq!(sizes_of("3.75mm / US 6"), vec!["3.75".to_string()]);
        assert_eq!(sizes_of("4mm / US 5"), vec!["4".to_string()]);
    }

    #[test]
    fn the_us_of_use_is_not_a_hook() {
        // A hook letter needs a space or dash after the US, so "use" is a word.
        assert_eq!(sizes_of("use 4mm needles"), vec!["4".to_string()]);
        assert_eq!(sizes_of("Use 3.5 mm circular"), vec!["3.5".to_string()]);
        assert_eq!(sizes_of("US H8"), Vec::<String>::new(), "a digit after the letter is not a hook");
        assert_eq!(sizes_of("US-H"), vec!["5".to_string()]);
    }

    #[test]
    fn us_size_numbers_read_however_they_are_written() {
        assert_eq!(sizes_of("US size 8"), vec!["5".to_string()]);
        assert_eq!(sizes_of("US8"), vec!["5".to_string()]);
        assert_eq!(sizes_of("US 6.0"), vec!["4".to_string()], "6.0 is the table's 6");
    }

    #[test]
    fn a_range_with_one_unit_is_both_sizes() {
        assert_eq!(sizes_of("3.5 – 4 mm"), vec!["3.5".to_string(), "4".to_string()]);
        assert_eq!(sizes_of("3.5-4mm"), vec!["3.5".to_string(), "4".to_string()]);
        assert_eq!(sizes_of("3,5 to 4 mm"), vec!["3.5".to_string(), "4".to_string()]);
    }

    #[test]
    fn a_uk_size_is_not_guessed_at() {
        // UK sizes run the other way (UK 10 is 3.25 mm); no reading beats a wrong one.
        assert_eq!(sizes_of("UK 10"), Vec::<String>::new());
        assert_eq!(sizes_of("4 mm / UK 8 / US 6"), vec!["4".to_string()]);
    }

    #[test]
    fn an_unknown_us_number_is_ignored_not_guessed() {
        // Not even as the bare-number fallback: 60 is outside the size range.
        assert_eq!(sizes_of("US 60"), Vec::<String>::new());
    }

    #[test]
    fn us_labels_come_from_the_table() {
        assert_eq!(us_label("4"), "6");
        assert_eq!(us_label("3.5"), "4");
        assert_eq!(us_label("5"), "8");
        // 3 mm and 2.5 mm have no standard US number.
        assert_eq!(us_label("3"), "");
        assert_eq!(us_label("2.5"), "");
        assert_eq!(us_label("nonsense"), "");
    }

    #[test]
    fn mm_labels_carry_the_unit() {
        assert_eq!(mm_label("4"), "4 mm");
        assert_eq!(mm_label("3.75"), "3.75 mm");
    }
}
