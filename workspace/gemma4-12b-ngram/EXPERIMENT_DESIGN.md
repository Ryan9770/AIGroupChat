# Gemma 4 12B 해시드 n-gram 주입 실험 설계서

문서 버전: 0.1  
기준일: 2026-09-11  
실행 환경: DGX Spark 1대, 128 GB coherent unified memory  
대상 모델: `google/gemma-4-12B` base, text-only causal language modeling

## 1. 연구 질문

Gemma 4 12B의 모든 기존 가중치를 고정한 상태에서, 얕은 층에 대용량 해시드 bigram/trigram 임베딩을 잔차로 주입하면 일반 텍스트의 다음-token validation NLL을 일관되게 낮출 수 있는가?

이 실험은 “파라미터 수가 많다” 자체보다 다음을 검증한다.

- 국소적인 어휘·형태 패턴을 해시 테이블이 저비용 lookup으로 기억하는가?
- 그 신호가 고정된 Transformer의 후속 층에서 유용하게 소비되는가?
- 충돌이 많은 작은 테이블에서 큰 테이블로 갈수록 성능이 예측 가능하게 개선되는가?
- 얻는 NLL 개선이 메모리, 처리량, 체크포인트 비용을 정당화하는가?

## 2. 사전 등록 가설

### 주가설 H1

동일한 고정 validation set에서 P1(`2^20` slots/head)은 adapter-off 기준선보다 평균 NLL을 **0.015 nat/token 이상** 낮춘다.

### 확장 가설 H2

P2(`2^23` slots/head)는 P1보다 평균 NLL을 추가로 **0.005 nat/token 이상** 낮추며, 개선은 희귀 n-gram 빈도 구간에서만 발생하지 않는다.

### 안전 가설 H3

adapter를 비활성화하면 원본 Gemma 기준선이 재현되고, 학습 전후 Gemma 본체 체크섬은 동일하다.

## 3. 모델 구조

### 3.1 고정 백본

- 체크포인트: instruction-tuned(`-it`)가 아닌 `google/gemma-4-12B` base
- dtype: BF16
- text hidden size: 3,840
- decoder blocks: 48
- 모든 Gemma 파라미터: `requires_grad=False`
- 학습/평가 중 KV cache: 끔
- 첫 두 블록까지는 `no_grad`로 실행하고 출력을 detach한 뒤 주입한다.
- 주입 이후 블록은 백본 가중치는 고정하되 adapter까지의 역전파 경로를 유지한다.

### 3.2 인과적 n-gram 정의

loss 위치 `t`가 `x[t+1]`을 예측할 때 다음 특징만 사용한다.

- bigram: `(x[t-1], x[t])`
- trigram: `(x[t-2], x[t-1], x[t])`
- 문서 경계를 넘는 n-gram은 만들지 않으며, 부족한 왼쪽 문맥은 전용 boundary ID로 채운다.

따라서 예측 대상인 `x[t+1]`이나 그 이후 토큰은 hash 입력에 포함되지 않는다.

### 3.3 멀티해시 테이블

- n-gram order: 2, 3
- order당 독립 hash heads: 8
- 총 heads: 16
- head vector dimension: 160
- 각 head는 독립 seed를 사용한다.
- bucket 수는 2의 거듭제곱이며 `bucket = stable_hash64(...) & (slots - 1)`로 계산한다.
- Python 프로세스마다 달라지는 내장 `hash()`는 사용하지 않는다.

각 위치에서 16개 벡터를 lookup하고 이어 붙인다.

```text
16 heads × 160 dim = 2,560 dim
2,560 ── linear projection ──> 3,840
```

### 3.4 주입 위치와 식

주입 위치는 **두 번째 decoder block 출력 뒤**로 고정한다(사람 기준 layer 2, Hugging Face module index 1).

```text
z_t  = concat(E[o,h][hash(o,h, history_t)])
r_t  = RMSNorm(W_proj z_t)
h'_t = h_t + tanh(g) · r_t
```

학습 파라미터는 hash tables, `W_proj`, RMSNorm scale, scalar gate `g`뿐이다. `tanh(g)`의 초기값은 0.01로 두어 원본 동작에 가깝게 시작하면서도 첫 step부터 table과 projection으로 그래디언트가 흐르게 한다. gate를 정확히 0으로 초기화하지 않는다.

## 4. 규모 단계

| 단계 | slots/head | table 파라미터 | BF16 table | 학습 토큰 | 목적 |
|---|---:|---:|---:|---:|---|
| P0 | `2^16` | 167,772,160 | 0.3125 GiB | 10M | 정확성·메모리·그래디언트 smoke test |
| P1 | `2^20` | 2,684,354,560 | 5 GiB | 100M | 효과 크기와 충돌 감소 확인 |
| P2 | `2^23` | 21,474,836,480 | 40 GiB | 500M, 통과 시 최대 1B | 최종 용량 검증 |

