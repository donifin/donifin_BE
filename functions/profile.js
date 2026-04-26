const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");

// 유저 프로필 저장 (최초 로그인 시 나이대 + 직업 저장)
// POST /saveProfile
// Body: { user_id, age_group, occupation }
exports.saveProfile = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, age_group, occupation } = req.body;

    if (!user_id) return res.status(400).json({ error: "user_id 필수" });

    // upsert: 이미 있으면 업데이트, 없으면 삽입
    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        { id: user_id, age_group, occupation },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, profile: data });
  } catch (err) {
    logger.error("saveProfile error:", err);
    return res.status(500).json({ error: "프로필 저장 실패" });
  }
});
