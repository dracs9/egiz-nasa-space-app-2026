# EGIZ demo kit — 30-second video (3 × 10 s)

Everything the team needs to produce the 30 s jury video. All media are real 1080p captures of the running EGIZ site.

| Pack | Time | Content | Archive |
|---|---|---|---|
| `video1_hook_moon_to_earth/` | 0–10 s | Landing: "The Moon starts here" → "This is not the Moon" | `video1_hook_moon_to_earth.zip` |
| `video2_moon_site_to_earth_analogs/` | 10–20 s | Start the Moon → Mons Mouton → Earth analog map → Discover any point | `video2_moon_site_to_earth_analogs.zip` |
| `video3_mission_home_lab_campaign/` | 20–30 s | Mission Home → Engineering Lab (rover sim) → Field Campaign → Record → "Earth first" | `video3_mission_home_lab_campaign.zip` |

Each pack contains:
- `PROMPT.txt`: the detailed prompt for Omni 1.2 Flash / Veo Ingredients (beat by beat), the negative prompt, the voice-over line and the subtitle;
- `frames/`: 1920×1080 PNG keyframes to upload as Ingredients;
- `screen_recordings/`: real screen recordings of every step (cursor, clicks, zooms);
- `READY_10s_real_footage.mp4`: an already-cut 10 s version from the real recording (fallback if AI output is bad).

## How to make the video
1. For each pack: upload `frames/*.png` as Ingredients, paste the PROMPT from `PROMPT.txt`, 16:9, 10 s, generated audio off.
2. ElevenLabs (Brian/Daniel, Stability ~45 %): generate the 3 voice-over lines separately and place them at 0.3 s, 10.3 s and 20.3 s.
3. Join video 1 + 2 + 3 (exactly 30 s), add the 3 subtitles (English), export MP4 1080p.
4. Upload to Google Drive as "Anyone with the link can view", post the link in the participants' Telegram, then Submit for Judging on spaceappschallenge.org before 23:59.

If an AI clip warps the interface text, use that pack's `READY_10s_real_footage.mp4` instead.

AI-use note for the submission: video transitions and camera moves were generated from real screenshots of our app; the voice-over is ElevenLabs; all data, analysis and interface are our own; no AI-made NASA logos.
