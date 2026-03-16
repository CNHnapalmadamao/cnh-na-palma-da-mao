
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// --- DATA TYPES ---
export type Subject = { name: string; longName: string; icon: string; color: string; };
export type ContentItem = { id: string; [key: string]: any };
export type ContentType = 'flashcards' | 'podcasts' | 'videos' | 'quizz' | 'material';
export type ContentStore = {
    [subjectLongName: string]: {
        [contentType in ContentType]?: ContentItem[]
    }
};
export type StudentProgress = {
    [subjectLongName: string]: {
        completed: string[]; 
    }
};
export type Student = {
    id: number;
    name: string;
    studyTime: string;
    progress: StudentProgress;
};

export const SESSION_AUTH_KEY = 'autoEscolaAuth';

// --- ADAPTER / IMPLEMENTATION PICKER ---
import { LocalDataService } from "./localDataService";

/**
 * DataService Adapter
 * 
 * Atualmente exporta o LocalDataService (IndexedDB).
 * Para trocar para um Backend Real no futuro, basta:
 * 1. Criar um arquivo (ex: remoteDataService.ts) que implemente os mesmos métodos.
 * 2. Alterar a exportação abaixo para: export const DataService = RemoteDataService;
 */
export const DataService = LocalDataService;
