//! Yarn weight: the standard families, and working out which one a pattern uses.
//!
//! A pattern states its yarn in whatever way the designer felt like — "DK",
//! "4-ply worsted", "aran", or just "100 m/100 g" — so the text is kept as
//! written and a family is derived from it for filtering. Knitters shop and
//! stash yarn by family, so filtering by family is what is actually useful;
//! the metre figure is the fallback for when only that is given.
//!
//! The metre boundaries are the conventional ones for a worsted-spun wool.
//! They are a guide, not a measurement: a 100 m/100 g cotton is not a 100
//! m/100 g wool, and brands disagree at the edges. A name always wins over a
//! figure, because a designer's stated weight is more reliable than our guess
//! from a number.

/// One row of the standard weight table: the key stored in the database, the
/// label shown, and the metres-per-100g band it covers.
///
/// The bands are inclusive of `min` and exclusive of `max`, and they are
/// contiguous from `jumbo` upwards, so every plausible figure lands in exactly
/// one row. The top row is open-ended: embroidery thread runs to several
/// hundred metres per 100 g and there is no useful ceiling.
pub const FAMILIES: &[(&str, &str, u32, u32)] = &[
    ("lace", "Lace", 200, u32::MAX),
    ("fingering", "Fingering", 170, 200),
    ("sport", "Sport", 120, 170),
    ("dk", "DK", 100, 120),
    ("worsted", "Worsted", 80, 100),
    ("aran", "Aran", 60, 80),
    ("bulky", "Bulky", 40, 60),
    ("chunky", "Chunky", 30, 40),
    ("super-chunky", "Super chunky", 20, 30),
    ("jumbo", "Jumbo", 0, 20),
];

/// Words that name a family directly, longest and most specific first so that
/// "super chunky" is not read as "chunky" and "double knit" beats "dk".
const KEYWORDS: &[(&str, &str)] = &[
    ("super chunky", "super-chunky"),
    ("super-chunky", "super-chunky"),
    ("super bulky", "super-chunky"),
    ("double knit", "dk"),
    ("sock weight", "fingering"),
    ("4-ply", "worsted"),
    ("4 ply", "worsted"),
    ("3-ply", "chunky"),
    ("2-ply", "super-chunky"),
    ("2 ply", "super-chunky"),
    ("afghan", "worsted"),
    ("fingering", "fingering"),
    ("finger", "fingering"),
    ("worsted", "worsted"),
    ("chunky", "chunky"),
    ("bulky", "bulky"),
    ("sport", "sport"),
    ("jumbo", "jumbo"),
    ("thread", "lace"),
    ("cobweb", "lace"),
    ("lace", "lace"),
    ("aran", "aran"),
    ("dk", "dk"),
];

/// The family a yarn weight falls into, or `""` when nothing recognisable is
/// in the text.
///
/// This is the value stored in `patterns.yarn_weight_family` and is what the
/// filter matches on, so it has to be cheap and total: anything unrecognised
/// becomes `""` rather than being guessed at.
pub fn family_of(text: &str) -> &'static str {
    if let Some(found) = family_by_name(text) {
        return found;
    }
    match metres_per_100g(text) {
        Some(m) => family_by_metres(m),
        None => "",
    }
}

/// The family named in the text, ignoring any metre figure in it.
fn family_by_name(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    KEYWORDS
        .iter()
        .find(|(word, _)| contains_word(&lower, word))
        .map(|(_, family)| *family)
}

/// The family whose metre band a figure falls in.
pub fn family_by_metres(m: u32) -> &'static str {
    for (key, _, min, max) in FAMILIES {
        if m >= *min && m < *max {
            return key;
        }
    }
    // Only reachable if the table stops being contiguous.
    "jumbo"
}

/// The label for a family key.
///
/// Labels reach the frontend inside the facet payload rather than being looked
/// up there, so the spelling of "DK" or "Super chunky" is decided in one
/// place.
pub fn label_for(key: &str) -> &str {
    FAMILIES
        .iter()
        .find(|(k, _, _, _)| *k == key)
        .map(|(_, label, _, _)| *label)
        .unwrap_or("")
}

