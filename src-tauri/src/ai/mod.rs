//! Talks to a language model to suggest metadata for a pattern.
//!
//! Two backends are supported behind one interface: a local Ollama server,
//! which never sends anything off the machine, and OpenRouter, which does.
//! The difference matters, so it is stated in the UI rather than hidden here.

pub mod metadata;
pub mod openai_compat;
pub mod secret;

use serde::{Deserialize, Serialize};

use crate::models::{AiSettings, Suggestion};

/// The instructions sent with the excerpt. Kept deliberately narrow: the
/// model is asked for a fixed set of fields and nothing else, which is what
/// makes the output parseable and cheap.
pub const SYSTEM_PROMPT: &str = r#"You extract catalogue metadata from knitting and crochet patterns.

Reply with a single JSON object and nothing else. No prose, no markdown fences.

Schema:
{
  "designer": string,        // the pattern's author, empty string if not stated
  "difficulty": string,      // exactly one of: beginner, easy, intermediate, advanced
  "needleSize": string,      // every needle or hook size stated, separated by ";", each as written, e.g. "4mm; 5mm" or "US 6"; empty string if not stated
  "yarnWeight": string,      // the yarn weight, e.g. "DK", "4-ply worsted", "100 m/100g"
  "yarn": string,            // the yarn or fibre named, empty string if not stated
  "tags": string[],          // 2-6 short lowercase tags describing the object and technique
  "summary": string,         // one sentence on what the pattern makes
  "book": boolean            // true when the file holds several separate patterns: a book, a magazine, a collection
}

Rules:
- Use only what the text states. If something is not given, use an empty string.
- Never invent a designer, gauge, or needle size.
- yarnWeight is the weight, not the yarn. Give the standard name when the
  pattern uses one ("DK", "aran", "fingering", "4-ply"), otherwise the metre
  figure as written ("100 m/100g"). Do not convert between the two.
- List every size the pattern states, separated by ";". Give each exactly as
  written ("4mm", "US 6", "US H-8"); never convert between systems and never
  merge several sizes into one phrase.
- Tags must be single words or short lowercase phrases, no punctuation.
- difficulty must be one of the four listed words, never blank.
- book is true for a book, a magazine or a collection of patterns: a contents
  page listing several designs, several pattern names, or many pages (a single
  pattern is rarely over 30). It is false for one pattern, even one in several
  sizes or with several pieces. For a book, the summary says what it collects.
"#;

/// What the prompt says of the file's length, when it is known.
fn pages_line(pages: Option<u32>) -> String {
    match pages {
        Some(n) if n > 0 => format!("The file has {n} page{}.\n", if n == 1 { "" } else { "s" }),
        _ => String::new(),
    }
}

/// Builds the user message for one pattern.
pub fn build_user_prompt(title: &str, file_name: &str, excerpt: &str, pages: Option<u32>) -> String {
    let pages = pages_line(pages);
    format!(
        "Pattern file: {file_name}\nFilename suggests: {title}\n{pages}\n\
         --- BEGIN PATTERN ---\n{excerpt}\n--- END PATTERN ---\n\n\
         Produce the JSON object described in the instructions."
    )
}

/// Builds the user message for a pattern that has no extractable text.
///
/// Plenty of knitting patterns are scans or photographs, where the page is an
/// image and there is no text layer at all. Reading the picture is then the
/// only way to learn anything, so the pages are sent as images and the model
/// is asked to describe what it can see.
pub fn build_vision_prompt(title: &str, file_name: &str, page_count: usize, file_pages: Option<u32>) -> String {
    let length = pages_line(file_pages);
    let pages = if page_count == 1 {
        "1 page image follows".to_string()
    } else {
        format!("{page_count} page images follow, in order")
    };
    format!(
        "Pattern file: {file_name}\nFilename suggests: {title}\n{length}\n\
         This file has no text layer: it is a scan or a photograph, and there is \
         nothing to extract with text search. The {pages}, and you must read the \
         pattern from what you can see in them.\n\n\
         Read the front page closely for the pattern's name, the designer, \
         every needle size or hook size stated, the yarn, and any stated difficulty. A chart \
         or a photograph of finished work is also worth a tag or two. Transcribe \
         only what is actually legible: an unreadable or absent detail must come \
         back as an empty string rather than a guess.\n\n\
         Produce the JSON object described in the instructions."
    )
}

