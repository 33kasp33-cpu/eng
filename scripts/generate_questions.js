/**
 * Automated Question Generator using Gemini 3.5 Flash Lite & Cloudflare D1
 * Supports Part 5, Part 6/7, Part 2 (Listening), Part 3/4 (Listening)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "1af4debb9e11e210757d95082b23a0a8";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_TOKEN;
const D1_DATABASE_ID = "45bfa3c3-6fe7-43f9-8e70-2067df606cf5";

if (!GEMINI_API_KEY) {
  console.error("===============================================================");
  console.error("🚨 Error: GEMINI_API_KEY is not configured in GitHub Secrets.");
  console.error("Please add 'GEMINI_API_KEY' in repository Settings -> Secrets -> Actions.");
  console.error("URL: https://github.com/33kasp33-cpu/eng/settings/secrets/actions");
  console.error("===============================================================");
  process.exit(1);
}

if (!CLOUDFLARE_API_TOKEN) {
  console.error("===============================================================");
  console.error("🚨 Error: CLOUDFLARE_API_TOKEN is not configured in GitHub Secrets.");
  console.error("Please add 'CLOUDFLARE_API_TOKEN' in repository Settings -> Secrets -> Actions.");
  console.error("URL: https://github.com/33kasp33-cpu/eng/settings/secrets/actions");
  console.error("===============================================================");
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `
あなたはTOEIC 600点奪取特化型RTA（反射神経ゲーム）の問題作成AIです。
英語を読まずにパターンと記号だけで機械処理できる以下の問題を生成してください。

【パート別生成ルール】
1. Part 5 (品詞): 空欄前後と接尾辞(-tion, -able, -ly等)で解ける問題（4択）
2. Part 6/7 (目的): 冒頭2行の定型文(Subject, I am writing to等)で解ける問題（4択）
3. Part 2 (リスニング即答): 冒頭0.5秒の音の塊(When, Where, Who, Why, 間接応答Check/Ask等)で解ける応答問題（3択：optionsの4つ目は空文字 ""）
4. Part 3/4 (リスニングスナイプ): 冒頭第1文のシグナル(I'm calling about, Unfortunately, Welcome to等)で解ける問題（4択）

5. triggerは「20〜40文字の秒殺ルール解説」（例: "When [ウェン] ➔ 期限・日時 [By Friday] を秒殺！"）。
`;

const PROMPT = `
TOEIC 600点特化の問題を以下の比率で合計12問生成してください：
- Part 5 (品詞): 4問
- Part 6/7 (目的): 2問
- Part 2 (リスニング): 3問 (選択肢は3つ、4つ目は空文字 "")
- Part 3/4 (リスニング): 3問 (選択肢4つ)

JSON配列形式で出力してください。
`;

async function callGemini() {
  const models = ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`Attempting question generation with model: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      
      const payload = {
        contents: [
          { role: "user", parts: [{ text: PROMPT }] }
        ],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                part: { type: "INTEGER" },
                pattern_type: { type: "STRING" },
                q: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                answer: { type: "INTEGER" },
                trigger: { type: "STRING" }
              },
              required: ["part", "pattern_type", "q", "options", "answer", "trigger"]
            }
          },
          temperature: 0.7
        }
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const contentText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!contentText) throw new Error("Empty response from Gemini API");

      const parsed = JSON.parse(contentText);
      console.log(`Successfully generated ${parsed.length} questions using ${model}!`);
      return parsed;
    } catch (err) {
      console.warn(`Model ${model} failed: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError;
}

async function insertToD1(questions) {
  console.log(`Inserting ${questions.length} questions into Cloudflare D1...`);
  const crypto = require("crypto");
  
  let sqlStatements = [];
  for (const q of questions) {
    if (!q.q || !Array.isArray(q.options) || q.options.length < 3 || typeof q.answer !== "number") {
      continue;
    }
    const id = crypto.randomUUID();
    const part = q.part || 5;
    const patType = (q.pattern_type || "PATTERN").replace(/'/g, "''");
    const qText = q.q.replace(/'/g, "''");
    const opt0 = (q.options[0] || "").replace(/'/g, "''");
    const opt1 = (q.options[1] || "").replace(/'/g, "''");
    const opt2 = (q.options[2] || "").replace(/'/g, "''");
    const opt3 = (q.options[3] || "").replace(/'/g, "''");
    const ans = q.answer;
    const trig = (q.trigger || "").replace(/'/g, "''");

    sqlStatements.push(
      `INSERT INTO questions (id, part, pattern_type, question_text, option_0, option_1, option_2, option_3, answer_index, trigger_text) VALUES ('${id}', ${part}, '${patType}', '${qText}', '${opt0}', '${opt1}', '${opt2}', '${opt3}', ${ans}, '${trig}');`
    );
  }

  if (sqlStatements.length === 0) {
    console.log("No valid questions to insert.");
    return;
  }

  const fullSql = sqlStatements.join(" ");
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ sql: fullSql })
  });

  const resultJson = await res.json();
  if (resultJson.success) {
    console.log(`Successfully added ${sqlStatements.length} questions into D1!`);
  } else {
    console.error("Failed to insert into D1:", resultJson.errors);
  }
}

async function main() {
  try {
    const questions = await callGemini();
    await insertToD1(questions);
    console.log("Auto-generation pipeline completed successfully.");
  } catch (e) {
    console.error("Pipeline failed:", e);
    process.exit(1);
  }
}

main();
