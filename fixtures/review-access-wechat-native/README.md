# Native WeChat Mini Program Surface

This fixture validates AIBA semantics in an ordinary native WeChat Mini Program
without CloudBase or a web SDK. It exercises the review-access flow and a
one-time `wx.login` exchange, keeps the application session inside the service
layer, and sends no tenant or authorization claims.

`project.config.json` intentionally uses `touristappid`; this repository does not
upload or publish the fixture. Run:

```bash
pnpm --filter @aiba/fixture-review-access-wechat-native test
pnpm --filter @aiba/fixture-review-access-wechat-native check:miniprogram
```

Real-device validation requires replacing the AppID locally, configuring the
server domain in WeChat, and completing the normal upload whitelist checks.
