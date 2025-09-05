
import React, { useState, FC, useEffect, useRef, createContext, useContext } from 'https://esm.sh/react@beta';
import ReactDOM from 'https://esm.sh/react-dom@beta/client';

declare var Html5Qrcode: any;
declare var QRCode: any;
declare var XLSX: any;

// FIX: Add SpeechRecognition types to the global window object to resolve TypeScript errors.
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- APIプロキシヘルパー ---
async function callApiProxy(task: string, payload: object) {
    try {
        const response = await fetch('/api/gemini-proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ task, payload }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'APIの呼び出しに失敗しました。');
        }
        return await response.json();
    } catch (error) {
        console.error(`APIプロキシエラー (${task}):`, error);
        throw error;
    }
}


// --- データ型定義 ---
interface CustomField { key: string; value: string; }
interface CardDataInput {
    companyName?: string; name?: string; furigana?: string; department?: string;
    title?: string; zipCode?: string; address?: string; tel?: string;
    mobileTel?: string; fax?: string; email?: string; website?: string[]; otherTel?: string; notes?: string;
    tags?: string[]; classification?: string; sns?: string[]; customFields?: CustomField[];
}
interface CardData extends CardDataInput {
    id: number; imageUrl: string | null; imageUrlBack: string | null;
}
interface Memo {
    id: number; timestamp: string; content: string; summary?: string;
}
interface ImagesToConfirm {
    front: string | null; back: string | null;
}
// 保険証券データの新しい型定義
interface PolicyField {
    id: number;
    key: string;
    value: string;
}
interface PolicyData {
    id: number;
    title: string;
    imageUrls: string[];
    fields: PolicyField[];
}


type View = 'main' | 'list' | 'recent' | 'add' | 'confirm' | 'detail' | 'memo' | 'analysisTool' | 'dynamicAnalysis' | 'policyDetail' | 'analysisList' | 'excelIntegration';

interface ExtractionState {
    confirmedData: CardDataInput;
    fieldsToReExtract: Array<keyof CardDataInput>;
    previousCheckedFields?: Record<string, boolean>;
}

const classifications = ['顧客', '協力会社', 'サポート会社', '業界関係者', '社内関係者', 'その他'];

interface CardForClassification {
    data: CardDataInput;
    images: ImagesToConfirm | null;
    isEditing: boolean;
    editingId?: number;
}
interface AiAnalysisResult {
    insuranceNeeds: { need: string; reason: string; }[];
    disasterRisk: { riskType: string; level: string; details: string; } | null;
    approachStrategy: {
        titleBasedHints: string[];
        proposalTemplate: string;
    };
    marketInfo: {
        content: string;
        sources: { uri: string; title: string; }[];
    } | null;
}
// 現在進行中の証券分析セッションの型
interface CurrentPolicyAnalysis {
    images: string[];
    fields: PolicyField[];
    isAnalyzing: boolean;
    error: string | null;
}

