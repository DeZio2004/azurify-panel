# Client portal

A page where each client signs in with a username and password to see their own
usage, connection links and QR codes, plus download links for the VPN apps.

- **Address:** `https://YOUR-DOMAIN:PANEL-PORT/clientportal/` (the panel port, not the
  secret panel path). It is served by the same process as the panel, so the
  installer sets it up with the panel.
- **Username / password:** the username is the client's email as entered in the
  panel. A password is generated for every client automatically (new clients,
  bulk-created and imported ones, and existing clients on first start).
- **Giving a client their login:** open the client's info dialog in the panel. The
  "Client portal" block shows the link, username and password, with copy buttons and
  a "New password" button.
- **Security:** wrong passwords are rate-limited (8 tries per 15 minutes per
  address and per username). Sessions last 12 hours and use a `SameSite=Strict`
  HttpOnly cookie. Serve it over https (set a certificate in the `azurify-ui` menu), or the
  password travels in clear text.

## App download links

The portal lists NPV Tunnel (iPhone/iPad, Android) and NetMod (Android). A Windows
NetMod link is not included because no official download page could be verified; set
it yourself. Every link can be overridden, or hidden by leaving it empty, in
`/etc/default/azurify-ui` (restart with `systemctl restart azurify-ui`):

```
PORTAL_NPV_IOS_URL=https://apps.apple.com/app/id1629465476
PORTAL_NPV_ANDROID_URL=https://play.google.com/store/search?q=NPV%20Tunnel&c=apps
PORTAL_NETMOD_ANDROID_URL=https://play.google.com/store/apps/details?id=com.netmod.syna
PORTAL_NETMOD_WINDOWS_URL=
```

## Importing the config

The portal gives the client a copy button and a QR code for each link. NPV Tunnel
lists import from QR codes, links and the clipboard in its App Store description.
No one-tap "open in app" link is used, because no documented URL scheme for NPV
Tunnel or NetMod could be confirmed.
