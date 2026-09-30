//! Checking for and applying app updates from GitHub releases.
//!
//! The check reads the releases feed directly rather than using an updater
//! plugin: the repository is private while the app is in beta, and the feed
//! listing is the only endpoint that surfaces prereleases, which is where
//! beta builds are published.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use semver::Version;
use serde_json::Value;
use tauri::State;

use crate::db;
use crate::models::{AppError, AppResult};
use crate::AppState;

type CmdResult<T> = AppResult<T>;

const RELEASES_URL: &str =
    "https://api.github.com/repos/shinystarborne/shiny-knitting/releases?per_page=20";
const SETTINGS_KEY: &str = "updates";
/// How often the startup check is allowed to actually hit the network.
const STARTUP_CHECK_INTERVAL_SECS: i64 = 24 * 60 * 60;

/// The installed version, as the build knows it.
fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A client with the User-Agent GitHub insists on, matching the AI module.
///
/// The error is a bare reason string so each caller can word it for what it
/// was doing ("could not check…", "could not download…").
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        // GitHub answers 403 to a request with no User-Agent, and reqwest
        // sends none by default.
        .user_agent(concat!("ShinyKnitting/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

// ---------- models ----------

/// One downloadable update: the release it came from and the installer asset.
#[derive(Debug, serde::Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub tag: String,
    pub name: String,
    pub published_at: String,
    pub prerelease: bool,
    pub asset_name: String,
    /// The asset's API URL, not the browser download URL: the API URL serves
    /// the bytes directly, where the browser URL's redirect breaks some
    /// clients.
    pub asset_api_url: String,
    pub size_bytes: u64,
}

/// What a manual check found.
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    pub current_version: String,
    /// Unix seconds.
    pub checked_at: i64,
    pub update: Option<UpdateInfo>,
}

/// What the startup check found. Errors become `skipped: true` rather than a
/// failure: launch must never be interrupted by an update check.
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupOutcome {
    pub skipped: bool,
    pub current_version: Option<String>,
    pub checked_at: Option<i64>,
    pub update: Option<UpdateInfo>,
}

/// The settings row stored under the "updates" key.
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    pub include_beta: bool,
    pub check_on_startup: bool,
    /// Unix seconds of the last attempted check, 0 when never.
    pub last_checked_at: i64,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            include_beta: false,
            check_on_startup: true,
            last_checked_at: 0,
        }
    }
}

/// The settings as the frontend sees them, with the running version added.
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsView {
    pub include_beta: bool,
    pub check_on_startup: bool,
    pub current_version: String,
}

// ---------- settings ----------

#[tauri::command]
pub fn get_update_settings(state: State<'_, AppState>) -> CmdResult<UpdateSettingsView> {
    let settings: UpdateSettings = db::get_setting(&state.db(), SETTINGS_KEY)?;
    Ok(UpdateSettingsView {
        include_beta: settings.include_beta,
        check_on_startup: settings.check_on_startup,
        current_version: current_version(),
    })
}

/// Saves the two toggles, leaving `last_checked_at` alone.
#[tauri::command]
pub fn save_update_settings(
    state: State<'_, AppState>,
    include_beta: bool,
    check_on_startup: bool,
) -> CmdResult<()> {
    let conn = state.db();
    let mut settings: UpdateSettings = db::get_setting(&conn, SETTINGS_KEY)?;
    settings.include_beta = include_beta;
    settings.check_on_startup = check_on_startup;
    db::set_setting(&conn, SETTINGS_KEY, &settings)
}

// ---------- checking ----------

/// Parses a release tag like `v0.2.0-beta.2`, ignoring the leading `v`.
fn parse_tag(tag: &str) -> Option<Version> {
    Version::parse(tag.strip_prefix('v').unwrap_or(tag)).ok()
}

/// The newest release worth offering, or `None` when nothing beats `current`.
///
/// Drafts and tags that are not semver are ignored; prereleases count only
/// with `include_beta`. A release with no usable Windows installer asset
/// counts as nothing to offer.
fn pick_release(releases: &[Value], include_beta: bool, current: &Version) -> Option<UpdateInfo> {
    releases
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .filter(|r| include_beta || !r["prerelease"].as_bool().unwrap_or(false))
        .filter_map(|r| parse_tag(r["tag_name"].as_str()?).map(|v| (v, r)))
        .filter(|(v, _)| v > current)
        .max_by(|a, b| a.0.cmp(&b.0))
        .and_then(|(_, release)| build_info(release))
}

