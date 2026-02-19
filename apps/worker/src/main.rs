use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use chrono::{Datelike, Duration as ChronoDuration, Local, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    net::{SocketAddr, ToSocketAddrs},
    path::PathBuf,
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::time::{self, Duration};

#[derive(Clone)]
struct AppState {
    bearer_token: String,
    master_api_endpoint: String,
    local_api_endpoint: String,
    rustic_bin: String,
    state_dir: String,
    requests_total: Arc<AtomicU64>,
    error_total: Arc<AtomicU64>,
    started_at: Instant,
    client: reqwest::Client,
    synced_backup_plans: Arc<Mutex<Vec<SyncedBackupPlan>>>,
    executed_plan_ticks: Arc<Mutex<HashSet<String>>>,
    pending_reports: Arc<Mutex<Vec<PendingReport>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSyncPayload {
    status: &'static str,
    endpoint: String,
    uptime_ms: u64,
    requests_total: u64,
    error_total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiErrorResponse {
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRuntimeStats {
    uptime_ms: u64,
    requests_total: u64,
    error_total: u64,
    error_rate_percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticCommandResult {
    success: bool,
    command: Vec<String>,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    parsed_json: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticVersionResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticSnapshotsResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticStatsResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RusticBackupRequest {
    repository: String,
    password: Option<String>,
    backend: Option<String>,
    options: Option<HashMap<String, String>>,
    paths: Vec<String>,
    tags: Option<Vec<String>>,
    dry_run: Option<bool>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncedBackupPlan {
    id: String,
    cron: String,
    request: RusticBackupRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPlanSyncResponse {
    plans: Vec<SyncedBackupPlan>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupPlanReportRequest {
    status: String,
    error: Option<String>,
    duration_ms: u64,
    snapshot_id: Option<String>,
    snapshot_time: Option<String>,
    next_run_at: Option<String>,
    output: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticInitRequest {
    backend: Option<String>,
    repository: String,
    password: Option<String>,
    options: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticRepositoryRequest {
    repository: String,
    password: Option<String>,
    backend: Option<String>,
    options: Option<HashMap<String, String>>,
}

const PENDING_REPORTS_MAX: usize = 500;
const PENDING_REPORT_MAX_ATTEMPTS: u32 = 20;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RcloneSizeRequest {
    remote: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RcloneSizeResponse {
    worker: WorkerRuntimeStats,
    rclone: RusticCommandResult,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingReport {
    url: String,
    payload: BackupPlanReportRequest,
    attempts: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticSnapshotFilesRequest {
    repository: String,
    snapshot: String,
    path: Option<String>,
    password: Option<String>,
    backend: Option<String>,
    options: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticRestoreRequest {
    repository: String,
    snapshot: String,
    target: String,
    path: Option<String>,
    password: Option<String>,
    backend: Option<String>,
    options: Option<HashMap<String, String>>,
    dry_run: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LsDirsRequest {
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LsDirsResponse {
    dirs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticForgetRequest {
    repository: String,
    password: Option<String>,
    backend: Option<String>,
    options: Option<HashMap<String, String>>,
    keep_last: Option<u32>,
    keep_daily: Option<u32>,
    keep_weekly: Option<u32>,
    keep_monthly: Option<u32>,
    keep_yearly: Option<u32>,
    keep_within: Option<String>,
    prune: Option<bool>,
    dry_run: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticForgetResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticBackupResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticInitResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticSnapshotFilesResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RusticRepositoryCommandResponse {
    worker: WorkerRuntimeStats,
    rustic: RusticCommandResult,
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn log_info(message: impl AsRef<str>) {
    println!("[worker][info][{}] {}", timestamp_ms(), message.as_ref());
}

fn log_warn(message: impl AsRef<str>) {
    eprintln!("[worker][warn][{}] {}", timestamp_ms(), message.as_ref());
}

fn log_error(message: impl AsRef<str>) {
    eprintln!("[worker][error][{}] {}", timestamp_ms(), message.as_ref());
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("token")
        || normalized.ends_with("key")
        || normalized.contains("access_key")
}

fn is_already_initialized_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("already initialized") || normalized.contains("already exists")
}

fn strip_ansi_codes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
        }
        output.push(ch);
    }

    output
}

fn first_useful_error_line(stderr: &str) -> Option<String> {
    let lines = stderr
        .lines()
        .map(strip_ansi_codes)
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return None;
    }

    for (idx, line) in lines.iter().enumerate() {
        let normalized = line.to_ascii_lowercase();
        if normalized == "message:" {
            if let Some(next) = lines
                .iter()
                .skip(idx + 1)
                .find(|candidate| {
                    let n = candidate.to_ascii_lowercase();
                    !n.is_empty()
                        && !n.starts_with("some additional details")
                        && !n.starts_with("backtrace")
                })
                .cloned()
            {
                return Some(next);
            }
        }
    }

    for line in &lines {
        let normalized = line.to_ascii_lowercase();
        if normalized.starts_with("message:") && line.len() > 8 {
            let message = line[8..].trim();
            if !message.is_empty() {
                return Some(message.to_string());
            }
        }
    }

    lines
        .into_iter()
        .find(|line| {
            let normalized = line.to_ascii_lowercase();
            !normalized.contains("[info]") && !normalized.starts_with("info:")
        })
}

#[tokio::main]
async fn main() {
    let cli = parse_cli_args().unwrap_or_else(|err| {
        eprintln!("{err}");
        std::process::exit(2);
    });
    let addr = endpoint_to_socket_addr("local-api-endpoint", &cli.local_api_endpoint)
        .unwrap_or_else(|err| {
            eprintln!("{err}");
            std::process::exit(2);
        });

    let pending_reports = load_pending_reports(&cli.state_dir);
    let state = AppState {
        bearer_token: cli.api_token,
        master_api_endpoint: cli.master_api_endpoint,
        local_api_endpoint: cli.local_api_endpoint.clone(),
        rustic_bin: cli.rustic_bin,
        state_dir: cli.state_dir,
        requests_total: Arc::new(AtomicU64::new(0)),
        error_total: Arc::new(AtomicU64::new(0)),
        started_at: Instant::now(),
        client: reqwest::Client::new(),
        synced_backup_plans: Arc::new(Mutex::new(Vec::new())),
        executed_plan_ticks: Arc::new(Mutex::new(HashSet::new())),
        pending_reports: Arc::new(Mutex::new(pending_reports)),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/", get(index))
        .route("/rustic/version", get(rustic_version))
        .route("/rustic/snapshots", get(rustic_snapshots))
        .route("/rustic/repository-snapshots", post(rustic_repository_snapshots))
        .route("/rustic/snapshot/files", post(rustic_snapshot_files))
        .route("/rustic/check", post(rustic_check))
        .route("/rustic/repair-index", post(rustic_repair_index))
        .route("/rustic/stats", get(rustic_stats))
        .route("/rustic/init", post(rustic_init))
        .route("/rustic/backup", post(rustic_backup))
        .route("/rustic/forget", post(rustic_forget))
        .route("/rustic/restore", post(rustic_restore))
        .route("/rustic/ls-dirs", post(ls_dirs))
        .route("/rustic/rclone-size", post(rclone_size))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_logger,
        ))
        .route_layer(middleware::from_fn_with_state(state.clone(), bearer_auth))
        .with_state(state.clone());

    let sync_state = state.clone();
    tokio::spawn(async move {
        sync_stats_loop(sync_state).await;
    });
    let plan_sync_state = state.clone();
    tokio::spawn(async move {
        sync_backup_plans_loop(plan_sync_state).await;
    });
    let plan_exec_state = state.clone();
    tokio::spawn(async move {
        execute_synced_backup_plans_loop(plan_exec_state).await;
    });
    let flush_state = state.clone();
    tokio::spawn(async move {
        flush_pending_reports_loop(flush_state).await;
    });

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind listener");
    log_info(format!("worker listening on http://{addr}"));
    log_info(format!("master api endpoint: {}", state.master_api_endpoint));
    log_info(format!("local api endpoint: {}", state.local_api_endpoint));

    axum::serve(listener, app).await.expect("worker server failed");
}

async fn health() -> &'static str {
    "ok"
}

async fn rclone_size(
    State(state): State<AppState>,
    Json(payload): Json<RcloneSizeRequest>,
) -> Result<Json<RcloneSizeResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let remote = payload.remote.trim().to_string();
    if remote.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "remote is required"));
    }

    let worker = worker_runtime_stats(&state);
    let rclone = run_rclone_command(
        &state,
        vec!["size".to_string(), remote.clone(), "--json".to_string()],
        vec!["rclone".to_string(), "size".to_string(), remote, "--json".to_string()],
    )
    .await?;

    Ok(Json(RcloneSizeResponse { worker, rclone }))
}

async fn index() -> &'static str {
    "worker up"
}

fn worker_runtime_stats(state: &AppState) -> WorkerRuntimeStats {
    let requests_total = state.requests_total.load(Ordering::Relaxed);
    let error_total = state.error_total.load(Ordering::Relaxed);
    let uptime_ms = state.started_at.elapsed().as_millis() as u64;
    let error_rate_percent = if requests_total == 0 {
        0.0
    } else {
        ((error_total as f64 / requests_total as f64) * 10000.0).round() / 100.0
    };

    WorkerRuntimeStats {
        uptime_ms,
        requests_total,
        error_total,
        error_rate_percent,
    }
}

fn api_error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<ApiErrorResponse>) {
    (
        status,
        Json(ApiErrorResponse {
            error: message.into(),
        }),
    )
}

fn parse_rustic_json_output(stdout: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(stdout) {
        return Some(value);
    }

    let parsed_lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();

    if parsed_lines.is_empty() {
        None
    } else if parsed_lines.len() == 1 {
        parsed_lines.into_iter().next()
    } else {
        Some(Value::Array(parsed_lines))
    }
}

async fn run_rustic_command(
    state: &AppState,
    args: Vec<String>,
    env_vars: Vec<(String, String)>,
    command_preview: Option<Vec<String>>,
) -> Result<RusticCommandResult, (StatusCode, Json<ApiErrorResponse>)> {
    let bin = state.rustic_bin.clone();
    let state_dir = state.state_dir.clone();
    let args_for_process = args.clone();
    let env_vars_for_process = env_vars.clone();
    let full_command = command_preview.unwrap_or_else(|| {
        std::iter::once(bin.clone())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
    });
    log_info(format!("executing rustic command: {}", full_command.join(" ")));

    let output = tokio::task::spawn_blocking(move || {
        let base = PathBuf::from(&state_dir);
        let xdg_config_home = base.join("config");
        let xdg_cache_home = base.join("cache");
        let home_dir = base.join("home");
        let rclone_config = xdg_config_home.join("rclone").join("rclone.conf");
        let _ = fs::create_dir_all(home_dir.clone());
        let _ = fs::create_dir_all(xdg_config_home.join("rclone"));
        let _ = fs::create_dir_all(xdg_cache_home.clone());

        let mut command = Command::new(&bin);
        command.args(&args_for_process);
        command.env("HOME", home_dir);
        command.env("XDG_CONFIG_HOME", xdg_config_home);
        command.env("XDG_CACHE_HOME", xdg_cache_home);
        command.env("RCLONE_CONFIG", rclone_config);
        command.env("RUSTIC_LOG_LEVEL", "warn");
        for (key, value) in env_vars_for_process {
            command.env(key, value);
        }
        command.output()
    })
    .await
    .map_err(|error| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("rustic command task failed: {error}"),
        )
    })?
    .map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("rustic binary not found at '{}'", state.rustic_bin),
            )
        } else {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to execute rustic: {error}"),
            )
        }
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let parsed_json = parse_rustic_json_output(&stdout);
    let exit_code = output.status.code();
    if output.status.success() {
        log_info(format!(
            "rustic command completed successfully (exit={})",
            exit_code.unwrap_or(0)
        ));
    } else {
        log_warn(format!(
            "rustic command failed (exit={:?}) stderr={}",
            exit_code,
            stderr.trim()
        ));
    }

    Ok(RusticCommandResult {
        success: output.status.success(),
        command: full_command,
        exit_code,
        parsed_json,
        stdout,
        stderr,
    })
}

async fn run_rclone_command(
    state: &AppState,
    args: Vec<String>,
    command_preview: Vec<String>,
) -> Result<RusticCommandResult, (StatusCode, Json<ApiErrorResponse>)> {
    log_info(format!(
        "executing rclone command: {}",
        command_preview.join(" ")
    ));

    let state_dir = state.state_dir.clone();
    let args_for_process = args.clone();
    let output = tokio::task::spawn_blocking(move || {
        let base = PathBuf::from(&state_dir);
        let xdg_config_home = base.join("config");
        let home_dir = base.join("home");
        let rclone_config = xdg_config_home.join("rclone").join("rclone.conf");
        let _ = fs::create_dir_all(home_dir.clone());
        let _ = fs::create_dir_all(xdg_config_home.join("rclone"));

        let mut command = Command::new("rclone");
        command.args(&args_for_process);
        command.env("HOME", home_dir);
        command.env("XDG_CONFIG_HOME", xdg_config_home);
        command.env("RCLONE_CONFIG", rclone_config);
        command.output()
    })
            .await
            .map_err(|error| {
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("rclone command task failed: {error}"),
                )
            })?
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    api_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "rclone binary not found in PATH",
                    )
                } else {
                    api_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to execute rclone: {error}"),
                    )
                }
            })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let parsed_json = parse_rustic_json_output(&stdout);
    let exit_code = output.status.code();
    if output.status.success() {
        log_info(format!(
            "rclone command completed successfully (exit={})",
            exit_code.unwrap_or(0)
        ));
    } else {
        log_warn(format!(
            "rclone command failed (exit={:?}) stderr={}",
            exit_code,
            stderr.trim()
        ));
    }

    Ok(RusticCommandResult {
        success: output.status.success(),
        command: command_preview,
        exit_code,
        stdout,
        stderr,
        parsed_json,
    })
}

