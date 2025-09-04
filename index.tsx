
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
    
    const handleExport = (format: 'csv' | 'txt') => {
        const cardsToExport = cards.filter(c => selectedForExport.has(c.id));
        if (cardsToExport.length === 0) return;

        let content = '';
        let mimeType = '';
        let filename = '';

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
            filename = `business_cards_${new Date().toISOString().split('T')[0]}.csv`;
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
            filename = `business_cards_${new Date().toISOString().split('T')[0]}.txt`;
        }
        
        const blob = new Blob([content], { type: mimeType });
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
                            <button className="control-button primary" onClick={() => handleExport('csv')}>CSVファイル</button>
                            <button className="control-button" onClick={() => handleExport('txt')}>テキストファイル</button>
                        </div>
                         <button className="control-button" style={{marginTop: '16px'}} onClick={() => setShowExportModal(false)}>閉じる</button>
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
                <>
                    {recentCards.length === 0 ? (
                        <div className="placeholder-screen"><p>最近閲覧した名刺はありません。</p></div>
                    ) : (
                        <div className="card-list">
                            {recentCards.map(card => (
                                <div key={card.id} className="card-list-item-container simple" onClick={() => handleSelectCard(card.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSelectCard(card.id)}>
                                   <div className="card-list-item">
                                       <div className="card-item-company">{card.companyName || '会社名未登録'}</div>
                                       <div className="card-item-name">{card.name || '氏名未登録'}</div>
                                   </div>
                               </div>
                           ))}
                        </div>
                    )}
                </>
            )}

            {activeTab === 'policies' && (
                 <>
                    {recentPolicies.length === 0 ? (
                        <div className="placeholder-screen"><p>最近閲覧した分析データはありません。</p></div>
                    ) : (
                        <div className="card-list">
                            {recentPolicies.map(policy => (
                                <div key={policy.id} className="card-list-item-container simple" onClick={() => handleSelectPolicy(policy.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSelectPolicy(policy.id)}>
                                    <div className="card-list-item">
                                        <div className="card-item-company">{policy.title}</div>
                                        <div className="card-item-name">{(policy.fields || []).slice(0, 2).map(f => f.value || '').join(' - ') || '詳細を見る'}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};


const AddCardScreen: FC = () => {
    const { goBack, handleConfirmImages } = useAppContext();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [imageFront, setImageFront] = useState<string | null>(null);
    const [imageBack, setImageBack] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [capturingFor, setCapturingFor] = useState<'front' | 'back' | null>(null);
    
    useEffect(() => {
        const startCamera = async () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
            } catch (error) {
                console.error("Error accessing camera:", error);
                alert("カメラにアクセスできませんでした。");
            }
        };

        if (isCapturing && capturingFor) {
            startCamera();
        } else {
             if (stream) {
                stream.getTracks().forEach(track => track.stop());
                setStream(null);
            }
        }
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [isCapturing, capturingFor]);

    const handleCapture = () => {
        if (!videoRef.current || !capturingFor) return;

        const video = videoRef.current;
        const canvas = document.createElement('canvas');

        const videoRatio = video.videoWidth / video.videoHeight;
        const elemRatio = video.clientWidth / video.clientHeight;
        
        let sWidth = video.videoWidth;
        let sHeight = video.videoHeight;
        let sx = 0;
        let sy = 0;

        if (videoRatio > elemRatio) {
            sWidth = video.videoHeight * elemRatio;
            sx = (video.videoWidth - sWidth) / 2;
        } else {
            sHeight = video.videoWidth / elemRatio;
            sy = (video.videoHeight - sHeight) / 2;
        }

        const cropSx = sx + sWidth * 0.05;
        const cropSy = sy + sHeight * 0.05;
        const cropSWidth = sWidth * 0.9;
        const cropSHeight = sHeight * 0.9;

        canvas.width = cropSWidth;
        canvas.height = cropSHeight;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(video, cropSx, cropSy, cropSWidth, cropSHeight, 0, 0, cropSWidth, cropSHeight);
            const imageDataUrl = canvas.toDataURL('image/jpeg');
            
            if (capturingFor === 'front') {
                setImageFront(imageDataUrl);
            } else {
                setImageBack(imageDataUrl);
            }
            
            setIsCapturing(false);
            setCapturingFor(null);
        }
    };

    const startCapture = (side: 'front' | 'back') => {
        setCapturingFor(side);
        setIsCapturing(true);
    };

    const cancelCapture = () => {
        setIsCapturing(false);
        setCapturingFor(null);
    };

    return (
        <div className="add-card-screen">
            <h2>名刺追加</h2>
            {isCapturing ? (
                 <div className="capturing-view">
                    <div className="camera-container">
                        <video ref={videoRef} autoPlay playsInline className="camera-feed"></video>
                        <div className="camera-overlay"></div>
                    </div>
                    <div className="camera-controls">
                        <button className="control-button primary" onClick={handleCapture}>撮影</button>
                        <button className="control-button" onClick={cancelCapture}>キャンセル</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="capture-preview-area">
                        <div className="capture-slot">
                            {imageFront ? <img src={imageFront} alt="表面" /> : <div className="placeholder-img">表面</div>}
                            <button className="control-button" onClick={() => startCapture('front')}>
                                {imageFront ? '表面を撮り直す' : '表面を撮影'}
                            </button>
                        </div>
                         <div className="capture-slot">
                            {imageBack ? <img src={imageBack} alt="裏面" /> : <div className="placeholder-img">裏面</div>}
                            <button className="control-button" onClick={() => startCapture('back')}>
                                 {imageBack ? '裏面を撮り直す' : '裏面を撮影'}
                            </button>
                        </div>
                    </div>
                    <div className="privacy-notice">
                        <span className="privacy-icon">🔒</span>
                        ご安心ください：撮影された画像は情報の抽出処理にのみ使用され、GoogleのAIモデルの再学習や第三者への共有には使用されません。通信は暗号化され安全に保護されています。
                    </div>
                    <div className="add-card-controls">
                       <button 
                            className="control-button primary" 
                            onClick={() => handleConfirmImages({ front: imageFront, back: imageBack })}
                            disabled={!imageFront && !imageBack}
                        >
                            確認画面へ進む
                        </button>
                    </div>
                </>
            )}
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};


const ConfirmCardScreen: FC = () => {
    const { goBack, promptForClassification, imagesToConfirm, editingCard, extractionState, handleRetryExtraction, clearExtractionState } = useAppContext();
    
    const isEditing = !!editingCard;
    const initialCardData = isEditing ? editingCard : (extractionState ? extractionState.confirmedData : {});
    const images = isEditing ? { front: editingCard.imageUrl, back: editingCard.imageUrlBack } : imagesToConfirm;
    const isManualCreation = !isEditing && !images;

    const [cardData, setCardData] = useState<CardDataInput>(initialCardData);
    const [tagInput, setTagInput] = useState(initialCardData.tags?.join(', ') || '');
    const [websiteInput, setWebsiteInput] = useState(
        (Array.isArray(initialCardData.website) ? initialCardData.website.join(', ') : initialCardData.website) || ''
    );
    const [snsInput, setSnsInput] = useState(
        (Array.isArray(initialCardData.sns) ? initialCardData.sns.join(', ') : initialCardData.sns) || ''
    );
    const [isLoading, setIsLoading] = useState(!isEditing && !!images?.front);
    const [error, setError] = useState<string | null>(null);
    const [customFields, setCustomFields] = useState<{ id: number; key: string; value: string }[]>(
        (isEditing && editingCard?.customFields?.map((f, i) => ({ ...f, id: Date.now() + i }))) || []
    );
    
    const [checkedFields, setCheckedFields] = useState<Record<string, boolean>>(() => {
        if (isEditing && editingCard) {
            const newChecked: Record<string, boolean> = {};
            Object.keys(editingCard).forEach(key => {
                if ((editingCard as any)[key]) {
                    newChecked[key] = true;
                }
            });
            return newChecked;
        }
        return extractionState?.previousCheckedFields || {};
    });

    useEffect(() => {
        if (isEditing || isManualCreation || !images?.front) {
            setIsLoading(false);
            return;
        }

        const runExtraction = async () => {
            setIsLoading(true);
            try {
                if (extractionState && extractionState.fieldsToReExtract.length > 0) {
                    const reExtractedData = await callApiProxy('reExtractInfo', {
                        frontImage: images.front,
                        backImage: images.back,
                        fieldsToReExtract: extractionState.fieldsToReExtract,
                    });
                    const updates = Object.entries(reExtractedData).reduce((acc, [key, value]) => {
                        const valueExists = Array.isArray(value) ? value.length > 0 : !!value;
                        if (valueExists) {
                            acc[key as keyof CardDataInput] = value as any;
                        }
                        return acc;
                    }, {} as Partial<CardDataInput>);
                    
                    setCardData(prev => ({...prev, ...updates}));

                    setCheckedFields(prev => {
                        const newChecked = {...prev};
                        Object.keys(updates).forEach(key => { 
                           newChecked[key] = true;
                        });
                        return newChecked;
                    });

                } else {
                    const extractedData = await callApiProxy('extractInfo', {
                        frontImage: images.front,
                        backImage: images.back,
                    });
                    setCardData(extractedData);
                    const newChecked: Record<string, boolean> = {};
                    Object.keys(extractedData).forEach(key => {
                        if (extractedData[key as keyof CardDataInput]) {
                            newChecked[key] = true;
                        }
                    });
                    setCheckedFields(newChecked);
                    if (extractedData.tags && Array.isArray(extractedData.tags)) setTagInput(extractedData.tags.join(', '));
                    if (extractedData.website && Array.isArray(extractedData.website)) setWebsiteInput(extractedData.website.join(', '));
                    if (extractedData.sns && Array.isArray(extractedData.sns)) setSnsInput(extractedData.sns.join(', '));
                }

            } catch (err) {
                console.error("Error extracting info via proxy:", err);
                setError("情報の抽出に失敗しました。手動で入力してください。");
            } finally {
                setIsLoading(false);
                clearExtractionState();
            }
        };
        runExtraction();
    }, [images, isEditing, extractionState, isManualCreation]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setCardData(prev => ({ ...prev, [name]: value }));
    };

    const handleCheckChange = (fieldName: string, isChecked: boolean) => {
        setCheckedFields(prev => ({ ...prev, [fieldName]: isChecked }));
    };
    
    const handleAddCustomField = () => {
        setCustomFields([...customFields, { id: Date.now(), key: '', value: '' }]);
    };

    const handleCustomFieldChange = (id: number, type: 'key' | 'value', value: string) => {
        setCustomFields(customFields.map(field => (field.id === id ? { ...field, [type]: value } : field)));
    };

    const handleDeleteCustomField = (id: number) => {
        setCustomFields(customFields.filter(field => field.id !== id));
    };


    const handlePromptClassification = () => {
        const tagsArray = tagInput.split(',').map(t => t.trim()).filter(Boolean);
        const websiteArray = websiteInput.split(',').map(t => t.trim()).filter(Boolean);
        const snsArray = snsInput.split(',').map(t => t.trim()).filter(Boolean);
        const finalCustomFields = customFields
            .map(({ key, value }) => ({ key, value }))
            .filter(f => f.key.trim() && f.value.trim());

        const finalCardData = { 
            ...cardData, 
            tags: tagsArray, 
            website: websiteArray, 
            sns: snsArray,
            customFields: finalCustomFields.length > 0 ? finalCustomFields : undefined
        };

        promptForClassification({
            data: finalCardData,
            images: images,
            isEditing: isEditing,
            editingId: editingCard?.id
        });
    };

    const onBack = () => {
        if (isEditing || isManualCreation) {
            goBack();
        } else {
            handleRetryExtraction(cardData, checkedFields);
        }
    };

    const allPossibleFields: (keyof CardDataInput)[] = [
        'companyName', 'name', 'furigana', 'department', 'title', 'zipCode', 'address', 'tel', 'mobileTel', 'fax', 'email', 'website', 'sns', 'otherTel', 'notes', 'tags'
    ];

    const handleToggleAllChecks = () => {
        const areAllChecked = allPossibleFields.every(field => !!checkedFields[field]);
        const newCheckedState: Record<string, boolean> = {};
        allPossibleFields.forEach(field => {
            newCheckedState[field] = !areAllChecked;
        });
        setCheckedFields(newCheckedState);
    };

    const areAllChecked = allPossibleFields.length > 0 && allPossibleFields.every(field => !!checkedFields[field]);

    const renderForm = () => {
        const fields: { name: keyof CardDataInput; label: string, type?: string }[] = [
            { name: 'companyName', label: '会社名' }, { name: 'name', label: '氏名' },
            { name: 'furigana', label: 'フリガナ' }, { name: 'department', label: '部署' },
            { name: 'title', label: '役職' }, { name: 'zipCode', label: '郵便番号' },
            { name: 'address', label: '住所' }, { name: 'tel', label: '電話番号' },
            { name: 'mobileTel', label: '携帯番号' }, { name: 'fax', label: 'FAX' },
            { name: 'email', label: 'Email' },
        ];
        return (
            <>
                {!isEditing && !isManualCreation && (
                    <div className="form-controls-header">
                        <label>
                            <input
                                type="checkbox"
                                onChange={handleToggleAllChecks}
                                checked={areAllChecked}
                                aria-label="すべての項目を選択または選択解除"
                            />
                            すべて選択 / 解除
                        </label>
                        <p className="checkbox-description">
                            チェックした項目は確定済みとみなし、「撮り直す」際にAIによる再抽出を行いません。
                        </p>
                    </div>
                )}
                <form className="card-data-form" onSubmit={(e) => e.preventDefault()}>
                    {fields.map(field => (
                        <div className="form-group" key={field.name}>
                            <label htmlFor={field.name}>{field.label}</label>
                            {!isEditing && !isManualCreation && (
                                <input
                                    type="checkbox"
                                    className="field-checkbox"
                                    title={`この項目 (${field.label}) を確定する`}
                                    checked={!!checkedFields[field.name]}
                                    onChange={(e) => handleCheckChange(field.name, e.target.checked)}
                                />
                            )}
                            <input
                                type="text"
                                id={field.name}
                                name={field.name}
                                value={(cardData as any)[field.name] || ''}
                                onChange={handleInputChange}
                            />
                        </div>
                    ))}
                    <div className="form-group">
                        <label htmlFor="website">Webサイト (カンマ区切り)</label>
                        {!isEditing && !isManualCreation && <input type="checkbox" className="field-checkbox" title="Webサイトを確定する" checked={!!checkedFields['website']} onChange={(e) => handleCheckChange('website', e.target.checked)}/>}
                        <input type="text" id="website" name="website" value={websiteInput} onChange={(e) => setWebsiteInput(e.target.value)} />
                    </div>
                     <div className="form-group">
                        <label htmlFor="sns">SNS (カンマ区切り)</label>
                        {!isEditing && !isManualCreation && <input type="checkbox" className="field-checkbox" title="SNSを確定する" checked={!!checkedFields['sns']} onChange={(e) => handleCheckChange('sns', e.target.checked)}/>}
                        <input type="text" id="sns" name="sns" value={snsInput} onChange={(e) => setSnsInput(e.target.value)} />
                    </div>
                     <div className="form-group">
                        <label htmlFor="otherTel">その他電話番号</label>
                        {!isEditing && !isManualCreation && <input type="checkbox" className="field-checkbox" title="その他電話番号を確定する" checked={!!checkedFields['otherTel']} onChange={(e) => handleCheckChange('otherTel', e.target.checked)}/>}
                        <textarea id="otherTel" name="otherTel" value={cardData.otherTel || ''} onChange={handleInputChange} rows={2}></textarea>
                    </div>
                    <div className="form-group">
                        <label htmlFor="notes">備考</label>
                        {!isEditing && !isManualCreation && <input type="checkbox" className="field-checkbox" title="備考を確定する" checked={!!checkedFields['notes']} onChange={(e) => handleCheckChange('notes', e.target.checked)}/>}
                        <textarea id="notes" name="notes" value={cardData.notes || ''} onChange={handleInputChange} rows={3}></textarea>
                    </div>
                    <div className="form-group">
                        <label htmlFor="tags">タグ (カンマ区切り)</label>
                        {!isEditing && !isManualCreation && (
                            <input
                                type="checkbox"
                                className="field-checkbox"
                                title="タグを確定する"
                                checked={!!checkedFields['tags']}
                                onChange={(e) => handleCheckChange('tags', e.target.checked)}
                            />
                        )}
                        <input
                            type="text"
                            id="tags"
                            name="tags"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="例: IT, クライアント, 展示会"
                        />
                    </div>
                </form>
                <div className="custom-fields-section">
                    <h4>カスタム項目</h4>
                    {customFields.map(field => (
                        <div key={field.id} className="editable-key-value-item">
                            <input
                                type="text"
                                value={field.key}
                                onChange={(e) => handleCustomFieldChange(field.id, 'key', e.target.value)}
                                placeholder="項目名"
                                className="key-input"
                            />
                            <textarea
                                value={field.value}
                                onChange={(e) => handleCustomFieldChange(field.id, 'value', e.target.value)}
                                placeholder="内容"
                                className="value-input"
                                rows={1}
                            />
                            <button onClick={() => handleDeleteCustomField(field.id)} className="delete-field-btn">×</button>
                        </div>
                    ))}
                     <button onClick={handleAddCustomField} className="control-button secondary add-field-btn">
                        <span className="button-icon">➕</span> 項目を追加
                    </button>
                </div>
            </>
        );
    };

    return (
        <div className="confirm-card-screen">
            <h2>{isEditing ? '名刺情報の編集' : (isManualCreation ? '名刺の作成' : '名刺情報の確認')}</h2>
            <div className="confirm-content">
                {!isManualCreation && (
                  <div className="confirm-preview-container dual-image">
                      {images?.front && <img src={images.front} alt="名刺（表面）" className="confirm-preview-image" />}
                      {images?.back && <img src={images.back} alt="名刺（裏面）" className="confirm-preview-image" />}
                  </div>
                )}
                <div className={`confirm-form-container ${isManualCreation ? 'full-width' : ''}`}>
                    {isLoading ? (
                         <div className="loading-container"><div className="spinner"></div><p>AIが情報を抽出中...</p></div>
                    ) : error ? (
                        <div className="error-container"><p>{error}</p>{renderForm()}</div>
                    ) : (
                        renderForm()
                    )}
                </div>
            </div>
            <div className="confirm-controls">
                <button className="control-button" onClick={onBack}>{isEditing || isManualCreation ? 'キャンセル' : '撮り直す'}</button>
                <button className="control-button primary" onClick={handlePromptClassification}>{isEditing ? '更新' : '保存'}</button>
            </div>
        </div>
    );
};

const MemoScreen: FC = () => {
    const { selectedCard: card, memos, handleSaveMemos, goBack, startRecordingOnCall, setStartRecordingOnCall, selectedCardPhoneNumber, setSelectedCardPhoneNumber } = useAppContext();
    
    if (!card) return null;

    const savedMemos = memos[card.id] || [];
    const [currentMemo, setCurrentMemo] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [lastSummary, setLastSummary] = useState<{ content: string; summary: string } | null>(null);
    const [summaryError, setSummaryError] = useState('');
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('お使いのブラウザは音声認識をサポートしていません。');
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    setCurrentMemo(prev => prev + event.results[i][0].transcript);
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
        };
        recognition.onstart = () => setIsRecording(true);
        recognition.onend = () => setIsRecording(false);
        recognitionRef.current = recognition;
    }, []);
    
    useEffect(() => {
        if (startRecordingOnCall) {
            if (selectedCardPhoneNumber) {
                window.location.href = `tel:${selectedCardPhoneNumber}`;
                setSelectedCardPhoneNumber(null);
            }
            setStartRecordingOnCall(false);
        }
    }, [startRecordingOnCall]);

    const handleToggleRecording = () => {
        if (isRecording) {
            recognitionRef.current?.stop();
        } else {
            try {
                recognitionRef.current?.start();
            } catch (e) {
                 console.error("音声認識の開始に失敗しました:", e);
                 alert("音声認識の開始に失敗しました。マイクの権限を確認してください。");
            }
        }
    };

    const handleSaveMemo = () => {
        if (currentMemo.trim() === '') return;
        const newMemo: Memo = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('ja-JP'),
            content: currentMemo.trim(),
            summary: lastSummary?.content === currentMemo.trim() ? lastSummary.summary : undefined,
        };
        handleSaveMemos(card.id, [...savedMemos, newMemo]);
        setCurrentMemo('');
        setLastSummary(null);
    };

    const handleSummarize = async () => {
        if (currentMemo.trim() === '') return;
        setIsSummarizing(true);
        setSummaryError('');
        setLastSummary(null);
        try {
            const result = await callApiProxy('summarize', { text: currentMemo });
            setLastSummary({ content: currentMemo.trim(), summary: result.summary });
        } catch (error) {
            console.error("Error summarizing text via proxy:", error);
            setSummaryError('要約の生成に失敗しました。');
        } finally {
            setIsSummarizing(false);
        }
    };
    
    const handleExport = () => {
        let content = `--- ${card.companyName} ${card.name}様との会話メモ ---\n\n`;
        const allMemos = [...savedMemos];
        if (currentMemo.trim()) {
            allMemos.push({ id: 0, timestamp: '（未保存のメモ）', content: currentMemo, summary: lastSummary?.summary });
        }
        allMemos.forEach(memo => {
            content += `日時: ${memo.timestamp}\n`;
            content += `内容:\n${memo.content}\n`;
            if (memo.summary) {
                content += `AIによる要約:\n${memo.summary}\n`;
            }
            content += '---------------------------------\n\n';
        });
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `メモ_${card.name}_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="memo-screen">
            <h2>{card.name}様 - 通話メモ</h2>
            <div className="memo-content-area">
                <div className="memo-list">
                    <h3>保存済みメモ</h3>
                    {savedMemos.length > 0 ? (
                        savedMemos.map(memo => (
                            <div key={memo.id} className="memo-item">
                                <p className="memo-timestamp">{memo.timestamp}</p>
                                <p className="memo-text">{memo.content}</p>
                                {memo.summary && <div className="memo-summary-saved"><strong>AI要約:</strong> {memo.summary}</div>}
                            </div>
                        ))
                    ) : (
                        <p className="memo-placeholder">まだ保存されたメモはありません。</p>
                    )}
                </div>
                <div className="memo-input-area">
                    <h3>新規メモ</h3>
                    <textarea
                        value={currentMemo}
                        onChange={(e) => setCurrentMemo(e.target.value)}
                        placeholder="通話内容のメモを音声または手動で入力..."
                    />
                     {isSummarizing && <div className="loading-container inline"><div className="spinner small"></div><p>AIが要約を生成中...</p></div>}
                    {summaryError && <p className="error-text">{summaryError}</p>}
                    {lastSummary && (
                        <div className="memo-summary">
                            <strong>AIによる要約:</strong>
                            <p>{lastSummary.summary}</p>
                        </div>
                    )}
                </div>
            </div>
            <div className="memo-controls">
                <button
                    className={`control-button mic-button ${isRecording ? 'recording' : ''}`}
                    onClick={handleToggleRecording}
                    title="音声入力"
                >
                    🎤
                </button>
                <button className="control-button" onClick={handleSummarize} disabled={isSummarizing || !currentMemo.trim()}>AIで要約</button>
                <button className="control-button" onClick={handleSaveMemo} disabled={!currentMemo.trim()}>メモを保存</button>
                <button className="control-button" onClick={handleExport}>エクスポート</button>
            </div>
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};

// --- New Components for Policy Analysis ---

const AnalysisToolScreen: FC = () => {
    const { goBack, handleAddImageToAnalysis, currentPolicyAnalysis } = useAppContext();
    const videoRef = useRef<HTMLVideoElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    
    useEffect(() => {
        let isMounted = true;
        const startCamera = async () => {
            if (stream) stream.getTracks().forEach(track => track.stop());
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                if (isMounted) {
                    setStream(mediaStream);
                    if (videoRef.current) videoRef.current.srcObject = mediaStream;
                }
            } catch (error) {
                console.error("Error accessing camera:", error);
                alert("カメラにアクセスできませんでした。");
            }
        };
        startCamera();
        return () => { 
            isMounted = false;
            if (stream) stream.getTracks().forEach(track => track.stop()); 
        };
    }, []);

    const handleCapture = () => {
        if (!videoRef.current || !overlayRef.current) return;

        const video = videoRef.current;
        const overlay = overlayRef.current;
        const canvas = document.createElement('canvas');

        // ビデオの実際の解像度と、画面上での表示サイズのアスペクト比を計算
        const videoRatio = video.videoWidth / video.videoHeight;
        const containerRatio = video.clientWidth / video.clientHeight;

        // CSSの object-fit: cover を考慮して、画面に表示されているビデオソースの領域を計算
        let sWidth = video.videoWidth;
        let sHeight = video.videoHeight;
        let sx = 0;
        let sy = 0;

        if (videoRatio > containerRatio) {
            // ビデオがコンテナより横長の場合、表示高さに合わせ、左右がはみ出る
            sHeight = video.videoHeight;
            sWidth = sHeight * containerRatio;
            sx = (video.videoWidth - sWidth) / 2;
        } else {
            // ビデオがコンテナより縦長の場合、表示幅に合わせ、上下がはみ出る
            sWidth = video.videoWidth;
            sHeight = sWidth / containerRatio;
            sy = (video.videoHeight - sHeight) / 2;
        }
        
        // 画面上のピクセルから、ビデオソース上のピクセルへの変換スケールを計算
        const scale = sWidth / video.clientWidth;

        // オーバーレイの画面上の座標を取得
        const videoRect = video.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        // オーバーレイの座標をビデオソース上の座標に変換
        const cropSx = sx + (overlayRect.left - videoRect.left) * scale;
        const cropSy = sy + (overlayRect.top - videoRect.top) * scale;
        const cropSWidth = overlayRect.width * scale;
        const cropSHeight = overlayRect.height * scale;

        // キャンバスに正確に切り取った画像を描画
        canvas.width = cropSWidth;
        canvas.height = cropSHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(
                video,
                cropSx, cropSy, cropSWidth, cropSHeight, // ソース領域
                0, 0, cropSWidth, cropSHeight           // 描画先領域
            );
            const imageDataUrl = canvas.toDataURL('image/jpeg');
            handleAddImageToAnalysis(imageDataUrl);
        }
    };
    

    return (
        <div className="add-card-screen">
            <h2>書類の撮影 ({currentPolicyAnalysis?.images.length + 1}ページ目)</h2>
            <div className="capturing-view">
                <div className="camera-container">
                    <video ref={videoRef} autoPlay playsInline className="camera-feed"></video>
                    <div ref={overlayRef} className="camera-overlay"></div>
                </div>
                <div className="camera-controls">
                    <button className="control-button primary" onClick={handleCapture}>撮影して分析</button>
                    <button className="control-button" onClick={goBack}>キャンセル</button>
                </div>
            </div>
             <div className="privacy-notice" style={{marginTop: '16px'}}>
                <span className="privacy-icon">🔒</span>
                ご安心ください：撮影された画像は情報の抽出処理にのみ使用され、GoogleのAIモデルの再学習や第三者への共有には使用されません。通信は暗号化され安全に保護されています。
            </div>
        </div>
    );
};

const DynamicAnalysisScreen: FC = () => {
    const { currentPolicyAnalysis, cancelCurrentAnalysis, navigateTo, handleSaveCurrentAnalysis } = useAppContext();
    
    if (!currentPolicyAnalysis) return null;

    const handleSave = () => {
        const defaultTitle = currentPolicyAnalysis.fields.find(f => f.key.includes('保険種類') || f.key.includes('契約者'))?.value || `分析結果 ${new Date().toLocaleDateString()}`;
        const title = prompt("この分析のタイトルを入力してください:", defaultTitle);
        if (title) {
            handleSaveCurrentAnalysis(title);
        }
    }

    return (
        <div className="dynamic-analysis-screen">
            <h2>AI分析結果</h2>
            <div className="analysis-content">
                <div className="analysis-images-pane">
                    <h3>撮影済みページ ({currentPolicyAnalysis.images.length}枚)</h3>
                    <div className="image-thumbnail-list">
                        {currentPolicyAnalysis.images.map((imgSrc, index) => (
                            <img key={index} src={imgSrc} alt={`Page ${index + 1}`} className="thumbnail" />
                        ))}
                    </div>
                    <button className="control-button secondary full-width" onClick={() => navigateTo('analysisTool')}>
                        <span className="button-icon">➕</span> ページを追加撮影
                    </button>
                </div>

                <div className="analysis-fields-pane">
                    <h3>抽出された情報</h3>
                    <div className="analysis-fields-content">
                        {currentPolicyAnalysis.isAnalyzing && (
                             <div className="loading-container"><div className="spinner"></div><p>AIが情報を分析中...</p></div>
                        )}
                        {currentPolicyAnalysis.error && (
                            <div className="error-container"><p>{currentPolicyAnalysis.error}</p></div>
                        )}
                        {!currentPolicyAnalysis.isAnalyzing && currentPolicyAnalysis.fields.length === 0 && !currentPolicyAnalysis.error && (
                            <p className="placeholder-text">AIによる分析結果がここに表示されます。</p>
                        )}
                        {currentPolicyAnalysis.fields.length > 0 && (
                            <div className="key-value-list">
                                {currentPolicyAnalysis.fields.map(field => (
                                    <div key={field.id} className="key-value-item">
                                        <strong className="item-key">{field.key}</strong>
                                        <span className="item-value">{field.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="confirm-controls">
                <button className="control-button" onClick={cancelCurrentAnalysis}>分析を中止</button>
                <button 
                    className="control-button primary" 
                    onClick={handleSave}
                    disabled={currentPolicyAnalysis.isAnalyzing || currentPolicyAnalysis.images.length === 0}>
                    保存
                </button>
            </div>
        </div>
    );
};

const PolicyDetailScreen: FC = () => {
    const { policies, selectedPolicyId, handleUpdatePolicy, handleDeletePolicy, goBack } = useAppContext();
    const policy = policies.find(p => p.id === selectedPolicyId);
    
    const [title, setTitle] = useState(policy?.title || '');
    const [fields, setFields] = useState<PolicyField[]>(policy?.fields.map(f => ({...f})) || []);
    const [showExportModal, setShowExportModal] = useState(false);
    
    if (!policy) {
        return <div className="placeholder-screen"><p>分析データが見つかりません。</p><button className="back-button" onClick={goBack}>戻る</button></div>;
    }
    
    const handleFieldChange = (id: number, type: 'key' | 'value', text: string) => {
        setFields(fields.map(f => f.id === id ? { ...f, [type]: text } : f));
    };

    const handleAddField = () => {
        const newField: PolicyField = { id: Date.now(), key: '', value: '' };
        setFields([...fields, newField]);
    };

    const handleDeleteField = (id: number) => {
        setFields(fields.filter(f => f.id !== id));
    };

    const onUpdate = () => {
        const updatedPolicy: PolicyData = { ...policy, title, fields };
        handleUpdatePolicy(updatedPolicy);
    };

    const handleExport = (format: 'csv' | 'txt') => {
        if (!policy) return;

        let content = '';
        let mimeType = '';
        let filename = `analysis_${title.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}`;

        if (format === 'csv') {
            const header = ['id', 'title', 'imageUrls', 'fields'];
            const row = [
                formatCsvField(policy.id),
                formatCsvField(title),
                formatCsvField(policy.imageUrls.join(';')),
                formatCsvField(fields.map(f => `${f.key}:${f.value}`).join(';'))
            ];
            content = [header.join(','), row.join(',')].join('\n');
            mimeType = 'text/csv;charset=utf-8;';
            filename += '.csv';
        } else { // txt
            content = `--- Analysis Data: ${title} ---\n`;
            content += `Image URLs: ${policy.imageUrls.join(', ')}\n\n`;
            content += `--- Fields ---\n`;
            fields.forEach(field => {
                content += `${field.key}: ${field.value}\n`;
            });
            content += '---------------------------\n';
            mimeType = 'text/plain;charset=utf-8;';
            filename += '.txt';
        }

        const blob = new Blob([content], { type: mimeType });
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
        <div className="policy-detail-screen">
            <h2>分析データの編集</h2>
            <div className="form-group vertical">
                <label htmlFor="policyTitle">タイトル</label>
                <input
                    type="text"
                    id="policyTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
            </div>

            <div className="analysis-images-pane">
                <h3>撮影済みページ ({policy.imageUrls.length}枚)</h3>
                <div className="image-thumbnail-list">
                    {policy.imageUrls.map((imgSrc, index) => (
                        <img key={index} src={imgSrc} alt={`Page ${index + 1}`} className="thumbnail" />
                    ))}
                </div>
            </div>

            <div className="editable-fields-section">
                <h3>抽出情報</h3>
                <div className="editable-key-value-list">
                    {fields.map(field => (
                        <div key={field.id} className="editable-key-value-item">
                            <input
                                type="text"
                                value={field.key}
                                onChange={(e) => handleFieldChange(field.id, 'key', e.target.value)}
                                placeholder="項目名"
                                className="key-input"
                            />
                            <textarea
                                value={field.value}
                                onChange={(e) => handleFieldChange(field.id, 'value', e.target.value)}
                                placeholder="内容"
                                className="value-input"
                                rows={1}
                            />
                            <button onClick={() => handleDeleteField(field.id)} className="delete-field-btn">×</button>
                        </div>
                    ))}
                </div>
                <button onClick={handleAddField} className="control-button secondary add-field-btn">
                    <span className="button-icon">➕</span> 項目を追加
                </button>
            </div>
            
            <div className="confirm-controls">
                <button className="control-button delete" onClick={() => handleDeletePolicy(policy.id)}>この分析を削除</button>
                <button className="control-button" onClick={() => setShowExportModal(true)}>エクスポート</button>
                <button className="control-button primary" onClick={onUpdate}>更新</button>
            </div>
            <button className="back-button" onClick={goBack}>戻る</button>

            {showExportModal && (
                <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>エクスポート形式を選択</h3>
                        <div className="export-options">
                            <button className="control-button primary" onClick={() => handleExport('csv')}>CSVファイル</button>
                            <button className="control-button" onClick={() => handleExport('txt')}>テキストファイル</button>
                        </div>
                         <button className="control-button" style={{marginTop: '16px'}} onClick={() => setShowExportModal(false)}>閉じる</button>
                    </div>
                </div>
            )}
        </div>
    );
};


const AnalysisListScreen: FC = () => {
    const { policies, handleSelectPolicy, goBack } = useAppContext();

    return (
        <div className="card-list-screen">
            <h2>分析済み証券一覧</h2>
            {policies.length === 0 ? (
                <div className="placeholder-screen">
                    <p>まだ分析された証券がありません。「支援ツール」から新しい証券を分析してください。</p>
                </div>
            ) : (
                <div className="card-list">
                    {policies.map(policy => (
                        <div key={policy.id} className="card-list-item-container simple" onClick={() => handleSelectPolicy(policy.id)}>
                           <div className="card-list-item">
                               <div className="card-item-company">{policy.title}</div>
                               <div className="card-item-name">{(policy.fields || []).slice(0, 2).map(f => f.value || '').join(' - ') || '詳細を見る'}</div>
                           </div>
                       </div>
                   ))}
                </div>
            )}
            <button className="back-button" onClick={goBack}>戻る</button>
        </div>
    );
};


const ClassificationModal: FC = () => {
    const { cardForClassification, cancelClassification, handleSaveCard, handleUpdateCard } = useAppContext();
    const [selected, setSelected] = useState<string>('');

    if (!cardForClassification) return null;

    const handleSave = () => {
        if (!selected) {
            alert('分類を選択してください。');
            return;
        }
        const finalData = { ...cardForClassification.data, classification: selected };
        
        if (cardForClassification.isEditing && cardForClassification.editingId) {
            handleUpdateCard({ 
                ...finalData, 
                id: cardForClassification.editingId, 
                imageUrl: cardForClassification.images?.front || null,
                imageUrlBack: cardForClassification.images?.back || null,
            });
        } else {
            handleSaveCard(finalData);
        }
    };
    
    return (
        <div className="modal-overlay" onClick={cancelClassification}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>名刺の分類を選択</h3>
                <p>この名刺をどのカテゴリに分類しますか？</p>
                <div className="classification-selector">
                    {classifications.map(c => (
                        <button 
                            key={c}
                            className={`classification-select-button ${selected === c ? 'active' : ''}`}
                            onClick={() => setSelected(c)}
                        >
                            {c}
                        </button>
                    ))}
                </div>
                <div className="modal-actions">
                    <button className="control-button" onClick={cancelClassification}>キャンセル</button>
                    <button className="control-button primary" onClick={handleSave} disabled={!selected}>保存</button>
                </div>
            </div>
        </div>
    );
}

// --- New Component for Excel Integration ---
const ExcelIntegrationScreen: FC = () => {
    const { goBack } = useAppContext();
    const [step, setStep] = useState(1);
    const [excelFile, setExcelFile] = useState<File | null>(null);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [excelData, setExcelData] = useState<any[]>([]);
    const [csvData, setCsvData] = useState<any[]>([]);
    const [columnMap, setColumnMap] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'excel' | 'csv') => {
        const file = e.target.files?.[0] || null;
        if (type === 'excel') setExcelFile(file);
        else setCsvFile(file);
    };

    const processFiles = async () => {
        if (!excelFile || !csvFile) return;
        setIsLoading(true);
        setError(null);
        try {
            // Process Excel
            const excelReader = new FileReader();
            excelReader.onload = async (e) => {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                if (jsonData.length === 0) throw new Error("Excelファイルが空です。");
                const headers = jsonData[0] as string[];
                setExcelHeaders(headers);
                setExcelData(XLSX.utils.sheet_to_json(worksheet));

                // Process CSV
                const csvReader = new FileReader();
                csvReader.onload = async (e_csv) => {
                    const csvText = e_csv.target?.result as string;
                    const csv_workbook = XLSX.read(csvText, { type: 'string' });
                    const csv_sheetName = csv_workbook.SheetNames[0];
                    const csv_worksheet = csv_workbook.Sheets[csv_sheetName];
                    const csv_jsonData = XLSX.utils.sheet_to_json(csv_worksheet, { header: 1 });
                    if (csv_jsonData.length === 0) throw new Error("CSVファイルが空です。");
                    const csv_headers = csv_jsonData[0] as string[];
                    setCsvHeaders(csv_headers);
                    setCsvData(XLSX.utils.sheet_to_json(csv_worksheet));
                    
                    // Get AI mapping
                    try {
                        const result = await callApiProxy('mapCsvToExcel', { csvHeaders: csv_headers, excelHeaders: headers });
                        setColumnMap(result.mapping || {});
                        setStep(2);
                    } catch (aiError) {
                        console.error("AI mapping failed:", aiError);
                        // Fallback to empty mapping
                        setColumnMap({});
                        setStep(2);
                    } finally {
                        setIsLoading(false);
                    }
                };
                csvReader.readAsText(csvFile);
            };
            excelReader.readAsBinaryString(excelFile);
        } catch (err: any) {
            setError(`ファイルの処理中にエラーが発生しました: ${err.message}`);
            setIsLoading(false);
        }
    };
    
    const handleMapChange = (csvHeader: string, excelHeader: string) => {
        setColumnMap(prev => ({ ...prev, [csvHeader]: excelHeader }));
    };

    const generateNewExcel = () => {
        // Create a copy of the original Excel data
        const newSheetData = [...excelData];

        // Map CSV data to new rows
        csvData.forEach(csvRow => {
            const newRow: Record<string, any> = {};
            excelHeaders.forEach(excelHeader => {
                 // Find which CSV header is mapped to this Excel header
                const mappedCsvHeader = Object.keys(columnMap).find(key => columnMap[key] === excelHeader);
                if (mappedCsvHeader && csvRow[mappedCsvHeader] !== undefined) {
                    newRow[excelHeader] = csvRow[mappedCsvHeader];
                } else {
                    newRow[excelHeader] = ''; // Or some default value
                }
            });
            newSheetData.push(newRow);
        });

        // Create new workbook and worksheet
        const newWorksheet = XLSX.utils.json_to_sheet(newSheetData, { header: excelHeaders });
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Updated Data');

        // Trigger download
        XLSX.writeFile(newWorkbook, `Updated_${excelFile?.name || 'data.xlsx'}`);
    };

    return (
        <div className="excel-integration-screen">
            <h2>Excelデータ連携ツール</h2>

            {error && <div className="error-container" style={{marginBottom: '16px'}}>{error}</div>}

            {isLoading && (
                 <div className="loading-container"><div className="spinner"></div><p>ファイルを処理中...</p></div>
            )}
            
            {!isLoading && step === 1 && (
                <div className="step-container">
                    <h3>ステップ1: ファイルの選択</h3>
                    <p>データを追加したいExcelファイルと、元になるCSVファイルを選択してください。</p>
                    <div className="file-upload-area">
                        <div className="file-input-wrapper">
                            <label htmlFor="excel-file">① 対象のExcelファイル (.xlsx)</label>
                            <input id="excel-file" type="file" accept=".xlsx" onChange={(e) => handleFileChange(e, 'excel')} />
                            {excelFile && <span className="file-name">{excelFile.name}</span>}
                        </div>
                        <div className="file-input-wrapper">
                            <label htmlFor="csv-file">② 名刺データCSVファイル (.csv)</label>
                            <input id="csv-file" type="file" accept=".csv" onChange={(e) => handleFileChange(e, 'csv')} />
                            {csvFile && <span className="file-name">{csvFile.name}</span>}
                        </div>
                    </div>
                    <div className="step-controls">
                        <button className="control-button primary" onClick={processFiles} disabled={!excelFile || !csvFile}>
                            次へ進む (列のマッピング)
                        </button>
                    </div>
                </div>
            )}

            {!isLoading && step === 2 && (
                <div className="step-container">
                    <h3>ステップ2: 列の紐付け (マッピング)</h3>
                    <p>AIが自動で列の対応関係を推測しました。内容を確認し、必要であれば修正してください。</p>
                    <div className="column-mapping-area">
                        <table>
                            <thead>
                                <tr>
                                    <th>CSVの項目 (入力元)</th>
                                    <th>Excelの項目 (入力先)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {csvHeaders.map(csvHeader => (
                                    <tr key={csvHeader}>
                                        <td>{csvHeader}</td>
                                        <td>
                                            <select 
                                                value={columnMap[csvHeader] || ''}
                                                onChange={(e) => handleMapChange(csvHeader, e.target.value)}
                                            >
                                                <option value="">-- 紐付けない --</option>
                                                {excelHeaders.map(excelHeader => (
                                                    <option key={excelHeader} value={excelHeader}>{excelHeader}</option>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                     <div className="step-controls space-between">
                         <button className="control-button" onClick={() => setStep(1)}>戻る</button>
                        <button className="control-button primary" onClick={generateNewExcel}>
                            新しいExcelファイルを生成してダウンロード
                        </button>
                    </div>
                </div>
            )}
            <button className="back-button" onClick={goBack}>メインメニューに戻る</button>
        </div>
    );
};



// --- App Content Component ---
const AppContent: FC = () => {
    const { view } = useAppContext();

    switch (view) {
        case 'list': return <CardListScreen />;
        case 'detail': return <CardDetailScreen />;
        case 'recent': return <RecentHistoryScreen />;
        case 'add': return <AddCardScreen />;
        case 'confirm': return <ConfirmCardScreen />;
        case 'memo': return <MemoScreen />;
        case 'analysisTool': return <AnalysisToolScreen />;
        case 'dynamicAnalysis': return <DynamicAnalysisScreen />;
        case 'policyDetail': return <PolicyDetailScreen />;
        case 'analysisList': return <AnalysisListScreen />;
        case 'excelIntegration': return <ExcelIntegrationScreen />;
        case 'main':
        default: return <MainScreen />;
    }
};


const App: FC = () => {
    return (
        <AppProvider>
            <div className="app-container">
                <header className="app-header">
                    <h1>名刺管理アプリ</h1>
                    <span className="app-version">v3.2.1-beta</span>
                </header>
                <main className="content-area">
                    <AppContentWrapper />
                </main>
            </div>
        </AppProvider>
    );
};

// This wrapper is necessary because the main App component provides the context,
// but the component that USES the context (for goBack and history) must be a child.
const AppContentWrapper: FC = () => {
    const { goBack, history } = useAppContext();
    const touchStartX = useRef(0);
    const canGoBack = history.length > 1;

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.targetTouches[0].clientX;
    };
    
    const handleTouchMove = (e: React.TouchEvent) => {
        if (!canGoBack || touchStartX.current === 0) return;
        const touchCurrentX = e.targetTouches[0].clientX;
        const deltaX = touchCurrentX - touchStartX.current;
        if (touchStartX.current < 50 && deltaX > 80) { // Check for swipe from left edge
            goBack();
            touchStartX.current = 0; // Prevent multiple triggers
        }
    };

    return (
        <div 
            className="content-wrapper"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
        >
            <AppContent />
            <ClassificationModal />
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);