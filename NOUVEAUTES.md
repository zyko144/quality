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

## 0.4.3

### Corrige

- **La fenetre ne se deplacait plus.** La barre de titre du systeme est desactivee : deplacer la fenetre nous revient, et cela ne fonctionne que sur les elements qui portent la marque prevue. Seul l'en-tete d'un salon l'avait. Des qu'on ouvrait Amis, Waves, Suggestions ou Support, la fenetre devenait immobile — et cela s'est vu d'un coup, puisque ces pages ne s'ouvraient pas du tout avant la version precedente.
- **Le son du partage partait a la qualite d'un telephone.** La retouche appliquee au flux sonore s'arretait a la premiere piste, ce qui suffisait tant qu'il n'y avait que le micro. Depuis que le partage emporte le son de l'ordinateur, il y en a deux — et la seconde, celle qui porte le jeu ou la musique, restait en mono a trente-deux kilobits. Elle ne recevait pas non plus de plafond de debit, la ou la voix en avait un.

### Ameliore

- **Les commandes de fenetre sont trois pastilles de couleur** : vert pour reduire, orange pour agrandir, rouge pour fermer. Le trait, le carre et la croix disaient ce que la position dit deja. Les noms restent pour le clavier et les lecteurs d'ecran — une couleur ne se lit pas, et beaucoup ne distinguent pas le vert du rouge.
- **L'abonnement s'appelle desormais « Echow + »**, et passe en maintenance : barre en rouge dans la liste. « Bientot » annoncait une attente qui avance, ce qui n'etait plus vrai.

## 0.4.2

### Corrige

- **Le son d'un partage n'arrivait pas, alors qu'il partait bien.** Le micro d'une personne et le son de son partage voyagent dans deux flux distincts, et l'on distingue le second par la piste video qui l'accompagne. Mais les deux pistes n'arrivent pas ensemble, et rien n'impose que l'image precede : quand le son prenait les devants, son flux paraissait ne porter que de l'audio. Il etait alors pris pour une voix — il ecrasait le micro de la personne au passage — et n'atteignait jamais le curseur du partage, qui affichait « ce partage n'envoie pas de son » pendant que le son partait. Le classement se corrige desormais des que l'image ou l'annonce arrive.
- **Celui qui regarde sait pourquoi il n'entend rien.** L'infobulle affirmait « c'est un reglage de la personne qui partage » — ce qu'on ignorait. Elle distingue maintenant trois cas : le son part et tarde, il ne part pas, ou l'application d'en face ne sait pas encore le capturer. On cesse ainsi de chercher chez soi un defaut qui est ailleurs.

## 0.4.1

### Corrige

- **Le son du partage part enfin.** Il etait capture par le moteur web, qui ne l'accorde qu'apres une case a cocher vivant dans la fenetre de selection de Windows — celle-la meme qu'on supprime pour afficher la notre. Deux contournements avaient echoue, le second en tuant l'application a chaque partage. La capture se fait desormais cote natif, par le bouclage audio de Windows : le moteur n'a plus son mot a dire.
- **Un partage qu'on demandait a voir pouvait ne rien afficher.** Le role d'un flux — partage ou camera — voyage par le canal de signalisation, l'image par la connexion media. Quand l'annonce se perdait, la piste restait en attente pour toujours : le bouton passait a « Masquer » et rien n'apparaissait, sans que celui qui partageait puisse s'en douter. La presence dit deja qui partage ; elle sert desormais de repli, et cliquer « Regarder » tranche a lui seul.
- **Ouvrir Amis, Waves, Suggestions ou Support depuis un espace ne faisait rien.** Ces quatre pages liberent le salon actif en passant en vue privee — et un garde-fou voyait alors un espace ouvert sans salon choisi, et en rouvrait un aussitot. La page s'ouvrait et se refermait dans le meme rendu. Le defaut ne se voyait pas depuis la vue privee, ou aucun espace n'est actif : c'est-a-dire partout ou l'on pense a essayer.
- **Les images sautaient dans les jeux rapides.** Deux causes. Le partage d'une fenetre repassait par un canevas dont la cadence tournait a son propre rythme, sans rapport avec celui de la source : les deux horloges derivaient, et une image etait prise deux fois ou pas du tout. Ce meme canevas travaillait de plus a la taille de la fenetre a l'ecran, meme quand la capture arrivait deja reduite — on agrandissait une image reduite avant de l'encoder, et l'encodeur payait ce surcout en images perdues.
- **Un partage muet ne dit plus « deux chemins ont ete essayes ».** Il dit lequel a echoue et pourquoi : peripherique introuvable, bouclage refuse par Windows, format inconnu. Ces raisons existaient deja cote systeme ; elles etaient jetees en chemin.

