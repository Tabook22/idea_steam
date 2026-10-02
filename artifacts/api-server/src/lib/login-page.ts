import { readdirSync } from "node:fs";

export type LoginError = "invalid" | "throttled" | "signed-out" | undefined;

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The app's own fonts, when the built frontend is available (they are public and served before sign-in). */
function findFonts(dist = process.env.FRONTEND_DIST) {
  try {
    const files = dist ? readdirSync(`${dist}/assets`) : [];
    const pick = (prefix: string) => files.find((file) => file.startsWith(prefix) && file.endsWith(".woff2"));
    return {
      sans: pick("dm-sans-latin-wght-normal-"),
      serif: pick("playfair-display-latin-wght-normal-"),
      serifItalic: pick("playfair-display-latin-wght-italic-"),
    };
  } catch {
    return {};
  }
}
let fonts: ReturnType<typeof findFonts> | undefined;

const messages = {
  invalid: ["That username and password don't match. Please try again.", "اسم المستخدم أو كلمة المرور غير صحيحة. حاول مرة أخرى."],
  throttled: ["Too many attempts. Please wait a minute, then try again.", "محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا."],
  "signed-out": ["You've been signed out.", "تم تسجيل خروجك."],
} as const;

export function loginPage({ base, next, error, username = "" }: {
  base: string; next: string; error?: LoginError; username?: string;
}) {
  fonts ??= findFonts();
  const face = (family: string, file: string | undefined, style = "normal") => file
    ? `@font-face{font-family:"${family}";src:url("${base}/assets/${file}") format("woff2");font-weight:100 900;font-style:${style};font-display:swap}`
    : "";
  const notice = error ? messages[error] : null;
  const isError = error === "invalid" || error === "throttled";
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Sign in · Idea Stream</title>
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">
<link rel="manifest" href="${base}/manifest.webmanifest">
<style>
${face("DM Sans Variable", fonts.sans)}
${face("Playfair Display Variable", fonts.serif)}
${face("Playfair Display Variable", fonts.serifItalic, "italic")}
:root{
  --bg:hsl(43 20% 96%);--card:hsl(43 30% 99%);--fg:hsl(160 40% 12%);--muted:hsl(160 15% 42%);
  --border:hsl(43 15% 85%);--primary:hsl(155 35% 25%);--primary-hover:hsl(155 38% 20%);--on-primary:hsl(43 20% 96%);
  --accent:hsl(20 50% 55%);--field:hsl(43 25% 97%);--ring:hsl(155 35% 25% / .18);
  --danger-bg:hsl(0 70% 97%);--danger-fg:hsl(0 55% 38%);--danger-border:hsl(0 60% 88%);
  --info-bg:hsl(155 30% 95%);--info-fg:hsl(155 35% 22%);
  --sans:"DM Sans Variable",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
  --serif:"Playfair Display Variable",Georgia,"Times New Roman",serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:hsl(160 25% 7%);--card:hsl(160 20% 10%);--fg:hsl(43 25% 92%);--muted:hsl(155 10% 65%);
  --border:hsl(160 12% 20%);--primary:hsl(152 32% 52%);--primary-hover:hsl(152 34% 58%);--on-primary:hsl(160 30% 8%);
  --field:hsl(160 18% 8%);--ring:hsl(152 32% 52% / .25);
  --danger-bg:hsl(0 35% 14%);--danger-fg:hsl(0 70% 80%);--danger-border:hsl(0 30% 26%);
  --info-bg:hsl(155 25% 13%);--info-fg:hsl(152 30% 75%);
}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100vh;min-height:100dvh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);
  background:var(--bg);color:var(--fg);font-family:var(--sans);-webkit-font-smoothing:antialiased}
.story{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;
  padding:clamp(32px,5vw,64px);background:hsl(155 35% 20%);color:hsl(43 25% 94%)}
.story::before,.story::after{content:"";position:absolute;border-radius:50%;filter:blur(2px);pointer-events:none}
.story::before{width:520px;height:520px;right:-180px;top:-160px;background:radial-gradient(circle,hsl(20 50% 55% / .35),transparent 65%)}
.story::after{width:600px;height:600px;left:-220px;bottom:-260px;background:radial-gradient(circle,hsl(152 40% 45% / .35),transparent 65%)}
.brand{position:relative;display:flex;align-items:center;gap:12px;font-weight:600;font-size:20px;letter-spacing:-.01em;color:inherit;text-decoration:none}
.brand span b{font-weight:400}
.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:hsl(43 25% 94% / .12);border:1px solid hsl(43 25% 94% / .18)}
.story h1{position:relative;font-family:var(--serif);font-weight:500;font-size:clamp(36px,4.2vw,56px);line-height:1.08;letter-spacing:-.02em;margin:0 0 18px;max-width:12ch}
.story h1 em{color:hsl(28 70% 72%)}
.story p{position:relative;margin:0;max-width:40ch;font-size:16px;line-height:1.7;color:hsl(43 20% 88% / .85)}
.story .ar{margin-top:14px;font-size:15px;color:hsl(43 20% 88% / .7)}
.story small{position:relative;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:hsl(43 20% 88% / .6)}
main{display:flex;align-items:center;justify-content:center;padding:clamp(24px,5vw,64px) 16px}
.panel{width:100%;max-width:400px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
h2{font-family:var(--serif);font-weight:500;font-size:34px;line-height:1.15;letter-spacing:-.015em;margin:0 0 8px}
.lead{margin:0 0 28px;color:var(--muted);font-size:15px;line-height:1.6}
.notice{display:flex;gap:10px;align-items:flex-start;margin:0 0 20px;padding:12px 14px;border-radius:12px;font-size:14px;line-height:1.5;
  background:var(--info-bg);color:var(--info-fg)}
.notice.error{background:var(--danger-bg);color:var(--danger-fg);border:1px solid var(--danger-border)}
.notice svg{flex:none;margin-top:2px}
.notice span[lang=ar]{display:block;margin-top:2px;opacity:.85}
.story .ar,.notice span[lang=ar]{text-align:left}
label{display:block;margin:0 0 8px;font-size:14px;font-weight:500}
.field{position:relative;margin-bottom:18px}
input{width:100%;height:50px;padding:0 16px;border:1px solid var(--border);border-radius:12px;background:var(--field);color:var(--fg);
  font:inherit;font-size:16px;transition:border-color .15s,box-shadow .15s}
input:hover{border-color:hsl(155 15% 65%)}
input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 4px var(--ring)}
.field.password input{padding-inline-end:52px}
.toggle{position:absolute;inset-inline-end:6px;bottom:6px;width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:9px;
  background:transparent;color:var(--muted);cursor:pointer}
