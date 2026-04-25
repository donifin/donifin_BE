const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  openai,
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  setCorsHeaders,
  fetchFssProducts,
} = require("./config");

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

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-10),
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
