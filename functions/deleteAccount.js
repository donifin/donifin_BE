const { onRequest } = require("firebase-functions/v2/https");
const { createClient } = require("@supabase/supabase-js");
const { setCorsHeaders } = require("./config");

/**
 * DELETE /deleteAccount
 * body: { user_id: string }
 *
 * Supabase에서 해당 유저의 모든 데이터를 삭제.
 * 삭제 순서: 자식 테이블 먼저 → profiles 마지막.
 *   notifications → comment_likes → post_likes → bookmarks → comments → posts → profiles
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
    // 1. notifications
    await supabase.from("notifications").delete().eq("user_id", user_id);

    // 2. comment_likes
    await supabase.from("comment_likes").delete().eq("user_id", user_id);

    // 3. post_likes
    await supabase.from("post_likes").delete().eq("user_id", user_id);

    // 4. bookmarks
    await supabase.from("bookmarks").delete().eq("user_id", user_id);

    // 5. comments (내가 쓴 댓글)
    await supabase.from("comments").delete().eq("user_id", user_id);

    // 6. 내 게시글에 달린 댓글/좋아요/북마크 먼저 삭제 후 posts
    const { data: myPosts } = await supabase
      .from("posts")
      .select("id")
      .eq("user_id", user_id);

    if (myPosts && myPosts.length > 0) {
      const postIds = myPosts.map((p) => p.id);
      await supabase.from("comments").delete().in("post_id", postIds);
      await supabase.from("post_likes").delete().in("post_id", postIds);
      await supabase.from("bookmarks").delete().in("post_id", postIds);
      await supabase.from("posts").delete().in("id", postIds);
    }

    // 7. profiles (마지막)
    await supabase.from("profiles").delete().eq("id", user_id);

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[deleteAccount] error:", e);
    return res.status(500).json({ error: e.message });
  }
});
