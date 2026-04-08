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

// ══════════════════════════════════════════════════════════════
// 커뮤니티 함수 (Supabase)
// ══════════════════════════════════════════════════════════════

// 게시글 목록 조회
// GET /getCommunityPosts?page=1&limit=20
exports.getCommunityPosts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("posts")
      .select("id, title, content, created_at, user_id, profiles(age_group)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      posts: data,
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    logger.error("getCommunityPosts error:", err);
    return res.status(500).json({ error: "게시글 목록 조회 실패" });
  }
});

// 게시글 작성
// POST /createPost
// body: { user_id, title, content }
exports.createPost = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, title, content } = req.body;
    if (!user_id || !title || !content) {
      return res.status(400).json({ error: "user_id, title, content 필수" });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({ user_id, title, content })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ post: data });
  } catch (err) {
    logger.error("createPost error:", err);
    return res.status(500).json({ error: "게시글 작성 실패" });
  }
});

// 댓글 목록 조회
// GET /getComments?post_id=xxx
exports.getComments = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { post_id } = req.query;
    if (!post_id) return res.status(400).json({ error: "post_id 필수" });

    const { data, error } = await supabase
      .from("comments")
      .select("id, content, created_at, user_id, profiles(age_group)")
      .eq("post_id", post_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.status(200).json({ comments: data });
  } catch (err) {
    logger.error("getComments error:", err);
    return res.status(500).json({ error: "댓글 조회 실패" });
  }
});

// 댓글 작성
// POST /createComment
// body: { post_id, user_id, content }
exports.createComment = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { post_id, user_id, content } = req.body;
    if (!post_id || !user_id || !content) {
      return res.status(400).json({ error: "post_id, user_id, content 필수" });
    }

    const { data, error } = await supabase
      .from("comments")
      .insert({ post_id, user_id, content })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ comment: data });
  } catch (err) {
    logger.error("createComment error:", err);
    return res.status(500).json({ error: "댓글 작성 실패" });
  }
});

// ══════════════════════════════════════════════════════════════
// 나이대별 인기 상품 함수 (Supabase)
// ══════════════════════════════════════════════════════════════

// 상품 조회 기록 저장
// POST /recordProductView
// body: { user_id, product_code, age_group }
exports.recordProductView = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, product_code, age_group } = req.body;
    if (!user_id || !product_code || !age_group) {
      return res.status(400).json({ error: "user_id, product_code, age_group 필수" });
    }

    const { error } = await supabase
      .from("product_views")
      .insert({ user_id, product_code, age_group });

    if (error) throw error;

    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error("recordProductView error:", err);
    return res.status(500).json({ error: "조회 기록 저장 실패" });
  }
});

// 나이대별 인기 상품 TOP 5 조회
// GET /getPopularProducts?age_group=20대
exports.getPopularProducts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { age_group } = req.query;
    if (!age_group) return res.status(400).json({ error: "age_group 필수" });

    const { data, error } = await supabase
      .from("product_views")
      .select("product_code")
      .eq("age_group", age_group);

    if (error) throw error;

    // 상품 코드별 조회 수 집계
    const countMap = {};
    for (const row of data) {
      countMap[row.product_code] = (countMap[row.product_code] || 0) + 1;
    }

    // 조회 수 내림차순 정렬 후 TOP 5
    const top5 = Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([product_code, view_count]) => ({ product_code, view_count }));

    return res.status(200).json({ age_group, products: top5 });
  } catch (err) {
    logger.error("getPopularProducts error:", err);
    return res.status(500).json({ error: "인기 상품 조회 실패" });
  }
});
