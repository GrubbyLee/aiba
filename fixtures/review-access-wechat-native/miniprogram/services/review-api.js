let sessionToken = "";

function request(path, data) {
  const app = getApp();
  return new Promise(function(resolve, reject) {
    wx.request({
      url: app.globalData.apiBaseUrl + path,
      method: "POST",
      data: data,
      success: function(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(new Error("Review request was denied"));
      },
      fail: function() {
        reject(new Error("Review service is unavailable"));
      },
    });
  });
}

function authenticateReview(credential) {
  const app = getApp();
  return request("/review/session", {
    credential: credential,
    releaseId: app.globalData.releaseId,
  }).then(function(session) {
    sessionToken = session.token;
    return session;
  });
}

function loadReviewCatalog() {
  if (!sessionToken) {
    return Promise.reject(new Error("Review session is missing"));
  }
  return request("/review/catalog", { sessionToken: sessionToken });
}

function clearReviewSession() {
  sessionToken = "";
}

module.exports = {
  authenticateReview: authenticateReview,
  loadReviewCatalog: loadReviewCatalog,
  clearReviewSession: clearReviewSession,
};
