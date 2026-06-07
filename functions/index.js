require("dotenv").config();

const { setGlobalOptions } = require("firebase-functions");
setGlobalOptions({ maxInstances: 10 });

// ── 클라우드 함수 등록 ────────────────────────────────────────
const { getProducts }             = require("./products");
const { chatBot }                 = require("./chatbot");
const { getPersonalityQuestions,
        personalityTest }         = require("./personality");
const { getNews, searchAll }      = require("./news");
const { getCommunityPosts,
        getPost,
        createPost,
        updatePost,
        deletePost,
        getComments,
        createComment,
        updateComment,
        deleteComment }           = require("./community");
const { saveProfile }             = require("./profile");
const { getQuiz }                 = require("./quiz");
const { getNotifications,
        markAllNotificationsRead } = require("./notifications");
const { togglePostLike,
        toggleCommentLike,
        togglePostBookmark }      = require("./likes");
const { kakaoLogin }              = require("./kakaoAuth");

// ── 내보내기 ─────────────────────────────────────────────────
module.exports = {
  getProducts,
  chatBot,
  getPersonalityQuestions,
  personalityTest,
  getNews,
  searchAll,
  getCommunityPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getComments,
  createComment,
  updateComment,
  deleteComment,
  saveProfile,
  getQuiz,
  getNotifications,
  markAllNotificationsRead,
  togglePostLike,
  toggleCommentLike,
  togglePostBookmark,
  kakaoLogin,
};
