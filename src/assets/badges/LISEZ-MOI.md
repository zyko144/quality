# Les dessins des badges

Deposez ici un fichier par badge, **nomme d'apres la cle du badge** :

    pionnier.png
    premiere-heure.png
    equipe.png
    rapporteur.png
    espace-100.png     espace-10k.png     espace-100k.png    espace-1m.png
    messages-10k.png   messages-50k.png   messages-100k.png  messages-500k.png  messages-1m.png
    vocal-10.png       vocal-50.png       vocal-100.png      vocal-150.png      vocal-300.png
    vocal-500.png      vocal-1000.png     vocal-3000.png     vocal-5000.png
    anciennete-1an.png anciennete-3ans.png anciennete-5ans.png
    anciennete-7ans.png anciennete-10ans.png

Le nom est le seul lien entre le fichier et le badge : `vocal-500.png` s'affiche
sur « Voix — 500 h », sans une ligne de code a ecrire. Un nom qui ne correspond a
aucune cle ne s'affiche nulle part, et un badge sans fichier garde son dessin
vectoriel actuel. Les deux peuvent donc coexister le temps que la serie se
complete.

`.png`, `.webp` et `.svg` sont acceptes.

## Le fond doit etre transparent

Les dessins se posent sur la page, pas sur un carre. Une image livree avec son
fond sombre ferait une vignette noire sur le theme clair — exactement le defaut
qu'on vient de corriger ailleurs.

Pour detourer une image qui arrive sur fond sombre :

    python outils/detourer.py entree.png src/assets/badges/pionnier.png

L'outil estime le fond, garde la lueur en semi-transparence, recadre au dessin
et sort un carre de 256 px. Voir son en-tete pour les options.

## Ce qui est en place

Les dessins livres le 2 septembre 2026 sont poses et detoures. Leurs originaux
sont conserves dans `sources/`, pour pouvoir refaire le detourage sans les
redemander.

Deux series sont arrivees en quatre paliers pour cinq badges. Le dessin du haut
couvre donc deux marches, plutot que de laisser un badge en trace vectoriel au
milieu d'illustrations — un trou se voit davantage qu'une repetition :

    plumes-tier3      -> messages-100k ET messages-500k
    veteran-8ans-et+  -> anciennete-7ans ET anciennete-10ans

Deposer `messages-500k.png` et `anciennete-7ans.png` suffira a les separer.

**Manquent encore** : les neuf paliers de `vocal-*` et le badge `equipe`. Ils
gardent leur trace vectoriel en attendant, ce qui est le comportement prevu.

## Taille

256 x 256 suffit : la plus grande vignette de l'application fait 52 px, et un
ecran a deux fois la densite en demande 104. Au-dela, on transporte des pixels
que personne ne verra.
