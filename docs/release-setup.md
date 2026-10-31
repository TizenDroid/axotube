# Release setup (one-time)

Three things must be set up once before CI can ship installers that upgrade cleanly
and publish page bundles automatically.

## 1. Android release signing (needed for APK upgrades)

A debug-signed APK cannot replace an installed release build. Every CI runner also
creates a new debug key, so debug builds only install over each other after an
uninstall. Use one release keystore for every build.

Create the keystore once, on your own computer:

    keytool -genkeypair -v -keystore axotube-release.jks -alias axotube \
      -keyalg RSA -keysize 2048 -validity 10000

Then encode it for GitHub:

    base64 -w0 axotube-release.jks > axotube-release.jks.b64

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the contents of `axotube-release.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `axotube` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

Keep a backup of `axotube-release.jks` and its passwords somewhere safe. If the key
is lost, installed copies can never be upgraded in place again. Do not commit the
`.jks` file; `.gitignore` already excludes `.android-signing/`, so store the backup
there or outside the repository.

Tagged releases (`v*`) refuse to build without these secrets.

## 2. npm token for the page bundle

CI publishes the `axotube` npm package (the name in the root `package.json` `bundlePackage`
field) when a new version lands on `main`.

1. On npmjs.com, create an **Automation** access token with publish rights.
2. Add it as the repository secret `NPM_TOKEN`.

The publish step skips any version that already exists on npm, so re-running CI does
not fail.

Because this is the `axotube` package, each bundle release becomes its `latest` tag. The
old 1.15.14 release stays installable by exact version (`npm i axotube@1.15.14`), but a
plain `npm i axotube` will now install the bundle. If anything depends on the old
package, pin it to that version before the first publish.

## 3. Branch rules for `dist/`

CI commits a fresh `dist/` to `main` after each successful build. If branch
protection blocks pushes from `github-actions[bot]`, either allow that bot to bypass
the rule for `main`, or build and commit `dist/` yourself before each merge. Pull
requests fail when `dist/` is stale, so the committed build always matches the
source.