// --- CSV Helper Functions ---
const formatCsvField = (field: any): string => {
    if (field === null || field === undefined) {
        return '';
    }
    let stringValue = String(field);
    // Escape double quotes by doubling them
    stringValue = stringValue.replace(/"/g, '""');
    // If the string contains a comma, a double quote, or a newline, wrap it in double quotes
    if (stringValue.search(/("|,|\n)/g) >= 0) {
        stringValue = `"${stringValue}"`;
    }
    return stringValue;
};

const parseCsvLine = (line: string): string[] => {
    // This regex handles quoted fields, including escaped quotes ("") inside.
    const regex = /(?:"([^"]*(?:""[^"]*)*)"|([^,]*))(?:,|$)/g;
    const fields: string[] = [];
    let match;
    // Reset regex state for each line
    regex.lastIndex = 0;
    while ((match = regex.exec(line))) {
        if (match[1] !== undefined) {
            // Quoted field: unescape double quotes
            fields.push(match[1].replace(/""/g, '"'));
        } else if (match[2] !== undefined) {
            // Unquoted field
            fields.push(match[2]);
        } else {
            fields.push('');
        }
        if (match[0].slice(-1) !== ',') break; // End of line
    }
    return fields;
};

// --- App Context for State Management ---
interface AppContextType {
    view: View;
    history: View[];
    navigateTo: (view: View) => void;
    goBack: () => void;
    imagesToConfirm: ImagesToConfirm | null;
    cards: CardData[];
    selectedCardId: number | null;
    editingCard: CardData | null;
    memos: Record<number, Memo[]>;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    allTags: string[];
    activeTagFilter: string | null;
    setActiveTagFilter: (tag: string | null) => void;
    activeClassificationFilter: string | null;
    setActiveClassificationFilter: (classification: string | null) => void;
    handleConfirmImages: (images: ImagesToConfirm) => void;
    handleSaveCard: (newCardData: CardDataInput) => void;
    handleUpdateCard: (updatedCardData: CardData) => void;
    handleDeleteCard: (cardId: number) => void;
    handleSelectCard: (id: number) => void;
    handleSaveMemos: (cardId: number, newMemos: Memo[]) => void;
    handleImportData: (file: File) => void;
    startRecordingOnCall: boolean;
    setStartRecordingOnCall: (start: boolean) => void;
    selectedCardPhoneNumber: string | null;
    setSelectedCardPhoneNumber: (phone: string | null) => void;
    selectedCard: CardData | undefined;
    recentCardIds: number[];
    extractionState: ExtractionState | null;
    handleRetryExtraction: (currentData: CardDataInput, checkedState: Record<string, boolean>) => void;
    clearExtractionState: () => void;
    handleCreateManualCard: () => void;
    cardForClassification: CardForClassification | null;
    promptForClassification: (card: CardForClassification) => void;
    cancelClassification: () => void;
    aiAnalysisResult: AiAnalysisResult | null;
    isAnalyzing: boolean;
    handleAnalyzeCard: (card: CardData) => void;
    // New states and handlers for Policy Analysis
    policies: PolicyData[];
    selectedPolicyId: number | null;
    recentPolicyIds: number[];
    handleUpdatePolicy: (updatedPolicy: PolicyData) => void;
    handleDeletePolicy: (policyId: number) => void;
    handleSelectPolicy: (id: number) => void;
    currentPolicyAnalysis: CurrentPolicyAnalysis | null;
    handleStartNewAnalysis: () => void;
    handleAddImageToAnalysis: (image: string) => void;
    handleSaveCurrentAnalysis: (title: string) => void;
    cancelCurrentAnalysis: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};

// --- App Provider Component ---
const AppProvider: FC<{children: React.ReactNode}> = ({ children }) => {
    const [history, setHistory] = useState<View[]>(['main']);
    const view = history[history.length - 1];
    const [imagesToConfirm, setImagesToConfirm] = useState<ImagesToConfirm | null>(null);
    const [cards, setCards] = useState<CardData[]>([]);
    const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
    const [editingCard, setEditingCard] = useState<CardData | null>(null);
    const [recentCardIds, setRecentCardIds] = useState<number[]>([]);
    const [memos, setMemos] = useState<Record<number, Memo[]>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [startRecordingOnCall, setStartRecordingOnCall] = useState(false);
    const [selectedCardPhoneNumber, setSelectedCardPhoneNumber] = useState<string | null>(null);
    const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
    const [activeClassificationFilter, setActiveClassificationFilter] = useState<string | null>(null);
    const [extractionState, setExtractionState] = useState<ExtractionState | null>(null);
    const [cardForClassification, setCardForClassification] = useState<CardForClassification | null>(null);
    const [aiAnalysisResult, setAiAnalysisResult] = useState<AiAnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    // New states for Policy Analysis
    const [policies, setPolicies] = useState<PolicyData[]>([]);
    const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
    const [recentPolicyIds, setRecentPolicyIds] = useState<number[]>([]);
    const [currentPolicyAnalysis, setCurrentPolicyAnalysis] = useState<CurrentPolicyAnalysis | null>(null);


    const navigateTo = (view: View) => setHistory(prev => [...prev, view]);
    const goBack = () => setHistory(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));

    useEffect(() => {
        try {
            const storedCards = localStorage.getItem('businessCards');
            if (storedCards) setCards(JSON.parse(storedCards));
            
            const storedRecent = localStorage.getItem('recentBusinessCards');
            if (storedRecent) setRecentCardIds(JSON.parse(storedRecent));

            const storedMemos = localStorage.getItem('businessCardMemos');
            if(storedMemos) setMemos(JSON.parse(storedMemos));
            
            const storedPolicies = localStorage.getItem('insurancePolicies');
            if (storedPolicies) setPolicies(JSON.parse(storedPolicies));
            
            const storedRecentPolicies = localStorage.getItem('recentInsurancePolicies');
            if (storedRecentPolicies) setRecentPolicyIds(JSON.parse(storedRecentPolicies));


        } catch (e) {
            console.error("Failed to load data from localStorage", e);
        }
    }, []);
    
    const updateCards = (newCards: CardData[]) => {
        setCards(newCards);
        try {
            localStorage.setItem('businessCards', JSON.stringify(newCards));
        } catch (e) {
            console.error("Failed to save cards to localStorage", e);
        }
    };
    
    const updateMemos = (newMemos: Record<number, Memo[]>) => {
        setMemos(newMemos);
        try {
            localStorage.setItem('businessCardMemos', JSON.stringify(newMemos));
        } catch(e) {
            console.error("Failed to save memos to localStorage", e);
        }
    }
    
    const updateRecentCards = (newRecentIds: number[]) => {
        setRecentCardIds(newRecentIds);
        try {
            localStorage.setItem('recentBusinessCards', JSON.stringify(newRecentIds));
        } catch (e) {
            console.error("Failed to save recent cards", e);
        }
    }

    const updatePolicies = (newPolicies: PolicyData[]) => {
        setPolicies(newPolicies);
        try {
            localStorage.setItem('insurancePolicies', JSON.stringify(newPolicies));
        } catch (e) {
            console.error("Failed to save policies to localStorage", e);
        }
    };

    const updateRecentPolicies = (newRecentIds: number[]) => {
        setRecentPolicyIds(newRecentIds);
        try {
            localStorage.setItem('recentInsurancePolicies', JSON.stringify(newRecentIds));
        } catch (e) {
            console.error("Failed to save recent policies", e);
        }
    }

    const handleConfirmImages = (images: ImagesToConfirm) => {
        setImagesToConfirm(images);
        setEditingCard(null);
        navigateTo('confirm');
    };

    const handleSaveCard = (newCardData: CardDataInput) => {
        if (!cardForClassification) return;
        const images = cardForClassification.images; // Can be null for manual creation
        const newCard: CardData = {
            ...newCardData,
            id: Date.now(),
            imageUrl: images?.front || null,
            imageUrlBack: images?.back || null,
        };
        updateCards([...cards, newCard]);
        setImagesToConfirm(null);
        setCardForClassification(null);
        setHistory(['main', 'list']);
    };
    
    const handleUpdateCard = (updatedCardData: CardData) => {
        const newCards = cards.map(c => c.id === updatedCardData.id ? updatedCardData : c);
        updateCards(newCards);
        setEditingCard(null);
        setCardForClassification(null);
        navigateTo('detail');
    };
    
    const handleDeleteCard = (cardId: number) => {
        if (window.confirm('この名刺を本当に削除しますか？関連するメモもすべて削除されます。')) {
            const newCards = cards.filter(c => c.id !== cardId);
            updateCards(newCards);
            
            const newMemos = { ...memos };
            delete newMemos[cardId];
            updateMemos(newMemos);
            
            setHistory(['main', 'list']);
        }
    };
    
    const handleSelectCard = (id: number) => {
        setSelectedCardId(id);
        const cardToSelect = cards.find(c => c.id === id);
        if (cardToSelect) setEditingCard(cardToSelect);
        const newRecent = [id, ...recentCardIds.filter(recentId => recentId !== id)].slice(0, 15);
        updateRecentCards(newRecent);
        setAiAnalysisResult(null); // Clear previous analysis results
        navigateTo('detail');
    };

    const handleSaveMemos = (cardId: number, newMemos: Memo[]) => {
        const updatedMemos = {...memos, [cardId]: newMemos};
        updateMemos(updatedMemos);
    }
    
    const handleImportData = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                if (!content) throw new Error("ファイルが空です。");
                
                // データタイプの判別と処理
                if (file.name.endsWith('.csv')) {
                    const lines = content.trim().split('\n');
                    const headerLine = lines[0];
                    const header = parseCsvLine(headerLine).map(h => h.trim());

                    if (header.includes('companyName') && header.includes('name')) {
                        // 名刺データのCSV
                        const newCards = parseCardCsv(content);
                        const existingCards = new Set(cards.map(c => `${c.companyName}-${c.name}`));
                        const uniqueNewCards = newCards.filter(
                            (nc: CardDataInput) => !existingCards.has(`${nc.companyName}-${nc.name}`)
                        ).map((nc: CardDataInput) => ({
                             ...nc, id: Date.now() + Math.random(), imageUrl: null, imageUrlBack: null
                        }));
                        if(uniqueNewCards.length > 0) {
                            updateCards([...cards, ...uniqueNewCards]);
                            alert(`${uniqueNewCards.length}件の新しい名刺がインポートされました。名刺一覧に移動します。`);
                            navigateTo('list');
                        } else {
                            alert('新しい名刺は見つかりませんでした。すべてのデータが既に存在している可能性があります。');
                        }
                    } else if (header.includes('title') && header.includes('fields')) {
                        // 分析データのCSV
                        const newPolicies = parsePolicyCsv(content);
                        const existingPolicies = new Set(policies.map(p => p.title));
                        const uniqueNewPolicies = newPolicies.filter(
                            (np: Omit<PolicyData, 'id'>) => !existingPolicies.has(np.title)
                        ).map((np: Omit<PolicyData, 'id'>) => ({
                            ...np, id: Date.now() + Math.random()
                        }));
                         if(uniqueNewPolicies.length > 0) {
                            updatePolicies([...policies, ...uniqueNewPolicies]);
                            alert(`${uniqueNewPolicies.length}件の新しい分析データがインポートされました。分析一覧に移動します。`);
                            navigateTo('analysisList');
                        } else {
                            alert('新しい分析データは見つかりませんでした。すべてのデータが既に存在している可能性があります。');
                        }
                    } else {
                        throw new Error("不明な形式のCSVファイルです。");
                    }

                } else if (file.name.endsWith('.txt')) {
                    if (content.includes('--- Business Card ---')) {
                        // 名刺データのTXT
                        const newCards = parseCardTxt(content);
                         const existingCards = new Set(cards.map(c => `${c.companyName}-${c.name}`));
                         const uniqueNewCards = newCards.filter(
                            (nc: CardDataInput) => !existingCards.has(`${nc.companyName}-${nc.name}`)
                        ).map((nc: CardDataInput) => ({
                             ...nc, id: Date.now() + Math.random(), imageUrl: null, imageUrlBack: null
                        }));
                        if(uniqueNewCards.length > 0) {
                            updateCards([...cards, ...uniqueNewCards]);
                            alert(`${uniqueNewCards.length}件の新しい名刺がインポートされました。名刺一覧に移動します。`);
                            navigateTo('list');
                        } else {
                            alert('新しい名刺は見つかりませんでした。すべてのデータが既に存在している可能性があります。');
                        }
                    } else if (content.includes('--- Analysis Data:')) {
                        // 分析データのTXT
                        const newPolicies = parsePolicyTxt(content);
                        const existingPolicies = new Set(policies.map(p => p.title));
                        const uniqueNewPolicies = newPolicies.filter(
                            (np: Omit<PolicyData, 'id'>) => !existingPolicies.has(np.title)
                        ).map((np: Omit<PolicyData, 'id'>) => ({
                            ...np, id: Date.now() + Math.random()
                        }));
                         if(uniqueNewPolicies.length > 0) {
                            updatePolicies([...policies, ...uniqueNewPolicies]);
                            alert(`${uniqueNewPolicies.length}件の新しい分析データがインポートされました。分析一覧に移動します。`);
                            navigateTo('analysisList');
                        } else {
                            alert('新しい分析データは見つかりませんでした。すべてのデータが既に存在している可能性があります。');
                        }
                    } else {
                         throw new Error("不明な形式のテキストファイルです。");
                    }
                } else {
                     throw new Error("対応していないファイル形式です。.csvまたは.txtファイルを選択してください。");
                }
            } catch (error: any) {
                console.error("インポートエラー:", error);
                alert(`ファイルのインポートに失敗しました: ${error.message}`);
            }
        };
        reader.readAsText(file);
    };

    const parseCardCsv = (csv: string): CardDataInput[] => {
        // BUG FIX: Simple split('\n') fails if fields contain newlines.
        // Use a regex that splits on newlines only if they are not inside quotes.
        const lines = csv.trim().split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const headerLine = lines.shift();
        if (!headerLine) return [];
        const header = parseCsvLine(headerLine).map(h => h.trim());
        
        return lines.map(line => {
            if (!line.trim()) return null;
            const values = parseCsvLine(line);
            const card: CardDataInput = {};
            header.forEach((key, index) => {
                if (index >= values.length) return;
                const typedKey = key as keyof CardDataInput;
                const value = values[index];
                if (['website', 'sns', 'tags'].includes(key)) {
                    (card as any)[typedKey] = value ? value.split(';') : [];
                } else if (key === 'customFields') {
                    (card as any)[typedKey] = value ? value.split(';').map(cf => {
                        const separatorIndex = cf.indexOf(':');
                        if (separatorIndex === -1) return { key: cf, value: '' };
                        const k = cf.substring(0, separatorIndex);
                        const v = cf.substring(separatorIndex + 1);
                        return { key: k, value: v };
                    }) : [];
                } else {
                    (card as any)[typedKey] = value;
                }
            });
            return card;
        }).filter((card): card is CardDataInput => card !== null);
    };
    
    const parsePolicyCsv = (csv: string): Omit<PolicyData, 'id'>[] => {
        // BUG FIX: Simple split('\n') fails if fields contain newlines.
        // Use a regex that splits on newlines only if they are not inside quotes.
        const lines = csv.trim().split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const headerLine = lines.shift();
        if (!headerLine) return [];
        const header = parseCsvLine(headerLine).map(h => h.trim());
        
        return lines.map(line => {
             if (!line.trim()) return null;
             const values = parseCsvLine(line);
             const policyData: { [key: string]: any } = {};
             header.forEach((key, index) => {
                if (index < values.length) {
                    policyData[key] = values[index];
                }
             });

             return {
                title: policyData.title || '',
                imageUrls: policyData.imageUrls ? policyData.imageUrls.split(';') : [],
                fields: policyData.fields ? policyData.fields.split(';').map((f: string, i: number) => {
                    const separatorIndex = f.indexOf(':');
                    if (separatorIndex === -1) return { id: Date.now() + Math.random() + i, key: f, value: '' };
                    const key = f.substring(0, separatorIndex);
                    const value = f.substring(separatorIndex + 1);
                    return { id: Date.now() + Math.random() + i, key, value };
                }) : []
             };
        }).filter((policy): policy is Omit<PolicyData, 'id'> => policy !== null);
    };

    const parseCardTxt = (txt: string): CardDataInput[] => {
        const entries = txt.trim().split('--- Business Card ---').filter(Boolean);
        return entries.map(entry => {
            const card: CardDataInput = {};
            const lines = entry.trim().split('\n');
            lines.forEach(line => {
                const [key, ...valueParts] = line.split(': ');
                const value = valueParts.join(': ');
                // This is a simplified parser. It would need to be more robust for real-world use.
                switch(key) {
                    case 'companyName': card.companyName = value; break;
                    case 'name': card.name = value; break;
                    case 'furigana': card.furigana = value; break;
                    case 'department': card.department = value; break;
                    case 'title': card.title = value; break;
                    // ... add all other fields
                }
            });
            return card;
        });
    };
    
    const parsePolicyTxt = (txt: string): Omit<PolicyData, 'id'>[] => {
        const entries = txt.trim().split('--- Analysis Data:').filter(Boolean);
        return entries.map(entry => {
            const lines = entry.trim().split('\n');
            const title = lines.shift()!.replace('---', '').trim();
            const fields: PolicyField[] = [];
            lines.forEach(line => {
                const [key, ...valueParts] = line.split(': ');
                if (key && valueParts.length > 0) {
                     fields.push({ id: Date.now() + Math.random(), key: key.trim(), value: valueParts.join(': ').trim() });
                }
            });
            return { title, imageUrls: [], fields };
        });
    };

    const handleRetryExtraction = (currentData: CardDataInput, checkedState: Record<string, boolean>) => {
        const confirmedData: CardDataInput = {};
        const fieldsToReExtract: Array<keyof CardDataInput> = [];
        const allPossibleFields: (keyof CardDataInput)[] = ['companyName', 'name', 'furigana', 'department', 'title', 'zipCode', 'address', 'tel', 'mobileTel', 'fax', 'email', 'website', 'sns', 'otherTel', 'notes', 'tags'];
        
        allPossibleFields.forEach(key => {
            if (checkedState[key]) {
                (confirmedData as any)[key] = currentData[key];
            } else {
                fieldsToReExtract.push(key);
            }
        });

        if (fieldsToReExtract.length > 0) {
             setExtractionState({ confirmedData, fieldsToReExtract, previousCheckedFields: checkedState });
        } else {
             setExtractionState(null);
        }
        navigateTo('add');
    };
    
    const handleCreateManualCard = () => {
        setEditingCard(null);
        setImagesToConfirm(null);
        clearExtractionState();
        navigateTo('confirm');
    };
    
    const promptForClassification = (card: CardForClassification) => {
        setCardForClassification(card);
    };
    const cancelClassification = () => {
        setCardForClassification(null);
    }

    const clearExtractionState = () => setExtractionState(null);

    const handleAnalyzeCard = async (card: CardData) => {
        setIsAnalyzing(true);
        setAiAnalysisResult(null);
        try {
            const result = await callApiProxy('analyzeCard', {
                companyName: card.companyName,
                website: card.website,
                title: card.title,
                address: card.address,
            });
            setAiAnalysisResult(result);
        } catch (error) {
            console.error("AI analysis failed", error);
            alert("AI分析に失敗しました。");
        } finally {
            setIsAnalyzing(false);
        }
    };
    
    // --- Handlers for New Policy Analysis ---
    const handleStartNewAnalysis = () => {
        setCurrentPolicyAnalysis({ images: [], fields: [], isAnalyzing: false, error: null });
        navigateTo('analysisTool');
    };

    const handleAddImageToAnalysis = async (image: string) => {
        if (!currentPolicyAnalysis) return;

        const newImages = [...currentPolicyAnalysis.images, image];
        setCurrentPolicyAnalysis({ ...currentPolicyAnalysis, images: newImages, isAnalyzing: true, error: null });
        navigateTo('dynamicAnalysis');

        try {
            const result = await callApiProxy('analyzePolicy', {
                images: newImages,
            });
            const newFields = result.map((field: { key: string; value: string }, index: number) => ({
                id: Date.now() + index, ...field
            }));
            setCurrentPolicyAnalysis({ images: newImages, fields: newFields, isAnalyzing: false, error: null });
        } catch (err) {
            console.error("Error analyzing policy:", err);
            setCurrentPolicyAnalysis(prev => prev ? { ...prev, isAnalyzing: false, error: "情報の抽出に失敗しました。" } : null);
        }
    };
    
    const handleSaveCurrentAnalysis = (title: string) => {
        if (!currentPolicyAnalysis || currentPolicyAnalysis.images.length === 0) return;
        const newPolicy: PolicyData = {
            id: Date.now(),
            title: title || `無題の分析 - ${new Date().toLocaleString()}`,
            imageUrls: currentPolicyAnalysis.images,
            fields: currentPolicyAnalysis.fields,
        };
        updatePolicies([...policies, newPolicy]);
        setCurrentPolicyAnalysis(null);
        setHistory(['main', 'analysisList']);
    };
    
    const cancelCurrentAnalysis = () => {
        if(window.confirm('現在の分析を中止しますか？撮影した画像や抽出したデータは保存されません。')) {
            setCurrentPolicyAnalysis(null);
            goBack();
        }
    };
    
    const handleUpdatePolicy = (updatedPolicy: PolicyData) => {
        updatePolicies(policies.map(p => p.id === updatedPolicy.id ? updatedPolicy : p));
        goBack();
    };

    const handleDeletePolicy = (policyId: number) => {
        if (window.confirm('この証券分析データを本当に削除しますか？')) {
            updatePolicies(policies.filter(p => p.id !== policyId));
            goBack();
        }
    };
    
    const handleSelectPolicy = (id: number) => {
        setSelectedPolicyId(id);
        const newRecent = [id, ...recentPolicyIds.filter(recentId => recentId !== id)].slice(0, 15);
        updateRecentPolicies(newRecent);
        navigateTo('policyDetail');
    };

    const selectedCard = cards.find(c => c.id === selectedCardId);
    const allTags = Array.from(new Set(cards.flatMap(c => c.tags || []))).sort();

    const value = {
        view, history, navigateTo, goBack,
        imagesToConfirm,
        cards,
        selectedCardId,
        editingCard,
        memos,
        searchTerm, setSearchTerm,
        allTags,
        activeTagFilter, setActiveTagFilter,
        activeClassificationFilter, setActiveClassificationFilter,
        handleConfirmImages,
        handleSaveCard,
        handleUpdateCard,
        handleDeleteCard,
        handleSelectCard,
        handleSaveMemos,
        handleImportData,
        startRecordingOnCall, setStartRecordingOnCall,
        selectedCardPhoneNumber, setSelectedCardPhoneNumber,
        selectedCard,
        recentCardIds,
        extractionState,
        handleRetryExtraction,
        clearExtractionState,
        handleCreateManualCard,
        cardForClassification, promptForClassification, cancelClassification,
        aiAnalysisResult, isAnalyzing, handleAnalyzeCard,
        policies, selectedPolicyId, recentPolicyIds,
        handleUpdatePolicy, handleDeletePolicy, handleSelectPolicy,
        currentPolicyAnalysis, handleStartNewAnalysis, handleAddImageToAnalysis,
        handleSaveCurrentAnalysis, cancelCurrentAnalysis,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// --- Screen Components ---

const MainScreen: FC = () => {
    const { navigateTo, searchTerm, setSearchTerm, clearExtractionState, handleCreateManualCard, handleStartNewAnalysis, handleImportData } = useAppContext();
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const handleSearch = () => {
        if(searchTerm.trim()){
            navigateTo('list');
        }
    }

    const onImportClick = () => {
        fileInputRef.current?.click();
    };

    const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImportData(file);
        }
        // Reset file input to allow selecting the same file again
        e.target.value = '';
    };

    return (
        <div className="main-screen-container">
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                onChange={onFileSelected}
                accept=".csv, .txt"
            />
            <div className="search-bar-main">
                <input
                    type="text"
                    placeholder="名刺をフリーワード検索..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    aria-label="名刺をフリーワード検索"
                />
                <button onClick={handleSearch}>検索</button>
            </div>
            
            <div className="main-sections-grid">
                <div className="main-section">
                    <h3 className="section-title"><span className="section-icon">📇</span> 名刺管理</h3>
                    <div className="section-main-actions">
                        <button className="section-action-button primary" onClick={() => { clearExtractionState(); navigateTo('add'); }}>
                            <span className="button-icon-large">📷</span>
                            <span>スキャンして追加</span>
                        </button>
                        <button className="section-action-button" onClick={() => { setSearchTerm(''); navigateTo('list'); }}>
                             <span className="button-icon-large">📄</span>
                            <span>名刺一覧</span>
                        </button>
                    </div>
                    <div className="section-sub-actions">
                        <button onClick={handleCreateManualCard}><span>✍️</span> 手動作成</button>
                        <button onClick={onImportClick}><span>📥</span> インポート</button>
                        <button onClick={() => navigateTo('recent')}><span>🕒</span> 最近の履歴</button>
                    </div>
                </div>

                <div className="main-section">
                     <h3 className="section-title"><span className="section-icon">💼</span> 営業支援ツール</h3>
                     <div className="section-main-actions">
                        <button className="section-action-button primary support" onClick={handleStartNewAnalysis}>
                            <span className="button-icon-large">📑</span>
                            <span>書類を分析</span>
                        </button>
                         <button className="section-action-button" onClick={() => navigateTo('analysisList')}>
                            <span className="button-icon-large">📜</span>
                            <span>分析一覧</span>
                        </button>
                        <button className="section-action-button" onClick={() => navigateTo('excelIntegration')}>
                            <span className="button-icon-large">🔄</span>
                            <span>Excel連携</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CardListScreen: FC = () => {
    const { cards, handleSelectCard, searchTerm, goBack, allTags, activeTagFilter, setActiveTagFilter, activeClassificationFilter, setActiveClassificationFilter } = useAppContext();
    const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);
    const [selectedForExport, setSelectedForExport] = useState<Set<number>>(new Set());
    const [showExportModal, setShowExportModal] = useState(false);

    const filteredCards = cards.filter(card => {
        const effectiveSearchTerm = localSearchTerm || searchTerm;
        const searchMatch = (() => {
            if (!effectiveSearchTerm.trim()) return true;
            const term = effectiveSearchTerm.toLowerCase();
            const cardContent = [
                card.companyName, card.name, card.furigana, card.department,
                card.title, card.zipCode, card.address, card.tel,
                card.mobileTel, card.fax, card.email, card.otherTel, card.notes,
                card.classification,
                Array.isArray(card.website) ? card.website.join(' ') : card.website,
                Array.isArray(card.sns) ? card.sns.join(' ') : card.sns,
                ...(Array.isArray(card.tags) ? card.tags : (typeof (card.tags as any) === 'string' ? (card.tags as any).split(',') : [])),
                ...(card.customFields?.flatMap(f => [f.key, f.value]) || [])
            ].join(' ').toLowerCase();
            
            return cardContent.includes(term);
        })();

        const tagMatch = (() => {
            if (!activeTagFilter) {
                return true;
            }
            if (!card.tags) {
                return false;
            }
            if (Array.isArray(card.tags)) {
                return card.tags.includes(activeTagFilter);
            }
            if (typeof (card.tags as any) === 'string') {
                return (card.tags as any).split(',').map((t: string) => t.trim()).includes(activeTagFilter);
            }
            return false;
        })();
        
        const classificationMatch = !activeClassificationFilter || card.classification === activeClassificationFilter;

        return searchMatch && tagMatch && classificationMatch;
    });

    const handleExportSelect = (cardId: number) => {
        setSelectedForExport(prev => {
            const newSet = new Set(prev);
            if (newSet.has(cardId)) {
                newSet.delete(cardId);
            } else {
                newSet.add(cardId);
            }
            return newSet;
        });
    };
    
    const handleExport = (format: 'csv' | 'txt' | 'xlsx') => {
        const cardsToExport = cards.filter(c => selectedForExport.has(c.id));
        if (cardsToExport.length === 0) {
            alert("エクスポートする名刺を選択してください。");
            return;
        }

        let content = '';
        let mimeType = '';
        let filename = `business_cards_${new Date().toISOString().split('T')[0]}`;
        
        if (format === 'xlsx') {
            const header = ['id', 'companyName', 'name', 'furigana', 'department', 'title', 'zipCode', 'address', 'tel', 'mobileTel', 'fax', 'email', 'website', 'sns', 'otherTel', 'notes', 'tags', 'classification', 'customFields'];
            const dataForSheet = cardsToExport.map(card => {
                const row: Record<string, any> = {};
                header.forEach(key => {
                    let value = (card as any)[key];
                    if (key === 'customFields' && Array.isArray(value)) {
                        row[key] = value.map(f => `${f.key}:${f.value}`).join(';');
                    } else if (Array.isArray(value)) {
                        row[key] = value.join(';');
                    } else if (value !== null && value !== undefined) {
                        row[key] = value;
                    } else {
                        row[key] = '';
                    }
                });
                return row;
            });
    
            const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '名刺データ');
            
            const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setShowExportModal(false);
            return;
        }

        if (format === 'csv') {
            const header = ['id', 'companyName', 'name', 'furigana', 'department', 'title', 'zipCode', 'address', 'tel', 'mobileTel', 'fax', 'email', 'website', 'sns', 'otherTel', 'notes', 'tags', 'classification', 'customFields'];
            const rows = cardsToExport.map(card => {
                const row = header.map(key => {
                    let value = (card as any)[key];
                    if (key === 'customFields' && Array.isArray(value)) {
                        return formatCsvField(value.map(f => `${f.key}:${f.value}`).join(';'));
                    }
                    if (Array.isArray(value)) {
                        return formatCsvField(value.join(';'));
                    }
                    return formatCsvField(value);
                });
                return row.join(',');
            });
            content = [header.join(','), ...rows].join('\n');
            mimeType = 'text/csv;charset=utf-8;';
            filename = `${filename}.csv`;
        } else { // txt
            content = cardsToExport.map(card => {
                return `--- Business Card ---\n` +
                    Object.entries(card).map(([key, value]) => {
                        if (value === null || value === undefined || value === '') return null;
                         if (Array.isArray(value)) {
                            if (value.length === 0) return null;
                            if (key === 'customFields') {
                                return `customFields: ${value.map(f => `${f.key}:${f.value}`).join(';')}`;
                            }
                            return `${key}: ${value.join(', ')}`;
                        }
                        return `${key}: ${value}`;
                    }).filter(Boolean).join('\n') +
                    `\n---------------------\n`;
            }).join('\n');
            mimeType = 'text/plain;charset=utf-8;';
            filename = `${filename}.txt`;
        }
        
        const blob = new Blob(['\uFEFF' + content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportModal(false);
    };

    return (
        <div className="card-list-screen">
            <h2>名刺一覧</h2>
             <div className="list-controls">
                <input
                    type="text"
                    className="search-bar-list"
                    placeholder="さらに絞り込み..."
                    value={localSearchTerm}
                    onChange={(e) => setLocalSearchTerm(e.target.value)}
                    aria-label="名刺を検索"
                />
                <button
                    className="control-button primary"
                    onClick={() => setShowExportModal(true)}
                    disabled={selectedForExport.size === 0}
                >
                    エクスポート
                </button>
            </div>
            <div className="classification-filters">
                <button 
                    className={`classification-filter-button ${!activeClassificationFilter ? 'active' : ''}`}
                    onClick={() => setActiveClassificationFilter(null)}
                >
                    すべて
                </button>
                {classifications.map(c => (
                    <button 
                        key={c}
                        className={`classification-filter-button ${activeClassificationFilter === c ? 'active' : ''}`}
                        onClick={() => setActiveClassificationFilter(c)}
                    >
                        {c}
                    </button>
                ))}
            </div>
            {allTags.length > 0 && (
                <div className="tag-filters">
                    <button 
                        className={`tag-filter-button ${!activeTagFilter ? 'active' : ''}`}
                        onClick={() => setActiveTagFilter(null)}
                    >
                        すべて
                    </button>
                    {allTags.map(tag => (
                        <button 
                            key={tag}
                            className={`tag-filter-button ${activeTagFilter === tag ? 'active' : ''}`}
                            onClick={() => setActiveTagFilter(tag)}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            )}
            {cards.length === 0 ? (
                <div className="placeholder-screen">
                    <p>まだ名刺が登録されていません。「名刺追加」から新しい名刺を登録してください。</p>
                </div>
            ) : (
                <div className="card-list">
                    {filteredCards.map(card => (
                        <div key={card.id} className="card-list-item-container" onClick={() => handleSelectCard(card.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSelectCard(card.id)}>
                            <label className="export-checkbox-label" aria-label={`Select ${card.name} for export`} onClick={e => e.stopPropagation()}>
                                <input 
                                    type="checkbox" 
                                    checked={selectedForExport.has(card.id)} 
                                    onChange={() => handleExportSelect(card.id)}
                                />
                            </label>
                            <div className="card-list-item">
                                <div className="card-item-company">{card.companyName || '会社名未登録'}</div>
                                <div className="card-item-name">{card.name || '氏名未登録'}</div>
                                <div className="card-item-meta">
                                    {card.classification && <span className="classification-tag">{card.classification}</span>}
                                    {card.tags && card.tags.length > 0 && (
                                        <div className="tag-container">
                                            {card.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {showExportModal && (
                <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>エクスポート形式を選択</h3>
                        <p>{selectedForExport.size}件の名刺をエクスポートします。</p>
                        <div className="export-options">
                            <button className="export-option-button" onClick={() => handleExport('xlsx')}>
                                <span className="export-icon">📊</span>
                                <div className="export-text">
                                    <strong>Excel (.xlsx)</strong>
                                    <span className="export-description">編集やデータ分析に最適</span>
                                </div>
                            </button>
                            <button className="export-option-button" onClick={() => handleExport('csv')}>
                                <span className="export-icon">📄</span>
                                <div className="export-text">
                                    <strong>CSVファイル</strong>
                                    <span className="export-description">他のシステムとの連携に</span>
                                </div>
                            </button>
                            <button className="export-option-button" onClick={() => handleExport('txt')}>
                                <span className="export-icon">📝</span>
                                <div className="export-text">
                                    <strong>テキストファイル</strong>
                                    <span className="export-description">シンプルなバックアップに</span>
                                </div>
                            </button>
                        </div>
                         <button className="modal-close-button" onClick={() => setShowExportModal(false)}>閉じる</button>
                    </div>
                </div>
            )}
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};

const Linkify: FC<{ text?: string }> = ({ text }) => {
    if (!text) return null;

    const urlRegex = /(https?:\/\/[^\s]+)/;
    const phoneRegex = /(0\d{1,4}-\d{1,4}-\d{4}|\b0[789]0-\d{4}-\d{4}\b|\b0\d{9,10}\b)/;
    const splitRegex = new RegExp(`(${urlRegex.source}|${phoneRegex.source})`, 'g');
    
    const parts = text.split(splitRegex).filter(Boolean);

    return (
        <>
            {parts.map((part, index) => {
                if (part.match(urlRegex)) {
                    return <a href={part} target="_blank" rel="noopener noreferrer" key={index}>{part}</a>;
                }
                if (part.match(phoneRegex)) {
                    return <a href={`tel:${part.replace(/-/g, '')}`} key={index}>{part}</a>;
                }
                return <span key={index}>{part}</span>;
            })}
        </>
    );
};

const CardDetailScreen: FC = () => {
    const { selectedCard: card, memos, navigateTo, goBack, setStartRecordingOnCall, setSelectedCardPhoneNumber, handleDeleteCard, handleAnalyzeCard, aiAnalysisResult, isAnalyzing } = useAppContext();
    const [showImages, setShowImages] = useState(false);
    const [openAccordion, setOpenAccordion] = useState<string | null>('needs');

    if (!card) return null;

    const toggleAccordion = (id: string) => {
        setOpenAccordion(openAccordion === id ? null : id);
    };

    const onCall = (phoneNumber: string) => {
        if (window.confirm('通話を開始しますか？')) {
            setSelectedCardPhoneNumber(phoneNumber);
            setStartRecordingOnCall(true);
            navigateTo('memo');
        }
    }

    const onEdit = () => {
        navigateTo('confirm'); 
    }
    
    const cardMemos = memos[card.id] || [];
    const lastMemo = cardMemos.length > 0 ? cardMemos.sort((a,b) => b.id - a.id)[0] : null;

    const renderDetailItem = (label: string, value?: string | React.ReactNode, type: 'text' | 'tel' | 'email' = 'text') => {
        if (!value) return null;
        let content;
        if (typeof value === 'string') {
            switch (type) {
                case 'tel': 
                    content = <a href="#" onClick={(e) => { e.preventDefault(); onCall(value); }}>{value}</a>; 
                    break;
                case 'email': content = <a href={`mailto:${value}`}>{value}</a>; break;
                default: content = <span>{value}</span>;
            }
        } else {
            content = value;
        }

        return (
            <div className="detail-item">
                <span className="detail-label">{label}</span>
                <span className="detail-value">{content}</span>
            </div>
        );
    };

    const renderListItem = (label: string, items?: string[]) => {
        if (!items || items.length === 0) return null;
        
        const content = (
            <div className="detail-value-list">
                {items.map((site, index) => {
                    const href = site.startsWith('http://') || site.startsWith('https://') ? site : `https://${site}`;
                    return (
                        <div key={index} className="detail-list-item">
                            <span className="list-item-number">{index + 1}.</span>
                            <a href={href} target="_blank" rel="noopener noreferrer">{site}</a>
                        </div>
                    );
                })}
            </div>
        );
        return renderDetailItem(label, content);
    };

    return (
        <div className="card-detail-screen">
            <h2>名刺詳細</h2>
            <div className="card-details-container">
                <div className="card-details">
                    {renderDetailItem('会社名', card.companyName)}
                    {renderDetailItem('氏名', card.name)}
                    {renderDetailItem('フリガナ', card.furigana)}
                    {renderDetailItem('分類', card.classification && <span className="classification-tag detail">{card.classification}</span>)}
                    {renderDetailItem('部署', card.department)}
                    {renderDetailItem('役職', card.title)}
                    {card.tags && card.tags.length > 0 && renderDetailItem('タグ', (
                        <div className="tag-container">
                            {card.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                        </div>
                    ))}
                    {renderDetailItem('郵便番号', card.zipCode)}
                    {renderDetailItem('住所', card.address)}
                    {renderDetailItem('電話番号', card.tel, 'tel')}
                    {renderDetailItem('携帯番号', card.mobileTel, 'tel')}
                    {renderDetailItem('FAX', card.fax)}
                    {renderDetailItem('Email', card.email, 'email')}
                    {renderListItem('Webサイト', Array.isArray(card.website) ? card.website : (card.website ? [card.website] : []))}
                    {renderListItem('SNS', Array.isArray(card.sns) ? card.sns : (card.sns ? [card.sns] : []))}
                    {renderDetailItem('その他電話番号', <Linkify text={card.otherTel} />)}
                    {renderDetailItem('備考', <Linkify text={card.notes} />)}
                     {card.customFields && card.customFields.map((field, index) => renderDetailItem(field.key, field.value))}
                </div>
                 <div className="card-images-container">
                    {showImages ? (
                        <>
                            {card.imageUrl && (
                                <div className="card-image-wrapper">
                                    <p className="image-label">表面</p>
                                    <img src={card.imageUrl} alt="名刺画像（表面）" className="card-image" />
                                </div>
                            )}
                            {card.imageUrlBack && (
                                <div className="card-image-wrapper">
                                     <p className="image-label">裏面</p>
                                     <img src={card.imageUrlBack} alt="名刺画像（裏面）" className="card-image" />
                                </div>
                            )}
                            <button className="control-button" onClick={() => setShowImages(false)}>写真を隠す</button>
                        </>
                    ) : (
                        (card.imageUrl || card.imageUrlBack) && (
                            <button className="control-button" onClick={() => setShowImages(true)}>写真を確認</button>
                        )
                    )}
                </div>
            </div>

            <div className="contact-history-section">
                <h4><span className="section-icon">📞</span>顧客との接点履歴</h4>
                <div className="history-content">
                    <p>保存された通話メモ: {cardMemos.length}件</p>
                    {lastMemo && <p className="last-contact">最終接触日: {lastMemo.timestamp}</p>}
                </div>
                <button className="control-button" onClick={() => navigateTo('memo')}>メモを確認・追加</button>
            </div>
            
            {isAnalyzing && (
                <div className="loading-container" style={{ margin: '20px 0' }}>
                    <div className="spinner"></div>
                    <p>AIが営業サポート情報を分析中...</p>
                </div>
            )}
            {aiAnalysisResult && (
                <div className="ai-analysis-container">
                    <h3><span className="section-icon">✨</span>AI営業サポート</h3>
                    <div className="accordion-item">
                        <button className="accordion-header" onClick={() => toggleAccordion('needs')} aria-expanded={openAccordion === 'needs'}>
                            保険ニーズ分析
                            <span className={`accordion-icon ${openAccordion === 'needs' ? 'open' : ''}`}>▼</span>
                        </button>
                        {openAccordion === 'needs' && (
                            <div className="accordion-content">
                                <ul>
                                    {aiAnalysisResult.insuranceNeeds.map((item, index) => (
                                        <li key={index}><strong>{item.need}</strong>: {item.reason}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {aiAnalysisResult.disasterRisk && (
                        <div className="accordion-item">
                            <button className="accordion-header" onClick={() => toggleAccordion('risk')} aria-expanded={openAccordion === 'risk'}>
                                地域別の災害リスク
                                <span className={`accordion-icon ${openAccordion === 'risk' ? 'open' : ''}`}>▼</span>
                            </button>
                            {openAccordion === 'risk' && (
                                <div className="accordion-content">
                                    <p><strong>リスクの種類:</strong> {aiAnalysisResult.disasterRisk.riskType}</p>
                                    <p><strong>リスクレベル:</strong> <span className={`risk-level risk-${(aiAnalysisResult.disasterRisk.level || 'default').toLowerCase()}`}>{aiAnalysisResult.disasterRisk.level}</span></p>
                                    <p>{aiAnalysisResult.disasterRisk.details}</p>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {aiAnalysisResult.approachStrategy && (
                        <div className="accordion-item">
                            <button className="accordion-header" onClick={() => toggleAccordion('approach')} aria-expanded={openAccordion === 'approach'}>
                                アプローチ戦略
                                <span className={`accordion-icon ${openAccordion === 'approach' ? 'open' : ''}`}>▼</span>
                            </button>
                            {openAccordion === 'approach' && (
                                <div className="accordion-content">
                                    <h4>役職に応じた提案ヒント</h4>
                                    <ul>
                                        {aiAnalysisResult.approachStrategy.titleBasedHints.map((hint, index) => <li key={index}>{hint}</li>)}
                                    </ul>
                                    <h4>提案テンプレート</h4>
                                    <pre className="proposal-template">{aiAnalysisResult.approachStrategy.proposalTemplate}</pre>
                                </div>
                            )}
                        </div>
                    )}

                    {aiAnalysisResult.marketInfo && (
                         <div className="accordion-item">
                            <button className="accordion-header" onClick={() => toggleAccordion('market')} aria-expanded={openAccordion === 'market'}>
                                市場動向・競合情報 (by Google Search)
                                <span className={`accordion-icon ${openAccordion === 'market' ? 'open' : ''}`}>▼</span>
                            </button>
                            {openAccordion === 'market' && (
                                <div className="accordion-content">
                                    <p className="market-content">{aiAnalysisResult.marketInfo.content}</p>
                                    {aiAnalysisResult.marketInfo.sources.length > 0 && (
                                        <div className="market-sources">
                                            <h4>情報源</h4>
                                            <ul>
                                                {aiAnalysisResult.marketInfo.sources.map((source, index) => (
                                                    <li key={index}><a href={source.uri} target="_blank" rel="noopener noreferrer">{source.title || source.uri}</a></li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="detail-actions">
                <button className="control-button ai-support-button" onClick={() => handleAnalyzeCard(card)} disabled={isAnalyzing}>
                    {aiAnalysisResult ? 'AIサポート再生成' : 'AI営業サポート'}
                    <span className="beta-tag">β版</span>
                </button>
                <button className="control-button primary" onClick={onEdit}>編集</button>
                <button className="control-button" onClick={() => navigateTo('memo')}>メモ</button>
                <button className="control-button delete" onClick={() => handleDeleteCard(card.id)}>削除</button>
            </div>
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};

const RecentHistoryScreen: FC = () => {
    const { 
        cards, handleSelectCard, recentCardIds, 
        policies, handleSelectPolicy, recentPolicyIds, 
        goBack 
    } = useAppContext();
    const [activeTab, setActiveTab] = useState<'cards' | 'policies'>('cards');

    const recentCards = recentCardIds
        .map(id => cards.find(c => c.id === id))
        .filter((c?: CardData): c is CardData => !!c);

    const recentPolicies = recentPolicyIds
        .map(id => policies.find(p => p.id === id))
        .filter((p?: PolicyData): p is PolicyData => !!p);

    return (
        <div className="card-list-screen">
            <h2>最近の履歴</h2>
            
            <div className="tab-nav">
                <button 
                    className={`tab-nav-button ${activeTab === 'cards' ? 'active' : ''}`}
                    onClick={() => setActiveTab('cards')}
                >
                    名刺
                </button>
                <button 
                    className={`tab-nav-button ${activeTab === 'policies' ? 'active' : ''}`}
                    onClick={() => setActiveTab('policies')}
                >
                    分析データ
                </button>
            </div>

            {activeTab === 'cards' && (
                recentCards.length > 0 ? (
                    <div className="card-list">
                        {recentCards.map(card => (
                            <div key={card.id} className="card-list-item-container simple" onClick={() => handleSelectCard(card.id)} role="button">
                                <div className="card-list-item">
                                    <div className="card-item-company">{card.companyName || '会社名未登録'}</div>
                                    <div className="card-item-name">{card.name || '氏名未登録'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="placeholder-screen">
                        <p>名刺の閲覧履歴はありません。</p>
                    </div>
                )
            )}

            {activeTab === 'policies' && (
                recentPolicies.length > 0 ? (
                     <div className="card-list">
                        {recentPolicies.map(policy => (
                            <div key={policy.id} className="card-list-item-container simple" onClick={() => handleSelectPolicy(policy.id)} role="button">
                                <div className="card-list-item">
                                    <div className="card-item-name">{policy.title}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="placeholder-screen">
                         <p>分析データの閲覧履歴はありません。</p>
                    </div>
                )
            )}

            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
}

// --- START: Added Components ---

const AddCardScreen: FC = () => {
    const { goBack, handleConfirmImages } = useAppContext();
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [frontImage, setFrontImage] = useState<string | null>(null);
    const [backImage, setBackImage] = useState<string | null>(null);
    const [capturing, setCapturing] = useState<'front' | 'back' | null>(null);
    const html5QrcodeRef = useRef<any>(null);
    const videoRef = useRef<HTMLDivElement>(null);

    const startCamera = async () => {
        if (!videoRef.current) return;
        try {
            const html5Qrcode = new Html5Qrcode(videoRef.current.id);
            html5QrcodeRef.current = html5Qrcode;
            await html5Qrcode.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 400, height: 225 } },
                () => {}, () => {}
            );
            setIsCameraActive(true);
        } catch (err) {
            console.error("Camera start failed:", err);
            alert("カメラの起動に失敗しました。カメラの権限が許可されているか確認してください。");
        }
    };

    const stopCamera = () => {
        if (html5QrcodeRef.current && isCameraActive) {
            html5QrcodeRef.current.stop().then(() => {
                setIsCameraActive(false);
                html5QrcodeRef.current = null;
            }).catch((err: any) => console.error("Camera stop failed", err));
        }
    };

    useEffect(() => {
        if (capturing) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [capturing]);

    const handleCapture = () => {
        if (!html5QrcodeRef.current || !isCameraActive) return;
        const videoElement = document.getElementById(videoRef.current!.id)?.querySelector('video');
        if (videoElement) {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            canvas.getContext('2d')?.drawImage(videoElement, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg');
            if (capturing === 'front') setFrontImage(dataUrl);
            if (capturing === 'back') setBackImage(dataUrl);
            setCapturing(null);
        }
    };
    
    const onConfirm = () => {
        if (!frontImage && !backImage) {
            alert('少なくとも1枚の画像を撮影してください。');
            return;
        }
        handleConfirmImages({ front: frontImage, back: backImage });
    };

    if (capturing) {
        return (
            <div className="add-card-screen capturing-view">
                <p className="description-text">{capturing === 'front' ? '名刺の表面を枠に合わせてください' : '名刺の裏面を枠に合わせてください'}</p>
                <div className="camera-container">
                    <div id="camera-feed-container" ref={videoRef} className="camera-feed"></div>
                    <div className="camera-overlay"></div>
                </div>
                <div className="camera-controls">
                    <button className="control-button primary" onClick={handleCapture}>撮影</button>
                    <button className="control-button" onClick={() => setCapturing(null)}>キャンセル</button>
                </div>
                <div className="privacy-notice">
                    <span className="privacy-icon">ℹ️</span>
                    <span>撮影された画像は暗号化され、安全にサーバーへ送信されます。データ抽出後に画像はサーバーから削除されます。</span>
                </div>
            </div>
        );
    }

    return (
        <div className="add-card-screen">
            <p className="description-text">名刺の表と裏をスキャンします。</p>
            <div className="capture-preview-area">
                <div className="capture-slot">
                    <p>表面</p>
                    {frontImage ? <img src={frontImage} alt="Front Preview" /> : <div className="placeholder-img">📷</div>}
                    <button className="control-button secondary" onClick={() => setCapturing('front')}>表面を撮影</button>
                </div>
                <div className="capture-slot">
                    <p>裏面</p>
                    {backImage ? <img src={backImage} alt="Back Preview" /> : <div className="placeholder-img">📷</div>}
                    <button className="control-button secondary" onClick={() => setCapturing('back')}>裏面を撮影</button>
                </div>
            </div>
            <div className="add-card-controls">
                 <button className="control-button primary" onClick={onConfirm} disabled={!frontImage && !backImage}>
                    AIで読み取り
                </button>
            </div>
             <div className="privacy-notice">
                <span className="privacy-icon">ℹ️</span>
                <span>撮影された画像は暗号化され、安全にサーバーへ送信されます。データ抽出後に画像はサーバーから削除されます。</span>
            </div>
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};

const ConfirmCardScreen: FC = () => {
    const { imagesToConfirm, editingCard, goBack, handleSaveCard, handleUpdateCard, extractionState, clearExtractionState, handleRetryExtraction, promptForClassification, cardForClassification, cancelClassification } = useAppContext();
    const [cardData, setCardData] = useState<CardDataInput>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [customFields, setCustomFields] = useState<CustomField[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [checkedFields, setCheckedFields] = useState<Record<string, boolean>>({});
    const isEditing = !!editingCard;

    useEffect(() => {
        const performExtraction = async (images: ImagesToConfirm, state?: ExtractionState) => {
            setIsLoading(true);
            setError(null);
            try {
                const payload: any = {
                    frontImage: images.front,
                    backImage: images.back,
                };
                let task = 'extractInfo';

                if (state) {
                    task = 'reExtractInfo';
                    payload.fieldsToReExtract = state.fieldsToReExtract;
                }
                
                const result = await callApiProxy(task, payload);
                
                const newData = state ? { ...state.confirmedData, ...result } : result;
                
                setCardData(newData);
                setCustomFields(newData.customFields || []);
                setTags(newData.tags || []);
                
                if (state?.previousCheckedFields) {
                    setCheckedFields(state.previousCheckedFields);
                }

            } catch (err: any) {
                setError(`情報の抽出に失敗しました: ${err.message}`);
            } finally {
                setIsLoading(false);
                clearExtractionState();
            }
        };

        if (isEditing) {
            setCardData(editingCard);
            setCustomFields(editingCard.customFields || []);
            setTags(editingCard.tags || []);
            setIsLoading(false);
        } else if (imagesToConfirm) {
            performExtraction(imagesToConfirm, extractionState || undefined);
        } else { // Manual creation
            setCardData({});
            setCustomFields([]);
            setTags([]);
            setIsLoading(false);
        }
    }, [imagesToConfirm, editingCard, extractionState]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setCardData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTags(e.target.value.split(',').map(t => t.trim()));
    }

    const handleCustomFieldChange = (index: number, field: 'key' | 'value', value: string) => {
        const newFields = [...customFields];
        newFields[index][field] = value;
        setCustomFields(newFields);
    };

    const addCustomField = () => {
        setCustomFields([...customFields, { key: '', value: '' }]);
    };

    const removeCustomField = (index: number) => {
        setCustomFields(customFields.filter((_, i) => i !== index));
    };

    const onSave = () => {
        const finalCardData = { ...cardData, customFields, tags };
        if(isEditing && editingCard) {
            promptForClassification({ data: finalCardData, images: null, isEditing: true, editingId: editingCard.id });
        } else {
            promptForClassification({ data: finalCardData, images: imagesToConfirm, isEditing: false });
        }
    };
    
    const onClassificationConfirm = (classification: string) => {
        if (!cardForClassification) return;
        const finalData = { ...cardForClassification.data, classification };
        if (cardForClassification.isEditing && cardForClassification.editingId) {
            handleUpdateCard({ ...finalData, id: cardForClassification.editingId, imageUrl: editingCard?.imageUrl || null, imageUrlBack: editingCard?.imageUrlBack || null });
        } else {
            handleSaveCard(finalData);
        }
    };
    
    const onRetry = () => {
        handleRetryExtraction(cardData, checkedFields);
    }
    
    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = e.target;
        setCheckedFields(prev => ({ ...prev, [name]: checked }));
    };

    const renderField = (key: keyof CardDataInput, label: string) => (
        <div className="form-group">
            {!isEditing && (
                <input
                    type="checkbox"
                    name={key}
                    className="field-checkbox"
                    checked={checkedFields[key] || false}
                    onChange={handleCheckboxChange}
                    aria-label={`Confirm ${label}`}
                />
            )}
            <label htmlFor={key}>{label}</label>
            <input
                type="text"
                id={key}
                name={key}
                value={(cardData[key] as string) || ''}
                onChange={handleChange}
            />
        </div>
    );
    
    if (cardForClassification) {
        return (
            <div className="modal-overlay">
                <div className="modal-content">
                    <h3>分類を選択</h3>
                    <p>この名刺をどのカテゴリに分類しますか？</p>
                    <div className="classification-selector">
                        {classifications.map(c => (
                            <button
                                key={c}
                                className={`classification-select-button ${cardForClassification.data.classification === c ? 'active' : ''}`}
                                onClick={() => onClassificationConfirm(c)}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                     <div className="modal-actions">
                        <button className="control-button secondary" onClick={cancelClassification}>キャンセル</button>
                    </div>
                </div>
            </div>
        );
    }
    
    const images = isEditing ? { front: editingCard.imageUrl, back: editingCard.imageUrlBack } : imagesToConfirm;

    return (
        <div className="confirm-card-screen">
            <div className="confirm-content">
                {(images?.front || images?.back) && (
                     <div className={`confirm-preview-container ${images.front && images.back ? 'dual-image' : ''}`}>
                        {images.front && <img src={images.front} alt="Front" className="confirm-preview-image" />}
                        {images.back && <img src={images.back} alt="Back" className="confirm-preview-image" />}
                    </div>
                )}
                <div className={`confirm-form-container ${(images?.front || images?.back) ? '' : 'full-width'}`}>
                    {isLoading ? (
                        <div className="loading-container">
                            <div className="spinner"></div>
                            <p>AIが名刺情報を抽出中...</p>
                        </div>
                    ) : error ? (
                        <div className="error-container">
                            <p>{error}</p>
                            <button className="control-button primary" onClick={goBack}>戻る</button>
                        </div>
                    ) : (
                        <form className="card-data-form" onSubmit={(e) => e.preventDefault()}>
                            {!isEditing && (
                                <div className="form-controls-header">
                                    <label>
                                        <input type="checkbox" onChange={e => setCheckedFields(prev => {
                                            const allChecked = e.target.checked;
                                            const newState: Record<string, boolean> = {};
                                            Object.keys(cardData).forEach(k => newState[k] = allChecked);
                                            return newState;
                                        })} />
                                        すべての項目を承認
                                    </label>
                                    <p className="checkbox-description">AIの抽出結果が正しい項目にチェックを入れてください。チェックされていない項目のみ再抽出を試みます。</p>
                                </div>
                            )}
                            {renderField('companyName', '会社名')}
                            {renderField('name', '氏名')}
                            {renderField('furigana', 'フリガナ')}
                            {renderField('department', '部署')}
                            {renderField('title', '役職')}
                            {renderField('zipCode', '郵便番号')}
                            {renderField('address', '住所')}
                            {renderField('tel', '電話番号')}
                            {renderField('mobileTel', '携帯番号')}
                            {renderField('fax', 'FAX')}
                            {renderField('email', 'Email')}
                            <div className="form-group vertical">
                                <label htmlFor="website">Webサイト (カンマ区切り)</label>
                                <input type="text" id="website" name="website" value={Array.isArray(cardData.website) ? cardData.website.join(',') : (cardData.website || '')} onChange={e => setCardData(prev => ({...prev, website: e.target.value.split(',')}))}/>
                            </div>
                            <div className="form-group vertical">
                                <label htmlFor="sns">SNS (カンマ区切り)</label>
                                <input type="text" id="sns" name="sns" value={Array.isArray(cardData.sns) ? cardData.sns.join(',') : (cardData.sns || '')} onChange={e => setCardData(prev => ({...prev, sns: e.target.value.split(',')}))}/>
                            </div>
                            <div className="form-group vertical">
                                <label htmlFor="otherTel">その他電話番号</label>
                                <textarea id="otherTel" name="otherTel" value={cardData.otherTel || ''} onChange={handleChange} rows={2}></textarea>
                            </div>
                            <div className="form-group vertical">
                                <label htmlFor="notes">備考</label>
                                <textarea id="notes" name="notes" value={cardData.notes || ''} onChange={handleChange} rows={3}></textarea>
                            </div>
                            <div className="form-group vertical">
                                <label htmlFor="tags">タグ (カンマ区切り)</label>
                                <input type="text" id="tags" name="tags" value={tags.join(',')} onChange={handleTagChange} />
                            </div>
                             <h4>カスタム項目</h4>
                            {customFields.map((field, index) => (
                                <div key={index} className="form-group">
                                    <input type="text" placeholder="項目名" value={field.key} onChange={e => handleCustomFieldChange(index, 'key', e.target.value)} />
                                    <input type="text" placeholder="内容" value={field.value} onChange={e => handleCustomFieldChange(index, 'value', e.target.value)} />
                                    <button type="button" onClick={() => removeCustomField(index)} className="delete-field-btn">&times;</button>
                                </div>
                            ))}
                            <button type="button" onClick={addCustomField} className="control-button secondary">カスタム項目を追加</button>
                        </form>
                    )}
                </div>
            </div>
            <div className="confirm-controls">
                {!isEditing && (
                    <button className="control-button secondary" onClick={onRetry} disabled={isLoading}>
                        再抽出
                    </button>
                )}
                 <button className="control-button primary" onClick={onSave} disabled={isLoading}>
                    {isEditing ? '更新' : '保存'}
                </button>
            </div>
            <button className="back-button" onClick={goBack}>
                 {isEditing ? '詳細に戻る' : 'キャンセル'}
            </button>
        </div>
    );
};

const MemoScreen: FC = () => {
    const { selectedCard, memos, handleSaveMemos, goBack, startRecordingOnCall, setStartRecordingOnCall, selectedCardPhoneNumber } = useAppContext();
    const [localMemos, setLocalMemos] = useState<Memo[]>([]);
    const [newMemoContent, setNewMemoContent] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (selectedCard) {
            setLocalMemos(memos[selectedCard.id] || []);
        }
    }, [selectedCard, memos]);

    useEffect(() => {
        if (startRecordingOnCall) {
            handleStartRecording();
            setStartRecordingOnCall(false); // Reset the trigger
        }
    }, [startRecordingOnCall]);
    
    useEffect(() => {
        // Setup SpeechRecognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'ja-JP';

            recognitionRef.current.onresult = (event: any) => {
                let interimTranscript = '';
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                setNewMemoContent(prev => prev + finalTranscript);
            };
            
            recognitionRef.current.onend = () => {
                // If it stops unexpectedly, and we still want to be recording, restart it.
                if (isRecording) {
                    recognitionRef.current.start();
                }
            };
        }
    }, [isRecording]);

    const handleStartRecording = () => {
        if (recognitionRef.current && !isRecording) {
            if (selectedCardPhoneNumber) {
                // Start call
                window.location.href = `tel:${selectedCardPhoneNumber.replace(/-/g, '')}`;
            }
            setIsRecording(true);
            recognitionRef.current.start();
        }
    };

    const handleStopRecording = () => {
        if (recognitionRef.current && isRecording) {
            setIsRecording(false);
            recognitionRef.current.stop();
        }
    };

    const handleSaveMemo = async () => {
        if (!selectedCard || !newMemoContent.trim()) return;
        const timestamp = new Date().toLocaleString('ja-JP');
        let summary;
        try {
            const result = await callApiProxy('summarize', { text: newMemoContent });
            summary = result.summary;
        } catch (e) {
            console.error("Summarization failed", e);
            // Continue without summary if it fails
        }
        
        const newMemo: Memo = {
            id: Date.now(),
            timestamp,
            content: newMemoContent,
            summary,
        };
        const updatedMemos = [...localMemos, newMemo];
        setLocalMemos(updatedMemos);
        handleSaveMemos(selectedCard.id, updatedMemos);
        setNewMemoContent('');
    };

    if (!selectedCard) return null;

    return (
        <div className="memo-screen">
            <h2>{selectedCard.name}様との通話メモ</h2>
            <div className="memo-list">
                {localMemos.length > 0 ? (
                    localMemos.sort((a,b) => b.id - a.id).map(memo => (
                        <div key={memo.id} className="memo-item">
                            <p className="memo-timestamp">{memo.timestamp}</p>
                            {memo.summary && (
                                <div className="memo-summary">
                                    <p className="summary-title"><strong>📝 AIによる要約</strong></p>
                                    <p>{memo.summary}</p>
                                </div>
                            )}
                            <p className="memo-content">{memo.content}</p>
                        </div>
                    ))
                ) : (
                    <p className="no-memos">まだメモはありません。</p>
                )}
            </div>
            <div className="memo-input-area">
                <textarea
                    value={newMemoContent}
                    onChange={(e) => setNewMemoContent(e.target.value)}
                    placeholder={isRecording ? "音声入力中..." : "ここにメモを入力..."}
                    rows={8}
                />
                <div className="memo-controls">
                    <button onClick={handleSaveMemo} className="control-button primary" disabled={!newMemoContent.trim()}>保存</button>
                    {isRecording ? (
                        <button onClick={handleStopRecording} className="control-button recording">
                            <span className="record-indicator"></span>録音停止
                        </button>
                    ) : (
                        <button onClick={handleStartRecording} className="control-button">
                            <span className="mic-icon">🎤</span>録音開始
                        </button>
                    )}
                </div>
            </div>
            <button className="back-button" onClick={goBack}>詳細に戻る</button>
        </div>
    );
};

// --- Analysis Tool Screens ---

const AnalysisToolScreen: FC = () => {
    const { goBack, handleAddImageToAnalysis, cancelCurrentAnalysis } = useAppContext();
    const [isCameraActive, setIsCameraActive] = useState(false);
    const html5QrcodeRef = useRef<any>(null);
    const videoRef = useRef<HTMLDivElement>(null);

    const startCamera = async () => {
        if (!videoRef.current || isCameraActive) return;
        try {
            const html5Qrcode = new Html5Qrcode(videoRef.current.id);
            html5QrcodeRef.current = html5Qrcode;
            await html5Qrcode.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 400, height: 250 } },
                () => {}, () => {}
            );
            setIsCameraActive(true);
        } catch (err) {
            console.error("Camera start failed:", err);
            alert("カメラの起動に失敗しました。カメラの権限が許可されているか確認してください。");
        }
    };

    const stopCamera = () => {
        if (html5QrcodeRef.current && isCameraActive) {
            html5QrcodeRef.current.stop().then(() => {
                setIsCameraActive(false);
                html5QrcodeRef.current = null;
            }).catch((err: any) => console.error("Camera stop failed", err));
        }
    };
    
    useEffect(() => {
        startCamera();
        return () => stopCamera();
    }, []);

    const handleCapture = () => {
        if (!html5QrcodeRef.current || !isCameraActive) return;
        const videoElement = document.getElementById(videoRef.current!.id)?.querySelector('video');
        if (videoElement) {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            canvas.getContext('2d')?.drawImage(videoElement, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg');
            handleAddImageToAnalysis(dataUrl);
            stopCamera();
        }
    };

    return (
        <div className="add-card-screen capturing-view">
            <p className="description-text">分析したい書類を枠に合わせてください。</p>
            <div className="camera-container">
                <div id="camera-feed-container" ref={videoRef} className="camera-feed"></div>
                <div className="camera-overlay"></div>
            </div>
            <div className="camera-controls">
                <button className="control-button primary" onClick={handleCapture}>撮影して分析</button>
            </div>
             <div className="privacy-notice">
                <span className="privacy-icon">ℹ️</span>
                <span>撮影された画像は暗号化され、安全にサーバーへ送信されます。データ抽出後に画像はサーバーから削除されます。</span>
            </div>
            <button className="back-button" onClick={cancelCurrentAnalysis}>分析を中止</button>
        </div>
    );
};

const DynamicAnalysisScreen: FC = () => {
    const { currentPolicyAnalysis, handleAddImageToAnalysis, handleSaveCurrentAnalysis, cancelCurrentAnalysis, goBack } = useAppContext();
    const [analysisTitle, setAnalysisTitle] = useState('');
    
    if (!currentPolicyAnalysis) return null; // Should not happen

    return (
        <div className="dynamic-analysis-screen">
            <h2>分析結果</h2>
            <div className="analysis-content">
                <div className="analysis-images-pane">
                    <h3>分析した画像 ({currentPolicyAnalysis.images.length}枚)</h3>
                    <div className="image-thumbnail-list">
                        {currentPolicyAnalysis.images.map((img, index) => (
                            <img key={index} src={img} alt={`Analyzed image ${index + 1}`} className="thumbnail" />
                        ))}
                    </div>
                </div>
                <div className="analysis-fields-pane">
                    <h3>抽出された情報</h3>
                    {currentPolicyAnalysis.isAnalyzing ? (
                        <div className="loading-container">
                            <div className="spinner"></div>
                            <p>AIが情報を抽出中...</p>
                        </div>
                    ) : currentPolicyAnalysis.error ? (
                        <div className="error-container">{currentPolicyAnalysis.error}</div>
                    ) : (
                        <div className="key-value-list">
                            {currentPolicyAnalysis.fields.map(field => (
                                <div key={field.id} className="key-value-item">
                                    <span className="item-key">{field.key}</span>
                                    <span className="item-value">{field.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="confirm-controls">
                <input
                    type="text"
                    className="form-control"
                    placeholder="分析データのタイトル"
                    value={analysisTitle}
                    onChange={(e) => setAnalysisTitle(e.target.value)}
                    style={{ flexGrow: 2, padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                />
                <button
                    className="control-button primary"
                    onClick={() => handleSaveCurrentAnalysis(analysisTitle)}
                    disabled={currentPolicyAnalysis.isAnalyzing || currentPolicyAnalysis.fields.length === 0}
                >
                    この内容で保存
                </button>
            </div>
            <div className="detail-actions" style={{justifyContent: 'space-between'}}>
                 <button className="control-button secondary" onClick={() => goBack()} disabled={currentPolicyAnalysis.isAnalyzing}>
                    さらに撮影する
                </button>
                <button className="control-button delete" onClick={cancelCurrentAnalysis}>
                    分析を中止
                </button>
            </div>
        </div>
    );
};

const AnalysisListScreen: FC = () => {
    const { policies, handleSelectPolicy, goBack } = useAppContext();

    return (
        <div className="card-list-screen">
            <h2>分析データ一覧</h2>
            {policies.length === 0 ? (
                <div className="placeholder-screen">
                    <p>まだ分析データがありません。「書類を分析」から新しい分析を開始してください。</p>
                </div>
            ) : (
                <div className="card-list">
                    {policies.map(policy => (
                         <div key={policy.id} className="card-list-item-container simple" onClick={() => handleSelectPolicy(policy.id)} role="button">
                            <div className="card-list-item">
                                <div className="card-item-name">{policy.title}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
}

const PolicyDetailScreen: FC = () => {
    const { policies, selectedPolicyId, handleUpdatePolicy, handleDeletePolicy, goBack } = useAppContext();
    const [isEditing, setIsEditing] = useState(false);
    const selectedPolicy = policies.find(p => p.id === selectedPolicyId);
    const [editablePolicy, setEditablePolicy] = useState<PolicyData | null>(JSON.parse(JSON.stringify(selectedPolicy || null)));

    if (!selectedPolicy || !editablePolicy) return null;

    const handleFieldChange = (fieldId: number, key: 'key' | 'value', value: string) => {
        setEditablePolicy(prev => {
            if (!prev) return null;
            return {
                ...prev,
                fields: prev.fields.map(f => f.id === fieldId ? { ...f, [key]: value } : f)
            };
        });
    };
    
    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditablePolicy(prev => prev ? { ...prev, title: e.target.value } : null);
    }

    const addField = () => {
        setEditablePolicy(prev => {
            if (!prev) return null;
            const newField: PolicyField = { id: Date.now(), key: '', value: '' };
            return { ...prev, fields: [...prev.fields, newField] };
        });
    };

    const removeField = (fieldId: number) => {
        setEditablePolicy(prev => prev ? { ...prev, fields: prev.fields.filter(f => f.id !== fieldId) } : null);
    };

    const onSave = () => {
        handleUpdatePolicy(editablePolicy);
        setIsEditing(false);
    };

    const onCancel = () => {
        setEditablePolicy(JSON.parse(JSON.stringify(selectedPolicy)));
        setIsEditing(false);
    };


    return (
        <div className="policy-detail-screen">
             <div className="form-group vertical" style={{marginBottom: '16px'}}>
                <label style={{fontWeight: 'bold'}}>タイトル</label>
                <input
                    type="text"
                    value={editablePolicy.title}
                    onChange={handleTitleChange}
                    readOnly={!isEditing}
                    className="form-control"
                    style={{ fontSize: '1.5rem', fontWeight: 'bold', padding: '8px' }}
                />
            </div>

            <div className="analysis-content">
                <div className="analysis-images-pane">
                    <h3>分析した画像 ({selectedPolicy.imageUrls.length}枚)</h3>
                    <div className="image-thumbnail-list">
                        {selectedPolicy.imageUrls.map((img, index) => (
                            <img key={index} src={img} alt={`Policy image ${index + 1}`} className="thumbnail" />
                        ))}
                    </div>
                </div>
                <div className="analysis-fields-pane">
                    <div className="editable-fields-section">
                        <h3>抽出された情報</h3>
                        {isEditing ? (
                            <div className="editable-key-value-list">
                                {editablePolicy.fields.map(field => (
                                    <div key={field.id} className="editable-key-value-item">
                                        <input
                                            type="text"
                                            placeholder="項目名"
                                            value={field.key}
                                            onChange={(e) => handleFieldChange(field.id, 'key', e.target.value)}
                                            className="key-input"
                                        />
                                        <textarea
                                            placeholder="内容"
                                            value={field.value}
                                            onChange={(e) => handleFieldChange(field.id, 'value', e.target.value)}
                                            className="value-input"
                                            rows={1}
                                        />
                                        <button onClick={() => removeField(field.id)} className="delete-field-btn" aria-label="Delete field">&times;</button>
                                    </div>
                                ))}
                                <button onClick={addField} className="control-button secondary add-field-btn">
                                    <span className="button-icon">➕</span>項目を追加
                                </button>
                            </div>
                        ) : (
                            <div className="key-value-list">
                                {selectedPolicy.fields.map(field => (
                                    <div key={field.id} className="key-value-item">
                                        <span className="item-key">{field.key}</span>
                                        <span className="item-value">{field.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="detail-actions policy-actions">
                <button className="control-button delete" onClick={() => handleDeletePolicy(selectedPolicy.id)}>削除</button>
                <div className="main-actions">
                    {isEditing ? (
                        <>
                            <button className="control-button" onClick={onCancel}>キャンセル</button>
                            <button className="control-button primary" onClick={onSave}>保存</button>
                        </>
                    ) : (
                        <button className="control-button primary" onClick={() => setIsEditing(true)}>編集</button>
                    )}
                </div>
            </div>

            <button className="back-button" onClick={goBack}>一覧に戻る</button>
        </div>
    );
};

const ExcelIntegrationScreen: FC = () => {
    const { goBack, cards, policies } = useAppContext();

    // Step 1 states
    const [originalFile, setOriginalFile] = useState<File | null>(null);
    const [workbook, setWorkbook] = useState<any>(null);
    const [sheetNames, setSheetNames] = useState<string[]>([]);
    const [selectedSheet, setSelectedSheet] = useState<string>('');
    const [startCell, setStartCell] = useState<string>('A1');

    // Step 2 states
    const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
    const [sourceDataType, setSourceDataType] = useState<'cards' | 'policies'>('cards');
    const [sourceHeaders, setSourceHeaders] = useState<string[]>([]);
    const [sourceData, setSourceData] = useState<any[]>([]);
    const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

    // Step 3 states
    const [mappedData, setMappedData] = useState<any[]>([]);

    // General states
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    useEffect(() => {
        let data: any[], headers: Set<string>;
        if (sourceDataType === 'cards') {
            data = cards;
            const headersSet = new Set<string>();
            cards.forEach(card => Object.keys(card).forEach(key => headersSet.add(key)));
            headers = headersSet;
        } else {
             data = policies.map(p => {
                 const flat: any = { id: p.id, title: p.title };
                 p.fields.forEach(f => {
                     if(f.key) flat[f.key] = f.value;
                 });
                 return flat;
             });
            const headersSet = new Set<string>();
            data.forEach(item => Object.keys(item).forEach(key => headersSet.add(key)));
            headers = headersSet;
        }
        setSourceData(data);
        setSourceHeaders(Array.from(headers).sort());
    }, [sourceDataType, cards, policies]);

    const resetState = () => {
        setStep(1);
        setOriginalFile(null);
        setWorkbook(null);
        setSheetNames([]);
        setSelectedSheet('');
        setExcelHeaders([]);
        setColumnMapping({});
        setMappedData([]);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setIsLoading(true);
            setError(null);
            setOriginalFile(file);
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = event.target?.result;
                    const wb = XLSX.read(data, { type: 'array' });
                    setWorkbook(wb);
                    setSheetNames(wb.SheetNames);
                    setSelectedSheet(wb.SheetNames[0]);
                    setIsLoading(false);
                } catch (err: any) {
                    setError(`ファイルの読み込みに失敗しました: ${err.message}`);
                    setIsLoading(false);
                }
            };
            reader.onerror = () => {
                 setError('ファイルの読み込み中にエラーが発生しました。');
                 setIsLoading(false);
            };
            reader.readAsArrayBuffer(file);
        }
    };

    const handleProceedToMapping = () => {
        if (!workbook || !selectedSheet) {
            setError('ファイルとシートを選択してください。');
            return;
        }
        try {
            const ws = workbook.Sheets[selectedSheet];
            const jsonData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", range: startCell });
            
            if (jsonData.length === 0) {
                 setError('選択された範囲にデータが見つかりません。開始セルが正しいか確認してください。');
                 return;
            }
            const headers = jsonData[0].map(String);
            setExcelHeaders(headers);
            setStep(2);
        } catch(err: any) {
            setError(`シートの解析に失敗しました: ${err.message}. 開始セルの形式が正しいか確認してください(例: A1)。`);
        }
    };
    
    const handleAutoMap = async () => {
        setIsLoading(true);
        try {
            const result = await callApiProxy('mapCsvToExcel', {
                csvHeaders: sourceHeaders,
                excelHeaders: excelHeaders,
            });
            const newMapping: Record<string, string> = {};
            excelHeaders.forEach(eh => {
                const foundCsvHeader = Object.keys(result.mapping).find(
                    (csvKey) => result.mapping[csvKey] === eh
                );
                newMapping[eh] = foundCsvHeader || '';
            });
            setColumnMapping(newMapping);

        } catch (err: any) {
            setError('AIによる自動マッピングに失敗しました。');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handlePreview = () => {
        const data = sourceData.map(sourceRow => {
            const newRow: Record<string, any> = {};
            excelHeaders.forEach(excelHeader => {
                const sourceHeader = columnMapping[excelHeader];
                if (sourceHeader && sourceRow[sourceHeader] !== undefined) {
                    const value = sourceRow[sourceHeader];
                    // Handle complex objects like customFields
                    if (Array.isArray(value)) {
                         if (sourceHeader === 'customFields') {
                             newRow[excelHeader] = value.map(cf => `${cf.key}:${cf.value}`).join('; ');
                         } else {
                            newRow[excelHeader] = value.join(', ');
                         }
                    } else {
                        newRow[excelHeader] = value;
                    }
                } else {
                    newRow[excelHeader] = ''; // Fill with empty string if no mapping or data
                }
            });
            return newRow;
        });
        setMappedData(data);
        setStep(3);
    };
    
    const handleDownload = () => {
        if (!mappedData.length) {
            alert('ダウンロードするデータがありません。');
            return;
        }
        // This process creates a clean new file, preventing old data from remaining.
        const newWs = XLSX.utils.json_to_sheet(mappedData, { header: excelHeaders });
        const newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, newWs, selectedSheet || 'Sheet1');
        XLSX.writeFile(newWb, `連携済み_${originalFile?.name || 'data.xlsx'}`);
    };

    const handleAddRow = () => {
        const newRow = excelHeaders.reduce((acc, header) => ({ ...acc, [header]: '' }), {});
        setMappedData(prev => [...prev, newRow]);
    };

    const handleRemoveRow = (index: number) => {
        setMappedData(prev => prev.filter((_, i) => i !== index));
    };

    const handleCellChange = (index: number, header: string, value: string) => {
        setMappedData(prev => prev.map((row, i) => i === index ? { ...row, [header]: value } : row));
    }


    return (
        <div className="excel-integration-screen">
            <h2>Excel連携ツール</h2>

            {error && <div className="error-container" style={{marginBottom: '16px', padding: '10px', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '4px' }}>{error}</div>}

            {step === 1 && (
                <div className="step-container">
                    <h3>Step 1: 元となるExcelファイルをアップロード</h3>
                    <p>データを入力したいExcelのテンプレートファイルをアップロードしてください。</p>
                    <div className="file-upload-area">
                        <div className="file-input-wrapper">
                             <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" />
                             {originalFile && <span className="file-name">{originalFile.name}</span>}
                        </div>
                         <div className="form-group vertical" style={{alignItems: 'flex-start', marginTop: '16px'}}>
                            <label htmlFor="startCell">データ開始セル (任意)</label>
                            <input
                                type="text"
                                id="startCell"
                                value={startCell}
                                onChange={e => setStartCell(e.target.value)}
                                placeholder="例: A1"
                            />
                            <p className="checkbox-description" style={{marginTop: '4px'}}>表のヘッダー行が始まるセルを指定してください。空欄の場合はA1から開始します。</p>
                        </div>
                        {workbook && (
                            <div className="form-group vertical" style={{alignItems: 'flex-start'}}>
                                <label htmlFor="sheet-select">シートを選択</label>
                                <select id="sheet-select" value={selectedSheet} onChange={e => setSelectedSheet(e.target.value)}>
                                    {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                    <div className="step-controls">
                        <button className="control-button primary" onClick={handleProceedToMapping} disabled={!workbook || isLoading}>
                            {isLoading ? <div className="spinner small inline"></div> : '次へ'}
                        </button>
                    </div>
                </div>
            )}
            
            {step >= 2 && (
                 <div className="step-controls space-between">
                    <button className="control-button" onClick={resetState}>最初からやり直す</button>
                 </div>
            )}

            {step === 2 && (
                <div className="step-container">
                    <h3>Step 2: データのマッピング</h3>
                    <p>Excelの列とアプリ内のデータを紐付けます。</p>
                     <div className="form-group vertical" style={{alignItems: 'flex-start'}}>
                        <label>連携するデータソース</label>
                        <select value={sourceDataType} onChange={e => setSourceDataType(e.target.value as 'cards' | 'policies')}>
                            <option value="cards">名刺データ</option>
                            <option value="policies">分析データ</option>
                        </select>
                    </div>
                    <button className="control-button secondary" onClick={handleAutoMap} disabled={isLoading} style={{margin: '16px 0'}}>
                        {isLoading ? 'マッピング中...' : 'AIで自動マッピング'}
                    </button>
                    <div className="integration-table-container" style={{maxHeight: '400px'}}>
                        <table>
                            <thead>
                                <tr><th>Excelの列</th><th>アプリのデータ</th></tr>
                            </thead>
                            <tbody>
                                {excelHeaders.map(header => (
                                    <tr key={header}>
                                        <td>{header}</td>
                                        <td>
                                            <select value={columnMapping[header] || ''} onChange={e => setColumnMapping(prev => ({...prev, [header]: e.target.value}))}>
                                                <option value="">-- 選択しない --</option>
                                                {sourceHeaders.map(sh => <option key={sh} value={sh}>{sh}</option>)}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="step-controls">
                        <button className="control-button primary" onClick={handlePreview}>プレビューに進む</button>
                    </div>
                </div>
            )}
            
             {step === 3 && (
                <div className="step-container">
                    <h3>Step 3: プレビューとダウンロード</h3>
                    <p>内容を確認し、問題なければダウンロードしてください。この画面で直接編集も可能です。</p>
                    <div className="integration-table-container" style={{maxHeight: '500px'}}>
                        <table>
                            <thead>
                                <tr>
                                    {excelHeaders.map(h => <th key={h}>{h}</th>)}
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mappedData.map((row, rowIndex) => (
                                    <tr key={rowIndex}>
                                        {excelHeaders.map(header => (
                                            <td key={header}><input type="text" value={row[header]} onChange={(e) => handleCellChange(rowIndex, header, e.target.value)} className="cell-input" /></td>
                                        ))}
                                        <td><button className="delete-field-btn" onClick={() => handleRemoveRow(rowIndex)}>&times;</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="step-controls space-between" style={{ marginTop: '16px' }}>
                        <div>
                            <button className="control-button secondary" onClick={handleAddRow}><span className="button-icon">➕</span>行を追加</button>
                        </div>
                        <button className="control-button primary" onClick={handleDownload}>ダウンロード</button>
                    </div>
                </div>
            )}
            
            <button className="back-button" onClick={goBack}>メインに戻る</button>
        </div>
    );
};

const App: FC = () => {
    const { view } = useAppContext();
    return (
        <div className="app-container">
            <header className="app-header">
                <h1>AI名刺・営業サポート</h1>
                <span className="app-version">v1.2.0</span>
            </header>
            <main className="content-wrapper">
                 <div className="content-area">
                    {
                        {
                            main: <MainScreen />,
                            list: <CardListScreen />,
                            recent: <RecentHistoryScreen />,
                            add: <AddCardScreen />,
                            confirm: <ConfirmCardScreen />,
                            detail: <CardDetailScreen />,
                            memo: <MemoScreen />,
                            analysisTool: <AnalysisToolScreen />,
                            dynamicAnalysis: <DynamicAnalysisScreen />,
                            policyDetail: <PolicyDetailScreen />,
                            analysisList: <AnalysisListScreen />,
                            excelIntegration: <ExcelIntegrationScreen />,
                        }[view]
                    }
                </div>
            </main>
        </div>
    );
}

const AppWrapper: FC = () => (
    <AppProvider>
        <App />
    </AppProvider>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<AppWrapper />);
