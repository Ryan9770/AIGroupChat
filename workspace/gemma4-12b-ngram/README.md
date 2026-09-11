# DGX Spark 첫날 실행 가이드

이 디렉터리는 **Gemma 4 12B 본체를 고정하고, 해시드 bigram/trigram 임베딩만 학습**하는 실험의 준비 문서다. 지금 단계의 목표는 곧바로 대규모 학습을 돌리는 것이 아니라 다음 세 가지를 순서대로 확인하는 것이다.

1. DGX Spark의 OS·GPU·Docker가 정상인지 확인한다.
2. Gemma 4 12B base 체크포인트가 BF16으로 로드되는지 확인한다.
3. `P0` 축소 실험으로 손실, 그래디언트, 메모리 경로를 검증한다.

> 이 폴더에는 실행 순서와 실험 설정 계약이 들어 있다. 모델 래퍼와 학습 코드는 아직 구현 대상이다. 구현 전에 `EXPERIMENT_DESIGN.md`의 P0 통과 조건을 고정해야 불필요한 40 GiB 테이블 생성과 장시간 실행을 피할 수 있다.

## 오늘 가장 먼저 할 일

### 1. DGX Spark 자체를 먼저 업데이트한다

전원과 네트워크를 안정적으로 연결하고, 중요한 파일을 백업한 뒤 **DGX Dashboard의 시스템 업데이트**를 사용한다. NVIDIA가 Spark에서 권장하는 경로다. 업데이트가 끝나면 재부팅한다.

Dashboard를 사용할 수 없을 때만 공식 수동 절차를 따른다.

```bash
sudo apt update
sudo apt dist-upgrade
sudo fwupdmgr refresh
sudo fwupdmgr upgrade
sudo reboot
```

재부팅 뒤 이 프로젝트 폴더를 Spark의 로컬 NVMe(예: `~/work/gemma4-12b-ngram`)로 복사한다. 네트워크 드라이브에서 학습하지 않는다.

### 2. 아무것도 내려받기 전에 호스트를 점검한다

프로젝트 루트에서 실행한다.

```bash
cd ~/work/gemma4-12b-ngram
bash scripts/preflight.sh | tee preflight.txt
```

통과 기준은 다음과 같다.

- 아키텍처가 `aarch64`
- `nvidia-smi`가 오류 없이 실행됨
- Docker daemon에 현재 사용자로 접근 가능
- 로컬 작업 디스크 여유 공간 최소 250 GiB, 권장 500 GiB 이상
- 시스템 가용 메모리가 다른 큰 프로세스에 점유되지 않음

`docker ps`에서 권한 오류가 날 때만 다음을 실행하고 새 로그인 세션을 연다.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker ps
```

### 3. NVIDIA PyTorch 컨테이너를 고정한다

이 설계의 기준 이미지는 2026-09-11 현재 ARM64 manifest가 있는 `26.08-py3`다. `latest`는 쓰지 않는다.

```bash
docker pull nvcr.io/nvidia/pytorch:26.08-py3
docker image inspect nvcr.io/nvidia/pytorch:26.08-py3 \
  --format '{{index .RepoDigests 0}}' | tee container-digest.txt
```

GPU가 컨테이너 안에서도 보이는지 확인한다.

```bash
docker run --rm --gpus all \
  nvcr.io/nvidia/pytorch:26.08-py3 nvidia-smi
```

### 4. 영속 디렉터리를 만들고 컨테이너를 연다

모델 캐시, 데이터, 체크포인트가 컨테이너 삭제와 함께 사라지지 않도록 호스트 디렉터리를 마운트한다.

```bash
mkdir -p "$HOME/.cache/huggingface" "$PWD/data" "$PWD/outputs"

docker run --gpus all -it --rm --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -v "$PWD:/workspace" -w /workspace \
  nvcr.io/nvidia/pytorch:26.08-py3
```

이후 명령은 컨테이너 안에서 실행한다.

```bash
python - <<'PY'
import platform, torch
print("machine:", platform.machine())
print("torch:", torch.__version__)
print("cuda runtime:", torch.version.cuda)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    x = torch.randn(1024, 1024, device="cuda", dtype=torch.bfloat16)
    print("bf16 matmul:", (x @ x).shape)
PY
```

`cuda available: True`와 BF16 matmul 성공을 확인한 뒤에만 Python 패키지를 설치한다.

```bash
python -m pip install -r requirements.txt
python -m pip freeze | sort > outputs/p0-environment.txt
```

### 5. Hugging Face 접근을 준비하고 모델만 먼저 받는다

브라우저에서 Gemma 사용 조건이 표시되면 먼저 동의한다. 토큰을 명령줄 인자나 파일에 직접 적지 말고 대화형 로그인을 사용한다.

```bash
hf auth login
hf download google/gemma-4-12B \
  config.json generation_config.json \
  tokenizer.json tokenizer_config.json \
  processor_config.json model.safetensors
```

모델 다운로드 뒤 캐시가 있는 디스크의 여유 공간을 다시 확인한다.

```bash
df -h "$HOME/.cache/huggingface" "$PWD"
```

### 6. P0 전에 반드시 할 네 가지 테스트

학습 코드 구현 시 아래 테스트를 먼저 만든다.

1. **기준선 동치성:** adapter gate를 끈 출력과 원본 Gemma 출력의 최대 절대 오차가 BF16 허용 범위 안인지 확인한다.
2. **인과성:** 위치 `t`의 n-gram은 `token[0:t]`만 사용하며 미래 토큰을 바꿔도 위치 `t` 특징이 바뀌지 않아야 한다.
3. **동결 검증:** 한 step 뒤 Gemma 파라미터는 bitwise 동일하고, table/projection/gate에만 그래디언트가 있어야 한다.
4. **재현성:** 같은 token IDs와 seed는 재시작 후에도 같은 bucket IDs를 만들어야 한다. Python 내장 `hash()`는 금지한다.

그 다음 `configs/p0_smoke.yaml`로 **약 1,000만 토큰만** 실행한다. P0가 통과하기 전에는 `2^20` 또는 `2^23` 테이블을 만들지 않는다.

## 실행 순서 요약

```text
Spark 업데이트/재부팅
  → 호스트 preflight
  → 26.08-py3 이미지 pull 및 GPU smoke test
  → Gemma 인증/다운로드
  → 원본 Gemma validation NLL 기록
  → 단위 테스트 4종
  → P0(2^16 slots/head, 10M tokens)
  → 통과 시에만 P1
```

## 파일 안내

- `EXPERIMENT_DESIGN.md`: 가설, 구조, 단계, 평가, 메모리 예산, 중단 기준
- `configs/p0_smoke.yaml`: 첫 구현이 따라야 할 P0 설정 계약
- `scripts/preflight.sh`: 다운로드나 시스템 변경 없이 호스트 상태를 수집하는 점검 스크립트
- `requirements.txt`: NGC PyTorch 위에 추가하는 Python 패키지의 최소 호환 범위

## 공식 참고자료

- NVIDIA DGX Spark OS/컴포넌트 업데이트 가이드: <https://docs.nvidia.com/dgx/dgx-spark/os-and-component-update.html>
- NVIDIA DGX Spark PyTorch fine-tuning playbook: <https://build.nvidia.com/spark/pytorch-fine-tune/instructions>
- NVIDIA NGC PyTorch 태그: <https://catalog.ngc.nvidia.com/orgs/nvidia/-/containers/pytorch/-/tags>
- Gemma 4 12B base 모델: <https://huggingface.co/google/gemma-4-12B>
- FineWeb2 데이터셋: <https://huggingface.co/datasets/HuggingFaceFW/fineweb-2>
