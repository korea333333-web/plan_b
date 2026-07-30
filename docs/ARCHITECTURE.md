# 아키텍처 — 현재 구현

## 1. 기술 구성

- Vinext 기반 Next.js App Router
- React 19 클라이언트 컴포넌트
- TypeScript
- Tailwind CSS 4 import + 직접 작성한 전역 CSS
- Supabase Auth
- Supabase Postgres `plans` 테이블 + Row Level Security(RLS)
- 과거 OpenAI Sites 계획을 읽기 위한 Cloudflare Worker, D1, Drizzle ORM

추가 상태 관리, 차트, 날짜 라이브러리는 사용하지 않는다.

계획의 기준 저장소는 배포 환경과 관계없이 Supabase 하나다.

| 환경 | 빌드·런타임 | 현재 계획 저장 |
|---|---|---|
| 로컬 개발·OpenAI Sites | vinext + Cloudflare Worker | Supabase |
| Vercel | Next.js `next build` | Supabase |

Sites의 D1과 Vercel의 기존 `localStorage`는 새 계획 저장소가 아니다. 로그인한 사용자가 명시적으로 실행하는 기존 계획 가져오기에만 사용한다.

## 2. 실제 모듈

```text
app/
  page.tsx                 # PlannerApp 렌더링
  PlannerApp.tsx           # 인증 상태 연결, 세 탭, 주요 UI 상태와 CRUD
  AuthGate.tsx             # Google OAuth 로그인 진입과 오류 상태
  globals.css              # 인증 화면을 포함한 디자인과 반응형 규칙
  api/plans/route.ts       # 과거 D1 계획 가져오기용 엔드포인트
lib/
  planner.ts               # 날짜, 자동 배치, 통계, 대사
  plan-types.ts            # 화면 계획과 쓰기 타입
  supabase.ts              # 브라우저 Supabase 클라이언트
  supabase-plans.ts        # Postgres 행 변환, 쓰기 payload, 중복 서명
db/
  schema.ts                # 과거 D1 plans 테이블 모델
  index.ts                 # D1 Drizzle 연결
drizzle/
  0000_empty_the_captain.sql
  0001_lively_lilith.sql   # 과거 D1 반복 회차별 상태 열
tests/
  planner-engine.test.mjs
  supabase-plans.test.ts
  rendered-html.test.mjs
```

세 제품 화면은 별도 라우트가 아니다. 로그인 뒤 `PlannerApp`의 `page: "planner" | "create" | "records"` 상태로 `/` 안에서 전환한다.

## 3. 인증 흐름

`AuthGate`는 브라우저의 Supabase 클라이언트를 사용해 Google OAuth를 시작한다.

- 첫 렌더에서 저장된 인증 세션을 확인한다.
- 인증 확인이 끝나기 전에는 이전 계정의 계획 화면을 렌더링하지 않는다.
- 세션이 없으면 `Google로 계속하기` 버튼을 표시한다.
- 버튼을 누르면 `signInWithOAuth({ provider: "google" })`로 Google의 계정 선택·동의 화면으로 이동한다.
- 인증 뒤 허용된 앱 주소로 돌아오면 Supabase 클라이언트가 OAuth 응답을 세션으로 복구한다.
- 세션이 있으면 사용자 ID를 계획 조회와 쓰기에 사용한다.
- Supabase의 인증 상태 변경 이벤트로 로그인과 로그아웃을 반영한다.
- 로그아웃은 `scope: "local"`로 현재 브라우저 세션만 종료한다.
- 계정이 바뀌면 계획 작업 공간을 새 사용자 기준으로 초기화한다.

브라우저에는 Supabase URL과 publishable key만 제공한다. Google OAuth 공급자 설정은 Supabase 프로젝트에서 관리하며, OAuth 비밀값이나 service role key는 저장소·클라이언트 코드·`NEXT_PUBLIC_*` 환경 변수에 포함하지 않는다. 실제 사용자별 접근 권한은 UI의 필터가 아니라 Postgres RLS가 강제한다.

## 4. 브라우저 상태

