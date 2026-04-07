# 돈이FIN - Backend

> Firebase Cloud Functions 기반 백엔드
> 금감원 API + ai API + (네이버) 뉴스 API 연동

## 기술 스택

- Firebase Cloud Functions (Node.js)
- Supabase (PostgreSQL DB)
- 금감원 finlife API
- Anthropic Claude API
- (네이버) 뉴스 API

## 프로젝트 구조

functions/
├── index.js          # 진입점
├── products.js       # 금감원 API - 상품 검색/필터링
├── chat.js           # Anthropic API - AI 챗봇
├── personality.js    # Anthropic API - 성향 테스트
├── news.js           # 네이버 뉴스 API
└── community.js      # 커뮤니티 (Supabase CRUD)

## 시작하기

### 필수 설치
- Node.js v18 이상
- Firebase CLI

# Firebase CLI 설치
npm install -g firebase-tools

# 로그인
firebase login

# 패키지 설치
cd functions
npm install

### 로컬 에뮬레이터 실행
firebase emulators:start

에뮬레이터 실행 후:
- Functions: http://localhost:5001
- Auth:      http://localhost:9099
- UI:        http://localhost:4000

## API 엔드포인트

| 함수명 | 설명 |
|--------|------|
| getProducts | 금감원 예금/적금 상품 검색 |
| chatBot | AI 금융 챗봇 응답 |
| personalityTest | 금융 성향 테스트 결과 |
| getNews | 금융 뉴스 조회 |
| getCommunityPosts | 커뮤니티 게시글 목록 |

## 환경 변수

.env 파일 생성 (절대 GitHub에 올리지 말 것!)

FSS_API_KEY=금감원_인증키
ANTHROPIC_API_KEY=Anthropic_키
NAVER_CLIENT_ID=네이버_클라이언트_ID
NAVER_CLIENT_SECRET=네이버_시크릿
SUPABASE_URL=Supabase_URL
SUPABASE_KEY=Supabase_KEY

