#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="glare-worker"
BIN_NAME="glare-worker"
INSTALL_BIN_PATH="/usr/local/bin/${BIN_NAME}"
STATE_DIR="/var/lib/glare-worker"
CONFIG_DIR="/etc/glare-worker"
ENV_FILE="${CONFIG_DIR}/worker.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
GITHUB_REPO="iRazvan2745/Glare"
RELEASE_TAG="latest"
ASSET_NAME=""

MASTER_API_ENDPOINT="${MASTER_API_ENDPOINT:-http://localhost:3000/}"
LOCAL_API_ENDPOINT="${LOCAL_API_ENDPOINT:-http://127.0.0.1:4001/}"
API_TOKEN="${API_TOKEN:-HSOCJOMNWJABHAQQW7NP3HTFIY:dzSwVGyWFJOrAkMZMoiivO7wpv3qUx2Q5n8ITkaCETk}"
RUSTIC_BIN="${RUSTIC_BIN:-rustic}"

usage() {
  cat <<'EOF'
Usage: ./installer/install.sh [options]

Options:
  --github-repo <owner/repo>
  --release-tag <tag|latest>
  --asset-name <filename>
  --master-api-endpoint <url>
  --local-api-endpoint <url>
  --api-token <token>
  --rustic-bin <path>
  -h, --help

Environment variables (used if args are not provided):
  MASTER_API_ENDPOINT, LOCAL_API_ENDPOINT, API_TOKEN, RUSTIC_BIN
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --github-repo)
      GITHUB_REPO="${2:-}"
      shift 2
      ;;
    --release-tag)
      RELEASE_TAG="${2:-}"
      shift 2
      ;;
    --asset-name)
      ASSET_NAME="${2:-}"
      shift 2
      ;;
    --master-api-endpoint)
      MASTER_API_ENDPOINT="${2:-}"
      shift 2
      ;;
    --local-api-endpoint)
      LOCAL_API_ENDPOINT="${2:-}"
      shift 2
      ;;
    --api-token)
      API_TOKEN="${2:-}"
      shift 2
      ;;
    --rustic-bin)
      RUSTIC_BIN="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${MASTER_API_ENDPOINT}" || -z "${LOCAL_API_ENDPOINT}" || -z "${API_TOKEN}" ]]; then
  echo "master/local endpoints and api token are required." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is required but systemctl was not found." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found." >&2
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Please run as root or install sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

PKG_MGR=""
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
elif command -v apk >/dev/null 2>&1; then
  PKG_MGR="apk"
elif command -v zypper >/dev/null 2>&1; then
  PKG_MGR="zypper"
fi

APT_UPDATED=0
install_pkg() {
  local pkg="$1"
  case "${PKG_MGR}" in
    apt)
      if [[ "${APT_UPDATED}" -eq 0 ]]; then
        ${SUDO} apt-get update -y
        APT_UPDATED=1
      fi
      ${SUDO} apt-get install -y "${pkg}"
      ;;
    dnf)
      ${SUDO} dnf install -y "${pkg}"
      ;;
    yum)
      ${SUDO} yum install -y "${pkg}"
      ;;
    pacman)
      ${SUDO} pacman -Sy --noconfirm "${pkg}"
      ;;
    apk)
      ${SUDO} apk add --no-cache "${pkg}"
      ;;
    zypper)
      ${SUDO} zypper --non-interactive install "${pkg}"
      ;;
    *)
      echo "No supported package manager found. Install '${pkg}' manually." >&2
      return 1
      ;;
  esac
}

ensure_cmd() {
  local cmd="$1"
  local pkg="$2"
  if command -v "${cmd}" >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing ${cmd}..."
  install_pkg "${pkg}" || return 1
  command -v "${cmd}" >/dev/null 2>&1
}

