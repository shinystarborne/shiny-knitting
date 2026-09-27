//! The one backend: any OpenAI-compatible chat completions endpoint.
//!
//! This is deliberately not split into "Ollama" and "OpenRouter". A model
//! served by Ollama, LM Studio, vLLM, llama.cpp, LocalAI, or OpenRouter all
//! expose the same two endpoints, `/v1/chat/completions` and `/v1/models`, so
//! they differ only in the base URL and whether a key is required. One
//! configurable endpoint covers all of them, and a self-hosted model on
//! another machine is just another address.
//!
//! The API key is optional. Local servers usually need none, and requiring one
//! would lock out exactly the case where nothing leaves your own network.

use std::time::Duration;

use serde::Deserialize;

use super::{AiError, AiResult, CompletionRequest, ModelInfo};
use crate::models::AiSettings;

const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
    /// Some servers return the error in the body with a 200 status.
    #[serde(default)]
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    message: Message,
    /// Present when generation stopped because it hit the token limit.
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct Message {
    #[serde(default)]
    content: String,
    // Reasoning models put their working here and may return empty content.
    #[serde(default)]
    reasoning: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct ModelList {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
}

fn client() -> AiResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        // Some self-hosted gateways, and this one in particular, answer 403 to
        // a request with no User-Agent. reqwest sends none by default, so it
        // has to be set explicitly or every call is refused.
        .user_agent(concat!("ShinyKnitting/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AiError::unreachable("the model server", e))
}

/// Normalises whatever the user typed into a base URL ending in `/v1`.
///
/// Someone pasting `http://192.168.1.20:11434` means the same thing as
/// `http://192.168.1.20:11434/v1`, and making them add the version themselves
/// is a pointless papercut. A URL that already names a version is left alone.
pub fn normalise_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with("/v1") || trimmed.ends_with("/api/v1") {
        return trimmed.to_string();
    }
    format!("{trimmed}/v1")
}

/// True when the address points at this machine or a private network, which
/// is what the UI uses to reassure the user that nothing is being sent away.
pub fn is_local_address(base_url: &str) -> bool {
    let host = host_of(base_url).to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host == "::1" {
        return true;
    }
    // The names a home server usually answers to.
    if host.ends_with(".local") || host.ends_with(".lan") {
        return true;
    }
    match ipv4_octets(&host) {
        Some([a, b, _, _]) => {
            a == 0 || a == 10 || a == 127 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
        }
        None => false,
    }
}

/// The host part of an address, with any scheme, credentials, port and path
/// removed. The private-address check has to look at the host alone: matching
/// substrings of the whole URL reads "evil10.com" as a private address and
/// "172.2.x.x" as the 172.16/12 range.
fn host_of(url: &str) -> &str {
    let after_scheme = match url.split_once("://") {
        Some((_, rest)) => rest,
        None => url,
    };
    let after_auth = after_scheme.rsplit('@').next().unwrap_or(after_scheme);
    let host_port = after_auth.split('/').next().unwrap_or("");
    if let Some(rest) = host_port.strip_prefix('[') {
        // An IPv6 literal, written [addr]:port.
        return rest.split(']').next().unwrap_or("");
    }
    host_port.split(':').next().unwrap_or("")
}

/// The four octets of a dotted IPv4 address, or None when the host is a name.
fn ipv4_octets(host: &str) -> Option<[u8; 4]> {
    let mut octets = [0u8; 4];
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    for (slot, part) in octets.iter_mut().zip(parts) {
        // A part with a leading zero or a sign is a name, not an octet.
        if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    Some(octets)
}

/// Attaches the key only when there is one; a local server usually has none
/// and may reject a request that carries a bogus `Authorization` header.
fn authorised(
    request: reqwest::RequestBuilder,
    settings: &AiSettings,
) -> reqwest::RequestBuilder {
    let key = settings.api_key.trim();
    if key.is_empty() {
        request
    } else {
        request.bearer_auth(key)
    }
}

/// The user turn, as either a plain string or the multimodal content array.
///
/// The shape is what distinguishes a text request from an image one across
/// every OpenAI-compatible server, so it is chosen by whether any images came
/// with the request. Sending a content array where a string is expected is
/// accepted by some servers and rejected by others, and a plain string is
/// universally fine, so the array is only used when it is actually needed.
fn user_content(request: &CompletionRequest) -> serde_json::Value {
    if request.images.is_empty() {
        return serde_json::Value::String(request.user.clone());
    }
    let mut parts = vec![serde_json::json!({
        "type": "text",
        "text": request.user,
    })];
    for image in &request.images {
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": image },
        }));
    }
    serde_json::Value::Array(parts)
}

