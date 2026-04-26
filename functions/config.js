require("dotenv").config();

const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const { MOCK_DEPOSIT_PRODUCTS, MOCK_SAVING_PRODUCTS } = require("./mockData");

// ── 클라이언트 초기화 ──────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

// ── 환경변수 ──────────────────────────────────────────────────
const FSS_API_KEY = process.env.FSS_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const ECOS_API_KEY = process.env.ECOS_API_KEY;

const USE_MOCK = !FSS_API_KEY; // 금감원 API 키 없으면 mock 데이터 사용

// ── 공통 CORS 헤더 설정 ───────────────────────────────────────
function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── 금감원 API 상품 데이터 가져오기 ───────────────────────────
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

  return baseList.map((product) => ({
    ...product,
    options: optionList.filter((o) => o.fin_prdt_cd === product.fin_prdt_cd),
  }));
}

module.exports = {
  openai,
  supabase,
  axios,
  FSS_API_KEY,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  ECOS_API_KEY,
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  setCorsHeaders,
  fetchFssProducts,
};
