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

// 성향 테스트 질문 목록
const PERSONALITY_QUESTIONS = [
  {
    id: 1,
    question: "저축의 주된 목적은 무엇인가요?",
    options: ["비상금 마련", "단기 목표 달성 (여행, 구매 등)", "목돈 마련", "노후 준비"],
  },
  {
    id: 2,
    question: "선호하는 저축 기간은 얼마인가요?",
    options: ["6개월 이하", "1년", "2년", "3년 이상"],
  },
  {
    id: 3,
    question: "월 저축 가능 금액은 얼마인가요?",
    options: ["10만원 이하", "10만원~30만원", "30만원~50만원", "50만원 이상"],
  },
  {
    id: 4,
    question: "원금 손실에 대해 어떻게 생각하시나요?",
    options: ["절대 안 됨, 원금은 무조건 보장돼야 함", "최대한 피하고 싶음", "어느 정도 감수할 수 있음"],
  },
  {
    id: 5,
    question: "저축 방식은 어떤 걸 선호하나요?",
    options: ["매달 정해진 금액을 납입하고 싶음", "상황에 따라 자유롭게 넣고 싶음"],
  },
  {
    id: 6,
    question: "지금 비상금(생활비 3개월치)이 충분히 있나요?",
    options: ["충분히 있음", "어느 정도 있음", "거의 없음"],
  },
  {
    id: 7,
    question: "저축으로 달성하고 싶은 목표 금액이 있나요?",
    options: ["1000만원 이상의 큰 금액", "500만원 이하의 소액", "딱히 목표 금액은 없음"],
  },
  {
    id: 8,
    question: "금리가 조금 낮더라도 언제든 돈을 뺄 수 있는 게 중요한가요?",
    options: ["매우 중요함, 유동성이 우선", "중요하지만 금리도 고려함", "금리가 더 중요함"],
  },
  {
    id: 9,
    question: "재테크나 금융 상품 경험이 있나요?",
    options: ["없음, 처음 시작하는 단계", "예적금 정도는 해봤음", "다양한 금융 상품 경험 있음"],
  },
  {
    id: 10,
    question: "지금 가장 중요하게 생각하는 것은?",
    options: ["안전성 (원금 보장)", "수익성 (높은 금리)", "유동성 (자유로운 입출금)"],
  },
  {
    id: 11,
    question: "저축을 시작하려는 가장 큰 이유는?",
    options: ["생활비 절약 습관 만들기", "특정 목적을 위한 저축", "자산을 불리고 싶어서"],
  },
  {
    id: 12,
    question: "매달 저축 금액이 일정한 편인가요?",
    options: ["매달 비슷하게 저축 가능", "수입이 들쭉날쭉해서 일정하지 않음"],
  },
];

// 성향 유형별 상품 필터 조건
const PERSONALITY_PRODUCT_FILTER = {
  "단기 안전형": { type: "deposit", maxTerm: 6 },
  "장기 안전형": { type: "deposit", minTerm: 24 },
  "소액 저축형": { type: "saving", rsrv_type: "자유적립식" },
  "목돈 마련형": { type: "saving", minTerm: 12 },
};

// 성향에 맞는 상품 필터링
function filterProductsByPersonality(personalityType, deposits, savings) {
  const filter = PERSONALITY_PRODUCT_FILTER[personalityType];
  if (!filter) return [];

  const products = filter.type === "deposit" ? deposits : savings;

  return products
    .map((p) => {
      let matchedOptions = p.options;

      if (filter.maxTerm) {
        matchedOptions = matchedOptions.filter((o) => parseInt(o.save_trm) <= filter.maxTerm);
      }
      if (filter.minTerm) {
        matchedOptions = matchedOptions.filter((o) => parseInt(o.save_trm) >= filter.minTerm);
      }
      if (filter.rsrv_type) {
        matchedOptions = matchedOptions.filter((o) =>
          o.rsrv_type_nm && o.rsrv_type_nm.includes(filter.rsrv_type)
        );
      }

      if (matchedOptions.length === 0) return null;

      const maxRate = Math.max(...matchedOptions.map((o) => o.intr_rate2 ?? o.intr_rate));
      return { ...p, options: matchedOptions, max_rate: maxRate };
    })
    .filter(Boolean)
    .sort((a, b) => b.max_rate - a.max_rate)
    .slice(0, 3);
}

// 성향 테스트 질문 목록 조회
// GET /getPersonalityQuestions
exports.getPersonalityQuestions = onRequest((req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  return res.status(200).json({ questions: PERSONALITY_QUESTIONS });
});

// 성향 테스트 결과 분석
// POST /personalityTest
// body: { answers: [0, 1, 2, ...] } (각 질문의 선택지 인덱스, 0부터 시작)
exports.personalityTest = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length < 10) {
      return res.status(400).json({ error: "answers 배열 필수 (최소 10개)" });
    }

    const qaText = PERSONALITY_QUESTIONS.slice(0, answers.length)
      .map((q, i) => `Q${i + 1}. ${q.question}\n답변: ${q.options[answers[i]] || "미선택"}`)
      .join("\n\n");

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

    const systemPrompt = `너는 금융 성향 분석 전문가야.
사용자의 설문 답변을 분석해서 아래 4가지 유형 중 하나로 판정해줘.

유형 목록:
- 단기 안전형: 6개월 이하 단기, 원금 보장 중시
- 장기 안전형: 2년 이상 장기, 안정적 수익 중시
- 소액 저축형: 소액이라도 꾸준히, 자유로운 납입 선호
- 목돈 마련형: 목돈 목표, 높은 금리 중시

반드시 아래 JSON 형식으로만 답해줘. 다른 텍스트는 절대 포함하지 마.
{
  "type": "유형명",
  "description": "사용자에게 보여줄 성향 설명 (2~3문장, 친근한 말투)"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: qaText },
      ],
      max_tokens: 300,
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch {
      return res.status(500).json({ error: "AI 응답 파싱 실패" });
    }

    const { type, description } = parsed;
    const recommendedProducts = filterProductsByPersonality(type, deposits, savings);

    return res.status(200).json({
      type,
      description,
      products: recommendedProducts,
      is_mock: USE_MOCK,
    });
  } catch (err) {
    logger.error("personalityTest error:", err);
    return res.status(500).json({ error: "성향 테스트 분석 실패" });
  }
});