async fn prepare_repository_for_rclone(
    state: &AppState,
    mut repository: String,
    backend: Option<&str>,
    options: &HashMap<String, String>,
    operation: &str,
) -> Result<String, (StatusCode, Json<ApiErrorResponse>)> {
    if backend != Some("rclone") {
        if !options.is_empty() {
            log_warn(format!(
                "{operation} received repository options, but backend is not rclone; ignoring options"
            ));
        }
        return Ok(repository);
    }

    let remote_from_repository = repository
        .strip_prefix("rclone:")
        .and_then(|value| value.split_once(':'))
        .map(|(remote, _)| remote.to_string());
    let remote_name = options
        .get("rclone.remote")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(remote_from_repository)
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_REQUEST,
                "rclone backend requires `rclone.remote` option or repository path in format rclone:<remote>:<path>",
            )
        })?;

    let rclone_type = options
        .get("rclone.type")
        .or_else(|| options.get("rclone.config.type"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let has_rclone_config = options.keys().any(|key| key.starts_with("rclone.config."));

    if let Some(rclone_type) = rclone_type {
        let mut rclone_args = vec![
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            rclone_type,
        ];
        let mut rclone_preview = vec![
            "rclone".to_string(),
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            options
                .get("rclone.type")
                .or_else(|| options.get("rclone.config.type"))
                .map(|value| value.trim().to_string())
                .unwrap_or_default(),
        ];

        let mut rclone_config_items = options
            .iter()
            .filter_map(|(key, value)| {
                key.strip_prefix("rclone.config.")
                    .filter(|trimmed| !trimmed.is_empty() && *trimmed != "type")
                    .map(|trimmed| (trimmed.to_string(), value.to_string()))
            })
            .collect::<Vec<_>>();
        rclone_config_items.sort_by(|a, b| a.0.cmp(&b.0));

        for (key, value) in rclone_config_items {
            rclone_args.push(key.clone());
            rclone_args.push(value.clone());
            rclone_preview.push(key.clone());
            rclone_preview.push(if is_sensitive_key(&key) {
                "***".to_string()
            } else {
                value
            });
        }
        rclone_args.push("--non-interactive".to_string());
        rclone_preview.push("--non-interactive".to_string());

        let rclone_result = run_rclone_command(state, rclone_args, rclone_preview).await?;
        if !rclone_result.success {
            let reason = first_useful_error_line(&rclone_result.stderr)
                .unwrap_or_else(|| "rclone config create failed".to_string());
            return Err(api_error(
                StatusCode::BAD_GATEWAY,
                format!("failed to create rclone config: {reason}"),
            ));
        }
    } else if has_rclone_config {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "rclone backend requires option `rclone.type` (example: rclone.type=s3)",
        ));
    } else {
        log_info(format!(
            "skipping rclone config create for {operation}; no rclone.type provided"
        ));
    }

    if !repository.starts_with("rclone:") {
        let normalized_path = repository.trim_start_matches('/');
        repository = format!("rclone:{remote_name}:{normalized_path}");
        log_info(format!(
            "normalized repository for rclone {operation}: {repository}"
        ));
    }

    Ok(repository)
}

