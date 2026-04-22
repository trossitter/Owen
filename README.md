# Owen
Owen is a personal work log assistant built for people who do labor-intensive, often unacknowledged work in small, fast-moving organizations. He listens, structures, and persists what you did and who asked you to do it — creating an attributable record with minimal friction.
# Owen — Voice-First Work Log

Owen is a personal work log assistant built for people who do labor-intensive, often unacknowledged work in small, fast-moving organizations. He listens and adds structures. You review at 5pm.

---

## What it does

Tap a mic button. Speak naturally. Owen turns what you say into a structured log entry and saves it to a Google Sheet. At the end of the day, say "wrap up" — Owen compiles a daily summary you can copy in one tap. Over time, the Sheet becomes a searchable paper trail: who assigned what, when priorities shifted, and who authorized the change.

---

## Why it's built this way

**Voice-first because friction is the enemy.** If logging requires opening an app, navigating a form, and typing, it won't happen. A mic button is the lowest possible barrier for someone who isn't always at a desk.

**No voice output by design.** Owen responds in text only. Audio responses would require headphones or silence — neither is guaranteed on a job site or in a shared space.

**Multi-turn context is preserved server-side per session.** Owen remembers everything said in the current session, so the daily summary is accurate without the user having to repeat themselves.

**The TTT framework structures Owen's behavior.** Owen's system prompt is organized around three concepts:
- **Triggers** — four distinct situations Owen recognizes (new event, priority shift, end-of-session, weekly review), each with a specific response pattern
- **Task** — exactly what Owen does for each trigger, with no ambiguity
- **Teammates** — the named people in the user's environment whose requests Owen tracks; these become first-class data in the Sheet, enabling workload attribution by person

**The Receipt system is the core accountability mechanism.** Any time a task displaces another or a priority changes, Owen flags it with a `⚑ RECEIPT` and logs it to a dedicated Receipts sheet. This is the paper trail — queryable evidence of who changed what and who authorized it.

**Google Sheets is optional on day one.** If no Sheets credentials are configured, Owen still works — entries display on screen and can be copied manually. This lowers the setup barrier so the habit can form before the automation is wired up.

---

## Stack

- **Frontend:** Vanilla HTML/CSS/JS, Web Speech API (no framework, no install)
- **Backend:** Node.js + Express
- **AI:** Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`
- **Persistence:** Google Sheets via `googleapis` (optional)

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in your environment variables
cp .env.example .env
# Add your CLAUDE_API_KEY at minimum

# 3. Start Owen
npm start

# 4. Open in browser
open http://localhost:3000
```

For Google Sheets setup (recommended), see [SETUP.md](./SETUP.md).

---

## Project structure

```
owen/
├── server.js          # Express server, Claude integration, Sheets sync
├── public/
│   └── index.html     # Voice UI (single file, no build step)
├── package.json
├── .env.example       # Copy to .env and fill in
├── README.md          # This file
└── SETUP.md           # Step-by-step setup including Google Sheets
```

---

## Google Sheet structure

Owen writes to three tabs automatically:

| Sheet | Purpose |
|-------|---------|
| `Log` | Every entry: date, task, assignor, effort, follow-up, week number |
| `Receipts` | Priority changes only — the paper trail |
| `Teammates` | Every named person who assigned a task — workload by person |

---