### Nouveau

- **Un espace Support**, en rouge a droite d'« Ajouter un ami ». On y depose une demande, on suit l'echange, et on la clot soi-meme quand elle est reglee. Ce qu'on y ecrit n'est lu que par l'equipe : ni les proprietaires d'espaces, ni personne d'autre n'y ont acces.
- **Les suggestions sont devenues un salon.** La liste au-dessus, le champ en bas, comme partout ailleurs. La commande `/suggestion` repondait depuis n'importe quel salon : elle partait donc d'une conversation ou plus personne ne la reverrait, vers une page que son auteur decouvrait au moment de l'envoi — sans avoir vu ce qui avait deja ete propose. Elle ne repond plus qu'ici, ou elle n'est d'ailleurs plus necessaire.
- **Un compte peut etre suspendu.** Datee et motivee : la levee se fait toute seule, et le motif est lu par la personne concernee. La suspension empeche d'ecrire, jamais de lire ni de joindre le support — c'est la qu'on conteste une decision, et une decision peut etre une erreur.
- **L'application tient un journal de ses propres defauts** et le fait remonter, pour que « ca a coupe » devienne quelque chose qu'on puisse corriger. Il ne contient ni contenu de message, ni nom de fichier partage, ni adresse IP : des identifiants, des nombres et des noms d'etats. Ce qu'on n'y met pas ne peut pas fuir.

### Ameliore

- **Rejoindre un salon vocal est plus rapide.** Une attente d'un dixieme de seconde etait payee a chaque changement de salon, le temps que le systeme rende le micro precedent — pour un echec qui n'arrive presque jamais, et qui savait deja se rattraper seul. Les canaux restants se ferment desormais de front plutot qu'a la file.

## 0.4.0

### Corrige

- **Se demuter laissait sourd.** Deux chemins de sortie audio se relayaient sans se defaire : une fois le graphe ouvert pour amplifier quelqu'un, le volume de l'element restait a zero, et revenir dessus donnait un silence definitif qu'il fallait relancer l'application pour lever. C'est aussi ce qui faisait qu'on n'entendait plus certaines personnes.
- Se rendre sourd ne coupait pas les voix amplifiees : l'attribut `muted` d'un element audio n'a aucune prise sur le graphe. Sourdine et coupure sont desormais des gains a zero, une seule valeur d'ou tout decoule.
- Le casque de l'icone de sourdine paraissait perce : ses coussinets etaient des contours fermes, et tout le jeu d'icones est trace sans remplissage.
- Le logo etait pixelise dans la barre des taches. Chaque taille est desormais rendue depuis un maitre de 2048 pixels, et l'icone Windows en porte dix — le systeme prend celle dont il a besoin au lieu d'en reduire une autre.
- Le logo est centre sur la forme de la vague et non sur le cadre de l'image : la pointe de la bulle decalait tout vers le bas.

### Nouveau

- Les raccourcis vocaux se choisissent. Ils etaient fixes dans le code — or `Ctrl+Maj+M` est deja pris par plusieurs jeux, et qui parle en jouant n'avait aucun moyen de contourner le conflit.
- **Parler en maintenant une touche.** Relacher rend l'etat qui precedait l'appui, plutot que de couper : qui parlait deja micro ouvert continue de parler.
- Le volume d'un partage se regle sur l'image, a cote du plein ecran. Il n'existait que dans le menu contextuel de la personne, a trois gestes d'un son trop fort.
- Dans la liste des salons, un anneau colore autour de la photo dit qui est muet et qui est sourd — rouge et orange, comme sur la scene vocale.

