require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');
const FormData = require('form-data');
const { google } = require('googleapis');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Stats persistence ─────────────────────────────────────────────
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch { return { totalEntries: 0, firstEntryDate: null, todayEntries: {}, daysWithEntries: [] }; }
}

function saveStats(stats) {
  fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function recordEntry() {
  const stats = loadStats();
  const today = todayStr();
  stats.totalEntries = (stats.totalEntries || 0) + 1;
  if (!stats.firstEntryDate) stats.firstEntryDate = today;
  if (!stats.daysWithEntries) stats.daysWithEntries = [];
  if (!stats.daysWithEntries.includes(today)) stats.daysWithEntries.push(today);
  if (!stats.todayEntries) stats.todayEntries = {};
  stats.todayEntries[today] = (stats.todayEntries[today] || 0) + 1;
  saveStats(stats);
  return stats;
}

function getPublicStats(stats) {
  const today = todayStr();
  return {
    todayCount: (stats.todayEntries || {})[today] || 0,
    totalEntries: stats.totalEntries || 0,
    firstEntryDate: stats.firstEntryDate || null,
    daysActive: (stats.daysWithEntries || []).length,
  };
}

// ── Sessions ──────────────────────────────────────────────────────
const sessions = {};

function getHistory(sid) {
  if (!sessions[sid]) sessions[sid] = [];
  return sessions[sid];
}

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Owen — a silent professional record-keeper.

The person speaking is documenting their workday by voice. Your job is to extract what matters, translate it into professional language, and keep a clean record. You do not chat. You do not validate. You do not respond conversationally during the day.

## For every voice entry during the day:

Extract:
- What was done, assigned, or needs doing
- Who directed or assigned it
- Any priority shift or displacement

Translate informal language into professional language without changing the substance:
- "Josh has been flaky" → "Josh has been unresponsive"
- "My boss won't listen" → "Management has not acknowledged the concern"
- "I had to drop everything" → "Existing work was displaced"
- "covering for someone" → "providing coverage"

If the assignor is not mentioned, record as [unattributed]. Do not ask. Infer from context where possible.

Return ONLY the ::LOG:: line. Nothing else. No acknowledgment. No questions. No sign-off.

::LOG:: {"task":"professional description","requestedBy":"name or [unattributed]","effort":"low|medium|high","followUp":"one line or null","isReceipt":false,"professionalSummary":"one clean sentence"}

## Priority shifts:

::LOG:: {"task":"new priority","requestedBy":"who directed it","effort":"low|medium|high","followUp":null,"isReceipt":true,"receiptNote":"what was displaced and by whose direction","professionalSummary":"one clean sentence"}

## Wrap-up (user says "wrap up", "my day", "end of day", "summary", or similar):

Compile everything logged this session. Infer missing attribution from context. Surface unresolved gaps as notes, not demands. Write as a professional record.

Use this format:

# Daily Log — [Weekday, Month Day]

## Work completed
[Bullet points grouped by who assigned the work. Professional language throughout.]

## Priority changes
[Receipts — what shifted and who directed it. Omit this section entirely if none.]

## Open items
[Unresolved follow-ups. Omit if none.]

## Notes
[Patterns, concerns, context worth flagging. Unresolved attribution: "Attribution unclear: [task]". Omit if nothing to flag.]

Do not add a sign-off. Do not include ::LOG:: lines in the wrap-up.`;

// ── Helpers ───────────────────────────────────────────────────────
function extractLog(text) {
  const match = text.match(/::LOG::\s*(\{.+\})/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function stripLog(text) {
  return text.replace(/\n?::LOG::\s*\{.+\}/, '').trim();
}

function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ── Google Sheets ─────────────────────────────────────────────────
let sheets = null;

async function initSheets() {
  const creds = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!creds || !sheetId) return;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(creds),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets connected.');
  } catch (err) {
    console.error('⚠️  Google Sheets setup failed:', err.message);
  }
}

async function logToSheets(entry, rawInput) {
  if (!sheets) return;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const now = new Date();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Log!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[
        now.toLocaleDateString('en-US'),
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        now.toLocaleDateString('en-US', { weekday: 'long' }),
        entry.task || '',
        entry.requestedBy || '',
        entry.effort || '',
        entry.followUp || '',
        entry.isReceipt ? 'yes' : '',
        entry.receiptNote || '',
        weekNumber(now),
        rawInput,
      ]] },
    });
    if (entry.requestedBy && !['self', '[unattributed]'].includes(entry.requestedBy)) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId, range: 'Teammates!A:C', valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[entry.requestedBy, '', now.toLocaleDateString('en-US')]] },
      });
    }
    if (entry.isReceipt && entry.receiptNote) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId, range: 'Receipts!A:D', valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[now.toLocaleDateString('en-US'), entry.task, entry.receiptNote, entry.requestedBy]] },
      });
    }
  } catch (err) {
    console.error('Sheet write failed:', err.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  const sid = sessionId || 'default';
  const history = getHistory(sid);
  history.push({ role: 'user', content: message });

  const isWrapUp = /wrap.?up|my day|end of day|summary|that.?s it/i.test(message);

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const rawReply = response.content[0].text;
    const logEntry = extractLog(rawReply);
    const displayReply = stripLog(rawReply);

    history.push({ role: 'assistant', content: rawReply });

    let stats = null;
    if (logEntry) {
      stats = recordEntry();
      logToSheets(logEntry, message).catch(() => {});
    }

    res.json({
      // Only send reply text for wrap-ups — silent the rest of the day
      reply: isWrapUp ? displayReply : null,
      isWrapUp,
      sessionId: sid,
      logged: !!logEntry,
      stats: stats ? getPublicStats(stats) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Owen encountered an error. Check your CLAUDE_API_KEY.' });
  }
});

app.get('/stats', (req, res) => {
  res.json(getPublicStats(loadStats()));
});

app.post('/clear', (req, res) => {
  const sid = req.body?.sessionId || 'default';
  delete sessions[sid];
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, sheetsConnected: !!sheets, whisperReady: !!process.env.OPENAI_API_KEY });
});

app.post('/transcribe', async (req, res) => {
  const { audio, mimeType } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not set in .env' });

  try {
    const buffer = Buffer.from(audio, 'base64');
    const type = mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : 'webm';
    const boundary = '----OwenBoundary' + Date.now();
    const CRLF = '\r\n';

    const body = Buffer.concat([
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="recording.${ext}"${CRLF}Content-Type: ${type}${CRLF}${CRLF}`),
      buffer,
      Buffer.from(`${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}whisper-1${CRLF}--${boundary}--${CRLF}`),
    ]);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Whisper API error:', response.status, text);
      return res.status(500).json({ error: 'Transcription failed' });
    }

    const result = await response.json();
    res.json({ text: result.text });
  } catch (err) {
    console.error('Whisper error:', err.message);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

const PORT = process.env.PORT || 3000;
initSheets().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Owen is running at http://localhost:${PORT}`);
    if (!process.env.CLAUDE_API_KEY) console.warn('⚠️  CLAUDE_API_KEY is not set');
  });
});