/// The chat completions payload.
///
/// JSON output is asked for on every call: the reply is always parsed as a
/// JSON object, and whether the model *reasons* has nothing to do with the
/// shape it answers in. The reasoning effort is separate, and only sent when
/// one is chosen, so clearing the field leaves the model's own default alone.
fn request_body(model: &str, settings: &AiSettings, request: &CompletionRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": request.system },
            { "role": "user", "content": user_content(request) },
        ],
        "temperature": 0.1,
        // Deliberately generous. A reasoning model spends part of this budget
        // thinking before it writes anything, and if the cap lands first the
        // reply comes back empty. Running out of room mid-answer is far more
        // expensive than a few unused tokens.
        "max_tokens": 4000,
        "stream": false,
        "response_format": { "type": "json_object" },
    });

    let effort = settings.reasoning_effort.trim();
    if !effort.is_empty() {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }
    body
}

pub async fn complete(
    settings: &AiSettings,
    request: &CompletionRequest,
) -> AiResult<String> {
    let base = normalise_base_url(&settings.base_url);
    if base.is_empty() {
        return Err(AiError::NotConfigured);
    }
    let model = super::effective_model(settings);
    if model.trim().is_empty() {
        return Err(AiError::NotConfigured);
    }

    let url = format!("{base}/chat/completions");
    let body = request_body(&model, settings, request);

    let response = authorised(client()?.post(&url), settings)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AiError::Timeout
            } else {
                AiError::unreachable("the model server", describe(&e, &base))
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(AiError::api(
            "the model server",
            explain_status(status.as_u16(), &detail),
        ));
    }

    let parsed: ChatResponse =
        response.json().await.map_err(|e| AiError::BadResponse(e.to_string()))?;

    if let Some(err) = parsed.error {
        if !err.message.is_empty() {
            return Err(AiError::api("the model server", err.message));
        }
    }

    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| AiError::BadResponse("the reply contained no choices".to_string()))?;

    if choice.message.content.trim().is_empty() {
        // A reasoning model that ran out of budget answers with an empty
        // message. Saying which it was beats a bare parsing failure.
        let reasoned = choice.message.reasoning.is_some() || choice.message.reasoning_content.is_some();
        return Err(AiError::BadResponse(if reasoned {
            "the model used its whole reply on reasoning and produced no answer. \
             Try a lower reasoning effort in Settings, or a model that does not \
             reason before answering."
                .to_string()
        } else {
            format!(
                "the model returned an empty reply (finished: {}).",
                choice.finish_reason.as_deref().unwrap_or("unspecified")
            )
        }));
    }

    Ok(choice.message.content)
}

pub async fn list_models(settings: &AiSettings) -> AiResult<Vec<ModelInfo>> {
    let base = normalise_base_url(&settings.base_url);
    if base.is_empty() {
        return Err(AiError::NotConfigured);
    }
    let url = format!("{base}/models");
    let response = authorised(client()?.get(&url), settings)
        .send()
        .await
        .map_err(|e| AiError::unreachable("the model server", describe(&e, &base)))?;

    if !response.status().is_success() {
        return Err(AiError::api(
            "the model server",
            response.status().to_string(),
        ));
    }

    let parsed: ModelList =
        response.json().await.map_err(|e| AiError::BadResponse(e.to_string()))?;

    Ok(parsed
        .data
        .into_iter()
        .map(|m| ModelInfo {
            label: if m.name.is_empty() { m.id.clone() } else { m.name },
            id: m.id,
        })
        .filter(|m| !m.id.is_empty())
        .collect())
}

/// Turns a connection failure into something that names the likely cause.
fn describe(error: &reqwest::Error, base_url: &str) -> String {
    if error.is_connect() {
        format!(
            "no answer from {base_url}. If the model runs on another machine, check \
             the address is reachable from this one, and that it is serving an \
             OpenAI-compatible API."
        )
    } else {
        error.to_string()
    }
}

