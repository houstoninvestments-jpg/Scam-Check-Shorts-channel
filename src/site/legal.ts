import type { ChannelConfig } from "../lib/config.js";
import { esc, page } from "./templates.js";

/**
 * Privacy policy and terms. Written from what the code does today; update these pages
 * before any new data use goes live (the tests check the key claims against config).
 */

export function privacyPage(c: ChannelConfig, root: string) {
  const email = esc(c.channel.contactEmail);
  const signupOn = Boolean(c.supabase.url && c.supabase.publishableKey);
  const passOn = c.familyPass.enabled;
  const drillOn = passOn && Boolean(c.site.fireDrillBaseUrl);
  const body = `
<h1>Privacy</h1>
<p class="small">Last updated ${esc(c.channel.policyDate)}</p>
<p class="lede">Short version: we collect ${passOn ? "very little" : "almost nothing"}. We never sell your information.</p>

<h2>What this site collects</h2>
<p><b>Your email, only if you sign up.</b> The site has a box to get the daily round by email.${
    signupOn ? "" : " Right now that box is turned off, so the site collects no email addresses at all."
  } When it is on, you can type in your email. We then save your email address and the date you signed up. We keep it in our database (Supabase). We use it only to send you the daily round.</p>
<p><b>${passOn ? "Nothing else for free visitors." : "Nothing else."}</b> The site has no ads, no tracking tools, and no visitor counters. Our site's code sets no cookies.</p>
${
  passOn
    ? `
<h2>If you buy the Family Pass</h2>
<p><b>Paying.</b> Stripe handles your payment. You type your card on Stripe's page, not ours. We never see or store your card number. See <a href="https://stripe.com/privacy" rel="noopener">Stripe's privacy policy</a>.</p>
<p><b>What we keep.</b> Your email, the date, the amount, and Stripe's payment number. We keep it in our database (Supabase).</p>
<p><b>Signing in.</b> We email you a sign-in link. Our email service, Resend, sends it for us.</p>
<p><b>Your family group.</b> We keep the group's name, the names you type for members, and the emails you invite. We also keep which days each person finished the round and their score. That is how streaks work.</p>${
        drillOn ? `
<p><b>Fire Drill.</b> When someone taps a practice link, we save only the time of the tap. Nothing about the person.</p>` : ""
      }
<p><b>Deleting it.</b> Email us and we will delete your account and family group within 30 days. We keep payment records only as long as the law requires.</p>
`
    : ""
}
<h2>What stays on your phone</h2>
<p>When you play the daily round, your score is saved in your own browser. So is your text size choice. Neither is sent to us. You can clear it by clearing your browser's site data.</p>

<h2>Our web host</h2>
<p>The site is hosted by Cloudflare. Cloudflare handles the traffic to the site, like any web host. It may keep basic records, such as visit times and browser types. We don't use those records to track you.</p>

<h2>YouTube API Services</h2>
<p>Scam or Not uses YouTube API Services. That is how our system posts our videos to YouTube and reads our own channel's numbers.</p>
<p>When you watch our videos on YouTube, you agree to the <a href="https://www.youtube.com/t/terms" rel="noopener">YouTube Terms of Service</a>. The <a href="http://www.google.com/policies/privacy" rel="noopener">Google Privacy Policy</a> explains how Google uses data.</p>
<p><b>What YouTube data we use.</b> Only data about our own Scam or Not channel. Our system does three things with it:</p>
<ul>
<li>It posts our own videos to our channel.</li>
<li>It checks the privacy setting of the videos it posted.</li>
<li>It reads stats for our own videos. That means views, how much people watch, and how many stay past the start.</li>
</ul>
<p><b>What we never see.</b> Your YouTube account, your name, your watch history or your comments. We can't tell who watched.</p>
<p><b>What we keep.</b> The ID, title and privacy setting of each video we posted. We keep the stats for each video for 30 days at most, then delete them. From those stats we keep one score per opening-line style. That score holds no personal data.</p>
<p><b>Who can turn it off.</b> Only the owner of the Scam or Not channel signs in to YouTube for our system. The owner can remove its access at any time on <a href="https://security.google.com/settings/security/permissions" rel="noopener">Google's security settings page</a>. Then our system can no longer post or read stats.</p>
<p><b>Getting data deleted.</b> Email us and we will delete stored YouTube data within 30 days.</p>

<h2>We never sell or share it</h2>
<p>We don't sell your information. We don't rent it or trade it. We don't give it to advertisers.</p>

<h2>How to get removed</h2>
<p>Email <a href="mailto:${email}">${email}</a> and ask us to delete your email address. We will delete it within 30 days and tell you when it's done.</p>

<h2>Kids</h2>
<p>This site and our videos are not made for children under 13. We don't knowingly collect anything from them. If you think a child signed up, email us and we will delete it.</p>

<h2>We never contact you first</h2>
<p>${esc(c.channel.never)} If someone says they are us and asks for money, it's a scam.</p>

<h2>Changes</h2>
<p>If we change how we use information, we will first update this page. We will also change the date at the top.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${email}">${email}</a>.</p>`;
  return page({ title: "Privacy | Scam or Not", description: "What Scam or Not collects (almost nothing) and how to get removed.", body, root, canonical: `${c.site.baseUrl}/privacy/` });
}