ensure_rustic() {
  if [[ "${RUSTIC_BIN}" == "rustic" ]]; then
    ensure_cmd rustic rustic || {
      echo "Failed to install rustic. Install it manually or pass --rustic-bin <path>." >&2
      exit 1
    }
    return 0
  fi

  if [[ -x "${RUSTIC_BIN}" ]]; then
    return 0
  fi
  if command -v "${RUSTIC_BIN}" >/dev/null 2>&1; then
    return 0
  fi

  echo "RUSTIC_BIN '${RUSTIC_BIN}' not found/executable. Install rustic or pass a valid --rustic-bin path." >&2
  exit 1
}

install_worker_from_source() {
  echo "Falling back to source build from ${GITHUB_REPO}..."
  ensure_cmd git git || {
    echo "Failed to install git." >&2
    exit 1
  }
  ensure_cmd cargo cargo || {
    echo "Failed to install cargo/rust toolchain." >&2
    exit 1
  }

  local src_tmp
  src_tmp="$(mktemp -d)"

  git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "${src_tmp}/repo"
  cargo build --manifest-path "${src_tmp}/repo/apps/worker/Cargo.toml" --release

  local built_bin
  built_bin="${src_tmp}/repo/apps/worker/target/release/worker"
  if [[ ! -x "${built_bin}" ]]; then
    echo "Source build finished but worker binary was not found." >&2
    exit 1
  fi

  echo "Installing binary from source build..."
  ${SUDO} install -Dm755 "${built_bin}" "${INSTALL_BIN_PATH}"
  rm -rf "${src_tmp}"
}

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "${arch}" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  armv7l) arch="armv7" ;;
esac

if [[ "${RELEASE_TAG}" == "latest" ]]; then
  api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
else
  api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}"
fi

echo "Fetching release metadata from ${GITHUB_REPO} (${RELEASE_TAG})..."
release_json=""
if ! release_json="$(curl -fsSL "${api_url}" 2>/dev/null)"; then
  if [[ "${RELEASE_TAG}" == "latest" ]]; then
    echo "No stable 'latest' release found. Trying newest available release (including pre-releases)..."
    if ! release_json="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" 2>/dev/null)"; then
      echo "No GitHub release metadata found (or release endpoint unavailable)."
      install_worker_from_source
    fi
  else
    echo "No GitHub release metadata found for tag '${RELEASE_TAG}'."
    install_worker_from_source
  fi
fi

if [[ -n "${release_json}" ]]; then
  asset_urls="$(printf '%s\n' "${release_json}" | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]\+\)".*/\1/p')"
else
  asset_urls=""
fi

if [[ -z "${asset_urls}" ]]; then
  if [[ -n "${release_json}" ]]; then
    echo "No release assets found. Falling back to source build."
    install_worker_from_source
  fi
fi

