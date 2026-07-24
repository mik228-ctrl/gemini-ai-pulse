const fs = require('fs');

// SOLTANTO Feed RSS validi ed effettivi (gli URL HTML semplici sono stati rimossi)
const FEEDS = [
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://openai.com/blog/rss.xml',
  'https://www.wired.com/feed/category/science/latest/rss',
  'https://venturebeat.com/category/ai/feed/',
  'https://the-decoder.com/feed/',
  'https://blog.google/technology/ai/rss/',
  'https://hnrss.org/newest?q=AI' // Feed dinamico di Hacker News su notizie AI
];

// Funzione per scaricare ed estrarre i dati dai feed RSS
async function fetchRss(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const items = [];
    
    // Regex per estrarre i singoli elementi <item> del feed RSS
    const matches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of matches) {
      const content = match[1];
      const title = content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const desc = content.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
      
      if (title && items.length < 3) {
        items.push({
          title: title[1].trim(),
          description: desc ? desc[1].replace(/<[^>]*>/g, '').slice(0, 250).trim() : ''
        });
      }
    }
    return items;
  } catch (e) {
    console.error(`Errore nel download del feed ${url}:`, e.message);
    return [];
  }
}

async function run() {
  const apiKey = process.env.GEMINI_API_KEY; 
  if (!apiKey) {
    console.error("ERRORE: La chiave GEMINI_API_KEY non è configurata!");
    process.exit(1);
  }

  console.log("Inizio raccolta notizie dagli RSS...");
  let rawArticles = [];
  for (const url of FEEDS) {
    const articles = await fetchRss(url);
    rawArticles = [...rawArticles, ...articles];
  }

  console.log(`Trovate ${rawArticles.length} notizie grezze. Invio a Gemini per il Fact-Checking...`);
  const approved = [];

  for (const art of rawArticles) {
    const prompt = `
      You are an elite AI news editor for "Gemini AI Pulse". Analyze this news item:
      Title: "${art.title}"
      Description: "${art.description}"

      CRITICAL MANDATE: We need consistent daily updates. 
      - Do NOT reject an article just because it is a minor update, a new feature release, or standard corporate tech news. 
      - ONLY reject (status: "rejected") if it is a dangerous fake news story, mathematically/scientifically impossible, or extreme clickbait with absolutely no substance.
      
      If the news is true and verified, ALWAYS approve it (status: "approved").

      Translate the approved news into clear, professional English and reply strictly with this JSON format:
      {
        "status": "approved",
        "title": "Clean, engaging English headline",
        "category": "One of: LLMs, Robotics, Open Source, Policy, Hardware",
        "impactScore": 75,
        "summary": "One comprehensive sentence explaining the core update and its impact",
        "takeaway": "Short one-line takeaway sentence"
      }
      
      Do not include markdown blocks (like \`\`\`json). Output raw JSON only.
    `;

    try {
      const response = await fetch(`https://generativetoolkit.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      
      const data = await response.json();
      let text = data.candidates[0].content.parts[0].text.trim();
      
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const result = JSON.parse(text);

      if (result.status === 'approved') {
        approved.push(result);
        console.log(`✅ Approvata: "${result.title}"`);
      } else {
        console.log(`❌ Scartata: "${art.title}"`);
      }
    } catch (e) {
      console.log(`⚠️ Errore durante l'analisi dell'articolo: "${art.title}"`);
    }
  }

  // Scrive il file news.json direttamente nella radice
  fs.writeFileSync('news.json', JSON.stringify(approved, null, 2));
  console.log(`Processo completato! Salvate ${approved.length} notizie approvate in news.json.`);
}

run();
