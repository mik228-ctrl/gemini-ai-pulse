const fs = require('fs');

// Feed RSS gratuiti da cui prendere le notizie sull'AI
const FEEDS = [
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://openai.com/blog/rss.xml'
];

// Funzione di utilità per scaricare ed estrarre i dati dai feed RSS senza usare librerie esterne
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
      
      // Prendiamo al massimo 3 notizie fresche per ogni feed per non sovraccaricare le chiamate API
      if (title && items.length < 3) {
        items.push({
          title: title[1].trim(),
          description: desc ? desc[1].replace(/<[^>]*>/g, '').slice(0, 200).trim() : ''
        });
      }
    }
    return items;
  } catch (e) {
    console.error(`Errore nel download del feed ${url}:`, e);
    return [];
  }
}

async function run() {
  // GitHub Actions passerà la chiave salvata in cassaforte tramite le variabili d'ambiente (process.env)
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
    // Istruzioni per Gemini direttamente modellate per fare da filtro euristico contro fake e clickbait
    const prompt = `
      You are an AI news filter and editor. Analyze this news:
      Title: "${art.title}"
      Description: "${art.description}"

      If this news is clickbait, fake, minor/unimportant, highly repetitive, or a pure marketing stunt, reply strictly with:
      {"status": "rejected"}

      If it is real, high-quality, and important AI news, translate it to English and reply strictly with this JSON format:
      {
        "status": "approved",
        "title": "Clean English title",
        "summary": "One sentence summary explaining why this matters"
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
      
      // Rimuove eventuali blocchi markdown di formattazione che Gemini potrebbe inserire per errore
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

  // Scrive il file news.json che verrà letto dal tuo index.html statico
  fs.writeFileSync('news.json', JSON.stringify(approved, null, 2));
  console.log(`Processo completato! Salvate ${approved.length} notizie approvate in news.json.`);
}

run();