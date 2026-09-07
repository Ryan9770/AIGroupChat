# fetch-client

## 사용법

```js
import { buildRequest } from 'fetch-client';

const req = buildRequest({ timeout: 3000, retries: 1 });
```

## 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `timeout` | `5000` | 요청 제한 시간(밀리초) |
| `retries` | `2` | 재시도 횟수 |

`timeout`은 0보다 커야 하고, `retries`는 0 이상의 정수여야 한다.
