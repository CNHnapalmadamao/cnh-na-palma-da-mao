
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { DataService, Subject, ContentType, ContentItem } from "./dataService";
import { loadAllSubjects } from "./src/loaders/subjectLoader";

/** 
 * URL DE DISTRIBUIÇÃO MESTRE:
 * Definido como './manifest.json' para carregar os arquivos locais embutidos no app.
 */
const MASTER_DISTRIBUTION_URL: string | null = null; 

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
    theme: localStorage.getItem('theme') || 'light',
};

// --- SERVICES ---
const ThemeService = {
    init() {
        document.documentElement.setAttribute('data-theme', state.theme);
    },
    toggle() {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', state.theme);
        document.documentElement.setAttribute('data-theme', state.theme);
    }
};

const GamificationService = {
    getPoints(): number {
        if (!DataService.state.currentUser) return 0;
        const key = `points_${DataService.state.currentUser.id}`;
        return parseInt(localStorage.getItem(key) || '0');
    },
    addPoints(amount: number) {
        if (!DataService.state.currentUser) return;
        const key = `points_${DataService.state.currentUser.id}`;
        const current = this.getPoints();
        localStorage.setItem(key, (current + amount).toString());
    },
    getLevel(): string {
        const points = this.getPoints();
        if (points < 200) return "Condutor Iniciante";
        if (points < 500) return "Condutor em Treinamento";
        if (points < 1000) return "Condutor Consciente";
        return "Mestre do Volante";
    },
    recordError(question: any, subject: string, userAnswer: any) {
        if (!DataService.state.currentUser) return;
        const key = `errors_${DataService.state.currentUser.id}`;
        const errors = JSON.parse(localStorage.getItem(key) || '[]');
        const existingIdx = errors.findIndex((e: any) => e.id === question.id);
        if (existingIdx > -1) {
            errors[existingIdx] = { ...question, subject, lastUserAnswer: userAnswer };
        } else {
            errors.push({ ...question, subject, lastUserAnswer: userAnswer });
        }
        localStorage.setItem(key, JSON.stringify(errors));
    },
    getErrors(): any[] {
        if (!DataService.state.currentUser) return [];
        const key = `errors_${DataService.state.currentUser.id}`;
        return JSON.parse(localStorage.getItem(key) || '[]');
    },
    removeError(id: string) {
        if (!DataService.state.currentUser) return;
        const key = `errors_${DataService.state.currentUser.id}`;
        const errors = this.getErrors().filter((e: any) => e.id !== id);
        localStorage.setItem(key, JSON.stringify(errors));
    }
};

const SearchService = {
    async getExplanation(query: string, context: any[]): Promise<string> {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const model = "gemini-3-flash-preview";
            
            const contextText = context.map(c => `Matéria: ${c.subject}\nTítulo: ${c.title}\nConteúdo: ${c.text}`).join('\n---\n');
            
            const prompt = `Você é o Assistente de Estudo "Sinal Verde" para alunos de autoescola.
O usuário perguntou: "${query}"

Com base no material didático abaixo, forneça uma explicação clara, didática e resumida (máximo 4 parágrafos) respondendo à pergunta do usuário.
Se a informação não estiver no material, use seu conhecimento geral sobre o Código de Trânsito Brasileiro (CTB) para explicar, mas mencione que é uma explicação geral.

MATERIAL DIDÁTICO DISPONÍVEL:
${contextText || "Nenhum material específico encontrado."}

Responda em Português do Brasil.`;

            const response = await ai.models.generateContent({
                model,
                contents: [{ parts: [{ text: prompt }] }]
            });
            
            return response.text || "Desculpe, não consegui gerar uma explicação no momento.";
        } catch (err) {
            console.error("Erro no Gemini:", err);
            return "Ocorreu um erro ao tentar explicar o conteúdo. Por favor, tente novamente.";
        }
    },

    search(query: string): { title: string; text: string; subject: string }[] {
        const results: { title: string; text: string; subject: string }[] = [];
        const normalizedQuery = normalizeText(query);
        if (!normalizedQuery) return [];

        const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

        Object.entries(DataService.state.contentStore).forEach(([subject, content]) => {
            const materials = content.material || [];
            materials.forEach(m => {
                const title = normalizeText(m.title || "");
                const text = normalizeText(m.text || "");
                const description = normalizeText(m.description || "");
                const contentText = normalizeText(m.content || "");

                const combined = `${title} ${text} ${description} ${contentText} ${normalizeText(subject)}`;
                
                let score = 0;
                if (combined.includes(normalizedQuery)) {
                    score += 10; // Exact phrase match
                } else {
                    queryWords.forEach(word => {
                        if (combined.includes(word)) score += 2;
                    });
                }

                if (score > 0) {
                    results.push({
                        title: m.title,
                        text: m.text || m.description || m.content || "Conteúdo disponível no material didático.",
                        subject: subject,
                        score: score
                    } as any);
                }
            });
        });
        
        return results.sort((a: any, b: any) => b.score - a.score);
    }
};