export function termsPage(c: ChannelConfig, root: string) {
  const email = esc(c.channel.contactEmail);
  // The Family Pass section appears only when the pass is switched on.
  const body = `
<h1>Terms</h1>
<p class="small">Last updated ${esc(c.channel.policyDate)}</p>
<p class="lede">Scam or Not is free${c.familyPass.enabled ? `. The optional Family Pass costs $${c.familyPass.priceUsd} once` : ""}. These are the simple rules for using it.</p>

<h2>What this is</h2>
<p>Scam or Not shows real scam messages and explains how to spot them. It is for learning. It is not legal, money, or police advice. Lost money to a scam? Call your bank first. Then report it where you live.</p>

<h2>How we make the messages</h2>
<p>Each scam comes from public warnings and reports, like those from government agencies. Some messages are recreated from those warnings. We swap out real links and phone numbers so nobody can tap a live scam. We link the sources on each scam's page.</p>
<p>The voice in our videos is made by AI. It comes from Kokoro, a free open voice model. The phone screens are made by code.</p>

<h2>We do our best, but we can be wrong</h2>
<p>We check every claim against its source before we post. Still, scams change fast, and we can make mistakes. Use your own judgment. When unsure, contact the company yourself, using a number or website you already trust.</p>

<h2>We never ask you for anything</h2>
<p>${esc(c.channel.never)} We will never ask for your passwords, codes, or bank details.</p>

<h2>Using our content</h2>
<p>You are welcome to share links to our pages and videos. Please don't copy whole pages or videos and post them as your own.</p>

<h2>YouTube</h2>
<p>Our videos are on YouTube, and we post them using YouTube API Services. When you watch them there, you agree to the <a href="https://www.youtube.com/t/terms" rel="noopener">YouTube Terms of Service</a>. Our <a href="../privacy/">privacy page</a> explains what YouTube data we use.</p>

<h2>Other websites</h2>
<p>We link to other sites, like the agencies we quote and YouTube. We don't control those sites. Their own rules apply there.</p>

${
  c.familyPass.enabled
    ? `<h2>Family Pass</h2>
<p><b>What you get.</b> You pay $${c.familyPass.priceUsd} one time. It covers you and up to ${c.familyPass.maxMembers - 1} family members. You all get every past round and big text. You also get a private family group with streaks${c.site.fireDrillBaseUrl ? ", plus Fire Drill" : ""}. There is no subscription.</p>
<p><b>Paying.</b> Stripe handles the payment. Prices are in US dollars.</p>
<p><b>Refunds.</b> Changed your mind? Within ${c.familyPass.refundDays} days of buying, tap "Refund my Family Pass" or email us. The refund ends access for your whole family group.</p>
<p><b>Changes.</b> We may improve or change the Family Pass features over time.</p>

`
    : ""
}<h2>Paid links</h2>
<p>If we ever add a paid link, we will label it "Paid link" right next to it.</p>

<h2>No promises</h2>
<p>We offer the site as it is. We don't promise it will always be online. We don't promise it is free of errors. We are not responsible for losses from using it, as far as the law allows.</p>

<h2>Changes</h2>
<p>We may update these terms. We will change the date at the top when we do.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${email}">${email}</a>.</p>`;
  return page({ title: "Terms | Scam or Not", description: "The simple rules for using Scam or Not.", body, root, canonical: `${c.site.baseUrl}/terms/` });
}
