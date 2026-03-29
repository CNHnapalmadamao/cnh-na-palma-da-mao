
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
export type StudentError = {
    id: string;
    question: string;
    options: string[];
    correct: string | number;
    correctText?: string;
    userAnswer: string | number;
    userAnswerText?: string;
    subject: string;
    timestamp: number;
};

export type Student = {
    id: string; // Alterado para string para consistência com IDs gerados
    name: string;
    studyTime: string;
    progress: StudentProgress;
    errors: StudentError[];
    points: number;
};

export const SESSION_AUTH_KEY = 'autoEscolaAuth';
