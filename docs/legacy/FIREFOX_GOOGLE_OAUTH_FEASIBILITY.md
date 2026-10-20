> Historical / legacy reference. Not the default v0.1 sync setup. See [current Dropbox sync](../SYNC.md).

# Firefox / Zen Google OAuth feasibility

Assessment: **CONDITIONAL**, checked 2026-10-20. No production auth or sync code was changed. A documented candidate exists, but a working Google authorization-code/token exchange for this application has not been established. Do not present the current Firefox adapter or its mocked tests as proven Google login support.

## Official semantics

- Mozilla `identity.launchWebAuthFlow` handles authorization and returns a callback URL. It does not provide Chrome's `getAuthToken` cache or manage Google token refresh. Interactive flows must originate from a user action; silent flows may fail when user interaction is needed. [launchWebAuthFlow](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/launchWebAuthFlow)
- `getRedirectURL` derives the callback from the add-on ID. Mozilla warns that some providers, including Google, impose domain-ownership restrictions on its default dummy domain. Since Firefox 86, Mozilla also explicitly permits `http://127.0.0.1/mozoauth2/<redirect-subdomain>` as an alternative. This is browser-supported redirect interception, not an extension pretending to own an HTTP listener. [Mozilla identity setup](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity#setup)
- Google's Desktop app documentation describes public clients, PKCE S256, loopback redirects and an optional `client_secret` in the token exchange. That is the candidate client type for a separately verified Firefox implementation; it is not a reason to reuse the Chrome Extension client or embed a secret. [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- Google's web code-model guide routes code exchange and refresh-token handling through a backend. The current web-server reference labels `client_secret` optional in its general parameter table, so a blanket statement that every Google code exchange always requires a secret would be inaccurate. Those statements still do not establish a general public Web Application + Firefox PKCE contract. Registering an HTTPS redirect, or obtaining a code, alone does not prove secret-less exchange. [Google code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [web-server OAuth reference](https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code)
- Device Authorization is designed for TVs and other limited-input devices. `drive.appdata` is in its allowed scope list, but this does not make a desktop browser extension a validated device-client configuration; it also introduces a different user-code/polling flow. It was not selected or implemented. [Google device flow](https://developers.google.com/identity/protocols/oauth2/limited-input-device)
- Implicit tokens, deprecated OOB redirects, undisclosed client-secret distribution, Chrome-client reuse and simulated localhost listeners are not alternatives for this task.

## Actual Zen API probe

An unsigned temporary probe with the current build's ID `chat-explorer@local.invalid` was installed in a new isolated Zen profile. No signed-in/user profile, Google account or user token was accessed. Zen reported version 1.23.3b, Gecko 158.0. The environment could not launch sandboxed tab subprocesses in the initial attempt; the successful isolated API probe ran with out-of-process extensions disabled in that test profile only. This is an identity API check, not normal-profile Google login validation.

Actual `browser.identity.getRedirectURL('google')`:

```text
https://9b719694906f95c69763d62176c0137dfab4f833.extensions.allizom.org/google
```

Actual default `getRedirectURL()`:

```text
https://9b719694906f95c69763d62176c0137dfab4f833.extensions.allizom.org/
```

The documented loopback candidate derived from that default:

```text
http://127.0.0.1/mozoauth2/9b719694906f95c69763d62176c0137dfab4f833
```

The probe called the real `launchWebAuthFlow({interactive:false})` API against a local synthetic authorization endpoint that redirected to this loopback with dummy code/state values. Zen returned the callback successfully without a listener at the callback address. This confirms Mozilla's redirect handling only; it does not confirm Google's redirect admission, consent, token exchange or Drive access. Probe artifacts remain in ignored `.verification/`, outside the build/test inputs.

## Required gate before changing the Firefox adapter

1. In the Google Cloud project used by the working Chromium client, create a separate **Desktop app** OAuth client. Keep the existing Chrome Extension client intact. Configure Drive API and consent/test users with only `https://www.googleapis.com/auth/drive.appdata`. Use the public Desktop Client ID as `VITE_GOOGLE_CLIENT_ID_FIREFOX`. Do not provide a client secret to the extension.
2. Verify the exact Mozilla loopback candidate above against that Desktop client. Desktop loopback redirects do not use the Web Application authorized-HTTPS-redirect registration workflow. If the Console/client or Google authorization server rejects this configuration, stop; do not substitute an unverified URI/client workaround.
3. Complete real consent and code exchange with S256, exact redirect matching and state validation, omitting `client_secret`. A token-endpoint success with a valid code is required. Invalid/dummy-code requests would not prove this gate.
4. Verify token expiry/refresh or explicitly retain reconnect-required behavior. The existing adapter stores only a short-lived access token, requests no offline access and cannot refresh it. Firefox identity does not silently manage its lifecycle. Background sync must retain dirty state and never trigger an interactive prompt.
5. Verify that Chrome and the separate Desktop client see the same intended encrypted appDataFolder file, including its private application marker, using the same Google account/project. Then verify Sync Key/decrypt/preview/Apply, startup/idle/close, conflict and Drive request counts. Do not declare Chrome↔Zen interoperability until this passes.

No Firefox Client ID was configured during this investigation; Google Cloud Console registration and valid Google authorization/token exchange were not performed. No access/refresh tokens were generated or logged. No new auth adapter, refresh logic, permissions or backend was added.

## Extension identity

`browser_specific_settings.gecko.id` is already explicit. Keep the same ID for temporary development installs and the intended signed build if the same redirect is required; changing it changes the redirect. AMO requires an explicit ID for MV3 signing and checks uniqueness. A development/production ID split requires separately measured redirects. A browser fork can change identity behavior; the Zen runtime measurement above is the evidence for this version, not a guarantee for every fork/version. [getRedirectURL](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/getRedirectURL), [Gecko manifest ID](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings#id)

## If the candidate fails the gate

Keep Google Drive Sync on the verified Chromium path, or separately authorize a minimal confidential OAuth broker. A broker would keep the Web Application client secret server-side, bind authorization to an extension session (state/PKCE and a one-time completion handle), exchange/refresh tokens, and return short-lived access tokens. Refresh-token persistence would require encrypted credential storage or a deliberately designed extension-held credential scheme; an authentication broker is not automatically stateless.

The extension would still call Drive directly. The broker would receive no Explorer workspace, Sync Key or encrypted Drive snapshot, and use no D1 workspace storage. Its Web Application client would register the broker-owned HTTPS callback; Google would not redirect directly to the Mozilla dummy domain. Implementing or deploying such a service requires a separate task and security review of the token handoff. No broker was implemented here.
