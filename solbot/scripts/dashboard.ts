/**
 * Régénère le tableau de bord à partir des fichiers du bot (sans réseau, sans clé).
 *
 *   npm run dashboard   → <DATA_DIR>/dashboard.html, à ouvrir dans un navigateur
 */

import { loadConfig, loadDotEnv } from '../src/config.ts';
import { writeDashboard } from '../src/dashboard.ts';
import { systemClock } from '../src/lib/store.ts';

loadDotEnv();
const config = loadConfig();
console.log(`tableau de bord : ${writeDashboard(config.dataDir, config, systemClock)}`);