계산식은 `2 orders × 8 heads × slots × 160 dim`이다. bucket 의미가 capacity에 따라 바뀌므로 각 단계는 **새 table로 처음부터** 학습한다. 이전 단계 table을 단순 복사해 warm-start하지 않는다.

## 5. 데이터 설계

### 5.1 코퍼스

- 1차 코퍼스: FineWeb2의 한국어(`kor_Hang`) 일반 텍스트
- tokenizer: Gemma 4 체크포인트에 포함된 tokenizer 고정
- 입력: text-only; 이미지·오디오 토큰은 사용하지 않음
- 문서 단위 deterministic split 후 tokenization한다. tokenized stream을 먼저 섞은 뒤 split하지 않는다.
- train/validation/test 문서 ID와 데이터셋 revision을 manifest에 기록한다.

### 5.2 분할

- validation: 고정 10M tokens. P0의 중간 평가는 그 안의 고정 2M-token subset을 쓰고, 종료 시 전체를 평가한다.
- test: 고정 10M tokens, 최종 P2 결론 전까지 보지 않음
- train: 단계별 앞의 10M / 100M / 500M tokens; P2가 유망할 때만 1B까지 확장
- 동일 문서가 여러 split에 들어가지 않도록 content hash로 검사한다.

### 5.3 저장 형식

- 토큰 ID는 로컬 NVMe에 `uint32` 고정 길이 shard로 사전 생성한다.
- 각 sample은 1,025 tokens를 읽어 1,024 입력과 shifted label을 만든다.
- 문서 경계, tokenizer revision, shard SHA-256, sample 수를 manifest에 남긴다.
- 학습 중 원문 streaming/tokenization을 하지 않아 네트워크와 tokenizer 변동을 제거한다.

## 6. 학습 설정

P0의 구체 값은 `configs/p0_smoke.yaml`을 단일 기준으로 삼는다.

- sequence length: 1,024
- microbatch: 1
- gradient accumulation: 16
- effective tokens/update: 16,384
- backbone: BF16, frozen
- activation checkpointing: 주입 이후 decoder blocks에 적용
- table optimizer P0: sparse SGD, momentum 0, weight decay 0
- projection/norm/gate optimizer: AdamW
- gradient clipping: trainable dense 모듈에 적용; sparse table gradient norm은 별도 기록
- checkpoint: adapter 구성요소와 manifest만 저장하며 Gemma 본체를 복제하지 않음

P2에서는 일반 AdamW, SparseAdam, 표준 Adagrad를 table에 사용하지 않는다. 21.47B table 전체 크기의 dense moment/state가 생길 수 있기 때문이다. 우선 sparse SGD로 검증하고, 성능상 필요할 때만 **실제 row-wise scalar state**를 쓰는 검증된 optimizer kernel을 도입한다. 이 경우 FP32 state는 약 0.5 GiB다.

## 7. 비교군과 ablation

모든 비교는 같은 validation tokens, tokenizer, sequence length로 수행한다.

| ID | 조건 | 답하려는 질문 |
|---|---|---|
| B0 | adapter off, 원본 frozen Gemma | 절대 기준선 |
| C1 | P1과 동일하되 n-gram bucket을 batch마다 무작위 치환 | 단순 noise/추가 residual 효과인가? |
| C2 | bigram heads만 사용 | trigram의 추가 기여는? |
| C3 | trigram heads만 사용 | bigram과 역할이 다른가? |
| C4 | 같은 projection 폭의 non-hashed 저랭크 residual adapter | lookup 기억과 단순 adapter 효과를 구분할 수 있는가? |
| A1 | 주입 위치: block 8 뒤 | 얕은 주입에 특이적인가? |

P0에서는 B0만 필수다. C1–C4와 A1은 P1의 주가설이 통과할 때 실행한다. 모든 조합을 한꺼번에 탐색하지 않는다.

## 8. 측정값

### 8.1 1차 지표

- validation mean NLL (nat/token)
- `ΔNLL = NLL(adapter_on) - NLL(B0)`; 음수가 개선
- token perplexity는 `exp(NLL)`로 함께 보고하되 의사결정은 NLL로 한다.

### 8.2 2차 지표

- n-gram train frequency 분위수별 NLL 변화
- 한글/숫자/라틴/구두점 token class별 NLL 변화
- hash head별 unique buckets, collision rate 추정, lookup gradient sparsity
- peak unified-memory 사용량, step time, tokens/s
- gate 값, projection norm, sparse gradient norm
- train-validation gap

### 8.3 통계 보고

- validation 문서 단위 bootstrap 95% confidence interval을 사용한다.
- P1은 seed 3개를 권장한다. 비용상 1개만 먼저 실행할 경우 탐색 결과로 표시하고 나머지 2개를 확인 실행한다.
- best checkpoint를 validation에 반복 선택한 뒤 같은 validation 수치를 확정 결과로 쓰지 않는다. 선택용 구간과 보고용 validation을 분리한다.

## 9. 단계별 통과 및 중단 기준

### P0 통과

다음을 모두 만족해야 한다.

