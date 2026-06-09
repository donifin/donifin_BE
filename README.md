# 돈이FIN - Backend

> Firebase 클라우드 함수 기반 서버리스 백엔드
> 금융 정보 통합 + AI 맞춤 추천 모바일 앱(Android·Web)의 API 서버

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 클라우드 함수 | Firebase Cloud Functions (Node.js 24, 서버리스) |
| 인증 | Firebase Authentication (이메일 · Google · Kakao) |
| DB | Supabase (PostgreSQL) |
| AI | OpenAI API (gpt-4o-mini) |
| 예금·적금 | 금융감독원 finlife API |
| 기준금리 | 한국은행 ECOS API |
| 환율 | 한국수출입은행 EXIM API |
| 주식 | Yahoo Finance API |
| 뉴스 | 네이버 뉴스 API |

---

## 프로젝트 구조

```
donifin_BE/
├── firebase.json          # 에뮬레이터 포트 설정
├── .firebaserc            # Firebase 프로젝트 연결
├── .gitignore
└── functions/
    ├── index.js           # 모든 클라우드 함수 진입점 (export)
    ├── config.js          # 클라이언트 초기화 · CORS · 공통 함수
    ├── mockData.js        # API 키 없을 때 사용하는 테스트 데이터
    ├── logos.js           # 은행/종목 로고 URL 매핑
    ├── products.js        # 예금/적금 검색
    ├── chatbot.js         # AI 챗봇 (프로필 + 성향 반영)
    ├── personality.js     # 성향 테스트 (12문항, AI 판정)
    ├── news.js            # 환율/주식/뉴스/금리 + 통합검색
    ├── community.js       # 게시글/댓글 CRUD
    ├── likes.js           # 게시글/댓글 좋아요 + 북마크 토글
    ├── notifications.js   # 알림 목록/읽음 처리
    ├── quiz.js            # 일일 OX 금융 퀴즈 (AI 생성)
    ├── profile.js         # 프로필 저장 (upsert)
    ├── kakaoAuth.js       # 카카오 로그인 (Custom Token)
    ├── deleteAccount.js   # 회원 탈퇴 (DB + Auth 전체 삭제)
    ├── package.json
    └── .env               # API 키 (절대 GitHub에 올리지 말 것!)
```

---

## 팀원 초기 세팅 가이드

### 1. 필수 프로그램 설치

```bash
node --version                  # Node.js (없으면 https://nodejs.org)
npm install -g firebase-tools   # Firebase CLI
firebase login                  # 구글 계정 로그인
```

### 2. 레포 클론 & 패키지 설치

```bash
git clone https://github.com/donifin/donifin_BE.git
cd donifin_BE
git checkout develop
cd functions
npm install
```

### 3. `.env` 파일 생성

`functions/.env` 파일을 직접 만들고 아래 형식으로 작성
**(API 키는 카톡방에 공유, 절대 GitHub에 올리지 말 것!)**

```
OPENAI_API_KEY=받은_키_입력
FSS_API_KEY=받은_키_입력            # 금융감독원 finlife
NAVER_CLIENT_ID=받은_키_입력
NAVER_CLIENT_SECRET=받은_키_입력
ECOS_API_KEY=받은_키_입력           # 한국은행 (기준금리)
EXIM_API_KEY=받은_키_입력           # 한국수출입은행 (환율)
SUPABASE_URL=받은_URL_입력
SUPABASE_KEY=받은_키_입력           # anon 키
SUPABASE_SERVICE_KEY=받은_키_입력   # service_role 키 (탈퇴 시 RLS 우회용)
```

> **API 키가 없는 경우**: 해당 키를 비워두면 자동으로 테스트 데이터(mock)로 동작합니다.
> Yahoo Finance(주식)는 별도 키 없이 동작합니다.

### 4. 로컬 에뮬레이터 실행

```bash
# donifin_BE 루트 폴더에서 실행
firebase emulators:start
```

접속 주소:
- 클라우드 함수: `http://localhost:5001`
- Auth 에뮬레이터: `http://localhost:9099`
- 에뮬레이터 UI: `http://localhost:4000`

### 5. 배포 (Blaze 플랜 필요)

```bash
firebase deploy --only functions               # 전체 배포
firebase deploy --only functions:chatBot       # 특정 함수만 배포
```

---

## API 엔드포인트

> 로컬 에뮬레이터 base URL: `http://localhost:5001/donifin/us-central1`
> 운영(배포) base URL: `https://us-central1-donifin.cloudfunctions.net`

### 인증

#### `POST /kakaoLogin` — 카카오 로그인

```json
// 요청
{ "access_token": "카카오 SDK로 받은 토큰" }
// 응답
{ "firebase_token": "Custom Token", "uid": "...", "nickname": "..." }
```
> 클라이언트는 받은 `firebase_token`으로 `signInWithCustomToken` 호출.
> 카카오 ID는 UUID v5로 변환해 고정 uid 생성 (재로그인 시 동일 유저).

