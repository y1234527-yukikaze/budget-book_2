/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, StrictMode, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// --- 定数 ---
const USER_KEY = 'kakeibo_user';
const FAMILY_SETUP_COMPLETED_KEY = 'kakeibo_familySetupCompleted';
const OSHI_STORAGE_KEY = 'kakeibo_oshi';
const FIXED_COSTS_KEY = 'kakeibo_fixedCosts';
const RECEIPTS_KEY = 'kakeibo_receipts';
const SHOPPING_LIST_KEY = 'kakeibo_shoppingList';


// --- データ永続化ヘルパー ---
const getFromStorage = (key, defaultValue) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    console.error(`Could not access localStorage for key: ${key}`, e);
    return defaultValue;
  }
};

const setToStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Could not access localStorage for key: ${key}`, e);
  }
};

// --- API呼び出しヘルパー ---
const callApi = async (task, payload) => {
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task, payload }),
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || 'APIリクエストに失敗しました。');
    }
    return body; // { data: ... }
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};

// --- 日付操作ヘルパー ---
const getStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const getEndOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return getStartOfDay(new Date(d.setDate(diff)));
};
const getEndOfWeek = (date) => {
    const d = getStartOfWeek(date);
    return getEndOfDay(new Date(d.setDate(d.getDate() + 6)));
};


// --- UIコンポーネント ---

function Login({ onLogin }) {
  return (
    <div className="screen login-screen">
      <div className="card">
        <h2>ログイン</h2>
        <p className="text-light" style={{textAlign: 'center', marginBottom: '1.5rem'}}>
          始めるにはGoogleアカウントでログインしてください。
        </p>
        <button onClick={onLogin} className="btn btn-google">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
            <g>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </g>
          </svg>
          <span>Googleでログイン</span>
        </button>
        <p className="text-light" style={{fontSize: '0.8rem', marginTop: '1rem', textAlign: 'center'}}>
          ※これはデモ用の機能です。実際のGoogleログインは行われません。
        </p>
      </div>
    </div>
  );
}

function FamilySetup({ onComplete }) {
  const [mode, setMode] = useState('create'); // 'create', 'join'
  const [inviteCode, setInviteCode] = useState('');

  // A dummy code for demonstration
  const generatedCode = 'KAKEIBO-XYZ123';

  const handleComplete = (action) => {
    // In a real app, you'd save the code or join a family here.
    // For now, we just proceed.
    alert('家族共有機能は現在開発中です。UIのみ実装されています。');
    onComplete();
  };

  const handleSkip = () => {
    onComplete(); // Simply proceed without any "sharing" action.
  };

  return (
    <div className="screen">
      <div className="card">
        <h2>家族共有の初期設定</h2>
        <p className="text-light" style={{marginBottom: '1rem'}}>
          家族とデータを共有しますか？この設定は後からでも変更できます。
        </p>
        <div className="tab-buttons">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            招待する側
          </button>
          <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            招待された側
          </button>
        </div>

        {mode === 'create' && (
          <div className="tab-content">
            <p>他の家族を招待するためのコードです。</p>
            <div className="invite-code-display">{generatedCode}</div>
            <button className="btn btn-secondary" style={{width: 'auto'}} onClick={() => navigator.clipboard.writeText(generatedCode)}>コードをコピー</button>
            <button onClick={() => handleComplete('create')} className="btn btn-primary" style={{marginTop: '1rem'}}>設定を保存</button>
          </div>
        )}

        {mode === 'join' && (
          <div className="tab-content">
            <p>受け取った招待コードを入力してください。</p>
            <div className="form-group">
              <input
                type="text"
                className="text-input"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="招待コード"
                aria-label="招待コード入力"
              />
            </div>
            <button onClick={() => handleComplete('join')} className="btn btn-primary" disabled={!inviteCode.trim()}>
              参加する
            </button>
          </div>
        )}
      </div>
      <button onClick={handleSkip} className="btn btn-secondary" aria-label="共有しないで始める">
        共有しない
      </button>
    </div>
  );
}


function OshiSetup({ onOshiSet, onSkip }) {
  const [name, setName] = useState('');

  const handleSave = () => {
    if (name.trim()) {
      onOshiSet(name.trim());
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <h2>あなたの推しを教えてください</h2>
        <p className="text-light" style={{marginBottom: '1rem'}}>
          入力すると、あなたの推しに関する特別な情報をお届けします。
        </p>
        <div className="form-group">
          <label htmlFor="oshi-name">推しの名前</label>
          <input
            id="oshi-name"
            type="text"
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：アイドル名、キャラクター名"
            aria-label="推しの名前"
          />
        </div>
        <button
          onClick={handleSave}
          className="btn btn-primary"
          disabled={!name.trim()}
          aria-label="保存"
        >
          保存
        </button>
      </div>
      <button onClick={onSkip} className="btn btn-secondary" aria-label="推しを設定しない">
        推しを設定しない
      </button>
    </div>
  );
}

function Home({ oshi, onNavigate }) {
  return (
    <div className="screen">
      {oshi && (
        <div className="oshi-section card">
          <p>あなたの推し: <strong>{oshi}</strong></p>
          <button
            className="btn"
            onClick={() => onNavigate('OSHI_PUSH')}
            aria-label="今日のひと推し"
          >
            今日のひと推し
          </button>
        </div>
      )}
      <div className="home-grid">
        <button className="btn btn-secondary" onClick={() => onNavigate('LIFESTYLE_TIPS')} aria-label="くらしのヒント">くらしのヒント</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('SHOPPING_LIST')} aria-label="買い物忘れリスト">買い物忘れリスト</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('RECIPE')} aria-label="今晩のレシピ">今晩のレシピ</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('FIXED_COST_INPUT')} aria-label="固定費入力">固定費入力</button>
        <button className="btn btn-primary" onClick={() => onNavigate('RECEIPT_SCAN')} aria-label="レシートの入力">レシート入力</button>
        <button className="btn btn-primary" onClick={() => onNavigate('REPORTS')} aria-label="支出のレポート">支出のレポート</button>
      </div>
      <div className="settings-section">
          <button 
            className="btn btn-secondary"
            onClick={() => onNavigate('FAMILY_SETUP')}
            aria-label="家族共有の設定を変更"
          >
            家族共有設定
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => onNavigate('OSHI_SETUP')}
            aria-label="推しの設定を変更"
          >
            推しの設定
          </button>
      </div>
    </div>
  );
}

function OshiPush({ oshi, onBack }) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchOshiInfo = async () => {
      if (!oshi) {
        setError("「推し」が設定されていません。");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await callApi('oshi_push', { oshi });
        setInfo(response.data);
      } catch (e) {
        console.error("API call error:", e);
        setError(e.message || "情報の取得中にエラーが発生しました。しばらくしてからもう一度お試しください。");
      } finally {
        setLoading(false);
      }
    };

    fetchOshiInfo();
  }, [oshi]);

  return (
    <div className="screen">
      <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
        <span>ホームへ戻る</span>
      </button>
      <div className="card">
        <h2>今日のひと推し</h2>
        {loading && (
          <div className="loader-container">
            <div className="loader"></div>
            <p>情報を取得中...</p>
          </div>
        )}
        {error && <p className="error-message">{error}</p>}
        {info && <p>{info}</p>}
      </div>
    </div>
  );
}

function ReceiptScan({ onComplete, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState('');
  const [capturedImages, setCapturedImages] = useState([]);

  useEffect(() => {
    let stream;
    const enableCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setError("カメラへのアクセスが許可されませんでした。");
      }
    };
    enableCamera();
    return () => {
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handleCapture = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedImages(prevImages => [...prevImages, dataUrl]);
  };
  
  const handleRemoveImage = (indexToRemove) => {
      setCapturedImages(prevImages => prevImages.filter((_, index) => index !== indexToRemove));
  };

  const handleDone = () => {
      if(capturedImages.length > 0) {
          onComplete(capturedImages);
      }
  };


  return (
     <div className="screen">
      <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
        <span>ホームへ戻る</span>
      </button>
       <div className="receipt-scan-view">
         <h2>レシートを撮影</h2>
         <p className="text-light" style={{textAlign: 'center', marginBottom: '1rem'}}>
            長いレシートは分割して撮影できます。
         </p>
         {error ? <p className="error-message">{error}</p> : (
            <div className="camera-container">
              <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
              <div className="scan-overlay"></div>
            </div>
         )}
        <button onClick={handleCapture} className="capture-btn" aria-label="撮影する" disabled={!!error}></button>
        <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
        
        {capturedImages.length > 0 && (
            <div className="thumbnail-container">
                <h3>撮影済み ({capturedImages.length}枚)</h3>
                <div className="thumbnail-list">
                    {capturedImages.map((imgSrc, index) => (
                        <div key={index} className="thumbnail-item">
                            <img src={imgSrc} alt={`撮影 ${index + 1}`} />
                             <button onClick={() => handleRemoveImage(index)} className="delete-btn thumbnail-delete-btn" aria-label={`撮影 ${index + 1} を削除`}>×</button>
                        </div>
                    ))}
                </div>
                 <button onClick={handleDone} className="btn btn-primary" style={{marginTop: '1rem'}}>撮影完了</button>
            </div>
        )}
       </div>
    </div>
  );
}

function ReceiptConfirm({ imagesB64, onBack, onSave, onRescan }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState(null);

  useEffect(() => {
    const processReceipt = async () => {
      if (!imagesB64 || imagesB64.length === 0) {
        setError("解析する画像がありません。");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await callApi('receipt_confirm', { imagesB64 });
        const parsedData = JSON.parse(response.data);
        setFormData(parsedData);
      } catch (e) {
        console.error("API call error:", e);
        setError("レシート情報の解析中にエラーが発生しました。");
      } finally {
        setLoading(false);
      }
    };

    processReceipt();
  }, [imagesB64]);

  const handleFieldChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    const itemValue = field === 'price' ? parseInt(value, 10) || 0 : value;
    newItems[index] = { ...newItems[index], [field]: itemValue };
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const handleSave = () => {
    onSave(formData);
  }

  if (loading) {
    return (
      <div className="screen">
        <div className="loader-container">
          <div className="loader"></div>
          <p>レシートを解析中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen receipt-confirm-view">
        <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
            <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
            <span>ホームへ戻る</span>
        </button>
        <div className="card">
        <h2>レシート情報の確認・編集</h2>
        {error && <p className="error-message">{error}</p>}
        {formData && (
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label htmlFor="storeName">店名</label>
              <input type="text" id="storeName" className="text-input" value={formData.storeName || ''} onChange={(e) => handleFieldChange('storeName', e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="purchaseDate">購入日</label>
              <input type="date" id="purchaseDate" className="text-input" value={formData.purchaseDate || ''} onChange={(e) => handleFieldChange('purchaseDate', e.target.value)} />
            </div>

            <div className="item-list">
              <h3>購入品目</h3>
              <table>
                <thead>
                  <tr><th>品名</th><th>金額（円）</th></tr>
                </thead>
                <tbody>
                  {formData.items?.map((item, index) => (
                    <tr key={index}>
                      <td><input type="text" className="text-input item-name-input" value={item.name || ''} onChange={(e) => handleItemChange(index, 'name', e.target.value)} /></td>
                      <td><input type="number" className="text-input item-price-input" value={item.price || ''} onChange={(e) => handleItemChange(index, 'price', e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}
       </div>
       <div className="confirm-actions">
            <button onClick={handleSave} className="btn btn-primary">保存</button>
            <button onClick={onRescan} className="btn btn-secondary">続けて別のレシートを撮影</button>
       </div>
    </div>
  );
}

function FixedCostInput({ initialCosts, onSave, onBack }) {
    const [costs, setCosts] = useState(initialCosts || []);
    const [itemName, setItemName] = useState('');
    const [itemAmount, setItemAmount] = useState('');

    const handleAddItem = (e) => {
        e.preventDefault();
        if (itemName.trim() && Number(itemAmount) > 0) {
            setCosts([...costs, { id: Date.now(), name: itemName.trim(), amount: parseInt(itemAmount, 10) }]);
            setItemName('');
            setItemAmount('');
        }
    };

    const handleRemoveItem = (id) => {
        setCosts(costs.filter(cost => cost.id !== id));
    };

    const handleSave = () => {
        onSave(costs);
    };

    const totalAmount = costs.reduce((sum, cost) => sum + cost.amount, 0);

    return (
        <div className="screen">
            <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
                <span>ホームへ戻る</span>
            </button>
            <div className="card">
                <h2>月々の固定費</h2>
                <form onSubmit={handleAddItem} className="fixed-cost-form">
                    <div className="form-group">
                        <label htmlFor="cost-name">項目</label>
                        <input
                            id="cost-name"
                            type="text"
                            className="text-input"
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                            placeholder="例：家賃、光熱費"
                            aria-label="項目を入力"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="cost-amount">金額（円）</label>
                        <input
                            id="cost-amount"
                            type="number"
                            className="text-input"
                            value={itemAmount}
                            onChange={(e) => setItemAmount(e.target.value)}
                            placeholder="例: 80000"
                            aria-label="金額を入力"
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" aria-label="追加ボタン">追加</button>
                </form>
            </div>
            <div className="card">
                <h3>現在の固定費リスト</h3>
                {costs.length === 0 ? (
                    <p className="text-light">追加された固定費はありません。</p>
                ) : (
                    <ul className="item-list-display">
                        {costs.map(cost => (
                            <li key={cost.id}>
                                <span>{cost.name}</span>
                                <span className="item-amount">{cost.amount.toLocaleString()}円</span>
                                <button onClick={() => handleRemoveItem(cost.id)} className="delete-btn" aria-label={`${cost.name}を削除`}>×</button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="total-amount">
                    <strong>合計: {totalAmount.toLocaleString()}円</strong>
                </div>
            </div>
            <button onClick={handleSave} className="btn btn-primary" style={{marginTop: '1rem'}}>保存する</button>
        </div>
    );
}

function ShoppingList({ receipts, onBack }) {
    const [items, setItems] = useState(() => getFromStorage(SHOPPING_LIST_KEY, []));
    const [newItemName, setNewItemName] = useState('');
    const [aiSuggestions, setAiSuggestions] = useState([]);
    const [loadingAi, setLoadingAi] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setToStorage(SHOPPING_LIST_KEY, items);
    }, [items]);

    useEffect(() => {
        const fetchSuggestions = async () => {
            if (receipts.length < 3) {
                setLoadingAi(false);
                return;
            }
            setLoadingAi(true);
            setError('');
            try {
                const response = await callApi('shopping_list', { receipts });
                const suggestions = response.data.suggestions || [];
                const currentItemNames = items.map(item => item.name.toLowerCase());
                const filteredSuggestions = suggestions.filter(suggestion => !currentItemNames.includes(suggestion.toLowerCase()));
                setAiSuggestions(filteredSuggestions);
            } catch (e) {
                console.error("API call error in shopping list:", e);
                setError("AIによる提案の取得に失敗しました。");
            } finally {
                setLoadingAi(false);
            }
        };
        fetchSuggestions();
    }, [receipts]); 

    const handleAddItem = (e) => {
        e.preventDefault();
        if (newItemName.trim()) {
            const newItem = { id: Date.now(), name: newItemName.trim(), checked: false };
            setItems(prevItems => [...prevItems, newItem]);
            setNewItemName('');
        }
    };

    const handleToggleItem = (id) => {
        setItems(prevItems => prevItems.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
    };

    const handleRemoveItem = (id) => {
        setItems(prevItems => prevItems.filter(item => item.id !== id));
    };

    const handleAddFromSuggestion = (suggestionName) => {
        if (!items.some(item => item.name.toLowerCase() === suggestionName.toLowerCase())) {
            const newItem = { id: Date.now(), name: suggestionName, checked: false };
            setItems(prevItems => [...prevItems, newItem]);
        }
        setAiSuggestions(prev => prev.filter(s => s !== suggestionName));
    };

    return (
        <div className="screen">
            <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
                <span>ホームへ戻る</span>
            </button>
            <div className="card">
                <h2>買い物忘れリスト</h2>

                <div className="ai-suggestions">
                    <h3>AIからの提案</h3>
                    {loadingAi && <div className="loader-container mini"><div className="loader"></div></div>}
                    {error && <p className="error-message">{error}</p>}
                    {!loadingAi && receipts.length < 3 && <p className="text-light">レシートデータが3件以上貯まると、AIが買い忘れそうなものを提案します。</p>}
                    {!loadingAi && aiSuggestions.length > 0 && (
                        <ul className="suggestion-list">
                            {aiSuggestions.map((item, index) => (
                                <li key={index}>
                                    <span>{item}</span>
                                    <button onClick={() => handleAddFromSuggestion(item)} className="add-suggestion-btn" aria-label={`${item}をリストに追加`}>+</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {!loadingAi && receipts.length >= 3 && aiSuggestions.length === 0 && !error && <p className="text-light">AIからの新しい提案はありません。</p>}
                </div>

                <div className="manual-list">
                    <h3>あなたの買い物リスト</h3>
                    <form onSubmit={handleAddItem} className="add-item-form">
                        <input
                            type="text"
                            className="text-input"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder="例：牛乳、パン"
                            aria-label="新しい買い物項目"
                        />
                        <button type="submit" className="btn btn-primary" disabled={!newItemName.trim()}>追加</button>
                    </form>
                    <ul className="shopping-list-display">
                        {items.length === 0 ? (
                             <p className="text-light">リストに項目はありません。</p>
                        ) : (
                            items.map(item => (
                                <li key={item.id} className={item.checked ? 'checked' : ''}>
                                    <label>
                                        <input type="checkbox" checked={item.checked} onChange={() => handleToggleItem(item.id)} />
                                        <span>{item.name}</span>
                                    </label>
                                    <button onClick={() => handleRemoveItem(item.id)} className="delete-btn" aria-label={`${item.name}を削除`}>×</button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}

function Recipe({ receipts, onBack }) {
    const [loading, setLoading] = useState(true);
    const [recipe, setRecipe] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchRecipe = async () => {
            if (receipts.length < 3) {
                setLoading(false);
                return;
            }
            setLoading(true);
            setError('');
            try {
                const response = await callApi('recipe', { receipts });
                setRecipe(response.data);
            } catch (e) {
                console.error("API call error in recipe:", e);
                setError("レシピの取得に失敗しました。");
            } finally {
                setLoading(false);
            }
        };

        fetchRecipe();
    }, [receipts]);

    return (
        <div className="screen">
            <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
                <span>ホームへ戻る</span>
            </button>
            <div className="card">
                <h2>今晩のレシピ</h2>
                {loading && <div className="loader-container"><div className="loader"></div><p>レシピを考え中...</p></div>}
                {error && <p className="error-message">{error}</p>}
                {!loading && receipts.length < 3 && <p className="text-light">レシートデータが3件以上貯まると、家にあるもので作れそうなレシピを提案します。</p>}
                {recipe && (
                    <div className="recipe-details">
                        <h3>{recipe.recipeName}</h3>
                        <div className="recipe-section">
                            <h4>材料</h4>
                            <ul>
                                {recipe.ingredients.map((item, index) => <li key={index}>{item}</li>)}
                            </ul>
                        </div>
                        <div className="recipe-section">
                            <h4>作り方</h4>
                            <ol>
                                {recipe.instructions.map((step, index) => <li key={index}>{step}</li>)}
                            </ol>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function LifestyleTips({ receipts, onBack }) {
    const [loading, setLoading] = useState(true);
    const [tips, setTips] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchTips = async () => {
            if (receipts.length < 1) {
                setLoading(false);
                return;
            }
            setLoading(true);
            setError('');
            try {
                const response = await callApi('lifestyle_tips', { receipts });
                setTips(response.data);
            } catch (e) {
                console.error("API call error in lifestyle tips:", e);
                setError("ヒントの取得に失敗しました。");
            } finally {
                setLoading(false);
            }
        };

        fetchTips();
    }, [receipts]);

    return (
        <div className="screen">
            <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
                <span>ホームへ戻る</span>
            </button>
            <div className="card">
                <h2>くらしのヒント</h2>
                {loading && <div className="loader-container"><div className="loader"></div><p>AIが分析中...</p></div>}
                {error && <p className="error-message">{error}</p>}
                {!loading && receipts.length < 1 && <p className="text-light">レシートデータが貯まると、AIが生活に役立つヒントを提案します。</p>}
                {tips && <p style={{lineHeight: 1.8}}>{tips}</p>}
            </div>
        </div>
    );
}

function Reports({ receipts, fixedCosts, onBack }) {
    const [activeTab, setActiveTab] = useState('today');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [yearlyChartData, setYearlyChartData] = useState(null);
    const [loadingChart, setLoadingChart] = useState(false);
    const [error, setError] = useState('');

    const changeDate = (amount) => {
        const newDate = new Date(currentDate);
        if (activeTab === 'today') newDate.setDate(newDate.getDate() + amount);
        if (activeTab === 'weekly') newDate.setDate(newDate.getDate() + (amount * 7));
        if (activeTab === 'monthly') newDate.setMonth(newDate.getMonth() + amount);
        if (activeTab === 'yearly') newDate.setFullYear(newDate.getFullYear() + amount);
        setCurrentDate(newDate);
    };

    const getFilteredReceipts = () => {
        if (activeTab === 'today') {
            const start = getStartOfDay(currentDate);
            const end = getEndOfDay(currentDate);
            return receipts.filter(r => new Date(r.purchaseDate) >= start && new Date(r.purchaseDate) <= end);
        }
        if (activeTab === 'weekly') {
            const start = getStartOfWeek(currentDate);
            const end = getEndOfWeek(currentDate);
            return receipts.filter(r => new Date(r.purchaseDate) >= start && new Date(r.purchaseDate) <= end);
        }
        if (activeTab === 'monthly') {
            return receipts.filter(r => new Date(r.purchaseDate).getMonth() === currentDate.getMonth() && new Date(r.purchaseDate).getFullYear() === currentDate.getFullYear());
        }
        if (activeTab === 'yearly') {
            return receipts.filter(r => new Date(r.purchaseDate).getFullYear() === currentDate.getFullYear());
        }
        return [];
    };

    useEffect(() => {
        if (activeTab !== 'yearly') {
            setYearlyChartData(null);
            return;
        }

        const generateChart = async () => {
            const yearlyReceipts = getFilteredReceipts();
            if (yearlyReceipts.length === 0) {
                 setYearlyChartData({ categories: [], maxAmount: 0 });
                 return;
            }

            setLoadingChart(true);
            setError('');
            try {
                const response = await callApi('yearly_report', { yearlyReceipts });
                setYearlyChartData(response.data);
            } catch (e) {
                console.error("API call error in reports:", e);
                setError("年間レポートの生成中にエラーが発生しました。");
                setYearlyChartData(null);
            } finally {
                setLoadingChart(false);
            }
        };

        generateChart();
    }, [activeTab, currentDate, receipts]);
    
    const titleFormats = {
        today: `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`,
        weekly: `${getStartOfWeek(currentDate).toLocaleDateString()} - ${getEndOfWeek(currentDate).toLocaleDateString()}`,
        monthly: `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`,
        yearly: `${currentDate.getFullYear()}年`
    };

    const renderContent = () => {
        const filtered = getFilteredReceipts();
        const total = filtered.reduce((sum, r) => sum + r.items.reduce((itemSum, i) => itemSum + i.price, 0), 0);
        
        if (activeTab === 'yearly') {
            const yearlyTotal = total + (fixedCosts.reduce((sum, c) => sum + c.amount, 0) * 12);
            return (
                <div>
                     {loadingChart && <div className="loader-container mini"><div className="loader"></div><p>グラフを生成中...</p></div>}
                     {error && <p className="error-message">{error}</p>}
                     {yearlyChartData && (
                        <div>
                             <div className="report-summary">
                                <span>年間の変動費合計</span>
                                <strong>{total.toLocaleString()}円</strong>
                            </div>
                             <div className="report-summary total">
                                <span>年間の総合計 (固定費込)</span>
                                <strong>{yearlyTotal.toLocaleString()}円</strong>
                            </div>
                            <div className="chart-container">
                                {yearlyChartData.categories.length > 0 ? yearlyChartData.categories.map(cat => (
                                     <div key={cat.name} className="chart-bar-group">
                                        <div className="chart-label">{cat.name} ({cat.amount.toLocaleString()}円)</div>
                                        <div className="chart-bar" style={{width: `${(cat.amount / yearlyChartData.maxAmount) * 100}%`}}></div>
                                    </div>
                                )) : <p className="text-light">この年のデータはありません。</p>}
                            </div>
                        </div>
                     )}
                </div>
            )
        }
        
        const monthlyTotal = total + fixedCosts.reduce((sum, c) => sum + c.amount, 0);

        return (
            <div>
                <div className="report-summary">
                    <span>
                        {activeTab === 'today' && '今日の合計'}
                        {activeTab === 'weekly' && '週間の合計'}
                        {activeTab === 'monthly' && '月間の変動費'}
                    </span>
                    <strong>{total.toLocaleString()}円</strong>
                </div>

                {activeTab === 'monthly' && (
                     <>
                        <div className="report-summary secondary">
                            <span>固定費</span>
                            <strong>{fixedCosts.reduce((sum, c) => sum + c.amount, 0).toLocaleString()}円</strong>
                        </div>
                        <div className="report-summary total">
                            <span>月間総合計</span>
                            <strong>{monthlyTotal.toLocaleString()}円</strong>
                        </div>
                     </>
                )}
                
                {activeTab === 'today' && (
                     <ul className="item-list-display">
                        {filtered.length === 0 ? <p className="text-light">この期間のデータはありません。</p> :
                        filtered.flatMap(r => r.items.map((item, i) => (
                            <li key={`${r.id}-${i}`}>
                                <span>{item.name} <span className="text-light">({new Date(r.purchaseDate).toLocaleDateString()})</span></span>
                                <span className="item-amount">{item.price.toLocaleString()}円</span>
                            </li>
                        )))}
                    </ul>
                )}

                {(activeTab === 'weekly' || activeTab === 'monthly') && filtered.length === 0 && (
                     <p className="text-light" style={{marginTop: '1rem'}}>この期間のデータはありません。</p>
                )}
            </div>
        )
    };

    return (
         <div className="screen">
            <button onClick={onBack} className="back-button" aria-label="ホームへ戻る">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
                <span>ホームへ戻る</span>
            </button>
            <div className="card">
                <h2>支出レポート</h2>
                <div className="report-tabs">
                    <button onClick={() => setActiveTab('today')} className={activeTab === 'today' ? 'active' : ''}>今日</button>
                    <button onClick={() => setActiveTab('weekly')} className={activeTab === 'weekly' ? 'active' : ''}>週間</button>
                    <button onClick={() => setActiveTab('monthly')} className={activeTab === 'monthly' ? 'active' : ''}>月間</button>
                    <button onClick={() => setActiveTab('yearly')} className={activeTab === 'yearly' ? 'active' : ''}>年間</button>
                </div>
                
                 <div className="date-navigator">
                    <button onClick={() => changeDate(-1)}>&lt;</button>
                    <span>{titleFormats[activeTab]}</span>
                    <button onClick={() => changeDate(1)}>&gt;</button>
                </div>

                <div className="report-content">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}


// --- メインAppコンポーネント ---

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('LOADING'); // LOADING, LOGIN, FAMILY_SETUP, OSHI_SETUP, HOME, OSHI_PUSH, RECEIPT_SCAN, RECEIPT_CONFIRM, FIXED_COST_INPUT, SHOPPING_LIST, RECIPE, LIFESTYLE_TIPS, REPORTS
  const [oshi, setOshi] = useState(null);
  const [receiptImages, setReceiptImages] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [fixedCosts, setFixedCosts] = useState([]);


  useEffect(() => {
    const storedUser = getFromStorage(USER_KEY, null);
    if (storedUser) {
        setUser(storedUser);
        setOshi(getFromStorage(OSHI_STORAGE_KEY, null));
        setReceipts(getFromStorage(RECEIPTS_KEY, []));
        setFixedCosts(getFromStorage(FIXED_COSTS_KEY, []));

        const familySetupDone = getFromStorage(FAMILY_SETUP_COMPLETED_KEY, false);
        const oshiSetupDone = getFromStorage(OSHI_STORAGE_KEY, undefined) !== undefined;

        if (!familySetupDone) {
          setView('FAMILY_SETUP');
        } else if (!oshiSetupDone) {
          setView('OSHI_SETUP');
        } else {
          setView('HOME');
        }
    } else {
        setView('LOGIN');
    }
  }, []);
  
  const handleLogin = () => {
      const mockUser = { name: 'デモユーザー' };
      setUser(mockUser);
      setToStorage(USER_KEY, mockUser);
      setView('FAMILY_SETUP');
  };
  
  const handleLogout = () => {
      if (window.confirm('ログアウトしますか？入力したデータはすべてリセットされます。')) {
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem(FAMILY_SETUP_COMPLETED_KEY);
          localStorage.removeItem(OSHI_STORAGE_KEY);
          localStorage.removeItem(FIXED_COSTS_KEY);
          localStorage.removeItem(RECEIPTS_KEY);
          localStorage.removeItem(SHOPPING_LIST_KEY);
          setUser(null);
          // Reset all states
          setOshi(null);
          setReceipts([]);
          setFixedCosts([]);
          setReceiptImages([]);
          setView('LOGIN');
      }
  };


  const handleFamilySetupComplete = () => {
    setToStorage(FAMILY_SETUP_COMPLETED_KEY, true);
    const oshiSetupDone = getFromStorage(OSHI_STORAGE_KEY, undefined) !== undefined;
    if (!oshiSetupDone) {
        setView('OSHI_SETUP');
    } else {
        setView('HOME');
    }
  };

  const handleOshiSet = (newOshi) => {
    setOshi(newOshi);
    setToStorage(OSHI_STORAGE_KEY, newOshi);
    setView('HOME');
  };
  
  const handleSkipOshi = () => {
    setOshi(null);
    setToStorage(OSHI_STORAGE_KEY, null);
    setView('HOME');
  };

  const handleReceiptCapture = (imageDataUrls) => {
    setReceiptImages(imageDataUrls);
    setView('RECEIPT_CONFIRM');
  };
  
  const handleSaveReceipt = (newReceiptData) => {
    const newReceipts = [...receipts, { ...newReceiptData, id: Date.now() }];
    setReceipts(newReceipts);
    setToStorage(RECEIPTS_KEY, newReceipts);
    alert("レシートが保存されました！");
    setView('HOME');
  };
  
  const handleSaveFixedCosts = (newFixedCosts) => {
    setFixedCosts(newFixedCosts);
    setToStorage(FIXED_COSTS_KEY, newFixedCosts);
    alert("固定費が保存されました！");
    setView('HOME');
  };

  const renderView = () => {
    switch (view) {
      case 'LOGIN':
        return <Login onLogin={handleLogin} />;
      case 'FAMILY_SETUP':
        return <FamilySetup onComplete={handleFamilySetupComplete} />;
      case 'OSHI_SETUP':
        return <OshiSetup onOshiSet={handleOshiSet} onSkip={handleSkipOshi} />;
      case 'HOME':
        return <Home oshi={oshi} onNavigate={setView} />;
      case 'OSHI_PUSH':
        return <OshiPush oshi={oshi} onBack={() => setView('HOME')} />;
      case 'RECEIPT_SCAN':
        return <ReceiptScan onComplete={handleReceiptCapture} onBack={() => setView('HOME')} />;
      case 'RECEIPT_CONFIRM':
        return <ReceiptConfirm 
                    imagesB64={receiptImages} 
                    onBack={() => setView('HOME')}
                    onSave={handleSaveReceipt}
                    onRescan={() => setView('RECEIPT_SCAN')}
                />;
       case 'FIXED_COST_INPUT':
         return <FixedCostInput 
                    initialCosts={fixedCosts} 
                    onSave={handleSaveFixedCosts} 
                    onBack={() => setView('HOME')} 
                />;
       case 'SHOPPING_LIST':
         return <ShoppingList receipts={receipts} onBack={() => setView('HOME')} />;
       case 'RECIPE':
         return <Recipe receipts={receipts} onBack={() => setView('HOME')} />;
       case 'LIFESTYLE_TIPS':
         return <LifestyleTips receipts={receipts} onBack={() => setView('HOME')} />;
       case 'REPORTS':
        return <Reports receipts={receipts} fixedCosts={fixedCosts} onBack={() => setView('HOME')} />;
      case 'LOADING':
      default:
        return (
          <div className="screen">
            <div className="loader-container">
              <div className="loader"></div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="app-container">
       <header className="app-header">
        <div className="header-content">
          <h1>我が家の！かんたん家計簿</h1>
          {user && (
            <div className="user-info">
              <span>{user.name}</span>
              <button onClick={handleLogout} className="btn-logout" aria-label="ログアウト">ログアウト</button>
            </div>
          )}
        </div>
      </header>
      <main className="app-content">
        {renderView()}
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
