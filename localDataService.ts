
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Student, ContentStore, ContentType, ContentItem, SESSION_AUTH_KEY } from "./dataService";

const DB_NAME = 'AutoEscolaDB';
const DB_VERSION = 1;
const STORE_NAME = 'appState';
// Senha padrão ofuscada: '19101400'
const DEFAULT_MGR_PWD = atob('MTkxMDE0MDA=');
const MANAGER_PASSWORD = (process.env as any).VITE_MANAGER_PASSWORD || DEFAULT_MGR_PWD;

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
            let localData = await this._getFromDB('mainData');
            
            // Sincronização remota desativada para modelo 100% embutido
            // const effectiveUrl = (localData && localData.remoteJsonUrl) ? localData.remoteJsonUrl : masterUrl;

            if (!localData && seedData) {
                localData = seedData;
                await this._saveToDB('mainData', localData);
            }

            if (localData) {
                this.state.contentStore = localData.contentStore || {};
                this.state.studentsData = localData.studentsData || [];
                this.state.remoteJsonUrl = null; // Forçado nulo

                // MESCLAGEM INTELIGENTE: Adiciona itens do seedData que não existem no banco local (baseado no ID)
                if (seedData && seedData.contentStore) {
                    Object.keys(seedData.contentStore).forEach(subjectKey => {
                        if (!this.state.contentStore[subjectKey]) {
                            this.state.contentStore[subjectKey] = seedData.contentStore[subjectKey];
                        } else {
                            const localSubject = this.state.contentStore[subjectKey];
                            const seedSubject = seedData.contentStore[subjectKey];
                            
                            Object.keys(seedSubject).forEach(type => {
                                const contentType = type as ContentType;
                                if (!localSubject[contentType]) {
                                    localSubject[contentType] = seedSubject[contentType];
                                } else {
                                    const localItems = localSubject[contentType] || [];
                                    const seedItems = seedSubject[contentType] || [];
                                    
                                    // Adiciona itens novos ou atualiza existentes (pelo ID)
                                    seedItems.forEach((sItem: any) => {
                                        const existingIdx = localItems.findIndex((lItem: any) => lItem.id === sItem.id);
                                        if (existingIdx === -1) {
                                            localItems.push(sItem);
                                        } else {
                                            // Atualiza o item local com os metadados do seed (ex: novas descrições)
                                            localItems[existingIdx] = { ...localItems[existingIdx], ...sItem };
                                        }
                                    });
                                }
                            });
                        }
                    });
                    // Salva a mesclagem no DB
                    await this.sync();
                }
            }
            
            const saved = sessionStorage.getItem(SESSION_AUTH_KEY);
            if (saved) {
                const { role, userId } = JSON.parse(saved);
                this.state.currentUserRole = role;
                if (role === 'student' && userId) {
                    this.state.currentUser = this.state.studentsData.find(s => s.id === userId) || null;
                }
            }
        } catch (e) {
            console.error("LocalDataService Init Error", e);
        }
    },

    async syncFromRemote(url: string): Promise<boolean> {
        // Funcionalidade desativada para garantir app 100% offline
        console.warn("Sincronização remota desativada.");
        return false;
    },

    async restoreSubjectBackup(subjectName: string, content: any): Promise<void> {
        this.state.contentStore[subjectName] = content;
        await this.sync();
    },

    async restoreBackup(data: any): Promise<void> {
        if (!data || !data.contentStore) throw new Error("Backup inválido");
        this.state.contentStore = data.contentStore;
        this.state.studentsData = data.studentsData || this.state.studentsData;
        this.state.remoteJsonUrl = data.remoteJsonUrl || this.state.remoteJsonUrl;
        await this.sync();
    },

    async setRemoteUrl(url: string): Promise<boolean> {
        // Funcionalidade desativada para garantir app 100% offline
        return false;
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

    async loginStudent(studentId: number): Promise<void> {
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
        const newStudent: Student = { id: Date.now(), name, studyTime: '0h', progress: {} };
        this.state.studentsData.push(newStudent);
        await this.sync();
        return newStudent;
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
            const bytes = encodeURI(JSON.stringify(this.state)).split(/%..|./).length - 1;
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
