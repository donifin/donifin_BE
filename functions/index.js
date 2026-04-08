require("dotenv").config();

const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

setGlobalOptions({ maxInstances: 10 });

// ── 클라이언트 초기화 ──────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

const FSS_API_KEY = process.env.FSS_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

const USE_MOCK = !FSS_API_KEY; // 금감원 API 키 없으면 mock 데이터 사용
const { MOCK_DEPOSIT_PRODUCTS, MOCK_SAVING_PRODUCTS } = require("./mockData");

// ── 공통 CORS 헤더 설정 ───────────────────────────────────────
function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── TODO: 아래에 각 Cloud Function 구현 예정 ──────────────────
// getProducts        - 금융 상품 검색 + 필터링 + 금리 정렬
// chatBot            - AI 금융 챗봇
// personalityTest    - 금융 성향 테스트
// getNews            - 금융 뉴스
// getCommunityPosts  - 커뮤니티 게시글 목록
// createPost         - 게시글 작성
// getComments        - 댓글 목록
// createComment      - 댓글 작성
// getPopularProducts - 나이대별 인기 상품 TOP 5
// recordProductView  - 상품 조회 기록 저장