async fn rustic_version(
    State(state): State<AppState>,
) -> Result<Json<RusticVersionResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, vec!["--version".to_string()], vec![], None).await?;
    let version = rustic
        .stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned);

    Ok(Json(RusticVersionResponse {
        worker,
        rustic,
        version,
    }))
}

async fn rustic_snapshots(
    State(state): State<AppState>,
) -> Result<Json<RusticSnapshotsResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(
        &state,
        vec![
            "snapshots".to_string(),
            "--json".to_string(),
            "--no-progress".to_string(),
        ],
        vec![],
        None,
    )
    .await?;

    Ok(Json(RusticSnapshotsResponse { worker, rustic }))
}

async fn rustic_repository_snapshots(
    State(state): State<AppState>,
    Json(payload): Json<RusticRepositoryRequest>,
) -> Result<Json<RusticSnapshotsResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let repository = payload.repository.trim();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for snapshots",
        ));
    }
    let repository = prepare_repository_for_rclone(
        &state,
        repository.to_string(),
        payload.backend.as_deref(),
        &payload.options.unwrap_or_default(),
        "snapshot listing",
    )
    .await?;

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(
        &state,
        vec![
            "--repository".to_string(),
            repository,
            "snapshots".to_string(),
            "--json".to_string(),
            "--no-progress".to_string(),
        ],
        env_vars,
        None,
    )
    .await?;

    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "failed to load snapshots".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticSnapshotsResponse { worker, rustic }))
}

async fn rustic_snapshot_files(
    State(state): State<AppState>,
    Json(payload): Json<RusticSnapshotFilesRequest>,
) -> Result<Json<RusticSnapshotFilesResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let repository = payload.repository.trim();
    let snapshot = payload.snapshot.trim();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for file listing",
        ));
    }
    if snapshot.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "snapshot is required for file listing",
        ));
    }
    let repository = prepare_repository_for_rclone(
        &state,
        repository.to_string(),
        payload.backend.as_deref(),
        &payload.options.unwrap_or_default(),
        "snapshot file listing",
    )
    .await?;

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let mut target = snapshot.to_string();
    if let Some(path) = payload.path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            target = format!("{snapshot}:{trimmed}");
        }
    }

    let args = vec![
        "--repository".to_string(),
        repository,
        "ls".to_string(),
        "--json".to_string(),
        "--no-progress".to_string(),
        target,
    ];

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, args, env_vars, None).await?;

    if !rustic.success {
        let reason = first_useful_error_line(&rustic.stderr)
            .unwrap_or_else(|| "failed to list snapshot files".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticSnapshotFilesResponse { worker, rustic }))
}

async fn rustic_check(
    State(state): State<AppState>,
    Json(payload): Json<RusticRepositoryRequest>,
) -> Result<Json<RusticRepositoryCommandResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let repository = payload.repository.trim();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for check",
        ));
    }
    let repository = prepare_repository_for_rclone(
        &state,
        repository.to_string(),
        payload.backend.as_deref(),
        &payload.options.unwrap_or_default(),
        "check",
    )
    .await?;

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(
        &state,
        vec![
            "--repository".to_string(),
            repository,
            "check".to_string(),
            "--no-progress".to_string(),
        ],
        env_vars,
        None,
    )
    .await?;

    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "repository check failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticRepositoryCommandResponse { worker, rustic }))
}

