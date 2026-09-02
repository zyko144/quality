"""Detoure un badge livre sur fond sombre.

    python outils/detourer.py entree.png src/assets/badges/pionnier.png

Options
    --taille N    cote du carre produit (256 par defaut)
    --marge N     pixels de vide autour du dessin, en pourcentage du cote (6)
    --fond R,G,B  couleur du fond, si l'estimation se trompe
    --seuil A,B   distances de bascule, sur 255 (14,140 par defaut)
    --apercu F    ecrit en plus une planche avant/apres, sur damier

Pourquoi pas un simple seuil
----------------------------
Ces dessins ne s'arretent pas net : ils rayonnent. Une lueur, c'est du fond
qu'on voit a travers le dessin, et un seuil doit trancher — il la garde en bloc,
et le badge traine un halo carre, ou il la coupe, et le badge parait decoupe aux
ciseaux. Les deux se voient immediatement sur une page claire, ou le halo garde
la couleur du fond d'origine.

L'opacite est donc CONTINUE : proportionnelle a la distance entre le pixel et le
fond. La lueur devient du semi-transparent, ce qu'elle est reellement, et se
repose ensuite sur n'importe quel fond.

Deux precautions
----------------
**La couleur est desaturee du fond.** Un pixel a demi opaque a ete melange au
fond avant d'arriver : le rendre tel quel le laisserait teinte de ce fond pour
toujours. On remonte donc la couleur d'origine (`c = f + (p - f) / a`), sans quoi
un badge detoure d'un fond bleu nuit garde un voile bleu sur page blanche.

**La borne haute est volontairement loin (140 sur 255).** Basse — 64 — une lueur
un peu vive depasse la barre et devient OPAQUE : elle emporte alors la couleur
qu'elle avait une fois melangee au fond, et le badge se retrouve cercle d'un
anneau brun sur page blanche. C'est le defaut le plus visible du procede, et il
ne se voit que sur fond clair. Loin, la lueur reste a l'etat de demi-teinte,
c'est-a-dire ce qu'elle est.

Mesure, sur un badge dore a forte lueur pose sur bleu nuit puis recompose sur
blanc — luminance de la lueur, ou 255 est l'invisible :

    seuil 14,64    moyenne 169    l'anneau se voit
    seuil 14,140   moyenne 213    l'anneau ne se voit plus

Si un dessin ressort quand meme cercle, c'est cette borne qu'il faut monter.

**Le dedans n'est jamais efface.** Un badge peut contenir des zones aussi
sombres que le fond — un creux, une ombre portee, un contour noir. Juger au
pixel les effacerait et percerait le dessin. Seul ce qui TOUCHE le bord par un
chemin continu de fond est du fond ; le reste est garde, meme noir.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def estimer_fond(rgb: np.ndarray) -> np.ndarray:
    """La couleur dominante sur l'anneau exterieur.

    La mediane, et non la moyenne : si un morceau de dessin touche le bord, la
    moyenne se decale vers lui alors que la mediane l'ignore.
    """
    bande = max(2, min(rgb.shape[0], rgb.shape[1]) // 40)
    anneau = np.concatenate([
        rgb[:bande].reshape(-1, 3),
        rgb[-bande:].reshape(-1, 3),
        rgb[:, :bande].reshape(-1, 3),
        rgb[:, -bande:].reshape(-1, 3),
    ])
    return np.median(anneau, axis=0)


def detourer(
    image: Image.Image,
    fond: np.ndarray | None = None,
    seuil: tuple[float, float] = (14.0, 140.0),
) -> Image.Image:
    rgb = np.asarray(image.convert('RGB'), dtype=np.float64)
    if fond is None:
        fond = estimer_fond(rgb)

    # Distance au fond, par pixel.
    ecart = np.linalg.norm(rgb - fond, axis=2)

    bas, haut = seuil
    if haut <= bas:
        raise SystemExit('--seuil veut deux valeurs croissantes, par exemple 14,140')

    # Opacite continue entre les deux seuils : c'est ce qui garde la lueur.
    alpha = np.clip((ecart - bas) / (haut - bas), 0.0, 1.0)

    # Ce qui touche le bord par un chemin continu de fond est du fond. Le reste
    # est le dedans du dessin : garde opaque, meme sombre.
    candidat = ecart < haut
    depart = np.zeros_like(candidat)
    depart[0, :] = depart[-1, :] = True
    depart[:, 0] = depart[:, -1] = True
    depart &= candidat

    dehors = ndimage.binary_propagation(depart, mask=candidat)
    alpha = np.where(dehors, alpha, 1.0)

    # La couleur est desaturee du fond : sans cela, tout ce qui est a demi
    # opaque garde la teinte du fond d'origine.
    a = alpha[..., None]
    couleur = np.where(a > 0.004, fond + (rgb - fond) / np.maximum(a, 0.004), rgb)

    sortie = np.concatenate([np.clip(couleur, 0, 255), alpha[..., None] * 255], axis=2)
    return Image.fromarray(sortie.astype(np.uint8), 'RGBA')


def cadrer(image: Image.Image, taille: int, marge: float) -> Image.Image:
    """Recadre sur le dessin, puis pose le tout dans un carre."""
    boite = image.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if boite:
        image = image.crop(boite)

    cote = max(image.size)
    plein = max(1, int(round(cote * (1 + 2 * marge))))
    carre = Image.new('RGBA', (plein, plein), (0, 0, 0, 0))
    carre.paste(image, ((plein - image.width) // 2, (plein - image.height) // 2))
    return carre.resize((taille, taille), Image.LANCZOS)


def damier(taille: tuple[int, int], case: int = 12) -> Image.Image:
    """Un fond a carreaux, pour voir la transparence plutot que la deviner."""
    fond = Image.new('RGB', taille, (255, 255, 255))
    pixels = fond.load()
    for y in range(taille[1]):
        for x in range(taille[0]):
            if ((x // case) + (y // case)) % 2:
                pixels[x, y] = (206, 206, 210)
    return fond


def main(argv: list[str]) -> int:
    positionnels: list[str] = []
    options: dict[str, str] = {}

    i = 0
    while i < len(argv):
        if argv[i].startswith('--'):
            if i + 1 >= len(argv):
                raise SystemExit(f'{argv[i]} attend une valeur')
            options[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            positionnels.append(argv[i])
            i += 1

    if len(positionnels) != 2:
        raise SystemExit(__doc__)

    entree, sortie = Path(positionnels[0]), Path(positionnels[1])
    taille = int(options.get('taille', 256))
    marge = float(options.get('marge', 6)) / 100
    fond = None
    if 'fond' in options:
        fond = np.array([float(v) for v in options['fond'].split(',')])
    seuil = (14.0, 140.0)
    if 'seuil' in options:
        bas, haut = options['seuil'].split(',')
        seuil = (float(bas), float(haut))

    source = Image.open(entree)
    decoupe = cadrer(detourer(source, fond, seuil), taille, marge)

    sortie.parent.mkdir(parents=True, exist_ok=True)
    decoupe.save(sortie)

    couverture = np.asarray(decoupe.getchannel('A'), dtype=np.float64).mean() / 255
    print(f'{entree.name} -> {sortie}  ({taille}x{taille}, {couverture:.0%} d\'encre)')

    if 'apercu' in options:
        avant = source.convert('RGB')
        avant.thumbnail((taille, taille), Image.LANCZOS)
        planche = damier((taille * 2 + 24, taille))
        planche.paste(avant, (0, (taille - avant.height) // 2))
        planche.paste(decoupe, (taille + 24, 0), decoupe)
        planche.save(options['apercu'])
        print(f'apercu -> {options["apercu"]}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
