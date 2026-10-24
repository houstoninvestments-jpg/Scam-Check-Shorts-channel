import type { ChannelConfig } from "../lib/config.js";
import { esc, page } from "./templates.js";

/**
 * Privacy policy and terms. Written from what the code does today; update these pages
 * before any new data use goes live (the tests check the key claims against config).
 */

export function privacyPage(c: ChannelConfig, root: string) {
  const email = esc(c.channel.contactEmail);
  const signupOn = Boolean(c.supabase.url && c.supabase.publishableKey);
  const body = `
<h1>Privacy</h1>
<p class="small">Last updated ${esc(c.channel.policyDate)}</p>
<p class="lede">Short version: we collect almost nothing. We never sell your information.</p>

<h2>What this site collects</h2>
<p><b>Your email, only if you sign up.</b> The site has a box to get the daily round by email.${
    signupOn ? "" : " Right now that box is turned off, so the site collects no email addresses at all."
  } When it is on, you can type in your email. We then save your email address and the date you signed up. We keep it in our database (Supabase). We use it only to send you the daily round.</p>
<p><b>Nothing else.</b> The site has no ads, no tracking tools, and no visitor counters. Our site's code sets no cookies.</p>

<h2>What stays on your phone</h2>
<p>When you play the daily round, your score is saved in your own browser. So is your text size choice. Neither is sent to us. You can clear it by clearing your browser's site data.</p>

<h2>Our web host</h2>
<p>The site is hosted by Cloudflare. Cloudflare handles the traffic to the site, like any web host. It may keep basic records, such as visit times and browser types. We don't use those records to track you.</p>

<h2>YouTube</h2>
<p>Our videos are on YouTube. We use YouTube's tools for two things. The first is posting videos to our own Scam or Not channel. The second is reading how our own videos do, like views and watch time. We never sign in to your account. We never see who you are when you watch.</p>
<p>When you watch on YouTube, YouTube's own rules apply. See the <a href="https://www.youtube.com/t/terms" rel="noopener">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" rel="noopener">Google Privacy Policy</a>.</p>

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
  const body = `
<h1>Terms</h1>
<p class="small">Last updated ${esc(c.channel.policyDate)}</p>
<p class="lede">Scam or Not is free. These are the simple rules for using it.</p>

<h2>What this is</h2>
<p>Scam or Not shows real scam messages and explains how to spot them. It is for learning. It is not legal, money, or police advice. Lost money to a scam? Call your bank first. Then report it where you live.</p>

<h2>How we make the messages</h2>
<p>Each scam comes from public warnings and reports, like those from government agencies. Some messages are recreated from those warnings. We swap out real links and phone numbers so nobody can tap a live scam. We link the sources on each scam's page.</p>
<p>The voice in our videos is made by AI. The phone screens are made by code.</p>

<h2>We do our best, but we can be wrong</h2>
<p>We check every claim against its source before we post. Still, scams change fast, and we can make mistakes. Use your own judgment. When unsure, contact the company yourself, using a number or website you already trust.</p>

<h2>We never ask you for anything</h2>
<p>${esc(c.channel.never)} We will never ask for your passwords, codes, or bank details.</p>

<h2>Using our content</h2>
<p>You are welcome to share links to our pages and videos. Please don't copy whole pages or videos and post them as your own.</p>

<h2>Other websites</h2>
<p>We link to other sites, like the agencies we quote and YouTube. We don't control those sites. Their own rules apply there.</p>

<h2>Paid links</h2>
<p>If we ever add a paid link, we will label it "Paid link" right next to it.</p>

<h2>No promises</h2>
<p>We offer the site as it is. We don't promise it will always be online. We don't promise it is free of errors. We are not responsible for losses from using it, as far as the law allows.</p>

<h2>Changes</h2>
<p>We may update these terms. We will change the date at the top when we do.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${email}">${email}</a>.</p>`;
  return page({ title: "Terms | Scam or Not", description: "The simple rules for using Scam or Not.", body, root, canonical: `${c.site.baseUrl}/terms/` });
}