/// Strips the excerpt down to something worth sending: collapses the runs of
/// whitespace and newlines that PDF extraction produces, and truncates on a
/// character budget.
pub fn clean_excerpt(raw: &str, max_chars: i64) -> String {
    let budget = max_chars.max(200) as usize;

    let mut out = String::with_capacity(budget.min(8192));
    let mut last_was_space = true;
    for ch in raw.chars() {
        if out.len() >= budget {
            out.push_str(" [truncated]");
            break;
        }
        // Text extracted from a PDF is mostly runs of spaces and newlines;
        // collapsing them spends the budget on content rather than gaps.
        if ch.is_whitespace() {
            if !last_was_space && !out.is_empty() {
                out.push(' ');
            }
            last_was_space = true;
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out.trim().to_string()
}

/// Pulls a JSON object out of a model response.
///
/// Models are asked for bare JSON but do not always comply: some wrap it in a
/// ```json fence, some add a sentence before it. Rather than trusting the
/// format, this finds the first balanced object in the text.
pub fn extract_json_object(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();

    // Fast path: the whole response is the object.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if value.is_object() {
            return Some(value);
        }
    }

    // Otherwise scan for the first balanced {...}, respecting strings so a
    // brace inside a quoted value does not end the object early.
    let bytes: Vec<char> = trimmed.chars().collect();
    let start = bytes.iter().position(|c| *c == '{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for i in start..bytes.len() {
        let c = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let candidate: String = bytes[start..=i].iter().collect();
                    return serde_json::from_str(&candidate).ok();
                }
            }
            _ => {}
        }
    }
    None
}

/// Coerces a model's JSON into a `Suggestion`, discarding anything unusable.
///
/// A model that returns one bad field should not cost us the rest, so each
/// value is validated independently.
pub fn parse_suggestion(value: &serde_json::Value) -> Suggestion {
    let text = |key: &str| -> String {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    let difficulty = match text("difficulty").to_lowercase().as_str() {
        "beginner" => "beginner",
        "easy" => "easy",
        "intermediate" => "intermediate",
        "advanced" => "advanced",
        // Models like to answer "Intermediate Knitting", "for experienced
        // knitters", or "medium", so match on the words they actually use.
        other => {
            if other.contains("beginner") || other.contains("novice") {
                "beginner"
            } else if other.contains("advanc") || other.contains("expert")
                || other.contains("experi")
            {
                "advanced"
            } else if other.contains("intermed") || other.contains("medium")
                || other.contains("confident")
            {
                "intermediate"
            } else if other.contains("easy") || other.contains("simple") {
                "easy"
            } else {
                ""
            }
        }
    };

    // A tag list can come back as an array, a comma-separated string, or a
    // single string. All three are common enough to be worth accepting.
    let mut tags: Vec<String> = match value.get("tags") {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|i| i.as_str())
            .map(|s| s.to_string())
            .collect(),
        Some(serde_json::Value::String(s)) => s.split(',').map(|s| s.to_string()).collect(),
        _ => Vec::new(),
    };
    tags = tags
        .iter()
        .map(|t| {
            t.trim()
                .trim_matches(|c: char| c.is_whitespace() || "\"'.,;:".contains(c))
                .to_lowercase()
        })
        .filter(|t| !t.is_empty() && t.chars().count() <= 30)
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    tags.truncate(8);

    // A yes can come back as true, "true" or "yes".
    let book = match value.get("book") {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => matches!(s.trim().to_lowercase().as_str(), "true" | "yes"),
        _ => false,
    };

    Suggestion {
        book,
        designer: text("designer").chars().take(120).collect(),
        difficulty: difficulty.to_string(),
        needle_size: text("needleSize")
            .chars()
            .take(120)
            .collect(),
        yarn_weight: text("yarnWeight").chars().take(40).collect(),
        yarn: text("yarn").chars().take(120).collect(),
        tags,
        summary: text("summary").chars().take(400).collect(),
    }
}

/// True when a suggestion contains nothing worth writing.
pub fn is_empty(s: &Suggestion) -> bool {
    s.designer.is_empty()
        && s.difficulty.is_empty()
        && s.needle_size.is_empty()
        && s.yarn_weight.is_empty()
        && s.yarn.is_empty()
        && s.tags.is_empty()
        && s.summary.is_empty()
}

