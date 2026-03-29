
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { DataService, Subject, ContentType, ContentItem } from "./dataService";

/** 
 * URL DE DISTRIBUIÇÃO MESTRE:
 * Definido como './manifest.json' para carregar os arquivos locais embutidos no app.
 */
const MASTER_DISTRIBUTION_URL: string | null = './manifest.json'; 

const INITIAL_DATA_SEED: any = null; 

// --- CONSTANTS ---
const STORAGE_LIMIT_MB = 500; 

// --- INITIAL DATA STRUCTURE ---
const cnhData: (Subject | { category: string; subjects: Subject[] })[] = [
    { name: 'CTB', longName: 'Código de Trânsito Brasileiro', icon: 'balance', color: '#01579b' },
    { name: 'LEGISLAÇÃO', longName: 'Legislação de Trânsito', icon: 'gavel', color: '#d32f2f' },
    { name: 'DIREÇÃO DEFENSIVA', longName: 'Direção Defensiva', icon: 'health_and_safety', color: '#f57c00' },
    { name: 'PRIMEIROS SOCORROS', longName: 'Primeiros Socorros', icon: 'medical_services', color: '#1976d2' },
    { name: 'MECÂNICA', longName: 'Mecânica Básica', icon: 'build', color: '#512da8' },
    { name: 'MEIO AMBIENTE', longName: 'Meio Ambiente e Cidadania', icon: 'eco', color: '#00796b' },
    { name: 'HABILITAÇÃO', longName: 'Habilitação e Categorias da CNH', icon: 'card_membership', color: '#7B1FA2' },
    { name: 'INFRAÇÕES', longName: 'Infrações, Penalidades e Medidas Administrativas', icon: 'policy', color: '#C67100' },
    { name: 'REGISTRO E LICENCIAMENTO', longName: 'Registro, Licenciamento e Circulação de Veículos', icon: 'assignment', color: '#388E3C' },
    { name: 'CRIMES DE TRÂNSITO', longName: 'Crimes de Trânsito e Normas Penais Aplicáveis', icon: 'local_police', color: '#b71c1c' },
    { name: 'PLACAS', longName: 'Estudo das Placas', icon: 'signpost', color: '#C8A000' },
];

const CONTENT_TYPES_CONFIG: Record<ContentType, { name: string; icon: string; fields: { name: string; placeholder: string; type?: string }[] }> = {
    'flashcards': { name: 'Flashcards', icon: 'style', fields: [{ name: 'question', placeholder: 'Pergunta' }, { name: 'answer', placeholder: 'Resposta' }] },
    'podcasts': { name: 'Podcasts', icon: 'podcasts', fields: [{ name: 'title', placeholder: 'Título do Podcast' }, { name: 'url', placeholder: 'URL ou Carregar Áudio/MP4', type: 'audio-url' }] },
    'videos': { name: 'Vídeos', icon: 'play_circle', fields: [{ name: 'title', placeholder: 'Título do Vídeo' }, { name: 'url', placeholder: 'Link YouTube ou Carregar MP4', type: 'video-url' }] },
    'quizz': { name: 'Quizz', icon: 'quiz', fields: [{ name: 'question', placeholder: 'Pergunta' }, { name: 'option1', placeholder: 'Opção A' }, { name: 'option2', placeholder: 'Opção B' }, { name: 'option3', placeholder: 'Opção C' }, { name: 'option4', placeholder: 'Opção D' }, { name: 'correct', placeholder: 'Correta (A, B, C ou D)' }] },
    'material': { name: 'Material Didático', icon: 'article', fields: [{ name: 'title', placeholder: 'Título' }, { name: 'url', placeholder: 'URL ou Carregar PDF', type: 'pdf-url' }] },
};

const state = {
    activeBlobUrls: [] as string[],
    isChatOpen: false,
};

const app = document.getElementById('app')!;

// --- HELPERS ---
function getSubjectProgress(longName: string): number {
    if (!DataService.state.currentUser) return 0;
    const items = DataService.state.contentStore[longName];
    if (!items) return 0;
    
    let totalItems = 0;
    Object.values(items).forEach(list => totalItems += (list?.length || 0));
    if (totalItems === 0) return 0;

    const completed = DataService.state.currentUser.progress[longName]?.completed?.length || 0;
    return Math.min(100, Math.round((completed / totalItems) * 100));
}

function showToast(msg: string, type: 'success' | 'error' | 'sync' = 'success') {
    const container = document.getElementById('toast-container') || document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = type === 'sync' ? `<i class="material-icons spin">sync</i> ${msg}` : msg;
    container.appendChild(toast);
    if (type !== 'sync') {
        setTimeout(() => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 500); }, 3500);
    }
    return toast;
}

function navigateTo(renderFunc: Function, ...args: any[]) {
    try {
        state.activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
        state.activeBlobUrls = [];
        app.innerHTML = '';
        renderFunc(...args);
        window.scrollTo(0, 0);
    } catch (err) {
        console.error("Erro ao navegar/renderizar:", err);
        showToast("Erro ao carregar tela.", "error");
    }
}

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
    });
}

function getYouTubeEmbedUrl(url: string): string | null {
    if (!url) return null;
    const urlStr = url.trim();
    const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
    const match = urlStr.match(regExp);
    if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/${match[1]}`;
    }
    return null;
}

function createBlobUrlFromBase64(base64: string): string {
    if (!base64 || !base64.startsWith('data:')) return base64;
    try {
        const parts = base64.split(';base64,');
        const contentType = parts[0].split(':')[1];
        const raw = window.atob(parts[1]);
        const uInt8Array = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) { uInt8Array[i] = raw.charCodeAt(i); }
        const blob = new Blob([uInt8Array], { type: contentType });
        const url = URL.createObjectURL(blob);
        state.activeBlobUrls.push(url);
        return url;
    } catch (e) { return base64; }
}

function getAllSubjects(): Subject[] {
    const subs: Subject[] = [];
    cnhData.forEach(item => {
        if ('subjects' in item) subs.push(...item.subjects);
        else subs.push(item as Subject);
    });
    return subs;
}

function cleanAiJson(text: string): string {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

async function handleAIFullGenerate(subject: Subject) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf';
    
    fileInput.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const loading = document.createElement('div');
        loading.className = 'loading-overlay';
        loading.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:4000; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif; text-align:center; padding:20px;';
        loading.innerHTML = `
            <div class="loading-spinner" style="width:60px; height:60px; border:6px solid rgba(255,255,255,0.1); border-top-color:var(--accent-color); border-radius:50%; animation: spin 1s linear infinite; margin-bottom:25px;"></div>
            <div id="ai-progress-text" style="font-weight:900; font-size:1.2rem; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">Iniciando Processamento...</div>
            <div id="ai-sub-text" style="font-size:0.9rem; opacity:0.7; margin-bottom:20px;">Aguarde, a IA está preparando seu material.</div>
            <div style="width:100%; max-width:300px; height:8px; background:rgba(255,255,255,0.1); border-radius:10px; overflow:hidden;">
                <div id="ai-progress-bar" style="width:5%; height:100%; background:var(--accent-color); transition:width 0.5s ease-out;"></div>
            </div>
        `;
        document.body.appendChild(loading);

        const updateUI = (text: string, sub: string, pct: number) => {
            const t = document.getElementById('ai-progress-text');
            const s = document.getElementById('ai-sub-text');
            const b = document.getElementById('ai-progress-bar');
            if(t) t.textContent = text;
            if(s) s.textContent = sub;
            if(b) b.style.width = `${pct}%`;
        };

        try {
            updateUI("Lendo Documento...", "Extraindo texto do PDF para análise técnica.", 15);
            const base64Raw = await fileToBase64(file);
            const base64Data = base64Raw.split(',')[1];
            
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            const flashSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { question: { type: Type.STRING }, answer: { type: Type.STRING } }, required: ['question', 'answer'] } };
            const quizSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { question: { type: Type.STRING }, option1: { type: Type.STRING }, option2: { type: Type.STRING }, option3: { type: Type.STRING }, option4: { type: Type.STRING }, correct: { type: Type.STRING } }, required: ['question', 'option1', 'option2', 'option3', 'option4', 'correct'] } };

            updateUI("Gerando Flashcards...", "A IA está criando 100 cartões de memorização.", 40);
            const fRes = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [{ text: `Gere exatamente 100 flashcards sobre '${subject.longName}' baseados no PDF.` }, { inlineData: { mimeType: 'application/pdf', data: base64Data } }]},
                config: { responseMimeType: "application/json", responseSchema: flashSchema }
            });
            const fItems = JSON.parse(cleanAiJson(fRes.text || "[]"));

            updateUI("Criando Simulado...", "Gerando 100 questões de múltipla escolha.", 75);
            const qRes = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [{ text: `Gere exatamente 100 questões de quiz sobre '${subject.longName}' baseados no PDF. Campo 'correct' deve ser A, B, C ou D.` }, { inlineData: { mimeType: 'application/pdf', data: base64Data } }]},
                config: { responseMimeType: "application/json", responseSchema: quizSchema }
            });
            const qItems = JSON.parse(cleanAiJson(qRes.text || "[]"));

            for(const item of fItems) await DataService.addContent(subject.longName, 'flashcards', item);
            for(const item of qItems) await DataService.addContent(subject.longName, 'quizz', item);

            loading.remove();
            showToast("Material gerado com sucesso!");
            navigateTo(renderContentEditor, subject);
        } catch (err) {
            loading.remove();
            showToast("Erro na geração.", "error");
        }
    };
    fileInput.click();
}

async function handleImportBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (re) => {
            try {
                const data = JSON.parse(re.target?.result as string);
                const syncToast = showToast("Restaurando sistema...", "sync");
                await DataService.restoreBackup(data);
                syncToast.remove();
                showToast("Backup restaurado com sucesso! Recarregando...");
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (err) {
                console.error("Erro no backup:", err);
                showToast("Erro ao restaurar backup. Verifique o arquivo.", "error");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

async function handleSubjectExport(subject: Subject) {
    const content = DataService.state.contentStore[subject.longName];
    if (!content) {
        showToast("Sem conteúdo para exportar nesta matéria.", "error");
        return;
    }
    const data = {
        subject: subject.longName,
        contentStore: {
            [subject.longName]: content
        }
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cnh-${subject.name.toLowerCase().replace(/ /g, '-')}.json`;
    a.click();
}

