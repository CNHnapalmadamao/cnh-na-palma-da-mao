
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export * from "./types";

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
