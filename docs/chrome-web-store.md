# Chrome Web Store

Console: https://chrome.google.com/webstore/devconsole

## One time

- Register a developer account (one-time fee, currently 5 USD).
- Host the privacy policy at a public URL.

## First submission

1. Download `briefme-<version>-chrome.zip` from the GitHub release.
2. Console: Add new item, upload the zip.
3. Store listing: description and category from [store-listing.md](store-listing.md); add screenshots and the promo tile.
4. Privacy tab: single purpose, permission justifications, data disclosure and privacy policy URL, all from [store-listing.md](store-listing.md). Answer that no user data is collected by the developer.
5. Distribution: visibility and regions.
6. Submit for review. Reviews often take a few days; broad or optional host permissions can slow them down, so keep the justification text clear.

## Updates

Publish a new GitHub release, upload its zip to the same item, submit. The version must be higher than the published one.

## Notes

- Optional host permission `*://*/*` is declared so the extension can ask for one server at a time. Say this in the justification.
- Edge uses the same zip: [edge-addons.md](edge-addons.md).