React에만 저장되어 새로고침 시 초기화되는 값:

- 현재 제품 탭
- 주간/오늘
- 표/원
- 30분/1시간
- 기준 주
- 자동 생성 미리보기
- 화산오검 반응 순번과 현재 토스트
- 현재 저장·가져오기 안내 상태

Supabase 인증 세션은 Supabase 클라이언트가 브라우저에서 관리한다.

이전 버전과의 호환을 위해 읽을 수 있는 브라우저 값:

- `maewha-client-id`
- `maewha-plans:${clientId}` 형태의 과거 Vercel 계획
- 사용자·기기별 기존 계획 가져오기 완료 표시

`maewha-client-id`는 과거 D1 행을 찾거나 같은 origin의 과거 계획을 읽는 레거시 키일 뿐이다. 로그인 토큰이나 현재 계획의 소유권 근거로 사용하지 않는다.

제품 탭 전환은 `navigateToPage()`가 맡는다. 화면을 바꾼 뒤 문서 스크롤을 맨 위로 돌려, 긴 모바일 화면에서 이전 탭의 스크롤 위치가 새 탭에 남지 않게 한다.

## 5. Supabase 계획 모델

현재 모든 환경이 사용하는 Postgres `public.plans`의 주요 열:

| 열 | 의미 |
|---|---|
| `id` | identity 기본 키 |
| `user_id` | `auth.users.id`를 참조하는 계획 소유자 |
| `title` | 계획 이름 |
| `date` | `YYYY-MM-DD` 기준 날짜 |
| `start`, `end` | `HH:mm` 시간 |
| `repeat` | 요일 번호 JSONB 배열 또는 null |
| `category` | 현재 UI에서는 색상 문자열 |
| `memo` | 선택 메모 |
| `status` | 비반복 계획의 planned/completed/incomplete/unconfirmed. 반복 계획은 planned 유지 |
| `occurrence_statuses` | 반복 계획의 발생 날짜별 completed/incomplete JSONB 객체 |
| `source` | manual/auto |
| `created_at`, `updated_at` | DB가 관리하는 시각 |

RLS 정책은 인증된 사용자의 `auth.uid()`와 `user_id`가 같은 행에만 SELECT, INSERT, UPDATE, DELETE를 허용한다. 외부 키는 사용자 삭제 시 해당 계획도 삭제되도록 구성한다.

`lib/supabase-plans.ts`는 Supabase의 snake_case 행을 화면의 camelCase 계획으로 변환한다. JSONB와 과거 문자열 JSON을 정리하고, 손상된 반복 요일·회차 상태 값은 화면 모델에 넣지 않는다. 화면 모델의 `clientId` 필드는 레거시 호환 때문에 남아 있으며, Supabase 행에서는 `user_id`를 담는다.

## 6. 현재 Supabase 저장 흐름

### 조회

로그인한 사용자 ID로 `plans`를 날짜·시간순으로 조회한다. Supabase의 행 반환 상한에 잘리지 않도록 1,000행 단위로 끝까지 페이지 조회하며, RLS가 다른 사용자의 행을 반환하지 않는다. 조회가 실패하면 계획을 빈 목록으로 확정하거나 과거 로컬 계획으로 바꾸지 않고, 오류와 재시도 동작을 표시한다. 조회 중에는 생성·판정·삭제를 시작하지 않는다.

### 직접 작성

폼 검증 → Supabase INSERT 한 번 → 반환 행을 화면 모델로 변환 → React 목록에 추가 → 내 계획표 탭 순서다.

### 자동 생성

입력 → `generateAutoPlan()`으로 브라우저 메모리 미리보기 생성 → 각 항목을 Supabase에 순차 INSERT한다.

자동 저장은 트랜잭션이나 일괄 API가 아니다. 루프 중 실패하면 이미 성공한 행은 Supabase와 React 목록에 남고, 미리보기에서는 성공한 항목을 제외해 사용자가 남은 항목만 재시도하게 한다. 실패한 항목을 D1이나 `localStorage`에 대신 저장하지 않는다.

### 판정과 삭제

