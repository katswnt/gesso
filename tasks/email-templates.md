# Gesso auth email templates (Supabase) — on-brand

Paste into Supabase → Authentication → **Email Templates**. Uses `{{ .ConfirmationURL }}`.
Brand: warm bg `#e9e7e0`, cream card `#f6f4ee`, ink `#1b1916`, muted `#8a8472`, ultramarine `#2230b8`,
card line `#ddd8ca`. Bold sans (Archivo → falls back to a clean sans, NOT serif), IBM Plex Mono kicker,
the `gess·o` wordmark with its ultramarine dab. NOTE: needs custom SMTP for delivery.

---

## Confirm signup — Subject: `Confirm your email for Gesso`
```html
<div style="background:#e9e7e0;padding:28px 16px;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#f6f4ee;border:1px solid #ddd8ca;border-radius:14px;padding:30px">
    <div style="font:700 12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8472;margin-bottom:18px">gess<span style="display:inline-block;width:7px;height:7px;border-radius:50% 50% 50% 12%;background:#2230b8;margin:0 1px;vertical-align:middle"></span>o &middot; the daily art game</div>
    <h1 style="font:800 26px 'Archivo','Helvetica Neue',Arial,sans-serif;color:#1b1916;margin:0 0 6px">Welcome to Gesso</h1>
    <p style="font:400 13px 'IBM Plex Mono',ui-monospace,monospace;color:#8a8472;margin:0 0 22px"><strong style="color:#3a362d">ges&middot;so</strong> &middot; the white primer brushed onto a canvas before the first brushstroke</p>
    <p style="font-size:15px;line-height:1.6;color:#1b1916;margin:0 0 24px">Confirm your email to start your streak — your rank and progress will follow you across every device you play on.</p>
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font:700 15px 'Archivo','Helvetica Neue',Arial,sans-serif;padding:13px 26px;border-radius:9px;display:inline-block">Confirm my email &rarr;</a>
    <p style="font-size:13px;line-height:1.5;color:#8a8472;margin:24px 0 0">Button not working? Paste this link:<br><a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a></p>
    <p style="font-size:12px;color:#a59f8e;margin:22px 0 0;border-top:1px solid #ddd8ca;padding-top:14px">Didn't sign up for Gesso? Ignore this email — no account will be created.</p>
  </div>
</div>
```

## Magic Link — Subject: `Your Gesso sign-in link`
```html
<div style="background:#e9e7e0;padding:28px 16px;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#f6f4ee;border:1px solid #ddd8ca;border-radius:14px;padding:30px">
    <div style="font:700 12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8472;margin-bottom:18px">gess<span style="display:inline-block;width:7px;height:7px;border-radius:50% 50% 50% 12%;background:#2230b8;margin:0 1px;vertical-align:middle"></span>o &middot; the daily art game</div>
    <h1 style="font:800 26px 'Archivo','Helvetica Neue',Arial,sans-serif;color:#1b1916;margin:0 0 16px">Sign in to Gesso</h1>
    <p style="font-size:15px;line-height:1.6;color:#1b1916;margin:0 0 24px">Here's your one-tap sign-in link. It expires shortly and can only be used once.</p>
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font:700 15px 'Archivo','Helvetica Neue',Arial,sans-serif;padding:13px 26px;border-radius:9px;display:inline-block">Sign in &rarr;</a>
    <p style="font-size:13px;line-height:1.5;color:#8a8472;margin:24px 0 0">Or paste this link:<br><a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a></p>
    <p style="font-size:12px;color:#a59f8e;margin:22px 0 0;border-top:1px solid #ddd8ca;padding-top:14px">Didn't request this? Ignore this email — your account stays locked.</p>
  </div>
</div>
```

## Reset password — Subject: `Reset your Gesso password`
```html
<div style="background:#e9e7e0;padding:28px 16px;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#f6f4ee;border:1px solid #ddd8ca;border-radius:14px;padding:30px">
    <div style="font:700 12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8472;margin-bottom:18px">gess<span style="display:inline-block;width:7px;height:7px;border-radius:50% 50% 50% 12%;background:#2230b8;margin:0 1px;vertical-align:middle"></span>o &middot; the daily art game</div>
    <h1 style="font:800 26px 'Archivo','Helvetica Neue',Arial,sans-serif;color:#1b1916;margin:0 0 16px">Reset your password</h1>
    <p style="font-size:15px;line-height:1.6;color:#1b1916;margin:0 0 24px">Tap below to choose a new password. Didn't ask for this? Nothing has changed — just ignore this email.</p>
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font:700 15px 'Archivo','Helvetica Neue',Arial,sans-serif;padding:13px 26px;border-radius:9px;display:inline-block">Choose a new password &rarr;</a>
    <p style="font-size:13px;line-height:1.5;color:#8a8472;margin:24px 0 0">Or paste this link:<br><a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a></p>
    <p style="font-size:12px;color:#a59f8e;margin:22px 0 0;border-top:1px solid #ddd8ca;padding-top:14px">This link expires shortly and can only be used once.</p>
  </div>
</div>
```

## Change email — Subject: `Confirm your new email for Gesso`
```html
<div style="background:#e9e7e0;padding:28px 16px;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#f6f4ee;border:1px solid #ddd8ca;border-radius:14px;padding:30px">
    <div style="font:700 12px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8472;margin-bottom:18px">gess<span style="display:inline-block;width:7px;height:7px;border-radius:50% 50% 50% 12%;background:#2230b8;margin:0 1px;vertical-align:middle"></span>o &middot; the daily art game</div>
    <h1 style="font:800 26px 'Archivo','Helvetica Neue',Arial,sans-serif;color:#1b1916;margin:0 0 16px">Confirm your new email</h1>
    <p style="font-size:15px;line-height:1.6;color:#1b1916;margin:0 0 24px">Tap below to confirm this address for your Gesso account. Your rank, streak, and progress stay exactly as they are.</p>
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font:700 15px 'Archivo','Helvetica Neue',Arial,sans-serif;padding:13px 26px;border-radius:9px;display:inline-block">Confirm new email &rarr;</a>
    <p style="font-size:13px;line-height:1.5;color:#8a8472;margin:24px 0 0">Or paste this link:<br><a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a></p>
    <p style="font-size:12px;color:#a59f8e;margin:22px 0 0;border-top:1px solid #ddd8ca;padding-top:14px">Didn't request this change? Ignore this email and your address stays the same.</p>
  </div>
</div>
```