// ---------- the provider interface ----------

/// What a backend is asked. Deliberately just a prompt, so a new backend is
/// only the HTTP part.
pub struct CompletionRequest {
    pub system: String,
    pub user: String,
    /// Page images as `data:` URLs, for a pattern with no text layer.
    ///
    /// Empty for the normal case. When present, the user message is sent as
    /// the multimodal content array rather than a plain string.
    pub images: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("could not reach {provider}: {detail}")]
    Unreachable { provider: String, detail: String },

    #[error("{provider} returned an error: {detail}")]
    Api { provider: String, detail: String },

    #[error("{0}")]
    BadResponse(String),

    #[error("no model server is configured yet. Open Settings and enter its address.")]
    NotConfigured,

    #[error("the request took too long and was cancelled")]
    Timeout,
}

impl AiError {
    pub fn unreachable(provider: &str, detail: impl std::fmt::Display) -> Self {
        AiError::Unreachable {
            provider: provider.to_string(),
            detail: detail.to_string(),
        }
    }

    pub fn api(provider: &str, detail: impl std::fmt::Display) -> Self {
        AiError::Api {
            provider: provider.to_string(),
            detail: detail.to_string(),
        }
    }
}

pub type AiResult<T> = Result<T, AiError>;

/// Issues a chat completion against the configured server.
pub async fn complete(
    settings: &AiSettings,
    request: &CompletionRequest,
) -> AiResult<String> {
    openai_compat::complete(settings, request).await
}

/// The model name to use, falling back when the configured one is blank.
pub fn effective_model(settings: &AiSettings) -> String {
    let model = settings.model.trim();
    if !model.is_empty() {
        model.to_string()
    } else {
        settings.fallback_model.clone()
    }
}

/// A model listing, for the settings dialog's picker.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    /// Present for OpenRouter; blank for Ollama.
    pub label: String,
}

/// Lists the models the configured server has available. Used to populate the
/// picker rather than making the user type a model name from memory.
pub async fn list_models(settings: &AiSettings) -> AiResult<Vec<ModelInfo>> {
    if openai_compat::normalise_base_url(&settings.base_url).is_empty() {
        return Err(AiError::NotConfigured);
    }
    openai_compat::list_models(settings).await
}