// --- HELPERS ---
function shuffleArray(array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function normalizeText(text: string): string {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

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
    state.activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
    state.activeBlobUrls = [];
    app.innerHTML = '';
    renderFunc(...args);
    window.scrollTo(0, 0);
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
    showToast("A geração de conteúdo via IA (PDF) está desativada no modo 100% offline.", "error");
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
                showToast("Backup restaurado com sucesso!");
                navigateTo(renderHomeScreen);
            } catch (err) {
                showToast("Arquivo de backup inválido.", "error");
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
                    await DataService.restoreSubjectBackup(subjectKey, content);
                    showToast(`Conteúdo de ${subject.name} importado!`);
                    navigateTo(renderAdminDashboard);
                } else {
                    showToast("Formato de arquivo modular inválido.", "error");
                }
            } catch (err) {
                showToast("Erro ao ler JSON.", "error");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// --- RENDERERS ---
const app = document.getElementById('app')!;

function renderHeader(title: string, backFunc?: Function) {
    const header = document.createElement('header');
    header.innerHTML = `
        <div class="header-container">
            <h1 style="font-size:1rem; max-width: 50%; font-weight:900; letter-spacing:-0.5px; text-transform: uppercase;">${title}</h1>
            <div class="header-actions">
                <button id="theme-toggle-btn" class="header-action-btn" aria-label="Alternar Tema"><i class="material-icons">${state.theme === 'light' ? 'dark_mode' : 'light_mode'}</i></button>
                <button id="search-assistant-btn" class="header-action-btn" aria-label="Assistente de Estudo"><i class="material-icons">psychology</i></button>
                ${backFunc ? '<button id="back-nav-btn" class="header-action-btn" aria-label="Voltar"><i class="material-icons">arrow_back</i></button>' : ''}
                <button id="logout-btn" class="header-action-btn" aria-label="Sair"><i class="material-icons">logout</i></button>
            </div>
        </div>
    `;
    (header.querySelector('#theme-toggle-btn') as HTMLElement).onclick = () => {
        ThemeService.toggle();
        const icon = header.querySelector('#theme-toggle-btn i')!;
        icon.textContent = state.theme === 'light' ? 'dark_mode' : 'light_mode';
    };
    (header.querySelector('#search-assistant-btn') as HTMLElement).onclick = () => renderSearchAssistant();
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

function renderHomeScreen() {
    app.appendChild(renderHeader("CNH na palma da mão"));
    const main = document.createElement('main');
    
    let totalProgress = 0;
    const subjects = getAllSubjects();
    subjects.forEach(s => totalProgress += getSubjectProgress(s.longName));
    const avgProgress = Math.round(totalProgress / (subjects.length || 1));

    const points = GamificationService.getPoints();
    const level = GamificationService.getLevel();

    main.innerHTML = `
        <div class="dashboard-stats">
            <div class="stat-card">
                <span class="stat-label">Progresso Total</span>
                <span class="stat-value">${avgProgress}%</span>
                <div class="stat-bar"><div style="width:${avgProgress}%"></div></div>
            </div>
            <div class="stat-card">
                <span class="stat-label">Pontuação e Nível</span>
                <span class="stat-value">${points} pts</span>
                <span class="stat-label" style="font-size:0.7rem; color:var(--accent-color); font-weight:bold;">${level}</span>
            </div>
            ${DataService.state.currentUserRole === 'manager' ? '<button id="admin-hub-btn" style="border:none; background:none;"><i class="material-icons" style="color:var(--accent-color)">settings</i></button>' : ''}
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; padding: 0 1rem; margin-bottom: 1.5rem;">
            <button id="simulado-btn" class="nav-btn" style="background:var(--accent-color); color:white; justify-content:center; font-size:0.8rem;">
                <i class="material-icons">assignment</i> SIMULADO DETRAN
            </button>
            <button id="review-btn" class="nav-btn" style="background:#f57c00; color:white; justify-content:center; font-size:0.8rem;">
                <i class="material-icons">history_edu</i> REVISAR ERROS
            </button>
        </div>

        <div class="search-container">
            <i class="material-icons">search</i>
            <input type="text" id="find" placeholder="Qual matéria quer estudar?">
        </div>
        <div class="subject-grid" id="grid"></div>
    `;
    app.appendChild(main);

    (main.querySelector('#simulado-btn') as HTMLElement).onclick = () => startSimulado();
    (main.querySelector('#review-btn') as HTMLElement).onclick = () => renderReviewScreen();

    if (DataService.state.currentUserRole === 'manager') {
        (main.querySelector('#admin-hub-btn') as HTMLElement).onclick = () => navigateTo(renderAdminDashboard);
    }

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
    draw();
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
                if (!ans) return; // Only count when showing answer
                const isNew = await DataService.updateProgress(subject.longName, item.id); 
                if (isNew !== false) GamificationService.addPoints(5);
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
                    const isNew = !DataService.state.currentUser?.progress[subject.longName]?.completed.includes(q.id);
                    await DataService.updateProgress(subject.longName, q.id);
                    if (isNew) GamificationService.addPoints(10);
                    showToast("Correto!", "success");
                } else {
                    target.style.setProperty('background', '#f44336', 'important');
                    target.style.setProperty('color', '#fff', 'important');
                    GamificationService.recordError(q, subject.longName);
                    if (correctIdx !== -1) {
                        const cBtn = box.querySelector(`.quiz-option-btn[data-idx="${correctIdx}"]`) as HTMLElement;
                        if(cBtn) cBtn.style.setProperty('background', '#4caf50', 'important');
                    }
                    showToast("Resposta incorreta", "error");
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

            <div class="admin-section" style="margin-top:20px; border-left: 4px solid #ccc; opacity: 0.5; pointer-events: none;">
                <h3 style="margin-bottom:1rem; font-size:0.8rem; font-weight:900; color:#888; text-transform:uppercase;">Distribuição Cloud (Desativado)</h3>
                <p style="font-size:0.75rem; color:#666; margin-bottom:10px;">O app está configurado para modo 100% offline.</p>
            </div>

            <h3 style="margin:2rem 0 1rem; font-size:1rem; font-weight:900;">Gerenciar Matérias Individuais</h3>
            <div id="asubs"></div>
        </div>
    `;
    app.appendChild(main);
    
    (main.querySelector('#save-remote-url') as HTMLElement).onclick = async () => {
        const input = main.querySelector('#remote-url-input') as HTMLInputElement;
        const syncToast = showToast("Sincronizando...", "sync");
        const success = await DataService.setRemoteUrl(input.value.trim());
        syncToast.remove();
        if (success) {
            showToast("Link de distribuição salvo!");
            navigateTo(renderHomeScreen);
        } else {
            showToast("Falha ao sincronizar com a URL fornecida.", "error");
        }
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
        <div class="admin-section" style="margin:1rem; border: 2px dashed #ccc; text-align:center; opacity: 0.5;">
            <i class="material-icons" style="font-size:2rem; color:#888;">auto_awesome</i>
            <h4 style="font-weight:900; color:#888;">IA: Gerar conteúdo (Desativado)</h4>
            <p style="font-size:0.7rem; color:#666;">A geração via PDF exige conexão com a nuvem.</p>
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

function renderSearchAssistant() {
    const overlay = document.createElement('div');
    overlay.className = 'chat-overlay';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.innerHTML = `
        <div class="chat-container" style="bottom: 50%; right: 50%; transform: translate(50%, 50%); height: 80vh; width: 90vw; max-width: 500px;">
            <div class="chat-header">
                <span style="font-weight:900;"><i class="material-icons" style="vertical-align:middle; margin-right:5px;">psychology</i> Assistente de Estudo</span>
                <button id="close-chat" style="background:none; border:none; color:white;"><i class="material-icons">close</i></button>
            </div>
            <div class="chat-messages" id="search-results" style="background:var(--primary-bg);">
                <div class="ai-message chat-message">Olá! Eu sou seu assistente offline. O que você gostaria de pesquisar no material didático?</div>
            </div>
            <div class="chat-input-form">
                <form id="search-form" class="chat-input-wrapper">
                    <input type="text" id="search-input" placeholder="Ex: Regras de ultrapassagem..." style="flex:1;">
                    <button type="submit" class="nav-btn" style="background:var(--accent-color); color:white; padding:10px;"><i class="material-icons">search</i></button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    overlay.querySelector('#close-chat')!.onclick = close;

    const resultsBox = overlay.querySelector('#search-results')!;
    (overlay.querySelector('#search-form') as HTMLFormElement).onsubmit = async (e) => {
        e.preventDefault();
        const input = overlay.querySelector('#search-input') as HTMLInputElement;
        const query = input.value;
        if (!query) return;

        resultsBox.innerHTML += `<div class="user-message chat-message">${query}</div>`;
        const results = SearchService.search(query);
        
        const loadingMsg = document.createElement('div');
        loadingMsg.className = "ai-message chat-message";
        loadingMsg.innerHTML = `<i class="material-icons spin">sync</i> Analisando material e preparando explicação...`;
        resultsBox.appendChild(loadingMsg);
        resultsBox.scrollTop = resultsBox.scrollHeight;

        const explanation = await SearchService.getExplanation(query, results);
        loadingMsg.remove();

        resultsBox.innerHTML += `
            <div class="ai-message chat-message" style="background: var(--card-bg); border-left: 4px solid var(--accent-color);">
                <div class="markdown-body" style="font-size:0.9rem; line-height:1.5;">
                    ${explanation.replace(/\n/g, '<br>')}
                </div>
                ${results.length > 0 ? `
                    <div style="margin-top:15px; padding-top:10px; border-top:1px solid rgba(0,0,0,0.1);">
                        <p style="font-size:0.7rem; font-weight:bold; opacity:0.7; margin-bottom:5px;">FONTES ENCONTRADAS NO MATERIAL:</p>
                        ${results.slice(0, 2).map(res => `
                            <div style="font-size:0.75rem; margin-bottom:5px;">
                                <span style="color:var(--accent-color); font-weight:bold;">[${res.subject}]</span> ${res.title}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;

        input.value = "";
        resultsBox.scrollTop = resultsBox.scrollHeight;
    };
}

let simuladoState = {
  questions: [] as any[],
  answers: {} as Record<number, any>,
  currentQuestion: 0
};

function startSimulado() {
    const allQuizzes: any[] = [];
    Object.entries(DataService.state.contentStore).forEach(([subject, content]) => {
        if (content.quizz) {
            content.quizz.forEach(q => allQuizzes.push({ ...q, subject }));
        }
    });

    if (allQuizzes.length < 30) {
        showToast("É necessário pelo menos 30 questões cadastradas para iniciar o simulado.", "error");
        return;
    }

    shuffleArray(allQuizzes);

    simuladoState = {
        questions: allQuizzes.slice(0, 30),
        answers: {},
        currentQuestion: 0
    };

    renderSimuladoQuestion();
}

function renderSimuladoQuestion() {
    app.innerHTML = "";
    app.appendChild(renderHeader(`Simulado - Questão ${simuladoState.currentQuestion + 1}/30`, () => {
        if(confirm("Deseja cancelar o simulado?")) navigateTo(renderHomeScreen);
    }));

    const q = simuladoState.questions[simuladoState.currentQuestion];
    const main = document.createElement('main');
    app.appendChild(main);

    const letters = ["A", "B", "C", "D"];

    main.innerHTML = `
        <div class="quiz-card" style="padding:1.5rem;">
            <p style="font-weight:bold; margin-bottom:1.5rem; font-size:1.1rem;">${q.question}</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
                ${[1, 2, 3, 4].map(n => `
                    <button class="quiz-option-btn nav-btn ${simuladoState.answers[simuladoState.currentQuestion] === letters[n-1] ? 'active-simulado' : ''}" data-value="${letters[n-1]}">
                        <span style="font-weight:bold; margin-right:10px;">${letters[n-1]})</span> ${q['option'+n]}
                    </button>
                `).join('')}
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:2rem; padding:0 1rem;">
            <button id="prev-q" class="nav-btn" ${simuladoState.currentQuestion === 0 ? 'disabled' : ''}>Anterior</button>
            <button id="finish-sim" class="nav-btn" style="background:var(--danger-color); color:white;">FINALIZAR</button>
            <button id="next-q" class="nav-btn" ${simuladoState.currentQuestion === 29 ? 'disabled' : ''}>Próxima</button>
        </div>
    `;

    main.querySelectorAll('.quiz-option-btn').forEach(btn => btn.onclick = (e) => {
        const val = (e.currentTarget as HTMLElement).getAttribute('data-value');
        simuladoState.answers[simuladoState.currentQuestion] = val;
        // Visual feedback immediate
        main.querySelectorAll('.quiz-option-btn').forEach(b => b.classList.remove('active-simulado'));
        (e.currentTarget as HTMLElement).classList.add('active-simulado');
        // Small delay before re-render to show selection
        setTimeout(() => renderSimuladoQuestion(), 100);
    });

    if (main.querySelector('#prev-q')) (main.querySelector('#prev-q') as HTMLElement).onclick = () => {
        simuladoState.currentQuestion--;
        renderSimuladoQuestion();
    };
    if (main.querySelector('#next-q')) (main.querySelector('#next-q') as HTMLElement).onclick = () => {
        simuladoState.currentQuestion++;
        renderSimuladoQuestion();
    };
    if (main.querySelector('#finish-sim')) (main.querySelector('#finish-sim') as HTMLElement).onclick = () => {
        finishSimulado();
    };
}

function finishSimulado() {
    let correct = 0;
    const total = 30;
    const normalize = (v: any) => String(v).trim().toUpperCase().charAt(0);

    simuladoState.questions.forEach((q, index) => {
        const userAnswer = simuladoState.answers[index];
        const correctAnswer = q.correct;

        if (userAnswer && normalize(userAnswer) === normalize(correctAnswer)) {
            correct++;
        } else {
            GamificationService.recordError(q, q.subject, userAnswer);
        }
    });

    const wrong = total - correct;
    const percentage = (correct / total) * 100;

    app.innerHTML = "";
    app.appendChild(renderHeader("Resultado do Simulado", () => navigateTo(renderHomeScreen)));
    const main = document.createElement('main');
    app.appendChild(main);

    main.innerHTML = `
        <div class="admin-section" style="text-align:center; padding:2rem;">
            <h2 style="margin-bottom:1rem;">Resultado do Simulado</h2>
            <div style="font-size:3rem; font-weight:900; color:${percentage >= 70 ? '#4caf50' : '#f44336'}; margin-bottom:1rem;">${Math.round(percentage)}%</div>
            <p style="font-size:1.2rem; font-weight:bold; margin-bottom:2rem;">Situação: ${percentage >= 70 ? 'APROVADO' : 'REPROVADO'}</p>
            <div style="display:flex; justify-content:space-around; margin-bottom:2rem; background:rgba(0,0,0,0.03); padding:1rem; border-radius:15px;">
                <div><p style="font-size:0.8rem; opacity:0.7;">Acertos</p><p style="font-size:1.5rem; font-weight:bold; color:#4caf50;">${correct}</p></div>
                <div style="width:1px; background:rgba(0,0,0,0.1);"></div>
                <div><p style="font-size:0.8rem; opacity:0.7;">Erros</p><p style="font-size:1.5rem; font-weight:bold; color:#f44336;">${wrong}</p></div>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button id="go-review" class="nav-btn" style="width:100%; justify-content:center; background:var(--accent-color); color:white;">
                    <i class="material-icons">history_edu</i> REVISAR ERROS
                </button>
                <button id="back-home" class="nav-btn" style="width:100%; justify-content:center; background:white; border:1px solid var(--border-color);">
                    <i class="material-icons">home</i> VOLTAR PARA HOME
                </button>
            </div>
        </div>
    `;

    main.querySelector('#go-review')!.onclick = () => renderReviewScreen();
    main.querySelector('#back-home')!.onclick = () => navigateTo(renderHomeScreen);
}

function renderReviewScreen() {
    app.innerHTML = "";
    app.appendChild(renderHeader("Revisar Erros", () => navigateTo(renderHomeScreen)));
    
    const errors = GamificationService.getErrors();
    const main = document.createElement('main');
    app.appendChild(main);

    if (errors.length === 0) {
        main.innerHTML = `<div style="padding:4rem; text-align:center; opacity:0.4;"><i class="material-icons" style="font-size:4rem;">check_circle</i><p>Parabéns! Você não tem erros para revisar.</p></div>`;
        return;
    }

    main.innerHTML = `
        <div style="padding:1rem;">
            <p style="margin-bottom:1.5rem; font-size:0.9rem; opacity:0.7;">Aqui estão as questões que você errou. Revise a explicação e tente novamente.</p>
            <div id="error-list"></div>
        </div>
    `;

    const list = main.querySelector('#error-list')!;
    errors.forEach(q => {
        const card = document.createElement('div');
        card.className = "quiz-card";
        card.style.padding = "1.5rem";
        
        const rawCorrect = String(q.correct || "A").trim().toUpperCase();
        const letters = ["A", "B", "C", "D"];
        const numbers = ["1", "2", "3", "4"];
        let correctIdx = -1;
        if (letters.includes(rawCorrect.charAt(0))) correctIdx = letters.indexOf(rawCorrect.charAt(0));
        else if (numbers.includes(rawCorrect.charAt(0))) correctIdx = numbers.indexOf(rawCorrect.charAt(0));
        
        const correctText = q['option' + (correctIdx + 1)];
        
        let lastUserAnswerText = "Não respondida";
        if (q.lastUserAnswer !== null && q.lastUserAnswer !== undefined) {
            if (typeof q.lastUserAnswer === 'number') {
                lastUserAnswerText = q['option' + (q.lastUserAnswer + 1)];
            } else if (typeof q.lastUserAnswer === 'string') {
                const idx = letters.indexOf(q.lastUserAnswer.toUpperCase());
                if (idx > -1) lastUserAnswerText = q['option' + (idx + 1)];
                else lastUserAnswerText = q.lastUserAnswer;
            }
        }

        card.innerHTML = `
            <p style="font-size:0.7rem; color:var(--accent-color); font-weight:bold; margin-bottom:5px; text-transform:uppercase;">${q.subject}</p>
            <p style="font-weight:bold; margin-bottom:1rem;">${q.question}</p>
            
            <div style="margin-bottom:1rem; font-size:0.9rem;">
                <div style="background:#ffebee; padding:0.8rem; border-radius:10px; margin-bottom:8px; border-left: 4px solid #f44336;">
                    <p style="font-size:0.7rem; font-weight:bold; color:#c62828; text-transform:uppercase; margin-bottom:2px;">Sua Resposta Anterior:</p>
                    <p style="color:#b71c1c;">${lastUserAnswerText}</p>
                </div>
                <div style="background:#e8f5e9; padding:0.8rem; border-radius:10px; border-left: 4px solid #4caf50;">
                    <p style="font-size:0.7rem; font-weight:bold; color:#2e7d32; text-transform:uppercase; margin-bottom:2px;">Resposta Correta:</p>
                    <p style="color:#1b5e20;">${correctText}</p>
                </div>
            </div>

            <div class="explanation-box" style="display:none; background:#fff3e0; padding:1rem; border-radius:12px; margin-bottom:1rem; border-left: 4px solid #ff9800; font-size:0.85rem;">
                <p style="font-weight:bold; color:#e65100; margin-bottom:5px;">Explicação da Sinal Verde:</p>
                <div class="explanation-text">Carregando explicação...</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <button class="nav-btn explain-btn" style="justify-content:center; background:white; border:1px solid #ddd; font-size:0.75rem;">
                    <i class="material-icons" style="font-size:1.1rem;">psychology</i> POR QUE?
                </button>
                <button class="nav-btn retry-btn" style="justify-content:center; background:var(--accent-color); color:white; font-size:0.75rem;">
                    <i class="material-icons" style="font-size:1.1rem;">refresh</i> REFAZER
                </button>
            </div>
        `;

        const explainBtn = card.querySelector('.explain-btn') as HTMLElement;
        const explanationBox = card.querySelector('.explanation-box') as HTMLElement;
        const explanationText = card.querySelector('.explanation-text') as HTMLElement;

        explainBtn.onclick = async () => {
            explanationBox.style.display = 'block';
            explainBtn.style.display = 'none';
            const explanation = await SearchService.getExplanation(`Explique por que a resposta correta para a pergunta "${q.question}" é "${correctText}" no contexto de ${q.subject}.`, []);
            explanationText.innerHTML = explanation.replace(/\n/g, '<br>');
        };

        card.querySelector('.retry-btn')!.onclick = () => {
            card.innerHTML = `
                <p style="font-weight:bold; margin-bottom:1.5rem;">${q.question}</p>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    ${[1, 2, 3, 4].map(n => `<button class="quiz-option-btn nav-btn" data-idx="${n-1}">${q['option'+n]}</button>`).join('')}
                </div>
            `;
            card.querySelectorAll('.quiz-option-btn').forEach(btn => btn.onclick = (e) => {
                const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-idx')!);
                if (idx === correctIdx) {
                    showToast("Correto agora! Removendo da revisão.");
                    GamificationService.removeError(q.id);
                    GamificationService.addPoints(5);
                    setTimeout(() => renderReviewScreen(), 1000);
                } else {
                    showToast("Ainda incorreto. Tente novamente.", "error");
                    (e.currentTarget as HTMLElement).style.background = "#f44336";
                    (e.currentTarget as HTMLElement).style.color = "white";
                }
            });
        };
        list.appendChild(card);
    });
}

async function init() { 
    ThemeService.init();
    let seedData = null;
    try {
        seedData = await loadAllSubjects();
    } catch (err) {
        console.error("Erro ao carregar matérias locais:", err);
    }
    
    await DataService.init(seedData, MASTER_DISTRIBUTION_URL); 

    // Registro do Service Worker para suporte PWA/Offline
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err => console.error('SW fail:', err));
        });
    }

    if (DataService.state.currentUserRole || DataService.state.currentUser) navigateTo(renderHomeScreen);
    else navigateTo(renderLoginScreen);
}

init();
