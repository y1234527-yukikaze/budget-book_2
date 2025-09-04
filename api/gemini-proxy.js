
// ファイルパス: /api/gemini-proxy.js

// Vercel/Netlifyのような環境で動作するサーバーレス関数です。
// フロントエンドからのリクエストを受け取り、安全に保管されたAPIキーを使って
// バックエンドからGemini APIを呼び出します。

export default async function handler(req, res) {
  // POSTリクエスト以外は許可しない
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 環境変数からAPIキーを取得 (これが最も安全な方法です)
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ message: 'API key is not configured on the server.' });
  }

  // Gemini APIのRESTエンドポイント
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const fullSchema = {
      type: "OBJECT",
      properties: {
        companyName: { type: "STRING" }, name: { type: "STRING" }, furigana: { type: "STRING" },
        department: { type: "STRING" }, title: { type: "STRING" }, zipCode: { type: "STRING" },
        address: { type: "STRING" }, tel: { type: "STRING" }, mobileTel: { type: "STRING" },
        fax: { type: "STRING" }, email: { type: "STRING" }, 
        website: { type: "ARRAY", items: { type: "STRING" } },
        sns: { type: "ARRAY", items: { type: "STRING" } },
        otherTel: { type: "STRING" },
        notes: { type: "STRING" },
        tags: { type: "ARRAY", items: { type: "STRING" } },
      },
  };

  try {
    const { task, payload } = req.body;
    let requestBody;

    // フロントエンドから依頼されたタスクに応じて、Geminiに送るデータを作成
    switch (task) {
      case 'extractInfo': {
        const { frontImage, backImage } = payload;
        const parts = [];
        if (frontImage) {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: frontImage.split(',')[1] } });
        }
        if (backImage) {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: backImage.split(',')[1] } });
        }
        
        const systemInstruction = `あなたは名刺のデジタル化を専門とする熟練のデータ入力アシスタントです。

タスク:
この名刺の表と裏の画像を分析し、提供されたJSONスキーマに従ってすべての情報を正確に抽出してください。

重要な指示:
1.  **両面の情報を統合**: 表と裏の両方から情報を読み取り、1つの完全なデータレコードを作成してください。同じ情報が両面にある場合、重複させないでください。
2.  **裏面への注意**: 名刺の裏面には補足情報が含まれていることが多いため、特に注意を払ってください。
3.  **電話番号の分類**:
    - 一般的な会社の代表番号や固定電話は 'tel' フィールドに入れてください。
    - 「携帯電話」「Mobile」と明記されている番号は 'mobileTel' フィールドに入れてください。
    - 「カスタマーサポート」「お客様相談窓口」などのサポート関連の電話番号は、'otherTel' フィールドに "ラベル: 番号" の形式で記載してください。(例: "カスタマーサポート: 0120-xxx-xxx")。複数ある場合は改行で区切ってください。
4.  **ウェブサイトとSNSの分離**:
    - 会社の公式ウェブサイトは 'website' フィールドの配列に追加してください。
    - LinkedIn, X (Twitter), Facebookなどの**個人または会社のSNSアカウントのURL**は、'sns' フィールドの配列に一つずつ追加してください。
5.  **備考欄の活用**: 上記のどのフィールドにも当てはまらないその他の関連情報（事業内容、営業時間、キャッチコピー、URLではないSNSのIDやユーザー名など）は 'notes' フィールドにまとめてください。

上記の指示に厳密に従い、情報を抽出してください。`;

        requestBody = {
          contents: [{ parts }],
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: fullSchema
          }
        };
        break;
      }
      
      case 'reExtractInfo': {
        const { frontImage, backImage, fieldsToReExtract } = payload;
        if (!fieldsToReExtract || fieldsToReExtract.length === 0) {
            return res.status(200).json({}); // No fields to re-extract
        }

        const parts = [];
        if (frontImage) {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: frontImage.split(',')[1] } });
        }
        if (backImage) {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: backImage.split(',')[1] } });
        }
        parts.push({
          text: `これは名刺の再スキャンです。以前の抽出で不正確だった以下の項目のみに集中して、画像からより高い精度で情報を再抽出してください: ${fieldsToReExtract.join(', ')}`
        });

        const dynamicProperties = {};
        for (const field of fieldsToReExtract) {
            if (fullSchema.properties[field]) {
                dynamicProperties[field] = fullSchema.properties[field];
            }
        }
        const dynamicSchema = { type: "OBJECT", properties: dynamicProperties };
        
        requestBody = {
            contents: [{ parts }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: dynamicSchema
            }
        };
        break;
      }

      case 'summarize': {
        const { text } = payload;
        requestBody = {
          contents: [{ parts: [{ text: `以下の文章を簡潔に要約してください：\n\n${text}` }] }],
        };
        break;
      }
      
      case 'analyzePolicy': {
        const { images } = payload;
        const parts = [];
        
        if (!images || images.length === 0) {
            return res.status(400).json({ message: 'No images provided for analysis.' });
        }
        
        for (const image of images) {
            parts.push({ inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] } });
        }

        const policySchema = {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    key: { type: "STRING", description: "抽出した情報の項目名（例：証券番号、契約者名）" },
                    value: { type: "STRING", description: "抽出した情報の内容（例：123456789、山田 太郎）" }
                }
            }
        };

        const systemInstruction = `あなたは保険証券や関連書類の分析を専門とするAIアシスタントです。
提供された複数ページの画像を分析し、そこに含まれるすべての重要な情報を抽出してください。

**タスク:**
1.  すべての画像から情報を包括的に読み取ります。
2.  情報を「項目名（key）」と「内容（value）」のペアに整理します。
3.  結果を、指定されたJSONスキーマ（キーと値のペアの配列）に従って出力します。

**重要な指示:**
-   **項目名の標準化**: 「ご契約者さま」や「契約者氏名」は「契約者名」のように、意味が同じ項目はできるだけ標準的な言葉に統一してください。
-   **情報の統合**: 複数ページに同じ情報（例：証券番号）が記載されている場合、1つの項目にまとめてください。
-   **優先順位**: 以下の重要な項目を優先的に、リストの最初の方に配置してください： 証券番号, 契約者名, 保険会社名, 保険種類, 保険料。
-   **網羅性**: 上記以外のすべての関連情報（被保険者名、保険期間、保障内容、特約、車両情報など）も 빠짐なく抽出してください。
-   **該当なしの場合**: 画像に情報が存在しない場合、その項目は出力に含めないでください。`;

        requestBody = {
            contents: [{ parts }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: policySchema
            }
        };
        break;
      }


      case 'analyzeCard': {
        const { companyName, website, title, address } = payload;

        // --- Call 1: Structured Data ---
        const structuredAnalysisSchema = {
            type: "OBJECT",
            properties: {
                insuranceNeeds: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            need: { type: "STRING", description: "提案すべき保険の具体的な種類（例：労災保険）" },
                            reason: { type: "STRING", description: "その保険が必要だと考えられる簡潔な理由" }
                        }
                    }
                },
                disasterRisk: {
                    type: "OBJECT",
                    properties: {
                        riskType: { type: "STRING", description: "最も懸念される災害リスクの種類 (例: 地震, 水害)" },
                        level: { type: "STRING", description: "リスクのレベル (例: 高い, 中程度, 低い)" },
                        details: { type: "STRING", description: "リスクに関する具体的な詳細や根拠" }
                    }
                },
                approachStrategy: {
                    type: "OBJECT",
                    properties: {
                        titleBasedHints: {
                            type: "ARRAY",
                            items: { "type": "STRING" },
                            description: "名刺の役職者への効果的なアプローチ方法や会話の切り口のヒント"
                        },
                        proposalTemplate: {
                            type: "STRING",
                            description: "名刺の情報に基づいて生成された、すぐに使える簡潔な保険提案のテンプレート文章"
                        }
                    }
                }
            }
        };

        const systemInstructionStructured = `あなたは、日本の保険代理店の営業担当者を支援する、経験豊富なAI保険コンサルタントです。提供された企業情報に基づき、以下の構造化データを生成してください。
1.  **保険ニーズの分析**: 企業の業種や規模から、提案すべき保険商品を2〜3つ挙げ、その理由を説明してください。
2.  **災害リスク分析**: 提供された住所（${address || 'なし'}）に基づき、その地域で最も懸念される災害リスク（地震、水害など）を1つ特定し、リスクレベルと詳細を分析してください。住所情報がない場合は、この項目は分析不要です。
3.  **アプローチ戦略**:
    - **役職に応じたヒント**: 提供された役職の人物に響きやすい会話の切り口を2〜3つ提示してください。
    - **提案テンプレート**: 名刺情報に基づき、すぐに使える簡潔な保険提案のメールや会話のテンプレートを生成してください。`;

        const userContentStructured = `分析対象:
- 会社名: ${companyName || '情報なし'}
- ウェブサイト: ${Array.isArray(website) ? website.join(', ') : (website || '情報なし')}
- 役職: ${title || '情報なし'}
- 住所: ${address || '情報なし'}`;
        
        const requestBodyStructured = {
          contents: [{ parts: [{ text: userContentStructured }] }],
          systemInstruction: { parts: [{ text: systemInstructionStructured }] },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: structuredAnalysisSchema
          }
        };

        const structuredPromise = fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBodyStructured),
        }).then(res => res.json());


        // --- Call 2: Market Data with Search ---
        const userContentMarket = `日本の保険市場について、特に「${companyName}」のような企業（ウェブサイト: ${Array.isArray(website) ? website.join(', ') : (website || '情報なし')}）が属する業界向けの最新トレンドや、主要な競合商品の動向を教えてください。`;
        
        const requestBodyMarket = {
          contents: [{ parts: [{ text: userContentMarket }] }],
          tools: [{ googleSearch: {} }],
        };

        const marketPromise = fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBodyMarket),
        }).then(res => res.json());

        // --- Combine Results ---
        const [structuredResult, marketResult] = await Promise.all([structuredPromise, marketPromise]);

        if (structuredResult.error || marketResult.error) {
            console.error('Gemini API Error (Structured):', structuredResult.error);
            console.error('Gemini API Error (Market):', marketResult.error);
            throw new Error('One or more Gemini API requests failed.');
        }

        const combinedResult = {};
        
        if (structuredResult.candidates && structuredResult.candidates[0].content.parts[0].text) {
             const structuredData = JSON.parse(structuredResult.candidates[0].content.parts[0].text.trim());
             combinedResult.insuranceNeeds = structuredData.insuranceNeeds || [];
             combinedResult.disasterRisk = address ? (structuredData.disasterRisk || null) : null;
             combinedResult.approachStrategy = structuredData.approachStrategy || { titleBasedHints: [], proposalTemplate: '' };
        } else {
             combinedResult.insuranceNeeds = [];
             combinedResult.disasterRisk = null;
             combinedResult.approachStrategy = { titleBasedHints: [], proposalTemplate: '' };
        }

        if (marketResult.candidates && marketResult.candidates[0].content.parts[0].text) {
            const marketContent = marketResult.candidates[0].content.parts[0].text;
            const groundingChunks = marketResult.candidates[0].groundingMetadata?.groundingChunks || [];
            const sources = groundingChunks.map(chunk => ({
                uri: chunk.web?.uri || '',
                title: chunk.web?.title || '',
            })).filter(source => source.uri);
            
            combinedResult.marketInfo = {
                content: marketContent,
                sources: sources,
            };
        } else {
            combinedResult.marketInfo = null;
        }

        return res.status(200).json(combinedResult);
      }
      
      case 'mapCsvToExcel': {
        const { csvHeaders, excelHeaders } = payload;
        
        const mappingSchema = {
            type: "OBJECT",
            properties: {
                mapping: {
                    type: "OBJECT",
                    properties: csvHeaders.reduce((acc, header) => {
                        acc[header] = { 
                            type: "STRING",
                            description: `The best matching header from the Excel headers for the CSV header '${header}'. Should be one of [${excelHeaders.join(', ')}] or null.`,
                            nullable: true
                        };
                        return acc;
                    }, {})
                }
            }
        };

        const systemInstruction = `あなたは賢いデータマッピングアシスタントです。あなたの仕事は、CSVファイルの列をExcelファイルの最も適切な列にマッピングすることです。
提供されたCSVヘッダーとExcelヘッダーのリストに基づき、JSONオブジェクトを返してください。
このオブジェクトでは、各キーがCSVヘッダーで、その値が対応するExcelヘッダーになります。
意味に基づいて照合してください。言語が異なる場合（例：英語と日本語）でも対応してください。
CSVヘッダーに適した一致が見つからない場合は、値をnullに設定してください。`;
        
        const userContent = `CSV Headers: [${csvHeaders.join(', ')}]\nExcel Headers: [${excelHeaders.join(', ')}]`;
        
        requestBody = {
            contents: [{ parts: [{ text: userContent }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: mappingSchema
            }
        };
        break;
      }


      default:
        return res.status(400).json({ message: 'Invalid task specified.' });
    }

    // バックエンドからGemini APIへリクエストを送信
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.json();
      console.error('Gemini API Error:', error);
      throw new Error('Gemini API request failed.');
    }

    const data = await geminiResponse.json();
    
    // Geminiからのレスポンスを解析してフロントエンドに返す
    const responseText = data.candidates[0].content.parts[0].text;
    let result;
    if (task === 'extractInfo' || task === 'reExtractInfo' || task === 'analyzeCard' || task === 'analyzePolicy' || task === 'mapCsvToExcel') {
      result = JSON.parse(responseText.trim());
    } else { // summarize
      result = { summary: responseText };
    }
    
    return res.status(200).json(result);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ message: 'An internal server error occurred.' });
  }
}