/// Finds `needle` in `hay` without matching it inside a longer word, so "dk"
/// does not fire on "adk" and "dk" but does on "DK", "(dk)" and "4 dk".
fn contains_word(hay: &str, needle: &str) -> bool {
    let bytes = hay.as_bytes();
    let start = needle.as_bytes();
    if start.is_empty() || start.len() > bytes.len() {
        return false;
    }
    for at in 0..=(bytes.len() - start.len()) {
        if &bytes[at..at + start.len()] != start {
            continue;
        }
        let before_ok = at == 0 || !is_word_byte(bytes[at - 1]);
        let after = at + start.len();
        let after_ok = after == bytes.len() || !is_word_byte(bytes[after]);
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

/// Pulls a metres-per-100g figure out of free text.
///
/// Accepts the shapes that actually appear on a pattern: "100 m/100g",
/// "230 m per 100 g", "85m/100g". The unit is required, because a bare number
/// in a yarn description is far more often a needle size or a stitch count
/// than a metre figure.
fn metres_per_100g(text: &str) -> Option<u32> {
    let lower = text.to_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        // A decimal point is allowed but the whole thing must be followed by
        // the unit, checked below.
        if i < bytes.len() && bytes[i] == b'.' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit()
        {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        let number: f64 = lower[start..i].parse().ok()?;
        if number <= 0.0 || number > 100_000.0 {
            continue;
        }

        // Skip spaces, then require the metre unit.
        let mut j = i;
        while j < bytes.len() && bytes[j] == b' ' {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'm' {
            continue;
        }
        j += 1;
        for word in ["etres", "eters", "trs"] {
            if lower[j..].starts_with(word) {
                j += word.len();
                break;
            }
        }
        // Then "per 100 g", "100g" or "/100g", with spaces anywhere.
        let rest: String = lower[j..]
            .chars()
            .take(12)
            .filter(|c| !c.is_whitespace())
            .collect();
        if !(rest.starts_with("/100g")
            || rest.starts_with("per100g")
            || rest.starts_with("per100grams")
            || rest.starts_with("at100g"))
        {
            continue;
        }
        return Some(number.round() as u32);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_read_as_written() {
        for (text, expected) in [
            ("DK", "dk"),
            ("dk", "dk"),
            ("Double Knit", "dk"),
            ("Fingering", "fingering"),
            ("sock weight", "fingering"),
            ("Sport", "sport"),
            ("Worsted", "worsted"),
            ("4-ply", "worsted"),
            ("Aran", "aran"),
            ("Bulky", "bulky"),
            ("Chunky", "chunky"),
            ("super chunky", "super-chunky"),
            ("Super Bulky", "super-chunky"),
            ("Jumbo", "jumbo"),
            ("Lace", "lace"),
            ("lace weight thread", "lace"),
        ] {
            assert_eq!(family_of(text), expected, "for {text:?}");
        }
    }

    #[test]
    fn a_more_specific_name_beats_the_one_inside_it() {
        // The whole point of ordering: "chunky" would otherwise win.
        assert_eq!(family_of("super chunky"), "super-chunky");
        assert_eq!(family_of("super-chunky"), "super-chunky");
        assert_eq!(family_of("double knit"), "dk");
    }

    #[test]
    fn short_names_do_not_match_inside_other_words() {
        // "dk" is two letters and appears in ordinary words.
        assert_eq!(family_of("a dk free pattern"), "dk");
        assert_eq!(family_of("dk"), "dk");
        assert_eq!(family_of("bodykeep"), "");
        assert_eq!(family_of("shocking"), "");
        assert_eq!(family_of("park"), "");
    }

    #[test]
    fn a_metre_figure_is_used_when_no_name_is_given() {
        for (text, expected) in [
            ("100 m/100g", "dk"),
            ("100m per 100g", "dk"),
            ("85 m/100 g", "worsted"),
            ("75 m/100g", "aran"),
            ("180 m/100g", "fingering"),
            ("140 m/100g", "sport"),
            // 230 is past fingering, so it reads as lace.
            ("230 m/100g", "lace"),
            ("300m/100g", "lace"),
            ("400 m per 100 g", "lace"),
            ("50m/100g", "bulky"),
            ("35m/100g", "chunky"),
            ("12 m/100g", "jumbo"),
        ] {
            assert_eq!(family_of(text), expected, "for {text:?}");
        }
    }

    #[test]
    fn a_name_wins_over_a_contradicting_figure() {
        // The designer's stated weight is more trustworthy than our reading of
        // a number, especially since the number may not even be a metre figure.
        assert_eq!(family_of("Aran, 100 m/100g"), "aran");
        assert_eq!(family_of("Lace weight - 85m/100g"), "lace");
    }

    #[test]
    fn a_bare_number_is_not_a_metre_figure() {
        // No unit means it is a needle size or a stitch count far more often
        // than a metre figure, and guessing here would be worse than nothing.
        assert_eq!(family_of("100"), "");
        assert_eq!(family_of("4 mm needles"), "");
        assert_eq!(family_of("cast on 64 sts"), "");
    }

    #[test]
    fn unrecognised_text_yields_nothing_rather_than_a_guess() {
        for text in ["", "   ", "some wool", "unknown", "hand-dyed local spin"] {
            assert_eq!(family_of(text), "", "for {text:?}");
        }
    }

    #[test]
    fn the_metre_bands_are_contiguous_and_cover_the_range() {
        // A figure landing between two rows would silently vanish from the
        // filter, so the bands are checked to meet end to end. The table runs
        // lightest first, so each row's floor is the next row's ceiling.
        for pair in FAMILIES.windows(2) {
            assert_eq!(
                pair[0].2, pair[1].3,
                "{} meets {} at {}",
                pair[0].1,
                pair[1].1,
                pair[0].2
            );
        }
        assert_eq!(
            FAMILIES.last().unwrap().2, 0,
            "the table must reach down to zero"
        );
        assert_eq!(
            FAMILIES[0].3,
            u32::MAX,
            "the lightest row must be open-ended"
        );
    }

    #[test]
    fn every_family_has_a_label() {
        for (key, _, _, _) in FAMILIES {
            assert!(!label_for(key).is_empty(), "no label for {key}");
        }
        assert_eq!(label_for("dk"), "DK");
        assert_eq!(label_for("nonsense"), "");
    }
}
