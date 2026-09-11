#!/usr/bin/env bash
# Read-only DGX Spark host checks. This script downloads and changes nothing.

set -uo pipefail

failures=0
warnings=0

pass() { printf '[PASS] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf '[FAIL] %s\n' "$*"; failures=$((failures + 1)); }
section() { printf '\n== %s ==\n' "$*"; }

section 'Platform'
arch="$(uname -m)"
printf 'Architecture: %s\n' "$arch"
uname -a
if [[ -r /etc/os-release ]]; then
  sed -n '1,8p' /etc/os-release
fi
if [[ "$arch" == 'aarch64' ]]; then
  pass 'ARM64 architecture detected'
else
  fail "Expected aarch64 on DGX Spark, got $arch"
fi

section 'GPU and CUDA driver'
if command -v nvidia-smi >/dev/null 2>&1; then
  if nvidia-smi; then
    pass 'nvidia-smi completed'
  else
    fail 'nvidia-smi exists but returned an error'
  fi
else
  fail 'nvidia-smi not found'
fi

if command -v nvcc >/dev/null 2>&1; then
  nvcc --version
else
  warn 'nvcc not found on host; acceptable if CUDA is used only inside NGC container'
fi

section 'Memory'
if command -v free >/dev/null 2>&1; then
  free -h
  available_kib="$(free -k | awk '/^Mem:/ {print $7}')"
  if [[ -n "${available_kib:-}" ]] && (( available_kib >= 104857600 )); then
    pass 'At least 100 GiB system memory currently available'
  else
    warn 'Less than 100 GiB currently available; stop other large processes before training'
  fi
else
  fail 'free command not found'
fi

section 'Local storage'
work_path="$(pwd)"
df -h "$work_path"
available_kib="$(df -Pk "$work_path" | awk 'NR==2 {print $4}')"
if [[ -n "${available_kib:-}" ]] && (( available_kib >= 262144000 )); then
  pass 'At least 250 GiB free on the project filesystem'
else
  fail 'Less than 250 GiB free on the project filesystem; 500 GiB is recommended'
fi

fs_type="$(df -PT "$work_path" | awk 'NR==2 {print $2}')"
printf 'Project filesystem type: %s\n' "$fs_type"
case "$fs_type" in
  nfs|nfs4|cifs|fuse.sshfs)
    warn 'Project appears to be on a network filesystem; use local NVMe for data/checkpoints'
    ;;
  *)
    pass 'Project filesystem is not a commonly detected network filesystem'
    ;;
esac

section 'Docker'
if command -v docker >/dev/null 2>&1; then
  docker --version
  if docker version --format 'Server: {{.Server.Version}}' >/dev/null 2>&1; then
    docker version --format 'Client: {{.Client.Version}} | Server: {{.Server.Version}}'
    pass 'Current user can access Docker daemon'
  else
    fail 'Docker is installed but daemon access failed; check service and docker-group membership'
  fi
else
  fail 'docker not found'
fi

section 'CPU pressure and large processes'
uptime || true
ps -eo pid,user,%mem,%cpu,comm --sort=-%mem | head -n 12 || true

section 'Summary'
printf 'Failures: %d | Warnings: %d\n' "$failures" "$warnings"
if (( failures > 0 )); then
  printf 'Preflight failed. Resolve FAIL items before downloading the model or starting P0.\n'
  exit 1
fi

printf 'Preflight passed. Review WARN items, then pull the pinned NGC container.\n'

