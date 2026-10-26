# HamLog (Technical Blog)

Node.js(Express) 백엔드와 React(Vite) 프론트엔드로 구성된 기술 블로그 프로젝트입니다.  
복잡한 RDBMS 없이 **파일 시스템의 JSON 파일을 데이터 저장소로 사용**하여 가볍고 이식성이 뛰어난 것이 특징입니다.

## Architecture
- **Frontend**: `src/` (React + Vite)
- **Backend**: `server/` (Express API + 정적 파일 서빙)
- **Storage**: `server/data/` (JSON, 조회수·익명 방문 통계 분리 저장), `server/uploads/` (이미지 업로드)
- **Prod Serving**: 백엔드가 `dist/` 정적 자산을 서빙하고 SPA fallback을 제공합니다. (`server/app.js`)

## Tech Stack
- **Frontend**: React, Vite, TypeScript
- **Styling**: TailwindCSS
- **State**: Zustand
- **Editor**: Tiptap (Headless WYSIWYG)
- **Backend**: Node.js(Express), JWT(Auth cookie)
- **Infra**: Docker, GitHub Actions, Self-Hosted Runner(옵션)

## Key Features
- **Admin 글쓰기/관리**: Tiptap 기반 편집, 이미지 업로드/붙여넣기, 미리보기
- **자동 목차(TOC)**: 글 본문의 `h1/h2/h3` 기반 TOC 생성 + 스크롤 스파이
- **검색/필터링**: 카테고리/태그/검색 기반 탐색
- **방문 통계**: 실시간 접속자, 오늘·누적 순 방문자/페이지뷰, 최근 7일 집계
- **SEO**: 메타/OG, 라우트 기반 메타 주입, 사이트맵/RSS
- **보안**: JWT 인증(쿠키), CORS 제어, Rate Limit, 링크 프리뷰 SSRF 방어

## Local Development
### Prerequisites
- Node.js 24, npm 11

### 1) Install
```bash
npm ci
```

### 2) Run (Dev)
터미널 2개를 사용합니다.

```bash
# API server (http://localhost:4000)
npm run server
```

```bash
# Vite dev server (http://localhost:5173)
npm run dev
```

Vite는 기본적으로 `/api`, `/uploads`를 `http://localhost:4000`으로 프록시합니다. (`vite.config.ts`)
API와 Vite는 개발 환경에서 기본적으로 `127.0.0.1`에만 바인딩됩니다.

Tailscale 또는 LAN에 개발 서버를 의도적으로 공개하려면 임시 기본 계정을 사용하지 말고,
두 프로세스에 동일한 명시적 허용 플래그와 별도 비밀값을 전달해야 합니다.

```bash
# 예시는 실제 Tailscale IP와 충분히 긴 임의 값으로 바꿉니다.
HOST=100.64.0.10 HAMLOG_ALLOW_EXTERNAL_DEV=true \
  JWT_SECRET='<random-secret>' ADMIN_PASSWORD='<strong-password>' npm run server

VITE_DEV_HOST=100.64.0.10 HAMLOG_ALLOW_EXTERNAL_DEV=true \
  VITE_DEV_API_TARGET=http://100.64.0.10:4000 \
  JWT_SECRET='<random-secret>' ADMIN_PASSWORD='<strong-password>' npm run dev
```

`npm run dev -- --host 0.0.0.0`처럼 CLI로 호스트를 덮어써도 위 안전 검사를 우회할 수 없습니다.

### 3) Build
```bash
npm run build
```

### 4) Test
```bash
npm run test
```

### 5) Data Integrity Check
`posts.json` 인덱스와 `server/data/posts/*.json` 개별 글 파일이 서로 맞는지 확인합니다.

```bash
npm run verify:data
```

## Dependency Security

