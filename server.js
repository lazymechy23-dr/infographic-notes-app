const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.docx', '.pptx'].includes(ext)) cb(null, true);
    else cb(new Error('Only .docx and .pptx allowed'));
  }
});

// Home
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AI Infographic Notes</title>
      <style>
        body { font-family: system-ui; max-width: 640px; margin: 40px auto; padding: 20px; background: #f0f4f8; }
        .card { background: white; padding: 35px; border-radius: 16px; box-shadow: 0 12px 30px rgba(0,0,0,0.1); }
        h1 { color: #0d47a1; }
        input, button { width: 100%; padding: 14px; font-size: 16px; margin: 10px 0; border-radius: 10px; border: 2px solid #ddd; }
        button { background: linear-gradient(135deg, #1565c0, #0d47a1); color: white; border: none; font-weight: bold; cursor: pointer; }
        .info { background: #e3f2fd; padding: 14px; border-radius: 10px; margin-top: 18px; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>AI Infographic Notes Maker</h1>
        <p>Upload English .docx / .pptx → Clean multi-page notes (dense layout)</p>
        
        <form action="/convert" method="POST" enctype="multipart/form-data">
          <input type="file" name="document" accept=".docx,.pptx" required>
          <button type="submit">Generate Dense Infographic Notes →</button>
        </form>

        <div class="info">
          Using Groq + structured template (low repetition + dense layout)
        </div>
      </div>
    </body>
    </html>
  `);
});

// Preview static template
app.get('/preview', (req, res) => {
  res.render('notes', { data: null }); // will use fallback
});

// Convert + AI
app.post('/convert', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  let extractedText = '';

  try {
    // Extract text
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value;
    } else {
      let raw;
      try {
        raw = await officeParser.parseOfficeAsync(filePath);
      } catch {
        raw = await new Promise((resolve, reject) => {
          officeParser.parseOffice(filePath, (data, err) => err ? reject(err) : resolve(data));
        });
      }
      extractedText = typeof raw === 'string' ? raw : (raw?.text || String(raw));
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    extractedText = extractedText.trim().substring(0, 11000);
    if (extractedText.length < 50) throw new Error('Not enough text extracted');

    console.log(`\nExtracted ${extractedText.length} chars. Generating structured notes...\n`);

    // ========== STRICT JSON PROMPT ==========
    const prompt = `You are an expert at creating dense exam notes.

Analyze the content and return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:

{
  "title": "Main Topic Title",
  "meaning": "2-3 sentence clear definition",
  "position_points": ["point 1", "point 2", "point 3"],
  "importance_points": ["point 1", "point 2", "point 3"],
  "protector_text": "Short paragraph about rights protection role",
  "timeline": [
    {"year": "Year / Act", "desc": "Short description"},
    {"year": "Year / Act", "desc": "Short description"}
  ],
  "articles": [
    {"article": "Art. 214", "provision": "description"},
    {"article": "Art. 226", "provision": "description"}
  ],
  "functions": [
    {"name": "Original Jurisdiction", "desc": "short desc"},
    {"name": "Appellate Jurisdiction", "desc": "short desc"},
    {"name": "Supervisory Jurisdiction", "desc": "short desc"},
    {"name": "Advisory Jurisdiction", "desc": "short desc"}
  ],
  "quick_revision": ["point 1", "point 2", "point 3", "point 4", "point 5", "point 6"]
}

Rules:
- Use only English
- Be dense and exam-oriented
- Maximum 8-10 timeline items
- Maximum 7 articles
- Keep every description short
- No repetition
- If some information is missing, create reasonable exam-oriented content based on the topic

CONTENT:
"""
${extractedText}
"""`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You only return pure valid JSON. No extra text.' },
        { role: 'user', content: prompt }
      ],
      model: MODEL,
      temperature: 0.15,
      max_tokens: 2200,
      response_format: { type: 'json_object' }
    });

    let raw = completion.choices[0]?.message?.content || '{}';
    let data;

    try {
      data = JSON.parse(raw);
    } catch (e) {
      // fallback if JSON is slightly broken
      raw = raw.replace(/```json|```/g, '').trim();
      data = JSON.parse(raw);
    }

    console.log('AI structured data received successfully');

    res.render('notes', { data });

  } catch (err) {
    console.error(err);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).send(`
      <div style="font-family:system-ui;max-width:600px;margin:40px auto;padding:30px;background:white;border-radius:12px;">
        <h2 style="color:#c62828;">Error</h2>
        <p>${err.message}</p>
        <br>
        <a href="/" style="background:#1565c0;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">← Try Again</a>
      </div>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Dense AI Notes App running!`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`📄 Preview template: http://localhost:${PORT}/preview\n`);
});