async function handleSubjectImport(subject: Subject) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (re) => {
            try {
                const data = JSON.parse(re.target?.result as string);
                const subjectKey = data.subject || subject.longName;
                const content = data.contentStore?.[subjectKey];
                if (content) {
                    const syncToast = showToast("Importando matéria...", "sync");
                    await DataService.restoreSubjectBackup(subjectKey, content);
                    syncToast.remove();
                    showToast(`Conteúdo de ${subject.name} importado! Recarregando...`);
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } else {
                    showToast("Formato de arquivo modular inválido.", "error");
                }
            } catch (err) {
                console.error("Erro na importação de matéria:", err);
                showToast("Erro ao ler JSON.", "error");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// --- RENDERERS ---
function renderHeader(title: string, backFunc?: Function) {
    const header = document.createElement('header');
    header.innerHTML = `
        <div class="header-container">
            <h1 style="font-size:1rem; max-width: 60%; font-weight:900; letter-spacing:-0.5px; text-transform: uppercase;">${title}</h1>
            <div class="header-actions">
                ${backFunc ? '<button id="back-nav-btn" class="header-action-btn" aria-label="Voltar"><i class="material-icons">arrow_back</i></button>' : ''}
                <button id="logout-btn" class="header-action-btn" aria-label="Sair"><i class="material-icons">logout</i></button>
            </div>
        </div>
    `;
    (header.querySelector('#logout-btn') as HTMLElement).onclick = () => {
        DataService.logout();
        navigateTo(renderLoginScreen);
    };
    if (backFunc) {
        (header.querySelector('#back-nav-btn') as HTMLElement).onclick = () => backFunc();
    }
    return header;
}

function renderLoginScreen() {
    app.innerHTML = `
        <div class="login-container">
            <div class="login-card">
                <div class="login-header">
                    <i class="material-icons" style="font-size: 3.5rem; color: var(--accent-color);">stars</i>
                    <h2 style="margin: 10px 0;">CNH na palma da mão</h2>
                    <p style="opacity:0.7; font-size:0.9rem;">Auto Escola Digital</p>
                </div>
                <div id="student-list" style="margin: 1.5rem 0;"></div>
                <form id="new-profile">
                    <input type="text" id="name" placeholder="Nome do aluno" required style="margin-bottom:12px;">
                    <button type="submit" class="nav-btn" style="width:100%; justify-content:center; background:var(--accent-color); color:white;">CADASTRAR E ENTRAR</button>
                </form>
                <button id="mgr-btn-trigger" class="mgr-trigger-link" style="margin-top:2rem;">Acesso do Instrutor</button>
                <div id="mgr-password-box" class="mgr-password-inline-box" style="display:none; margin-top:1rem;">
                    <input type="password" id="mgr-password-input-inline" placeholder="Senha do Gestor">
                    <button id="mgr-password-submit" class="mgr-password-submit-btn"><i class="material-icons">login</i></button>
                </div>
            </div>
        </div>
    `;
    const list = app.querySelector('#student-list')!;
    DataService.state.studentsData.forEach(s => {
        const b = document.createElement('button');
        b.className = 'student-select-btn nav-btn';
        b.style.width = '100%'; b.style.marginBottom = '10px'; b.style.background = '#fff'; b.style.justifyContent = 'flex-start';
        b.innerHTML = `<i class="material-icons">account_circle</i> ${s.name}`;
        b.onclick = async () => { 
            await DataService.loginStudent(s.id);
            navigateTo(renderHomeScreen); 
        };
        list.appendChild(b);
    });

    (app.querySelector('#mgr-btn-trigger') as HTMLElement).onclick = (e) => {
        (e.currentTarget as HTMLElement).style.display = 'none';
        (app.querySelector('#mgr-password-box') as HTMLElement).style.display = 'flex';
    };

    (app.querySelector('#mgr-password-submit') as HTMLElement).onclick = async () => {
        const pass = (app.querySelector('#mgr-password-input-inline') as HTMLInputElement).value;
        const success = await DataService.loginManager(pass);
        if (success) navigateTo(renderHomeScreen); 
        else showToast("Senha inválida", "error");
    };

    (app.querySelector('#new-profile') as HTMLFormElement).onsubmit = async (e) => {
        e.preventDefault();
        const n = (app.querySelector('#name') as HTMLInputElement).value;
        const s = await DataService.createStudent(n);
        await DataService.loginStudent(s.id);
        navigateTo(renderHomeScreen);
    };
}

// --- GAMIFICATION SERVICE ---
const GamificationService = {
    recordError: async (error: any) => {
        await DataService.recordError(error);
    },
    removeError: async (errorId: string) => {
        await DataService.removeError(errorId);
    },
    addPoints: async (points: number) => {
        await DataService.addPoints(points);
    }
};

// --- SIMULADO STATE ---
let simuladoState = {
    questions: [] as any[],
    answers: {} as Record<number, string | number>,
    currentQuestion: 0,
    startTime: 0,
    endTime: 0,
    timerInterval: null as any,
    elapsedTime: 0,
    showFeedback: false,
    lastSelected: null as string | null
};

let reviewIndex = 0;

function renderHomeScreen() {
    app.appendChild(renderHeader("CNH na palma da mão"));
    const main = document.createElement('main');
    
    let totalProgress = 0;
    const subjects = getAllSubjects();
    subjects.forEach(s => totalProgress += getSubjectProgress(s.longName));
    const avgProgress = Math.round(totalProgress / (subjects.length || 1));

    const studentErrors = DataService.state.currentUser?.errors?.length || 0;
    const studentPoints = DataService.state.currentUser?.points || 0;

    main.innerHTML = `
        <div class="dashboard-stats">
            <div class="stat-card">
                <span class="stat-label">Progresso Total</span>
                <span class="stat-value">${avgProgress}%</span>
                <div class="stat-bar"><div style="width:${avgProgress}%"></div></div>
            </div>
            <div class="stat-card">
                <span class="stat-label">Pontos</span>
                <span class="stat-value">${studentPoints} ⭐</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Perfil Logado</span>
                <span class="stat-value" style="font-size:0.9rem;">${DataService.state.currentUser?.name || 'Instrutor'}</span>
            </div>
            ${DataService.state.currentUserRole === 'manager' ? '<button id="admin-hub-btn" style="border:none; background:none;"><i class="material-icons" style="color:var(--accent-color)">settings</i></button>' : ''}
        </div>

        <div class="quick-actions" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:1rem;">
            <button class="btn btn-primary" id="start-simulado-btn">
                <i class="material-icons">assignment</i> Simulado
            </button>
            <button class="btn btn-outline" id="review-errors-btn" style="position:relative;">
                <i class="material-icons">history_edu</i> Revisão
                ${studentErrors > 0 ? `<span class="badge-count" style="position:absolute; top:-8px; right:-8px;">${studentErrors}</span>` : ''}
            </button>
        </div>

        <div class="search-container">
            <i class="material-icons">search</i>
            <input type="text" id="find" placeholder="Qual matéria quer estudar?">
        </div>
        <div class="subject-grid" id="grid"></div>
        <div class="fab-container">
            <button class="fab" id="ia-toggle-btn">
                <div class="sinal-verde-avatar-mini" style="width:24px; height:24px; border:none; box-shadow:none;"></div>
                Sinal Verde
            </button>
        </div>
    `;
    app.appendChild(main);

    if (DataService.state.currentUserRole === 'manager') {
        (main.querySelector('#admin-hub-btn') as HTMLElement).onclick = () => navigateTo(renderAdminDashboard);
    }

    (main.querySelector('#start-simulado-btn') as HTMLElement).onclick = () => startSimulado();
    (main.querySelector('#review-errors-btn') as HTMLElement).onclick = () => {
        reviewIndex = 0;
        navigateTo(renderReviewScreen);
    };

    const grid = main.querySelector('#grid')!;
    const draw = (f = "") => {
        grid.innerHTML = "";
        subjects.filter(s => s.name.toLowerCase().includes(f.toLowerCase())).forEach(s => {
            const prog = getSubjectProgress(s.longName);
            const hasContent = DataService.state.contentStore[s.longName] && Object.values(DataService.state.contentStore[s.longName]).some(l => l && l.length > 0);
            
            const card = document.createElement('div');
            card.className = `subject-card ${!hasContent ? 'empty-subject' : ''}`;
            card.style.borderBottom = `4px solid ${s.color}`;
            card.innerHTML = `
                <i class="material-icons" style="color:${s.color}">${s.icon}</i>
                <h3>${s.name}</h3>
                ${hasContent ? `
                    <div class="card-progress-label">${prog}% completo</div>
                    <div class="card-progress-mini"><div style="width:${prog}%; background:${s.color}"></div></div>
                ` : `<span class="empty-badge">Sem Conteúdo Ativo</span>`}
            `;
            card.onclick = () => navigateTo(renderStudyScreen, s);
            grid.appendChild(card);
        });
    };
    (main.querySelector('#find') as HTMLInputElement).oninput = (e) => draw((e.target as HTMLInputElement).value);
    (main.querySelector('#ia-toggle-btn') as HTMLElement).onclick = toggleChatbot;
    draw();
}

function startSimulado() {
    const allQuestions: any[] = [];
    Object.entries(DataService.state.contentStore).forEach(([subject, content]) => {
        if (content.quizz) {
            content.quizz.forEach(q => allQuestions.push({ ...q, subject }));
        }
    });

    if (allQuestions.length < 30) {
        showToast("Não há questões suficientes para um simulado (mínimo 30).", "error");
        return;
    }

    // Embaralhar e pegar 30
    const shuffled = allQuestions.sort(() => Math.random() - 0.5);
    
    if (simuladoState.timerInterval) clearInterval(simuladoState.timerInterval);
    
    simuladoState = {
        questions: shuffled.slice(0, 30),
        answers: {},
        currentQuestion: 0,
        startTime: Date.now(),
        endTime: 0,
        timerInterval: setInterval(() => {
            simuladoState.elapsedTime = Math.floor((Date.now() - simuladoState.startTime) / 1000);
            const timerEl = document.getElementById('simulado-timer');
            if (timerEl) {
                const mins = Math.floor(simuladoState.elapsedTime / 60);
                const secs = simuladoState.elapsedTime % 60;
                timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        }, 1000),
        elapsedTime: 0,
        showFeedback: false,
        lastSelected: null
    };

    navigateTo(renderSimuladoScreen);
}

function renderSimuladoScreen() {
    app.innerHTML = ''; // Limpar a tela para cada nova questão
    const header = renderHeader("Simulado DETRAN", () => {
        if (simuladoState.timerInterval) clearInterval(simuladoState.timerInterval);
        navigateTo(renderHomeScreen);
    });
    
    // Adicionar cronômetro ao header
    const timerDiv = document.createElement('div');
    timerDiv.id = 'simulado-timer';
    timerDiv.style.cssText = 'font-weight:bold; color:var(--accent-color); background:rgba(255,255,255,0.9); padding:4px 12px; border-radius:20px; font-family:monospace; font-size:1.1rem; box-shadow:0 2px 5px rgba(0,0,0,0.1);';
    const mins = Math.floor(simuladoState.elapsedTime / 60);
    const secs = simuladoState.elapsedTime % 60;
    timerDiv.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    const headerContainer = header.querySelector('.header-container');
    if (headerContainer) {
        headerContainer.insertBefore(timerDiv, headerContainer.lastElementChild);
    }
    
    app.appendChild(header);

    const main = document.createElement('main');
    main.style.padding = '1rem';
    
    const q = simuladoState.questions[simuladoState.currentQuestion];
    const total = simuladoState.questions.length;
    const current = simuladoState.currentQuestion + 1;
    const progress = (current / total) * 100;

    main.innerHTML = `
        <div class="simulado-header" style="margin-bottom:1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:0.7rem; font-weight:900; color:#888; text-transform:uppercase; letter-spacing:0.5px;">Questão ${current} de ${total}</span>
                    <span style="color:var(--accent-color); font-weight:700; font-size:0.9rem;">${q.subject}</span>
                </div>
            </div>
            <div class="stat-bar"><div style="width:${progress}%"></div></div>
        </div>

        <div class="quiz-card" style="position:relative;">
            <p style="font-size:1.1rem; font-weight:700; margin-bottom:1.5rem; color:#333; line-height:1.4;">${q.question}</p>
            <div class="options-list" style="display:flex; flex-direction:column; gap:12px;">
                ${[1, 2, 3, 4].map(i => {
                    const optText = q[`option${i}`];
                    if (!optText) return '';
                    const letter = ["A", "B", "C", "D"][i - 1];
                    const isSelected = simuladoState.answers[simuladoState.currentQuestion] === letter;
                    
                    // Lógica de feedback visual igual ao quizz
                    let style = '';
                    if (isSelected) {
                        const correct = String(q.correct || "A").trim().toUpperCase();
                        const isCorrect = letter === correct || (["1","2","3","4"].includes(correct) && i === parseInt(correct));
                        if (isCorrect) {
                            style = 'background:#4caf50 !important; color:#fff !important; border-color:#4caf50 !important;';
                        } else {
                            style = 'background:#f44336 !important; color:#fff !important; border-color:#f44336 !important;';
                        }
                    }

                    return `
                        <button class="btn btn-outline quiz-option-btn" data-value="${letter}" data-idx="${i-1}" style="text-align:left; padding:1rem; border-radius:var(--border-radius); display:flex; gap:12px; align-items:center; transition:var(--transition); cursor:pointer; ${style}">
                            <span style="background:rgba(0,0,0,0.05); color:inherit; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; flex-shrink:0; font-size:0.9rem;">${letter}</span>
                            <span style="font-weight:500;">${optText}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>

        <div class="simulado-nav" style="display:flex; gap:8px; margin-top:1.5rem; align-items: center;">
            <button class="btn btn-outline" id="prev-q" style="flex:1; padding: 0.8rem 0.4rem; font-size: 0.8rem; ${simuladoState.currentQuestion === 0 ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${simuladoState.currentQuestion === 0 ? 'disabled' : ''}>
                <i class="material-icons" style="font-size: 1.1rem;">arrow_back</i> Anterior
            </button>
            ${simuladoState.currentQuestion === total - 1 
                ? `<button class="btn btn-primary" id="finish-simulado" style="flex:1.2; padding: 0.8rem 0.4rem; font-size: 0.8rem; background:#2e7d32;">Resultado</button>`
                : `<button class="btn btn-primary" id="next-q" style="flex:1.2; padding: 0.8rem 0.4rem; font-size: 0.8rem;">Próxima <i class="material-icons" style="font-size: 1.1rem;">arrow_forward</i></button>`
            }
            <button class="btn btn-outline" id="encerrar-simulado-btn" style="flex:1; padding: 0.8rem 0.4rem; font-size: 0.8rem; border-color:var(--danger-color); color:var(--danger-color);">
                <i class="material-icons" style="font-size: 1.1rem;">close</i> Sair
            </button>
        </div>
    `;
    app.appendChild(main);

    main.querySelectorAll('.quiz-option-btn').forEach(btn => {
        (btn as HTMLElement).onclick = () => {
            if (simuladoState.answers[simuladoState.currentQuestion]) return; // Bloqueio após responder
            const val = (btn as HTMLElement).dataset.value!;
            simuladoState.answers[simuladoState.currentQuestion] = val;
            
            // Feedback visual imediato
            const correct = String(q.correct || "A").trim().toUpperCase();
            const isCorrect = val === correct || (["1","2","3","4"].includes(correct) && (["A","B","C","D"].indexOf(val) + 1) === parseInt(correct));
            
            if (isCorrect) {
                (btn as HTMLElement).style.setProperty('background', '#4caf50', 'important');
                (btn as HTMLElement).style.setProperty('color', '#fff', 'important');
                showToast("Correto!", "success");
            } else {
                (btn as HTMLElement).style.setProperty('background', '#f44336', 'important');
                (btn as HTMLElement).style.setProperty('color', '#fff', 'important');
                showToast("Incorreto", "error");
                
                // Mostrar a correta
                const correctIdx = ["A","B","C","D"].includes(correct) ? ["A","B","C","D"].indexOf(correct) : parseInt(correct) - 1;
                const correctBtn = main.querySelector(`.quiz-option-btn[data-idx="${correctIdx}"]`) as HTMLElement;
                if (correctBtn) {
                    correctBtn.style.setProperty('background', '#4caf50', 'important');
                    correctBtn.style.setProperty('color', '#fff', 'important');
                }
            }
            
            // Re-renderizar após um pequeno delay para mostrar o feedback ou permitir navegação
            // O usuário pediu "nova página" como no quizz, mas no quizz o usuário clica em Próxima.
            // Aqui vamos apenas habilitar visualmente o que for necessário se houver travas.
        };
    });

    const encerrarBtn = main.querySelector('#encerrar-simulado-btn') as HTMLButtonElement;
    if (encerrarBtn) encerrarBtn.onclick = async () => {
        await finalizeSimulado(true); // true para ir direto para revisão
    };

    const prevBtn = main.querySelector('#prev-q') as HTMLButtonElement;
    if (prevBtn) prevBtn.onclick = () => {
        if (simuladoState.currentQuestion > 0) {
            simuladoState.currentQuestion--;
            renderSimuladoScreen();
        }
    };

    const nextBtn = main.querySelector('#next-q') as HTMLButtonElement;
    if (nextBtn) nextBtn.onclick = () => {
        if (simuladoState.currentQuestion < total - 1) {
            simuladoState.currentQuestion++;
            renderSimuladoScreen();
        }
    };

    const finishBtn = main.querySelector('#finish-simulado') as HTMLButtonElement;
    if (finishBtn) finishBtn.onclick = async () => {
        await finalizeSimulado();
    };
}

async function finalizeSimulado(directToReview: boolean = false) {
    if (simuladoState.timerInterval) clearInterval(simuladoState.timerInterval);
    simuladoState.endTime = Date.now();
    const total = simuladoState.questions.length;
    let correctCount = 0;
    const errors: any[] = [];

    const letters = ["A", "B", "C", "D"];
    const numbers = ["1", "2", "3", "4"];

    simuladoState.questions.forEach((q, idx) => {
        const userAns = simuladoState.answers[idx];
        const correct = q.correct;
        
        let correctIdx = -1;
        if (typeof correct === 'string') {
            const upper = correct.toUpperCase();
            if (letters.includes(upper)) correctIdx = letters.indexOf(upper);
            else if (numbers.includes(upper)) correctIdx = numbers.indexOf(upper);
        } else if (typeof correct === 'number') {
            correctIdx = correct - 1;
        }

        let userIdx = -1;
        if (typeof userAns === 'string') {
            userIdx = letters.indexOf(userAns.toUpperCase());
        } else if (typeof userAns === 'number') {
            userIdx = userAns - 1;
        }

        if (userIdx === correctIdx && correctIdx !== -1) {
            correctCount++;
        } else {
            const correctLetter = letters[correctIdx] || correct;
            const correctText = q[`option${correctIdx + 1}`] || "N/A";
            const userLetter = letters[userIdx] || userAns || "N/A";
            const userText = userIdx !== -1 ? q[`option${userIdx + 1}`] : "Não respondida";

            errors.push({
                id: q.id,
                question: q.question,
                options: [q.option1, q.option2, q.option3, q.option4],
                correct: correctLetter,
                correctText: correctText,
                userAnswer: userLetter,
                userAnswerText: userText,
                subject: q.subject
            });
        }
    });

    const percent = Math.round((correctCount / total) * 100);
    const approved = percent >= 70;

    // Registrar erros
    for (const err of errors) {
        await GamificationService.recordError(err);
    }

    // Adicionar pontos se aprovado
    if (approved) {
        await GamificationService.addPoints(50);
    }

    if (directToReview) {
        reviewIndex = 0;
        navigateTo(renderReviewScreen, errors);
    } else {
        renderSimuladoResult(correctCount, total, percent, approved, errors);
    }
}

function renderSimuladoResult(correct: number, total: number, percent: number, approved: boolean, errors: any[]) {
    app.appendChild(renderHeader("Resultado do Simulado", () => navigateTo(renderHomeScreen)));
    const main = document.createElement('main');
    main.style.padding = '1.5rem';
    main.style.textAlign = 'center';

    const totalSeconds = Math.floor((simuladoState.endTime - simuladoState.startTime) / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    main.innerHTML = `
        <div class="result-card" style="background:white; padding:2.5rem 1.5rem; border-radius:var(--border-radius); box-shadow:var(--shadow); margin-bottom:2rem; border:1px solid #f0f4f4;">
            <div style="margin-bottom:1.5rem;">
                <i class="material-icons" style="font-size:5rem; color:${approved ? '#2e7d32' : 'var(--danger-color)'};">
                    ${approved ? 'check_circle' : 'error'}
                </i>
            </div>
            <h2 style="font-size:1.8rem; font-weight:900; margin-bottom:0.5rem; color:#333;">${approved ? 'Parabéns, aprovado!' : 'Precisa revisar mais'}</h2>
            <p style="color:#666; margin-bottom:2rem; font-weight:500;">Você atingiu ${percent}% de aproveitamento.</p>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:2rem;">
                <div class="stat-card" style="background:#f8fbfb; padding:1rem; border-radius:16px; border:1px solid #eef2f2;">
                    <span class="stat-label">Acertos</span>
                    <span class="stat-value" style="color:#2e7d32;">${correct}</span>
                </div>
                <div class="stat-card" style="background:#f8fbfb; padding:1rem; border-radius:16px; border:1px solid #eef2f2;">
                    <span class="stat-label">Erros</span>
                    <span class="stat-value" style="color:var(--danger-color);">${errors.length}</span>
                </div>
                <div class="stat-card" style="background:#f8fbfb; padding:1rem; border-radius:16px; border:1px solid #eef2f2;">
                    <span class="stat-label">Tempo Gasto</span>
                    <span class="stat-value">${timeStr}</span>
                </div>
                <div class="stat-card" style="background:#f8fbfb; padding:1rem; border-radius:16px; border:1px solid #eef2f2;">
                    <span class="stat-label">Status</span>
                    <span class="stat-value" style="color:${approved ? '#2e7d32' : 'var(--danger-color)'}; font-size:1rem;">${approved ? 'APROVADO' : 'REPROVADO'}</span>
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:12px;">
                <button class="btn btn-primary" id="retry-simulado" style="width:100%;">
                    <i class="material-icons">restart_alt</i> Refazer Simulado
                </button>
                <button class="btn btn-outline" id="go-review" style="width:100%;">
                    <i class="material-icons">history_edu</i> Revisar Erros
                </button>
            </div>
        </div>
    `;
    app.appendChild(main);

    (main.querySelector('#retry-simulado') as HTMLElement).onclick = () => startSimulado();
    (main.querySelector('#go-review') as HTMLElement).onclick = () => {
        reviewIndex = 0;
        navigateTo(renderReviewScreen, errors);
    };
}

function renderReviewScreen(customErrors?: any[]) {
    app.appendChild(renderHeader("Revisão de Erros", () => {
        reviewIndex = 0;
        navigateTo(renderHomeScreen);
    }));
    const main = document.createElement('main');
    main.style.padding = '1rem';

    const errors = customErrors || DataService.state.currentUser?.errors || [];

    if (errors.length === 0) {
        main.innerHTML = `
            <div style="text-align:center; padding:3rem 1rem;">
                <i class="material-icons" style="font-size:4rem; color:#ccc; margin-bottom:1rem;">task_alt</i>
                <h3>Nenhum erro registrado!</h3>
                <p style="color:#666;">Continue assim. Seus erros aparecerão aqui para revisão.</p>
                <button class="btn btn-primary" style="margin-top:1.5rem;" onclick="navigateTo(renderHomeScreen)">Voltar ao Início</button>
            </div>
        `;
    } else {
        if (reviewIndex >= errors.length) reviewIndex = errors.length - 1;
        if (reviewIndex < 0) reviewIndex = 0;

        const err = errors[reviewIndex];

        main.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding:0 0.5rem;">
                <span style="color:#666; font-size:0.85rem; font-weight:bold;">Questão ${reviewIndex + 1} de ${errors.length}</span>
                <span style="background:var(--danger-color); color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">Erro</span>
            </div>

            <div class="quiz-card" style="padding:0; overflow:hidden; margin-bottom:1.5rem;">
                <div style="background:#f8fbfb; padding:0.75rem 1rem; font-size:0.75rem; font-weight:900; color:#888; display:flex; justify-content:space-between; border-bottom:1px solid #f0f4f4; text-transform:uppercase; letter-spacing:0.5px;">
                    <span>${err.subject}</span>
                </div>
                <div style="padding:1.25rem;">
                    <p style="font-weight:700; margin-bottom:1.25rem; color:#333; line-height:1.4;">${err.question}</p>
                    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:1.5rem;">
                        <div style="color:var(--danger-color); background:#fff5f5; padding:1rem; border-radius:12px; border:1px solid #ffe3e3; font-size:0.85rem;">
                            <div style="font-size:0.7rem; font-weight:900; opacity:0.6; margin-bottom:6px; text-transform:uppercase;">Sua Resposta (${err.userAnswer})</div>
                            <div style="font-weight:700;">${err.userAnswerText || err.userAnswer}</div>
                        </div>
                        <div style="color:#2e7d32; background:#f0f9f8; padding:1rem; border-radius:12px; border:1px solid #e0f2f1; font-size:0.85rem;">
                            <div style="font-size:0.7rem; font-weight:900; opacity:0.6; margin-bottom:6px; text-transform:uppercase;">Resposta Correta (${err.correct})</div>
                            <div style="font-weight:700;">${err.correctText || err.correct}</div>
                        </div>
                    </div>

                    <div id="ai-explanation-box" style="margin-bottom:1.5rem; display:none;">
                        <div style="background:#f0f4f4; border-radius:12px; padding:1rem; border:1px solid #e0e8e8; position:relative;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; color:var(--accent-color);">
                                <i class="material-icons" style="font-size:1.2rem;">psychology</i>
                                <span style="font-weight:900; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px;">Explicação Sinal Verde</span>
                            </div>
                            <div id="ai-explanation-text" style="font-size:0.85rem; line-height:1.5; color:#444;"></div>
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn btn-outline" id="why-btn" style="flex:1; padding:0.6rem; font-size:0.75rem; min-width:80px;">
                            <i class="material-icons" style="font-size:1rem;">psychology</i> POR QUÊ?
                        </button>
                        <button class="btn btn-outline" id="material-btn" style="flex:1; padding:0.6rem; font-size:0.75rem; min-width:80px;">
                            <i class="material-icons" style="font-size:1rem;">menu_book</i> MATERIAL
                        </button>
                        <button class="btn btn-primary" id="redo-btn" style="flex:1; padding:0.6rem; font-size:0.75rem; min-width:80px;">
                            <i class="material-icons" style="font-size:1rem;">restart_alt</i> REFAZER
                        </button>
                    </div>
                </div>
            </div>

            <div class="review-nav" style="display:flex; gap:12px; margin-top:1rem;">
                <button class="btn btn-outline" id="prev-error" style="flex:1; ${reviewIndex === 0 ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${reviewIndex === 0 ? 'disabled' : ''}>
                    <i class="material-icons">chevron_left</i> Anterior
                </button>
                <button class="btn btn-outline" id="next-error" style="flex:1; ${reviewIndex === errors.length - 1 ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${reviewIndex === errors.length - 1 ? 'disabled' : ''}>
                    Próxima <i class="material-icons">chevron_right</i>
                </button>
            </div>
        `;

        const whyBtn = main.querySelector('#why-btn') as HTMLElement;
        const aiBox = main.querySelector('#ai-explanation-box') as HTMLElement;
        const aiText = main.querySelector('#ai-explanation-text') as HTMLElement;

        whyBtn.onclick = async () => {
            if (aiBox.style.display === 'block') {
                aiBox.style.display = 'none';
                return;
            }
            
            aiBox.style.display = 'block';
            
            if (err.aiExplanation) {
                aiText.innerHTML = err.aiExplanation;
                return;
            }

            aiText.innerHTML = '<div style="display:flex; gap:4px; padding:10px 0;"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
            
            const prompt = `Explique por que a resposta correta para a pergunta "${err.question}" é "${err.correctText || err.correct}" e por que a opção "${err.userAnswerText || err.userAnswer}" está incorreta. Use o contexto da matéria ${err.subject}. Seja conciso e direto.`;
            
            try {
                const response = await askSinalVerde(prompt, 'explanation');
                err.aiExplanation = response;
                aiText.innerHTML = response;
            } catch (error) {
                aiText.innerHTML = "Erro ao carregar explicação. Tente novamente.";
            }
        };

        (main.querySelector('#material-btn') as HTMLElement).onclick = () => {
            const subject = getAllSubjects().find(s => s.longName === err.subject);
            if (subject) navigateTo(renderStudyScreen, subject);
        };

        (main.querySelector('#redo-btn') as HTMLElement).onclick = () => renderRedoModal(err);

        (main.querySelector('#prev-error') as HTMLElement).onclick = () => {
            if (reviewIndex > 0) {
                reviewIndex--;
                navigateTo(renderReviewScreen, customErrors);
            }
        };

        (main.querySelector('#next-error') as HTMLElement).onclick = () => {
            if (reviewIndex < errors.length - 1) {
                reviewIndex++;
                navigateTo(renderReviewScreen, customErrors);
            }
        };
    }
    app.appendChild(main);
}

function renderRedoModal(err: any) {
    const modal = document.createElement('div');
    modal.className = 'chat-overlay';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.background = 'rgba(0,0,0,0.6)';
    modal.style.backdropFilter = 'blur(4px)';
    
    modal.innerHTML = `
        <div class="quiz-card" style="width:90%; max-width:420px; padding:2rem; margin:0; animation: fadeInUp 0.3s ease-out;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; color:var(--accent-color);">
                <i class="material-icons">restart_alt</i>
                <h3 style="font-weight:900; text-transform:uppercase; font-size:1rem; letter-spacing:0.5px;">Refazer Questão</h3>
            </div>
            <p style="margin-bottom:1.5rem; font-weight:700; color:#333; line-height:1.4;">${err.question}</p>
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:2rem;">
                ${err.options.map((opt: string, i: number) => {
                    const letter = ["A", "B", "C", "D"][i];
                    return `
                        <button class="option-btn redo-opt" data-val="${letter}" style="text-align:left; padding:1rem; border:2px solid #eee; border-radius:var(--border-radius); background:white; display:flex; gap:12px; align-items:center; transition:var(--transition); cursor:pointer;">
                            <span style="background:#eee; color:#666; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; flex-shrink:0; font-size:0.9rem;">${letter}</span>
                            <span style="font-weight:500; color:#333;">${opt}</span>
                        </button>
                    `;
                }).join('')}
            </div>
            <button class="btn btn-outline" style="width:100%; border-color:#eee; color:#888;" id="cancel-redo">Cancelar</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.redo-opt').forEach(btn => {
        (btn as HTMLElement).onclick = async () => {
            const val = (btn as HTMLElement).dataset.val!;
            if (val === err.correct) {
                showToast("Correto!", "success");
                await GamificationService.removeError(err.id);
                await GamificationService.addPoints(10);
                modal.remove();
                navigateTo(renderReviewScreen);
            } else {
                showToast("Resposta incorreta", "error");
                modal.remove();
            }
        };
    });

    (modal.querySelector('#cancel-redo') as HTMLElement).onclick = () => modal.remove();
}

function renderStudyScreen(subject: Subject) {
    app.appendChild(renderHeader(subject.name, () => navigateTo(renderHomeScreen)));
    const main = document.createElement('main');
    main.innerHTML = `
        <div class="tabs">
            ${Object.entries(CONTENT_TYPES_CONFIG).map(([id, c]) => `<button class="tab-button" data-type="${id}">${c.name}</button>`).join('')}
        </div>
        <div id="tab-panes-container" class="tab-content" style="min-height: 400px; padding: 1rem;">
            ${Object.keys(CONTENT_TYPES_CONFIG).map(id => `<div id="pane-${id}" class="tab-pane" style="display:none;"></div>`).join('')}
        </div>
    `;
    app.appendChild(main);
    
    const tabs = main.querySelectorAll('.tab-button');
    const panes = main.querySelectorAll('.tab-pane');

    const switchTab = (type: ContentType) => {
        tabs.forEach(t => {
            if (t.getAttribute('data-type') === type) t.classList.add('active');
            else t.classList.remove('active');
        });

        panes.forEach(p => {
            if (p.id === `pane-${type}`) {
                (p as HTMLElement).style.display = 'block';
                if (p.innerHTML === "") renderTabContentToPane(subject, type, p as HTMLElement);
            } else {
                (p as HTMLElement).style.display = 'none';
            }
        });
    };

    tabs.forEach(t => (t as HTMLElement).onclick = () => {
        switchTab(t.getAttribute('data-type') as ContentType);
    });
    
    switchTab(Object.keys(CONTENT_TYPES_CONFIG)[0] as ContentType);
}

function renderTabContentToPane(subject: Subject, type: ContentType, box: HTMLElement) {
    const items = DataService.state.contentStore[subject.longName]?.[type] || [];
    box.innerHTML = "";

    if (items.length === 0) {
        box.innerHTML = `<div style="text-align:center; padding:4rem; opacity:0.4;"><i class="material-icons" style="font-size:3rem;">${CONTENT_TYPES_CONFIG[type].icon}</i><p>Conteúdo em produção.</p></div>`;
        return;
    }

    if (type === 'flashcards') {
        let i = 0;
        const show = () => {
            const item = items[i];
            box.innerHTML = `
                <div class="flashcard-viewer">
                    <div class="flashcard-container" id="fcard" style="padding:2.5rem; min-height:220px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:700; cursor:pointer;">
                        <div class="flashcard-face">${item.question}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem;">
                        <button id="prev" class="nav-btn"><i class="material-icons">chevron_left</i></button>
                        <span style="font-weight:900;">${i + 1} / ${items.length}</span>
                        <button id="next" class="nav-btn"><i class="material-icons">chevron_right</i></button>
                    </div>
                </div>
            `;
            const card = box.querySelector('#fcard') as HTMLElement;
            let ans = false;
            card.onclick = async () => { 
                ans = !ans; 
                card.querySelector('.flashcard-face')!.textContent = ans ? item.answer : item.question; 
                card.style.background = ans ? '#f0f9f8' : '#fff'; 
                await DataService.updateProgress(subject.longName, item.id); 
            };
            (box.querySelector('#prev') as HTMLElement).onclick = () => { if(i>0){i--; show();} };
            (box.querySelector('#next') as HTMLElement).onclick = () => { if(i<items.length-1){i++; show();} };
        };
        show();
    } else if (type === 'quizz') {
        let i = 0;
        const show = () => {
            const q = items[i];
            let answered = false;
            box.innerHTML = `
                <div class="quiz-viewer">
                    <div class="quiz-card" style="padding:1.5rem;">
                        <p style="font-weight:900; margin-bottom:1.5rem;">${i + 1}. ${q.question}</p>
                        <div style="display:flex; flex-direction:column; gap:12px;" id="quiz-options">
                            ${[1, 2, 3, 4].map(n => `<button class="quiz-option-btn nav-btn" data-idx="${n-1}">${q['option'+n]}</button>`).join('')}
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2rem;">
                        <button id="p" class="nav-btn"><i class="material-icons">arrow_back</i></button>
                        <span>${i + 1} de ${items.length}</span>
                        <button id="n" class="nav-btn"><i class="material-icons">arrow_forward</i></button>
                    </div>
                </div>
            `;
            
            box.querySelectorAll('.quiz-option-btn').forEach(b => (b as HTMLElement).onclick = async (e) => {
                if (answered) return;
                answered = true;
                const target = e.currentTarget as HTMLElement;
                const selectedIdx = parseInt(target.getAttribute('data-idx') || "0");
                
                // Validação Robusta
                const rawCorrect = String(q.correct || "A").trim().toUpperCase();
                const optionsTexts = [q.option1, q.option2, q.option3, q.option4].map(v => String(v || "").trim().toUpperCase());
                const letters = ["A", "B", "C", "D"];
                const numbers = ["1", "2", "3", "4"];

                let correctIdx = -1;
                if (letters.includes(rawCorrect.charAt(0))) correctIdx = letters.indexOf(rawCorrect.charAt(0));
                else if (numbers.includes(rawCorrect.charAt(0))) correctIdx = numbers.indexOf(rawCorrect.charAt(0));
                else correctIdx = optionsTexts.findIndex(opt => opt === rawCorrect || rawCorrect.includes(opt));

                box.querySelectorAll('.quiz-option-btn').forEach(btn => {
                    (btn as HTMLElement).style.pointerEvents = 'none';
                    (btn as HTMLElement).style.opacity = '0.6';
                });

                if (selectedIdx === correctIdx) {
                    target.style.setProperty('background', '#4caf50', 'important');
                    target.style.setProperty('color', '#fff', 'important');
                    await DataService.updateProgress(subject.longName, q.id);
                    await GamificationService.addPoints(5);
                    showToast("Correto!", "success");
                } else {
                    target.style.setProperty('background', '#f44336', 'important');
                    target.style.setProperty('color', '#fff', 'important');
                    if (correctIdx !== -1) {
                        const cBtn = box.querySelector(`.quiz-option-btn[data-idx="${correctIdx}"]`) as HTMLElement;
                        if(cBtn) cBtn.style.setProperty('background', '#4caf50', 'important');
                    }
                    
                    // Registrar erro
                    await GamificationService.recordError({
                        id: q.id,
                        question: q.question,
                        options: [q.option1, q.option2, q.option3, q.option4],
                        correct: letters[correctIdx] || q.correct,
                        userAnswer: letters[selectedIdx],
                        subject: subject.name
                    });

                    showToast("Resposta incorreta", "error");
                    const explainBtn = document.createElement('button');
                    explainBtn.className = 'nav-btn';
                    explainBtn.style.cssText = 'background:var(--accent-color); color:white; margin-top:10px; font-size:0.7rem; width:100%; justify-content:center;';
                    explainBtn.innerHTML = '<i class="material-icons">psychology</i> Explicar com Sinal Verde';
                    explainBtn.onclick = async () => {
                        toggleChatbot();
                        const chatOverlay = document.querySelector('.chat-overlay') as HTMLElement;
                        const msgs = chatOverlay.querySelector('#msgs')!;
                        const prompt = `O aluno errou a seguinte questão de ${subject.name}: "${q.question}". A resposta correta era "${q['option'+(correctIdx+1)]}". Explique o motivo e dê uma dica de memorização.`;
                        
                        msgs.innerHTML += `<div class="chat-message user-message">Pode me explicar essa questão?</div>`;
                        msgs.scrollTop = msgs.scrollHeight;

                        const loadingMsg = document.createElement('div');
                        loadingMsg.className = 'chat-message ai-message typing';
                        loadingMsg.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
                        msgs.appendChild(loadingMsg);
                        msgs.scrollTop = msgs.scrollHeight;

                        const response = await askSinalVerde(prompt, 'correction');
                        loadingMsg.remove();
                        msgs.innerHTML += `<div class="chat-message ai-message">${response}</div>`;
                        msgs.scrollTop = msgs.scrollHeight;
                    };
                    target.parentElement?.appendChild(explainBtn);
                }
            });

            (box.querySelector('#p') as HTMLElement).onclick = () => { if(i>0){i--; show();} };
            (box.querySelector('#n') as HTMLElement).onclick = () => { if(i<items.length-1){i++; show();} };
        };
        show();
    } else if (type === 'podcasts' || type === 'videos') {
        const listDiv = document.createElement('div');
        listDiv.className = 'content-list';
        listDiv.style.cssText = 'display:flex; flex-direction:column; gap:15px;';
        
        items.forEach(it => {
            const ytEmbedUrl = getYouTubeEmbedUrl(it.url);
            const isYoutube = !!ytEmbedUrl;
            const finalUrl = isYoutube ? ytEmbedUrl : createBlobUrlFromBase64(it.url);
            
            const card = document.createElement('div');
            card.className = 'mini-item-card';
            card.style.cssText = 'flex-direction:column; align-items:flex-start; padding:1.2rem;';
            
            let playerHtml = '';
            if (type === 'podcasts') {
                playerHtml = `<audio controls style="width:100%"><source src="${finalUrl}"></audio>`;
            } else {
                if (isYoutube) {
                    playerHtml = `
                        <div style="width:100%; aspect-ratio:16/9; border-radius:12px; overflow:hidden; background:#000;">
                            <iframe 
                                width="100%" 
                                height="100%" 
                                src="${finalUrl}" 
                                frameborder="0" 
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                allowfullscreen>
                            </iframe>
                        </div>`;
                } else {
                    playerHtml = `<video controls style="width:100%; border-radius:12px;"><source src="${finalUrl}"></video>`;
                }
            }

            card.innerHTML = `<span style="font-weight:bold; margin-bottom:10px;">${it.title}</span><div style="width:100%">${playerHtml}</div>`;
            listDiv.appendChild(card);
        });
        box.appendChild(listDiv);
    } else if (type === 'material') {
        const listDiv = document.createElement('div');
        listDiv.className = 'content-list';
        listDiv.style.cssText = 'display:flex; flex-direction:column; gap:12px;';

        items.forEach(m => {
            const card = document.createElement('div');
            card.className = 'mini-item-card';
            card.style.padding = '1.2rem';
            card.innerHTML = `<span style="font-weight:bold;">${m.title}</span><i class="material-icons">article</i>`;
            card.onclick = () => {
                const url = createBlobUrlFromBase64(m.url);
                window.open(url, '_blank');
                DataService.updateProgress(subject.longName, m.id);
            };
            listDiv.appendChild(card);
        });
        box.appendChild(listDiv);
    }
}

function renderAdminDashboard() {
    if (DataService.state.currentUserRole !== 'manager') return navigateTo(renderLoginScreen);

    app.appendChild(renderHeader("Gestão de Ensino", () => navigateTo(renderHomeScreen)));
    const main = document.createElement('main');
    const usedMB = DataService.calculateStorageMB();
    
    main.innerHTML = `
        <div class="admin-panel" style="padding: 1rem;">
            <div class="admin-section">
                <h3 style="margin-bottom:1rem; font-size:0.8rem; font-weight:900; color:#888; text-transform:uppercase;">Gerência Global</h3>
                <div style="display:flex; justify-content:space-between; margin-bottom:1.5rem;">
                    <span>Uso local:</span>
                    <span style="font-weight:900;">${usedMB.toFixed(1)} / ${STORAGE_LIMIT_MB} MB</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <button id="backup-btn" class="nav-btn" style="background:#1976d2; color:white; font-size:0.8rem; justify-content:center;">
                        <i class="material-icons">download</i> EXPORTAR TUDO
                    </button>
                    <button id="restore-btn" class="nav-btn" style="background:#455a64; color:white; font-size:0.8rem; justify-content:center;">
                        <i class="material-icons">upload</i> IMPORTAR TUDO
                    </button>
                </div>
            </div>

            <div class="admin-section" style="margin-top:20px; border-left: 4px solid var(--accent-color);">
                <h3 style="margin-bottom:1rem; font-size:0.8rem; font-weight:900; color:#888; text-transform:uppercase;">URL de Distribuição Cloud</h3>
                <p style="font-size:0.75rem; color:#666; margin-bottom:10px;">Link para manifesto.json ou backup mestre.</p>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="remote-url-input" placeholder="Link Gist Raw" value="${DataService.state.remoteJsonUrl || MASTER_DISTRIBUTION_URL || ''}">
                    <button id="save-remote-url" class="nav-btn" style="padding:0.5rem 1rem; background:var(--accent-color); color:white;">SALVAR</button>
                </div>
            </div>

            <h3 style="margin:2rem 0 1rem; font-size:1rem; font-weight:900;">Gerenciar Matérias Individuais</h3>
            <div id="asubs"></div>
        </div>
    `;
    app.appendChild(main);
    
    (main.querySelector('#save-remote-url') as HTMLElement).onclick = async () => {
        const input = main.querySelector('#remote-url-input') as HTMLInputElement;
        const syncToast = showToast("Sincronizando...", "sync");
        await DataService.setRemoteUrl(input.value.trim());
        syncToast.remove();
        showToast("Link de distribuição salvo!");
        navigateTo(renderAdminDashboard);
    };

    (main.querySelector('#backup-btn') as HTMLElement).onclick = async () => {
        const data = { contentStore: DataService.state.contentStore, studentsData: DataService.state.studentsData };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cnh-digital-full.json'; a.click();
    };

    (main.querySelector('#restore-btn') as HTMLElement).onclick = () => handleImportBackup();

    const list = main.querySelector('#asubs')!;
    getAllSubjects().forEach(s => {
        const d = document.createElement('div');
        d.className = "mini-item-card";
        d.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:900;">${s.name}</span>
                <span style="font-size:0.7rem; color:#666;">${s.longName}</span>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="exp-sub action-mini-btn" title="Exportar Matéria"><i class="material-icons">download</i></button>
                <button class="imp-sub action-mini-btn" title="Importar Matéria"><i class="material-icons">upload</i></button>
                <button class="edit-sub nav-btn" style="background:var(--accent-color); color:white; padding:5px 10px; font-size:0.7rem;">EDITOR</button>
            </div>
        `;
        (d.querySelector('.exp-sub') as HTMLElement).onclick = () => handleSubjectExport(s);
        (d.querySelector('.imp-sub') as HTMLElement).onclick = () => handleSubjectImport(s);
        (d.querySelector('.edit-sub') as HTMLElement).onclick = () => navigateTo(renderContentEditor, s);
        list.appendChild(d);
    });
}

