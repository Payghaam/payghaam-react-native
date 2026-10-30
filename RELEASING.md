# Releasing `@payghaam/react-native`

Releases are cut by pushing a tag. `.github/workflows/publish.yml` does the rest
and authenticates to npm with OIDC — there is no `NPM_TOKEN` in this repo and
there should never be one.

## One-time setup

This has to be done once per package, on npmjs.com, before any tagged release
can work.

1. Go to **npmjs.com → Packages → @payghaam/react-native → Settings → Trusted
   publishing** and add a publisher.
2. Choose **GitHub Actions** and fill in:

   | Field | Value |
   | --- | --- |
   | Organization or user | `Payghaam` |
   | Repository | `payghaam-react-native` |
   | Workflow filename | `publish.yml` |
   | Environment name | *(leave blank)* |

3. **Allowed actions — this is the one that bites.** npm changed the default on
   3 September 2026: publishers created after that date are set to allow
   `npm stage publish` only. This workflow runs `npm publish`, so you must tick
   **`npm publish`** as well, or the first release fails with `ENEEDAUTH` and
   the error will not tell you why.

   If you would rather keep the stricter default, that is a legitimate choice —
   change the last line of `publish.yml` to `npm stage publish` and approve each
   release with 2FA from the CLI or npmjs.com. Do not leave the two out of sync.

Every field is case-sensitive and npm does not validate any of them when you
save. A typo surfaces only as an authentication failure at publish time.

Afterwards, go to **Settings → Publishing access → "Require two-factor
authentication and disallow tokens"**, and revoke any `NPM_TOKEN`-style
automation tokens that were ever created for this package. Trusted publishing
keeps working — it does not use tokens — so the only thing this locks out is the
credential you no longer need. Leaving an unused publish token alive is the
whole risk that trusted publishing exists to remove.

## Cutting a release

```bash
# 1. Make sure main is green and you are on it
git checkout main && git pull

# 2. Bump the version. This writes package.json + package-lock.json,
#    commits both, and creates the matching v<version> tag.
npm version patch     # or minor / major

# 3. Push the commit and the tag
git push && git push --tags
```

The workflow checks the tag matches `package.json` before installing anything,
runs typecheck / build / test, then publishes.

`npm version` is what keeps the tag and the version in step. Writing the version
by hand and tagging separately is how they drift, and publishing a version under
the wrong tag cannot be undone — npm will not let that version number be reused
even after `npm unpublish`.

## Checking it worked

Publishing is near-instant:

```bash
npm view @payghaam/react-native versions
```

Then check the package page on npmjs.com for the **provenance** badge. Its
presence is the proof that the release came from this workflow in this
repository, rather than from someone's laptop. If it is missing, the publish
fell back to some other credential and the trusted publisher is not actually in
use — worth fixing before the next release rather than after.

## A coupling worth remembering

This package is a thin wrapper over the native SDKs (`com.payghaam:payghaam` on
Android, the `Payghaam` pod on iOS). A JS release that expects native behaviour
which is not in a published native version yet will fail at runtime in a
consumer's app, not here — nothing in this repo's tests can catch it.

If a release depends on new native behaviour, publish the native SDK first and
pin the version in the podspec / gradle dependency before tagging this one.