- `sharp`는 `0.35.5` 이상과 보안 수정된 `libheif 1.23.2`, `librsvg 2.63.2` 이상을 사용합니다. AVIF·SVG 디코딩과 WebP 변환, 실제 Docker 런타임의 디코더 버전을 회귀 테스트로 확인합니다.
- ESLint의 개발 의존성인 `js-yaml`은 잠금 파일에서 빈 매핑 병합의 자원 제한이 수정된 `4.3.2`를 사용합니다.
- Tiptap 패키지는 보안 수정이 포함된 `3.31.3`으로 버전을 통일합니다. 업그레이드할 때는 에디터와 서버 HTML 렌더러를 함께 검증해야 합니다.
- Express 4와 body-parser가 사용하는 `qs`는 `overrides`로 `6.16.0`을 사용합니다. 상위 패키지에서 수정 버전을 지원하기 전까지 이 설정을 유지합니다.
- Axios와 DOMPurify의 최소 버전을 각각 `1.20.0`, `3.4.16`으로 올리고, 잠금 파일의 Undici·ip-address·brace-expansion도 보안 수정 버전으로 갱신합니다. 운영 의존성과 개발 의존성을 포함한 `npm audit`를 함께 확인합니다.
- DOMPurify의 최소 버전을 `3.4.17`로 올리고, 잠금 파일의 body-parser `1.20.9`, follow-redirects `1.16.2`, Undici `7.30.1`, ip-address `10.7.5`도 보안 수정 버전으로 갱신합니다. 각 패키지를 실제로 사용하는 상위 패키지 기준으로 해석한 버전을 회귀 테스트로 확인합니다.
- `@tiptap/html`의 서버 렌더러가 사용하는 Happy DOM은 [import alias 코드 실행 취약점](https://github.com/advisories/GHSA-834v-8h66-3h79)이 `21.0.4`에서만 수정되어 `overrides`로 고정합니다. Tiptap의 peer 범위(`^20.8.9`) 밖이므로 Tiptap을 올릴 때 이 고정이 아직 필요한지 확인하고 서버 렌더러 테스트를 함께 실행합니다.
- KaTeX는 `0.18.2` 이상을 사용하고 `overrides`로 Mermaid에도 같은 버전을 적용합니다. 잠금 파일의 `proxy-addr`도 `2.0.8` 이상으로 유지하여 IPv4-mapped IPv6 신뢰 주소 검사를 보호합니다.
- 개발 도구의 `braces`에는 [중첩 패턴 처리 취약점](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)이 있으며 현재 수정 버전이 없습니다. Tailwind CSS 3의 개발 의존성이므로 전체 감사에는 경고가 남습니다. 자동 `npm audit fix --force`는 Tailwind CSS 4 전환을 요구하므로 별도로 호환성을 검증해야 합니다.
- Tiptap 3의 표·다단 메뉴는 Floating UI를 사용합니다. `tippy.js`는 자체 슬래시 명령 메뉴에서 여전히 필요합니다.
- 의존성 변경 후 `npm ci`, `npm audit`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`를 실행합니다. 보안 회귀 테스트는 `server/tests/dependency-security.test.js`에 포함되어 있습니다.

## 에디터 저장·복구 동작

- 입력 내용은 약 1초 후 현재 브라우저에 임시 저장됩니다. 탭이 숨겨지거나 페이지를 떠날 때도 마지막 입력을 즉시 보관하며 서버 저장·발행은 자동 실행하지 않습니다.
- 상단에는 핵심 저장 상태만 표시하고, `저장 상태 상세`를 펼치면 브라우저 임시 저장 상태와 서버 저장 시각을 각각 확인할 수 있습니다. 브라우저 복구본이 있으면 복구 또는 삭제를 선택하기 전 서버 저장을 막아 확인하지 않은 사본을 보호합니다.
- `집중 모드`는 관리자 헤더와 글 목록·설정 패널을 숨겨 작성 공간을 넓힙니다. 입력 내용과 기존 패널 설정은 유지하며, 같은 버튼으로 해제할 수 있습니다.
- 브라우저 임시 저장본에는 편집의 기준이 된 서버 저장 버전도 함께 보관합니다. 복구 후 서버에 저장할 때 원래 기준 버전으로 충돌을 확인하며, 기준 버전이 없는 예전 임시 저장본은 서버 저장 전에 덮어쓰기 여부를 명시적으로 확인합니다.
- 서버 저장 중 추가한 입력은 그대로 남으며, 저장된 부분과 아직 저장되지 않은 변경을 구분합니다. 새 글이 서버 ID를 받은 경우 추가 입력을 새 ID의 임시 저장본에 먼저 복사한 뒤 이전 키를 정리합니다.
- 반복 저장·삭제 단축키는 요청 하나로 제한합니다. 글 전환 후 늦게 도착한 응답과 저장 이전에 시작한 목록 조회가 현재 편집본·목록을 되돌리지 않게 합니다. 초안의 기준 버전은 단순 목록 새로고침으로 변경하지 않습니다.
- 기존 글 수정 API는 `expectedUpdatedAt` 문자열을 필수로 요구합니다. 누락·잘못된 타입은 428, 현재 저장 버전과 불일치는 409로 거부하며, 글 생성은 이 값을 요구하지 않습니다.
- 기존 글은 본문 전체를 확인하기 전 편집을 열지 않습니다. 로딩 실패와 없는 글을 구분하고, 재시도할 때 요청한 글 주소를 유지합니다. 이미 편집 중인 글은 백그라운드 목록 오류로 초기화하지 않습니다.
- 글을 열거나 테마를 전환할 때 에디터의 초기 정규화를 사용자 수정으로 기록하지 않습니다. 표·다단 레이아웃 메뉴는 본문이나 메뉴에 포커스가 있을 때 표시하며 키보드 조작과 실행 취소를 지원합니다.
- 저장 중 인증이 만료되면 관리자 섹션과 글 ID를 유지한 채 재인증합니다. 기존 브라우저 복구본은 계속 보존하며 자동으로 서버에 덮어쓰지 않습니다.
- 자기소개 저장도 요청 이후 입력한 필드와 소셜·표시 설정을 보존합니다. 저장된 부분과 아직 저장하지 않은 변경을 구분하고 임시 초안에도 최신 입력을 유지합니다.
- 카테고리 이름 변경·삭제로 글이 재분류되면 해당 글의 저장 버전도 갱신합니다. 다른 탭의 오래된 편집본이 이전 카테고리를 되살리지 않도록 충돌 검사합니다.

### 글 휴지통

- 글 삭제는 즉시 영구삭제하지 않고 휴지통으로 이동합니다. 공개 화면·검색·RSS·사이트맵에서 제외되지만 서버에 저장된 본문·댓글·조회수·수정 이력·이미지는 보존합니다. 저장하지 않은 입력은 서버 복원본에 포함되지 않습니다.
- 관리자 글 목록 아래의 `휴지통 열기`에서 복원할 수 있습니다. 복원된 글은 예약 발행을 해제한 **비공개 초안**이며, URL은 그대로 유지됩니다. 휴지통에 있는 동안 같은 URL을 다른 글에 사용할 수 없습니다.
- 휴지통은 자동으로 비우지 않습니다. 영구삭제는 휴지통에서 글 제목을 정확히 입력해야 하며 본문·댓글·조회수·수정 이력을 제거합니다. 이미지는 별도의 미사용 이미지 정리에서 관리합니다.
- 휴지통 복원·영구삭제는 삭제 시점 버전을 확인하므로 다른 탭에서 이미 복원하거나 다시 삭제한 글에 오래된 작업을 적용하지 않습니다. 휴지통 데이터도 기존 데이터 백업·검증 대상에 포함됩니다.
- 영구삭제 요청은 데이터 디렉터리의 `post-deletions/`에 먼저 기록합니다. 댓글·조회수·이력·글 파일 정리가 중단되면 휴지통에 미완료 상태가 남고 복원은 차단됩니다. 제목 확인 후 재시도하거나 서버 재시작 시 남은 정리를 이어서 처리합니다. 완료 전에는 이전 URL도 계속 예약됩니다.
- 무결성 검사는 미완료 영구삭제를 별도로 알립니다. 이 상태에서 백업·배포 검증이 중단되면 저장소 오류를 해결한 뒤 정리를 완료하고 다시 검증해야 합니다.
- 저장 이력은 보관된 최근 최대 25개를 펼쳐 볼 수 있습니다. 선택한 저장본의 텍스트와 현재 초안의 문단·메타데이터 차이를 확인한 뒤 명시적으로 복구합니다. 복구 API도 `expectedUpdatedAt`을 요구하며 누락은 428, 충돌은 409입니다.
- 긴 글의 목차는 변경 구간을 반영하고, 같은 문서의 HTML·JSON 변환 결과는 재사용합니다. 저장·미리보기에는 지연된 초안이 아닌 현재 입력을 사용합니다.

### 댓글 관리

- 관리자 `댓글 관리`에서 전체·숨긴 댓글·숨기지 않은 댓글을 페이지별로 확인합니다. 비공개 글과 휴지통의 댓글도 확인할 수 있습니다.
- 숨김은 되돌릴 수 있고 방문자에게는 표시되지 않습니다. 관리자 영구삭제는 별도의 확인을 거치며 작성자 비밀번호를 요구하지 않습니다. 기존 방문자 본인 삭제는 비밀번호 방식 그대로 유지됩니다.
- 관리 API는 인증·변경 요청 출처·댓글 버전을 확인합니다. 비밀번호와 해시는 응답에 포함하지 않습니다. 상태가 바뀌거나 작업 결과를 확인할 수 없으면 최신 목록을 확인한 뒤 다시 작업합니다.

### 글 주소와 독자 탐색

- 글 주소를 바꾸면 이전 슬러그를 보관합니다. 공개 글의 이전 주소는 현재 주소로 영구 리디렉션하며, 비공개·예약 전·휴지통 글의 대상 주소는 공개하지 않습니다. 과거 주소는 다른 글에서 사용할 수 없고, 영구삭제가 완료되면 해제됩니다.
- 검색은 제목 일치를 본문 일치보다 우선하며, 일치 수준이 같으면 발행일과 글 ID로 안정적으로 정렬합니다. 페이지별 결과와 전체 건수·더보기를 제공하고 태그·시리즈 조건을 함께 사용할 수 있습니다.
- 검색 API는 `page` 또는 `pageSize`를 주면 `{posts,total,page,pageSize,hasMore}`를 반환합니다(기본 25, 최대 50). 두 값이 없는 기존 요청은 최대 25건의 배열 응답을 유지합니다.
- 시리즈 목차와 이전·다음 글은 공개된 같은 시리즈의 글을 발행일 순으로 연결합니다. 태그·시리즈·카테고리 링크의 특수문자는 URL에 안전하게 인코딩합니다.

## Environment Variables

Cloudflare Access 로그인 통합은 [설정 가이드](docs/cloudflare-access.md)를 참고하세요.
기본 인증 방식은 비밀번호이며, 운영 전환은 Access 경로·정책 확인 후 명시적으로 활성화합니다.

### Backend (`server`)
- `PORT` (default: `4000`)
- `HOST` (optional)
  - 개발 기본값은 `127.0.0.1`, production 기본값은 컨테이너 내부 통신을 위한 `0.0.0.0`
- `HAMLOG_ALLOW_EXTERNAL_DEV` (optional, default: `false`)
  - production이 아닌 서버를 loopback 밖에 열 때만 `true`로 지정
  - 이 경우 기본값이 아닌 `JWT_SECRET`, `ADMIN_PASSWORD`도 반드시 필요
- `APP_VERSION` (optional)
  - `/api/health`에 노출할 배포 버전. 운영 GitHub Actions는 커밋 SHA 앞 7자를 자동 주입합니다.
- `HAMLOG_DATA_DIR` (optional, default: `server/data`)
  - JSON 저장 경로. 테스트는 실제 데이터를 보호하기 위해 `.tmp` 경로로 재지정합니다.
- `HAMLOG_UPLOAD_DIR` (optional, default: `server/uploads`)
  - 업로드 파일 저장 경로
- `JWT_SECRET`
  - production에서는 **필수**
- `ADMIN_PASSWORD`
  - production에서는 **필수**
- `ANALYTICS_SECRET` (optional)
  - 익명 방문자 식별자를 HMAC 처리하는 별도 비밀값. 미설정 시 `JWT_SECRET`을 사용합니다.
  - 값을 바꾸면 기존 방문자는 새 방문자로 집계되므로 운영 중에는 고정하는 것을 권장합니다.
- `ANALYTICS_TIME_ZONE` (optional, default: `Asia/Seoul`)
  - 오늘·일별 방문 통계의 날짜 기준 시간대
- `CORS_ORIGINS` (optional)
  - 허용할 Origin 목록을 콤마(`,`)로 구분
  - 예: `https://hamlog.com,https://www.hamlog.com`
- `RATE_LIMIT_LOGIN_MAX` (optional, default: `10`)
- `RATE_LIMIT_UPLOAD_MAX` (optional, default: `30`)
- `RATE_LIMIT_PREVIEW_MAX` (optional, default: `120`)
- `RATE_LIMIT_SEARCH_MAX` (optional, default: `180`)
- `RATE_LIMIT_COMMENT_MAX` (optional, default: `20`)
- `RATE_LIMIT_VIEW_MAX` (optional, default: `240`)
- `RATE_LIMIT_ANALYTICS_MAX` (optional, default: `1200`)
- `RATE_LIMIT_ANALYTICS_PUBLIC_MAX` (optional, default: `120`)
- `TRUST_PROXY` (optional, default: `0`)
  - Express 앞에 신뢰할 수 있는 reverse proxy가 있을 때만 hop 수 또는 IP/subnet을 지정
  - 예: 프록시가 정확히 한 단계면 `1`, 직접 노출이면 `0`
- `GOOGLE_SITE_VERIFICATION` (optional)
  - Search Console의 HTML 태그 인증을 사용할 때 메타 태그 content 값
  - 예: Search Console이 `<meta name="google-site-verification" content="abc123" />`를 주면 `abc123`
- `NAVER_SITE_VERIFICATION` (optional)
  - 네이버 서치어드바이저 HTML 태그 인증의 content 값
- `DAUM_SITE_VERIFICATION` (optional)
  - 다음/카카오 검색 등록에서 HTML 메타 태그 인증을 사용할 때의 content 값
- `DAUM_WEBMASTER_PIN` (optional)
  - 다음 웹마스터도구 PIN 인증을 사용할 때 `/robots.txt`에 `DaumWebMasterTool: <PIN>` 형식으로 노출
- `COOKIE_SAME_SITE` (optional: `lax`, `strict`, `none`)
  - 미설정 시 `CORS_ORIGINS`가 있으면 `none`, 아니면 `lax`
- `COOKIE_SECURE` (optional: `true`, `false`)
  - 미설정 시 HTTPS 요청 또는 `SameSite=None`일 때 `true`

관리자 프론트엔드와 API가 서로 다른 Origin에 있다면 `CORS_ORIGINS`를 반드시 설정해야 하며,
대부분의 경우 쿠키는 `SameSite=None; Secure`가 필요합니다. 현재 서버는 이 경우를 자동으로 맞추도록 되어 있습니다.
같은 Origin에서 `http://<ip>:4000/admin`처럼 직접 접속하는 환경은 기본적으로 `Secure`를 끄고 동작합니다.

### Frontend (`vite`)
- `VITE_API_BASE_URL` (optional)
  - 기본값은 `'/api'`이며, dev에서는 Vite proxy로 백엔드에 연결됩니다.
- `VITE_DEV_HOST` (optional, default: `127.0.0.1`)
  - 외부 주소를 지정하면 `HAMLOG_ALLOW_EXTERNAL_DEV=true`와 기본값이 아닌 관리자 비밀값이 필요
- `VITE_DEV_API_TARGET` (optional, default: `http://127.0.0.1:4000`)
  - 개발 프록시가 연결할 API 주소

## Visitor Analytics

공개 홈과 포스트 페이지는 1년 유효의 `HttpOnly` 익명 방문자 쿠키를 사용합니다. 원본 쿠키 ID와
IP는 통계 파일에 저장하지 않고, 서버 비밀값으로 만든 HMAC과 집계 수치만 저장합니다. 일별 데이터는
최근 90일을 보관하며 누적 방문자와 페이지뷰는 계속 유지합니다.

실시간 접속자는 화면이 활성화된 동안 전송되는 30초 heartbeat를 기준으로 최근 90초 이내 방문자를
계산합니다. 이 presence 정보는 프로세스 메모리에 있으므로 서버 재시작 때 초기화되고, 여러 서버
인스턴스 사이에서는 공유되지 않습니다.

공개 화면의 상단 네비게이션에는 누적 방문자와 실시간 접속자만 표시합니다. 오늘 수치와 페이지뷰,
최근 7일 내역은 인증된 관리자 대시보드에서만 조회할 수 있습니다.

## Editor Guide (Admin)
### Shortcuts
- 저장: `Ctrl/Cmd+S`
- 초안 저장: `Ctrl/Cmd+Shift+S`
- 발행 설정 열기: `Ctrl/Cmd+Enter`
- 미리보기 토글: `Alt+Shift+P`

본문에서 `/`를 입력하거나 툴바의 `/` 버튼을 누르면 수식, Mermaid 다이어그램, 유튜브, 링크 카드,
표와 2·3단 레이아웃 같은 고급 블록을 삽입할 수 있습니다.

### Autosave
편집 중 자동 저장본이 남아있으면 관리자 화면에서 **복구/삭제**가 가능합니다.

### Image Cleanup Safety
관리자의 **이미지 정리**는 저장된 글·수정 이력·프로필뿐 아니라 현재 초안과 같은 브라우저의
임시 저장본에서 참조하는 이미지도 보호합니다. 최근 24시간 이내 업로드는 정리 대상에서 제외하며,
삭제할 파일은 직접 선택해야 합니다. 삭제 직전에 참조를 다시 확인하고 글·프로필 저장과 순서를 조정합니다.
참조 데이터나 브라우저 임시 저장본을 읽지 못하면 안전을 위해 정리를 중단합니다.

다른 기기에만 남아 있는 미저장 초안은 확인할 수 없습니다. 정리 전 다른 기기의 글도 먼저 저장하세요.
업로드 도중 취소된 파일도 보호기간이 지난 뒤 미사용 이미지 목록에서 정리할 수 있습니다.

### SEO Description Consistency
공개 상세 API와 최초 HTML은 서버에서 계산한 읽기 전용 `metaDescription`을 전달합니다.
브라우저의 검색·공유 메타 태그와 구조화 데이터도 같은 값을 사용하며,
직접 입력한 SEO 설명을 우선합니다. 짧은 글 요약은 본문으로 보충하되 원본 요약은 변경하지 않습니다.

## TOC Placement (Post Page)
본문의 `h1/h2/h3`를 기준으로 목차를 만듭니다. 1536px 미만 화면에서는 본문 위의 접이식 목차를,
`2xl` 이상에서는 우측 고정 목차를 표시합니다. 제목이 없는 글에는 목차를 표시하지 않습니다.
절을 선택하면 URL 해시와 키보드 포커스가 이동하며, 링크 공유·새로고침·뒤로/앞으로 이동을 지원합니다.
최초 HTML과 브라우저가 같은 절 ID를 사용하고, 중복 제목은 고유 ID로 구분합니다.

## Public Search
홈 검색은 제목·요약·태그·시리즈·카테고리뿐 아니라 본문의 실제 텍스트도 검색합니다.
검색 결과에는 본문 전체 대신 일치한 부분의 짧은 발췌를 표시합니다. 하위 카테고리·태그·시리즈
필터를 먼저 적용하고 제목 일치 수준, 발행일, 글 ID 순으로 정렬합니다. 기본 25편씩 더보기로
탐색하며, 비공개 글과 아직 공개되지 않은 예약 글·휴지통 글은 제외합니다.

검색어(`q`)와 카테고리·태그·시리즈·불러온 페이지 수는 URL에 보존되어 글을 읽은 뒤 돌아오거나 새로고침해도 유지됩니다.
입력 요청은 250ms 지연하고 한글 조합이 끝난 뒤 실행하며, 이전 검색 요청은 취소합니다.
검색 실패 시 재시도를 제공하고 결과 없음과 구분합니다. 검색 조건·목차 해시 변경은 별도 방문으로 집계하지 않습니다.

## Docker
### docker-compose (추천)
```bash
docker compose up -d --build
```

`docker-compose.yml`은 아래를 볼륨으로 마운트합니다.
- `./server/data:/app/server/data`
- `./server/uploads:/app/server/uploads`

환경변수는 `.env`를 사용합니다. (`docker-compose.yml`)
`.env.example`을 복사한 뒤 `JWT_SECRET`, `ADMIN_PASSWORD`를 반드시 변경해야 합니다.
운영 컨테이너는 두 값이 없으면 시작하지 않습니다.
컨테이너 프로세스는 root가 아닌 Node 사용자로 실행되며, 호스트의 4000번 포트는 기본적으로
`127.0.0.1`에만 열립니다. 같은 호스트의 reverse proxy가 아닌 곳에서 직접 연결해야 하는 명확한
이유가 있을 때만 `.env`의 `HAMLOG_BIND_ADDRESS`를 변경합니다. GitHub Actions 운영 배포는 같은
이름의 Repository Variable을 사용합니다.
Compose는 앱 실행 전에 마운트 권한을 제한적으로 준비합니다. 호스트 기본 그룹 ID가 1000이 아니면
`.env`의 `HAMLOG_DATA_GID`를 `id -g` 결과로 설정합니다.

`bash scripts/setup-server.sh`로 수동 재배포할 때도 기존 `hamlog` 컨테이너가 있으면 중단 전에
데이터를 검증하여 백업합니다. 기본 백업 위치는 `$HOME/hamlog-backups`, 보관 기간은 30일이며
`HAMLOG_BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `HAMLOG_BACKUP_HOOK`으로 기존 백업 정책을 그대로
지정할 수 있습니다. 데이터가 완전히 비어 있는 최초 설치만 `HAMLOG_ALLOW_EMPTY_BACKUP=true`를
명시해야 하며, 백업이나 검증이 실패하면 기존 컨테이너를 건드리지 않고 배포를 중단합니다.

파일 저장소의 쓰기 잠금은 단일 Node.js 프로세스 안에서만 유효합니다. 여러 컨테이너나
여러 호스트가 동시에 쓰는 구성에는 SQLite/PostgreSQL 같은 공유 데이터베이스를 사용해야 합니다.

## CI/CD (GitHub Actions)
`.github/workflows/docker-deploy.yml`
- `main` push 시 Docker 이미지를 빌드하여 GHCR에 업로드
- Self-Hosted Runner가 운영 서버에서 최신 이미지를 pull/run (포트 4000)
- 배포 전 `$HOME/hamlog-data`를 `$HOME/hamlog-backups`에 백업하고 30일간 보관
- 매일 03:17(KST)에 같은 백업을 실행하고 30일간 보관
- 운영 데이터 무결성, 압축 목록, SHA-256 재검증 중 하나라도 실패하면 백업과 배포를 중단
- 새 컨테이너의 로컬 및 `SITE_URL` 공개 헬스 응답에서 커밋 버전을 확인
- 헬스체크 실패 시 직전 Docker 이미지로 자동 롤백
- 컨테이너 로그는 파일당 10MB, 최대 3개로 회전
- GitHub 호스티드 러너가 15분마다 홈·헬스 API를 외부에서 점검

외부 점검 주소를 바꾸려면 Repository Variable `PUBLIC_SITE_URL`을 설정합니다.
미설정 시 `https://tech.hamwoo.co.kr`을 사용합니다.

## Backup and Restore

운영 배포는 데이터와 업로드를 잠시 멈춘 뒤 일관된 `tar.gz` 백업과 SHA-256 체크섬을 생성합니다.
수동 백업도 같은 스크립트를 사용할 수 있습니다.

```bash
BACKUP_RETENTION_DAYS=30 \
  HAMLOG_VERIFY_DATA=true \
  bash scripts/backup-data.sh "$HOME/hamlog-data" "$HOME/hamlog-backups"
```

데이터 디렉터리가 없거나 비어 있으면 기본적으로 실패합니다. 완전한 최초 설치를 확인한 경우에만
`HAMLOG_ALLOW_EMPTY_BACKUP=true`를 명시할 수 있습니다.

복구는 기존 데이터 위에 압축을 덮어풀지 않고 아래 스크립트로 수행합니다. 백업 이후 생긴 글 파일이나
영구삭제 요청이 남으면 복구한 글이 다시 삭제될 수 있으므로 `data/`와 `uploads/`를 함께 교체합니다.
실행 전 같은 서버의 배포·예약 백업 작업을 중단하여 복구 중 다른 작업이 데이터를 변경하지 않게 합니다.

```bash
bash scripts/restore-data.sh \
  "$HOME/hamlog-backups/hamlog-YYYYMMDDTHHMMSSZ-SHA.tar.gz" \
  "$HOME/hamlog-data"
```

아카이브 옆의 같은 이름에 `.sha256`을 붙인 체크섬 파일이 필요합니다. 스크립트는 아카이브 사본의
체크섬과 항목 경로를 확인하고 새 디렉터리에 해제한 뒤 데이터 무결성을 검증합니다. 두 최상위 디렉터리가
모두 있는 백업만 복구하며, 경로 이탈·심볼릭 링크·하드 링크·특수 파일·중복 항목은 거부합니다.
호스트에는 Bash, GNU tar, SHA-256 도구와 UTF-8 로케일(`C.UTF-8`)이 필요하며, 무결성 검증은
호스트 Node.js 또는 기존 컨테이너 이미지의 Node.js를 사용합니다.

기본 대상 컨테이너는 `hamlog`이며 `HAMLOG_CONTAINER_NAME`으로 변경할 수 있습니다. 컨테이너의
데이터 마운트 경로가 복구 대상과 일치하는지 확인한 후, 실행 중인 컨테이너를 중지하고 두 디렉터리를
교체하여 다시 시작합니다. 재시작·헬스 확인·교체가 실패하거나 종료 신호를 받으면 기존 디렉터리와
원래 실행 상태를 복구합니다. 이미 중지된 컨테이너는 복구 후에도 중지 상태를 유지합니다.
컨테이너가 만든 디렉터리의 소유권과 권한을 보존하기 위해, Docker 복구는 대상 경로만 연결한
보조 컨테이너에서 원자적으로 이동합니다. 보조 작업의 종료를 확인한 후에만 롤백하며, Docker 장애로
종료를 확인할 수 없으면 `.hamlog-restore-lock`을 유지합니다. 이 경우 `hamlog.restore.id` 라벨의
보조 컨테이너가 모두 중지·제거되고 디렉터리 상태가 복구된 것을 확인한 뒤 잠금을 정리합니다.
Docker 없이 복구할 때는 모든 서버 프로세스를 직접 중지한 뒤 `HAMLOG_CONTAINER_NAME=''`으로
실행하며, 이 경우 서버 시작도 직접 수행합니다.

성공해도 이전 데이터는 출력된 `.hamlog-before-restore.*` 디렉터리에 보존합니다. 복구된 사이트를
확인한 뒤 이 디렉터리를 별도로 보관하거나 삭제합니다. 교체가 실패하면 새 스냅샷도
`.hamlog-restore.*`에 남기므로 오류 메시지의 경로를 확인할 수 있습니다. 서버와 디스크가 강제로 종료되어
자동 복구가 실행되지 않았다면, 서버를 중지한 상태에서 보존된 두 디렉터리를 확인하여 수동 복구합니다.

이 백업은 동일 호스트의 배포·데이터 손상 복구용입니다. 호스트 장애에 대비하려면
`$HOME/hamlog-backups`를 별도의 암호화된 오브젝트 스토리지나 백업 서버로 동기화해야 합니다.

저장소는 특정 외부 공급자로 데이터를 보내지 않습니다. 오프사이트 저장소와 자격 증명을 선택한 뒤,
self-hosted runner에 아래 계약을 따르는 실행 파일을 설치하고 Repository Variable
`HAMLOG_BACKUP_HOOK`에 그 **절대 경로**를 지정할 수 있습니다.

```text
backup-hook /absolute/path/hamlog-....tar.gz /absolute/path/hamlog-....tar.gz.sha256
```

훅은 업로드와 원격 체크섬 확인까지 성공했을 때 0을 반환해야 합니다. 설정된 훅이 없으면 외부 전송은
일어나지 않으며, 훅이 실패하면 로컬 백업은 보존되지만 해당 백업·배포 작업은 실패 처리됩니다.

## Recommended Branch Protection

GitHub의 `main`과 `develop`에 다음 보호 규칙을 적용하는 것을 권장합니다.

- Pull Request를 통한 변경만 허용
- 병합 전 최신 CI 상태 검사 필수
- 강제 푸시와 브랜치 삭제 금지
- `main`은 운영 환경 승인 또는 지정 관리자 병합만 허용
