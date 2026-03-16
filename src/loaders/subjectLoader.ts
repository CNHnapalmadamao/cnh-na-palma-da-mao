
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loader automático para matérias embutidas no projeto.
 * Carrega todos os arquivos JSON que possuem a estrutura de matéria.
 */
export async function loadAllSubjects() {
    // Carrega todos os arquivos JSON da pasta public
    const modules = import.meta.glob('@/public/*.json', { eager: true });
    const contentStore: Record<string, any> = {};

    for (const path in modules) {
        const data = (modules[path] as any);
        
        // Filtra apenas arquivos que possuem a estrutura de matéria (campo 'subject')
        // Isso evita carregar package.json, tsconfig.json, etc.
        if (data && data.subject) {
            const subjectName = data.subject;
            
            // Merge seguro do campo 'content' ou 'contentStore'
            // Suporta tanto o formato descrito no prompt ("content") quanto o formato real nos arquivos ("contentStore")
            const content = data.content || (data.contentStore ? data.contentStore[subjectName] : null);
            
            if (content) {
                // Normaliza a estrutura para garantir compatibilidade com o ContentStore
                contentStore[subjectName] = {
                    videos: content.videos || [],
                    podcasts: content.podcasts || [],
                    material: content.material || [],
                    quizz: content.quizz || [],
                    flashcards: content.flashcards || []
                };
            }
        }
    }

    return {
        contentStore,
        studentsData: [] // Retorna a estrutura esperada pelo LocalDataService.init()
    };
}