- 예정 10M tokens(현재 P0 config는 610 update)를 NaN/Inf 없이 완료
- adapter-off 기준선 재현
- Gemma 파라미터 체크섬 불변
- table/projection/gate에 유한하고 0이 아닌 gradient 확인
- 미래 token 변경이 과거 위치 hash를 바꾸지 않는 인과성 테스트 통과
- 전체 P0 구간 동안 OOM 없음
- checkpoint 저장 후 재개한 다음 step의 loss가 허용 오차 안에서 재현

하나라도 실패하면 P1으로 가지 않는다.

### P1 진행(Go)

- validation `ΔNLL ≤ -0.015 nat/token`
- 문서 bootstrap 95% CI 상한이 0 미만
- 무작위 hash 대조군 C1보다 `0.01 nat/token` 이상 우수
- 심한 train-only 암기나 처리량 붕괴가 없음

`-0.015 < ΔNLL < 0`이면 보류: seed 2개를 추가하고 원인을 분석한다. `ΔNLL ≥ 0`이거나 C1과 차이가 없으면 P2를 중단한다.

### P2 성공

- P1 대비 추가 `ΔNLL ≤ -0.005 nat/token`
- B0 대비 총 개선의 95% CI 상한이 0 미만
- 개선이 적어도 두 개 이상의 n-gram 빈도 분위수에서 관찰됨
- 시스템+모델+table+optimizer+activation을 포함한 peak 사용량이 115 GiB 미만
- 최소 10%의 메모리 headroom을 유지하며 5,000 update 연속 안정 실행

P2가 P1보다 유의하게 좋아지지 않으면 40 GiB table은 운영 후보에서 제외하고 P1을 최종 규모로 간주한다.

## 10. DGX Spark 메모리 예산

P2 예상치이며 실제 peak는 구현 후 계측값으로 대체한다.

| 항목 | 예상 |
|---|---:|
| Gemma 4 12B BF16 weights 및 로드 오버헤드 | 24–30 GiB |
| n-gram BF16 tables | 40 GiB |
| row-wise optimizer state(선택 시) | 약 0.5 GiB |
| projection/norm/gate 및 optimizer | 0.1 GiB 미만 |
| sparse gradients/indices | 1–4 GiB |
| activations와 checkpoint recompute working set | 10–20 GiB |
| CUDA allocator, kernels, dataloader, OS 여유 | 12–20 GiB |
| **예상 peak** | **약 92–113 GiB** |

DGX Spark의 128 GB는 CPU와 GPU가 공유한다. 따라서 `nvidia-smi`의 전통적인 전용 VRAM 수치만 믿지 말고, `free`, DGX Dashboard, 프로세스 RSS, CUDA peak allocation을 함께 기록한다. swap을 성능 안전망으로 간주하지 않는다.

## 11. 재현성 및 산출물

각 run 디렉터리에 다음을 저장한다.

- 완전히 해석된 YAML config
- Git commit 또는 소스 bundle hash
- 모델 ID와 실제 Hugging Face revision SHA
- NGC image digest와 `pip freeze`
- dataset/shard manifest와 SHA-256
- 모든 hash seed와 hash 알고리즘 버전
- train/eval JSONL metrics
- peak memory와 throughput 요약
- adapter-only checkpoint 및 checksum
- backbone 시작/종료 checksum 비교 결과

run 이름 예시:

```text
20260911_p0_s65536_seed20260911
```

## 12. 주요 위험과 완화책

- **미래 token 누출:** shifted label과 n-gram index의 off-by-one 단위 테스트를 가장 먼저 작성한다.
- **dense optimizer state 폭증:** table optimizer를 별도 구성하고 checkpoint에서 state shape를 검사한다.
- **백본이 실수로 학습됨:** optimizer 생성 전에 trainable parameter allow-list를 assert하고 전후 checksum을 비교한다.
- **통합 메모리 thrashing:** 115 GiB를 hard stop으로 두고 P0→P1→P2 순서를 건너뛰지 않는다.
- **hash 비재현:** 고정 64-bit 알고리즘·seed를 manifest에 기록하고 CPU/GPU golden vector test를 둔다.
- **문서 경계 오염:** boundary ID와 attention/loss mask를 shard 생성 단계에서 함께 저장한다.
- **ARM64 패키지 부재:** NVIDIA multi-arch PyTorch 컨테이너를 기반으로 하고, 모든 추가 wheel 설치를 P0 전에 검증한다.
- **효과가 단순 용량 암기:** 무작위 hash와 non-hashed residual 대조군, frequency-bin 평가로 구분한다.
- **체크포인트 저장 공간 부족:** adapter만 저장하고 P2 checkpoint는 `last`와 `best` 최대 2개로 제한한다.

## 13. 의사결정 기록

실험의 첫 결론은 “P2를 돌릴 수 있는가”가 아니라 “P1에서 검증 가능한 일반화 개선이 있는가”다. P0는 소프트웨어와 과학적 유효성 검증, P1은 아이디어 검증, P2는 용량 확장 검증으로 구분한다.