- 비반복 계획 판정은 행의 `status`를 변경한다.
- 반복 계획 판정은 전역 `status`를 `planned`로 유지하고 `occurrence_statuses[발생 날짜]`만 변경한다.
- 반복 계획 판정은 `updated_at` 비교 후 최신 행과 병합해, 서로 다른 발생 날짜의 동시 판정이 JSON 전체를 덮어쓰지 않게 한다.
- 같은 계획의 판정·삭제 요청이 진행 중일 때 해당 버튼을 잠가 같은 화면에서 중복 요청을 보내지 않는다.
- 반복 계획 삭제는 선택한 회차가 아니라 계획 행 전체를 삭제한다.
- UPDATE와 DELETE도 행 ID와 사용자 ID를 함께 제한하며 최종 권한은 RLS가 확인한다.

현재 일정 내용 편집과 판정 정정 UI는 없다.

## 7. 기존 계획 가져오기

이전 버전의 저장소는 자동으로 읽어 현재 계획 목록과 합치지 않는다. 로그인 뒤 사용자가 `기존 계획 가져오기`를 눌렀을 때만 다음을 수행한다.

1. 현재 origin의 `maewha-plans:${clientId}` 계획을 읽는다.
2. 과거 `maewha-client-id`로 `/api/plans?clientId=...`를 호출해 접근 가능한 Sites D1 계획을 500행 단위로 끝까지 읽는다.
3. 두 후보와 현재 Supabase 계획을 내용 서명으로 비교해 중복을 건너뛴다.
4. 남은 계획을 한 건씩 Supabase에 순차 INSERT한다.
5. 전체 작업이 끝나면 해당 사용자·기기의 가져오기 완료를 브라우저에 표시한다.

중복 서명은 제목, 기준 날짜, 시작·종료 시간, 반복 요일, 분류, 메모, 생성 방식을 사용한다. 저장소별 ID, 사용자 ID, 생성·수정 시각과 판정 상태는 서명에서 제외한다. 따라서 같은 내용의 계획이 이미 있으면 기존 판정 상태를 자동 합치거나 덮어쓰지 않고 가져오기를 건너뛴다.

중간 실패 시 일부 계획만 Supabase에 생성될 수 있다. 재시도는 이미 들어간 같은 내용의 계획을 다시 추가하지 않는 것을 우선한다. 원래 `localStorage`와 D1 행은 성공 뒤에도 자동 삭제하지 않는다.

브라우저 `localStorage`는 origin별이므로 다른 Vercel 별칭, preview 도메인, Sites 도메인 또는 다른 브라우저 프로필의 과거 계획은 현재 origin에서 직접 읽을 수 없다.

## 8. 과거 D1과 API

D1 모델은 신규 제품 데이터 모델이 아니라 이전 OpenAI Sites 계획을 읽기 위한 과도기 호환 계층이다.

| 열 | 의미 |
|---|---|
| `id` | 자동 증가 정수 PK |
| `client_id` | 과거 브라우저별 조회 키 |
| `title`, `date`, `start`, `end` | 계획 기본 정보 |
| `repeat`, `category`, `memo` | 반복과 표시 정보 |
| `status` | 과거 비반복 상태 |
| `occurrence_statuses` | 과거 반복 회차별 판정 |
| `source` | manual/auto |
| `created_at`, `updated_at` | 과거 저장 시각 |

현재 인증된 앱이 `/api/plans`를 사용하는 목적은 `GET ?clientId=`로 기존 후보를 읽는 것뿐이다. 응답은 최대 500행과 `complete`, `nextCursor`를 돌려주며 다음 요청은 `afterId`를 사용한다. `POST`, `PATCH`, `DELETE`는 405로 거부한다. 새 계획 생성, 판정, 삭제는 이 API나 D1로 보내지 않는다. D1을 Supabase의 백업 또는 자동 복제본으로 설명하지 않는다.

`clientId`는 인증이 아니므로 D1 API를 현재 사용자 소유권 검증 수단으로 사용하지 않는다. 이 호환 경로는 기존 데이터 이전 기간이 끝나면 제거할 대상이다.

