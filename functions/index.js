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
// personalityTest    - 금융 성향 테스트
// getNews            - 금융 뉴스

// ══════════════════════════════════════════════════════════════
// AI 금융 챗봇 (OpenAI + 금감원 데이터)
// ══════════════════════════════════════════════════════════════

// 상품 데이터를 AI 프롬프트용 텍스트로 변환
function formatProductsForPrompt(deposits, savings) {
  const formatList = (products, label) =>
    products.map((p) => {
      const rates = p.options
        .map((o) => `  - ${o.save_trm}개월: 기본금리 ${o.intr_rate}%, 우대금리 ${o.intr_rate2}%`)
        .join("\n");
      return `[${label}] ${p.kor_co_nm} - ${p.fin_prdt_nm}\n  가입방법: ${p.join_way}\n  우대조건: ${p.spcl_cnd}\n${rates}`;
    }).join("\n\n");

  return `=== 정기예금 상품 ===\n${formatList(deposits, "예금")}\n\n=== 적금 상품 ===\n${formatList(savings, "적금")}`;
}

// AI 금융 챗봇
// POST /chatBot
// body: { message, history: [{role, content}, ...] }
exports.chatBot = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "message 필수" });

    // 금감원 데이터 로드 (mock or 실제)
    let deposits, savings;
    if (USE_MOCK) {
      deposits = MOCK_DEPOSIT_PRODUCTS;
      savings = MOCK_SAVING_PRODUCTS;
    } else {
      [deposits, savings] = await Promise.all([
        fetchFssProducts("deposit"),
        fetchFssProducts("saving"),
      ]);
    }

    const productContext = formatProductsForPrompt(deposits, savings);

    const systemPrompt = `너는 친절한 금융 전문가 챗봇이야.
반드시 아래 금감원 실제 상품 데이터 안에서만 상품을 추천해야 해. 데이터에 없는 상품은 절대 만들어내지 마.
금융 용어 설명은 쉽고 간결하게 해줘. 답변은 한국어로 해줘.

[현재 금융 상품 데이터]
${productContext}`;

    // 대화 히스토리 + 새 메시지 조합
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-10), // 최근 10개까지만 유지
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 1000,
    });

    const reply = completion.choices[0].message.content;

    return res.status(200).json({ reply });
  } catch (err) {
    logger.error("chatBot error:", err);
    return res.status(500).json({ error: "챗봇 응답 실패" });
  }
});

// ══════════════════════════════════════════════════════════════
// 금융 상품 검색 (금감원 API or Mock)
// ══════════════════════════════════════════════════════════════

// 금감원 API에서 상품 데이터 가져오기
async function fetchFssProducts(type) {
  const endpoint = type === "deposit"
    ? "http://finlife.fss.or.kr/finlifeapi/depositProductsSearch.json"
    : "http://finlife.fss.or.kr/finlifeapi/savingProductsSearch.json";

  const res = await axios.get(endpoint, {
    params: { auth: FSS_API_KEY, topFinGrpNo: "020000", pageNo: 1 },
  });

  const result = res.data.result;
  const baseList = result.baseList;
  const optionList = result.optionList;

  // 상품 코드 기준으로 옵션 묶기
  return baseList.map((product) => ({
    ...product,
    options: optionList.filter((o) => o.fin_prdt_cd === product.fin_prdt_cd),
  }));
}

// 금융 상품 검색 + 필터링 + 금리 정렬
// GET /getProducts?type=deposit&term=12&sort=high
// - type   : "deposit"(예금) | "saving"(적금) | 없으면 둘 다
// - term   : 6 | 12 | 24 | 36 (개월, 없으면 전체)
// - sort   : "high"(금리 높은 순, 기본) | "low"(금리 낮은 순)
exports.getProducts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { type, term, sort = "high" } = req.query;

    let depositProducts = [];
    let savingProducts = [];

    if (USE_MOCK) {
      // 금감원 API 키 없을 때 mock 데이터 사용
      if (!type || type === "deposit") depositProducts = MOCK_DEPOSIT_PRODUCTS;
      if (!type || type === "saving") savingProducts = MOCK_SAVING_PRODUCTS;
    } else {
      // 실제 금감원 API 호출
      if (!type || type === "deposit") depositProducts = await fetchFssProducts("deposit");
      if (!type || type === "saving") savingProducts = await fetchFssProducts("saving");
    }

    const allProducts = [
      ...depositProducts.map((p) => ({ ...p, product_type: "deposit" })),
      ...savingProducts.map((p) => ({ ...p, product_type: "saving" })),
    ];

    // 기간 필터링 + 해당 기간 옵션만 추출
    const filtered = allProducts
      .map((product) => {
        const matchedOptions = term
          ? product.options.filter((o) => String(o.save_trm) === String(term))
          : product.options;

        if (matchedOptions.length === 0) return null;

        // 옵션 중 최고 우대금리
        const maxRate = Math.max(...matchedOptions.map((o) => o.intr_rate2 ?? o.intr_rate));

        return { ...product, options: matchedOptions, max_rate: maxRate };
      })
      .filter(Boolean);

    // 금리 정렬
    filtered.sort((a, b) =>
      sort === "low" ? a.max_rate - b.max_rate : b.max_rate - a.max_rate
    );

    return res.status(200).json({
      products: filtered,
      count: filtered.length,
      is_mock: USE_MOCK,
    });
  } catch (err) {
    logger.error("getProducts error:", err);
    return res.status(500).json({ error: "상품 조회 실패" });
  }
});

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
// 나이대·직업별 인기 상품 함수 (Supabase)
// ══════════════════════════════════════════════════════════════

// 상품 조회 기록 저장
// POST /recordProductView
// body: { user_id, product_code, age_group, occupation }
exports.recordProductView = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, product_code, age_group, occupation } = req.body;
    if (!user_id || !product_code || !age_group) {
      return res.status(400).json({ error: "user_id, product_code, age_group 필수" });
    }

    const { error } = await supabase
      .from("product_views")
      .insert({ user_id, product_code, age_group, occupation: occupation || null });

    if (error) throw error;

    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error("recordProductView error:", err);
    return res.status(500).json({ error: "조회 기록 저장 실패" });
  }
});

// 나이대·직업별 인기 상품 TOP 5 조회
// GET /getPopularProducts?age_group=20대&occupation=직장인
// - age_group, occupation 둘 다 선택, 하나만 써도 됨
exports.getPopularProducts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { age_group, occupation } = req.query;
    if (!age_group && !occupation) {
      return res.status(400).json({ error: "age_group 또는 occupation 중 하나 이상 필수" });
    }

    let query = supabase.from("product_views").select("product_code");
    if (age_group) query = query.eq("age_group", age_group);
    if (occupation) query = query.eq("occupation", occupation);

    const { data, error } = await query;
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

    return res.status(200).json({ age_group, occupation, products: top5 });
  } catch (err) {
    logger.error("getPopularProducts error:", err);
    return res.status(500).json({ error: "인기 상품 조회 실패" });
  }
});
