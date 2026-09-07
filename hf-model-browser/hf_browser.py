#!/usr/bin/env python3
"""Hugging Face 모델 브라우저 CLI.

허깅페이스 허브에서 모델을 검색/조회하고, 로컬 nvidia-smi로 감지한
GPU VRAM 용량과 비교해 어떤 모델이 실제로 올라갈 수 있는지 보여준다.

외부 의존성 없이 표준 라이브러리만 사용한다 (urllib + subprocess).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

API_BASE = "https://huggingface.co/api"
USER_AGENT = "hf-model-browser/1.0"

# fp16/bf16 기준 가중치 1B 파라미터 = 약 2GB. 추론 시 KV 캐시/활성화 오버헤드로
# 실제로는 가중치 크기보다 더 필요하므로 20% 여유를 둔다.
INFERENCE_OVERHEAD = 1.2

WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".pth", ".gguf", ".ggml")


# --------------------------------------------------------------------------
# GPU / VRAM 감지
# --------------------------------------------------------------------------


@dataclass
class GpuInfo:
    name: str
    total_mib: float
    used_mib: float
    free_mib: float

    @property
    def total_gb(self) -> float:
        return self.total_mib / 1024

    @property
    def free_gb(self) -> float:
        return self.free_mib / 1024


def detect_gpus() -> list[GpuInfo]:
    """nvidia-smi로 GPU 목록과 VRAM 사용량을 가져온다."""
    if shutil.which("nvidia-smi") is None:
        raise RuntimeError(
            "nvidia-smi를 찾을 수 없습니다. NVIDIA 드라이버가 설치되어 있는지 확인하세요."
        )

    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"nvidia-smi 실행 실패: {e.stderr.strip()}") from e

    gpus: list[GpuInfo] = []
    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4:
            continue
        name, total, used, free = parts
        gpus.append(GpuInfo(name=name, total_mib=float(total), used_mib=float(used), free_mib=float(free)))
    return gpus


# --------------------------------------------------------------------------
# Hugging Face API
# --------------------------------------------------------------------------


def _http_get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} 오류: {url}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"네트워크 오류: {e.reason}") from e


def search_models(query: str | None, limit: int, task: str | None, sort: str) -> list[dict]:
    params = {"limit": str(limit), "sort": sort, "direction": "-1"}
    if query:
        params["search"] = query
    if task:
        params["filter"] = task
    url = f"{API_BASE}/models?{urllib.parse.urlencode(params)}"
    return _http_get_json(url)


def get_model_files(model_id: str) -> list[dict]:
    """모델 저장소의 파일 트리(크기 포함)를 가져온다."""
    url = f"{API_BASE}/models/{urllib.parse.quote(model_id)}/tree/main"
    try:
        return _http_get_json(url)
    except RuntimeError:
        return []


# --------------------------------------------------------------------------
# 모델 크기 추정
# --------------------------------------------------------------------------

# 모델 이름에 흔히 박히는 파라미터 수 패턴: 7b, 13B, 1.5b, 70b 등
PARAM_PATTERN = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*[bB](?![\w])")


def estimate_params_from_name(model_id: str) -> float | None:
    matches = PARAM_PATTERN.findall(model_id)
    if not matches:
        return None
    # 이름에 여러 숫자가 있으면(버전 등) 가장 큰 값을 파라미터 수로 취급
    return max(float(m) for m in matches)


def weight_size_gb_from_files(files: list[dict]) -> float | None:
    total_bytes = 0
    found = False
    for f in files:
        path = f.get("path", "")
        if not path.lower().endswith(WEIGHT_EXTS):
            continue
        size = f.get("size")
        if size is None and isinstance(f.get("lfs"), dict):
            size = f["lfs"].get("size")
        if size:
            total_bytes += int(size)
            found = True
    if not found:
        return None
    return total_bytes / (1024**3)


@dataclass
class ModelEstimate:
    model_id: str
    downloads: int
    likes: int
    task: str | None
    est_params_b: float | None = None
    weight_gb: float | None = None
    required_gb: float | None = None
    fits: bool | None = None


def estimate_model(model_id: str, meta: dict, fetch_files: bool, gpu_free_gb: float | None) -> ModelEstimate:
    est = ModelEstimate(
        model_id=model_id,
        downloads=meta.get("downloads", 0),
        likes=meta.get("likes", 0),
        task=meta.get("pipeline_tag"),
    )
    est.est_params_b = estimate_params_from_name(model_id)

    weight_gb = None
    if fetch_files:
        files = get_model_files(model_id)
        weight_gb = weight_size_gb_from_files(files)

    if weight_gb is None and est.est_params_b is not None:
        # fp16 가중치 가정: 1B 파라미터 ≈ 2GB
        weight_gb = est.est_params_b * 2

    est.weight_gb = weight_gb
    if weight_gb is not None:
        est.required_gb = weight_gb * INFERENCE_OVERHEAD
        if gpu_free_gb is not None:
            est.fits = est.required_gb <= gpu_free_gb

    return est


# --------------------------------------------------------------------------
# 출력 포맷
# --------------------------------------------------------------------------


def fmt_gb(value: float | None) -> str:
    return f"{value:.1f}GB" if value is not None else "?"


def print_gpu_table(gpus: list[GpuInfo]) -> None:
    if not gpus:
        print("감지된 GPU가 없습니다.")
        return
    print(f"{'GPU':<30} {'전체 VRAM':>12} {'사용중':>10} {'여유':>10}")
    print("-" * 66)
    for g in gpus:
        print(f"{g.name:<30} {fmt_gb(g.total_gb):>12} {fmt_gb(g.used_mib/1024):>10} {fmt_gb(g.free_gb):>10}")


def print_model_table(estimates: list[ModelEstimate], show_fit: bool) -> None:
    header = f"{'모델':<45} {'파라미터':>9} {'가중치':>8} {'필요 VRAM':>10} {'다운로드':>10}"
    if show_fit:
        header += "  적재가능"
    print(header)
    print("-" * (len(header) + 2))
    for e in estimates:
        params = f"{e.est_params_b:g}B" if e.est_params_b else "?"
        row = (
            f"{e.model_id:<45} {params:>9} {fmt_gb(e.weight_gb):>8} "
            f"{fmt_gb(e.required_gb):>10} {e.downloads:>10,}"
        )
        if show_fit:
            if e.fits is None:
                row += "  ?"
            elif e.fits:
                row += "  ✅"
            else:
                row += "  ❌"
        print(row)


# --------------------------------------------------------------------------
# 서브커맨드
# --------------------------------------------------------------------------


def cmd_gpu(args: argparse.Namespace) -> int:
    try:
        gpus = detect_gpus()
    except RuntimeError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1
    print_gpu_table(gpus)
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    try:
        models = search_models(args.query, args.limit, args.task, args.sort)
    except RuntimeError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1

    gpu_free_gb = None
    if args.fits_only or args.show_fit:
        try:
            gpus = detect_gpus()
            if gpus:
                gpu_free_gb = max(g.free_gb for g in gpus)
        except RuntimeError as e:
            print(f"경고: GPU 감지 실패 ({e}). VRAM 기준 필터링 없이 진행합니다.", file=sys.stderr)

    estimates = [
        estimate_model(m["id"], m, fetch_files=args.detailed, gpu_free_gb=gpu_free_gb)
        for m in models
    ]

    if args.fits_only:
        estimates = [e for e in estimates if e.fits]

    show_fit = args.show_fit or args.fits_only
    print_model_table(estimates, show_fit=show_fit)
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    try:
        meta = _http_get_json(f"{API_BASE}/models/{urllib.parse.quote(args.model_id)}")
    except RuntimeError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1

    gpu_free_gb = None
    gpus: list[GpuInfo] = []
    try:
        gpus = detect_gpus()
    except RuntimeError as e:
        print(f"경고: GPU 감지 실패 ({e})", file=sys.stderr)

    est = estimate_model(args.model_id, meta, fetch_files=True, gpu_free_gb=None)

    print(f"모델: {est.model_id}")
    print(f"태스크: {est.task or '알 수 없음'}")
    print(f"다운로드: {est.downloads:,}  좋아요: {est.likes:,}")
    print(f"추정 파라미터: {f'{est.est_params_b:g}B' if est.est_params_b else '알 수 없음 (이름에서 추출 불가)'}")
    print(f"가중치 파일 크기 합계: {fmt_gb(est.weight_gb)}")
    print(f"추정 필요 VRAM(추론, +{int((INFERENCE_OVERHEAD-1)*100)}% 여유): {fmt_gb(est.required_gb)}")

    if gpus and est.required_gb is not None:
        print("\nGPU별 적재 가능 여부:")
        for g in gpus:
            mark = "✅ 가능" if est.required_gb <= g.free_gb else "❌ 부족"
            print(f"  {g.name} (여유 {fmt_gb(g.free_gb)} / 전체 {fmt_gb(g.total_gb)}): {mark}")
    elif est.required_gb is None:
        print("\n크기를 추정할 수 없어 적재 가능 여부를 판단할 수 없습니다.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="hf-browser",
        description="Hugging Face 모델을 검색하고, 로컬 GPU VRAM으로 적재 가능한지 확인하는 CLI",
    )
    sub = p.add_subparsers(dest="command", required=True)

    p_gpu = sub.add_parser("gpu", help="nvidia-smi로 감지한 GPU/VRAM 정보 출력")
    p_gpu.set_defaults(func=cmd_gpu)

    p_search = sub.add_parser("search", help="모델 검색")
    p_search.add_argument("query", nargs="?", default=None, help="검색어 (예: llama, whisper)")
    p_search.add_argument("--limit", type=int, default=20, help="결과 개수 (기본 20)")
    p_search.add_argument("--task", default=None, help="파이프라인 태스크로 필터 (예: text-generation)")
    p_search.add_argument(
        "--sort", default="downloads", choices=["downloads", "likes", "lastModified", "createdAt"],
        help="정렬 기준 (기본 downloads)",
    )
    p_search.add_argument(
        "--show-fit", action="store_true", help="현재 GPU 여유 VRAM 대비 적재 가능 여부 표시"
    )
    p_search.add_argument(
        "--fits-only", action="store_true", help="현재 GPU 여유 VRAM에 들어가는 모델만 표시"
    )
    p_search.add_argument(
        "--detailed", action="store_true",
        help="각 모델의 실제 가중치 파일 크기를 조회 (느리지만 정확)",
    )
    p_search.set_defaults(func=cmd_search)

    p_info = sub.add_parser("info", help="특정 모델 상세 정보 및 GPU별 적재 가능 여부")
    p_info.add_argument("model_id", help="예: meta-llama/Llama-2-7b-hf")
    p_info.set_defaults(func=cmd_info)

    return p


def _ensure_utf8_stdio() -> None:
    """Windows 콘솔의 기본 코드페이지(cp949 등)에서도 한글/이모지가 깨지지 않도록 강제 UTF-8 출력."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name)
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def main(argv: list[str] | None = None) -> int:
    _ensure_utf8_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
