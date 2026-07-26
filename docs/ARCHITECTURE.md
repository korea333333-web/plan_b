# 아키텍처 — 현재 구현

## 1. 기술 구성

- Vinext 기반 Next.js App Router
- React 19 클라이언트 컴포넌트
- TypeScript
- Tailwind CSS 4 import + 직접 작성한 전역 CSS
- Cloudflare Worker
- Cloudflare D1 + Drizzle ORM

추가 상태 관리, 차트, 날짜 라이브러리는 사용하지 않는다.

배포 경로는 두 개다.

| 환경 | 빌드·런타임 | 계획 저장 |
|---|---|---|
| 로컬 개발·OpenAI Sites | vinext + Cloudflare Worker | D1 |
| Vercel | Next.js `next build` | 브라우저 `localStorage` |

Vercel 경로에는 D1 바인딩이 없으며 서버 동기화를 제공하지 않는다.

## 2. 실제 모듈

```text
app/
  page.tsx                 # PlannerApp만 렌더링
  PlannerApp.tsx           # 세 탭과 모든 주요 UI 상태
  globals.css              # 전체 디자인과 반응형 규칙
  api/plans/route.ts       # vinext/D1 경로의 GET/POST/PATCH/DELETE
lib/
  planner.ts               # 날짜, 자동 배치, 통계, 대사
db/
  schema.ts                # plans 테이블
  index.ts                 # D1 Drizzle 연결
drizzle/
  0000_empty_the_captain.sql
tests/
  planner-engine.test.mjs
  rendered-html.test.mjs
```

세 제품 화면은 별도 라우트가 아니다. `PlannerApp`의 `page: "planner" | "create" | "records"` 상태로 `/` 안에서 전환한다.

## 3. 브라우저 상태

React에만 저장되어 새로고침 시 초기화되는 값:

- 현재 제품 탭
- 주간/오늘
- 표/원
- 30분/1시간
- 기준 주
- 자동 생성 미리보기
- 화산오검 반응 순번과 현재 토스트

브라우저 `localStorage`에 저장되는 값:

- `maewha-client-id`
- Vercel 환경에서는 계획 데이터

`clientId`는 첫 접속에 `crypto.randomUUID()`로 생성된다. 로그인 토큰이 아니며 사용자 신원을 증명하지 않는다. 로컬·Sites에서는 같은 브라우저 프로필의 D1 행을 다시 찾기 위한 키다. Vercel에서는 계획 자체가 같은 origin의 `localStorage`에만 남는다.

따라서 현재 구현은 다음을 보장하지 않는다.

- 다른 기기나 브라우저와 동기화
- 저장소 삭제 뒤 계정 복구
- 인증된 사용자 소유권
- 민감한 개인 정보에 적합한 접근 통제

## 4. 로컬·Sites의 D1 모델

아래 모델은 vinext로 실행하는 로컬 개발과 OpenAI Sites에만 적용된다. 테이블은 `plans` 하나다.

| 열 | 의미 |
|---|---|
| `id` | 자동 증가 정수 PK |
| `client_id` | 브라우저별 조회 키 |
| `title` | 계획 이름 |
| `date` | `YYYY-MM-DD` 기준 날짜 |
| `start`, `end` | `HH:mm` 시간 |
| `repeat` | 요일 번호 JSON 배열 또는 null |
| `category` | 현재 UI에서는 색상 문자열 |
| `memo` | 선택 메모 |
| `status` | planned/completed/incomplete/unconfirmed |
| `source` | manual/auto |
| `created_at`, `updated_at` | ISO 문자열 또는 DB 기본 시각 |

인덱스:

- `(client_id, date, start)`
- `(client_id, status)`

서버는 ID·날짜·시간·문자열 길이·enum을 검증한다. 종료 시간은 시작 시간보다 늦어야 한다. API 조회는 최대 500행이다.

## 5. 로컬·Sites의 API

단일 엔드포인트 `/api/plans`:

- `GET ?clientId=`: 해당 ID의 전체 계획을 날짜·시간순으로 조회
- `POST`: 계획 한 건 생성
- `PATCH`: 소유 `clientId`와 행 ID가 일치하는 계획 변경
- `DELETE ?clientId=&id=`: 계획 한 건 삭제

UI가 현재 사용하는 PATCH는 완료·미완료 상태 변경뿐이다. 일정 내용 편집 UI는 없다.

D1 오류와 검증 오류는 JSON `{ error }`로 반환한다. 테이블이 준비되지 않은 경우 503 안내를 반환한다.

Vercel에서는 이 API를 D1 동기화 수단으로 사용하지 않는다. 브라우저 저장 경로가 계획 조회·생성·상태 변경·삭제를 `localStorage`에 반영한다.

## 6. 환경별 저장 흐름

### 로컬·Sites

직접 작성은 폼 → POST 한 번 → D1 성공 행을 React 목록에 추가 → 내 계획표 탭 순서다.

자동 생성은 입력 → `generateAutoPlan()`으로 브라우저 메모리 미리보기 생성 → 각 항목을 순차 POST한다.