if [[ -n "${asset_urls}" ]]; then
  select_asset_url() {
    local pattern="$1"
    printf '%s\n' "${asset_urls}" | awk -v p="${pattern}" '
      {
        n=$0
        sub(/^.*\//, "", n)
        if (n ~ p) {
          print $0
          exit
        }
      }
    '
  }

  if [[ -n "${ASSET_NAME}" ]]; then
    asset_url="$(printf '%s\n' "${asset_urls}" | awk -v n="${ASSET_NAME}" '
      {
        f=$0
        sub(/^.*\//, "", f)
        if (f == n) {
          print $0
          exit
        }
      }
    ')"
  else
    asset_url="$(select_asset_url "^${BIN_NAME}[-_.]?${os}[-_.]?${arch}(\\.|$)")"
    [[ -n "${asset_url}" ]] || asset_url="$(select_asset_url "^worker[-_.]?${os}[-_.]?${arch}(\\.|$)")"
    [[ -n "${asset_url}" ]] || asset_url="$(printf '%s\n' "${asset_urls}" | awk -v os="${os}" -v arch="${arch}" '
      {
        n=$0
        sub(/^.*\//, "", n)
        if (n ~ os && n ~ arch && n !~ /sha256|checksums|sig/) {
          print $0
          exit
        }
      }
    ')"
    [[ -n "${asset_url}" ]] || asset_url="$(printf '%s\n' "${asset_urls}" | awk '
      {
        n=$0
        sub(/^.*\//, "", n)
        if (n !~ /sha256|checksums|sig/) {
          print $0
          exit
        }
      }
    ')"
  fi

  if [[ -z "${asset_url}" ]]; then
    echo "Could not find a matching release asset." >&2
    echo "Available asset names:" >&2
    printf '%s\n' "${asset_urls}" | sed 's#^.*/# - #' >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  asset_file="${tmp_dir}/asset"
  echo "Downloading release asset..."
  curl -fL "${asset_url}" -o "${asset_file}"

extract_or_copy_binary() {
  local src="$1"
  local out="$2"

  if file "${src}" | grep -qi 'gzip compressed'; then
    tar -xzf "${src}" -C "${tmp_dir}"
  elif file "${src}" | grep -qi 'zip archive'; then
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip is required for zip assets." >&2
      exit 1
    fi
    unzip -q "${src}" -d "${tmp_dir}"
  else
    cp "${src}" "${out}"
    return 0
  fi

  local candidate
  candidate="$(find "${tmp_dir}" -type f \( -name "${BIN_NAME}" -o -name "worker" \) | head -n1 || true)"
  if [[ -z "${candidate}" ]]; then
    echo "Downloaded archive does not contain ${BIN_NAME}/worker binary." >&2
    exit 1
  fi
  cp "${candidate}" "${out}"
}

  bin_tmp="${tmp_dir}/${BIN_NAME}"
  extract_or_copy_binary "${asset_file}" "${bin_tmp}"
  chmod +x "${bin_tmp}"

  echo "Installing binary..."
  ${SUDO} install -Dm755 "${bin_tmp}" "${INSTALL_BIN_PATH}"
fi

echo "Ensuring dependencies..."
ensure_cmd rclone rclone || {
  echo "Failed to install rclone. Install it manually and re-run installer." >&2
  exit 1
}
ensure_rustic

echo "Creating service user/directories..."
if ! id -u glare-worker >/dev/null 2>&1; then
  ${SUDO} useradd --system --home-dir "${STATE_DIR}" --shell /usr/sbin/nologin glare-worker || true
fi
${SUDO} install -d -m750 -o glare-worker -g glare-worker "${STATE_DIR}"
${SUDO} install -d -m700 -o root -g root "${CONFIG_DIR}"

echo "Writing config..."
cat <<EOF | ${SUDO} tee "${ENV_FILE}" >/dev/null
MASTER_API_ENDPOINT=${MASTER_API_ENDPOINT}
LOCAL_API_ENDPOINT=${LOCAL_API_ENDPOINT}
API_TOKEN=${API_TOKEN}
RUSTIC_BIN=${RUSTIC_BIN}
EOF
${SUDO} chmod 600 "${ENV_FILE}"
${SUDO} chown root:root "${ENV_FILE}"

echo "Writing systemd unit..."
cat <<EOF | ${SUDO} tee "${UNIT_FILE}" >/dev/null
[Unit]
Description=Glare Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=glare-worker
Group=glare-worker
WorkingDirectory=${STATE_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_BIN_PATH} --master-api-endpoint \${MASTER_API_ENDPOINT} --local-api-endpoint \${LOCAL_API_ENDPOINT} --api-token \${API_TOKEN} --rustic-bin \${RUSTIC_BIN} --state-dir ${STATE_DIR}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "Enabling + starting service..."
${SUDO} systemctl daemon-reload
${SUDO} systemctl enable --now "${SERVICE_NAME}"

echo
echo "Done."
echo "Check status: sudo systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:         sudo journalctl -u ${SERVICE_NAME} -f"
