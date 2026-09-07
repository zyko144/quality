; Nettoyage des installations laissees par les anciens noms.
;
; Le probleme
; -----------
; L'application s'est appelee Orbit, puis Quality, puis Echow. L'installateur
; NSIS range chaque version sous son nom de produit : un dossier, un raccourci
; et une entree de desinstallation par nom. Renommer l'application n'a donc pas
; renomme l'installation existante — il en a cree une seconde a cote.
;
; Ce que voyaient les gens : deux raccourcis au menu Demarrer, deux lignes dans
; « Applications installees », et surtout une ancienne version qui se lancait
; encore quand ils cliquaient sur le raccourci qu'ils avaient l'habitude de
; cliquer. D'ou « chez moi c'est encore Quality » alors que la mise a jour etait
; bien passee : elle etait passee a cote, dans l'autre installation.
;
; Ce que fait ce fichier
; ----------------------
; Avant d'installer, il lance le desinstallateur des anciens noms s'il en reste,
; puis efface les raccourcis qui auraient survecu.
;
; Ce qu'il ne fait PAS : toucher aux donnees. Le desinstallateur de Tauri ne
; supprime le dossier de donnees que si l'on coche la case prevue ; en mode
; silencieux il n'y a pas de case, et rien n'est supprime. Sessions, reglages et
; raccourcis clavier survivent donc au nettoyage — ce qui est le minimum,
; puisque personne ne l'a demande.

; Desinstalle une installation portant un ancien nom de produit, si elle existe.
;
; Les deux ruches sont interrogees : l'installateur pose ses cles pour
; l'utilisateur courant (`HKCU`), mais une installation faite « pour tous les
; utilisateurs » les pose dans `HKLM`. N'en regarder qu'une laissait la moitie
; des cas en place.
!macro DesinstallerAncien NOM
  Push $0

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOM}" "UninstallString"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NOM}" "UninstallString"
  ${EndIf}

  ${If} $0 != ""
    ; `/S` : silencieux. Sans lui, une fenetre de desinstallation s'ouvrirait au
    ; milieu de la mise a jour, ce qui ressemblerait a tout sauf a une mise a
    ; jour. `ExecWait` pour que l'installation ne commence pas pendant que
    ; l'ancienne se retire.
    ExecWait '$0 /S' $0
  ${EndIf}

  ; Ceinture : un raccourci peut survivre a un desinstallateur absent ou casse,
  ; et c'est lui, pas l'entree de registre, qui relance l'ancienne version.
  Delete "$SMPROGRAMS\${NOM}.lnk"
  Delete "$DESKTOP\${NOM}.lnk"

  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DesinstallerAncien "Quality"
  !insertmacro DesinstallerAncien "Orbit"
!macroend

; Windows garde l'ancienne icone en memoire, et il faut le lui dire.
;
; Le probleme
; -----------
; « Force le logo, car la je l'ai pas dans ma barre des taches. »
;
; L'icone est bien dans le binaire — elle est compilee dedans — mais Windows
; ne la relit pas. Il tient un cache d'icones par chemin de fichier, et une
; mise a jour remplace l'executable SANS changer son chemin : le cache reste
; donc valable a ses yeux, et le raccourci epingle continue d'afficher
; l'ancienne image. Parfois pendant des semaines, jusqu'a ce qu'une session
; se termine.
;
; C'est d'autant plus deroutant que l'icone est correcte partout ailleurs —
; dans l'explorateur, au menu Demarrer — et fausse au seul endroit qu'on
; regarde tous les jours.
;
; Ce qu'on fait
; -------------
; Trois gestes, du plus doux au plus franc, parce que le premier ne suffisait
; pas : `-show` seul a ete essaye, et l'ancienne image est restee.
;
;  1. `ie4uinit.exe -ClearIconCache` invalide le cache ;
;  2. `ie4uinit.exe -show` demande a l'interpreteur de commandes de le
;     reconstruire ;
;  3. les fichiers du cache sont effaces a la main.
;
; Le troisieme n'est pas une precaution de trop. Depuis Windows 10, les images
; ne vivent plus dans le seul `IconCache.db` que `ie4uinit` connait, mais dans
; une serie de `iconcache_<taille>.db` — une par definition d'ecran. Verifie sur
; la machine ou le defaut se voit : les quinze fichiers s'effacent sans que
; l'explorateur proteste, et il les reconstruit a partir des binaires.
;
; Ce qu'on ne fait PAS : redemarrer l'explorateur. C'est le remede infaillible,
; et il ferme toutes les fenetres ouvertes de qui installe une mise a jour. Une
; icone se corrige au pire au prochain demarrage ; une session de travail
; perdue, non.
;
; L'echec est ignore d'un bout a l'autre : une icone qui met un jour a se
; rafraichir n'est pas une raison d'interrompre une installation qui, elle, a
; reussi.
!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ExecWait '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'

  ; Les caches par definition d'ecran. `Delete` echoue en silence sur un
  ; fichier verrouille, ce qui est exactement le comportement voulu ici.
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  Delete "$LOCALAPPDATA\IconCache.db"

  ClearErrors
!macroend
