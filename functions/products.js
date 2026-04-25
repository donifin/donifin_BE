const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  setCorsHeaders,
  fetchFssProducts,
} = require("./config");

// 금융 상품 검색 + 필터링 + 금리 정렬
// GET /getProducts?type=deposit&term=12&sort=high
// - type : "deposit"(예금) | "saving"(적금) | 없으면 둘 다
// - term : 6 | 12 | 24 | 36 (개월, 없으면 전체)
// - sort : "high"(금리 높은 순, 기본) | "low"(금리 낮은 순)
exports.getProducts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { type, term, sort = "high" } = req.query;

    let depositProducts = [];
    let savingProducts = [];

    if (USE_MOCK) {
      if (!type || type === "deposit") depositProducts = MOCK_DEPOSIT_PRODUCTS;
      if (!type || type === "saving") savingProducts = MOCK_SAVING_PRODUCTS;
    } else {
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
