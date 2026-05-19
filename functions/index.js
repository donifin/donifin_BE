require("dotenv").config();

const { setGlobalOptions } = require("firebase-functions");
setGlobalOptions({ maxInstances: 10 });

// ── 클라우드 함수 등록 ────────────────────────────────────────
const { getProducts }             = require("./products");
const { chatBot }                 = require("./chatbot");
const { getPersonalityQuestions,
        personalityTest }         = require("./personality");
const { getNews }                 = require("./news");
const { getCommunityPosts,
        getPost,
        createPost,
        updatePost,
        deletePost,
        getComments,
        createComment,
        updateComment,
        deleteComment }           = require("./community");
const { recordProductView,
        getPopularProducts }      = require("./popular");
const { saveProfile }             = require("./profile");
const { getQuiz }                 = require("./quiz");

// ── 내보내기 ─────────────────────────────────────────────────
module.exports = {
  getProducts,
  chatBot,
  getPersonalityQuestions,
  personalityTest,
  getNews,
  getCommunityPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getComments,
  createComment,
  updateComment,
  deleteComment,
  recordProductView,
  getPopularProducts,
  saveProfile,
  getQuiz,
};
