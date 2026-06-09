require("dotenv").config();

const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const { MOCK_DEPOSIT_PRODUCTS, MOCK_SAVING_PRODUCTS } = require("./mockData");

// ── 클라이언트 초기화 ──────────────────────────────────────────
let openaiClient;
let supabaseClient;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY environment variables are required");
  }
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }
  return supabaseClient;
}

const supabase = new Proxy({}, {
  get(_target, prop) {
    return getSupabase()[prop];
  },
});

// ── 환경변수 ──────────────────────────────────────────────────
const FSS_API_KEY = process.env.FSS_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const ECOS_API_KEY = process.env.ECOS_API_KEY;
// 한국수출입은행 환율 API 인증키 — koreaexim.go.kr 에서 발급 (무료, 1일 1000회).
const EXIM_API_KEY = process.env.EXIM_API_KEY;

const USE_MOCK = !FSS_API_KEY; // 금감원 API 키 없으면 mock 데이터 사용

// ── 공통 CORS 헤더 설정 ───────────────────────────────────────
function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── 금감원 API 상품 데이터 가져오기 ───────────────────────────
// 네트워크/응답 오류 시 throw하지 않고 mock으로 폴백 (호출자가 빈 배열로 죽는 거 방지).
async function fetchFssProducts(type) {
  const endpoint = type === "deposit"
    ? "http://finlife.fss.or.kr/finlifeapi/depositProductsSearch.json"
    : "http://finlife.fss.or.kr/finlifeapi/savingProductsSearch.json";

  const fallback = type === "deposit"
    ? MOCK_DEPOSIT_PRODUCTS
    : MOCK_SAVING_PRODUCTS;

  if (!FSS_API_KEY) {
    return fallback;
  }

  try {
    const res = await axios.get(endpoint, {
      params: { auth: FSS_API_KEY, topFinGrpNo: "020000", pageNo: 1 },
      timeout: 10000,
    });

    const result = res.data?.result;
    if (!result || !Array.isArray(result.baseList)) {
      console.warn(`fetchFssProducts(${type}): 응답 구조 비정상 — mock 폴백`);
      return fallback;
    }

    const baseList = result.baseList;
    const optionList = Array.isArray(result.optionList) ? result.optionList : [];

    return baseList.map((product) => ({
      ...product,
      options: optionList.filter((o) => o.fin_prdt_cd === product.fin_prdt_cd),
    }));
  } catch (e) {
    console.warn(`fetchFssProducts(${type}) 실패 — mock 폴백:`, e?.message || e);
    return fallback;
  }
}

module.exports = {
  getOpenAI,
  getSupabase,
  supabase,
  axios,
  FSS_API_KEY,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  ECOS_API_KEY,
  EXIM_API_KEY,
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  setCorsHeaders,
  fetchFssProducts,
};
