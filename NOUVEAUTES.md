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

## 0.3.2

### Corrige

- Le son du partage n'etait jamais capture, quelle que soit la source choisie. La cause n'etait pas Windows mais nous : le drapeau qui supprime la fenetre de selection du systeme — celui qui nous permet d'avoir notre propre selecteur — supprime aussi la case « partager aussi le son » qu'elle contient. Sans cette case, Chromium n'accorde jamais la piste audio.
- Le message affiche pendant un partage muet accusait Windows. Il dit desormais la vraie cause, et ce qu'il faut faire.

### Nouveau

- Le choix vous revient : cocher « Partager le son de l'ordinateur » et relancer rend la fenetre de Windows a la place de notre selecteur, en echange du son. Les deux ne peuvent pas coexister — la case est dans la fenetre qu'on supprime.

### Ameliore

- L'abonnement s'appelle Waves.

## 0.3.1

### Nouveau

- Un ecran de regles avant d'entrer, a lire jusqu'en bas. Sept points, ce sont les seules choses qu'on ne peut pas decouvrir en se servant de l'application. Le bouton n'apparait qu'une fois le texte parcouru — cela ne garantit pas la lecture, seulement qu'on a vu qu'il y avait quelque chose a lire.
- Une verification a la creation de compte et a la demande de nouveau mot de passe : une question de tete, pas une case a cocher. Pas a la connexion — qui connait deja son mot de passe a franchi une porte plus solide.

### Ameliore

- L'acceptation est consignee en base, avec une date posee par le serveur et un numero de version. Une date fournie par le navigateur ne vaudrait que ce que vaut la montre de qui la pose.

## 0.3.0

### Corrige

- Le son d'un partage n'atteignait pas ceux qui rejoignaient **apres** son debut : seule l'image leur etait envoyee. Celui qui etait deja la entendait le jeu, l'arrivant voyait une image muette — et rien ne distinguait cela d'un partage sans son. Cela se voit surtout dans un serveur, ou l'on entre et sort pendant qu'une partie se joue.
- Le workflow de publication ne se lisait plus depuis trois versions : une commande contenait un vrai retour a la ligne la ou il fallait un echappement. Aucun paquet n'etait construit, 0.2.7 a 0.2.9 n'ont jamais ete publiees.

### Nouveau

- Quand le systeme refuse le son du partage, l'application le dit a qui partage. Windows ne l'accorde que pour un ecran entier ou un onglet, jamais pour une fenetre seule : sans cette precision, l'echec etait muet et se confondait avec un jeu silencieux.

### Ameliore

- Ce message des nouveautes est range par nature et colore : vert pour ce qui est repare, bleu pour ce qui est nouveau, ambre pour ce qui change. On voit s'il y a des corrections avant de lire lesquelles.

## 0.2.9

- Le message « aucun relais n'est configure » ne s'affiche plus en vocal. Il partait dans le canal des erreurs, celui des pannes reelles, pour dire que rien ne s'etait mal passe. Le constat vit maintenant dans les reglages, a cote de l'interrupteur concerne.
- La page de connexion passe a une seule colonne centree. La colonne de presentation redisait ce que la page d'accueil vient d'expliquer — on y arrive en cliquant « Se connecter », donc apres l'avoir lue.
- Le logo tourne pendant la connexion, comme au demarrage : la meme marque et le meme mouvement, pour que ce soit visiblement la meme chose qui travaille.
- **Waves**, l'abonnement de Quality, s'annonce sous « Amis ». Rien n'est encaissable : le bouton est desactive et le dit. Ce que Waves ne fera jamais est ecrit noir sur blanc.
- Les reglages et les fiches de profil respirent : titres de rubrique lisibles, explications limitees a une soixantaine de caracteres par ligne, rubriques separees.

## 0.2.8

- Un champ de recherche dans les parametres. Onze sections et une centaine de reglages : le classement est defendable, mais il suppose de partager le raisonnement de qui l'a range. Personne ne cherche « Voix et video » — on cherche « le truc qui enleve le bruit du clavier ». Taper « clavier » y mene.
- Chaque resultat dit dans quelle section il se trouve : la fois suivante, on y va directement.

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
