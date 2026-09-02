/// <reference types="vite/client" />

/** Version du paquet, injectee au moment de la compilation par Vite. */
declare const __APP_VERSION__: string;
/** Notes de la version en cours, extraites de `NOUVEAUTES.md` a la compilation. */
declare const __APP_NOTES__: string;

/**
 * Les notes de toutes les versions recentes, de la plus neuve a la plus ancienne.
 *
 * Ce qui permet de montrer ce qu'on a manque, et non seulement la derniere :
 * qui saute trois versions n'apprenait jamais ce que les deux intermediaires
 * avaient apporte.
 */
declare const __APP_HISTORIQUE__: { version: string; notes: string }[];
