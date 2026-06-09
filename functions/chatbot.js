const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  getOpenAI,
  supabase,
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
    const { user_id, message, history = [], personality } = req.body;
    if (!message) return res.status(400).json({ error: "message 필수" });

    // 사용자 프로필 조회 (선택적 - user_id 있을 때만)
    let userProfile = null;
    if (user_id) {
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("name, age, occupation, interests, main_bank")
        .eq("id", user_id)
        .single();
      if (!profileError && data) {
        userProfile = data;
      } else if (profileError) {
        logger.warn("chatBot: 프로필 조회 실패", profileError.message);
      }
    }

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

    const profileContext = userProfile
      ? `\n[사용자 정보]\n- 이름: ${userProfile.name || "미입력"}\n- 나이: ${userProfile.age || "미입력"}\n- 직업: ${userProfile.occupation || "미입력"}\n- 관심분야: ${userProfile.interests || "미입력"}\n- 주거래 은행: ${userProfile.main_bank || "미입력"}\n위 사용자 정보를 고려해서 맞춤형으로 답변해줘.`
      : "";

    // 성향 테스트 결과 반영 (프론트에서 전달 — { type, description }).
    const personalityContext = (personality && personality.type)
      ? `\n[사용자 금융 성향]\n- 유형: ${personality.type}\n${personality.description ? `- 설명: ${personality.description}\n` : ""}이 사용자는 성향 테스트에서 "${personality.type}"으로 분석됐어. 상품을 추천할 때 이 성향(예: 단기/장기, 안정/수익, 자유납입/목돈)에 부합하는 상품을 우선적으로 추천하고, 왜 이 성향에 맞는지 한 문장으로 설명해줘.`
      : "";

    const systemPrompt = `너는 친절한 금융 전문가 챗봇이야.
반드시 아래 금감원 실제 상품 데이터 안에서만 상품을 추천해야 해. 데이터에 없는 상품은 절대 만들어내지 마.
금융 용어 설명은 쉽고 간결하게 해줘. 답변은 한국어로 해줘.${profileContext}${personalityContext}

[현재 금융 상품 데이터]
${productContext}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-10),
      { role: "user", content: message },
    ];

    const openai = getOpenAI();
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
