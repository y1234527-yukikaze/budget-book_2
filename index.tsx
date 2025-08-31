/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, StrictMode, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// --- グローバル診断関数の型定義 ---
declare global {
  interface Window {
    diagnosticLog: (message: string, type?: 'info' | 'success' | 'error') => void;
    React: any;
    ReactDOM: any;
    google: any; // GSIスクリプトによってグローバルに追加される
    gapi: any; // GAPIスクリプトによってグローバルに追加される
  }
}

// --- Custom Error Type ---
interface StatusError extends Error {
  status?: number;
  code?: number;
  result?: { error?: { code?: number; message?: string; } };
}

// --- 定数 ---
const APP_DATA_FILE_NAME = 'kakeibo_app_data.json';
const USER_DATA_KEY_PREFIX = 'kakeibo_userdata_';

// --- データ永続化ヘルパー (localStorage for user settings) ---
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
const getUserDataKey = (userId) => `${USER_DATA_KEY_PREFIX}${userId}`;


// --- Google Drive API ヘルパー ---
const driveApi = {
  async _ensureClientReady() {
    if (!window.gapi?.client?.drive) {
        window.diagnosticLog('Drive API client not ready. This may indicate an initialization issue.', 'error');
        throw new Error('Google Drive APIの準備ができていません。アプリの初期化に問題がある可能性があります。ページを再読み込みしてください。');
    }
  },
  
  async findOrCreateFile(fileName) {
    await this._ensureClientReady();
    // 1. Search for the file among files created by this app.
    // With 'drive.file' scope, we list all files accessible by the app and filter by name.
    const response = await window.gapi.client.drive.files.list({
      spaces: 'drive',
      fields: 'files(id, name)',
    });

    const existingFile = response.result.files.find(f => f.name === fileName);

    if (existingFile) {
      const fileId = existingFile.id;
      window.diagnosticLog(`Found existing Drive file with ID: ${fileId}`, 'success');
      return fileId;
    } else {
      // 2. If not found, create it in the root of the user's Drive.
      window.diagnosticLog(`No file found. Creating new file: ${fileName}`);
      const fileMetadata = {
        name: fileName,
      };
      const createResponse = await window.gapi.client.drive.files.create({
        resource: fileMetadata,
        fields: 'id',
      });
      const newFileId = createResponse.result.id;
      window.diagnosticLog(`Successfully created new Drive file with ID: ${newFileId}`, 'success');

      // Initialize with empty data structure
      const initialData = { receipts: [], fixedCosts: {}, oshi: { name: '', url: '' }, shoppingList: [] };
      await this.saveFile(newFileId, initialData);

      return newFileId;
    }
  },
  
  async archiveFile(fileId) {
    await this._ensureClientReady();
    window.diagnosticLog(`Attempting to archive file with ID: ${fileId}`);
    // Create a user-friendly timestamp for the archive name
    const d = new Date();
    const timestamp = `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;
    const newName = `${APP_DATA_FILE_NAME.replace('.json', '')}_archive_${timestamp}.json`;

    const fileMetadata = {
        name: newName,
    };
    
    await window.gapi.client.drive.files.update({
        fileId: fileId,
        resource: fileMetadata,
    });
    window.diagnosticLog(`File archived successfully to new name: ${newName}`, 'success');
  },

  async loadFile(fileId) {
    await this._ensureClientReady();
    window.diagnosticLog(`Attempting to load file with ID: ${fileId}`);

    // Step 1: Verify metadata and permissions first.
    try {
        window.diagnosticLog(`Step 1: Fetching metadata and capabilities for file ID: ${fileId}`);
        const metaResponse = await window.gapi.client.drive.files.get({
            fileId: fileId,
            fields: 'id, name, capabilities'
        });
        
        const capabilities = metaResponse.result.capabilities;
        window.diagnosticLog(`Metadata loaded successfully for file: '${metaResponse.result.name}'`, 'success');
        
        if (!capabilities.canEdit) {
            window.diagnosticLog(`Permission check failed: User requires 'canEdit' capability but it is false.`, 'error');
            // Create a custom error object to be caught below.
            const permissionError: StatusError = new Error('ファイルへの「編集者」権限が必要です。オーナーに共有設定の変更を依頼してください。');
            permissionError.status = 403; // Use 403 to signify permission issue.
            throw permissionError;
        }
        window.diagnosticLog(`Permission check passed: User can edit the file.`, 'success');

    } catch(e) {
        // This catch handles failures of the metadata check.
        console.error("Error during file metadata verification:", e);
        const err = e as StatusError;
        const status = err.result?.error?.code || err.status || err.code;
        window.diagnosticLog(`Metadata verification failed. Status: ${status}. Message: ${err.message}`, 'error');

        // Re-throw with a user-friendly message.
        if (status === 404) {
            throw new Error(`ファイルが見つかりませんでした (404 Not Found)。招待コードが正しいか、共有設定が完了しているか確認してください。`);
        }
        if (status === 403) {
            // This will catch both the custom 'canEdit' error and real 403s.
            throw new Error(err.message || `ファイルへのアクセスが拒否されました (403 Forbidden)。ファイルのオーナーに「編集者」権限での共有を依頼してください。`);
        }
        throw new Error(`Google Driveファイルの検証に失敗しました。理由: ${err.message || '不明なエラー'}`);
    }

    // Step 2: If metadata check passes, load the content.
    try {
        window.diagnosticLog(`Step 2: Fetching file content.`);
        const contentResponse = await window.gapi.client.drive.files.get({
          fileId: fileId,
          alt: 'media',
        });
        window.diagnosticLog(`File content loaded successfully.`, 'success');
        // Handle cases where the file is new and empty
        return contentResponse.body ? JSON.parse(contentResponse.body) : {};
    } catch(e) {
        // This catch handles failures of the content download. Should be rare if metadata works.
        console.error("Error loading file content from Drive:", e);
        const err = e as StatusError;
        const status = err.result?.error?.code || err.status || err.code;
        window.diagnosticLog(`Failed to load file content. Status: ${status}.`, 'error');
        // It's possible to get a 403 here too, e.g. if download is disabled by policy.
        throw new Error(`Google Driveからのデータ本体の読み込みに失敗しました。理由: ${err.message || '不明なエラー'}`);
    }
  },

  async saveFile(fileId, data) {
    await this._ensureClientReady();
    window.diagnosticLog(`Attempting to save file with ID: ${fileId}`);
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const metadata = {
      'mimeType': 'application/json'
    };

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(data) +
        close_delim;
    
    const request = window.gapi.client.request({
        'path': `/upload/drive/v3/files/${fileId}`,
        'method': 'PATCH',
        'params': {'uploadType': 'multipart'},
        'headers': {
          'Content-Type': 'multipart/related; boundary="' + boundary + '"'
        },
        'body': multipartRequestBody
    });
    
    await request;
    window.diagnosticLog(`File saved successfully.`, 'success');
  }
};


// --- API呼び出しヘルパー (変更なし) ---
const callApi = async (task, payload) => {
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task, payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error;
      } catch (e) {
        errorMessage = errorText;
      }
      if (!errorMessage) {
        errorMessage = `APIリクエストに失敗しました。ステータス: ${response.status}`;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};

// --- 日付操作ヘルパー (変更なし) ---
const getStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const getEndOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return getStartOfDay(new Date(d.setDate(diff)));
};
const getEndOfWeek = (date) => {
    const d = getStartOfWeek(date);
    return getEndOfDay(new Date(d.setDate(d.getDate() + 6)));
};

// --- Custom Hooks ---
const useSwipeBack = (onBack) => {
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isSwiping = useRef(false);

  const handleTouchStart = useCallback((e) => {
    // Only start tracking if touch is near the left edge
    const edgeThreshold = 40; // pixels from the left edge
    if (e.targetTouches[0].clientX < edgeThreshold) {
      touchStartX.current = e.targetTouches[0].clientX;
      touchEndX.current = e.targetTouches[0].clientX;
      isSwiping.current = true; // Start tracking swipe
    } else {
      isSwiping.current = false;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isSwiping.current) return;
    touchEndX.current = e.targetTouches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping.current) return;
    isSwiping.current = false;

    const swipeThreshold = 75; // Minimum pixels for a swipe
    if (touchEndX.current - touchStartX.current > swipeThreshold) {
      if (onBack) {
        onBack();
      }
    }
  }, [onBack]);

  useEffect(() => {
    if (typeof onBack !== 'function') return;

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onBack, handleTouchStart, handleTouchMove, handleTouchEnd]);
};


// --- UIコンポーネント ---

function Login({ onLogin, error }) {
  return (
    <div className="screen login-screen">
      <div className="card">
        <h2>ログイン</h2>
        {error ? (
           <p className="error-message">{error}</p>
        ) : (
          <>
            <p className="text-light" style={{textAlign: 'center', marginBottom: '1.5rem'}}>
              始めるにはGoogleアカウントでログインし、Google Driveへのアクセスを許可してください。
            </p>
            <button id="google-signin-button" className="btn btn-primary" onClick={onLogin}>
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" style={{marginRight: '10px'}}><path fill="white" d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.75 8.36,4.73 12.19,4.73C15.28,4.73 17.27,6.48 17.27,6.48L19.6,4.2C19.6,4.2 16.59,1 12.19,1C6.42,1 2.03,5.57 2.03,12C2.03,18.43 6.42,23 12.19,23C17.9,23 21.5,18.33 21.5,12.33C21.5,11.76 21.45,11.43 21.35,11.1Z"></path></svg>
              Googleアカウントでログイン
            </button>
            <p style={{fontSize: '0.8rem', color: '#757575', marginTop: '1rem', textAlign: 'center'}}>
              家計簿データを安全に保管するため、Google Driveへのアクセス許可が必要です。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// GsiErrorScreen (変更なし)
function GsiErrorScreen({ onRetry, onDevMode, guidance, currentOrigin, errorType }) {
  const ScriptLoadErrorContent = () => (
    <>
      <h2>Googleサービスへの接続に失敗しました</h2>
      <p>
        Googleの認証やデータ保存に必要なスクリプトファイルの読み込みに失敗しました。
        これは、お使いのネットワーク環境やブラウザの設定が原因である可能性が高いです。
      </p>
      <div className="gsi-checklist">
        <h3>トラブルシューティング</h3>
        <p>以下の手順を順番にお試しください。</p>
        <ol className="gsi-steps">
          <li><strong>ページの再読み込み:</strong> 一時的なネットワークの問題かもしれません。まずページを更新してみてください。</li>
          <li><strong>ブラウザ拡張機能の無効化:</strong> 広告ブロッカー等が原因のことがあります。全ての拡張機能を無効にして再試行してください。</li>
          <li><strong>別のネットワークを試す:</strong> 可能であれば、Wi-Fiからスマートフォンのテザリングに切り替えるなど、別のインターネット接続でお試しください。</li>
          <li><strong>ファイアウォール/セキュリティソフト:</strong> 会社や公共のネットワークでは、セキュリティ設定が原因のことがあります。設定をご確認ください。</li>
        </ol>
      </div>
    </>
  );

  const InitializationErrorContent = () => (
    <>
      <h2>Googleログイン設定エラー</h2>
      <p>
        Googleログインの初期化に失敗しました。
        これは、ほぼ間違いなく <strong>Google Cloudの設定ミス</strong>が原因です。
      </p>
      <p>
        以下のチェックリストを確認し、Google Cloudコンソールの設定を修正してください。
      </p>
      <div className="gsi-checklist">
        <h3>【最重要】承認済みのJavaScript生成元</h3>
        <p>
          お使いのウェブアプリのURLが、Googleのログイン設定に正しく登録されているか確認してください。
        </p>
        <p className="checklist-item-label">
          <strong>このURLをコピーして登録してください:</strong>
        </p>
        <div className="checklist-value-box">{currentOrigin || '（再試行してください）'}</div>
        
        <h4>手順:</h4>
        <ol className="gsi-steps">
          <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>にアクセスします。</li>
          <li>正しいプロジェクトを選択していることを確認します。</li>
          <li>「認証情報」ページで、お使いの「ウェブクライアント」のID名をクリックします。</li>
          <li>「承認済みの JavaScript 生成元」セクションで、「+ URI を追加」をクリックします。</li>
          <li>上記のURL（<strong>{currentOrigin}</strong>）を貼り付けて保存します。</li>
        </ol>
      </div>
    </>
  );

  return (
    <div className="screen gsi-error-screen">
      <div className="card">
        {errorType === 'script_load' ? <ScriptLoadErrorContent /> : <InitializationErrorContent />}
        
        <div className="error-details">
          <h4>技術的な詳細（エラーメッセージ）</h4>
          <pre>{guidance}</pre>
        </div>

        <div className="gsi-error-actions">
          <button onClick={onRetry} className="btn btn-primary">
            再試行
          </button>
          <button onClick={onDevMode} className="btn btn-secondary">
            開発モードで続ける
          </button>
        </div>
      </div>
    </div>
  );
}

function FileLoadErrorScreen({ message, onReturnToSetup, onDiagnose, diagnosticLog = [] }) {
  const technicalDetailsMatch = message.match(/技術的な詳細: (.*)/s);
  const mainMessage = technicalDetailsMatch ? message.replace(technicalDetailsMatch[0], '').trim() : message;
  const technicalDetails = technicalDetailsMatch ? technicalDetailsMatch[1] : '';

  return (
    <div className="screen file-load-error-screen">
      <div className="card">
         <p className="error-message" style={{whiteSpace: 'pre-wrap'}}>{mainMessage}</p>

         {diagnosticLog.length > 0 && (
            <div className="diagnostic-log-container">
                <h3>診断ステップ</h3>
                <ol className="diagnostic-steps">
                    {diagnosticLog.map((step, index) => <li key={index}>{step}</li>)}
                </ol>
            </div>
         )}

         {technicalDetails && (
            <div className="error-details" style={{marginTop: '1.5rem'}}>
                <h4>技術的な詳細</h4>
                <pre>{technicalDetails}</pre>
            </div>
         )}
         
         <div className="file-error-actions">
            <button onClick={onDiagnose} className="btn btn-primary">
              共有ステータスを診断する
            </button>
            <button onClick={onReturnToSetup} className="btn btn-secondary">
              設定画面に戻る
            </button>
         </div>
      </div>
    </div>
  );
}

function GoogleDriveConnectionDiagnoser({ onBack, user, onFileLoaded }) {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsSearching(true);
    setError('');
    setResults([]);
    setSearchAttempted(true);

    try {
      window.diagnosticLog('Starting search for kakeibo files...');
      const response = await window.gapi.client.drive.files.list({
        q: `name = '${APP_DATA_FILE_NAME}'`,
        fields: 'files(id, name, owners(displayName, emailAddress), capabilities(canEdit))',
        spaces: 'drive',
      });
      
      const files = response.result.files || [];
      window.diagnosticLog(`Found ${files.length} potential file(s).`, 'success');
      
      const processedFiles = files.map(file => ({
        id: file.id,
        owner: file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || '不明',
        canEdit: file.capabilities?.canEdit || false,
      }));

      setResults(processedFiles);

    } catch (e) {
      const err = e as StatusError;
      console.error("Error during file search:", err);
      const errorMessage = `ファイルの検索中にエラーが発生しました: ${err.message || '不明なエラー'}`;
      setError(errorMessage);
      window.diagnosticLog(errorMessage, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAndLoadFile = async (fileId: string) => {
    setLoadingFileId(fileId);
    setError('');
    try {
      window.diagnosticLog(`Diagnoser is now attempting to directly load file: ${fileId}`);
      const data = await driveApi.loadFile(fileId);
      window.diagnosticLog(`Direct load successful. Passing data to app.`, 'success');
      onFileLoaded(fileId, data);
    } catch(e) {
      const err = e as StatusError;
      console.error("Error during direct file load from diagnoser:", err);
      const errorMessage = `ファイルは発見できましたが、直後の読み込みに失敗しました。Google Drive側で共有設定が反映されるまで時間がかかっている可能性があります。数分待ってから再度お試しください。\n\n詳細: ${err.message}`;
      setError(errorMessage);
      window.diagnosticLog(errorMessage, 'error');
    } finally {
      setLoadingFileId(null);
    }
  };

  return (
    <div className="screen">
      <BackButton onClick={onBack} />
      <div className="card">
        <h2>Google Drive 接続診断ツール</h2>
        <p className="text-light" style={{textAlign: 'center', marginBottom: '1.5rem'}}>
          あなたのアカウントからアクセス可能な家計簿ファイルを検索し、共有設定の問題を特定します。
        </p>
        <button onClick={handleSearch} className="btn btn-primary" disabled={isSearching || loadingFileId !== null}>
          {isSearching ? '検索中...' : 'アクセス可能なファイルを検索'}
        </button>
      </div>

      {(searchAttempted || error) && (
        <div className="card">
          <h3>診断結果</h3>
          {isSearching && <Loader mini={true} message="Google Driveを検索しています..." />}
          {error && <p className="error-message" style={{whiteSpace: 'pre-wrap'}}>{error}</p>}
          {!isSearching && !error && results.length > 0 && (
            <div className="diagnoser-results-list">
              {results.map(file => (
                <div key={file.id} className="diagnoser-result-item">
                  <div className="diagnoser-file-info">
                    <p><strong>招待コード:</strong> <code>{file.id}</code></p>
                    <p><strong>オーナー:</strong> {file.owner}</p>
                    <div className={`diagnoser-permission ${file.canEdit ? 'ok' : 'ng'}`}>
                      <strong>あなたの権限:</strong> 
                      <span>{file.canEdit ? '✅ 編集可能' : '❌ 編集できません'}</span>
                    </div>
                  </div>
                  {file.canEdit && (
                    <button onClick={() => handleSelectAndLoadFile(file.id)} className="btn btn-secondary" disabled={loadingFileId !== null}>
                      {loadingFileId === file.id ? '読み込み中...' : 'このファイルを使用'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!isSearching && !error && results.length === 0 && searchAttempted && (
             <div className="gsi-checklist" style={{marginTop: 0}}>
                <h3>ファイルが見つかりませんでした</h3>
                <p>
                  現在ログイン中のアカウント (<strong>{user.email}</strong>) からアクセスできる家計簿ファイル (<code>{APP_DATA_FILE_NAME}</code>) が見つかりませんでした。
                </p>
                <h4>考えられる原因と対策:</h4>
                <ol className="gsi-steps">
                    <li><strong>オーナー側の共有設定ミス:</strong> ファイルのオーナーに、あなたのアカウント (<strong>{user.email}</strong>) に対して「編集者」権限でファイルを共有してもらっているか、再度確認してください。</li>
                    <li><strong>別のアカウントでログイン中:</strong> 共有されたGoogleアカウントとは別のアカウントでこのアプリにログインしている可能性があります。一度ログアウトし、正しいアカウントでログインし直してください。</li>
                </ol>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

function Loader({ message, mini = false }) {
  return (
    <div className={`loader-container ${mini ? 'mini' : ''}`}>
      <div className="loader"></div>
      {message && <p>{message}</p>}
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button onClick={onClick} className="back-button">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      戻る
    </button>
  );
}

function OshiSetup({ onSave, initialOshi, onBack = null }) {
  const [name, setName] = useState(initialOshi?.name || '');
  const [url, setUrl] = useState(initialOshi?.url || '');

  const handleSave = () => {
    onSave({ name, url });
  };
  
  return (
    <div className="screen">
       {onBack && <BackButton onClick={onBack} />}
      <div className="card">
        <h2>推しの設定</h2>
        <p className="text-light" style={{textAlign: 'center', marginBottom: '1.5rem'}}>
          あなたの「推し」について教えてください。応援メッセージの精度が向上します。
        </p>
        <div className="form-group">
          <label htmlFor="oshi-name">推しの名前</label>
          <input
            id="oshi-name"
            type="text"
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: アーティスト名、キャラクター名"
          />
        </div>
        <div className="form-group">
          <label htmlFor="oshi-url">参考URL（任意）</label>
          <input
            id="oshi-url"
            type="url"
            className="text-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="例: 公式サイト、Wikipedia"
          />
           <p style={{fontSize: '0.8rem', color: '#757575', marginTop: '0.5rem'}}>
            同姓同名の人物やキャラクターがいる場合に、より正確な情報を取得できます。
          </p>
        </div>
        <button onClick={handleSave} className="btn btn-primary" disabled={!name}>
          設定を保存
        </button>
      </div>
    </div>
  );
}


function Home({ onNavigate, oshi, isAiUnlocked, onLogout }) {
  const aiDisabledTooltip = "1ヶ月分のデータ蓄積後に利用可能になります";

  return (
    <div className="screen">
      <div className="oshi-section card">
         <h2>推し活応援サーチ</h2>
         <p>
            「{oshi?.name || 'あなたの推し'}」について知りたいことをAIに質問してみましょう！
         </p>
         <div className="oshi-actions">
           <button className="btn" onClick={() => onNavigate('oshi-push')}>
             質問する
           </button>
           <button className="btn btn-secondary" onClick={() => onNavigate('oshi-setup')}>
             推しの設定
           </button>
         </div>
      </div>
      
      <div className="primary-actions">
        <button className="btn btn-secondary" onClick={() => onNavigate('receipt-scan')}>撮影/読込</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('manual-entry')}>手入力</button>
      </div>

      <div className="home-grid">
        <button className="btn btn-secondary" onClick={() => onNavigate('fixed-cost')}>月の固定費</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('reports')}>レポート</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('shopping-list')}>買い物リスト</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('recipe')} disabled={!isAiUnlocked} data-tooltip={!isAiUnlocked ? aiDisabledTooltip : undefined}>今日のレシピ</button>
        <button className="btn btn-secondary" onClick={() => onNavigate('lifestyle-tips')} disabled={!isAiUnlocked} data-tooltip={!isAiUnlocked ? aiDisabledTooltip : undefined}>生活のヒント</button>
      </div>
      <div className="settings-section">
         <button className="btn btn-secondary" onClick={() => onNavigate('family-setup')}>家族とデータ共有</button>
         <button className="btn btn-secondary" onClick={onLogout}>ログアウト</button>
      </div>
    </div>
  );
}

function OshiPush({ onBack, oshi }) {
  const [query, setQuery] = useState(oshi?.name ? `${oshi.name}の最新情報は？` : '');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!query) return;
    setIsLoading(true);
    setError('');
    setResult('');
    try {
      const response = await callApi('oshi_push', { query, oshi });
      setResult(response.data);
    } catch (err) {
      setError(err.message || '情報の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="screen">
      <BackButton onClick={onBack} />
      <div className="card">
        <h2>推し活応援サーチ</h2>
        <div className="form-group">
          <label htmlFor="oshi-query">質問を入力してください</label>
          <textarea
            id="oshi-query"
            className="text-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 〇〇の次のライブはいつ？"
            rows={4}
          />
        </div>
        <button onClick={handleGenerate} className="btn btn-primary" disabled={isLoading || !query}>
          {isLoading ? '検索中...' : 'AIに質問する'}
        </button>
      </div>
      {isLoading && <Loader message="最新の情報を検索中..." />}
      {error && <div className="error-message">{error}</div>}
      {result && (
        <div className="card">
          <h3>AIからの応援メッセージ</h3>
          <p style={{lineHeight: 1.8}}>{result}</p>
        </div>
      )}
    </div>
  );
}


function ReceiptScan({ onScanComplete, onBack }) {
  const [images, setImages] = useState([]);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("カメラの起動に失敗しました:", err);
        alert("カメラの起動に失敗しました。ブラウザの権限設定を確認してください。");
      }
    };
    startCamera();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const resizeImageOnCanvas = (sourceElement: HTMLVideoElement | HTMLImageElement) => {
    if (!canvasRef.current) return null;

    const sourceCanvas = canvasRef.current;
    sourceCanvas.width = 'videoWidth' in sourceElement ? sourceElement.videoWidth : sourceElement.width;
    sourceCanvas.height = 'videoHeight' in sourceElement ? sourceElement.videoHeight : sourceElement.height;
    
    const context = sourceCanvas.getContext('2d');
    context.drawImage(sourceElement, 0, 0, sourceCanvas.width, sourceCanvas.height);
      
    const MAX_DIMENSION = 1024;
    let { width, height } = sourceCanvas;

    if (width > height) {
      if (width > MAX_DIMENSION) {
        height *= MAX_DIMENSION / width;
        width = MAX_DIMENSION;
      }
    } else {
      if (height > MAX_DIMENSION) {
        width *= MAX_DIMENSION / height;
        height = MAX_DIMENSION;
      }
    }
      
    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = width;
    resizeCanvas.height = height;
    const resizeContext = resizeCanvas.getContext('2d');
    resizeContext.drawImage(sourceCanvas, 0, 0, width, height);

    return resizeCanvas.toDataURL('image/jpeg', 0.90);
  };

  const handleCapture = () => {
    if (videoRef.current) {
      const dataUrl = resizeImageOnCanvas(videoRef.current);
      if (dataUrl) {
          setImages(prev => [...prev, dataUrl]);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filePromises = Array.from(files).map(file => {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const dataUrl = resizeImageOnCanvas(img);
                    if (dataUrl) {
                        resolve(dataUrl);
                    } else {
                        reject(new Error("Canvas for resizing not found."));
                    }
                };
                img.onerror = reject;
                img.src = event.target.result as string;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    });

    Promise.all(filePromises)
      .then(newImages => {
        setImages(prev => [...prev, ...newImages]);
      })
      .catch(err => {
        console.error("Error processing uploaded images", err);
        alert("画像の処理に失敗しました。");
      });
    
    e.target.value = '';
  };
  
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };


  const handleDeleteImage = (indexToDelete) => {
    setImages(prev => prev.filter((_, index) => index !== indexToDelete));
  };

  const handleDone = () => {
    if (images.length > 0) {
      onScanComplete(images);
    }
  };

  return (
    <div className="receipt-scan-view">
      <input type="file" ref={fileInputRef} multiple accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />
      <div className="privacy-notice">
         <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
         <span>レシート画像はAIの学習には使用されません。</span>
      </div>
      <div className="camera-viewport-wrapper">
        <div className="camera-container">
          <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
          <div className="scan-overlay"></div>
        </div>
        <div className="scan-actions">
          <div className="scan-actions-buttons">
            <button onClick={onBack} className="btn btn-secondary">ホーム</button>
            <button onClick={handleUploadClick} className="btn btn-secondary">選ぶ</button>
            <button onClick={handleCapture} className="btn btn-primary">撮る</button>
            <button onClick={handleDone} className="btn" disabled={images.length === 0}>完了</button>
          </div>
          <div className="scan-hints">
            <p className="scan-hint">
              💡 **ヒント:** 長いレシートや、ピントが合いにくい箇所は、角度を変えて複数回撮影するとAIの読み取り精度が向上します。
            </p>
            <p className="scan-hint">
              ⚠️ **注意:** 一度に処理する枚数が多すぎると（目安: 5枚以上）、エラーが発生する場合があります。
            </p>
          </div>
        </div>
      </div>

      {images.length > 0 && (
        <div className="thumbnail-container">
           <h3>撮影/選択済み ({images.length}枚)</h3>
           <div className="thumbnail-list">
            {images.map((img, index) => (
              <div key={index} className="thumbnail-item">
                <img src={img} alt={`レシート ${index + 1}`} />
                <button onClick={() => handleDeleteImage(index)} className="delete-btn thumbnail-delete-btn">&times;</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
    </div>
  );
}

function ReceiptConfirm({ receiptData, onSave, onRetakeForUnchecked, onDiscardAndStartOver, isSaving }) {
  const [localItems, setLocalItems] = useState([]);
  const [storeName, setStoreName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);

  useEffect(() => {
    if (receiptData) {
      setLocalItems(
        (receiptData.items || []).map((item, index) => ({
          ...item,
          id: `item-${Date.now()}-${index}`,
          checked: true,
        }))
      );
      setStoreName(receiptData.storeName || '');
      setPurchaseDate((receiptData.purchaseDate ? String(receiptData.purchaseDate) : new Date().toISOString()).split('T')[0]);
      setDiscount(receiptData.discount || 0);
      setTax(receiptData.tax || 0);
    }
  }, [receiptData]);

  const handleToggleCheck = (id) => {
    setLocalItems(
      localItems.map(item =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const handleToggleAll = (e) => {
    const isChecked = e.target.checked;
    setLocalItems(localItems.map(item => ({ ...item, checked: isChecked })));
  };

  const handleItemChange = (id, field, value) => {
    setLocalItems(localItems.map(item => {
        if (item.id !== id) return item;
        
        if (field === 'name') {
            return { ...item, name: value };
        } else if (field === 'price') {
            const price = parseInt(value, 10);
            return { ...item, price: isNaN(price) ? 0 : price };
        }
        return item;
    }));
  };
  
  const handleDeleteItem = (id) => {
      setLocalItems(localItems.filter(item => item.id !== id));
  };

  const handleSave = () => {
    const finalItems = localItems
      .filter(item => item.checked)
      .map(({ id, checked, ...rest }) => rest);
      
    onSave({ storeName, purchaseDate, items: finalItems, discount: Number(discount) || 0, tax: Number(tax) || 0 });
  };
  
  const handleRetake = () => {
    onRetakeForUnchecked(localItems);
  }

  const allChecked = localItems.length > 0 && localItems.every(item => item.checked);
  const checkedCount = localItems.filter(item => item.checked).length;
  
  const itemsTotal = localItems.reduce((sum, item) => sum + (item.checked ? (Number(item.price) || 0) : 0), 0);
  const totalAmount = itemsTotal + (Number(tax) || 0) - (Number(discount) || 0);

  return (
    <div className="receipt-confirm-view">
      <div className="card">
        <h3>レシート情報の確認・編集</h3>
        <p className="text-light" style={{textAlign: 'center', lineHeight: '1.6', margin: '-0.5rem 0 1.5rem'}}>
            正しく読み取れた項目にチェックを入れてください。チェックした項目のみが保存されます。
        </p>
        <div className="form-group">
          <label htmlFor="store-name">店名</label>
          <input
            id="store-name"
            type="text"
            className="text-input"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="purchase-date">購入日</label>
          <input
            id="purchase-date"
            type="date"
            className="text-input"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div className="item-list">
          <table>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allChecked} onChange={handleToggleAll} title="すべて選択 / 解除" />
                </th>
                <th>品名</th>
                <th>金額</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {localItems.map(item => (
                <tr key={item.id} className={!item.checked ? 'item-unchecked' : ''}>
                  <td>
                    <input type="checkbox" checked={item.checked} onChange={() => handleToggleCheck(item.id)} />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="text-input item-name-input"
                      value={item.name}
                      onChange={(e) => handleItemChange(item.id, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="text-input item-price-input"
                      value={`${item.price ?? ''}`}
                      onChange={(e) => handleItemChange(item.id, 'price', e.target.value.replace(/\D/g, ''))}
                    />
                  </td>
                  <td>
                    <button onClick={() => handleDeleteItem(item.id)} className="delete-btn">&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="receipt-summary-fields">
            <div className="summary-row">
                <span>チェック済み小計</span>
                <span>{itemsTotal.toLocaleString()} 円</span>
            </div>
            <div className="summary-row form-group">
              <label htmlFor="receipt-discount">割引</label>
              <input id="receipt-discount" type="text" inputMode="numeric" className="text-input" value={discount} onChange={(e) => setDiscount(Number(e.target.value.replace(/\D/g, '')))} />
            </div>
            <div className="summary-row form-group">
              <label htmlFor="receipt-tax">消費税</label>
              <input id="receipt-tax" type="text" inputMode="numeric" className="text-input" value={tax} onChange={(e) => setTax(Number(e.target.value.replace(/\D/g, '')))} />
            </div>
            <div className="summary-row total">
                <strong>チェック済み合計</strong>
                <strong>{totalAmount.toLocaleString()} 円</strong>
            </div>
        </div>

        <div className="confirm-actions">
           <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || checkedCount === 0}>
            {isSaving ? '保存中...' : `${checkedCount}件を家計簿に保存`}
          </button>
           <button onClick={handleRetake} className="btn btn-secondary" disabled={isSaving}>
            未チェック項目を再撮影/再選択
          </button>
           <button onClick={onDiscardAndStartOver} className="btn btn-delete" disabled={isSaving}>
            破棄して最初から
          </button>
        </div>
      </div>
    </div>
  );
}


function FixedCostInput({ onBack, allFixedCosts, onSave }) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    const [monthKey, setMonthKey] = useState(getMonthKey(currentDate));
    const [costs, setCosts] = useState<{name: string, amount: number}[]>([]);
    const [newItemName, setNewItemName] = useState('');
    const [newItemAmount, setNewItemAmount] = useState('');

    useEffect(() => {
        const newMonthKey = getMonthKey(currentDate);
        setMonthKey(newMonthKey);
        setCosts(
            (allFixedCosts[newMonthKey] || []).map(c => ({...c, amount: Number(c.amount || 0)}))
        );
    }, [currentDate, allFixedCosts]);

    const navigateMonth = (amount) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setDate(1); // 月の長さに起因する問題を回避
            newDate.setMonth(newDate.getMonth() + amount);
            return newDate;
        });
    };

    const handleAddItem = (e) => {
        e.preventDefault();
        if (newItemName && newItemAmount) {
            const newCost = { name: newItemName, amount: parseInt(newItemAmount, 10) || 0 };
            setCosts(prevCosts => [...prevCosts, newCost]);
            setNewItemName('');
            setNewItemAmount('');
        }
    };
    
    const handleDeleteItem = (indexToDelete) => {
        setCosts(costs.filter((_, index) => index !== indexToDelete));
    };

    const handleSave = () => {
        onSave(monthKey, costs);
    };

    const totalAmount = costs.reduce((sum, item) => sum + (item.amount || 0), 0);
    const monthDisplay = `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;

    return (
        <div className="screen">
            <div className="screen-header-with-note">
                <BackButton onClick={onBack} />
                <p className="header-note">月次レポートで確認できます</p>
            </div>
            <div className="card">
                <div className="month-navigator">
                    <button onClick={() => navigateMonth(-1)}>&lt;</button>
                    <h3>{monthDisplay}の固定費</h3>
                    <button onClick={() => navigateMonth(1)}>&gt;</button>
                </div>
                {costs.length > 0 ? (
                    <ul className="item-list-display">
                        {costs.map((item, index) => (
                            <li key={index}>
                                <span>{item.name}</span>
                                <span className="item-amount">{item.amount.toLocaleString()}円</span>
                                <button onClick={() => handleDeleteItem(index)} className="delete-btn">&times;</button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-light" style={{textAlign: 'center'}}>この月の固定費は登録されていません。</p>
                )}
                <div className="total-amount">
                    <strong>合計: {totalAmount.toLocaleString()}円</strong>
                </div>
            </div>
            <div className="card">
                <h3>{monthDisplay}の固定費を追加</h3>
                <form onSubmit={handleAddItem} className="fixed-cost-form">
                    <div className="form-group">
                        <label htmlFor="cost-name">項目名</label>
                        <input
                            id="cost-name"
                            type="text"
                            className="text-input"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder="例: 家賃、光熱費"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="cost-amount">金額（円）</label>
                        <input
                            id="cost-amount"
                            type="text"
                            inputMode="numeric"
                            className="text-input"
                            value={newItemAmount}
                            onChange={(e) => setNewItemAmount(e.target.value.replace(/\D/g, ''))}
                            placeholder="例: 80000"
                        />
                    </div>
                    <button type="submit" className="btn btn-secondary" disabled={!newItemName || !newItemAmount}>追加</button>
                </form>
            </div>
            <button onClick={handleSave} className="btn btn-primary">この月の固定費を保存</button>
        </div>
    );
}

function ManualEntry({ onBack, onSave, isSaving }) {
    const [storeName, setStoreName] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
    const [items, setItems] = useState([]);
    const [newItemName, setNewItemName] = useState('');
    const [newItemPrice, setNewItemPrice] = useState('');

    const handleAddItem = (e) => {
        e.preventDefault();
        if (newItemName && newItemPrice) {
            const newItem = { name: newItemName, price: parseInt(newItemPrice, 10) || 0 };
            setItems(prev => [...prev, newItem]);
            setNewItemName('');
            setNewItemPrice('');
        }
    };

    const handleDeleteItem = (indexToDelete) => {
        setItems(items.filter((_, index) => index !== indexToDelete));
    };

    const handleSave = () => {
        if (items.length > 0) {
            onSave({ storeName: storeName || '手入力', purchaseDate, items });
        }
    };

    const totalAmount = items.reduce((sum, item) => sum + (item.price || 0), 0);

    return (
        <div className="screen">
            <BackButton onClick={onBack} />
            <div className="card">
                <h2>支出の手入力</h2>
                <div className="form-group">
                    <label htmlFor="manual-store-name">店名（任意）</label>
                    <input
                        id="manual-store-name"
                        type="text"
                        className="text-input"
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="manual-purchase-date">購入日</label>
                    <input
                        id="manual-purchase-date"
                        type="date"
                        className="text-input"
                        value={purchaseDate}
                        onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                </div>
            </div>
            <div className="card">
                <h3>品目を追加</h3>
                <form onSubmit={handleAddItem} className="manual-entry-form">
                    <div className="form-group">
                        <label htmlFor="item-name">品名</label>
                        <input
                            id="item-name"
                            type="text"
                            className="text-input"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder="例: 牛乳"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="item-price">金額（円）</label>
                        <input
                            id="item-price"
                            type="text"
                            inputMode="numeric"
                            className="text-input"
                            value={newItemPrice}
                            onChange={(e) => setNewItemPrice(e.target.value.replace(/\D/g, ''))}
                            placeholder="例: 200"
                        />
                    </div>
                    <button type="submit" className="btn btn-secondary" disabled={!newItemName || !newItemPrice}>リストに追加</button>
                </form>
            </div>
             <div className="card">
                <h3>入力済みリスト</h3>
                {items.length > 0 ? (
                    <ul className="item-list-display">
                        {items.map((item, index) => (
                            <li key={index}>
                                <span>{item.name}</span>
                                <span className="item-amount">{item.price.toLocaleString()}円</span>
                                <button onClick={() => handleDeleteItem(index)} className="delete-btn">&times;</button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-light" style={{textAlign: 'center'}}>品目はまだありません。</p>
                )}
                <div className="total-amount">
                    <strong>合計: {totalAmount.toLocaleString()}円</strong>
                </div>
            </div>
            <button onClick={handleSave} className="btn btn-primary" disabled={isSaving || items.length === 0}>
                {isSaving ? '保存中...' : '家計簿に保存'}
            </button>
        </div>
    );
}

function FamilySetup({ onBack = null, onFileIdSet, driveFileId, user }) {
  const [activeTab, setActiveTab] = useState('join');
  const [inviteCode, setInviteCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleCreateFamily = async () => {
    setIsCreating(true);
    try {
        const fileId = await driveApi.findOrCreateFile(APP_DATA_FILE_NAME);
        onFileIdSet(fileId);
    } catch(e) {
        console.error("データファイルの作成に失敗しました。", e); // 開発者向けログ
        let userMessage = "データファイルの作成に失敗しました。";
        
        const err = e as StatusError;
        if (err.result && err.result.error) {
            const error = err.result.error;
            userMessage += `\n\n理由: ${error.message}`;
            if (error.code === 403) {
                userMessage += `\n\n【考えられる原因】\nアプリがGoogle Driveにファイルを作成する権限がないようです。Google Cloud Consoleで「Google Drive API」が有効になっているか確認してください。`;
            }
        } else if (err.message) {
            userMessage += `\n\n理由: ${err.message}`;
        }
        
        alert(userMessage);
    } finally {
        setIsCreating(false);
    }
  };

  const handleJoinFamily = (e) => {
    e.preventDefault();
    if(!inviteCode) return;

    if (driveFileId) {
      if (!confirm(
        '別の家計簿データに切り替えますか？\n\n現在表示されているご自身のデータはこのアプリ上ではアクセスできなくなります。（Google Driveからデータが削除されるわけではありません。）\n\nこの操作は元に戻せません。よろしいですか？'
      )) {
        return;
      }
    }
    onFileIdSet(inviteCode);
  };
  
  const handleResetAndCreate = async () => {
    if (!confirm(
      '現在の家計簿データとの連携を解除し、新しいデータを作成します。\n\n' +
      '古いデータはGoogle Drive上で「..._archive_...」という名前に変更され、安全に保管されます。（削除はされません）\n\n' +
      'この操作を実行しますか？'
    )) {
        return;
    }

    setIsResetting(true);
    try {
        await driveApi.archiveFile(driveFileId);
        const newFileId = await driveApi.findOrCreateFile(APP_DATA_FILE_NAME);
        onFileIdSet(newFileId);
        alert('新しい家計簿データが作成され、新しい招待コードが発行されました。');
    } catch(e) {
        console.error("データの再作成に失敗しました。", e);
        alert(`データの再作成に失敗しました: ${e.message}`);
    } finally {
        setIsResetting(false);
    }
  };

  if (driveFileId) {
     return (
        <div className="screen">
          <BackButton onClick={onBack} />
          <div className="card">
            <h2>家族とデータ共有</h2>
            <p className="text-light" style={{textAlign: 'center'}}>
              現在、Google Drive上の家計簿ファイルに接続しています。
            </p>
            <h3>招待コード（ファイルID）</h3>
            <p>このコードをコピーして、招待したい家族に送りましょう。</p>
            <div className="invite-code-display">{driveFileId}</div>
            <div className="gsi-checklist" style={{marginTop: '1.5rem'}}>
                <h3>【重要】家族を招待する方法</h3>
                <ol className="gsi-steps" style={{fontSize: '0.9rem'}}>
                    <li><strong>招待コードの共有:</strong> 上記の招待コードをコピーして、招待したい家族に送ります。</li>
                    <li><strong>Google Driveでファイルを開く:</strong> <a href={`https://drive.google.com/file/d/${driveFileId}/`} target="_blank" rel="noopener noreferrer">このリンクをクリックしてGoogle Driveでファイルを開きます。</a></li>
                    <li><strong>共有設定を開く:</strong> 画面の右上にある青い「共有」ボタンをクリックします。</li>
                    <li><strong>招待者を追加:</strong> 「ユーザーやグループを追加」という欄に、<strong>招待したい家族のGoogleアカウント（メールアドレス）を直接入力します。</strong></li>
                    <li><strong>権限を設定:</strong> 役割が**「編集者」**になっていることを確認し、「送信」ボタンを押します。</li>
                    <li><strong>家族側の操作:</strong> 共有されたご家族は、このアプリを開き、「招待コードで参加」から受け取ったコードを入力すると、同じ家計簿を編集できるようになります。</li>
                </ol>
            </div>
          </div>
          <div className="card">
            <h3>別の家族グループに参加する</h3>
            <p className="text-light" style={{textAlign: 'center', lineHeight: '1.7', marginBottom: '1.5rem'}}>
              家族から新しい招待コードを受け取った場合は、こちらに入力してください。表示される家計簿データが切り替わります。
            </p>
            <form onSubmit={handleJoinFamily}>
              <div className="form-group">
                <label htmlFor="switch-invite-code">新しい招待コード (ファイルID)</label>
                <input
                  id="switch-invite-code"
                  type="text"
                  className="text-input"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="家族から共有された新しいコード"
                />
              </div>
              <button type="submit" className="btn btn-secondary" disabled={!inviteCode}>
                データファイルを切り替える
              </button>
            </form>
          </div>
          <div className="card">
            <h3>新しい家計簿データを開始する</h3>
            <p className="text-light" style={{textAlign: 'center', lineHeight: '1.7', marginBottom: '1.5rem'}}>
              招待コードの共有に問題がある場合や、心機一転して新しい家計簿を始めたい場合は、現在のデータ連携を解除して新しいデータファイルを作成できます。
            </p>
             <div className="gsi-checklist" style={{marginTop: '0', marginBottom: '1.5rem', borderColor: 'var(--error-color)', backgroundColor: '#fff5f5' }}>
                <h3 style={{color: 'var(--error-color)'}}>【重要】操作前の注意</h3>
                <ol className="gsi-steps" style={{fontSize: '0.9rem'}}>
                  <li>この操作を行うと、新しい招待コードが発行されます。</li>
                  <li>古いデータはGoogle Driveから削除されず、<strong>「..._archive_...」</strong>という名前に変更されて安全に保管されます。</li>
                  <li>一度この操作を行うと、アプリから古いデータにはアクセスできなくなります。</li>
                </ol>
            </div>
            <button onClick={handleResetAndCreate} className="btn btn-delete" disabled={isResetting}>
              {isResetting ? '処理中...' : '連携を解除して新規作成'}
            </button>
          </div>
        </div>
     );
  }

  return (
    <div className="screen">
      {onBack && <BackButton onClick={onBack} />}
      <div className="card">
        <h2>家族とデータ共有の設定</h2>
        <p className="text-light" style={{textAlign: 'center', lineHeight: '1.7'}}>
          家計簿データを家族と共有するには、Google Drive上に共有データファイルを作成するか、招待コードで既存のファイルに参加します。
        </p>
        <div className="tab-buttons">
          <button className={activeTab === 'join' ? 'active' : ''} onClick={() => setActiveTab('join')}>
            招待コードで参加
          </button>
          <button className={activeTab === 'create' ? 'active' : ''} onClick={() => setActiveTab('create')}>
            一人で開始 / 新規作成
          </button>
        </div>
        <div className="tab-content">
          {activeTab === 'join' && (
            <form onSubmit={handleJoinFamily}>
              <h3>招待コードで参加</h3>
              <div className="form-group">
                <label htmlFor="invite-code">招待コード (ファイルID)</label>
                <input
                  id="invite-code"
                  type="text"
                  className="text-input"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="家族から共有されたコードを入力"
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={!inviteCode}>参加する</button>
            </form>
          )}
          {activeTab === 'create' && (
            <div>
              <h3>新しい家計簿データを作成</h3>
              <p>
                あなた専用の家計簿データファイルをGoogle Driveに作成します。作成後に発行される招待コードを共有することで、いつでも家族を招待できます。
              </p>
              <button onClick={handleCreateFamily} className="btn btn-primary" style={{marginBottom: '1rem'}} disabled={isCreating}>
                {isCreating ? '作成中...' : '作成して開始する'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function ShoppingList({ onBack, shoppingList, onUpdate, receipts, isAiUnlocked }) {
    const [newItem, setNewItem] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [isLoading, setIsLoading] = useState(isAiUnlocked);

    useEffect(() => {
        if (isAiUnlocked) {
            const getSuggestions = async () => {
                setIsLoading(true);
                try {
                    const response = await callApi('shopping_list', { receipts });
                    setSuggestions(response.data.suggestions);
                } catch (error) {
                    console.error("買い物リストの提案取得に失敗:", error);
                } finally {
                    setIsLoading(false);
                }
            };
            getSuggestions();
        } else {
            setIsLoading(false);
            setSuggestions([]);
        }
    }, [receipts, isAiUnlocked]);
    

    const handleAddItem = (itemName) => {
        if (itemName && !shoppingList.some(item => item.name === itemName)) {
            onUpdate([...shoppingList, { name: itemName, checked: false }]);
        }
    };
    
    const handleFormSubmit = (e) => {
        e.preventDefault();
        handleAddItem(newItem);
        setNewItem('');
    };

    const handleToggleItem = (indexToToggle) => {
        const newList = shoppingList.map((item, index) =>
            index === indexToToggle ? { ...item, checked: !item.checked } : item
        );
        onUpdate(newList);
    };

    const handleDeleteItem = (indexToDelete) => {
        onUpdate(shoppingList.filter((_, index) => index !== indexToDelete));
    };

    return (
        <div className="screen">
            <BackButton onClick={onBack} />
            {isAiUnlocked && (
                <div className="card ai-suggestions">
                    <h3>AIからの購入提案</h3>
                    {isLoading ? (
                        <Loader mini={true} message="購入履歴を分析中..." />
                    ) : suggestions.length > 0 ? (
                         <ul className="suggestion-list">
                            {suggestions.map((item, index) => (
                                <li key={index}>
                                    <span>{item}</span>
                                    <button onClick={() => handleAddItem(item)} className="add-suggestion-btn">+</button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-light">提案はありません。</p>
                    )}
                </div>
            )}
            <div className="card">
                <h3>買い物リスト</h3>
                 <form onSubmit={handleFormSubmit} className="add-item-form">
                    <input
                        type="text"
                        className="text-input"
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        placeholder="追加する品物を入力"
                    />
                    <button type="submit" className="btn btn-primary">追加</button>
                </form>
                {shoppingList.length > 0 ? (
                    <ul className="shopping-list-display">
                        {shoppingList.map((item, index) => (
                           <li key={index} className={item.checked ? 'checked' : ''}>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={item.checked}
                                        onChange={() => handleToggleItem(index)}
                                    />
                                    <span>{item.name}</span>
                                </label>
                                <button onClick={() => handleDeleteItem(index)} className="delete-btn">&times;</button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-light" style={{textAlign: 'center'}}>リストは空です。</p>
                )}
            </div>
        </div>
    );
}

function Recipe({ onBack, receipts }) {
    const [recipe, setRecipe] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await callApi('recipe', { receipts });
                setRecipe(response.data);
            } catch (err) {
                setError('レシピの取得に失敗しました。');
            } finally {
                setIsLoading(false);
            }
        })();
    }, [receipts]);

    return (
        <div className="screen">
            <BackButton onClick={onBack} />
            <div className="card">
                <h2>今日のレシピ提案</h2>
                {isLoading && <Loader message="購入履歴からレシピを考案中..." />}
                {error && <p className="error-message">{error}</p>}
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

function LifestyleTips({ onBack, receipts }) {
    const [tips, setTips] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const getTips = async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await callApi('lifestyle_tips', { receipts });
                setTips(response.data);
            } catch (err) {
                setError('ヒントの取得に失敗しました。');
            } finally {
                setIsLoading(false);
            }
        };
        getTips();
    }, [receipts]);
    
    return (
        <div className="screen">
            <BackButton onClick={onBack} />
            <div className="card">
                <h2>AIからの生活のヒント</h2>
                {isLoading && <Loader message="あなたの生活を分析中..." />}
                {error && <p className="error-message">{error}</p>}
                {tips && <p style={{lineHeight: 1.8}}>{tips}</p>}
            </div>
        </div>
    );
}

// --- Report Sub-Components ---

interface EditingItem {
    receiptId: number;
    itemIndex: number;
    data: {
        name: string;
        price: string;
    };
}

function WeeklyReport({ receipts, allReceipts, onUpdateReceipts }) {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

    const toggleSelection = (key) => {
        setSelectedKeys(prev => {
            const newSet = new Set(prev);
            if (newSet.has(key)) {
                newSet.delete(key);
            } else {
                newSet.add(key);
            }
            return newSet;
        });
    };

    const toggleReceiptSelection = (receipt) => {
        const receiptItemKeys = receipt.items.map((_, i) => `${receipt.id}-${i}`);
        const areAllSelected = receiptItemKeys.length > 0 && receiptItemKeys.every(key => selectedKeys.has(key));
        
        setSelectedKeys(prev => {
            const newSet = new Set(prev);
            if (areAllSelected) {
                receiptItemKeys.forEach(key => newSet.delete(key));
            } else {
                receiptItemKeys.forEach(key => newSet.add(key));
            }
            return newSet;
        });
    };
    
    const handleDeleteSelected = () => {
        if (selectedKeys.size === 0 || !confirm(`${selectedKeys.size}個の品目を削除しますか？`)) {
            return;
        }

        const updatedReceipts = allReceipts
            .map(r => ({
                ...r,
                items: r.items.filter((_, i) => !selectedKeys.has(`${r.id}-${i}`))
            }))
            .filter(r => r.items.length > 0);
        
        onUpdateReceipts(updatedReceipts);
        setSelectedKeys(new Set());
    };

    const handleStartEdit = () => {
        const key = Array.from(selectedKeys)[0];
        const [receiptIdStr, itemIndexStr] = key.split('-');
        const receiptId = parseInt(receiptIdStr, 10);
        const itemIndex = parseInt(itemIndexStr, 10);
        const receipt = allReceipts.find(r => r.id === receiptId);
        if (receipt) {
            const item = receipt.items[itemIndex];
            setEditingItem({
                receiptId: receipt.id,
                itemIndex,
                data: { name: item.name, price: String(item.price) }
            });
        }
    };

    const handleSaveEdit = () => {
        if (!editingItem) return;
        const { receiptId, itemIndex, data } = editingItem;

        const updatedReceipts = allReceipts.map(r => {
            if (r.id !== receiptId) return r;
            const newItems = r.items.map((item, index) => {
                if (index !== itemIndex) return item;
                return {
                    ...item,
                    name: data.name,
                    price: parseInt(data.price, 10) || 0
                };
            });
            return { ...r, items: newItems };
        });

        onUpdateReceipts(updatedReceipts);
        setEditingItem(null);
        setSelectedKeys(new Set());
    };
    
    if (editingItem) {
        return (
            <div className="card" style={{marginTop: '1.5rem'}}>
                <h3>品目の編集</h3>
                <div className="form-group">
                    <label>品名</label>
                    <input type="text" className="text-input" value={editingItem.data.name} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, name: e.target.value}})} />
                </div>
                <div className="form-group">
                    <label>金額</label>
                    <input 
                      type="text" 
                      inputMode="numeric" 
                      className="text-input" 
                      value={editingItem.data.price} 
                      onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, price: e.target.value.replace(/\D/g, '')}})} 
                    />
                </div>
                <div style={{display: 'flex', gap: '1rem'}}>
                    <button onClick={handleSaveEdit} className="btn btn-primary">保存</button>
                    <button onClick={() => setEditingItem(null)} className="btn btn-secondary">キャンセル</button>
                </div>
            </div>
        )
    }
    
    if (receipts.length === 0) {
        return <p className="text-light" style={{textAlign: 'center', marginTop: '1rem'}}>この期間の支出はありません。</p>;
    }
    
    const numSelected = selectedKeys.size;

    return (
      <>
        <div className="weekly-report-actions">
            <button className="btn btn-secondary" onClick={handleStartEdit} disabled={numSelected !== 1}>
                選択を編集
            </button>
            <button className="btn btn-delete" onClick={handleDeleteSelected} disabled={numSelected === 0}>
                選択を削除 ({numSelected})
            </button>
        </div>
        <h3 style={{marginTop: '1.5rem', marginBottom: '1rem'}}>支出詳細</h3>
        {receipts.map((receipt) => {
          const receiptItemKeys = receipt.items.map((_, i) => `${receipt.id}-${i}`);
          const areAllSelected = receiptItemKeys.length > 0 && receiptItemKeys.every(key => selectedKeys.has(key));

          return (
            <div key={receipt.id} style={{marginBottom: '1rem'}}>
                <div className="weekly-report-header">
                    <input 
                        type="checkbox"
                        checked={areAllSelected}
                        onChange={() => toggleReceiptSelection(receipt)}
                        title="このレシートの項目をすべて選択/解除"
                    />
                    <span>{receipt.purchaseDate} - {receipt.storeName}</span>
                </div>
                <ul className="item-list-display editable">
                {receipt.items.map((item, i) => {
                    const key = `${receipt.id}-${i}`;
                    const isSelected = selectedKeys.has(key);
                    return (
                    <li key={key} className={isSelected ? 'selected' : ''}>
                        <input 
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(key)}
                        />
                        <span>{item.name}</span>
                        <span>{item.price.toLocaleString()}円</span>
                    </li>
                    );
                })}
                </ul>
            </div>
          );
        })}
      </>
    );
}

function MonthlyReport({ receipts, cacheKey }) {
    const [summary, setSummary] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const getCategorySummary = async (forceRefresh = false) => {
        const cachedData = getFromStorage(cacheKey, null);
        if (receipts.length === 0) {
            setSummary([]);
            setToStorage(cacheKey, []);
            return;
        }
        if (!forceRefresh && cachedData) {
             setSummary(cachedData);
             return;
        }
        setIsLoading(true);
        setError('');
        try {
            const allItems = receipts.flatMap(r => r.items);
            const response = await callApi('monthly_report_categorize', { items: allItems });
            setSummary(response.data);
            setToStorage(cacheKey, response.data);
        } catch (err) {
            setError('カテゴリ別集計の取得に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        getCategorySummary();
    }, [receipts, cacheKey]);

    const handleRefresh = () => {
        getCategorySummary(true);
    };

    return (
        <div className="monthly-category-report">
            <div className="report-header">
                <h3>カテゴリ別支出</h3>
                <button onClick={handleRefresh} className="btn-refresh" disabled={isLoading}>
                    {isLoading ? '更新中...' : 'AIで再集計'}
                </button>
            </div>
            {isLoading && <Loader mini={true} message="AIが支出をカテゴリ分けしています..." />}
            {error && <p className="error-message">{error}</p>}
            {!isLoading && !error && (!summary || summary.length === 0) &&
                <p className="text-light" style={{textAlign: 'center', marginTop: '1rem'}}>集計するデータがありません。</p>
            }
            {summary && summary.length > 0 && (
                <ul className="item-list-display">
                    {summary.map((item, index) => (
                        <li key={index} className="category-item">
                            <span className="category-item-name">{item.category}</span>
                            <span className="category-item-amount">{item.totalAmount.toLocaleString()}円</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function YearlyReport({ receipts, allFixedCosts, cacheKey, year }) {
    const [categoryData, setCategoryData] = useState(null);
    const [storeData, setStoreData] = useState([]);
    const [monthlyData, setMonthlyData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const generateColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }
        return color;
    };

    const processData = useCallback(async (forceRefresh = false) => {
        // Client-side aggregations
        const storeTotals = receipts.reduce((acc, r) => {
            const store = r.storeName || '不明な店';
            acc[store] = (acc[store] || 0) + r.items.reduce((sum, i) => sum + i.price, 0);
            return acc;
        }, {});
        setStoreData(Object.entries(storeTotals).map(([name, value]) => ({ name, value, color: generateColor(name) })));

        const monthlyVariableTotals = Array(12).fill(0);
        receipts.forEach(r => {
            const month = new Date(r.purchaseDate).getMonth();
            monthlyVariableTotals[month] += r.items.reduce((sum, i) => sum + i.price, 0);
        });
        
        const allMonthsData = Array(12).fill(0).map((_, index) => {
            const month = index + 1;
            const monthKey = `${year}-${String(month).padStart(2, '0')}`;
            const costsForMonth = allFixedCosts[monthKey] || [];
            const fixedCostTotal = costsForMonth.reduce((sum, c) => sum + (Number(c.amount || 0) || 0), 0);
            return {
                name: `${month}月`,
                variable: monthlyVariableTotals[index],
                fixed: fixedCostTotal,
            };
        });
        setMonthlyData(allMonthsData);


        // AI-powered categorization (with cache)
        const cachedData = getFromStorage(cacheKey, null);
        if (receipts.length === 0) {
            setCategoryData([]);
            setToStorage(cacheKey, []);
            return;
        }
        if (!forceRefresh && cachedData) {
            setCategoryData(cachedData);
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const allItems = receipts.flatMap(r => r.items);
            const response = await callApi('monthly_report_categorize', { items: allItems });
            const processed = response.data.map(d => ({ name: d.category, value: d.totalAmount, color: generateColor(d.category) }));
            setCategoryData(processed);
            setToStorage(cacheKey, processed);
        } catch (err) {
            setError('カテゴリ分析に失敗しました。');
        } finally {
            setIsLoading(false);
        }
    }, [receipts, allFixedCosts, cacheKey, year]);
    
    useEffect(() => {
        processData();
    }, [processData]);

    const PieChart = ({ title, data }) => {
        const total = data.reduce((sum, item) => sum + item.value, 0);
        if (total === 0) return null;
        
        let cumulativePercent = 0;
        const gradientParts = data.map(item => {
            const percent = (item.value / total) * 100;
            const part = `${item.color} ${cumulativePercent}% ${cumulativePercent + percent}%`;
            cumulativePercent += percent;
            return part;
        });
        const conicGradient = `conic-gradient(${gradientParts.join(', ')})`;
        
        return (
            <div className="chart-wrapper">
                <h4>{title}</h4>
                <div className="pie-chart-container">
                    <div className="pie-chart" style={{ background: conicGradient }}></div>
                    <ul className="pie-chart-legend">
                        {data.slice(0, 7).map(item => (
                            <li key={item.name}>
                                <span className="legend-color" style={{ backgroundColor: item.color }}></span>
                                {item.name} ({((item.value / total) * 100).toFixed(1)}%)
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    };

    const BarChart = ({ title, data }) => {
        const maxValue = Math.max(...data.map(d => d.variable + d.fixed), 1);
        return (
            <div className="chart-wrapper">
                <h4>{title}</h4>
                <div className="chart-legend">
                    <div className="legend-item">
                        <div className="legend-color-box" style={{backgroundColor: 'var(--primary-color)'}}></div>
                        <span>変動費</span>
                    </div>
                    <div className="legend-item">
                        <div className="legend-color-box" style={{backgroundColor: 'var(--accent-color)'}}></div>
                        <span>固定費</span>
                    </div>
                </div>
                <div className="bar-chart-container">
                    {data.map(item => {
                        const totalValue = item.variable + item.fixed;
                        return (
                            <div key={item.name} className="bar-group">
                                <div className="bar">
                                    <span className="bar-value">{totalValue.toLocaleString()}</span>
                                    <div className="bar-segment fixed" title={`固定費: ${item.fixed.toLocaleString()}円`} style={{ height: `${(item.fixed / maxValue) * 100}%` }}></div>
                                    <div className="bar-segment variable" title={`変動費: ${item.variable.toLocaleString()}円`} style={{ height: `${(item.variable / maxValue) * 100}%` }}></div>
                                </div>
                                <span className="bar-label">{item.name}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="yearly-report">
            <div className="report-header">
                <h3>年次サマリー</h3>
                <button onClick={() => processData(true)} className="btn-refresh" disabled={isLoading}>
                    {isLoading ? '更新中...' : 'AIで再分析'}
                </button>
            </div>
            {isLoading && <Loader mini={true} message="AIが1年間の支出を分析中です..." />}
            {error && <p className="error-message">{error}</p>}
            {!isLoading && receipts.length === 0 && <p className="text-light" style={{ textAlign: 'center' }}>データがありません。</p>}
            
            {!isLoading && !error && receipts.length > 0 && (
                <div className="yearly-report-grid">
                    <PieChart title="カテゴリ別支出" data={categoryData || []} />
                    <PieChart title="店舗別支出" data={storeData} />
                    <BarChart title="月次支出推移" data={monthlyData} />
                </div>
            )}
        </div>
    );
}


function Reports({ onBack, receipts, fixedCosts, onUpdateReceipts, driveFileId }) {
  const [reportType, setReportType] = useState('weekly');
  const [currentDate, setCurrentDate] = useState(new Date());

  const navigateDate = (amount) => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      if (reportType === 'weekly') {
        newDate.setDate(newDate.getDate() + amount * 7);
      } else if (reportType === 'monthly') {
        newDate.setMonth(newDate.getMonth() + amount);
      } else { // yearly
        newDate.setFullYear(newDate.getFullYear() + amount);
      }
      return newDate;
    });
  };

  const { start, end, title, cacheKey } = (() => {
    const d = currentDate;
    const baseCacheKey = `kakeibo_report_cache_${driveFileId}`;
    if (reportType === 'weekly') {
      const start = getStartOfWeek(d);
      const end = getEndOfWeek(d);
      const key = `${baseCacheKey}_weekly_${start.toISOString().split('T')[0]}`;
      return { start, end, title: `${start.toLocaleDateString('ja-JP')} - ${end.toLocaleDateString('ja-JP')}`, cacheKey: key};
    }
    if (reportType === 'monthly') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const key = `${baseCacheKey}_monthly_${d.getFullYear()}_${d.getMonth() + 1}`;
      return { start, end, title: `${d.getFullYear()}年${d.getMonth() + 1}月`, cacheKey: key };
    }
    // yearly
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    const key = `${baseCacheKey}_yearly_${d.getFullYear()}`;
    return { start, end, title: `${d.getFullYear()}年`, cacheKey: key };
  })();

  const periodReceipts = receipts.filter(r => {
    const rDate = new Date(r.purchaseDate);
    return rDate.getTime() >= start.getTime() && rDate.getTime() <= end.getTime();
  });
  
  const variableSpending = periodReceipts.reduce((sum, r) => sum + r.items.reduce((itemSum, i) => itemSum + (i.price || 0), 0), 0);
  
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const monthlyFixedCosts = fixedCosts[monthKey] || [];
  const fixedSpending = reportType === 'monthly' ? monthlyFixedCosts.reduce((sum, c) => sum + (c.amount || 0), 0) : 0;
  
  const totalSpending = variableSpending + fixedSpending;
  
  return (
    <div className="screen">
      <BackButton onClick={onBack} />
      <div className="card">
        <h2>レポート</h2>
        <div className="report-tabs">
          <button className={reportType === 'weekly' ? 'active' : ''} onClick={() => setReportType('weekly')}>週次</button>
          <button className={reportType === 'monthly' ? 'active' : ''} onClick={() => setReportType('monthly')}>月次</button>
          <button className={reportType === 'yearly' ? 'active' : ''} onClick={() => setReportType('yearly')}>年次</button>
        </div>
        <div className="date-navigator">
          <button onClick={() => navigateDate(-1)}>&lt;</button>
          <span>{title}</span>
          <button onClick={() => navigateDate(1)}>&gt;</button>
        </div>

        <div className="report-content">
          <div className="report-summary secondary">
            <span>変動費 (買い物)</span>
            <strong>{variableSpending.toLocaleString()} 円</strong>
          </div>
          {reportType === 'monthly' && (
            <div className="report-summary secondary">
              <span>月の固定費</span>
              <strong>{fixedSpending.toLocaleString()} 円</strong>
            </div>
          )}
          <div className="report-summary total">
            <span>合計支出</span>
            <strong>{totalSpending.toLocaleString()} 円</strong>
          </div>
          
           {reportType === 'weekly' && <WeeklyReport receipts={periodReceipts} allReceipts={receipts} onUpdateReceipts={onUpdateReceipts} />}
           {reportType === 'monthly' && <MonthlyReport receipts={periodReceipts} cacheKey={cacheKey} />}
           {reportType === 'yearly' && <YearlyReport receipts={periodReceipts} allFixedCosts={fixedCosts} cacheKey={cacheKey} year={currentDate.getFullYear()} />}
        </div>
      </div>
    </div>
  );
}



function App() {
  const [user, setUser] = useState(null);
  const [driveFileId, setDriveFileId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState('home');
  
  // Data states are now loaded from Google Drive
  const [allData, setAllData] = useState({
      receipts: [],
      fixedCosts: {},
      oshi: { name: '', url: '' },
      shoppingList: []
  });
  
  // States for receipt processing flow
  const [receiptImages, setReceiptImages] = useState([]);
  const [stagedReceipt, setStagedReceipt] = useState(null);
  const [isProcessing, setIsProcessing] = useState<string | false>(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [fileLoadError, setFileLoadError] = useState(null);
  const [fileLoadLog, setFileLoadLog] = useState<string[]>([]);


  // GSI/GAPI states
  const [gsiErrorType, setGsiErrorType] = useState<'script_load' | 'initialization' | null>(null);
  const [gsiGuidance, setGsiGuidance] = useState('');
  const [gsiCurrentOrigin, setGsiCurrentOrigin] = useState('');
  const [tokenClient, setTokenClient] = useState(null);
  
  // Diagnostic panel state
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const versionClickCount = useRef(0);
  const versionClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const AppVersion = "2.4.0";

  // This function will be called to update any part of the app's data
  // and will automatically save it to Google Drive.
  const updateAndSaveData = useCallback(async (newData) => {
    if (!driveFileId) return;
    setAllData(newData);
    try {
      await driveApi.saveFile(driveFileId, newData);
    } catch(e) {
      setError(`データの保存に失敗しました: ${e.message}`);
      throw e; // Re-throw to be caught by the caller
    }
  }, [driveFileId]);

  const showSuccessMessage = (message) => {
    setSuccessMessage(message);
    setTimeout(() => {
        setSuccessMessage('');
    }, 4000); // Clear after 4 seconds
  };
  
  // Diagnostic panel visibility logic
  const handleVersionClick = () => {
    versionClickCount.current += 1;

    if (versionClickTimer.current) {
      clearTimeout(versionClickTimer.current);
    }

    if (versionClickCount.current >= 5) {
      setShowDiagnostics(prev => !prev);
      versionClickCount.current = 0;
      versionClickTimer.current = null;
    } else {
      versionClickTimer.current = setTimeout(() => {
        versionClickCount.current = 0;
        versionClickTimer.current = null;
      }, 1000); // Reset after 1 second
    }
  };
  
  useEffect(() => {
    const panel = document.getElementById('diagnostic-panel');
    const root = document.getElementById('root');
    if (panel && root) {
      if (showDiagnostics) {
        panel.style.display = 'block';
        setTimeout(() => {
            root.style.paddingTop = `${panel.offsetHeight}px`;
        }, 10);
      } else {
        panel.style.display = 'none';
        root.style.paddingTop = '1rem';
      }
    }
  }, [showDiagnostics]);


  const isAiUnlocked = () => {
    if (!driveFileId) return false;
    
    const validReceipts = allData.receipts
        .filter(r => r.purchaseDate && !isNaN(new Date(r.purchaseDate).getTime()));

    if (validReceipts.length === 0) return false;

    validReceipts.sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime());
    
    const firstDate = new Date(validReceipts[0].purchaseDate);
    
    const oneMonthLater = new Date(firstDate);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    
    return new Date() >= oneMonthLater;
  };

  const handleLogout = () => {
    setUser(null);
    setDriveFileId(null);
    setAllData({ receipts: [], fixedCosts: {}, oshi: { name: '', url: '' }, shoppingList: [] });
    if (user) {
        setToStorage(getUserDataKey(user.id), {});
    }
    window.google?.accounts.id.disableAutoSelect();
  };
  
  const decodeJwt = (token: string) => {
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        console.error("Error decoding JWT", e);
        return null;
    }
  };

  // Login process split into parts
  const handleLoginClick = () => {
    if (tokenClient) {
        tokenClient.requestAccessToken();
    }
  };
  
  const startDevMode = () => {
      // Dev mode is complex with Drive API, so we'll simplify and disable it for now.
      alert("Google Drive連携のため、開発モードは現在無効です。通常のログインをお試しください。");
  };

  const initGoogleClients = useCallback(async (isRetry = false) => {
    if (!isRetry) setIsLoading(true);
    setGsiErrorType(null);
    window.diagnosticLog('③ Reactアプリ初期化開始');
    
    const loadGoogleScriptWithRetries = (url: string, name: string, maxRetries = 3, timeout = 30000): Promise<void> => {
        return new Promise((resolve, reject) => {
            let attempt = 1;

            const tryLoad = () => {
                window.diagnosticLog(`[Attempt ${attempt}/${maxRetries}] Loading ${name} script...`);
                let timer;
                const script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.defer = true;

                const cleanup = () => {
                    clearTimeout(timer);
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                };

                script.onload = () => {
                    window.diagnosticLog(`${name} script loaded successfully.`, 'success');
                    cleanup();
                    resolve();
                };

                script.onerror = () => {
                    window.diagnosticLog(`Failed to load ${name} script on attempt ${attempt}.`, 'error');
                    cleanup();
                    if (attempt < maxRetries) {
                        attempt++;
                        setTimeout(tryLoad, 1000); // Wait 1 second before retrying
                    } else {
                        reject(new Error(`${name} スクリプトの読み込みに失敗しました。`));
                    }
                };

                timer = setTimeout(() => {
                    window.diagnosticLog(`${name} script timed out on attempt ${attempt}.`, 'error');
                    cleanup();
                     if (attempt < maxRetries) {
                        attempt++;
                        tryLoad(); // Retry immediately on timeout
                    } else {
                        reject(new Error(`${name} スクリプトの読み込みがタイムアウトしました。`));
                    }
                }, timeout);
                
                document.head.appendChild(script);
            };

            tryLoad();
        });
    };


    try {
      window.diagnosticLog('⑥ GSI/GAPIスクリプトの動的読み込みを開始');
      
      const gsiPromise = loadGoogleScriptWithRetries('https://accounts.google.com/gsi/client', 'Google Sign-In (GSI)');
      const gapiPromise = loadGoogleScriptWithRetries('https://apis.google.com/js/api.js', 'Google Drive API (GAPI)');

      await Promise.all([gsiPromise, gapiPromise]);
      
      window.diagnosticLog('⑦ GSI/GAPIスクリプト準備完了', 'success');
      
      const GOOGLE_CLIENT_ID = "180245414289-5p8iucl74etimjv6f65jq93qa1fu97v5.apps.googleusercontent.com";
      
      window.diagnosticLog(`④ 使用中のClient ID: ${GOOGLE_CLIENT_ID}`, 'info');
      const currentOrigin = window.location.origin;
      setGsiCurrentOrigin(currentOrigin);
      window.diagnosticLog(`⑤ 現在のオリジン: ${currentOrigin}`, 'info');
      
      // Initialize GAPI
      await new Promise((resolve, reject) => window.gapi.load('client', {callback: resolve, onerror: reject}));
      await window.gapi.client.init({ discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]});
      window.diagnosticLog('⑧ GAPIクライアント初期化完了', 'success');

      // Initialize GSI Token Client
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive',
        callback: async (tokenResponse) => {
          if (tokenResponse.access_token) {
            window.diagnosticLog('⑨ アクセストークン取得成功', 'success');
            window.gapi.client.setToken(tokenResponse);
            
            // Fetch user profile
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
            });
            const userInfo = await userInfoResponse.json();

            const loggedInUser = {
              id: userInfo.sub,
              name: userInfo.name,
              email: userInfo.email,
              picture: userInfo.picture,
            };
            setUser(loggedInUser);

            // Check for saved fileId
            const userData = getFromStorage(getUserDataKey(loggedInUser.id), {});
            if (userData.driveFileId) {
                setDriveFileId(userData.driveFileId);
            } else {
                setIsLoading(false); // No fileId, stop loading and show setup screen
            }
          } else if (tokenResponse.error) {
              window.diagnosticLog(`Token request failed or was cancelled by user: ${tokenResponse.error}`, 'info');
              // This handles silent auth failure and user cancelling the login popup.
              // Stop the initial loading indicator and show the login button.
              setIsLoading(false);
          }
        },
      });
      setTokenClient(client);
      window.diagnosticLog('⑩ GSIトークンクライアント初期化完了', 'success');
      
      // Attempt to sign in silently on page load
      window.diagnosticLog('⑪ Attempting silent login...', 'info');
      client.requestAccessToken({prompt: 'none'});

    } catch (error) {
      const currentOrigin = window.location.origin;
      setGsiCurrentOrigin(currentOrigin);
      window.diagnosticLog(`[ERROR] Googleクライアント初期化失敗: ${error.message}`, 'error');
      setGsiErrorType('script_load');
      
      let guidanceMessage = `Googleのサービス接続に失敗しました: ${error.message}.`;
      if (error.message.includes('タイムアウト')) {
          guidanceMessage += `\n複数回の再試行に失敗しました。これは、お使いのネットワーク接続が低速であるか、広告ブロッカー等の拡張機能が原因の可能性があります。ページを再読み込みするか、別のネットワークでお試しください。それでも解決しない場合は、しばらく時間をおいてから再度お試しください。`;
      } else {
          guidanceMessage += ` ネットワーク接続、広告ブロッカーなどを確認してください。`;
      }
      setGsiGuidance(guidanceMessage);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initGoogleClients();
  }, [initGoogleClients]);

  // Load data from drive when fileId is set
  useEffect(() => {
    const loadDataWithRetries = async () => {
        if (!driveFileId || !user) return;

        setIsLoading(true);
        setFileLoadError(null);
        setFileLoadLog([]);
        setError('');

        const maxRetries = 2; // Total of 3 attempts
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 sec delay
                    window.diagnosticLog(`Retrying file load (attempt ${attempt + 1})...`);
                }
                const data = await driveApi.loadFile(driveFileId);
                setAllData(prev => ({ ...prev, ...data }));
                setIsLoading(false);
                return; // Success!
            } catch (e) {
                lastError = e as Error;
            }
        }

        // If loop finishes, all retries have failed
        window.diagnosticLog(`File load failed after all retries. Error: ${lastError.message}. Displaying error screen.`, 'error');

        const logSteps: string[] = [];
        logSteps.push(`ログイン中のアカウント: ${user.email}`);
        logSteps.push(`Google Drive APIの準備状況を確認... OK`);
        logSteps.push(`招待コード (${driveFileId}) でファイル情報を取得開始...`);
        logSteps.push(`エラー: ${lastError.message.split('。')[0]} (複数回試行)`);
        setFileLoadLog(logSteps);

        const errorTitle = "ファイルの読み込みに失敗しました。";
        const currentUserAccount = `【現在ログイン中のアカウント】\n${user.email || '不明'}`;
        const checkList = `
【考えられる原因と対策】
1. 招待コード（ファイルID）が間違っている可能性があります。
   → もう一度コードを確認し、コピー＆ペーストで正確に入力してください。

2. ファイルのオーナーが、上記のアカウントにファイルを共有していません。
   → ファイルのオーナーに、上記アカウントへの「編集者」権限での共有を依頼してください。

3. ブラウザで複数のGoogleアカウントにログインしており、意図しないアカウントが使用されています。
   → 一度ログアウトし、共有されたアカウントのみで再度ログインし直してください。
        `.trim();
        
        const detailedErrorMessage = `${errorTitle}\n\n${currentUserAccount}\n\n${checkList}\n\n技術的な詳細: ${lastError.message}`;
        setFileLoadError(detailedErrorMessage);
        setIsLoading(false);
    };

    loadDataWithRetries();
  }, [driveFileId, user]);


  const handleScanComplete = async (images) => {
    setReceiptImages(images);
    setIsProcessing('画像を解析中...');
    setCurrentScreen('home');
    try {
      const imagesB64 = images.map(dataUrl => dataUrl.split(',')[1]);
      const response = await callApi('receipt_confirm', { imagesB64 });
      const newReceiptData = response.data;
      
      setStagedReceipt(prevStagedReceipt => {
        if (prevStagedReceipt) {
          // This is a rescan, merge items. Keep metadata from the first scan.
          const combinedItems = [...prevStagedReceipt.items, ...newReceiptData.items];
          return { ...prevStagedReceipt, items: combinedItems };
        } else {
          // This is the first scan.
          return newReceiptData;
        }
      });
      
      setCurrentScreen('receipt-confirm');
    } catch (err) {
      let userFriendlyError = '画像の解析に失敗しました。';
      const errorMessage = (err as Error).message || '';
      
      if (errorMessage.includes('不鮮明') || errorMessage.includes('読み取れなかった')) {
          userFriendlyError += '\n\n画像が不鮮明でAIが文字を読み取れなかったようです。ピントを合わせ、明るい場所で再度撮影/選択してください。';
      } else if (errorMessage.toLowerCase().includes('payload') || errorMessage.includes('大きすぎます')) {
          userFriendlyError += '\n\n画像のデータ量が大きすぎるようです。枚数を減らして再度お試しください。';
      } else if (errorMessage.toLowerCase().includes('failed to fetch')) {
          userFriendlyError += '\n\n通信が不安定な可能性があります。電波の良い環境で再度お試しください。';
      } else {
          userFriendlyError += `\n理由: ${errorMessage}`;
      }
      
      setError(userFriendlyError);
      setCurrentScreen('home'); // On error, stay on home but show message
    } finally {
      setIsProcessing(false);
      setReceiptImages([]); // Clear images after processing
    }
  };

  const handleConfirmReceipt = async (data) => {
    setIsProcessing('家計簿に保存中...');
    const newReceipt = { id: Date.now(), ...data };
    const updatedData = { ...allData, receipts: [...allData.receipts, newReceipt] };
    try {
        await updateAndSaveData(updatedData);
        setStagedReceipt(null);
        setReceiptImages([]);
        setCurrentScreen('home');
        showSuccessMessage(`${data.purchaseDate}のレシートを保存しました。`);
    } catch (e) {
        setError(`保存に失敗しました: ${e.message}`);
        setCurrentScreen('home');
    } finally {
        setIsProcessing(false);
    }
  };

  const handleRetakeForUnchecked = (currentItems) => {
    const checkedItems = currentItems.filter(item => item.checked);
    setStagedReceipt(prev => ({ ...prev, items: checkedItems.map(({id, checked, ...rest}) => rest) }));
    setCurrentScreen('receipt-scan');
  };

  const handleDiscardAndStartOver = useCallback(() => {
    setStagedReceipt(null);
    setReceiptImages([]);
    setCurrentScreen('receipt-scan');
  }, []);

  const handleManualSave = async (data) => {
    setIsProcessing('家計簿に保存中...');
    const newReceipt = { id: Date.now(), ...data, discount: 0, tax: 0 };
    const sortedReceipts = [...allData.receipts, newReceipt].sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
    const updatedData = { ...allData, receipts: sortedReceipts };
    try {
        await updateAndSaveData(updatedData);
        setCurrentScreen('home');
        showSuccessMessage(`${data.purchaseDate}の支出を保存しました。`);
    } catch (e) {
        setError(`保存に失敗しました: ${e.message}`);
        setCurrentScreen('home');
    } finally {
        setIsProcessing(false);
    }
  };

  const updateReceipts = (updatedReceipts) => {
      updateAndSaveData({ ...allData, receipts: updatedReceipts });
  };
  
  const updateShoppingList = (newList) => {
    updateAndSaveData({ ...allData, shoppingList: newList });
  };

  const handleSaveFixedCosts = (monthKey, costs) => {
    const updatedFixedCosts = { ...allData.fixedCosts, [monthKey]: costs };
    updateAndSaveData({ ...allData, fixedCosts: updatedFixedCosts });
    setCurrentScreen('home');
  };

  const handleSaveOshi = (data) => {
    updateAndSaveData({ ...allData, oshi: data });
    setCurrentScreen('home');
  };

  const handleSetFileId = (newFileId) => {
    setDriveFileId(newFileId);
    if (user) {
        setToStorage(getUserDataKey(user.id), { driveFileId: newFileId });
    }
  };
  
  const handleReturnToSetup = useCallback(() => {
    window.diagnosticLog('User acknowledged file load error. Returning to Family Setup screen.');
    setFileLoadError(null);
    setError('');
    setDriveFileId(null);
    setCurrentScreen('home'); // Reset screen state
    if (user) {
        setToStorage(getUserDataKey(user.id), {});
    }
  }, [user]);
  
  const handleFileLoadedFromDiagnoser = (fileId: string, data: any) => {
    window.diagnosticLog(`File ${fileId} successfully loaded from diagnoser. Setting app state.`);
    setAllData(prev => ({ ...prev, ...data }));
    handleSetFileId(fileId); // This saves to local storage and sets state
    setFileLoadError(null);
  };

  const navigateHome = useCallback(() => setCurrentScreen('home'), []);
  
  const onBackHandler = useMemo(() => {
    if (currentScreen === 'drive-diagnoser') {
        return handleReturnToSetup;
    }
    const backMap = {
      'oshi-setup': navigateHome,
      'oshi-push': navigateHome,
      'receipt-scan': navigateHome,
      'receipt-confirm': handleDiscardAndStartOver,
      'fixed-cost': navigateHome,
      'manual-entry': navigateHome,
      'reports': navigateHome,
      'shopping-list': navigateHome,
      'recipe': navigateHome,
      'lifestyle-tips': navigateHome,
      'family-setup': driveFileId ? navigateHome : null,
    };
    return backMap[currentScreen] || null;
  }, [currentScreen, driveFileId, handleReturnToSetup, navigateHome, handleDiscardAndStartOver]);

  useSwipeBack(onBackHandler);

  const renderScreen = () => {
    const { receipts, fixedCosts, oshi, shoppingList } = allData;
    switch (currentScreen) {
      case 'home':
        return <Home onNavigate={setCurrentScreen} oshi={oshi} isAiUnlocked={isAiUnlocked()} onLogout={handleLogout} />;
      case 'oshi-setup':
        return <OshiSetup onSave={handleSaveOshi} initialOshi={oshi} onBack={navigateHome} />;
      case 'oshi-push':
        return <OshiPush onBack={navigateHome} oshi={oshi} />;
      case 'receipt-scan':
        return <ReceiptScan onScanComplete={handleScanComplete} onBack={navigateHome} />;
      case 'receipt-confirm':
        return <ReceiptConfirm 
                    receiptData={stagedReceipt} 
                    onSave={handleConfirmReceipt} 
                    onRetakeForUnchecked={handleRetakeForUnchecked}
                    onDiscardAndStartOver={handleDiscardAndStartOver}
                    isSaving={!!isProcessing} />;
      case 'fixed-cost':
        return <FixedCostInput onBack={navigateHome} allFixedCosts={fixedCosts} onSave={handleSaveFixedCosts} />;
      case 'manual-entry':
        return <ManualEntry onBack={navigateHome} onSave={handleManualSave} isSaving={!!isProcessing} />;
      case 'reports':
        return <Reports onBack={navigateHome} receipts={receipts} fixedCosts={fixedCosts} onUpdateReceipts={updateReceipts} driveFileId={driveFileId} />;
      case 'shopping-list':
        return <ShoppingList onBack={navigateHome} shoppingList={shoppingList} onUpdate={updateShoppingList} receipts={receipts} isAiUnlocked={isAiUnlocked()} />;
      case 'recipe':
        return <Recipe onBack={navigateHome} receipts={receipts} />;
      case 'lifestyle-tips':
        return <LifestyleTips onBack={navigateHome} receipts={receipts} />;
      case 'family-setup':
        return <FamilySetup onBack={driveFileId ? navigateHome : null} onFileIdSet={handleSetFileId} driveFileId={driveFileId} user={user} />;
      default:
        setCurrentScreen('home');
        return <Home onNavigate={setCurrentScreen} oshi={oshi} isAiUnlocked={isAiUnlocked()} onLogout={handleLogout} />;
    }
  };

  if (isLoading && !user) {
    return <Loader message="アプリを起動中..." />;
  }
  
  if (gsiErrorType) {
    return <GsiErrorScreen 
        onRetry={() => initGoogleClients(true)}
        onDevMode={startDevMode} 
        guidance={gsiGuidance} 
        currentOrigin={gsiCurrentOrigin}
        errorType={gsiErrorType}
    />;
  }

  if (!user) {
    return <Login onLogin={handleLoginClick} error={error} />;
  }

  if (fileLoadError) {
      const mainContent = currentScreen === 'drive-diagnoser' 
          ? <GoogleDriveConnectionDiagnoser 
                onBack={handleReturnToSetup} 
                user={user} 
                onFileLoaded={handleFileLoadedFromDiagnoser}
            />
          : <FileLoadErrorScreen 
                message={fileLoadError} 
                onReturnToSetup={handleReturnToSetup} 
                onDiagnose={() => setCurrentScreen('drive-diagnoser')}
                diagnosticLog={fileLoadLog}
            />;
      
    return (
        <div className="app-container">
            <header className="app-header">
                <div className="header-content">
                    <div className="header-title-group">
                        <h1>我が家の！かんたん家計簿Ⅱ</h1>
                        <span className="app-version" onClick={handleVersionClick} style={{cursor: 'pointer'}} title="5回クリックで診断パネル表示">v{AppVersion}</span>
                    </div>
                </div>
            </header>
            <main className="app-content">
                {mainContent}
            </main>
        </div>
    );
  }

  if (!driveFileId) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <div className="header-title-group">
              <h1>我が家の！かんたん家計簿Ⅱ</h1>
              <span className="app-version" onClick={handleVersionClick} style={{cursor: 'pointer'}} title="5回クリックで診断パネル表示">v{AppVersion}</span>
            </div>
          </div>
        </header>
        <main className="app-content">
          <FamilySetup onFileIdSet={handleSetFileId} driveFileId={driveFileId} user={user} />
        </main>
      </div>
    );
  }

  if (isLoading && driveFileId) {
     return <Loader message="Google Driveからデータを読み込み中..." />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <div className="header-title-group">
            <h1>我が家の！かんたん家計簿Ⅱ</h1>
            <span className="app-version" onClick={handleVersionClick} style={{cursor: 'pointer'}} title="5回クリックで診断パネル表示">v{AppVersion}</span>
          </div>
        </div>
      </header>
      <main className="app-content">
        {error && <p className="error-message" onClick={() => setError('')} style={{whiteSpace: 'pre-wrap'}}>{error}</p>}
        {successMessage && <p className="success-message">{successMessage}</p>}
        {isProcessing ? <Loader message={isProcessing as string} /> : renderScreen()}
      </main>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// Add React to window for GSI and other potential scripts
window.React = React;
window.ReactDOM = { createRoot };