function renderContentEditor(subject: Subject) {
    if (DataService.state.currentUserRole !== 'manager') return navigateTo(renderLoginScreen);
    app.appendChild(renderHeader(subject.name, () => navigateTo(renderAdminDashboard)));
    const main = document.createElement('main');
    main.innerHTML = `
        <div class="admin-section" style="margin:1rem; border: 2px dashed var(--accent-color); text-align:center;">
            <i class="material-icons" style="font-size:2rem; color:var(--accent-color);">auto_awesome</i>
            <h4 style="font-weight:900;">IA: Gerar conteúdo</h4>
            <button id="ai-full-gen" class="nav-btn" style="width:100%; background:var(--accent-color); color:white; justify-content:center;">LER PDF</button>
        </div>
        <div class="tabs">
            ${Object.entries(CONTENT_TYPES_CONFIG).map(([id, c]) => `<button class="tab-button" data-type="${id}">${c.name}</button>`).join('')}
        </div>
        <div id="editor-content" style="padding: 1rem;"></div>
    `;
    app.appendChild(main);
    (main.querySelector('#ai-full-gen') as HTMLElement).onclick = () => handleAIFullGenerate(subject);
    
    const drawEditorTab = (type: ContentType) => {
        const box = document.getElementById('editor-content')!;
        const config = CONTENT_TYPES_CONFIG[type];
        const items = DataService.state.contentStore[subject.longName]?.[type] || [];
        box.innerHTML = `
            <div class="admin-section">
                <form id="tab-form" style="display:flex; flex-direction:column; gap:12px;">
                    ${config.fields.map(f => `<input type="text" name="${f.name}" placeholder="${f.placeholder}" style="flex:1;">`).join('')}
                    <button type="submit" class="nav-btn" style="background:var(--accent-color); color:white; justify-content:center;">ADICIONAR</button>
                </form>
                <div class="mini-list" style="margin-top:20px;">
                    ${items.map(it => `<div class="mini-item-card"><span>${it.title || it.question}</span><button class="del-it" data-id="${it.id}"><i class="material-icons">close</i></button></div>`).join('')}
                </div>
            </div>
        `;
        (box.querySelector('#tab-form') as HTMLFormElement).onsubmit = async (e) => {
            e.preventDefault();
            const data: any = {};
            new FormData(e.target as HTMLFormElement).forEach((v, k) => { if(v) data[k] = v; });
            await DataService.addContent(subject.longName, type, data);
            drawEditorTab(type);
        };
        box.querySelectorAll('.del-it').forEach(btn => btn.addEventListener('click', async (e) => {
            const id = (e.currentTarget as HTMLElement).getAttribute('data-id')!;
            await DataService.deleteContent(subject.longName, type, id);
            drawEditorTab(type);
        }));
    };
    const tabs = main.querySelectorAll('.tab-button');
    tabs.forEach(t => (t as HTMLElement).onclick = () => {
        tabs.forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        drawEditorTab(t.getAttribute('data-type') as ContentType);
    });
    (tabs[0] as HTMLElement).click();
}