async fn rustic_repair_index(
    State(state): State<AppState>,
    Json(payload): Json<RusticRepositoryRequest>,
) -> Result<Json<RusticRepositoryCommandResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let repository = payload.repository.trim();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for repair index",
        ));
    }
    let repository = prepare_repository_for_rclone(
        &state,
        repository.to_string(),
        payload.backend.as_deref(),
        &payload.options.unwrap_or_default(),
        "repair index",
    )
    .await?;

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(
        &state,
        vec![
            "--repository".to_string(),
            repository,
            "repair".to_string(),
            "index".to_string(),
            "--no-progress".to_string(),
        ],
        env_vars,
        None,
    )
    .await?;

    if !rustic.success {
        let reason = first_useful_error_line(&rustic.stderr)
            .unwrap_or_else(|| "repository repair index failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticRepositoryCommandResponse { worker, rustic }))
}

async fn rustic_stats(
    State(state): State<AppState>,
) -> Result<Json<RusticStatsResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(
        &state,
        vec![
            "stats".to_string(),
            "--json".to_string(),
            "--no-progress".to_string(),
        ],
        vec![],
        None,
    )
    .await?;

    Ok(Json(RusticStatsResponse { worker, rustic }))
}

async fn execute_backup_request(
    state: &AppState,
    payload: RusticBackupRequest,
) -> Result<RusticCommandResult, (StatusCode, Json<ApiErrorResponse>)> {
    let mut repository = payload.repository.trim().to_string();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for backup",
        ));
    }

    if payload.paths.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "backup requires at least one path",
        ));
    }
    if payload.paths.iter().any(|path| path.trim().is_empty()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "backup paths must not be empty",
        ));
    }

    let options = payload.options.unwrap_or_default();
    if payload.backend.as_deref() == Some("rclone") {
        let remote_from_repository = repository
            .strip_prefix("rclone:")
            .and_then(|value| value.split_once(':'))
            .map(|(remote, _)| remote.to_string());
        let remote_name = options
            .get("rclone.remote")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(remote_from_repository)
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backup requires `rclone.remote` option or repository path in format rclone:<remote>:<path>",
                )
            })?;
        let rclone_type = options
            .get("rclone.type")
            .or_else(|| options.get("rclone.config.type"))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backup requires option `rclone.type` (example: rclone.type=s3)",
                )
            })?;

        let mut rclone_args = vec![
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            rclone_type,
        ];
        let mut rclone_preview = vec![
            "rclone".to_string(),
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            options
                .get("rclone.type")
                .or_else(|| options.get("rclone.config.type"))
                .map(|value| value.trim().to_string())
                .unwrap_or_default(),
        ];

        let mut rclone_config_items = options
            .iter()
            .filter_map(|(key, value)| {
                key.strip_prefix("rclone.config.")
                    .filter(|trimmed| !trimmed.is_empty() && *trimmed != "type")
                    .map(|trimmed| (trimmed.to_string(), value.to_string()))
            })
            .collect::<Vec<_>>();
        rclone_config_items.sort_by(|a, b| a.0.cmp(&b.0));

        for (key, value) in rclone_config_items {
            rclone_args.push(key.clone());
            rclone_args.push(value.clone());
            rclone_preview.push(key.clone());
            rclone_preview.push(if is_sensitive_key(&key) {
                "***".to_string()
            } else {
                value
            });
        }
        rclone_args.push("--non-interactive".to_string());
        rclone_preview.push("--non-interactive".to_string());

        let rclone_result = run_rclone_command(state, rclone_args, rclone_preview).await?;
        if !rclone_result.success {
            let reason = first_useful_error_line(&rclone_result.stderr)
                .unwrap_or_else(|| "rclone config create failed".to_string());
            return Err(api_error(
                StatusCode::BAD_GATEWAY,
                format!("failed to create rclone config: {reason}"),
            ));
        }

        if !repository.starts_with("rclone:") {
            let normalized_path = repository.trim_start_matches('/');
            repository = format!("rclone:{remote_name}:{normalized_path}");
            log_info(format!(
                "normalized repository for rclone backup: {repository}"
            ));
        }
    } else if repository.starts_with("s3:") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "s3 backend is not supported by this worker build; provide rclone backend/options or use a saved repository backup endpoint",
        ));
    } else if !options.is_empty() {
        log_warn(
            "backup received repository options, but backend is not rclone; ignoring options",
        );
    }

    let mut args = vec![
        "--repository".to_string(),
        repository,
        "backup".to_string(),
        "--json".to_string(),
        "--no-progress".to_string(),
    ];

    if payload.dry_run.unwrap_or(false) {
        args.push("--dry-run".to_string());
    }

    if let Some(tags) = payload.tags {
        for tag in tags {
            if !tag.trim().is_empty() {
                args.push("--tag".to_string());
                args.push(tag);
            }
        }
    }

    args.extend(payload.paths);

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let rustic = run_rustic_command(state, args, env_vars, None).await?;
    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "backup command failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(rustic)
}

async fn rustic_backup(
    State(state): State<AppState>,
    Json(payload): Json<RusticBackupRequest>,
) -> Result<Json<RusticBackupResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let worker = worker_runtime_stats(&state);
    let rustic = execute_backup_request(&state, payload).await?;

    Ok(Json(RusticBackupResponse { worker, rustic }))
}

