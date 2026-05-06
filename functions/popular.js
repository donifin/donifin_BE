const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  supabase,
  setCorsHeaders,
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  fetchFssProducts,
} = require("./config");

// 상품 조회 기록 저장
// POST /recordProductView
// body: { user_id, product_code }
exports.recordProductView = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, product_code } = req.body;
    if (!user_id || !product_code) {
      return res.status(400).json({ error: "user_id, product_code 필수" });
    }

    // profiles 테이블에서 나이, 직업 자동으로 가져오기
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("age, occupation")
      .eq("id", user_id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: "프로필을 찾을 수 없습니다. saveProfile을 먼저 호출해주세요." });
    }

    const { error } = await supabase
      .from("product_views")
      .insert({
        user_id,
        product_code,
        age: profile.age || null,
        occupation: profile.occupation || null,
      });

    if (error) throw error;

    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error("recordProductView error:", err);
    return res.status(500).json({ error: "조회 기록 저장 실패" });
  }
});

// 나이·직업별 인기 상품 TOP 5 조회
// GET /getPopularProducts?age=25&occupation=직장인
exports.getPopularProducts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { age, occupation } = req.query;
    if (!age && !occupation) {
      return res.status(400).json({ error: "age 또는 occupation 중 하나 이상 필수" });
    }

    let query = supabase.from("product_views").select("product_code");
    if (age) query = query.eq("age", parseInt(age));
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
      .slice(0, 5);

    // 상품 상세 정보(은행명, 상품명, 최고 금리) 매핑
    let allProducts = [];
    if (USE_MOCK) {
      allProducts = [...MOCK_DEPOSIT_PRODUCTS, ...MOCK_SAVING_PRODUCTS];
    } else {
      const [deposits, savings] = await Promise.all([
        fetchFssProducts("deposit"),
        fetchFssProducts("saving"),
      ]);
      allProducts = [...deposits, ...savings];
    }

    const productMap = {};
    for (const p of allProducts) {
      const maxRate = p.options && p.options.length > 0
        ? Math.max(...p.options.map((o) => o.intr_rate2 ?? o.intr_rate))
        : null;
      productMap[p.fin_prdt_cd] = {
        kor_co_nm: p.kor_co_nm,
        fin_prdt_nm: p.fin_prdt_nm,
        max_rate: maxRate,
      };
    }

    const products = top5.map(([product_code, view_count]) => ({
      product_code,
      view_count,
      kor_co_nm: productMap[product_code]?.kor_co_nm || null,
      fin_prdt_nm: productMap[product_code]?.fin_prdt_nm || null,
      max_rate: productMap[product_code]?.max_rate || null,
    }));

    return res.status(200).json({ age, occupation, products });
  } catch (err) {
    logger.error("getPopularProducts error:", err);
    return res.status(500).json({ error: "인기 상품 조회 실패" });
  }
});