## 9. 날짜와 반복

- Supabase와 과거 D1은 날짜와 시간을 `YYYY-MM-DD`, `HH:mm` 형태로 저장한다.
- `lib/planner.ts`의 날짜 범위·요일 계산은 UTC 기반 문자열 연산으로 환경별 날짜 밀림을 피한다.
- UI의 오늘, 현재 시각, 종료 판정은 브라우저의 로컬 `Date`를 사용한다.
- 고정 `Asia/Seoul` 변환이나 UTC epoch 저장은 없다.

반복 일정은 별도 회차 행을 만들지 않는다. 기준 날짜 이후 `repeat`에 포함된 요일이면 같은 계획 행을 화면에 다시 그린다. 완료·미완료 판정은 같은 행의 `occurrenceStatuses` 객체에 `YYYY-MM-DD` 키로 저장하므로 날짜별 회차가 독립적이다. 비반복 일정은 기존 `status` 열을 사용한다.

## 10. 상태와 대사

저장 상태는 네 값이다.

```text
planned -- 종료 시각 경과(화면 계산) --> unconfirmed
planned/unconfirmed -- 사용자 선택 --> completed 또는 incomplete
```

`planned` 행은 시간이 지나도 DB에서 자동 변경되지 않는다. `effectiveStatus()`가 발생 날짜의 `occurrenceStatuses`를 먼저 확인하고, 미판정 회차는 화면에서만 종료 시각에 따라 예정 또는 미확인으로 해석한다. 비반복 계획은 행의 `status`를 사용한다.

판정 성공 후 `reactionIndex`로 인물을 고르고 토스트를 5.2초 표시한다. 순번과 인물은 행에 저장하지 않는다. 새로고침하면 순번은 0으로 돌아간다.

대사와 순서는 `lib/planner.ts`의 `CHARACTER_ORDER`, `CHARACTER_DIALOGUES`가 단일 기준이다.

## 11. 자동 배치와 기록

`generateAutoPlan()`은 시작·종료일, 선택 요일, 가능 시간, 하루 최대 분, 각 할 일의 총 분량, 30분 또는 60분 단위를 고려한다. 기존 저장 일정과의 충돌은 검사하지 않으며 미리보기 수정 기능은 없다.

기록 계산:

- 비반복 판정과 반복 계획의 `occurrenceStatuses`를 발생 회차 목록으로 펼친다.
- 완료율은 completed / (completed + incomplete)를 반올림한다.
- 미확인 개수와 연속 달성은 최대 최근 365일 범위에서 계산한다.
- 이번 주 매화는 현재 주의 completed 발생 회차 1개당 1송이를 렌더링한다.

## 12. 환경 변수와 배포

브라우저 빌드에 필요한 값:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

두 값은 로컬 `.env.local`, OpenAI Sites 환경 변수, Vercel 환경 변수에 각각 설정한다. `.env.local`은 커밋하지 않고 `.env.example`에는 변수 이름만 기록한다.

Google 로그인을 위해서는 Supabase Auth의 Google 공급자가 활성화되어 있어야 하고, Google OAuth 콜백과 앱의 로컬·Sites·Vercel 반환 주소가 각 서비스의 허용 목록에 등록되어 있어야 한다. 앱의 브라우저 환경 변수에는 위 두 Supabase 공개 값만 둔다.

### 로컬·Sites

- vinext와 Cloudflare Worker 경로를 사용한다.
- `.openai/hosting.json`의 D1 `DB` 바인딩은 기존 계획 가져오기 호환을 위해 유지한다.
- 신규 계획의 스키마 변경은 Supabase에서 관리하며 과거 D1 migration 절차와 혼동하지 않는다.

### Vercel

- Vercel Build Command는 `next build` 경로를 사용한다.
- 현재 계획 저장에는 Cloudflare `DB` 바인딩이 필요 없다.
- 같은 Supabase 프로젝트 환경 변수를 Production, Preview, Development에 설정한다.

두 환경 모두 Supabase 연결 실패를 브라우저 계획 저장 성공으로 바꾸지 않는다.
