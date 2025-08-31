/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// このファイルは、Vercelサーバーレス環境との互換性問題を回避するため、
// @google/genai SDK を使わずに、Google AI REST API と直接通信します。

/**
 * AIからの応答テキストを安全にJSONとして解析します。
 * 応答がマークダウンのコードブロック(` ```json ... ``` `)で囲まれている場合も考慮します。
 * @param {string} rawText - AIからの生の応答テキスト。
 * @returns {object} パースされたJSONオブジェクト。
 * @throws {Error} JSONのパースに失敗した場合。
 */
const cleanAndParseJson = (rawText) => {
  const cleanedText = rawText.replace(/```json\n?|```/g, '').trim();
  try {
    return JSON.parse(cleanedText);
  } catch (e) {
    console.error("Failed to parse JSON response after cleaning:", cleanedText);
    // AIが画像を解析できなかった場合に、JSONではないテキストを返すことがあるため、より具体的なエラーメッセージを投げる
    throw new Error("AIからの応答が予期せぬ形式でした。画像が不鮮明でAIが文字を読み取れなかった可能性があります。");
  }
};

/**
 * REST APIのスキーマ定義で使用する型の定数。
 */
const Type = {
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
};

export default async function handler(req, res) {
  const task = req.body?.task || 'unknown';
  try {
    console.log(`[API] Received task: ${task}`);

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("[API] CRITICAL: API_KEY is not set in server environment variables.");
      return res.status(500).json({ error: "重大なエラー: APIキーがサーバー環境変数に設定されていません。Vercelのダッシュボードで環境変数 'API_KEY' を確認してください。" });
    }
    console.log(`[API] API Key loaded successfully. Starts with: '${apiKey.substring(0, 4)}', ends with: '${apiKey.slice(-4)}'.`);
    
    if (!req.body || !req.body.task) {
      return res.status(400).json({ error: "無効なリクエストです。タスクを指定してください。" });
    }
    
    const { payload } = req.body;
    const model = 'gemini-2.5-flash';
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    let requestBody;

    console.log(`[API] Building request for task: ${task}`);
    switch (task) {
      case 'oshi_push': {
        const { query, oshi } = payload;
        if (!query) throw new Error("検索クエリが必要です。");
        
        let oshiContext = `ユーザーは「${oshi?.name || '指定なし'}」という名前の推しについて質問しています。`;
        if (oshi?.url) {
            oshiContext += `\n参考URLとして「${oshi.url}」が指定されています。このURLは、同姓同名の別人や他の作品と区別するための最も重要な情報源です。`;
        }

        const prompt = `
あなたは、ユーザーの推し活を全力で応援する情熱的なアシスタントです。

${oshiContext}

上記の推しの情報を最優先のコンテキストとしてWeb検索を活用し、以下のユーザーの質問に回答してください。

ユーザーの質問: "${query}"

回答のトーン＆マナー：
- ユーザーが元気づけられ、推し活がもっと楽しくなるような、ポジティブで情熱的な文章を生成してください。
- SNSの最新投稿、近々のライブやイベント情報、ファンが喜ぶ豆知識など、タイムリーで嬉しい情報を具体的に盛り込んでください。

制約：
- 回答は100文字以上200文字以内で、自然な日本語の文章で記述してください。
- 箇条書きは使わないでください。
- 事実に基づいた正確な情報を提供してください。
- 生成する文章は、回答のみとし、タイトルや前置きは不要です。
        `.trim();

        requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{googleSearch: {}}],
        };
        break;
      }

      case 'receipt_confirm': {
        const { imagesB64 } = payload;
        if (!imagesB64 || imagesB64.length === 0) throw new Error("画像データが必要です。");
        
        const payloadSize = JSON.stringify(payload).length;
        console.log(`[API] Receipt task: Processing ${imagesB64.length} image(s). Payload size: ~${(payloadSize / 1024 / 1024).toFixed(2)} MB`);
        if (payloadSize > 4 * 1024 * 1024) {
            throw new Error("送信された画像が大きすぎます。ファイルサイズを小さくしてもう一度お試しください。");
        }
        
        const imageParts = imagesB64.map(b64 => ({
          inlineData: { mimeType: 'image/jpeg', data: b64 },
        }));
        const promptPart = { text: `これらの複数の画像を、一連の購入記録として扱ってください。画像は物理的なレシート、またはオンラインストア（Amazon、楽天市場など）の購入履歴のスクリーンショットです。以下の情報を抽出してください: 店名 (storeName), 購入日 (purchaseDate, YYYY-MM-DD形式), 品目リスト (items), 割引額 (discount), 消費税額 (tax)。品目リストには、各品物の名前 (name) と価格 (price, 数値) を含めてください。情報が読み取れない項目（割引、消費税など）は、値を0にしてください。画像の品質が完璧ではない場合があるため、不鮮明な文字も最大限解読を試みてください。`};
        
        requestBody = {
          contents: [{ parts: [promptPart, ...imageParts] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                storeName: { type: Type.STRING, description: "店の名前" },
                purchaseDate: { type: Type.STRING, description: "購入日 (YYYY-MM-DD)" },
                items: {
                  type: Type.ARRAY, description: "購入した品物のリスト",
                  items: {
                    type: Type.OBJECT,
                    properties: { name: { type: Type.STRING }, price: { type: Type.NUMBER } },
                    required: ['name', 'price']
                  }
                },
                discount: { type: Type.NUMBER, description: "割引の合計額。なければ0。" },
                tax: { type: Type.NUMBER, description: "消費税の合計額。なければ0。" }
              },
              required: ['storeName', 'purchaseDate', 'items', 'discount', 'tax']
            },
          }
        };
        break;
      }
      
      case 'shopping_list': {
        const { receipts } = payload;
        const history = receipts.slice(-10).map(r => ({ date: r.purchaseDate, items: r.items.map(i => i.name) }));
        const prompt = `以下のJSONはユーザーの最近の買い物履歴です。このデータに基づき、ユーザーが次に購入する必要がありそうな商品を予測してください。特に、定期的に購入される消耗品（食品、日用品など）で、最近の購入が見られないものを中心に提案してください。最大5つまで提案をお願いします。\n\n購入履歴:\n${JSON.stringify(history)}`;
        requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        suggestions: { type: Type.ARRAY, description: "購入を提案する商品の名前リスト", items: { type: Type.STRING } }
                    },
                    required: ['suggestions']
                }
            }
        };
        break;
      }
      
      case 'recipe': {
          const { receipts } = payload;
          const recentItems = [...new Set(receipts.slice(-10).flatMap(r => r.items.map(i => i.name)))];
          const prompt = `以下の食材リストは、ユーザーが最近購入したものです。これらの食材を使って作れる、簡単でおいしい家庭料理のレシピを1つ提案してください。レシピ名、材料リスト、そして簡単な作り方の手順を返してください。\n\n食材リスト: ${recentItems.join(', ')}`;
          requestBody = {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                          recipeName: { type: Type.STRING, description: "レシピの名前" },
                          ingredients: { type: Type.ARRAY, description: "材料のリスト", items: { type: Type.STRING } },
                          instructions: { type: Type.ARRAY, description: "作り方の手順", items: { type: Type.STRING } }
                      },
                      required: ['recipeName', 'ingredients', 'instructions']
                  }
              }
          };
          break;
      }
      
      case 'lifestyle_tips': {
        const { receipts } = payload;
        const history = receipts.slice(-10).map(r => ({ store: r.storeName, items: r.items.map(i => i.name) }));
        const prompt = `以下のJSONはユーザーの最近の買い物履歴です。このデータに基づき、ユーザーの生活に役立つヒントを2〜3個、親しみやすい口調で提案してください。例えば、よく行く店の特売情報、よく買う商品の値上がり傾向、あるいは関連商品の提案などです。\n\n購入履歴:\n${JSON.stringify(history)}`;
        requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { tips: { type: Type.STRING, description: "ユーザーへの生活のヒント" } },
                    required: ["tips"],
                }
            }
        };
        break;
      }

      case 'monthly_report_categorize': {
        const { items } = payload;
        if (!items || items.length === 0) {
            return res.status(200).json({ data: [] });
        }
        const categories = [
            "食料品", "飲料", "日用品", "衣料品", "医薬品・衛生用品", 
            "化粧品・美容品", "家電・雑貨", "外食・テイクアウト", "趣味・娯楽", 
            "交通費", "教育・学習", "ペット関連", "ギフト・交際費", "サービス費", "その他"
        ];
        
        const prompt = `あなたは家計簿の専門家です。以下の購入品目リストを分析し、指定されたカテゴリに分類し、カテゴリごとの合計金額を計算してください。

# 指示
1. 各品目を、下記のカテゴリリストの中から最も適切と思われるものに1つだけ分類してください。
2. 全ての品目を分類した後、カテゴリごとに合計金額を算出してください。
3. 結果は、金額の大きい順に並べ替えてください。

# カテゴリリスト
${categories.join('、')}

# 購入品目リスト (JSON形式)
${JSON.stringify(items)}

# 出力形式
必ず以下のJSONスキーマに従って、結果のみを出力してください。`;

        requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        categorizedSummary: {
                            type: Type.ARRAY,
                            description: "カテゴリごとの合計金額のリスト。金額の大きい順にソート済み。",
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    category: { type: Type.STRING, description: "カテゴリ名" },
                                    totalAmount: { type: Type.NUMBER, description: "そのカテゴリの合計金額" }
                                },
                                required: ['category', 'totalAmount']
                            }
                        }
                    },
                    required: ['categorizedSummary']
                }
            }
        };
        break;
      }

      default:
        throw new Error("無効なタスクが指定されました。");
    }

    console.log(`[API] Sending request to Google AI for task: ${task}`);
    const apiResponse = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!apiResponse.ok) {
        let errorBody;
        try {
            errorBody = await apiResponse.json();
            console.error("[API] Google AI API Error Response:", JSON.stringify(errorBody, null, 2));
        } catch (e) {
            errorBody = { error: { message: await apiResponse.text() } };
        }
        const errorMessage = errorBody.error?.message || '不明なエラー';
        throw new Error(`Google AI API returned an error: ${errorMessage}`);
    }

    const responseData = await apiResponse.json();
    
    if (!responseData.candidates?.[0]?.content?.parts?.[0]) {
        console.error("[API] Invalid response structure from Google AI:", JSON.stringify(responseData));
        throw new Error("AIからの応答が予期せぬ形式でした。");
    }

    const rawText = responseData.candidates[0].content.parts[0].text;
    let result;

    if (['receipt_confirm', 'shopping_list', 'recipe', 'monthly_report_categorize'].includes(task)) {
        const parsedJson = cleanAndParseJson(rawText);
        
        if (task === 'monthly_report_categorize') {
            result = parsedJson.categorizedSummary;
        } else {
            result = parsedJson;
        }
    } else if (task === 'lifestyle_tips') {
         const parsedJson = cleanAndParseJson(rawText);
         result = parsedJson.tips;
    } else {
        result = rawText;
    }
    
    console.log(`[API] Response processed successfully for task: ${task}`);
    return res.status(200).json({ data: result });

  } catch (error) {
    console.error(`[API] CRITICAL ERROR in handler for task '${task}':`, error);
    let userMessage = `サーバーで予期せぬエラーが発生しました: ${error.message}`;
    const errorMessage = error.message || '';
    if (errorMessage.includes('API key') || errorMessage.includes('permission') || errorMessage.includes('403')) {
      userMessage = `Google AIとの通信中に認証エラーが発生しました。アプリが動作しない場合、以下の3点をご確認ください：
1. Vercelの環境変数に設定したAPIキーの値が正しいか。
2. APIキーを発行したGoogle Cloudプロジェクトで "Generative Language API" または "Vertex AI API" が有効になっているか。
3. そのGoogle Cloudプロジェクトで課金が有効になっているか。`;
    }
    return res.status(500).json({ error: userMessage });
  }
}