## 0.3.9

### Nouveau

- Le logo revient a la vague en spirale d'origine, en blanc sur un disque noir, et rond partout — dans l'application, sur la barre des taches, dans le menu Demarrer et sur le site.

## 0.3.8

### Nouveau

- L'application s'appelle **Echow**. Les derniers textes qui portaient encore l'ancien nom sont repris.

### Corrige

- Les liens de telechargement du site pointaient vers un depot qui n'existe pas : le renommage les avait fait viser `zyko144/Echow`, quand le depot reste `zyko144/quality`. Tous les boutons rendaient une erreur 404.
- L'installateur est publie sous ses deux noms pendant la transition, pour que les liens deja partages continuent de repondre.

## 0.3.7

### Corrige

- **L'application tombait a chaque partage d'ecran.** Le detour ajoute en 0.3.5 pour recuperer le son demandait la sortie du systeme par des contraintes heritees de Chromium, sans identifiant de source. WebView2 traite cet appel comme un message malforme et tue le processus de rendu : page blanche, application a relancer. Le detour est retire.
- Un partage muet vaut infiniment mieux qu'une application qui tombe. Le son se fera donc autrement.

## 0.3.6

### Corrige

- La fenetre de selection de Windows est de nouveau supprimee, pour de bon. C'est moi qui l'avais fait revenir : le mecanisme cense rendre le son reaffirmait la preference a chaque ouverture du selecteur, et comme la case est cochee par defaut, le lanceur cessait de poser le drapeau. Le mecanisme entier est retire — il n'avait pas lieu d'exister.
- Le son du partage est desormais pris uniquement par le bouclage du systeme, sans aucune fenetre.

## 0.3.5

### Corrige

- Le son du partage est capture par un autre chemin, sans rendre la fenetre de selection de Windows. Ma correction precedente proposait de la faire revenir en echange du son : c'etait exactement ce qu'on avait entrepris de retirer, donc pas une solution.
- Chromium expose une voie anterieure a `getDisplayMedia`, toujours en place, qui rend la sortie de l'ordinateur sans rien afficher. C'est celle qu'emploient les applications Electron pour la meme raison. Elle est tentee des que la premiere n'a pas donne de son.
- La liste des suggestions ne s'installait pas : `max()` n'existe pas pour les booleens en PostgreSQL.

### Ameliore

- Le message affiche pendant un partage muet dit desormais que deux chemins ont ete essayes, et ce qu'il resterait a faire.

## 0.3.4

### Corrige

- Cocher « Partager le son de l'ordinateur » ne changeait rien, meme apres un redemarrage. La case etait deja cochee par defaut : la cocher n'ecrivait donc rien, et le lanceur — qui supposait l'inverse tant qu'aucun fichier ne le contredit — restait sur son choix. Les deux valeurs par defaut ne s'accordaient pas.
- L'application demande maintenant au lanceur ce qu'il a reellement decide, au lieu de le deviner. L'avertissement « relancez » apparait donc quand il le faut, et la preference est reaffirmee a chaque ouverture du selecteur.
- La liste des suggestions ne s'installait pas : `max()` n'existe pas pour les booleens en PostgreSQL.

## 0.3.3

### Nouveau

- Un espace **Suggestions**, sous Waves. On y propose par la commande `/suggestion` suivie de son idee, depuis n'importe quel salon — c'est la seule porte d'entree : ecrire une commande demande d'avoir voulu proposer, la ou un champ toujours ouvert recueille surtout des essais.
- On vote pour ou contre. Le vote est binaire et non un compte de « j'aime » : une idee peut deranger autant qu'elle plait, et une echelle a un seul sens ne dirait que la moitie de ce qu'on veut savoir. Recliquer sur son vote le retire.
- Les plus soutenues remontent. Une liste chronologique enterrerait une bonne idee sous une semaine de nouvelles.

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
