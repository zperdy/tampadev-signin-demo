# Sign in with Tampa.dev

Add Tampa.dev authentication to your app with OAuth 2.1 + PKCE. Give your users single sign-on with the Tampa Bay tech community.

Check out this [live demo](https://tampadev-signin-demo.pages.dev).

[![Sign in with Tampa.dev](https://api.tampa.dev/assets/signin-button.svg)](https://tampa.dev/developer/docs/signin-with-tampadev) [![Sign in with Tampa.dev](https://api.tampa.dev/assets/signin-button.svg?theme=dark)](https://tampa.dev/developer/docs/signin-with-tampadev)

1. Register your app in the [Developer Portal](https://tampa.dev/developer) or via the dynamic client registration API
2. Redirect users to `https://tampa.dev/oauth/authorize` with PKCE parameters
3. Exchange the authorization code for an access token at `https://tampa.dev/oauth/token`
4. Use the token to call the Tampa.dev API (`https://api.tampa.dev/v1/me`, etc.)

Full integration guide: **https://tampa.dev/developer/docs/signin-with-tampadev**