자동 저장은 트랜잭션이나 일괄 API가 아니다. 루프 중 실패하면 이미 성공한 행은 D1과 React 목록에 남고 뒤 항목은 저장되지 않는다. 현재 구조에서 전부 성공·전부 실패를 가정하면 안 된다.

D1 API가 네트워크 오류, 404 또는 5xx를 반환하면 UI는 현재 브라우저 저장으로 전환하고 안내 배너를 표시한다. `서버 다시 연결`이 성공하면 D1 목록으로 돌아가며, 브라우저 폴백 계획을 D1과 자동 병합하지 않는다.

### Vercel

직접 작성, 자동 생성, 상태 변경, 삭제 결과를 브라우저 `localStorage`의 계획 목록에 반영한다. 저장 범위는 Vercel 사이트의 origin과 현재 브라우저 프로필이다.

- Cloudflare Worker나 D1에 요청하지 않는다.
- 서버 백업, 계정 복구, 브라우저 간 병합은 없다.
- `localStorage`를 지우면 Vercel 계획도 사라진다.
- 브라우저 저장 실패는 D1로 자동 전환하지 않는다.

## 7. 날짜와 반복

- D1은 날짜와 시간을 문자열로 저장한다.
- `lib/planner.ts`의 날짜 범위·요일 계산은 UTC 기반 문자열 연산으로 환경별 날짜 밀림을 피한다.
- UI의 오늘, 현재 시각, 종료 판정은 브라우저의 로컬 `Date`를 사용한다.
- 고정 `Asia/Seoul` 변환이나 UTC epoch 저장은 없다.

반복 일정은 별도 회차 행을 만들지 않는다. 기준 날짜 이후 `repeat`에 포함된 요일이면 같은 계획 행을 화면에 다시 그린다. 상태도 같은 행 하나에 저장되므로 반복 회차마다 독립적으로 완료 처리할 수 없다.

## 8. 상태와 대사

저장 상태는 네 값이다.

```text
planned -- 종료 시각 경과(화면 계산) --> unconfirmed
planned/unconfirmed -- 사용자 선택 --> completed 또는 incomplete
```

`planned` 행은 시간이 지나도 D1에서 자동 변경되지 않는다. `effectiveStatus()`가 화면에서만 미확인으로 바꿔 해석한다.

판정 성공 후 `reactionIndex`로 인물을 고르고 토스트를 5.2초 표시한다. 순번과 인물은 행에 저장하지 않는다. 새로고침하면 순번은 0으로 돌아간다. 현재 UI는 완료·미완료 상태의 정정을 제공하지 않는다.

대사와 순서는 `lib/planner.ts`의 `CHARACTER_ORDER`, `CHARACTER_DIALOGUES`가 단일 기준이다.

## 9. 자동 배치

`generateAutoPlan()`은 다음만 고려한다.

- 시작일·종료일
- 선택 요일
- 요일별 가능 시간(현재 UI에서는 모든 선택 요일에 같은 시간)
- 하루 최대 분
- 각 할 일의 총 분량
- 30분 또는 60분 분산 단위

겹치는 가능 시간 창은 합친다. 전체 분량을 가능한 날에 고르게 나누고, 수용하지 못한 분량을 `unscheduled`로 반환한다.

현재 저장소의 기존 일정은 함수 입력에 들어가지 않으므로 환경과 관계없이 충돌을 피하지 않는다. 결과는 결정적이지만 미리보기 수정 기능은 없다.

## 10. 기록 계산

- `calculateCompletionRate`: completed / (completed + incomplete), 반올림
- `calculateCompletionStreak`: 계획이 있는 날짜만 보고 모두 완료된 날짜를 역순으로 계산
- 오늘에 planned만 있으면 오늘은 건너뜀
- incomplete 또는 effective unconfirmed 날짜에서 중단

UI는 전체 로드된 행을 함수에 넘긴다. 주간·월간 필터가 없으며 매화 개화도 같은 전체 완료율을 사용한다.

## 11. 빌드와 배포 설정

### 로컬·Sites

- `.openai/hosting.json`: `"d1": "DB"`
- `wrangler.jsonc`: `DB` 바인딩과 `drizzle` migration 디렉터리
- `db/index.ts`: `env.DB`로 Drizzle 생성

스키마를 바꿀 때:

1. `db/schema.ts` 수정
2. `pnpm run db:generate`
3. 생성 migration 검토
4. 로컬과 Sites D1에 적용

로컬·Sites는 D1을 우선 사용한다. D1 API 장애 때만 안내와 함께 브라우저 저장으로 폴백한다.

### Vercel

- Vercel Build Command는 `next build` 경로를 사용한다.
- Vercel 배포에는 Cloudflare `DB` 바인딩을 요구하지 않는다.
- 브라우저 저장 모드를 사용하며 D1 마이그레이션을 Vercel 저장 준비 절차로 안내하지 않는다.
- Vercel에서 보이는 계획을 “클라우드 저장”, “서버 동기화”, “교차 기기 저장”으로 표현하지 않는다.