.toggle:hover{background:var(--ring);color:var(--fg)}
.toggle:focus-visible{outline:2px solid var(--primary);outline-offset:1px}
.toggle .hide,.toggle[aria-pressed=true] .show{display:none}
.toggle[aria-pressed=true] .hide{display:block}
.submit{width:100%;height:52px;margin-top:8px;border:0;border-radius:12px;background:var(--primary);color:var(--on-primary);
  font:inherit;font-size:16px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  box-shadow:0 8px 24px -10px hsl(155 35% 25% / .6);transition:background .15s,transform .1s}
.submit:hover{background:var(--primary-hover)}
.submit:active{transform:translateY(1px)}
.submit:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
.submit[disabled]{opacity:.75;cursor:progress}
.spinner{display:none;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
.submit[disabled] .spinner{display:block}
@keyframes spin{to{transform:rotate(360deg)}}
.foot{margin-top:28px;padding-top:20px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:center;color:var(--muted);font-size:13px;line-height:1.5}
.foot svg{flex:none}
@media (max-width:860px){
  body{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  .story{padding:24px 20px 28px}
  .story .copy{margin-top:28px}
  .story h1{font-size:32px;max-width:none}
  .story p.en{font-size:15px}
  .story .ar,.story small{display:none}
  main{align-items:flex-start;padding-top:32px}
  h2{font-size:28px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<aside class="story" aria-hidden="false">
  <a class="brand" href="${base}/" aria-label="Idea Stream">
    <span class="mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg></span>
    <span>idea<b>stream</b></span>
  </a>
  <div class="copy">
    <h1>Big things start with a <em>little idea.</em></h1>
    <p class="en">Your private notebook for passing thoughts, voice notes, and sources, ready to become something finished.</p>
    <p class="ar" lang="ar" dir="rtl">دفترك الخاص للأفكار العابرة والملاحظات الصوتية والمصادر.</p>
  </div>
  <small>Private workspace</small>
</aside>
<main>
  <div class="panel">
    <p class="eyebrow">Welcome back</p>
    <h2>Sign in to your notebook</h2>
    <p class="lead">Enter your credentials to continue where you left off.</p>
    ${notice ? `<div class="notice${isError ? " error" : ""}" role="${isError ? "alert" : "status"}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${isError
        ? '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
        : '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'}</svg>
      <div><span>${notice[0]}</span><span lang="ar" dir="rtl">${notice[1]}</span></div>
    </div>` : ""}
    <form method="post" action="${base}/login" novalidate>
      <input type="hidden" name="next" value="${escape(next)}">
      <div class="field">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escape(username)}"${username ? "" : " autofocus"}>
      </div>
      <div class="field password">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required${username ? " autofocus" : ""}>
        <button class="toggle" type="button" aria-label="Show password" aria-pressed="false" aria-controls="password">
          <svg class="show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
          <svg class="hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
        </button>
      </div>
      <button class="submit" type="submit"><span class="spinner" aria-hidden="true"></span><span class="label">Sign in</span></button>
    </form>
    <p class="foot">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      Private, single-owner workspace. You'll stay signed in on this device for 30 days.
    </p>
  </div>
</main>
<script>
(function(){
  var toggle=document.querySelector('.toggle'),field=document.getElementById('password');
  toggle.addEventListener('click',function(){
    var shown=field.type==='text';field.type=shown?'password':'text';
    toggle.setAttribute('aria-pressed',String(!shown));
    toggle.setAttribute('aria-label',shown?'Show password':'Hide password');field.focus();
  });
  var form=document.querySelector('form');
  form.addEventListener('submit',function(event){
    var user=document.getElementById('username');
    if(!user.value.trim()){event.preventDefault();user.focus();return;}
    if(!field.value){event.preventDefault();field.focus();return;}
    var button=form.querySelector('.submit');button.disabled=true;button.querySelector('.label').textContent='Signing in…';
  });
  window.addEventListener('pageshow',function(){var b=form.querySelector('.submit');b.disabled=false;b.querySelector('.label').textContent='Sign in';});
})();
</script>
</body>
</html>`;
}