async fn rustic_forget(
    State(state): State<AppState>,
    Json(payload): Json<RusticForgetRequest>,
) -> Result<Json<RusticForgetResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let mut repository = payload.repository.trim().to_string();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for forget",
        ));
    }

    let options = payload.options.unwrap_or_default();
    if payload.backend.as_deref() == Some("rclone") {
        let remote_from_repository = repository
            .strip_prefix("rclone:")
            .and_then(|value| value.split_once(':'))
            .map(|(remote, _)| remote.to_string());
        let remote_name = options
            .get("rclone.remote")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(remote_from_repository)
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backend requires `rclone.remote` option or repository path in format rclone:<remote>:<path>",
                )
            })?;
        let rclone_type = options
            .get("rclone.type")
            .or_else(|| options.get("rclone.config.type"))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backend requires option `rclone.type` (example: rclone.type=s3)",
                )
            })?;

        let mut rclone_args = vec![
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            rclone_type,
        ];
        let mut rclone_preview = vec![
            "rclone".to_string(),
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            options
                .get("rclone.type")
                .or_else(|| options.get("rclone.config.type"))
                .map(|value| value.trim().to_string())
                .unwrap_or_default(),
        ];

        let mut rclone_config_items = options
            .iter()
            .filter_map(|(key, value)| {
                key.strip_prefix("rclone.config.")
                    .filter(|trimmed| !trimmed.is_empty() && *trimmed != "type")
                    .map(|trimmed| (trimmed.to_string(), value.to_string()))
            })
            .collect::<Vec<_>>();
        rclone_config_items.sort_by(|a, b| a.0.cmp(&b.0));

        for (key, value) in rclone_config_items {
            rclone_args.push(key.clone());
            rclone_args.push(value.clone());
            rclone_preview.push(key.clone());
            rclone_preview.push(if is_sensitive_key(&key) {
                "***".to_string()
            } else {
                value
            });
        }
        rclone_args.push("--non-interactive".to_string());
        rclone_preview.push("--non-interactive".to_string());

        let rclone_result = run_rclone_command(&state, rclone_args, rclone_preview).await?;
        if !rclone_result.success {
            let reason = first_useful_error_line(&rclone_result.stderr)
                .unwrap_or_else(|| "rclone config create failed".to_string());
            return Err(api_error(
                StatusCode::BAD_GATEWAY,
                format!("failed to create rclone config: {reason}"),
            ));
        }

        if !repository.starts_with("rclone:") {
            let normalized_path = repository.trim_start_matches('/');
            repository = format!("rclone:{remote_name}:{normalized_path}");
            log_info(format!(
                "normalized repository for rclone forget: {repository}"
            ));
        }
    }

    let mut args = vec![
        "--repository".to_string(),
        repository,
        "forget".to_string(),
        "--json".to_string(),
        "--no-progress".to_string(),
    ];

    if let Some(n) = payload.keep_last {
        args.push("--keep-last".to_string());
        args.push(n.to_string());
    }
    if let Some(n) = payload.keep_daily {
        args.push("--keep-daily".to_string());
        args.push(n.to_string());
    }
    if let Some(n) = payload.keep_weekly {
        args.push("--keep-weekly".to_string());
        args.push(n.to_string());
    }
    if let Some(n) = payload.keep_monthly {
        args.push("--keep-monthly".to_string());
        args.push(n.to_string());
    }
    if let Some(n) = payload.keep_yearly {
        args.push("--keep-yearly".to_string());
        args.push(n.to_string());
    }
    if let Some(ref duration) = payload.keep_within {
        let trimmed = duration.trim();
        if !trimmed.is_empty() {
            args.push("--keep-within".to_string());
            args.push(trimmed.to_string());
        }
    }
    if payload.prune == Some(true) {
        args.push("--prune".to_string());
    }
    if payload.dry_run == Some(true) {
        args.push("--dry-run".to_string());
    }

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, args, env_vars, None).await?;

    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "forget command failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticForgetResponse { worker, rustic }))
}

async fn rustic_restore(
    State(state): State<AppState>,
    Json(payload): Json<RusticRestoreRequest>,
) -> Result<Json<RusticRepositoryCommandResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let repository = payload.repository.trim();
    let snapshot = payload.snapshot.trim();
    let target = payload.target.trim();
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for restore",
        ));
    }
    if snapshot.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "snapshot is required for restore",
        ));
    }
    if target.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "target is required for restore",
        ));
    }

    let repository = prepare_repository_for_rclone(
        &state,
        repository.to_string(),
        payload.backend.as_deref(),
        &payload.options.unwrap_or_default(),
        "restore",
    )
    .await?;

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let mut args = vec![
        "--repository".to_string(),
        repository,
        "restore".to_string(),
        "--no-progress".to_string(),
        "--target".to_string(),
        target.to_string(),
        snapshot.to_string(),
    ];
    if let Some(path) = payload.path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            args.push(trimmed.to_string());
        }
    }
    if payload.dry_run == Some(true) {
        args.push("--dry-run".to_string());
    }

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, args, env_vars, None).await?;
    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "restore command failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

    Ok(Json(RusticRepositoryCommandResponse { worker, rustic }))
}

async fn ls_dirs(
    Json(payload): Json<LsDirsRequest>,
) -> Result<Json<LsDirsResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let path = payload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("/")
        .to_string();

    let mut dirs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        if !name.starts_with('.') {
                            dirs.push(format!("{}/{}", path.trim_end_matches('/'), name));
                        }
                    }
                }
            }
        }
    }
    dirs.sort();
    Ok(Json(LsDirsResponse { dirs }))
}

async fn rustic_init(
    State(state): State<AppState>,
    Json(payload): Json<RusticInitRequest>,
) -> Result<Json<RusticInitResponse>, (StatusCode, Json<ApiErrorResponse>)> {
    let mut repository = payload.repository.trim().to_string();
    log_info(format!("received init request for repository={repository}"));
    if repository.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "repository is required for init",
        ));
    }

    let options = payload.options.unwrap_or_default();
    if payload.backend.as_deref() == Some("rclone") {
        let remote_from_repository = repository
            .strip_prefix("rclone:")
            .and_then(|value| value.split_once(':'))
            .map(|(remote, _)| remote.to_string());
        let remote_name = options
            .get("rclone.remote")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(remote_from_repository)
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backend requires `rclone.remote` option or repository path in format rclone:<remote>:<path>",
                )
            })?;
        let rclone_type = options
            .get("rclone.type")
            .or_else(|| options.get("rclone.config.type"))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                api_error(
                    StatusCode::BAD_REQUEST,
                    "rclone backend requires option `rclone.type` (example: rclone.type=s3)",
                )
            })?;

        let mut rclone_args = vec![
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            rclone_type,
        ];
        let mut rclone_preview = vec![
            "rclone".to_string(),
            "config".to_string(),
            "create".to_string(),
            remote_name.clone(),
            options
                .get("rclone.type")
                .or_else(|| options.get("rclone.config.type"))
                .map(|value| value.trim().to_string())
                .unwrap_or_default(),
        ];

        let mut rclone_config_items = options
            .iter()
            .filter_map(|(key, value)| {
                key.strip_prefix("rclone.config.")
                    .filter(|trimmed| !trimmed.is_empty() && *trimmed != "type")
                    .map(|trimmed| (trimmed.to_string(), value.to_string()))
            })
            .collect::<Vec<_>>();
        rclone_config_items.sort_by(|a, b| a.0.cmp(&b.0));

        for (key, value) in rclone_config_items {
            rclone_args.push(key.clone());
            rclone_args.push(value.clone());
            rclone_preview.push(key.clone());
            rclone_preview.push(if is_sensitive_key(&key) {
                "***".to_string()
            } else {
                value
            });
        }
        rclone_args.push("--non-interactive".to_string());
        rclone_preview.push("--non-interactive".to_string());

        let rclone_result = run_rclone_command(&state, rclone_args, rclone_preview).await?;
        if !rclone_result.success {
            let reason = first_useful_error_line(&rclone_result.stderr)
                .unwrap_or_else(|| "rclone config create failed".to_string());
            return Err(api_error(
                StatusCode::BAD_GATEWAY,
                format!("failed to create rclone config: {reason}"),
            ));
        }

        if !repository.starts_with("rclone:") {
            let normalized_path = repository.trim_start_matches('/');
            repository = format!("rclone:{remote_name}:{normalized_path}");
            log_info(format!(
                "normalized repository for rclone backend: {repository}"
            ));
        }
    } else if !options.is_empty() {
        log_warn("init received repository options, but this rustic build does not support --option; ignoring options");
    }

    let mut args = vec!["--repository".to_string(), repository];
    let mut display_args = args.clone();
    args.push("init".to_string());
    args.push("--no-progress".to_string());
    display_args.push("init".to_string());
    display_args.push("--no-progress".to_string());

    let mut env_vars = Vec::new();
    if let Some(password) = payload.password {
        if !password.trim().is_empty() {
            env_vars.push(("RUSTIC_PASSWORD".to_string(), password));
        }
    }

    let command_preview = Some(
        std::iter::once(state.rustic_bin.clone())
            .chain(display_args.into_iter())
            .collect::<Vec<_>>(),
    );
    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, args, env_vars, command_preview).await?;

    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "rustic init failed".to_string());
        let status = if is_already_initialized_message(&reason) {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_GATEWAY
        };
        return Err(api_error(status, reason));
    }

    Ok(Json(RusticInitResponse { worker, rustic }))
}