fn build_info(release: &Value) -> Option<UpdateInfo> {
    let (asset_name, asset_api_url, size_bytes) = pick_asset(release)?;
    Some(UpdateInfo {
        tag: release["tag_name"].as_str()?.to_string(),
        name: release["name"].as_str().unwrap_or_default().to_string(),
        published_at: release["published_at"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        prerelease: release["prerelease"].as_bool().unwrap_or(false),
        asset_name,
        asset_api_url,
        size_bytes,
    })
}

/// The installer asset of a release: the NSIS `-setup.exe` (per-user, no
/// admin prompt) when present, else any `.exe`, else nothing.
fn pick_asset(release: &Value) -> Option<(String, String, u64)> {
    let assets = release["assets"].as_array()?;
    let find = |suffix: &str| {
        assets.iter().find(|a| {
            a["name"]
                .as_str()
                .is_some_and(|name| name.ends_with(suffix))
        })
    };
    // Try the specific suffix first: a "-setup.exe" also ends with ".exe".
    let asset = find("-setup.exe").or_else(|| find(".exe"))?;
    Some((
        asset["name"].as_str()?.to_string(),
        asset["url"].as_str()?.to_string(),
        asset["size"].as_u64().unwrap_or(0),
    ))
}

async fn run_check(include_beta: bool) -> CmdResult<UpdateOutcome> {
    let client = client().map_err(|e| AppError::Message(format!("could not check for updates: {e}")))?;
    let response = client
        .get(RELEASES_URL)
        .send()
        .await
        .map_err(|e| AppError::Message(format!("could not check for updates: {e}")))?;
    // The feed answers 404 for a repository the caller cannot see, which for
    // this app means the repo is private or gone.
    if response.status().as_u16() == 404 {
        return Err(AppError::Message("releases could not be reached".into()));
    }
    let response = response
        .error_for_status()
        .map_err(|e| AppError::Message(format!("could not check for updates: {e}")))?;
    let releases: Vec<Value> = response
        .json()
        .await
        .map_err(|e| AppError::Message(format!("could not check for updates: {e}")))?;

    let current = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| AppError::Message(format!("could not check for updates: {e}")))?;
    Ok(UpdateOutcome {
        current_version: current.to_string(),
        checked_at: now_secs(),
        update: pick_release(&releases, include_beta, &current),
    })
}

#[tauri::command]
pub async fn check_for_update(include_beta: bool) -> CmdResult<UpdateOutcome> {
    run_check(include_beta).await
}

/// Whether the startup check should actually run at this moment.
fn should_run_startup_check(now: i64, settings: &UpdateSettings) -> bool {
    settings.check_on_startup && now - settings.last_checked_at >= STARTUP_CHECK_INTERVAL_SECS
}

/// The launch-time check. Always answers, never fails: a skipped result is
/// how "off", "too soon" and "the check failed" are all reported.
#[tauri::command]
pub async fn startup_update_check(state: State<'_, AppState>) -> CmdResult<StartupOutcome> {
    let skipped = |current_version: Option<String>, checked_at: Option<i64>| StartupOutcome {
        skipped: true,
        current_version,
        checked_at,
        update: None,
    };

    let settings: UpdateSettings = {
        let conn = state.db();
        match db::get_setting(&conn, SETTINGS_KEY) {
            Ok(s) => s,
            Err(_) => return Ok(skipped(Some(current_version()), None)),
        }
    };

    let now = now_secs();
    if !should_run_startup_check(now, &settings) {
        return Ok(skipped(Some(current_version()), None));
    }

    // Record the attempt before running it, so a failing network does not get
    // retried on every launch.
    {
        let conn = state.db();
        let mut stamped = settings.clone();
        stamped.last_checked_at = now;
        let _ = db::set_setting(&conn, SETTINGS_KEY, &stamped);
    }

    match run_check(settings.include_beta).await {
        Ok(outcome) => Ok(StartupOutcome {
            skipped: false,
            current_version: Some(outcome.current_version),
            checked_at: Some(outcome.checked_at),
            update: outcome.update,
        }),
        Err(_) => Ok(skipped(Some(current_version()), Some(now))),
    }
}

// ---------- downloading and installing ----------

#[tauri::command]
pub async fn download_update(asset_api_url: String, file_name: String) -> CmdResult<String> {
    let err = |e: &dyn std::fmt::Display| {
        AppError::Message(format!("could not download the update: {e}"))
    };

    let client = client().map_err(|e| AppError::Message(format!("could not download the update: {e}")))?;
    let mut response = client
        .get(&asset_api_url)
        // Asking the API URL for octet-stream serves the asset bytes
        // directly instead of the JSON description.
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|e| err(&e))?;
    if !response.status().is_success() {
        return Err(err(&format_args!("the server answered {}", response.status())));
    }

    // The file name came from a release asset, so it should already be tame,
    // but it still goes on disk: strip anything that is not a plain name
    // character.
    let safe: String = file_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    let path = std::env::temp_dir().join(format!("ShinyKnitting-update-{safe}"));

    let mut file = std::fs::File::create(&path).map_err(|e| err(&e))?;
    while let Some(chunk) = response.chunk().await.map_err(|e| err(&e))? {
        file.write_all(&chunk).map_err(|e| err(&e))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Guards `install_update`: only the installer this app downloaded may be
/// run, which means a `.exe` that exists inside the temp folder.
fn validate_install_path(path: &Path) -> CmdResult<()> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err(AppError::Message(
            "Only the downloaded installer (.exe) can be run.".into(),
        ));
    }
    if !path.starts_with(std::env::temp_dir()) {
        return Err(AppError::Message(
            "The installer must be the one this app downloaded.".into(),
        ));
    }
    if !path.is_file() {
        return Err(AppError::Message(
            "The downloaded installer is missing.".into(),
        ));
    }
    Ok(())
}

