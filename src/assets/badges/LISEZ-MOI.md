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

## Taille

256 x 256 suffit : la plus grande vignette de l'application fait 52 px, et un
ecran a deux fois la densite en demande 104. Au-dela, on transporte des pixels
que personne ne verra.