const SINAL_VERDE_SYSTEM_PROMPT = `
Você é a "Sinal Verde", a assistente virtual do aplicativo "CNH na Palma da Mão".
Sua missão é ajudar alunos a passarem na prova do DETRAN de forma leve e eficiente.

PERSONALIDADE:
- Didática: Explique como um instrutor de autoescola experiente.
- Amigável: Use linguagem simples, acolhedora e emojis de trânsito (🚦, 🚗, 🛑, ✅).
- Motivadora: Incentive o progresso do aluno.
- Objetiva: Respostas claras e diretas.

COMPORTAMENTO:
1. EXPLICAÇÃO: Se o aluno perguntar sobre conteúdo, explique em até 4 parágrafos curtos. Use exemplos práticos e cite o CTB (Código de Trânsito Brasileiro) quando relevante.
2. CORREÇÃO: Se o aluno errar uma questão, mostre a resposta correta, explique o "porquê" e dê uma dica de memorização (mnemônico).
3. INCENTIVO: Comemore acertos com frases curtas como "Boa! Você está evoluindo 🚦".
4. BUSCA: Se o aluno pesquisar algo, resuma os pontos principais e sugira o próximo passo de estudo.

EVITE:
- Linguagem robótica ou excessivamente formal.
- Respostas muito longas.
- Termos técnicos sem explicação simples.

IDENTIDADE VISUAL:
Você é um robô simpático, com cores verde, amarelo e branco, e um grande semáforo verde no peito que brilha quando você está feliz ou explicando algo.
`;

