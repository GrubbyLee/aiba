const wechatAuth = require("./wechat-auth");

function listVehicles(limit) {
  const token = wechatAuth.currentSessionToken();
  if (!token) return Promise.reject(new Error("Application session is missing"));
  const app = getApp();
  return new Promise(function(resolve, reject) {
    wx.request({
      url: app.globalData.apiBaseUrl + "/api/vehicles?limit=" + encodeURIComponent(String(limit)),
      method: "GET",
      header: {
        accept: "application/json",
        "x-aiba-session": token,
      },
      success: function(response) {
        if (
          response.statusCode >= 200
          && response.statusCode < 300
          && response.data
          && Array.isArray(response.data.items)
        ) {
          resolve(response.data);
          return;
        }
        reject(new Error("Vehicle request was rejected"));
      },
      fail: function() {
        reject(new Error("Vehicle service is unavailable"));
      },
    });
  });
}

module.exports = { listVehicles: listVehicles };