async fn bearer_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let provided = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if provided != state.bearer_token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(req).await)
}

async fn request_logger(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    let response = next.run(req).await;
    let status = response.status().as_u16();
    let elapsed = start.elapsed().as_millis();

    state.requests_total.fetch_add(1, Ordering::Relaxed);
    if status >= 500 {
        state.error_total.fetch_add(1, Ordering::Relaxed);
    }

    if status >= 500 {
        log_error(format!("{method} {path} -> {status} ({elapsed}ms)"));
    } else if status >= 400 {
        log_warn(format!("{method} {path} -> {status} ({elapsed}ms)"));
    } else {
        log_info(format!("{method} {path} -> {status} ({elapsed}ms)"));
    }
    response
}

async fn sync_stats_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(15));
    let sync_url = format!(
        "{}/api/workers/sync",
        state.master_api_endpoint.trim_end_matches('/')
    );

    loop {
        interval.tick().await;

        let payload = WorkerSyncPayload {
            status: "online",
            endpoint: state.local_api_endpoint.clone(),
            uptime_ms: state.started_at.elapsed().as_millis() as u64,
            requests_total: state.requests_total.load(Ordering::Relaxed),
            error_total: state.error_total.load(Ordering::Relaxed),
        };

        let response = state
            .client
            .post(&sync_url)
            .header("Authorization", format!("Bearer {}", state.bearer_token))
            .json(&payload)
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                log_info(format!(
                    "worker sync success endpoint={} status={} req={} err={}",
                    payload.endpoint, payload.status, payload.requests_total, payload.error_total
                ));
            }
            Ok(response) => {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "unable to read response body".to_string());
                log_error(format!("worker stats sync failed: {status} - {body}"));
            }
            Err(error) => {
                log_error(format!("worker stats sync failed: {error}"));
            }
        }
    }
}

fn extract_snapshot_ref(parsed_json: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(value) = parsed_json else {
        return (None, None);
    };

    let candidate = if let Some(array) = value.as_array() {
        array.first()
    } else {
        Some(value)
    };

    let Some(object) = candidate.and_then(|entry| entry.as_object()) else {
        return (None, None);
    };

    let snapshot_id = object
        .get("snapshotId")
        .and_then(Value::as_str)
        .or_else(|| object.get("id").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let snapshot_time = object
        .get("snapshotTime")
        .and_then(Value::as_str)
        .or_else(|| object.get("time").and_then(Value::as_str))
        .map(ToOwned::to_owned);

    (snapshot_id, snapshot_time)
}

fn parse_cron_field(raw: &str, min: u32, max: u32) -> Option<HashSet<u32>> {
    let mut values = HashSet::new();

    for chunk_raw in raw.split(',') {
        let chunk = chunk_raw.trim();
        if chunk.is_empty() {
            return None;
        }

        let (base_raw, step_raw) = chunk
            .split_once('/')
            .map(|(base, step)| (base, Some(step)))
            .unwrap_or((chunk, None));
        let step = match step_raw {
            Some(step_str) => step_str.parse::<u32>().ok()?,
            None => 1,
        };
        if step == 0 {
            return None;
        }

        let mut range_min = min;
        let mut range_max = max;
        if base_raw != "*" {
            if let Some((start_raw, end_raw)) = base_raw.split_once('-') {
                range_min = start_raw.parse::<u32>().ok()?;
                range_max = end_raw.parse::<u32>().ok()?;
            } else {
                let single = base_raw.parse::<u32>().ok()?;
                range_min = single;
                range_max = single;
            }
        }

        if range_min < min || range_max > max || range_min > range_max {
            return None;
        }
        let mut value = range_min;
        while value <= range_max {
            values.insert(value);
            value = match value.checked_add(step) {
                Some(next) => next,
                None => break,
            };
        }
    }

    Some(values)
}

struct ParsedCron {
    minute: HashSet<u32>,
    hour: HashSet<u32>,
    day_of_month: HashSet<u32>,
    month: HashSet<u32>,
    day_of_week: HashSet<u32>,
    is_day_of_month_wildcard: bool,
    is_day_of_week_wildcard: bool,
}

fn parse_cron_expression(cron: &str) -> Option<ParsedCron> {
    let parts = cron.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 5 {
        return None;
    }

    let minute_field = parts[0];
    let hour_field = parts[1];
    let day_of_month_field = parts[2];
    let month_field = parts[3];
    let day_of_week_field = parts[4];

    let minute = parse_cron_field(minute_field, 0, 59)?;
    let hour = parse_cron_field(hour_field, 0, 23)?;
    let day_of_month = parse_cron_field(day_of_month_field, 1, 31)?;
    let month = parse_cron_field(month_field, 1, 12)?;
    let day_of_week = parse_cron_field(day_of_week_field, 0, 6)?;

    Some(ParsedCron {
        minute,
        hour,
        day_of_month,
        month,
        day_of_week,
        is_day_of_month_wildcard: day_of_month_field == "*",
        is_day_of_week_wildcard: day_of_week_field == "*",
    })
}

fn cron_matches_now(parsed: &ParsedCron) -> bool {
    let now = Local::now();
    let minute = now.minute();
    let hour = now.hour();
    let day_of_month = now.day();
    let month = now.month();
    let day_of_week = now.weekday().num_days_from_sunday();

    if !parsed.minute.contains(&minute)
        || !parsed.hour.contains(&hour)
        || !parsed.month.contains(&month)
    {
        return false;
    }

    let dom_match = parsed.day_of_month.contains(&day_of_month);
    let dow_match = parsed.day_of_week.contains(&day_of_week);
    if parsed.is_day_of_month_wildcard && parsed.is_day_of_week_wildcard {
        return true;
    }
    if parsed.is_day_of_month_wildcard {
        return dow_match;
    }
    if parsed.is_day_of_week_wildcard {
        return dom_match;
    }

    dom_match || dow_match
}

fn compute_next_run_at(cron: &str) -> Option<String> {
    let parsed = parse_cron_expression(cron)?;
    let mut cursor = Local::now() + ChronoDuration::minutes(1);
    cursor = cursor
        .with_second(0)?
        .with_nanosecond(0)?;
    for _ in 0..(60 * 24 * 366) {
        let minute = cursor.minute();
        let hour = cursor.hour();
        let day_of_month = cursor.day();
        let month = cursor.month();
        let day_of_week = cursor.weekday().num_days_from_sunday();

        if parsed.minute.contains(&minute)
            && parsed.hour.contains(&hour)
            && parsed.month.contains(&month)
        {
            let dom_match = parsed.day_of_month.contains(&day_of_month);
            let dow_match = parsed.day_of_week.contains(&day_of_week);
            let matches = if parsed.is_day_of_month_wildcard && parsed.is_day_of_week_wildcard {
                true
            } else if parsed.is_day_of_month_wildcard {
                dow_match
            } else if parsed.is_day_of_week_wildcard {
                dom_match
            } else {
                dom_match || dow_match
            };
            if matches {
                return Some(cursor.to_rfc3339());
            }
        }
        cursor += ChronoDuration::minutes(1);
    }
    None
}

async fn sync_backup_plans_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(30));
    let sync_url = format!(
        "{}/api/workers/backup-plans/sync",
        state.master_api_endpoint.trim_end_matches('/')
    );

    loop {
        interval.tick().await;

        let response = state
            .client
            .post(&sync_url)
            .header("Authorization", format!("Bearer {}", state.bearer_token))
            .send()
            .await;

        let synced_plans = match response {
            Ok(response) if response.status().is_success() => {
                match response.json::<BackupPlanSyncResponse>().await {
                    Ok(payload) => payload.plans,
                    Err(error) => {
                        log_error(format!("failed to decode backup plan sync response: {error}"));
                        continue;
                    }
                }
            }
            Ok(response) => {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "unable to read response body".to_string());
                log_error(format!("backup plan sync failed: {status} - {body}"));
                continue;
            }
            Err(error) => {
                log_error(format!("backup plan sync failed: {error}"));
                continue;
            }
        };

        if let Ok(mut plans) = state.synced_backup_plans.lock() {
            *plans = synced_plans;
            log_info(format!("backup plans synced count={}", plans.len()));
        } else {
            log_error("failed to lock synced backup plans cache");
        }
    }
}

