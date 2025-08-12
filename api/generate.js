/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Vercel Edgeランタイムなど、一部の環境ではesm.shから直接インポートする必要があります。
// Node.js環境では 'npm install @google/genai' を実行し、
// import { GoogleGenAI, Type } from "@google/genai"; のように使用します。
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

export default async function handler(req, res) {
  // POSTリクエストのみを許可
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // APIキーがサーバーの環境変数に設定されているか確認
  if (!process.env.API_KEY) {
    return res.status(500).json({ error: "APIキーがサーバーに設定されていません。" });
  }
  
  const { task, payload } = req.body;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    let result;
    switch (task) {
        
      case 'oshi_push': {
        const { oshi } = payload;
        if (!oshi) throw new Error("推しの名前が必要です。");

        const prompt = `${oshi}に関する最新情報を、ファンが見逃しがちな豆知識や細かい情報を含めて、日本語で100文字程度で教えてください。`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 0 }
            }
        });
        result = response.text;
        break;
      }

      case 'receipt_confirm': {
        const { imagesB64 } = payload;
        if (!imagesB64 || imagesB64.length === 0) throw new Error("画像データが必要です。");

        const schema = {
          type: Type.OBJECT,
          properties: {
            storeName: { type: Type.STRING, description: "店の名前" },
            purchaseDate: { type: Type.STRING, description: "購入日 (YYYY-MM-DD)" },
            items: {
              type: Type.ARRAY,
              description: "購入した品物のリスト",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "品物の名前" },
                  price: { type: Type.NUMBER, description: "品物の価格（税込）" }
                },
                required: ['name', 'price']
              }
            }
          },
          required: ['storeName', 'purchaseDate', 'items']
        };

        const imageParts = imagesB64.map(b64 => ({
          inlineData: {
            mimeType: 'image/jpeg',
            data: b64.split(',')[1],
          },
        }));

        const textPart = {
          text: `これらの複数のレシート画像を1枚の連続したレシートとして扱い、以下の情報を抽出してください: 店名 (storeName), 購入日 (purchaseDate, YYYY-MM-DD形式), 品目リスト (items)。品目リストには、各品物の名前 (name) と価格 (price, 数値) を含めてください。情報が読み取れない場合は、該当する値を空文字や空のリストにしてください。`
        };
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [...imageParts, textPart] },
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
          }
        });
        result = response.text; // JSON文字列
        break;
      }

      case 'shopping_list': {
        const { receipts } = payload;
        const history = receipts
            .slice(-10)
            .map(r => ({ date: r.purchaseDate, items: r.items.map(i => i.name) }));

        const prompt = `以下のJSONはユーザーの最近の買い物履歴です。このデータに基づき、ユーザーが次に購入する必要がありそうな商品を予測してください。特に、定期的に購入される消耗品（食品、日用品など）で、最近の購入が見られないものを中心に提案してください。最大5つまで提案をお願いします。\n\n購入履歴:\n${JSON.stringify(history)}`;

        const schema = {
            type: Type.OBJECT,
            properties: {
                suggestions: {
                    type: Type.ARRAY,
                    description: "購入を提案する商品の名前リスト",
                    items: { type: Type.STRING }
                }
            },
            required: ['suggestions']
        };
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema }
        });
        result = JSON.parse(response.text);
        break;
      }
      
      case 'recipe': {
          const { receipts } = payload;
          const recentItems = [...new Set(receipts.slice(-10).flatMap(r => r.items.map(i => i.name)))];
          const prompt = `以下の食材リストは、ユーザーが最近購入したものです。これらの食材を使って作れる、簡単でおいしい家庭料理のレシピを1つ提案してください。レシピ名、材料リスト、そして簡単な作り方の手順を返してください。\n\n食材リスト: ${recentItems.join(', ')}`;
          const schema = {
              type: Type.OBJECT,
              properties: {
                  recipeName: { type: Type.STRING, description: "レシピの名前" },
                  ingredients: { type: Type.ARRAY, description: "材料のリスト", items: { type: Type.STRING } },
                  instructions: { type: Type.ARRAY, description: "作り方の手順", items: { type: Type.STRING } }
              },
              required: ['recipeName', 'ingredients', 'instructions']
          };
          const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
              config: { responseMimeType: "application/json", responseSchema: schema }
          });
          result = JSON.parse(response.text);
          break;
      }

      case 'lifestyle_tips': {
        const { receipts } = payload;
        const history = receipts
            .slice(-10)
            .map(r => ({ store: r.storeName, items: r.items.map(i => i.name) }));
        const prompt = `以下のJSONはユーザーの最近の買い物履歴です。このデータに基づき、ユーザーの生活に役立つヒントを2〜3個、親しみやすい口調で提案してください。例えば、よく行く店の特売情報、よく買う商品の値上がり傾向、あるいは関連商品の提案などです。\n\n購入履歴:\n${JSON.stringify(history)}`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        result = response.text;
        break;
      }

      case 'yearly_report': {
        const { yearlyReceipts } = payload;
        const allItems = yearlyReceipts.flatMap(r => r.items);
        
        if (allItems.length === 0) {
            result = { categories: [], maxAmount: 0 };
            break;
        }

        const prompt = `以下のJSONはユーザーの1年間の購入品目リストです。各品目を「食費」「日用品」「趣味・娯楽」「交通費」「衣類」「健康・医療」「その他」のいずれかのカテゴリに分類してください。\n\n品目リスト:\n${JSON.stringify(allItems.map(i => i.name))}`;
        const schema = {
            type: Type.OBJECT,
            properties: {
                categorizedItems: {
                    type: Type.ARRAY,
                    description: "カテゴリ分類された品物のリスト",
                    items: {
                        type: Type.OBJECT,
                        properties: { name: { type: Type.STRING }, category: { type: Type.STRING } },
                        required: ['name', 'category']
                    }
                }
            },
            required: ['categorizedItems']
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema }
        });

        const parsed = JSON.parse(response.text);
        const categoryTotals = {};
        allItems.forEach(item => {
            const foundCategory = parsed.categorizedItems?.find(ci => ci.name.trim() === item.name.trim());
            const category = foundCategory ? foundCategory.category : 'その他';
            if (!categoryTotals[category]) categoryTotals[category] = 0;
            categoryTotals[category] += item.price;
        });

        const categories = Object.keys(categoryTotals).map(name => ({
            name,
            amount: categoryTotals[name]
        })).sort((a, b) => b.amount - a.amount);
        
        const maxAmount = Math.max(...categories.map(c => c.amount), 1);
        
        result = { categories, maxAmount };
        break;
      }

      default:
        throw new Error("無効なタスクが指定されました。");
    }

    return res.status(200).json({ data: result });

  } catch (error) {
    console.error(`'${task}' タスクのAPIルートでエラーが発生しました:`, error);
    // Vercelのログで詳細を確認できるように、エラーオブジェクト全体をログに出力します
    console.error(error);
    return res.status(500).json({ error: error.message || "サーバーで内部エラーが発生しました。" });
  }
}
