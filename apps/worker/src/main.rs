use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env,
    fs,
    net::{SocketAddr, ToSocketAddrs},
    path::PathBuf,
    process::Command,
    sync::{
        Arc,
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

#[derive(Deserialize)]
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RusticSnapshotFilesRequest {
    repository: String,
    snapshot: String,
    path: Option<String>,
    password: Option<String>,
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
            repository.to_string(),
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
        repository.to_string(),
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
            repository.to_string(),
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
            repository.to_string(),
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

async fn rustic_backup(
    State(state): State<AppState>,
    Json(payload): Json<RusticBackupRequest>,
) -> Result<Json<RusticBackupResponse>, (StatusCode, Json<ApiErrorResponse>)> {
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

    let worker = worker_runtime_stats(&state);
    let rustic = run_rustic_command(&state, args, env_vars, None).await?;

    if !rustic.success {
        let reason =
            first_useful_error_line(&rustic.stderr).unwrap_or_else(|| "backup command failed".to_string());
        return Err(api_error(StatusCode::BAD_GATEWAY, reason));
    }

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
