const wechatAuth = require("../../services/wechat-auth");
const vehicleApi = require("../../services/vehicle-api");

Page({
  data: {
    status: "loading",
    vehicles: [],
  },

  onLoad: function() {
    this.loadVehicles();
  },

  loadVehicles: function() {
    const page = this;
    this.setData({ status: "loading" });
    wechatAuth.authenticate()
      .then(function() { return vehicleApi.listVehicles(50); })
      .then(function(result) {
        page.setData({ status: "ready", vehicles: result.items });
      })
      .catch(function() {
        wechatAuth.clearSession();
        page.setData({ status: "unavailable", vehicles: [] });
      });
  },
});