fn enqueue_pending_report(state: &AppState, report: PendingReport) {
    if let Ok(mut queue) = state.pending_reports.lock() {
        if queue.len() >= PENDING_REPORTS_MAX {
            log_warn(format!(
                "pending reports queue full ({PENDING_REPORTS_MAX}), dropping oldest entry"
            ));
            queue.remove(0);
        }
        log_info(format!(
            "queuing pending report url={} attempt={}",
            report.url, report.attempts
        ));
        queue.push(report);
    } else {
        log_error("failed to lock pending reports queue");
    }
}

async fn run_synced_backup_plan(state: AppState, plan: SyncedBackupPlan) {
    let started = Instant::now();
    let report_url = format!(
        "{}/api/workers/backup-plans/{}/report",
        state.master_api_endpoint.trim_end_matches('/'),
        plan.id
    );

    let (run_status, error, snapshot_id, snapshot_time, output_value) =
        match execute_backup_request(&state, plan.request).await {
            Ok(rustic) => {
                let (snapshot_id, snapshot_time) = extract_snapshot_ref(rustic.parsed_json.as_ref());
                let output = serde_json::to_value(&rustic).unwrap_or_else(|_| Value::Null);
                ("success".to_string(), None, snapshot_id, snapshot_time, output)
            }
            Err((_, error_response)) => {
                let error = error_response.0.error;
                ("failed".to_string(), Some(error), None, None, Value::Null)
            }
        };

    let payload = BackupPlanReportRequest {
        status: run_status,
        error,
        duration_ms: started.elapsed().as_millis() as u64,
        snapshot_id,
        snapshot_time,
        next_run_at: compute_next_run_at(&plan.cron),
        output: output_value,
    };

    let should_queue = match state
        .client
        .post(&report_url)
        .header("Authorization", format!("Bearer {}", state.bearer_token))
        .json(&payload)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            log_info(format!(
                "backup plan run reported plan_id={} status={}",
                plan.id, payload.status
            ));
            false
        }
        Ok(response) => {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read response body".to_string());
            log_error(format!(
                "backup plan report failed plan_id={} status={} body={} — queuing for retry",
                plan.id, status, body
            ));
            true
        }
        Err(error) => {
            log_error(format!(
                "backup plan report request failed plan_id={} error={} — queuing for retry",
                plan.id, error
            ));
            true
        }
    };

    if should_queue {
        enqueue_pending_report(
            &state,
            PendingReport {
                url: report_url,
                payload,
                attempts: 1,
            },
        );
    }
}

fn pending_reports_path(state_dir: &str) -> PathBuf {
    PathBuf::from(state_dir).join("pending_reports.json")
}

