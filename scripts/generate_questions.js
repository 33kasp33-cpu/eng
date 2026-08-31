/**
 * Automated Question Generator using Gemini 3.5 Flash Lite & Cloudflare D1
 * Free Tier Compliant (0 yen operation)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "1af4debb9e11e210757d95082b23a0a8";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DATABASE_ID = "45bfa3c3-6fe7-43f9-8e70-2067df606cf5";

if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required.");
  process.exit(1);
}

if (!CLOUDFLARE_API_TOKEN) {
  console.error("Error: CLOUDFLARE_API_TOKEN environment variable is required.");
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `
あなたはTOEIC 600点奪取特化型RTA（反射神経ゲーム）の問題作成AIです。
英語を読まずに空欄前後と接尾辞だけで機械処理できる「Part 5品詞問題」または「Part 6/7冒頭目的スナイプ問題」を生成してください。

【ルール】
1. Part 5: 品詞判定（-tion名詞, -able形容詞, -ly副詞, 冠詞/所有格/前置詞の配置ルール）
2. Part 6/7: 冒頭2行の定型構文（Subject: ..., I am writing to ..., We regret to inform you that ...）
3. 選択肢は必ず4つ。
4. triggerは「20?40文字の秒殺ルール解説」（例: "助動詞 will + _____ + 本動詞 → 副詞 [-ly]"）。
`;

const PROMPT = `
TOEIC 600点レベルのPart 5品詞識別問題とPart 6/7目的スナイプ問題を合計10問生成してください。
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
    if (!q.q || !Array.isArray(q.options) || q.options.length < 4 || typeof q.answer !== "number") {
      continue;
    }
    const id = crypto.randomUUID();
    const part = q.part || 5;
    const patType = (q.pattern_type || "POS_PATTERN").replace(/'/g, "''");
    const qText = q.q.replace(/'/g, "''");
    const opt0 = q.options[0].replace(/'/g, "''");
    const opt1 = q.options[1].replace(/'/g, "''");
    const opt2 = q.options[2].replace(/'/g, "''");
    const opt3 = q.options[3].replace(/'/g, "''");
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
