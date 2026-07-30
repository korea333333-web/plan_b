# 매화수련록 작업 지도

이 저장소는 모바일 우선 개인 계획표 **매화수련록**의 MVP다. 변경 전에 아래 문서를 읽는다.

1. `docs/PRODUCT_SPEC.md` — 현재 제공하는 기능과 제한
2. `docs/DESIGN.md` — 실제 화면 규칙
3. `docs/ARCHITECTURE.md` — 현재 코드·데이터 구조
4. `docs/QUALITY.md` — 현재 검증 범위

## 저장소 지도

- `app/PlannerApp.tsx`: 인증 상태 연결, 세 화면, 폼, 시간표, 기록을 포함한 클라이언트 앱
- `app/AuthGate.tsx`: Google OAuth 로그인 화면
- `app/api/plans/route.ts`: 기존 Sites D1 계획 가져오기용 과도기 API
- `app/globals.css`: 반응형 레이아웃과 매화·한지 디자인
- `lib/planner.ts`: 자동 배치, 날짜, 상태, 통계, 확정 대사
- `lib/supabase.ts`, `lib/supabase-plans.ts`: 인증 클라이언트와 계획 행 변환
- `db/schema.ts`: 기존 계획 가져오기용 D1 테이블
- `tests/`: 도메인 및 서버 렌더링 테스트
- `.openai/hosting.json`: 로컬·Sites의 `DB` D1 바인딩

## 현재 제품 불변 조건

- 화면은 `내 계획표 / 계획 만들기 / 수련 기록` 세 탭이며 URL은 `/` 하나다.
- 모바일은 하단 내비게이션, 920px 초과 화면은 좌측 사이드바를 사용한다.
- 현재 환경의 저장소가 비어 있으면 가짜 일정 대신 `아직 계획이 없습니다.`와 `계획 만들기`가 나온다.
- 주간/오늘, 30분/1시간, 오늘의 표/원형 보기를 지원한다.
- 종료 전은 `예정`, 종료 후 미판정 상태는 `미확인`이다. 자동 미완료 처리는 없다.
- 반복 계획의 완료·미완료 판정은 발생 날짜별로 독립적이며, 다른 날짜의 같은 반복 계획에 영향을 주지 않는다.
- 대사는 `lib/planner.ts`가 단일 기준이며 문구를 임의로 고치지 않는다.
- 캐릭터 사진과 웹툰 원본 이미지는 아직 넣지 않는다.
- 모든 환경은 Supabase Google OAuth 로그인이 필요하며 Postgres `plans`와 RLS를 단일 저장소로 사용한다.
- 같은 계정은 모바일·PC와 다른 브라우저에서 계획을 공유한다.
- 새 계획 저장이 실패해도 D1이나 브라우저 저장으로 자동 폴백하지 않는다.
- 과거 Vercel `localStorage`와 Sites D1 계획은 사용자가 명시적으로 가져올 때만 Supabase에 순차 복사한다.

## 구현상 주의

- 자동 생성 저장과 기존 계획 가져오기는 일정별 순차 INSERT다. 원자적 일괄 저장으로 가정하지 않으며, 자동 생성 재시도는 이미 성공한 미리보기 항목을 제외한다.
- publishable key만 브라우저에 제공하며 service role key를 클라이언트 환경 변수에 넣지 않는다.
- Google OAuth Client Secret은 Supabase 공급자 설정에만 보관하며 저장소, 채팅, `NEXT_PUBLIC_*` 환경 변수에 넣지 않는다.
- 사용자별 접근 제어는 UI 필터가 아니라 Supabase RLS가 강제한다.
- 기존 계획은 현재 계정 데이터와 자동 병합하거나 원본 저장소에서 자동 삭제하지 않는다.
- 반복 일정은 한 DB 행을 여러 요일에 보여 주되 판정은 `occurrenceStatuses`에 발생 날짜별로 저장한다. 비반복 일정은 기존 `status`를 사용한다.
- 반복 계획의 삭제는 선택한 회차만이 아니라 반복 계획 전체 행을 삭제한다.
- `occurrenceStatuses` 추가 migration은 기존 반복행의 전역 `status`를 `planned`로 초기화하며, 비반복행의 기존 `status`는 유지한다.
- 기록 통계는 계획 행이 아니라 발생 회차를 기준으로 계산한다. 미확인 개수와 연속 달성 범위는 최대 최근 365일이다.
- 반응 순번과 보기 설정은 React 상태라 새로고침 후 초기화된다.
- 날짜·시간은 `YYYY-MM-DD`, `HH:mm` 문자열로 저장한다. UTC 저장이나 고정 KST 변환이 구현됐다고 가정하지 않는다.
- 테스트 fixture를 실제 초기 화면에 넣지 않는다.
- UI·DB 동작을 바꾸면 먼저 이 문서들의 “현재” 설명도 함께 갱신한다.
- Git 커밋 메시지는 항상 한글로 작성한다.

## 검증

```bash
pnpm run lint
pnpm test
pnpm run build
pnpm exec next build
```

`pnpm run build`/`pnpm test`는 vinext·Sites 경로, `pnpm exec next build`는 Vercel 경로를 확인한다.