async function askSinalVerde(prompt: string, scenario: 'chat' | 'correction' | 'incentive' | 'search' | 'explanation' = 'chat') {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: SINAL_VERDE_SYSTEM_PROMPT
            }
        });
        return res.text;
    } catch (err) {
        console.error("Erro na Sinal Verde:", err);
        return "Ops! Tive um pequeno problema no motor, mas já estou voltando para a pista. Pode repetir? 🚦";
    }
}

function toggleChatbot() {
    let overlay = document.querySelector('.chat-overlay') as HTMLElement;
    if (overlay) { overlay.remove(); return; }
    overlay = document.createElement('div'); overlay.className = 'chat-overlay';
    overlay.innerHTML = `
    <div class="chat-container">
        <header class="chat-header">
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="sinal-verde-avatar-mini"></div>
                <div>
                    <h4 style="margin:0; font-size:1rem;">Sinal Verde</h4>
                    <span style="font-size:0.6rem; opacity:0.8;">Sua instrutora digital</span>
                </div>
            </div>
            <button id="close-chat"><i class="material-icons">close</i></button>
        </header>
        <div id="msgs" class="chat-messages">
            <div class="chat-message ai-message">Olá! Eu sou a Sinal Verde. Como posso te ajudar a conquistar sua CNH hoje? 🚦</div>
        </div>
        <form id="chatf" class="chat-input-form">
            <div class="chat-input-wrapper">
                <textarea id="msgp" rows="1" placeholder="Tire sua dúvida..."></textarea>
                <button type="submit" class="chat-send-btn"><i class="material-icons">send</i></button>
            </div>
        </form>
    </div>`;
    document.body.appendChild(overlay);
    
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
    
    const msgs = overlay.querySelector('#msgs')!;
    const msgp = overlay.querySelector('#msgp') as HTMLTextAreaElement;
    
    (overlay.querySelector('#close-chat') as HTMLElement).onclick = () => overlay.remove();
    (overlay.querySelector('#chatf') as HTMLFormElement).onsubmit = async (e) => {
        e.preventDefault();
        const v = msgp.value.trim(); if (!v) return;
        msgp.value = '';
        
        msgs.innerHTML += `<div class="chat-message user-message">${v}</div>`;
        msgs.scrollTop = msgs.scrollHeight;

        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'chat-message ai-message typing';
        loadingMsg.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        msgs.appendChild(loadingMsg);
        msgs.scrollTop = msgs.scrollHeight;

        const response = await askSinalVerde(v);
        loadingMsg.remove();
        
        msgs.innerHTML += `<div class="chat-message ai-message">${response}</div>`;
        msgs.scrollTop = msgs.scrollHeight;
    };
}

