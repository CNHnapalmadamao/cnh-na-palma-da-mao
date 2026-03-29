
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Student, ContentStore, ContentType, ContentItem, SESSION_AUTH_KEY } from "./types";

const DB_NAME = 'AutoEscolaDB';
const DB_VERSION = 1;
const STORE_NAME = 'appState';
const MANAGER_PASSWORD = (process.env as any).VITE_MANAGER_PASSWORD || '19101400';

export const LocalDataService = {
    state: {
        contentStore: {} as ContentStore,
        studentsData: [] as Student[],
        currentUser: null as Student | null,
        currentUserRole: null as 'student' | 'manager' | null,
        remoteJsonUrl: null as string | null,
    },

    async init(seedData: any = null, masterUrl: string | null = null) {
        try {
            console.log("LocalDataService: Iniciando...");
            let localData = await this._getFromDB('mainData').catch(() => null);
            
            const effectiveUrl = (localData && localData.remoteJsonUrl) ? localData.remoteJsonUrl : masterUrl;

            if (effectiveUrl) {
                if (localData) {
                    // Se já temos dados, sincronizamos em background para não travar o app
                    console.log("LocalDataService: Sincronizando em background...");
                    this.syncFromRemote(effectiveUrl).catch(e => console.warn("Background sync failed", e));
                } else {
                    // Se não temos nada, precisamos sincronizar agora (bloqueante)
                    console.log("LocalDataService: Sincronizando inicial (bloqueante)...");
                    await this.syncFromRemote(effectiveUrl);
                    localData = await this._getFromDB('mainData').catch(() => null);
                }
            }

            if (!localData && seedData) {
                localData = seedData;
                await this._saveToDB('mainData', localData);
            }

            if (localData) {
                this.state.contentStore = (localData.contentStore && typeof localData.contentStore === 'object') ? localData.contentStore : {};
                this.state.studentsData = Array.isArray(localData.studentsData) ? localData.studentsData : [];
                this.state.remoteJsonUrl = localData.remoteJsonUrl || effectiveUrl || null;
            } else {
                this.state.contentStore = {};
                this.state.studentsData = [];
            }
            
            const saved = sessionStorage.getItem(SESSION_AUTH_KEY);
            if (saved) {
                try {
                    const { role, userId } = JSON.parse(saved);
                    this.state.currentUserRole = role;
                    if (role === 'student' && userId) {
                        this.state.currentUser = this.state.studentsData.find(s => s.id === userId) || null;
                    }
                } catch (e) { console.warn("Erro ao ler sessão salva"); }
            }
            console.log("LocalDataService: Pronto.");
        } catch (e) {
            console.error("LocalDataService Init Error", e);
            throw e; // Repassa o erro para o index.tsx tratar
        }
    },

    async syncFromRemote(url: string) {
        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const data = await response.json();

            if (data.isManifest && data.parts) {
                // Sincronização paralela das partes para ser mais rápido
                const promises = data.parts.map(async (partUrl: string) => {
                    try {
                        const pr = await fetch(partUrl);
                        if (pr.ok) {
                            const partData = await pr.json();
                            if (partData.subject && partData.contentStore) {
                                const subjectKey = partData.subject;
                                this.state.contentStore[subjectKey] = partData.contentStore[subjectKey];
                            } else if (partData.contentStore) {
                                Object.assign(this.state.contentStore, partData.contentStore);
                            }
                        }
                    } catch (err) {
                        console.error("Erro ao carregar parte do manifesto:", partUrl);
                    }
                });
                await Promise.all(promises);
            } else {
                this.state.contentStore = data.contentStore || this.state.contentStore;
            }
            
            this.state.remoteJsonUrl = url;
            await this.sync();
        } catch (e) {
            console.warn("Falha na sincronização remota.");
        }
    },

    async restoreSubjectBackup(subjectName: string, content: any): Promise<void> {
        this.state.contentStore[subjectName] = content;
        await this.sync();
    },

    async restoreBackup(data: any): Promise<void> {
        if (!data || !data.contentStore) throw new Error("Backup inválido: contentStore ausente.");
        
        // Garantir que contentStore seja um objeto
        this.state.contentStore = (typeof data.contentStore === 'object') ? data.contentStore : {};
        
        // Garantir que studentsData seja um array
        this.state.studentsData = Array.isArray(data.studentsData) ? data.studentsData : [];
        
        this.state.remoteJsonUrl = data.remoteJsonUrl || this.state.remoteJsonUrl;
        await this.sync();
    },

    async setRemoteUrl(url: string): Promise<void> {
        this.state.remoteJsonUrl = url;
        if (url) {
            await this.syncFromRemote(url);
        }
        await this.sync();
    },

    async loginManager(password: string): Promise<boolean> {
        if (password === MANAGER_PASSWORD) {
            this.state.currentUserRole = 'manager';
            this.state.currentUser = null;
            sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify({ role: 'manager' }));
            return true;
        }
        return false;
    },

    async loginStudent(studentId: string): Promise<void> {
        const student = this.state.studentsData.find(s => s.id === studentId);
        if (student) {
            this.state.currentUser = student;
            this.state.currentUserRole = 'student';
            sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify({ role: 'student', userId: studentId }));
        }
    },

    logout() {
        this.state.currentUser = null;
        this.state.currentUserRole = null;
        sessionStorage.removeItem(SESSION_AUTH_KEY);
    },

    async createStudent(name: string): Promise<Student> {
        const newStudent: Student = { 
            id: String(Date.now()), 
            name, 
            studyTime: '0h', 
            progress: {}, 
            errors: [], 
            points: 0 
        };
        this.state.studentsData.push(newStudent);
        await this.sync();
        return newStudent;
    },

    async recordError(error: any): Promise<void> {
        if (!this.state.currentUser) return;
        if (!this.state.currentUser.errors) this.state.currentUser.errors = [];
        
        // Evitar duplicatas de erro para a mesma questão
        const exists = this.state.currentUser.errors.find(e => e.id === error.id);
        if (!exists) {
            this.state.currentUser.errors.push({
                ...error,
                timestamp: Date.now()
            });
            await this.sync();
        }
    },

    async removeError(errorId: string): Promise<void> {
        if (!this.state.currentUser || !this.state.currentUser.errors) return;
        this.state.currentUser.errors = this.state.currentUser.errors.filter(e => e.id !== errorId);
        await this.sync();
    },

    async addPoints(points: number): Promise<void> {
        if (!this.state.currentUser) return;
        this.state.currentUser.points = (this.state.currentUser.points || 0) + points;
        await this.sync();
    },

    async updateProgress(subjectLongName: string, contentId: string): Promise<void> {
        if (!this.state.currentUser) return;
        if (!this.state.currentUser.progress[subjectLongName]) {
            this.state.currentUser.progress[subjectLongName] = { completed: [] };
        }
        const completed = this.state.currentUser.progress[subjectLongName].completed;
        if (!completed.includes(contentId)) {
            completed.push(contentId);
            await this.sync();
        }
    },

    async addContent(subjectLongName: string, type: ContentType, item: any): Promise<void> {
        if (!this.state.contentStore[subjectLongName]) this.state.contentStore[subjectLongName] = {};
        if (!this.state.contentStore[subjectLongName][type]) this.state.contentStore[subjectLongName][type] = [];
        const newItem = { id: this._generateId(), ...item };
        this.state.contentStore[subjectLongName][type]!.push(newItem);
        await this.sync();
    },

    async deleteContent(subjectLongName: string, type: ContentType, itemId: string): Promise<void> {
        if (this.state.contentStore[subjectLongName]?.[type]) {
            this.state.contentStore[subjectLongName][type] = 
                this.state.contentStore[subjectLongName][type]!.filter(it => it.id !== itemId);
            await this.sync();
        }
    },

    async sync() {
        const data = {
            contentStore: this.state.contentStore,
            studentsData: this.state.studentsData,
            remoteJsonUrl: this.state.remoteJsonUrl
        };
        await this._saveToDB('mainData', data);
    },

    calculateStorageMB(): number {
        try {
            const str = JSON.stringify(this.state);
            const bytes = new TextEncoder().encode(str).length;
            return bytes / 1048576;
        } catch (e) { return 0; }
    },

    _generateId(): string {
        return Date.now().toString() + Math.random().toString(36).substring(2, 11);
    },

    async _openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async _saveToDB(key: string, value: any) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },

    async _getFromDB(key: string): Promise<any> {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
};
