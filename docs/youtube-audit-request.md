# YouTube API audit request (prepared answers)

Why this exists: the first upload test found uploads locked to private.
Test result: status stayed private after asking for unlisted

Form: https://support.google.com/youtube/contact/yt_api_form

## Answers to paste

**What does your API client do?**
It uploads up to three short videos a day to our own channel, Scam or Not.
Each video shows a real scam message and explains three warning signs and one safe step.
No other users. No other channels. We only upload to the channel we own.

**Which API features do you use?**
- videos.insert (up to three uploads a day to our own channel)
- videos.update (privacy status on our own videos)
- videos.list (read back our own video status)
- YouTube Analytics reports for our own channel (retention, views), used to improve future videos

**Who uses the API client?**
Only us, the channel owner. It runs as a scheduled job. There is no public app and no sign-in for anyone else.

**How do you store YouTube data?**
We keep video IDs, titles, and our own channel's daily view and retention numbers.
We store no data about viewers.

**How do you show users that content is AI-assisted?**
Every upload sets the altered or synthetic content flag and says in the description that the narration is an AI voice (the open Kokoro model).

**Quota needed**
The default 10,000 units a day is enough. We ask only for the upload lock to be lifted.

**Channel**
Scam or Not. Site: https://scamornotdaily.com (also https://scamornot.pages.dev)