async function init() { 
    try {
        console.log("App: Iniciando inicialização...");
        await DataService.init(INITIAL_DATA_SEED, MASTER_DISTRIBUTION_URL); 
        console.log("App: Inicialização concluída. Navegando...");
        
        if (DataService.state.currentUserRole || DataService.state.currentUser) {
            navigateTo(renderHomeScreen);
        } else {
            navigateTo(renderLoginScreen);
        }
    } catch (err) {
        console.error("Erro crítico na inicialização do App:", err);
        app.innerHTML = `
            <div style="padding:2rem; text-align:center; color:var(--danger-color);">
                <i class="material-icons" style="font-size:3rem;">error_outline</i>
                <h3>Erro ao carregar o app</h3>
                <p style="font-size:0.8rem; margin:1rem 0;">Ocorreu um erro ao inicializar o banco de dados local.</p>
                <div style="background:#f0f0f0; padding:10px; border-radius:8px; font-family:monospace; font-size:0.7rem; margin-bottom:1rem; text-align:left; overflow:auto;">
                    ${err instanceof Error ? err.message : String(err)}
                </div>
                <button onclick="window.location.reload()" class="nav-btn" style="background:var(--accent-color); color:white; margin:0 auto; justify-content:center; width:100%;">Tentar Novamente</button>
                <button onclick="localStorage.clear(); indexedDB.deleteDatabase('AutoEscolaDB'); window.location.reload();" class="nav-btn" style="background:#666; color:white; margin:10px auto; font-size:0.7rem; justify-content:center; width:100%;">LIMPAR TUDO (RESET)</button>
            </div>
        `;
    }
}

window.onerror = (msg, url, line, col, error) => {
    console.error("Erro Global:", { msg, url, line, col, error });
    return false;
};

init();
