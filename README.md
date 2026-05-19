# 돈이FIN - Backend

> Firebase 클라우드 함수 기반 백엔드  
> 금감원 API + OpenAI API + 네이버 뉴스 API + Supabase 연동

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 클라우드 함수 | Firebase Cloud Functions (Node.js 24) |
| 인증 | Firebase Authentication |
| DB | Supabase (PostgreSQL) |
| AI | OpenAI API (gpt-4o-mini) |
| 금융 데이터 | 금감원 finlife API |
| 환율·금리 | 한국은행 ECOS API |
| 주식 | Yahoo Finance API |
| 뉴스 | 네이버 뉴스 API |

---

## 프로젝트 구조

```
donifin_BE/
├── firebase.json         # 에뮬레이터 포트 설정
├── .firebaserc           # Firebase 프로젝트 연결
├── .gitignore
└── functions/
    ├── index.js          # 모든 클라우드 함수 진입점
    ├── mockData.js       # API 키 없을 때 사용하는 테스트 데이터
    ├── package.json
    └── .env              # API 키 (절대 GitHub에 올리지 말 것!)
```

---

## 팀원 초기 세팅 가이드

### 1. 필수 프로그램 설치

```bash
# Node.js 설치 확인 (없으면 https://nodejs.org 에서 설치)
node --version

# Firebase CLI 전역 설치
npm install -g firebase-tools

# Firebase 로그인 (구글 계정)
firebase login
```

### 2. 레포 클론

```bash
git clone https://github.com/donifin/donifin_BE.git
cd donifin_BE

# 각자 브랜치로 이동
git checkout develop
```

### 3. 패키지 설치

```bash
cd functions
npm install
```

설치되는 패키지:
- `axios` — 외부 API 호출
- `openai` — OpenAI API
- `@supabase/supabase-js` — Supabase DB 연동
- `dotenv` — 환경변수 로드

### 4. .env 파일 생성

`functions/.env` 파일을 직접 만들고 아래 형식으로 작성  
**(API 키는 카톡방에 공유, 절대 GitHub에 올리지 말 것!)**

```
OPENAI_API_KEY=받은_키_입력
FSS_API_KEY=받은_키_입력
NAVER_CLIENT_ID=받은_키_입력
NAVER_CLIENT_SECRET=받은_키_입력
ECOS_API_KEY=받은_키_입력
SUPABASE_URL=받은_URL_입력
SUPABASE_KEY=받은_키_입력
```

> **API 키가 없는 경우**: 해당 키를 비워두면 자동으로 테스트 데이터(mock)로 동작합니다.  
> Yahoo Finance(주식)는 별도 키 없이 동작합니다.

### 5. 로컬 에뮬레이터 실행

```bash
# donifin_BE 루트 폴더에서 실행
firebase emulators:start
```

실행 후 접속 주소:
- 클라우드 함수: `http://localhost:5001`
- Auth 에뮬레이터: `http://localhost:9099`
- 에뮬레이터 UI: `http://localhost:4000`

---

## API 엔드포인트

