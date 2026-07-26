# 매화수련록

한지와 매화 분위기로 만든 모바일 중심 주간 계획표입니다.

## 주요 기능

- 주간 계획표와 오늘 일정 전환
- 오늘 일정의 목록·24시간 원형 보기
- 직접 작성과 자동 계획 생성
- 완료·미완료·미확인 상태 판정
- 화산오검 순환 반응 대사
- 완료율, 연속 달성일, 최근 기록
- 브라우저별 익명 `clientId`와 Cloudflare D1을 이용한 저장

캐릭터 이미지는 포함하지 않았으며 현재는 이름 인장으로 표시합니다.

## 실행

Node.js 22.13 이상과 pnpm이 필요합니다.

```bash
pnpm install
pnpm dev
```

로컬 D1을 처음 준비할 때는 다음 마이그레이션을 적용합니다.

```bash
pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/state
```

## 검증

```bash
pnpm lint
pnpm test
```

제품 기준과 구조적 결정은 `docs/`에 정리되어 있습니다.