fn load_pending_reports(state_dir: &str) -> Vec<PendingReport> {
    let path = pending_reports_path(state_dir);
    match fs::read_to_string(&path) {
        Ok(data) => match serde_json::from_str::<Vec<PendingReport>>(&data) {
            Ok(reports) => {
                if !reports.is_empty() {
                    log_info(format!(
                        "loaded {} pending reports from {}",
                        reports.len(),
                        path.display()
                    ));
                }
                reports
            }
            Err(err) => {
                log_warn(format!(
                    "failed to parse pending reports from {}: {err}",
                    path.display()
                ));
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

fn save_pending_reports(state_dir: &str, reports: &[PendingReport]) {
    let path = pending_reports_path(state_dir);
    let _ = fs::create_dir_all(state_dir);
    match serde_json::to_string(reports) {
        Ok(json) => {
            if let Err(err) = fs::write(&path, json) {
                log_warn(format!(
                    "failed to persist pending reports to {}: {err}",
                    path.display()
                ));
            }
        }
        Err(err) => {
            log_warn(format!("failed to serialize pending reports: {err}"));
        }
    }
}

async fn flush_pending_reports_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;

        let items: Vec<PendingReport> = match state.pending_reports.lock() {
            Ok(mut queue) => {
                let taken = queue.drain(..).collect();
                taken
            }
            Err(_) => {
                log_error("failed to lock pending reports queue for flush");
                continue;
            }
        };

        if items.is_empty() {
            continue;
        }

        log_info(format!("flushing {} pending reports", items.len()));
        let mut still_pending = Vec::new();

        for mut item in items {
            let result = state
                .client
                .post(&item.url)
                .header("Authorization", format!("Bearer {}", state.bearer_token))
                .json(&item.payload)
                .send()
                .await;

            let delivered = match result {
                Ok(resp) if resp.status().is_success() => {
                    log_info(format!(
                        "pending report delivered url={} after {} attempts",
                        item.url, item.attempts
                    ));
                    true
                }
                Ok(resp) => {
                    log_warn(format!(
                        "pending report still failing url={} status={} attempt={}",
                        item.url,
                        resp.status(),
                        item.attempts
                    ));
                    false
                }
                Err(err) => {
                    log_warn(format!(
                        "pending report still failing url={} error={} attempt={}",
                        item.url, err, item.attempts
                    ));
                    false
                }
            };

            if !delivered {
                item.attempts += 1;
                if item.attempts > PENDING_REPORT_MAX_ATTEMPTS {
                    log_warn(format!(
                        "dropping pending report after {} attempts url={}",
                        item.attempts, item.url
                    ));
                } else {
                    still_pending.push(item);
                }
            }
        }

        if let Ok(mut queue) = state.pending_reports.lock() {
            for item in still_pending {
                if queue.len() < PENDING_REPORTS_MAX {
                    queue.push(item);
                }
            }
            save_pending_reports(&state.state_dir, &queue);
        }
    }
}

async fn execute_synced_backup_plans_loop(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(15));
    loop {
        interval.tick().await;

        let plans = match state.synced_backup_plans.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                log_error("failed to lock synced backup plans cache");
                continue;
            }
        };

        if plans.is_empty() {
            continue;
        }

        for plan in plans {
            let parsed = match parse_cron_expression(&plan.cron) {
                Some(parsed) => parsed,
                None => {
                    log_warn(format!("invalid cron for plan {}: {}", plan.id, plan.cron));
                    continue;
                }
            };
            if !cron_matches_now(&parsed) {
                continue;
            }

            let minute_tick_key = format!("{}:{}", plan.id, Local::now().format("%Y%m%d%H%M"));
            let mut should_run = false;
            if let Ok(mut executed) = state.executed_plan_ticks.lock() {
                if executed.len() > 20_000 {
                    executed.clear();
                }
                if !executed.contains(&minute_tick_key) {
                    executed.insert(minute_tick_key);
                    should_run = true;
                }
            } else {
                log_error("failed to lock executed plan tick cache");
            }
            if !should_run {
                continue;
            }

            let run_state = state.clone();
            tokio::spawn(async move {
                run_synced_backup_plan(run_state, plan).await;
            });
        }
    }
}

struct CliArgs {
    master_api_endpoint: String,
    local_api_endpoint: String,
    api_token: String,
    rustic_bin: String,
    state_dir: String,
}

fn parse_cli_args() -> Result<CliArgs, String> {
    let mut master_api_endpoint: Option<String> = None;
    let mut local_api_endpoint: Option<String> = None;
    let mut api_token: Option<String> = None;
    let mut rustic_bin = "rustic".to_string();
    let mut state_dir = ".glare-worker".to_string();
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--master-api-endpoint=") {
            master_api_endpoint = Some(value.to_string());
            continue;
        }
        if let Some(value) = arg.strip_prefix("--local-api-endpoint=") {
            local_api_endpoint = Some(value.to_string());
            continue;
        }
        if let Some(value) = arg.strip_prefix("--api-token=") {
            api_token = Some(value.to_string());
            continue;
        }
        if let Some(value) = arg.strip_prefix("--rustic-bin=") {
            rustic_bin = value.to_string();
            continue;
        }
        if let Some(value) = arg.strip_prefix("--state-dir=") {
            state_dir = value.to_string();
            continue;
        }

        match arg.as_str() {
            "--master-api-endpoint" => {
                let value = args
                    .next()
                    .ok_or_else(|| "missing value for --master-api-endpoint".to_string())?;
                master_api_endpoint = Some(value);
            }
            "--local-api-endpoint" => {
                let value = args
                    .next()
                    .ok_or_else(|| "missing value for --local-api-endpoint".to_string())?;
                local_api_endpoint = Some(value);
            }
            "--api-token" => {
                let value = args
                    .next()
                    .ok_or_else(|| "missing value for --api-token".to_string())?;
                api_token = Some(value);
            }
            "--rustic-bin" => {
                rustic_bin = args
                    .next()
                    .ok_or_else(|| "missing value for --rustic-bin".to_string())?;
            }
            "--state-dir" => {
                state_dir = args
                    .next()
                    .ok_or_else(|| "missing value for --state-dir".to_string())?;
            }
            _ => return Err(usage(format!("unknown argument: {arg}"))),
        }
    }

    let master_api_endpoint =
        master_api_endpoint.ok_or_else(|| usage("missing required --master-api-endpoint"))?;
    let local_api_endpoint =
        local_api_endpoint.ok_or_else(|| usage("missing required --local-api-endpoint"))?;
    let api_token = api_token.ok_or_else(|| usage("missing required --api-token"))?;

    Ok(CliArgs {
        master_api_endpoint,
        local_api_endpoint,
        api_token,
        rustic_bin,
        state_dir,
    })
}

fn endpoint_to_socket_addr(flag_name: &str, endpoint: &str) -> Result<SocketAddr, String> {
    let without_scheme = endpoint
        .strip_prefix("http://")
        .or_else(|| endpoint.strip_prefix("https://"))
        .unwrap_or(endpoint);
    let authority = without_scheme
        .split('/')
        .next()
        .ok_or_else(|| format!("invalid --{flag_name}: {endpoint}"))?;

    let mut addrs = authority
        .to_socket_addrs()
        .map_err(|e| format!("invalid --{flag_name} '{endpoint}': {e}"))?;
    addrs
        .next()
        .ok_or_else(|| format!("--{flag_name} did not resolve to an address: {endpoint}"))
}

fn usage(msg: impl AsRef<str>) -> String {
    format!(
        "{}\nusage: worker --master-api-endpoint <url> --local-api-endpoint <url> --api-token <token> [--rustic-bin <path>] [--state-dir <path>]",
        msg.as_ref()
    )
}