/// Starts the downloaded installer and exits so it can replace the app.
#[tauri::command]
pub fn install_update(app: tauri::AppHandle, path: String) -> CmdResult<()> {
    let path = PathBuf::from(path);
    validate_install_path(&path)?;
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| AppError::Message(format!("could not start the installer: {e}")))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn asset(name: &str, size: u64) -> Value {
        json!({
            "name": name,
            "url": format!("https://api.github.com/repos/assets/{name}"),
            "browser_download_url": format!("https://example.com/{name}"),
            "size": size,
        })
    }

    fn release(tag: &str, prerelease: bool, draft: bool, assets: Vec<Value>) -> Value {
        json!({
            "tag_name": tag,
            "name": format!("Release {tag}"),
            "published_at": "2024-01-01T00:00:00Z",
            "prerelease": prerelease,
            "draft": draft,
            "assets": assets,
        })
    }

    fn setup_asset() -> Value {
        asset("ShinyKnitting-setup.exe", 1_000_000)
    }

    #[test]
    fn a_beta_tag_parses_as_a_prerelease_and_garbage_is_skipped() {
        let v = parse_tag("v0.2.0-beta.2").expect("parses");
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 0);
        assert!(!v.pre.is_empty());

        assert!(parse_tag("not-a-version").is_none());
        assert!(parse_tag("v2").is_none());

        // A garbage tag is skipped even when it is the only newer-looking
        // entry, rather than failing the whole check.
        let current = Version::new(0, 2, 1);
        let releases = vec![
            release("garbage", false, false, vec![setup_asset()]),
            release("v0.2.0", false, false, vec![setup_asset()]),
        ];
        assert!(pick_release(&releases, false, &current).is_none());
    }

    #[test]
    fn the_newest_candidate_wins_beta_on_and_off() {
        let current = Version::new(0, 2, 1);
        let releases = vec![
            release("v0.3.0", false, false, vec![setup_asset()]),
            release("v0.4.0-beta.1", true, false, vec![setup_asset()]),
        ];
        // Without beta, the stable 0.3.0 is the newest on offer.
        let picked = pick_release(&releases, false, &current).expect("stable update");
        assert_eq!(picked.tag, "v0.3.0");
        assert!(!picked.prerelease);
        // With beta, the prerelease 0.4.0-beta.1 outranks it.
        let picked = pick_release(&releases, true, &current).expect("beta update");
        assert_eq!(picked.tag, "v0.4.0-beta.1");
        assert!(picked.prerelease);
    }

    #[test]
    fn drafts_are_never_offered() {
        let current = Version::new(0, 2, 1);
        let releases = vec![release("v9.9.9", false, true, vec![setup_asset()])];
        assert!(pick_release(&releases, true, &current).is_none());
    }

    #[test]
    fn the_beta_tag_skew_never_offers_the_installed_version() {
        // The 0.2.1 build shipped tagged as v0.2.0-beta.2; semver ordering
        // (0.2.1 > 0.2.0-beta.2) keeps it from looking like an update.
        let current = Version::new(0, 2, 1);
        let releases = vec![release("v0.2.0-beta.2", true, false, vec![setup_asset()])];
        assert!(pick_release(&releases, true, &current).is_none());
    }

    #[test]
    fn a_newer_beta_is_offered_only_with_beta_enabled() {
        let current = Version::new(0, 2, 1);
        let releases = vec![release("v0.3.0-beta.1", true, false, vec![setup_asset()])];
        assert!(pick_release(&releases, false, &current).is_none());
        let picked = pick_release(&releases, true, &current).expect("beta update");
        assert_eq!(picked.tag, "v0.3.0-beta.1");
        assert_eq!(picked.asset_name, "ShinyKnitting-setup.exe");
        assert_eq!(
            picked.asset_api_url,
            "https://api.github.com/repos/assets/ShinyKnitting-setup.exe"
        );
        assert_eq!(picked.size_bytes, 1_000_000);
    }

    #[test]
    fn the_setup_exe_is_preferred_and_an_msi_only_release_is_skipped() {
        let current = Version::new(0, 2, 1);
        let mixed = vec![release(
            "v0.3.0",
            false,
            false,
            vec![
                asset("ShinyKnitting.msi", 2_000_000),
                asset("ShinyKnitting.exe", 3_000_000),
                asset("ShinyKnitting-setup.exe", 1_000_000),
            ],
        )];
        let picked = pick_release(&mixed, false, &current).expect("update");
        assert_eq!(picked.asset_name, "ShinyKnitting-setup.exe");

        // With no "-setup.exe", a plain ".exe" still counts.
        let plain = vec![release(
            "v0.3.0",
            false,
            false,
            vec![asset("ShinyKnitting.msi", 2), asset("ShinyKnitting.exe", 3)],
        )];
        let picked = pick_release(&plain, false, &current).expect("update");
        assert_eq!(picked.asset_name, "ShinyKnitting.exe");

        // An .msi alone is not something install_update can run.
        let msi_only = vec![release(
            "v0.3.0",
            false,
            false,
            vec![asset("ShinyKnitting.msi", 2)],
        )];
        assert!(pick_release(&msi_only, false, &current).is_none());
    }

    #[test]
    fn settings_round_trip_and_defaults() {
        let conn = crate::db::open_test_db();
        let defaults: UpdateSettings = db::get_setting(&conn, SETTINGS_KEY).unwrap();
        assert!(!defaults.include_beta);
        assert!(defaults.check_on_startup);
        assert_eq!(defaults.last_checked_at, 0);

        let custom = UpdateSettings {
            include_beta: true,
            check_on_startup: false,
            last_checked_at: 1234,
        };
        db::set_setting(&conn, SETTINGS_KEY, &custom).unwrap();
        let loaded: UpdateSettings = db::get_setting(&conn, SETTINGS_KEY).unwrap();
        assert!(loaded.include_beta);
        assert!(!loaded.check_on_startup);
        assert_eq!(loaded.last_checked_at, 1234);
    }

    #[test]
    fn the_startup_check_is_gated_by_the_setting_and_the_day() {
        let on = |check_on_startup: bool, last_checked_at: i64| UpdateSettings {
            check_on_startup,
            last_checked_at,
            ..Default::default()
        };
        let now = 1_000_000;

        assert!(should_run_startup_check(now, &on(true, 0)));
        // Exactly a day on, it runs again.
        assert!(should_run_startup_check(
            now,
            &on(true, now - STARTUP_CHECK_INTERVAL_SECS)
        ));
        // Less than a day, it does not.
        assert!(!should_run_startup_check(
            now,
            &on(true, now - STARTUP_CHECK_INTERVAL_SECS + 1)
        ));
        // Off means never, however long it has been.
        assert!(!should_run_startup_check(now, &on(false, 0)));
    }

    #[test]
    fn install_path_validation() {
        // A real .exe in the temp folder passes.
        let ok = std::env::temp_dir().join("shiny-knitting-test-installer.exe");
        std::fs::write(&ok, b"exe").unwrap();
        assert!(validate_install_path(&ok).is_ok());
        std::fs::remove_file(&ok).unwrap();

        // A real .exe outside the temp folder (this test binary) is refused.
        let elsewhere = std::env::current_exe().unwrap();
        assert!(!elsewhere.starts_with(std::env::temp_dir()));
        assert!(validate_install_path(&elsewhere).is_err());

        // An .msi in the temp folder is refused.
        let msi = std::env::temp_dir().join("shiny-knitting-test-installer.msi");
        std::fs::write(&msi, b"msi").unwrap();
        assert!(validate_install_path(&msi).is_err());
        std::fs::remove_file(&msi).unwrap();

        // A missing file is refused.
        let missing = std::env::temp_dir().join("shiny-knitting-no-such-installer.exe");
        assert!(validate_install_path(&missing).is_err());
    }

    /// Talks to the real GitHub releases feed. Ignored by default because it
    /// needs the network and a public repository; run it with
    /// `cargo test -- --ignored` when changing the check.
    #[tokio::test]
    #[ignore = "needs the live GitHub releases feed"]
    async fn reaches_the_live_releases_feed() {
        // Stable only: the newest stable (0.1.0) is older than this build.
        let outcome = run_check(false)
            .await
            .expect("the releases feed should answer");
        assert_eq!(outcome.current_version, env!("CARGO_PKG_VERSION"));
        assert!(outcome.update.is_none(), "stable feed offered an update to a newer build");

        // With betas: the newest prerelease is still this build's own tag
        // (v0.2.0-beta.2 ships version 0.2.1), so no update either way — but
        // the feed must parse and prereleases must be considered.
        let beta = run_check(true).await.expect("the releases feed should answer");
        assert!(beta.update.is_none(), "the newest release is this build itself");
    }
}