/// True when the configured server is on this machine or a private network,
/// which is what the UI uses to say that nothing is sent off-site.
pub fn is_local_model_server(settings: &AiSettings) -> bool {
    openai_compat::is_local_address(&openai_compat::normalise_base_url(
        &settings.base_url,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- excerpt cleaning ----------

    #[test]
    fn collapses_runs_of_whitespace() {
        let raw = "Title\n\n\n  by   Jess  \t\t Leslie \r\n\r\n  Gauge: 28 sts";
        let out = clean_excerpt(raw, 4000);
        assert_eq!(out, "Title by Jess Leslie Gauge: 28 sts");
    }

    #[test]
    fn keeps_single_spaces_between_words() {
        assert_eq!(clean_excerpt("a  b   c", 100), "a b c");
    }

    #[test]
    fn never_starts_with_a_space() {
        assert_eq!(clean_excerpt("   leading", 100), "leading");
    }

    #[test]
    fn truncates_on_the_budget() {
        let long = "word ".repeat(5000);
        let out = clean_excerpt(&long, 200);
        assert!(out.len() <= 220, "was {}", out.len());
        assert!(out.contains("[truncated]"));
    }

    #[test]
    fn an_absurd_budget_still_yields_something() {
        // A zero or negative setting must not produce an empty excerpt.
        assert!(!clean_excerpt("some text here", 0).is_empty());
        assert!(!clean_excerpt("some text here", -5).is_empty());
    }

    #[test]
    fn empty_input_stays_empty() {
        assert_eq!(clean_excerpt("", 1000), "");
        assert_eq!(clean_excerpt("    \n\n  ", 1000), "");
    }

    // ---------- JSON extraction ----------

    #[test]
    fn reads_a_plain_object() {
        let v = extract_json_object(r#"{"designer":"Jess Leslie","tags":["lace"]}"#).unwrap();
        assert_eq!(v["designer"], "Jess Leslie");
    }

    #[test]
    fn reads_an_object_inside_a_code_fence() {
        let reply = "```json\n{\"designer\": \"Jess Leslie\"}\n```";
        let v = extract_json_object(reply).unwrap();
        assert_eq!(v["designer"], "Jess Leslie");
    }

    #[test]
    fn reads_an_object_after_preamble() {
        let reply = "Sure! Here is the metadata you asked for:\n\n{\"yarn\":\"Shetland\"}";
        let v = extract_json_object(reply).unwrap();
        assert_eq!(v["yarn"], "Shetland");
    }

    /// A brace inside a quoted value must not be read as the end of the object.
    #[test]
    fn handles_braces_inside_strings() {
        let reply = r#"{"summary":"knit {with} braces","yarn":"alpaca"}"#;
        let v = extract_json_object(reply).unwrap();
        assert_eq!(v["summary"], "knit {with} braces");
        assert_eq!(v["yarn"], "alpaca");
    }

    /// An escaped quote must not end the string early.
    #[test]
    fn handles_escaped_quotes() {
        let reply = r#"{"designer":"By \"Someone\" Leslie","tags":[]}"#;
        let v = extract_json_object(reply).unwrap();
        assert_eq!(v["designer"], r#"By "Someone" Leslie"#);
    }

    #[test]
    fn returns_nothing_when_there_is_no_object() {
        assert!(extract_json_object("I cannot help with that.").is_none());
        assert!(extract_json_object("").is_none());
        assert!(extract_json_object("[1, 2, 3]").is_none());
    }

    /// An array is not a valid answer, even though it parses as JSON.
    #[test]
    fn a_bare_array_is_not_an_object() {
        assert!(extract_json_object(r#"["designer","lace"]"#).is_none());
    }

    #[test]
    fn an_unterminated_object_is_rejected() {
        assert!(extract_json_object(r#"{"designer": "Jess"#).is_none());
    }

    // ---------- suggestion parsing ----------

    #[test]
    fn parses_a_well_formed_reply() {
        let v = extract_json_object(
            r#"{"designer":"Jess Leslie","difficulty":"intermediate","needleSize":"4mm",
                "yarn":"Shetland wool","tags":["Lace","Socks"],"summary":"A fine sock."}"#,
        )
        .unwrap();
        let s = parse_suggestion(&v);
        assert_eq!(s.designer, "Jess Leslie");
        assert_eq!(s.difficulty, "intermediate");
        assert_eq!(s.needle_size, "4mm");
        assert_eq!(s.tags, vec!["lace", "socks"]);
    }

    #[test]
    fn accepts_a_freeform_difficulty() {
        // Models add qualifiers, and synonyms, and capitalise differently.
        for (input, expected) in [
            ("Beginner", "beginner"),
            ("ADVANCED", "advanced"),
            ("Intermediate", "intermediate"),
            ("intermediate difficulty", "intermediate"),
            ("Expert", "advanced"),
            ("medium", "intermediate"),
            ("simple", "easy"),
            ("for experienced knitters", "advanced"),
        ] {
            let v = extract_json_object(&format!(r#"{{"difficulty":"{input}"}}"#)).unwrap();
            assert_eq!(parse_suggestion(&v).difficulty, expected, "input: {input}");
        }
    }

    #[test]
    fn an_unrecognised_difficulty_becomes_empty() {
        let v = extract_json_object(r#"{"difficulty":"spicy"}"#).unwrap();
        assert_eq!(parse_suggestion(&v).difficulty, "");
    }

    #[test]
    fn reads_whether_it_is_a_book() {
        let yes = |json: &str| parse_suggestion(&extract_json_object(json).unwrap()).book;
        assert!(yes(r#"{"book":true}"#));
        assert!(yes(r#"{"book":"yes"}"#));
        assert!(!yes(r#"{"book":false}"#));
        assert!(!yes(r#"{"designer":"Someone"}"#));
    }

    #[test]
    fn accepts_tags_as_a_comma_separated_string() {
        let v = extract_json_object(r#"{"tags":"lace, socks ,  colourwork"}"#).unwrap();
        // Tags come back sorted, so a comparison must not depend on the order
        // the model happened to use.
        let mut expected = vec!["lace", "socks", "colourwork"];
        expected.sort();
        assert_eq!(parse_suggestion(&v).tags, expected);
    }

    #[test]
    fn accepts_a_single_string_tag() {
        let v = extract_json_object(r#"{"tags":"lace"}"#).unwrap();
        assert_eq!(parse_suggestion(&v).tags, vec!["lace"]);
    }

    #[test]
    fn tags_are_cleaned_deduped_and_capped() {
        let v = extract_json_object(
            r#"{"tags":[" Lace ","LACE","socks","a very long tag that goes on and on and on",
                        "","   ","work"]}"#,
        )
        .unwrap();
        let tags = parse_suggestion(&v).tags;
        assert_eq!(tags.iter().filter(|t| *t == "lace").count(), 1);
        assert!(tags.contains(&"socks".to_string()));
        assert!(tags.contains(&"work".to_string()));
        // Over-long and blank tags are dropped rather than stored.
        assert!(!tags.iter().any(|t| t.len() > 30));
        assert!(!tags.iter().any(|t| t.trim().is_empty()));
        assert!(tags.len() <= 8);
    }

    #[test]
    fn missing_fields_become_empty_not_errors() {
        let v = extract_json_object(r#"{"designer":"Someone"}"#).unwrap();
        let s = parse_suggestion(&v);
        assert_eq!(s.designer, "Someone");
        assert!(s.difficulty.is_empty());
        assert!(s.needle_size.is_empty());
        assert!(s.tags.is_empty());
    }

    #[test]
    fn wrong_types_do_not_panic() {
        // A model that answers a number where a string belongs.
        let v = extract_json_object(r#"{"designer":42,"tags":"lace","difficulty":3}"#).unwrap();
        let s = parse_suggestion(&v);
        assert!(s.designer.is_empty());
        assert_eq!(s.tags, vec!["lace"]);
    }

    #[test]
    fn a_very_long_value_is_truncated() {
        let long = "x".repeat(5000);
        let v = extract_json_object(&format!(r#"{{"designer":"{long}"}}"#)).unwrap();
        let s = parse_suggestion(&v);
        assert!(s.designer.chars().count() <= 120);
    }

    #[test]
    fn is_empty_detects_an_answer_with_nothing_in_it() {
        let v = extract_json_object(r#"{"designer":"","difficulty":"","tags":[]}"#).unwrap();
        assert!(is_empty(&parse_suggestion(&v)));
        let v = extract_json_object(r#"{"designer":"Someone"}"#).unwrap();
        assert!(!is_empty(&parse_suggestion(&v)));
    }

    // ---------- prompts and settings ----------

    #[test]
    fn the_user_prompt_carries_the_excerpt() {
        let prompt = build_user_prompt("A Sock", "a-sock.pdf", "Gauge 28 sts", Some(4));
        assert!(prompt.contains("The file has 4 pages."));
        assert!(!build_user_prompt("A Sock", "a-sock.pdf", "Gauge 28 sts", None).contains("page"));
        assert!(prompt.contains("a-sock.pdf"));
        assert!(prompt.contains("A Sock"));
        assert!(prompt.contains("Gauge 28 sts"));
    }

    #[test]
    fn the_system_prompt_states_the_schema() {
        for key in [
            "designer",
            "difficulty",
            "needleSize",
            "yarn",
            "tags",
            "summary",
        ] {
            assert!(SYSTEM_PROMPT.contains(key), "prompt omits {key}");
        }
    }

    #[test]
    fn a_blank_model_falls_back() {
        let mut s = AiSettings {
            model: "  ".to_string(),
            fallback_model: "some-other-model".to_string(),
            ..Default::default()
        };
        assert_eq!(effective_model(&s), "some-other-model");
        s.model = "chosen-model".to_string();
        assert_eq!(effective_model(&s), "chosen-model");
    }

    /// A blank address has to read as "not configured" rather than producing
    /// a nonsense request, since nothing is guessed on the user's behalf.
    #[test]
    fn a_blank_address_is_not_configured() {
        let s = AiSettings {
            base_url: "   ".to_string(),
            ..Default::default()
        };
        assert!(!is_local_model_server(&s));
        assert!(openai_compat::normalise_base_url(&s.base_url).is_empty());
    }

    /// The shipped default points at a remote server, so the UI must not
    /// claim nothing leaves the machine.
    #[test]
    fn the_default_server_is_recognised_as_remote() {
        let s = AiSettings::default();
        assert!(s.base_url.starts_with("https://"));
        assert!(!is_local_model_server(&s));
    }
}
