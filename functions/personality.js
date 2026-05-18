const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  openai,
  supabase,
  USE_MOCK,
  MOCK_DEPOSIT_PRODUCTS,
  MOCK_SAVING_PRODUCTS,
  setCorsHeaders,
  fetchFssProducts,
} = require("./config");

// join_member 텍스트에서 연령 제한 파싱.
// "만 17세 미만의 ..."   → { type: "max", age: 17, inclusive: false }
// "만 19세 이상"        → { type: "min", age: 19, inclusive: true }
// "만 65세 이하"        → { type: "max", age: 65, inclusive: true }
// 매칭 안 되면 null (제한 없는 것으로 간주).
function parseAgeLimit(joinMember) {
  if (typeof joinMember !== "string" || !joinMember.trim()) return null;
  // 가장 흔한 패턴부터.
  const undermatch = joinMember.match(/만\s*(\d+)\s*세\s*미만/);
  if (undermatch) {
    return { type: "max", age: parseInt(undermatch[1], 10), inclusive: false };
  }
  const minMatch = joinMember.match(/만\s*(\d+)\s*세\s*이상/);
  if (minMatch) {
    return { type: "min", age: parseInt(minMatch[1], 10), inclusive: true };
  }
  const maxMatch = joinMember.match(/만\s*(\d+)\s*세\s*이하/);
  if (maxMatch) {
    return { type: "max", age: parseInt(maxMatch[1], 10), inclusive: true };
  }
  return null;
}

// 주어진 나이가 join_member 제한을 통과하는지.
function isAgeEligible(age, joinMember) {
  if (age == null) return true; // 나이 모르면 통과시킴
  const limit = parseAgeLimit(joinMember);
  if (!limit) return true; // 제한 없으면 통과
  if (limit.type === "min") {
    return limit.inclusive ? age >= limit.age : age > limit.age;
  }
  // max
  return limit.inclusive ? age <= limit.age : age < limit.age;
}

// 성향 테스트 질문 목록 (1~5점 척도: 전혀 그렇지 않다 ~ 매우 그렇다)
const PERSONALITY_QUESTIONS = [
  { id: 1,  question: "나는 저축할 때 원금을 잃지 않는 것이 가장 중요하다." },
  { id: 2,  question: "나는 6개월 이내의 단기 저축을 선호한다." },
  { id: 3,  question: "나는 목돈(1000만원 이상)을 모으는 것이 목표다." },
  { id: 4,  question: "나는 매달 일정한 금액을 꾸준히 저축할 수 있다." },
  { id: 5,  question: "나는 필요할 때 언제든 돈을 꺼낼 수 있는 유동성이 중요하다." },
  { id: 6,  question: "나는 2년 이상 장기 저축도 괜찮다." },
  { id: 7,  question: "나는 금리가 높다면 오랫동안 돈을 묶어두는 것을 감수할 수 있다." },
  { id: 8,  question: "나는 소액이라도 자유롭게 저축하는 방식을 선호한다." },
  { id: 9,  question: "나는 비상금(생활비 3개월치)이 이미 충분히 마련되어 있다." },
  { id: 10, question: "나는 저축보다 높은 수익률을 위해 어느 정도 위험을 감수할 수 있다." },
  { id: 11, question: "나는 특정 목표(여행, 결혼, 차 구매 등)를 위해 저축하고 있다." },
  { id: 12, question: "나는 매달 저축 금액이 일정하지 않고 들쭉날쭉한 편이다." },
];

// 척도 텍스트
const SCALE_LABELS = {
  1: "전혀 그렇지 않다",
  2: "그렇지 않다",
  3: "보통이다",
  4: "그렇다",
  5: "매우 그렇다",
};

// 성향 유형별 상품 필터 조건
const PERSONALITY_PRODUCT_FILTER = {
  "단기 안전형": { type: "deposit", maxTerm: 6 },
  "장기 안전형": { type: "deposit", minTerm: 24 },
  "소액 저축형": { type: "saving", rsrv_type: "자유적립식" },
  "목돈 마련형": { type: "saving", minTerm: 12 },
};

// 성향에 맞는 상품 필터링.
// age가 주어지면 join_member의 연령 제한도 적용 (예: 25살에게 17세 미만 상품 제외).
function filterProductsByPersonality(personalityType, deposits, savings, age) {
  const filter = PERSONALITY_PRODUCT_FILTER[personalityType];
  if (!filter) return [];

  const products = filter.type === "deposit" ? deposits : savings;

  return products
    .map((p) => {
      // 연령 부적합 상품은 일찍 제외.
      if (!isAgeEligible(age, p.join_member)) return null;

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

  return res.status(200).json({
    questions: PERSONALITY_QUESTIONS,
    scale: SCALE_LABELS,
  });
});

// 성향 테스트 결과 분석
// POST /personalityTest
// body: { answers: [1~5, 1~5, ...] } (각 질문에 대한 1~5점 점수)
exports.personalityTest = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { answers, user_id } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length < 10) {
      return res.status(400).json({ error: "answers 배열 필수 (최소 10개)" });
    }

    // user_id가 있으면 profiles에서 나이 조회 (실패해도 진행 — 필터 없이).
    let userAge = null;
    if (user_id) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("age")
          .eq("id", user_id)
          .single();
        if (profile && typeof profile.age === "number") {
          userAge = profile.age;
        }
      } catch (e) {
        logger.warn("프로필 조회 실패 (필터 없이 진행):", e?.message || e);
      }
    }

    // 점수 유효성 검사 (1~5만 허용)
    const invalid = answers.some((a) => !Number.isInteger(a) || a < 1 || a > 5);
    if (invalid) {
      return res.status(400).json({ error: "각 답변은 1~5 사이의 정수여야 합니다" });
    }

    // AI에게 전달할 질문+점수 텍스트
    const qaText = PERSONALITY_QUESTIONS.slice(0, answers.length)
      .map((q, i) => `Q${i + 1}. ${q.question}\n답변: ${answers[i]}점 (${SCALE_LABELS[answers[i]]})`)
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
사용자가 각 문항에 1~5점으로 답했어. 1점은 "전혀 그렇지 않다", 5점은 "매우 그렇다"를 의미해.
답변을 종합 분석해서 아래 4가지 유형 중 하나로 판정해줘.

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
    const recommendedProducts = filterProductsByPersonality(
      type,
      deposits,
      savings,
      userAge,
    );

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
