# Nouveautes

Ce fichier est la source unique des notes de version.

Il sert deux fois : l'atelier de publication y prend le texte de la release
GitHub, et l'application y prend celui du message affiche au premier lancement
qui suit une mise a jour. Ecrire les notes a deux endroits garantissait qu'ils
finiraient par diverger.

Le format compte. Chaque version est un titre de niveau deux, `## x.y.z`, suivi
d'une liste a puces. Le premier titre rencontre est celui de la version en
cours ; l'outil de publication et l'application lisent tous deux la section
correspondant a leur numero de version.

## 0.2.7

- Le son des partages d'ecran n'arrivait toujours pas : la piste audio etait rangee selon une annonce qui voyage par un autre canal qu'elle, et rien ne garantit laquelle arrive d'abord. Quand l'audio precedait l'annonce, il etait pris pour une voix et ecrasait le micro. La presence d'une piste video dans le meme flux tranche desormais, sans dependre de l'ordre.
- Le curseur du son de partage s'affiche des que quelqu'un partage, grise s'il n'y a pas de son — plutot qu'absent sans explication. Un partage sans son est une case a cocher du cote de qui partage, et rien ne le disait.
- Le message des nouveautes s'affiche enfin. Il n'apparaissait que si la mise a jour etait passee par le bouton « Installer » de la banniere : installer le setup a la main ne rangeait rien, et rien ne s'affichait jamais. Il compare desormais la version qui tourne a la derniere vue.
- Les notes sont ecrites une seule fois, dans `NOUVEAUTES.md`, et servent a la fois a la page de publication et au message dans l'application. Les tenir a deux endroits garantissait qu'ils finiraient par se contredire.

## 0.2.6

- Une vraie suppression du bruit : RNNoise retire le clavier, la chaise et le ventilateur **pendant** qu'on parle. Une porte, elle, ne sait que couper entre les phrases — elle ne pouvait rien contre un clavier au milieu d'un mot, puisqu'a cet instant c'est la voix qui porte le niveau.
- La case « Isolation de la voix » etait sans effet : le moteur l'annonce supportee, puis rapporte `voiceIsolation: false` sur la piste obtenue. La demande etait acceptee et ignoree.
- Un seul ecran de demarrage. Il en restait un troisieme, dans l'espace de travail, qui attendait le chargement des espaces derriere le premier.
- Le message des nouveautes s'affiche au premier lancement qui suit une mise a jour, quelle que soit la facon dont elle est arrivee — y compris en installant le setup a la main.

## 0.2.5

- Le son des partages d'ecran s'entend : il arrivait dans le meme casier que la voix, et le dernier des deux effacait l'autre.
- Il a son propre curseur, distinct de celui de la voix. Il demarre a 75 %, un jeu etant mixe bien plus fort qu'un micro.
- Le curseur de volume fonctionne enfin : le pourcentage n'etait jamais divise par cent, si bien qu'il ne faisait rien au-dessus de 1 %.
- Il suit une courbe perceptive : a mi-course, douze decibels de moins. Au-dela de cent pour cent, le son est reellement amplifie.

## 0.2.4

- Les reglages sont refaits : vrais titres de section, groupes en cartes, colonne elargie.

## 0.2.3

- Le vocal qui lachait « des fois » : chaque entree fermait puis rouvrait tous les canaux d'ecoute, au moment ou la signalisation du salon s'etablissait.
- La porte de bruit passe sur le fil audio, qui n'est jamais ralenti quand la fenetre passe en arriere-plan.
- Les liens des messages s'ouvrent dans le navigateur du systeme, au lieu de ne rien faire.
