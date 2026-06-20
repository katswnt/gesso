# Gesso auth email templates (Supabase)

Paste into Supabase → Authentication → **Email Templates**. Each uses Supabase's
`{{ .ConfirmationURL }}` variable. NOTE: custom templates + reliable delivery require
**custom SMTP** (Authentication → Settings → SMTP) — the built-in sender is rate-limited
and only sends to team members. Brand: ultramarine `#2230b8`, ink `#1b1916`, calm museum voice.

---

## Confirm signup
**Subject:** `Confirm your email for Gesso`

```html
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1b1916;line-height:1.55">
  <p style="font:700 22px Georgia,serif;margin:0 0 4px">Welcome to Gesso</p>
  <p style="font-size:13px;color:#6a645b;margin:0 0 20px;letter-spacing:.02em">
    <strong>ges·so</strong> — the white primer brushed onto a canvas before the first brushstroke
  </p>
  <p>Tap below to confirm your email and start your streak. You'll keep your rank and progress across every device you play on.</p>
  <p style="margin:26px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Confirm my email</a>
  </p>
  <p style="font-size:13px;color:#6a645b">If the button doesn't work, paste this link into your browser:<br>
    <a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a>
  </p>
  <p style="font-size:12px;color:#9a948a;margin-top:24px;border-top:1px solid #e6e2d8;padding-top:14px">
    Didn't sign up for Gesso? You can safely ignore this email — no account will be created.
  </p>
</div>
```

---

## Magic Link
**Subject:** `Your Gesso sign-in link`

```html
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1b1916;line-height:1.55">
  <p style="font:700 22px Georgia,serif;margin:0 0 16px">Sign in to Gesso</p>
  <p>Here's your one-tap sign-in link. It expires shortly and can only be used once.</p>
  <p style="margin:26px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Sign in to Gesso</a>
  </p>
  <p style="font-size:13px;color:#6a645b">Or paste this link into your browser:<br>
    <a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a>
  </p>
  <p style="font-size:12px;color:#9a948a;margin-top:24px;border-top:1px solid #e6e2d8;padding-top:14px">
    Didn't request this? Ignore this email — your account stays locked.
  </p>
</div>
```

---

## Reset password
**Subject:** `Reset your Gesso password`

```html
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1b1916;line-height:1.55">
  <p style="font:700 22px Georgia,serif;margin:0 0 16px">Reset your password</p>
  <p>Tap below to choose a new password for your Gesso account. If you didn't ask for this, nothing has changed — just ignore this email.</p>
  <p style="margin:26px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Choose a new password</a>
  </p>
  <p style="font-size:13px;color:#6a645b">Or paste this link into your browser:<br>
    <a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a>
  </p>
  <p style="font-size:12px;color:#9a948a;margin-top:24px;border-top:1px solid #e6e2d8;padding-top:14px">
    This link expires shortly and can only be used once.
  </p>
</div>
```

---

## Change email address
**Subject:** `Confirm your new email for Gesso`

```html
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1b1916;line-height:1.55">
  <p style="font:700 22px Georgia,serif;margin:0 0 16px">Confirm your new email</p>
  <p>Tap below to confirm this address as the new email for your Gesso account. Your rank, streak, and progress stay exactly as they are.</p>
  <p style="margin:26px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#2230b8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Confirm new email</a>
  </p>
  <p style="font-size:13px;color:#6a645b">Or paste this link into your browser:<br>
    <a href="{{ .ConfirmationURL }}" style="color:#2230b8;word-break:break-all">{{ .ConfirmationURL }}</a>
  </p>
  <p style="font-size:12px;color:#9a948a;margin-top:24px;border-top:1px solid #e6e2d8;padding-top:14px">
    Didn't request this change? Ignore this email and your address stays the same.
  </p>
</div>
```