> 로컬 에뮬레이터 기준 base URL:  
> `http://localhost:5001/donifin/us-central1`

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
  "message": "적금이랑 예금 차이가 뭐야?",
  "history": [
    { "role": "user", "content": "이전 질문" },
    { "role": "assistant", "content": "이전 답변" }
  ]
}
```

```json
// 응답
{ "reply": "AI 답변 내용" }
```

---

### 성향 테스트

#### `GET /getPersonalityQuestions` — 성향 테스트 질문 목록 조회

```json
// 응답
{
  "questions": [
    {
      "id": 1,
      "question": "저축의 주된 목적은 무엇인가요?",
      "options": ["비상금 마련", "단기 목표 달성", "목돈 마련", "노후 준비"]
    }
  ]
}
```

#### `POST /personalityTest` — 성향 테스트 결과 분석

```json
// 요청 body (각 질문의 선택지 인덱스, 0부터 시작)
{
  "answers": [0, 1, 2, 0, 1, 0, 2, 1, 0, 1]
}
```

```json
// 응답
{
  "type": "단기 안전형",
  "description": "성향 설명 (AI 생성)",
  "products": [ /* 추천 상품 최대 3개 */ ],
  "is_mock": false
}
```

성향 유형 4가지:
- `단기 안전형` — 6개월 이하 정기예금 추천
- `장기 안전형` — 2년 이상 정기예금 추천
- `소액 저축형` — 자유적립식 적금 추천
- `목돈 마련형` — 1년 이상 고금리 적금 추천

---

### 금융 뉴스

#### `GET /getNews` — 주요지수 / 주식 / 상승TOP5 / 환율 / 경제뉴스 / 금리

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `category` | 선택 | `주요지수` / `주식` / `상승TOP5` / `환율` / `경제뉴스` / `금리` / 없으면 전체 |
| `region` | 선택 | `국내`(기본) / `해외` — `category=주식`일 때만 |

```
GET /getNews                            ← 전체 반환
GET /getNews?category=주요지수            ← 코스피/코스닥/S&P500/나스닥
GET /getNews?category=주식&region=국내    ← 국내 인기 5종목
GET /getNews?category=주식&region=해외    ← 해외 인기 5종목
GET /getNews?category=상승TOP5            ← 등락률 TOP 5
```

**조회 종목:**
- 주요 지수: 코스피, 코스닥, S&P 500, 나스닥
- 국내 인기: 삼성전자, SK하이닉스, 카카오, NAVER, 현대차
- 해외 인기: 애플, 테슬라, 엔비디아, 마이크로소프트, 구글

**응답 예시 (주요지수):**
```json
{
  "major_indices": [
    {
      "name": "코스피",
      "ticker": "^KS11",
      "region": "국내",
      "price": "2,720",
      "change": "+0.85%",
      "chart": [ { "date": "2026-04-01", "close": 2700 }, ... ]
    }
    // ... 4개
  ]
}
```

---

### 커뮤니티

#### `GET /getCommunityPosts` — 게시글 목록

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `page` | 선택 | 페이지 번호 (기본값: 1) |
| `limit` | 선택 | 페이지당 개수 (기본값: 20) |

응답: `{ posts: [...], total, page, totalPages }`

#### `GET /getPost?id=xxx` — 게시글 단건 조회

```json
// 응답
{ "post": { "id": "...", "title": "...", "content": "...", "user_id": "...", "profiles": { "name": "...", "age": 25 } } }
```

#### `POST /createPost` — 게시글 작성

```json
{ "user_id": "유저ID", "title": "제목", "content": "내용" }
```

#### `POST /updatePost` — 게시글 수정

```json
{ "id": "게시글ID", "user_id": "유저ID", "title": "새 제목", "content": "새 내용" }
```
> 본인 글만 수정 가능. 다른 사용자가 시도하면 403.

#### `POST /deletePost` — 게시글 삭제

```json
{ "id": "게시글ID", "user_id": "유저ID" }
```
> 본인 글만 삭제 가능. 해당 게시글의 댓글도 함께 삭제됨.

#### `GET /getComments?post_id=xxx` — 댓글 목록

#### `POST /createComment` — 댓글 작성

```json
{ "post_id": "게시글ID", "user_id": "유저ID", "content": "댓글 내용" }
```

#### `POST /updateComment` — 댓글 수정

```json
{ "id": "댓글ID", "user_id": "유저ID", "content": "새 댓글 내용" }
```

#### `POST /deleteComment` — 댓글 삭제

```json
{ "id": "댓글ID", "user_id": "유저ID" }
```

---

### 나이·직업별 인기 상품

#### `GET /getPopularProducts` — 인기 상품 TOP 5

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `age` | 선택 | 숫자 (예: `25`) |
| `occupation` | 선택 | `직장인` / `학생` / `자영업자` 등 |

```
GET /getPopularProducts?age=25&occupation=직장인
```

```json
// 응답
{
  "age": "25",
  "occupation": "직장인",
  "products": [
    {
      "product_code": "WR0003B",
      "view_count": 15,
      "kor_co_nm": "하나은행",
      "fin_prdt_nm": "하나 정기예금",
      "max_rate": 4.2
    }
    // ... 최대 5개, 조회수 내림차순
  ]
}
```

#### `POST /recordProductView` — 상품 조회 기록 저장

```json
// 요청 body (나이/직업은 백엔드가 profiles에서 자동으로 가져옴)
{ "user_id": "유저ID", "product_code": "상품코드" }
```

```json
// 응답
{ "success": true }
```

---

### 프로필

#### `POST /saveProfile` — 유저 프로필 저장

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
```

```json
// 응답
{
  "success": true,
  "profile": {
    "id": "Firebase UID",
    "name": "홍길동",
    "email": "hong@gmail.com",
    "age": 25,
    "occupation": "직장인",
    "interests": "주식, 게임, 여행",
    "main_bank": "국민은행",
    "created_at": "2026-05-06T00:00:00.000Z"
  }
}
```

> 회원가입 시 사용자 정보 입력 후 호출. 이미 있으면 업데이트.

---

### 카드 소개 (구현 예정)

#### `GET /getCards` — 카드 목록 소개

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `category` | 선택 | `신용` / `체크` / 없으면 전체 |

---

## Flutter 연동 방법

에뮬레이터 실행 후 Flutter에서 같은 와이파이로 연결할 때:

```dart
// localhost 대신 PC의 로컬 IP 주소 사용
const baseUrl = 'http://192.168.X.X:5001/donifin/us-central1';
```

> PC의 로컬 IP 확인: Windows에서 `ipconfig` 실행 → IPv4 주소 확인

---

## Supabase 테이블 구조

| 테이블 | 설명 |
|--------|------|
| `profiles` | 사용자 정보 저장 |
| `posts` | 커뮤니티 게시글 |
| `comments` | 게시글 댓글 |
| `product_views` | 나이·직업별 인기 상품 집계용 조회 기록 |

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

### product_views

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `user_id` | uuid | profiles.id 참조 |
| `product_code` | text | 금감원 상품 코드 |
| `age` | integer | 조회 시점 나이 |
| `occupation` | text | 조회 시점 직업 |
| `viewed_at` | timestamptz | 조회 일시 |
