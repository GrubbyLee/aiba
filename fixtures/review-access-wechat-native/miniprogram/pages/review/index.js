const reviewApi = require("../../services/review-api");

Page({
  data: {
    credential: "",
    pending: false,
    status: "idle",
    catalog: [],
  },

  onCredentialInput: function(event) {
    this.setData({ credential: event.detail.value });
  },

  submitReviewAccess: function() {
    const page = this;
    if (!this.data.credential || this.data.pending) return;
    this.setData({ pending: true, status: "authenticating" });
    reviewApi.authenticateReview(this.data.credential)
      .then(function() {
        return reviewApi.loadReviewCatalog();
      })
      .then(function(result) {
        page.setData({
          credential: "",
          pending: false,
          status: "authorized",
          catalog: result.items,
        });
      })
      .catch(function() {
        reviewApi.clearReviewSession();
        page.setData({
          credential: "",
          pending: false,
          status: "denied",
          catalog: [],
        });
      });
  },
});