fn explain_status(code: u16, body: &str) -> String {
    let detail: String = body.chars().filter(|c| *c != '\n').take(240).collect();
    match code {
        401 => format!("the API key was rejected. Check it in Settings. {detail}"),
        403 => format!("access denied. {detail}"),
        404 => format!(
            "the server has no /v1/chat/completions endpoint at that address. \
             Check the base URL, and that the server is running. {detail}"
        ),
        429 => format!("rate limited, or the server is busy. {detail}"),
        500..=599 => format!("the model server failed ({code}). {detail}"),
        _ => format!("{code}: {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_the_api_version_when_it_is_missing() {
        assert_eq!(
            normalise_base_url("http://localhost:11434"),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            normalise_base_url("http://192.168.1.20:1234/"),
            "http://192.168.1.20:1234/v1"
        );
        assert_eq!(normalise_base_url("  0.0.0.0:8000  "), "0.0.0.0:8000/v1");
    }

    #[test]
    fn leaves_an_existing_version_alone() {
        assert_eq!(
            normalise_base_url("https://openrouter.ai/api/v1"),
            "https://openrouter.ai/api/v1"
        );
        assert_eq!(
            normalise_base_url("http://localhost:8080/v1/"),
            "http://localhost:8080/v1"
        );
        // A path that merely contains "v1" is not a version suffix.
        assert_eq!(
            normalise_base_url("https://example.com/v1beta"),
            "https://example.com/v1beta/v1"
        );
    }

    #[test]
    fn an_empty_address_stays_empty() {
        assert_eq!(normalise_base_url(""), "");
        assert_eq!(normalise_base_url("   "), "");
    }

    /// The UI leans on this to tell the user whether anything leaves the
    /// machine, so getting it wrong matters.
    #[test]
    fn recognises_local_and_private_addresses() {
        for local in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://192.168.1.20:1234/v1",
            "http://10.0.0.5:8000/v1",
            "http://172.16.4.4:8000/v1",
            "http://mymodel.local:1234/v1",
            "http://server.lan:1234/v1",
            "http://[::1]:1234/v1",
        ] {
            assert!(is_local_address(local), "should be local: {local}");
        }
        for remote in [
            "https://openrouter.ai/api/v1",
            "https://api.example.com/v1",
            "http://172.32.0.1:8000/v1",
        ] {
            assert!(!is_local_address(remote), "should be remote: {remote}");
        }
    }

    #[test]
    fn lookalike_addresses_are_not_misread_as_local() {
        // Substring matching would call all of these local: the digits of a
        // private range inside a public host or address.
        for remote in [
            // "10." appears in the name.
            "http://evil10.com/v1",
            // 172.2.x.x is public; the private range starts at 172.16.
            "http://172.2.3.4:8000/v1",
            "http://172.15.0.1:8000/v1",
            // "localhost" as a subdomain of someone else's domain.
            "http://localhost.evil.com/v1",
            // 192.168 inside a name is not the address.
            "http://192.168.example.com/v1",
        ] {
            assert!(!is_local_address(remote), "should be remote: {remote}");
        }
        for local in [
            // The edges of the private ranges.
            "http://10.255.255.255/v1",
            "http://172.16.0.1/v1",
            "http://172.31.255.255/v1",
            "http://192.168.0.1/v1",
            "http://foo.localhost:8000/v1",
            "http://0.0.0.0:8000/v1",
        ] {
            assert!(is_local_address(local), "should be local: {local}");
        }
    }

    #[test]
    fn json_mode_is_requested_regardless_of_reasoning_effort() {
        // Clearing the effort field must not stop the request asking for a
        // JSON object: the reply is parsed as one either way.
        let settings = AiSettings {
            reasoning_effort: String::new(),
            ..Default::default()
        };
        let body = request_body("m", &settings, &request(vec![]));
        assert_eq!(body["response_format"]["type"], "json_object");
        assert!(body.get("reasoning").is_none());

        let settings = AiSettings {
            reasoning_effort: "low".to_string(),
            ..Default::default()
        };
        let body = request_body("m", &settings, &request(vec![]));
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["reasoning"]["effort"], "low");
    }

    #[test]
    fn status_codes_produce_actionable_messages() {
        assert!(explain_status(401, "").contains("API key"));
        assert!(explain_status(404, "").contains("base URL"));
        assert!(explain_status(429, "").contains("busy"));
        assert!(explain_status(503, "").contains("failed"));
    }

    fn request(images: Vec<&str>) -> CompletionRequest {
        CompletionRequest {
            system: "sys".to_string(),
            user: "usr".to_string(),
            images: images.into_iter().map(str::to_string).collect(),
        }
    }

    #[test]
    fn a_text_request_sends_a_plain_string() {
        // The common case must stay a plain string: every server accepts it,
        // whereas a content array is only understood by ones that support
        // images.
        assert_eq!(
            user_content(&request(vec![])),
            serde_json::Value::String("usr".to_string())
        );
    }

    #[test]
    fn images_turn_the_user_turn_into_a_content_array() {
        let content = user_content(&request(vec![
            "data:image/jpeg;base64,AAA",
            "data:image/jpeg;base64,BBB",
        ]));
        let parts = content.as_array().expect("an array of parts");
        assert_eq!(parts.len(), 3, "one text part then one per image");

        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[0]["text"], "usr");
        for (part, expected) in parts[1..].iter().zip(["AAA", "BBB"]) {
            assert_eq!(part["type"], "image_url");
            assert_eq!(
                part["image_url"]["url"],
                format!("data:image/jpeg;base64,{expected}")
            );
        }
    }

    /// Talks to a real model server. Ignored by default because it needs the
    /// network and a server that may not be running; run it with
    /// `cargo test -- --ignored` when changing the client.
    #[tokio::test]
    #[ignore = "needs a live model server"]
    async fn reaches_a_live_openai_compatible_server() {
        let settings = AiSettings {
            base_url: "https://gen2.zeroval.eu/v1".to_string(),
            model: "Qwen3.6-27B".to_string(),
            ..Default::default()
        };

        // The point of this test: some gateways answer 403 to a request with no
        // User-Agent, and reqwest sends none unless told otherwise.
        let models = list_models(&settings)
            .await
            .expect("the model server should be reachable");
        assert!(!models.is_empty(), "the server reported no models");

        let request = super::super::CompletionRequest {
            system: "Reply with a JSON object with one key named ok set to true.".to_string(),
            user: "Reply now.".to_string(),
            images: Vec::new(),
        };
        let reply = complete(&settings, &request)
            .await
            .expect("the model should answer");
        assert!(
            reply.contains("ok"),
            "expected a JSON object, got: {reply}"
        );
    }
}
