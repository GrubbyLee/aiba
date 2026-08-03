let sessionToken = "";

function loginCode() {
  return new Promise(function(resolve, reject) {
    wx.login({
      success: function(result) {
        if (result && typeof result.code === "string" && result.code.length >= 8) {
          resolve(result.code);
          return;
        }
        reject(new Error("WeChat login code is unavailable"));
      },
      fail: function() {
        reject(new Error("WeChat login is unavailable"));
      },
    });
  });
}

function exchange(code) {
  const app = getApp();
  return new Promise(function(resolve, reject) {
    wx.request({
      url: app.globalData.apiBaseUrl + "/auth/wechat/session",
      method: "POST",
      data: { code: code },
      success: function(response) {
        const body = response.data;
        const keys = body && typeof body === "object" ? Object.keys(body).sort() : [];
        const allowed = ["issuedAt", "principal", "token"];
        if (
          response.statusCode >= 200
          && response.statusCode < 300
          && keys.length === allowed.length
          && keys.every(function(key, index) { return key === allowed[index]; })
          && typeof body.token === "string"
          && body.token.length >= 16
          && body.principal
          && body.principal.type === "user"
        ) {
          sessionToken = body.token;
          resolve({ principal: body.principal, issuedAt: body.issuedAt });
          return;
        }
        reject(new Error("WeChat authentication was rejected"));
      },
      fail: function() {
        reject(new Error("Authentication service is unavailable"));
      },
    });
  });
}

function authenticate() {
  return loginCode().then(exchange);
}

function currentSessionToken() {
  return sessionToken;
}

function clearSession() {
  sessionToken = "";
}

module.exports = {
  authenticate: authenticate,
  currentSessionToken: currentSessionToken,
  clearSession: clearSession,
};
