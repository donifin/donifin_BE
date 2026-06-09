const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");
const { v5: uuidv5 } = require("uuid");
const { setCorsHeaders, supabase } = require("./config");

// 카카오 ID → 결정적 UUID v5 변환용 namespace.
// 같은 카카오 ID는 항상 같은 UUID를 만들어내므로 재로그인 시에도 동일 유저로 인식됨.
const KAKAO_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 example UUID

// firebase-admin 초기화 (다른 곳에서 안 했다면).
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * 카카오 로그인 → Firebase Custom Token 발급.
 *
 * 플로우:
 *   1. 클라이언트가 카카오 SDK로 로그인 → access_token 획득
 *   2. 이 함수에 access_token 전달
 *   3. 카카오 API로 사용자 정보 조회 (id, nickname)
 *   4. Firebase Auth에 user 생성/조회 (uid = "kakao_<kakao_id>")
 *   5. Custom Token 발급해서 응답
 *   6. 클라이언트가 그 토큰으로 signInWithCustomToken
 *
 * 동의항목: 닉네임만 (이메일 미수집 → 가상 이메일 생성)
 *
 * POST /kakaoLogin
 * body: { access_token: string }
 * response: { firebase_token, uid, nickname }
 */
exports.kakaoLogin = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { access_token } = req.body || {};
    if (!access_token) {
      return res.status(400).json({ error: "access_token 필수" });
    }

    // ── 1. 카카오 사용자 정보 조회 ──────────────────────────
    let kakaoUser;
    try {
      const { data } = await axios.get("https://kapi.kakao.com/v2/user/me", {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      });
      kakaoUser = data;
    } catch (e) {
      logger.warn("kakao /v2/user/me 실패:", e?.response?.data || e?.message);
      return res.status(401).json({ error: "카카오 토큰 검증 실패" });
    }

    const kakaoId = kakaoUser.id;
    const nickname =
      kakaoUser?.kakao_account?.profile?.nickname ||
      kakaoUser?.properties?.nickname ||
      "카카오사용자";

    if (!kakaoId) {
      return res.status(401).json({ error: "카카오 사용자 ID 없음" });
    }

    // Supabase profiles.id 컬럼 호환성 + 멱등성을 위해 결정적 UUID로 변환.
    // kakao_id가 같으면 항상 같은 uid가 나오므로 재로그인 시 같은 계정으로 매핑됨.
    const uid = uuidv5(`kakao_${kakaoId}`, KAKAO_NAMESPACE);
    // 이메일도 UID 기반으로 — 옛 형식(`kakao_<id>@`)과 충돌 회피.
    const syntheticEmail = `${uid}@donifin.app`;

    // ── 2. Firebase Auth 사용자 생성 or 확인 ────────────────
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(uid);
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        userRecord = await admin.auth().createUser({
          uid,
          email: syntheticEmail,
          displayName: nickname,
          emailVerified: false,
        });
        logger.info(`Firebase user 생성: ${uid} (${nickname})`);
      } else {
        throw e;
      }
    }

    // ── 3. Supabase profiles 초기 row 생성 (없을 때만) ──────
    try {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", uid)
        .maybeSingle();
      if (!existing) {
        await supabase.from("profiles").insert({
          id: uid,
          name: nickname,
          email: syntheticEmail,
        });
      }
    } catch (e) {
      // 프로필 생성 실패는 치명적이지 않음 — 나중에 saveProfile에서 처리됨.
      logger.warn("profiles 초기 row 생성 실패:", e?.message || e);
    }

    // ── 4. Custom Token 발급 ───────────────────────────────
    const firebaseToken = await admin.auth().createCustomToken(uid, {
      provider: "kakao",
      kakao_id: kakaoId,
    });

    return res.status(200).json({
      firebase_token: firebaseToken,
      uid,
      nickname,
    });
  } catch (err) {
    logger.error("kakaoLogin error:", err);
    return res
      .status(500)
      .json({ error: "카카오 로그인 처리 실패", detail: err?.message });
  }
});
