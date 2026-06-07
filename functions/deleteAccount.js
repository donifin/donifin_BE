const { onRequest } = require("firebase-functions/v2/https");
const { createClient } = require("@supabase/supabase-js");
const admin = require("firebase-admin");
const { setCorsHeaders } = require("./config");

if (!admin.apps.length) admin.initializeApp();

/**
 * POST /deleteAccount
 * body: { user_id: string }
 *
 * 1. Supabase 전체 데이터 삭제 (service_role 키로 RLS 우회)
 * 2. Firebase Auth 계정 삭제 (Admin SDK — 세션 상태 무관하게 강제 삭제)
 * 삭제 순서: notifications → comment_likes → post_likes → bookmarks → comments → posts → profiles
 */
exports.deleteAccount = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id 필요" });

  // service_role 키 사용 — RLS 우회하여 profiles 포함 전체 삭제 가능
  const supabase = createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || ""
  );

  try {
    // ── Supabase 데이터 삭제 ──────────────────────────────
    await supabase.from("notifications").delete().eq("user_id", user_id);
    await supabase.from("comment_likes").delete().eq("user_id", user_id);
    await supabase.from("post_likes").delete().eq("user_id", user_id);
    await supabase.from("bookmarks").delete().eq("user_id", user_id);
    await supabase.from("comments").delete().eq("user_id", user_id);

    const { data: myPosts } = await supabase
      .from("posts").select("id").eq("user_id", user_id);

    if (myPosts && myPosts.length > 0) {
      const postIds = myPosts.map((p) => p.id);
      await supabase.from("comments").delete().in("post_id", postIds);
      await supabase.from("post_likes").delete().in("post_id", postIds);
      await supabase.from("bookmarks").delete().in("post_id", postIds);
      await supabase.from("posts").delete().in("id", postIds);
    }

    await supabase.from("profiles").delete().eq("id", user_id);

    // ── Firebase Auth 계정 삭제 (Admin SDK) ──────────────
    try {
      await admin.auth().deleteUser(user_id);
    } catch (authErr) {
      // 이미 삭제된 계정이면 무시
      if (authErr.code !== "auth/user-not-found") {
        console.warn("[deleteAccount] Firebase Auth 삭제 실패:", authErr.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[deleteAccount] error:", e);
    return res.status(500).json({ error: e.message });
  }
});
