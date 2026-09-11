# hf-model-browser

Hugging Face 허브 모델을 검색하고, `nvidia-smi`로 감지한 로컬 GPU의 VRAM 용량과
비교해 실제로 적재 가능한 모델인지 보여주는 CLI 도구.

의존성 없음 (Python 3.9+ 표준 라이브러리만 사용).

## 사용법

```bash
python hf_browser.py gpu
```

```
GPU                            전체 VRAM       사용중         여유
------------------------------------------------------------------
NVIDIA GeForce RTX 5070 Ti        15.9GB       15.3GB       0.4GB
```

```bash
# 모델 검색 (이름에서 파라미터 수 추정)
python hf_browser.py search llama --limit 10

# 현재 GPU 여유 VRAM 기준 적재 가능 여부 표시
python hf_browser.py search llama --show-fit

# 적재 가능한 모델만 필터링
python hf_browser.py search llama --fits-only

# 실제 가중치 파일 크기까지 조회 (더 정확하지만 느림, 모델마다 API 호출 1회 추가)
python hf_browser.py search llama --show-fit --detailed

# 특정 모델 상세 + GPU별 적재 가능 여부
python hf_browser.py info meta-llama/Llama-2-7b-hf
```

## 동작 원리

1. **GPU 감지**: `nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free`
   결과를 파싱한다. NVIDIA 드라이버가 없으면 오류 메시지를 출력한다.
2. **모델 검색**: `https://huggingface.co/api/models` 공개 API를 호출한다 (인증 불필요).
3. **크기 추정**:
   - `--detailed` 옵션 시 `/api/models/{id}/tree/main`에서 `.safetensors`/`.bin`/`.gguf`
     등 가중치 파일 크기를 합산한다 (가장 정확).
   - 그렇지 않으면 모델 이름에 박힌 `7b`, `13B` 같은 패턴으로 파라미터 수를 추정하고,
     fp16 기준 `1B 파라미터 ≈ 2GB`로 환산한다.
   - 추론 시 KV 캐시 등 오버헤드를 고려해 최종 필요 VRAM은 가중치 크기의 1.2배로 계산한다.
4. 이 추정치를 GPU 여유 VRAM과 비교해 ✅/❌로 표시한다.

## 한계

- 파라미터 수를 이름에서 추출하지 못하는 모델(예: 커스텀 이름)은 `--detailed` 없이는
  크기를 추정할 수 없다.
- VRAM 추정치는 근사값이다. 실제 필요량은 양자화(4bit/8bit/GGUF), 배치 크기, 컨텍스트
  길이에 따라 달라진다.
- NVIDIA GPU만 지원한다 (`nvidia-smi` 기반).