#### `POST /deleteAccount` — 회원 탈퇴

```json
// 요청
{ "user_id": "Firebase UID" }
// 응답
{ "success": true }
```
> Supabase 전체 데이터(프로필·글·댓글·좋아요·북마크·알림) + Firebase Auth 계정을 모두 삭제.
> service_role 키로 RLS 우회, Admin SDK로 Auth 계정 강제 삭제.

---

### 금융 상품

#### `GET /getProducts` — 예금/적금 상품 검색

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `type` | 선택 | `deposit`(예금) / `saving`(적금) / 없으면 둘 다 |
| `term` | 선택 | `6` / `12` / `24` / `36` (개월) |
| `sort` | 선택 | `high`(금리 높은 순, 기본값) / `low` |

```
GET /getProducts?type=deposit&term=12&sort=high
```

---

### AI 챗봇

#### `POST /chatBot` — AI 금융 챗봇

```json
// 요청 body
{
  "user_id": "유저ID (선택 - 있으면 프로필 기반 맞춤 답변)",
  "message": "나한테 맞는 적금 추천해줘",
  "history": [
    { "role": "user", "content": "이전 질문" },
    { "role": "assistant", "content": "이전 답변" }
  ],
  "personality": {
    "type": "목돈 마련형",
    "description": "성향 설명 (선택 - 있으면 성향 반영 추천)"
  }
}
// 응답
{ "reply": "AI 답변 내용" }
```
> 최근 10개 대화(history)로 맥락 유지. 성향(personality) 전달 시 해당 성향에 맞는 상품 우선 추천.
> 실제 금감원 상품 데이터 내에서만 추천 (AI가 상품 창작 불가).

---

### 성향 테스트

#### `GET /getPersonalityQuestions` — 성향 테스트 질문 목록

```json
// 응답
{
  "questions": [
    { "id": 1, "question": "나는 저축할 때 원금을 잃지 않는 것이 가장 중요하다." }
    // ... 총 12문항
  ],
  "scale": {
    "1": "전혀 그렇지 않다", "2": "그렇지 않다", "3": "보통이다",
    "4": "그렇다", "5": "매우 그렇다"
  }
}
```

#### `POST /personalityTest` — 성향 테스트 결과 분석

```json
// 요청 body (각 질문에 1~5점 척도 답변)
{
  "user_id": "유저ID (선택 - 있으면 나이 기반 상품 필터)",
  "answers": [1, 5, 3, 4, 2, 5, 1, 3, 4, 2, 5, 1]
}
// 응답
{
  "type": "목돈 마련형",
  "description": "성향 설명 (AI 생성)",
  "products": [ /* 추천 상품 최대 3개 */ ]
}
```

성향 유형 4가지:
- `단기 안전형` — 6개월 이하 정기예금 추천
- `장기 안전형` — 2년 이상 정기예금 추천
- `소액 저축형` — 자유적립식 적금 추천
- `목돈 마련형` — 1년 이상 고금리 적금 추천

> AI는 성향 **판정**만, 상품 **추천**은 유형별 규칙 기반 필터링 (정확성·일관성 확보).

---

### 금융 뉴스 · 시세

#### `GET /getNews` — 주요지수 / 주식 / 상승TOP5 / 환율 / 경제뉴스 / 금리

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `category` | 선택 | `주요지수` / `주식` / `상승TOP5` / `환율` / `경제뉴스` / `금리` / 없으면 전체 |
| `region` | 선택 | `국내`(기본) / `해외` — `category=주식`일 때만 |
| `keyword` | 선택 | 경제뉴스 검색어 (기본 "경제", 금융 키워드 자동 필터링) |

```
GET /getNews                          ← 전체 반환
GET /getNews?category=주요지수          ← 코스피/코스닥/S&P500/나스닥
GET /getNews?category=주식&region=해외  ← 해외 인기 종목
GET /getNews?category=상승TOP5          ← 등락률 TOP 5 (18종목 풀)
GET /getNews?category=경제뉴스&keyword=금리
```

> - 환율: 한국수출입은행 매매기준율 (평일 오전 11시경 갱신, 5분 캐시)
> - 주식: Yahoo Finance 실시간 (캐시 없음)
> - 뉴스: 기사 og:image 썸네일 자동 추출

#### `GET /searchAll?keyword=삼성` — 통합 검색

종목(이름/티커) + 환율(통화 코드/한글명) + 뉴스를 한 번에 검색.

```json
{
  "keyword": "삼성",
  "stocks": [ { "name": "삼성전자", "price": "...", "chart": [...] } ],
  "exchange": [],
  "news": [ { "title": "...", "link": "...", "image_url": "..." } ]
}
```

---

### 커뮤니티

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/getCommunityPosts` | GET | 게시글 목록 (`page`, `limit`) |
| `/getPost?id=xxx` | GET | 게시글 단건 조회 (작성자 프로필 포함) |
| `/createPost` | POST | 글 작성 `{ user_id, title, content }` |
| `/updatePost` | POST | 글 수정 `{ id, user_id, title, content }` (본인만) |
| `/deletePost` | POST | 글 삭제 `{ id, user_id }` (본인만, 댓글 동반 삭제) |
| `/getComments?post_id=xxx` | GET | 댓글 목록 |
| `/createComment` | POST | 댓글 작성 `{ post_id, user_id, content }` |
| `/updateComment` | POST | 댓글 수정 `{ id, user_id, content }` (본인만) |
| `/deleteComment` | POST | 댓글 삭제 `{ id, user_id }` (본인만) |

---

### 좋아요 · 북마크

#### `POST /togglePostLike` — 게시글 좋아요 토글

```json
// 요청 { "post_id": "...", "user_id": "..." }
// 응답 { "liked": true, "like_count": 5 }
```
> 좋아요 추가 시 게시글 작성자에게 알림 생성.

#### `POST /toggleCommentLike` — 댓글 좋아요 토글

```json
// 요청 { "comment_id": "...", "user_id": "..." }
// 응답 { "liked": true, "like_count": 3 }
```

#### `POST /togglePostBookmark` — 북마크 토글

```json
// 요청 { "post_id": "...", "user_id": "..." }
// 응답 { "bookmarked": true }
```

---

### 알림

#### `GET /getNotifications?user_id=xxx` — 알림 목록

```json
// 응답
{
  "notifications": [
    { "id": "...", "type": "post_like", "title": "...", "body": "...",
      "target_id": "post-xxx", "read": false, "created_at": "..." }
  ],
  "unread_count": 2
}
```
> 조회 시 오늘의 퀴즈 알림 1일 1회 자동 생성. `target_id`로 화면 이동 (`post-xxx`, `quiz-YYYY-MM-DD`).

#### `POST /markAllNotificationsRead` — 알림 모두 읽음

```json
// 요청 { "user_id": "..." }
// 응답 { "success": true }
```

---

### 일일 퀴즈

#### `GET /getQuiz` — 오늘의 OX 금융 퀴즈

```json
// 응답
{
  "date": "2026-06-09",
  "questions": [
    { "id": 1, "question": "...", "answer": true,
      "explanation": "...", "hint": "...", "hint2": "..." }
    // ... 3문항
  ]
}
```
> AI(gpt-4o-mini)가 날짜별로 생성, 같은 날엔 동일 문제 캐시. 실패 시 폴백 문제 제공.

---

### 프로필

#### `POST /saveProfile` — 유저 프로필 저장 (upsert)

```json
// 요청 body
{
  "user_id": "Firebase UID",
  "name": "홍길동",
  "email": "hong@gmail.com",
  "age": 25,
  "occupation": "직장인",
  "interests": "주식, 게임, 여행",
  "main_bank": "국민은행"
}
// 응답
{ "success": true, "profile": { /* 저장된 프로필 */ } }
```
> 회원가입 시 정보 입력 후 호출. 이미 있으면 업데이트.

---

## Flutter 연동 방법

에뮬레이터 사용 시 PC의 로컬 IP로 연결:

```dart
const baseUrl = 'http://192.168.X.X:5001/donifin/us-central1';
```
> 로컬 IP 확인: Windows `ipconfig` → IPv4 주소

---

## Supabase 테이블 구조

| 테이블 | 설명 |
|--------|------|
| `profiles` | 사용자 정보 |
| `posts` | 커뮤니티 게시글 |
| `comments` | 게시글 댓글 |
| `post_likes` | 게시글 좋아요 |
| `comment_likes` | 댓글 좋아요 |
| `bookmarks` | 게시글 북마크 |
| `notifications` | 알림 |

### profiles

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | Firebase Auth UID |
| `name` | text | 이름 |
| `email` | text | 이메일 |
| `age` | integer | 나이 |
| `occupation` | text | `직장인`, `학생`, `자영업자` 등 |
| `interests` | text | 관심분야 (자유 문자열) |
| `main_bank` | text | 자주 쓰는 은행 |
| `created_at` | timestamptz | 가입일 |

### posts / comments

| 컬럼 (posts) | 타입 |
|------|------|
| `id` | PK |
| `user_id` | 작성자 (profiles.id) |
| `title` · `content` | 제목 · 내용 |
| `category` | 분류 |
| `view_count` | 조회수 |
| `created_at` | 작성일 |

> comments: `id`, `post_id`(FK), `user_id`(FK), `content`, `parent_id`(대댓글), `created_at`

### post_likes / comment_likes / bookmarks

공통 구조: `id` PK, 대상 FK(`post_id` 또는 `comment_id`), `user_id`(text — Firebase UID), `created_at`

### notifications

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | PK | |
| `user_id` | text | 수신자 |
| `type` | text | `post_like` / `comment_like` / `quiz` |
| `title` · `body` | text | 알림 제목 · 내용 |
| `target_id` | text | 이동 대상 (`post-xxx`, `quiz-YYYY-MM-DD`) |
| `read` | bool | 읽음 여부 |
| `created_at` | timestamptz | 생성일 |
